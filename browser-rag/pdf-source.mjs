const PARSER_VERSION = '6.4.299';
const POLICY_VERSION = 'text-items-v1';
const WORKER_STARTUP_TIMEOUT_MS = 10000;
const CLEANUP_TIMEOUT_MS = 5000;
const DEFAULT_LIMITS = Object.freeze({ maxFileBytes: 32 * 1024 * 1024, maxPages: 512,
  maxItems: 100000, maxTextUtf16: 2000000 });
const MESSAGES = Object.freeze({
  INVALID_INPUT: 'Select a supported local PDF file.',
  INVALID_RECORD: 'The parser returned an invalid source record.',
  INVALID_LIMITS: 'Extraction budgets must be positive safe integers with known keys.',
  FILE_TOO_LARGE: 'The selected file exceeds the file-byte budget.',
  INVALID_PDF: 'The selected bytes do not have a supported PDF signature.',
  PARSER_VERSION_UNSUPPORTED: 'The PDF.js API version does not match the pinned parser.',
  WORKER_UNAVAILABLE: 'A dedicated native PDF parsing worker is required in this browser.',
  EXTRACTION_LIMIT: 'The PDF exceeds the page, item or extracted-text budget.',
  EMPTY_DOCUMENT: 'No selectable text was extracted. Scanned/empty PDFs need a separate OCR path.',
  PDF_PASSWORD_REQUIRED: 'Password-protected PDFs are not supported by this inspector.',
  EXTRACTION_FAILED: 'PDF extraction failed. No source records were committed.',
  CLEANUP_FAILED: 'An owned PDF parsing resource could not be fully cleaned up.',
  ABORTED: 'PDF extraction was cancelled. No source records were committed.',
});

export class PdfSourceError extends Error {
  constructor(code) { super(MESSAGES[code]); this.name = 'PdfSourceError'; this.code = code; }
}
const fail = code => { throw new PdfSourceError(code); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const matrix = (value, length) => Array.isArray(value) && value.length === length
  && value.every(number => typeof number === 'number' && Number.isFinite(number));
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

// Strings are exact parser-returned text, not PDF content-stream byte spans.
// Geometry is TextItem geometry plus page-space metadata, not per-glyph boxes.
export function createPageRecord({ sourceSha256, parserVersion, physicalPageNumber,
  pageLabel, page, textContent } = {}) {
  if (!/^[a-f0-9]{64}$/.test(sourceSha256) || typeof parserVersion !== 'string'
      || !parserVersion.trim() || !positive(physicalPageNumber)
      || (pageLabel !== null && typeof pageLabel !== 'string')
      || !page || !matrix(page.view, 4) || !Number.isFinite(page.rotate)
      || !Number.isFinite(page.userUnit) || page.userUnit <= 0
      || !textContent || !Array.isArray(textContent.items)) fail('INVALID_RECORD');
  const textItems = textContent.items.map((item, itemIndex) => {
    if (!item || typeof item.str !== 'string' || !['ltr', 'rtl', 'ttb'].includes(item.dir)
        || !matrix(item.transform, 6) || !Number.isFinite(item.width) || item.width < 0
        || !Number.isFinite(item.height) || item.height < 0 || typeof item.fontName !== 'string'
        || typeof item.hasEOL !== 'boolean') fail('INVALID_RECORD');
    return { itemIndex, text: item.str, dir: item.dir, transform: [...item.transform],
      width: item.width, height: item.height, fontName: item.fontName, hasEOL: item.hasEOL,
      span: { id: `${sourceSha256}/pdfjs-${parserVersion}/${POLICY_VERSION}/p${physicalPageNumber}`
        + `/i${itemIndex}/u16-0-${item.str.length}`,
      startUtf16: 0, endUtf16: item.str.length, quote: item.str } };
  });
  return freeze({ sourceSha256, parserVersion, policyVersion: POLICY_VERSION,
    physicalPageNumber, pageLabel, status: textItems.some(item => item.text.trim()) ? 'text' : 'empty',
    geometry: { view: [...page.view], rotation: page.rotate, userUnit: page.userUnit }, textItems });
}

function limitsFor(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
      || Object.keys(overrides).some(key => !Object.hasOwn(DEFAULT_LIMITS, key))) fail('INVALID_LIMITS');
  const result = { ...DEFAULT_LIMITS, ...overrides };
  if (!Object.entries(result).every(([key, value]) => positive(value)
      && value <= DEFAULT_LIMITS[key])) fail('INVALID_LIMITS');
  return result;
}
function checkAbort(signal) { if (signal?.aborted) fail('ABORTED'); }
async function abortable(promise, signal) {
  checkAbort(signal);
  if (!signal) return promise;
  let listener;
  const aborted = new Promise((_, reject) => {
    listener = () => reject(new PdfSourceError('ABORTED'));
    signal.addEventListener('abort', listener, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener('abort', listener); }
}

function waitForNativeWorker(native, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let timer;
    const finish = error => {
      clearTimeout(timer);
      native.removeEventListener('message', message);
      native.removeEventListener('error', unavailable);
      native.removeEventListener('messageerror', unavailable);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    // PDF.js 6.4.299 WorkerMessageHandler.initializeFromPort sends this ready
    // message. Do not create a loading task against a failed or silent port:
    // task.destroy() waits for setup, which cannot finish if startup failed.
    const message = event => {
      const data = event.data;
      if (data?.sourceName === 'worker' && data.targetName === 'main'
          && data.action === 'ready' && data.data instanceof Uint8Array) finish();
    };
    const unavailable = () => finish(new PdfSourceError('WORKER_UNAVAILABLE'));
    const aborted = () => finish(new PdfSourceError('ABORTED'));
    native.addEventListener('message', message);
    native.addEventListener('error', unavailable);
    native.addEventListener('messageerror', unavailable);
    signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(unavailable, WORKER_STARTUP_TIMEOUT_MS);
  });
}

async function boundedCleanup(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new PdfSourceError('CLEANUP_FAILED')), CLEANUP_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}

// Extracted records remain private adapter data. Callers publish only after the
// operation controller accepts matching bounded terminal metadata, synchronously.
export async function extractPdf(file, { pdfjs, workerFactory, assetBaseUrl,
  signal, onProgress, limits } = {}) {
  checkAbort(signal);
  const budgets = limitsFor(limits);
  if (!file || !positive(file.size) || typeof file.arrayBuffer !== 'function'
      || typeof file.name !== 'string' || (signal && (typeof signal.addEventListener !== 'function'
        || typeof signal.removeEventListener !== 'function'))
      || (onProgress !== undefined && typeof onProgress !== 'function')) fail('INVALID_INPUT');
  if (file.size > budgets.maxFileBytes) fail('FILE_TOO_LARGE');
  if (pdfjs?.version !== PARSER_VERSION || typeof pdfjs.getDocument !== 'function')
    fail('PARSER_VERSION_UNSUPPORTED');
  const nodeMode = typeof process !== 'undefined' && Boolean(process.versions?.node)
    && typeof window === 'undefined';
  if (!nodeMode && (typeof Worker !== 'function' || !workerFactory)) fail('WORKER_UNAVAILABLE');
  if (workerFactory && (typeof workerFactory !== 'function' || !assetBaseUrl
      || typeof pdfjs.PDFWorker?.create !== 'function')) fail('WORKER_UNAVAILABLE');

  let task = null; let wrapper = null; let native = null; let cleanupPromise;
  let workerFailure = null; let workerError = null; let workerErrorListener = null;
  const parseAwait = promise => {
    if (workerError) throw workerError;
    return abortable(workerFailure ? Promise.race([promise, workerFailure]) : promise, signal);
  };
  const cleanup = () => cleanupPromise ??= (async () => {
    let failed = false;
    try { if (task) await boundedCleanup(task.destroy()); } catch { failed = true; }
    try { if (wrapper) await boundedCleanup(wrapper.destroy()); } catch { failed = true; }
    try { if (native) await boundedCleanup(native.terminate()); } catch { failed = true; }
    native?.removeEventListener?.('error', workerErrorListener);
    native?.removeEventListener?.('messageerror', workerErrorListener);
    if (failed) throw new PdfSourceError('CLEANUP_FAILED');
  })();
  let outcome; let error;
  try {
    const buffer = await abortable(file.arrayBuffer(), signal); checkAbort(signal);
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size
        || buffer.byteLength > budgets.maxFileBytes) fail('INVALID_INPUT');
    const data = new Uint8Array(buffer);
    const header = new TextDecoder('ascii').decode(data.subarray(0, 8));
    if (!/^%PDF-\d\.\d/.test(header)) fail('INVALID_PDF');
    if (!globalThis.crypto?.subtle) fail('EXTRACTION_FAILED');
    // Hash before getDocument transfers/detaches the byte buffer.
    const digest = await abortable(crypto.subtle.digest('SHA-256', data), signal); checkAbort(signal);
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    let resourceOptions = { useWasm: false, useSystemFonts: false, useWorkerFetch: false };
    const base = assetBaseUrl ? new URL(assetBaseUrl) : null;
    if (base) {
      let resource = suffix => new URL(suffix, base).href;
      if (nodeMode && !workerFactory && base.protocol === 'file:') {
        // Node's official legacy BinaryDataFactory reads filesystem paths, not
        // file-URL strings, and PDF.js requires directory options to end in '/'.
        const { fileURLToPath } = await import('node:url'); checkAbort(signal);
        resource = suffix => fileURLToPath(new URL(suffix, base)).replaceAll('\\', '/');
      }
      resourceOptions = { ...resourceOptions, cMapUrl: resource('cmaps/'), cMapPacked: true,
        standardFontDataUrl: resource('standard_fonts/'), wasmUrl: resource('wasm/'),
        iccUrl: resource('iccs/') };
    }
    if (workerFactory) {
      const workerUrl = new URL('build/pdf.worker.mjs', base).href;
      try { native = workerFactory(workerUrl); } catch { fail('WORKER_UNAVAILABLE'); }
      if (!native || typeof native.terminate !== 'function' || typeof native.postMessage !== 'function'
          || typeof native.addEventListener !== 'function' || typeof native.removeEventListener !== 'function'
          || (!nodeMode && !(native instanceof Worker)))
        fail('WORKER_UNAVAILABLE');
      await waitForNativeWorker(native, signal); checkAbort(signal);
      workerFailure = new Promise((_, reject) => {
        workerErrorListener = () => {
          workerError ??= new PdfSourceError('WORKER_UNAVAILABLE'); reject(workerError);
        };
        native.addEventListener('error', workerErrorListener);
        native.addEventListener('messageerror', workerErrorListener);
      });
      // The owned failure promise can reject during cleanup, when no parsing
      // await is active. Its error is still checked before source publication.
      workerFailure.catch(() => {});
      wrapper = pdfjs.PDFWorker.create({ port: native }); checkAbort(signal);
      resourceOptions = { ...resourceOptions, useWasm: true, useWorkerFetch: true };
    }
    task = pdfjs.getDocument({ data, ...(wrapper ? { worker: wrapper } : {}),
      ...resourceOptions, stopAtErrors: true, enableXfa: false });
    const document = await parseAwait(task.promise); checkAbort(signal);
    if (!positive(document.numPages) || document.numPages > budgets.maxPages) fail('EXTRACTION_LIMIT');
    const labels = await parseAwait(document.getPageLabels()); checkAbort(signal);
    if (labels !== null && (!Array.isArray(labels) || labels.length !== document.numPages
        || labels.some(label => typeof label !== 'string'))) fail('INVALID_RECORD');
    const pages = []; let itemCount = 0; let textLength = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await parseAwait(document.getPage(number)); checkAbort(signal);
      try {
        const textContent = await parseAwait(page.getTextContent({ disableNormalization: true,
          includeMarkedContent: false })); checkAbort(signal);
        if (!Array.isArray(textContent?.items)) fail('INVALID_RECORD');
        // Count before copying into source records; PDF.js already allocated its
        // returned page content. These limits are not a parser memory sandbox.
        itemCount += textContent.items.length;
        for (const item of textContent.items) {
          if (typeof item?.str !== 'string') fail('INVALID_RECORD');
          textLength += item.str.length;
        }
        if (itemCount > budgets.maxItems || textLength > budgets.maxTextUtf16) fail('EXTRACTION_LIMIT');
        pages.push(createPageRecord({ sourceSha256: sha256, parserVersion: pdfjs.version,
          physicalPageNumber: number, pageLabel: labels?.[number - 1] ?? null, page, textContent }));
      } finally { await page.cleanup?.(); }
      onProgress?.({ completed: number, total: document.numPages, unit: 'pages', estimated: false });
      checkAbort(signal);
    }
    if (!pages.some(page => page.status === 'text')) fail('EMPTY_DOCUMENT');
    outcome = freeze({ schemaVersion: 1, status: 'extracted-not-indexed',
      source: { sha256, name: file.name, size: file.size },
      parser: { name: 'pdfjs', version: pdfjs.version, policyVersion: POLICY_VERSION,
        disableNormalization: true }, workerMode: workerFactory ? 'native' : 'node-fake',
      numPages: document.numPages, pages });
  } catch (caught) {
    error = signal?.aborted ? new PdfSourceError('ABORTED')
      : caught instanceof PdfSourceError ? caught : new PdfSourceError(
      caught?.name === 'PasswordException'
        ? 'PDF_PASSWORD_REQUIRED' : 'EXTRACTION_FAILED');
  } finally {
    try { await cleanup(); } catch (caught) { if (!error) error = caught; }
  }
  if (error) throw error;
  if (workerError) throw workerError;
  checkAbort(signal);
  return outcome;
}
