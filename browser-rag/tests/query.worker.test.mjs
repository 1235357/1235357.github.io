import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { encodeQuery, EmbeddingRuntimeError } from '../embedding-runtime.mjs';
import { RetrievalError } from '../retrieval.mjs';
import { Tensor, mean_pooling } from '../node_modules/@huggingface/transformers/src/utils/tensor.js';
import { WASM_FILE, WASM_PIN, wasmBytes } from './wasm-runtime-fixture.mjs';
import { input, passages, query, command, resultArtifact, encodeStages, identity, code, ControlledWorker, clean } from './query-fixtures.mjs';
const module = await import('../query.worker.mjs').catch(() => ({}));
const sourceModule = await import('../query-source.mjs').catch(() => ({}));
function handler(send, options) { assert.equal(typeof module.createQueryCommandHandler, 'function', 'pure query handler must exist'); return module.createQueryCommandHandler(send, options); }
test('one-shot pure worker encodes the raw question once and ranks owned historical passages', async () => {
  const packets = []; let received;
  const handle = handler(packet => packets.push(packet), { encode: async (question, { onProgress }) => { received = question; encodeStages(onProgress); return query(); } });
  const value = command(), pending = handle(value); value.question = 'CHANGED'; value.embeddingArtifact.vectors[1][1] = 0;
  assert.throws(() => handle(command()), code('WORKER_PROTOCOL_ERROR')); assert.equal(await pending, true); assert.equal(received, 'PRIVATE_QUESTION');
  assert.deepEqual(packets.map(p => p.event.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(packets.map(p => p.event.stage), ['download', 'download', 'initialize', 'encode', 'encode', 'rank', 'rank', 'rank']);
  assert.equal(JSON.stringify(packets.map(p => p.event)).includes('PRIVATE'), false);
  assert.deepEqual(packets.at(-1).artifact, resultArtifact()); assert.ok(Object.isFrozen(packets.at(-1).artifact.query.vector));
});
test('isolated Node imports and pure query handler preserve console identity, prototype and descriptors', () => {
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
    const worker = await import(${JSON.stringify(new URL('../query.worker.mjs', import.meta.url).href)});
    unchanged('query import');
    await import(${JSON.stringify(new URL('../embedding.worker.mjs', import.meta.url).href)});
    unchanged('embedding import');
    const { command, encodeStages, query } = await import(${JSON.stringify(new URL('./query-fixtures.mjs', import.meta.url).href)});
    const packets = [];
    const handle = worker.createQueryCommandHandler(packet => packets.push(packet), {
      encode: (_question, { onProgress }) => { encodeStages(onProgress); return query(); },
    });
    unchanged('handler creation');
    assert.equal(await handle(command()), true);
    assert.equal(packets.at(-1).event.kind, 'result');
    unchanged('pure query command');`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', fixture], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
});
for (const [name, mutate] of [
  ['kind', c => { c.kind = 'embed-chunks'; }], ['extra command', c => { c.private = true; }], ['identity', c => { c.identity.operation = 'embed'; }],
  ['question', c => { c.question = ''; }], ['topK', c => { c.topK = 0; }], ['source extra', c => { c.chunkArtifact.source.name = 'PRIVATE'; }],
  ['chunk extra', c => { c.chunkArtifact.chunks[0].geometry = 'PRIVATE'; }], ['passage source', c => { c.embeddingArtifact.sourceSha256 = 'b'.repeat(64); }],
]) test(`invalid command ${name} authors no events or encoder calls`, () => {
  let calls = 0; const packets = [], handle = handler(packet => packets.push(packet), { encode: () => { calls++; } }); const value = command(); mutate(value);
  assert.throws(() => handle(value), code('WORKER_PROTOCOL_ERROR')); assert.equal(calls, 0); assert.deepEqual(packets, []);
});
test('invalid first command does not consume valid one-shot command', async () => { const packets = []; const handle = handler(p => packets.push(p), { encode: (_question, { onProgress }) => { encodeStages(onProgress); return query(); } }); assert.throws(() => handle(null), code('WORKER_PROTOCOL_ERROR')); await handle(command()); assert.equal(packets.at(-1).event.kind, 'result'); });
test('command fields are single-read owned snapshots', async () => {
  const value = command(); let reads = 0, received; const artifact = value.embeddingArtifact;
  Object.defineProperty(value, 'embeddingArtifact', { get() { if (++reads > 1) throw new Error('PRIVATE'); return artifact; } });
  const packets = []; await handler(p => packets.push(p), { encode: (question, { onProgress }) => { received = question; encodeStages(onProgress); return query(); } })(value);
  assert.equal(reads, 1); assert.equal(received, 'PRIVATE_QUESTION'); assert.equal(packets.at(-1).event.kind, 'result');
});
for (const [name, failure, expected] of [
  ['runtime instance', () => new EmbeddingRuntimeError('GPU_DEVICE_LOST'), 'GPU_DEVICE_LOST'],
  ['ranker instance', () => new RetrievalError(), 'INVALID_RETRIEVAL_INPUT'],
  ['arbitrary error', () => new Error('PRIVATE'), 'QUERY_FAILED'],
  ['forged name', () => ({ name: 'EmbeddingRuntimeError', code: 'GPU_DEVICE_LOST', message: 'PRIVATE' }), 'QUERY_FAILED'],
  ['hostile prototype', () => new Proxy(new Error(), { getPrototypeOf() { throw new Error('PRIVATE'); } }), 'QUERY_FAILED'],
  ['hostile code', () => { const e = new EmbeddingRuntimeError('GPU_DEVICE_LOST'); Object.defineProperty(e, 'code', { get() { throw new Error('PRIVATE'); } }); return e; }, 'QUERY_FAILED'],
]) test(`worker ${name} produces fixed safe diagnostics`, async () => {
  const packets = []; await handler(p => packets.push(p), { encode: () => { throw failure(); } })(command());
  assert.equal(packets.at(-1).event.kind, 'error'); assert.equal(packets.at(-1).event.payload.code, expected); assert.equal(JSON.stringify(packets).includes('PRIVATE'), false);
});
for (const [name, encode] of [
  ['missing progress', () => query()], ['incomplete encode', (_q, { onProgress }) => { encodeStages((stage, payload) => { if (stage !== 'encode' || payload.completed === 0) onProgress(stage, payload); }); return query(); }],
  ['wrong actual total', (_q, { onProgress }) => { encodeStages(onProgress); const q = query(); q.tokenIds = [101, 42, 43, 102]; q.counts.totalTokens = 4; return q; }],
  ['invalid vector', (_q, { onProgress }) => { encodeStages(onProgress); const q = query(); q.vector.fill(0); return q; }],
  ['private progress', (_q, { onProgress }) => { onProgress('download', { completed: 0, total: 100, unit: 'bytes', estimated: false, question: 'PRIVATE' }); return query(); }],
]) test(`encoder ${name} never returns candidates`, async () => {
  const packets = []; await handler(p => packets.push(p), { encode })(command()); assert.equal(packets.at(-1).event.payload.code, 'WORKER_PROTOCOL_ERROR'); assert.equal(packets.some(p => Object.hasOwn(p, 'artifact')), false);
});
test('handler validates config getters before work and send errors are bounded', async () => {
  for (const options of [{ encode: null }, { extra: true }, { get encode() { throw new Error('PRIVATE'); } }]) assert.throws(() => handler(() => {}, options), code('INVALID_QUERY_WORKER_CONFIG'));
  const handle = handler(() => { throw new Error('PRIVATE'); }, { encode: (_q, { onProgress }) => { encodeStages(onProgress); return query(); } }); await assert.rejects(handle(command()), code('QUERY_FAILED'));
});
test('one-shot permission is consumed before encoder await and retained progress cannot emit after terminal', async () => {
  let resume, progress; const packets = [], handle = handler(p => packets.push(p), { encode: async (_q, { onProgress }) => { progress = onProgress; await new Promise(done => { resume = done; }); encodeStages(onProgress); return query(); } });
  const pending = handle(command()); assert.throws(() => handle(command()), code('WORKER_PROTOCOL_ERROR')); resume(); await pending;
  assert.throws(() => progress('rank', { completed: 2, total: 2, unit: 'chunks', estimated: false }), code('WORKER_PROTOCOL_ERROR')); assert.equal(packets.length, 8);
});

// Real shared encodeQuery and rankCandidates run beneath the actual channel and
// handler. Only network/model/device boundaries are controlled; installed tensor
// math performs attention-mask pooling and normalization without native GPU.
async function runtimeFixture() {
  const registry = JSON.parse(await readFile(new URL('../embedding-assets.json', import.meta.url), 'utf8'));
  const bytes = new Uint8Array([42]), hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  let total = 0; for (const group of ['modelFiles', 'runtimeFiles', 'noticeFiles']) for (const key of Object.keys(registry[group])) { registry[group][key] = group === 'runtimeFiles' && key === WASM_FILE ? { ...WASM_PIN } : { bytes: 1, sha256: hash }; if (group !== 'noticeFiles') total += registry[group][key].bytes; }
  const state = { questions: [], inferences: 0, modelDisposals: 0, deviceDestructions: 0 };
  const device = { lost: new Promise(() => {}), destroy() { state.deviceDestructions++; } }, adapter = { info: { isFallbackAdapter: false }, async requestDevice() { return device; } };
  const model = async inputs => { state.inferences++; const buffer = new Float32Array(3 * 384); for (let i = 0; i < 3; i++) buffer[i * 384 + 1] = 2; return { last_hidden_state: new Tensor('float32', buffer, [1, 3, 384]) }; };
  model.dispose = async () => { state.modelDisposals++; };
  const library = { Tensor, mean_pooling, env: { backends: { onnx: { wasm: {}, webgpu: {} } } },
    AutoTokenizer: { async from_pretrained() { return (question, settings) => { state.questions.push(question); assert.deepEqual(settings, { padding: false, truncation: false, add_special_tokens: true, return_tensor: false }); return { input_ids: [101, 44, 102], attention_mask: [1, 1, 1], token_type_ids: [0, 0, 0] }; }; } },
    AutoModel: { async from_pretrained() { await library.env.backends.onnx.webgpu.adapter.requestDevice(); return model; } } };
  let time = 0;
  return { state, total, options: { baseURL: 'https://fixture.example/browser-rag/', crypto: webcrypto, cacheStorage: null, gpu: { async requestAdapter() { return adapter; } },
    fetch: async url => new Response(url.endsWith('embedding-assets.json') ? JSON.stringify(registry) : url === 'https://fixture.example/browser-rag/vendor/transformers/' + WASM_FILE ? wasmBytes() : bytes), importer: async () => library, now: () => ++time } };
}
test('controlled channel invokes real query encoding and exact ranking without reencoding passages', async () => {
  const fixture = await runtimeFixture(), worker = new ControlledWorker();
  const handle = handler(packet => worker.emit('message', packet), { encode: (question, options) => encodeQuery(question, { ...fixture.options, ...options }) });
  worker.postMessage = command => { worker.sent.push(command); handle(command); };
  assert.equal(typeof sourceModule.queryInWorker, 'function'); const pending = sourceModule.queryInWorker(input(), passages(), 'PRIVATE_QUESTION', { identity: identity(), workerFactory: () => worker }); worker.ready();
  const accepted = await pending; assert.equal(accepted.artifact.query.receipt.verifiedBytes, fixture.total); assert.equal(accepted.artifact.retrieval.candidates[0].chunkId, 'PRIVATE_BETA'); assert.equal(accepted.artifact.retrieval.candidates[0].score, 1);
  assert.deepEqual(fixture.state, { questions: ['PRIVATE_QUESTION'], inferences: 1, modelDisposals: 1, deviceDestructions: 1 }); clean(worker);
});
function nativeFixture(frozen = false, invalid = false) {
  const sourceURL = new URL('../query.worker.mjs', import.meta.url);
  const fixture = `import vm from 'node:vm';import fs from 'node:fs';
    const state={calls:0,leaks:[],packets:[],listeners:{},failures:[]};const context=vm.createContext({state});
    vm.runInContext(\`class WorkerGlobalScope{};globalThis.WorkerGlobalScope=WorkerGlobalScope;Object.setPrototypeOf(globalThis,WorkerGlobalScope.prototype);
      globalThis.console=Object.fromEntries(['log','error','warn','info','debug','trace','table','dir','dirxml','assert','group','groupCollapsed','groupEnd','time','timeEnd','timeLog','count','countReset','clear'].map(key=>[key,(...args)=>state.leaks.push(args)]));
      ${frozen ? 'Object.freeze(console);' : ''}globalThis.postMessage=packet=>state.packets.push(packet);globalThis.addEventListener=(type,listener)=>state.listeners[type]=listener;globalThis.setTimeout=()=>{};\`,context);
    const cache=new Map();function load(url){if(cache.has(url))return cache.get(url);const code=url.endsWith('/embedding-runtime.mjs')?
      \`export class EmbeddingRuntimeError extends Error{};export async function encodeQuery(){state.calls++;console.error('PRIVATE_TENSOR');throw new Error('PRIVATE_RUNTIME');}\`:fs.readFileSync(new URL(url),'utf8');
      const mod=new vm.SourceTextModule(code,{context,identifier:url});cache.set(url,mod);return mod;}
    const root=load(${JSON.stringify(sourceURL.href)});await root.link((s,p)=>load(new URL(s,p.identifier).href));await root.evaluate();
    vm.runInContext('try{state.listeners.message({data:JSON.parse('+${JSON.stringify(JSON.stringify(JSON.stringify(invalid ? null : command())))}+')})}catch(e){state.failures.push({code:e.code,message:e.message})}',context);await new Promise(done=>setImmediate(done));
    ${invalid ? "vm.runInContext(\"console.log('PUBLIC_AFTER_INVALID')\",context);" : ''}
    process.stdout.write(JSON.stringify(state));`;
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', fixture], { encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr); return JSON.parse(run.stdout);
}
test('native worker mutes private SDK console before query and installs only query readiness', () => { assert.equal(typeof module.createQueryCommandHandler, 'function'); const value = nativeFixture(); assert.equal(value.calls, 1); assert.deepEqual(value.leaks, []); assert.equal(value.packets[0].kind, 'query-ready'); assert.equal(value.packets.at(-1).event.payload.code, 'QUERY_FAILED'); assert.equal(value.packets.filter(p => p.kind).length, 1); });
test('native non-writable console fails safely before SDK and invalid command cannot mute console', () => {
  assert.equal(typeof module.createQueryCommandHandler, 'function'); const value = nativeFixture(true); assert.equal(value.calls, 0); assert.deepEqual(value.leaks, []); assert.equal(value.packets.at(-1).event.payload.code, 'QUERY_FAILED');
  const invalid = nativeFixture(false, true); assert.equal(invalid.calls, 0); assert.equal(invalid.failures[0].code, 'WORKER_PROTOCOL_ERROR'); assert.deepEqual(invalid.leaks, [['PUBLIC_AFTER_INVALID']]);
});
