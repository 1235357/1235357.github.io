import { EMBEDDING_SPEC, validateTokenIds, acceptEmbeddingVectors } from './embedding-contract.mjs';

const MESSAGES = Object.freeze({
  INVALID_EMBEDDING_CONFIG: 'The embedding configuration is invalid.',
  ENCODER_INPUT_LIMIT: 'The encoder input is invalid or exceeds its token budget.',
  INVALID_EMBEDDING: 'The embedding vectors are invalid.',
  GPU_UNAVAILABLE: 'A non-fallback WebGPU adapter is required.',
  GPU_DEVICE_LOST: 'The WebGPU device was lost.',
  ASSET_INTEGRITY_ERROR: 'The local embedding assets could not be verified.',
  EMBEDDING_LOAD_FAILED: 'The local embedding encoder could not be loaded.',
  EMBEDDING_FAILED: 'The embedding operation failed.',
  ABORTED: 'The embedding operation was cancelled.',
});
export class EmbeddingRuntimeError extends Error {
  constructor(code) {
    const safe = typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'EMBEDDING_FAILED';
    super(MESSAGES[safe]); this.name = 'EmbeddingRuntimeError'; this.code = safe;
  }
}
const fail = code => { throw new EmbeddingRuntimeError(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const SHA = /^[a-f0-9]{64}$/;

function projectChunks(artifact) {
  try {
    if (!record(artifact) || artifact.schemaVersion !== 1 || artifact.status !== 'chunked-not-embedded'
      || !record(artifact.source) || typeof artifact.source.sha256 !== 'string'
      || !SHA.test(artifact.source.sha256) || !record(artifact.counts) || !Array.isArray(artifact.chunks)
      || artifact.chunks.length < 1 || artifact.chunks.length > EMBEDDING_SPEC.maxChunks
      || artifact.counts.chunks !== artifact.chunks.length) fail('INVALID_EMBEDDING_CONFIG');
    const chunks = [], ids = new Set(), sourceSha256 = artifact.source.sha256;
    for (let i = 0; i < artifact.chunks.length; i++) {
      if (!Object.hasOwn(artifact.chunks, i)) fail('INVALID_EMBEDDING_CONFIG');
      const chunk = artifact.chunks[i];
      if (!record(chunk) || typeof chunk.id !== 'string' || !chunk.id.trim() || chunk.id.length > 1024
        || ids.has(chunk.id) || typeof chunk.text !== 'string' || !chunk.text.trim()
        || chunk.text.length > 4096) fail('INVALID_EMBEDDING_CONFIG');
      ids.add(chunk.id); chunks.push({ id: chunk.id, text: chunk.text });
    }
    return { sourceSha256, chunks };
  } catch { fail('INVALID_EMBEDDING_CONFIG'); }
}

function dependencies(options) {
  try {
    const keys = ['baseURL', 'gpu', 'fetch', 'cacheStorage', 'crypto', 'importer', 'now', 'signal', 'onProgress'];
    if (!record(options) || Reflect.ownKeys(options).some(key => !keys.includes(key))) fail('INVALID_EMBEDDING_CONFIG');
    const own = (key, defaultValue) => Object.hasOwn(options, key) ? options[key] : defaultValue();
    const base = new URL(own('baseURL', () => new URL('./', import.meta.url)));
    const moduleURL = new URL(import.meta.url);
    const origin = ['http:', 'https:'].includes(moduleURL.protocol) ? moduleURL.origin : globalThis.location?.origin;
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash
      || !base.pathname.endsWith('/') || (origin && origin !== 'null' && base.origin !== origin)) {
      fail('INVALID_EMBEDDING_CONFIG');
    }
    const config = { baseURL: base.href, gpu: own('gpu', () => globalThis.navigator?.gpu),
      fetch: own('fetch', () => {
        const fetch = globalThis.fetch;
        return typeof fetch === 'function' ? fetch.bind(globalThis) : fetch;
      }), cacheStorage: own('cacheStorage', () => globalThis.caches),
      crypto: own('crypto', () => globalThis.crypto), importer: own('importer', () => url => import(url)),
      now: own('now', () => () => globalThis.performance.now()), signal: options.signal, onProgress: options.onProgress };
    if (typeof config.fetch !== 'function' || typeof config.importer !== 'function' || typeof config.now !== 'function'
      || typeof config.crypto?.subtle?.digest !== 'function'
      || (config.cacheStorage != null && typeof config.cacheStorage.open !== 'function')
      || (config.onProgress !== undefined && typeof config.onProgress !== 'function')
      || (config.signal !== undefined && (typeof config.signal?.aborted !== 'boolean'
        || typeof config.signal.addEventListener !== 'function' || typeof config.signal.removeEventListener !== 'function'))) {
      fail('INVALID_EMBEDDING_CONFIG');
    }
    return config;
  } catch { fail('INVALID_EMBEDDING_CONFIG'); }
}

// Every awaited boundary races cancellation/device loss. A resource returned
// after that race is released without keeping the public operation pending.
function lifecycle(config) {
  let reason, active = true, rejectStop;
  const controller = new AbortController();
  const stopped = new Promise((_resolve, reject) => { rejectStop = reject; });
  stopped.catch(() => {});
  const stop = code => {
    if (!active || reason) return;
    reason = code; controller.abort(); rejectStop(new EmbeddingRuntimeError(code));
  };
  const abort = () => stop('ABORTED');
  try {
    config.signal?.addEventListener('abort', abort, { once: true });
    if (config.signal?.aborted) abort();
  } catch { fail('INVALID_EMBEDDING_CONFIG'); }
  const check = () => { if (reason) fail(reason); };
  return {
    signal: controller.signal, check,
    watch(device) {
      if (typeof device?.destroy !== 'function' || typeof device?.lost?.then !== 'function') fail('GPU_UNAVAILABLE');
      device.lost.then(() => stop('GPU_DEVICE_LOST'), () => stop('GPU_DEVICE_LOST'));
      check();
    },
    async wait(task, code, onLate = () => {}) {
      check();
      const operation = Promise.resolve().then(() => { check(); return task(); }).then(value => {
        if (reason) { quiet(() => onLate(value)); fail(reason); }
        return value;
      });
      try { const value = await Promise.race([operation, stopped]); check(); return value; }
      catch (error) { if (reason) fail(reason); if (error instanceof EmbeddingRuntimeError) throw error; fail(code); }
    },
    emit(stage, payload) {
      check(); config.onProgress?.(stage, Object.freeze(payload)); check();
    },
    close() { active = false; quiet(() => config.signal?.removeEventListener('abort', abort)); },
  };
}
function quiet(task) {
  try { const result = task(); if (result && typeof result.catch === 'function') result.catch(() => {}); } catch {}
}

const MODEL_FILES = Object.freeze(['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model.onnx']);
const RUNTIME_FILES = Object.freeze(['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']);
// Fixed preparation metadata supplements the existing loader registry contract.
// Ordinary encode/query behavior is unchanged; preparation receipts use these pins.
export const EMBEDDING_PREPARATION_PINS = Object.freeze(Object.fromEntries(Object.entries({
  'config.json': { bytes: 650, sha256: '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7' },
  'tokenizer.json': { bytes: 711661, sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0' },
  'tokenizer_config.json': { bytes: 366, sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3' },
  'special_tokens_map.json': { bytes: 125, sha256: 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3' },
  'onnx/model.onnx': { bytes: 90387606, sha256: '759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e' },
  'transformers.min.js': { bytes: 888173, sha256: 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa' },
  'ort-wasm-simd-threaded.jsep.mjs': { bytes: 44484, sha256: '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9' },
  'ort-wasm-simd-threaded.jsep.wasm': { bytes: 21596019, sha256: 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39' },
}).map(([name,pin])=>[name,Object.freeze(pin)])));
const NOTICE_FILES = Object.freeze(['TRANSFORMERS-LICENSE.txt', 'JINJA-LICENSE.txt', 'FLATBUFFERS-LICENSE.txt',
  'LONG-LICENSE.txt', 'PLATFORM-LICENSE.txt', 'PROTOBUFJS-LICENSE.txt', 'MODEL-CARD.txt',
  'ONNXRUNTIME-LICENSE.txt', 'ONNXRUNTIME-ThirdPartyNotices.txt', 'ATTRIBUTION.txt']);
const exactKeys = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

function assetPlan(registry, baseURL) {
  if (!exactKeys(registry, ['schemaVersion', 'modelId', 'revision', 'libraryVersion', 'ortVersion',
    'modelFiles', 'runtimeFiles', 'noticeFiles']) || registry.schemaVersion !== 1
    || registry.modelId !== EMBEDDING_SPEC.modelId || registry.revision !== EMBEDDING_SPEC.revision
    || registry.libraryVersion !== '3.8.1' || registry.ortVersion !== '1.22.0-dev.20250409-89f8206ba4') {
    fail('ASSET_INTEGRITY_ERROR');
  }
  const assets = []; let total = 0;
  for (const [group, names, prefix] of [
    ['modelFiles', MODEL_FILES, `models/${EMBEDDING_SPEC.revision}/${EMBEDDING_SPEC.modelId}/`],
    ['runtimeFiles', RUNTIME_FILES, 'vendor/transformers/'], ['noticeFiles', NOTICE_FILES, 'notices/']]) {
    if (!exactKeys(registry[group], names)) fail('ASSET_INTEGRITY_ERROR');
    for (const name of names) {
      const entry = registry[group][name];
      if (!exactKeys(entry, ['bytes', 'sha256']) || !Number.isSafeInteger(entry.bytes)
        || entry.bytes < 1 || entry.bytes > 100 * 1024 * 1024 || typeof entry.sha256 !== 'string'
        || !SHA.test(entry.sha256)) fail('ASSET_INTEGRITY_ERROR');
      if (group !== 'noticeFiles') {
        total += entry.bytes; assets.push({ url: new URL(prefix + name, baseURL).href, ...entry });
      }
    }
  }
  if (total > 128 * 1024 * 1024) fail('ASSET_INTEGRITY_ERROR');
  return { assets, total };
}

async function readBytes(response, url, limit, exact, scope) {
  let reader, complete = false;
  try {
    if (!response?.ok || response.redirected || (response.url && response.url !== url)
      || typeof response.body?.getReader !== 'function') fail('ASSET_INTEGRITY_ERROR');
    const encoding = response.headers.get('content-encoding');
    const encoded = encoding !== null && encoding.trim().toLowerCase() !== 'identity';
    if (encoded && encoding.toLowerCase().split(',').some(value =>
      !['gzip', 'br', 'deflate'].includes(value.trim()))) fail('ASSET_INTEGRITY_ERROR');
    // Fetch decodes supported content codings but preserves the wire length.
    // The bounded decoded stream and its pinned SHA remain authoritative.
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))
      || (encoded ? length !== String(Number(length))
        : Number(length) > limit || (exact && Number(length) !== limit)))) fail('ASSET_INTEGRITY_ERROR');
    reader = response.body.getReader();
    const buffer = new Uint8Array(limit); let count = 0;
    while (true) {
      const part = await scope.wait(() => reader.read(), 'ASSET_INTEGRITY_ERROR');
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || part.value.byteLength > limit - count) fail('ASSET_INTEGRITY_ERROR');
      buffer.set(part.value, count); count += part.value.byteLength;
    }
    if (exact && count !== limit) fail('ASSET_INTEGRITY_ERROR');
    complete = true; return buffer.slice(0, count);
  } catch (error) { if (error instanceof EmbeddingRuntimeError) throw error; fail('ASSET_INTEGRITY_ERROR'); }
  finally {
    if (!complete) quiet(() => reader ? reader.cancel() : response?.body?.cancel());
    quiet(() => reader?.releaseLock());
  }
}

async function verifyAssets(config, scope, fixedPreparation = false) {
  const registryURL = new URL('embedding-assets.json', config.baseURL).href;
  const request = url => scope.wait(() => config.fetch(url, { redirect: 'error', credentials: 'omit', signal: scope.signal }),
    'ASSET_INTEGRITY_ERROR', response => response?.body?.cancel());
  const bytes = await readBytes(await request(registryURL), registryURL, 32768, false, scope);
  let registry;
  try { registry = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('ASSET_INTEGRITY_ERROR'); }
  const { assets, total } = assetPlan(registry, config.baseURL);
  if (fixedPreparation) for (const asset of assets) {
    const name = asset.url.includes('/vendor/transformers/') ? asset.url.split('/').at(-1)
      : asset.url.split(`${EMBEDDING_SPEC.modelId}/`)[1];
    const fixed = EMBEDDING_PREPARATION_PINS[name];
    if (!fixed || asset.bytes !== fixed.bytes || asset.sha256 !== fixed.sha256) fail('ASSET_INTEGRITY_ERROR');
  }
  const cache = config.cacheStorage == null ? null : await scope.wait(() => config.cacheStorage.open(
    `financial-rag-embedding-${EMBEDDING_SPEC.revision}-v1`), 'ASSET_INTEGRITY_ERROR');
  if (config.cacheStorage != null && (!cache || typeof cache.match !== 'function' || typeof cache.put !== 'function')) {
    fail('ASSET_INTEGRITY_ERROR');
  }
  const verified = new Map(), receipt = { verifiedBytes: 0, networkBytes: 0, cacheBytes: 0 };
  const progress = () => scope.emit('download', { completed: receipt.verifiedBytes, total, unit: 'bytes', estimated: false });
  progress();
  for (const asset of assets) {
    let response = cache ? await scope.wait(() => cache.match(asset.url), 'ASSET_INTEGRITY_ERROR',
      value => value?.body?.cancel()) : undefined;
    const cached = response !== undefined && response !== null;
    if (!cached) response = await request(asset.url);
    const buffer = await readBytes(response, asset.url, asset.bytes, true, scope);
    const hash = await scope.wait(() => config.crypto.subtle.digest('SHA-256', buffer), 'ASSET_INTEGRITY_ERROR');
    const actual = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== asset.sha256) fail('ASSET_INTEGRITY_ERROR');
    const accepted = new Response(buffer);
    if (cache && !cached) await scope.wait(() => cache.put(asset.url, accepted.clone()), 'ASSET_INTEGRITY_ERROR');
    verified.set(asset.url, accepted);
    receipt.verifiedBytes += buffer.length; receipt[cached ? 'cacheBytes' : 'networkBytes'] += buffer.length;
    progress();
  }
  return { verified, receipt, assetPins: assets.map(asset => Object.freeze({ ...asset })) };
}

// Explicit static preparation owns no PDF, tokenizer, SDK or GPU resources.
// Persistent cache bodies remain advisory: every later operation verifies again.
export async function prepareEmbeddingAssets(options = {}) {
  if (!record(options) || Reflect.ownKeys(options).some(key =>
    !['baseURL', 'fetch', 'cacheStorage', 'crypto', 'now', 'signal', 'onProgress'].includes(key))) {
    fail('INVALID_EMBEDDING_CONFIG');
  }
  const config = dependencies({ ...options, gpu: null, importer: () => { fail('EMBEDDING_LOAD_FAILED'); } });
  if (config.cacheStorage == null) fail('ASSET_INTEGRITY_ERROR');
  const scope = lifecycle(config); let prepared;
  try {
    prepared = await verifyAssets(config, scope, true); scope.check();
    return Object.freeze({ assets: prepared.assetPins.length, ...prepared.receipt,
      assetPins: Object.freeze(prepared.assetPins) });
  } finally {
    if (prepared) { for (const response of prepared.verified.values()) quiet(() => response.body?.cancel()); prepared.verified.clear(); }
    scope.close();
  }
}

function configureLibrary(library, config, adapter, verified, wasmBinary) {
  try {
    if (typeof library?.AutoTokenizer?.from_pretrained !== 'function'
      || typeof library?.AutoModel?.from_pretrained !== 'function' || typeof library.Tensor !== 'function'
      || typeof library.mean_pooling !== 'function' || !library.env?.backends?.onnx?.wasm
      || !library.env.backends.onnx.webgpu) fail('EMBEDDING_LOAD_FAILED');
    const env = library.env;
    env.allowRemoteModels = false; env.allowLocalModels = true;
    env.localModelPath = new URL(`models/${EMBEDDING_SPEC.revision}/`, config.baseURL).href;
    env.useBrowserCache = false; env.useFSCache = false; env.useCustomCache = true;
    env.customCache = {
      async match(request) {
        const url = typeof request === 'string' ? request : request?.url;
        return verified.get(url)?.clone() ?? new Response(null, { status: 404 });
      },
      async put() {},
    };
    env.backends.onnx.wasm.wasmPaths = {
      wasm: new URL('vendor/transformers/ort-wasm-simd-threaded.jsep.wasm', config.baseURL).href,
      mjs: new URL('vendor/transformers/ort-wasm-simd-threaded.jsep.mjs', config.baseURL).href,
    };
    // The pinned ORT factory uses this verified body instead of fetching WASM
    // again. The owned worker retains the additional ArrayBuffer until teardown.
    env.backends.onnx.wasm.wasmBinary = wasmBinary;
    env.backends.onnx.wasm.proxy = false; env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.webgpu.adapter = adapter;
  } catch { fail('EMBEDDING_LOAD_FAILED'); }
}

function tokenFrame(frame) {
  try {
    if (!record(frame)) fail('ENCODER_INPUT_LIMIT');
    const ids = validateTokenIds(frame.input_ids);
    if (ids[0] !== 101 || ids.at(-1) !== 102 || ids.some(id => id > 30521)) fail('ENCODER_INPUT_LIMIT');
    const arrays = {};
    for (const [key, expected] of [['attention_mask', 1], ['token_type_ids', 0]]) {
      const array = frame[key];
      if (!Array.isArray(array) || array.length !== ids.length) fail('ENCODER_INPUT_LIMIT');
      const copied = [];
      for (let i = 0; i < ids.length; i++) {
        if (!Object.hasOwn(array, i) || array[i] !== expected) fail('ENCODER_INPUT_LIMIT');
        copied.push(expected);
      }
      arrays[key] = Object.freeze(copied);
    }
    return { input_ids: ids, ...arrays };
  } catch { fail('ENCODER_INPUT_LIMIT'); }
}

function validTensor(tensor, dims) {
  if (!tensor || tensor.type !== 'float32' || !(tensor.data instanceof Float32Array)
    || !Array.isArray(tensor.dims) || tensor.dims.length !== dims.length
    || dims.some((value, index) => tensor.dims[index] !== value)
    || tensor.data.length !== dims.reduce((a, b) => a * b, 1)) fail('INVALID_EMBEDDING');
}
function clock(config) {
  try { const value = config.now(); if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail('INVALID_EMBEDDING_CONFIG'); return value; }
  catch { fail('INVALID_EMBEDDING_CONFIG'); }
}

export async function encodeChunks(chunkArtifact, options = {}) {
  const projected = projectChunks(chunkArtifact);
  const encoded = await encodeTextRows(projected.chunks.map(chunk => chunk.text), options, 'chunks');
  return Object.freeze({ schemaVersion: 1, status: 'embedded-not-retrieved', sourceSha256: projected.sourceSha256,
    representationId: EMBEDDING_SPEC.version, representation: EMBEDDING_SPEC, backend: 'webgpu', dtype: 'fp32',
    chunkIds: Object.freeze(projected.chunks.map(chunk => chunk.id)),
    tokenIds: encoded.tokenIds, vectors: encoded.vectors,
    counts: Object.freeze({ chunks: encoded.tokenIds.length, totalTokens: encoded.totalTokens,
      dimensions: EMBEDDING_SPEC.dimensions }), receipt: encoded.receipt });
}

export async function encodeQuery(question, options = {}) {
  if (typeof question !== 'string' || !question.trim() || question.length > 4096) fail('INVALID_EMBEDDING_CONFIG');
  const encoded = await encodeTextRows([question], options, 'tokens');
  return Object.freeze({ schemaVersion: 1, status: 'query-embedded-not-retrieved',
    representationId: EMBEDDING_SPEC.version, representation: EMBEDDING_SPEC, backend: 'webgpu', dtype: 'fp32',
    tokenIds: encoded.tokenIds[0], vector: encoded.vectors[0],
    counts: Object.freeze({ totalTokens: encoded.totalTokens, dimensions: EMBEDDING_SPEC.dimensions }),
    receipt: encoded.receipt });
}

// Passage and query inputs use the same verified assets, token preflight,
// inference, pooling and resource lifetime. Only their progress units differ.
async function encodeTextRows(texts, options, unit) {
  const config = dependencies(options);
  const scope = lifecycle(config), released = new WeakSet(); let device, model, closed = false;
  const releaseDevice = value => {
    if (value && typeof value.destroy === 'function' && !released.has(value)) {
      released.add(value); quiet(() => value.destroy());
    }
  };
  const releaseTensor = tensor => {
    if (tensor && typeof tensor.dispose === 'function' && !released.has(tensor)) {
      released.add(tensor); quiet(() => tensor.dispose());
    }
  };
  const releaseOutput = output => { for (const tensor of Object.values(output ?? {})) releaseTensor(tensor); };
  const releaseModel = value => {
    if (!value || typeof value.dispose !== 'function' || released.has(value)) return;
    released.add(value);
    const disposal = value.dispose();
    quiet(() => disposal); return disposal;
  };
  try {
    scope.check(); const started = clock(config);
    if (typeof config.gpu?.requestAdapter !== 'function') fail('GPU_UNAVAILABLE');
    const adapter = await scope.wait(() => config.gpu.requestAdapter({ powerPreference: 'high-performance' }), 'GPU_UNAVAILABLE');
    const fallback = typeof adapter?.info?.isFallbackAdapter === 'boolean'
      ? adapter.info.isFallbackAdapter : adapter?.isFallbackAdapter;
    if (!adapter || fallback !== false || typeof adapter.requestDevice !== 'function') fail('GPU_UNAVAILABLE');
    const assets = await verifyAssets(config, scope);
    scope.emit('initialize', { completed: 0, total: null, unit, estimated: false });
    const wasmURL=new URL('vendor/transformers/ort-wasm-simd-threaded.jsep.wasm',config.baseURL).href;
    const wasmPin=EMBEDDING_PREPARATION_PINS['ort-wasm-simd-threaded.jsep.wasm'];
    const acceptedPin=assets.assetPins.find(asset=>asset.url===wasmURL),wasmResponse=assets.verified.get(wasmURL);
    if(!acceptedPin||acceptedPin.bytes!==wasmPin.bytes||acceptedPin.sha256!==wasmPin.sha256||!(wasmResponse instanceof Response))fail('ASSET_INTEGRITY_ERROR');
    const wasmBinary=await scope.wait(()=>Response.prototype.arrayBuffer.call(Response.prototype.clone.call(wasmResponse)),'ASSET_INTEGRITY_ERROR');
    if(!(wasmBinary instanceof ArrayBuffer)||wasmBinary.byteLength!==wasmPin.bytes)fail('ASSET_INTEGRITY_ERROR');
    scope.check();
    const library = await scope.wait(() => config.importer(new URL('vendor/transformers/transformers.min.js', config.baseURL).href),
      'EMBEDDING_LOAD_FAILED');
    // This operation owns a fresh worker/library instance. The pinned ORT JSEP
    // backend consumes env.webgpu.adapter, creates its own device with required
    // limits/features, then makes adapter/device readonly. Capture that device
    // at creation; native adapter getters and methods retain their real receiver.
    const requestDevice = (...args) => scope.wait(() => {
      if (closed) fail('EMBEDDING_LOAD_FAILED');
      return Reflect.apply(adapter.requestDevice, adapter, args);
    }, 'GPU_UNAVAILABLE', releaseDevice).then(value => {
      if (closed) { releaseDevice(value); fail('EMBEDDING_LOAD_FAILED'); }
      device = value; scope.watch(value); return value;
    });
    const ownedAdapter = new Proxy(adapter, { get(target, key) {
      if (key === 'requestDevice') return requestDevice;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    configureLibrary(library, config, ownedAdapter, assets.verified, wasmBinary);
    const settings = { revision: EMBEDDING_SPEC.revision, local_files_only: true };
    const tokenizer = await scope.wait(() => library.AutoTokenizer.from_pretrained(EMBEDDING_SPEC.modelId, settings), 'EMBEDDING_LOAD_FAILED');
    if (typeof tokenizer !== 'function') fail('EMBEDDING_LOAD_FAILED');
    const frames = []; let totalTokens = 0;
    for (const text of texts) {
      const frame = tokenFrame(await scope.wait(() => tokenizer(text, {
        padding: false, truncation: false, add_special_tokens: true, return_tensor: false,
      }), 'ENCODER_INPUT_LIMIT'));
      totalTokens += frame.input_ids.length;
      if (totalTokens > EMBEDDING_SPEC.maxTotalTokens) fail('ENCODER_INPUT_LIMIT');
      frames.push(frame);
    }
    model = await scope.wait(() => library.AutoModel.from_pretrained(EMBEDDING_SPEC.modelId, {
      ...settings, device: 'webgpu', dtype: 'fp32',
    }), 'EMBEDDING_LOAD_FAILED', releaseModel);
    if (typeof model !== 'function' || typeof model.dispose !== 'function') fail('EMBEDDING_LOAD_FAILED');
    const rows = [], total = unit === 'tokens' ? totalTokens : frames.length;
    let completed = 0;
    scope.emit('encode', { completed, total, unit, estimated: false });
    for (const frame of frames) {
      const tensors = new Set();
      const own = tensor => { tensors.add(tensor); return tensor; };
      try {
        const inputs = {};
        for (const [key, ids] of Object.entries(frame)) {
          inputs[key] = own(new library.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]));
        }
        const output = await scope.wait(() => model(inputs), 'EMBEDDING_FAILED', releaseOutput);
        for (const tensor of Object.values(output ?? {})) own(tensor);
        const hidden = output?.last_hidden_state;
        validTensor(hidden, [1, frame.input_ids.length, EMBEDDING_SPEC.dimensions]);
        const pooled = own(library.mean_pooling(hidden, inputs.attention_mask));
        validTensor(pooled, [1, EMBEDDING_SPEC.dimensions]);
        if (typeof pooled.normalize !== 'function') fail('INVALID_EMBEDDING');
        const normalized = own(pooled.normalize(2, -1));
        validTensor(normalized, [1, EMBEDDING_SPEC.dimensions]);
        try { rows.push(acceptEmbeddingVectors([Array.from(normalized.data)], 1)[0]); }
        catch { fail('INVALID_EMBEDDING'); }
      } finally { for (const tensor of tensors) releaseTensor(tensor); }
      completed += unit === 'tokens' ? frame.input_ids.length : 1;
      scope.emit('encode', { completed, total, unit, estimated: false });
    }
    let vectors;
    try { vectors = acceptEmbeddingVectors(rows, frames.length); } catch { fail('INVALID_EMBEDDING'); }
    await scope.wait(() => releaseModel(model), 'EMBEDDING_FAILED');
    const elapsedMs = clock(config) - started;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) fail('INVALID_EMBEDDING_CONFIG');
    scope.check();
    return { tokenIds: Object.freeze(frames.map(frame => frame.input_ids)), vectors, totalTokens,
      // These are verified asset-body reads, excluding registry/HTTP overhead
      // and any later SDK transport. They are not a browser traffic capture.
      receipt: Object.freeze({ ...assets.receipt, elapsedMs }) };
  } catch (error) { if (error instanceof EmbeddingRuntimeError) throw error; fail('EMBEDDING_FAILED'); }
  finally {
    closed = true;
    if (model && !released.has(model)) {
      let cleanup; quiet(() => { cleanup = releaseModel(model); });
      try { await scope.wait(() => cleanup, 'EMBEDDING_FAILED'); } catch {}
    }
    scope.close(); releaseDevice(device);
  }
}
