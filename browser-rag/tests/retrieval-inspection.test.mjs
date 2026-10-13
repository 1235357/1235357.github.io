import test from 'node:test';
import assert from 'node:assert/strict';
import {createRetrievalInspection,RetrievalInspectionError} from '../retrieval-inspection.mjs';
import {inspectionInput,axis} from './retrieval-inspection-fixture.mjs';

const invalid=error=>error instanceof RetrievalInspectionError&&error.code==='INVALID_RETRIEVAL_INSPECTION'
  &&error.message==='The retained retrieval artifacts do not agree.'&&!Object.hasOwn(error,'cause');
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} differs from ${expected}`);

test('inspection retains all ranked passages and exact selected boundary without changing accepted artifacts',()=>{
  const input=inspectionInput({topK:1,vectors:[axis(0,-1),axis(1),axis()]}),before=structuredClone(input);
  const {record,components}=createRetrievalInspection(input);
  assert.deepEqual(input,before);assert.equal(record.status,'inspection-recomputed');assert.equal(record.chunkCount,3);
  assert.equal(record.requestedTopK,1);assert.equal(record.returnedCount,1);
  assert.deepEqual(record.rankedChunks.map(row=>[row.ordinal,row.score,row.selected]),[[2,1,true],[1,0,false],[0,-1,false]]);
  assert.deepEqual(record.source,input.source.source);assert.equal(record.rankedChunks[0].physicalPageNumber,3);
  assert.equal(record.rankedChunks[1].pageLabel,'i');assert.equal(record.rankedChunks[2].pageLabel,null);
  const values=components(0);assert.equal(values.components.length,384);assert.equal(values.components[0].product,-1);
  assert.equal(values.components.at(-1).cumulativeDot,-1);assert.equal(values.score,-1);assert.equal(values.denominator,1);
});
test('component calculation preserves measured non-unit norms and full scalar precision',()=>{
  const query=axis(0,0.60003);query[1]=0.80004;
  const input=inspectionInput({count:2,topK:1,query,vectors:[axis(0,1.00004),axis(1,1.00003)]});
  const inspection=createRetrievalInspection(input),values=inspection.components(1);
  close(values.queryNorm,1.00005);close(values.chunkNorm,1.00003);close(values.dotProduct,0.8000640012);
  close(values.score,0.8);assert.notEqual(values.score,values.dotProduct);
  assert.equal(values.dotProduct,input.retrieval.candidates[0].dotProduct);assert.equal(values.score,input.retrieval.candidates[0].score);
  assert.equal(values.components.at(-1).cumulativeDot,values.dotProduct);
  assert.equal(Math.sqrt(values.querySquared),values.queryNorm);assert.equal(Math.sqrt(values.passageSquared),values.chunkNorm);
});
test('exact cosine ties follow source ordinal despite different raw dot products',()=>{
  const input=inspectionInput({topK:2,vectors:[axis(0,0.99991),axis(0,1.00009),axis()]});
  const inspection=createRetrievalInspection(input);
  assert.deepEqual(inspection.record.rankedChunks.map(row=>row.ordinal),[0,1,2]);
  assert.deepEqual(inspection.record.rankedChunks.map(row=>row.score),[1,1,1]);
  assert.deepEqual(inspection.record.rankedChunks.map(row=>row.selected),[true,true,false]);
  assert.deepEqual(inspection.record.rankedChunks.map(row=>row.dotProduct),[0.99991,1.00009,1]);
});
test('maximum 512 accepted rows remain inspectable including unselected row 512',()=>{
  const inspection=createRetrievalInspection(inspectionInput({count:512,topK:5}));
  assert.equal(inspection.record.chunkCount,512);assert.equal(inspection.record.rankedChunks.filter(row=>row.selected).length,5);
  assert.deepEqual([...inspection.record.rankedChunks.map(row=>row.ordinal)].sort((a,b)=>a-b),Array.from({length:512},(_,i)=>i));
  assert.equal(inspection.components(511).components.length,384);assert.equal(inspection.components(511).physicalPageNumber,1);
});
test('snapshots are deeply frozen and component records stay detached after every input mutation',()=>{
  const input=inspectionInput(),inspection=createRetrievalInspection(input),before=structuredClone(inspection.record),values=inspection.components(0);
  assert.ok(Object.isFrozen(inspection));assert.ok(Object.isFrozen(inspection.record.rankedChunks[0]));assert.ok(Object.isFrozen(values.components[0]));
  input.source.source.name='CHANGED';input.chunkArtifact.chunks[0].pageLabel='CHANGED';
  input.embeddingArtifact.vectors[0][0]=-1;input.query.vector[0]=-1;input.retrieval.candidates[0].score=99;
  assert.deepEqual(inspection.record,before);assert.deepEqual(inspection.components(0),values);
  assert.throws(()=>{values.components[0].product=99;},TypeError);
});
for(const [name,mutate]of [
  ['accepted score',input=>{input.retrieval.candidates[0].score+=0.000001;}],
  ['accepted dot',input=>{input.retrieval.candidates[0].dotProduct+=0.000001;}],
  ['accepted norm',input=>{input.retrieval.candidates[0].chunkNorm+=0.000001;}],
  ['accepted query norm',input=>{input.retrieval.queryNorm+=0.000001;}],
  ['accepted candidate order',input=>{input.retrieval.candidates.reverse();}],
  ['candidate count',input=>{input.retrieval.returnedCount=1;}],
  ['selected candidate ID',input=>{input.retrieval.candidates[0].chunkId='PRIVATE_WRONG';}],
  ['selected source hash',input=>{input.retrieval.sourceSha256='b'.repeat(64);} ],
  ['mismatched mapped physical page',input=>{input.chunkArtifact.chunks[0].physicalPageNumber=3;}],
  ['mismatched PDF label',input=>{input.chunkArtifact.chunks[0].pageLabel='PRIVATE_WRONG';}],
  ['mismatched parser quote',input=>{input.chunkArtifact.chunks[0].segments[0].quote='PRIVATE_WRONG';}],
  ['mismatched vector lineage',input=>{input.embeddingArtifact.chunkIds.reverse();}],
  ['inconsistent query receipt',input=>{input.query.receipt.cacheBytes+=1;}],
  ['inconsistent passage receipt',input=>{input.embeddingArtifact.receipt.cacheBytes+=1;}],
  ['nonfinite query vector',input=>{input.query.vector[0]=NaN;}],
  ['zero passage vector',input=>{input.embeddingArtifact.vectors[0].fill(0);} ],
  ['unknown input field',input=>{input.private='PRIVATE';}],
])test(`inspection refuses ${name} through the fixed public error`,()=>{
  const input=inspectionInput();mutate(input);assert.throws(()=>createRetrievalInspection(input),invalid);
});
test('wrong source-ordinal tie order is refused even when both numerical scores agree',()=>{
  const input=inspectionInput({vectors:[axis(),axis(),axis()]});input.retrieval.candidates.reverse();
  assert.throws(()=>createRetrievalInspection(input),invalid);
});
for(const ordinal of [-1,3,0.5,'0',null,undefined,NaN,Infinity])test(`component lookup refuses ordinal ${String(ordinal)}`,()=>{
  assert.throws(()=>createRetrievalInspection(inspectionInput()).components(ordinal),invalid);
});
test('throwing private getters are sanitized and not copied into the error',()=>{
  const input=inspectionInput();Object.defineProperty(input,'query',{enumerable:true,get(){throw new Error('PRIVATE_DIAGNOSTIC');}});
  assert.throws(()=>createRetrievalInspection(input),invalid);assert.throws(()=>createRetrievalInspection(null),invalid);
});
