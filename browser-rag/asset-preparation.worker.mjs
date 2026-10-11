import {prepareEmbeddingAssets} from './embedding-runtime.mjs';
import {prepareGeneratorAssets} from './generator-native-core.mjs';
import {AssetPreparationError,copyPreparationCommand,copyPreparationProgress,copyPreparationReceipt,
  preparationProfile,PREPARATION_MAX_PACKETS,PREPARATION_DEADLINE_MS} from './asset-preparation-source.mjs';
import {suppressWorkerConsole} from './worker-console.mjs';

export function createAssetPreparationCommandHandler(send,options={}){
  if(typeof send!=='function'||options===null||typeof options!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(options))
    ||Reflect.ownKeys(options).some(key=>!['prepareEncoder','prepareGenerator','now'].includes(key)))throw new AssetPreparationError('INVALID_ASSET_PREPARATION');
  const encoder=options.prepareEncoder??prepareEmbeddingAssets,generator=options.prepareGenerator??prepareGeneratorAssets,now=options.now??(()=>performance.now());
  if([encoder,generator,now].some(value=>typeof value!=='function'))throw new AssetPreparationError('INVALID_ASSET_PREPARATION');
  let consumed=false,validating=false;
  return raw=>{
    if(consumed||validating)throw new AssetPreparationError('WORKER_PROTOCOL_ERROR');
    let command;validating=true;try{command=copyPreparationCommand(raw);consumed=true;}finally{validating=false;}
    const {identity,profile}=command,spec=preparationProfile(profile);let seq=0,active=true,lastSent=-Infinity,lastCompleted=0,lastVerified=0,callbackError;
    const started=now(),clock=()=>{const value=now()-started;if(!Number.isFinite(value)||value<0||value>PREPARATION_DEADLINE_MS)throw new AssetPreparationError('ASSET_PREPARATION_TIMEOUT');return value;};
    const emit=(kind,payload)=>{if(!active||seq>=PREPARATION_MAX_PACKETS)throw new AssetPreparationError('WORKER_PROTOCOL_ERROR');if(kind!=='progress')active=false;send(Object.freeze({...identity,profile,kind,seq:++seq,payload}));};
    function progress(rawPayload){
      try{
        if(callbackError)throw callbackError;const value=copyPreparationProgress(rawPayload,profile),elapsed=clock();
        if(value.completed<lastCompleted||value.verified<lastVerified)throw Error();lastCompleted=value.completed;lastVerified=value.verified;
        if(value.completed===0||value.verified>0&&value.verified===value.completed||elapsed-lastSent>=500){
          if(seq>=PREPARATION_MAX_PACKETS-1)throw Error();lastSent=elapsed;emit('progress',value);
        }
      }catch{callbackError=new AssetPreparationError('WORKER_PROTOCOL_ERROR');throw callbackError;}
    }
    return (async()=>{
      try{
        progress(Object.freeze({completed:0,verified:0,total:spec.bytes,unit:'bytes',estimated:false,mode:spec.mode}));
        const result=profile==='encoder'?await encoder({onProgress:(_stage,payload)=>progress({...payload,verified:payload.completed,mode:'verified-assets'})})
          :await generator({onProgress:progress});
        if(callbackError)throw callbackError;
        const receipt=copyPreparationReceipt({schemaVersion:1,status:'static-assets-prepared-not-loaded',profile,modelId:spec.modelId,revision:spec.revision,
          libraryVersion:'3.8.1',ortVersion:'1.22.0-dev.20250409-89f8206ba4',...result,elapsedMs:clock()},profile);
        if(lastVerified!==spec.bytes)throw Error();emit('result',receipt);
      }catch{
        if(!active)throw new AssetPreparationError('WORKER_PROTOCOL_ERROR');
        const error=callbackError??new AssetPreparationError('ASSET_PREPARATION_FAILED');emit('error',Object.freeze({code:error.code,message:error.message}));
      }
      return true;
    })();
  };
}
if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope&&typeof globalThis.postMessage==='function'){
  const handle=createAssetPreparationCommandHandler(packet=>globalThis.postMessage(packet),{
    prepareEncoder:options=>{suppressWorkerConsole();return prepareEmbeddingAssets(options);},
    prepareGenerator:options=>{suppressWorkerConsole();return prepareGeneratorAssets(options);},
  });
  const failure=()=>{throw new AssetPreparationError('WORKER_PROTOCOL_ERROR');};
  globalThis.addEventListener('message',message=>{try{handle(message.data).catch(()=>globalThis.setTimeout(failure,0));}catch{failure();}});
  globalThis.postMessage({kind:'asset-preparation-ready',protocolVersion:1,workerVersion:'asset-preparation-v1'});
}
