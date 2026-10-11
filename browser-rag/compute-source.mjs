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
const ARTIFACT_KEYS = ['schemaVersion', 'status', 'source', 'parser', 'numPages', 'workerMode', 'chunker', 'counts', 'chunks'];
const CHUNKER_KEYS = ['version', 'maxChunkUtf16', 'overlapUtf16', 'separator', 'order'];
const CHUNK_KEYS = ['id', 'physicalPageNumber', 'pageLabel', 'startUtf16', 'endUtf16', 'text', 'segments'];
const SOURCE_SEGMENT_KEYS = ['kind', 'sourceSpanId', 'itemIndex', 'startUtf16', 'endUtf16', 'quote', 'chunkStartUtf16', 'chunkEndUtf16'];
const PRESENTATION_SEGMENT_KEYS = ['kind', 'text', 'chunkStartUtf16', 'chunkEndUtf16'];
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
function fields(value, keys) {
  const owned = {};
  for (const key of keys) owned[key] = value[key];
  return owned;
}
function snapshot(value, keys) {
  if (!exact(value, keys)) fail('WORKER_PROTOCOL_ERROR');
  return fields(value, keys);
}
function dense(array, maximum) {
  if (!Array.isArray(array) || Object.getPrototypeOf(array) !== Array.prototype
      || array.length > maximum || Reflect.ownKeys(array).length !== array.length + 1) return false;
  for (let index = 0; index < array.length; index++) if (!Object.hasOwn(array, index)) return false;
  return true;
}

// Numeric attribution coordinates only: no page string or chunk window is
// constructed here. Empty items retain their indices but own no text run and
// introduce no authored separator, exactly as the accepted chunker contract.
function pageCoordinates(page) {
  let length = 0, hasRun = false;
  const runs = [];
  for (const item of page.textItems) {
    if (item.text.length === 0) continue;
    if (hasRun) { runs.push({ kind: 'presentation', start: length, end: length + 1 }); length++; }
    runs.push({ kind: 'source', start: length, end: length + item.text.length, item });
    length += item.text.length; hasRun = true;
  }
  return { length, runs };
}

function firstIntersectingRun(runs, offset) {
  let low = 0, high = runs.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (runs[middle].end <= offset) low = middle + 1; else high = middle;
  }
  return low;
}
function codeUnitAt(position, offset) {
  const run = position.runs[firstIntersectingRun(position.runs, offset)];
  return run.kind === 'presentation' ? 10 : run.item.text.charCodeAt(offset - run.start);
}
function insidePair(position, offset) {
  if (offset <= 0 || offset >= position.length) return false;
  const high = codeUnitAt(position, offset - 1), low = codeUnitAt(position, offset);
  return high >= 0xD800 && high <= 0xDBFF && low >= 0xDC00 && low <= 0xDFFF;
}

// Verify the declared mechanical windows using finite item coordinates and
// code-unit reads. No joined page, rechunked substring, or second chunkSource
// invocation is constructed. Copy only the same known values we validate.
function copyArtifact(artifact, source, requestedConfig, receipt) {
  artifact = snapshot(artifact, ARTIFACT_KEYS);
  artifact.source = snapshot(artifact.source, SOURCE_KEYS);
  artifact.parser = snapshot(artifact.parser, PARSER_KEYS);
  artifact.chunker = snapshot(artifact.chunker, CHUNKER_KEYS);
  artifact.counts = snapshot(artifact.counts, COUNTS_KEYS);
  const config = requestedConfig ?? chunkConfig({ maxChunkUtf16: artifact.chunker.maxChunkUtf16,
    overlapUtf16: artifact.chunker.overlapUtf16 });
  if (artifact.schemaVersion !== 1 || artifact.status !== 'chunked-not-embedded'
      || !sameFields(artifact.source, source.source, SOURCE_KEYS)
      || !sameFields(artifact.parser, source.parser, PARSER_KEYS)
      || artifact.numPages !== source.numPages || artifact.workerMode !== source.workerMode
      || artifact.chunker.version !== 'page-parser-order-v1' || artifact.chunker.maxChunkUtf16 !== config.maxChunkUtf16
      || artifact.chunker.overlapUtf16 !== config.overlapUtf16 || artifact.chunker.separator !== '\n'
      || artifact.chunker.order !== 'parser-item-order'
      || (receipt !== undefined && !sameFields(artifact.counts, receipt.counts, COUNTS_KEYS))
      || !dense(artifact.chunks, config.maxChunks) || artifact.chunks.length !== artifact.counts.chunks
      || !positive(artifact.counts.chunks) || !positive(artifact.counts.outputUtf16) || !positive(artifact.counts.fragments)
      || artifact.counts.outputUtf16 > config.maxOutputUtf16 || artifact.counts.fragments > config.maxFragments) fail('WORKER_PROTOCOL_ERROR');
  let outputUtf16 = 0, fragments = 0, chunkIndex = 0;
  const chunks = [], prefix = `${source.source.sha256}/pdfjs-${source.parser.version}/${source.parser.policyVersion}`
    + `/page-parser-order-v1/m${config.maxChunkUtf16}/o${config.overlapUtf16}`;
  for (const page of source.pages) {
    if (page.status === 'empty') continue;
    const position = pageCoordinates(page);
    let start = 0;
    while (start < position.length) {
      let end = Math.min(start + config.maxChunkUtf16, position.length);
      if (insidePair(position, end)) end--;
      if (chunkIndex >= artifact.chunks.length) fail('WORKER_PROTOCOL_ERROR');
      const chunk = snapshot(artifact.chunks[chunkIndex], CHUNK_KEYS);
      if (chunk.physicalPageNumber !== page.physicalPageNumber || chunk.pageLabel !== page.pageLabel
          || chunk.startUtf16 !== start || chunk.endUtf16 !== end
          || chunk.id !== `${prefix}/p${page.physicalPageNumber}/u16-${start}-${end}`
          || !boundedText(chunk.text, config.maxChunkUtf16) || chunk.text.length !== end - start
          || !dense(chunk.segments, config.maxFragments - fragments)) fail('WORKER_PROTOCOL_ERROR');
      outputUtf16 += chunk.text.length; fragments += chunk.segments.length;
      if (outputUtf16 > config.maxOutputUtf16 || fragments > config.maxFragments) fail('WORKER_PROTOCOL_ERROR');
      const segments = [];
      let segmentIndex = 0;
      for (let runIndex = firstIntersectingRun(position.runs, start);
        runIndex < position.runs.length && position.runs[runIndex].start < end; runIndex++) {
        const run = position.runs[runIndex], from = Math.max(run.start, start), to = Math.min(run.end, end);
        if (segmentIndex >= chunk.segments.length) fail('WORKER_PROTOCOL_ERROR');
        const segment = snapshot(chunk.segments[segmentIndex], run.kind === 'source' ? SOURCE_SEGMENT_KEYS : PRESENTATION_SEGMENT_KEYS);
        if (segment.kind !== run.kind || segment.chunkStartUtf16 !== from - start
            || segment.chunkEndUtf16 !== to - start) fail('WORKER_PROTOCOL_ERROR');
        if (run.kind === 'source') {
          const item = run.item, itemStart = from - run.start, itemEnd = to - run.start;
          if (segment.itemIndex !== item.itemIndex || segment.sourceSpanId !== item.span.id
              || segment.startUtf16 !== itemStart || segment.endUtf16 !== itemEnd
              || !boundedText(segment.quote, config.maxChunkUtf16) || segment.quote.length !== to - from) fail('WORKER_PROTOCOL_ERROR');
          for (let offset = 0; offset < to - from; offset++) {
            const unit = item.text.charCodeAt(itemStart + offset);
            if (segment.quote.charCodeAt(offset) !== unit || chunk.text.charCodeAt(from - start + offset) !== unit) fail('WORKER_PROTOCOL_ERROR');
          }
        } else if (segment.text !== '\n' || chunk.text.charCodeAt(from - start) !== 10) fail('WORKER_PROTOCOL_ERROR');
        segments.push(segment); segmentIndex++;
      }
      if (segmentIndex !== chunk.segments.length) fail('WORKER_PROTOCOL_ERROR');
      chunk.segments = segments; chunks.push(chunk); chunkIndex++;
      if (end === position.length) break;
      let next = end - config.overlapUtf16;
      if (insidePair(position, next)) next++;
      start = next > start ? next : end;
    }
  }
  if (chunkIndex !== artifact.chunks.length || outputUtf16 !== artifact.counts.outputUtf16
      || fragments !== artifact.counts.fragments) fail('WORKER_PROTOCOL_ERROR');
  artifact.chunks = chunks;
  return freeze(artifact);
}

// Public two-argument provenance boundary uses global output caps and the
// artifact's validated declared settings. Worker validation keeps the caller's
// requested settings, reduced output budgets and terminal count equality.
export function copyValidatedSource(source) {
  try { return projectSource(source); }
  catch { fail('INVALID_SOURCE'); }
}

export function copyValidatedChunkArtifact(source, artifact) {
  try { source = projectSource(source); }
  catch { fail('INVALID_SOURCE'); }
  try { return copyArtifact(artifact, source); }
  catch { fail('WORKER_PROTOCOL_ERROR'); }
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

// Own only the fields consumed by the chunker before the first asynchronous
// boundary. Geometry and extractor extras are neither needed nor copied. The
// projection is bounded; it does not join pages or calculate chunk windows.
function projectSource(source) {
  if (!record(source)) fail('INVALID_SOURCE');
  source = fields(source, ['schemaVersion', 'status', 'source', 'parser', 'numPages', 'workerMode', 'pages']);
  if (!record(source.source) || !record(source.parser)) fail('INVALID_SOURCE');
  source.source = fields(source.source, SOURCE_KEYS); source.parser = fields(source.parser, PARSER_KEYS);
  if (source.schemaVersion !== 1 || source.status !== 'extracted-not-indexed'
      || typeof source.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.source.sha256)
      || !boundedText(source.source.name, 4096) || !positive(source.source.size)
      || source.parser.name !== 'pdfjs' || source.parser.version !== '6.4.299'
      || source.parser.policyVersion !== 'text-items-v1' || source.parser.disableNormalization !== true
      || !['native', 'node-fake'].includes(source.workerMode) || !positive(source.numPages) || source.numPages > 512
      || !dense(source.pages, 512) || source.pages.length !== source.numPages) fail('INVALID_SOURCE');
  let items = 0, textUtf16 = 0;
  const pages = [];
  for (let pageIndex = 0; pageIndex < source.pages.length; pageIndex++) {
    let page = source.pages[pageIndex];
    if (!record(page)) fail('INVALID_SOURCE');
    page = fields(page, ['physicalPageNumber', 'pageLabel', 'sourceSha256', 'parserVersion', 'policyVersion', 'status', 'textItems']);
    if (page.physicalPageNumber !== pageIndex + 1 || (page.pageLabel !== null && !boundedText(page.pageLabel, 4096))
        || page.sourceSha256 !== source.source.sha256 || page.parserVersion !== source.parser.version
        || page.policyVersion !== source.parser.policyVersion
        || !dense(page.textItems, 100000 - items)) fail('INVALID_SOURCE');
    items += page.textItems.length;
    const textItems = [];
    let pageHasText = false;
    for (let itemIndex = 0; itemIndex < page.textItems.length; itemIndex++) {
      let item = page.textItems[itemIndex];
      if (!record(item)) fail('INVALID_SOURCE');
      item = fields(item, ['itemIndex', 'text', 'span']);
      if (item.itemIndex !== itemIndex || typeof item.text !== 'string' || !record(item.span)) fail('INVALID_SOURCE');
      textUtf16 += item.text.length;
      if (textUtf16 > 2000000) fail('INVALID_SOURCE');
      item.span = fields(item.span, ['id', 'startUtf16', 'endUtf16', 'quote']);
      if (item.span.startUtf16 !== 0 || item.span.endUtf16 !== item.text.length || item.span.quote !== item.text
          || item.span.id !== `${source.source.sha256}/pdfjs-${source.parser.version}/${source.parser.policyVersion}`
            + `/p${page.physicalPageNumber}/i${itemIndex}/u16-0-${item.text.length}`) fail('INVALID_SOURCE');
      if (item.text.trim()) pageHasText = true;
      textItems.push(item);
    }
    if (page.status !== (pageHasText ? 'text' : 'empty')) fail('INVALID_SOURCE');
    page.textItems = textItems; pages.push(page);
  }
  source.pages = pages;
  return freeze(source);
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
