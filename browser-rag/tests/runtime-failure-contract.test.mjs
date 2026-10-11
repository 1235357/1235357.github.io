import test from 'node:test';
import assert from 'node:assert/strict';

const identity={protocolVersion:1,runtimeId:'owned-runtime',operationId:'op-1',documentEpoch:2,operation:'embed'};
const worker={component:'encoder-initializer',phase:'model-load',assetIndex:null,allowedCode:'EMBEDDING_LOAD_FAILED'};
const raw=()=>({schemaVersion:1,identity:{...identity},safeError:{...worker,failureOrigin:'worker-reported-error',readyObserved:true,commandPosted:true,lastSeq:4,elapsedMs:123}});
const contract=()=>import('../runtime-failure-contract.mjs');

test('owned model boundary survives detached failure copy without raw exception data',async()=>{
  const {copyRuntimeFailure}=await contract(),input=raw(),copy=copyRuntimeFailure(input,identity,3);
  input.safeError.phase='sdk-import';input.identity.runtimeId='other';
  assert.equal(copy.safeError.phase,'model-load');assert.equal(copy.identity.runtimeId,identity.runtimeId);
  assert.ok(Object.isFrozen(copy)&&Object.isFrozen(copy.identity)&&Object.isFrozen(copy.safeError));
  assert.equal(JSON.stringify(copy).includes('URL'),false);
});
test('worker categories distinguish cache from unchanged outer preparation failure',async()=>{
  const {copyWorkerFailure}=await contract();
  assert.equal(copyWorkerFailure({component:'preparation-loader',phase:'asset-verify-and-store',assetIndex:7,allowedCode:'ASSET_CACHE_ERROR'},'preparation-loader').allowedCode,'ASSET_CACHE_ERROR');
});
test('foreign identity and a sequence older than accepted progress cannot enter session state',async()=>{
  const {copyRuntimeFailure}=await contract();
  assert.throws(()=>copyRuntimeFailure(raw(),{...identity,runtimeId:'other'},3));
  assert.throws(()=>copyRuntimeFailure(raw(),identity,5));
});
test('strict failure copier refuses unknown keys and wrong component phase or category',async()=>{
  const {copyRuntimeFailure}=await contract();
  for(const change of [value=>value.safeError.url='https://private.invalid',value=>value.safeError.phase='cache-open',value=>value.safeError.allowedCode='RAW_MESSAGE',value=>value.safeError.assetIndex=8,value=>value.safeError.elapsedMs=130001]){
    const input=raw();change(input);assert.throws(()=>copyRuntimeFailure(input,identity));
  }
});
test('diagnostic copy never calls hostile getters or lets Proxy traps escape',async()=>{
  const {copyRuntimeFailure}=await contract();let reads=0;const input=raw();
  Object.defineProperty(input.safeError,'phase',{enumerable:true,get(){reads++;throw Error('raw URL');}});
  assert.throws(()=>copyRuntimeFailure(input,identity));assert.equal(reads,0);
  assert.throws(()=>copyRuntimeFailure(new Proxy({}, {getPrototypeOf(){throw Error('private');}}),identity),{message:'Invalid runtime failure diagnostic'});
});
test('client timeout records trusted branch with unknown worker phase and nullable elapsed',async()=>{
  const {createRuntimeFailure}=await contract();
  const failure=createRuntimeFailure(identity,{failureOrigin:'client-readiness-deadline',readyObserved:false,commandPosted:false,lastSeq:0,elapsedMs:150000,allowedCode:'EMBEDDING_TIMEOUT'});
  assert.equal(failure.safeError.phase,'worker-readiness');assert.equal(failure.safeError.elapsedMs,null);
  assert.equal(failure.safeError.component,'encoder-client');
  assert.equal(failure.safeError.readyObserved,false);
});
test('worker diagnostics require an actually ready posted command and accepted terminal sequence',async()=>{
  const {copyRuntimeFailure}=await contract();
  for(const key of ['readyObserved','commandPosted']){const input=raw();input.safeError[key]=false;assert.throws(()=>copyRuntimeFailure(input,identity));}
  const input=raw();input.safeError.lastSeq=0;assert.throws(()=>copyRuntimeFailure(input,identity));
});
test('query client records its existing worker error without inventing an initializer phase',async()=>{
  const {createRuntimeFailure,copyRuntimeFailure}=await contract(),owned={...identity,operation:'query'};
  const failure=createRuntimeFailure(owned,{failureOrigin:'worker-reported-error',readyObserved:true,commandPosted:true,lastSeq:3,elapsedMs:4,allowedCode:'QUERY_FAILED'});
  assert.equal(failure.safeError.component,'query-client');assert.equal(failure.safeError.phase,'unknown');
  assert.deepEqual(copyRuntimeFailure(failure,owned,3),failure);
});
test('preparation absolute deadline can win before readiness without inventing ready or command flags',async()=>{
  const {createRuntimeFailure}=await contract();
  const failure=createRuntimeFailure({...identity,operation:'prepare-assets'},{failureOrigin:'client-operation-deadline',readyObserved:false,commandPosted:false,lastSeq:0,elapsedMs:1800001,allowedCode:'ASSET_PREPARATION_TIMEOUT'});
  assert.equal(failure.safeError.phase,'worker-operation');assert.equal(failure.safeError.elapsedMs,null);assert.equal(failure.safeError.readyObserved,false);
});
test('diagnostic code ignores non-enumerable or accessor error codes',async()=>{
  const {diagnosticCode}=await contract();const error={};Object.defineProperty(error,'code',{value:'ASSET_CACHE_ERROR'});
  assert.equal(diagnosticCode(error,'preparation-loader','ASSET_PREPARATION_FAILED'),'ASSET_PREPARATION_FAILED');
});
