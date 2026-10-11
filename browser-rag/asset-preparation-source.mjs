import {EMBEDDING_PREPARATION_PINS} from './embedding-runtime.mjs';
import {GENERATOR_PREPARATION_PINS} from './generator-native-core.mjs';
import {preparationTransport,copyExternalReads,copyTransportFailure} from './asset-preparation-transport.mjs';
import {copyWorkerFailure,createRuntimeFailure} from './runtime-failure-contract.mjs';

const MESSAGES=Object.freeze({
  INVALID_ASSET_PREPARATION:'The asset preparation configuration is invalid.',
  ASSET_PREPARATION_FAILED:'Static asset preparation failed. No complete preparation receipt was committed.',
  ASSET_PREPARATION_TIMEOUT:'Static asset preparation exceeded its fixed time budget.',
  ASSET_TRANSPORT_REFUSED:'The explicit static asset transport was refused.',
  WORKER_UNAVAILABLE:'A native asset preparation worker is unavailable.',
  WORKER_PROTOCOL_ERROR:'The asset preparation worker channel was invalid.',
  ABORTED:'Static asset preparation was cancelled.',
});
export class AssetPreparationError extends Error {
  constructor(code,transportFailure=null){const safe=typeof code==='string'&&Object.hasOwn(MESSAGES,code)?code:'ASSET_PREPARATION_FAILED';super(MESSAGES[safe]);this.name='AssetPreparationError';this.code=safe;this.transportFailure=transportFailure;}
}
export const PREPARATION_READY_MS=10000;
export const PREPARATION_DEADLINE_MS=1800000;
export const PREPARATION_MAX_PACKETS=4096;
const RUNTIME_FILES=['transformers.min.js','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'];
export const PREPARATION_PROFILES=Object.freeze({
  encoder:Object.freeze({modelId:'Xenova/all-MiniLM-L6-v2',revision:'751bff37182d3f1213fa05d7196b954e230abad9',
    bytes:113629084,mode:'verified-assets',files:Object.freeze(['config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/model.onnx'])}),
  generator:Object.freeze({modelId:'onnx-community/Qwen2.5-0.5B-Instruct',revision:'22942cb7d7ba4cc81bb4673549ca4d4614469b5e',
    bytes:815725938,mode:'streamed-body',files:Object.freeze(['config.json','tokenizer.json','tokenizer_config.json','generation_config.json','onnx/model_q4.onnx'])}),
});
const IDENTITY_KEYS=['protocolVersion','runtimeId','operationId','documentEpoch','operation'];
const PROGRESS_KEYS=['completed','verified','total','unit','estimated','mode'];
const RECEIPT_KEYS=['schemaVersion','status','profile','modelId','revision','libraryVersion','ortVersion','assets',
  'verifiedBytes','networkBytes','cacheBytes','assetPins','elapsedMs'];
const fail=code=>{throw new AssetPreparationError(code);};
const signalAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const addSignalListener=EventTarget.prototype.addEventListener,removeSignalListener=EventTarget.prototype.removeEventListener;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
function data(value,keys){
  if(value===null||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('WORKER_PROTOCOL_ERROR');
  const actual=Reflect.ownKeys(value);
  if(actual.length!==keys.length||actual.some(key=>!keys.includes(key)))fail('WORKER_PROTOCOL_ERROR');
  const result={};for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)fail('WORKER_PROTOCOL_ERROR');result[key]=descriptor.value;}
  return result;
}
export function preparationProfile(profile){if(typeof profile!=='string'||!Object.hasOwn(PREPARATION_PROFILES,profile))fail('INVALID_ASSET_PREPARATION');return PREPARATION_PROFILES[profile];}
export function copyPreparationIdentity(raw){
  const value=data(raw,IDENTITY_KEYS);
  if(value.protocolVersion!==1||value.operation!=='prepare-assets'||typeof value.runtimeId!=='string'||!value.runtimeId.trim()||value.runtimeId.length>256
    ||typeof value.operationId!=='string'||!/^op-[1-9]\d{0,15}$/.test(value.operationId)||!integer(Number(value.operationId.slice(3)),1,Number.MAX_SAFE_INTEGER)
    ||!integer(value.documentEpoch,0,Number.MAX_SAFE_INTEGER))fail('WORKER_PROTOCOL_ERROR');
  return Object.freeze(value);
}
export function copyPreparationCommand(raw){
  const value=data(raw,['schemaVersion','kind','identity','profile','transport']);
  if(value.schemaVersion!==3||value.kind!=='prepare-assets')fail('WORKER_PROTOCOL_ERROR');preparationProfile(value.profile);
  try{preparationTransport(value.transport);}catch{fail('WORKER_PROTOCOL_ERROR');}
  return Object.freeze({...value,identity:copyPreparationIdentity(value.identity)});
}
export function copyPreparationProgress(raw,profile){
  const spec=preparationProfile(profile),value=data(raw,PROGRESS_KEYS);
  if(!integer(value.completed,0,spec.bytes)||!integer(value.verified,0,value.completed)||value.total!==spec.bytes
    ||value.unit!=='bytes'||value.estimated!==false||value.mode!==spec.mode
    ||(spec.mode==='verified-assets'&&value.completed!==value.verified))fail('WORKER_PROTOCOL_ERROR');
  return Object.freeze(value);
}
function copyReceipt(raw,profile,baseURL,version,transport){
  if(version===2)try{preparationTransport(transport);}catch{fail('WORKER_PROTOCOL_ERROR');}
  const spec=preparationProfile(profile),value=data(raw,RECEIPT_KEYS);
  if(value.schemaVersion!==version||value.status!=='static-assets-prepared-not-loaded'||value.profile!==profile||value.modelId!==spec.modelId||value.revision!==spec.revision
    ||value.libraryVersion!=='3.8.1'||value.ortVersion!=='1.22.0-dev.20250409-89f8206ba4'||value.assets!==8||value.verifiedBytes!==spec.bytes
    ||!integer(value.networkBytes,0,spec.bytes)||!integer(value.cacheBytes,0,spec.bytes)||value.networkBytes+value.cacheBytes!==spec.bytes
    ||typeof value.elapsedMs!=='number'||!Number.isFinite(value.elapsedMs)||value.elapsedMs<0||value.elapsedMs>PREPARATION_DEADLINE_MS)fail('WORKER_PROTOCOL_ERROR');
  const pins=value.assetPins;
  if(!Array.isArray(pins)||Object.getPrototypeOf(pins)!==Array.prototype||pins.length!==8||Reflect.ownKeys(pins).length!==9)fail('WORKER_PROTOCOL_ERROR');
  const paths=[...spec.files.map(name=>`models/${spec.revision}/${spec.modelId}/${name}`),...RUNTIME_FILES.map(name=>`vendor/transformers/${name}`)];
  const names=[...spec.files,...RUNTIME_FILES],fixed=profile==='encoder'?EMBEDDING_PREPARATION_PINS:GENERATOR_PREPARATION_PINS;
  let bytes=0;const copied=[];
  for(let index=0;index<8;index++){
    const descriptor=Object.getOwnPropertyDescriptor(pins,String(index));if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)fail('WORKER_PROTOCOL_ERROR');
    const pin=data(descriptor.value,['url','bytes','sha256']);
    if(pin.url!==new URL(paths[index],baseURL).href||pin.bytes!==fixed[names[index]].bytes||pin.sha256!==fixed[names[index]].sha256)fail('WORKER_PROTOCOL_ERROR');
    bytes+=pin.bytes;copied.push(Object.freeze(pin));
  }
  if(bytes!==spec.bytes)fail('WORKER_PROTOCOL_ERROR');
  return Object.freeze({...value,assetPins:Object.freeze(copied)});
}
// Historical v1 archives can be replayed explicitly; the current client/UI never
// uses this helper to commit a new preparation.
export function copyLegacyPreparationReceipt(raw,profile,baseURL=new URL('./',import.meta.url).href){return copyReceipt(raw,profile,baseURL,1);}
export function copyPreparationReceipt(raw,profile,baseURL=new URL('./',import.meta.url).href,transport='site'){
  const value=data(raw,[...RECEIPT_KEYS,'transport','externalReads']);
  if(value.transport!==transport)fail('WORKER_PROTOCOL_ERROR');
  const core=Object.fromEntries(RECEIPT_KEYS.map(key=>[key,value[key]])),receipt=copyReceipt(core,profile,baseURL,2,transport);
  try{return Object.freeze({...receipt,transport,externalReads:copyExternalReads(value.externalReads,profile,transport,receipt.networkBytes,baseURL)});}
  catch{fail('WORKER_PROTOCOL_ERROR');}
}
export function copyPreparationFailure(raw,profile,transport,baseURL=new URL('./',import.meta.url).href){
  const value=data(raw,['code','message','transportFailure']);
  if(typeof value.code!=='string'||!Object.hasOwn(MESSAGES,value.code)||value.message!==MESSAGES[value.code]
    ||(transport==='site'&&value.transportFailure!==null))fail('WORKER_PROTOCOL_ERROR');
  try{preparationTransport(transport);return Object.freeze({...value,transportFailure:copyTransportFailure(value.transportFailure,profile,baseURL)});}
  catch{fail('WORKER_PROTOCOL_ERROR');}
}

export async function prepareAssetsInWorker(profile,options={}){
  preparationProfile(profile);
  let identity,signal,onProgress,workerFactory,transport;
  try {
    if(options===null||typeof options!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw Error();
    const keys=Reflect.ownKeys(options);if(keys.some(key=>!['identity','signal','onProgress','workerFactory','transport'].includes(key)))throw Error();
    const captured={};for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(options,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error();captured[key]=descriptor.value;}
    identity=copyPreparationIdentity(captured.identity);signal=captured.signal;onProgress=captured.onProgress;
    transport=preparationTransport(captured.transport??'site');
    workerFactory=captured.workerFactory??(url=>new globalThis.Worker(url,{type:'module'}));
    if(typeof workerFactory!=='function'||(onProgress!==undefined&&typeof onProgress!=='function')
      ||(signal!==undefined&&(!(signal instanceof AbortSignal))))throw Error();
    if(signal)signalAborted.call(signal);
  } catch {fail('INVALID_ASSET_PREPARATION');}
  if(signal&&signalAborted.call(signal))fail('ABORTED');
  return new Promise((resolve,reject)=>{
    let worker,terminate,add,remove,post,settled=false,ready=false,commandPosted=false,receiving=false,lastSeq=0,lastCompleted=0,lastVerified=0,started=false;
    const constructed=performance.now();
    let readyTimer,deadlineTimer;const listeners=new Map(),abort=()=>finish(new AssetPreparationError('ABORTED'));
    function finish(error,result,failureOrigin='channel-validation',workerFailure=null){
      if(settled)return;settled=true;
      if(error&&error.code!=='ABORTED')try{error.diagnostic=createRuntimeFailure(identity,{failureOrigin,readyObserved:ready,commandPosted,lastSeq,elapsedMs:performance.now()-constructed,allowedCode:error.code},workerFailure);}catch{}
      clearTimeout(readyTimer);clearTimeout(deadlineTimer);
      try{if(signal)removeSignalListener.call(signal,'abort',abort);}catch{}
      if(worker){for(const [type,listener]of listeners)try{remove?.call(worker,type,listener);}catch{}try{terminate?.call(worker);}catch{}}
      if(error)reject(error);else resolve(result);
    }
    function receive(message){
      if(settled)return;if(receiving){finish(new AssetPreparationError('WORKER_PROTOCOL_ERROR'));return;}receiving=true;
      try {
        const packet=message.data;
        if(!ready){const value=data(packet,['kind','protocolVersion','workerVersion']);if(value.kind!=='asset-preparation-ready'||value.protocolVersion!==1||value.workerVersion!=='asset-preparation-v3')throw Error();if(settled)return;ready=true;clearTimeout(readyTimer);post.call(worker,{schemaVersion:3,kind:'prepare-assets',identity,profile,transport});if(!settled)commandPosted=true;return;}
        const value=data(packet,[...IDENTITY_KEYS,'schemaVersion','profile','transport','kind','seq','payload']);
        if(value.schemaVersion!==3||value.transport!==transport||IDENTITY_KEYS.some(key=>value[key]!==identity[key])||value.profile!==profile||value.seq!==lastSeq+1||!integer(value.seq,1,PREPARATION_MAX_PACKETS))throw Error();
        if(value.kind==='progress'){
          if(value.seq>=PREPARATION_MAX_PACKETS)throw Error();const payload=copyPreparationProgress(value.payload,profile);
          if((!started&&(payload.completed!==0||payload.verified!==0))||payload.completed<lastCompleted||payload.verified<lastVerified)throw Error();
          if(settled)return;started=true;lastSeq=value.seq;lastCompleted=payload.completed;lastVerified=payload.verified;
          onProgress?.(payload);
        }else if(value.kind==='result'){
          if(!started||lastVerified!==preparationProfile(profile).bytes)throw Error();const receipt=copyPreparationReceipt(value.payload,profile,undefined,transport);if(settled)return;lastSeq=value.seq;finish(null,receipt);
        }else if(value.kind==='error'){
          const captured=data(value.payload,['code','message','transportFailure','workerFailure']);
          const payload=copyPreparationFailure({code:captured.code,message:captured.message,transportFailure:captured.transportFailure},profile,transport);
          const workerFailure=copyWorkerFailure(captured.workerFailure,'preparation-loader');
          if(settled)return;lastSeq=value.seq;finish(new AssetPreparationError(payload.code,payload.transportFailure),undefined,'worker-reported-error',workerFailure);
        }else throw Error();
      }catch{finish(new AssetPreparationError('WORKER_PROTOCOL_ERROR'));}finally{receiving=false;}
    }
    try{
      // Fixed absolute budget includes readiness and never renews on progress.
      deadlineTimer=setTimeout(()=>finish(new AssetPreparationError('ASSET_PREPARATION_TIMEOUT'),undefined,'client-operation-deadline'),PREPARATION_DEADLINE_MS);
      readyTimer=setTimeout(()=>finish(new AssetPreparationError('ASSET_PREPARATION_TIMEOUT'),undefined,'client-readiness-deadline'),PREPARATION_READY_MS);
      worker=workerFactory(new URL('./asset-preparation.worker.mjs',import.meta.url));if(settled){try{worker?.terminate?.();}catch{}return;}if(!worker)throw Error();
      terminate=worker.terminate;add=worker.addEventListener;remove=worker.removeEventListener;post=worker.postMessage;
      if([terminate,add,remove,post].some(method=>typeof method!=='function'))throw Error();
      if(signal)addSignalListener.call(signal,'abort',abort,{once:true});if(settled)return;if(signal&&signalAborted.call(signal)){abort();return;}
      listeners.set('message',receive);listeners.set('error',()=>finish(new AssetPreparationError('ASSET_PREPARATION_FAILED'),undefined,'native-worker-error'));
      listeners.set('messageerror',()=>finish(new AssetPreparationError('WORKER_PROTOCOL_ERROR')));
      for(const [type,listener]of listeners){add.call(worker,type,listener);if(settled)return;}
    }catch{finish(new AssetPreparationError('WORKER_UNAVAILABLE'));}
  });
}
