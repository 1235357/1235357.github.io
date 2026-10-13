import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfSession} from '../pdf-session.mjs';
import {chunkInWorker,ComputeError} from '../compute-source.mjs';
import {createComputeCommandHandler} from '../compute.worker.mjs';
import {createPageRecord} from '../pdf-source.mjs';
import {EMBEDDING_SPEC} from '../embedding-contract.mjs';
import {embedInWorker,embeddingReceipt,EmbeddingWorkerError} from '../embedding-source.mjs';
import {createEmbeddingCommandHandler} from '../embedding.worker.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getItemWindow} from '../item-window.mjs';
import {queryInWorker,queryResultReceipt,QueryWorkerError} from '../query-source.mjs';
import {rankCandidates} from '../retrieval.mjs';
import {createQueryCommandHandler} from '../query.worker.mjs';
import {createContextView} from '../context-view.mjs';
import {createCompleteRecordDisclosure} from '../complete-record-disclosure.mjs';
import {createGenerationView} from '../generation-view.mjs';
import {createRetrievalInspectionView} from '../retrieval-inspection-view.mjs';
import {ContextError} from '../context-contract.mjs';
import {createRuntimeFailure} from '../runtime-failure-contract.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const source = name => ({status:'extracted-not-indexed',source:{name,sha256:'a'.repeat(64),size:8},parser:{version:'6.4.299'},numPages:2,pages:[]});

test('source records commit only after a matching metadata terminal', async () => {
  const session = createPdfSession({extract:async()=>source('A'),runtimeId:'owner-a'});
  await session.select({name:'A'});
  assert.equal(session.snapshot().status,'extracted-not-indexed');
  assert.equal(session.document().source.name,'A');
  assert.equal(session.snapshot().lifecycle.terminal.payload.data.sourceSha256,'a'.repeat(64));
  assert.equal(Object.hasOwn(session.snapshot().lifecycle.terminal.payload.data,'pages'),false);
});

test('replaced A cannot commit after B is selected', async () => {
  const a=deferred(), b=deferred(); const calls=[];
  const session=createPdfSession({runtimeId:'owner-a',extract:(file,options)=>{
    calls.push(options); return file.name==='A'?a.promise:b.promise;
  }});
  const first=session.select({name:'A'}); const second=session.select({name:'B'});
  assert.equal(calls.length,2,'each selected document starts its owned extraction');
  assert.equal(calls[0].signal.aborted,true);
  const before=session.snapshot(); a.resolve(source('A')); await first;
  assert.deepEqual(session.snapshot(),before);
  assert.equal(session.document(),null);
  b.resolve(source('B')); await second;
  assert.equal(session.document().source.name,'B');
  assert.equal(session.snapshot().lifecycle.terminal.documentEpoch,2);
});

test('clear revokes identity and source without a late completion restoring it', async () => {
  const wait=deferred(); const session=createPdfSession({runtimeId:'owner-a',extract:()=>wait.promise});
  const operation=session.select({name:'A'}); session.clear();
  const cleared=session.snapshot(); wait.resolve(source('A')); await operation;
  assert.deepEqual(session.snapshot(),cleared);
  assert.equal(session.document(),null);
  assert.equal(session.snapshot().status,'idle');
});

test('cancelled operation cannot publish a late error or progress', async () => {
  const wait=deferred(); let onProgress;
  const session=createPdfSession({runtimeId:'owner-a',extract:(_,options)=>{onProgress=options.onProgress;return wait.promise;}});
  const operation=session.select({name:'A'}); session.cancel(); const cancelled=session.snapshot();
  assert.equal(typeof onProgress,'function','extraction receives its progress adapter');
  onProgress({completed:1,total:2,unit:'pages',estimated:false});
  wait.reject(Object.assign(new Error('private details'),{code:'PDF_INVALID'})); await operation;
  assert.deepEqual(session.snapshot(),cancelled);
  assert.equal(session.snapshot().status,'cancelled');
});

test('runtime errors are typed without persisting arbitrary exception text', async () => {
  const session=createPdfSession({runtimeId:'owner-a',extract:async()=>{throw new Error('private document text');}});
  await session.select({name:'A'});
  assert.equal(session.snapshot().status,'runtime-error');
  assert.equal(session.snapshot().error.code,'PDF_PARSE_ERROR');
  assert.equal(JSON.stringify(session.snapshot()).includes('private document text'),false);
});

test('malformed progress does not suppress a subsequent valid completion', async () => {
  const session=createPdfSession({runtimeId:'owner-a',extract:async(_,options)=>{
    options.onProgress({completed:5,total:2,unit:'pages',estimated:false});return source('A');
  }});
  await session.select({name:'A'});
  assert.equal(session.snapshot().status,'extracted-not-indexed');
});

test('documented parser error codes remain actionable without persisting exception text', async () => {
  for (const code of ['INVALID_INPUT','PARSER_VERSION_UNSUPPORTED','PDF_PASSWORD_REQUIRED']) {
    const session=createPdfSession({runtimeId:'error-owner',extract:async()=>{
      throw Object.assign(new Error('private text'),{code});
    }});
    await session.select({name:'A'});
    assert.equal(session.snapshot().error.code,code);
    assert.equal(JSON.stringify(session.snapshot()).includes('private text'),false);
  }
});

function extracted(name='private-A.pdf',text='Alpha Beta Gamma') {
  const sha256='a'.repeat(64),parserVersion='6.4.299';
  return {schemaVersion:1,status:'extracted-not-indexed',source:{name,sha256,size:99},
    parser:{name:'pdfjs',version:parserVersion,policyVersion:'text-items-v1',disableNormalization:true},
    workerMode:'node-fake',numPages:1,pages:[createPageRecord({sourceSha256:sha256,
      parserVersion,physicalPageNumber:1,pageLabel:'i',page:{view:[0,0,100,100],rotate:0,userUnit:1},
      textContent:{items:[{str:text,dir:'ltr',transform:[1,0,0,1,0,0],width:20,height:10,fontName:'f1',hasEOL:false}]}})]};
}
const chunkOptions={maxChunkUtf16:8,overlapUtf16:2};
function workerPackets(record,identity,options={}) {
  const packets=[];
  createComputeCommandHandler(packet=>packets.push(packet))({kind:'chunk-source',identity,source:record,options});
  assert.equal(packets.at(-1).event.kind,'result','the hand-authored source must produce real chunks');
  return packets;
}
const completeState=session=>({snapshot:session.snapshot(),document:session.document(),chunks:session.chunks()});
const fixedComputeError=code=>error=>error instanceof ComputeError&&error.code===code;
function controlledSession(extra={}) {
  const tasks=[];let incarnation=0;
  const session=createPdfSession({runtimeId:'parser-owner',runtimeIdFactory:()=>`compute-${++incarnation}`,
    extract:async file=>extracted(file.name),compute:(record,options)=>{
      const pending=deferred();tasks.push({record,options,...pending});return pending.promise;
    },...extra});
  return {session,tasks};
}
async function selected(extra={}) {
  const harness=controlledSession(extra);await harness.session.select({name:'private-A.pdf'});return harness;
}
function settle(task) {
  const packets=workerPackets(task.record,task.options.identity,task.options.chunkOptions);
  task.options.onProgress(packets[0].event);task.resolve(packets[1]);return packets;
}

// Replace only the native channel. The real session, adapter and command handler
// all run; these tests do not claim native browser-worker acceptance.
class SessionWorker {
  listeners=new Map();packets=[];terminated=0;
  addEventListener(type,callback){
    if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);
  }
  removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
  postMessage(command){createComputeCommandHandler(packet=>this.packets.push(packet))(command);}
  terminate(){this.terminated++;}
  emit(packet){for(const callback of [...(this.listeners.get('message')??[])])callback({data:packet});}
  ready(){this.emit({kind:'compute-ready',protocolVersion:1,workerVersion:'chunks-v1'});}
}

test('chunk lifecycle preserves actual index events and commits real adapter output outside metadata',async()=>{
  const worker=new SessionWorker(),notifications=[];
  const {session}=await selected({compute:chunkInWorker,
    computeOptions:{workerFactory:()=>worker},onState:state=>notifications.push(state)});
  assert.equal(typeof session.chunk,'function','the accepted source must support an owned chunk operation');
  assert.equal(session.chunks(),null);
  const before=session.snapshot(),record=session.document();
  const operation=session.chunk(chunkOptions);
  assert.equal(session.snapshot().status,'chunking');assert.equal(session.chunks(),null);
  assert.equal(session.snapshot().lifecycle.documentEpoch,before.lifecycle.documentEpoch);
  assert.notEqual(session.snapshot().lifecycle.runtimeId,before.lifecycle.runtimeId);
  worker.ready();const [progress,terminal]=worker.packets;
  worker.emit(progress);
  assert.deepEqual(session.snapshot().lifecycle.active,{protocolVersion:1,runtimeId:'compute-1',
    operationId:'op-1',documentEpoch:1,operation:'ingest',lastSeq:1,stage:'index',progress:progress.event.payload});
  worker.emit(terminal);await operation;
  assert.equal(session.snapshot().status,'chunked-not-embedded');assert.equal(session.document(),record);
  assert.deepEqual(session.chunks(),terminal.artifact);
  assert.deepEqual(session.snapshot().lifecycle.terminal,terminal.event);
  assert.equal(session.chunks().chunks[0].text,'Alpha Be');
  assert.ok(notifications.some(state=>state.status==='chunking'&&state.lifecycle.active.stage==='index'));
  const metadata=JSON.stringify(session.snapshot());
  for(const privateValue of ['private-A.pdf','Alpha','textItems','segments','"pages"'])assert.equal(metadata.includes(privateValue),false);
  assert.equal(Object.hasOwn(session.snapshot().lifecycle.terminal.payload.data,'chunks'),false);
});

test('caller computation options cannot replace the owned identity signal progress or chunk options',async()=>{
  const worker=new SessionWorker(),foreignSignal=new AbortController().signal;
  const {session}=await selected({compute:chunkInWorker,computeOptions:{workerFactory:()=>worker,
    identity:{runtimeId:'foreign'},signal:foreignSignal,onProgress:()=>{throw new Error('private callback');},
    chunkOptions:{maxChunkUtf16:1}}});
  assert.equal(typeof session.chunk,'function');
  const operation=session.chunk(chunkOptions);worker.ready();worker.emit(worker.packets[0]);worker.emit(worker.packets[1]);
  await operation;assert.equal(session.snapshot().status,'chunked-not-embedded');
  assert.equal(session.chunks().chunker.maxChunkUtf16,8);
  assert.equal(session.snapshot().lifecycle.terminal.runtimeId,'compute-1');
});

test('maximum-sequence real adapter progress cannot strand a session after protocol refusal and owned cleanup',async()=>{
  const worker=new SessionWorker();
  const {session}=await selected({compute:chunkInWorker,computeOptions:{workerFactory:()=>worker}});
  const record=session.document(),operation=session.chunk(chunkOptions);worker.ready();
  const progress=structuredClone(worker.packets[0]);progress.event.seq=Number.MAX_SAFE_INTEGER;
  worker.emit(progress);worker.emit(worker.packets[1]);await operation;
  assert.equal(worker.terminated,1,'the real adapter terminates its rejected worker');
  for(const listeners of worker.listeners.values())assert.equal(listeners.size,0);
  assert.equal(session.snapshot().status,'runtime-error');assert.equal(session.snapshot().lifecycle.active,null);
  assert.equal(session.snapshot().error.code,'WORKER_PROTOCOL_ERROR');
  assert.equal(session.snapshot().lifecycle.terminal.seq,1,'refused maximum progress does not consume the fallback sequence');
  assert.equal(session.document(),record);assert.equal(session.chunks(),null);
  const completed=completeState(session);worker.emit(progress);worker.emit(worker.packets[1]);session.cancel();
  assert.deepEqual(completeState(session),completed);
});

for(const [progressSeq,errorSeq]of [[Number.MAX_SAFE_INTEGER,1],
  [Number.MAX_SAFE_INTEGER-1,Number.MAX_SAFE_INTEGER]])
test(`injected compute progress ${progressSeq} leaves a safe sequence for typed error settlement`,async()=>{
  const {session,tasks}=await selected(),record=session.document(),operation=session.chunk();
  const progress=structuredClone(workerPackets(tasks[0].record,tasks[0].options.identity)[0].event);
  progress.seq=progressSeq;tasks[0].options.onProgress(progress);
  tasks[0].reject(new ComputeError('WORKER_PROTOCOL_ERROR'));await operation;
  assert.equal(session.snapshot().status,'runtime-error');assert.equal(session.snapshot().lifecycle.active,null);
  assert.equal(session.snapshot().error.code,'WORKER_PROTOCOL_ERROR');
  assert.equal(session.snapshot().lifecycle.terminal.seq,errorSeq);
  assert.equal(session.document(),record);assert.equal(session.chunks(),null);
  assert.equal(JSON.stringify(session.snapshot()).includes('private'),false);
  const retry=session.chunk();session.cancel();assert.equal(tasks[1].options.signal.aborted,true);
  tasks[1].reject(new ComputeError('ABORTED'));await retry;
});

test('invalid chunk invocations preserve the complete state and accepted artifacts',async()=>{
  const {session,tasks}=controlledSession();
  assert.equal(typeof session.chunk,'function');
  const idle=completeState(session);await assert.rejects(session.chunk(),fixedComputeError('INVALID_COMPUTE_CONFIG'));
  assert.deepEqual(completeState(session),idle);
  await session.select({name:'private-A.pdf'});
  const first=session.chunk();const active=completeState(session);
  await assert.rejects(session.chunk(),fixedComputeError('INVALID_COMPUTE_CONFIG'));
  assert.deepEqual(completeState(session),active);settle(tasks[0]);await first;
  const parse=deferred(),parseOnly=createPdfSession({runtimeId:'parse-only',extract:()=>parse.promise});
  const parsing=parseOnly.select({name:'private.pdf'}),before=completeState(parseOnly);
  await assert.rejects(parseOnly.chunk(),fixedComputeError('INVALID_COMPUTE_CONFIG'));
  assert.deepEqual(completeState(parseOnly),before);parse.resolve(extracted());await parsing;
  const accepted=completeState(parseOnly);
  await assert.rejects(parseOnly.chunk(),fixedComputeError('INVALID_COMPUTE_CONFIG'));
  assert.deepEqual(completeState(parseOnly),accepted);
});

test('runtime factory failure or reuse leaves prior chunks and lifecycle unchanged',async()=>{
  let next='compute-A';const {session,tasks}=await selected({runtimeIdFactory:()=>{
    if(next instanceof Error)throw next;return next;
  }});
  assert.equal(typeof session.chunk,'function');
  let operation=session.chunk();settle(tasks[0]);await operation;
  next='compute-B';operation=session.chunk();settle(tasks[1]);await operation;
  const before=completeState(session);
  for(const invalid of ['compute-A','compute-B','parser-owner','',null,42,new Error('private filename.pdf')]){
    next=invalid;await assert.rejects(session.chunk(),fixedComputeError('INVALID_COMPUTE_CONFIG'));
    assert.deepEqual(completeState(session),before);
  }
});

test('rechunk clears old chunks before work while preserving the selected document epoch',async()=>{
  const {session,tasks}=await selected();assert.equal(typeof session.chunk,'function');
  let operation=session.chunk(chunkOptions);settle(tasks[0]);await operation;
  const before=session.snapshot(),record=session.document();operation=session.chunk();
  assert.equal(session.chunks(),null);assert.equal(session.document(),record);assert.equal(session.snapshot().status,'chunking');
  assert.equal(session.snapshot().lifecycle.documentEpoch,before.lifecycle.documentEpoch);
  assert.equal(session.snapshot().lifecycle.runtimeId,'compute-2');
  assert.equal(session.snapshot().lifecycle.active.operationId,'op-1');
  settle(tasks[1]);await operation;assert.equal(session.snapshot().status,'chunked-not-embedded');
});

test('chunk cancellation revokes before abort retains source and permits retry despite late A events',async()=>{
  const {session,tasks}=await selected();assert.equal(typeof session.chunk,'function');
  const record=session.document(),operation=session.chunk();let abortState;
  tasks[0].options.signal.addEventListener('abort',()=>{abortState=completeState(session);});
  session.cancel();assert.equal(abortState.snapshot.lifecycle.active,null);
  assert.equal(abortState.snapshot.lifecycle.terminal.payload.reason,'user');
  assert.equal(session.document(),record);assert.equal(session.chunks(),null);assert.equal(session.snapshot().status,'cancelled');
  const retry=session.chunk(chunkOptions),before=completeState(session);
  settle(tasks[0]);await operation;assert.deepEqual(completeState(session),before);
  settle(tasks[1]);await retry;assert.equal(session.snapshot().status,'chunked-not-embedded');
  assert.equal(session.snapshot().lifecycle.runtimeId,'compute-2');
});

test('cancel refuses synchronous abort-listener chunk reentry and preserves the retry aborter',async()=>{
  const {session,tasks}=await selected(),record=session.document();
  const first=session.chunk();let reentrant,duringAbort;
  tasks[0].options.signal.addEventListener('abort',()=>{
    duringAbort=completeState(session);reentrant=session.chunk(chunkOptions);reentrant.catch(()=>{});
  },{once:true});
  session.cancel();
  assert.equal(tasks.length,1,'abort dispatch cannot start computation beneath cancellation');
  assert.equal(tasks[0].options.signal.aborted,true);
  assert.equal(session.snapshot().status,'cancelled');assert.equal(session.snapshot().lifecycle.active,null);
  assert.equal(session.document(),record);assert.equal(session.chunks(),null);
  assert.deepEqual(duringAbort,completeState(session));
  await assert.rejects(reentrant,fixedComputeError('INVALID_COMPUTE_CONFIG'));
  const retry=session.chunk(chunkOptions),retryState=completeState(session);
  assert.equal(tasks.length,2);assert.equal(session.snapshot().lifecycle.runtimeId,'compute-2');
  settle(tasks[0]);await first;assert.deepEqual(completeState(session),retryState);
  session.cancel();assert.equal(tasks[1].options.signal.aborted,true,'retry retains its physical cancellation owner');
  const cancelled=completeState(session);tasks[1].reject(new ComputeError('ABORTED'));await retry;
  assert.deepEqual(completeState(session),cancelled);
  const next=session.chunk(chunkOptions);settle(tasks[2]);await next;
  assert.equal(session.snapshot().status,'chunked-not-embedded');assert.equal(session.document(),record);
});

test('clear refuses synchronous abort-listener chunk reentry and leaves an idle empty session',async()=>{
  const {session,tasks}=await selected();const first=session.chunk();let reentrant,duringAbort;
  tasks[0].options.signal.addEventListener('abort',()=>{
    duringAbort=completeState(session);reentrant=session.chunk();reentrant.catch(()=>{});
  },{once:true});
  session.clear();
  assert.equal(tasks.length,1,'abort dispatch cannot start computation beneath clearing');
  assert.equal(tasks[0].options.signal.aborted,true);
  assert.equal(session.snapshot().status,'idle');assert.equal(session.snapshot().lifecycle.active,null);
  assert.equal(session.document(),null);assert.equal(session.chunks(),null);
  assert.deepEqual(duringAbort,completeState(session));
  await assert.rejects(reentrant,fixedComputeError('INVALID_COMPUTE_CONFIG'));
  const cleared=completeState(session);settle(tasks[0]);await first;
  assert.deepEqual(completeState(session),cleared);
  await session.select({name:'private-C.pdf'});const next=session.chunk();
  session.cancel();assert.equal(tasks[1].options.signal.aborted,true);
  tasks[1].reject(new ComputeError('ABORTED'));await next;
  assert.equal(session.document().source.name,'private-C.pdf');
});

test('select refuses synchronous abort-listener selection reentry and commits the outer replacement',async()=>{
  const parses=[],names=[];
  const {session,tasks}=await selected({extract:file=>{
    names.push(file.name);if(file.name==='private-A.pdf')return Promise.resolve(extracted(file.name));
    const pending=deferred();parses.push({file,...pending});return pending.promise;
  }});
  const first=session.chunk();let reentrant,duringAbort;
  tasks[0].options.signal.addEventListener('abort',()=>{
    duringAbort=completeState(session);reentrant=session.select({name:'private-B.pdf'});reentrant.catch(()=>{});
  },{once:true});
  const replacement=session.select({name:'private-C.pdf'});replacement.catch(()=>{});
  assert.deepEqual(names,['private-A.pdf','private-C.pdf'],'only the requested outer replacement starts extraction');
  assert.equal(tasks[0].options.signal.aborted,true);
  await assert.rejects(reentrant,fixedComputeError('INVALID_COMPUTE_CONFIG'));
  assert.equal(duringAbort.snapshot.lifecycle.active,null);assert.equal(duringAbort.document,null);
  assert.equal(duringAbort.chunks,null);assert.equal(duringAbort.snapshot.status,'idle');
  assert.equal(session.snapshot().status,'parsing');assert.equal(session.snapshot().lifecycle.documentEpoch,2);
  const replacing=completeState(session);settle(tasks[0]);await first;
  assert.deepEqual(completeState(session),replacing);
  parses[0].resolve(extracted('private-C.pdf'));await assert.doesNotReject(replacement);
  assert.equal(session.document().source.name,'private-C.pdf');assert.equal(session.snapshot().status,'extracted-not-indexed');
  const next=session.chunk();session.cancel();assert.equal(tasks[1].options.signal.aborted,true);
  tasks[1].reject(new ComputeError('ABORTED'));await next;
});

test('late chunk error cannot clear a newer aborter or publish over its state',async()=>{
  const {session,tasks}=await selected();assert.equal(typeof session.chunk,'function');
  const first=session.chunk();session.cancel();const second=session.chunk();
  const before=completeState(session);tasks[0].reject(new Error('private stale error.pdf'));await first;
  assert.deepEqual(completeState(session),before);
  session.cancel();assert.equal(tasks[1].options.signal.aborted,true);
  tasks[1].reject(new ComputeError('ABORTED'));await second;assert.equal(session.document().source.name,'private-A.pdf');
});

test('clear revokes chunk identity before abort and late completion cannot restore either artifact',async()=>{
  const {session,tasks}=await selected();assert.equal(typeof session.chunk,'function');
  const operation=session.chunk();let duringAbort;
  tasks[0].options.signal.addEventListener('abort',()=>{duringAbort=completeState(session);});
  session.clear();assert.equal(duringAbort.snapshot.lifecycle.active,null);
  assert.equal(duringAbort.snapshot.lifecycle.terminal.payload.reason,'document-replaced');
  assert.equal(duringAbort.snapshot.lifecycle.documentEpoch,2);
  const cleared=completeState(session);settle(tasks[0]);await operation;
  assert.deepEqual(completeState(session),cleared);assert.equal(session.document(),null);assert.equal(session.chunks(),null);
});

for(const lateKind of ['result','error'])test(`identical-hash document replacement refuses old chunk ${lateKind} and progress`,async()=>{
  const {session,tasks}=await selected();assert.equal(typeof session.chunk,'function');
  const a=session.chunk();await session.select({name:'private-B.pdf'});const b=session.chunk();
  const before=completeState(session),oldPackets=workerPackets(tasks[0].record,tasks[0].options.identity);
  tasks[0].options.onProgress(oldPackets[0].event);
  if(lateKind==='result')tasks[0].resolve(oldPackets[1]);else tasks[0].reject(new Error('private A failure'));
  await a;assert.deepEqual(completeState(session),before);assert.equal(session.chunks(),null);
  settle(tasks[1]);await b;assert.equal(session.chunks().source.name,'private-B.pdf');
  assert.equal(session.snapshot().lifecycle.terminal.documentEpoch,2);
  session.clear();assert.equal(session.document(),null);assert.equal(session.chunks(),null);
});

test('malformed chunk progress is safely refused without suppressing the actual valid terminal',async()=>{
  const {session,tasks}=await selected();assert.equal(typeof session.chunk,'function');const operation=session.chunk();
  const task=tasks[0],packets=workerPackets(task.record,task.options.identity),before=completeState(session);
  for(const mutate of [event=>{event.runtimeId='foreign';},event=>{event.documentEpoch++;},
    event=>{event.stage='parse';},event=>{event.seq=0;},event=>{event.seq=Number.MAX_SAFE_INTEGER;},event=>{event.kind='result';},
    event=>{event.payload.completed=9;event.payload.total=2;},event=>{event.payload.text='private';}]){
    const event=structuredClone(packets[0].event);mutate(event);task.options.onProgress(event);
    assert.deepEqual(completeState(session),before);
  }
  task.options.onProgress(null);assert.deepEqual(completeState(session),before);
  task.options.onProgress(packets[0].event);const progressed=completeState(session);
  task.options.onProgress(packets[0].event);assert.deepEqual(completeState(session),progressed);
  task.resolve(packets[1]);await operation;assert.equal(session.snapshot().status,'chunked-not-embedded');
});

for(const [name,mutate]of [
  ['missing event',packet=>{delete packet.event;}],['missing artifact',packet=>{delete packet.artifact;}],
  ['wrong runtime',packet=>{packet.event.runtimeId='foreign';}],['wrong stage',packet=>{packet.event.stage='parse';}],
  ['progress as terminal',packet=>{packet.event.kind='progress';}],['full artifact in metadata',packet=>{packet.event.payload.data=packet.artifact;}],
  ['extra private metadata',packet=>{packet.event.payload.data.filename='private.pdf';}],
])test(`malformed chunk terminal ${name} produces a fixed error without committing source text`,async()=>{
  const {session,tasks}=await selected();assert.equal(typeof session.chunk,'function');const operation=session.chunk();
  const packet=structuredClone(workerPackets(tasks[0].record,tasks[0].options.identity)[1]);mutate(packet);
  tasks[0].resolve(packet);await operation;
  assert.equal(session.snapshot().status,'runtime-error');assert.equal(session.snapshot().error.code,'WORKER_PROTOCOL_ERROR');
  assert.equal(session.snapshot().lifecycle.active,null);assert.equal(session.snapshot().lifecycle.terminal.kind,'error');
  assert.equal(session.chunks(),null);assert.equal(session.document().source.name,'private-A.pdf');
  assert.equal(JSON.stringify(session.snapshot()).includes('private'),false);
  assert.equal(JSON.stringify(session.snapshot()).includes('Alpha'),false);
});

test('compute rejection preserves typed safe codes and never records raw exception messages',async()=>{
  for(const code of ['INVALID_CONFIG','COMPUTE_TIMEOUT','CHUNK_LIMIT','EMPTY_SOURCE','untrusted']){
    const {session,tasks}=await selected();assert.equal(typeof session.chunk,'function');const operation=session.chunk();
    const packets=workerPackets(tasks[0].record,tasks[0].options.identity);tasks[0].options.onProgress(packets[0].event);
    tasks[0].reject(Object.assign(new Error('private source filename.pdf'),{code}));await operation;
    assert.equal(session.snapshot().error.code,code==='untrusted'?'COMPUTE_FAILED':code);
    assert.equal(session.snapshot().lifecycle.terminal.seq,2);
    assert.equal(session.snapshot().lifecycle.terminal.runtimeId,'compute-1');
    assert.equal(session.snapshot().status,'runtime-error');assert.equal(session.chunks(),null);
    assert.equal(session.document().source.name,'private-A.pdf');assert.equal(JSON.stringify(session.snapshot()).includes('private'),false);
  }
});

const DOWNLOAD_BYTES=113629084;
const embeddingState=session=>({...completeState(session),embeddings:session.embeddings()});
const fixedEmbeddingError=code=>error=>error instanceof EmbeddingWorkerError&&error.code===code;
function embeddedArtifact(input){
  const count=input.counts.chunks;
  return {schemaVersion:1,status:'embedded-not-retrieved',sourceSha256:input.source.sha256,
    representationId:EMBEDDING_SPEC.version,representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',
    counts:{chunks:count,totalTokens:count*3,dimensions:384},
    receipt:{verifiedBytes:DOWNLOAD_BYTES,networkBytes:DOWNLOAD_BYTES,cacheBytes:0,elapsedMs:12.5},
    chunkIds:input.chunks.map(chunk=>chunk.id),tokenIds:input.chunks.map(()=>[101,1000,102]),
    vectors:input.chunks.map(()=>[1,...Array(383).fill(0)])};
}
function embeddingPackets(task){
  const count=task.record.counts.chunks;
  const progress=[['download',0,DOWNLOAD_BYTES,'bytes'],['download',DOWNLOAD_BYTES,DOWNLOAD_BYTES,'bytes'],
    ['initialize',0,null,'chunks'],['encode',0,count,'chunks'],['encode',count,count,'chunks']]
    .map(([stage,completed,total,unit],index)=>({...task.options.identity,kind:'progress',stage,seq:index+1,
      payload:{completed,total,unit,estimated:false}}));
  const artifact=embeddedArtifact(task.record);
  return {progress,result:{event:{...task.options.identity,kind:'result',stage:'encode',seq:6,
    payload:{data:structuredClone(embeddingReceipt(artifact))}},artifact}};
}
function finishEmbedding(task){const packet=embeddingPackets(task);packet.progress.forEach(task.options.onProgress);task.resolve(packet.result);return packet.result;}
async function chunkedSession(extra={}){
  const embeds=[];
  const harness=await selected({embed:(record,options)=>{
    const pending=deferred();embeds.push({record,options,...pending});return pending.promise;
  },...extra});
  const operation=harness.session.chunk(chunkOptions);settle(harness.tasks[0]);await operation;
  return {...harness,embeds};
}

test('embedding is an explicit action with no adapter effects during select or chunk',async()=>{
  const {session,embeds}=await chunkedSession();
  assert.equal(typeof session.embed,'function','accepted chunks need an explicit embedding action');
  assert.equal(typeof session.embeddings,'function');assert.equal(session.embeddings(),null);assert.equal(embeds.length,0);
  const before=session.snapshot(),source=session.document(),chunks=session.chunks();
  const operation=session.embed();assert.equal(session.snapshot().status,'embedding');
  assert.equal(session.snapshot().lifecycle.active.operation,'embed');
  assert.equal(session.snapshot().lifecycle.documentEpoch,before.lifecycle.documentEpoch);
  assert.notEqual(session.snapshot().lifecycle.runtimeId,before.lifecycle.runtimeId);
  const terminal=finishEmbedding(embeds[0]);await operation;
  assert.equal(session.snapshot().status,'embedded-not-retrieved');assert.equal(session.document(),source);assert.equal(session.chunks(),chunks);
  assert.deepEqual(session.snapshot().lifecycle.terminal,terminal.event);assert.deepEqual(session.embeddings(),terminal.artifact);
  assert.ok(Object.isFrozen(session.embeddings().vectors[0]));terminal.artifact.vectors[0][0]=0;
  assert.equal(session.embeddings().vectors[0][0],1);
  for(const text of ['private-A.pdf','Alpha','tokenIds','vectors','chunkIds'])assert.equal(JSON.stringify(session.snapshot()).includes(text),false);
});

test('embedding preconditions and absent adapter preserve state without side effects',async()=>{
  const {session}=controlledSession({embed:()=>{throw new Error('must not start');}});
  assert.equal(typeof session.embed,'function');const idle=embeddingState(session);
  await assert.rejects(session.embed(),fixedEmbeddingError('INVALID_EMBEDDING_CONFIG'));assert.deepEqual(embeddingState(session),idle);
  await session.select({name:'private-A.pdf'});const sourceOnly=embeddingState(session);
  await assert.rejects(session.embed(),fixedEmbeddingError('INVALID_EMBEDDING_CONFIG'));assert.deepEqual(embeddingState(session),sourceOnly);
  const absent=await chunkedSession({embed:undefined});const before=embeddingState(absent.session);
  await assert.rejects(absent.session.embed(),fixedEmbeddingError('INVALID_EMBEDDING_CONFIG'));assert.deepEqual(embeddingState(absent.session),before);
});

test('caller embedding options cannot replace the owned identity signal or progress',async()=>{
  const foreign=new AbortController(),{session,embeds}=await chunkedSession({embeddingOptions:{identity:{runtimeId:'foreign'},
    signal:foreign.signal,onProgress:()=>{throw new Error('PRIVATE');}}});
  const operation=session.embed({identity:{runtimeId:'also-foreign'},signal:foreign.signal,onProgress:()=>{throw new Error('PRIVATE');}});
  assert.equal(embeds[0].options.identity.operation,'embed');assert.notEqual(embeds[0].options.signal,foreign.signal);
  finishEmbedding(embeds[0]);await operation;assert.equal(session.snapshot().status,'embedded-not-retrieved');
});

test('embedding runtime factory throw or reuse preserves accepted vectors',async()=>{
  let next='chunk-A';const {session,embeds}=await chunkedSession({runtimeIdFactory:()=>{if(next instanceof Error)throw next;return next;}});
  next='embed-A';const operation=session.embed();finishEmbedding(embeds[0]);await operation;const before=embeddingState(session);
  for(const invalid of ['chunk-A','embed-A','parser-owner','',null,42,new Error('PRIVATE')]){
    next=invalid;await assert.rejects(session.embed(),fixedEmbeddingError('INVALID_EMBEDDING_CONFIG'));
    assert.deepEqual(embeddingState(session),before);
  }
});

test('embedding cancel revokes before synchronous abort callbacks and retains source and chunks',async()=>{
  const {session,embeds}=await chunkedSession(),source=session.document(),chunks=session.chunks();
  const first=session.embed();let during,reentrant;
  embeds[0].options.signal.addEventListener('abort',()=>{during=embeddingState(session);reentrant=session.embed();reentrant.catch(()=>{});session.clear();});
  session.cancel();await assert.rejects(reentrant,fixedEmbeddingError('INVALID_EMBEDDING_CONFIG'));
  assert.deepEqual(during,embeddingState(session));assert.equal(during.snapshot.lifecycle.active,null);assert.equal(during.embeddings,null);
  assert.equal(session.document(),source);assert.equal(session.chunks(),chunks);assert.equal(session.snapshot().status,'cancelled');
  const retry=session.embed(),before=embeddingState(session);finishEmbedding(embeds[0]);await first;
  assert.deepEqual(embeddingState(session),before);session.cancel();assert.equal(embeds[1].options.signal.aborted,true);
  embeds[1].reject(new EmbeddingWorkerError('ABORTED'));await retry;
});

for(const transition of ['clear','replace'])test(`${transition} clears embedding dependencies before abort dispatch`,async()=>{
  const {session,embeds}=await chunkedSession();const first=session.embed();let during,reentrant;
  embeds[0].options.signal.addEventListener('abort',()=>{during=embeddingState(session);reentrant=session.embed();reentrant.catch(()=>{});});
  if(transition==='clear')session.clear();else await session.select({name:'private-B.pdf'});
  await assert.rejects(reentrant,fixedEmbeddingError('INVALID_EMBEDDING_CONFIG'));
  assert.equal(during.document,null);assert.equal(during.chunks,null);assert.equal(during.embeddings,null);assert.equal(during.snapshot.lifecycle.active,null);
  const before=embeddingState(session);finishEmbedding(embeds[0]);await first;assert.deepEqual(embeddingState(session),before);
});

test('restart embedding and rechunk discard vectors while preserving their accepted dependencies',async()=>{
  const {session,tasks,embeds}=await chunkedSession();let operation=session.embed();finishEmbedding(embeds[0]);await operation;
  const source=session.document(),chunks=session.chunks();operation=session.embed();
  assert.equal(session.embeddings(),null);assert.equal(session.document(),source);assert.equal(session.chunks(),chunks);
  finishEmbedding(embeds[1]);await operation;operation=session.chunk();
  assert.equal(session.embeddings(),null);assert.equal(session.chunks(),null);assert.equal(session.document(),source);
  settle(tasks[1]);await operation;
});

for(const late of ['result','error'])test(`identical SHA replacement refuses old embedding ${late} and progress and preserves the new aborter`,async()=>{
  const {session,tasks,embeds}=await chunkedSession();const first=session.embed();await session.select({name:'private-B.pdf'});
  const chunk=session.chunk();settle(tasks[1]);await chunk;const second=session.embed(),before=embeddingState(session);
  const packet=embeddingPackets(embeds[0]);packet.progress.forEach(embeds[0].options.onProgress);
  if(late==='result')embeds[0].resolve(packet.result);else embeds[0].reject(new Error('PRIVATE'));
  await first;assert.deepEqual(embeddingState(session),before);session.cancel();assert.equal(embeds[1].options.signal.aborted,true);
  embeds[1].reject(new EmbeddingWorkerError('ABORTED'));await second;
});

test('stale or malformed embedding progress does not consume stage guard or sequence',async()=>{
  const {session,embeds}=await chunkedSession();const operation=session.embed(),task=embeds[0],packet=embeddingPackets(task),before=embeddingState(session);
  for(const mutate of [event=>{event.runtimeId='foreign';},event=>{event.documentEpoch++;},event=>{event.seq=0;},
    event=>{event.seq=Number.MAX_SAFE_INTEGER;},event=>{event.private='PRIVATE';},event=>{event.kind='result';},
    event=>{event.stage='encode';},event=>{event.payload.total--;},event=>{event.payload.completed=1;},
    event=>{event.payload.text='PRIVATE';},event=>{event.payload.estimated=true;}]){
    const event=structuredClone(packet.progress[0]);mutate(event);task.options.onProgress(event);assert.deepEqual(embeddingState(session),before);
  }
  task.options.onProgress(null);assert.deepEqual(embeddingState(session),before);
  task.options.onProgress(packet.progress[0]);const accepted=embeddingState(session);
  const wrong=structuredClone(packet.progress[1]);wrong.seq=1;task.options.onProgress(wrong);assert.deepEqual(embeddingState(session),accepted);
  packet.progress.slice(1).forEach(task.options.onProgress);task.resolve(packet.result);await operation;
  assert.equal(session.snapshot().status,'embedded-not-retrieved');
});

for(const [name,mutate]of [
  ['full text metadata',packet=>{packet.result.event.payload.data.text='PRIVATE';}],
  ['wrong identity',packet=>{packet.result.event.runtimeId='foreign';}],
  ['wrong stage',packet=>{packet.result.event.stage='index';}],
  ['wrong source',packet=>{packet.result.artifact.sourceSha256='b'.repeat(64);}],
  ['zero vectors',packet=>{packet.result.artifact.vectors[0].fill(0);}],
  ['nonfinite vector',packet=>{packet.result.artifact.vectors[0][0]=NaN;}],
  ['wrong receipt',packet=>{packet.result.event.payload.data.receipt.cacheBytes++;}],
  ['wrong dimensions',packet=>{packet.result.artifact.counts.dimensions=383;}],
  ['no complete encode',packet=>{packet.progress.pop();}],
])test(`embedding terminal refuses ${name} without partial vectors`,async()=>{
  const {session,embeds}=await chunkedSession(),chunks=session.chunks(),operation=session.embed(),packet=embeddingPackets(embeds[0]);
  mutate(packet);packet.progress.forEach(embeds[0].options.onProgress);embeds[0].resolve(packet.result);await operation;
  assert.equal(session.embeddings(),null);assert.equal(session.chunks(),chunks);assert.equal(session.snapshot().status,'runtime-error');
  assert.equal(session.snapshot().error.code,'WORKER_PROTOCOL_ERROR');assert.equal(session.snapshot().lifecycle.active,null);
  assert.equal(JSON.stringify(session.snapshot()).includes('PRIVATE'),false);
});

for(const stageIndex of [-1,1,2,4])test(`embedding safe error settles at last accepted stage after progress ${stageIndex}`,async()=>{
  const {session,embeds}=await chunkedSession(),operation=session.embed(),packet=embeddingPackets(embeds[0]);
  packet.progress.slice(0,stageIndex+1).forEach(embeds[0].options.onProgress);
  const thrown={get code(){throw new Error('PRIVATE');}};embeds[0].reject(thrown);await operation;
  assert.equal(session.snapshot().error.code,'EMBEDDING_FAILED');assert.equal(session.snapshot().lifecycle.active,null);
  assert.equal(session.snapshot().lifecycle.terminal.stage,stageIndex<0?'download':packet.progress[stageIndex].stage);
  assert.equal(session.snapshot().lifecycle.terminal.seq,stageIndex+2);assert.equal(session.embeddings(),null);
});

test('maximum safe progress reserves terminal capacity for an embedding failure',async()=>{
  const {session,embeds}=await chunkedSession(),operation=session.embed(),packet=embeddingPackets(embeds[0]);
  packet.progress[0].seq=Number.MAX_SAFE_INTEGER-1;embeds[0].options.onProgress(packet.progress[0]);
  embeds[0].reject(new EmbeddingWorkerError('GPU_UNAVAILABLE'));await operation;
  assert.equal(session.snapshot().lifecycle.terminal.seq,Number.MAX_SAFE_INTEGER);assert.equal(session.snapshot().error.code,'GPU_UNAVAILABLE');
});

class EmbeddingSessionWorker extends SessionWorker{
  postMessage(command){this.pending=createEmbeddingCommandHandler(packet=>this.packets.push(packet),{
    encode:async(input,{onProgress})=>{const task={record:input,options:{identity:command.identity}};
      for(const event of embeddingPackets(task).progress)onProgress(event.stage,event.payload);
      return embeddedArtifact(input);}})(command);}
  ready(){this.emit({kind:'embedding-ready',protocolVersion:1,workerVersion:'embedding-v2'});}
}
test('real embedding adapter and command handler integrate with the session through a controlled channel',async()=>{
  const worker=new EmbeddingSessionWorker(),{session}=await chunkedSession({embed:embedInWorker,embeddingOptions:{workerFactory:()=>worker}});
  const operation=session.embed();worker.ready();await worker.pending;worker.packets.forEach(packet=>worker.emit(packet));await operation;
  assert.equal(worker.terminated,1);assert.equal(session.snapshot().status,'embedded-not-retrieved');
  assert.deepEqual(session.snapshot().lifecycle.terminal,worker.packets.at(-1).event);
  assert.equal(session.embeddings().receipt.verifiedBytes,DOWNLOAD_BYTES);
});

// Minimal DOM at the platform boundary; the actual app renderer and session run.
// Native PDF/GPU/browser acceptance is deliberately left to the live IAB review.
class AppElement{
  constructor(tag='div'){this.tag=tag;this.children=[];this.listeners=new Map();this.textContent='';this.value='';this.disabled=false;this.open=false;this.hidden=false;}
  get tagName(){return this.tag;}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return (this._text??'')+this.children.map(child=>child.textContent).join('');}
  append(...children){this.children.push(...children);if(this.tag==='select'&&this.value===''&&this.children.length)this.value=String(this.children[0].value);}
  replaceChildren(...children){this.children=[];this._text='';if(this.tag==='select')this.value='';this.append(...children);}
  addEventListener(type,listener){this.listeners.set(type,listener);}
  removeEventListener(type,listener){if(this.listeners.get(type)===listener)this.listeners.delete(type);}
  setAttribute(name,value){this[name]=String(value);}
  removeAttribute(name){if(name==='value')this.value=undefined;}
  focus(){this.focused=true;}
  fire(type,event){this.listeners.get(type)?.(event);}
}
class AppFileInput extends AppElement{
  constructor(){super('input');this.files=[];}
  get value(){return this.fileValue;}
  set value(value){this.fileValue=String(value);if(value==='')this.files=[];}
}
function appHarness(harnessOptions={}){
  const ids=new Map(),extracts=[],computes=[],embeds=[],queries=[],windowListeners=new Map();let session,incarnation=0;
  const byId=id=>{if(!ids.has(id))ids.set(id,id==='pdf-file'?new AppFileInput():new AppElement(id.endsWith('select')?'select':'div'));return ids.get(id);};
  // These helpers model the restoration/chooser boundary. Only an explicit
  // changed selection emits change; setting the file control to '' clears files.
  const restoreFile=file=>{byId('pdf-file').value=`C:\\fakepath\\${file.name}`;byId('pdf-file').files=[file];};
  const chooseFile=file=>{const previous=byId('pdf-file').value;restoreFile(file);if(previous!==byId('pdf-file').value)byId('pdf-file').fire('change');};
  const dispatchWindow=(type,event={})=>{for(const listener of windowListeners.get(type)??[])listener({type,...event});};
  if(harnessOptions.restoredFile)restoreFile(harnessOptions.restoredFile);
  if(harnessOptions.restoredQuestion!==undefined)byId('question-input').value=harnessOptions.restoredQuestion;
  const context={document:{getElementById:byId,querySelector:selector=>byId(selector.slice(1)),createElement:tag=>new AppElement(tag)},window:{addEventListener(type,listener){
      if(!windowListeners.has(type))windowListeners.set(type,new Set());windowListeners.get(type).add(listener);}},
    URL,Worker:class{},pdfjs:{},extractPdf(){},chunkInWorker(){},embedInWorker(){},queryInWorker(){},getItemWindow,EMBEDDING_SPEC,
    createContextView,createGenerationView,createCompleteRecordDisclosure,createRetrievalInspectionView,ContextError,
    createPdfSession:options=>{session=createPdfSession({...options,runtimeId:'ui-parser',runtimeIdFactory:()=>`ui-${++incarnation}`,
      extract:(file,options)=>{extracts.push({file,options});return (harnessOptions.extract??(async selected=>extracted(selected.name)))(file,options);},compute:async(record,options)=>{
        computes.push({record,options});
        const packets=workerPackets(record,options.identity,harnessOptions.chunkOptions??chunkOptions);options.onProgress(packets[0].event);return packets[1];},
      embed:(record,options)=>{const pending=deferred();embeds.push({record,options,...pending});return pending.promise;},
      query:(record,passages,question,options)=>{const pending=deferred();queries.push({record,passages,question,options,...pending});return pending.promise;}});return session;}};
  const code=readFileSync(new URL('../pdf-app.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'')
    .replace(/^export function mountPdfApp/m,'function mountPdfApp')
    .replace(/import\.meta\.url/g,JSON.stringify('https://example.test/project/browser-rag/pdf-app.mjs'));
  vm.runInNewContext(`${code}\nmountPdfApp();`,context);return {session,extracts,computes,embeds,queries,byId,restoreFile,chooseFile,dispatchWindow};
}
const appText=node=>[node.textContent,...node.children.map(appText)].join('\n');
const appNodes=node=>[node,...node.children.flatMap(appNodes)];
function appCompleteRecord(detail){
  const nodes=appNodes(detail),pre=nodes.find(node=>node.tag==='pre');assert.ok(pre);
  if(pre.className!=='bounded-text-page')return pre.textContent;
  const previous=nodes.find(node=>node.tag==='button'&&node.textContent==='Previous page'),next=nodes.find(node=>node.tag==='button'&&node.textContent==='Next page'),parts=[];
  while(!previous.disabled)previous.fire('click');
  for(let i=0;i<100000;i++){assert.ok(pre.textContent.length<=24576);assert.ok(pre.textContent.split(/\r\n|[\r\n]/).length<=160);parts.push(pre.textContent);if(next.disabled)return parts.join('');next.fire('click');}
  assert.fail('Record pages did not reach terminal page');
}
const appTick=()=>new Promise(resolve=>setImmediate(resolve));
function uiQueryPackets(task){
  const tokens=[101,1000,102],count=task.record.counts.chunks;
  const query={schemaVersion:1,status:'query-embedded-not-retrieved',representationId:EMBEDDING_SPEC.version,
    representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',counts:{totalTokens:tokens.length,dimensions:384},
    receipt:{verifiedBytes:DOWNLOAD_BYTES,networkBytes:0,cacheBytes:DOWNLOAD_BYTES,elapsedMs:7.25},
    tokenIds:tokens,vector:[1,...Array(383).fill(0)]};
  const retrieval=rankCandidates(task.record,task.passages,{representationId:query.representationId,
    representation:query.representation,vector:query.vector},{topK:task.options.topK}),artifact={query,retrieval};
  const progress=[['download',0,DOWNLOAD_BYTES,'bytes'],['download',DOWNLOAD_BYTES,DOWNLOAD_BYTES,'bytes'],
    ['initialize',0,null,'tokens'],['encode',0,tokens.length,'tokens'],['encode',tokens.length,tokens.length,'tokens'],
    ['rank',0,count,'chunks'],['rank',count,count,'chunks']]
    .map(([stage,completed,total,unit],index)=>({...task.options.identity,kind:'progress',stage,seq:index+1,
      payload:{completed,total,unit,estimated:false}}));
  return {progress,result:{event:{...task.options.identity,kind:'result',stage:'rank',seq:8,
    payload:{data:queryResultReceipt(artifact)}},artifact}};
}
async function uiEmbedded(harnessOptions={}){
  const harness=appHarness(harnessOptions);await harness.session.select({name:'private-ui.pdf'});await harness.session.chunk();
  const operation=harness.session.embed();finishEmbedding(harness.embeds[0]);await operation;return harness;
}
async function uiFinishQuery(task){const packet=uiQueryPackets(task);packet.progress.forEach(task.options.onProgress);task.resolve(packet.result);await appTick();return packet;}

test('app fresh startup clears a browser-restored file selection so the same PDF can be selected explicitly',async()=>{
  const file={name:'selectable-test.pdf'},rawQuestion='  PRIVATE restored question  ';let parses=0;
  const {session,queries,embeds,byId,chooseFile}=appHarness({restoredFile:file,restoredQuestion:rawQuestion,
    extract:async selected=>{parses++;assert.equal(selected,file);return extracted(selected.name);}});
  assert.equal(byId('pdf-file').value,'','an empty fresh session must release the browser-restored selection');
  assert.deepEqual(byId('pdf-file').files,[]);
  assert.equal(parses,0);assert.equal(queries.length,0);assert.equal(embeds.length,0);
  assert.equal(session.snapshot().status,'idle');assert.equal(session.document(),null);assert.equal(session.question(),null);
  assert.equal(byId('question-input').value,rawQuestion);assert.equal(JSON.stringify(session.snapshot()).includes('PRIVATE'),false);
  // The browser fires change only for a changed file selection. Exercise that
  // boundary while keeping the actual app change handler and session intact.
  chooseFile(file);
  await appTick();assert.equal(parses,1);assert.equal(session.document().source.name,file.name);
  assert.equal(session.snapshot().status,'extracted-not-indexed');assert.equal(queries.length,0);assert.equal(embeds.length,0);
});

test('app pagehide releases the same-DOM file selection and pageshow waits for an explicit same-file choice',async()=>{
  const file={name:'same-DOM.pdf'},rawQuestion='  PRIVATE question kept in the control  ';
  const {session,extracts,computes,embeds,queries,byId,chooseFile,dispatchWindow}=appHarness();
  chooseFile(file);await appTick();await session.chunk();
  const embedding=session.embed();finishEmbedding(embeds[0]);await embedding;
  byId('question-input').value=rawQuestion;byId('query-top-k').value='1';byId('run-query').fire('click');await uiFinishQuery(queries[0]);
  assert.equal(session.snapshot().status,'query-candidates-only');
  assert.ok(session.document());assert.ok(session.chunks());assert.ok(session.embeddings());
  assert.ok(session.queryEmbedding());assert.ok(session.retrieval());

  dispatchWindow('pagehide',{persisted:true});
  const cleared=session.snapshot();
  assert.equal(cleared.status,'idle');assert.equal(cleared.lifecycle.active,null);
  assert.equal(session.document(),null);assert.equal(session.chunks(),null);assert.equal(session.embeddings(),null);
  assert.equal(session.question(),null);assert.equal(session.queryEmbedding(),null);assert.equal(session.retrieval(),null);
  assert.equal(byId('pdf-file').value,'','leaving must release the selected file in the retained DOM');
  assert.deepEqual(byId('pdf-file').files,[]);
  dispatchWindow('pageshow',{persisted:true});await appTick();
  assert.deepEqual(session.snapshot(),cleared,'showing an empty retained session must not advance its epoch');
  assert.equal(byId('pdf-file').value,'');assert.deepEqual(byId('pdf-file').files,[]);
  assert.equal(byId('question-input').value,rawQuestion);
  assert.deepEqual([extracts.length,computes.length,embeds.length,queries.length],[1,1,1,1],'lifecycle events do not parse or run compute');

  chooseFile(file);await appTick();
  assert.equal(extracts.length,2,'reselecting the released same file starts exactly one additional parse');
  assert.equal(session.document().source.name,file.name);assert.equal(session.snapshot().status,'extracted-not-indexed');
  assert.deepEqual(byId('pdf-file').files,[file]);
  assert.deepEqual([computes.length,embeds.length,queries.length],[1,1,1]);
});

test('app pageshow clears a file restored after fresh initialization without parsing or erasing literal question text',async()=>{
  const file={name:'late-restored.pdf'},rawQuestion='  <script>PRIVATE restored literal</script>\n& <img src=x>  ';
  const {session,extracts,computes,embeds,queries,byId,restoreFile,chooseFile,dispatchWindow}=appHarness({restoredQuestion:rawQuestion});
  assert.equal(byId('pdf-file').value,'');assert.deepEqual(byId('pdf-file').files,[]);
  const idle=session.snapshot();restoreFile(file);
  assert.equal(byId('pdf-file').value,`C:\\fakepath\\${file.name}`);assert.deepEqual(byId('pdf-file').files,[file]);
  dispatchWindow('pageshow',{persisted:false});await appTick();
  assert.equal(byId('pdf-file').value,'','pageshow releases restoration that arrived after module initialization');
  assert.deepEqual(byId('pdf-file').files,[]);assert.deepEqual(session.snapshot(),idle);
  assert.equal(session.document(),null);assert.equal(session.question(),null);assert.equal(session.queryEmbedding(),null);assert.equal(session.retrieval(),null);
  assert.equal(byId('question-input').value,rawQuestion);assert.equal(JSON.stringify(session.snapshot()).includes('PRIVATE'),false);
  assert.deepEqual([extracts.length,computes.length,embeds.length,queries.length],[0,0,0,0]);
  chooseFile(file);await appTick();
  assert.equal(extracts.length,1);assert.equal(session.document().source.name,file.name);
  assert.equal(byId('question-input').value,rawQuestion);assert.deepEqual([computes.length,embeds.length,queries.length],[0,0,0]);
});

test('app pageshow preserves accepted source chunks passage vectors query candidates and file selection',async()=>{
  const file={name:'accepted-before-show.pdf'},rawQuestion='  PRIVATE accepted question\n  ';
  const {session,extracts,computes,embeds,queries,byId,chooseFile,dispatchWindow}=appHarness();
  chooseFile(file);await appTick();await session.chunk();
  const embedding=session.embed();finishEmbedding(embeds[0]);await embedding;
  byId('question-input').value=rawQuestion;byId('query-top-k').value='1';byId('run-query').fire('click');await uiFinishQuery(queries[0]);
  const before=session.snapshot(),accepted={source:session.document(),chunks:session.chunks(),passages:session.embeddings(),
    question:session.question(),query:session.queryEmbedding(),candidates:session.retrieval()},files=byId('pdf-file').files;
  assert.equal(before.status,'query-candidates-only');assert.equal(before.lifecycle.active,null);
  assert.ok(accepted.source);assert.ok(accepted.chunks);assert.ok(accepted.passages);assert.ok(accepted.query);assert.ok(accepted.candidates);
  for(const persisted of [false,true]){
    dispatchWindow('pageshow',{persisted});await appTick();
    assert.deepEqual(session.snapshot(),before);
    assert.equal(session.document(),accepted.source);assert.equal(session.chunks(),accepted.chunks);assert.equal(session.embeddings(),accepted.passages);
    assert.equal(session.question(),accepted.question);assert.equal(session.queryEmbedding(),accepted.query);assert.equal(session.retrieval(),accepted.candidates);
    assert.equal(byId('pdf-file').value,`C:\\fakepath\\${file.name}`);assert.equal(byId('pdf-file').files,files);
    assert.equal(byId('question-input').value,rawQuestion);
    assert.deepEqual([extracts.length,computes.length,embeds.length,queries.length],[1,1,1,1]);
  }
});

test('app pageshow preserves a selected file and its deferred active parser when no source is accepted yet',async()=>{
  const file={name:'still-parsing.pdf'},pending=deferred();
  const {session,extracts,computes,embeds,queries,byId,chooseFile,dispatchWindow}=appHarness({extract:()=>pending.promise});
  chooseFile(file);const before=session.snapshot(),files=byId('pdf-file').files;
  assert.equal(before.status,'parsing');assert.ok(before.lifecycle.active);assert.equal(session.document(),null);assert.equal(extracts.length,1);
  for(const persisted of [false,true]){
    dispatchWindow('pageshow',{persisted});await appTick();
    assert.deepEqual(session.snapshot(),before);assert.equal(extracts[0].options.signal.aborted,false);
    assert.equal(byId('pdf-file').value,`C:\\fakepath\\${file.name}`);assert.equal(byId('pdf-file').files,files);
    assert.deepEqual([extracts.length,computes.length,embeds.length,queries.length],[1,0,0,0]);
  }
  const record=extracted(file.name);pending.resolve(record);await appTick();
  assert.equal(session.document(),record);assert.equal(session.snapshot().status,'extracted-not-indexed');assert.equal(session.snapshot().lifecycle.active,null);
  assert.deepEqual([extracts.length,computes.length,embeds.length,queries.length],[1,0,0,0]);
});

test('app pagehide revokes an active parser and late completion cannot restore the cleared session or selection',async()=>{
  const file={name:'leaving-during-parse.pdf'},pending=deferred();
  const {session,extracts,computes,embeds,queries,byId,chooseFile,dispatchWindow}=appHarness({extract:()=>pending.promise});
  chooseFile(file);assert.equal(session.snapshot().status,'parsing');assert.equal(extracts.length,1);
  dispatchWindow('pagehide',{persisted:true});const cleared=session.snapshot();
  assert.equal(extracts[0].options.signal.aborted,true);assert.equal(cleared.status,'idle');assert.equal(cleared.lifecycle.active,null);
  assert.equal(byId('pdf-file').value,'');assert.deepEqual(byId('pdf-file').files,[]);
  dispatchWindow('pageshow',{persisted:true});pending.resolve(extracted(file.name));await appTick();
  assert.deepEqual(session.snapshot(),cleared);assert.equal(session.document(),null);assert.equal(session.chunks(),null);assert.equal(session.embeddings(),null);
  assert.equal(session.question(),null);assert.equal(session.queryEmbedding(),null);assert.equal(session.retrieval(),null);
  assert.equal(byId('pdf-file').value,'');assert.deepEqual(byId('pdf-file').files,[]);
  assert.deepEqual([extracts.length,computes.length,embeds.length,queries.length],[1,0,0,0]);
});

test('app query controls require accepted passage vectors and preserve exact captured input',async()=>{
  const harness=appHarness(),{session,embeds,queries,byId}=harness;
  assert.equal(byId('run-query').disabled,true,'querying requires accepted passage vectors');
  await session.select({name:'private-ui.pdf'});await session.chunk();assert.equal(byId('run-query').disabled,true);
  const operation=session.embed();finishEmbedding(embeds[0]);await operation;
  assert.equal(byId('run-query').disabled,false);assert.equal(queries.length,0,'embedding does not run a query');
  const raw='  What was FY2025 revenue?\n\tKeep this spacing.  ';
  byId('question-input').value=raw;byId('query-top-k').value='2';byId('run-query').fire('click');
  assert.equal(queries.length,1);assert.equal(queries[0].question,raw);assert.equal(queries[0].options.topK,2);
  assert.equal(byId('question-input').disabled,true);assert.equal(byId('query-top-k').disabled,true);
  assert.equal(byId('run-query').disabled,true);assert.equal(byId('clear-query').disabled,false);
  const packet=uiQueryPackets(queries[0]);
  for(const event of packet.progress){
    queries[0].options.onProgress(event);assert.doesNotMatch(byId('status-detail').textContent,/parsing/);
    if(event.stage==='initialize')assert.equal(byId('operation-progress').value,undefined);
    else{
      assert.equal(byId('operation-progress').value,event.payload.completed);
      assert.equal(byId('operation-progress').max,event.payload.total);
      assert.match(byId('status-detail').textContent,new RegExp(event.stage==='download'?'verified asset body bytes':event.stage==='encode'?'actual query tokens':'retained chunks ranked'));
    }
  }
  queries[0].resolve(packet.result);await appTick();
  for(const id of ['question-original','question-resolved','question-encoder'])assert.equal(byId(id).textContent,raw);
  assert.equal(byId('status-title').textContent,'Query candidates; not an answer');
  assert.equal(byId('question-input').disabled,false);assert.equal(byId('query-top-k').disabled,false);
  assert.match(appText(byId('candidate-results')),/cosine 1\.000000/);assert.match(appText(byId('candidate-results')),/dot 1\.000000/);
  assert.match(appText(byId('candidate-results')),/chunk norm 1\.000000/);assert.match(appText(byId('candidate-results')),/query norm 1\.000000/);
  assert.match(appText(byId('candidate-results')),/physical page 1/);assert.match(appText(byId('candidate-results')),/PDF label "i"/);
  assert.match(appText(byId('query-receipt')),/7\.3 ms/);assert.match(appText(byId('embedding-receipt')),/12\.5 ms/);
  const detail=byId('query-embedding-detail'),lazy=detail.children.filter(child=>child.tag==='details');
  assert.equal(detail.children.filter(child=>child.tag==='pre').length,0,'query tokens and full vector remain lazy');
  assert.equal(lazy.length,2);lazy[0].open=true;lazy[0].fire('toggle');assert.deepEqual(JSON.parse(appCompleteRecord(lazy[0])),[101,1000,102]);
  lazy[1].open=true;lazy[1].fire('toggle');assert.equal(JSON.parse(appCompleteRecord(lazy[1])).length,384);
  lazy.forEach(item=>{item.open=false;item.fire('toggle');assert.equal(item.children.length,1);});
  assert.equal(embeds.length,1);assert.equal(queries.length,1,'inspection does not rerun the encoder');
});

test('app query edits and explicit clear retain accepted source passage vectors',async()=>{
  const {session,queries,byId}=await uiEmbedded();
  const source=session.document(),chunks=session.chunks(),passages=session.embeddings();
  byId('question-input').value='First question';byId('query-top-k').value='5';byId('run-query').fire('click');await uiFinishQuery(queries[0]);
  byId('question-input').value='Edited question';byId('question-input').fire('input');
  assert.equal(session.question(),null);assert.equal(session.retrieval(),null);assert.equal(session.queryEmbedding(),null);
  assert.equal(byId('question-input').value,'Edited question');assert.equal(byId('candidate-results').children.length,1);
  assert.equal(byId('query-receipt').children.length,0);assert.equal(session.document(),source);
  assert.equal(session.chunks(),chunks);assert.equal(session.embeddings(),passages);
  byId('run-query').fire('click');await uiFinishQuery(queries[1]);
  byId('query-top-k').value='1';byId('query-top-k').fire('input');assert.equal(session.retrieval(),null);
  byId('run-query').fire('click');await uiFinishQuery(queries[2]);byId('clear-query').fire('click');
  assert.equal(byId('question-input').value,'');assert.equal(session.question(),null);assert.equal(session.queryEmbedding(),null);
  assert.equal(session.document(),source);assert.equal(session.chunks(),chunks);assert.equal(session.embeddings(),passages);
});

test('app candidate inspection selects the retained chunk and the correct source item window',async()=>{
  const source=extracted();source.pages[0]=createPageRecord({sourceSha256:source.source.sha256,
    parserVersion:source.parser.version,physicalPageNumber:1,pageLabel:'i',page:{view:[0,0,100,100],rotate:0,userUnit:1},textContent:{items:[]}});
  source.pages.push(createPageRecord({sourceSha256:source.source.sha256,parserVersion:source.parser.version,
    physicalPageNumber:2,pageLabel:'front-matter',page:{view:[0,0,100,100],rotate:0,userUnit:1},
    textContent:{items:Array.from({length:105},()=>({str:'X',dir:'ltr',transform:[1,0,0,1,0,0],width:20,height:10,fontName:'f1',hasEOL:false}))}}));source.numPages=2;
  const {session,queries,embeds,byId}=await uiEmbedded({extract:async()=>source,chunkOptions:{maxChunkUtf16:2,overlapUtf16:0}});
  byId('question-input').value='X';byId('query-top-k').value='105';byId('run-query').fire('click');await uiFinishQuery(queries[0]);
  const candidate=byId('candidate-results').children.filter(child=>child.tag==='article')[101],button=candidate.children.find(child=>child.tag==='button');
  assert.ok(button,'each retained candidate has an inspection action');button.fire('click');
  assert.equal(byId('chunk-select').value,'101');assert.match(byId('chunk-meta').textContent,/Chunk 102 of/);
  assert.ok(byId('chunk-select').children.length<=100,'candidate navigation adjusts the bounded selector window');
  assert.equal(byId('page-select').value,'1');assert.match(byId('page-meta').textContent,/Physical page 2/);
  assert.match(byId('items-range').textContent,/Showing items 101–105 of 105/);
  assert.equal(byId('chunk-detail').children[0].textContent,session.chunks().chunks[101].id);
  assert.equal(queries.length,1);assert.equal(embeds.length,1);
});

test('app guarded query refusal clears after later actions and cannot overwrite newer work',async()=>{
  const {session,queries,byId}=await uiEmbedded();
  byId('question-input').value=' \n ';byId('query-top-k').value='5';byId('run-query').fire('click');await appTick();
  assert.equal(queries.length,0);assert.equal(byId('status-title').textContent,'Query did not start');
  assert.match(byId('status-detail').textContent,/INVALID_QUERY_WORKER_CONFIG/);assert.match(byId('status-detail').textContent,/1–512/);
  byId('question-input').value='Valid question';byId('question-input').fire('input');
  assert.equal(byId('status-title').textContent,'Embedded; not retrieved');
  const rejected=deferred(),realQuery=session.query;session.query=()=>rejected.promise;
  byId('run-query').fire('click');session.query=realQuery;session.clear();rejected.reject(new Error('PRIVATE refusal detail'));await appTick();
  assert.equal(byId('status-title').textContent,'Waiting for a PDF');assert.doesNotMatch(byId('status-detail').textContent,/PRIVATE/);
});

test('app query runtime error and cancellation preserve passages and show no candidate result',async()=>{
  const {session,queries,byId}=await uiEmbedded(),passages=session.embeddings();
  byId('question-input').value='Question';byId('query-top-k').value='5';byId('run-query').fire('click');
  queries[0].reject(new QueryWorkerError('QUERY_TIMEOUT'));await appTick();
  assert.match(byId('status-detail').textContent,/query worker exceeded/i);assert.equal(session.embeddings(),passages);
  assert.equal(session.queryEmbedding(),null);assert.equal(session.retrieval(),null);assert.equal(byId('question-input').disabled,false);
  byId('run-query').fire('click');byId('cancel').fire('click');queries[1].reject(new QueryWorkerError('ABORTED'));await appTick();
  assert.equal(session.embeddings(),passages);assert.equal(session.retrieval(),null);assert.match(byId('status-detail').textContent,/passage vectors retained/i);
});

test('app explicit clear revokes an active query while retaining passage vectors and literal text stays inert',async()=>{
  const {session,queries,embeds,byId}=await uiEmbedded(),source=session.document(),chunks=session.chunks(),passages=session.embeddings();
  const raw='  <script>PRIVATE literal</script>\n& <img src=x>  ';
  byId('question-input').value=raw;byId('query-top-k').value='1';byId('run-query').fire('click');await uiFinishQuery(queries[0]);
  for(const id of ['question-original','question-resolved','question-encoder']){
    assert.equal(byId(id).textContent,raw);assert.equal(byId(id).children.length,1);assert.equal(byId(id).children[0].tag,'span');
  }
  assert.equal(queries.length,1);assert.equal(embeds.length,1);
  byId('run-query').fire('click');const task=queries[1];assert.equal(byId('clear-query').disabled,false);
  byId('clear-query').fire('click');assert.equal(task.options.signal.aborted,true);
  assert.equal(session.document(),source);assert.equal(session.chunks(),chunks);assert.equal(session.embeddings(),passages);
  assert.equal(session.question(),null);assert.equal(session.queryEmbedding(),null);assert.equal(session.retrieval(),null);
  assert.equal(byId('question-input').value,'');assert.equal(byId('question-input').disabled,false);
  assert.equal(byId('status-title').textContent,'Embedded; not retrieved');
  const cleared=session.snapshot();task.reject(new QueryWorkerError('ABORTED'));await appTick();
  assert.deepEqual(session.snapshot(),cleared);assert.equal(queries.length,2);assert.equal(embeds.length,1);
});
test('app uses explicit embed action and real operation stage progress without resetting selected chunk',async()=>{
  const {session,embeds,byId}=appHarness();
  assert.equal(byId('embed-chunks').disabled,true,'embedding needs accepted chunks');
  await session.select({name:'private-ui.pdf'});assert.equal(byId('embed-chunks').disabled,true);
  await session.chunk();assert.equal(byId('embed-chunks').disabled,false);assert.equal(embeds.length,0);
  byId('chunk-select').value='1';byId('chunk-select').fire('change');const text=byId('chunk-meta').textContent;
  const operation=session.embed(),packet=embeddingPackets(embeds[0]);
  assert.equal(byId('operation-progress').hidden,false);assert.equal(byId('operation-progress').value,undefined);
  for(const event of packet.progress){embeds[0].options.onProgress(event);
    assert.equal(byId('chunk-select').value,'1');assert.equal(byId('chunk-meta').textContent,text);
    assert.match(byId('status-detail').textContent,new RegExp(event.stage==='download'?'verified':event.stage==='initialize'?'initializ':'completed'));
    assert.doesNotMatch(byId('status-detail').textContent,/parsing/);
  }
  embeds[0].resolve(packet.result);await operation;
  assert.equal(byId('status-title').textContent,'Embedded; not retrieved');
  assert.match(byId('embedding-meta').textContent,/384/);assert.match(byId('embedding-meta').textContent,/1\.000000/);
  const detail=byId('embedding-detail');assert.ok(detail.children.some(child=>child.tag==='details'));
  assert.equal(detail.children.filter(child=>child.tag==='pre').length,0,'token IDs and full vector remain lazy complete records');
  const idsDetail=detail.children.find(child=>child.tag==='details'&&child.children[0].textContent.includes('selected token IDs'));
  idsDetail.open=true;idsDetail.fire('toggle');assert.deepEqual(JSON.parse(appCompleteRecord(idsDetail)),session.embeddings().tokenIds[1]);
  byId('chunk-select').value='0';byId('chunk-select').fire('change');assert.equal(embeds.length,1,'inspection never reruns inference');
  session.clear();assert.match(byId('embedding-meta').textContent,/No vectors/);assert.equal(byId('operation-progress').hidden,true);
});

test('active embedding refuses a concurrent attempt without clearing its owned state',async()=>{
  const {session,embeds}=await chunkedSession(),operation=session.embed(),before=embeddingState(session);
  await assert.rejects(session.embed(),fixedEmbeddingError('INVALID_EMBEDDING_CONFIG'));
  assert.deepEqual(embeddingState(session),before);assert.equal(embeds.length,1);
  finishEmbedding(embeds[0]);await operation;
});

test('embedding projection refuses oversized accepted chunks before touching the adapter or incarnation',async()=>{
  for(const mode of ['oversized text','too many chunks']){
    let incarnations=0;const harness=await selected({extract:async()=>extracted('large.pdf','A'.repeat(2050)),
      runtimeIdFactory:()=>`large-${++incarnations}`,embed:()=>assert.fail('invalid input must not reach the encoder'),
      compute:async(record,options)=>{
        const packet=structuredClone(workerPackets(record,options.identity,mode==='too many chunks'?{maxChunkUtf16:2,overlapUtf16:0}:{}).at(-1));
        if(mode==='oversized text')packet.artifact.chunks[0].text='A'.repeat(4097);
        return packet;}});
    await harness.session.chunk();
    const before=embeddingState(harness.session),count=incarnations;
    await assert.rejects(harness.session.embed(),fixedEmbeddingError('INVALID_EMBEDDING_CONFIG'));
    assert.deepEqual(embeddingState(harness.session),before);assert.equal(incarnations,count);
  }
});

test('embedding input and numerical output commit only the caller component value read once',async()=>{
  let reads=0,original;const embeds=[];
  const {session}=await selected({compute:async(record,options)=>{
    const packet=structuredClone(workerPackets(record,options.identity,chunkOptions).at(-1)),chunkArray=packet.artifact.chunks;
    original=chunkArray[0];packet.artifact.chunks=new Proxy(chunkArray,{get(target,key,receiver){
      if(key==='0'){reads++;return reads===1?original:{...original,text:'PRIVATE ALTERNATE'};}return Reflect.get(target,key,receiver);}});
    return packet;},embed:(record,options)=>{const pending=deferred();embeds.push({record,options,...pending});return pending.promise;}});
  await session.chunk();
  // The full chunk artifact is an adapter boundary in this controlled test.
  // The accepted input projection must not make a second numeric-array read.
  const operation=session.embed();assert.equal(reads,1);assert.equal(embeds[0].record.chunks[0].text,original.text);
  const packet=embeddingPackets(embeds[0]);let vectorReads=0;
  packet.result.artifact.vectors[0]=new Proxy(packet.result.artifact.vectors[0],{get(target,key,receiver){
    if(key==='0'){vectorReads++;return vectorReads===1?1:0;}return Reflect.get(target,key,receiver);}});
  packet.progress.forEach(embeds[0].options.onProgress);embeds[0].resolve(packet.result);await operation;
  assert.equal(session.snapshot().status,'embedded-not-retrieved');assert.equal(vectorReads,1);assert.equal(session.embeddings().vectors[0][0],1);
});

const queryState=session=>({...embeddingState(session),question:session.question(),queryEmbedding:session.queryEmbedding(),retrieval:session.retrieval()});
const fixedQueryError=code=>error=>error instanceof QueryWorkerError&&error.code===code&&!error.message.includes('PRIVATE');
function queryPackets(task){
  const count=task.record.counts.chunks;
  const progress=[['download',0,DOWNLOAD_BYTES,'bytes'],['download',DOWNLOAD_BYTES,DOWNLOAD_BYTES,'bytes'],
    ['initialize',0,null,'tokens'],['encode',0,3,'tokens'],['encode',3,3,'tokens'],['rank',0,count,'chunks'],['rank',count,count,'chunks']]
    .map(([stage,completed,total,unit],index)=>({...task.options.identity,kind:'progress',stage,seq:index+1,
      payload:{completed,total,unit,estimated:false}}));
  const query={schemaVersion:1,status:'query-embedded-not-retrieved',representationId:EMBEDDING_SPEC.version,
    representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',tokenIds:[101,1001,102],vector:[1,...Array(383).fill(0)],
    counts:{totalTokens:3,dimensions:384},receipt:{verifiedBytes:DOWNLOAD_BYTES,networkBytes:0,cacheBytes:DOWNLOAD_BYTES,elapsedMs:4.5}};
  const artifact={query,retrieval:structuredClone(rankCandidates(task.record,task.passages,
    {representationId:query.representationId,representation:query.representation,vector:query.vector},{topK:task.options.topK}))};
  return {progress,result:{event:{...task.options.identity,kind:'result',stage:'rank',seq:8,
    payload:{data:structuredClone(queryResultReceipt(artifact))}},artifact}};
}
function finishQuery(task){const packet=queryPackets(task);packet.progress.forEach(task.options.onProgress);task.resolve(packet.result);return packet.result;}
async function queryReadySession(extra={}){
  const queries=[];
  const harness=await chunkedSession({query:(record,passages,question,options)=>{
    const pending=deferred();queries.push({record,passages,question,options,...pending});return pending.promise;
  },...extra});
  const operation=harness.session.embed();finishEmbedding(harness.embeds[0]);await operation;
  return {...harness,queries};
}
function nativeFailure(task,query=false){const error=query?new QueryWorkerError('QUERY_FAILED'):new EmbeddingWorkerError('EMBEDDING_LOAD_FAILED');
  error.diagnostic=createRuntimeFailure(task.options.identity,{failureOrigin:'native-worker-error',readyObserved:true,commandPosted:true,lastSeq:0,elapsedMs:4,allowedCode:error.code});return error;}
test('embed adapter diagnostic is retained as an owned sibling while controller error stays code/message',async()=>{
  const {session,embeds}=await chunkedSession(),operation=session.embed();embeds[0].reject(nativeFailure(embeds[0]));await operation;
  assert.deepEqual(Object.keys(session.snapshot().lifecycle.terminal.payload),['code','message']);
  const failure=session.embeddingFailure();assert.equal(failure.diagnostic.safeError.failureOrigin,'native-worker-error');
  assert.deepEqual(failure.terminal,session.snapshot().lifecycle.terminal);assert.ok(Object.isFrozen(failure));
  session.clearQuery();assert.equal(session.embeddingFailure(),null);
});
test('query adapter diagnostic binds the revision after its failed query is discarded',async()=>{
  const {session,queries}=await queryReadySession(),operation=session.query('question');queries[0].reject(nativeFailure(queries[0],true));await operation;
  const failure=session.queryFailure();assert.equal(failure.diagnostic.safeError.component,'query-client');
  assert.deepEqual(failure.terminal,session.snapshot().lifecycle.terminal);assert.equal(session.embeddings(),failure.embeddings);
  session.cancel();assert.equal(session.queryFailure(),null);
});
test('foreign or older adapter diagnostic cannot survive a current owned failure',async()=>{
  for(const foreign of [true,false]){const {session,embeds}=await chunkedSession(),operation=session.embed(),task=embeds[0];
    const error=nativeFailure(task);if(foreign)error.diagnostic={...error.diagnostic,identity:{...task.options.identity,runtimeId:'foreign'}};
    else{task.options.onProgress({...task.options.identity,kind:'progress',stage:'download',seq:1,payload:{completed:0,total:DOWNLOAD_BYTES,unit:'bytes',estimated:false}});}
    task.reject(error);await operation;assert.equal(session.embeddingFailure(),null);assert.equal(session.snapshot().status,'runtime-error');}
});
test('diagnostic getter is never read and a descriptor trap that clears the owner cannot commit',async()=>{
  for(const reenter of [false,true]){const {session,embeds}=await chunkedSession(),operation=session.embed(),task=embeds[0];let reads=0;
    const error=nativeFailure(task);if(reenter)task.reject(new Proxy(error,{getOwnPropertyDescriptor(target,key){if(key==='diagnostic')session.clear();return Reflect.getOwnPropertyDescriptor(target,key);}}));
    else{Object.defineProperty(error,'diagnostic',{enumerable:true,get(){reads++;throw Error('PRIVATE');}});task.reject(error);}
    await operation;assert.equal(reads,0);assert.equal(session.embeddingFailure(),null);if(reenter)assert.equal(session.snapshot().status,'idle');}
});

test('query captures the exact original question and commits owned candidates outside bounded metadata',async()=>{
  const {session,queries}=await queryReadySession(),raw='  PRIVATE question\n<script>literal</script>  ',before=embeddingState(session);
  assert.equal(typeof session.query,'function','accepted passages need an explicit query action');
  const operation=session.query(raw,{topK:2}),task=queries[0];
  assert.equal(session.question(),raw);assert.equal(task.question,raw);assert.equal(session.snapshot().status,'querying');
  assert.equal(session.document(),before.document);assert.equal(session.chunks(),before.chunks);assert.equal(session.embeddings(),before.embeddings);
  assert.ok(Object.isFrozen(task.record.chunks[0]));assert.ok(Object.isFrozen(task.passages.vectors[0]));
  assert.notEqual(task.record,before.chunks);assert.notEqual(task.passages,before.embeddings);
  assert.equal(task.options.identity.operation,'query');assert.equal(task.options.topK,2);
  assert.deepEqual(Object.keys(task.record.chunks[0]),['id','text']);
  const result=finishQuery(task);await operation;
  assert.equal(session.snapshot().status,'query-candidates-only');assert.equal(session.question(),raw);
  assert.equal(session.retrieval().returnedCount,2);assert.equal(session.retrieval().candidates[0].ordinal,0);
  assert.equal(session.retrieval().candidates[0].score,1);assert.equal(session.retrieval().candidates[0].dotProduct,1);
  assert.equal(session.retrieval().queryNorm,1);assert.equal(session.retrieval().candidates[0].chunkNorm,1);
  assert.ok(Object.isFrozen(session.retrieval().candidates[0]));assert.ok(Object.isFrozen(session.queryEmbedding().vector));
  result.artifact.query.vector[0]=0;result.artifact.retrieval.candidates[0].score=0;
  assert.equal(session.queryEmbedding().vector[0],1);assert.equal(session.retrieval().candidates[0].score,1);
  for(const text of ['PRIVATE','Alpha','tokenIds','vector"','candidates"','chunkId'])assert.equal(JSON.stringify(session.snapshot()).includes(text),false);
  assert.equal(session.snapshot().lifecycle.terminal.payload.data.query.receipt.cacheBytes,DOWNLOAD_BYTES);
  assert.equal(session.embeddings().receipt.cacheBytes,0,'historical passage receipt remains its own attempt');
});

test('query invalid input and options preserve accepted results before adapter or runtime factory effects',async()=>{
  let incarnations=0;const {session,queries}=await queryReadySession({runtimeIdFactory:()=>`query-input-${++incarnations}`});
  const operation=session.query('PRIVATE valid');finishQuery(queries[0]);await operation;
  for(const [question,options]of [[null,{}],[new String('not primitive'),{}],['',{}],[' \n ',{}],['x'.repeat(4097),{}],
    ['valid',{topK:0}],['valid',{topK:513}],['valid',{topK:1.5}],['valid',{topK:'2'}],['valid',null],['valid',{unknown:true}],
    ['valid',{get topK(){throw new Error('PRIVATE getter');}}]]){
    const before=queryState(session),count=incarnations;
    await assert.rejects(session.query(question,options),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));
    assert.deepEqual(queryState(session),before);assert.equal(incarnations,count);assert.equal(queries.length,1);
  }
  const accepted=session.query('x'.repeat(4096),{topK:512});assert.equal(queries.length,2);finishQuery(queries[1]);await accepted;
  assert.equal(session.question().length,4096);assert.equal(session.retrieval().requestedTopK,512);
});

test('query absent artifacts or adapter cannot start or alter accepted state',async()=>{
  const idle=controlledSession({query:()=>assert.fail('no artifacts')}).session;
  assert.equal(typeof idle.query,'function');let before=queryState(idle);
  await assert.rejects(idle.query('valid'),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));assert.deepEqual(queryState(idle),before);
  await idle.select({name:'A'});before=queryState(idle);
  await assert.rejects(idle.query('valid'),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));assert.deepEqual(queryState(idle),before);
  const {session}=await queryReadySession({query:undefined});before=queryState(session);
  await assert.rejects(session.query('valid'),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));assert.deepEqual(queryState(session),before);
});

test('query null topK is refused before an adapter can start',async()=>{
  for(const configured of [false,true]){
    let starts=0;const {session}=await queryReadySession({query:()=>{starts++;throw new Error('private');},
      ...(configured?{queryOptions:{topK:null}}:{})}),before=queryState(session);
    await assert.rejects(session.query('question',configured?{}:{topK:null}),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));
    assert.equal(starts,0);assert.deepEqual(queryState(session),before);
  }
});

test('query snapshots and validates the same option keys once even when a proxy changes them',async()=>{
  for(const configured of [false,true]){
    let reads=0,captured;
    const options=new Proxy({topK:1,unknown:true},{ownKeys(){return ++reads===1?['topK']:['unknown'];}});
    const {session}=await queryReadySession({query:(source,passages,question,owned)=>{captured=owned;throw new Error('private');},
      ...(configured?{queryOptions:options}:{})});
    await session.query('question',configured?{}:options);
    assert.equal(reads,1);assert.equal(captured.topK,1);assert.equal(Object.hasOwn(captured,'unknown'),false);
  }
  for(const configured of [false,true]){
    let calls=0,factories=0,reads=0;
    const options=new Proxy({topK:1,unknown:true},{ownKeys(){return ++reads===1?['unknown']:['topK'];}});
    const {session}=await queryReadySession({query:()=>{calls++;throw new Error('private');},runtimeIdFactory:()=>`keys-${++factories}`,
      ...(configured?{queryOptions:options}:{})}),before=queryState(session),count=factories;
    await assert.rejects(session.query('question',configured?{}:options),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));
    assert.equal(calls,0);assert.equal(factories,count);assert.deepEqual(queryState(session),before);assert.equal(reads,1);
  }
});

test('query refuses a selected source digest that disagrees with the accepted chunks before mutation',async()=>{
  let starts=0,factories=0;const {session}=await queryReadySession({query:()=>{starts++;throw new Error('private');},
    runtimeIdFactory:()=>`source-check-${++factories}`});
  session.document().source.sha256='b'.repeat(64);const before=queryState(session),count=factories;
  await assert.rejects(session.query('question'),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));
  assert.equal(starts,0);assert.equal(factories,count);assert.deepEqual(queryState(session),before);
});

test('query source digest getter is captured once and cannot continue a revoked preflight',async()=>{
  for(const action of ['clearQuery','clear']){
    let starts=0,reads=0,factories=0;const {session}=await queryReadySession({query:()=>{starts++;throw new Error('private');},
      runtimeIdFactory:()=>`digest-getter-${++factories}`});
    const source=session.document(),chunks=session.chunks(),passages=session.embeddings(),count=factories;
    Object.defineProperty(source.source,'sha256',{get(){reads++;session[action]();return 'a'.repeat(64);},enumerable:true});
    await assert.rejects(session.query('question'),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));
    assert.equal(starts,0);assert.equal(reads,1);assert.equal(factories,count);
    assert.equal(session.document(),action==='clear'?null:source);assert.equal(session.chunks(),action==='clear'?null:chunks);
    assert.equal(session.embeddings(),action==='clear'?null:passages);
  }
});

test('query preflight reads owned options once and never allows overriding identity signal or progress',async()=>{
  let reads=0;const foreign=new AbortController(),{session,queries}=await queryReadySession({queryOptions:{
    identity:{runtimeId:'PRIVATE'},signal:foreign.signal,onProgress:()=>assert.fail('foreign progress'),
    get workTimeoutMs(){reads++;return 333;}}});
  const operation=session.query('raw',{topK:1,identity:{runtimeId:'foreign'},signal:foreign.signal,onProgress:()=>assert.fail('foreign')});
  assert.equal(reads,1);assert.equal(queries[0].options.workTimeoutMs,333);assert.equal(queries[0].options.identity.operation,'query');
  assert.notEqual(queries[0].options.signal,foreign.signal);finishQuery(queries[0]);await operation;
});

test('query runtime reuse throw and configured-option failure leave existing candidates accepted',async()=>{
  let next,initial=0,throwOption=false;const {session,queries}=await queryReadySession({runtimeIdFactory:()=>{
    if(next instanceof Error)throw next;return next===undefined?(initial++?'embed-runtime':'chunk-runtime'):next;},queryOptions:{get readyTimeoutMs(){if(throwOption)throw new Error('PRIVATE');return 10;}}});
  // queryReadySession uses an embedding runtime distinct from the chunk attempt.
  next='query-runtime';const operation=session.query('PRIVATE valid');finishQuery(queries[0]);await operation;
  for(const invalid of ['query-runtime','parser-owner','chunk-runtime','',null,42,'x'.repeat(257),new Error('PRIVATE')]){
    const before=queryState(session);next=invalid;
    await assert.rejects(session.query('other'),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));assert.deepEqual(queryState(session),before);
  }
  next='next-valid';throwOption=true;const before=queryState(session);
  await assert.rejects(session.query('other'),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));assert.deepEqual(queryState(session),before);
});

test('query option getter and runtime factory reentry cannot run a revoked preflight',async()=>{
  let invoke=false,session;const harness=await queryReadySession({queryOptions:{get topK(){if(invoke)session.clear();return 5;}}});
  session=harness.session;invoke=true;
  await assert.rejects(session.query('PRIVATE'),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));
  assert.equal(harness.queries.length,0);assert.equal(session.document(),null);assert.equal(session.snapshot().status,'idle');
  let factoryReenter=false,owned;
  const second=await queryReadySession({runtimeIdFactory:()=>{if(factoryReenter)owned.clearQuery();return `reenter-${crypto.randomUUID()}`;}});
  owned=second.session;factoryReenter=true;const before=queryState(owned);
  await assert.rejects(owned.query('PRIVATE'),fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));
  assert.equal(second.queries.length,0);assert.equal(owned.snapshot().lifecycle.runtimeId,before.snapshot.lifecycle.runtimeId);
});

test('query startup notification reentry revokes before the old adapter runs',async()=>{
  let session,enabled=false;const harness=await queryReadySession({onState:state=>{if(enabled&&state.status==='querying')session.clearQuery();}});
  session=harness.session;enabled=true;const passages=session.embeddings();await session.query('PRIVATE');
  assert.equal(harness.queries.length,0);assert.equal(session.question(),null);assert.equal(session.embeddings(),passages);
  assert.equal(session.snapshot().lifecycle.active,null);assert.equal(session.snapshot().status,'embedded-not-retrieved');
});

test('clearQuery does not cancel or rewrite an unrelated parser chunker or passage encoder',async()=>{
  const parse=deferred();const {session,tasks,embeds}=await queryReadySession({extract:file=>file.name==='pending'?parse.promise:extracted(file.name)});
  for(const stage of ['chunk','embed','parse']){
    const operation=stage==='chunk'?session.chunk():stage==='embed'?session.embed():session.select({name:'pending'});
    const before=embeddingState(session);session.clearQuery();assert.deepEqual(embeddingState(session),before);
    assert.equal(session.snapshot().lifecycle.active!==null,true);
    if(stage==='chunk')settle(tasks.at(-1));else if(stage==='embed')finishEmbedding(embeds.at(-1));else parse.resolve(extracted('pending'));
    await operation;
  }
});

for(const action of ['cancel','clearQuery','clear','replace'])test(`query ${action} revokes before abort reentry and refuses late result`,async()=>{
  const {session,queries}=await queryReadySession(),source=session.document(),chunks=session.chunks(),passages=session.embeddings();
  const first=session.query('PRIVATE first'),task=queries[0];let during,reentrant;
  task.options.signal.addEventListener('abort',()=>{during=queryState(session);reentrant=session.query('PRIVATE reentry');reentrant.catch(()=>{});session.clear();});
  if(action==='replace')await session.select({name:'PRIVATE replacement.pdf'});else session[action]();
  await assert.rejects(reentrant,fixedQueryError('INVALID_QUERY_WORKER_CONFIG'));
  assert.equal(during.snapshot.lifecycle.active,null);assert.equal(during.queryEmbedding,null);assert.equal(during.retrieval,null);
  if(['cancel','clearQuery'].includes(action)){assert.equal(session.document(),source);assert.equal(session.chunks(),chunks);assert.equal(session.embeddings(),passages);}
  else{assert.equal(during.document,null);assert.equal(during.chunks,null);assert.equal(during.embeddings,null);}
  const revoked=queryState(session);finishQuery(task);await first;assert.deepEqual(queryState(session),revoked);
});

test('query retry rechunk reembed replace and clear invalidate all query-dependent artifacts',async()=>{
  const {session,queries,tasks,embeds}=await queryReadySession();let operation=session.query('first');finishQuery(queries[0]);await operation;
  const passages=session.embeddings();operation=session.query('second');assert.equal(session.queryEmbedding(),null);assert.equal(session.retrieval(),null);
  assert.equal(session.embeddings(),passages);finishQuery(queries[1]);await operation;
  operation=session.embed();assert.equal(session.question(),null);assert.equal(session.queryEmbedding(),null);assert.equal(session.retrieval(),null);
  finishEmbedding(embeds[1]);await operation;operation=session.query('third');finishQuery(queries[2]);await operation;
  operation=session.chunk();assert.equal(session.question(),null);assert.equal(session.queryEmbedding(),null);assert.equal(session.retrieval(),null);
  settle(tasks[1]);await operation;operation=session.embed();finishEmbedding(embeds[2]);await operation;
  operation=session.query('fourth');finishQuery(queries[3]);await operation;
  await session.select({name:'same-sha-new.pdf'});assert.equal(session.question(),null);assert.equal(session.retrieval(),null);assert.equal(session.embeddings(),null);
  session.clear();assert.equal(session.question(),null);assert.equal(session.queryEmbedding(),null);assert.equal(session.document(),null);
});

test('malformed query progress does not consume strict sequence stage or pinned byte totals',async()=>{
  const {session,queries}=await queryReadySession(),operation=session.query('PRIVATE'),task=queries[0],packet=queryPackets(task),before=queryState(session);
  for(const mutate of [e=>{e.runtimeId='foreign';},e=>{e.operationId='op-99';},e=>{e.documentEpoch++;},e=>{e.operation='embed';},e=>{e.protocolVersion=2;},
    e=>{e.seq=0;},e=>{e.seq=Number.MAX_SAFE_INTEGER;},e=>{e.stage='rank';},e=>{e.kind='result';},e=>{e.payload.total--;},
    e=>{e.payload.estimated=true;},e=>{e.payload.PRIVATE='diagnostic';},e=>{e.payload.completed=1;}]){
    const event=structuredClone(packet.progress[0]);mutate(event);task.options.onProgress(event);assert.deepEqual(queryState(session),before);
  }
  task.options.onProgress(packet.progress[0]);const accepted=queryState(session);task.options.onProgress(packet.progress[0]);assert.deepEqual(queryState(session),accepted);
  const badToken=structuredClone(packet.progress[3]);badToken.payload.total=257;task.options.onProgress(badToken);assert.deepEqual(queryState(session),accepted);
  packet.progress.slice(1).forEach(task.options.onProgress);task.resolve(packet.result);await operation;assert.equal(session.snapshot().status,'query-candidates-only');
});

for(const [name,mutate]of [
  ['numeric score tamper',p=>{p.result.artifact.retrieval.candidates[0].score=.5;}],
  ['candidate order',p=>{p.result.artifact.retrieval.candidates.reverse();}],
  ['wrong source',p=>{p.result.artifact.retrieval.sourceSha256='b'.repeat(64);} ],
  ['wrong identity',p=>{p.result.event.runtimeId='foreign';}],['wrong stage',p=>{p.result.event.stage='encode';}],
  ['same sequence',p=>{p.result.event.seq=7;}],['private metadata',p=>{p.result.event.payload.data.PRIVATE='raw';}],
  ['query token mismatch',p=>{p.progress[3].payload.total=4;p.progress[4].payload={completed:4,total:4,unit:'tokens',estimated:false};}],
  ['no complete ranking',p=>{p.progress.pop();}],['query norm',p=>{p.result.artifact.query.vector[0]=0;}],
])test(`query terminal rejects ${name} while retaining accepted passage artifacts`,async()=>{
  const {session,queries}=await queryReadySession(),passages=session.embeddings(),chunks=session.chunks(),source=session.document();
  const operation=session.query('PRIVATE'),packet=queryPackets(queries[0]);mutate(packet);packet.progress.forEach(queries[0].options.onProgress);
  queries[0].resolve(packet.result);await operation;assert.equal(session.snapshot().status,'runtime-error');assert.equal(session.snapshot().error.code,'WORKER_PROTOCOL_ERROR');
  assert.equal(session.queryEmbedding(),null);assert.equal(session.retrieval(),null);assert.equal(session.embeddings(),passages);
  assert.equal(session.document(),source);assert.equal(session.chunks(),chunks);assert.equal(JSON.stringify(session.snapshot()).includes('PRIVATE'),false);
});

test('query progress and result getters cannot commit after synchronously clearing their owner',async()=>{
  const {session,queries}=await queryReadySession();let operation=session.query('first'),packet=queryPackets(queries[0]);
  Object.defineProperty(packet.progress[0].payload,'total',{get(){session.clearQuery();return DOWNLOAD_BYTES;},enumerable:true});
  queries[0].options.onProgress(packet.progress[0]);const cleared=queryState(session);queries[0].resolve(packet.result);await operation;
  assert.deepEqual(queryState(session),cleared);operation=session.query('second');packet=queryPackets(queries[1]);packet.progress.forEach(queries[1].options.onProgress);
  Object.defineProperty(packet.result.artifact.query,'receipt',{get(){session.clear();return {verifiedBytes:DOWNLOAD_BYTES,networkBytes:0,cacheBytes:DOWNLOAD_BYTES,elapsedMs:4.5};},enumerable:true});
  queries[1].resolve(packet.result);await operation;assert.equal(session.snapshot().status,'idle');assert.equal(session.document(),null);assert.equal(session.retrieval(),null);
});

test('query progress getter reentry cannot advance a stale stage past the accepted sequence',async()=>{
  const {session,queries}=await queryReadySession(),operation=session.query('question'),task=queries[0],packet=queryPackets(task);
  const stale=structuredClone(packet.progress[1]);stale.seq=1;
  Object.defineProperty(stale.payload,'total',{get(){task.options.onProgress(packet.progress[0]);return DOWNLOAD_BYTES;},enumerable:true});
  task.options.onProgress(stale);
  assert.equal(session.snapshot().lifecycle.active.lastSeq,1);
  assert.equal(session.snapshot().lifecycle.active.progress.completed,0);
  const partial=structuredClone(packet.progress[1]);partial.payload.completed=1;task.options.onProgress(partial);
  assert.equal(session.snapshot().lifecycle.active.progress.completed,1);
  packet.progress[1].seq=3;packet.progress.slice(2).forEach(event=>event.seq++);
  packet.result.event.seq=9;packet.progress.slice(1).forEach(task.options.onProgress);task.resolve(packet.result);await operation;
  assert.equal(session.snapshot().status,'query-candidates-only');
});

test('query thrown-code getter reentry cannot publish a stale error and fixed errors preserve passages',async()=>{
  const {session,queries}=await queryReadySession(),passages=session.embeddings();let operation=session.query('PRIVATE');
  queries[0].reject({get code(){session.clearQuery();throw new Error('PRIVATE');}});await operation;
  assert.equal(session.snapshot().status,'embedded-not-retrieved');assert.equal(session.snapshot().error,null);assert.equal(session.embeddings(),passages);
  operation=session.query('PRIVATE');const packet=queryPackets(queries[1]);packet.progress[0].seq=Number.MAX_SAFE_INTEGER-1;queries[1].options.onProgress(packet.progress[0]);
  queries[1].reject(new Error('PRIVATE diagnostic'));await operation;
  assert.equal(session.snapshot().error.code,'QUERY_FAILED');assert.equal(session.snapshot().lifecycle.terminal.seq,Number.MAX_SAFE_INTEGER);
  assert.equal(session.embeddings(),passages);assert.equal(JSON.stringify(session.snapshot()).includes('PRIVATE'),false);
});

class QuerySessionWorker extends SessionWorker{
  postMessage(command){this.command=command;this.pending=createQueryCommandHandler(packet=>this.packets.push(packet),{
    encode:async(question,{onProgress})=>{const packet=queryPackets({record:command.chunkArtifact,passages:command.embeddingArtifact,options:{identity:command.identity,topK:command.topK}});
      for(const event of packet.progress.slice(0,5))onProgress(event.stage,event.payload);return packet.result.artifact.query;}})(command);}
  ready(){this.emit({kind:'query-ready',protocolVersion:1,workerVersion:'query-v1'});}
}
test('real query adapter and pure worker command integrate with session through a controlled channel',async()=>{
  const worker=new QuerySessionWorker(),{session}=await queryReadySession({query:queryInWorker,queryOptions:{workerFactory:()=>worker}});
  const raw='  PRIVATE exact\nquestion  ',operation=session.query(raw,{topK:2});worker.ready();await worker.pending;
  worker.packets.forEach(packet=>worker.emit(packet));await operation;
  assert.equal(worker.command.question,raw);assert.equal(worker.terminated,1);assert.equal(session.snapshot().status,'query-candidates-only');
  assert.equal(session.retrieval().candidates[0].score,1);assert.equal(session.queryEmbedding().counts.totalTokens,3);
  assert.deepEqual(session.snapshot().lifecycle.terminal,worker.packets.at(-1).event);
});
