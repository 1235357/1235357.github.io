import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatorAssetPlan, runGeneratorProbe, copyProbeReceipt, copyProbeByteProgress } from '../acceptance/generator-probe-runtime.mjs';
import { createProbeCommandHandler } from '../acceptance/generator-probe.worker.mjs';
import { createGeneratorProbeController } from '../acceptance/generator-probe.mjs';
import { preflightGeneration, inspectGeneratedSequence } from '../generator-contract.mjs';

const MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
const REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e';
const BASE = 'http://127.0.0.1:8766/browser-rag/';
const IDS = [151644,8948,198,2610,525,264,10950,17847,13,151645,198,151644,872,198,45764,23811,26753,323,6286,419,374,264,1602,2613,2205,1273,13,151645,198,151644,77091,198];
const MODEL_FILES = {
  'config.json': { bytes:678, sha256:'777e01f0fbb3346eb229cb6fb278ed6533c1e4dcb9ebf4bed0f6e94ef17fa1b5' },
  'tokenizer.json': { bytes:7031673, sha256:'a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf' },
  'tokenizer_config.json': { bytes:7849, sha256:'6a14243f0ae04884e597b3f032c05e15de9f417318fdcac24ab4e2680e691430' },
  'generation_config.json': { bytes:242, sha256:'f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3' },
  'onnx/model_q4.onnx': { bytes:786156820, sha256:'09235a3b1c135cd04ef570e5053b5c079e028078a2cc5f76ba6a251e91bf3296' },
};
const RUNTIME_FILES = JSON.parse(readFileSync(new URL('../embedding-assets.json', import.meta.url))).runtimeFiles;
const registry = () => ({schemaVersion:1,modelId:MODEL,revision:REVISION,modelFiles:structuredClone(MODEL_FILES),runtimeFiles:structuredClone(RUNTIME_FILES)});
const deferred = () => { let resolve,reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };
const errorCode = code => error => { assert.equal(error.code,code); assert.equal(/secret|stack|http/.test(error.message),false); return true; };
const tick = () => new Promise(resolve=>setImmediate(resolve));

function fixture(changes={}) {
  const calls={load:0,generate:0,decode:[],disposed:0,destroyed:0,closed:0,options:null,stages:[]};
  const device={lost:new Promise(()=>{}),addEventListener(){},removeEventListener(){},destroy(){calls.destroyed++;}};
  const adapter={get info(){assert.equal(this,adapter);return {isFallbackAdapter:false};},requestDevice(){assert.equal(this,adapter);return device;}};
  const tokenizer=Object.assign(async (_text,options)=>{ assert.deepEqual(options,{add_special_tokens:false,truncation:false,padding:false,return_tensor:false}); return {input_ids:[...IDS],attention_mask:IDS.map(()=>1)}; },{
    apply_chat_template(messages,options){assert.deepEqual(messages,[{role:'system',content:'You are a helpful assistant.'},{role:'user',content:'Say hello briefly and mention this is a very small local test.'}]);assert.deepEqual(options,{tokenize:false,add_generation_prompt:true});return 'fixed template';},
    decode(ids,options){calls.decode.push([...ids]);assert.deepEqual(options,{skip_special_tokens:true});return 'Hello! A small local test.';},
  });
  class Tensor {
    constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;}
    dispose(){calls.disposed++;}
  }
  const model={async generate(options){calls.generate++;calls.options=options;return new Tensor('int64',BigInt64Array.from([...IDS,5,151645],BigInt),[1,34]);},async dispose(){calls.disposed++;}};
  const library={env:{backends:{onnx:{wasm:{},webgpu:{}}}},Tensor,
    AutoTokenizer:{async from_pretrained(id,options){assert.equal(id,MODEL);assert.deepEqual(options,{revision:REVISION,local_files_only:true});return tokenizer;}},
    AutoModelForCausalLM:{async from_pretrained(id,options){calls.load++;assert.equal(id,MODEL);assert.deepEqual(options,{revision:REVISION,local_files_only:true,device:'webgpu',dtype:'q4',use_external_data_format:false,session_options:{executionProviders:['webgpu']}});await library.env.backends.onnx.webgpu.adapter.requestDevice({requiredFeatures:[]});return model;}}
  };
  const receipt={assets:8,verifiedBytes:Object.values({...MODEL_FILES,...RUNTIME_FILES}).reduce((n,v)=>n+v.bytes,0),networkBytes:0,cacheBytes:0};receipt.cacheBytes=receipt.verifiedBytes;
  const prepared={cache:{async match(){throw new Error('unused stub');}},receipt,async finishReads(){return {reads:5,verifiedBytes:800000000};},close(){calls.closed++;}};
  const options={baseURL:BASE,gpu:{async requestAdapter(){return adapter;}},async fetch(url){assert.equal(url,BASE+'acceptance/generator-probe-assets.json');return new Response(JSON.stringify(registry()));},cacheStorage:{open(){}},async prepare(plan,options){assert.equal(plan.assets.length,8);assert.equal(options.cacheStorage.open instanceof Function,true);for(const [assetIndex,asset] of plan.assets.entries()){options.onProgress?.({stage:'prepare',assetIndex,completed:0,total:asset.bytes,unit:'bytes',estimated:false,verified:false});options.onProgress?.({stage:'prepare',assetIndex,completed:asset.bytes,total:asset.bytes,unit:'bytes',estimated:false,verified:true});}return prepared;},async importer(url){assert.equal(url,BASE+'vendor/transformers/transformers.min.js');return library;},now:()=>1,onProgress:(stage)=>calls.stages.push(stage),...changes};
  return {options,calls,device,adapter,tokenizer,model,library,prepared,Tensor};
}

test('fixed manifest produces eight sealed primaries and only exact Hugging Face model aliases',()=>{
 const plan=generatorAssetPlan(registry(),BASE);
 assert.notEqual(plan,undefined,'an owned fixed asset plan is required');
 assert.equal(plan.cacheName,`financial-rag-generator-${REVISION}-smoke-v1`);
 assert.equal(plan.assets.length,8);
 assert.deepEqual(plan.assets[4],{url:BASE+`models/${REVISION}/${MODEL}/onnx/model_q4.onnx`,...MODEL_FILES['onnx/model_q4.onnx'],aliases:[`https://huggingface.co/${MODEL}/resolve/${REVISION}/onnx/model_q4.onnx`]});
 assert.equal(plan.assets.slice(5).every(item=>item.aliases.length===0),true);
});
for(const mutate of [r=>r.extra=true,r=>r.modelId='other',r=>r.revision='main',r=>r.modelFiles['../secret']={bytes:1,sha256:'a'.repeat(64)},r=>r.modelFiles['config.json'].bytes++,r=>r.modelFiles['config.json'].sha256='0'.repeat(64),r=>delete r.runtimeFiles['ort-wasm-simd-threaded.jsep.wasm']]) test('manifest refuses changed pins or schema before asset preparation '+String(mutate),()=>{const r=registry();mutate(r);assert.throws(()=>generatorAssetPlan(r,BASE),errorCode('ASSET_INTEGRITY_ERROR'));});

test('actual integration boundary applies exact tokens, q4 WebGPU policy, generated-only decode and awaits cleanup',async()=>{
 const f=fixture(),receipt=await runGeneratorProbe(f.options);
 assert.notEqual(receipt,undefined,'runtime must return an owned bounded receipt');
 assert.equal(receipt.status,'local-smoke-complete');assert.equal(receipt.preflight.generationMode,'not-run');assert.equal(receipt.inspection.generationMode,'not-run');
 assert.deepEqual(receipt.promptTokenIds,IDS);assert.deepEqual(receipt.generatedTokenIds,[5,151645]);assert.deepEqual(f.calls.decode,[[5,151645]]);
 assert.equal(f.calls.options.input_ids.type,'int64');assert.deepEqual(f.calls.options.input_ids.dims,[1,32]);assert.deepEqual([...f.calls.options.attention_mask.data],Array(32).fill(1n));
 assert.equal(f.calls.options.generation_config.max_length,40);assert.equal(f.calls.options.generation_config.max_new_tokens,8);assert.equal(f.calls.options.generation_config.do_sample,false);
 assert.equal(f.calls.destroyed,1);assert.equal(f.calls.disposed,4);assert.equal(f.calls.closed,1);
 assert.deepEqual(receipt.cleanup,{inputsDisposed:2,resultDisposed:true,modelDisposed:true,cacheClosed:true,devicesDestroyed:1});
 assert.equal(f.library.env.allowRemoteModels,false);assert.equal(f.library.env.useFSCache,false);assert.equal(f.library.env.useBrowserCache,false);assert.equal(f.library.env.customCache,f.prepared.cache);
 assert.deepEqual(copyProbeReceipt(receipt),receipt);
});
test('token mismatch refuses graph load',async()=>{const f=fixture();f.library.AutoTokenizer.from_pretrained=async()=>Object.assign(async()=>({input_ids:[...IDS.slice(1),4],attention_mask:Array(32).fill(1)}),{apply_chat_template:()=>''});await assert.rejects(runGeneratorProbe(f.options),errorCode('TOKENIZER_MISMATCH'));assert.equal(f.calls.load,0);assert.equal(f.calls.closed,1);});
test('fallback GPU is refused before assets',async()=>{const f=fixture();f.adapter.info.isFallbackAdapter=true;f.options.gpu={requestAdapter:async()=>({info:{isFallbackAdapter:true},requestDevice(){throw Error();}})};let fetched=false;f.options.fetch=()=>{fetched=true;};await assert.rejects(runGeneratorProbe(f.options),errorCode('GPU_UNAVAILABLE'));assert.equal(fetched,false);});
for(const [name,alter,code] of [
 ['model error',f=>f.library.AutoModelForCausalLM.from_pretrained=async()=>{throw Error('secret');},'MODEL_LOAD_FAILED'],
 ['generate error',f=>f.model.generate=async()=>{throw Error('secret');},'GENERATION_FAILED'],
 ['reads error',f=>f.prepared.finishReads=async()=>{throw Error('secret');},'ASSET_CACHE_ERROR'],
 ['cache error',f=>f.options.prepare=async()=>{throw Error('secret');},'ASSET_CACHE_ERROR'],
 ['wrong dtype',f=>f.model.generate=async()=>new f.Tensor('float32',new Float32Array(34),[1,34]),'INVALID_GENERATION_OUTPUT'],
 ['wrong prefix',f=>f.model.generate=async()=>new f.Tensor('int64',BigInt64Array.from([...IDS.slice(1),4,5,151645],BigInt),[1,34]),'INVALID_GENERATION_OUTPUT'],
 ['oversize',f=>f.model.generate=async()=>({type:'int64',dims:[1,41],get data(){throw Error('must not inspect data');},dispose(){f.calls.disposed++;}}),'INVALID_GENERATION_OUTPUT'],
 ['empty',f=>f.model.generate=async()=>new f.Tensor('int64',BigInt64Array.from(IDS,BigInt),[1,32]),'INVALID_GENERATION_OUTPUT'],
 ['incomplete',f=>f.model.generate=async()=>new f.Tensor('int64',BigInt64Array.from([...IDS,5],BigInt),[1,33]),'INVALID_GENERATION_OUTPUT'],
 ['oversize text',f=>f.tokenizer.decode=()=> 'x'.repeat(1025),'INVALID_GENERATION_OUTPUT'],
]) test(name+' stays fixed and cleans resources',async()=>{const f=fixture();alter(f);await assert.rejects(runGeneratorProbe(f.options),errorCode(code));assert.equal(f.calls.closed,name==='cache error'?0:1);assert.equal(f.calls.destroyed,name==='model error'||name==='cache error'?0:1);});

test('cancel races late model and still disposes the returned model',async()=>{const controller=new AbortController(),late=deferred(),entered=deferred(),f=fixture({signal:controller.signal});f.library.AutoModelForCausalLM.from_pretrained=async()=>{entered.resolve();return late.promise;};const pending=runGeneratorProbe(f.options);await entered.promise;controller.abort();await assert.rejects(pending,errorCode('ABORTED'));late.resolve(f.model);await tick();assert.equal(f.calls.disposed,1);assert.equal(f.calls.closed,1);});
test('cancel destroys a late device exactly once with native getter receivers preserved',async()=>{const controller=new AbortController(),late=deferred(),entered=deferred(),f=fixture({signal:controller.signal});f.adapter.requestDevice=()=>{entered.resolve();return late.promise;};const pending=runGeneratorProbe(f.options);await entered.promise;controller.abort();await assert.rejects(pending,errorCode('ABORTED'));late.resolve(f.device);await tick();assert.equal(f.calls.destroyed,1);assert.equal(f.calls.closed,1);});
test('device uncaptured error revokes a pending generation',async()=>{const f=fixture(),entered=deferred();let callback;f.device.addEventListener=(_type,listener)=>{callback=listener;};f.model.generate=()=>{entered.resolve();return new Promise(()=>{});};const pending=runGeneratorProbe(f.options);await entered.promise;callback({error:Error('secret')});await assert.rejects(pending,errorCode('GPU_UNCAPTURED_ERROR'));assert.equal(f.calls.destroyed,1);});
test('device lost revokes a pending generation',async()=>{const f=fixture(),lost=deferred(),entered=deferred();f.device.lost=lost.promise;f.model.generate=()=>{entered.resolve();return new Promise(()=>{});};const pending=runGeneratorProbe(f.options);await entered.promise;lost.resolve({message:'secret'});await assert.rejects(pending,errorCode('GPU_DEVICE_LOST'));assert.equal(f.calls.destroyed,1);});
test('cancellation after model load initiates disposal before returning and cleans late generation tensors',async()=>{const controller=new AbortController(),late=deferred(),entered=deferred(),f=fixture({signal:controller.signal});f.model.generate=()=>{entered.resolve();return late.promise;};const pending=runGeneratorProbe(f.options);await entered.promise;controller.abort();await assert.rejects(pending,errorCode('ABORTED'));assert.equal(f.calls.disposed,3);late.resolve(new f.Tensor('int64',BigInt64Array.from([...IDS,5,151645],BigInt),[1,34]));await tick();assert.equal(f.calls.disposed,4);assert.equal(f.calls.destroyed,1);});
test('elapsed durations are bounded independently of a long-lived browser clock',async()=>{const f=fixture({now:()=>600001});const receipt=await runGeneratorProbe(f.options);assert.equal(receipt.elapsedMs,0);});

test('worker accepts one exact command and emits bounded ordered lifecycle packets',async()=>{const packets=[],f=fixture();const handler=createProbeCommandHandler(packet=>packets.push(packet),{run:()=>runGeneratorProbe(f.options)});assert.throws(()=>handler({kind:'qwen-smoke',version:1,extra:true}),errorCode('WORKER_PROTOCOL_ERROR'));await handler({kind:'qwen-smoke',version:1});assert.equal(packets.at(-1).kind,'qwen-result');assert.equal(packets.every((packet,index)=>packet.seq===index+1&&packet.version===1),true);assert.throws(()=>handler({kind:'qwen-smoke',version:1}),errorCode('WORKER_PROTOCOL_ERROR'));});
test('worker normalizes raw exceptions into fixed channel code',async()=>{const packets=[];await createProbeCommandHandler(packet=>packets.push(packet),{run:async()=>{throw Error('secret');}})({kind:'qwen-smoke',version:1});assert.deepEqual(packets,[{kind:'qwen-error',version:1,seq:1,code:'GENERATION_FAILED'}]);});
test('worker rejects malformed owned configuration with a fixed error',()=>{assert.throws(()=>createProbeCommandHandler(()=>{},null),errorCode('INVALID_PROBE_CONFIG'));});

function hostFixture(){
 const workers=[],timers=new Map(),updates=[];let timerId=0;
 class WorkerDouble {constructor(){this.listeners=new Map();this.commands=[];this.terminations=0;workers.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type);}postMessage(command){this.commands.push(command);}terminate(){this.terminations++;}emit(packet){this.listeners.get('message')?.({data:packet});}}
 const host=createGeneratorProbeController({workerFactory:()=>new WorkerDouble(),onUpdate:event=>updates.push(event),setTimer:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimer:id=>timers.delete(id)});
 return {host,workers,timers,updates};
}
test('parent owns a fresh worker each explicit Run, validates ready and cleans listeners/timers on cancel',()=>{const f=hostFixture();f.host.run();assert.equal(f.workers.length,1);const w=f.workers[0];assert.equal([...f.timers.values()][0].ms,10000);w.emit({kind:'qwen-ready',version:1,seq:0});assert.deepEqual(w.commands,[{kind:'qwen-smoke',version:1}]);assert.equal([...f.timers.values()][0].ms,300000);f.host.cancel();assert.equal(w.terminations,1);assert.equal(w.listeners.size,0);assert.equal(f.timers.size,0);w.emit({kind:'qwen-result',version:1,seq:1,receipt:{}});assert.equal(f.updates.at(-1).status,'cancelled');f.host.run();assert.equal(f.workers.length,2);f.host.dispose();assert.equal(f.workers[1].terminations,1);});
for(const packet of [{kind:'qwen-ready',version:2,seq:0},{kind:'qwen-progress',version:1,seq:1,stage:'model',elapsedMs:0},{kind:'qwen-ready',version:1,seq:0,extra:true}]) test('parent malformed or premature packet revokes commit permission '+JSON.stringify(packet),()=>{const f=hostFixture();f.host.run();f.workers[0].emit(packet);assert.equal(f.workers[0].terminations,1);assert.equal(f.updates.at(-1).code,'WORKER_PROTOCOL_ERROR');});
test('parent rejects sequence gaps and no automatic retry occurs',()=>{const f=hostFixture();f.host.run();const w=f.workers[0];w.emit({kind:'qwen-ready',version:1,seq:0});w.emit({kind:'qwen-progress',version:1,seq:2,stage:'adapter',elapsedMs:1});assert.equal(w.terminations,1);assert.equal(f.workers.length,1);});
test('ready and work deadlines terminate owned worker without claiming native disposal',()=>{for(const ready of [false,true]){const f=hostFixture();f.host.run();if(ready)f.workers[0].emit({kind:'qwen-ready',version:1,seq:0});[...f.timers.values()][0].fn();assert.equal(f.workers[0].terminations,1);assert.equal(f.updates.at(-1).code,'PROBE_TIMEOUT');assert.equal(f.updates.at(-1).cleanup,'worker-terminated; native disposal unconfirmed');}});
test('parent commits only the bounded receipt of an ordered completed attempt',async()=>{
 const receipt=await runGeneratorProbe(fixture().options),f=hostFixture();f.host.run();const w=f.workers[0];w.emit({kind:'qwen-ready',version:1,seq:0});
 for(const [index,stage] of receipt.stages.entries())w.emit({kind:'qwen-progress',version:1,seq:index+1,...stage});
 w.emit({kind:'qwen-result',version:1,seq:9,receipt});assert.equal(f.updates.at(-1).status,'complete');assert.deepEqual(f.updates.at(-1).receipt,receipt);assert.equal(w.terminations,1);assert.equal(w.listeners.size,0);assert.equal(f.timers.size,0);
});
test('parent refuses a receipt whose stage times differ from its observed channel',async()=>{
 const receipt={...await runGeneratorProbe(fixture().options),elapsedMs:1},f=hostFixture();f.host.run();const w=f.workers[0];w.emit({kind:'qwen-ready',version:1,seq:0});
 for(const [index,stage] of receipt.stages.entries())w.emit({kind:'qwen-progress',version:1,seq:index+1,stage:stage.stage,elapsedMs:1});
 w.emit({kind:'qwen-result',version:1,seq:9,receipt});assert.equal(f.updates.at(-1).code,'WORKER_PROTOCOL_ERROR');assert.equal(w.terminations,1);
});
test('authored diagnostic registry exactly matches the independent production pin specification',()=>{assert.deepEqual(JSON.parse(readFileSync(new URL('../acceptance/generator-probe-assets.json',import.meta.url))),registry());});
for(const [name,body] of [['oversize',new Uint8Array(32769)],['invalid UTF8',new Uint8Array([255])],['invalid JSON',new TextEncoder().encode('{')]])test('bounded registry reader refuses '+name+' before preparing assets',async()=>{const f=fixture();let prepared=false;f.options.fetch=async()=>new Response(body);f.options.prepare=()=>{prepared=true;};await assert.rejects(runGeneratorProbe(f.options),errorCode('ASSET_INTEGRITY_ERROR'));assert.equal(prepared,false);});
test('registry rejects a redirect before preparing assets',async()=>{const f=fixture();let prepared=false;f.options.fetch=async()=>Object.defineProperty(new Response(JSON.stringify(registry())),'redirected',{value:true});f.options.prepare=()=>{prepared=true;};await assert.rejects(runGeneratorProbe(f.options),errorCode('ASSET_INTEGRITY_ERROR'));assert.equal(prepared,false);});
test('a late verified-cache handle is closed after cancellation',async()=>{const controller=new AbortController(),late=deferred(),entered=deferred(),f=fixture({signal:controller.signal});f.options.prepare=()=>{entered.resolve();return late.promise;};const pending=runGeneratorProbe(f.options);await entered.promise;controller.abort();await assert.rejects(pending,errorCode('ABORTED'));late.resolve(f.prepared);await tick();assert.equal(f.calls.closed,1);assert.equal(f.calls.load,0);});
test('success awaits asynchronous model disposal before committing a receipt',async()=>{const disposal=deferred(),entered=deferred(),f=fixture();let settled=false;f.model.dispose=()=>{entered.resolve();return disposal.promise;};const pending=runGeneratorProbe(f.options).then(value=>{settled=true;return value;});await entered.promise;assert.equal(settled,false);assert.equal(f.calls.closed,0);disposal.resolve();assert.equal((await pending).cleanup.modelDisposed,true);assert.equal(f.calls.destroyed,1);});
test('model disposal failure refuses successful receipt and still releases cache/device',async()=>{const f=fixture();f.model.dispose=async()=>{throw Error('secret');};await assert.rejects(runGeneratorProbe(f.options),errorCode('GENERATION_FAILED'));assert.equal(f.calls.closed,1);assert.equal(f.calls.destroyed,1);});
test('SDK read completion must settle before cleanup and accepted output',async()=>{const reads=deferred(),entered=deferred(),f=fixture();let settled=false;f.prepared.finishReads=()=>{entered.resolve();return reads.promise;};const pending=runGeneratorProbe(f.options).then(value=>{settled=true;return value;});await entered.promise;assert.equal(settled,false);assert.equal(f.calls.closed,0);reads.resolve({reads:5,verifiedBytes:800000000});await pending;assert.equal(f.calls.closed,1);});
test('parent saved queued callbacks cannot commit after cancellation',async()=>{const receipt=await runGeneratorProbe(fixture().options),f=hostFixture();f.host.run();const w=f.workers[0],receive=w.listeners.get('message');w.emit({kind:'qwen-ready',version:1,seq:0});f.host.cancel();const count=f.updates.length;receive({data:{kind:'qwen-result',version:1,seq:1,receipt}});assert.equal(f.updates.length,count);assert.equal(f.updates.at(-1).status,'cancelled');});
test('parent error and messageerror retire their worker without an automatic retry',()=>{for(const type of ['error','messageerror']){const f=hostFixture();f.host.run();f.workers[0].listeners.get(type)({message:'secret'});assert.equal(f.updates.at(-1).code,'WORKER_PROTOCOL_ERROR');assert.equal(f.workers[0].terminations,1);assert.equal(f.workers.length,1);}});
test('malformed result fields are refused without decoding or displaying them',async()=>{const receipt=await runGeneratorProbe(fixture().options);for(const mutate of [r=>r.text='x'.repeat(1025),r=>r.extra='secret',r=>r.cleanup.modelDisposed=false,r=>r.generatedTokenIds=[5],r=>r.preflight.generationMode='actual-run']){const r=structuredClone(receipt);mutate(r);assert.throws(()=>copyProbeReceipt(r),errorCode('WORKER_PROTOCOL_ERROR'));}});
test('receipt copy refuses a valid alternative preflight and matching inspection instead of rewriting the budget',async()=>{
 const receipt=structuredClone(await runGeneratorProbe(fixture().options));
 receipt.preflight=preflightGeneration(IDS,{contextWindowTokens:80,maxNewTokens:16});
 receipt.inspection=inspectGeneratedSequence([...IDS,...receipt.generatedTokenIds],receipt.preflight);
 assert.throws(()=>copyProbeReceipt(receipt),errorCode('WORKER_PROTOCOL_ERROR'));
});
test('parent refuses a result with an alternative preflight even when its EOS inspection matches',async()=>{
 const receipt=structuredClone(await runGeneratorProbe(fixture().options));
 receipt.preflight=preflightGeneration(IDS,{contextWindowTokens:80,maxNewTokens:16});
 receipt.inspection=inspectGeneratedSequence([...IDS,...receipt.generatedTokenIds],receipt.preflight);
 const f=hostFixture();f.host.run();const w=f.workers[0];w.emit({kind:'qwen-ready',version:1,seq:0});
 for(const [index,stage] of receipt.stages.entries())w.emit({kind:'qwen-progress',version:1,seq:index+1,...stage});
 w.emit({kind:'qwen-result',version:1,seq:9,receipt});
 assert.equal(f.updates.at(-1).status,'error');assert.equal(f.updates.at(-1).code,'WORKER_PROTOCOL_ERROR');
 assert.equal(w.terminations,1);assert.equal(f.timers.size,0);
});
test('runtime exposes bounded actual C2 prepare counters including the final verified graph bytes',async()=>{
 const progress=[],f=fixture({onByteProgress:event=>progress.push(event)});await runGeneratorProbe(f.options);
 assert.equal(progress.length,16);assert.deepEqual(progress[9],{stage:'prepare',assetIndex:4,receivedBytes:786156820,verifiedBytes:786156820,totalBytes:786156820,elapsedMs:0});
 assert.deepEqual(progress.at(-1),{stage:'prepare',assetIndex:7,receivedBytes:21596019,verifiedBytes:21596019,totalBytes:21596019,elapsedMs:0});
 assert.equal(progress.every(event=>Object.keys(event).length===6&&Object.isFrozen(event)),true);
});
test('worker emits a separate bounded byte event without changing its eight stage entry receipts',async()=>{
 const receipt=await runGeneratorProbe(fixture().options),packets=[];
 await createProbeCommandHandler(packet=>packets.push(packet),{run:async options=>{
   options.onProgress('adapter',0);options.onProgress('assets',0);
   options.onByteProgress({stage:'prepare',assetIndex:0,receivedBytes:0,verifiedBytes:0,totalBytes:678,elapsedMs:0});
   options.onByteProgress({stage:'prepare',assetIndex:0,receivedBytes:678,verifiedBytes:678,totalBytes:678,elapsedMs:0});
   for(const stage of receipt.stages.slice(2))options.onProgress(stage.stage,stage.elapsedMs);
   return receipt;
 }})({kind:'qwen-smoke',version:1});
 assert.deepEqual(packets[2],{kind:'qwen-bytes',version:1,seq:3,stage:'prepare',assetIndex:0,receivedBytes:0,verifiedBytes:0,totalBytes:678,elapsedMs:0});
 assert.equal(packets.filter(packet=>packet.kind==='qwen-progress').length,8);assert.equal(packets.at(-1).kind,'qwen-result');
});
test('parent shows prepared and SDK-read bytes independently and cancel revokes further byte commits',()=>{
 const f=hostFixture();f.host.run();const w=f.workers[0];w.emit({kind:'qwen-ready',version:1,seq:0});w.emit({kind:'qwen-progress',version:1,seq:1,stage:'adapter',elapsedMs:0});w.emit({kind:'qwen-progress',version:1,seq:2,stage:'assets',elapsedMs:0});
 w.emit({kind:'qwen-bytes',version:1,seq:3,stage:'prepare',assetIndex:0,receivedBytes:0,verifiedBytes:0,totalBytes:678,elapsedMs:0});
 w.emit({kind:'qwen-bytes',version:1,seq:4,stage:'prepare',assetIndex:0,receivedBytes:678,verifiedBytes:678,totalBytes:678,elapsedMs:0});
 assert.equal(f.updates.at(-1).status,'working');assert.equal(f.updates.at(-1).byteProgress.stage,'prepare');
 w.emit({kind:'qwen-progress',version:1,seq:5,stage:'sdk',elapsedMs:0});w.emit({kind:'qwen-progress',version:1,seq:6,stage:'tokenizer',elapsedMs:0});
 w.emit({kind:'qwen-bytes',version:1,seq:7,stage:'consume',assetIndex:0,receivedBytes:0,verifiedBytes:0,totalBytes:678,elapsedMs:0});
 assert.equal(f.updates.at(-1).byteProgress.stage,'consume');f.host.cancel();assert.equal(w.terminations,1);assert.equal(f.updates.at(-1).status,'cancelled');
});
test('C2 callback remains active for actual SDK-read phase after preparation counters complete',async()=>{
 const progress=[],f=fixture({onByteProgress:event=>progress.push(event)}),prepare=f.options.prepare;let callback;
 f.options.prepare=(plan,options)=>{callback=options.onProgress;return prepare(plan,options);};
 const generate=f.model.generate;
 f.model.generate=options=>{
  callback({stage:'consume',assetIndex:4,completed:0,total:786156820,unit:'bytes',estimated:false,verified:false});
  callback({stage:'consume',assetIndex:4,completed:786156820,total:786156820,unit:'bytes',estimated:false,verified:true});
  return generate(options);
 };
 const receipt=await runGeneratorProbe(f.options);
 assert.equal(progress.filter(event=>event.stage==='prepare').length,16);assert.equal(progress.filter(event=>event.stage==='consume').length,2);
 assert.deepEqual(progress.at(-1),{stage:'consume',assetIndex:4,receivedBytes:786156820,verifiedBytes:786156820,totalBytes:786156820,elapsedMs:0});
 assert.equal(receipt.cachePreparation.verifiedBytes,815725938);
});
test('intermediate byte counters are throttled while every read start and verified final survives',async()=>{
 let now=0;const progress=[],f=fixture({now:()=>now,onByteProgress:event=>progress.push(event)});
 f.options.prepare=async(plan,options)=>{
   for(const [assetIndex,asset] of plan.assets.entries()){
     const emit=(completed,verified=false)=>options.onProgress({stage:'prepare',assetIndex,completed,total:asset.bytes,unit:'bytes',estimated:false,verified});
     emit(0);if(assetIndex===4){now=50;emit(100);now=100;emit(200);now=125;emit(300);now=150;emit(400);}emit(asset.bytes,true);
   }
   return f.prepared;
 };
 await runGeneratorProbe(f.options);const graph=progress.filter(event=>event.assetIndex===4);
 assert.deepEqual(graph.map(event=>event.receivedBytes),[0,200,786156820]);assert.equal(graph.at(-1).verifiedBytes,786156820);
});
test('malformed byte fields and false verification are refused before parent display',()=>{
 const valid={stage:'prepare',assetIndex:0,receivedBytes:0,verifiedBytes:0,totalBytes:678,elapsedMs:0};
 for(const mutate of [v=>v.extra='secret',v=>v.totalBytes++,v=>v.assetIndex=8,v=>v.receivedBytes=679,v=>v.verifiedBytes=1,v=>v.verifiedBytes=678,v=>v.elapsedMs=300001]){
   const value={...valid};mutate(value);assert.throws(()=>copyProbeByteProgress(value),errorCode('WORKER_PROTOCOL_ERROR'));
 }
 const f=hostFixture();f.host.run();const w=f.workers[0];w.emit({kind:'qwen-ready',version:1,seq:0});w.emit({kind:'qwen-progress',version:1,seq:1,stage:'adapter',elapsedMs:0});w.emit({kind:'qwen-progress',version:1,seq:2,stage:'assets',elapsedMs:0});
 w.emit({kind:'qwen-bytes',version:1,seq:3,...valid,verifiedBytes:678});assert.equal(f.updates.at(-1).code,'WORKER_PROTOCOL_ERROR');assert.equal(w.terminations,1);
});
test('cancel during observed preparation bytes prevents further runtime and model commits',async()=>{
 const controller=new AbortController(),progress=[],f=fixture({signal:controller.signal,onByteProgress(event){progress.push(event);controller.abort();}});
 await assert.rejects(runGeneratorProbe(f.options),errorCode('ABORTED'));assert.equal(progress.length,1);assert.equal(f.calls.load,0);
});
test('raw C2 verification flag cannot mark a zero-byte incomplete body as verified',async()=>{
 const f=fixture(),prepare=f.options.prepare;f.options.prepare=(plan,options)=>{
   options.onProgress({stage:'prepare',assetIndex:0,completed:0,total:678,unit:'bytes',estimated:false,verified:true});
   return prepare(plan,options);
 };
 await assert.rejects(runGeneratorProbe(f.options),errorCode('WORKER_PROTOCOL_ERROR'));assert.equal(f.calls.load,0);
});
test('actual DOM mount survives persisted pagehide and restore with fresh Run and repeated cancellation',async t=>{
 const ids=['run-probe','cancel-probe','probe-status','probe-detail','probe-output','probe-receipt','probe-progress','probe-ids','probe-model','probe-revision'];
 class Element extends EventTarget {
   constructor(){super();this.disabled=false;this.hidden=false;this.textContent='';}
   click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
 }
 const elements=new Map(ids.map(id=>[id,new Element()])),windowEvents=new EventTarget(),workers=[];
 class OwnedWorker {
   constructor(){this.listeners=new Map();this.terminations=0;workers.push(this);}
   addEventListener(type,listener){this.listeners.set(type,listener);}
   removeEventListener(type,listener){if(this.listeners.get(type)===listener)this.listeners.delete(type);}
   postMessage(command){assert.deepEqual(command,{kind:'qwen-smoke',version:1});}
   terminate(){this.terminations++;}
   ready(){this.listeners.get('message')?.({data:{kind:'qwen-ready',version:1,seq:0}});}
 }
 const original=Object.fromEntries(['document','Worker','addEventListener'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 t.after(()=>{
   for(const worker of workers)worker.listeners.get('error')?.({});
   for(const [key,descriptor] of Object.entries(original)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 });
 globalThis.document={getElementById:id=>elements.get(id)};
 globalThis.Worker=OwnedWorker;
 globalThis.addEventListener=windowEvents.addEventListener.bind(windowEvents);
 const hide=()=>windowEvents.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));
 const show=()=>windowEvents.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));
 await import(new URL('../acceptance/generator-probe.mjs?mounted-page-lifecycle',import.meta.url));
 const run=elements.get('run-probe'),status=elements.get('probe-status'),receipt=elements.get('probe-receipt');
 run.click();assert.equal(workers.length,1);const first=workers[0],oldReceive=first.listeners.get('message');first.ready();
 hide();assert.equal(first.terminations,1);assert.equal(run.disabled,false);assert.equal(status.textContent,'Cancelled');
 const cancelledReceipt=receipt.textContent;oldReceive({data:{kind:'qwen-result',version:1,seq:1,receipt:{text:'late secret'}}});
 assert.equal(receipt.textContent,cancelledReceipt);
 show();run.click();assert.equal(workers.length,2,'restored page Run must create a fresh owned worker');
 const second=workers[1],secondReceive=second.listeners.get('message');second.ready();hide();
 assert.equal(second.terminations,1,'each pagehide must cancel the current worker');assert.equal(second.listeners.size,0);
 assert.equal(run.disabled,false);assert.equal(status.textContent,'Cancelled');
 secondReceive({data:{kind:'qwen-result',version:1,seq:1,receipt:{text:'another late secret'}}});
 assert.equal(receipt.textContent,cancelledReceipt);assert.equal(workers.length,2);
});
