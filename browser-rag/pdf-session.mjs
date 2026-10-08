import {createController} from './protocol.mjs';
import {ComputeError} from './compute-source.mjs';

const SAFE_CODES = new Set(['INVALID_RECORD','INVALID_INPUT','FILE_TOO_LARGE','INVALID_PDF',
  'PARSER_VERSION_UNSUPPORTED','WORKER_UNAVAILABLE','INVALID_LIMITS','EXTRACTION_LIMIT','EMPTY_DOCUMENT',
  'PDF_PASSWORD_REQUIRED','EXTRACTION_FAILED','CLEANUP_FAILED','ABORTED']);

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>record(value)&&Reflect.ownKeys(value).length===keys.length
  &&Reflect.ownKeys(value).every(key=>keys.includes(key));
const COUNT_KEYS=['chunks','outputUtf16','fragments'];

// The adapter validates the full artifact. This small boundary guard prevents
// accidental source/chunk data from ever entering the lifecycle controller.
function chunkReceipt(result,source) {
  if(!exact(result,['event','artifact'])||result.event?.kind!=='result'||result.event.stage!=='index'
      ||!exact(result.event.payload,['data']))return false;
  const data=result.event.payload.data,artifact=result.artifact;
  return exact(data,['sourceSha256','parserVersion','pageCount','status','chunkerVersion','counts'])
    &&data.sourceSha256===source.source.sha256&&data.parserVersion===source.parser.version
    &&data.pageCount===source.numPages&&data.status==='chunked-not-embedded'
    &&data.chunkerVersion==='page-parser-order-v1'&&exact(data.counts,COUNT_KEYS)
    &&COUNT_KEYS.every(key=>Number.isSafeInteger(data.counts[key])&&data.counts[key]>0)
    &&record(artifact)&&artifact.source?.sha256===data.sourceSha256
    &&artifact.parser?.version===data.parserVersion&&artifact.numPages===data.pageCount
    &&artifact.status===data.status&&artifact.chunker?.version===data.chunkerVersion
    &&exact(artifact.counts,COUNT_KEYS)&&COUNT_KEYS.every(key=>artifact.counts[key]===data.counts[key])
    &&Array.isArray(artifact.chunks)&&artifact.chunks.length===data.counts.chunks;
}

export function createPdfSession({extract,parserOptions={},compute,computeOptions={},onState=()=>{},
  runtimeId=crypto.randomUUID(),runtimeIdFactory=()=>crypto.randomUUID()}) {
  if(typeof extract!=='function') throw new TypeError('A parser adapter is required');
  const controller=createController(runtimeId);
  let source=null,chunks=null,aborter=null,status='idle',error=null,invalidating=false;
  const snapshot=()=>Object.freeze({status,error,lifecycle:controller.snapshot()});
  const notify=()=>onState(snapshot());
  function invalidate(replace,retainSource=false,nextStatus='idle') {
    invalidating=true;
    try {
      // Commit the revoked state and detach the old owner before synchronous
      // abort listeners run. Those listeners cannot start a replacement beneath
      // this transition; direct calls after it returns can retry normally.
      if(replace) controller.replaceDocument(); else controller.cancel();
      const ownedAborter=aborter;aborter=null;
      chunks=null;if(!retainSource)source=null;error=null;status=nextStatus;
      ownedAborter?.abort();
    } finally { invalidating=false; }
  }
  return {
    snapshot,
    document:()=>source,
    chunks:()=>chunks,
    cancel(){ if(invalidating||controller.snapshot().active===null) return; invalidate(false,status==='chunking','cancelled');notify(); },
    clear(){ if(invalidating)return;invalidate(true);notify(); },
    async chunk(options={}){
      if(invalidating||source===null||controller.snapshot().active!==null||typeof compute!=='function'
          ||typeof runtimeIdFactory!=='function')throw new ComputeError('INVALID_COMPUTE_CONFIG');
      // Validate the incarnation before changing accepted state. The existing
      // controller rejects every previously used ID, including A -> B -> A.
      try{
        const incarnation=runtimeIdFactory();
        if(typeof incarnation!=='string'||incarnation.length>256||incarnation.trim().length===0)
          throw new ComputeError('INVALID_COMPUTE_CONFIG');
        controller.replaceRuntime(incarnation);
      }catch{throw new ComputeError('INVALID_COMPUTE_CONFIG');}
      const identity=controller.begin('ingest'),ownedSource=source;
      const ownedAborter=new AbortController();aborter=ownedAborter;
      let seq=0;chunks=null;error=null;status='chunking';notify();
      const failure=code=>({...identity,kind:'error',stage:'index',seq:seq+1,
        payload:{code:code.code,message:code.message}});
      try{
        const result=await compute(ownedSource,{...computeOptions,identity,signal:ownedAborter.signal,
          onProgress:event=>{
            // Reserve the last safe sequence for a terminal so even an adapter
            // refusal after progress can close this operation with a safe error.
            if(event?.kind!=='progress'||event.stage!=='index'||event.seq===Number.MAX_SAFE_INTEGER)return;
            if(controller.accept(event).accepted){seq=event.seq;notify();}
          },chunkOptions:options});
        if(!chunkReceipt(result,ownedSource))throw new ComputeError('WORKER_PROTOCOL_ERROR');
        // Preserve the original worker terminal. No await or notification can
        // interleave acceptance with the artifact/status commit.
        if(controller.accept(result.event).accepted){
          chunks=result.artifact;status='chunked-not-embedded';aborter=null;notify();
        }else if(!ownedAborter.signal.aborted){
          throw new ComputeError('WORKER_PROTOCOL_ERROR');
        }
      }catch(cause){
        const safe=new ComputeError(cause?.code);
        if(controller.accept(failure(safe)).accepted){
          error=Object.freeze({code:safe.code,message:safe.message});status='runtime-error';aborter=null;notify();
        }
      }
    },
    async select(file){
      if(invalidating)throw new ComputeError('INVALID_COMPUTE_CONFIG');
      invalidate(true);
      const identity=controller.begin('ingest');
      const ownedAborter=new AbortController(); aborter=ownedAborter;
      let seq=0;status='parsing';notify();
      const event=(kind,payload)=>({...identity,kind,stage:'parse',seq:++seq,payload});
      try {
        const candidate=await extract(file,{...parserOptions,signal:ownedAborter.signal,
          onProgress:progress=>{
            if(controller.accept(event('progress',progress)).accepted) notify();
          }});
        const metadata={sourceSha256:candidate.source.sha256,parserVersion:candidate.parser.version,
          pageCount:candidate.numPages,status:'extracted-not-indexed'};
        // No await between acceptance and source commit. The source itself never
        // enters the lifecycle controller's bounded metadata state.
        if(controller.accept(event('result',{data:metadata})).accepted){
          source=candidate;status='extracted-not-indexed';aborter=null;notify();
        }
      } catch(cause){
        const code=SAFE_CODES.has(cause?.code)?cause.code:'PDF_PARSE_ERROR';
        const message='PDF extraction did not complete. No source was committed.';
        if(controller.accept(event('error',{code,message})).accepted){
          error=Object.freeze({code,message});status='runtime-error';aborter=null;notify();
        }
      }
    },
  };
}
