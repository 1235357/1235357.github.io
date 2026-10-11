import assert from 'node:assert/strict';
import test from 'node:test';
import { input, passages, query, queryMetadata, resultArtifact, resultMetadata, identity, READY, progress, stagePackets, result, code, ControlledWorker, clean } from './query-fixtures.mjs';
const module = await import('../query-source.mjs').catch(() => ({}));
function start(options = {}, source = input(), embedded = passages(), question = 'PRIVATE_QUESTION') {
  assert.equal(typeof module.queryInWorker, 'function', 'query transport must exist');
  const worker = new ControlledWorker();
  return { worker, pending: module.queryInWorker(source, embedded, question, { identity: identity(), workerFactory: () => worker, ...options }) };
}
test('query readiness refusal records the trusted deadline before a command is posted',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const {worker,pending}=start();t.mock.timers.tick(10000);
  const error=await pending.catch(value=>value);assert.equal(error.code,'QUERY_TIMEOUT');
  assert.equal(error.diagnostic.safeError.failureOrigin,'client-readiness-deadline');
  assert.equal(error.diagnostic.safeError.readyObserved,false);assert.equal(error.diagnostic.safeError.commandPosted,false);
  assert.equal(error.diagnostic.safeError.lastSeq,0);assert.equal(worker.sent.length,0);
});
test('query work refusal records ready command and accepted native progress sequence',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const {worker,pending}=start();worker.ready();worker.emit('message',progress('download',1,0,100));t.mock.timers.tick(120000);
  const error=await pending.catch(value=>value);assert.equal(error.diagnostic.safeError.failureOrigin,'client-operation-deadline');
  assert.equal(error.diagnostic.safeError.commandPosted,true);assert.equal(error.diagnostic.safeError.lastSeq,1);
});
test('query native error and accepted old-channel error packet have distinct inert provenance',async()=>{
  for(const reported of [false,true]){const {worker,pending}=start();worker.ready();
    if(reported)worker.emit('message',{event:{...identity(),kind:'error',stage:'download',seq:1,payload:{code:'QUERY_FAILED',message:'The query operation failed.'}}});
    else worker.emit('error',{message:'PRIVATE https://secret.invalid/?signature=raw'});
    const error=await pending.catch(value=>value);assert.equal(error.diagnostic.safeError.failureOrigin,reported?'worker-reported-error':'native-worker-error');
    assert.equal(error.diagnostic.safeError.phase,'unknown');assert.doesNotMatch(JSON.stringify(error.diagnostic),/PRIVATE|secret|signature/);
  }
});
test('query malformed packet and failed post retain channel provenance without a successful command',async()=>{
  const first=start();first.worker.emit('message',{...READY,workerVersion:'wrong'});
  const malformed=await first.pending.catch(value=>value);assert.equal(malformed.diagnostic.safeError.failureOrigin,'channel-validation');
  const postWorker=new ControlledWorker();postWorker.postMessage=()=>{throw Error('PRIVATE');};const second=start({workerFactory:()=>postWorker});postWorker.ready();
  const failed=await second.pending.catch(value=>value);assert.equal(failed.diagnostic.safeError.commandPosted,false);
});
test('query channel posts one owned command and accepts immutable source-linked candidates after ranking', async () => {
  let url; const worker = new ControlledWorker(), source = input(), embedded = passages(); source.source.name = 'PRIVATE_FILENAME';
  const { pending } = start({ workerFactory: value => { url = value; return worker; } }, source, embedded);
  source.chunks[0].text = 'CHANGED'; embedded.vectors[0][0] = 0; embedded.receipt.verifiedBytes = 999;
  worker.ready(); assert.ok(url.href.endsWith('/query.worker.mjs'));
  assert.deepEqual(worker.sent, [{ kind: 'query-candidates', identity: identity(), question: 'PRIVATE_QUESTION', chunkArtifact: input(), embeddingArtifact: passages(), topK: 5 }]);
  worker.stages(); const packet = result(); worker.emit('message', packet); const accepted = await pending;
  assert.deepEqual(accepted, packet); assert.notEqual(accepted.artifact, packet.artifact);
  assert.ok(Object.isFrozen(accepted.artifact.query.vector)); assert.ok(Object.isFrozen(accepted.artifact.retrieval.candidates[0]));
  assert.equal(JSON.stringify(accepted.event).includes('PRIVATE'), false);
  packet.artifact.query.vector[1] = 0; assert.equal(accepted.artifact.query.vector[1], 1); clean(worker);
});

test('query preflight ignores inherited chunk-array map and posts only detached projected fields', async () => {
  const source = input(), callerChunks = source.chunks; callerChunks[0].privateGeometry = { page: 7 }; let mapReads = 0;
  source.chunks = new Proxy(callerChunks, { get(target, key, receiver) {
    if (key === 'map') { mapReads++; return () => callerChunks; }
    return Reflect.get(target, key, receiver);
  } });
  const { worker, pending } = start({}, source); worker.ready(); worker.stages(); worker.emit('message', result()); await pending; clean(worker);
  assert.equal(mapReads, 0); assert.notEqual(worker.sent[0].chunkArtifact, source);
  assert.notEqual(worker.sent[0].chunkArtifact.chunks, callerChunks);
  assert.deepEqual(worker.sent[0].chunkArtifact, { schemaVersion: 1, status: 'chunked-not-embedded',
    source: { sha256: 'a'.repeat(64) }, counts: { chunks: 2 }, chunks: [
      { id: 'PRIVATE_ALPHA', text: 'PRIVATE_TEXT_ALPHA' }, { id: 'PRIVATE_BETA', text: 'PRIVATE_TEXT_BETA' },
    ] });
  for (let index = 0; index < callerChunks.length; index++) {
    const posted = worker.sent[0].chunkArtifact.chunks[index];
    assert.deepEqual(Reflect.ownKeys(posted), ['id', 'text']); assert.notEqual(posted, callerChunks[index]);
    assert.ok(Object.isFrozen(posted)); assert.equal(Object.isFrozen(callerChunks[index]), false);
  }
  assert.equal(Object.isFrozen(callerChunks), false); assert.equal(Object.isFrozen(callerChunks[0].privateGeometry), false);
});

for (const [name, mutate] of [
  ['duplicate IDs', chunks => { chunks[1].id = chunks[0].id; }],
  ['blank ID', chunks => { chunks[0].id = ' '; }], ['long ID', chunks => { chunks[0].id = 'x'.repeat(1025); }],
  ['blank text', chunks => { chunks[0].text = ' '; }], ['long text', chunks => { chunks[0].text = 'x'.repeat(4097); }],
  ['non-record chunk', chunks => { chunks[0] = null; }],
]) test(`query preflight rejects ${name} before worker creation despite inherited map override`, async () => {
  const source = input(), callerChunks = source.chunks; mutate(callerChunks); let mapReads = 0, created = false;
  source.chunks = new Proxy(callerChunks, { get(target, key, receiver) {
    if (key === 'map') { mapReads++; return () => callerChunks; }
    return Reflect.get(target, key, receiver);
  } });
  const { pending } = start({ workerFactory: () => { created = true; return null; } }, source);
  await assert.rejects(pending, code('INVALID_EMBEDDING_CONFIG')); assert.equal(created, false);
  assert.equal(mapReads, 0); assert.equal(Object.isFrozen(callerChunks), false);
});
test('shared query and pair copying validate, freeze and detach complete artifacts and bounded receipts', () => {
  assert.equal(typeof module.copyQueryArtifact, 'function'); assert.equal(typeof module.copyQueryResult, 'function');
  const value = resultArtifact(), copied = module.copyQueryResult(value, input(), passages(), 5, 100, resultMetadata(value));
  assert.deepEqual(copied, value); assert.notEqual(copied.query.tokenIds, value.query.tokenIds);
  assert.deepEqual(module.queryReceipt(value.query), queryMetadata(value.query));
  assert.deepEqual(module.queryResultReceipt(value), resultMetadata(value));
  assert.ok(Object.isFrozen(module.queryResultReceipt(value).query.receipt));
  assert.equal(JSON.stringify(module.queryResultReceipt(value)).includes('PRIVATE'), false);
});
for (const ready of [null, [], { ...READY, kind: 'embedding-ready' }, { ...READY, protocolVersion: 2 }, { ...READY, workerVersion: 'query-v2' }, { ...READY, private: true }]) test('malformed readiness never posts', async () => {
  const { worker, pending } = start(); worker.emit('message', ready); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); assert.equal(worker.sent.length, 0); clean(worker);
});
test('duplicate readiness cannot post a second command', async () => { const { worker, pending } = start(); worker.ready(); worker.ready(); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); assert.equal(worker.sent.length, 1); clean(worker); });
for (const question of [undefined, null, 1, {}, new String('question'), '', ' \n ', 'x'.repeat(4097)]) test('invalid primitive question refuses before worker creation', async () => {
  assert.equal(typeof module.queryInWorker, 'function'); let created = false;
  const pending = module.queryInWorker(input(), passages(), question, { identity: identity(), workerFactory: () => { created = true; } });
  await assert.rejects(pending, code('INVALID_QUERY_WORKER_CONFIG')); assert.equal(created, false);
});
for (const [name, options] of [ ['topK zero', { topK: 0 }], ['topK large', { topK: 513 }], ['topK fraction', { topK: 1.5 }], ['topK string', { topK: '1' }],
  ['extra options', { private: true }], ['bad callback', { onProgress: null }], ['bad signal', { signal: {} }], ['bad factory', { workerFactory: null }],
  ['bad identity', { identity: { ...identity(), operation: 'embed' } }], ['epoch', { identity: { ...identity(), documentEpoch: -1 } }], ['unsafe op', { identity: { ...identity(), operationId: 'op-9007199254740992' } }],
  ['ready deadline', { readyTimeoutMs: 0 }], ['work deadline', { workTimeoutMs: 2147483648 }],
]) test(`config ${name} is canonical before construction`, async () => {
  let created = false; const { pending } = start({ workerFactory: () => { created = true; }, ...options }); await assert.rejects(pending, code('INVALID_QUERY_WORKER_CONFIG')); assert.equal(created, false);
});
for (const key of ['topK', 'identity', 'workerFactory', 'onProgress', 'signal', 'readyTimeoutMs', 'workTimeoutMs']) test(`throwing ${key} option getter refuses before worker`, async () => {
  let created = false; const options = { identity: identity(), workerFactory: () => { created = true; } }; Object.defineProperty(options, key, { get() { throw new Error('PRIVATE'); } });
  assert.equal(typeof module.queryInWorker, 'function'); await assert.rejects(module.queryInWorker(input(), passages(), 'question', options), code('INVALID_QUERY_WORKER_CONFIG')); assert.equal(created, false);
});
for (const key of Object.keys(identity())) test(`throwing identity ${key} getter refuses before worker`, async () => {
  let created = false; const id = identity(); Object.defineProperty(id, key, { get() { throw new Error('PRIVATE'); } });
  const { pending } = start({ identity: id, workerFactory: () => { created = true; } }); await assert.rejects(pending, code('INVALID_QUERY_WORKER_CONFIG')); assert.equal(created, false);
});
test('invalid source and mismatching passage refuse before worker construction', async () => {
  for (const passageFault of [false, true]) { let created = false; const source = input(), embedded = passages();
    if (passageFault) embedded.sourceSha256 = 'b'.repeat(64); else source.chunks[0].text = '';
    const { pending } = start({ workerFactory: () => { created = true; } }, source, embedded);
    await assert.rejects(pending, code(passageFault ? 'WORKER_PROTOCOL_ERROR' : 'INVALID_EMBEDDING_CONFIG')); assert.equal(created, false);
  }
});
test('query boundary preserves raw UTF16 question at 4096 units and topK 512', async () => {
  const worker = new ControlledWorker(); const { pending } = start({ topK: 512, workerFactory: () => worker }, input(), passages(), '😀'.repeat(2048)); worker.ready(); worker.stages(); worker.emit('message', result(resultArtifact(512)));
  assert.equal(worker.sent[0].question.length, 4096); assert.equal((await pending).artifact.retrieval.requestedTopK, 512); clean(worker);
});
for (const [name, mutate] of [
  ['extra query', q => { q.private = true; }], ['status', q => { q.status = 'embedded-not-retrieved'; }], ['schema', q => { q.schemaVersion = 2; }],
  ['representation', q => { q.representation.maxTokens++; }], ['representation ID', q => { q.representationId = 'wrong'; }], ['backend', q => { q.backend = 'wasm'; }], ['dtype', q => { q.dtype = 'q8'; }],
  ['counts', q => { q.counts.totalTokens++; }], ['dimensions', q => { q.counts.dimensions--; }], ['CLS', q => { q.tokenIds[0] = 100; }], ['SEP', q => { q.tokenIds[2] = 103; }], ['vocab', q => { q.tokenIds[1] = 30522; }],
  ['fraction token', q => { q.tokenIds[1] = 1.2; }], ['short token row', q => { q.tokenIds = [101, 102]; q.counts.totalTokens = 2; }], ['long token row', q => { q.tokenIds = [101, ...Array(255).fill(42), 102]; q.counts.totalTokens = 257; }],
  ['zero vector', q => { q.vector.fill(0); }], ['nonunit vector', q => { q.vector[1] = 2; }], ['nonfinite vector', q => { q.vector[1] = NaN; }], ['dimension vector', q => { q.vector.pop(); }],
  ['bytes', q => { q.receipt.verifiedBytes = 200; q.receipt.networkBytes = 170; }], ['receipt sum', q => { q.receipt.cacheBytes++; }], ['elapsed', q => { q.receipt.elapsedMs = -1; }], ['receipt extra', q => { q.receipt.question = 'PRIVATE'; }],
]) test(`query artifact refuses ${name}`, async () => {
  const { worker, pending } = start(); worker.ready(); worker.stages(); const value = resultArtifact(); mutate(value.query); worker.emit('message', result(value)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const path of ['query.tokenIds', 'query.vector', 'retrieval.candidates']) for (const kind of ['sparse', 'named', 'hidden', 'accessor', 'typed']) test(`result strict array refuses ${path} ${kind}`, async () => {
  const { worker, pending } = start(); worker.ready(); worker.stages(); const value = resultArtifact(), keys = path.split('.'), key = keys.pop(), parent = keys.reduce((v, k) => v[k], value), array = parent[key];
  if (kind === 'sparse') delete array[0]; else if (kind === 'named') array.private = true; else if (kind === 'hidden') Object.defineProperty(array, '0', { enumerable: false });
  else if (kind === 'accessor') { const first = array[0]; Object.defineProperty(array, '0', { get: () => first }); } else parent[key] = new Float32Array(array.length);
  worker.emit('message', result(value)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const [name, mutate] of [
  ['source', r => { r.sourceSha256 = 'b'.repeat(64); }], ['status', r => { r.status = 'answer'; }], ['topK', r => { r.requestedTopK = 1; }], ['count', r => { r.returnedCount = 1; }], ['query norm', r => { r.queryNorm += 0.1; }],
  ['representation', r => { r.representationId = 'wrong'; }], ['score', r => { r.candidates[0].score = 0.5; }], ['dot', r => { r.candidates[0].dotProduct += 0.1; }], ['norm', r => { r.candidates[0].chunkNorm += 0.1; }],
  ['ordinal', r => { r.candidates[0].ordinal++; }], ['chunk', r => { r.candidates[0].chunkId = 'PRIVATE_WRONG'; }], ['order', r => { r.candidates.reverse(); }], ['extra', r => { r.candidates[0].text = 'PRIVATE'; }],
]) test(`ranker artifact refuses altered ${name}`, async () => {
  const { worker, pending } = start(); worker.ready(); worker.stages(); const value = structuredClone(resultArtifact()); mutate(value.retrieval); worker.emit('message', result(value)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const path of ['query.backend', 'query.counts.totalTokens', 'query.receipt.cacheBytes', 'retrieval.sourceSha256', 'retrieval.returnedCount']) test(`metadata ${path} must match the full result`, async () => {
  const { worker, pending } = start(); worker.ready(); worker.stages(); const packet = result(), keys = path.split('.'), key = keys.pop(), parent = keys.reduce((v, k) => v[k], packet.event.payload.data); parent[key] = 'PRIVATE';
  worker.emit('message', packet); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const [name, packets] of [
  ['skip download', [progress('initialize', 1, 0, null)]], ['incomplete download', [progress('download', 1, 0, 100), progress('initialize', 2, 0, null)]],
  ['download nonzero', [progress('download', 1, 1, 100)]], ['download oversized', [progress('download', 1, 0, 128 * 1024 * 1024 + 1)]], ['download changed total', [progress('download', 1, 0, 100), progress('download', 2, 1, 101)]],
  ['download regression', [progress('download', 1, 0, 100), progress('download', 2, 50, 100), progress('download', 3, 49, 100)]],
  ['initialize unit', [...stagePackets().slice(0, 2), progress('initialize', 3, 0, null, 'chunks')]], ['duplicate initialize', [...stagePackets().slice(0, 3), progress('initialize', 4, 0, null)]],
  ['tokens too short', [...stagePackets().slice(0, 3), progress('encode', 4, 0, 2)]], ['tokens too many', [...stagePackets().slice(0, 3), progress('encode', 4, 0, 257)]],
  ['tokens wrong unit', [...stagePackets().slice(0, 3), progress('encode', 4, 0, 3, 'chunks')]], ['tokens changed total', [...stagePackets().slice(0, 4), progress('encode', 5, 1, 4)]],
  ['tokens regression', [...stagePackets().slice(0, 4), progress('encode', 5, 2, 3), progress('encode', 6, 1, 3)]],
  ['rank early', [...stagePackets().slice(0, 4), progress('rank', 5, 0, 2)]], ['rank count', [...stagePackets().slice(0, 5), progress('rank', 6, 0, 1)]],
  ['rank unit', [...stagePackets().slice(0, 5), progress('rank', 6, 0, 2, 'tokens')]], ['rank regression', [...stagePackets().slice(0, 6), progress('rank', 7, 1, 2), progress('rank', 8, 0, 2)]],
  ['return encode after rank', [...stagePackets().slice(0, 6), progress('encode', 7, 3, 3)]],
]) test(`strict progress refuses ${name}`, async () => {
  const { worker, pending } = start(); worker.ready(); packets.forEach(packet => worker.emit('message', packet)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const mutate of [p => { p.event.seq = 0; }, p => { p.event.seq = Number.MAX_SAFE_INTEGER; }, p => { p.event.runtimeId = 'stale'; }, p => { p.event.documentEpoch++; }, p => { p.event.operationId = 'op-2'; }, p => { p.event.operation = 'embed'; },
  p => { p.event.payload.estimated = true; }, p => { p.event.payload.private = true; }, p => { p.extra = true; }, p => { p.event.extra = true; }]) test('malformed progress identity or schema safely rejects', async () => {
  const { worker, pending } = start(); worker.ready(); const packet = progress('download', 1, 0, 100); mutate(packet); worker.emit('message', packet); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('replayed sequence rejects and terminal reserved MAX sequence remains valid', async () => {
  { const { worker, pending } = start(); worker.ready(); worker.emit('message', progress('download', 1, 0, 100)); worker.emit('message', progress('download', 1, 100, 100)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); }
  { const { worker, pending } = start(); worker.ready(); worker.stages(); worker.emit('message', result(resultArtifact(), Number.MAX_SAFE_INTEGER)); assert.equal((await pending).event.seq, Number.MAX_SAFE_INTEGER); clean(worker); }
});
for (const prefix of [0, 5, 6]) test('terminal success requires completed rank', async () => { const { worker, pending } = start(); worker.ready(); stagePackets().slice(0, prefix).forEach(p => worker.emit('message', p)); worker.emit('message', result()); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); });
test('completed token progress must equal accepted query artifact count', async () => {
  const { worker, pending } = start(); worker.ready(); const packets = stagePackets(); packets[3].event.payload.total = packets[4].event.payload.total = packets[4].event.payload.completed = 4;
  packets.forEach(p => worker.emit('message', p)); worker.emit('message', result()); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('ready deadline and fixed work deadline terminate without renewal from progress', async () => {
  { const { worker, pending } = start({ readyTimeoutMs: 5 }); await assert.rejects(pending, code('QUERY_TIMEOUT')); assert.equal(worker.sent.length, 0); clean(worker); }
  { const { worker, pending } = start({ workTimeoutMs: 15 }); worker.ready(); let seq = 0; const timer = setInterval(() => worker.emit('message', progress('download', ++seq, 0, 100)), 3);
    try { await assert.rejects(pending, code('QUERY_TIMEOUT')); clean(worker); } finally { clearInterval(timer); } }
});
for (const ready of [false, true]) test('abort removes listeners and revokes captured reentrant and late commits', async () => {
  const abort = new AbortController(); const { worker, pending } = start({ signal: abort.signal }); if (ready) worker.ready(); const receive = worker.captured;
  worker.onTerminate = () => receive({ data: result() }); abort.abort(); receive({ data: READY }); await assert.rejects(pending, code('ABORTED')); clean(worker);
});
test('already aborted signal creates no worker', async () => { const abort = new AbortController(); abort.abort(); let called = false; const { pending } = start({ signal: abort.signal, workerFactory: () => { called = true; } }); await assert.rejects(pending, code('ABORTED')); assert.equal(called, false); });
test('cleanup completes before promise publication even with abort, throw and reentrant hooks', async () => {
  const abort = new AbortController(), worker = new ControlledWorker(); let captured;
  const remove = worker.removeEventListener.bind(worker); worker.removeEventListener = (...args) => { remove(...args); abort.abort(); captured({ data: result() }); throw new Error('PRIVATE'); };
  worker.onTerminate = () => { abort.abort(); captured({ data: READY }); throw new Error('PRIVATE'); };
  const { pending } = start({ signal: abort.signal, workerFactory: () => worker }); captured = worker.captured;
  worker.ready(); worker.stages(); worker.emit('message', result()); const accepted = await pending; assert.equal(accepted.artifact.retrieval.status, 'candidates-only'); clean(worker);
});

test('query token copying uses its validated length despite a numeric proxy changing subsequent length reads', () => {
  const value = query(); value.tokenIds = [101, 102, 102]; let copiedLastInterior = false;
  value.tokenIds = new Proxy(value.tokenIds, { get(target, key, receiver) {
    if (key === '1') copiedLastInterior = true;
    if (key === 'length' && copiedLastInterior) return 2;
    return Reflect.get(target, key, receiver);
  } });
  const copied = module.copyQueryArtifact(value, 100); assert.deepEqual(copied.tokenIds, [101, 102, 102]); assert.equal(copied.counts.totalTokens, copied.tokenIds.length);
});
test('submitted candidates cannot bypass every-field checks by replacing inherited array map', async () => {
  const { worker, pending } = start(); worker.ready(); worker.stages(); const value = resultArtifact(); value.retrieval.candidates[0].score = 0.5;
  value.retrieval.candidates = new Proxy(value.retrieval.candidates, { get(target, key, receiver) { return key === 'map' ? () => [] : Reflect.get(target, key, receiver); } });
  worker.emit('message', result(value)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const mutate of [p => { p.event.stage = 'encode'; }, p => { p.event.payload.question = 'PRIVATE'; }, p => { p.event.payload.data.query.vector = [1]; }, p => { p.extra = true; }, p => { p.artifact.extra = true; }]) test('terminal schema cannot carry unowned fields', async () => {
  const { worker, pending } = start(); worker.ready(); worker.stages(); const packet = result(); mutate(packet); worker.emit('message', packet); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('progress and canonical error getters emit only a single validated read', async () => {
  { const seen = []; const { worker, pending } = start({ onProgress: p => seen.push(p) }); worker.ready(); const packet = progress('download', 1, 0, 100); let reads = 0;
    Object.defineProperty(packet.event.payload, 'completed', { get() { return ++reads === 1 ? 0 : 'PRIVATE'; } }); worker.emit('message', packet); stagePackets().slice(1).forEach(p => worker.emit('message', p)); worker.emit('message', result()); await pending;
    assert.equal(reads, 1); assert.equal(seen[0].payload.completed, 0); clean(worker); }
  { const { worker, pending } = start(); worker.ready(); let reads = 0; worker.emit('message', { event: { ...identity(), kind: 'error', stage: 'download', seq: 1,
      payload: { get code() { return ++reads === 1 ? 'GPU_DEVICE_LOST' : 'PRIVATE'; }, message: 'The WebGPU device was lost.' } } }); await assert.rejects(pending, code('GPU_DEVICE_LOST')); assert.equal(reads, 1); clean(worker); }
});
test('throwing construction, post, progress and abort installation errors stay bounded and clean', async () => {
  { const { pending } = start({ workerFactory: () => { throw new Error('PRIVATE'); } }); await assert.rejects(pending, code('WORKER_UNAVAILABLE')); }
  { const worker = new ControlledWorker(); worker.postMessage = () => { throw new Error('PRIVATE'); }; const { pending } = start({ workerFactory: () => worker }); worker.ready(); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); }
  { const { worker, pending } = start({ onProgress: () => { throw new Error('PRIVATE'); } }); worker.ready(); worker.emit('message', progress('download', 1, 0, 100)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); }
  { const signal = { aborted: false, addEventListener() { throw new Error('PRIVATE'); }, removeEventListener() {} }; const { worker, pending } = start({ signal }); await assert.rejects(pending, code('WORKER_UNAVAILABLE')); clean(worker); }
});
test('abort removal failure cannot prevent cleanup and settlement', async () => {
  const signal = { aborted: false, addEventListener() {}, removeEventListener() { throw new Error('PRIVATE'); } }; const { worker, pending } = start({ signal }); worker.ready(); worker.stages(); worker.emit('message', result()); await pending; clean(worker);
});
for (const key of ['addEventListener', 'removeEventListener', 'postMessage']) test(`throwing worker ${key} inspection still terminates the owned worker once`, async () => {
  const worker = new ControlledWorker(); Object.defineProperty(worker, key, { get() { throw new Error('PRIVATE'); } });
  const { pending } = start({ workerFactory: () => worker }); await assert.rejects(pending, code('WORKER_UNAVAILABLE')); assert.equal(worker.terminated, 1);
});
test('invalid worker shape still terminates the owned worker once', async () => {
  const worker = new ControlledWorker(); worker.postMessage = null; const { pending } = start({ workerFactory: () => worker }); await assert.rejects(pending, code('WORKER_UNAVAILABLE')); assert.equal(worker.terminated, 1);
});
test('reentrant abort during the second signal inspection cannot create a deadline after settlement', async t => {
  const scheduled = []; t.mock.method(globalThis, 'setTimeout', (callback, delay) => { scheduled.push({ callback, delay }); return {}; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  let reads = 0, onAbort; const signal = { get aborted() { if (++reads === 2) onAbort(); return false; }, addEventListener(_type, listener) { onAbort = listener; }, removeEventListener() {} };
  const { worker, pending } = start({ signal }); await assert.rejects(pending, code('ABORTED')); assert.deepEqual(scheduled, []); clean(worker);
});
test('callback-triggered cancellation cannot accept later packets', async () => { const abort = new AbortController(); const { worker, pending } = start({ signal: abort.signal, onProgress: () => abort.abort() }); worker.ready(); worker.emit('message', progress('download', 1, 0, 100)); worker.captured({ data: result() }); await assert.rejects(pending, code('ABORTED')); clean(worker); });
for (const type of ['error', 'messageerror']) test('native diagnostic failures stay safe', async () => { const { worker, pending } = start(); worker.ready(); worker.emit(type, { message: 'PRIVATE' }); await assert.rejects(pending, code(type === 'error' ? 'QUERY_FAILED' : 'WORKER_PROTOCOL_ERROR')); clean(worker); });
test('canonical errors follow actual stage and reject private or forged code text', async () => {
  for (const payload of [{ code: 'GPU_DEVICE_LOST', message: 'The WebGPU device was lost.' }, { code: 'QUERY_FAILED', message: 'PRIVATE' }, { code: 'PRIVATE', message: 'PRIVATE' }]) {
    const { worker, pending } = start(); worker.ready(); worker.emit('message', { event: { ...identity(), kind: 'error', stage: 'download', seq: 1, payload } }); await assert.rejects(pending, code(payload.code === 'GPU_DEVICE_LOST' ? 'GPU_DEVICE_LOST' : 'WORKER_PROTOCOL_ERROR')); clean(worker);
  }
});
test('safe error class canonicalizes unknown diagnostic strings', () => { assert.equal(typeof module.QueryWorkerError, 'function'); const error = new module.QueryWorkerError('PRIVATE'); assert.equal(error.code, 'QUERY_FAILED'); assert.equal(error.message, 'The query operation failed.'); });
test('validated query and receipt getters are read once and output detached', () => {
  assert.equal(typeof module.copyQueryArtifact, 'function'); const value = query(); let reads = 0;
  Object.defineProperty(value, 'backend', { get() { return ++reads === 1 ? 'webgpu' : 'PRIVATE'; } });
  const copied = module.copyQueryArtifact(value, 100); assert.equal(copied.backend, 'webgpu'); assert.equal(reads, 1);
  const receiptValue = query(); let receiptReads = 0; Object.defineProperty(receiptValue.receipt, 'cacheBytes', { get() { return ++receiptReads === 1 ? 30 : 'PRIVATE'; } });
  assert.equal(module.queryReceipt(receiptValue).receipt.cacheBytes, 30); assert.equal(receiptReads, 1);
});
test('throwing artifact and message getters are safe protocol failures', async () => {
  for (const messageFault of [false, true]) { const { worker, pending } = start(); worker.ready(); worker.stages(); const packet = result();
    Object.defineProperty(messageFault ? packet : packet.artifact.query, messageFault ? 'event' : 'vector', { get() { throw new Error('PRIVATE'); } }); worker.emit('message', packet); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); }
});
