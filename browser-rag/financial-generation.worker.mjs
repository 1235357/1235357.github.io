import { runFinancialGenerator } from './financial-generator-runtime.mjs';
import { copyFinancialNativeReceipt, FinancialGeneratorReceiptError } from './financial-generator-contract.mjs';
import { PromptError } from './prompt-contract.mjs';
import { GenerationContractError } from './generator-contract.mjs';
import { ProbeError, PROBE_MAX_PACKETS } from './generator-native-core.mjs';
import { createReceiptSnapshot } from './receipt-snapshot.mjs';
import { FinancialGenerationWorkerError, copyFinancialGenerationCommand,
  createFinancialGenerationStageGuard, financialGenerationResultReceipt } from './financial-generation-source.mjs';
import { suppressWorkerConsole } from './worker-console.mjs';

const BYTE_DETAIL_KEYS=['stage','assetIndex','receivedBytes','verifiedBytes','totalBytes','elapsedMs'];

// Pure single-command handler. Only trusted local construction can select run;
// the command contains complete input/options data and never executable hooks.
export function createFinancialGenerationCommandHandler(send,options={}) {
  let run;
  try {
    if(typeof send!=='function'||options===null||typeof options!=='object'
      ||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw Error();
    const keys=Reflect.ownKeys(options);if(keys.some(key=>key!=='run'))throw Error();
    const configuredRun=options.run;run=configuredRun===undefined?runFinancialGenerator:configuredRun;if(typeof run!=='function')throw Error();
  } catch {throw new FinancialGenerationWorkerError('INVALID_FINANCIAL_WORKER_CONFIG');}
  let consumed=false,validating=false;
  return raw=>{
    if(consumed||validating)throw new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');
    // Reserve validation before touching any caller getter. An invalid first
    // command can be corrected, but nested validation never starts native work.
    let command;validating=true;
    try {command=copyFinancialGenerationCommand(raw);consumed=true;}finally {validating=false;}
    const {identity,contextInput,generationOptions}=command,guard=createFinancialGenerationStageGuard();
    let active=true,seq=0,callbackError,callbackRunning=false;
    const fail=()=>{throw new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');};
    const emit=packet=>{try {send(Object.freeze(packet));}catch {active=false;fail();}};
    function assertCallbackPermission() {
      if(callbackError)throw callbackError;
      if(!active||seq>=PROBE_MAX_PACKETS-1)fail();
    }
    function progress(stage,payload,detail) {
      assertCallbackPermission();
      emit({event:Object.freeze({...identity,kind:'progress',stage,seq:++seq,payload:Object.freeze(payload)}),detail});
    }
    function callback(task) {
      if(!active)fail();if(callbackError)throw callbackError;
      // Reserve callback execution before any detail getter or sender can
      // reenter and consume another callback's packet budget.
      if(callbackRunning){callbackError=new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');throw callbackError;}
      callbackRunning=true;
      try {
        // Reserve the terminal slot before a callback can advance stage state.
        assertCallbackPermission();const value=task();if(callbackError)throw callbackError;return value;
      }catch {callbackError??=new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');throw callbackError;}
      finally {callbackRunning=false;}
    }
    function terminal(kind,payload,artifact) {
      if(!active||seq>=PROBE_MAX_PACKETS)fail();active=false;
      const event=Object.freeze({...identity,kind,stage:guard.stage,seq:++seq,payload:Object.freeze(payload)});
      emit(artifact===undefined?{event}:{event,artifact});
    }
    return (async()=>{
      try {
        const receipt=await run(contextInput,generationOptions,{
          onProgress(stage,elapsedMs){return callback(()=>{const accepted=guard.accept(stage,elapsedMs);
            progress(stage,{completed:accepted.elapsedMs,total:null,unit:'milliseconds',estimated:false},null);});},
          onByteProgress(rawDetail){return callback(()=>{
            const captured=createReceiptSnapshot().record(rawDetail,BYTE_DETAIL_KEYS);
            // Capturing a getter can latch a rejected nested callback. Recheck
            // permission on owned fields before mutating the byte guard.
            assertCallbackPermission();const detail=guard.acceptBytes(captured);
            progress(guard.stage,{completed:detail.receivedBytes,total:detail.totalBytes,unit:'bytes',estimated:false},detail);});},
        });
        if(callbackError)throw callbackError;
        const artifact=copyFinancialNativeReceipt(receipt,contextInput,generationOptions);guard.assertComplete(artifact);
        // Receipt accessors may catch callback rejection while being copied.
        // Preserve that latched failure before committing a successful result.
        if(callbackError)throw callbackError;
        terminal('result',{data:financialGenerationResultReceipt(artifact)},artifact);
      } catch(error) {
        if(!active)throw new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');
        let code='GENERATION_FAILED';const observedError=callbackError??error;
        try {if(observedError instanceof ProbeError||observedError instanceof PromptError||observedError instanceof GenerationContractError
          ||observedError instanceof FinancialGeneratorReceiptError||observedError instanceof FinancialGenerationWorkerError)code=observedError.code;}catch {}
        const safe=new FinancialGenerationWorkerError(code);terminal('error',{code:safe.code,message:safe.message});
      }
      return true;
    })();
  };
}

if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope&&typeof globalThis.postMessage==='function') {
  const handle=createFinancialGenerationCommandHandler(packet=>globalThis.postMessage(packet),{run(input,options,callbacks){
    // The owned Worker alone is muted before the native runtime imports its SDK.
    try {suppressWorkerConsole();}catch {throw new FinancialGenerationWorkerError('GENERATION_FAILED');}
    return runFinancialGenerator(input,options,callbacks);
  }});
  const channelFailure=()=>{throw new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');};
  globalThis.addEventListener('message',message=>{
    try {handle(message.data).catch(()=>globalThis.setTimeout(channelFailure,0));}catch {channelFailure();}
  });
  globalThis.postMessage({kind:'generation-ready',protocolVersion:1,workerVersion:'financial-generation-v1'});
}
