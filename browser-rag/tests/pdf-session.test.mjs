import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfSession} from '../pdf-session.mjs';
import {chunkInWorker,ComputeError} from '../compute-source.mjs';
import {createComputeCommandHandler} from '../compute.worker.mjs';
import {createPageRecord} from '../pdf-source.mjs';

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
