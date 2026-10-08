const MESSAGES = Object.freeze({
  INVALID_COMPUTE_CONFIG: 'The computation configuration is invalid.',
  WORKER_UNAVAILABLE: 'A native computation worker is unavailable.',
  WORKER_PROTOCOL_ERROR: 'The computation worker protocol was invalid.',
  COMPUTE_TIMEOUT: 'The computation worker exceeded its time budget.',
  ABORTED: 'The computation was cancelled.',
  INVALID_SOURCE: 'The extracted source record is invalid.',
  INVALID_CONFIG: 'The chunking configuration is invalid.',
  CHUNK_LIMIT: 'The chunked output exceeds its configured budget.',
  EMPTY_SOURCE: 'The source contains no selectable nonblank text.',
  COMPUTE_FAILED: 'The computation failed safely.',
});
const IDENTITY_KEYS = ['protocolVersion', 'runtimeId', 'operationId', 'documentEpoch', 'operation'];
const EVENT_KEYS = [...IDENTITY_KEYS, 'kind', 'stage', 'seq', 'payload'];
const SOURCE_KEYS = ['sha256', 'name', 'size'];
const PARSER_KEYS = ['name', 'version', 'policyVersion', 'disableNormalization'];
const COUNTS_KEYS = ['chunks', 'outputUtf16', 'fragments'];
const DEFAULTS = Object.freeze({ maxChunkUtf16: 512, overlapUtf16: 64,
  maxChunks: 10000, maxOutputUtf16: 4000000, maxFragments: 200000 });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length
  && Reflect.ownKeys(value).every(key => keys.includes(key));
const positive = value => Number.isSafeInteger(value) && value > 0;
const boundedText = (value, limit) => typeof value === 'string' && value.length <= limit;
const fail = code => { throw new ComputeError(code); };

export class ComputeError extends Error {
  constructor(code) {
    const safe = typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'COMPUTE_FAILED';
    super(MESSAGES[safe]); this.name = 'ComputeError'; this.code = safe;
  }
}

// Shared schema guard only. No controller is created here: the PDF session owns
// that state. These are trusted same-origin structured-clone records, not a
// sandbox for hostile object getters or proxies.
export function isComputeIdentity(value) {
  return exact(value, IDENTITY_KEYS) && value.protocolVersion === 1 && value.operation === 'ingest'
    && boundedText(value.runtimeId, 256) && value.runtimeId.trim().length > 0
    && typeof value.operationId === 'string' && /^op-[1-9]\d{0,15}$/.test(value.operationId)
    && Number.isSafeInteger(Number(value.operationId.slice(3)))
    && Number.isSafeInteger(value.documentEpoch) && value.documentEpoch >= 0;
}

function chunkConfig(options) {
  if (!record(options) || Reflect.ownKeys(options).some(key => !Object.hasOwn(DEFAULTS, key))) fail('INVALID_CONFIG');
  const config = { ...DEFAULTS };
  for (const key of Reflect.ownKeys(options)) config[key] = options[key];
  if (!Number.isSafeInteger(config.maxChunkUtf16) || config.maxChunkUtf16 < 2 || config.maxChunkUtf16 > 4096
      || !Number.isSafeInteger(config.overlapUtf16) || config.overlapUtf16 < 0 || config.overlapUtf16 >= config.maxChunkUtf16
      || ['maxChunks', 'maxOutputUtf16', 'maxFragments'].some(key => !positive(config[key]) || config[key] > DEFAULTS[key])) fail('INVALID_CONFIG');
  return config;
}

function sameFields(a, b, fields) { return fields.every(key => a[key] === b[key]); }
function dense(array, maximum) {
  if (!Array.isArray(array) || array.length > maximum || Reflect.ownKeys(array).length !== array.length + 1) return false;
  for (let index = 0; index < array.length; index++) if (!Object.hasOwn(array, index)) return false;
  return true;
}

// Numeric attribution coordinates only: no page string or chunk window is
// constructed here. Empty items retain their indices but own no text run and
// introduce no authored separator, exactly as the accepted chunker contract.
function pageCoordinates(page) {
  let length = 0, hasRun = false;
  const itemStarts = [], separators = new Set();
  for (const item of page.textItems) {
    if (item.text.length === 0) { itemStarts.push(null); continue; }
    if (hasRun) { separators.add(length); length++; }
    itemStarts.push(length); length += item.text.length; hasRun = true;
  }
  return { length, itemStarts, separators };
}

// Walk the known finite artifact schema before copying/freezing it. This checks
// attribution and receipts; it deliberately does not rechunk/join pages or run
// chunkSource on the main thread. The worker remains responsible for windows.
function copyArtifact(artifact, source, config, receipt) {
  if (!exact(artifact, ['schemaVersion', 'status', 'source', 'parser', 'numPages', 'workerMode', 'chunker', 'counts', 'chunks'])
      || artifact.schemaVersion !== 1 || artifact.status !== 'chunked-not-embedded'
      || !exact(artifact.source, SOURCE_KEYS) || !sameFields(artifact.source, source.source, SOURCE_KEYS)
      || !exact(artifact.parser, PARSER_KEYS) || !sameFields(artifact.parser, source.parser, PARSER_KEYS)
      || artifact.numPages !== source.numPages || artifact.workerMode !== source.workerMode
      || !exact(artifact.chunker, ['version', 'maxChunkUtf16', 'overlapUtf16', 'separator', 'order'])
      || artifact.chunker.version !== 'page-parser-order-v1' || artifact.chunker.maxChunkUtf16 !== config.maxChunkUtf16
      || artifact.chunker.overlapUtf16 !== config.overlapUtf16 || artifact.chunker.separator !== '\n'
      || artifact.chunker.order !== 'parser-item-order' || !exact(artifact.counts, COUNTS_KEYS)
      || !sameFields(artifact.counts, receipt.counts, COUNTS_KEYS)
      || !dense(artifact.chunks, config.maxChunks) || artifact.chunks.length !== artifact.counts.chunks
      || !positive(artifact.counts.chunks) || !positive(artifact.counts.outputUtf16) || !positive(artifact.counts.fragments)
      || artifact.counts.outputUtf16 > config.maxOutputUtf16 || artifact.counts.fragments > config.maxFragments) fail('WORKER_PROTOCOL_ERROR');
  const coordinates = source.pages.map(pageCoordinates);
  let outputUtf16 = 0, fragments = 0, previousPage = 0, previousStart = -1;
  for (const chunk of artifact.chunks) {
    if (!exact(chunk, ['id', 'physicalPageNumber', 'pageLabel', 'startUtf16', 'endUtf16', 'text', 'segments'])
        || !positive(chunk.physicalPageNumber) || chunk.physicalPageNumber > source.numPages
        || chunk.physicalPageNumber < previousPage || !Number.isSafeInteger(chunk.startUtf16) || chunk.startUtf16 < 0
        || !Number.isSafeInteger(chunk.endUtf16) || chunk.endUtf16 <= chunk.startUtf16
        || !boundedText(chunk.text, config.maxChunkUtf16) || chunk.text.length !== chunk.endUtf16 - chunk.startUtf16
        || !dense(chunk.segments, config.maxFragments - fragments)) fail('WORKER_PROTOCOL_ERROR');
    const page = source.pages[chunk.physicalPageNumber - 1];
    const position = coordinates[chunk.physicalPageNumber - 1];
    if (!page || page.physicalPageNumber !== chunk.physicalPageNumber || page.pageLabel !== chunk.pageLabel
        || page.status !== 'text' || chunk.endUtf16 > position.length
        || (chunk.physicalPageNumber === previousPage && chunk.startUtf16 <= previousStart)
        || chunk.id !== `${source.source.sha256}/pdfjs-${source.parser.version}/${source.parser.policyVersion}`
          + `/page-parser-order-v1/m${config.maxChunkUtf16}/o${config.overlapUtf16}`
          + `/p${chunk.physicalPageNumber}/u16-${chunk.startUtf16}-${chunk.endUtf16}`) fail('WORKER_PROTOCOL_ERROR');
    previousPage = chunk.physicalPageNumber; previousStart = chunk.startUtf16;
    outputUtf16 += chunk.text.length; fragments += chunk.segments.length;
    if (outputUtf16 > config.maxOutputUtf16 || fragments > config.maxFragments) fail('WORKER_PROTOCOL_ERROR');
    let offset = 0;
    for (const segment of chunk.segments) {
      if (!record(segment) || segment.chunkStartUtf16 !== offset || !positive(segment.chunkEndUtf16)
          || segment.chunkEndUtf16 <= offset || segment.chunkEndUtf16 > chunk.text.length) fail('WORKER_PROTOCOL_ERROR');
      if (segment.kind === 'source') {
        if (!exact(segment, ['kind', 'sourceSpanId', 'itemIndex', 'startUtf16', 'endUtf16', 'quote', 'chunkStartUtf16', 'chunkEndUtf16'])
            || !Number.isSafeInteger(segment.itemIndex) || segment.itemIndex < 0 || !Number.isSafeInteger(segment.startUtf16)
            || segment.startUtf16 < 0 || !positive(segment.endUtf16) || segment.endUtf16 <= segment.startUtf16
            || !boundedText(segment.quote, config.maxChunkUtf16)) fail('WORKER_PROTOCOL_ERROR');
        const item = page.textItems[segment.itemIndex];
        if (!item || segment.sourceSpanId !== item.span.id || segment.endUtf16 > item.text.length
            || position.itemStarts[segment.itemIndex] === null
            || chunk.startUtf16 + segment.chunkStartUtf16 !== position.itemStarts[segment.itemIndex] + segment.startUtf16
            || chunk.startUtf16 + segment.chunkEndUtf16 !== position.itemStarts[segment.itemIndex] + segment.endUtf16
            || segment.quote !== item.text.slice(segment.startUtf16, segment.endUtf16)
            || segment.quote !== chunk.text.slice(offset, segment.chunkEndUtf16)) fail('WORKER_PROTOCOL_ERROR');
      } else if (segment.kind === 'presentation') {
        if (!exact(segment, ['kind', 'text', 'chunkStartUtf16', 'chunkEndUtf16']) || segment.text !== '\n'
            || segment.chunkEndUtf16 !== offset + 1
            || !position.separators.has(chunk.startUtf16 + segment.chunkStartUtf16)
            || chunk.text.slice(offset, segment.chunkEndUtf16) !== '\n') fail('WORKER_PROTOCOL_ERROR');
      } else fail('WORKER_PROTOCOL_ERROR');
      offset = segment.chunkEndUtf16;
    }
    if (offset !== chunk.text.length) fail('WORKER_PROTOCOL_ERROR');
  }
  if (outputUtf16 !== artifact.counts.outputUtf16 || fragments !== artifact.counts.fragments) fail('WORKER_PROTOCOL_ERROR');
  return freeze(structuredClone(artifact));
}

function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function receiptValid(data, source) {
  return exact(data, ['sourceSha256', 'parserVersion', 'pageCount', 'status', 'chunkerVersion', 'counts'])
    && data.sourceSha256 === source.source.sha256 && data.parserVersion === source.parser.version
    && data.pageCount === source.numPages && data.status === 'chunked-not-embedded'
    && data.chunkerVersion === 'page-parser-order-v1' && exact(data.counts, COUNTS_KEYS)
    && COUNTS_KEYS.every(key => positive(data.counts[key]));
}

function validSourceHeader(source) {
  return record(source) && source.schemaVersion === 1 && source.status === 'extracted-not-indexed'
    && record(source.source) && typeof source.source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(source.source.sha256)
    && boundedText(source.source.name, 4096) && positive(source.source.size)
    && record(source.parser) && source.parser.name === 'pdfjs' && source.parser.version === '6.4.299'
    && source.parser.policyVersion === 'text-items-v1' && source.parser.disableNormalization === true
    && ['native', 'node-fake'].includes(source.workerMode) && positive(source.numPages) && source.numPages <= 512
    && dense(source.pages, 512) && source.pages.length === source.numPages;
}

// Own only the fields consumed by the chunker before the first asynchronous
// boundary. Geometry and extractor extras are neither needed nor copied. The
// projection is bounded; it does not join pages or calculate chunk windows.
function projectSource(source) {
  if (!validSourceHeader(source)) fail('INVALID_SOURCE');
  let items = 0, textUtf16 = 0;
  const pages = source.pages.map(page => {
    if (!record(page) || !positive(page.physicalPageNumber)
        || (page.pageLabel !== null && !boundedText(page.pageLabel, 4096))
        || typeof page.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(page.sourceSha256)
        || !boundedText(page.parserVersion, 64) || !boundedText(page.policyVersion, 64)
        || !['text', 'empty'].includes(page.status)
        || !dense(page.textItems, 100000 - items)) fail('INVALID_SOURCE');
    items += page.textItems.length;
    const textItems = page.textItems.map(item => {
      if (!record(item) || !Number.isSafeInteger(item.itemIndex) || item.itemIndex < 0
          || typeof item.text !== 'string' || !record(item.span)
          || !boundedText(item.span.id, 512) || !Number.isSafeInteger(item.span.startUtf16)
          || !Number.isSafeInteger(item.span.endUtf16) || item.span.startUtf16 < 0
          || item.span.endUtf16 < item.span.startUtf16 || item.span.quote !== item.text) fail('INVALID_SOURCE');
      textUtf16 += item.text.length;
      if (textUtf16 > 2000000) fail('INVALID_SOURCE');
      return { itemIndex: item.itemIndex, text: item.text,
        span: { id: item.span.id, startUtf16: item.span.startUtf16,
          endUtf16: item.span.endUtf16, quote: item.span.quote } };
    });
    return { physicalPageNumber: page.physicalPageNumber, pageLabel: page.pageLabel,
      sourceSha256: page.sourceSha256, parserVersion: page.parserVersion,
      policyVersion: page.policyVersion, status: page.status, textItems };
  });
  return freeze({ schemaVersion: source.schemaVersion, status: source.status,
    source: Object.fromEntries(SOURCE_KEYS.map(key => [key, source.source[key]])),
    parser: Object.fromEntries(PARSER_KEYS.map(key => [key, source.parser[key]])),
    numPages: source.numPages, workerMode: source.workerMode, pages });
}

// Own exactly one native worker and one request. Termination is cancellation of
// synchronous chunk construction; no cancel message can interrupt its JS loop.
export async function chunkInWorker(source, options = {}) {
  const allowed = ['identity', 'workerFactory', 'onProgress', 'signal', 'readyTimeoutMs', 'workTimeoutMs', 'chunkOptions'];
  if (!record(options) || Reflect.ownKeys(options).some(key => !allowed.includes(key))) fail('INVALID_COMPUTE_CONFIG');
  const { identity, onProgress, signal, readyTimeoutMs = 10000, workTimeoutMs = 30000, chunkOptions = {} } = options;
  const workerFactory = options.workerFactory === undefined
    ? (url => new globalThis.Worker(url, { type: 'module' })) : options.workerFactory;
  const timeoutValid = value => positive(value) && value <= 2147483647;
  if (!isComputeIdentity(identity) || typeof workerFactory !== 'function'
      || (onProgress !== undefined && typeof onProgress !== 'function')
      || (signal !== undefined && (signal === null || typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
      || !timeoutValid(readyTimeoutMs) || !timeoutValid(workTimeoutMs)) fail('INVALID_COMPUTE_CONFIG');
  if (signal?.aborted) fail('ABORTED');
  try { source = projectSource(source); }
  catch (error) { throw error instanceof ComputeError ? error : new ComputeError('INVALID_SOURCE'); }
  const config = chunkConfig(chunkOptions);
  const ownedIdentity = Object.freeze(Object.fromEntries(IDENTITY_KEYS.map(key => [key, identity[key]])));
  const ownedOptions = Object.fromEntries(Reflect.ownKeys(chunkOptions).map(key => [key, chunkOptions[key]]));
  return new Promise((resolve, reject) => {
    let worker, settled = false, ready = false, lastSeq = 0, readyTimer, workTimer;
    const listeners = new Map();
    const onAbort = () => finish(new ComputeError('ABORTED'));
    function cleanup() {
      clearTimeout(readyTimer); clearTimeout(workTimer);
      try { signal?.removeEventListener('abort', onAbort); }
      catch { /* a cleanup hook cannot prevent safe terminal settlement */ }
      if (worker) {
        for (const [type, listener] of listeners) {
          try { worker.removeEventListener(type, listener); } catch { /* owned channel cleanup is best-effort */ }
        }
        try { worker.terminate(); } catch { /* already unavailable; never leak its exception */ }
      }
    }
    function finish(error, result) {
      if (settled) return;
      // Revoke this adapter's commit permission before terminating the channel.
      settled = true; cleanup();
      if (error) reject(error); else resolve(result);
    }
    function protocolError() { finish(new ComputeError('WORKER_PROTOCOL_ERROR')); }
    function receive(message) {
      if (settled) return;
      const packet = message.data;
      if (!ready) {
        if (!exact(packet, ['kind', 'protocolVersion', 'workerVersion']) || packet.kind !== 'compute-ready'
            || packet.protocolVersion !== 1 || packet.workerVersion !== 'chunks-v1') { protocolError(); return; }
        ready = true; clearTimeout(readyTimer);
        workTimer = setTimeout(() => finish(new ComputeError('COMPUTE_TIMEOUT')), workTimeoutMs);
        try { worker.postMessage({ kind: 'chunk-source', identity: ownedIdentity, source, options: ownedOptions }); }
        catch { protocolError(); }
        return;
      }
      try {
        const event = packet?.event;
        if (!exact(event, EVENT_KEYS) || !sameFields(event, ownedIdentity, IDENTITY_KEYS)
            || event.stage !== 'index' || !positive(event.seq) || event.seq <= lastSeq) fail('WORKER_PROTOCOL_ERROR');
        if (event.kind === 'progress') {
          if (!exact(packet, ['event']) || !exact(event.payload, ['completed', 'total', 'unit', 'estimated'])
              || event.payload.completed !== 0 || event.payload.total !== null || event.payload.unit !== 'chunks'
              || event.payload.estimated !== false) fail('WORKER_PROTOCOL_ERROR');
          lastSeq = event.seq;
          onProgress?.(freeze(structuredClone(event)));
        } else if (event.kind === 'error') {
          if (!exact(packet, ['event']) || !exact(event.payload, ['code', 'message'])
              || typeof event.payload.code !== 'string' || !Object.hasOwn(MESSAGES, event.payload.code)
              || event.payload.message !== MESSAGES[event.payload.code]) fail('WORKER_PROTOCOL_ERROR');
          lastSeq = event.seq; finish(new ComputeError(event.payload.code));
        } else if (event.kind === 'result') {
          if (!exact(packet, ['event', 'artifact']) || !exact(event.payload, ['data'])
              || !receiptValid(event.payload.data, source)) fail('WORKER_PROTOCOL_ERROR');
          const artifact = copyArtifact(packet.artifact, source, config, event.payload.data);
          const result = Object.freeze({ event: freeze(structuredClone(event)), artifact });
          lastSeq = event.seq; finish(null, result);
        } else fail('WORKER_PROTOCOL_ERROR');
      } catch (error) {
        finish(error instanceof ComputeError ? error : new ComputeError('WORKER_PROTOCOL_ERROR'));
      }
    }
    try {
      worker = workerFactory(new URL('./compute.worker.mjs', import.meta.url));
      if (!worker || ['addEventListener', 'removeEventListener', 'postMessage', 'terminate'].some(key => typeof worker[key] !== 'function')) {
        finish(new ComputeError('WORKER_UNAVAILABLE')); return;
      }
      listeners.set('message', receive);
      listeners.set('error', () => finish(new ComputeError('COMPUTE_FAILED')));
      listeners.set('messageerror', protocolError);
      for (const [type, listener] of listeners) worker.addEventListener(type, listener);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      readyTimer = setTimeout(() => finish(new ComputeError('COMPUTE_TIMEOUT')), readyTimeoutMs);
    } catch { finish(new ComputeError('WORKER_UNAVAILABLE')); }
  });
}
