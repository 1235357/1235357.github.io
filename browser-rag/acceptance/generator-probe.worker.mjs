import { runGeneratorProbe, copyProbeReceipt, createProbeByteGuard, ProbeError, PROBE_STAGES, PROBE_MAX_PACKETS } from './generator-probe-runtime.mjs';
import { suppressWorkerConsole } from '../worker-console.mjs';

const exact=(value,keys)=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))
  &&Reflect.ownKeys(value).length===keys.length&&Reflect.ownKeys(value).every(key=>keys.includes(key));

export function createProbeCommandHandler(send,options={}) {
  if(typeof send!=='function'||options===null||typeof options!=='object'
    ||!exact(options,Object.hasOwn(options,'run')?['run']:[])||typeof (options.run??runGeneratorProbe)!=='function')throw new ProbeError('INVALID_PROBE_CONFIG');
  const run=options.run??runGeneratorProbe;let consumed=false,seq=0,index=0,lastElapsed=0;
  const byteGuard=createProbeByteGuard();
  const emit=packet=>{if(seq>=PROBE_MAX_PACKETS)throw new ProbeError('WORKER_PROTOCOL_ERROR');try{send(Object.freeze({kind:packet.kind,version:1,seq:++seq,...packet}));}catch{throw new ProbeError('WORKER_PROTOCOL_ERROR');}};
  return command=>{
    if(consumed||!exact(command,['kind','version'])||command.kind!=='qwen-smoke'||command.version!==1)throw new ProbeError('WORKER_PROTOCOL_ERROR');
    consumed=true;
    return (async()=>{
      try {
        const receipt=copyProbeReceipt(await run({onProgress(stage,elapsedMs){
          if(stage!==PROBE_STAGES[index]||typeof elapsedMs!=='number'||!Number.isFinite(elapsedMs)||elapsedMs<lastElapsed||elapsedMs>300000)throw new ProbeError('WORKER_PROTOCOL_ERROR');
          index++;lastElapsed=elapsedMs;emit({kind:'qwen-progress',stage,elapsedMs});
        },onByteProgress(raw){
          const progress=byteGuard.accept(raw);
          if(progress.elapsedMs<lastElapsed||(progress.stage==='prepare'&&index!==2)
            ||(progress.stage==='consume'&&(index<3||index>7)))throw new ProbeError('WORKER_PROTOCOL_ERROR');
          lastElapsed=progress.elapsedMs;emit({kind:'qwen-bytes',...progress});
        }}));
        emit({kind:'qwen-result',receipt});
      } catch(error) {emit({kind:'qwen-error',code:error instanceof ProbeError?error.code:'GENERATION_FAILED'});}
      return true;
    })();
  };
}

if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope&&typeof globalThis.postMessage==='function') {
  const handle=createProbeCommandHandler(packet=>globalThis.postMessage(packet),{run(options){
    // Muting belongs solely to this native worker and precedes dynamic SDK import.
    suppressWorkerConsole();return runGeneratorProbe(options);
  }});
  const channelFailure=()=>{throw new ProbeError('WORKER_PROTOCOL_ERROR');};
  globalThis.addEventListener('message',event=>{
    try{handle(event.data).catch(()=>globalThis.setTimeout(channelFailure,0));}catch{channelFailure();}
  });
  globalThis.postMessage({kind:'qwen-ready',version:1,seq:0});
}
