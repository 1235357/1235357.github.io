import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputeCommandHandler } from '../compute.worker.mjs';
import { ComputeError } from '../compute-source.mjs';
import { chunkSource } from '../chunking.mjs';
import { createPageRecord } from '../pdf-source.mjs';

const SHA = 'a'.repeat(64);
const identity = () => ({ protocolVersion: 1, runtimeId: 'native-channel', operationId: 'op-4', documentEpoch: 2, operation: 'ingest' });
const options = { maxChunkUtf16: 8, overlapUtf16: 2 };
function sourceOf(text = 'Alpha Beta Gamma') {
  return { schemaVersion: 1, status: 'extracted-not-indexed',
    source: { name: 'private.pdf', size: 99, sha256: SHA }, workerMode: 'node-fake', numPages: 1,
    parser: { name: 'pdfjs', version: '6.4.299', policyVersion: 'text-items-v1', disableNormalization: true },
    pages: [createPageRecord({ sourceSha256: SHA, parserVersion: '6.4.299', physicalPageNumber: 1,
      pageLabel: null, page: { view: [0, 0, 100, 100], rotate: 0, userUnit: 1 },
      textContent: { items: [{ str: text, dir: 'ltr', transform: [1, 0, 0, 1, 0, 0], width: 20,
        height: 10, fontName: 'f1', hasEOL: false }] } })] };
}
const commandOf = () => ({ kind: 'chunk-source', identity: identity(), source: sourceOf(), options: { ...options } });
const codeIs = code => error => error instanceof ComputeError && error.code === code;
test('pure command handler emits exact initial progress and real chunk artifact with small receipt', () => {
  const packets = []; const handler = createComputeCommandHandler(packet => packets.push(packet));
  const command = commandOf(); const before = structuredClone(command);
  assert.equal(handler(command), true); assert.deepEqual(command, before);
  const artifact = chunkSource(command.source, command.options);
  assert.deepEqual(packets, [
    { event: { ...identity(), kind: 'progress', stage: 'index', seq: 1,
      payload: { completed: 0, total: null, unit: 'chunks', estimated: false } } },
    { event: { ...identity(), kind: 'result', stage: 'index', seq: 2, payload: { data: {
      sourceSha256: SHA, parserVersion: '6.4.299', pageCount: 1, status: 'chunked-not-embedded',
      chunkerVersion: 'page-parser-order-v1', counts: { ...artifact.counts } } } }, artifact },
  ]);
  assert.equal(JSON.stringify(packets[0]).includes('private'), false);
  assert.equal(JSON.stringify(packets[1].event).includes('private'), false);
});
test('each concrete handler consumes one command only', () => {
  const packets = []; const handler = createComputeCommandHandler(packet => packets.push(packet));
  handler(commandOf()); const count = packets.length;
  assert.throws(() => handler(commandOf()), codeIs('WORKER_PROTOCOL_ERROR')); assert.equal(packets.length, count);
});
for (const [name, mutate] of [
  ['kind', command => { command.kind = 'query'; }], ['outer keys', command => { command.extra = true; }],
  ['missing source', command => { delete command.source; }], ['missing options', command => { delete command.options; }],
  ['identity operation', command => { command.identity.operation = 'query'; }],
  ['identity version', command => { command.identity.protocolVersion = 2; }],
  ['identity epoch', command => { command.identity.documentEpoch = -1; }],
  ['identity extra', command => { command.identity.text = 'private'; }],
  ['identity null', command => { command.identity = null; }],
]) test(`invalid command ${name} emits nothing and never invents identity`, () => {
  const packets = []; const handler = createComputeCommandHandler(packet => packets.push(packet));
  const command = commandOf(); mutate(command);
  assert.throws(() => handler(command), codeIs('WORKER_PROTOCOL_ERROR')); assert.deepEqual(packets, []);
});
for (const [code, mutate] of [
  ['INVALID_SOURCE', command => { command.source.status = 'private unsupported text'; }],
  ['INVALID_CONFIG', command => { command.options.maxChunkUtf16 = 1; }],
  ['CHUNK_LIMIT', command => { command.options.maxChunks = 1; }],
  ['EMPTY_SOURCE', command => { command.source = sourceOf('  '); }],
]) test(`real chunker ${code} becomes a fixed safe error event`, () => {
  const packets = []; const handler = createComputeCommandHandler(packet => packets.push(packet));
  const command = commandOf(); mutate(command); handler(command);
  assert.equal(packets.length, 2); assert.deepEqual(Object.keys(packets[1]), ['event']);
  assert.deepEqual({ ...packets[1].event, payload: undefined }, { ...identity(), kind: 'error', stage: 'index', seq: 2, payload: undefined });
  assert.equal(packets[1].event.payload.code, code);
  assert.equal(JSON.stringify(packets).includes('private'), false);
});
test('handler validates its sender instead of failing later with arbitrary errors', () => {
  assert.throws(() => createComputeCommandHandler(null), codeIs('INVALID_COMPUTE_CONFIG'));
});
test('non-enumerable controller identity is copied by its exact five fields', () => {
  const packets = []; const handler = createComputeCommandHandler(packet => packets.push(packet));
  const command = commandOf(), id = {};
  for (const [key, value] of Object.entries(identity())) Object.defineProperty(id, key, { value, enumerable: false });
  command.identity = id; handler(command);
  assert.deepEqual(packets[0].event, { ...identity(), kind: 'progress', stage: 'index', seq: 1,
    payload: { completed: 0, total: null, unit: 'chunks', estimated: false } });
});
test('unexpected chunker exception is mapped without its raw message', () => {
  const command = commandOf(); Object.defineProperty(command.source, 'status', { get() { throw new Error('private raw exception'); } });
  const packets = []; createComputeCommandHandler(packet => packets.push(packet))(command);
  assert.equal(packets[1].event.payload.code, 'COMPUTE_FAILED');
  assert.equal(packets[1].event.payload.message, 'The computation failed safely.');
  assert.equal(JSON.stringify(packets).includes('private'), false);
});
test('sender failure is safely typed rather than forwarding its raw exception', () => {
  const handler = createComputeCommandHandler(() => { throw new Error('private raw exception'); });
  assert.throws(() => handler(commandOf()), error => codeIs('COMPUTE_FAILED')(error) && !error.message.includes('private'));
});
