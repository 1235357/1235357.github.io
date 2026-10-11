import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPageRecord } from '../pdf-source.mjs';
import { chunkSource } from '../chunking.mjs';
import { EMBEDDING_SPEC } from '../embedding-contract.mjs';
import { projectEmbeddingInput } from '../embedding-source.mjs';
import { copyQueryPassages, copyQueryResult, queryResultReceipt } from '../query-source.mjs';
import { rankCandidates } from '../retrieval.mjs';
import { assembleProvenanceContext } from '../context-contract.mjs';
import { prepareGenerationPrompt } from '../prompt-contract.mjs';
import { preflightGeneration } from '../generator-contract.mjs';

// Real provenance/parser/chunker/ranker contracts and controlled SDK resources.
// These unit boundaries establish no GPU execution or financial correctness.
const runtime = await import('../financial-generator-runtime.mjs').catch(() => ({}));
const core = await import('../generator-native-core.mjs').catch(() => ({}));
const BASE = 'http://127.0.0.1:8766/browser-rag/';
const MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
const REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e';
const SHA = 'a'.repeat(64), QUESTION = '  財報 PRIVATE_QUESTION 😀\n  ';
const vector = axis => Array.from({length:384}, (_, index) => index === axis ? 1 : 0);
const registry = () => JSON.parse(readFileSync(new URL('../acceptance/generator-probe-assets.json', import.meta.url)));
const deferred = () => { let resolve; const promise = new Promise(yes => {resolve=yes;}); return {promise,resolve}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const code = expected => error => { assert.equal(error.code,expected); assert.equal(/PRIVATE|secret|http/.test(error.message),false); return true; };
function frozen(value) {
  if(value === null || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value),true);
  for(const child of Object.values(value)) frozen(child);
}
function contextInput(pages = [['  PRIVATE_ALPHA\n😀\t  ', '', '尾  '], ['PRIVATE_BETA']]) {
  const parser = {name:'pdfjs',version:'6.4.299',policyVersion:'text-items-v1',disableNormalization:true};
  const source = {schemaVersion:1,status:'extracted-not-indexed',source:{sha256:SHA,name:'PRIVATE.pdf',size:1002},
    parser,numPages:pages.length,workerMode:'node-fake',pages:pages.map((strings,index) => createPageRecord({
      sourceSha256:SHA,parserVersion:parser.version,physicalPageNumber:index+1,pageLabel:index===0?null:'i',
      page:{view:[0,0,612,792],rotate:0,userUnit:1},textContent:{items:strings.map(str => ({str,dir:'ltr',
        transform:[1,0,0,1,30,740],width:120,height:12,fontName:'f1',hasEOL:false}))}}))};
  const chunkArtifact = chunkSource(source,{maxChunkUtf16:4096,overlapUtf16:0});
  const projection = projectEmbeddingInput(chunkArtifact),count=projection.chunks.length;
  const embeddingArtifact = {schemaVersion:1,status:'embedded-not-retrieved',sourceSha256:SHA,
    representationId:EMBEDDING_SPEC.version,representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',
    chunkIds:projection.chunks.map(chunk=>chunk.id),tokenIds:projection.chunks.map(()=>[101,42,102]),
    vectors:projection.chunks.map((_,index)=>vector(index)),counts:{chunks:count,totalTokens:count*3,dimensions:384},
    receipt:{verifiedBytes:200,networkBytes:150,cacheBytes:50,elapsedMs:2}};
  const query = {schemaVersion:1,status:'query-embedded-not-retrieved',representationId:EMBEDDING_SPEC.version,
    representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',tokenIds:[101,44,102],vector:vector(1),
    counts:{totalTokens:3,dimensions:384},receipt:{verifiedBytes:100,networkBytes:70,cacheBytes:30,elapsedMs:1}};
  const passages=copyQueryPassages(embeddingArtifact,projection),topK=count;
  const queryResult = {query,retrieval:rankCandidates(projection,passages,
    {representationId:query.representationId,representation:query.representation,vector:query.vector},{topK})};
  const queryMetadata=queryResultReceipt(queryResult);
  copyQueryResult(queryResult,projection,passages,topK,100,queryMetadata);
  return structuredClone({source,chunkArtifact,embeddingArtifact,question:QUESTION,queryResult,
    topK,queryDownloadTotal:100,queryMetadata});
}
function sdkFixture({length=23,suffix=[5,151645],text='{"answer":"unverified","citations":["E2"],"insufficient_evidence":false}'}={}) {
  const calls={adapter:0,assets:0,tokenizer:0,load:0,generate:0,decode:[],tensors:[],disposed:0,modelDisposed:0,closed:0,destroyed:0,stages:[]};
  const ids=Array.from({length},(_,index)=>index+10),mask=ids.map(()=>1),lost=deferred(),listeners=new Map();
  const device={lost:lost.promise,addEventListener(type,listener){listeners.set(type,listener);},
    removeEventListener(type,listener){if(listeners.get(type)===listener)listeners.delete(type);},destroy(){calls.destroyed++;}};
  const adapter={get info(){assert.equal(this,adapter);return {isFallbackAdapter:false};},
    requestDevice(){assert.equal(this,adapter);return device;}};
  function tokenizer(prompt,options){calls.prompt=prompt;assert.deepEqual(options,
    {add_special_tokens:false,padding:false,truncation:false,return_tensor:false});return {input_ids:ids,attention_mask:mask};}
  tokenizer.apply_chat_template=function(messages,options){assert.equal(this,tokenizer);calls.messages=messages;
    assert.deepEqual(options,{tokenize:false,add_generation_prompt:true});
    return `<|im_start|>system\n${messages[0].content}<|im_end|>\n<|im_start|>user\n${messages[1].content}<|im_end|>\n<|im_start|>assistant\n`;};
  tokenizer.decode=(generated,options)=>{calls.decode.push([...generated]);assert.deepEqual(options,{skip_special_tokens:true});return text;};
  class Tensor {
    constructor(type,data,dims){Object.assign(this,{type,data,dims});calls.tensors.push(this);}
    dispose(){calls.disposed++;}
  }
  const model={async generate(options){calls.generate++;calls.options=options;
    const sequence=[...options.input_ids.data,...suffix.map(BigInt)];return new Tensor('int64',BigInt64Array.from(sequence),[1,sequence.length]);},
    async dispose(){calls.modelDisposed++;}};
  const library={env:{backends:{onnx:{wasm:{},webgpu:{}}}},Tensor,
    AutoTokenizer:{async from_pretrained(id,options){calls.tokenizer++;assert.equal(id,MODEL);
      assert.deepEqual(options,{revision:REVISION,local_files_only:true});return tokenizer;}},
    AutoModelForCausalLM:{async from_pretrained(id,options){calls.load++;assert.equal(id,MODEL);assert.deepEqual(options,
      {revision:REVISION,local_files_only:true,device:'webgpu',dtype:'q4',use_external_data_format:false,session_options:{executionProviders:['webgpu']}});
      await library.env.backends.onnx.webgpu.adapter.requestDevice({requiredFeatures:[]});return model;}}};
  const assets=Object.values({...registry().modelFiles,...registry().runtimeFiles}).reduce((sum,pin)=>sum+pin.bytes,0);
  const prepared={cache:{},receipt:{assets:8,verifiedBytes:assets,networkBytes:0,cacheBytes:assets},
    async finishReads(){return {reads:5,verifiedBytes:800000000};},close(){calls.closed++;}};
  const options={baseURL:BASE,gpu:{async requestAdapter(){calls.adapter++;return adapter;}},cacheStorage:{open(){}},
    async fetch(url){assert.equal(url,BASE+'acceptance/generator-probe-assets.json');return new Response(JSON.stringify(registry()));},
    async prepare(plan,options){calls.assets++;for(const [assetIndex,asset] of plan.assets.entries()) {
      options.onProgress({stage:'prepare',assetIndex,completed:0,total:asset.bytes,unit:'bytes',estimated:false,verified:false});
      options.onProgress({stage:'prepare',assetIndex,completed:asset.bytes,total:asset.bytes,unit:'bytes',estimated:false,verified:true});
    } return prepared;},async importer(url){assert.equal(url,BASE+'vendor/transformers/transformers.min.js');return library;},
    now:()=>1,onProgress:stage=>calls.stages.push(stage)};
  return {calls,ids,mask,device,adapter,lost,listeners,tokenizer,Tensor,model,library,prepared,options};
}
function run(input,options,sdk) {
  assert.equal(typeof runtime.runFinancialGenerator,'function','runFinancialGenerator export');
  return runtime.runFinancialGenerator(input,options,sdk);
}

test('financial entry exports a bounded decoded text policy',()=>{
  assert.equal(typeof runtime.runFinancialGenerator,'function');assert.equal(runtime.FINANCIAL_MAX_DECODED_UTF16,16384);
});
for(const length of [23,71]) test(`complete financial prompt drives dynamic native tensors at ${length} tokens`,async()=>{
  const input=contextInput(),f=sdkFixture({length}),options={maxNewTokens:17};
  const expected=prepareGenerationPrompt(input,f.tokenizer,options),receipt=await run(input,options,f.options);
  assert.equal(receipt.status,'native-generation-complete-uninspected');assert.equal(receipt.generationMode,'native-run');
  assert.equal(receipt.outputInspection,'not-run');assert.equal(receipt.financialCorrectness,'unestablished');
  assert.deepEqual(receipt.preparedPrompt,expected);assert.deepEqual(receipt.preparedPrompt.context,assembleProvenanceContext(input));
  assert.equal(receipt.preparedPrompt.context.question,QUESTION);
  assert.deepEqual(JSON.parse(receipt.preparedPrompt.messages[1].content),receipt.preparedPrompt.modelInput);
  assert.deepEqual(receipt.preparedPrompt.modelInput.evidence.map(unit=>unit.text),receipt.preparedPrompt.context.evidenceUnits.map(unit=>unit.text));
  assert.equal(receipt.preparedPrompt.preflight.generationMode,'not-run');assert.equal(receipt.inspection.generationMode,'not-run');
  assert.deepEqual(f.calls.options.input_ids.dims,[1,length]);assert.deepEqual(f.calls.options.attention_mask.dims,[1,length]);
  assert.deepEqual([...f.calls.options.input_ids.data],f.ids.map(BigInt));assert.deepEqual([...f.calls.options.attention_mask.data],Array(length).fill(1n));
  assert.deepEqual(f.calls.options.generation_config,expected.preflight.settings);assert.equal(Object.keys(f.calls.options.generation_config).length,46);
  assert.notEqual(f.calls.options.generation_config.eos_token_id,receipt.preflight.settings.eos_token_id);
  assert.notEqual(f.calls.options.generation_config.generation_kwargs,receipt.preflight.settings.generation_kwargs);
  assert.equal(f.calls.options.generation_config.max_length,length+17);assert.deepEqual(f.calls.decode,[[5,151645]]);
  assert.deepEqual(receipt.generatedTokenIds,[5,151645]);assert.equal(receipt.inspection.termination,'eos');
  assert.equal(receipt.modelId,MODEL);assert.equal(receipt.revision,REVISION);assert.equal(receipt.device,'webgpu');assert.equal(receipt.dtype,'q4');
  assert.deepEqual(receipt.stages.map(entry=>entry.stage),['adapter','assets','sdk','tokenizer','model','generate','reads','cleanup']);
  assert.deepEqual(receipt.cleanup,{inputsDisposed:2,resultDisposed:true,modelDisposed:true,cacheClosed:true,devicesDestroyed:1});
  assert.equal(f.calls.disposed,3);assert.equal(f.calls.modelDisposed,1);assert.equal(f.calls.destroyed,1);assert.equal(f.listeners.size,0);
  assert.equal(f.library.env.allowRemoteModels,false);assert.equal(f.library.env.useBrowserCache,false);assert.equal(f.library.env.useFSCache,false);
  frozen(receipt);assert.equal(Object.isFrozen(input),false);
});
test('length termination is retained only as raw uninspected native output',async()=>{
  const f=sdkFixture({suffix:[5,6,7]});const result=await run(contextInput(),{maxNewTokens:3},f.options);
  assert.equal(result.inspection.termination,'length');assert.equal(result.status,'native-generation-complete-uninspected');
  assert.equal(result.outputInspection,'not-run');assert.equal(result.financialCorrectness,'unestablished');
});
test('full decoded JSON text survives below the explicit cap without truncation',async()=>{
  const text=' {"answer":"'+ 'a'.repeat(1100)+'","citations":[],"insufficient_evidence":true} \n';
  assert.equal((await run(contextInput(),{},sdkFixture({text}).options)).text,text);
});
for(const [name,mutate] of [
  ['assembled context',()=>assembleProvenanceContext(contextInput())],['extra field',v=>{v.extra='secret';return v;}],
  ['wrong source span',v=>{v.source.pages[0].textItems[0].span.quote='secret';return v;}],
  ['changed evidence',v=>{v.chunkArtifact.chunks[0].text='secret';return v;}],
  ['different rank',v=>{v.queryResult.retrieval.candidates.reverse();return v;}],
  ['wrong representation',v=>{v.embeddingArtifact.representationId='other';return v;}],
  ['wrong terminal metadata',v=>{v.queryMetadata.query.receipt.verifiedBytes++;return v;}],
  ['question over limit',v=>{v.question='x'.repeat(4097);return v;}],
]) test(`${name} provenance fails before the first native operation`,async()=>{
  const f=sdkFixture();await assert.rejects(async()=>run(mutate(contextInput()),{},f.options),code('INVALID_PROMPT_INPUT'));
  assert.equal(f.calls.adapter,0);assert.equal(f.calls.assets,0);assert.equal(f.calls.load,0);
});
for(const stage of ['assets','tokenizer']) test(`initial eight-field snapshot cannot be retargeted while awaiting ${stage}`,async()=>{
  const input=contextInput(),original=structuredClone(input),options={maxNewTokens:17},f=sdkFixture(),gate=deferred(),entered=deferred();
  const target=stage==='assets'?f.options:f.library.AutoTokenizer,key=stage==='assets'?'prepare':'from_pretrained',previous=target[key];
  target[key]=async(...args)=>{entered.resolve();await gate.promise;return previous(...args);};
  const result=run(input,options,f.options);await entered.promise;
  Object.assign(input,contextInput([['RETARGET_A'],['RETARGET_B']]));input.question='RETARGET_QUESTION';options.maxNewTokens=512;
  gate.resolve();const receipt=await result;
  assert.deepEqual(receipt.preparedPrompt.context,assembleProvenanceContext(original));assert.equal(receipt.preflight.maxNewTokens,17);
});
test('generation options are captured once before any await',async()=>{
  const f=sdkFixture(),options={};let reads=0;
  Object.defineProperty(options,'maxNewTokens',{enumerable:true,get(){reads++;return 19;}});
  const receipt=await run(contextInput(),options,f.options);assert.equal(reads,1);assert.equal(receipt.preflight.maxNewTokens,19);
});
test('ignored extractor and geometry extras remain unread while owning the bounded original source',async()=>{
  const input=contextInput(),f=sdkFixture();let reads=0;
  for(const value of [input.source,input.source.source,input.source.pages[0],input.source.pages[0].textItems[0],input.source.pages[0].textItems[0].span]) {
    Object.defineProperty(value,'ignored',{enumerable:true,get(){reads++;throw Error('PRIVATE ignored extra must remain unread');}});
  }
  input.source.pages[1].geometry=new Array(0xffffffff);
  const result=await run(input,{},f.options);assert.equal(reads,0);assert.equal(f.calls.load,1);
  assert.equal(result.preparedPrompt.context.question,QUESTION);
});
for(const options of [{maxNewTokens:0},{maxNewTokens:513},{contextWindowTokens:2049},{temperature:0}]) test('invalid generation policy fails before adapter '+JSON.stringify(options),async()=>{
  const f=sdkFixture();await assert.rejects(async()=>run(contextInput(),options,f.options),code('INVALID_GENERATION_CONFIG'));assert.equal(f.calls.adapter,0);
});
test('exact input plus output reservation overflow refuses model construction',async()=>{
  const f=sdkFixture({length:40});await assert.rejects(run(contextInput(),{contextWindowTokens:56,maxNewTokens:17},f.options),code('GENERATION_INPUT_LIMIT'));
  assert.equal(f.calls.load,0);assert.equal(f.calls.closed,1);
  const accepted=await run(contextInput(),{contextWindowTokens:57,maxNewTokens:17},sdkFixture({length:40}).options);
  assert.equal(accepted.preflight.settings.max_length,57);
});
for(const [name,mutate,expected] of [
  ['template mismatch',f=>f.tokenizer.apply_chat_template=()=>'<wrong private template>','INVALID_PROMPT_TOKENIZER'],
  ['mask mismatch',f=>f.mask[0]=0,'INVALID_PROMPT_FRAME'],
  ['invalid prompt ID',f=>f.ids[0]=151936,'GENERATION_INPUT_LIMIT'],
]) test(`${name} refuses graph creation`,async()=>{
  const f=sdkFixture();mutate(f);await assert.rejects(run(contextInput(),{},f.options),code(expected));assert.equal(f.calls.load,0);assert.equal(f.calls.closed,1);
});
for(const [name,alter] of [
  ['wrong dtype',f=>f.model.generate=async()=>new f.Tensor('float32',new Float32Array(25),[1,25])],
  ['wrong batch',f=>f.model.generate=async()=>({type:'int64',dims:[2,25],get data(){assert.fail('unbounded read');},dispose(){f.calls.disposed++;}})],
  ['oversize shape',f=>f.model.generate=async()=>({type:'int64',dims:[1,152],get data(){assert.fail('unbounded read');},dispose(){f.calls.disposed++;}})],
  ['wrong data type',f=>f.model.generate=async()=>new f.Tensor('int64',Array(25).fill(1),[1,25])],
  ['wrong prefix',f=>f.model.generate=async()=>new f.Tensor('int64',BigInt64Array.from([0,...f.ids.slice(1),5,151645],BigInt),[1,25])],
  ['invalid suffix ID',f=>f.model.generate=async()=>new f.Tensor('int64',BigInt64Array.from([...f.ids,151936,151645],BigInt),[1,25])],
  ['empty tokens',f=>f.model.generate=async()=>new f.Tensor('int64',BigInt64Array.from(f.ids,BigInt),[1,23])],
  ['incomplete tokens',f=>f.model.generate=async()=>new f.Tensor('int64',BigInt64Array.from([...f.ids,5],BigInt),[1,24])],
  ['empty decode',f=>f.tokenizer.decode=()=> ' \n '],
  ['overlong decode',f=>f.tokenizer.decode=()=> 'x'.repeat(16385)],
]) test(`${name} rejects output and confirms owned resource release`,async()=>{
  const f=sdkFixture();alter(f);await assert.rejects(run(contextInput(),{},f.options),code('INVALID_GENERATION_OUTPUT'));
  assert.equal(f.calls.closed,1);assert.equal(f.calls.destroyed,1);assert.equal(f.calls.modelDisposed,1);assert.equal(f.calls.disposed,3);
});
test('SDK nested setting mutation cannot mutate canonical receipt settings',async()=>{
  const f=sdkFixture(),generate=f.model.generate;
  f.model.generate=options=>{options.generation_config.eos_token_id[0]=5;options.generation_config.generation_kwargs.secret=true;return generate(options);};
  const receipt=await run(contextInput(),{},f.options);assert.deepEqual(receipt.preflight.settings.eos_token_id,[151645,151643]);
  assert.deepEqual(receipt.preflight.settings.generation_kwargs,{});
});
for(const [name,trigger,expected] of [
  ['lost',f=>f.lost.resolve({message:'secret'}),'GPU_DEVICE_LOST'],
  ['uncaptured',f=>f.listeners.get('uncapturederror')({message:'secret'}),'GPU_UNCAPTURED_ERROR'],
]) test(`device ${name} during generation cancels and disposes a late result`,async()=>{
  const f=sdkFixture(),gate=deferred(),entered=deferred();f.model.generate=()=>{entered.resolve();return gate.promise;};
  const result=run(contextInput(),{},f.options);await entered.promise;trigger(f);await assert.rejects(result,code(expected));
  gate.resolve(new f.Tensor('int64',BigInt64Array.from([...f.ids,5,151645],BigInt),[1,25]));await tick();
  assert.equal(f.calls.disposed,3);assert.equal(f.calls.modelDisposed,1);assert.equal(f.calls.closed,1);assert.equal(f.calls.destroyed,1);
});
for(const stage of ['assets','model','generate','device']) test(`abort while awaiting ${stage} releases late owned resources`,async()=>{
  const f=sdkFixture(),controller=new AbortController(),gate=deferred(),entered=deferred();f.options.signal=controller.signal;
  if(stage==='assets') f.options.prepare=()=>{entered.resolve();return gate.promise;};
  if(stage==='model') f.library.AutoModelForCausalLM.from_pretrained=()=>{entered.resolve();return gate.promise;};
  if(stage==='generate') f.model.generate=()=>{entered.resolve();return gate.promise;};
  if(stage==='device') f.adapter.requestDevice=()=>{entered.resolve();return gate.promise;};
  const result=run(contextInput(),{},f.options);await entered.promise;controller.abort();await assert.rejects(result,code('ABORTED'));
  gate.resolve(stage==='assets'?f.prepared:stage==='model'?f.model:stage==='device'?f.device:
    new f.Tensor('int64',BigInt64Array.from([...f.ids,5,151645],BigInt),[1,25]));await tick();
  if(stage==='assets') assert.equal(f.calls.closed,1);
  if(stage==='model') assert.equal(f.calls.modelDisposed,1);
  if(stage==='device') assert.equal(f.calls.destroyed,1);
  if(stage==='generate') {assert.equal(f.calls.disposed,3);assert.equal(f.calls.destroyed,1);assert.equal(f.calls.modelDisposed,1);}
});
test('shared core rejects an alternate valid preflight instead of rewriting token IDs or settings',async()=>{
  assert.equal(typeof core.runNativeGenerator,'function');const f=sdkFixture();
  const frame={tokenIds:f.ids,attentionMask:f.mask,preflight:preflightGeneration([...f.ids.slice(1),77],{maxNewTokens:17})};
  await assert.rejects(core.runNativeGenerator(()=>frame,f.options),code('TOKENIZER_MISMATCH'));assert.equal(f.calls.load,0);
});
test('shared core rejects changed canonical settings before model load',async()=>{
  assert.equal(typeof core.runNativeGenerator,'function');const f=sdkFixture();
  const preflight=structuredClone(preflightGeneration(f.ids,{maxNewTokens:17}));preflight.settings.temperature=0;
  await assert.rejects(core.runNativeGenerator(()=>({tokenIds:f.ids,attentionMask:f.mask,preflight}),f.options),code('TOKENIZER_MISMATCH'));
  assert.equal(f.calls.load,0);
});
