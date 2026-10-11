import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inputOf, commandOf, syntheticRun } from './financial-generation-fixture.mjs';
import { ProbeError } from '../generator-native-core.mjs';
const api=await import('../financial-generation.worker.mjs').catch(()=>({}));
const handler=(send,options)=>{assert.equal(typeof api.createFinancialGenerationCommandHandler,'function');return api.createFinancialGenerationCommandHandler(send,options);};
const safe=e=>e.code==='WORKER_PROTOCOL_ERROR'&&!/PRIVATE|secret|http/.test(e.message);
test('one complete valid command consumes the fresh realm before callbacks and emits exact progress/result packets',async()=>{
  const packets=[],raw=commandOf(),handle=handler(p=>{packets.push(p);assert.throws(()=>handle(raw),safe);},{run:syntheticRun});
  assert.equal(await handle(raw),true);assert.throws(()=>handle(raw),safe);
  assert.equal(packets[0].detail,null);assert.equal(packets[0].event.stage,'adapter');assert.equal(packets.at(-1).event.stage,'cleanup');
  packets.forEach((p,i)=>assert.equal(p.event.seq,i+1));assert.equal(packets.at(-1).artifact.preparedPrompt.context.question,raw.contextInput.question);
});
test('unknown commands are refused before trusted execution and a later valid first command can run',async()=>{
  let runs=0;const handle=handler(()=>{},{run(...args){runs++;return syntheticRun(...args);}});
  assert.throws(()=>handle({...commandOf(),kind:'other'}),safe);assert.equal(runs,0);await handle(commandOf());assert.equal(runs,1);
});
test('command-copy getter reentry cannot begin two native runs in one realm',async()=>{
  let runs=0,reentrantError;const packets=[],outer=commandOf(),inner=commandOf(),originalInput=outer.contextInput;
  const handle=handler(p=>packets.push(p),{run(...args){runs++;return syntheticRun(...args);}});
  Object.defineProperty(outer,'contextInput',{enumerable:true,get(){try{handle(inner);}catch(error){reentrantError=error;}return originalInput;}});
  await handle(outer);assert.equal(runs,1);assert.equal(packets.filter(p=>p.event.kind==='result').length,1);assert.equal(reentrantError?.code,'WORKER_PROTOCOL_ERROR');
});
test('uncaught command-copy reentry rejects both before native work and permits a later valid first command',async()=>{
  let runs=0;const outer=commandOf(),inner=commandOf(),handle=handler(()=>{},{run(...args){runs++;return syntheticRun(...args);}});
  Object.defineProperty(outer,'contextInput',{enumerable:true,get(){handle(inner);return inputOf();}});
  assert.throws(()=>handle(outer),safe);assert.equal(runs,0);await handle(commandOf());assert.equal(runs,1);
});
for(const options of [{run:3},{run:null},{run:syntheticRun,extra:1},{contextInput:inputOf()},null])test('handler rejects injection settings '+String(options),()=>assert.throws(()=>handler(()=>{},options),e=>e.code==='INVALID_FINANCIAL_WORKER_CONFIG'));
test('private arbitrary errors cross as a fixed safe terminal only',async()=>{
  const packets=[];await handler(p=>packets.push(p),{run(){throw Error('PRIVATE secret http://private');}})(commandOf());
  assert.equal(packets.length,1);assert.equal(packets[0].event.kind,'error');assert.equal(packets[0].event.stage,'adapter');
  assert.equal(/PRIVATE|secret|http/.test(JSON.stringify(packets)),false);assert.equal(Object.hasOwn(packets[0],'artifact'),false);
});
test('known native failures map to fixed safe messages without raw details',async()=>{
  const packets=[];await handler(p=>packets.push(p),{run(){throw new ProbeError('GPU_UNAVAILABLE');}})(commandOf());
  assert.equal(packets[0].event.payload.code,'GPU_UNAVAILABLE');assert.equal(Object.keys(packets[0]).length,1);
});
test('send failure has no recursive terminal emission',async()=>{
  let sends=0;await assert.rejects(handler(()=>{sends++;throw Error('PRIVATE');},{run:syntheticRun})(commandOf()),safe);assert.equal(sends,1);
});
test('callbacks after successful terminal refuse rather than emit additional packets',async()=>{
  const packets=[];let callbacks;await handler(p=>packets.push(p),{run(input,opts,cb){callbacks=cb;return syntheticRun(input,opts,cb);}})(commandOf());
  const count=packets.length;assert.throws(()=>callbacks.onProgress('cleanup',1),safe);assert.equal(packets.length,count);
});
for(const [name,run] of [
  ['skipped stage',(_input,_options,cb)=>{cb.onProgress('sdk',0);}],
  ['premature output',async(input,options)=>syntheticRun(input,options)],
  ['bad byte',(_input,_options,cb)=>{cb.onProgress('adapter',0);cb.onByteProgress({stage:'prepare',assetIndex:0,receivedBytes:0,verifiedBytes:0,totalBytes:678,elapsedMs:0});}],
])test('handler refuses '+name+' before result emission',async()=>{
  const packets=[];await handler(p=>packets.push(p),{run})(commandOf());assert.equal(packets.at(-1).event.kind,'error');assert.equal(packets.some(p=>p.event.kind==='result'),false);
});
test('swallowed invalid callbacks still prevent a complete terminal result',async()=>{
  const packets=[];await handler(p=>packets.push(p),{async run(input,opts,cb){try{cb.onProgress('sdk',0);}catch{}return syntheticRun(input,opts);}})(commandOf());
  assert.equal(packets.at(-1).event.payload.code,'WORKER_PROTOCOL_ERROR');assert.equal(packets.some(p=>p.event.kind==='result'),false);
});
test('receipt getter cannot hide a callback failure latched during complete receipt validation',async()=>{
  const packets=[];let callbackCode;
  await handler(packet=>packets.push(packet),{async run(input,options,callbacks){
    const valid=await syntheticRun(input,options,callbacks);
    return {...valid,get text(){
      try {callbacks.onProgress('sdk',0);}catch(error){callbackCode=error.code;}
      return valid.text;
    }};
  }})(commandOf());
  assert.equal(callbackCode,'WORKER_PROTOCOL_ERROR');assert.equal(packets.filter(packet=>packet.event.kind==='result').length,0);
  const errors=packets.filter(packet=>packet.event.kind==='error');assert.equal(errors.length,1);
  assert.equal(errors[0].event.payload.code,'WORKER_PROTOCOL_ERROR');assert.equal(errors[0].event.stage,'cleanup');
  assert.equal(Object.hasOwn(errors[0],'artifact'),false);assert.equal(/PRIVATE|invented|trillion/.test(JSON.stringify(errors)),false);
});
test('packet limit reserves sequence 4096 for the safe terminal error',async()=>{
  const packets=[];await handler(p=>packets.push(p),{run(_input,_opts,cb){cb.onProgress('adapter',0);cb.onProgress('assets',0);
    cb.onByteProgress({stage:'prepare',assetIndex:0,receivedBytes:0,verifiedBytes:0,totalBytes:678,elapsedMs:0});
    for(let n=1;n<=4094;n++)cb.onByteProgress({stage:'prepare',assetIndex:0,receivedBytes:1,verifiedBytes:0,totalBytes:678,elapsedMs:0});
  }})(commandOf());
  assert.equal(packets.length,4096);assert.equal(packets.at(-1).event.seq,4096);assert.equal(packets.at(-1).event.kind,'error');assert.equal(packets.at(-1).event.payload.code,'WORKER_PROTOCOL_ERROR');
});
test('packet budget exhaustion does not advance the terminal beyond the last emitted native stage',async()=>{
  const registry=JSON.parse(readFileSync(new URL('../acceptance/generator-probe-assets.json',import.meta.url))),sizes=Object.values({...registry.modelFiles,...registry.runtimeFiles}).map(pin=>pin.bytes);
  const packets=[];await handler(p=>packets.push(p),{run(_input,_opts,cb){cb.onProgress('adapter',0);cb.onProgress('assets',0);
    for(let assetIndex=0;assetIndex<8;assetIndex++) {
      cb.onByteProgress({stage:'prepare',assetIndex,receivedBytes:0,verifiedBytes:0,totalBytes:sizes[assetIndex],elapsedMs:0});
      if(assetIndex===0)for(let i=0;i<4077;i++)cb.onByteProgress({stage:'prepare',assetIndex,receivedBytes:1,verifiedBytes:0,totalBytes:sizes[assetIndex],elapsedMs:0});
      cb.onByteProgress({stage:'prepare',assetIndex,receivedBytes:sizes[assetIndex],verifiedBytes:sizes[assetIndex],totalBytes:sizes[assetIndex],elapsedMs:0});
    }
    cb.onProgress('sdk',0);
  }})(commandOf());
  assert.equal(packets.length,4096);assert.equal(packets.at(-1).event.stage,'assets');assert.equal(packets.at(-1).event.kind,'error');
});
test('byte detail getter cannot reenter callbacks and consume the outer callback packet budget',async()=>{
  const registry=JSON.parse(readFileSync(new URL('../acceptance/generator-probe-assets.json',import.meta.url))),sizes=Object.values({...registry.modelFiles,...registry.runtimeFiles}).map(pin=>pin.bytes);
  const packets=[];let nestedAccepted=0,nestedRejected=0,outerCode;
  await handler(packet=>packets.push(packet),{run(_input,_options,callbacks){
    callbacks.onProgress('adapter',0);callbacks.onProgress('assets',0);
    for(let assetIndex=0;assetIndex<8;assetIndex++)for(const bytes of [0,sizes[assetIndex]])callbacks.onByteProgress({stage:'prepare',assetIndex,receivedBytes:bytes,verifiedBytes:bytes,totalBytes:sizes[assetIndex],elapsedMs:0});
    callbacks.onProgress('sdk',0);
    const detail={stage:'consume',assetIndex:0,receivedBytes:0,verifiedBytes:0,totalBytes:sizes[0],get elapsedMs(){
      for(let i=0;i<4076;i++)try {
        callbacks.onByteProgress({stage:'consume',assetIndex:1,receivedBytes:i===0?0:1,verifiedBytes:0,totalBytes:sizes[1],elapsedMs:0});nestedAccepted++;
      }catch(error){assert.equal(error.code,'WORKER_PROTOCOL_ERROR');nestedRejected++;}
      return 0;
    }};
    try {callbacks.onByteProgress(detail);}catch(error){outerCode=error.code;}
    throw new ProbeError('ASSET_CACHE_ERROR');
  }})(commandOf());
  assert.equal(nestedAccepted,0);assert.equal(nestedRejected,4076);assert.equal(outerCode,'WORKER_PROTOCOL_ERROR');
  assert.equal(packets.filter(packet=>packet.event.kind==='progress').length,19);
  const errors=packets.filter(packet=>packet.event.kind==='error');assert.equal(errors.length,1);assert.equal(errors[0].event.seq,20);
  assert.equal(errors[0].event.payload.code,'WORKER_PROTOCOL_ERROR');assert.equal(errors[0].event.stage,'sdk');assert.equal(Object.hasOwn(errors[0],'artifact'),false);
});
test('sender callback reentry is latched once and cannot advance native stages',async()=>{
  const packets=[];let callbacks,nestedCode;
  await handler(packet=>{packets.push(packet);if(packet.event.kind==='progress')try{callbacks.onProgress('assets',0);}catch(error){nestedCode=error.code;}},
    {run(_input,_options,cb){callbacks=cb;try{cb.onProgress('adapter',0);}catch{}throw new ProbeError('ASSET_CACHE_ERROR');}})(commandOf());
  assert.equal(nestedCode,'WORKER_PROTOCOL_ERROR');assert.equal(packets.length,2);assert.equal(packets[0].event.stage,'adapter');
  assert.equal(packets[1].event.kind,'error');assert.equal(packets[1].event.stage,'adapter');assert.equal(packets[1].event.payload.code,'WORKER_PROTOCOL_ERROR');
});
test('command graph mutation after callbacks cannot retarget the runtime input',async()=>{
  const raw=commandOf(),original=raw.contextInput.question,packets=[];
  await handler(p=>{packets.push(p);raw.contextInput.question='retarget';raw.generationOptions.maxNewTokens=512;},{run:syntheticRun})(raw);
  const result=packets.at(-1);assert.equal(result.artifact.preparedPrompt.context.question,original);assert.equal(result.artifact.preflight.maxNewTokens,17);
});
test('hostile error code getters stay private and are never copied into packets',async()=>{
  const packets=[],error=new ProbeError('GPU_UNAVAILABLE');Object.defineProperty(error,'code',{get(){throw Error('PRIVATE');}});
  await handler(p=>packets.push(p),{run(){throw error;}})(commandOf());assert.equal(packets[0].event.payload.code,'GENERATION_FAILED');assert.equal(JSON.stringify(packets).includes('PRIVATE'),false);
});
test('actual native entry emits exact ready and mutes only its Worker console after a valid command',()=>{
  const entry=new URL('../financial-generation.worker.mjs',import.meta.url).href,fixture=new URL('./financial-generation-fixture.mjs',import.meta.url).href;
  const script=`import { commandOf } from ${JSON.stringify(fixture)};
    const packets=[],originalLog=()=>{},fakeConsole={log:originalLog,error:()=>{}};let listener;
    globalThis.console=fakeConsole;globalThis.WorkerGlobalScope=class {static [Symbol.hasInstance](){return true;}};
    globalThis.postMessage=p=>packets.push(p);globalThis.addEventListener=(type,fn)=>{if(type==='message')listener=fn;};
    await import(${JSON.stringify(entry)});const before=fakeConsole.log===originalLog;
    listener({data:commandOf()});await new Promise(resolve=>setImmediate(resolve));
    process.stdout.write(JSON.stringify({before,muted:fakeConsole.log!==originalLog,packets}));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
  const result=JSON.parse(child.stdout);assert.equal(result.before,true);assert.equal(result.muted,true);
  assert.deepEqual(result.packets[0],{kind:'generation-ready',protocolVersion:1,workerVersion:'financial-generation-v1'});
  assert.equal(result.packets[1].event.kind,'error');assert.equal(Object.hasOwn(result.packets[1],'artifact'),false);
});
