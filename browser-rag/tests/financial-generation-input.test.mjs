import test from 'node:test';
import assert from 'node:assert/strict';
import { inputOf } from './financial-generation-fixture.mjs';
import { copyValidatedSource } from '../compute-source.mjs';
const api=await import('../financial-generation-input.mjs').catch(()=>({}));
const copy=value=>{assert.equal(typeof api.copyFinancialGenerationInput,'function');return api.copyFinancialGenerationInput(value);};
test('shared owner retains the complete eight fields and raw question while detaching and freezing',()=>{
  const input=inputOf(),expected=structuredClone(input);expected.source=copyValidatedSource(input.source);const owned=copy(input);
  assert.deepEqual(owned,expected);assert.equal(Object.keys(owned).length,8);assert.notEqual(owned,input);
  input.question='retarget';input.embeddingArtifact.vectors[0][0]=0;assert.deepEqual(owned,expected);
  assert.equal(Object.isFrozen(owned.queryResult.query.vector),true);assert.equal(Object.isFrozen(input),false);
});
test('ownership normalizes the source and never reads ignored extractor geometry',()=>{
  const input=inputOf();let reads=0;Object.defineProperty(input.source.pages[0].textItems[0],'transform',{get(){reads++;throw Error('PRIVATE');}});
  input.source.pages[1].geometry=new Array(0xffffffff);assert.equal(copy(input).question,input.question);assert.equal(reads,0);
});
test('invalid original provenance fails before structured cloning and unknown outer keys remain unread',()=>{
  const input=inputOf();let reads=0;Object.defineProperty(input,'unknown',{enumerable:true,get(){reads++;throw Error('PRIVATE');}});
  assert.throws(()=>copy(input),e=>e.code==='INVALID_PROMPT_INPUT');assert.equal(reads,0);
  const invalid=inputOf();invalid.queryMetadata.query.receipt.verifiedBytes++;
  assert.throws(()=>copy(invalid),e=>e.code==='INVALID_PROMPT_INPUT');
});
test('outer key list is observed once before any fields',()=>{
  let keys=0,fields=0;const input=new Proxy(inputOf(),{ownKeys(target){keys++;return keys===1?['extra']:Reflect.ownKeys(target);},get(target,key){fields++;return target[key];}});
  assert.throws(()=>copy(input),e=>e.code==='INVALID_PROMPT_INPUT');assert.equal(keys,1);assert.equal(fields,0);
});
test('canonical option ownership uses the shared preflight and captures settings once',()=>{
  assert.equal(typeof api.copyFinancialGenerationOptions,'function');let reads=0;
  const options={get maxNewTokens(){reads++;return 17;}};const copy=api.copyFinancialGenerationOptions(options);
  assert.deepEqual(copy,{contextWindowTokens:2048,maxNewTokens:17});assert.equal(reads,1);assert.equal(Object.isFrozen(copy),true);
  for(const bad of [{temperature:0},{maxNewTokens:513},{contextWindowTokens:1}])assert.throws(()=>api.copyFinancialGenerationOptions(bad));
});
