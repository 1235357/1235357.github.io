import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPageRecord } from '../pdf-source.mjs';
import { chunkSource } from '../chunking.mjs';
import { EMBEDDING_SPEC } from '../embedding-contract.mjs';
import { projectEmbeddingInput } from '../embedding-source.mjs';
import { copyQueryPassages, queryResultReceipt } from '../query-source.mjs';
import { rankCandidates } from '../retrieval.mjs';
import { runFinancialGenerator } from '../financial-generator-runtime.mjs';

const native = await import('../generator-native-core.mjs').catch(() => ({}));
const prompt = await import('../prompt-contract.mjs').catch(() => ({}));
const generation = await import('../generator-contract.mjs').catch(() => ({}));
const financial = await import('../financial-generator-contract.mjs').catch(() => ({}));
const SHA = 'a'.repeat(64), QUESTION = '  PRIVATE 財報 😀\uD800\n\t  ';
const vector = axis => Array.from({length:384}, (_, index) => index === axis ? 1 : 0);
function inputOf(strings = ['  PRIVATE_ALPHA\n😀\t  ', 'PRIVATE_BETA', 'PRIVATE_GAMMA'], topK = 2) {
  const parser = {name:'pdfjs',version:'6.4.299',policyVersion:'text-items-v1',disableNormalization:true};
  const source = {schemaVersion:1,status:'extracted-not-indexed',source:{sha256:SHA,name:'PRIVATE.pdf',size:1002},
    parser,numPages:strings.length,workerMode:'node-fake',pages:strings.map((str,index) => createPageRecord({
      sourceSha256:SHA,parserVersion:parser.version,physicalPageNumber:index+1,pageLabel:index===0?null:'i',
      page:{view:[0,0,612,792],rotate:0,userUnit:1},textContent:{items:[{str,dir:'ltr',
        transform:[1,0,0,1,30,740],width:120,height:12,fontName:'f1',hasEOL:false}]}}))};
  const chunkArtifact = chunkSource(source,{maxChunkUtf16:4096,overlapUtf16:0});
  const projection = projectEmbeddingInput(chunkArtifact), count = projection.chunks.length;
  const embeddingArtifact = {schemaVersion:1,status:'embedded-not-retrieved',sourceSha256:SHA,
    representationId:EMBEDDING_SPEC.version,representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',
    chunkIds:projection.chunks.map(chunk=>chunk.id),tokenIds:projection.chunks.map(()=>[101,42,102]),
    vectors:projection.chunks.map((_,index)=>vector(index)),counts:{chunks:count,totalTokens:count*3,dimensions:384},
    receipt:{verifiedBytes:200,networkBytes:150,cacheBytes:50,elapsedMs:2}};
  const query = {schemaVersion:1,status:'query-embedded-not-retrieved',representationId:EMBEDDING_SPEC.version,
    representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',tokenIds:[101,44,102],vector:vector(1),
    counts:{totalTokens:3,dimensions:384},receipt:{verifiedBytes:100,networkBytes:70,cacheBytes:30,elapsedMs:1}};
  const passages = copyQueryPassages(embeddingArtifact,projection);
  const queryResult = {query,retrieval:rankCandidates(projection,passages,
    {representationId:query.representationId,representation:query.representation,vector:query.vector},{topK})};
  return structuredClone({source,chunkArtifact,embeddingArtifact,question:QUESTION,queryResult,topK,
    queryDownloadTotal:100,queryMetadata:queryResultReceipt(queryResult)});
}

// Only the tokenizer and native SDK resources are declared doubles. The real
// parser, chunker, embedding/query copiers, ranker, prompt and native lifecycle
// produce the synthetic receipt; these tests establish no actual model run.
async function fixture({length=23,maxNewTokens=17,suffix=[5,151645],text=' {"answer":"invented $9 trillion","citations":["E2"],"insufficient_evidence":false}\n'}={}) {
  const input = inputOf(), options = {maxNewTokens};
  const ids = Array.from({length},(_,index)=>index+10);
  const device = {lost:new Promise(()=>{}),addEventListener(){},removeEventListener(){},destroy(){}};
  const adapter = {info:{isFallbackAdapter:false},requestDevice:()=>device};
  function tokenizer(){return {input_ids:ids,attention_mask:ids.map(()=>1)};}
  tokenizer.apply_chat_template = messages => `<|im_start|>system\n${messages[0].content}<|im_end|>\n<|im_start|>user\n${messages[1].content}<|im_end|>\n<|im_start|>assistant\n`;
  tokenizer.decode = () => text;
  class Tensor { constructor(type,data,dims){Object.assign(this,{type,data,dims});} dispose(){} }
  const model = {generate({input_ids}) {const sequence=[...input_ids.data,...suffix.map(BigInt)];
    return new Tensor('int64',BigInt64Array.from(sequence),[1,sequence.length]);},dispose(){}};
  const library = {env:{backends:{onnx:{wasm:{},webgpu:{}}}},Tensor,
    AutoTokenizer:{from_pretrained:()=>tokenizer},AutoModelForCausalLM:{async from_pretrained(){
      await library.env.backends.onnx.webgpu.adapter.requestDevice();return model;}}};
  const registry=JSON.parse(readFileSync(new URL('../acceptance/generator-probe-assets.json',import.meta.url)));
  const bytes=Object.values({...registry.modelFiles,...registry.runtimeFiles}).reduce((sum,pin)=>sum+pin.bytes,0);
  const receipt = await runFinancialGenerator(input,options,{baseURL:'http://127.0.0.1:8766/browser-rag/',
    gpu:{requestAdapter:()=>adapter},cacheStorage:{open(){}},fetch:()=>new Response(JSON.stringify(registry)),
    prepare:()=>({cache:{},receipt:{assets:8,verifiedBytes:bytes,networkBytes:0,cacheBytes:bytes},
      finishReads:()=>({reads:5,verifiedBytes:800000000}),close(){}}),importer:()=>library,now:()=>1});
  return {input,options,receipt:structuredClone(receipt)};
}
function financialCopy(value,input,options) {
  assert.equal(typeof financial.copyFinancialNativeReceipt,'function','copyFinancialNativeReceipt export');
  return financial.copyFinancialNativeReceipt(value,input,options);
}
function promptCopy(value,input,options) {
  assert.equal(typeof prompt.copyPreparedGenerationPrompt,'function','copyPreparedGenerationPrompt export');
  return prompt.copyPreparedGenerationPrompt(value,input,options);
}
function nativeOnly(receipt) {const {preparedPrompt,outputInspection,financialCorrectness,...value}=receipt;return value;}
function nativeCopy(value,preflight,cap) {
  assert.equal(typeof native.copyNativeGeneratorReceipt,'function','copyNativeGeneratorReceipt export');
  return native.copyNativeGeneratorReceipt(value,preflight,cap);
}
function fixedFinancial(error) {
  assert.equal(error.name,'FinancialGeneratorReceiptError');assert.equal(error.code,'INVALID_FINANCIAL_RECEIPT');
  assert.equal(error.message,'The financial generator receipt is invalid.');assert.equal(Object.hasOwn(error,'cause'),false);
  assert.equal(/PRIVATE|secret|http/.test(error.stack),false);return true;
}
const fixedNative = error => error.name==='ProbeError' && ['INVALID_PROBE_CONFIG','INVALID_GENERATION_OUTPUT','WORKER_PROTOCOL_ERROR'].includes(error.code)
  && !Object.hasOwn(error,'cause') && !/PRIVATE|secret|http/.test(error.message);
const fixedPrompt = error => error.name==='PromptError' && !Object.hasOwn(error,'cause') && !/PRIVATE|secret|http/.test(error.message);
function frozen(value) {if(value===null||typeof value!=='object')return;assert.equal(Object.isFrozen(value),true);for(const child of Object.values(value))frozen(child);}

test('the existing canonical preflight copier is reusable and owns all nested settings',async()=>{
  assert.equal(typeof generation.copyGenerationPreflight,'function','copyGenerationPreflight export');
  const {receipt}=await fixture(), raw=receipt.preflight, copy=generation.copyGenerationPreflight(raw);
  assert.deepEqual(copy,raw);frozen(copy);raw.settings.eos_token_id[0]=5;assert.deepEqual(copy.settings.eos_token_id,[151645,151643]);
});
test('complete receipt copy retains variable framing, Unicode, spans, all settings and raw invented output',async()=>{
  const {input,options,receipt}=await fixture({length:71});
  const copy=financialCopy(receipt,input,options);assert.deepEqual(copy,receipt);frozen(copy);
  assert.equal(copy.preparedPrompt.context.question,QUESTION);assert.equal(copy.preparedPrompt.context.evidenceUnits[0].segments.length>0,true);
  assert.equal(copy.promptTokenIds.length,71);assert.equal(Object.keys(copy.preflight.settings).length,46);
  assert.equal(copy.financialCorrectness,'unestablished');assert.equal(copy.outputInspection,'not-run');
  assert.equal(copy.text.includes('invented $9 trillion'),true);assert.equal(copy.generationMode,'native-run');
});
test('pure prepared copy retains not-run status and uses canonical owned body',async()=>{
  const {input,options,receipt}=await fixture();const copy=promptCopy(receipt.preparedPrompt,input,options);
  assert.deepEqual(copy,receipt.preparedPrompt);frozen(copy);assert.equal(copy.generationMode,'not-run');
  assert.equal(copy.tokenIds,copy.preflight.promptTokenIds);assert.notEqual(copy.context,receipt.preparedPrompt.context);
});
test('copy detaches without freezing caller records or repairing them',async()=>{
  const {input,options,receipt}=await fixture(),copy=financialCopy(receipt,input,options),before=structuredClone(copy);
  input.question='changed';input.source.source.name='changed';receipt.preparedPrompt.messages[0].content='changed';
  receipt.generatedTokenIds[0]=9;receipt.cleanup.cacheClosed=false;receipt.preflight.settings.eos_token_id[0]=5;options.maxNewTokens=512;
  assert.deepEqual(copy,before);for(const value of [input,input.source,receipt,receipt.preparedPrompt,options])assert.equal(Object.isFrozen(value),false);
});
for(const [name,change] of [
  ['raw question',v=>{v.question=v.question.trim();}],['source name',v=>{v.source.source.name='other.pdf';}],
  ['selected quote',v=>{v.source.pages[1].textItems[0].span.quote='changed';}],['topK',v=>{v.topK=1;}],
])test(`complete copy rejects changed original ${name}`,async()=>{const {input,options,receipt}=await fixture();change(input);assert.throws(()=>financialCopy(receipt,input,options),fixedFinancial);});
test('an independently valid replacement source cannot retarget an old receipt',async()=>{
  const {options,receipt}=await fixture();const changed=inputOf(['new quote','different selected quote','tail']);
  assert.throws(()=>financialCopy(receipt,changed,options),fixedFinancial);
});
test('original input must retain the exact eight-field contract',async()=>{
  const {input,options,receipt}=await fixture();input.extra='PRIVATE';assert.throws(()=>financialCopy(receipt,input,options),fixedFinancial);
  assert.throws(()=>financialCopy(receipt,receipt.preparedPrompt.context,options),fixedFinancial);
});
for(const [name,change] of [
  ['tokenizer identity',v=>{v.tokenizer.revision='other';}],['model data',v=>{v.modelInput.evidence[0].text='changed';}],
  ['context quote',v=>{v.context.evidenceUnits[0].text='changed';}],['context segment',v=>{v.context.evidenceUnits[0].segments[0].startUtf16++;}],
  ['messages',v=>{v.messages[1].content='changed';}],['rendered frame',v=>{v.renderedPrompt+=' ';}],
  ['IDs',v=>{v.tokenIds=[99,...v.tokenIds.slice(1)];}],['mask',v=>{v.attentionMask[0]=0;}],['preflight setting',v=>{v.preflight.settings.temperature=0;}],
  ['preflight nested EOS',v=>{v.preflight.settings.eos_token_id.reverse();}],['nested generation',v=>{v.preflight.generation.libraryVersion='other';}],
  ['unknown nested option',v=>{v.preflight.settings.generation_kwargs.extra='PRIVATE';}],['prepared status',v=>{v.generationMode='native-run';}],
  ['extra prepared field',v=>{v.extra='PRIVATE';}],
])test(`prepared copy rejects altered ${name}`,async()=>{const {input,options,receipt}=await fixture();change(receipt.preparedPrompt);
  assert.throws(()=>promptCopy(receipt.preparedPrompt,input,options),fixedPrompt);assert.throws(()=>financialCopy(receipt,input,options),fixedFinancial);});
for(const [name,change] of [
  ['native prompt prefix',v=>{v.promptTokenIds[0]=99;}],['full inspected prefix',v=>{v.inspection.sequenceIds[0]=99;}],
  ['inspected generated suffix',v=>{v.inspection.generatedTokenIds[0]=99;}],['empty suffix',v=>{v.generatedTokenIds=[];}],
  ['incomplete suffix',v=>{v.generatedTokenIds=[5];}],['interior EOS',v=>{v.generatedTokenIds=[151645,5,151643];}],
  ['termination',v=>{v.inspection.termination='length';}],['model pin',v=>{v.modelId='other';}],['revision pin',v=>{v.revision='other';}],
  ['device',v=>{v.device='cpu';}],['native nested setting',v=>{v.preflight.settings.generation_kwargs.extra=1;}],
  ['byte receipt',v=>{v.cachePreparation.verifiedBytes--;}],['SDK reads',v=>{v.sdkReads.reads=0;}],
  ['stage ordering',v=>{v.stages.reverse();}],['cleanup',v=>{v.cleanup.resultDisposed=false;}],
  ['output status',v=>{v.outputInspection='accepted';}],['truth status',v=>{v.financialCorrectness='established';}],
  ['extra envelope field',v=>{v.extra='PRIVATE';}],
])test(`complete copy rejects altered ${name}`,async()=>{const {input,options,receipt}=await fixture();change(receipt);
  assert.throws(()=>financialCopy(receipt,input,options),fixedFinancial);});
test('native copier rejects altered expected canonical preflight settings',async()=>{
  const {receipt}=await fixture(),expected=structuredClone(receipt.preflight);expected.settings.eos_token_id[0]=5;
  assert.throws(()=>nativeCopy(nativeOnly(receipt),expected),fixedNative);
});
test('length termination remains full raw uninspected output',async()=>{
  const {input,options,receipt}=await fixture({maxNewTokens:3,suffix:[5,6,7]});
  const copy=financialCopy(receipt,input,options);assert.equal(copy.inspection.termination,'length');assert.deepEqual(copy.generatedTokenIds,[5,6,7]);
  assert.equal(copy.outputInspection,'not-run');assert.equal(copy.financialCorrectness,'unestablished');
});
test('decoded text retains the exact 16384 UTF16 boundary and rejects one additional unit',async()=>{
  const text=' \t😀'+ 'x'.repeat(16379)+'\n',f=await fixture({text});assert.equal(text.length,16384);
  assert.equal(financialCopy(f.receipt,f.input,f.options).text,text);f.receipt.text+='x';
  assert.throws(()=>financialCopy(f.receipt,f.input,f.options),fixedFinancial);
});
test('configured native decoded cap fails before any receipt or preflight read',()=>{
  const raw=new Proxy({}, {get(){assert.fail('receipt read');},getPrototypeOf(){assert.fail('receipt reflection');}});
  for(const cap of [0,16385,1.5,null,NaN])assert.throws(()=>nativeCopy(raw,raw,cap),fixedNative);
});
test('native copier retains decoded text only within the configured cap',async()=>{
  const {receipt}=await fixture({text:' raw 😀\n '});assert.equal(nativeCopy(nativeOnly(receipt),receipt.preflight,10).text,receipt.text);
  assert.throws(()=>nativeCopy(nativeOnly(receipt),receipt.preflight,8),fixedNative);
});
test('native array lengths and numeric entries are captured once without caller iteration',async()=>{
  const {receipt}=await fixture();const value=nativeOnly(receipt);
  function guarded(array) {const reads=new Map();return new Proxy(array,{get(target,key,receiver){
    if(key==='length'||/^\d+$/.test(String(key))) {reads.set(key,(reads.get(key)??0)+1);if(reads.get(key)>1)throw Error('PRIVATE reread');}
    if(key===Symbol.iterator||key==='map')throw Error('PRIVATE iteration');return Reflect.get(target,key,receiver);}});}
  value.promptTokenIds=guarded([...value.promptTokenIds]);value.generatedTokenIds=guarded([...value.generatedTokenIds]);
  assert.deepEqual(nativeCopy(value,receipt.preflight).generatedTokenIds,[5,151645]);
});
test('combined 2048-token budget is preserved and options cannot retarget it',async()=>{
  const {input,options,receipt}=await fixture({length:2047,maxNewTokens:1,suffix:[151645]});
  assert.equal(financialCopy(receipt,input,options).preflight.settings.max_length,2048);
  assert.throws(()=>financialCopy(receipt,input,{maxNewTokens:2}),fixedFinancial);
});
test('huge generated arrays fail before keys, indices, iteration or caller map are read',async()=>{
  const {input,options,receipt}=await fixture();let reads=0;
  receipt.generatedTokenIds=new Proxy(new Array(1000000),{get(target,key){if(key==='length')return target.length;reads++;throw Error('PRIVATE');},
    ownKeys(){reads++;throw Error('PRIVATE');}});
  assert.throws(()=>financialCopy(receipt,input,options),fixedFinancial);assert.equal(reads,0);
  assert.throws(()=>nativeCopy(nativeOnly(receipt),receipt.preflight),fixedNative);assert.equal(reads,0);
});
test('huge prepared IDs and mismatched masks fail before caller array enumeration',async()=>{
  const {input,options,receipt}=await fixture();let reads=0;
  receipt.preparedPrompt.tokenIds=new Proxy(new Array(2049),{get(target,key){if(key==='length')return target.length;reads++;throw Error('PRIVATE');},ownKeys(){reads++;throw Error('PRIVATE');}});
  assert.throws(()=>financialCopy(receipt,input,options),fixedFinancial);assert.equal(reads,0);
});
for(const field of ['generatedTokenIds','text','preparedPrompt','cleanup'])test(`throwing ${field} getter is private-safe without a cause`,async()=>{
  const {input,options,receipt}=await fixture();Object.defineProperty(receipt,field,{get(){throw Error('PRIVATE secret http://private');}});
  assert.throws(()=>financialCopy(receipt,input,options),fixedFinancial);
});
test('reflection failures are private-safe',async()=>{
  const {input,options,receipt}=await fixture();const raw=new Proxy(receipt,{ownKeys(){throw Error('PRIVATE secret');}});
  assert.throws(()=>financialCopy(raw,input,options),fixedFinancial);
});
function once(record) {for(const key of Object.keys(record)){let count=0,value=record[key];Object.defineProperty(record,key,{enumerable:true,configurable:true,
  get(){if(++count>1)throw Error('PRIVATE reread '+key);return value;}});}return record;}
test('envelope, native/prepared fields, nested receipts and settings are captured only once',async()=>{
  const {input,options,receipt}=await fixture();
  for(const value of [receipt.preparedPrompt.tokenizer,receipt.preparedPrompt.preflight.generation,receipt.preparedPrompt.preflight.settings,
    receipt.preparedPrompt.preflight,receipt.preparedPrompt,receipt.preflight.generation,receipt.preflight.settings,receipt.preflight,
    receipt.inspection,receipt.cachePreparation,receipt.sdkReads,receipt.cleanup,...receipt.stages,receipt])once(value);
  assert.equal(financialCopy(receipt,input,once(options)).status,'native-generation-complete-uninspected');
});
test('ignored extractor geometry stays unread while revalidating original input',async()=>{
  const {input,options,receipt}=await fixture();let reads=0;
  Object.defineProperty(input.source.pages[0].textItems[0],'transform',{get(){reads++;throw Error('PRIVATE');}});
  assert.equal(financialCopy(receipt,input,options).preparedPrompt.context.question,QUESTION);assert.equal(reads,0);
});
test('noninjective provenance projection is revalidation, not an original byte-identity seal',async()=>{
  const {input,options,receipt}=await fixture();input.embeddingArtifact.tokenIds[0][1]=43;
  assert.deepEqual(financialCopy(receipt,input,options),receipt);
});
test('consistent numeric token frames pass pure shape checks without establishing actual tokenization',async()=>{
  const {input,options,receipt}=await fixture();receipt.preparedPrompt.tokenIds=[99,...receipt.preparedPrompt.tokenIds.slice(1)];
  receipt.preparedPrompt.preflight=structuredClone(generation.preflightGeneration(receipt.preparedPrompt.tokenIds,options));
  assert.equal(promptCopy(receipt.preparedPrompt,input,options).tokenIds[0],99);
  assert.throws(()=>financialCopy(receipt,input,options),fixedFinancial);
});

// Observe the whole mutable receipt graph once, preserving its natural aliases.
// These wrappers only enforce observation counts; the production contracts
// still validate every field and numeric role against the original provenance.
function onceGraph(root) {
  const memo=new WeakMap();
  function wrap(value) {
    if(value===null||typeof value!=='object')return value;
    if(memo.has(value))return memo.get(value);
    const reads=new Set();let keyReads=0,prototypeReads=0;
    const proxy=new Proxy(value,{get(target,key,receiver){
      if(Object.hasOwn(target,key)) {if(reads.has(key))throw Error('PRIVATE shared reread');reads.add(key);}
      return wrap(Reflect.get(target,key,receiver));
    },ownKeys(target){if(++keyReads>1)throw Error('PRIVATE keys reread');return Reflect.ownKeys(target);},
    getPrototypeOf(target){if(++prototypeReads>1)throw Error('PRIVATE prototype reread');return Reflect.getPrototypeOf(target);}});
    memo.set(value,proxy);return proxy;
  }
  return wrap(root);
}
test('native snapshot refuses a first unknown key list rather than observing a replacement list',async()=>{
  const {receipt}=await fixture();let keyReads=0,fieldReads=0;
  receipt.cachePreparation=new Proxy(receipt.cachePreparation,{ownKeys(target){keyReads++;
    return keyReads===1?['extra','verifiedBytes','networkBytes','cacheBytes']:Reflect.ownKeys(target);},
  get(target,key,receiver){fieldReads++;return Reflect.get(target,key,receiver);}});
  assert.throws(()=>nativeCopy(nativeOnly(receipt),receipt.preflight),fixedNative);
  assert.equal(keyReads,1);assert.equal(fieldReads,0);
});
test('natural shared prepared token IDs and preflight IDs are captured once',async()=>{
  const {input,options,receipt}=await fixture();
  assert.equal(receipt.preparedPrompt.tokenIds,receipt.preparedPrompt.preflight.promptTokenIds);
  const copy=promptCopy(onceGraph(receipt.preparedPrompt),input,options);
  assert.deepEqual(copy,receipt.preparedPrompt);
});
test('natural shared native suffix and inspection suffix are captured once',async()=>{
  const {receipt}=await fixture();assert.equal(receipt.generatedTokenIds,receipt.inspection.generatedTokenIds);
  const raw=onceGraph(nativeOnly(receipt)),copy=nativeCopy(raw,receipt.preparedPrompt.preflight);
  assert.deepEqual(copy,nativeOnly(receipt));
});
test('shared context representation getters are captured once through every canonical path',async()=>{
  const {input,options,receipt}=await fixture();
  assert.equal(receipt.preparedPrompt.context.representation,receipt.preparedPrompt.context.query.representation);
  const raw=receipt.preparedPrompt;
  raw.context.representation=onceGraph(raw.context.representation);raw.context.query.representation=raw.context.representation;
  assert.deepEqual(promptCopy(raw,input,options).context.representation,{...EMBEDDING_SPEC});
});
test('one complete copy owns a canonical graph with shared prepared and native preflight nodes',async()=>{
  const {input,options,receipt}=await fixture();
  receipt.preflight=receipt.preparedPrompt.preflight;receipt.promptTokenIds=receipt.preparedPrompt.tokenIds;
  const before=structuredClone(receipt),copy=financialCopy(onceGraph(receipt),input,options);
  assert.deepEqual(copy,before);frozen(copy);
});
test('standalone native copier owns shared expected and supplied preflight and prompt IDs once',async()=>{
  const {receipt}=await fixture();const value=nativeOnly(receipt),graph=onceGraph({value,expected:value.preflight});
  assert.deepEqual(nativeCopy(graph.value,graph.expected),value);
});
test('reused IDs cannot bypass a narrower generated-token length role',async()=>{
  const {input,options,receipt}=await fixture();receipt.generatedTokenIds=receipt.preparedPrompt.tokenIds;
  assert.throws(()=>financialCopy(onceGraph(receipt),input,options),fixedFinancial);
});
test('reused IDs cannot bypass the all-one attention-mask role',async()=>{
  const {input,options,receipt}=await fixture();receipt.preparedPrompt.attentionMask=receipt.preparedPrompt.tokenIds;
  assert.throws(()=>financialCopy(onceGraph(receipt),input,options),fixedFinancial);
});
test('cyclic and differently shaped aliases fail with fixed private-safe errors',async()=>{
  for(const mutate of [v=>{v.preparedPrompt.context.query.representation=v.preparedPrompt.context;},
    v=>{v.preparedPrompt.messages[0]=v.preparedPrompt;},v=>{v.inspection=v.preflight;}]) {
    const {input,options,receipt}=await fixture();mutate(receipt);
    assert.throws(()=>financialCopy(onceGraph(receipt),input,options),fixedFinancial);
  }
});
test('internal snapshot delegations refuse arbitrary caller readers before receipt access',async()=>{
  assert.equal(typeof prompt.copyPreparedGenerationPromptWithSnapshot,'function');
  assert.equal(typeof native.copyNativeGeneratorReceiptWithSnapshot,'function');
  const {input,options,receipt}=await fixture();let reads=0;
  const arbitrary=new Proxy({matches:()=>true},{get(){reads++;throw Error('PRIVATE reader');}});
  const raw=new Proxy({}, {get(){reads++;throw Error('PRIVATE receipt');},getPrototypeOf(){reads++;throw Error('PRIVATE reflection');}});
  assert.throws(()=>prompt.copyPreparedGenerationPromptWithSnapshot(raw,input,options,arbitrary),fixedPrompt);
  assert.throws(()=>native.copyNativeGeneratorReceiptWithSnapshot(raw,receipt.preflight,16384,arbitrary),fixedNative);
  assert.equal(reads,0);
});
