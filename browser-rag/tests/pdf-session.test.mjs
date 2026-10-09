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
  ready(){this.emit({kind:'embedding-ready',protocolVersion:1,workerVersion:'embedding-v1'});}
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
  append(...children){this.children.push(...children);if(this.tag==='select'&&this.value===''&&this.children.length)this.value=String(this.children[0].value);}
  replaceChildren(...children){this.children=[];if(this.tag==='select')this.value='';this.append(...children);}
  addEventListener(type,listener){this.listeners.set(type,listener);}
  removeAttribute(name){if(name==='value')this.value=undefined;}
  fire(type){this.listeners.get(type)?.();}
}
function appHarness(){
  const ids=new Map(),embeds=[];let session,incarnation=0;
  const byId=id=>{if(!ids.has(id))ids.set(id,new AppElement(id.endsWith('select')?'select':'div'));return ids.get(id);};
  const context={document:{getElementById:byId,createElement:tag=>new AppElement(tag)},window:{addEventListener(){}},
    URL,Worker:class{},pdfjs:{},extractPdf(){},chunkInWorker(){},embedInWorker(){},getItemWindow,EMBEDDING_SPEC,
    createPdfSession:options=>{session=createPdfSession({...options,runtimeId:'ui-parser',runtimeIdFactory:()=>`ui-${++incarnation}`,
      extract:async file=>extracted(file.name),compute:async(record,options)=>{
        const packets=workerPackets(record,options.identity,chunkOptions);options.onProgress(packets[0].event);return packets[1];},
      embed:(record,options)=>{const pending=deferred();embeds.push({record,options,...pending});return pending.promise;}});return session;}};
  const code=readFileSync(new URL('../pdf-app.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'')
    .replace(/import\.meta\.url/g,JSON.stringify('https://example.test/project/browser-rag/pdf-app.mjs'));
  vm.runInNewContext(code,context);return {session,embeds,byId};
}
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
  assert.equal(detail.children.filter(child=>child.tag==='pre').length,1,'token IDs are shown; full vector remains lazy');
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
