import {prepareEmbeddingAssets,EmbeddingRuntimeError} from './embedding-runtime.mjs';
import {prepareGeneratorAssets,ProbeError} from './generator-native-core.mjs';
import {VerifiedCacheError} from './verified-cache.mjs';
import {AssetPreparationError,copyPreparationCommand,copyPreparationProgress,copyPreparationReceipt,
  preparationProfile,PREPARATION_MAX_PACKETS,PREPARATION_DEADLINE_MS} from './asset-preparation-source.mjs';
import {suppressWorkerConsole} from './worker-console.mjs';
import {createPreparationTransport,copyTransportFailure,AssetTransportError} from './asset-preparation-transport.mjs';
import {copyWorkerFailure,createWorkerFailureTracker,diagnosticCode} from './runtime-failure-contract.mjs';

export function createAssetPreparationCommandHandler(send,options={}){
  if(typeof send!=='function'||options===null||typeof options!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(options))
    ||Reflect.ownKeys(options).some(key=>!['prepareEncoder','prepareGenerator','now','createTransport'].includes(key)))throw new AssetPreparationError('INVALID_ASSET_PREPARATION');
  const encoder=options.prepareEncoder??prepareEmbeddingAssets,generator=options.prepareGenerator??prepareGeneratorAssets,now=options.now??(()=>performance.now()),transportFactory=options.createTransport??createPreparationTransport;
  if([encoder,generator,now,transportFactory].some(value=>typeof value!=='function'))throw new AssetPreparationError('INVALID_ASSET_PREPARATION');
  let consumed=false,validating=false;
  return raw=>{
    if(consumed||validating)throw new AssetPreparationError('WORKER_PROTOCOL_ERROR');
    let command;validating=true;try{command=copyPreparationCommand(raw);consumed=true;}finally{validating=false;}
    const {identity,profile,transport}=command,spec=preparationProfile(profile);let seq=0,active=true,lastSent=-Infinity,lastCompleted=0,lastVerified=0,callbackError,adapter;
    let workerFailure=createWorkerFailureTracker('preparation-loader').snapshot();
    const onDiagnostic=value=>{workerFailure=copyWorkerFailure(value,'preparation-loader');};
    const started=now(),clock=()=>{const value=now()-started;if(!Number.isFinite(value)||value<0||value>PREPARATION_DEADLINE_MS)throw new AssetPreparationError('ASSET_PREPARATION_TIMEOUT');return value;};
    const emit=(kind,payload)=>{if(!active||seq>=PREPARATION_MAX_PACKETS)throw new AssetPreparationError('WORKER_PROTOCOL_ERROR');if(kind!=='progress')active=false;send(Object.freeze({...identity,schemaVersion:3,profile,transport,kind,seq:++seq,payload}));};
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
        adapter=transportFactory(profile,transport);
        const result=profile==='encoder'?await encoder({fetch:adapter.fetch,onProgress:(_stage,payload)=>progress({...payload,verified:payload.completed,mode:'verified-assets'}),onDiagnostic})
          :await generator({fetch:adapter.fetch,onProgress:progress,onDiagnostic});
        if(callbackError)throw callbackError;
        const receipt=copyPreparationReceipt({schemaVersion:2,status:'static-assets-prepared-not-loaded',profile,modelId:spec.modelId,revision:spec.revision,
          libraryVersion:'3.8.1',ortVersion:'1.22.0-dev.20250409-89f8206ba4',...result,elapsedMs:clock(),transport,externalReads:adapter.externalReads()},profile,undefined,transport);
        if(lastVerified!==spec.bytes)throw Error();emit('result',receipt);
      }catch(caught){
        if(!active)throw new AssetPreparationError('WORKER_PROTOCOL_ERROR');
        let diagnostic=null;
        if(transport==='huggingface')try{diagnostic=copyTransportFailure(adapter?.transportFailure()??null,profile);}catch{}
        let transportError=false,typed=false;try{transportError=caught instanceof AssetTransportError;
          typed=transportError||caught instanceof EmbeddingRuntimeError||caught instanceof ProbeError||caught instanceof VerifiedCacheError||caught instanceof AssetPreparationError;}catch{}
        const error=callbackError??new AssetPreparationError(transportError||diagnostic?'ASSET_TRANSPORT_REFUSED':'ASSET_PREPARATION_FAILED');
        if(callbackError)workerFailure=createWorkerFailureTracker('preparation-loader').failure('WORKER_PROTOCOL_ERROR');
        else if(typed&&workerFailure.allowedCode==='ASSET_PREPARATION_FAILED')workerFailure=copyWorkerFailure({...workerFailure,allowedCode:diagnosticCode(caught,'preparation-loader','ASSET_PREPARATION_FAILED')},'preparation-loader');
        emit('error',Object.freeze({code:error.code,message:error.message,transportFailure:diagnostic,workerFailure}));
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
  globalThis.postMessage({kind:'asset-preparation-ready',protocolVersion:1,workerVersion:'asset-preparation-v3'});
}
