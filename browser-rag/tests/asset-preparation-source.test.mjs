import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AssetPreparationError,prepareAssetsInWorker,copyPreparationCommand,copyPreparationReceipt,PREPARATION_PROFILES,
  PREPARATION_DEADLINE_MS,PREPARATION_READY_MS} from '../asset-preparation-source.mjs';
import {createAssetPreparationCommandHandler} from '../asset-preparation.worker.mjs';
import {EMBEDDING_PREPARATION_PINS,prepareEmbeddingAssets} from '../embedding-runtime.mjs';
import {GENERATOR_PREPARATION_PINS,prepareGeneratorAssets} from '../generator-native-core.mjs';
import {identity,receipt,cacheResult,progress,packet,ready,WorkerDouble} from './asset-preparation-fixture.mjs';
const safe=code=>error=>{assert.ok(error instanceof AssetPreparationError);assert.equal(error.code,code);assert.equal(error.cause,undefined);assert.doesNotMatch(error.message,/PRIVATE/);return true;};
function start(profile='encoder',options={}){const worker=new WorkerDouble(),pending=prepareAssetsInWorker(profile,{identity:identity(),workerFactory:()=>worker,...options});return {worker,pending};}
function complete(worker,profile='encoder'){worker.emit(ready());worker.emit(packet(profile,'progress',1,progress(profile,0)));worker.emit(packet(profile,'progress',2,progress(profile,PREPARATION_PROFILES[profile].bytes)));worker.emit(packet(profile,'result',3,receipt(profile)));}
test('fixed preparation catalog equals the existing two model/runtime registries',()=>{
  const encoder=JSON.parse(readFileSync(new URL('../embedding-assets.json',import.meta.url))),generator=JSON.parse(readFileSync(new URL('../acceptance/generator-probe-assets.json',import.meta.url)));
  assert.deepEqual(EMBEDDING_PREPARATION_PINS,{...encoder.modelFiles,...encoder.runtimeFiles});
  assert.deepEqual(GENERATOR_PREPARATION_PINS,{...generator.modelFiles,...generator.runtimeFiles});
  for(const profile of ['encoder','generator'])assert.equal(Object.values(profile==='encoder'?EMBEDDING_PREPARATION_PINS:GENERATOR_PREPARATION_PINS).reduce((sum,pin)=>sum+pin.bytes,0),PREPARATION_PROFILES[profile].bytes);
});
test('commands accept only static profile and bounded identity; PDF/GPU/hooks and getters never execute',()=>{
  const command={kind:'prepare-assets',identity:identity(),profile:'encoder'};assert.deepEqual(copyPreparationCommand(command),command);
  let reads=0;for(const key of ['pdf','question','gpu','prepare']){const raw={...command};Object.defineProperty(raw,key,{enumerable:true,get(){reads++;throw Error('PRIVATE');}});assert.throws(()=>copyPreparationCommand(raw),safe('WORKER_PROTOCOL_ERROR'));}
  const raw={...command};Object.defineProperty(raw,'profile',{enumerable:true,get(){reads++;throw Error('PRIVATE');}});assert.throws(()=>copyPreparationCommand(raw),safe('WORKER_PROTOCOL_ERROR'));assert.equal(reads,0);
});
for(const profile of ['encoder','generator']){
  test(`${profile} preparation client owns a complete immutable static-only receipt and terminates its worker`,async()=>{
    const seen=[],{worker,pending}=start(profile,{onProgress:value=>seen.push(value)});complete(worker,profile);const value=await pending;
    assert.deepEqual(worker.sent,[{kind:'prepare-assets',identity:identity(),profile}]);assert.deepEqual(value,receipt(profile));assert.ok(Object.isFrozen(value));assert.ok(value.assetPins.every(Object.isFrozen));
    assert.equal(seen.length,2);assert.equal(worker.terminated,1);assert.equal(worker.listeners.size,0);
  });
  for(const mutate of [value=>{value.assetPins[0].sha256='a'.repeat(64);},value=>{value.assetPins[0].bytes++;value.assetPins[1].bytes--;},
    value=>{value.assetPins.reverse();},value=>{value.assetPins[0].url='https://private.test/asset';},value=>{value.cacheBytes++;},value=>{value.revision='main';}]){
    test(`${profile} refuses altered body pins or receipt identity ${mutate.toString()}`,()=>{const value=receipt(profile);mutate(value);assert.throws(()=>copyPreparationReceipt(value,profile),safe('WORKER_PROTOCOL_ERROR'));});
  }
}
test('absolute 30-minute deadline includes readiness and is not renewed by progress',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const {worker,pending}=start();t.mock.timers.tick(9000);worker.emit(ready());worker.emit(packet('encoder','progress',1,progress('encoder',0)));
  t.mock.timers.tick(PREPARATION_DEADLINE_MS-9001);worker.emit(packet('encoder','progress',2,progress('encoder',650)));
  t.mock.timers.tick(1);await assert.rejects(pending,safe('ASSET_PREPARATION_TIMEOUT'));assert.equal(worker.terminated,1);
});
test('readiness has its independent 10-second cap and posts no command after it expires',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const {worker,pending}=start();t.mock.timers.tick(PREPARATION_READY_MS);await assert.rejects(pending,safe('ASSET_PREPARATION_TIMEOUT'));assert.equal(worker.sent.length,0);assert.equal(worker.terminated,1);
});
test('cancel revokes before termination callback and ignores every late packet',async()=>{
  const controller=new AbortController(),{worker,pending}=start('encoder',{signal:controller.signal});worker.emit(ready());const captured=worker.captured;
  worker.onTerminate=()=>captured({data:packet('encoder','result',3,receipt())});controller.abort();await assert.rejects(pending,safe('ABORTED'));captured({data:ready()});assert.equal(worker.terminated,1);
});
for(const value of [packet('encoder','progress',2,progress('encoder',0)),packet('generator','progress',1,progress('generator',0)),
  packet('encoder','result',1,receipt()),{...packet('encoder','progress',1,progress('encoder',0)),secret:'PRIVATE'},
  packet('encoder','error',1,{code:'ABORTED',message:'PRIVATE'})]){
  test(`untrusted packet cannot commit ${JSON.stringify(value).slice(0,70)}`,async()=>{const {worker,pending}=start();worker.emit(ready());worker.emit(value);await assert.rejects(pending,safe('WORKER_PROTOCOL_ERROR'));assert.equal(worker.terminated,1);});
}
test('worker constructor/protocol errors are safe and configured time-budget overrides are refused',async()=>{
  await assert.rejects(prepareAssetsInWorker('encoder',{identity:identity(),workTimeoutMs:99999999}),safe('INVALID_ASSET_PREPARATION'));
  await assert.rejects(prepareAssetsInWorker('encoder',{identity:identity(),workerFactory:()=>{throw Error('PRIVATE');}}),safe('WORKER_UNAVAILABLE'));
});
test('single-use worker coalesces streamed progress below its packet cap while preserving final verification',async()=>{
  const packets=[];let clock=0,calls=0;
  const handler=createAssetPreparationCommandHandler(value=>packets.push(value),{now:()=>clock,prepareGenerator:async options=>{
    calls++;for(let index=1;index<=20000;index++){clock+=1;options.onProgress(progress('generator',index,0));}
    options.onProgress(progress('generator',PREPARATION_PROFILES.generator.bytes));return cacheResult('generator');
  }});
  await handler({kind:'prepare-assets',identity:identity(),profile:'generator'});
  assert.ok(packets.length<50);assert.equal(packets.at(-1).kind,'result');assert.equal(packets.at(-2).payload.verified,PREPARATION_PROFILES.generator.bytes);assert.equal(calls,1);
  assert.throws(()=>handler({kind:'prepare-assets',identity:identity(),profile:'generator'}),safe('WORKER_PROTOCOL_ERROR'));
});
test('encoder worker progress labels complete verified bodies and safe errors never expose loader details',async()=>{
  const packets=[];const handler=createAssetPreparationCommandHandler(value=>packets.push(value),{prepareEncoder:async options=>{options.onProgress('download',{completed:650,total:PREPARATION_PROFILES.encoder.bytes,unit:'bytes',estimated:false});throw Error('PRIVATE URL');},now:()=>10});
  await handler({kind:'prepare-assets',identity:identity(),profile:'encoder'});assert.equal(packets[1].payload.mode,'verified-assets');assert.equal(packets[1].payload.verified,650);assert.equal(packets.at(-1).kind,'error');assert.doesNotMatch(JSON.stringify(packets),/PRIVATE/);
});
test('encoder preparation refuses changed registry pins before asset requests or cache writes',async()=>{
  const registry=JSON.parse(readFileSync(new URL('../embedding-assets.json',import.meta.url)));registry.modelFiles['config.json'].sha256='a'.repeat(64);let fetches=0,opens=0;
  await assert.rejects(prepareEmbeddingAssets({baseURL:'https://reader.test/browser-rag/',fetch:async()=>{fetches++;return new Response(JSON.stringify(registry));},cacheStorage:{open(){opens++;}},crypto:globalThis.crypto}),error=>error.code==='ASSET_INTEGRITY_ERROR');assert.equal(fetches,1);assert.equal(opens,0);
});
test('static wrapper option boundaries refuse GPU/SDK injection and encoder preparation requires persistence',async()=>{
  await assert.rejects(prepareEmbeddingAssets({gpu:{}}),error=>error.code==='INVALID_EMBEDDING_CONFIG');
  await assert.rejects(prepareGeneratorAssets({importer(){throw Error('PRIVATE');}}),error=>error.code==='INVALID_PROBE_CONFIG');
  await assert.rejects(prepareEmbeddingAssets({baseURL:'https://reader.test/browser-rag/',cacheStorage:null}),error=>error.code==='ASSET_INTEGRITY_ERROR');
});
test('both static wrappers avoid navigator/GPU reads and reject a bad registry before model bodies or storage',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let gpuReads=0;
  Object.defineProperty(globalThis,'navigator',{configurable:true,get(){gpuReads++;throw Error('PRIVATE GPU read');}});
  try{
    for(const [prepare,name]of [[prepareEmbeddingAssets,'embedding-assets.json'],[prepareGeneratorAssets,'generator-probe-assets.json']]){
      const registry=JSON.parse(readFileSync(new URL(name==='embedding-assets.json'?'../embedding-assets.json':'../acceptance/generator-probe-assets.json',import.meta.url)));registry.modelFiles['config.json'].sha256='a'.repeat(64);let requests=0,storage=0;
      await assert.rejects(prepare({baseURL:'https://reader.test/browser-rag/',fetch:async()=>{requests++;return new Response(JSON.stringify(registry));},cacheStorage:{open(){storage++;}},...(name==='embedding-assets.json'?{crypto:globalThis.crypto}:{})}),error=>error.code==='ASSET_INTEGRITY_ERROR');
      assert.equal(requests,1);assert.equal(storage,0);
    }
    assert.equal(gpuReads,0);
  }finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
test('abort reentry during worker construction terminates the late owned worker exactly once',async()=>{
  const controller=new AbortController(),worker=new WorkerDouble();const pending=prepareAssetsInWorker('encoder',{identity:identity(),signal:controller.signal,workerFactory:()=>{controller.abort();return worker;}});
  await assert.rejects(pending,safe('ABORTED'));assert.equal(worker.terminated,1);assert.equal(worker.sent.length,0);
});
