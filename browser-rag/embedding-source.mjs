import { EMBEDDING_SPEC, acceptEmbeddingVectors } from './embedding-contract.mjs';

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
  INVALID_EMBEDDING_WORKER_CONFIG: 'The embedding worker configuration is invalid.',
  WORKER_UNAVAILABLE: 'A native embedding worker is unavailable.',
  WORKER_PROTOCOL_ERROR: 'The embedding worker protocol was invalid.',
  EMBEDDING_TIMEOUT: 'The embedding worker exceeded its time budget.',
});
export class EmbeddingWorkerError extends Error {
  constructor(code) {
    const safe = typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'EMBEDDING_FAILED';
    super(MESSAGES[safe]); this.name = 'EmbeddingWorkerError'; this.code = safe;
  }
}
const fail = code => { throw new EmbeddingWorkerError(code); };
const IDENTITY_KEYS = ['protocolVersion', 'runtimeId', 'operationId', 'documentEpoch', 'operation'];
const EVENT_KEYS = [...IDENTITY_KEYS, 'kind', 'stage', 'seq', 'payload'];
const DATA_KEYS = ['sourceSha256', 'representationId', 'status', 'backend', 'dtype', 'counts', 'receipt'];
const COUNTS_KEYS = ['chunks', 'totalTokens', 'dimensions'];
const RECEIPT_KEYS = ['verifiedBytes', 'networkBytes', 'cacheBytes', 'elapsedMs'];
const ARTIFACT_KEYS = ['schemaVersion', ...DATA_KEYS, 'representation', 'chunkIds', 'tokenIds', 'vectors'];
const MAX_BYTES = 128 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length
  && Reflect.ownKeys(value).every(key => keys.includes(key));
const positive = value => Number.isSafeInteger(value) && value > 0;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const same = (a, b, keys) => keys.every(key => a[key] === b[key]);
function dense(value, max, length) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (length === undefined) length = value.length;
  if (!nonnegative(length) || length > max || Reflect.ownKeys(value).length !== length + 1) return false;
  for (let i = 0; i < length; i++) {
    const entry = Object.getOwnPropertyDescriptor(value, i);
    if (entry?.enumerable !== true || !Object.hasOwn(entry, 'value')) return false;
  }
  return true;
}
function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function copyFields(value, keys) { return Object.fromEntries(keys.map(key => [key, value[key]])); }

export function isEmbeddingIdentity(value) {
  return exact(value, IDENTITY_KEYS) && value.protocolVersion === 1 && value.operation === 'embed'
    && typeof value.runtimeId === 'string' && value.runtimeId.length <= 256 && value.runtimeId.trim().length > 0
    && typeof value.operationId === 'string' && /^op-[1-9]\d{0,15}$/.test(value.operationId)
    && Number.isSafeInteger(Number(value.operationId.slice(3)))
    && nonnegative(value.documentEpoch);
}

// Both channel endpoints use the same bounded projection. A rich chunk artifact
// may contain attribution/geometry, but only encoder input crosses this channel.
export function projectEmbeddingInput(artifact) {
  try {
    if (!record(artifact)) fail('INVALID_EMBEDDING_CONFIG');
    const { schemaVersion, status, source, counts, chunks: sourceChunks } = artifact;
    if (schemaVersion !== 1 || status !== 'chunked-not-embedded' || !record(source) || !record(counts)) fail('INVALID_EMBEDDING_CONFIG');
    const sha256 = source.sha256, chunkCount = counts.chunks;
    if (!Array.isArray(sourceChunks)) fail('INVALID_EMBEDDING_CONFIG');
    const length = sourceChunks.length;
    if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)
        || !positive(length) || length > EMBEDDING_SPEC.maxChunks || chunkCount !== length
        || !dense(sourceChunks, EMBEDDING_SPEC.maxChunks, length)) fail('INVALID_EMBEDDING_CONFIG');
    const ids = new Set(), chunks = [];
    // Read only bounded indices; inherited array methods belong to the caller.
    for (let index = 0; index < length; index++) {
      const chunk = sourceChunks[index];
      if (!record(chunk)) fail('INVALID_EMBEDDING_CONFIG');
      const { id, text } = chunk;
      if (typeof id !== 'string' || !id.trim() || id.length > 1024
          || ids.has(id) || typeof text !== 'string' || !text.trim()
          || text.length > 4096) fail('INVALID_EMBEDDING_CONFIG');
      ids.add(id); chunks.push({ id, text });
    }
    return freeze({ schemaVersion: 1, status: 'chunked-not-embedded', source: { sha256 },
      counts: { chunks: chunks.length }, chunks });
  } catch { fail('INVALID_EMBEDDING_CONFIG'); }
}

export function isEmbeddingCommand(command) {
  try {
    const value = command?.chunkArtifact;
    return exact(command, ['kind', 'identity', 'chunkArtifact']) && command.kind === 'embed-chunks'
      && isEmbeddingIdentity(command.identity)
      && exact(value, ['schemaVersion', 'status', 'source', 'counts', 'chunks'])
      && exact(value.source, ['sha256']) && exact(value.counts, ['chunks'])
      && dense(value.chunks, EMBEDDING_SPEC.maxChunks) && value.chunks.every(chunk => exact(chunk, ['id', 'text']))
      && Boolean(projectEmbeddingInput(value));
  } catch { return false; }
}

// The controller vocabulary is intentionally generic. This transport owns the
// stronger embedding-specific stage/order/receipt contract on both endpoints.
export function createEmbeddingStageGuard(chunkCount) {
  let stage = 'download', started = false, total = null, completed = 0;
  let downloadTotal = null, initialized = false, encodeStarted = false;
  return {
    get stage() { return stage; },
    get downloadTotal() { return downloadTotal; },
    accept(nextStage, payload) {
      try {
        if (!exact(payload, ['completed', 'total', 'unit', 'estimated'])) fail('WORKER_PROTOCOL_ERROR');
        payload = copyFields(payload, ['completed', 'total', 'unit', 'estimated']);
      } catch { fail('WORKER_PROTOCOL_ERROR'); }
      if (payload.estimated !== false
          || !nonnegative(payload.completed)) fail('WORKER_PROTOCOL_ERROR');
      if (nextStage === 'download') {
        if (initialized || encodeStarted || payload.unit !== 'bytes' || !positive(payload.total)
            || payload.total > MAX_BYTES || payload.completed > payload.total
            || (!started && payload.completed !== 0)
            || (started && (payload.total !== total || payload.completed < completed))) fail('WORKER_PROTOCOL_ERROR');
        started = true; stage = nextStage; total = downloadTotal = payload.total; completed = payload.completed;
      } else if (nextStage === 'initialize') {
        if (!started || initialized || completed !== downloadTotal || payload.completed !== 0
            || payload.total !== null || payload.unit !== 'chunks') fail('WORKER_PROTOCOL_ERROR');
        initialized = true; stage = nextStage; completed = 0; total = null;
      } else if (nextStage === 'encode') {
        if (!initialized || payload.unit !== 'chunks' || payload.total !== chunkCount
            || payload.completed > chunkCount || (!encodeStarted && payload.completed !== 0)
            || (encodeStarted && payload.completed < completed)) fail('WORKER_PROTOCOL_ERROR');
        encodeStarted = true; stage = nextStage; completed = payload.completed; total = chunkCount;
      } else fail('WORKER_PROTOCOL_ERROR');
      return freeze(copyFields(payload, ['completed', 'total', 'unit', 'estimated']));
    },
    assertComplete() { if (!encodeStarted || completed !== chunkCount) fail('WORKER_PROTOCOL_ERROR'); },
  };
}

function validReceipt(receipt, downloadTotal) {
  return exact(receipt, RECEIPT_KEYS) && positive(receipt.verifiedBytes) && receipt.verifiedBytes <= MAX_BYTES
    && receipt.verifiedBytes === downloadTotal && nonnegative(receipt.networkBytes) && nonnegative(receipt.cacheBytes)
    && receipt.networkBytes + receipt.cacheBytes === receipt.verifiedBytes
    && typeof receipt.elapsedMs === 'number' && Number.isFinite(receipt.elapsedMs) && receipt.elapsedMs >= 0;
}
export function embeddingReceipt(artifact) {
  return freeze({ ...copyFields(artifact, DATA_KEYS.slice(0, 5)), counts: copyFields(artifact.counts, COUNTS_KEYS),
    receipt: copyFields(artifact.receipt, RECEIPT_KEYS) });
}

// Preflight the known shape and budgets before copying large arrays. Each
// copied value is validated from that same read, without normalization, token
// repair, truncation or output relabeling on the main thread.
export function copyEmbeddingArtifact(artifact, source, downloadTotal, metadata) {
  try {
    const count = source.counts.chunks;
    const snapshot = (value, keys) => {
      if (!exact(value, keys)) fail('WORKER_PROTOCOL_ERROR');
      return copyFields(value, keys);
    };
    artifact = snapshot(artifact, ARTIFACT_KEYS);
    artifact.representation = snapshot(artifact.representation, Object.keys(EMBEDDING_SPEC));
    artifact.counts = snapshot(artifact.counts, COUNTS_KEYS);
    artifact.receipt = snapshot(artifact.receipt, RECEIPT_KEYS);
    if (metadata !== undefined) {
      metadata = snapshot(metadata, DATA_KEYS);
      metadata.counts = snapshot(metadata.counts, COUNTS_KEYS);
      metadata.receipt = snapshot(metadata.receipt, RECEIPT_KEYS);
    }
    if (artifact.schemaVersion !== 1 || artifact.status !== 'embedded-not-retrieved'
        || artifact.sourceSha256 !== source.source.sha256 || artifact.representationId !== EMBEDDING_SPEC.version
        || !exact(artifact.representation, Object.keys(EMBEDDING_SPEC))
        || !same(artifact.representation, EMBEDDING_SPEC, Object.keys(EMBEDDING_SPEC))
        || artifact.backend !== 'webgpu' || artifact.dtype !== 'fp32'
        || !exact(artifact.counts, COUNTS_KEYS) || artifact.counts.chunks !== count
        || artifact.counts.dimensions !== EMBEDDING_SPEC.dimensions
        || !validReceipt(artifact.receipt, downloadTotal)
        || !dense(artifact.chunkIds, count) || artifact.chunkIds.length !== count
        || !dense(artifact.tokenIds, count) || artifact.tokenIds.length !== count
        || !dense(artifact.vectors, count) || artifact.vectors.length !== count) fail('WORKER_PROTOCOL_ERROR');
    const tokenRows = [], vectorRows = [];
    let tokens = 0;
    for (let index = 0; index < count; index++) {
      const row = artifact.tokenIds[index], length = row?.length;
      if (!dense(row, EMBEDDING_SPEC.maxTokens) || !positive(length) || length < 3
          || length > EMBEDDING_SPEC.maxTokens) fail('WORKER_PROTOCOL_ERROR');
      tokenRows.push({ row, length }); tokens += length;
    }
    if (tokens > EMBEDDING_SPEC.maxTotalTokens || artifact.counts.totalTokens !== tokens) fail('WORKER_PROTOCOL_ERROR');
    for (let index = 0; index < count; index++) {
      const row = artifact.vectors[index];
      if (!dense(row, EMBEDDING_SPEC.dimensions) || row.length !== EMBEDDING_SPEC.dimensions) fail('WORKER_PROTOCOL_ERROR');
      vectorRows.push(row);
    }
    if (metadata !== undefined && (!exact(metadata, DATA_KEYS)
        || !same(metadata, artifact, DATA_KEYS.slice(0, 5)) || !exact(metadata.counts, COUNTS_KEYS)
        || !same(metadata.counts, artifact.counts, COUNTS_KEYS) || !exact(metadata.receipt, RECEIPT_KEYS)
        || !same(metadata.receipt, artifact.receipt, RECEIPT_KEYS))) fail('WORKER_PROTOCOL_ERROR');
    const chunkIds = [], tokenIds = [];
    for (let index = 0; index < count; index++) {
      const id = artifact.chunkIds[index];
      if (id !== source.chunks[index].id) fail('WORKER_PROTOCOL_ERROR');
      chunkIds.push(id);
      const { row, length } = tokenRows[index], copied = [];
      for (let token = 0; token < length; token++) {
        const tokenId = row[token];
        if (!nonnegative(tokenId) || tokenId > 30521 || (token === 0 && tokenId !== 101)
            || (token === length - 1 && tokenId !== 102)) fail('WORKER_PROTOCOL_ERROR');
        copied.push(tokenId);
      }
      tokenIds.push(copied);
    }
    // Contract validation copies each numerical component from its validated
    // read and accepts only unit vectors, without retaining SDK tensor buffers.
    const vectors = acceptEmbeddingVectors(vectorRows, count);
    return freeze({ schemaVersion: 1, ...embeddingReceipt(artifact), representation: { ...EMBEDDING_SPEC },
      chunkIds, tokenIds, vectors });
  } catch { fail('WORKER_PROTOCOL_ERROR'); }
}

// Each request creates and terminates a fresh SDK realm, even after successful
// work. The locked ORT environment is readonly and must never be reused here.
export async function embedInWorker(chunkArtifact, options = {}) {
  const allowed = ['identity', 'workerFactory', 'onProgress', 'signal', 'readyTimeoutMs', 'workTimeoutMs'];
  const timeoutValid = value => positive(value) && value <= 2147483647;
  let onProgress, signal, readyTimeoutMs, workTimeoutMs, workerFactory, ownedIdentity, aborted;
  try {
    if (!record(options) || Reflect.ownKeys(options).some(key => !allowed.includes(key))) fail('INVALID_EMBEDDING_WORKER_CONFIG');
    const { identity, workerFactory: configuredFactory, onProgress: configuredProgress, signal: configuredSignal,
      readyTimeoutMs: configuredReadyTimeout = 10000, workTimeoutMs: configuredWorkTimeout = 120000 } = options;
    onProgress = configuredProgress; signal = configuredSignal;
    readyTimeoutMs = configuredReadyTimeout; workTimeoutMs = configuredWorkTimeout;
    workerFactory = configuredFactory === undefined
      ? url => new globalThis.Worker(url, { type: 'module' }) : configuredFactory;
    if (!exact(identity, IDENTITY_KEYS)) fail('INVALID_EMBEDDING_WORKER_CONFIG');
    ownedIdentity = copyFields(identity, IDENTITY_KEYS);
    aborted = signal?.aborted;
    if (!isEmbeddingIdentity(ownedIdentity) || typeof workerFactory !== 'function' || !timeoutValid(readyTimeoutMs) || !timeoutValid(workTimeoutMs)
        || (onProgress !== undefined && typeof onProgress !== 'function')
        || (signal !== undefined && (typeof aborted !== 'boolean'
          || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))) fail('INVALID_EMBEDDING_WORKER_CONFIG');
    ownedIdentity = freeze(ownedIdentity);
  } catch { fail('INVALID_EMBEDDING_WORKER_CONFIG'); }
  if (aborted) fail('ABORTED');
  const source = projectEmbeddingInput(chunkArtifact);
  return new Promise((resolve, reject) => {
    let worker, settled = false, ready = false, lastSeq = 0, readyTimer, workTimer;
    const stages = createEmbeddingStageGuard(source.counts.chunks), listeners = new Map();
    const onAbort = () => finish(new EmbeddingWorkerError('ABORTED'));
    function cleanup() {
      clearTimeout(readyTimer); clearTimeout(workTimer);
      try { signal?.removeEventListener('abort', onAbort); } catch { /* safe best effort */ }
      if (worker) {
        for (const [type, listener] of listeners) { try { worker.removeEventListener(type, listener); } catch { /* safe best effort */ } }
        try { worker.terminate(); } catch { /* native diagnostics never cross this boundary */ }
      }
    }
    function finish(error, result) {
      if (settled) return;
      settled = true; cleanup(); // Revoke commit permission BEFORE terminate hooks.
      if (error) reject(error); else resolve(result);
    }
    const protocolError = () => finish(new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR'));
    function receive(message) {
      if (settled) return;
      try {
        const packet = message.data;
        if (!ready) {
          if (!exact(packet, ['kind', 'protocolVersion', 'workerVersion']) || packet.kind !== 'embedding-ready'
              || packet.protocolVersion !== 1 || packet.workerVersion !== 'embedding-v1') fail('WORKER_PROTOCOL_ERROR');
          ready = true; clearTimeout(readyTimer);
          workTimer = setTimeout(() => finish(new EmbeddingWorkerError('EMBEDDING_TIMEOUT')), workTimeoutMs);
          worker.postMessage({ kind: 'embed-chunks', identity: ownedIdentity, chunkArtifact: source }); return;
        }
        const rawEvent = packet?.event;
        if (!exact(rawEvent, EVENT_KEYS)) fail('WORKER_PROTOCOL_ERROR');
        const event = copyFields(rawEvent, EVENT_KEYS);
        if (!same(event, ownedIdentity, IDENTITY_KEYS) || !positive(event.seq) || event.seq <= lastSeq) fail('WORKER_PROTOCOL_ERROR');
        const eventCopy = (payload) => freeze({ ...ownedIdentity, kind: event.kind, stage: event.stage, seq: event.seq, payload });
        if (event.kind === 'progress') {
          if (!exact(packet, ['event']) || event.seq === Number.MAX_SAFE_INTEGER) fail('WORKER_PROTOCOL_ERROR');
          const payload = stages.accept(event.stage, event.payload); lastSeq = event.seq;
          onProgress?.(eventCopy(payload));
        } else if (event.kind === 'error') {
          if (!exact(packet, ['event']) || event.stage !== stages.stage || !exact(event.payload, ['code', 'message'])) fail('WORKER_PROTOCOL_ERROR');
          const payload = copyFields(event.payload, ['code', 'message']);
          if (typeof payload.code !== 'string' || !Object.hasOwn(MESSAGES, payload.code)
              || payload.message !== MESSAGES[payload.code]) fail('WORKER_PROTOCOL_ERROR');
          lastSeq = event.seq; finish(new EmbeddingWorkerError(payload.code));
        } else if (event.kind === 'result') {
          if (!exact(packet, ['event', 'artifact']) || event.stage !== 'encode' || !exact(event.payload, ['data'])) fail('WORKER_PROTOCOL_ERROR');
          stages.assertComplete();
          const artifact = copyEmbeddingArtifact(packet.artifact, source, stages.downloadTotal, event.payload.data);
          lastSeq = event.seq; finish(null, freeze({ event: eventCopy({ data: embeddingReceipt(artifact) }), artifact }));
        } else fail('WORKER_PROTOCOL_ERROR');
      } catch { protocolError(); }
    }
    try {
      worker = workerFactory(new URL('./embedding.worker.mjs', import.meta.url));
      if (!worker || ['addEventListener', 'removeEventListener', 'postMessage', 'terminate'].some(key => typeof worker[key] !== 'function')) {
        finish(new EmbeddingWorkerError('WORKER_UNAVAILABLE')); return;
      }
      listeners.set('message', receive);
      listeners.set('error', () => finish(new EmbeddingWorkerError('EMBEDDING_FAILED')));
      listeners.set('messageerror', protocolError);
      for (const [type, listener] of listeners) worker.addEventListener(type, listener);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      readyTimer = setTimeout(() => finish(new EmbeddingWorkerError('EMBEDDING_TIMEOUT')), readyTimeoutMs);
    } catch { finish(new EmbeddingWorkerError('WORKER_UNAVAILABLE')); }
  });
}
