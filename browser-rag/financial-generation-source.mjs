import { copyFinancialGenerationInput, copyFinancialGenerationOptions } from './financial-generation-input.mjs';
import { copyFinancialNativeReceipt } from './financial-generator-contract.mjs';
import { createReceiptSnapshot } from './receipt-snapshot.mjs';
import { createProbeByteGuard, PROBE_STAGES, PROBE_MAX_PACKETS } from './generator-native-core.mjs';

export { copyFinancialGenerationInput, copyFinancialGenerationOptions } from './financial-generation-input.mjs';
const MESSAGES=Object.freeze({
  INVALID_FINANCIAL_WORKER_CONFIG:'The financial generation worker configuration is invalid.',
  INVALID_PROMPT_INPUT:'The prompt input is invalid.',
  INVALID_PROMPT_TOKENIZER:'The prompt tokenizer is invalid.',
  INVALID_PROMPT_FRAME:'The prompt token frame is invalid.',
  PROMPT_INPUT_LIMIT:'The prompt input exceeds its text limit.',
  PROMPT_FAILED:'The prompt could not be prepared safely.',
  INVALID_GENERATION_CONFIG:'The generation configuration is invalid.',
  GENERATION_INPUT_LIMIT:'The generation input is invalid or exceeds its token budget.',
  INVALID_GENERATION_OUTPUT:'The financial generation output was invalid.',
  INVALID_FINANCIAL_RECEIPT:'The financial generator receipt is invalid.',
  INVALID_PROBE_CONFIG:'The local generator configuration is invalid.',
  ASSET_INTEGRITY_ERROR:'The pinned local assets could not be verified.',
  ASSET_CACHE_ERROR:'The verified asset cache operation failed.',
  GPU_UNAVAILABLE:'A non-fallback WebGPU adapter and owned device are required.',
  GPU_DEVICE_LOST:'The owned WebGPU device was lost.',
  GPU_UNCAPTURED_ERROR:'The owned WebGPU device reported an uncaptured error.',
  TOKENIZER_MISMATCH:'The local generator token frame did not match.',
  MODEL_LOAD_FAILED:'The pinned local generator could not be loaded.',
  GENERATION_FAILED:'The local financial generation failed.',
  ABORTED:'The financial generation operation was cancelled.',
  WORKER_PROTOCOL_ERROR:'The financial generation worker channel was invalid.',
  WORKER_UNAVAILABLE:'A native financial generation worker is unavailable.',
  GENERATION_TIMEOUT:'The financial generation worker exceeded its time budget.',
});
export class FinancialGenerationWorkerError extends Error {
  constructor(code) {
    const safe=typeof code==='string'&&Object.hasOwn(MESSAGES,code)?code:'GENERATION_FAILED';
    super(MESSAGES[safe]);this.name='FinancialGenerationWorkerError';this.code=safe;
  }
}
const fail=code=>{throw new FinancialGenerationWorkerError(code);};
const IDENTITY_KEYS=['protocolVersion','runtimeId','operationId','documentEpoch','operation'];
const EVENT_KEYS=[...IDENTITY_KEYS,'kind','stage','seq','payload'];
const PROGRESS_KEYS=['completed','total','unit','estimated'];
const DETAIL_KEYS=['stage','assetIndex','receivedBytes','verifiedBytes','totalBytes','elapsedMs'];
const positive=value=>Number.isSafeInteger(value)&&value>0;
const elapsed=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=300000;
function freeze(value) {
  if(value!==null&&typeof value==='object'&&!Object.isFrozen(value)) {
    for(const child of Object.values(value))freeze(child);Object.freeze(value);
  }
  return value;
}
function copyIdentity(raw,snapshot=createReceiptSnapshot()) {
  const identity=snapshot.record(raw,IDENTITY_KEYS);
  if(identity.protocolVersion!==1||identity.operation!=='generate'||typeof identity.runtimeId!=='string'
    ||identity.runtimeId.length>256||!identity.runtimeId.trim()||typeof identity.operationId!=='string'
    ||!/^op-[1-9]\d{0,15}$/.test(identity.operationId)||!positive(Number(identity.operationId.slice(3)))
    ||!Number.isSafeInteger(identity.documentEpoch)||identity.documentEpoch<0)fail('WORKER_PROTOCOL_ERROR');
  return Object.freeze({...identity});
}
export function copyFinancialGenerationCommand(raw) {
  try {
    const snapshot=createReceiptSnapshot(),command=snapshot.record(raw,['kind','identity','contextInput','generationOptions']);
    if(command.kind!=='generate-financial')fail('WORKER_PROTOCOL_ERROR');
    return Object.freeze({kind:'generate-financial',identity:copyIdentity(command.identity,snapshot),
      contextInput:copyFinancialGenerationInput(command.contextInput),generationOptions:copyFinancialGenerationOptions(command.generationOptions)});
  } catch {fail('WORKER_PROTOCOL_ERROR');}
}

// One ordered native lifecycle, measured milliseconds and fixed-pin byte reads.
// Native disposal is verified by the full receipt, never inferred from terminate.
export function createFinancialGenerationStageGuard() {
  const byteGuard=createProbeByteGuard(),stages=[];let lastElapsed=0,prepared=0,consumeStarted=0,consumeCompleted=0,verifiedBytes=0;
  const openReads=new Set();
  const checkTime=ms=>{if(!elapsed(ms)||ms<lastElapsed)fail('WORKER_PROTOCOL_ERROR');};
  return Object.freeze({
    get stage(){return stages.at(-1)?.stage??'adapter';},
    get stages(){return Object.freeze([...stages]);},
    accept(stage,elapsedMs) {
      if(stages.length>=PROBE_STAGES.length||stage!==PROBE_STAGES[stages.length]
        ||(stage==='sdk'&&prepared!==8))fail('WORKER_PROTOCOL_ERROR');
      checkTime(elapsedMs);lastElapsed=elapsedMs;
      const entry=Object.freeze({stage,elapsedMs});stages.push(entry);return entry;
    },
    acceptBytes(raw) {
      try {
        const captured=createReceiptSnapshot().record(raw,DETAIL_KEYS),current=stages.at(-1)?.stage;
        if((captured.stage==='prepare'&&current!=='assets')
          ||(captured.stage==='consume'&&!['sdk','tokenizer','model','generate','reads'].includes(current)))fail('WORKER_PROTOCOL_ERROR');
        checkTime(captured.elapsedMs);const detail=byteGuard.accept(captured);
        if(detail.stage==='prepare'&&detail.verifiedBytes===detail.totalBytes)prepared++;
        if(detail.stage==='consume') {
          if(detail.receivedBytes===0) {if(openReads.has(detail.assetIndex))fail('WORKER_PROTOCOL_ERROR');openReads.add(detail.assetIndex);consumeStarted++;}
          if(detail.verifiedBytes===detail.totalBytes) {if(!openReads.delete(detail.assetIndex))fail('WORKER_PROTOCOL_ERROR');consumeCompleted++;verifiedBytes+=detail.verifiedBytes;}
        }
        lastElapsed=detail.elapsedMs;return detail;
      } catch {fail('WORKER_PROTOCOL_ERROR');}
    },
    assertComplete(receipt) {
      try {
        if(stages.length!==8||prepared!==8||openReads.size!==0||consumeStarted!==consumeCompleted
          ||consumeCompleted!==receipt.sdkReads.reads||verifiedBytes!==receipt.sdkReads.verifiedBytes
          ||!elapsed(receipt.elapsedMs)||receipt.elapsedMs<lastElapsed
          ||receipt.stages.length!==8||stages.some((entry,i)=>entry.stage!==receipt.stages[i].stage||entry.elapsedMs!==receipt.stages[i].elapsedMs))fail('WORKER_PROTOCOL_ERROR');
      } catch {fail('WORKER_PROTOCOL_ERROR');}
    },
  });
}

// Input is the already validated full receipt. This bounded projection is the
// controller metadata only; decoded text and token arrays remain in artifact.
export function financialGenerationResultReceipt(receipt) {
  return freeze({schemaVersion:receipt.schemaVersion,status:receipt.status,generationMode:receipt.generationMode,
    modelId:receipt.modelId,revision:receipt.revision,device:receipt.device,dtype:receipt.dtype,
    counts:{inputTokens:receipt.preflight.inputTokens,generatedTokens:receipt.generatedTokenIds.length},termination:receipt.inspection.termination,
    cachePreparation:{...receipt.cachePreparation},sdkReads:{...receipt.sdkReads},elapsedMs:receipt.elapsedMs,
    stages:receipt.stages.map(entry=>({...entry})),cleanup:{...receipt.cleanup},outputInspection:receipt.outputInspection,financialCorrectness:receipt.financialCorrectness});
}

export async function generateFinancialInWorker(contextInput,generationOptions={},options={}) {
  // Complete ownership happens synchronously before construction or any await.
  const input=copyFinancialGenerationInput(contextInput),generation=copyFinancialGenerationOptions(generationOptions);
  let identity,workerFactory,onProgress,signal,signalAdd,signalRemove,aborted,readyTimeoutMs,workTimeoutMs;
  try {
    if(options===null||typeof options!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw Error();
    const keys=Reflect.ownKeys(options),allowed=['identity','workerFactory','onProgress','signal','readyTimeoutMs','workTimeoutMs'];
    if(keys.some(key=>!allowed.includes(key)))throw Error();
    const captured={};for(const key of allowed)captured[key]=options[key];
    identity=copyIdentity(captured.identity);onProgress=captured.onProgress;signal=captured.signal;
    workerFactory=captured.workerFactory===undefined?(url=>new globalThis.Worker(url,{type:'module'})):captured.workerFactory;
    readyTimeoutMs=captured.readyTimeoutMs===undefined?10000:captured.readyTimeoutMs;
    workTimeoutMs=captured.workTimeoutMs===undefined?300000:captured.workTimeoutMs;
    if(typeof workerFactory!=='function'||(onProgress!==undefined&&typeof onProgress!=='function')
      ||!positive(readyTimeoutMs)||readyTimeoutMs>10000||!positive(workTimeoutMs)||workTimeoutMs>300000)throw Error();
    if(signal!==undefined) {
      aborted=signal.aborted;signalAdd=signal.addEventListener;signalRemove=signal.removeEventListener;
      if(typeof aborted!=='boolean'||typeof signalAdd!=='function'||typeof signalRemove!=='function')throw Error();
    }
  } catch {fail('INVALID_FINANCIAL_WORKER_CONFIG');}
  if(aborted)fail('ABORTED');
  return new Promise((resolve,reject)=>{
    let worker,terminate,add,remove,post,settled=false,readySeen=false,receiving=false,commandSent=false,lastSeq=0,readyTimer,workTimer;
    const guard=createFinancialGenerationStageGuard(),listeners=new Map();
    const onAbort=()=>finish(new FinancialGenerationWorkerError('ABORTED'));
    function finish(error,result) {
      if(settled)return;settled=true; // Revoke before getters, cleanup or subscribers can reenter.
      clearTimeout(readyTimer);clearTimeout(workTimer);
      try {signalRemove?.call(signal,'abort',onAbort);}catch {}
      if(worker) {
        for(const [type,listener] of listeners)try {remove?.call(worker,type,listener);}catch {}
        try {terminate?.call(worker);}catch {}
      }
      if(error)reject(error);else resolve(result);
    }
    const protocolError=()=>finish(new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR'));
    function receive(message) {
      if(settled)return;if(receiving){protocolError();return;}receiving=true;
      try {
        const raw=message.data,snapshot=createReceiptSnapshot();
        if(!readySeen) {
          const announcement=snapshot.record(raw,['kind','protocolVersion','workerVersion']);
          if(announcement.kind!=='generation-ready'||announcement.protocolVersion!==1||announcement.workerVersion!=='financial-generation-v1')fail('WORKER_PROTOCOL_ERROR');
          if(settled)return;readySeen=true;clearTimeout(readyTimer);
          workTimer=setTimeout(()=>finish(new FinancialGenerationWorkerError('GENERATION_TIMEOUT')),workTimeoutMs);
          commandSent=true;
          post.call(worker,{kind:'generate-financial',identity,contextInput:input,generationOptions:generation});return;
        }
        // Packet shape is selected using a single observation of the event.
        if(raw===null||typeof raw!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))fail('WORKER_PROTOCOL_ERROR');
        const keys=Reflect.ownKeys(raw);
        if(![2,1].includes(keys.length)||!keys.includes('event')||keys.some(key=>!['event','detail','artifact'].includes(key)))fail('WORKER_PROTOCOL_ERROR');
        const event=snapshot.record(raw.event,EVENT_KEYS);
        if(!commandSent||IDENTITY_KEYS.some(key=>event[key]!==identity[key])||!positive(event.seq)||event.seq!==lastSeq+1||event.seq>PROBE_MAX_PACKETS)fail('WORKER_PROTOCOL_ERROR');
        const eventCopy=payload=>freeze({...identity,kind:event.kind,stage:event.stage,seq:event.seq,payload});
        if(event.kind==='progress') {
          if(keys.length!==2||!keys.includes('detail')||event.seq>=PROBE_MAX_PACKETS)fail('WORKER_PROTOCOL_ERROR');
          const payload=snapshot.record(event.payload,PROGRESS_KEYS),rawDetail=raw.detail;let detail,acceptedPayload;
          if(rawDetail===null) {
            if(payload.total!==null||payload.unit!=='milliseconds'||payload.estimated!==false)fail('WORKER_PROTOCOL_ERROR');
            const accepted=guard.accept(event.stage,payload.completed);detail=null;
            acceptedPayload={completed:accepted.elapsedMs,total:null,unit:'milliseconds',estimated:false};
          } else {
            const captured=snapshot.record(rawDetail,DETAIL_KEYS);detail=guard.acceptBytes(captured);
            if(event.stage!==guard.stage||payload.completed!==detail.receivedBytes||payload.total!==detail.totalBytes||payload.unit!=='bytes'||payload.estimated!==false)fail('WORKER_PROTOCOL_ERROR');
            acceptedPayload={completed:detail.receivedBytes,total:detail.totalBytes,unit:'bytes',estimated:false};
          }
          if(settled)return;lastSeq=event.seq;onProgress?.(freeze({event:eventCopy(acceptedPayload),detail}));
        } else if(event.kind==='error') {
          if(keys.length!==1||event.stage!==guard.stage)fail('WORKER_PROTOCOL_ERROR');
          const payload=snapshot.record(event.payload,['code','message']);
          if(typeof payload.code!=='string'||!Object.hasOwn(MESSAGES,payload.code)||payload.message!==MESSAGES[payload.code])fail('WORKER_PROTOCOL_ERROR');
          if(settled)return;lastSeq=event.seq;finish(new FinancialGenerationWorkerError(payload.code));
        } else if(event.kind==='result') {
          if(keys.length!==2||!keys.includes('artifact')||event.stage!=='cleanup')fail('WORKER_PROTOCOL_ERROR');
          const payload=snapshot.record(event.payload,['data']),artifact=copyFinancialNativeReceipt(raw.artifact,input,generation);
          guard.assertComplete(artifact);const metadata=financialGenerationResultReceipt(artifact);
          if(!snapshot.matches(payload.data,metadata))fail('WORKER_PROTOCOL_ERROR');
          if(settled)return;lastSeq=event.seq;finish(null,freeze({event:eventCopy({data:metadata}),artifact}));
        } else fail('WORKER_PROTOCOL_ERROR');
      } catch {protocolError();}finally {receiving=false;}
    }
    try {
      worker=workerFactory(new URL('./financial-generation.worker.mjs',import.meta.url));
      if(!worker){finish(new FinancialGenerationWorkerError('WORKER_UNAVAILABLE'));return;}
      terminate=worker.terminate; // Capture first so later getter failure still releases ownership.
      if(typeof terminate!=='function')throw Error();
      add=worker.addEventListener;remove=worker.removeEventListener;post=worker.postMessage;
      if([add,remove,post].some(method=>typeof method!=='function'))throw Error();
      listeners.set('message',receive);listeners.set('error',()=>finish(new FinancialGenerationWorkerError('GENERATION_FAILED')));listeners.set('messageerror',protocolError);
      // Cancellation is armed before any Worker listener can synchronously
      // deliver readiness or a receipt during registration.
      signalAdd?.call(signal,'abort',onAbort,{once:true});if(settled)return;
      const nowAborted=signal?.aborted;if(settled)return;if(nowAborted)onAbort();
      if(settled)return;
      readyTimer=setTimeout(()=>finish(new FinancialGenerationWorkerError('GENERATION_TIMEOUT')),readyTimeoutMs);
      for(const [type,listener] of listeners){add.call(worker,type,listener);if(settled)return;}
    } catch {finish(new FinancialGenerationWorkerError('WORKER_UNAVAILABLE'));}
  });
}
