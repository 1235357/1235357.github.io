import test from 'node:test';
import assert from 'node:assert/strict';
import { inputOf, identity, commandOf, syntheticRun, WorkerDouble, ready, tick } from './financial-generation-fixture.mjs';
import { PROBE_ASSET_BYTES, PROBE_STAGES } from '../generator-native-core.mjs';
const api=await import('../financial-generation-source.mjs').catch(()=>({}));
const workerApi=await import('../financial-generation.worker.mjs').catch(()=>({}));
const safe=expected=>error=>{assert.equal(error.code,expected);assert.equal(/PRIVATE|secret|http/.test(error.message),false);assert.equal(Object.hasOwn(error,'cause'),false);return true;};
const call=(name,...args)=>{assert.equal(typeof api[name],'function',name);return api[name](...args);};
async function packetsOf(options={maxNewTokens:17}) {
  assert.equal(typeof workerApi.createFinancialGenerationCommandHandler,'function');
  const packets=[],input=inputOf();await workerApi.createFinancialGenerationCommandHandler(p=>packets.push(p),{run:syntheticRun})(commandOf(input,options));
  return {packets,input,options};
}
function receiveAll(worker,packets){worker.receive(ready());for(const packet of packets)worker.receive(packet);}
test('command owns the exact eight-field input, identity and canonical generation options',()=>{
  const raw=commandOf(),owned=call('copyFinancialGenerationCommand',raw);assert.equal(owned.contextInput.question,raw.contextInput.question);
  assert.equal(Object.keys(owned.contextInput).length,8);assert.deepEqual(owned.generationOptions,{contextWindowTokens:2048,maxNewTokens:17});
  raw.contextInput.question='changed';raw.identity.operationId='op-2';assert.equal(owned.identity.operationId,'op-1');assert.equal(Object.isFrozen(owned.contextInput),true);
});
for(const [name,change] of [
  ['kind',v=>v.kind='qwen-smoke'],['extra',v=>v.extra='PRIVATE'],['query identity',v=>v.identity.operation='query'],
  ['empty runtime',v=>v.identity.runtimeId=' '],['long runtime',v=>v.identity.runtimeId='x'.repeat(257)],['unsafe id',v=>v.identity.operationId='op-9007199254740992'],
  ['zero id',v=>v.identity.operationId='op-0'],['epoch',v=>v.identity.documentEpoch=-1],['options',v=>v.generationOptions.temperature=0],
  ['projection',v=>v.contextInput=v.contextInput.queryMetadata],
])test(`command rejects ${name} with a fixed channel error`,()=>{const raw=commandOf();change(raw);assert.throws(()=>call('copyFinancialGenerationCommand',raw),safe('WORKER_PROTOCOL_ERROR'));});
test('stage guard ties all eight timestamps and all verified reads to the complete receipt',async()=>{
  const guard=call('createFinancialGenerationStageGuard');
  const receipt=await syntheticRun(inputOf(),{maxNewTokens:17},{onProgress:(stage,ms)=>guard.accept(stage,ms),onByteProgress:detail=>guard.acceptBytes(detail)});
  guard.assertComplete(receipt);assert.deepEqual(guard.stages,receipt.stages);assert.equal(guard.stage,'cleanup');
  assert.equal(receipt.cachePreparation.verifiedBytes,PROBE_ASSET_BYTES);assert.equal(receipt.sdkReads.reads,6);assert.equal(receipt.sdkReads.verifiedBytes,814793281);
});
for(const stage of [undefined,'cleanup'])test(`complete stage guard rejects a ninth ${String(stage)} stage without mutation`,async()=>{
  const guard=call('createFinancialGenerationStageGuard');
  const receipt=await syntheticRun(inputOf(),{maxNewTokens:17},{onProgress:(name,ms)=>guard.accept(name,ms),onByteProgress:detail=>guard.acceptBytes(detail)});
  const before=guard.stages;
  assert.throws(()=>guard.accept(stage,before.at(-1).elapsedMs),safe('WORKER_PROTOCOL_ERROR'));
  assert.deepEqual(guard.stages,before);assert.equal(guard.stage,'cleanup');guard.assertComplete(receipt);
});
for(const stage of [undefined,'cleanup'])test(`receiver rejects a ninth ${String(stage)} stage immediately after cleanup`,async()=>{
  const {input,options,packets}=await packetsOf(),progressPackets=packets.slice(0,-1),worker=new WorkerDouble(),seen=[];
  const finalStage=progressPackets.at(-1),ninth={event:{...finalStage.event,stage,seq:finalStage.event.seq+1},detail:null};
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker,workTimeoutMs:1,onProgress:packet=>seen.push(packet)});
  receiveAll(worker,progressPackets);worker.receive(ninth);
  await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));assert.equal(seen.length,progressPackets.length);assert.equal(worker.terminated,1);
});
for(const stage of ['assets','sdk','cleanup','generate'])test(`first stage cannot be ${stage}`,()=>{const guard=call('createFinancialGenerationStageGuard');assert.throws(()=>guard.accept(stage,0),safe('WORKER_PROTOCOL_ERROR'));});
for(const ms of [-1,NaN,Infinity,300001,'0'])test(`stage time refuses ${String(ms)}`,()=>{const guard=call('createFinancialGenerationStageGuard');assert.throws(()=>guard.accept('adapter',ms),safe('WORKER_PROTOCOL_ERROR'));});
test('sdk stage cannot begin without all eight ordered preparation completions',()=>{
  const guard=call('createFinancialGenerationStageGuard');guard.accept('adapter',0);guard.accept('assets',0);
  assert.throws(()=>guard.accept('sdk',0),safe('WORKER_PROTOCOL_ERROR'));
});
test('stage guard refuses byte events outside their native stage',()=>{
  const guard=call('createFinancialGenerationStageGuard');guard.accept('adapter',0);
  assert.throws(()=>guard.acceptBytes({stage:'prepare',assetIndex:0,receivedBytes:0,verifiedBytes:0,totalBytes:678,elapsedMs:0}),safe('WORKER_PROTOCOL_ERROR'));
});
test('compact result contains metadata only and full artifact remains its sibling',async()=>{
  const {packets}=await packetsOf(),result=packets.at(-1),meta=call('financialGenerationResultReceipt',result.artifact);
  assert.deepEqual(result.event.payload,{data:meta});assert.equal(JSON.stringify(meta).includes('PRIVATE'),false);assert.equal(JSON.stringify(meta).includes('invented'),false);
  for(const forbidden of ['question','source','promptTokenIds','generatedTokenIds','text','preparedPrompt','messages','attentionMask'])assert.equal(Object.hasOwn(meta,forbidden),false);
});
for(const termination of ['eos','length'])test(`receiver returns full frozen ${termination} output without inspecting financial text`,async()=>{
  const {input,options,packets}=await packetsOf(termination==='length'?{maxNewTokens:3}:{maxNewTokens:17}),worker=new WorkerDouble(),progress=[];
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:url=>{assert.equal(url.pathname.endsWith('/financial-generation.worker.mjs'),true);return worker;},onProgress:p=>progress.push(p)});
  receiveAll(worker,packets);const result=await pending;assert.equal(result.artifact.inspection.termination,termination);
  assert.equal(result.artifact.outputInspection,'not-run');assert.equal(result.artifact.financialCorrectness,'unestablished');assert.equal(result.artifact.text.includes('invented'),true);
  assert.equal(worker.terminated,1);assert.equal(worker.sent.length,1);assert.equal(Object.isFrozen(result.artifact.preparedPrompt.context),true);
  assert.equal(progress.length,packets.length-1);assert.deepEqual(Object.keys(progress[0]),['event','detail']);
});
test('invalid input and options refuse synchronously before constructing a Worker',async()=>{
  let created=0;const options={identity:identity(),workerFactory:()=>{created++;return new WorkerDouble();}};
  await assert.rejects(async()=>call('generateFinancialInWorker',{...inputOf(),extra:1},{},options),safe('INVALID_PROMPT_INPUT'));
  await assert.rejects(async()=>call('generateFinancialInWorker',inputOf(),{temperature:0},options),safe('INVALID_GENERATION_CONFIG'));assert.equal(created,0);
});
test('receiver copies caller provenance and options before Worker setup or await',async()=>{
  const {input,options,packets}=await packetsOf(),worker=new WorkerDouble();const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker});
  input.question='retarget';options.maxNewTokens=512;receiveAll(worker,packets);const result=await pending;
  assert.equal(result.artifact.preflight.maxNewTokens,17);assert.notEqual(worker.sent[0].contextInput.question,'retarget');
});
for(const [name,change] of [
  ['identity',p=>p.event.runtimeId='other'],['gap',p=>p.event.seq+=1],['duplicate sequence',p=>p.event.seq=0],['high progress sequence',p=>p.event.seq=4096],
  ['unexpected detail',p=>p.detail={}],['stage reorder',p=>p.event.stage='sdk'],['estimated',p=>p.event.payload.estimated=true],
  ['fake total',p=>p.event.payload.total=100],['wrong unit',p=>p.event.payload.unit='tokens'],['extra packet',p=>p.extra='PRIVATE'],
])test(`receiver rejects progress ${name} and revokes the channel`,async()=>{
  const {input,options,packets}=await packetsOf(),worker=new WorkerDouble(),p=structuredClone(packets[0]);change(p);
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker});worker.receive(ready());worker.receive(p);
  await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));assert.equal(worker.terminated,1);assert.equal(worker.listeners.size,0);
});
for(const [name,change] of [
  ['source',p=>p.artifact.preparedPrompt.context.source.name='other.pdf'],['options',p=>p.artifact.preflight.maxNewTokens=18],
  ['frame',p=>p.artifact.preparedPrompt.renderedPrompt+=' '],['metadata',p=>p.event.payload.data.elapsedMs++],['read count',p=>p.artifact.sdkReads.reads++],
  ['stage timestamp',p=>p.artifact.stages[7].elapsedMs++],['empty fulltext',p=>p.artifact.text=''],['missing artifact',p=>delete p.artifact],
])test(`receiver refuses changed result ${name}`,async()=>{
  const {input,options,packets}=await packetsOf(),worker=new WorkerDouble(),all=structuredClone(packets);change(all.at(-1));
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker});receiveAll(worker,all);await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));assert.equal(worker.terminated,1);
});
test('abort during progress settles before cleanup reentrancy and no late receipt is accepted',async()=>{
  const {input,options,packets}=await packetsOf(),worker=new WorkerDouble(),controller=new AbortController();let seen=0;
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker,signal:controller.signal,onProgress(){seen++;controller.abort();}});
  worker.terminate=function(){this.terminated++;this.receive(packets.at(-1));};receiveAll(worker,packets);await assert.rejects(pending,safe('ABORTED'));assert.equal(seen,1);assert.equal(worker.terminated,1);
});
test('throwing progress subscriber is contained in a fixed error',async()=>{
  const {input,options,packets}=await packetsOf(),worker=new WorkerDouble();const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker,onProgress(){throw Error('PRIVATE');}});
  receiveAll(worker,packets);await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));
});
test('ready and work deadlines are bounded, and progress never renews work time',async()=>{
  const worker=new WorkerDouble(),input=inputOf();const waiting=call('generateFinancialInWorker',input,{},{identity:identity(),workerFactory:()=>worker,readyTimeoutMs:1});
  await assert.rejects(waiting,safe('GENERATION_TIMEOUT'));assert.equal(worker.terminated,1);
  const next=new WorkerDouble(),pending=call('generateFinancialInWorker',input,{},{identity:identity(),workerFactory:()=>next,workTimeoutMs:5});next.receive(ready());
  next.receive({event:{...identity(),kind:'progress',stage:'adapter',seq:1,payload:{completed:0,total:null,unit:'milliseconds',estimated:false}},detail:null});
  await assert.rejects(pending,safe('GENERATION_TIMEOUT'));assert.equal(next.terminated,1);await tick();
});
for(const config of [{readyTimeoutMs:10001},{workTimeoutMs:300001},{readyTimeoutMs:0},{workTimeoutMs:0},{readyTimeoutMs:null},{workTimeoutMs:null},{workerFactory:null},{run:()=>{}}])test('receiver rejects unbounded or unknown channel settings '+Object.keys(config),async()=>{
  await assert.rejects(async()=>call('generateFinancialInWorker',inputOf(),{},{identity:identity(),...config}),safe('INVALID_FINANCIAL_WORKER_CONFIG'));
});
test('exact ready announcement is required and it is consumed once',async()=>{
  for(const announcement of [{...ready(),extra:1},{...ready(),workerVersion:'query-v1'},{...ready(),protocolVersion:2},{}]) {
    const worker=new WorkerDouble(),pending=call('generateFinancialInWorker',inputOf(),{},{identity:identity(),workerFactory:()=>worker});worker.receive(announcement);
    await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));assert.equal(worker.sent.length,0);
  }
  const worker=new WorkerDouble(),pending=call('generateFinancialInWorker',inputOf(),{},{identity:identity(),workerFactory:()=>worker});worker.receive(ready());worker.receive(ready());
  await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));assert.equal(worker.sent.length,1);
});
test('already aborted signal refuses construction; abort in factory or listener setup releases captured Worker',async()=>{
  const first=new AbortController();first.abort();let made=0;
  await assert.rejects(call('generateFinancialInWorker',inputOf(),{},{identity:identity(),signal:first.signal,workerFactory(){made++;return new WorkerDouble();}}),safe('ABORTED'));assert.equal(made,0);
  for(const at of ['factory','signal-listener','worker-listener']) {
    const controller=new AbortController(),worker=new WorkerDouble();let signal=controller.signal;
    if(at==='signal-listener')signal={get aborted(){return controller.signal.aborted;},addEventListener(type,listener){assert.equal(this,signal);controller.signal.addEventListener(type,listener);controller.abort();},removeEventListener(type,listener){assert.equal(this,signal);controller.signal.removeEventListener(type,listener);}};
    if(at==='worker-listener')worker.addEventListener=function(type,listener){this.listeners.set(type,listener);controller.abort();};
    const pending=call('generateFinancialInWorker',inputOf(),{},{identity:identity(),signal,workerFactory(){if(at==='factory')controller.abort();return worker;}});
    await assert.rejects(pending,safe('ABORTED'));assert.equal(worker.terminated,1);
  }
});
test('abort inside Worker listener setup cannot accept synchronously delivered financial output',async()=>{
  const {input,options,packets}=await packetsOf(),controller=new AbortController(),worker=new WorkerDouble();
  worker.addEventListener=function(type,listener){this.listeners.set(type,listener);if(type==='message'){controller.abort();receiveAll(this,packets);}};
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker,signal:controller.signal});
  await assert.rejects(pending,safe('ABORTED'));assert.equal(worker.terminated,1);assert.equal(worker.sent.length,0);
});
test('terminal revocation precedes remove-listener and terminate reentry',async()=>{
  const {input,options,packets}=await packetsOf(),worker=new WorkerDouble();let capturedReceive,reentries=0;
  const add=worker.addEventListener;worker.addEventListener=function(type,listener){if(type==='message')capturedReceive=listener;add.call(this,type,listener);};
  worker.removeEventListener=function(){reentries++;capturedReceive({data:packets[0]});};
  worker.terminate=function(){this.terminated++;capturedReceive({data:packets.at(-1)});};
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker});receiveAll(worker,packets);
  const result=await pending;assert.equal(result.event.kind,'result');assert.equal(worker.terminated,1);assert.equal(reentries,3);
});
test('repeated consumption reads remain bounded at 64 and require verified completion',async()=>{
  const guard=call('createFinancialGenerationStageGuard'),details=[];
  await syntheticRun(inputOf(),{maxNewTokens:17},{onProgress(stage,ms){if(stage==='adapter'||stage==='assets')guard.accept(stage,ms);},onByteProgress(detail){if(detail.stage==='prepare'){guard.acceptBytes(detail);details.push(detail);}}});
  const ms=details.at(-1).elapsedMs;guard.accept('sdk',ms);
  for(let i=0;i<64;i++)for(const bytes of [0,678])guard.acceptBytes({stage:'consume',assetIndex:0,receivedBytes:bytes,verifiedBytes:bytes,totalBytes:678,elapsedMs:ms});
  assert.throws(()=>guard.acceptBytes({stage:'consume',assetIndex:0,receivedBytes:0,verifiedBytes:0,totalBytes:678,elapsedMs:ms}),safe('WORKER_PROTOCOL_ERROR'));
});
test('default ready/work deadlines are exactly ten seconds/five minutes',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const first=new WorkerDouble(),waiting=call('generateFinancialInWorker',inputOf(),{},{identity:identity(),workerFactory:()=>first});
  t.mock.timers.tick(9999);assert.equal(first.terminated,0);t.mock.timers.tick(1);await assert.rejects(waiting,safe('GENERATION_TIMEOUT'));
  const next=new WorkerDouble(),pending=call('generateFinancialInWorker',inputOf(),{},{identity:identity(),workerFactory:()=>next});next.receive(ready());
  t.mock.timers.tick(299999);assert.equal(next.terminated,0);t.mock.timers.tick(1);await assert.rejects(pending,safe('GENERATION_TIMEOUT'));
});
test('Worker methods and signal methods are captured once and called with their receiver',async()=>{
  const {input,options,packets}=await packetsOf(),worker=new WorkerDouble(),reads=new Map(),controller=new AbortController();
  for(const key of ['terminate','addEventListener','removeEventListener','postMessage']) {
    const method=worker[key];Object.defineProperty(worker,key,{get(){reads.set(key,(reads.get(key)??0)+1);if(reads.get(key)>1)throw Error('PRIVATE reread');return function(...args){assert.equal(this,worker);return method.call(this,...args);};}});
  }
  const signal={get aborted(){return controller.signal.aborted;}};
  for(const key of ['addEventListener','removeEventListener'])Object.defineProperty(signal,key,{get(){reads.set(key+'Signal',(reads.get(key+'Signal')??0)+1);return function(...args){assert.equal(this,signal);return controller.signal[key](...args);};}});
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker,signal});receiveAll(worker,packets);await pending;
  for(const count of reads.values())assert.equal(count,1);
});
test('captured termination survives a later method getter failure and throwing cleanup',async()=>{
  const worker=new WorkerDouble();Object.defineProperty(worker,'addEventListener',{get(){throw Error('PRIVATE');}});
  await assert.rejects(call('generateFinancialInWorker',inputOf(),{},{identity:identity(),workerFactory:()=>worker}),safe('WORKER_UNAVAILABLE'));assert.equal(worker.terminated,1);
  const {input,options,packets}=await packetsOf(),next=new WorkerDouble();next.removeEventListener=function(){throw Error('PRIVATE');};next.terminate=function(){this.terminated++;throw Error('PRIVATE');};
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>next});receiveAll(next,packets);const result=await pending;assert.equal(next.terminated,1);assert.equal(result.event.kind,'result');
});
test('reentrant packet getter cannot commit a second event',async()=>{
  const {input,options,packets}=await packetsOf(),worker=new WorkerDouble(),packet={...packets[0]};
  Object.defineProperty(packet,'event',{get(){worker.receive(packets[0]);return packets[0].event;}});
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker});worker.receive(ready());worker.receive(packet);
  await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));assert.equal(worker.terminated,1);
});
test('aborting from result getters revokes before accepting the full receipt',async()=>{
  for(const field of ['artifact','metadata']) {
    const {input,options,packets}=await packetsOf(),all=structuredClone(packets),worker=new WorkerDouble(),controller=new AbortController(),result=all.at(-1);
    if(field==='artifact'){const artifact=result.artifact;Object.defineProperty(result,'artifact',{get(){controller.abort();return artifact;}});}
    else {const data=result.event.payload.data;Object.defineProperty(result.event.payload,'data',{get(){controller.abort();return data;}});}
    const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker,signal:controller.signal});receiveAll(worker,all);
    await assert.rejects(pending,safe('ABORTED'));assert.equal(worker.terminated,1);
  }
});
test('hostile huge result arrays fail before enumeration or private entries',async()=>{
  const {input,options,packets}=await packetsOf(),all=structuredClone(packets),worker=new WorkerDouble();let reads=0;
  all.at(-1).artifact.generatedTokenIds=new Proxy(new Array(1000000),{get(target,key){if(key==='length')return target.length;reads++;throw Error('PRIVATE');},ownKeys(){reads++;throw Error('PRIVATE');}});
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker});receiveAll(worker,all);
  await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));assert.equal(reads,0);
});
for(const [name,change] of [
  ['prepare ordering',p=>p.detail.assetIndex=1],['pinned size',p=>p.detail.totalBytes++],['unverified final',p=>p.detail.verifiedBytes=1],
  ['wrong byte payload',p=>p.event.payload.completed++],['byte timestamp regression',p=>p.detail.elapsedMs=0],['consume early',p=>p.detail.stage='consume'],
])test('receiver rejects malformed byte '+name,async()=>{
  const {input,options,packets}=await packetsOf(),all=structuredClone(packets),worker=new WorkerDouble();change(all[2]);
  const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker});receiveAll(worker,all);await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));
});
test('skipped preparation completion or incomplete SDK body cannot be hidden by a full receipt',async()=>{
  for(const select of [packets=>packets.findIndex(p=>p.detail?.stage==='prepare'&&p.detail.verifiedBytes>0),packets=>packets.findIndex(p=>p.detail?.stage==='consume'&&p.detail.verifiedBytes>0)]) {
    const {input,options,packets}=await packetsOf(),all=structuredClone(packets),worker=new WorkerDouble();all.splice(select(all),1);all.forEach((p,i)=>p.event.seq=i+1);
    const pending=call('generateFinancialInWorker',input,options,{identity:identity(),workerFactory:()=>worker});receiveAll(worker,all);await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));
  }
});
test('fixed known error receipt is accepted but private or wrong-stage diagnostics are refused',async()=>{
  for(const mutate of [p=>p,p=>{p.event.payload.message='PRIVATE';return p;},p=>{p.event.stage='cleanup';return p;}]) {
    const worker=new WorkerDouble(),packet=mutate({event:{...identity(),kind:'error',stage:'adapter',seq:1,payload:{code:'GPU_UNAVAILABLE',message:'A non-fallback WebGPU adapter and owned device are required.'}}});
    const pending=call('generateFinancialInWorker',inputOf(),{},{identity:identity(),workerFactory:()=>worker});worker.receive(ready());worker.receive(packet);
    await assert.rejects(pending,safe(packet.event.payload.message.includes('PRIVATE')||packet.event.stage==='cleanup'?'WORKER_PROTOCOL_ERROR':'GPU_UNAVAILABLE'));
  }
});
test('progress near the work deadline cannot keep work alive',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const worker=new WorkerDouble(),pending=call('generateFinancialInWorker',inputOf(),{},{identity:identity(),workerFactory:()=>worker,workTimeoutMs:10});
  worker.receive(ready());t.mock.timers.tick(9);worker.receive({event:{...identity(),kind:'progress',stage:'adapter',seq:1,payload:{completed:9,total:null,unit:'milliseconds',estimated:false}},detail:null});
  t.mock.timers.tick(1);await assert.rejects(pending,safe('GENERATION_TIMEOUT'));assert.equal(worker.terminated,1);
});
