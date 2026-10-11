import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { EMBEDDING_SPEC } from '../embedding-contract.mjs';
import { EmbeddingRuntimeError } from '../embedding-runtime.mjs';
const module = await import('../embedding.worker.mjs').catch(() => ({}));
const HASH = 'a'.repeat(64);
const id = () => ({ protocolVersion: 1, runtimeId: 'worker-test', operationId: 'op-1', documentEpoch: 0, operation: 'embed' });
const input = () => ({ schemaVersion: 1, status: 'chunked-not-embedded', source: { sha256: HASH }, counts: { chunks: 1 }, chunks: [{ id: 'PRIVATE_CHUNK', text: 'PRIVATE_TEXT' }] });
const command = () => ({ kind: 'embed-chunks', workerVersion:'embedding-v2',identity: id(), chunkArtifact: input() });
const output = () => ({ schemaVersion: 1, status: 'embedded-not-retrieved', sourceSha256: HASH, representationId: EMBEDDING_SPEC.version,
  representation: { ...EMBEDDING_SPEC }, backend: 'webgpu', dtype: 'fp32', chunkIds: ['PRIVATE_CHUNK'], tokenIds: [[101, 42, 102]],
  vectors: [[1, ...new Array(383).fill(0)]], counts: { chunks: 1, totalTokens: 3, dimensions: 384 },
  receipt: { verifiedBytes: 100, networkBytes: 100, cacheBytes: 0, elapsedMs: 2 } });
function stages(onProgress) { onProgress('download', { completed: 0, total: 100, unit: 'bytes', estimated: false }); onProgress('download', { completed: 100, total: 100, unit: 'bytes', estimated: false }); onProgress('initialize', { completed: 0, total: null, unit: 'chunks', estimated: false }); onProgress('encode', { completed: 0, total: 1, unit: 'chunks', estimated: false }); onProgress('encode', { completed: 1, total: 1, unit: 'chunks', estimated: false }); }
function handler(send, options) { assert.equal(typeof module.createEmbeddingCommandHandler, 'function', 'worker must expose a pure one-shot command handler'); return module.createEmbeddingCommandHandler(send, options); }
test('pure handler emits monotonic metadata events and a separate immutable artifact', async () => {
  const packets = []; let received;
  const handle = handler(packet => packets.push(packet), { encode: async (source, { onProgress }) => { received = source; stages(onProgress); return output(); } });
  assert.equal(await handle(command()), true); assert.deepEqual(received, input());
  assert.equal(packets.length, 6); assert.deepEqual(packets.map(packet => packet.event.seq), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(packets.map(packet => packet.event.stage), ['download', 'download', 'initialize', 'encode', 'encode', 'encode']);
  assert.equal(packets[5].event.kind, 'result'); assert.equal(JSON.stringify(packets.map(packet => packet.event)).includes('PRIVATE'), false);
  assert.deepEqual(packets[5].artifact, output()); assert.ok(Object.isFrozen(packets[5].artifact.vectors[0]));
});
test('isolated Node imports and pure embedding handler preserve console identity, prototype and descriptors', () => {
  const fixture = `import assert from 'node:assert/strict';
    const original = globalThis.console, prototype = Object.getPrototypeOf(original);
    const keys = Reflect.ownKeys(original);
    const descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(original, key)]));
    function unchanged(stage) {
      assert.equal(globalThis.console, original, stage + ': console identity');
      assert.equal(Object.getPrototypeOf(globalThis.console), prototype, stage + ': console prototype');
      assert.deepEqual(Reflect.ownKeys(globalThis.console), keys, stage + ': console own keys');
      for (const [key, descriptor] of descriptors) {
        assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis.console, key), descriptor, stage + ': ' + String(key));
      }
    }
    const worker = await import(${JSON.stringify(new URL('../embedding.worker.mjs', import.meta.url).href)});
    unchanged('embedding import');
    await import(${JSON.stringify(new URL('../query.worker.mjs', import.meta.url).href)});
    unchanged('query import');
    const packets = [];
    const handle = worker.createEmbeddingCommandHandler(packet => packets.push(packet), {
      encode: (_source, { onProgress }) => { (${stages.toString()})(onProgress); return ${JSON.stringify(output())}; },
    });
    unchanged('handler creation');
    assert.equal(await handle(${JSON.stringify(command())}), true);
    assert.equal(packets.at(-1).event.kind, 'result');
    unchanged('pure embedding command');`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', fixture], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
});
for (const [name, mutate] of [
  ['wrong kind', value => { value.kind = 'wrong'; }], ['extra command', value => { value.filename = 'PRIVATE'; }],
  ['wrong identity', value => { value.identity.operation = 'query'; }], ['missing identity', value => { delete value.identity; }],
  ['extra input', value => { value.chunkArtifact.filename = 'PRIVATE'; }], ['extra chunk', value => { value.chunkArtifact.chunks[0].geometry = 'PRIVATE'; }],
  ['extra source', value => { value.chunkArtifact.source.name = 'PRIVATE'; }], ['invalid source', value => { value.chunkArtifact.counts.chunks = 2; }],
]) test(`malformed ${name} fails safely without an invented event or encoder call`, () => {
  let calls = 0; const packets = []; const handle = handler(packet => packets.push(packet), { encode: () => { calls++; } });
  const value = command(); mutate(value);
  assert.throws(() => handle(value), error => error.code === 'WORKER_PROTOCOL_ERROR' && !error.message.includes('PRIVATE'));
  assert.equal(calls, 0); assert.deepEqual(packets, []);
});
test('duplicate valid commands cannot call the encoder twice, including concurrent duplicates', async () => {
  let calls = 0, resolve; const handle = handler(() => {}, { encode: (_source, { onProgress }) => { calls++; stages(onProgress); return new Promise(done => { resolve = done; }); } });
  const pending = handle(command()); assert.throws(() => handle(command()), error => error.code === 'WORKER_PROTOCOL_ERROR');
  resolve(output()); await pending; assert.equal(calls, 1);
});
test('invalid first command does not consume the truthful one-shot request', async () => {
  const packets = []; const handle = handler(packet => packets.push(packet), { encode: async (_source, { onProgress }) => { stages(onProgress); return output(); } });
  assert.throws(() => handle(null), error => error.code === 'WORKER_PROTOCOL_ERROR'); await handle(command()); assert.equal(packets.at(-1).event.kind, 'result');
});
for (const [stage, prefix] of [['download', () => {}], ['initialize', progress => {
  progress('download', { completed: 0, total: 100, unit: 'bytes', estimated: false }); progress('download', { completed: 100, total: 100, unit: 'bytes', estimated: false }); progress('initialize', { completed: 0, total: null, unit: 'chunks', estimated: false });
}], ['encode', progress => { stages(progress); }]]) test(`runtime error is canonical and attributed to last actual ${stage} stage`, async () => {
  const packets = []; const handle = handler(packet => packets.push(packet), { encode: async (_source, { onProgress }) => { prefix(onProgress); throw new EmbeddingRuntimeError('GPU_DEVICE_LOST'); } });
  await handle(command()); const terminal = packets.at(-1).event;
  assert.equal(terminal.stage, stage); assert.equal(terminal.kind, 'error'); assert.deepEqual(terminal.payload, { code: 'GPU_DEVICE_LOST', message: 'The WebGPU device was lost.',workerFailure:{component:'encoder-initializer',phase:'unknown',assetIndex:null,allowedCode:'GPU_DEVICE_LOST'} });
});
test('arbitrary encoder failure never leaks exception, input or cause', async () => {
  const packets = []; const handle = handler(packet => packets.push(packet), { encode: () => { throw new Error('PRIVATE_RAW', { cause: input() }); } });
  await handle(command()); assert.deepEqual(packets[0].event.payload, { code: 'EMBEDDING_FAILED', message: 'The embedding operation failed.',workerFailure:{component:'encoder-initializer',phase:'unknown',assetIndex:null,allowedCode:'EMBEDDING_FAILED'} }); assert.equal(JSON.stringify(packets).includes('PRIVATE'), false);
});
for (const [name, encode] of [
  ['result without completed stages', () => output()], ['invalid output', (_source, { onProgress }) => { stages(onProgress); return { ...output(), vectors: [[0, ...new Array(383).fill(0)]] }; }],
  ['out-of-order progress', (_source, { onProgress }) => { onProgress('encode', { completed: 0, total: 1, unit: 'chunks', estimated: false }); return output(); }],
  ['metadata text', (_source, { onProgress }) => { onProgress('download', { completed: 0, total: 100, unit: 'bytes', estimated: false, text: 'PRIVATE' }); return output(); }],
]) test(`encoder ${name} yields a safe protocol terminal, never an artifact`, async () => {
  const packets = []; await handler(packet => packets.push(packet), { encode })(command());
  assert.equal(packets.at(-1).event.kind, 'error'); assert.equal(packets.at(-1).event.payload.code, 'WORKER_PROTOCOL_ERROR'); assert.equal(packets.some(packet => Object.hasOwn(packet, 'artifact')), false);
});
test('send failure is a fixed safe exception', async () => {
  const handle = handler(() => { throw new Error('PRIVATE_SEND'); }, { encode: (_source, { onProgress }) => { stages(onProgress); return output(); } });
  await assert.rejects(handle(command()), error => error.code === 'EMBEDDING_FAILED' && !error.message.includes('PRIVATE'));
});
test('handler configuration is validated without work', () => {
  for (const [send, options] of [[null, {}], [() => {}, { encode: null }], [() => {}, { private: true }]]) assert.throws(() => handler(send, options), error => error.code === 'INVALID_EMBEDDING_WORKER_CONFIG');
});
test('handler owns the projected input before an asynchronous encoder resumes', async () => {
  let received, resume; const packets = [];
  const handle = handler(packet => packets.push(packet), { encode: async (source, { onProgress }) => { received = source; await new Promise(done => { resume = done; }); stages(onProgress); return output(); } });
  const value = command(); const pending = handle(value); value.chunkArtifact.chunks[0].text = 'CHANGED'; value.chunkArtifact.chunks[0].id = 'CHANGED'; value.identity.operationId = 'op-2';
  assert.deepEqual(received, input()); assert.ok(Object.isFrozen(received.chunks[0])); resume(); await pending;
  assert.equal(packets.at(-1).event.operationId, 'op-1');
});
test('forged typed-looking errors cannot launder private exception messages', async () => {
  const packets = []; await handler(packet => packets.push(packet), { encode: () => { throw { name: 'EmbeddingRuntimeError', code: 'GPU_DEVICE_LOST', message: 'PRIVATE' }; } })(command());
  assert.equal(packets[0].event.payload.code, 'EMBEDDING_FAILED'); assert.equal(JSON.stringify(packets).includes('PRIVATE'), false);
});
for (const target of ['tokenIds', 'tokenIds.0', 'vectors', 'vectors.0', 'chunkIds']) {
  test(`pure handler refuses a hidden numeric entry in ${target}`, async () => {
    const packets = []; const handle = handler(packet => packets.push(packet), { encode: (_source, { onProgress }) => {
      stages(onProgress); const value = output(); const array = target.split('.').reduce((part, key) => part[key], value);
      Object.defineProperty(array, '0', { enumerable: false }); return value;
    } });
    await handle(command()); assert.equal(packets.at(-1).event.kind, 'error'); assert.equal(packets.at(-1).event.payload.code, 'WORKER_PROTOCOL_ERROR');
    assert.equal(packets.some(packet => Object.hasOwn(packet, 'artifact')), false);
  });
}
test('pure handler configuration getter exceptions are canonical and do not run encoder', () => {
  const options = { get encode() { throw new Error('PRIVATE_ENCODER_GETTER'); } };
  assert.throws(() => handler(() => {}, options), error => error.code === 'INVALID_EMBEDDING_WORKER_CONFIG' && !error.message.includes('PRIVATE'));
});
test('explicit undefined encoder receives the approved default without invoking SDK for an invalid command', () => {
  let handle; assert.doesNotThrow(() => { handle = handler(() => {}, { encode: undefined }); });
  assert.throws(() => handle(null), error => error.code === 'WORKER_PROTOCOL_ERROR');
});
test('command getter throwing only during owned projection cannot leak raw diagnostics or run encoder', () => {
  let reads = 0, calls = 0; const value = command(), source = value.chunkArtifact;
  Object.defineProperty(value, 'chunkArtifact', { enumerable: true, get() { if (++reads > 1) throw new Error('PRIVATE_COMMAND_GETTER'); return source; } });
  const handle = handler(() => {}, { encode: () => { calls++; } });
  assert.throws(() => handle(value), error => error.code === 'WORKER_PROTOCOL_ERROR' && !error.message.includes('PRIVATE')); assert.equal(calls, 0);
});

for (const [name, failure] of [
  ['throwing prototype inspection', () => new Proxy(new Error(), { getPrototypeOf() { throw new Error('PRIVATE_PROTOTYPE'); } })],
  ['throwing typed error code', () => { const error = new EmbeddingRuntimeError('GPU_DEVICE_LOST'); Object.defineProperty(error, 'code', { get() { throw new Error('PRIVATE_CODE_GETTER'); } }); return error; }],
]) test(`encoder ${name} still emits a canonical safe terminal`, async () => {
  const packets = [];
  await handler(packet => packets.push(packet), { encode: () => { throw failure(); } })(command());
  assert.deepEqual(packets[0].event.payload, { code: 'EMBEDDING_FAILED', message: 'The embedding operation failed.',workerFailure:{component:'encoder-initializer',phase:'unknown',assetIndex:null,allowedCode:'EMBEDDING_FAILED'} });
  assert.equal(JSON.stringify(packets).includes('PRIVATE'), false);
});

// Exercise the actual native-install branch in an isolated VM realm. The fake
// host obeys the WorkerGlobalScope guard, without ever mutating Node's console.
function nativeFixture(frozen = false) {
  const sourceURL = new URL('../embedding.worker.mjs', import.meta.url);
  const fixture = `import vm from 'node:vm'; import fs from 'node:fs';
    const state={calls:0,leaks:[],packets:[],listeners:{}};
    const context=vm.createContext({state});
    vm.runInContext(\`class WorkerGlobalScope{};globalThis.WorkerGlobalScope=WorkerGlobalScope;Object.setPrototypeOf(globalThis,WorkerGlobalScope.prototype);
      globalThis.console=Object.fromEntries(['log','error','warn','info','debug','trace','table','dir','dirxml','assert','group','groupCollapsed','groupEnd','time','timeEnd','timeLog','count','countReset','clear'].map(key=>[key,(...args)=>state.leaks.push(args)]));
      ${frozen ? 'Object.freeze(console);' : ''}
      globalThis.postMessage=packet=>state.packets.push(packet);globalThis.addEventListener=(type,listener)=>state.listeners[type]=listener;
      globalThis.setTimeout=()=>{};\`,context);
    const cache=new Map(); function load(url){if(cache.has(url))return cache.get(url);const code=url.endsWith('/embedding-runtime.mjs')?
      \`export class EmbeddingRuntimeError extends Error{};export async function encodeChunks(){state.calls++;console.error('PRIVATE_TENSOR');throw new Error('PRIVATE_RUNTIME');}\`:fs.readFileSync(new URL(url),'utf8');
      const mod=new vm.SourceTextModule(code,{context,identifier:url});cache.set(url,mod);return mod;}
    const root=load(${JSON.stringify(sourceURL.href)});await root.link((specifier,parent)=>load(new URL(specifier,parent.identifier).href));await root.evaluate();
    const before=state.leaks.length; console.log('host console unaffected');
    vm.runInContext('state.listeners.message({data:JSON.parse('+${JSON.stringify(JSON.stringify(JSON.stringify(command())))}+')})',context);await new Promise(done=>setImmediate(done));
    process.stdout.write(JSON.stringify({calls:state.calls,leaks:state.leaks,packets:state.packets,before}));`;
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', fixture], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr); return JSON.parse(run.stdout.split('\n').at(-1));
}
test('native worker suppresses SDK console before encoding, without logging private tensors', () => {
  assert.equal(typeof module.createEmbeddingCommandHandler, 'function');
  const value = nativeFixture(); assert.equal(value.calls, 1); assert.deepEqual(value.leaks, []);
  assert.equal(value.packets[0].kind, 'embedding-ready'); assert.equal(value.packets.at(-1).event.payload.code, 'EMBEDDING_FAILED');
});
test('native frozen console safely refuses before calling encoder', () => {
  assert.equal(typeof module.createEmbeddingCommandHandler, 'function');
  const value = nativeFixture(true); assert.equal(value.calls, 0); assert.deepEqual(value.leaks, []); assert.equal(value.packets.at(-1).event.payload.code, 'EMBEDDING_FAILED');
});
