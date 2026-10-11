import {PREPARATION_PROFILES} from '../asset-preparation-source.mjs';
import {EMBEDDING_PREPARATION_PINS} from '../embedding-runtime.mjs';
import {GENERATOR_PREPARATION_PINS} from '../generator-native-core.mjs';
export const identity=()=>({protocolVersion:1,runtimeId:'prep-test-runtime',operationId:'op-1',documentEpoch:2,operation:'prepare-assets'});
const base=new URL('../',import.meta.url).href;
// Synthetic transport/DOM fixtures establish no network, model or native run.
export function receipt(profile='encoder',transport='site'){
  const spec=PREPARATION_PROFILES[profile],pins=profile==='encoder'?EMBEDDING_PREPARATION_PINS:GENERATOR_PREPARATION_PINS;
  const assetPins=Object.entries(pins).map(([name,pin])=>({url:new URL(spec.files.includes(name)
    ?`models/${spec.revision}/${spec.modelId}/${name}`:`vendor/transformers/${name}`,base).href,...pin}));
  return {schemaVersion:2,status:'static-assets-prepared-not-loaded',profile,modelId:spec.modelId,revision:spec.revision,
    libraryVersion:'3.8.1',ortVersion:'1.22.0-dev.20250409-89f8206ba4',assets:8,verifiedBytes:spec.bytes,
    networkBytes:transport==='site'?spec.bytes:0,cacheBytes:transport==='site'?0:spec.bytes,assetPins,elapsedMs:25,transport,externalReads:[]};
}
export function cacheResult(profile){const value=receipt(profile);return Object.fromEntries(['assets','verifiedBytes','networkBytes','cacheBytes','assetPins'].map(key=>[key,value[key]]));}
export const progress=(profile,completed,verified=completed)=>({completed,verified,total:PREPARATION_PROFILES[profile].bytes,unit:'bytes',estimated:false,mode:PREPARATION_PROFILES[profile].mode});
export const packet=(profile,kind,seq,payload,transport='site')=>({...identity(),schemaVersion:2,profile,transport,kind,seq,payload});
export const ready=()=>({kind:'asset-preparation-ready',protocolVersion:1,workerVersion:'asset-preparation-v2'});
export class WorkerDouble{
  constructor(){this.listeners=new Map();this.sent=[];this.terminated=0;}
  addEventListener(type,listener){this.listeners.set(type,listener);if(type==='message')this.captured=listener;}
  removeEventListener(type){this.listeners.delete(type);}
  postMessage(value){this.sent.push(value);}
  terminate(){this.terminated++;this.onTerminate?.();}
  emit(value){this.listeners.get('message')?.({data:value});}
}
