import { EMBEDDING_SPEC, acceptEmbeddingVectors } from './embedding-contract.mjs';
import { projectEmbeddingInput, copyEmbeddingArtifact } from './embedding-source.mjs';
import { rankCandidates } from './retrieval.mjs';

const MESSAGES = Object.freeze({
  INVALID_QUERY_WORKER_CONFIG: 'The query worker configuration is invalid.',
  INVALID_EMBEDDING_CONFIG: 'The embedding configuration is invalid.',
  ENCODER_INPUT_LIMIT: 'The encoder input is invalid or exceeds its token budget.',
  INVALID_EMBEDDING: 'The embedding vectors are invalid.',
  GPU_UNAVAILABLE: 'A non-fallback WebGPU adapter is required.',
  GPU_DEVICE_LOST: 'The WebGPU device was lost.',
  ASSET_INTEGRITY_ERROR: 'The local embedding assets could not be verified.',
  EMBEDDING_LOAD_FAILED: 'The local embedding encoder could not be loaded.',
  EMBEDDING_FAILED: 'The embedding operation failed.',
  INVALID_RETRIEVAL_INPUT: 'The retrieval input is invalid.',
  ABORTED: 'The query operation was cancelled.',
  WORKER_UNAVAILABLE: 'A native query worker is unavailable.',
  WORKER_PROTOCOL_ERROR: 'The query worker protocol was invalid.',
  QUERY_TIMEOUT: 'The query worker exceeded its time budget.',
  QUERY_FAILED: 'The query operation failed.',
});
export class QueryWorkerError extends Error {
  constructor(code) {
    const safe = typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'QUERY_FAILED';
    super(MESSAGES[safe]); this.name = 'QueryWorkerError'; this.code = safe;
  }
}
const fail = code => { throw new QueryWorkerError(code); };
const IDENTITY_KEYS = ['protocolVersion', 'runtimeId', 'operationId', 'documentEpoch', 'operation'];
const EVENT_KEYS = [...IDENTITY_KEYS, 'kind', 'stage', 'seq', 'payload'];
const QUERY_DATA = ['representationId', 'status', 'backend', 'dtype', 'counts', 'receipt'];
const QUERY_KEYS = ['schemaVersion', ...QUERY_DATA, 'representation', 'tokenIds', 'vector'];
const COUNTS_KEYS = ['totalTokens', 'dimensions'];
const RECEIPT_KEYS = ['verifiedBytes', 'networkBytes', 'cacheBytes', 'elapsedMs'];
const RETRIEVAL_DATA = ['sourceSha256', 'representationId', 'status', 'requestedTopK', 'returnedCount', 'queryNorm'];
const RETRIEVAL_KEYS = ['schemaVersion', ...RETRIEVAL_DATA, 'candidates'];
const CANDIDATE_KEYS = ['chunkId', 'ordinal', 'score', 'dotProduct', 'chunkNorm'];
const PASSAGE_KEYS = ['schemaVersion', 'sourceSha256', 'representationId', 'status', 'backend', 'dtype', 'counts', 'receipt', 'representation', 'chunkIds', 'tokenIds', 'vectors'];
const MAX_BYTES = 128 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length
  && Reflect.ownKeys(value).every(key => keys.includes(key));
const positive = value => Number.isSafeInteger(value) && value > 0;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const same = (a, b, keys) => keys.every(key => Object.is(a[key], b[key]));
const fields = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
function snapshot(value, keys) { if (!exact(value, keys)) fail('WORKER_PROTOCOL_ERROR'); return fields(value, keys); }
function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function dense(value, max, expectedLength) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const length = value.length;
  if (!nonnegative(length) || length > max || (expectedLength !== undefined && length !== expectedLength)
      || Reflect.ownKeys(value).length !== length + 1) return false;
  for (let index = 0; index < length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, index);
    if (entry?.enumerable !== true || !Object.hasOwn(entry, 'value')) return false;
  }
  return true;
}
const validQuestion = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
const validTopK = value => positive(value) && value <= EMBEDDING_SPEC.maxChunks;
export function isQueryIdentity(value) {
  return exact(value, IDENTITY_KEYS) && value.protocolVersion === 1 && value.operation === 'query'
    && typeof value.runtimeId === 'string' && value.runtimeId.length <= 256 && value.runtimeId.trim().length > 0
    && typeof value.operationId === 'string' && /^op-[1-9]\d{0,15}$/.test(value.operationId)
    && Number.isSafeInteger(Number(value.operationId.slice(3))) && nonnegative(value.documentEpoch);
}

// Passage reads use their historical receipt; the query attempt owns a separate
// asset-byte total. Snapshot the receipt before passing it to the shared copier.
export function copyQueryPassages(artifact, source) {
  try {
    const owned = snapshot(artifact, PASSAGE_KEYS);
    owned.receipt = snapshot(owned.receipt, RECEIPT_KEYS);
    return copyEmbeddingArtifact(owned, source, owned.receipt.verifiedBytes);
  } catch { fail('WORKER_PROTOCOL_ERROR'); }
}
export function copyQueryCommand(command) {
  try {
    const owned = snapshot(command, ['kind', 'identity', 'question', 'chunkArtifact', 'embeddingArtifact', 'topK']);
    owned.identity = snapshot(owned.identity, IDENTITY_KEYS);
    if (owned.kind !== 'query-candidates' || !isQueryIdentity(owned.identity)
        || !validQuestion(owned.question) || !validTopK(owned.topK)) fail('WORKER_PROTOCOL_ERROR');
    const source = snapshot(owned.chunkArtifact, ['schemaVersion', 'status', 'source', 'counts', 'chunks']);
    source.source = snapshot(source.source, ['sha256']); source.counts = snapshot(source.counts, ['chunks']);
    const chunkCount = source.chunks?.length;
    if (!dense(source.chunks, EMBEDDING_SPEC.maxChunks, chunkCount)) fail('WORKER_PROTOCOL_ERROR');
    const chunks = [];
    for (let index = 0; index < chunkCount; index++) chunks.push(snapshot(source.chunks[index], ['id', 'text']));
    source.chunks = chunks;
    owned.chunkArtifact = projectEmbeddingInput(source);
    owned.embeddingArtifact = copyQueryPassages(owned.embeddingArtifact, owned.chunkArtifact);
    return freeze(owned);
  } catch { fail('WORKER_PROTOCOL_ERROR'); }
}

export function createQueryStageGuard(chunkCount) {
  let stage = 'download', downloadStarted = false, downloadTotal = null, initialized = false;
  let encodeStarted = false, tokenTotal = null, rankStarted = false, completed = 0;
  return {
    get stage() { return stage; }, get downloadTotal() { return downloadTotal; }, get tokenTotal() { return tokenTotal; },
    accept(nextStage, raw) {
      let payload;
      try { payload = snapshot(raw, ['completed', 'total', 'unit', 'estimated']); }
      catch { fail('WORKER_PROTOCOL_ERROR'); }
      if (payload.estimated !== false || !nonnegative(payload.completed)) fail('WORKER_PROTOCOL_ERROR');
      if (nextStage === 'download') {
        if (initialized || payload.unit !== 'bytes' || !positive(payload.total) || payload.total > MAX_BYTES
            || payload.completed > payload.total || (!downloadStarted && payload.completed !== 0)
            || (downloadStarted && (payload.total !== downloadTotal || payload.completed < completed))) fail('WORKER_PROTOCOL_ERROR');
        downloadStarted = true; downloadTotal = payload.total;
      } else if (nextStage === 'initialize') {
        if (!downloadStarted || initialized || completed !== downloadTotal || payload.completed !== 0
            || payload.total !== null || payload.unit !== 'tokens') fail('WORKER_PROTOCOL_ERROR');
        initialized = true;
      } else if (nextStage === 'encode') {
        if (!initialized || rankStarted || payload.unit !== 'tokens' || !positive(payload.total)
            || payload.total < 3 || payload.total > EMBEDDING_SPEC.maxTokens || payload.completed > payload.total
            || (!encodeStarted && payload.completed !== 0)
            || (encodeStarted && (payload.total !== tokenTotal || payload.completed < completed))) fail('WORKER_PROTOCOL_ERROR');
        encodeStarted = true; tokenTotal = payload.total;
      } else if (nextStage === 'rank') {
        if (!encodeStarted || payload.unit !== 'chunks' || payload.total !== chunkCount || payload.completed > chunkCount
            || (!rankStarted && (completed !== tokenTotal || payload.completed !== 0))
            || (rankStarted && payload.completed < completed)) fail('WORKER_PROTOCOL_ERROR');
        rankStarted = true;
      } else fail('WORKER_PROTOCOL_ERROR');
      stage = nextStage; completed = payload.completed; return freeze(payload);
    },
    assertEncoded(tokens) { if (!encodeStarted || rankStarted || completed !== tokenTotal || (tokens !== undefined && tokens !== tokenTotal)) fail('WORKER_PROTOCOL_ERROR'); },
    assertComplete(tokens) { if (!rankStarted || completed !== chunkCount || (tokens !== undefined && tokens !== tokenTotal)) fail('WORKER_PROTOCOL_ERROR'); },
  };
}
function validReceipt(value, downloadTotal) {
  return positive(value.verifiedBytes) && value.verifiedBytes <= MAX_BYTES && value.verifiedBytes === downloadTotal
    && nonnegative(value.networkBytes) && nonnegative(value.cacheBytes) && value.networkBytes + value.cacheBytes === value.verifiedBytes
    && typeof value.elapsedMs === 'number' && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0;
}
function ownedQuery(value, downloadTotal, metadata) {
  value = snapshot(value, QUERY_KEYS);
  value.representation = snapshot(value.representation, Object.keys(EMBEDDING_SPEC));
  value.counts = snapshot(value.counts, COUNTS_KEYS); value.receipt = snapshot(value.receipt, RECEIPT_KEYS);
  const tokenCount = value.tokenIds?.length;
  if (downloadTotal === undefined) downloadTotal = value.receipt.verifiedBytes;
  if (value.schemaVersion !== 1 || value.status !== 'query-embedded-not-retrieved'
      || value.representationId !== EMBEDDING_SPEC.version || !same(value.representation, EMBEDDING_SPEC, Object.keys(EMBEDDING_SPEC))
      || value.backend !== 'webgpu' || value.dtype !== 'fp32' || value.counts.dimensions !== EMBEDDING_SPEC.dimensions
      || !validReceipt(value.receipt, downloadTotal) || !dense(value.tokenIds, EMBEDDING_SPEC.maxTokens, tokenCount)
      || tokenCount < 3 || value.counts.totalTokens !== tokenCount
      || !dense(value.vector, EMBEDDING_SPEC.dimensions, EMBEDDING_SPEC.dimensions)) fail('WORKER_PROTOCOL_ERROR');
  const tokens = [];
  for (let index = 0; index < tokenCount; index++) {
    const token = value.tokenIds[index];
    if (!nonnegative(token) || token > 30521 || (index === 0 && token !== 101)
        || (index === tokenCount - 1 && token !== 102)) fail('WORKER_PROTOCOL_ERROR');
    tokens.push(token);
  }
  value.tokenIds = tokens; value.vector = acceptEmbeddingVectors([value.vector], 1)[0];
  if (metadata !== undefined) {
    const meta = snapshot(metadata, QUERY_DATA); meta.counts = snapshot(meta.counts, COUNTS_KEYS); meta.receipt = snapshot(meta.receipt, RECEIPT_KEYS);
    if (!same(meta, value, QUERY_DATA.slice(0, 4)) || !same(meta.counts, value.counts, COUNTS_KEYS)
        || !same(meta.receipt, value.receipt, RECEIPT_KEYS)) fail('WORKER_PROTOCOL_ERROR');
  }
  return freeze(value);
}
export function copyQueryArtifact(artifact, downloadTotal, metadata) {
  try { if (!positive(downloadTotal) || downloadTotal > MAX_BYTES) fail('WORKER_PROTOCOL_ERROR'); return ownedQuery(artifact, downloadTotal, metadata); }
  catch { fail('WORKER_PROTOCOL_ERROR'); }
}
function queryData(value) { return freeze({ ...fields(value, QUERY_DATA.slice(0, 4)), counts: fields(value.counts, COUNTS_KEYS), receipt: fields(value.receipt, RECEIPT_KEYS) }); }
export function queryReceipt(artifact) {
  try { return queryData(ownedQuery(artifact)); } catch { fail('WORKER_PROTOCOL_ERROR'); }
}
function ownedRetrieval(value) {
  value = snapshot(value, RETRIEVAL_KEYS);
  if (value.schemaVersion !== 1 || value.status !== 'candidates-only' || typeof value.sourceSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.sourceSha256) || value.representationId !== EMBEDDING_SPEC.version || !validTopK(value.requestedTopK)
      || !positive(value.returnedCount) || value.returnedCount > value.requestedTopK || !dense(value.candidates, EMBEDDING_SPEC.maxChunks, value.returnedCount)
      || typeof value.queryNorm !== 'number' || !Number.isFinite(value.queryNorm)
      || Math.abs(value.queryNorm - 1) > 1e-4) fail('WORKER_PROTOCOL_ERROR');
  const candidates = [];
  for (let index = 0; index < value.returnedCount; index++) {
    const candidate = snapshot(value.candidates[index], CANDIDATE_KEYS);
    if (typeof candidate.chunkId !== 'string' || !candidate.chunkId.trim() || candidate.chunkId.length > 1024
        || !nonnegative(candidate.ordinal) || candidate.ordinal >= EMBEDDING_SPEC.maxChunks
        || ['score', 'dotProduct', 'chunkNorm'].some(key => typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key]))
        || Math.abs(candidate.chunkNorm - 1) > 1e-4) fail('WORKER_PROTOCOL_ERROR');
    candidates.push(candidate);
  }
  value.candidates = candidates;
  return freeze(value);
}
export function queryResultReceipt(artifact) {
  try {
    const value = snapshot(artifact, ['query', 'retrieval']), retrieval = ownedRetrieval(value.retrieval);
    return freeze({ query: queryReceipt(value.query), retrieval: fields(retrieval, RETRIEVAL_DATA) });
  } catch { fail('WORKER_PROTOCOL_ERROR'); }
}
// Recompute the pure exact ranker instead of maintaining a second cosine scan.
// Every submitted candidate field and its position must equal that owned scan.
export function copyQueryResult(artifact, source, passages, topK, downloadTotal, metadata) {
  try {
    const value = snapshot(artifact, ['query', 'retrieval']);
    const meta = metadata === undefined ? undefined : snapshot(metadata, ['query', 'retrieval']);
    const query = copyQueryArtifact(value.query, downloadTotal, meta?.query);
    const submitted = ownedRetrieval(value.retrieval);
    const retrieval = rankCandidates(source, passages, { representationId: query.representationId, representation: query.representation, vector: query.vector }, { topK });
    if (!same(submitted, retrieval, ['schemaVersion', ...RETRIEVAL_DATA])
        || submitted.candidates.some((candidate, index) => !same(candidate, retrieval.candidates[index], CANDIDATE_KEYS))) fail('WORKER_PROTOCOL_ERROR');
    if (meta !== undefined && !same(snapshot(meta.retrieval, RETRIEVAL_DATA), retrieval, RETRIEVAL_DATA)) fail('WORKER_PROTOCOL_ERROR');
    return freeze({ query, retrieval });
  } catch { fail('WORKER_PROTOCOL_ERROR'); }
}

export async function queryInWorker(chunkArtifact, embeddingArtifact, question, options = {}) {
  const allowed = ['topK', 'identity', 'workerFactory', 'onProgress', 'signal', 'readyTimeoutMs', 'workTimeoutMs'];
  let topK, onProgress, signal, signalAdd, signalRemove, readyTimeoutMs, workTimeoutMs, workerFactory, ownedIdentity, aborted;
  try {
    if (!validQuestion(question) || !record(options) || Reflect.ownKeys(options).some(key => !allowed.includes(key))) fail('INVALID_QUERY_WORKER_CONFIG');
    const { topK: configuredTopK = 5, identity, workerFactory: configuredFactory,
      onProgress: configuredProgress, signal: configuredSignal, readyTimeoutMs: ready = 10000, workTimeoutMs: work = 120000 } = options;
    topK = configuredTopK; onProgress = configuredProgress; signal = configuredSignal; readyTimeoutMs = ready; workTimeoutMs = work;
    ownedIdentity = snapshot(identity, IDENTITY_KEYS);
    workerFactory = configuredFactory === undefined ? url => new globalThis.Worker(url, { type: 'module' }) : configuredFactory;
    aborted = signal?.aborted;
    if (signal !== undefined) { signalAdd = signal?.addEventListener; signalRemove = signal?.removeEventListener; }
    if (!validTopK(topK) || !isQueryIdentity(ownedIdentity) || typeof workerFactory !== 'function'
        || !positive(ready) || ready > 2147483647 || !positive(work) || work > 2147483647
        || (onProgress !== undefined && typeof onProgress !== 'function')
        || (signal !== undefined && (typeof aborted !== 'boolean' || typeof signalAdd !== 'function' || typeof signalRemove !== 'function'))) fail('INVALID_QUERY_WORKER_CONFIG');
    ownedIdentity = freeze(ownedIdentity);
  } catch { fail('INVALID_QUERY_WORKER_CONFIG'); }
  if (aborted) fail('ABORTED');
  let source;
  try { source = projectEmbeddingInput(chunkArtifact); } catch { fail('INVALID_EMBEDDING_CONFIG'); }
  const passages = copyQueryPassages(embeddingArtifact, source);
  return new Promise((resolve, reject) => {
    let worker, methods, terminateWorker, settled = false, ready = false, receiving = false, lastSeq = 0, readyTimer, workTimer;
    const stages = createQueryStageGuard(source.counts.chunks), listeners = new Map();
    const onAbort = () => finish(new QueryWorkerError('ABORTED'));
    function cleanup() {
      clearTimeout(readyTimer); clearTimeout(workTimer);
      try { signalRemove?.call(signal, 'abort', onAbort); } catch {}
      if (worker) {
        for (const [type, listener] of listeners) { try { methods?.removeEventListener.call(worker, type, listener); } catch {} }
        try { terminateWorker?.call(worker); } catch {}
      }
    }
    function finish(error, result) { if (settled) return; settled = true; cleanup(); if (error) reject(error); else resolve(result); }
    const protocolError = () => finish(new QueryWorkerError('WORKER_PROTOCOL_ERROR'));
    function receive(message) {
      if (settled) return;
      if (receiving) { protocolError(); return; }
      receiving = true;
      try {
        const packet = message.data;
        if (!ready) {
          const announcement = snapshot(packet, ['kind', 'protocolVersion', 'workerVersion']);
          if (announcement.kind !== 'query-ready' || announcement.protocolVersion !== 1 || announcement.workerVersion !== 'query-v1') fail('WORKER_PROTOCOL_ERROR');
          if (settled) return;
          ready = true; clearTimeout(readyTimer); workTimer = setTimeout(() => finish(new QueryWorkerError('QUERY_TIMEOUT')), workTimeoutMs);
          methods.postMessage.call(worker, { kind: 'query-candidates', identity: ownedIdentity, question, chunkArtifact: source, embeddingArtifact: passages, topK }); return;
        }
        if (!record(packet)) fail('WORKER_PROTOCOL_ERROR');
        const event = snapshot(packet.event, EVENT_KEYS);
        if (!same(event, ownedIdentity, IDENTITY_KEYS) || !positive(event.seq) || event.seq <= lastSeq) fail('WORKER_PROTOCOL_ERROR');
        const eventCopy = payload => freeze({ ...ownedIdentity, kind: event.kind, stage: event.stage, seq: event.seq, payload });
        if (event.kind === 'progress') {
          if (!exact(packet, ['event']) || event.seq === Number.MAX_SAFE_INTEGER) fail('WORKER_PROTOCOL_ERROR');
          const payload = stages.accept(event.stage, event.payload); if (settled) return; lastSeq = event.seq; onProgress?.(eventCopy(payload));
        } else if (event.kind === 'error') {
          if (!exact(packet, ['event']) || event.stage !== stages.stage) fail('WORKER_PROTOCOL_ERROR');
          const payload = snapshot(event.payload, ['code', 'message']);
          if (typeof payload.code !== 'string' || !Object.hasOwn(MESSAGES, payload.code) || payload.message !== MESSAGES[payload.code]) fail('WORKER_PROTOCOL_ERROR');
          if (settled) return; lastSeq = event.seq; finish(new QueryWorkerError(payload.code));
        } else if (event.kind === 'result') {
          if (!exact(packet, ['event', 'artifact']) || event.stage !== 'rank') fail('WORKER_PROTOCOL_ERROR');
          stages.assertComplete(); const payload = snapshot(event.payload, ['data']);
          const artifact = copyQueryResult(packet.artifact, source, passages, topK, stages.downloadTotal, payload.data);
          stages.assertComplete(artifact.query.counts.totalTokens); if (settled) return;
          lastSeq = event.seq; finish(null, freeze({ event: eventCopy({ data: queryResultReceipt(artifact) }), artifact }));
        } else fail('WORKER_PROTOCOL_ERROR');
      } catch { protocolError(); } finally { receiving = false; }
    }
    try {
      worker = workerFactory(new URL('./query.worker.mjs', import.meta.url));
      if (!worker) { finish(new QueryWorkerError('WORKER_UNAVAILABLE')); return; }
      // Termination remains available even if a later method getter fails.
      terminateWorker = worker.terminate;
      methods = fields(worker, ['addEventListener', 'removeEventListener', 'postMessage']);
      if (typeof terminateWorker !== 'function' || Object.values(methods).some(method => typeof method !== 'function')) { finish(new QueryWorkerError('WORKER_UNAVAILABLE')); return; }
      listeners.set('message', receive); listeners.set('error', () => finish(new QueryWorkerError('QUERY_FAILED'))); listeners.set('messageerror', protocolError);
      for (const [type, listener] of listeners) { methods.addEventListener.call(worker, type, listener); if (settled) return; }
      signalAdd?.call(signal, 'abort', onAbort, { once: true }); if (settled) return;
      const nowAborted = signal?.aborted;
      if (settled) return;
      if (nowAborted) { onAbort(); return; }
      if (!ready) readyTimer = setTimeout(() => finish(new QueryWorkerError('QUERY_TIMEOUT')), readyTimeoutMs);
    } catch { finish(new QueryWorkerError('WORKER_UNAVAILABLE')); }
  });
}
