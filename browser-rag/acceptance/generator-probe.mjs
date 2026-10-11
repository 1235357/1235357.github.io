import { copyProbeReceipt, createProbeByteGuard, ProbeError, PROBE_MESSAGES, PROBE_STAGES, PROBE_IDS, PROBE_MODEL, PROBE_REVISION, PROBE_MAX_PACKETS } from './generator-probe-runtime.mjs';

const exact=(value,keys)=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))
  &&Reflect.ownKeys(value).length===keys.length&&Reflect.ownKeys(value).every(key=>keys.includes(key));
const TERMINATION='worker-terminated; native disposal unconfirmed';

/** One native worker per explicit Run. Revocation precedes termination, so a
 * queued callback or late packet can never commit a cancelled attempt. */
export function createGeneratorProbeController(options={}) {
  if(!options||typeof options!=='object'||Reflect.ownKeys(options).some(key=>!['workerFactory','onUpdate','setTimer','clearTimer'].includes(key)))throw new ProbeError('INVALID_PROBE_CONFIG');
  const workerFactory=options.workerFactory??(()=>new Worker(new URL('./generator-probe.worker.mjs',import.meta.url),{type:'module',name:'qwen-local-smoke'}));
  const onUpdate=options.onUpdate??(()=>{}),setTimer=options.setTimer??globalThis.setTimeout.bind(globalThis),clearTimer=options.clearTimer??globalThis.clearTimeout.bind(globalThis);
  if([workerFactory,onUpdate,setTimer,clearTimer].some(value=>typeof value!=='function'))throw new ProbeError('INVALID_PROBE_CONFIG');
  let owned=null,disposed=false;
  const update=value=>onUpdate(Object.freeze(value));
  function revoke(attempt,status,code) {
    if(!attempt.active)return;attempt.active=false;if(owned===attempt)owned=null;
    for(const timer of attempt.timers)clearTimer(timer);attempt.timers.clear();
    for(const [type,listener] of attempt.listeners)try{attempt.worker?.removeEventListener(type,listener);}catch{}
    try{attempt.worker?.terminate();}catch{}
    update({status,...(code?{code,message:PROBE_MESSAGES[code]}:{}),cleanup:TERMINATION});
  }
  function arm(attempt,delay){const timer=setTimer(()=>revoke(attempt,'error','PROBE_TIMEOUT'),delay);attempt.timers.add(timer);}
  function run() {
    if(disposed||owned)return false;
    const attempt={active:true,worker:null,timers:new Set(),listeners:new Map(),ready:false,seq:0,stageIndex:0,lastElapsed:0,stages:[],bytes:createProbeByteGuard()};owned=attempt;
    try{
      attempt.worker=workerFactory();
      if(!attempt.worker||['addEventListener','removeEventListener','postMessage','terminate'].some(key=>typeof attempt.worker[key]!=='function'))throw new ProbeError('WORKER_UNAVAILABLE');
      const receive=event=>{
        if(!attempt.active||owned!==attempt)return;
        try {
          const packet=event.data;
          if(!attempt.ready){
            if(!exact(packet,['kind','version','seq'])||packet.kind!=='qwen-ready'||packet.version!==1||packet.seq!==0)throw new ProbeError('WORKER_PROTOCOL_ERROR');
            attempt.ready=true;for(const timer of attempt.timers)clearTimer(timer);attempt.timers.clear();arm(attempt,300000);
            attempt.worker.postMessage({kind:'qwen-smoke',version:1});update({status:'working',stage:'ready',elapsedMs:0});return;
          }
          if(!packet||packet.version!==1||packet.seq!==attempt.seq+1||!Number.isSafeInteger(packet.seq)||packet.seq>PROBE_MAX_PACKETS)throw new ProbeError('WORKER_PROTOCOL_ERROR');
          if(packet.kind==='qwen-progress') {
            if(!exact(packet,['kind','version','seq','stage','elapsedMs'])||packet.stage!==PROBE_STAGES[attempt.stageIndex]
              ||typeof packet.elapsedMs!=='number'||!Number.isFinite(packet.elapsedMs)||packet.elapsedMs<attempt.lastElapsed||packet.elapsedMs>300000)throw new ProbeError('WORKER_PROTOCOL_ERROR');
            attempt.seq=packet.seq;attempt.stageIndex++;attempt.lastElapsed=packet.elapsedMs;attempt.stages.push({stage:packet.stage,elapsedMs:packet.elapsedMs});
            update({status:'working',stage:packet.stage,elapsedMs:packet.elapsedMs});return;
          }
          if(packet.kind==='qwen-bytes') {
            if(!exact(packet,['kind','version','seq','stage','assetIndex','receivedBytes','verifiedBytes','totalBytes','elapsedMs']))throw new ProbeError('WORKER_PROTOCOL_ERROR');
            const progress=attempt.bytes.accept({stage:packet.stage,assetIndex:packet.assetIndex,receivedBytes:packet.receivedBytes,
              verifiedBytes:packet.verifiedBytes,totalBytes:packet.totalBytes,elapsedMs:packet.elapsedMs});
            if(progress.elapsedMs<attempt.lastElapsed||(progress.stage==='prepare'&&attempt.stageIndex!==2)
              ||(progress.stage==='consume'&&(attempt.stageIndex<3||attempt.stageIndex>7)))throw new ProbeError('WORKER_PROTOCOL_ERROR');
            attempt.seq=packet.seq;attempt.lastElapsed=progress.elapsedMs;
            update({status:'working',stage:PROBE_STAGES[attempt.stageIndex-1],elapsedMs:progress.elapsedMs,byteProgress:progress});return;
          }
          if(packet.kind==='qwen-error') {
            if(!exact(packet,['kind','version','seq','code'])||typeof packet.code!=='string'||!Object.hasOwn(PROBE_MESSAGES,packet.code))throw new ProbeError('WORKER_PROTOCOL_ERROR');
            revoke(attempt,'error',packet.code);return;
          }
          if(packet.kind!=='qwen-result'||!exact(packet,['kind','version','seq','receipt'])||attempt.stageIndex!==8)throw new ProbeError('WORKER_PROTOCOL_ERROR');
          const receipt=copyProbeReceipt(packet.receipt);
          if(receipt.elapsedMs<attempt.lastElapsed||receipt.stages.some((item,index)=>item.stage!==attempt.stages[index].stage||item.elapsedMs!==attempt.stages[index].elapsedMs))throw new ProbeError('WORKER_PROTOCOL_ERROR');
          // Successful native cleanup is separately reported by the worker;
          // termination still retires the owned channel for this attempt.
          attempt.active=false;owned=null;for(const timer of attempt.timers)clearTimer(timer);attempt.timers.clear();
          for(const [type,listener] of attempt.listeners)attempt.worker.removeEventListener(type,listener);attempt.worker.terminate();
          update({status:'complete',receipt,cleanup:'worker receipt confirms native disposal'});
        } catch{revoke(attempt,'error','WORKER_PROTOCOL_ERROR');}
      };
      const channelError=()=>revoke(attempt,'error','WORKER_PROTOCOL_ERROR');
      for(const [type,listener] of [['message',receive],['error',channelError],['messageerror',channelError]]){attempt.listeners.set(type,listener);attempt.worker.addEventListener(type,listener);}
      arm(attempt,10000);update({status:'starting',stage:'worker-ready',elapsedMs:0});return true;
    } catch {revoke(attempt,'error','WORKER_UNAVAILABLE');return false;}
  }
  return Object.freeze({run,cancel(){if(owned)revoke(owned,'cancelled','ABORTED');},dispose(){disposed=true;if(owned)revoke(owned,'cancelled','ABORTED');}});
}

function mountProbe(document) {
  const run=document.getElementById('run-probe'),cancel=document.getElementById('cancel-probe');
  if(!run||!cancel)return;
  const status=document.getElementById('probe-status'),detail=document.getElementById('probe-detail'),output=document.getElementById('probe-output'),receipt=document.getElementById('probe-receipt'),progress=document.getElementById('probe-progress');
  document.getElementById('probe-ids').textContent=JSON.stringify(PROBE_IDS);
  document.getElementById('probe-model').textContent=PROBE_MODEL;
  document.getElementById('probe-revision').textContent=PROBE_REVISION;
  const controller=createGeneratorProbeController({onUpdate(event){
    const active=['starting','working'].includes(event.status);run.disabled=active;cancel.disabled=!active;
    status.textContent=event.status==='complete'?'Local generation completed':event.status==='cancelled'?'Cancelled':event.status==='error'?'Diagnostic stopped':active?'Running local diagnostic':'Ready';
    detail.textContent=active?`${event.stage} · ${Math.round(event.elapsedMs)} ms`:event.message??event.cleanup??'';
    progress.hidden=!event.byteProgress;
    if(event.byteProgress){const bytes=event.byteProgress,mib=value=>(value/1048576).toFixed(1);
      progress.max=bytes.totalBytes;progress.value=bytes.receivedBytes;
      detail.textContent=`${bytes.stage==='prepare'?'Cache preparation':'SDK verified read'} · asset ${bytes.assetIndex+1}/8 · received ${mib(bytes.receivedBytes)}/${mib(bytes.totalBytes)} MiB · verified ${mib(bytes.verifiedBytes)} MiB · ${Math.round(bytes.elapsedMs)} ms`;
    }
    if(event.status==='starting'){output.textContent='Awaiting generation.';receipt.textContent='This attempt has no accepted runtime receipt.';}
    if(event.status==='complete'){
      const result=event.receipt;output.textContent=result.text;
      // Fixed projection, bounded by validation; no SDK errors, HTML or tensors.
      receipt.textContent=JSON.stringify({modelId:result.modelId,revision:result.revision,device:result.device,dtype:result.dtype,
        inputTokens:32,generatedTokenIds:result.generatedTokenIds,termination:result.inspection.termination,
        pureContractGenerationMode:result.preflight.generationMode,cachePreparation:result.cachePreparation,
        sdkReads:result.sdkReads,elapsedMs:result.elapsedMs,stages:result.stages,cleanup:result.cleanup},null,2);
    } else if(!active){output.textContent='No accepted output for this attempt.';receipt.textContent=`${event.code??''}\n${event.cleanup??''}`;}
  }});
  run.addEventListener('click',()=>controller.run());cancel.addEventListener('click',()=>controller.cancel());
  // A persisted pagehide may enter BFCache. Cancel the current attempt on
  // every departure while preserving explicit Run after the page restores.
  globalThis.addEventListener('pagehide',()=>controller.cancel());
}
if(typeof document!=='undefined')mountProbe(document);
