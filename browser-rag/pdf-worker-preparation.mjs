import {verifyAssetResponse,VerifiedStreamError} from './verified-stream.mjs';

export const PDF_WORKER_PREPARATION_SPEC=Object.freeze({parserVersion:'6.4.299',bytes:2229713,
  sha256:'07ceb740d746e5d9012fcf9f27d5c7dea09f7d2f5e74f5c8109e5787551a2333',deadlineMs:120000});
const MESSAGES=Object.freeze({
  INVALID_PDF_WORKER_PREPARATION:'The static PDF worker preparation configuration is invalid.',
  PDF_WORKER_PREPARATION_TIMEOUT:'Static PDF worker preparation exceeded its fixed 120-second budget.',
  PDF_WORKER_PREPARATION_INTEGRITY:'The static PDF worker body did not match its pinned size and SHA-256.',
  PDF_WORKER_PREPARATION_FAILED:'Static PDF worker preparation failed. No parser was started.',
  ABORTED:'Static PDF worker preparation was cancelled.',
});
export class PdfWorkerPreparationError extends Error{
  constructor(code){const safe=typeof code==='string'&&Object.hasOwn(MESSAGES,code)?code:'PDF_WORKER_PREPARATION_FAILED';
    super(MESSAGES[safe]);this.name='PdfWorkerPreparationError';this.code=safe;}
}
const signalAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const addListener=EventTarget.prototype.addEventListener,removeListener=EventTarget.prototype.removeEventListener;
const responseUrl=Object.getOwnPropertyDescriptor(Response.prototype,'url').get;
const responseBody=Object.getOwnPropertyDescriptor(Response.prototype,'body').get;
function configuration(options){
  try{
    if(options===null||typeof options!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw Error();
    const keys=Reflect.ownKeys(options);
    if(!keys.includes('signal')||keys.some(key=>!['signal','onProgress'].includes(key)))throw Error();
    const values={};for(const key of keys){const property=Object.getOwnPropertyDescriptor(options,key);
      if(!property||!Object.hasOwn(property,'value')||!property.enumerable)throw Error();values[key]=property.value;}
    if(!(values.signal instanceof AbortSignal)||(values.onProgress!==undefined&&typeof values.onProgress!=='function'))throw Error();
    signalAborted.call(values.signal);
    const module=new URL(import.meta.url),page=new URL(globalThis.location.href);
    const loopback=module.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(module.hostname);
    if((module.protocol!=='https:'&&!loopback)||page.origin!==module.origin||module.username||module.password)throw Error();
    const url=new URL('./vendor/build/pdf.worker.mjs',module);
    if(url.origin!==page.origin||url.search||url.hash||url.username||url.password)throw Error();
    return {...values,url:url.href};
  }catch{throw new PdfWorkerPreparationError('INVALID_PDF_WORKER_PREPARATION');}
}
function cancelUnused(response){
  try{const body=responseBody.call(response);if(body&&!body.locked)Promise.resolve(body.cancel()).catch(()=>{});}catch{}
}

// Ordinary HTTP caching is advisory. This function does not populate CacheStorage,
// install/bypass Service Workers, execute script, or guarantee native Worker reuse.
export async function preparePdfWorker(options){
  const {signal,onProgress,url}=configuration(options);
  if(signalAborted.call(signal))throw new PdfWorkerPreparationError('ABORTED');
  const started=performance.now(),inner=new AbortController();
  let finished=false,reason=null,timer,response,reader,verification,rejectStopped;
  const stopped=new Promise((_,reject)=>{rejectStopped=reject;});stopped.catch(()=>{});
  const stop=code=>{
    if(finished||reason)return;reason=new PdfWorkerPreparationError(code);
    // Settle the race before abort listeners; a stalled native/injected fetch or
    // upstream read cannot prolong this selection's static deadline.
    rejectStopped(reason);inner.abort();
  };
  const aborted=()=>stop('ABORTED');
  const assertOwned=()=>{
    if(signalAborted.call(signal))stop('ABORTED');
    if(!reason&&performance.now()-started>=PDF_WORKER_PREPARATION_SPEC.deadlineMs)stop('PDF_WORKER_PREPARATION_TIMEOUT');
    if(reason)throw reason;
  };
  const wait=async promise=>{const value=await Promise.race([promise,stopped]);assertOwned();return value;};
  const progress=completed=>{
    assertOwned();onProgress?.(Object.freeze({completed,total:PDF_WORKER_PREPARATION_SPEC.bytes,unit:'bytes',estimated:false}));assertOwned();
  };
  addListener.call(signal,'abort',aborted,{once:true});
  timer=setTimeout(()=>stop('PDF_WORKER_PREPARATION_TIMEOUT'),PDF_WORKER_PREPARATION_SPEC.deadlineMs);
  try{
    assertOwned();progress(0);
    const fetching=Promise.resolve().then(()=>{
      assertOwned();return fetch(url,{mode:'same-origin',credentials:'omit',redirect:'error',cache:'default',referrerPolicy:'no-referrer',signal:inner.signal});
    });
    // A response arriving after a revoked race is not consumed or executed.
    fetching.then(value=>{if(finished||reason)cancelUnused(value);},()=>{});
    response=await wait(fetching);
    if(responseUrl.call(response)!==url)throw new PdfWorkerPreparationError('PDF_WORKER_PREPARATION_INTEGRITY');
    verification=verifyAssetResponse(response,{url,bytes:PDF_WORKER_PREPARATION_SPEC.bytes,sha256:PDF_WORKER_PREPARATION_SPEC.sha256},
      {signal:inner.signal,onProgress:value=>{if(!value.verified)progress(value.completed);}});
    reader=verification.response.body.getReader();
    for(;;){const item=await wait(reader.read());if(item.done)break;}
    await wait(verification.completion);assertOwned();
    return Object.freeze({schemaVersion:1,status:'static-pdf-worker-body-verified',parserVersion:PDF_WORKER_PREPARATION_SPEC.parserVersion,
      url,bytes:PDF_WORKER_PREPARATION_SPEC.bytes,sha256:PDF_WORKER_PREPARATION_SPEC.sha256,
      elapsedMs:performance.now()-started,cacheScope:'browser-http-cache-advisory'});
  }catch(error){
    if(reason)throw reason;
    if(signalAborted.call(signal))throw new PdfWorkerPreparationError('ABORTED');
    let code='PDF_WORKER_PREPARATION_FAILED';
    try{
      if(error instanceof PdfWorkerPreparationError)code=Object.getOwnPropertyDescriptor(error,'code')?.value;
      else if(error instanceof VerifiedStreamError&&Object.getOwnPropertyDescriptor(error,'code')?.value==='ASSET_INTEGRITY_ERROR')code='PDF_WORKER_PREPARATION_INTEGRITY';
    }catch{} // A rejection Proxy can throw even during an instanceof check.
    throw new PdfWorkerPreparationError(code);
  }finally{
    finished=true;clearTimeout(timer);removeListener.call(signal,'abort',aborted);
    // Cancellation is deliberately not awaited: an upstream cancel promise may
    // itself stall. The owned verifier aborts/releases its upstream reader.
    inner.abort();
    if(reader){try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
    else if(response)cancelUnused(response);
  }
}
