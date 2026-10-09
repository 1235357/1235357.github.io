import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { EmbeddingRuntimeError, encodeChunks, encodeQuery } from '../embedding-runtime.mjs';
import { EMBEDDING_SPEC } from '../embedding-contract.mjs';
import { Tensor as LibraryTensor, mean_pooling as libraryMeanPooling }
  from '../node_modules/@huggingface/transformers/src/utils/tensor.js';

const BASE = 'https://reader.example/browser-rag/';
const CODES = ['INVALID_EMBEDDING_CONFIG', 'ENCODER_INPUT_LIMIT', 'INVALID_EMBEDDING',
  'GPU_UNAVAILABLE', 'GPU_DEVICE_LOST', 'ASSET_INTEGRITY_ERROR', 'EMBEDDING_LOAD_FAILED',
  'EMBEDDING_FAILED', 'ABORTED'];
const safeError = code => error => error instanceof EmbeddingRuntimeError
  && error.name === 'EmbeddingRuntimeError' && error.code === code
  && !Object.hasOwn(error, 'cause') && !error.message.includes('PRIVATE');
const artifact = (texts = ['First chunk.']) => ({ schemaVersion: 1,
  status: 'chunked-not-embedded', source: { sha256: 'a'.repeat(64), name: 'PRIVATE.pdf' },
  counts: { chunks: texts.length }, chunks: texts.map((text, i) => ({ id: `chunk-${i}`, text })) });
const options = overrides => ({ baseURL: BASE, crypto: webcrypto, cacheStorage: undefined,
  now: () => 10, ...overrides });

test('runtime errors expose only fixed safe codes and fixed messages', () => {
  for (const code of CODES) {
    const first = new EmbeddingRuntimeError(code);
    assert.equal(safeError(code)(first), true);
    assert.equal(first instanceof Error, true);
    assert.equal(first.message, new EmbeddingRuntimeError(code).message);
  }
  for (const code of ['PRIVATE text', '__proto__', 'constructor', {}, null, undefined]) {
    assert.equal(safeError('EMBEDDING_FAILED')(new EmbeddingRuntimeError(code)), true);
  }
});

test('invalid chunk artifacts fail before reading GPU or fetching assets', async () => {
  const bad = [null, {}, { ...artifact(), status: 'embedded-not-retrieved' },
    { ...artifact(), source: { sha256: 'A'.repeat(64) } }, artifact([]),
    { ...artifact(), counts: { chunks: 2 } }, artifact(['  ']), artifact(['x'.repeat(4097)]),
    { ...artifact(), chunks: [{ id: '', text: 'ok' }] },
    { ...artifact(['one', 'two']), chunks: [{ id: 'same', text: 'one' }, { id: 'same', text: 'two' }] }];
  for (const value of bad) {
    let reads = 0;
    await assert.rejects(encodeChunks(value, options({ gpu: { requestAdapter() { reads++; } },
      fetch() { reads++; } })), safeError('INVALID_EMBEDDING_CONFIG'));
    assert.equal(reads, 0);
  }
});

test('sparse and inherited chunks and out-of-budget arrays are refused', async () => {
  const sparse = artifact(['one', 'two']); delete sparse.chunks[1];
  const inherited = artifact(); Object.setPrototypeOf(inherited.chunks, { 0: inherited.chunks[0] });
  delete inherited.chunks[0];
  const oversized = artifact(); oversized.chunks = Array(513); oversized.counts.chunks = 513;
  Object.defineProperty(oversized.chunks, 0, { get() { throw new Error('PRIVATE'); } });
  for (const value of [sparse, inherited, oversized]) {
    await assert.rejects(encodeChunks(value, options()), safeError('INVALID_EMBEDDING_CONFIG'));
  }
});

test('invalid options and non-HTTP base locations are refused before GPU access', async () => {
  for (const value of [null, [], { ...options(), unknown: true }, options({ baseURL: 'file:///PRIVATE/' }),
    options({ baseURL: 'https://user:pass@reader.example/' }), options({ baseURL: BASE + '?a=1' }),
    options({ fetch: 7 }), options({ importer: false }), options({ now: 1 }),
    options({ crypto: {} }), options({ onProgress: {} }), options({ signal: {} })]) {
    await assert.rejects(encodeChunks(artifact(), value), safeError('INVALID_EMBEDDING_CONFIG'));
  }
});

test('missing GPU refuses the operation before any model traffic', async () => {
  let fetches = 0;
  await assert.rejects(encodeChunks(artifact(), options({ gpu: null,
    fetch() { fetches++; } })), safeError('GPU_UNAVAILABLE'));
  assert.equal(fetches, 0);
});

test('a null, fallback or unknown adapter refuses all asset traffic', async () => {
  for (const adapter of [null, {}, { info: { isFallbackAdapter: true } },
    { isFallbackAdapter: true }, { info: { isFallbackAdapter: 'false' } }]) {
    let fetches = 0, devices = 0;
    if (adapter) adapter.requestDevice = () => { devices++; };
    const gpu = { async requestAdapter(request) {
      assert.deepEqual(request, { powerPreference: 'high-performance' }); return adapter;
    } };
    await assert.rejects(encodeChunks(artifact(), options({ gpu,
      fetch() { fetches++; } })), safeError('GPU_UNAVAILABLE'));
    assert.equal(fetches, 0); assert.equal(devices, 0);
  }
});

test('a caller abort before work prevents adapter and asset access', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(encodeChunks(artifact(), options({ signal: controller.signal,
    gpu: { requestAdapter() { calls++; } }, fetch() { calls++; } })), safeError('ABORTED'));
  assert.equal(calls, 0);
});

const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model.onnx'];
const RUNTIME_FILES = ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];
const NOTICE_FILES = ['TRANSFORMERS-LICENSE.txt', 'JINJA-LICENSE.txt', 'FLATBUFFERS-LICENSE.txt',
  'LONG-LICENSE.txt', 'PLATFORM-LICENSE.txt', 'PROTOBUFJS-LICENSE.txt', 'MODEL-CARD.txt',
  'ONNXRUNTIME-LICENSE.txt', 'ONNXRUNTIME-ThirdPartyNotices.txt', 'ATTRIBUTION.txt'];
const sha256 = async bytes => Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject }; };
function gpuFixture(legacy = false) {
  const lost = deferred(), calls = [], descriptors = [];
  const device = { lost: lost.promise, destroy() { calls.push('destroy'); } };
  const info = { isFallbackAdapter: false }, features = new Set(['timestamp-query', 'shader-f16', 'subgroups']);
  const limits = { maxComputeWorkgroupStorageSize: 16384, maxComputeWorkgroupsPerDimension: 65535,
    maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456, maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupSizeX: 256, maxComputeWorkgroupSizeY: 256, maxComputeWorkgroupSizeZ: 64 };
  const adapter = { ...(legacy ? { isFallbackAdapter: false } : {}),
    get info() { assert.equal(this, adapter); return legacy ? undefined : info; },
    get limits() { assert.equal(this, adapter); return limits; },
    get features() { assert.equal(this, adapter); return features; },
    async requestAdapterInfo() { assert.equal(this, adapter); return info; },
    async requestDevice(descriptor) {
      assert.equal(this, adapter); calls.push('device'); descriptors.push(descriptor); return device;
    } };
  return { device, adapter, lost, calls, descriptors, limits, features, gpu: { async requestAdapter(value) {
    calls.push(value); return adapter;
  } } };
}
async function assetFixture() {
  const registry = { schemaVersion: 1, modelId: EMBEDDING_SPEC.modelId, revision: EMBEDDING_SPEC.revision,
    libraryVersion: '3.8.1', ortVersion: '1.22.0-dev.20250409-89f8206ba4',
    modelFiles: {}, runtimeFiles: {}, noticeFiles: {} };
  const bodies = new Map();
  for (const [group, files, prefix] of [
    ['modelFiles', MODEL_FILES, `models/${EMBEDDING_SPEC.revision}/${EMBEDDING_SPEC.modelId}/`],
    ['runtimeFiles', RUNTIME_FILES, 'vendor/transformers/'], ['noticeFiles', NOTICE_FILES, 'notices/']]) {
    for (const file of files) {
      const bytes = new TextEncoder().encode(`fixture ${file}`);
      registry[group][file] = { bytes: bytes.length, sha256: await sha256(bytes) };
      bodies.set(new URL(prefix + file, BASE).href, bytes);
    }
  }
  const requests = [], imports = [], progress = [], stored = new Map(), cacheCalls = [];
  const cache = { async match(url) { cacheCalls.push(['match', url]); return stored.get(url)?.clone(); },
    async put(url, response) { cacheCalls.push(['put', url]); stored.set(url, response.clone()); } };
  const fetch = async (url, request) => {
    requests.push([url, request]);
    if (url === BASE + 'embedding-assets.json') return new Response(JSON.stringify(registry));
    return new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 });
  };
  const total = [...MODEL_FILES.map(file => registry.modelFiles[file]),
    ...RUNTIME_FILES.map(file => registry.runtimeFiles[file])].reduce((sum, entry) => sum + entry.bytes, 0);
  const hardware = gpuFixture();
  const opts = options({ gpu: hardware.gpu, fetch,
    cacheStorage: { async open(name) { cacheCalls.push(['open', name]); return cache; } },
    importer: async url => { imports.push(url); throw new Error('PRIVATE import failure'); },
    onProgress: (stage, payload) => progress.push([stage, payload]) });
  return { registry, bodies, requests, imports, progress, stored, cache, cacheCalls, total, hardware, opts };
}
const loadingStopped = fixture => assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('EMBEDDING_LOAD_FAILED'));

test('default global fetch retains its global receiver during asset verification', async () => {
  const fixture = await assetFixture(), fetch = fixture.opts.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let receiverRejected = false;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
    value: function(url, request) {
      if (this !== globalThis) { receiverRejected = true; throw new TypeError('Illegal invocation'); }
      return fetch(url, request);
    } });
  delete fixture.opts.fetch;
  try {
    const error = await encodeChunks(artifact(), fixture.opts).catch(error => error);
    assert.equal(receiverRejected, false, 'default fetch must receive globalThis to avoid Illegal invocation');
    assert.equal(safeError('EMBEDDING_LOAD_FAILED')(error), true);
    assert.equal(fixture.requests.length, 9); assert.equal(fixture.stored.size, 8);
    assert.equal(fixture.imports.length, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'fetch', descriptor);
    else delete globalThis.fetch;
  }
});

test('an absent or invalid default global fetch is refused before GPU access', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  try {
    for (const fetch of [undefined, null, 7]) {
      Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetch });
      let reads = 0;
      await assert.rejects(encodeChunks(artifact(), options({ gpu: { requestAdapter() { reads++; } } })),
        safeError('INVALID_EMBEDDING_CONFIG'));
      assert.equal(reads, 0);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'fetch', descriptor);
    else delete globalThis.fetch;
  }
});

test('an explicitly injected fetch retains its configuration receiver', async () => {
  const fixture = await assetFixture(), fetch = fixture.opts.fetch;
  const injectedFetch = function(url, request) {
    assert.notEqual(this, globalThis); assert.equal(this.fetch, injectedFetch);
    assert.equal(this.baseURL, BASE); return fetch(url, request);
  };
  fixture.opts.fetch = injectedFetch;
  await loadingStopped(fixture);
  assert.equal(fixture.requests.length, 9); assert.equal(fixture.imports.length, 1);
});

test('all eight local assets are hashed and cached before importing the encoder', async () => {
  const fixture = await assetFixture(); await loadingStopped(fixture);
  assert.equal(fixture.imports.length, 1);
  assert.equal(fixture.imports[0], BASE + 'vendor/transformers/transformers.min.js');
  assert.equal(fixture.requests.length, 9); assert.equal(fixture.stored.size, 8);
  assert.equal(fixture.cacheCalls[0][1], `financial-rag-embedding-${EMBEDDING_SPEC.revision}-v1`);
  for (const [url, request] of fixture.requests) {
    assert.equal(new URL(url).origin, new URL(BASE).origin);
    assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit');
    assert.equal(request.signal instanceof AbortSignal, true);
    assert.equal(url.includes('/notices/'), false);
  }
  const events = fixture.progress.filter(([stage]) => stage === 'download').map(([, payload]) => payload);
  assert.equal(events.length, 9);
  assert.equal(events.at(-1).completed, fixture.total); assert.equal(events.at(-1).total, fixture.total);
  assert.equal(events.every(p => p.unit === 'bytes' && p.estimated === false), true);
  assert.equal(events.every((p, i) => p.completed >= 0 && p.completed <= p.total
    && (!i || p.completed > events[i - 1].completed)), true);
  assert.equal(fixture.hardware.calls.includes('device'), false);
  assert.equal(fixture.hardware.calls.includes('destroy'), false);
});

test('cached assets are rehashed and no model asset is fetched on a complete cache hit', async () => {
  const fixture = await assetFixture();
  for (const [url, bytes] of fixture.bodies) if (!url.includes('/notices/')) fixture.stored.set(url, new Response(bytes));
  await loadingStopped(fixture);
  assert.equal(fixture.requests.length, 1); assert.equal(fixture.imports.length, 1);
  assert.equal(fixture.cacheCalls.filter(([op]) => op === 'put').length, 0);
});

test('a corrupt cached asset refuses the entire operation without repair or import', async () => {
  const fixture = await assetFixture(), first = [...fixture.bodies.keys()][0];
  fixture.stored.set(first, new Response(new Uint8Array(fixture.registry.modelFiles['config.json'].bytes)));
  await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ASSET_INTEGRITY_ERROR'));
  assert.equal(fixture.requests.length, 1); assert.equal(fixture.imports.length, 0);
  assert.equal(fixture.cacheCalls.filter(([op]) => op === 'put').length, 0);
  assert.equal(fixture.hardware.calls.includes('device'), false);
  assert.equal(fixture.hardware.calls.includes('destroy'), false);
});

test('asset verification works without CacheStorage', async () => {
  const fixture = await assetFixture(); fixture.opts.cacheStorage = undefined;
  await loadingStopped(fixture);
  assert.equal(fixture.requests.length, 9); assert.equal(fixture.imports.length, 1);
  assert.equal(fixture.cacheCalls.length, 0);
});

test('cache opening, matching or writing failures refuse verified-only loading', async () => {
  for (const operation of ['open', 'match', 'put']) {
    const fixture = await assetFixture();
    if (operation === 'open') fixture.opts.cacheStorage.open = async () => { throw new Error('PRIVATE'); };
    else fixture.cache[operation] = async () => { throw new Error('PRIVATE'); };
    await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ASSET_INTEGRITY_ERROR'));
    assert.equal(fixture.imports.length, 0); assert.equal(fixture.hardware.calls.includes('device'), false);
    assert.equal(fixture.hardware.calls.includes('destroy'), false);
  }
});

test('registry identity, exact keys and entry budgets are enforced', async () => {
  const mutations = [r => { r.schemaVersion = 2; }, r => { r.modelId = 'other'; },
    r => { r.revision = 'main'; }, r => { r.libraryVersion = '9'; }, r => { r.ortVersion = '9'; },
    r => { r.extra = true; }, r => { delete r.modelFiles['config.json']; },
    r => { r.modelFiles['PRIVATE-url'] = r.modelFiles['config.json']; },
    r => { delete r.noticeFiles['ATTRIBUTION.txt']; }, r => { r.modelFiles['config.json'].url = 'https://evil.example/'; },
    r => { r.modelFiles['config.json'].bytes = 0; }, r => { r.modelFiles['config.json'].bytes = 0.5; },
    r => { r.modelFiles['config.json'].bytes = 100 * 1024 * 1024 + 1; },
    r => { r.modelFiles['config.json'].sha256 = 'bad'; },
    r => { r.modelFiles['config.json'].bytes = 100 * 1024 * 1024; r.modelFiles['onnx/model.onnx'].bytes = 100 * 1024 * 1024; }];
  for (const mutate of mutations) {
    const fixture = await assetFixture(); mutate(fixture.registry);
    await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ASSET_INTEGRITY_ERROR'));
    assert.equal(fixture.requests.length, 1); assert.equal(fixture.imports.length, 0);
  }
});

test('an oversized or malformed registry is refused before asset requests', async () => {
  for (const body of ['x'.repeat(32769), '{bad json', 'null']) {
    const fixture = await assetFixture(); fixture.opts.fetch = async () => new Response(body);
    await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ASSET_INTEGRITY_ERROR'));
    assert.equal(fixture.imports.length, 0);
  }
});

test('non-OK and redirected asset responses are refused before importing', async () => {
  for (const make of [() => new Response('PRIVATE', { status: 404 }),
    () => { const response = new Response('PRIVATE'); Object.defineProperty(response, 'redirected', { value: true }); return response; },
    () => { const response = new Response('PRIVATE'); Object.defineProperty(response, 'url', { value: 'https://evil.example/' }); return response; }]) {
    const fixture = await assetFixture(), original = fixture.opts.fetch;
    fixture.opts.fetch = (url, req) => url.endsWith('embedding-assets.json') ? original(url, req) : make();
    await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ASSET_INTEGRITY_ERROR'));
    assert.equal(fixture.imports.length, 0);
  }
});

test('asset length, declared Content-Length and hash must all match', async () => {
  for (const mode of ['short', 'long', 'hash', 'header']) {
    const fixture = await assetFixture(), original = fixture.opts.fetch;
    fixture.opts.fetch = (url, req) => {
      if (url.endsWith('embedding-assets.json')) return original(url, req);
      const bytes = fixture.bodies.get(url);
      if (mode === 'short') return new Response(bytes.slice(1));
      if (mode === 'long') return new Response(new Uint8Array(bytes.length + 1));
      if (mode === 'hash') return new Response(new Uint8Array(bytes.length));
      return new Response(bytes, { headers: { 'Content-Length': String(bytes.length + 1) } });
    };
    await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ASSET_INTEGRITY_ERROR'));
    assert.equal(fixture.imports.length, 0);
  }
});

test('stream overflow cancels further asset reads at the declared byte bound', async () => {
  const fixture = await assetFixture(), original = fixture.opts.fetch; let cancelled = 0;
  fixture.opts.fetch = (url, req) => {
    if (url.endsWith('embedding-assets.json')) return original(url, req);
    const size = fixture.bodies.get(url).length;
    return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(size + 1)); },
      cancel() { cancelled++; } }));
  };
  await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ASSET_INTEGRITY_ERROR'));
  assert.equal(cancelled, 1); assert.equal(fixture.imports.length, 0);
});

test('abort settles a hanging adapter request without asset traffic', { timeout: 1000 }, async () => {
  const controller = new AbortController(); let fetches = 0;
  const pending = encodeChunks(artifact(), options({ signal: controller.signal,
    gpu: { requestAdapter: () => new Promise(() => {}) }, fetch() { fetches++; } }));
  controller.abort();
  await assert.rejects(pending, safeError('ABORTED')); assert.equal(fetches, 0);
});

test('the SDK device delivered after cancellation is destroyed exactly once', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), controller = new AbortController(), gate = deferred(), started = deferred();
  fixture.opts.signal = controller.signal;
  fixture.hardware.adapter.requestDevice = () => { started.resolve(); return gate.promise; };
  const pending = encodeChunks(artifact(), fixture.opts); await started.promise; controller.abort();
  await assert.rejects(pending, safeError('ABORTED'));
  gate.resolve(fixture.hardware.device); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
  assert.equal(fixture.requests.length, 9); assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.modelDisposals, 0);
});

test('cancellation settles hanging asset fetches before any device is created', { timeout: 1000 }, async () => {
  const fixture = await assetFixture(), controller = new AbortController(), started = deferred(); let signal;
  fixture.opts.signal = controller.signal;
  fixture.opts.fetch = (_url, request) => { signal = request.signal; started.resolve(); return new Promise(() => {}); };
  const pending = encodeChunks(artifact(), fixture.opts); await started.promise;
  controller.abort();
  await assert.rejects(pending, safeError('ABORTED'));
  assert.equal(signal.aborted, true); assert.equal(fixture.hardware.calls.includes('device'), false);
  assert.equal(fixture.hardware.calls.includes('destroy'), false);
});

async function encoderFixture() {
  const fixture = await assetFixture();
  const events = [], resources = [], calls = [], frames = [], snapshots = [], hiddenBuffers = [];
  const env = { backends: { onnx: { wasm: {}, webgpu: {} } } };
  const track = tensor => {
    if (resources.some(item => item.tensor === tensor)) return tensor;
    const item = { tensor, disposals: 0 }; resources.push(item);
    const dispose = tensor.dispose.bind(tensor), normalize = tensor.normalize.bind(tensor);
    tensor.dispose = () => { item.disposals++; dispose(); };
    tensor.normalize = (p, dim) => { events.push(['normalize', p, dim]); return track(normalize(p, dim)); };
    return tensor;
  };
  const hidden = length => {
    const data = new Float32Array(length * 384);
    for (let i = 0; i < length; i++) { data[i * 384] = i + 1; data[i * 384 + 1] = 2; }
    hiddenBuffers.push(data); return track(new LibraryTensor('float32', data, [1, length, 384]));
  };
  const tokenizer = (text, settings) => {
    const index = events.filter(([stage]) => stage === 'tokenize').length;
    events.push(['tokenize', text, settings]);
    return frames[index] ?? { input_ids: [101, 200 + index, 102], attention_mask: [1, 1, 1], token_type_ids: [0, 0, 0] };
  };
  const model = async inputs => {
    events.push(['inference']);
    calls.push(Object.fromEntries(Object.entries(inputs).map(([key, tensor]) => [key,
      { type: tensor.type, dims: [...tensor.dims], data: [...tensor.data] }])));
    const output = hidden(inputs.input_ids.dims[1]);
    return { last_hidden_state: output, also_hidden: output };
  };
  let modelDisposals = 0;
  model.dispose = async () => { modelDisposals++; events.push(['dispose-model']); };
  const runtime = { loadModel: async () => model, descriptors: [] };
  const snapshot = stage => snapshots.push([stage, { allowRemoteModels: env.allowRemoteModels,
    allowLocalModels: env.allowLocalModels, localModelPath: env.localModelPath, useBrowserCache: env.useBrowserCache,
    useFSCache: env.useFSCache, useCustomCache: env.useCustomCache,
    wasm: { ...env.backends.onnx.wasm }, adapter: env.backends.onnx.webgpu.adapter,
    device: env.backends.onnx.webgpu.device }]);
  const library = { env, Tensor: function (...args) { return track(new LibraryTensor(...args)); },
    mean_pooling(hiddenState, mask) { events.push(['pool', [...mask.data]]); return track(libraryMeanPooling(hiddenState, mask)); },
    AutoTokenizer: { async from_pretrained(id, settings) {
      snapshot('tokenizer'); events.push(['load-tokenizer', id, settings]); return tokenizer;
    } },
    AutoModel: { async from_pretrained(id, settings) {
      snapshot('model'); events.push(['load-model', id, settings]);
      // Reproduce the pinned ORT JSEP initialization boundary: it consumes the
      // configured adapter, builds its descriptor, and makes device/adapter readonly.
      const adapter = env.backends.onnx.webgpu.adapter;
      if (typeof adapter?.limits !== 'object' || typeof adapter.features !== 'object'
        || typeof adapter.requestDevice !== 'function') throw new Error('PRIVATE invalid SDK adapter');
      const requiredFeatures = [];
      const descriptor = { requiredLimits: {}, requiredFeatures };
      for (const name of ['maxComputeWorkgroupStorageSize', 'maxComputeWorkgroupsPerDimension',
        'maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeInvocationsPerWorkgroup',
        'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ']) {
        descriptor.requiredLimits[name] = adapter.limits[name];
      }
      const requireFeatureIfAvailable = feature => adapter.features.has(feature) && requiredFeatures.push(feature) && true;
      if (!requireFeatureIfAvailable('chromium-experimental-timestamp-query-inside-passes')) {
        requireFeatureIfAvailable('timestamp-query');
      }
      requireFeatureIfAvailable('shader-f16'); requireFeatureIfAvailable('subgroups');
      runtime.descriptors.push(descriptor);
      runtime.beforeDevice?.();
      const device = await adapter.requestDevice(descriptor);
      events.push(['device-created']);
      if (!adapter.info) await adapter.requestAdapterInfo();
      for (const [name, value] of [['device', device], ['adapter', adapter]]) {
        Object.defineProperty(env.backends.onnx.webgpu, name,
          { value, writable: false, enumerable: true, configurable: false });
      }
      return runtime.loadModel();
    } },
  };
  fixture.opts.importer = async url => { fixture.imports.push(url); events.push(['import']); return library; };
  let clock = 10; fixture.opts.now = () => clock++;
  return { ...fixture, events, resources, calls, frames, snapshots, hiddenBuffers, library, model, hidden, runtime,
    get modelDisposals() { return modelDisposals; } };
}

test('the encoder produces a frozen detached normalized artifact with precise verified-byte receipts', async () => {
  const fixture = await encoderFixture(), input = artifact(['one', 'two']);
  const result = await encodeChunks(input, fixture.opts);
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'status', 'sourceSha256', 'representationId',
    'representation', 'backend', 'dtype', 'chunkIds', 'tokenIds', 'vectors', 'counts', 'receipt']);
  assert.equal(result.schemaVersion, 1); assert.equal(result.status, 'embedded-not-retrieved');
  assert.equal(result.sourceSha256, 'a'.repeat(64)); assert.equal(result.representationId, EMBEDDING_SPEC.version);
  assert.equal(result.representation, EMBEDDING_SPEC); assert.equal(result.backend, 'webgpu'); assert.equal(result.dtype, 'fp32');
  assert.deepEqual(result.chunkIds, ['chunk-0', 'chunk-1']);
  assert.deepEqual(result.tokenIds, [[101, 200, 102], [101, 201, 102]]);
  assert.deepEqual(result.counts, { chunks: 2, totalTokens: 6, dimensions: 384 });
  assert.deepEqual(result.receipt, { verifiedBytes: fixture.total, networkBytes: fixture.total, cacheBytes: 0, elapsedMs: 1 });
  for (const row of result.vectors) {
    assert.equal(row.length, 384); assert.ok(Math.abs(row[0] - Math.SQRT1_2) < 1e-6);
    assert.ok(Math.abs(row[1] - Math.SQRT1_2) < 1e-6); assert.equal(row.slice(2).every(v => v === 0), true);
  }
  assert.equal([result, result.chunkIds, result.tokenIds, ...result.tokenIds, result.vectors,
    ...result.vectors, result.counts, result.receipt].every(Object.isFrozen), true);
  fixture.hiddenBuffers.forEach(buffer => buffer.fill(0)); input.chunks[0].id = 'changed';
  assert.equal(result.chunkIds[0], 'chunk-0'); assert.ok(result.vectors[0][0] > 0.7);
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.resources.every(item => item.disposals === 1), true);
  assert.equal(fixture.hardware.calls.filter(call => call === 'destroy').length, 1);
  assert.deepEqual(fixture.progress.map(([stage]) => stage), [...Array(9).fill('download'), 'initialize', 'encode', 'encode', 'encode']);
  assert.deepEqual(fixture.progress.find(([stage]) => stage === 'initialize')[1],
    { completed: 0, total: null, unit: 'chunks', estimated: false });
  assert.deepEqual(fixture.progress.at(-1)[1], { completed: 2, total: 2, unit: 'chunks', estimated: false });
  assert.equal(fixture.progress.every(([, payload]) => Object.keys(payload).join(',') === 'completed,total,unit,estimated'), true);
});

test('a mixed cache/network receipt counts each verified asset once', async () => {
  const fixture = await encoderFixture(), cachedURL = [...fixture.bodies.keys()][0];
  const bytes = fixture.bodies.get(cachedURL); fixture.stored.set(cachedURL, new Response(bytes));
  const result = await encodeChunks(artifact(), fixture.opts);
  assert.equal(result.receipt.cacheBytes, bytes.length);
  assert.equal(result.receipt.networkBytes, fixture.total - bytes.length);
  assert.equal(result.receipt.verifiedBytes, result.receipt.networkBytes + result.receipt.cacheBytes);
  assert.equal(fixture.requests.length, 8);
});

test('local environment and the forwarding adapter are installed before any pretrained session', async () => {
  const fixture = await encoderFixture(); await encodeChunks(artifact(), fixture.opts);
  for (const [stage, snapshot] of fixture.snapshots) {
    assert.equal(['tokenizer', 'model'].includes(stage), true);
    assert.deepEqual(snapshot, { allowRemoteModels: false, allowLocalModels: true,
      localModelPath: `${BASE}models/${EMBEDDING_SPEC.revision}/`, useBrowserCache: false,
      useFSCache: false, useCustomCache: true, wasm: { proxy: false, numThreads: 1, wasmPaths: {
        wasm: BASE + 'vendor/transformers/ort-wasm-simd-threaded.jsep.wasm',
        mjs: BASE + 'vendor/transformers/ort-wasm-simd-threaded.jsep.mjs' } },
      adapter: fixture.library.env.backends.onnx.webgpu.adapter, device: undefined });
  }
  assert.deepEqual(fixture.events.find(([stage]) => stage === 'load-tokenizer').slice(1),
    [EMBEDDING_SPEC.modelId, { revision: EMBEDDING_SPEC.revision, local_files_only: true }]);
  assert.deepEqual(fixture.events.find(([stage]) => stage === 'load-model').slice(1),
    [EMBEDDING_SPEC.modelId, { revision: EMBEDDING_SPEC.revision, local_files_only: true, device: 'webgpu', dtype: 'fp32' }]);
  const cache = fixture.library.env.customCache, first = [...fixture.bodies.keys()][0];
  const firstResponse = await cache.match(first), secondResponse = await cache.match(new Request(first));
  assert.notEqual(firstResponse, secondResponse);
  assert.deepEqual(new Uint8Array(await firstResponse.arrayBuffer()), fixture.bodies.get(first));
  assert.deepEqual(new Uint8Array(await secondResponse.arrayBuffer()), fixture.bodies.get(first));
  assert.equal((await cache.match(BASE + 'models/PRIVATE.json')).status, 404);
  assert.equal((await cache.match('https://evil.example/model.onnx')).status, 404);
  await cache.put(BASE + 'models/PRIVATE.json', new Response('PRIVATE'));
  assert.equal((await cache.match(BASE + 'models/PRIVATE.json')).status, 404);
});

test('the SDK creates the only owned device with its unchanged feature and limit descriptor', async () => {
  const fixture = await encoderFixture();
  await encodeChunks(artifact(), fixture.opts);
  assert.equal(fixture.hardware.calls.filter(value => value === 'device').length, 1);
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
  assert.equal(fixture.hardware.descriptors[0], fixture.runtime.descriptors[0]);
  assert.deepEqual(fixture.hardware.descriptors[0], { requiredLimits: {
    maxComputeWorkgroupStorageSize: 16384, maxComputeWorkgroupsPerDimension: 65535,
    maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456, maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupSizeX: 256, maxComputeWorkgroupSizeY: 256, maxComputeWorkgroupSizeZ: 64,
  }, requiredFeatures: ['timestamp-query', 'shader-f16', 'subgroups'] });
  const env = fixture.library.env.backends.onnx.webgpu;
  assert.equal(env.device, fixture.hardware.device);
  assert.equal(Object.getOwnPropertyDescriptor(env, 'device').writable, false);
  assert.equal(Object.getOwnPropertyDescriptor(env, 'adapter').configurable, false);
  assert.notEqual(env.adapter, fixture.hardware.adapter);
  assert.equal(fixture.events.findIndex(([stage]) => stage === 'device-created')
    > fixture.events.findIndex(([stage]) => stage === 'tokenize'), true);
});

test('the forwarding adapter preserves the native requestAdapterInfo receiver', async () => {
  const fixture = await encoderFixture(), hardware = gpuFixture(true);
  fixture.opts.gpu = hardware.gpu;
  const result = await encodeChunks(artifact(), fixture.opts);
  assert.equal(result.status, 'embedded-not-retrieved');
  assert.equal(hardware.calls.filter(value => value === 'device').length, 1);
  assert.equal(hardware.calls.filter(value => value === 'destroy').length, 1);
});

test('cancellation before the SDK request prevents native device creation', async () => {
  const fixture = await encoderFixture(), controller = new AbortController();
  fixture.opts.signal = controller.signal; fixture.runtime.beforeDevice = () => controller.abort();
  await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ABORTED'));
  assert.equal(fixture.requests.length, 9); assert.equal(fixture.hardware.calls.includes('device'), false);
  assert.equal(fixture.hardware.calls.includes('destroy'), false); assert.equal(fixture.calls.length, 0);
});

test('a rejected SDK device request exposes a safe GPU error without claiming device cleanup', async () => {
  const fixture = await encoderFixture();
  fixture.hardware.adapter.requestDevice = async () => { throw new Error('PRIVATE device descriptor'); };
  await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('GPU_UNAVAILABLE'));
  assert.equal(fixture.hardware.calls.includes('destroy'), false); assert.equal(fixture.calls.length, 0);
});

test('a device returned after the SDK load has failed is still destroyed exactly once', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), gate = deferred(); let started = false;
  fixture.hardware.adapter.requestDevice = descriptor => {
    if (!descriptor) return fixture.hardware.device;
    started = true; return gate.promise;
  };
  fixture.library.AutoModel.from_pretrained = () => {
    const pendingDevice = fixture.library.env.backends.onnx.webgpu.adapter.requestDevice({ requiredFeatures: [] });
    pendingDevice.catch(() => {});
    throw new Error('PRIVATE independent SDK initialization failure');
  };
  await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('EMBEDDING_LOAD_FAILED'));
  assert.equal(started, true);
  gate.resolve(fixture.hardware.device); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
  assert.equal(fixture.calls.length, 0);
});

test('every text is tokenized without truncation before creating the model', async () => {
  const fixture = await encoderFixture(); await encodeChunks(artifact(['one', 'two']), fixture.opts);
  const events = fixture.events, modelIndex = events.findIndex(([stage]) => stage === 'load-model');
  const tokenEvents = events.filter(([stage]) => stage === 'tokenize');
  assert.equal(tokenEvents.length, 2); assert.equal(events.slice(0, modelIndex).filter(([stage]) => stage === 'tokenize').length, 2);
  for (const [, text, settings] of tokenEvents) {
    assert.equal(['one', 'two'].includes(text), true);
    assert.deepEqual(settings, { padding: false, truncation: false, add_special_tokens: true, return_tensor: false });
  }
  assert.equal(events.findIndex(([stage]) => stage === 'inference') > modelIndex, true);
  assert.equal(events.filter(([stage]) => stage === 'normalize').every(([, p, dim]) => p === 2 && dim === -1), true);
});

test('model tensors contain exactly the preflight int64 IDs, masks and types', async () => {
  const fixture = await encoderFixture();
  fixture.frames.push({ input_ids: [101, 30521, 102], attention_mask: [1, 1, 1], token_type_ids: [0, 0, 0] });
  const result = await encodeChunks(artifact(), fixture.opts);
  assert.deepEqual(result.tokenIds, [[101, 30521, 102]]);
  assert.deepEqual(fixture.calls, [{ input_ids: { type: 'int64', dims: [1, 3], data: [101n, 30521n, 102n] },
    attention_mask: { type: 'int64', dims: [1, 3], data: [1n, 1n, 1n] },
    token_type_ids: { type: 'int64', dims: [1, 3], data: [0n, 0n, 0n] } }]);
  assert.deepEqual(fixture.events.find(([stage]) => stage === 'pool').slice(1), [[1n, 1n, 1n]]);
});

test('invalid later token IDs refuse the whole batch before model creation or inference', async () => {
  for (const ids of [[101, 102], [101, ...Array(255).fill(1), 102], [101, 30522, 102],
    [101, -1, 102], [101, 1.1, 102], [100, 1, 102], [101, 1, 103], [101, , 102]]) {
    const fixture = await encoderFixture();
    fixture.frames[1] = { input_ids: ids, attention_mask: Array(ids.length).fill(1), token_type_ids: Array(ids.length).fill(0) };
    await assert.rejects(encodeChunks(artifact(['good', 'bad']), fixture.opts), safeError('ENCODER_INPUT_LIMIT'));
    assert.equal(fixture.events.some(([stage]) => stage === 'load-model'), false);
    assert.equal(fixture.calls.length, 0); assert.equal(fixture.resources.length, 0);
    assert.equal(fixture.hardware.calls.includes('device'), false);
    assert.equal(fixture.hardware.calls.includes('destroy'), false);
  }
});

test('invalid attention masks and token types refuse preflight before inference', async () => {
  for (const frame of [
    { input_ids: [101, 1, 102], attention_mask: [1, 0, 1], token_type_ids: [0, 0, 0] },
    { input_ids: [101, 1, 102], attention_mask: [1, 1], token_type_ids: [0, 0, 0] },
    { input_ids: [101, 1, 102], attention_mask: [1, , 1], token_type_ids: [0, 0, 0] },
    { input_ids: [101, 1, 102], attention_mask: [1, 1, 1], token_type_ids: [0, 1, 0] },
    { input_ids: [101, 1, 102], attention_mask: [1, 1, 1] },
    { input_ids: [101, 1, 102], attention_mask: new Uint8Array([1, 1, 1]), token_type_ids: [0, 0, 0] }]) {
    const fixture = await encoderFixture(); fixture.frames[0] = frame;
    await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ENCODER_INPUT_LIMIT'));
    assert.equal(fixture.calls.length, 0); assert.equal(fixture.events.some(([stage]) => stage === 'load-model'), false);
  }
});

test('the maximum permitted token length is preserved without silent truncation', async () => {
  const fixture = await encoderFixture(), ids = [101, ...Array(254).fill(7), 102];
  fixture.frames[0] = { input_ids: ids, attention_mask: Array(256).fill(1), token_type_ids: Array(256).fill(0) };
  const result = await encodeChunks(artifact(), fixture.opts);
  assert.equal(result.counts.totalTokens, 256); assert.equal(result.tokenIds[0].length, 256);
  assert.equal(fixture.calls[0].input_ids.data.length, 256);
});

test('chunk text, IDs and source hash are projected before asynchronous work', async () => {
  const fixture = await encoderFixture(), input = artifact(), gate = deferred();
  fixture.opts.gpu.requestAdapter = () => gate.promise;
  const pending = encodeChunks(input, fixture.opts);
  input.source.sha256 = 'b'.repeat(64); input.chunks[0].id = 'mutated'; input.chunks[0].text = 'PRIVATE mutated';
  gate.resolve(fixture.hardware.adapter);
  const result = await pending;
  assert.equal(result.sourceSha256, 'a'.repeat(64)); assert.deepEqual(result.chunkIds, ['chunk-0']);
  assert.equal(fixture.events.find(([stage]) => stage === 'tokenize')[1], 'First chunk.');
});

test('nonfinite clocks refuse artifacts and negative elapsed time is refused', async () => {
  for (const values of [[NaN], [10, Infinity], [10, 9]]) {
    const fixture = await encoderFixture(); let index = 0; fixture.opts.now = () => values[Math.min(index++, values.length - 1)];
    await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('INVALID_EMBEDDING_CONFIG'));
    assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length <= 1, true);
  }
});

test('wrong hidden-state type or shape refuses embedding output and releases tensors', async () => {
  for (const shape of [[1, 3, 383], [2, 3, 384], [1, 2, 384]]) {
    const fixture = await encoderFixture();
    const malformed = new LibraryTensor('float32', new Float32Array(shape.reduce((a, b) => a * b, 1)), shape);
    let disposals = 0; malformed.dispose = () => { disposals++; };
    const wrongModel = async () => ({ last_hidden_state: malformed }); wrongModel.dispose = fixture.model.dispose;
    fixture.runtime.loadModel = async () => wrongModel;
    await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('INVALID_EMBEDDING'));
    assert.equal(disposals, 1); assert.equal(fixture.resources.every(item => item.disposals === 1), true);
    assert.equal(fixture.modelDisposals, 1);
  }
  const fixture = await encoderFixture(), wrong = new LibraryTensor('float64', new Float64Array(3 * 384), [1, 3, 384]);
  const model = async () => ({ last_hidden_state: wrong }); model.dispose = fixture.model.dispose;
  fixture.runtime.loadModel = async () => model;
  await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('INVALID_EMBEDDING'));
});

test('zero or nonfinite normalized output is refused rather than repaired', async () => {
  for (const value of [0, NaN, Infinity]) {
    const fixture = await encoderFixture();
    const model = async inputs => { const output = fixture.hidden(inputs.input_ids.dims[1]); output.data.fill(value);
      return { last_hidden_state: output }; };
    model.dispose = fixture.model.dispose; fixture.runtime.loadModel = async () => model;
    await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('INVALID_EMBEDDING'));
    assert.equal(fixture.resources.every(item => item.disposals === 1), true); assert.equal(fixture.modelDisposals, 1);
  }
});

test('model failures expose no private cause and release inputs, model and device', async () => {
  const fixture = await encoderFixture();
  const model = async () => { throw new Error('PRIVATE model input IDs'); }; model.dispose = fixture.model.dispose;
  fixture.runtime.loadModel = async () => model;
  await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('EMBEDDING_FAILED'));
  assert.equal(fixture.resources.length, 3); assert.equal(fixture.resources.every(item => item.disposals === 1), true);
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.hardware.calls.at(-1), 'destroy');
});

test('a model delivered after cancellation is disposed without inference', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), controller = new AbortController(), gate = deferred(), started = deferred();
  fixture.opts.signal = controller.signal;
  fixture.runtime.loadModel = () => { started.resolve(); return gate.promise; };
  const pending = encodeChunks(artifact(), fixture.opts); await started.promise; controller.abort();
  await assert.rejects(pending, safeError('ABORTED'));
  gate.resolve(fixture.model); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.calls.length, 0);
});

test('cancellation releases inference inputs and tensors returned late', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), controller = new AbortController(), gate = deferred(), started = deferred();
  fixture.opts.signal = controller.signal;
  const model = () => { started.resolve(); return gate.promise; }; model.dispose = fixture.model.dispose;
  fixture.runtime.loadModel = async () => model;
  const pending = encodeChunks(artifact(), fixture.opts); await started.promise; controller.abort();
  await assert.rejects(pending, safeError('ABORTED'));
  const late = fixture.hidden(3); gate.resolve({ last_hidden_state: late, alias: late });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.resources.every(item => item.disposals === 1), true);
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.hardware.calls.at(-1), 'destroy');
});

test('device loss while the model is loading refuses inference and cleans up the late model', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), gate = deferred(), started = deferred();
  fixture.runtime.loadModel = () => { started.resolve(); return gate.promise; };
  const pending = encodeChunks(artifact(), fixture.opts); await started.promise; fixture.hardware.lost.resolve({});
  await assert.rejects(pending, safeError('GPU_DEVICE_LOST'));
  gate.resolve(fixture.model); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
});

test('loss of the SDK inference device settles hanging inference and releases late tensors', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), gate = deferred(), started = deferred();
  const model = () => { started.resolve(); return gate.promise; }; model.dispose = fixture.model.dispose;
  fixture.runtime.loadModel = async () => model;
  const pending = encodeChunks(artifact(), fixture.opts); await started.promise;
  fixture.hardware.lost.resolve({ message: 'PRIVATE inference device diagnostic' });
  await assert.rejects(pending, safeError('GPU_DEVICE_LOST'));
  const late = fixture.hidden(3); gate.resolve({ last_hidden_state: late, alias: late });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.resources.every(item => item.disposals === 1), true);
  assert.equal(fixture.modelDisposals, 1);
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
});

test('cancellation before a queued adapter task prevents the request itself', async () => {
  const fixture = await assetFixture(), controller = new AbortController(); fixture.opts.signal = controller.signal;
  const pending = encodeChunks(artifact(), fixture.opts); controller.abort();
  await assert.rejects(pending, safeError('ABORTED'));
  assert.equal(fixture.hardware.calls.length, 0); assert.equal(fixture.requests.length, 0);
});

test('an already-lost SDK device refuses the artifact before inference', async () => {
  const fixture = await encoderFixture(); fixture.hardware.lost.resolve({ message: 'PRIVATE' });
  await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('GPU_DEVICE_LOST'));
  assert.equal(fixture.requests.length, 9); assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
});

test('an invalid cache object returned from open refuses the operation', async () => {
  for (const cache of [undefined, null, {}, { match() {} }, { put() {} }]) {
    const fixture = await assetFixture(); fixture.opts.cacheStorage.open = async () => cache;
    await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ASSET_INTEGRITY_ERROR'));
    assert.equal(fixture.imports.length, 0);
  }
});

test('private signal listener failures produce a fixed configuration error', async () => {
  await assert.rejects(encodeChunks(artifact(), options({
    signal: { aborted: false, addEventListener() { throw new Error('PRIVATE listener'); }, removeEventListener() {} },
  })), safeError('INVALID_EMBEDDING_CONFIG'));
});

test('a final-clock cancellation cannot return a completed artifact', async () => {
  const fixture = await encoderFixture(), controller = new AbortController(); fixture.opts.signal = controller.signal;
  let calls = 0; fixture.opts.now = () => { if (calls++) controller.abort(); return 10; };
  await assert.rejects(encodeChunks(artifact(), fixture.opts), safeError('ABORTED'));
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.hardware.calls.at(-1), 'destroy');
});

test('listener removal failure cannot leak a private diagnostic after cleanup', async () => {
  const fixture = await encoderFixture(); fixture.opts.signal = { aborted: false, addEventListener() {},
    removeEventListener() { throw new Error('PRIVATE listener removal'); } };
  const result = await encodeChunks(artifact(), fixture.opts);
  assert.equal(result.status, 'embedded-not-retrieved'); assert.equal(fixture.hardware.calls.at(-1), 'destroy');
});

test('a query preserves its raw text and returns the actual pooled vector with token progress', async () => {
  const fixture = await encoderFixture(), question = '  PRIVATE revenue?\n\t';
  fixture.frames.push({ input_ids: [101, 7, 8, 9, 102], attention_mask: [1, 1, 1, 1, 1],
    token_type_ids: [0, 0, 0, 0, 0] });
  const result = await encodeQuery(question, fixture.opts);
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'status', 'representationId', 'representation',
    'backend', 'dtype', 'tokenIds', 'vector', 'counts', 'receipt']);
  assert.equal(result.schemaVersion, 1); assert.equal(result.status, 'query-embedded-not-retrieved');
  assert.equal(result.representationId, EMBEDDING_SPEC.version); assert.equal(result.representation, EMBEDDING_SPEC);
  assert.equal(result.backend, 'webgpu'); assert.equal(result.dtype, 'fp32');
  assert.deepEqual(result.tokenIds, [101, 7, 8, 9, 102]);
  assert.deepEqual(result.counts, { totalTokens: 5, dimensions: 384 });
  assert.equal(result.vector.length, 384);
  // Five hidden rows have first coordinates 1..5 and second coordinate 2:
  // attention-mask mean [3, 2], then L2 normalization [3/sqrt(13), 2/sqrt(13)].
  assert.ok(Math.abs(result.vector[0] - 3 / Math.sqrt(13)) < 1e-6);
  assert.ok(Math.abs(result.vector[1] - 2 / Math.sqrt(13)) < 1e-6);
  assert.equal(result.vector.slice(2).every(value => value === 0), true);
  assert.deepEqual(fixture.events.find(([stage]) => stage === 'tokenize').slice(1), [question,
    { padding: false, truncation: false, add_special_tokens: true, return_tensor: false }]);
  assert.deepEqual(fixture.calls, [{ input_ids: { type: 'int64', dims: [1, 5], data: [101n, 7n, 8n, 9n, 102n] },
    attention_mask: { type: 'int64', dims: [1, 5], data: [1n, 1n, 1n, 1n, 1n] },
    token_type_ids: { type: 'int64', dims: [1, 5], data: [0n, 0n, 0n, 0n, 0n] } }]);
  assert.deepEqual(fixture.events.find(([stage]) => stage === 'pool').slice(1), [[1n, 1n, 1n, 1n, 1n]]);
  assert.deepEqual(fixture.events.find(([stage]) => stage === 'normalize').slice(1), [2, -1]);
  assert.ok(fixture.events.findIndex(([stage]) => stage === 'tokenize')
    < fixture.events.findIndex(([stage]) => stage === 'load-model'));
  assert.deepEqual(fixture.progress.map(([stage]) => stage), [...Array(9).fill('download'), 'initialize', 'encode', 'encode']);
  assert.deepEqual(fixture.progress.slice(-3), [
    ['initialize', { completed: 0, total: null, unit: 'tokens', estimated: false }],
    ['encode', { completed: 0, total: 5, unit: 'tokens', estimated: false }],
    ['encode', { completed: 5, total: 5, unit: 'tokens', estimated: false }],
  ]);
  assert.equal(fixture.progress.every(([, payload]) => Object.isFrozen(payload)), true);
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.resources.every(item => item.disposals === 1), true);
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
});

test('invalid queries are refused before options, defaults, dependencies or GPU can be read', async () => {
  const descriptors = ['navigator', 'fetch', 'caches', 'crypto', 'performance', 'location']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  let reads = 0;
  const badOptions = new Proxy({}, {
    get() { reads++; throw new Error('PRIVATE option'); },
    ownKeys() { reads++; throw new Error('PRIVATE option keys'); },
    getPrototypeOf() { reads++; throw new Error('PRIVATE option prototype'); },
  });
  try {
    for (const [key] of descriptors) Object.defineProperty(globalThis, key, { configurable: true,
      get() { reads++; throw new Error('PRIVATE dependency'); } });
    for (const question of [undefined, null, false, 1, {}, [], new String('question'), '', ' \n\t',
      'x'.repeat(4097), '😀'.repeat(2049)]) {
      await assert.rejects(encodeQuery(question, badOptions), safeError('INVALID_EMBEDDING_CONFIG'));
    }
    assert.equal(reads, 0);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

test('a 4096 UTF-16-unit query is accepted and passed through without text repair', async () => {
  const fixture = await encoderFixture(), question = '😀'.repeat(2048);
  const result = await encodeQuery(question, fixture.opts);
  assert.equal(result.counts.totalTokens, 3);
  assert.equal(fixture.events.find(([stage]) => stage === 'tokenize')[1], question);
});

test('query artifacts are deeply frozen and detached from tokenizer and tensor buffers', async () => {
  const fixture = await encoderFixture(), frame = { input_ids: [101, 4, 102],
    attention_mask: [1, 1, 1], token_type_ids: [0, 0, 0] };
  fixture.frames.push(frame);
  const result = await encodeQuery('PRIVATE query', fixture.opts);
  assert.equal([result, result.representation, result.tokenIds, result.vector, result.counts, result.receipt]
    .every(Object.isFrozen), true);
  assert.notEqual(result.tokenIds, frame.input_ids);
  frame.input_ids.fill(0); fixture.hiddenBuffers.forEach(buffer => buffer.fill(0));
  assert.deepEqual(result.tokenIds, [101, 4, 102]); assert.ok(result.vector[0] > 0.7);
  assert.throws(() => { result.vector[0] = 0; }, TypeError);
  assert.throws(() => { result.counts.totalTokens = 0; }, TypeError);
});

test('query byte progress and mixed cache receipts count the same eight verified local assets', async () => {
  const fixture = await encoderFixture(), cachedURL = [...fixture.bodies.keys()][0];
  const bytes = fixture.bodies.get(cachedURL); fixture.stored.set(cachedURL, new Response(bytes));
  const result = await encodeQuery('query', fixture.opts);
  assert.deepEqual(result.receipt, { verifiedBytes: fixture.total, networkBytes: fixture.total - bytes.length,
    cacheBytes: bytes.length, elapsedMs: 1 });
  assert.equal(result.receipt.verifiedBytes, result.receipt.networkBytes + result.receipt.cacheBytes);
  assert.equal(fixture.requests.length, 8); assert.equal(fixture.imports.length, 1);
  assert.equal(fixture.imports[0], BASE + 'vendor/transformers/transformers.min.js');
  for (const [url, request] of fixture.requests) {
    assert.equal(new URL(url).origin, 'https://reader.example'); assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit'); assert.equal(request.signal instanceof AbortSignal, true);
  }
  const progress = fixture.progress.filter(([stage]) => stage === 'download').map(([, payload]) => payload);
  assert.equal(progress.length, 9); assert.equal(progress[0].completed, 0);
  assert.deepEqual(progress.at(-1), { completed: fixture.total, total: fixture.total, unit: 'bytes', estimated: false });
  assert.equal(progress.every((payload, index) => payload.total === fixture.total && payload.unit === 'bytes'
    && payload.estimated === false && (!index || payload.completed > progress[index - 1].completed)), true);
  assert.deepEqual(fixture.events.find(([stage]) => stage === 'load-tokenizer').slice(1),
    [EMBEDDING_SPEC.modelId, { revision: EMBEDDING_SPEC.revision, local_files_only: true }]);
  assert.deepEqual(fixture.events.find(([stage]) => stage === 'load-model').slice(1),
    [EMBEDDING_SPEC.modelId, { revision: EMBEDDING_SPEC.revision, local_files_only: true, device: 'webgpu', dtype: 'fp32' }]);
  assert.equal(fixture.library.env.allowRemoteModels, false); assert.equal(fixture.library.env.allowLocalModels, true);
  assert.equal((await fixture.library.env.customCache.match('https://evil.example/model.onnx')).status, 404);
});

test('query verification uses default global fetch with its native receiver', async () => {
  const fixture = await encoderFixture(), fetch = fixture.opts.fetch;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true,
    value: function(url, request) { assert.equal(this, globalThis); return fetch(url, request); } });
  delete fixture.opts.fetch;
  try {
    const result = await encodeQuery('query', fixture.opts);
    assert.equal(result.status, 'query-embedded-not-retrieved'); assert.equal(fixture.requests.length, 9);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'fetch', descriptor); else delete globalThis.fetch;
  }
});

test('query configuration refuses a cross-origin base before requesting an adapter', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location'); let requests = 0;
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://reader.example' } });
  try {
    await assert.rejects(encodeQuery('query', options({ baseURL: 'https://evil.example/browser-rag/',
      gpu: { requestAdapter() { requests++; } } })), safeError('INVALID_EMBEDDING_CONFIG'));
    assert.equal(requests, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor); else delete globalThis.location;
  }
});

test('invalid query token IDs refuse model loading without truncation or diagnostics', async () => {
  for (const ids of [[101, 102], [101, ...Array(255).fill(1), 102], [101, 30522, 102],
    [101, -1, 102], [101, 1.1, 102], [100, 1, 102], [101, 1, 103], [101, , 102],
    new Uint32Array([101, 1, 102])]) {
    const fixture = await encoderFixture();
    fixture.frames.push({ input_ids: ids, attention_mask: Array(ids.length).fill(1), token_type_ids: Array(ids.length).fill(0) });
    await assert.rejects(encodeQuery('PRIVATE query', fixture.opts), safeError('ENCODER_INPUT_LIMIT'));
    assert.equal(fixture.events.some(([stage]) => stage === 'load-model'), false);
    assert.equal(fixture.calls.length, 0); assert.equal(fixture.resources.length, 0);
    assert.equal(fixture.hardware.calls.includes('device'), false);
  }
});

test('invalid query masks and token types refuse inference before model creation', async () => {
  for (const frame of [
    { input_ids: [101, 1, 102], attention_mask: [1, 0, 1], token_type_ids: [0, 0, 0] },
    { input_ids: [101, 1, 102], attention_mask: [1, 1], token_type_ids: [0, 0, 0] },
    { input_ids: [101, 1, 102], attention_mask: [1, , 1], token_type_ids: [0, 0, 0] },
    { input_ids: [101, 1, 102], attention_mask: [1, 1, 1], token_type_ids: [0, 1, 0] },
    { input_ids: [101, 1, 102], attention_mask: [1, 1, 1] }]) {
    const fixture = await encoderFixture(); fixture.frames.push(frame);
    await assert.rejects(encodeQuery('PRIVATE query', fixture.opts), safeError('ENCODER_INPUT_LIMIT'));
    assert.equal(fixture.events.some(([stage]) => stage === 'load-model'), false); assert.equal(fixture.calls.length, 0);
  }
});

test('the maximum query token budget reaches inference with every original token', async () => {
  const fixture = await encoderFixture(), ids = [101, ...Array(254).fill(30521), 102];
  fixture.frames.push({ input_ids: ids, attention_mask: Array(256).fill(1), token_type_ids: Array(256).fill(0) });
  const result = await encodeQuery('query', fixture.opts);
  assert.deepEqual(result.tokenIds, ids); assert.equal(result.counts.totalTokens, 256);
  assert.equal(fixture.calls[0].input_ids.data.length, 256);
  assert.deepEqual(fixture.progress.at(-1), ['encode', { completed: 256, total: 256, unit: 'tokens', estimated: false }]);
});

test('a query refuses a malformed hidden state and releases the output and inference inputs', async () => {
  const fixture = await encoderFixture();
  const model = async () => ({ last_hidden_state: fixture.hidden(4) }); model.dispose = fixture.model.dispose;
  fixture.runtime.loadModel = async () => model;
  await assert.rejects(encodeQuery('PRIVATE query', fixture.opts), safeError('INVALID_EMBEDDING'));
  assert.equal(fixture.resources.every(item => item.disposals === 1), true);
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
});

test('a query refuses zero and nonfinite model output rather than repairing a vector', async () => {
  for (const value of [0, NaN, Infinity]) {
    const fixture = await encoderFixture();
    const model = async inputs => { const output = fixture.hidden(inputs.input_ids.dims[1]); output.data.fill(value);
      return { last_hidden_state: output }; };
    model.dispose = fixture.model.dispose; fixture.runtime.loadModel = async () => model;
    await assert.rejects(encodeQuery('PRIVATE query', fixture.opts), safeError('INVALID_EMBEDDING'));
    assert.equal(fixture.resources.every(item => item.disposals === 1), true); assert.equal(fixture.modelDisposals, 1);
  }
});

test('query model failures expose a safe error and release all owned resources', async () => {
  const fixture = await encoderFixture();
  const model = async () => { throw new Error('PRIVATE query model input'); }; model.dispose = fixture.model.dispose;
  fixture.runtime.loadModel = async () => model;
  await assert.rejects(encodeQuery('PRIVATE query', fixture.opts), safeError('EMBEDDING_FAILED'));
  assert.equal(fixture.resources.length, 3); assert.equal(fixture.resources.every(item => item.disposals === 1), true);
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.hardware.calls.at(-1), 'destroy');
});

test('query cancellation before queued work prevents adapter and asset requests', async () => {
  const fixture = await encoderFixture(), controller = new AbortController(); fixture.opts.signal = controller.signal;
  const pending = encodeQuery('query', fixture.opts); controller.abort();
  await assert.rejects(pending, safeError('ABORTED'));
  assert.equal(fixture.hardware.calls.length, 0); assert.equal(fixture.requests.length, 0);
});

test('a query device delivered after cancellation is destroyed exactly once', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), controller = new AbortController(), gate = deferred(), started = deferred();
  fixture.opts.signal = controller.signal;
  fixture.hardware.adapter.requestDevice = () => { started.resolve(); return gate.promise; };
  const pending = encodeQuery('query', fixture.opts); await started.promise; controller.abort();
  await assert.rejects(pending, safeError('ABORTED'));
  gate.resolve(fixture.hardware.device); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
  assert.equal(fixture.calls.length, 0); assert.equal(fixture.modelDisposals, 0);
});

test('a query model delivered after cancellation is disposed without inference', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), controller = new AbortController(), gate = deferred(), started = deferred();
  fixture.opts.signal = controller.signal;
  fixture.runtime.loadModel = () => { started.resolve(); return gate.promise; };
  const pending = encodeQuery('query', fixture.opts); await started.promise; controller.abort();
  await assert.rejects(pending, safeError('ABORTED'));
  gate.resolve(fixture.model); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
});

test('query cancellation releases inputs and aliased tensors returned after inference stops', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), controller = new AbortController(), gate = deferred(), started = deferred();
  fixture.opts.signal = controller.signal;
  const model = () => { started.resolve(); return gate.promise; }; model.dispose = fixture.model.dispose;
  fixture.runtime.loadModel = async () => model;
  const pending = encodeQuery('query', fixture.opts); await started.promise; controller.abort();
  await assert.rejects(pending, safeError('ABORTED'));
  const late = fixture.hidden(3); gate.resolve({ last_hidden_state: late, alias: late });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.resources.every(item => item.disposals === 1), true);
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
});

test('query device loss while loading cleans up a late model and refuses inference', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), gate = deferred(), started = deferred();
  fixture.runtime.loadModel = () => { started.resolve(); return gate.promise; };
  const pending = encodeQuery('query', fixture.opts); await started.promise; fixture.hardware.lost.resolve({});
  await assert.rejects(pending, safeError('GPU_DEVICE_LOST'));
  gate.resolve(fixture.model); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
});

test('query device loss settles inference and releases late aliased output tensors', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), gate = deferred(), started = deferred();
  const model = () => { started.resolve(); return gate.promise; }; model.dispose = fixture.model.dispose;
  fixture.runtime.loadModel = async () => model;
  const pending = encodeQuery('query', fixture.opts); await started.promise;
  fixture.hardware.lost.resolve({ message: 'PRIVATE query device diagnostic' });
  await assert.rejects(pending, safeError('GPU_DEVICE_LOST'));
  const late = fixture.hidden(3); gate.resolve({ last_hidden_state: late, alias: late });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.resources.every(item => item.disposals === 1), true);
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1);
});

test('a query device returned after model loading failed is still destroyed once', { timeout: 1000 }, async () => {
  const fixture = await encoderFixture(), gate = deferred(); let started = false;
  fixture.hardware.adapter.requestDevice = () => { started = true; return gate.promise; };
  fixture.library.AutoModel.from_pretrained = () => {
    fixture.library.env.backends.onnx.webgpu.adapter.requestDevice({ requiredFeatures: [] }).catch(() => {});
    throw new Error('PRIVATE query SDK initialization');
  };
  await assert.rejects(encodeQuery('query', fixture.opts), safeError('EMBEDDING_LOAD_FAILED'));
  assert.equal(started, true);
  gate.resolve(fixture.hardware.device); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.hardware.calls.filter(value => value === 'destroy').length, 1); assert.equal(fixture.calls.length, 0);
});

test('a query cancelled by the final clock cannot return a completed artifact', async () => {
  const fixture = await encoderFixture(), controller = new AbortController(); fixture.opts.signal = controller.signal;
  let calls = 0; fixture.opts.now = () => { if (calls++) controller.abort(); return 10; };
  await assert.rejects(encodeQuery('query', fixture.opts), safeError('ABORTED'));
  assert.equal(fixture.modelDisposals, 1); assert.equal(fixture.hardware.calls.at(-1), 'destroy');
});
