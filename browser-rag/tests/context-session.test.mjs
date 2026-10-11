import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfSession} from '../pdf-session.mjs';
import {createPageRecord} from '../pdf-source.mjs';
import {createComputeCommandHandler} from '../compute.worker.mjs';
import {EMBEDDING_SPEC} from '../embedding-contract.mjs';
import {embeddingReceipt} from '../embedding-source.mjs';
import {queryResultReceipt,QueryWorkerError} from '../query-source.mjs';
import {rankCandidates} from '../retrieval.mjs';
import {assembleProvenanceContext,ContextError} from '../context-contract.mjs';

// Real parser-record, chunker, embedding/query copiers and ranker, with controlled
// adapter delivery and synthetic vectors. No browser, GPU or model execution.
const SHA='a'.repeat(64),DOWNLOAD_BYTES=113629084;
const RAW='  PRIVATE_QUESTION\n財報 😀?  ',CHUNK_OPTIONS={maxChunkUtf16:4096,overlapUtf16:0};
const vector=axis=>Array.from({length:384},(_,index)=>index===axis?1:0);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function extracted(name='PRIVATE_SOURCE.pdf'){
  const parser={name:'pdfjs',version:'6.4.299',policyVersion:'text-items-v1',disableNormalization:true};
  return structuredClone({schemaVersion:1,status:'extracted-not-indexed',source:{name,sha256:SHA,size:1002},
    parser,workerMode:'node-fake',numPages:3,pages:[['  PRIVATE_ALPHA\n😀  ','','尾\t'],['PRIVATE_BETA'],['PRIVATE_GAMMA']]
      .map((strings,index)=>createPageRecord({sourceSha256:SHA,parserVersion:parser.version,
        physicalPageNumber:index+1,pageLabel:[null,'i','i'][index],page:{view:[0,0,612,792],rotate:0,userUnit:1},
        textContent:{items:strings.map(str=>({str,dir:'ltr',transform:[1,0,0,1,30,740],
          width:120,height:12,fontName:'f1',hasEOL:false}))}}))});
}
function harness(extra={}){
  const computes=[],embeds=[],queries=[],states=[];let incarnation=0;
  const pending=(tasks,record,options,rest={})=>{const task={record,options,...rest,...deferred()};tasks.push(task);return task.promise;};
  const session=createPdfSession({runtimeId:'context-parser',runtimeIdFactory:()=>`context-${++incarnation}`,
    extract:async file=>extracted(file.name),compute:(record,options)=>pending(computes,record,options),
    embed:(record,options)=>pending(embeds,record,options),
    query:(record,passages,question,options)=>pending(queries,record,options,{passages,question}),
    onState:state=>{states.push(state);extra.onState?.(state);}});
  return {session,computes,embeds,queries,states};
}
function finishChunk(task){
  const packets=[];createComputeCommandHandler(packet=>packets.push(packet))(
    {kind:'chunk-source',identity:task.options.identity,source:task.record,options:task.options.chunkOptions});
  assert.equal(packets.at(-1).event.kind,'result');
  for(const packet of packets.slice(0,-1))task.options.onProgress(packet.event);
  const result=structuredClone(packets.at(-1));task.resolve(result);return result;
}
function progress(task,stages){
  stages.forEach(([stage,completed,total,unit],index)=>task.options.onProgress({...task.options.identity,
    kind:'progress',stage,seq:index+1,payload:{completed,total,unit,estimated:false}}));
}
function finishEmbedding(task){
  const count=task.record.counts.chunks;
  progress(task,[['download',0,DOWNLOAD_BYTES,'bytes'],['download',DOWNLOAD_BYTES,DOWNLOAD_BYTES,'bytes'],
    ['initialize',0,null,'chunks'],['encode',0,count,'chunks'],['encode',count,count,'chunks']]);
  const artifact={schemaVersion:1,status:'embedded-not-retrieved',sourceSha256:SHA,
    representationId:EMBEDDING_SPEC.version,representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',
    chunkIds:task.record.chunks.map(chunk=>chunk.id),tokenIds:task.record.chunks.map(()=>[101,42,102]),
    vectors:task.record.chunks.map((_,index)=>vector(index)),counts:{chunks:count,totalTokens:count*3,dimensions:384},
    receipt:{verifiedBytes:DOWNLOAD_BYTES,networkBytes:DOWNLOAD_BYTES,cacheBytes:0,elapsedMs:2}};
  const result={event:{...task.options.identity,kind:'result',stage:'encode',seq:6,
    payload:{data:structuredClone(embeddingReceipt(artifact))}},artifact};task.resolve(result);return result;
}
function finishQuery(task){
  const count=task.record.counts.chunks;
  progress(task,[['download',0,DOWNLOAD_BYTES,'bytes'],['download',DOWNLOAD_BYTES,DOWNLOAD_BYTES,'bytes'],
    ['initialize',0,null,'tokens'],['encode',0,3,'tokens'],['encode',3,3,'tokens'],
    ['rank',0,count,'chunks'],['rank',count,count,'chunks']]);
  const query={schemaVersion:1,status:'query-embedded-not-retrieved',representationId:EMBEDDING_SPEC.version,
    representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',tokenIds:[101,44,102],vector:vector(1),
    counts:{totalTokens:3,dimensions:384},receipt:{verifiedBytes:DOWNLOAD_BYTES,networkBytes:0,cacheBytes:DOWNLOAD_BYTES,elapsedMs:1}};
  const artifact={query,retrieval:structuredClone(rankCandidates(task.record,task.passages,
    {representationId:query.representationId,representation:query.representation,vector:query.vector},{topK:task.options.topK}))};
  const result={event:{...task.options.identity,kind:'result',stage:'rank',seq:8,
    payload:{data:structuredClone(queryResultReceipt(artifact))}},artifact};task.resolve(result);return result;
}
async function ready(extra={}){
  const h=harness(extra);await h.session.select({name:'PRIVATE_SOURCE.pdf'});
  const chunk=h.session.chunk(CHUNK_OPTIONS);finishChunk(h.computes.at(-1));await chunk;
  const embed=h.session.embed();finishEmbedding(h.embeds.at(-1));await embed;return h;
}
async function accepted(extra={},raw=RAW,topK=3){
  const h=await ready(extra),query=h.session.query(raw,{topK});h.packet=finishQuery(h.queries.at(-1));await query;return h;
}
const safeContext=code=>error=>error instanceof ContextError&&error.code===code&&!/PRIVATE|財報|😀|\.pdf/.test(error.message);
function context(session){assert.equal(typeof session.context,'function','session.context getter');return session.context();}
function assemble(session){assert.equal(typeof session.assembleContext,'function','explicit session.assembleContext action');return session.assembleContext();}
function frozen(value){if(value!==null&&typeof value==='object'){assert.ok(Object.isFrozen(value));Object.values(value).forEach(frozen);}}
function state(session){return {snapshot:session.snapshot(),document:session.document(),chunks:session.chunks(),
  embeddings:session.embeddings(),question:session.question(),query:session.queryEmbedding(),retrieval:session.retrieval(),context:context(session)};}

test('explicit synchronous context action returns the complete detached frozen shared artifact',async()=>{
  const {session,packet}=await accepted(),before=session.snapshot();assert.equal(context(session),null);
  const expected=assembleProvenanceContext({source:session.document(),chunkArtifact:session.chunks(),
    embeddingArtifact:session.embeddings(),question:RAW,queryResult:{query:session.queryEmbedding(),retrieval:session.retrieval()},
    topK:3,queryDownloadTotal:DOWNLOAD_BYTES,queryMetadata:before.lifecycle.terminal.payload.data});
  const result=assemble(session);assert.equal(result instanceof Promise,false);assert.deepEqual(result,expected);frozen(result);
  assert.equal(context(session),result);assert.equal(session.snapshot().status,'context-not-generated');
  assert.equal(result.question,RAW);assert.deepEqual(result.evidenceUnits.map(unit=>unit.citationId),['E2','E1','E3']);
  assert.deepEqual(result.evidenceUnits.map(unit=>unit.rank),[1,2,3]);
  assert.deepEqual(result.evidenceUnits.map(unit=>unit.pageLabel),['i',null,'i']);
  assert.equal(result.evidenceUnits[1].text,'  PRIVATE_ALPHA\n😀  \n尾\t');
  assert.ok(result.evidenceUnits[1].segments.some(segment=>segment.kind==='presentation'));
  assert.deepEqual(session.snapshot().lifecycle,before.lifecycle,'context must preserve the successful rank terminal');
  assert.equal(Object.isFrozen(session.document()),false);assert.equal(Object.isFrozen(session.chunks()),false);
  assert.notEqual(result.query,session.queryEmbedding());assert.notEqual(result.retrieval,session.retrieval());
  packet.artifact.query.vector[1]=9;packet.event.payload.data.query.counts.totalTokens=99;
  session.document().source.name='changed';session.chunks().chunks[0].segments[0].quote='changed';
  assert.equal(result.source.name,'PRIVATE_SOURCE.pdf');assert.equal(result.query.vector[1],1);
  assert.equal(result.evidenceUnits[1].segments[0].quote,'  PRIVATE_ALPHA\n😀  ');
});
test('context assembly remains explicit and snapshots contain bounded rank metadata only',async()=>{
  const h=await accepted(),{session}=h;assert.equal(context(session),null);const before=session.snapshot().lifecycle;
  assemble(session);assemble(session);
  for(const snapshot of h.states){const json=JSON.stringify(snapshot);
    assert.ok(!/PRIVATE|財報|😀|evidenceUnits|tokenIds|"vector"|"context"/.test(json));}
  assert.deepEqual(session.snapshot().lifecycle,before);assert.equal(before.terminal.stage,'rank');assert.equal(before.terminal.seq,8);
  assert.equal(Object.hasOwn(session,'contextInput'),false);
});
test('successful rank notification can immediately assemble its current owner',async()=>{
  let session,result;const h=await ready({onState:s=>{if(s.status==='query-candidates-only')result=assemble(session);}});
  session=h.session;const task=session.query(RAW,{topK:1});finishQuery(h.queries.at(-1));await task;
  assert.equal(context(session),result);assert.equal(result.evidenceUnits.length,1);assert.equal(result.evidenceUnits[0].citationId,'E2');
  assert.equal(result.counts.chunks,3);assert.equal(session.snapshot().lifecycle.terminal.stage,'rank');
});
test('no accepted query refuses context before reading any selected source getter',async()=>{
  const h=await ready();let reads=0;Object.defineProperty(h.session.document().source,'name',{get(){reads++;throw Error('PRIVATE');}});
  assert.throws(()=>assemble(h.session),safeContext('CONTEXT_FAILED'));assert.equal(reads,0);assert.equal(context(h.session),null);
});
test('empty session refuses context with a fixed operation error',()=>{
  const {session}=harness();assert.equal(context(session),null);assert.throws(()=>assemble(session),safeContext('CONTEXT_FAILED'));
});
for(const outcome of ['pending','failed','cancelled'])test(`${outcome} query refuses context and cannot restore an older artifact`,async()=>{
  const h=await accepted(),{session}=h;assemble(session);const task=session.query('next query');assert.equal(context(session),null);
  if(outcome==='failed'){h.queries.at(-1).reject(Error('PRIVATE raw diagnostic'));await task;}
  if(outcome==='cancelled'){session.cancel();finishQuery(h.queries.at(-1));await task;}
  assert.throws(()=>assemble(session),safeContext('CONTEXT_FAILED'));
  if(outcome==='pending'){session.cancel();finishQuery(h.queries.at(-1));await task;}
  assert.equal(context(session),null);
});
for(const [name,mutate]of [
  ['source text',session=>{session.document().pages[0].textItems[0].text='PRIVATE_FORGED';}],
  ['source digest',session=>{session.document().source.sha256='b'.repeat(64);}],
  ['source name',session=>{session.document().source.name='PRIVATE_FORGED.pdf';}],
  ['chunk quote',session=>{session.chunks().chunks[0].segments[0].quote='PRIVATE_FORGED';}],
  ['chunk span',session=>{session.chunks().chunks[0].endUtf16--;}],
  ['chunk order',session=>{session.chunks().chunks.reverse();}],
])test(`context rejects mutated ${name} through the shared contract`,async()=>{
  const {session}=await accepted();mutate(session);assert.throws(()=>assemble(session),safeContext('INVALID_CONTEXT_ARTIFACT'));
  assert.equal(context(session),null);assert.equal(session.snapshot().status,'query-candidates-only');
});
for(const action of ['clear','clearQuery','select','query','chunk','embed'])test(`${action} revokes the private context and accepted query owner`,async()=>{
  const h=await accepted(),{session}=h;assemble(session);
  const task=action==='select'?session.select({name:'replacement.pdf'}):action==='query'?session.query(RAW,{topK:1})
    :action==='chunk'?session.chunk(CHUNK_OPTIONS):session[action]();
  assert.equal(context(session),null);assert.throws(()=>assemble(session),safeContext('CONTEXT_FAILED'));
  if(action==='query')finishQuery(h.queries.at(-1));if(action==='chunk')finishChunk(h.computes.at(-1));
  if(action==='embed')finishEmbedding(h.embeds.at(-1));await task;
  if(action==='query'){const result=assemble(session);assert.equal(result.evidenceUnits.length,1);}
  else assert.equal(context(session),null);
});
test('invalid query preflight preserves an accepted context and successful terminal',async()=>{
  const {session}=await accepted();assemble(session);const before=state(session);
  for(const [question,options]of [[' ',{}],[RAW,{topK:0}],[RAW,{topK:null}],[RAW,{unexpected:true}],[RAW,{readyTimeoutMs:0}]]){
    await assert.rejects(session.query(question,options),error=>error instanceof QueryWorkerError);
    assert.deepEqual(state(session),before);assert.equal(context(session),before.context);
  }
});
test('cancel without active work is the existing no-op after synchronous context assembly',async()=>{
  const {session}=await accepted();assemble(session);const before=state(session);session.cancel();assert.deepEqual(state(session),before);
});
for(const action of ['clear','clearQuery','select','query'])test(`source getter ${action} reentry cannot commit or return stale context`,async()=>{
  const h=await accepted(),{session}=h;let triggered=false,reentered;
  Object.defineProperty(session.document().source,'name',{get(){if(!triggered){triggered=true;
    reentered=action==='select'?session.select({name:'replacement.pdf'}):action==='query'?session.query('next question')
      :session[action]();}return 'PRIVATE_SOURCE.pdf';}});
  assert.throws(()=>assemble(session),safeContext('CONTEXT_FAILED'));assert.equal(context(session),null);
  if(action==='query')finishQuery(h.queries.at(-1));await reentered;
  assert.notEqual(session.snapshot().status,'context-not-generated');
});
for(const action of ['clear','clearQuery','select','query'])test(`context subscriber ${action} reentry refuses the stale return after notify`,async()=>{
  let session,reentered,triggered=false;const h=await accepted({onState:s=>{if(s.status==='context-not-generated'&&!triggered){
    triggered=true;reentered=action==='select'?session.select({name:'replacement.pdf'}):action==='query'?session.query('next question')
      :session[action]();}}});session=h.session;
  assert.throws(()=>assemble(session),safeContext('CONTEXT_FAILED'));assert.equal(context(session),null);
  if(action==='query')finishQuery(h.queries.at(-1));await reentered;assert.notEqual(session.snapshot().status,'context-not-generated');
});
test('caught recursive source getter refusal leaves a still-owned outer assembly valid',async()=>{
  const {session}=await accepted();let recursive=false;
  Object.defineProperty(session.document().source,'name',{get(){if(!recursive){recursive=true;
    assert.throws(()=>assemble(session),safeContext('CONTEXT_FAILED'));}return 'PRIVATE_SOURCE.pdf';}});
  const result=assemble(session);assert.equal(context(session),result);assert.equal(result.question,RAW);
});
test('uncaught recursive source getter fails canonically and the assembly guard is released',async()=>{
  const {session}=await accepted();Object.defineProperty(session.document().source,'name',{configurable:true,get(){return assemble(session);}});
  assert.throws(()=>assemble(session),safeContext('INVALID_CONTEXT_ARTIFACT'));assert.equal(context(session),null);
  Object.defineProperty(session.document().source,'name',{value:'PRIVATE_SOURCE.pdf'});assert.equal(assemble(session).question,RAW);
});
test('caught recursive subscriber refusal preserves the valid outer commit and rank terminal',async()=>{
  let session;const h=await accepted({onState:s=>{if(s.status==='context-not-generated')assert.throws(()=>assemble(session),safeContext('CONTEXT_FAILED'));}});
  session=h.session;const before=session.snapshot().lifecycle,result=assemble(session);
  assert.equal(context(session),result);assert.deepEqual(session.snapshot().lifecycle,before);
});
test('subscriber raw exception is normalized without leaking diagnostics and releases the guard',async()=>{
  let fail=true;const h=await accepted({onState:s=>{if(s.status==='context-not-generated'&&fail)throw Error('PRIVATE question source diagnostic');}});
  assert.throws(()=>assemble(h.session),safeContext('CONTEXT_FAILED'));fail=false;assert.equal(assemble(h.session).question,RAW);
});
