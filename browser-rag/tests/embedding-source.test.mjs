import assert from 'node:assert/strict';
import test from 'node:test';
import { EMBEDDING_SPEC } from '../embedding-contract.mjs';

// A missing implementation is an explicit behavioral assertion, not an import
// loader error, during the first RED run.
const module = await import('../embedding-source.mjs').catch(() => ({}));
const READY = { kind: 'embedding-ready', protocolVersion: 1, workerVersion: 'embedding-v1' };
const HASH = 'a'.repeat(64);
const identity = () => ({ protocolVersion: 1, runtimeId: 'embedding-test', operationId: 'op-1', documentEpoch: 2, operation: 'embed' });
const input = () => ({ schemaVersion: 1, status: 'chunked-not-embedded', source: { sha256: HASH, name: 'PRIVATE_FILENAME.pdf' }, counts: { chunks: 2 },
  chunks: [{ id: 'PRIVATE_ID_ALPHA', text: 'PRIVATE_TEXT_ALPHA' }, { id: 'PRIVATE_ID_BETA', text: 'PRIVATE_TEXT_BETA' }] });
function artifact() {
  return { schemaVersion: 1, status: 'embedded-not-retrieved', sourceSha256: HASH,
    representationId: EMBEDDING_SPEC.version, representation: { ...EMBEDDING_SPEC }, backend: 'webgpu', dtype: 'fp32',
    chunkIds: input().chunks.map(chunk => chunk.id), tokenIds: [[101, 42, 102], [101, 43, 102]],
    vectors: [0, 1].map(() => [1, ...new Array(383).fill(0)]),
    counts: { chunks: 2, totalTokens: 6, dimensions: 384 },
    receipt: { verifiedBytes: 100, networkBytes: 70, cacheBytes: 30, elapsedMs: 1.25 } };
}
function metadata(value) {
  return Object.fromEntries(['sourceSha256', 'representationId', 'status', 'backend', 'dtype', 'counts', 'receipt'].map(key => [key, structuredClone(value[key])]));
}
const event = (kind, stage, seq, payload, id = identity()) => ({ ...id, kind, stage, seq, payload });
const progress = (stage, seq, completed, total, unit = stage === 'download' ? 'bytes' : 'chunks') => ({ event: event('progress', stage, seq, { completed, total, unit, estimated: false }) });
function result(value = artifact(), seq = 6) { return { event: event('result', 'encode', seq, { data: metadata(value) }), artifact: value }; }
const code = expected => error => error?.name === 'EmbeddingWorkerError' && error.code === expected && !error.message.includes('PRIVATE');
class ControlledWorker {
  listeners = new Map(); sent = []; terminated = 0; captured; onTerminate;
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener); if (type === 'message') this.captured = listener; }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  postMessage(command) { if (this.postFails) throw new Error('PRIVATE_POST'); this.sent.push(command); }
  terminate() { this.terminated++; this.onTerminate?.(); }
  emit(type, data) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(type === 'message' ? { data } : data); }
  ready() { this.emit('message', READY); }
  stages() { for (const packet of [progress('download', 1, 0, 100), progress('download', 2, 100, 100), progress('initialize', 3, 0, null), progress('encode', 4, 0, 2), progress('encode', 5, 2, 2)]) this.emit('message', packet); }
}
function start(options = {}, source = input()) {
  assert.equal(typeof module.embedInWorker, 'function', 'embedding transport must expose embedInWorker');
  const worker = new ControlledWorker();
  const pending = module.embedInWorker(source, { identity: identity(), workerFactory: () => worker, ...options });
  return { worker, pending };
}
function clean(worker) { assert.equal(worker.terminated, 1); for (const listeners of worker.listeners.values()) assert.equal(listeners.size, 0); }
test('one embedding operation owns a fresh module-worker URL, one command, and immutable result', async () => {
  let url;
  const worker = new ControlledWorker();
  const { pending } = start({ workerFactory: value => { url = value; return worker; } });
  assert.ok(url instanceof URL); assert.ok(url.href.endsWith('/embedding.worker.mjs'));
  worker.ready(); worker.stages(); const packet = result(); worker.emit('message', packet);
  const accepted = await pending;
  assert.deepEqual(accepted, { event: packet.event, artifact: packet.artifact });
  assert.notEqual(accepted.event, packet.event); assert.notEqual(accepted.artifact, packet.artifact);
  assert.ok(Object.isFrozen(accepted.artifact.vectors[0])); assert.ok(Object.isFrozen(accepted.event.payload.data.receipt));
  packet.artifact.vectors[0][0] = 0; assert.equal(accepted.artifact.vectors[0][0], 1);
  assert.equal(worker.sent.length, 1); clean(worker);
});
test('input is synchronously projected, copied, bounded and stripped of unrelated fields', async () => {
  const source = input(); source.private = new Array(100000); source.chunks[0].geometry = 'PRIVATE_GEOMETRY';
  const { worker, pending } = start({}, source);
  source.source.sha256 = 'b'.repeat(64); source.chunks[0].text = 'CHANGED'; source.chunks[0].id = 'CHANGED';
  worker.ready();
  assert.deepEqual(worker.sent[0], { kind: 'embed-chunks', identity: identity(), chunkArtifact: {
    schemaVersion: 1, status: 'chunked-not-embedded', source: { sha256: HASH }, counts: { chunks: 2 },
    chunks: input().chunks } });
  worker.stages(); worker.emit('message', result()); await pending; clean(worker);
});
test('validated progress is detached, frozen and metadata-only', async () => {
  const seen = []; const { worker, pending } = start({ onProgress: value => seen.push(value) });
  worker.ready(); worker.stages(); worker.emit('message', result()); await pending;
  assert.equal(seen.length, 5); assert.ok(Object.isFrozen(seen[0].payload));
  assert.equal(JSON.stringify(seen).includes('PRIVATE'), false); clean(worker);
});
for (const ready of [null, [], { ...READY, kind: 'compute-ready' }, { ...READY, workerVersion: 'chunks-v1' }, { ...READY, protocolVersion: 2 }, { ...READY, private: 'PRIVATE' }]) {
  test(`malformed readiness ${JSON.stringify(ready)} does not post a command`, async () => {
    const { worker, pending } = start(); worker.emit('message', ready);
    await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); assert.equal(worker.sent.length, 0); clean(worker);
  });
}
test('duplicate readiness fails without a second command', async () => {
  const { worker, pending } = start(); worker.ready(); worker.ready();
  await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); assert.equal(worker.sent.length, 1); clean(worker);
});
for (const option of ['readyTimeoutMs', 'workTimeoutMs']) for (const value of [0, -1, 1.1, NaN, Infinity, null, '5', 2147483648]) {
  test(`invalid ${option} ${String(value)} refuses before construction`, async () => {
    let called = false; const { pending } = start({ [option]: value, workerFactory: () => { called = true; return new ControlledWorker(); } });
    await assert.rejects(pending, code('INVALID_EMBEDDING_WORKER_CONFIG')); assert.equal(called, false);
  });
}
for (const [name, options] of [
  ['unknown option', { private: true }], ['invalid callback', { onProgress: null }], ['invalid signal', { signal: {} }], ['null factory', { workerFactory: null }],
  ['bad identity', { identity: { ...identity(), operation: 'ingest' } }], ['sourceEpoch instead of documentEpoch', { identity: { protocolVersion: 1, runtimeId: 'r', operationId: 'op-1', sourceEpoch: 2, operation: 'embed' } }],
  ['too long runtime', { identity: { ...identity(), runtimeId: 'x'.repeat(257) } }], ['unsafe ID', { identity: { ...identity(), operationId: 'op-9007199254740992' } }],
  ['bad epoch', { identity: { ...identity(), documentEpoch: -1 } }], ['extra identity', { identity: { ...identity(), name: 'PRIVATE' } }],
]) test(`${name} is a safe configuration refusal`, async () => { const { pending } = start(options); await assert.rejects(pending, code('INVALID_EMBEDDING_WORKER_CONFIG')); });
for (const [name, mutate] of [
  ['wrong status', source => { source.status = 'embedded-not-retrieved'; }], ['bad SHA', source => { source.source.sha256 = 'BAD'; }],
  ['zero chunks', source => { source.chunks = []; source.counts.chunks = 0; }], ['too many chunks', source => { source.chunks = new Array(513); source.counts.chunks = 513; }],
  ['count mismatch', source => { source.counts.chunks = 1; }], ['duplicate IDs', source => { source.chunks[1].id = source.chunks[0].id; }],
  ['blank ID', source => { source.chunks[0].id = ' '; }], ['long ID', source => { source.chunks[0].id = 'x'.repeat(1025); }],
  ['blank text', source => { source.chunks[0].text = ' '; }], ['long text', source => { source.chunks[0].text = 'x'.repeat(4097); }],
  ['sparse chunks', source => { delete source.chunks[0]; }], ['named chunks', source => { source.chunks.private = 'PRIVATE'; }],
]) test(`invalid source ${name} refuses before worker creation`, async () => {
  const source = input(); mutate(source); let created = false;
  const { pending } = start({ workerFactory: () => { created = true; return new ControlledWorker(); } }, source);
  await assert.rejects(pending, code('INVALID_EMBEDDING_CONFIG')); assert.equal(created, false);
});
test('ready timeout cleans without posting', async () => { const { worker, pending } = start({ readyTimeoutMs: 5 }); await assert.rejects(pending, code('EMBEDDING_TIMEOUT')); assert.equal(worker.sent.length, 0); clean(worker); });
test('progress cannot extend the fixed work deadline', { timeout: 250 }, async () => {
  const { worker, pending } = start({ workTimeoutMs: 15 }); worker.ready();
  worker.emit('message', progress('download', 1, 0, 100));
  let seq = 1; const timer = setInterval(() => worker.emit('message', progress('download', ++seq, 0, 100)), 5);
  try { await assert.rejects(pending, code('EMBEDDING_TIMEOUT')); clean(worker); }
  finally { clearInterval(timer); }
});
for (const ready of [false, true]) test(`abort ${ready ? 'during work' : 'before readiness'} revokes captured commits`, async () => {
  const abort = new AbortController(); const { worker, pending } = start({ signal: abort.signal }); if (ready) worker.ready();
  const captured = worker.captured; worker.onTerminate = () => captured({ data: result() });
  abort.abort(); captured({ data: READY });
  await assert.rejects(pending, code('ABORTED')); clean(worker);
});
test('already aborted signal creates no worker', async () => {
  const abort = new AbortController(); abort.abort(); let created = false;
  const { pending } = start({ signal: abort.signal, workerFactory: () => { created = true; return new ControlledWorker(); } });
  await assert.rejects(pending, code('ABORTED')); assert.equal(created, false);
});
test('termination callbacks and late packets cannot change a successful result', async () => {
  const { worker, pending } = start(); const captured = worker.captured;
  worker.onTerminate = () => captured({ data: { event: event('error', 'encode', 7, { code: 'EMBEDDING_FAILED', message: 'The embedding operation failed.' }) } });
  worker.ready(); worker.stages(); worker.emit('message', result()); const accepted = await pending;
  captured({ data: READY }); captured({ data: result() }); assert.equal(accepted.artifact.status, 'embedded-not-retrieved'); assert.equal(worker.sent.length, 1); clean(worker);
});
for (const type of ['error', 'messageerror']) test(`${type} safely rejects without raw exception`, async () => {
  const { worker, pending } = start(); worker.ready(); worker.emit(type, { message: 'PRIVATE_NATIVE', cause: 'PRIVATE' });
  await assert.rejects(pending, code(type === 'error' ? 'EMBEDDING_FAILED' : 'WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('constructor failure is normalized', async () => { const { pending } = start({ workerFactory: () => { throw new Error('PRIVATE_CONSTRUCTOR'); } }); await assert.rejects(pending, code('WORKER_UNAVAILABLE')); });
test('post failure terminates', async () => { const { worker, pending } = start(); worker.postFails = true; worker.ready(); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); });
test('callback failure terminates safely', async () => { const { worker, pending } = start({ onProgress: () => { throw new Error('PRIVATE_CALLBACK'); } }); worker.ready(); worker.emit('message', progress('download', 1, 0, 100)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); });
for (const [name, packets] of [
  ['skip download', [progress('initialize', 1, 0, null)]], ['skip initialize', [progress('download', 1, 0, 100), progress('download', 2, 100, 100), progress('encode', 3, 0, 2)]],
  ['download starts nonzero', [progress('download', 1, 1, 100)]], ['download zero total', [progress('download', 1, 0, 0)]],
  ['download oversized', [progress('download', 1, 0, 128 * 1024 * 1024 + 1)]], ['changed total', [progress('download', 1, 0, 100), progress('download', 2, 1, 101)]],
  ['regressing download', [progress('download', 1, 0, 100), progress('download', 2, 10, 100), progress('download', 3, 9, 100)]],
  ['premature initialize', [progress('download', 1, 0, 100), progress('initialize', 2, 0, null)]],
  ['duplicate initialize', [progress('download', 1, 0, 100), progress('download', 2, 100, 100), progress('initialize', 3, 0, null), progress('initialize', 4, 0, null)]],
  ['download after initialize', [progress('download', 1, 0, 100), progress('download', 2, 100, 100), progress('initialize', 3, 0, null), progress('download', 4, 100, 100)]],
  ['encode starts nonzero', [progress('download', 1, 0, 100), progress('download', 2, 100, 100), progress('initialize', 3, 0, null), progress('encode', 4, 1, 2)]],
  ['encode wrong total', [progress('download', 1, 0, 100), progress('download', 2, 100, 100), progress('initialize', 3, 0, null), progress('encode', 4, 0, 3)]],
  ['fractional bytes', [progress('download', 1, 0, 100), progress('download', 2, 0.5, 100)]],
]) test(`stage protocol refuses ${name}`, async () => {
  const { worker, pending } = start(); worker.ready(); for (const packet of packets) worker.emit('message', packet);
  await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const [name, mutate] of [
  ['identity', packet => { packet.event.documentEpoch++; }], ['extra event', packet => { packet.event.text = 'PRIVATE'; }], ['extra packet', packet => { packet.private = 'PRIVATE'; }],
  ['sequence zero', packet => { packet.event.seq = 0; }], ['sequence unsafe', packet => { packet.event.seq = Number.MAX_SAFE_INTEGER + 1; }],
  ['progress uses last terminal slot', packet => { packet.event.seq = Number.MAX_SAFE_INTEGER; }], ['estimated progress', packet => { packet.event.payload.estimated = true; }],
  ['wrong progress unit', packet => { packet.event.payload.unit = 'tokens'; }], ['extra payload', packet => { packet.event.payload.text = 'PRIVATE'; }],
]) test(`metadata refuses ${name}`, async () => {
  const { worker, pending } = start(); worker.ready(); const packet = progress('download', 1, 0, 100); mutate(packet); worker.emit('message', packet);
  await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('non-increasing sequence refuses', async () => { const { worker, pending } = start(); worker.ready(); worker.emit('message', progress('download', 1, 0, 100)); worker.emit('message', progress('download', 1, 100, 100)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); });
test('the final safe sequence slot remains available for a terminal result', async () => {
  const { worker, pending } = start(); worker.ready(); worker.stages(); worker.emit('message', result(artifact(), Number.MAX_SAFE_INTEGER)); assert.equal((await pending).event.seq, Number.MAX_SAFE_INTEGER); clean(worker);
});
test('result before completed encode never commits', async () => { const { worker, pending } = start(); worker.ready(); worker.emit('message', result()); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); });
for (const [name, mutate] of [
  ['extra artifact', value => { value.private = 'PRIVATE'; }], ['source', value => { value.sourceSha256 = 'b'.repeat(64); }], ['status', value => { value.status = 'retrieved'; }],
  ['representation', value => { value.representation.maxTokens = 512; }], ['representation extra', value => { value.representation.foo = 'PRIVATE'; }], ['representation ID', value => { value.representationId = 'OTHER'; }],
  ['backend', value => { value.backend = 'wasm'; }], ['dtype', value => { value.dtype = 'q8'; }], ['chunk order', value => { value.chunkIds.reverse(); }], ['chunk count', value => { value.chunkIds.pop(); }],
  ['token count', value => { value.counts.totalTokens++; }], ['dimensions', value => { value.counts.dimensions--; }], ['counts extra', value => { value.counts.private = true; }],
  ['token CLS', value => { value.tokenIds[0][0] = 100; }], ['token SEP', value => { value.tokenIds[0][2] = 103; }], ['token vocabulary', value => { value.tokenIds[0][1] = 30522; }],
  ['token negative', value => { value.tokenIds[0][1] = -1; }], ['token fraction', value => { value.tokenIds[0][1] = 1.5; }], ['token row too short', value => { value.tokenIds[0] = [101, 102]; }],
  ['token row too long', value => { value.tokenIds[0] = [101, ...new Array(255).fill(42), 102]; }], ['token sparse', value => { delete value.tokenIds[0][1]; }],
  ['zero vector', value => { value.vectors[0].fill(0); }], ['unnormalized vector', value => { value.vectors[0][0] = 2; }], ['nonfinite vector', value => { value.vectors[0][0] = NaN; }],
  ['wrong vector dimension', value => { value.vectors[0].pop(); }], ['sparse vector', value => { delete value.vectors[0][1]; }], ['typed vector', value => { value.vectors[0] = new Float32Array(value.vectors[0]); }],
  ['verified bytes mismatch', value => { value.receipt.verifiedBytes++; value.receipt.networkBytes++; }], ['zero verified bytes', value => { value.receipt.verifiedBytes = 0; value.receipt.networkBytes = value.receipt.cacheBytes = 0; }],
  ['receipt sum', value => { value.receipt.cacheBytes++; }], ['receipt negative', value => { value.receipt.cacheBytes = -1; value.receipt.networkBytes = 101; }], ['receipt unsafe', value => { value.receipt.networkBytes = Number.MAX_SAFE_INTEGER + 1; }],
  ['elapsed NaN', value => { value.receipt.elapsedMs = NaN; }], ['elapsed negative', value => { value.receipt.elapsedMs = -1; }], ['receipt extra', value => { value.receipt.private = 'PRIVATE'; }],
]) test(`artifact refuses ${name} before accepting any output`, async () => {
  const { worker, pending } = start(); worker.ready(); worker.stages(); const value = artifact(); mutate(value); worker.emit('message', result(value));
  await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const target of ['chunkIds', 'tokenIds', 'tokenIds.0', 'vectors', 'vectors.0']) for (const kind of ['named', 'symbol', 'nonenumerable']) {
  test(`strict normal array refuses ${target} ${kind} properties`, async () => {
    const { worker, pending } = start(); worker.ready(); worker.stages(); const value = artifact();
    const array = target.split('.').reduce((part, key) => part[key], value);
    if (kind === 'symbol') array[Symbol('PRIVATE')] = true;
    else if (kind === 'nonenumerable') Object.defineProperty(array, 'PRIVATE', { value: true });
    else array.PRIVATE = true;
    worker.emit('message', result(value)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
  });
}
test('result metadata must match artifact and cannot carry text', async () => {
  const { worker, pending } = start(); worker.ready(); worker.stages(); const packet = result(); packet.event.payload.data.receipt.cacheBytes++;
  worker.emit('message', packet); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const [stage, prefix] of [
  ['download', []], ['initialize', [progress('download', 1, 0, 100), progress('download', 2, 100, 100), progress('initialize', 3, 0, null)]],
  ['encode', [progress('download', 1, 0, 100), progress('download', 2, 100, 100), progress('initialize', 3, 0, null), progress('encode', 4, 0, 2)]],
]) test(`a canonical runtime error can terminate during ${stage}`, async () => {
  const { worker, pending } = start(); worker.ready(); prefix.forEach(packet => worker.emit('message', packet));
  worker.emit('message', { event: event('error', stage, prefix.length + 1, { code: 'GPU_DEVICE_LOST', message: 'The WebGPU device was lost.' }) });
  await assert.rejects(pending, code('GPU_DEVICE_LOST')); clean(worker);
});
test('error cannot claim a stage not yet accepted', async () => { const { worker, pending } = start(); worker.ready(); worker.emit('message', { event: event('error', 'encode', 1, { code: 'GPU_DEVICE_LOST', message: 'The WebGPU device was lost.' }) }); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); });
for (const payload of [{ code: 'UNKNOWN', message: 'PRIVATE' }, { code: 'GPU_DEVICE_LOST', message: 'PRIVATE' }]) test(`noncanonical error refuses ${payload.code}`, async () => { const { worker, pending } = start(); worker.ready(); worker.emit('message', { event: event('error', 'download', 1, payload) }); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker); });
test('safe error class never echoes an unknown code', () => { assert.equal(typeof module.EmbeddingWorkerError, 'function'); const error = new module.EmbeddingWorkerError('PRIVATE'); assert.equal(error.code, 'EMBEDDING_FAILED'); assert.equal(error.message, 'The embedding operation failed.'); });

test('each new operation invokes a new Worker factory even after prior success', async () => {
  const workers = []; const factory = () => { const worker = new ControlledWorker(); workers.push(worker); return worker; };
  for (let i = 1; i <= 2; i++) {
    const { pending } = start({ identity: { ...identity(), operationId: `op-${i}` }, workerFactory: factory });
    const worker = workers.at(-1); worker.ready();
    const commandIdentity = worker.sent[0].identity;
    for (const packet of [progress('download', 1, 0, 100), progress('download', 2, 100, 100), progress('initialize', 3, 0, null), progress('encode', 4, 0, 2), progress('encode', 5, 2, 2), result()]) {
      Object.assign(packet.event, commandIdentity); worker.emit('message', packet);
    }
    assert.equal((await pending).event.operationId, `op-${i}`); clean(worker);
  }
  assert.equal(workers.length, 2); assert.notEqual(workers[0], workers[1]);
});
test('same-origin input identity with nonenumerable fields is copied explicitly', async () => {
  const value = {}; for (const [key, field] of Object.entries(identity())) Object.defineProperty(value, key, { value: field });
  const { worker, pending } = start({ identity: value }); worker.ready();
  assert.deepEqual(worker.sent[0].identity, identity()); worker.stages(); worker.emit('message', result()); await pending; clean(worker);
});
for (const [name, signal] of [
  ['remove listener throws', { aborted: false, addEventListener() {}, removeEventListener() { throw new Error('PRIVATE_REMOVE'); } }],
]) test(`cleanup ${name} cannot prevent successful settlement`, async () => {
  const { worker, pending } = start({ signal }); worker.ready(); worker.stages(); worker.emit('message', result());
  assert.equal((await pending).artifact.counts.chunks, 2); clean(worker);
});
test('abort listener installation error is a safe worker error and cleans channel', async () => {
  const signal = { aborted: false, addEventListener() { throw new Error('PRIVATE_ADD'); }, removeEventListener() {} };
  const { worker, pending } = start({ signal }); await assert.rejects(pending, code('WORKER_UNAVAILABLE')); clean(worker);
});
for (const method of ['terminate', 'removeEventListener']) test(`throwing ${method} cleanup cannot undo a committed result`, async () => {
  const { worker, pending } = start(); const original = worker[method].bind(worker);
  worker[method] = (...args) => { original(...args); throw new Error('PRIVATE_CLEANUP'); };
  worker.ready(); worker.stages(); worker.emit('message', result()); assert.equal((await pending).artifact.counts.chunks, 2); clean(worker);
});
for (const mutate of [payload => { payload.total = 1; }, payload => { payload.completed = 1; }, payload => { payload.unit = 'bytes'; }]) {
  test('initialize must be exact indeterminate zero chunk progress', async () => {
    const { worker, pending } = start(); worker.ready(); worker.emit('message', progress('download', 1, 0, 100)); worker.emit('message', progress('download', 2, 100, 100));
    const packet = progress('initialize', 3, 0, null); mutate(packet.event.payload); worker.emit('message', packet); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
  });
}
test('encode progress may not regress after its first accepted increment', async () => {
  const { worker, pending } = start(); worker.ready();
  for (const packet of [progress('download', 1, 0, 100), progress('download', 2, 100, 100), progress('initialize', 3, 0, null), progress('encode', 4, 0, 2), progress('encode', 5, 1, 2), progress('encode', 6, 0, 2)]) worker.emit('message', packet);
  await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('result cannot contain extra metadata, even when full artifact is otherwise valid', async () => {
  const { worker, pending } = start(); worker.ready(); worker.stages(); const packet = result(); packet.event.payload.data.text = 'PRIVATE';
  worker.emit('message', packet); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('error follows latest accepted download progress, not its error code', async () => {
  const { worker, pending } = start(); worker.ready(); worker.emit('message', progress('download', 1, 0, 100));
  worker.emit('message', { event: event('error', 'download', 2, { code: 'ENCODER_INPUT_LIMIT', message: 'The encoder input is invalid or exceeds its token budget.' }) });
  await assert.rejects(pending, code('ENCODER_INPUT_LIMIT')); clean(worker);
});
test('callback-triggered cancellation forbids all captured later packets', async () => {
  const abort = new AbortController(); const { worker, pending } = start({ signal: abort.signal, onProgress: () => abort.abort() });
  worker.ready(); worker.emit('message', progress('download', 1, 0, 100)); worker.captured({ data: result() });
  await assert.rejects(pending, code('ABORTED')); clean(worker);
});

for (const target of ['chunkIds', 'tokenIds', 'tokenIds.0', 'vectors', 'vectors.0']) {
  test(`artifact array ${target} refuses a hidden existing numeric entry`, async () => {
    const { worker, pending } = start(); worker.ready(); worker.stages(); const value = artifact();
    const array = target.split('.').reduce((part, key) => part[key], value);
    Object.defineProperty(array, '0', { enumerable: false });
    worker.emit('message', result(value)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
  });
}
test('input chunks refuse a hidden existing numeric entry before creating a worker', async () => {
  const source = input(); Object.defineProperty(source.chunks, '0', { enumerable: false }); let created = false;
  const { pending } = start({ workerFactory: () => { created = true; return new ControlledWorker(); } }, source);
  await assert.rejects(pending, code('INVALID_EMBEDDING_CONFIG')); assert.equal(created, false);
});
for (const key of ['identity', 'workerFactory', 'onProgress', 'signal', 'readyTimeoutMs', 'workTimeoutMs']) {
  test(`throwing ${key} option getter is canonical and creates no worker`, async () => {
    let created = false; const options = { identity: identity(), workerFactory: () => { created = true; return new ControlledWorker(); } };
    Object.defineProperty(options, key, { enumerable: true, get() { throw new Error(`PRIVATE_OPTION_${key}`); } });
    await assert.rejects(module.embedInWorker(input(), options), code('INVALID_EMBEDDING_WORKER_CONFIG')); assert.equal(created, false);
  });
}
for (const key of Object.keys(identity())) test(`throwing identity ${key} getter is canonical and creates no worker`, async () => {
  let created = false; const value = identity(); Object.defineProperty(value, key, { enumerable: true, get() { throw new Error(`PRIVATE_IDENTITY_${key}`); } });
  const { pending } = start({ identity: value, workerFactory: () => { created = true; return new ControlledWorker(); } });
  await assert.rejects(pending, code('INVALID_EMBEDDING_WORKER_CONFIG')); assert.equal(created, false);
});
test('throwing signal inspection getter is canonical before worker creation', async () => {
  let created = false; const signal = { get aborted() { throw new Error('PRIVATE_SIGNAL'); }, addEventListener() {}, removeEventListener() {} };
  const { pending } = start({ signal, workerFactory: () => { created = true; return new ControlledWorker(); } });
  await assert.rejects(pending, code('INVALID_EMBEDDING_WORKER_CONFIG')); assert.equal(created, false);
});

for (const target of ['chunkIds', 'tokenIds', 'tokenIds.0', 'vectors', 'vectors.0']) {
  test(`artifact array ${target} refuses an accessor numeric entry`, async () => {
    const { worker, pending } = start(); worker.ready(); worker.stages(); const value = artifact();
    const array = target.split('.').reduce((part, key) => part[key], value), entry = array[0];
    Object.defineProperty(array, '0', { get: () => entry });
    worker.emit('message', result(value)); await assert.rejects(pending, code('WORKER_PROTOCOL_ERROR')); clean(worker);
  });
}

test('input chunks refuse an accessor numeric entry before creating a worker', async () => {
  const source = input(), entry = source.chunks[0]; let created = false;
  Object.defineProperty(source.chunks, '0', { get: () => entry });
  const { pending } = start({ readyTimeoutMs: 5, workerFactory: () => { created = true; return new ControlledWorker(); } }, source);
  await assert.rejects(pending, code('INVALID_EMBEDDING_CONFIG')); assert.equal(created, false);
});

for (const path of ['source.sha256', 'chunks.0.id', 'chunks.0.text']) {
  test(`input projection validates the single owned ${path} read`, () => {
    const value = input(), keys = path.split('.'), key = keys.pop();
    const parent = keys.reduce((part, field) => part[field], value), original = parent[key]; let reads = 0;
    Object.defineProperty(parent, key, { enumerable: true, get() { return ++reads === 1 ? original : ''; } });
    const projected = module.projectEmbeddingInput(value);
    assert.equal(keys.reduce((part, field) => part[field], projected)[key], original); assert.equal(reads, 1);
  });
}

test('progress validates the owned snapshot before emitting any private getter value', () => {
  let reads = 0; const stages = module.createEmbeddingStageGuard(2);
  const accepted = stages.accept('download', { get completed() { return ++reads === 1 ? 0 : 'PRIVATE_TEXT'; }, total: 100, unit: 'bytes', estimated: false });
  assert.deepEqual(accepted, { completed: 0, total: 100, unit: 'bytes', estimated: false }); assert.equal(reads, 1);
});

test('full artifact validation applies to the owned backend metadata snapshot', () => {
  const value = artifact(); let reads = 0;
  Object.defineProperty(value, 'backend', { enumerable: true, get() { return ++reads === 1 ? 'webgpu' : 'wasm'; } });
  const copied = module.copyEmbeddingArtifact(value, module.projectEmbeddingInput(input()), 100);
  assert.equal(copied.backend, 'webgpu'); assert.equal(reads, 1);
});

for (const key of ['kind', 'stage', 'seq']) {
  test(`received progress emits only its validated ${key} snapshot`, async () => {
    const seen = []; const { worker, pending } = start({ onProgress: value => seen.push(value) }); worker.ready();
    const packet = progress('download', 1, 0, 100), original = packet.event[key]; let reads = 0;
    Object.defineProperty(packet.event, key, { enumerable: true, get() { return ++reads === 1 ? original : 'PRIVATE_EVENT'; } });
    worker.emit('message', packet);
    for (const next of [progress('download', 2, 100, 100), progress('initialize', 3, 0, null), progress('encode', 4, 0, 2), progress('encode', 5, 2, 2), result()]) worker.emit('message', next);
    await pending; assert.equal(seen[0][key], original); assert.equal(reads, 1); clean(worker);
  });
}

test('received error settles with only its validated canonical code snapshot', async () => {
  const { worker, pending } = start(); worker.ready(); let reads = 0;
  worker.emit('message', { event: event('error', 'download', 1, {
    get code() { return ++reads === 1 ? 'GPU_DEVICE_LOST' : 'ABORTED'; }, message: 'The WebGPU device was lost.',
  }) });
  await assert.rejects(pending, code('GPU_DEVICE_LOST')); assert.equal(reads, 1); clean(worker);
});

for (const [path, index, changed] of [
  ['chunkIds', '0', 'PRIVATE_CHANGED_ID'],
  ['tokenIds.0', '1', 30522],
  ['tokenIds', '0', [101, 30522, 102]],
]) {
  test(`artifact ${path} commits only the numeric proxy value it validated`, async () => {
    const { worker, pending } = start(); worker.ready(); worker.stages(); const value = artifact();
    const keys = path.split('.'), key = keys.pop(), parent = keys.reduce((part, field) => part[field], value);
    const original = parent[key], expected = structuredClone(value); let reads = 0;
    parent[key] = new Proxy(original, { get(target, field, receiver) {
      if (field === index) return ++reads === 1 ? target[field] : changed;
      return Reflect.get(target, field, receiver);
    } });
    worker.emit('message', result(value)); const accepted = await pending;
    assert.deepEqual(accepted.artifact, expected); assert.equal(reads, 1); clean(worker);
  });
}
