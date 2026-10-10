import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkInWorker, ComputeError } from '../compute-source.mjs';
import { chunkSource } from '../chunking.mjs';
import { createPageRecord } from '../pdf-source.mjs';

const SHA = 'a'.repeat(64);
const PARSER = { name: 'pdfjs', version: '6.4.299', policyVersion: 'text-items-v1', disableNormalization: true };
const OPTIONS = { maxChunkUtf16: 8, overlapUtf16: 2 };
const READY = { kind: 'compute-ready', protocolVersion: 1, workerVersion: 'chunks-v1' };
const identity = () => ({ protocolVersion: 1, runtimeId: 'owned-runtime', operationId: 'op-8', documentEpoch: 5, operation: 'ingest' });
function sourceOf(strings = ['Alpha', ' Beta']) {
  return { schemaVersion: 1, status: 'extracted-not-indexed',
    source: { name: 'private-fixture.pdf', size: 1002, sha256: SHA }, parser: { ...PARSER },
    workerMode: 'node-fake', numPages: 1, pages: [createPageRecord({ sourceSha256: SHA,
      parserVersion: PARSER.version, physicalPageNumber: 1, pageLabel: 'i',
      page: { view: [0, 0, 612, 792], rotate: 0, userUnit: 1 },
      textContent: { items: strings.map(str => ({ str, dir: 'ltr', transform: [1, 0, 0, 1, 30, 740],
        width: 120, height: 12, fontName: 'f1', hasEOL: false })) } })] };
}
function eventOf(kind = 'result', seq = 2, id = identity(), payload) {
  return { ...id, kind, stage: 'index', seq, payload: payload ?? { data: receiptOf(chunkSource(sourceOf(), OPTIONS)) } };
}
function receiptOf(artifact) {
  return { sourceSha256: artifact.source.sha256, parserVersion: artifact.parser.version,
    pageCount: artifact.numPages, status: artifact.status, chunkerVersion: artifact.chunker.version,
    counts: { ...artifact.counts } };
}
function packetOf() {
  const artifact = structuredClone(chunkSource(sourceOf(), OPTIONS));
  return { event: eventOf('result', 2, identity(), { data: receiptOf(artifact) }), artifact };
}
const progressOf = (seq = 1) => ({ event: eventOf('progress', seq, identity(),
  { completed: 0, total: null, unit: 'chunks', estimated: false }) });
const codeIs = code => error => error instanceof ComputeError && error.name === 'ComputeError' && error.code === code;
class ControlledWorker {
  listeners = new Map(); sent = []; terminated = false; terminateCount = 0; postError = false;
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  postMessage(packet) {
    if (this.postError) throw new Error('private text must not escape');
    this.sent.push(packet);
  }
  terminate() { this.terminated = true; this.terminateCount++; }
  emit(type, data) { for (const callback of [...(this.listeners.get(type) ?? [])]) callback(type === 'message' ? { data } : data); }
  ready() { this.emit('message', { ...READY }); }
  result(packet = packetOf()) { this.emit('message', packet); }
}
function start(worker = new ControlledWorker(), options = {}, source = sourceOf()) {
  const pending = chunkInWorker(source, { identity: identity(), workerFactory: () => worker,
    chunkOptions: OPTIONS, readyTimeoutMs: 100, workTimeoutMs: 100, ...options });
  // Attach immediately so an intentionally synchronous rejection is observed.
  pending.catch(() => {});
  return { worker, pending, source };
}
function clean(worker) {
  assert.equal(worker.terminated, true); assert.equal(worker.terminateCount, 1);
  assert.ok([...worker.listeners.values()].every(listeners => listeners.size === 0));
}

test('nothing is posted until the owned channel announces exact readiness; valid result has detached frozen ownership', async () => {
  const { worker, pending, source } = start();
  assert.equal(worker.sent.length, 0);
  worker.ready();
  assert.equal(worker.sent.length, 1);
  assert.deepEqual(Object.keys(worker.sent[0]), ['kind', 'identity', 'source', 'options']);
  assert.equal(worker.sent[0].kind, 'chunk-source'); assert.deepEqual(worker.sent[0].identity, identity());
  assert.deepEqual(worker.sent[0].source.source, source.source); assert.deepEqual(worker.sent[0].source.parser, source.parser);
  assert.deepEqual(worker.sent[0].options, OPTIONS);
  const packet = packetOf(); worker.result(packet);
  const result = await pending;
  assert.deepEqual(result, packet); assert.notEqual(result, packet); assert.notEqual(result.artifact, packet.artifact);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.artifact.chunks[0].segments[0]));
  packet.artifact.chunks[0].text = 'mutated';
  assert.equal(result.artifact.chunks[0].text, 'Alpha\n B');
  assert.equal(Object.hasOwn(result.event.payload.data, 'chunks'), false);
  clean(worker);
});
test('native module worker URL is used and the submitted five-field identity is not relabelled', async () => {
  let url; const worker = new ControlledWorker();
  const { pending } = start(worker, { workerFactory: workerUrl => { url = workerUrl; return worker; } });
  assert.ok(url instanceof URL); assert.ok(url.href.endsWith('/compute.worker.mjs'));
  worker.ready(); worker.result();
  assert.deepEqual((await pending).event, eventOf()); clean(worker);
});
test('actual progress event is forwarded unchanged, detached and metadata-only', async () => {
  const progress = []; const { worker, pending } = start(undefined, { onProgress: event => progress.push(event) });
  worker.ready(); const packet = progressOf(); worker.emit('message', packet); worker.result();
  await pending;
  assert.deepEqual(progress, [packet.event]); assert.notEqual(progress[0], packet.event);
  assert.ok(Object.isFrozen(progress[0].payload)); clean(worker);
});
for (const [name, ready] of [
  ['unknown kind', { ...READY, kind: 'wrong' }], ['wrong version', { ...READY, protocolVersion: 2 }],
  ['wrong worker version', { ...READY, workerVersion: 'other' }], ['extra key', { ...READY, text: 'private' }],
  ['missing key', { kind: 'compute-ready', protocolVersion: 1 }], ['array', []], ['null', null],
]) test(`malformed readiness ${name} rejects before posting`, async () => {
  const { worker, pending } = start(); worker.emit('message', ready);
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); assert.deepEqual(worker.sent, []); clean(worker);
});
test('a terminal packet before readiness cannot commit an artifact', async () => {
  const { worker, pending } = start(); worker.result();
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('duplicate readiness during owned work rejects rather than reposting', async () => {
  const { worker, pending } = start(); worker.ready(); worker.ready();
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); assert.equal(worker.sent.length, 1); clean(worker);
});
test('constructor failure is a safe worker-unavailable error', async () => {
  const { pending } = start(undefined, { workerFactory: () => { throw new Error('private filename'); } });
  await assert.rejects(pending, error => codeIs('WORKER_UNAVAILABLE')(error) && !error.message.includes('private'));
});
test('missing Worker-shaped channel is rejected safely', async () => {
  const { pending } = start(undefined, { workerFactory: () => ({}) });
  await assert.rejects(pending, codeIs('WORKER_UNAVAILABLE'));
});
test('postMessage failure terminates the channel and does not leak its exception', async () => {
  const worker = new ControlledWorker(); worker.postError = true;
  const { pending } = start(worker); worker.ready();
  await assert.rejects(pending, error => codeIs('WORKER_PROTOCOL_ERROR')(error) && !error.message.includes('private')); clean(worker);
});
for (const type of ['error', 'messageerror']) test(`${type} event fails safely and cleans owned channel`, async () => {
  const { worker, pending } = start(); worker.ready(); worker.emit(type, { message: 'private' });
  await assert.rejects(pending, codeIs(type === 'error' ? 'COMPUTE_FAILED' : 'WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('ready timeout sends no command and cleans listeners', async () => {
  const { worker, pending } = start(undefined, { readyTimeoutMs: 5 });
  await assert.rejects(pending, codeIs('COMPUTE_TIMEOUT')); assert.equal(worker.sent.length, 0); clean(worker);
});
test('work timeout starts only after readiness and cleans owned channel', async () => {
  const { worker, pending } = start(undefined, { workTimeoutMs: 5 }); worker.ready();
  await assert.rejects(pending, codeIs('COMPUTE_TIMEOUT')); assert.equal(worker.sent.length, 1); clean(worker);
});
test('already aborted signal does not construct a worker', async () => {
  const abort = new AbortController(); abort.abort(); let constructed = false;
  const { pending } = start(undefined, { signal: abort.signal, workerFactory: () => { constructed = true; return new ControlledWorker(); } });
  await assert.rejects(pending, codeIs('ABORTED')); assert.equal(constructed, false);
});
for (const ready of [false, true]) test(`abort ${ready ? 'after' : 'before'} readiness prevents captured late handlers from committing`, async () => {
  const abort = new AbortController(); const { worker, pending } = start(undefined, { signal: abort.signal });
  const captured = [...worker.listeners.get('message')][0]; if (ready) worker.ready();
  abort.abort(); captured({ data: packetOf() });
  await assert.rejects(pending, codeIs('ABORTED')); clean(worker);
});
for (const option of ['readyTimeoutMs', 'workTimeoutMs']) for (const value of [0, -1, 1.5, NaN, Infinity, '5', null, 2147483648]) {
  test(`invalid ${option} ${String(value)} fails before creating a worker`, async () => {
    let created = false; const { pending } = start(undefined, { [option]: value, workerFactory: () => { created = true; return new ControlledWorker(); } });
    await assert.rejects(pending, codeIs('INVALID_COMPUTE_CONFIG')); assert.equal(created, false);
  });
}
for (const [name, change] of [
  ['runtime', event => { event.runtimeId = 'old'; }], ['operation ID', event => { event.operationId = 'op-7'; }],
  ['epoch', event => { event.documentEpoch--; }], ['protocol', event => { event.protocolVersion = 2; }],
  ['operation', event => { event.operation = 'query'; }], ['stage', event => { event.stage = 'parse'; }],
  ['zero sequence', event => { event.seq = 0; }], ['fraction sequence', event => { event.seq = 2.5; }],
  ['infinite sequence', event => { event.seq = Infinity; }], ['extra event key', event => { event.filename = 'private'; }],
  ['missing event key', event => { delete event.kind; }],
]) test(`wrong ${name} never commits result`, async () => {
  const { worker, pending } = start(); worker.ready(); const packet = packetOf(); change(packet.event); worker.result(packet);
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('a duplicate/non-increasing progress sequence fails before terminal commit', async () => {
  const { worker, pending } = start(); worker.ready(); worker.emit('message', progressOf()); worker.emit('message', progressOf());
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const [name, mutate] of [
  ['extra outer key', packet => { packet.private = 'text'; }],
  ['missing artifact', packet => { delete packet.artifact; }],
  ['artifact inside metadata', packet => { packet.event.payload.data = packet.artifact; }],
  ['extra result payload key', packet => { packet.event.payload.chunks = packet.artifact.chunks; }],
  ['hash mismatch', packet => { packet.artifact.source.sha256 = 'b'.repeat(64); }],
  ['parser mismatch', packet => { packet.artifact.parser.version = '6.4.300'; }],
  ['page count mismatch', packet => { packet.artifact.numPages = 2; }],
  ['receipt mismatch', packet => { packet.event.payload.data.counts.outputUtf16++; }],
  ['artifact count mismatch', packet => { packet.artifact.counts.fragments++; }],
  ['configured chunker mismatch', packet => { packet.artifact.chunker.maxChunkUtf16 = 9; }],
  ['fragment quote mismatch', packet => { packet.artifact.chunks[0].segments[0].quote = 'wrong'; }],
  ['foreign source span', packet => { packet.artifact.chunks[0].segments[0].sourceSpanId = 'foreign'; }],
  ['invalid chunk page', packet => { packet.artifact.chunks[0].physicalPageNumber = 2; }],
  ['extra artifact root key', packet => { packet.artifact.secret = 'private'; }],
]) test(`${name} is rejected, with no partial artifact`, async () => {
  const { worker, pending } = start(); worker.ready(); const packet = packetOf(); mutate(packet); worker.result(packet);
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const [name, payload] of [
  ['extra key', { completed: 0, total: null, unit: 'chunks', estimated: false, text: 'private' }],
  ['wrong unit', { completed: 0, total: null, unit: 'bytes', estimated: false }],
  ['negative completed', { completed: -1, total: null, unit: 'chunks', estimated: false }],
  ['infinite total', { completed: 0, total: Infinity, unit: 'chunks', estimated: false }],
]) test(`invalid progress ${name} cannot be forwarded`, async () => {
  const forwarded = []; const { worker, pending } = start(undefined, { onProgress: event => forwarded.push(event) });
  worker.ready(); worker.emit('message', { event: eventOf('progress', 1, identity(), payload) });
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); assert.deepEqual(forwarded, []); clean(worker);
});
test('safe typed chunking errors reject without propagating arbitrary worker strings', async () => {
  const { worker, pending } = start(); worker.ready(); worker.emit('message', { event: eventOf('error', 2, identity(),
    { code: 'EMPTY_SOURCE', message: 'The source contains no selectable nonblank text.' }) });
  await assert.rejects(pending, codeIs('EMPTY_SOURCE')); clean(worker);
});
test('unknown or noncanonical worker error is a protocol error', async () => {
  const { worker, pending } = start(); worker.ready(); worker.emit('message', { event: eventOf('error', 2, identity(),
    { code: 'EMPTY_SOURCE', message: 'private raw PDF text' }) });
  await assert.rejects(pending, error => codeIs('WORKER_PROTOCOL_ERROR')(error) && !error.message.includes('private')); clean(worker);
});
test('duplicate terminal and captured late ready do not mutate a completed result', async () => {
  const { worker, pending } = start(); const handler = [...worker.listeners.get('message')][0]; worker.ready(); worker.result();
  const result = await pending; const before = structuredClone(result);
  handler({ data: packetOf() }); handler({ data: READY });
  assert.deepEqual(result, before); assert.equal(worker.sent.length, 1); clean(worker);
});
for (const [name, patch] of [
  ['missing', null], ['wrong operation', { operation: 'query' }], ['bad epoch', { documentEpoch: -1 }],
  ['empty runtime', { runtimeId: '' }], ['bad ID', { operationId: 'arbitrary' }],
  ['wrong protocol', { protocolVersion: 2 }], ['extra', { filename: 'private' }],
]) test(`invalid command identity ${name} fails before worker creation`, async () => {
  let created = false;
  const id = patch === null ? null : { ...identity(), ...patch };
  const { pending } = start(undefined, { identity: id, workerFactory: () => { created = true; return new ControlledWorker(); } });
  await assert.rejects(pending, codeIs('INVALID_COMPUTE_CONFIG')); assert.equal(created, false);
});
test('unknown ComputeError code is normalized to a fixed safe fallback', () => {
  const error = new ComputeError('private raw exception');
  assert.equal(error.code, 'COMPUTE_FAILED'); assert.equal(error.message, 'The computation failed safely.');
});
test('source fields are owned at the request boundary, not reread from a mutable caller at readiness', async () => {
  const source = structuredClone(sourceOf()); const before = structuredClone(source);
  const { worker, pending } = start(undefined, {}, source);
  source.source.sha256 = 'b'.repeat(64); source.source.name = 'changed.pdf'; source.pages[0].textItems[0].text = 'changed';
  worker.ready(); assert.deepEqual(worker.sent[0].source.source, before.source);
  assert.equal(worker.sent[0].source.pages[0].textItems[0].text, 'Alpha');
  worker.result(); const result = await pending;
  assert.deepEqual(result.artifact.source, before.source); clean(worker);
});
test('source projection forwards attribution fields but does not copy geometry or unrelated extras', async () => {
  const source = structuredClone(sourceOf()); source.unrelated = { private: 'not chunk input' };
  const { worker, pending } = start(undefined, {}, source); worker.ready();
  assert.equal(Object.hasOwn(worker.sent[0].source, 'unrelated'), false);
  assert.equal(Object.hasOwn(worker.sent[0].source.pages[0].textItems[0], 'bbox'), false);
  assert.deepEqual(worker.sent[0].source.pages[0].textItems[0].span, source.pages[0].textItems[0].span);
  worker.result(); await pending; clean(worker);
});
test('exact non-enumerable identity fields remain present and unmodified in the posted command', async () => {
  const id = {};
  for (const [key, value] of Object.entries(identity())) Object.defineProperty(id, key, { value, enumerable: false });
  const { worker, pending } = start(undefined, { identity: id }); worker.ready();
  assert.deepEqual(worker.sent[0].identity, identity()); worker.result(); await pending; clean(worker);
});
for (const [name, options] of [
  ['explicit null worker factory', { workerFactory: null }], ['invalid callback', { onProgress: null }],
  ['invalid signal', { signal: {} }], ['unknown option', { private: true }],
]) test(`${name} is a safe configuration refusal`, async () => {
  const { pending } = start(undefined, options); await assert.rejects(pending, codeIs('INVALID_COMPUTE_CONFIG'));
});
for (const [name, mutate] of [
  ['aggregate item count', source => { source.pages[0].textItems = new Array(100001); }],
  ['aggregate text budget', source => { source.pages[0].textItems[0].text = 'x'.repeat(2000001); }],
  ['oversized page label', source => { source.pages[0].pageLabel = 'x'.repeat(4097); }],
  ['sparse item array', source => { delete source.pages[0].textItems[0]; }],
]) test(`bounded source projection rejects ${name} before constructing a worker`, async () => {
  const source = structuredClone(sourceOf()); mutate(source); let created = false;
  const { pending } = start(undefined, { workerFactory: () => { created = true; return new ControlledWorker(); } }, source);
  await assert.rejects(pending, codeIs('INVALID_SOURCE')); assert.equal(created, false);
});
for (const [name, mutate] of [
  ['sparse chunks', packet => { delete packet.artifact.chunks[0]; }],
  ['sparse segments', packet => { delete packet.artifact.chunks[0].segments[0]; }],
  ['oversized chunks', packet => { packet.artifact.chunks.length = 10001; }],
  ['oversized output receipt', packet => { packet.artifact.counts.outputUtf16 = packet.event.payload.data.counts.outputUtf16 = 4000001; }],
  ['oversized fragment receipt', packet => { packet.artifact.counts.fragments = packet.event.payload.data.counts.fragments = 200001; }],
  ['invalid presentation attribution', packet => { packet.artifact.chunks[0].segments[1].sourceSpanId = 'invented'; }],
  ['array-shaped result metadata', packet => { packet.event.payload.data = []; }],
  ['extra result metadata key', packet => { packet.event.payload.data.filename = 'private'; }],
  ['unknown worker error code', packet => { packet.event = eventOf('error', 2, identity(), { code: 'UNKNOWN', message: 'private' }); delete packet.artifact; }],
  ['unsupported terminal kind', packet => { packet.event.kind = 'cancelled'; }],
]) test(`strict finite artifact boundary refuses ${name}`, async () => {
  const { worker, pending } = start(); worker.ready(); const packet = packetOf(); mutate(packet); worker.result(packet);
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('progress callback failure safely terminates owned work', async () => {
  const { worker, pending } = start(undefined, { onProgress: () => { throw new Error('private'); } });
  worker.ready(); worker.emit('message', progressOf());
  await assert.rejects(pending, error => codeIs('WORKER_PROTOCOL_ERROR')(error) && !error.message.includes('private')); clean(worker);
});
test('abort listener is removed on successful work', async () => {
  const listeners = new Set(); const signal = { aborted: false,
    addEventListener(type, callback) { assert.equal(type, 'abort'); listeners.add(callback); },
    removeEventListener(type, callback) { assert.equal(type, 'abort'); listeners.delete(callback); } };
  const { worker, pending } = start(undefined, { signal }); assert.equal(listeners.size, 1);
  worker.ready(); worker.result(); await pending; assert.equal(listeners.size, 0); clean(worker);
});
test('abort-listener cleanup failure cannot leak an exception or prevent terminal settlement', { timeout: 250 }, async () => {
  const signal = { aborted: false, addEventListener() {}, removeEventListener() { throw new Error('private listener exception'); } };
  const { worker, pending } = start(undefined, { signal }); worker.ready();
  assert.doesNotThrow(() => worker.result());
  assert.equal((await pending).artifact.status, 'chunked-not-embedded'); clean(worker);
});
test('abort-listener installation failure settles with a fixed safe worker error', { timeout: 250 }, async () => {
  const signal = { aborted: false, addEventListener() { throw new Error('private listener exception'); },
    removeEventListener() { throw new Error('private cleanup exception'); } };
  const { worker, pending } = start(undefined, { signal });
  await assert.rejects(pending, error => codeIs('WORKER_UNAVAILABLE')(error) && !error.message.includes('private')); clean(worker);
});
test('joined-page attribution rejects windows shifted beyond the source page even with matching IDs and quotes', async () => {
  const source = sourceOf(['Alpha', 'Alpha']), chunkOptions = { maxChunkUtf16: 5, overlapUtf16: 0 };
  const artifact = structuredClone(chunkSource(source, chunkOptions));
  for (const chunk of artifact.chunks) {
    chunk.startUtf16 += 1000; chunk.endUtf16 += 1000;
    chunk.id = chunk.id.replace(/\/u16-\d+-\d+$/, `/u16-${chunk.startUtf16}-${chunk.endUtf16}`);
  }
  const { worker, pending } = start(undefined, { chunkOptions }, source); worker.ready();
  worker.result({ event: eventOf('result', 2, identity(), { data: receiptOf(artifact) }), artifact });
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('joined-page attribution rejects substituting an identical-text item from another position', async () => {
  const source = sourceOf(['Alpha', 'Alpha']), chunkOptions = { maxChunkUtf16: 5, overlapUtf16: 0 };
  const artifact = structuredClone(chunkSource(source, chunkOptions));
  artifact.chunks[0].segments[0].itemIndex = 1;
  artifact.chunks[0].segments[0].sourceSpanId = source.pages[0].textItems[1].span.id;
  const { worker, pending } = start(undefined, { chunkOptions }, source); worker.ready();
  worker.result({ event: eventOf('result', 2, identity(), { data: receiptOf(artifact) }), artifact });
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('joined-page attribution does not relabel an original item newline as an authored separator', async () => {
  const source = sourceOf(['A\nB', 'C']), chunkOptions = { maxChunkUtf16: 8, overlapUtf16: 0 };
  const artifact = structuredClone(chunkSource(source, chunkOptions));
  const segment = artifact.chunks[0].segments[0];
  artifact.chunks[0].segments.splice(0, 1,
    { ...segment, endUtf16: 1, quote: 'A', chunkEndUtf16: 1 },
    { kind: 'presentation', text: '\n', chunkStartUtf16: 1, chunkEndUtf16: 2 },
    { ...segment, startUtf16: 2, quote: 'B', chunkStartUtf16: 2 });
  artifact.counts.fragments += 2;
  const { worker, pending } = start(undefined, { chunkOptions }, source); worker.ready();
  worker.result({ event: eventOf('result', 2, identity(), { data: receiptOf(artifact) }), artifact });
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); clean(worker);
});
test('numeric attribution preserves original indices while zero-length items create no separator', async () => {
  const source = sourceOf(['', 'Alpha', '', '', 'Alpha']), chunkOptions = { maxChunkUtf16: 5, overlapUtf16: 0 };
  const artifact = structuredClone(chunkSource(source, chunkOptions));
  const { worker, pending } = start(undefined, { chunkOptions }, source); worker.ready();
  worker.result({ event: eventOf('result', 2, identity(), { data: receiptOf(artifact) }), artifact });
  assert.deepEqual((await pending).artifact, artifact); clean(worker);
});

function sourceWithPages(pages) {
  const source = sourceOf();
  source.numPages = pages.length;
  source.pages = pages.map((strings, index) => createPageRecord({ sourceSha256: SHA,
    parserVersion: PARSER.version, physicalPageNumber: index + 1, pageLabel: null,
    page: { view: [0, 0, 612, 792], rotate: 0, userUnit: 1 },
    textContent: { items: strings.map(str => ({ str, dir: 'ltr', transform: [1, 0, 0, 1, 30, 740],
      width: 120, height: 12, fontName: 'f1', hasEOL: false })) } }));
  return source;
}
function recount(artifact) {
  artifact.counts = { chunks: artifact.chunks.length,
    outputUtf16: artifact.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
    fragments: artifact.chunks.reduce((sum, chunk) => sum + chunk.segments.length, 0) };
}
for (const [name, alter] of [
  ['first window', artifact => artifact.chunks.shift()],
  ['middle window', artifact => artifact.chunks.splice(1, 1)],
  ['final window', artifact => artifact.chunks.pop()],
  ['entire text page', artifact => { artifact.chunks = artifact.chunks.filter(chunk => chunk.physicalPageNumber !== 2); }],
]) test(`canonical worker windows reject an omitted ${name} even with consistent counts and receipt`, async () => {
  const source = sourceWithPages([['ABCDEFGHIJKLMN'], ['Second page']]);
  const chunkOptions = { maxChunkUtf16: 5, overlapUtf16: 1 };
  const artifact = structuredClone(chunkSource(source, chunkOptions)); alter(artifact); recount(artifact);
  const { worker, pending } = start(undefined, { chunkOptions }, source); worker.ready();
  worker.result({ event: eventOf('result', 2, identity(), { data: receiptOf(artifact) }), artifact });
  await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); clean(worker);
});
for (const [name, alter] of [
  ['page ordinal', source => { source.pages[0].physicalPageNumber = 2; }],
  ['page SHA', source => { source.pages[0].sourceSha256 = 'b'.repeat(64); }],
  ['page parser', source => { source.pages[0].parserVersion = '6.4.300'; }],
  ['page policy', source => { source.pages[0].policyVersion = 'other'; }],
  ['item ordinal', source => { source.pages[0].textItems[0].itemIndex = 1; }],
  ['span ID', source => { source.pages[0].textItems[0].span.id = 'PRIVATE_FORGED_SPAN'; }],
  ['full span start', source => { source.pages[0].textItems[0].span.startUtf16 = 1; }],
  ['full span end', source => { source.pages[0].textItems[0].span.endUtf16 = 4; }],
  ['actual page status', source => { source.pages[0].status = 'empty'; }],
]) test(`source projection rejects inconsistent ${name} before constructing a worker`, async () => {
  const source = structuredClone(sourceOf()); alter(source); let constructed = false;
  const { pending } = start(undefined, { workerFactory: () => { constructed = true; throw new Error('PRIVATE'); } }, source);
  await assert.rejects(pending, codeIs('INVALID_SOURCE')); assert.equal(constructed, false);
});
test('worker keeps blank mechanical windows in a text page rather than filtering them', async () => {
  const source = sourceOf(['A       B']), chunkOptions = { maxChunkUtf16: 3, overlapUtf16: 0 };
  const artifact = structuredClone(chunkSource(source, chunkOptions));
  assert.ok(artifact.chunks.some(chunk => !chunk.text.trim()));
  const { worker, pending } = start(undefined, { chunkOptions }, source); worker.ready();
  worker.result({ event: eventOf('result', 2, identity(), { data: receiptOf(artifact) }), artifact });
  assert.deepEqual((await pending).artifact, artifact); clean(worker);
});
for (const [budget, value] of [['maxChunks', 1], ['maxOutputUtf16', 1], ['maxFragments', 1]]) {
  test(`worker terminal retains the requested reduced ${budget} budget`, async () => {
    const chunkOptions = { ...OPTIONS, [budget]: value };
    const { worker, pending } = start(undefined, { chunkOptions }); worker.ready(); worker.result();
    await assert.rejects(pending, codeIs('WORKER_PROTOCOL_ERROR')); clean(worker);
  });
}
