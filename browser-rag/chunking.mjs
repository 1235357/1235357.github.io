const MESSAGES = Object.freeze({
  INVALID_SOURCE: 'The extracted source record is invalid.',
  INVALID_CONFIG: 'The chunking configuration is invalid.',
  CHUNK_LIMIT: 'The chunked output exceeds its configured budget.',
  EMPTY_SOURCE: 'The source contains no selectable nonblank text.',
});
const PARSER_VERSION = '6.4.299';
const POLICY_VERSION = 'text-items-v1';
const CHUNKER_VERSION = 'page-parser-order-v1';
const DEFAULTS = Object.freeze({ maxChunkUtf16: 512, overlapUtf16: 64,
  maxChunks: 10000, maxOutputUtf16: 4000000, maxFragments: 200000 });

export class ChunkingError extends Error {
  constructor(code) {
    const safeCode = typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'INVALID_SOURCE';
    super(MESSAGES[safeCode]); this.name = 'ChunkingError'; this.code = safeCode;
  }
}
const fail = code => { throw new ChunkingError(code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const positive = value => Number.isSafeInteger(value) && value > 0;

function configFor(options) {
  if (!record(options) || Reflect.ownKeys(options).some(key => !Object.hasOwn(DEFAULTS, key))) fail('INVALID_CONFIG');
  const config = { ...DEFAULTS };
  for (const key of Reflect.ownKeys(options)) config[key] = options[key];
  if (!Number.isSafeInteger(config.maxChunkUtf16) || config.maxChunkUtf16 < 2
      || config.maxChunkUtf16 > 4096 || !Number.isSafeInteger(config.overlapUtf16)
      || config.overlapUtf16 < 0 || config.overlapUtf16 >= config.maxChunkUtf16
      || ['maxChunks', 'maxOutputUtf16', 'maxFragments'].some(key => !positive(config[key])
        || config[key] > DEFAULTS[key])) fail('INVALID_CONFIG');
  return config;
}

// This validates trusted extractor JSON before joining strings. It does not
// authenticate the PDF, sandbox malicious getters/proxies, or validate geometry.
function validateSource(source) {
  if (!record(source) || source.schemaVersion !== 1 || source.status !== 'extracted-not-indexed'
      || !record(source.source) || typeof source.source.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(source.source.sha256) || typeof source.source.name !== 'string'
      || !positive(source.source.size) || !record(source.parser) || source.parser.name !== 'pdfjs'
      || source.parser.version !== PARSER_VERSION || source.parser.policyVersion !== POLICY_VERSION
      || source.parser.disableNormalization !== true || !['native', 'node-fake'].includes(source.workerMode)
      || !positive(source.numPages) || source.numPages > 512 || !Array.isArray(source.pages)
      || source.pages.length !== source.numPages) fail('INVALID_SOURCE');
  let itemCount = 0, textLength = 0, hasText = false;
  for (let pageIndex = 0; pageIndex < source.pages.length; pageIndex++) {
    if (!Object.hasOwn(source.pages, pageIndex)) fail('INVALID_SOURCE');
    const page = source.pages[pageIndex];
    if (!record(page) || page.physicalPageNumber !== pageIndex + 1
        || (page.pageLabel !== null && typeof page.pageLabel !== 'string')
        || page.sourceSha256 !== source.source.sha256 || page.parserVersion !== PARSER_VERSION
        || page.policyVersion !== POLICY_VERSION || !Array.isArray(page.textItems)
        // Bound lengths before density scans, including the remaining item count.
        || page.textItems.length > 100000 - itemCount) fail('INVALID_SOURCE');
    itemCount += page.textItems.length;
    let pageHasText = false;
    for (let itemIndex = 0; itemIndex < page.textItems.length; itemIndex++) {
      if (!Object.hasOwn(page.textItems, itemIndex)) fail('INVALID_SOURCE');
      const item = page.textItems[itemIndex];
      if (!record(item) || item.itemIndex !== itemIndex || typeof item.text !== 'string') fail('INVALID_SOURCE');
      textLength += item.text.length;
      if (textLength > 2000000 || !record(item.span) || item.span.startUtf16 !== 0
          || item.span.endUtf16 !== item.text.length || item.span.quote !== item.text
          || item.span.id !== `${source.source.sha256}/pdfjs-${PARSER_VERSION}/${POLICY_VERSION}`
            + `/p${page.physicalPageNumber}/i${itemIndex}/u16-0-${item.text.length}`) fail('INVALID_SOURCE');
      if (item.text.trim()) pageHasText = true;
    }
    if (page.status !== (pageHasText ? 'text' : 'empty')) fail('INVALID_SOURCE');
    if (pageHasText) hasText = true;
  }
  if (!hasText) fail('EMPTY_SOURCE');
}

// Authored newlines are presentation runs. Original item strings (including
// whitespace) remain exact; empty strings do not create a run or separator.
function joinPage(page) {
  const parts = [], runs = []; let offset = 0;
  for (const item of page.textItems) {
    if (!item.text.length) continue;
    if (parts.length) {
      parts.push('\n'); runs.push({ kind: 'presentation', start: offset, end: offset + 1 }); offset++;
    }
    parts.push(item.text);
    runs.push({ kind: 'source', start: offset, end: offset + item.text.length,
      itemIndex: item.itemIndex, sourceSpanId: item.span.id, text: item.text });
    offset += item.text.length;
  }
  return { text: parts.join(''), runs };
}

function insidePair(text, offset) {
  if (offset <= 0 || offset >= text.length) return false;
  const high = text.charCodeAt(offset - 1), low = text.charCodeAt(offset);
  return high >= 0xD800 && high <= 0xDBFF && low >= 0xDC00 && low <= 0xDFFF;
}

function firstIntersectingRun(runs, start) {
  let low = 0, high = runs.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (runs[middle].end <= start) low = middle + 1; else high = middle;
  }
  return low;
}

function segmentsFor(runs, start, end, counts, config) {
  const segments = [];
  for (let index = firstIntersectingRun(runs, start); index < runs.length && runs[index].start < end; index++) {
    const run = runs[index], from = Math.max(run.start, start), to = Math.min(run.end, end);
    if (counts.fragments >= config.maxFragments) fail('CHUNK_LIMIT');
    counts.fragments++;
    const offsets = { chunkStartUtf16: from - start, chunkEndUtf16: to - start };
    if (run.kind === 'presentation') segments.push({ kind: 'presentation', text: '\n', ...offsets });
    else {
      const startUtf16 = from - run.start, endUtf16 = to - run.start;
      segments.push({ kind: 'source', sourceSpanId: run.sourceSpanId, itemIndex: run.itemIndex,
        startUtf16, endUtf16, quote: run.text.slice(startUtf16, endUtf16), ...offsets });
    }
  }
  return segments;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Windows are joined-page UTF-16 offsets, not tokenizer or original PDF-byte
// offsets. Surrogate boundaries can reduce effective overlap; lone units stay.
export function chunkSource(source, options = {}) {
  const config = configFor(options); validateSource(source);
  const chunks = [], counts = { chunks: 0, outputUtf16: 0, fragments: 0 };
  const prefix = `${source.source.sha256}/pdfjs-${PARSER_VERSION}/${POLICY_VERSION}/${CHUNKER_VERSION}`
    + `/m${config.maxChunkUtf16}/o${config.overlapUtf16}`;
  for (const page of source.pages) {
    if (page.status === 'empty') continue;
    const { text, runs } = joinPage(page);
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + config.maxChunkUtf16, text.length);
      if (insidePair(text, end)) end--;
      if (counts.chunks >= config.maxChunks || end - start > config.maxOutputUtf16 - counts.outputUtf16)
        fail('CHUNK_LIMIT');
      const segments = segmentsFor(runs, start, end, counts, config);
      chunks.push({ id: `${prefix}/p${page.physicalPageNumber}/u16-${start}-${end}`,
        physicalPageNumber: page.physicalPageNumber, pageLabel: page.pageLabel,
        startUtf16: start, endUtf16: end, text: text.slice(start, end), segments });
      counts.chunks++; counts.outputUtf16 += end - start;
      if (end === text.length) break;
      let next = end - config.overlapUtf16;
      if (insidePair(text, next)) next++;
      start = next > start ? next : end;
    }
  }
  return freeze({ schemaVersion: 1, status: 'chunked-not-embedded',
    source: { sha256: source.source.sha256, name: source.source.name, size: source.source.size },
    parser: { name: source.parser.name, version: source.parser.version,
      policyVersion: source.parser.policyVersion, disableNormalization: source.parser.disableNormalization },
    numPages: source.numPages, workerMode: source.workerMode,
    chunker: { version: CHUNKER_VERSION, maxChunkUtf16: config.maxChunkUtf16,
      overlapUtf16: config.overlapUtf16, separator: '\n', order: 'parser-item-order' }, counts, chunks });
}
