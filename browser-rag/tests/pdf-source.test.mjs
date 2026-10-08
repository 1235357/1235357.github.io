import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPageRecord, extractPdf } from '../pdf-source.mjs';

const SHA = 'a'.repeat(64);
const page = { view: [0, 0, 612, 792], rotate: 0, userUnit: 1 };
const item = (str, extra = {}) => ({ str, dir: 'ltr', transform: [1, 0, 0, 1, 30, 740],
  width: 120, height: 12, fontName: 'f1', hasEOL: false, ...extra });
const pageInput = (items = [item('TEST A😀B')], extra = {}) => ({ sourceSha256: SHA,
  parserVersion: '6.4.299', physicalPageNumber: 1, pageLabel: 'i', page: { ...page, view: [...page.view] },
  textContent: { items, styles: {}, lang: 'en' }, ...extra });
const bytes = new TextEncoder().encode('%PDF-1.7\nunit fixture');
const file = (data = bytes) => ({ name: 'fixture.pdf', size: data.byteLength,
  arrayBuffer: async () => data.slice().buffer });
const pending = () => { let resolve; const promise = new Promise(r => { resolve = r; });
  return { promise, resolve }; };
function harness({ pages = [[item('TEST first')], [item('TEST second')]],
  labels = ['i', '1'], pageWait, loadingWait, destroyWait, destroyError,
  workerReady = true, transfer = false, workerCreate, documentCreate } = {}) {
  const counts = { task: 0, wrapper: 0, native: 0 };
  const loadingEntered = pending(), pageEntered = pending(), cleanupEntered = pending();
  const workerEntered = pending(); let options, workerUrl;
  const doc = { numPages: pages.length, getPageLabels: async () => labels,
    getPage: async n => { pageEntered.resolve(); if (pageWait) await pageWait.promise; return { ...page,
      getTextContent: async params => { assert.equal(params.disableNormalization, true);
        assert.equal(params.includeMarkedContent, false);
        return { items: pages[n - 1], styles: {}, lang: null }; }, cleanup() {} }; } };
  const wrapper = { destroy() { counts.wrapper++; } };
  class NativePort extends EventTarget {
    postMessage() {}
    terminate() { counts.native++; }
  }
  const native = new NativePort();
  const pdfjs = { version: '6.4.299', PDFWorker: { create({ port }) {
    assert.equal(port, native); return wrapper; } }, getDocument(value) {
    options = value; loadingEntered.resolve(); documentCreate?.();
    if (transfer) structuredClone(value.data.buffer, { transfer: [value.data.buffer] });
    return { promise: loadingWait ? loadingWait.promise : Promise.resolve(doc),
      async destroy() { counts.task++; cleanupEntered.resolve(); if (destroyWait) await destroyWait.promise;
        if (destroyError) throw Error('private error'); } };
  } };
  const ready = () => native.dispatchEvent(new MessageEvent('message', { data: {
    sourceName: 'worker', targetName: 'main', action: 'ready', data: new Uint8Array() } }));
  return { pdfjs, counts, doc, native, NativePort, wrapper, loadingEntered, pageEntered,
    cleanupEntered, workerEntered, ready, options: () => options, workerUrl: () => workerUrl,
    workerFactory: url => { workerUrl = url; workerEntered.resolve(); workerCreate?.();
      if (workerReady) queueMicrotask(ready); return native; } };
}
const run = (h, extra = {}) => extractPdf(file(), { pdfjs: h.pdfjs,
  workerFactory: h.workerFactory, assetBaseUrl: 'http://localhost/browser-rag/vendor/', ...extra });
const errorCode = code => error => error?.code === code;

test('keeps exact parser text, original item index, UTF-16 quote and geometry', () => {
  const input = pageInput([item(''), item('TEST A😀B', { dir: 'rtl', hasEOL: true })]);
  const result = createPageRecord(input);
  assert.equal(result.physicalPageNumber, 1); assert.equal(result.pageLabel, 'i');
  assert.equal(result.textItems[1].itemIndex, 1);
  assert.equal(result.textItems[1].text, 'TEST A😀B');
  assert.deepEqual(result.textItems[1].span, { id: `${SHA}/pdfjs-6.4.299/text-items-v1/p1/i1/u16-0-9`,
    startUtf16: 0, endUtf16: 9, quote: 'TEST A😀B' });
  assert.deepEqual(result.geometry, { view: [0, 0, 612, 792], rotation: 0, userUnit: 1 });
  assert.equal(result.textItems[1].dir, 'rtl'); assert.equal(result.textItems[1].hasEOL, true);
  input.textContent.items[1].str = 'changed'; input.page.view[0] = 99;
  assert.equal(result.textItems[1].text, 'TEST A😀B'); assert.equal(result.geometry.view[0], 0);
  assert.throws(() => { result.textItems[1].transform[0] = 2; }, TypeError);
});
test('empty page stays explicit and an absent page label stays null', () => {
  const result = createPageRecord(pageInput([], { pageLabel: null }));
  assert.equal(result.status, 'empty'); assert.equal(result.pageLabel, null);
  assert.deepEqual(result.textItems, []);
});
test('rejects invalid source identities and malformed nonfinite geometry', () => {
  for (const overrides of [{ sourceSha256: 'not-a-hash' }, { physicalPageNumber: 0 },
    { pageLabel: 2 }, { page: { ...page, view: [0, NaN, 2, 3] } },
    { textContent: { items: [item('x', { transform: [0, 0, Infinity, 0, 1, 1] })] } }]) {
    assert.throws(() => createPageRecord(pageInput(undefined, overrides)), errorCode('INVALID_RECORD'));
  }
});
test('hashes raw bytes before parser transfer, returns records outside lifecycle metadata', async () => {
  const h = harness({ transfer: true }); const result = await run(h);
  assert.equal(result.source.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.status, 'extracted-not-indexed'); assert.equal(result.workerMode, 'native');
  assert.equal(result.numPages, 2); assert.deepEqual(result.pages.map(p => p.pageLabel), ['i', '1']);
  assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 });
  assert.equal(h.options().worker !== undefined, true);
  assert.equal(h.options().data.byteLength, 0, 'parser ownership detached the original input buffer');
});

test('native worker and auxiliary resources resolve under the vendor root', async () => {
  const h = harness(); await run(h);
  assert.equal(h.workerUrl(), 'http://localhost/browser-rag/vendor/build/pdf.worker.mjs');
  assert.equal(h.options().cMapUrl, 'http://localhost/browser-rag/vendor/cmaps/');
  assert.equal(h.options().standardFontDataUrl, 'http://localhost/browser-rag/vendor/standard_fonts/');
  assert.equal(h.options().wasmUrl, 'http://localhost/browser-rag/vendor/wasm/');
  assert.equal(h.options().iccUrl, 'http://localhost/browser-rag/vendor/iccs/');
  assert.equal(h.options().useWorkerFetch, true);
});

test('Node legacy parsing uses local filesystem asset paths with worker fetch disabled', async () => {
  const h = harness(), base = new URL('../node_modules/pdfjs-dist/', import.meta.url);
  await extractPdf(file(), { pdfjs: h.pdfjs, assetBaseUrl: base.href });
  assert.equal(h.options().standardFontDataUrl, fileURLToPath(new URL('standard_fonts/', base)).replaceAll('\\', '/'));
  assert.equal(h.options().cMapUrl, fileURLToPath(new URL('cmaps/', base)).replaceAll('\\', '/'));
  assert.equal(h.options().useWorkerFetch, false);
});

test('waits for the pinned native worker ready message before starting the parser', async () => {
  const h = harness({ workerReady: false }), result = run(h);
  await h.workerEntered.promise;
  assert.equal(h.options(), undefined);
  h.native.dispatchEvent(new MessageEvent('message', { data: { action: 'ready' } }));
  assert.equal(h.options(), undefined, 'unrelated or malformed ready messages do not start parsing');
  h.ready(); await result;
  assert.equal(h.options().worker, h.wrapper);
});

test('native startup error rejects without parser creation or fake fallback', async () => {
  const h = harness({ workerReady: false }), result = run(h);
  const rejection = assert.rejects(result, errorCode('WORKER_UNAVAILABLE'));
  await h.workerEntered.promise; h.native.dispatchEvent(new Event('error'));
  await rejection;
  assert.equal(h.options(), undefined);
  assert.deepEqual(h.counts, { task: 0, wrapper: 0, native: 1 });
});

test('native message decoding error rejects before parser creation', async () => {
  const h = harness({ workerReady: false }), result = run(h);
  const rejection = assert.rejects(result, errorCode('WORKER_UNAVAILABLE'));
  await h.workerEntered.promise; h.native.dispatchEvent(new Event('messageerror'));
  await rejection;
  assert.equal(h.options(), undefined);
  assert.deepEqual(h.counts, { task: 0, wrapper: 0, native: 1 });
});

test('native worker failure after startup rejects instead of committing the parser result', async () => {
  const h = harness();
  h.doc.getPageLabels = async () => {
    h.native.dispatchEvent(new Event('error')); return ['i', '1'];
  };
  await assert.rejects(run(h), errorCode('WORKER_UNAVAILABLE'));
  assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 });
});

test('native worker startup is bounded when the worker never sends ready', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness({ workerReady: false }), result = run(h);
  const rejection = assert.rejects(result, errorCode('WORKER_UNAVAILABLE'));
  await h.workerEntered.promise; t.mock.timers.tick(10000); await rejection;
  assert.equal(h.options(), undefined);
  assert.deepEqual(h.counts, { task: 0, wrapper: 0, native: 1 });
});

test('browser parsing refuses a factory result that is not a concrete native Worker', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class extends EventTarget {} });
    const h = harness(); await assert.rejects(run(h), errorCode('WORKER_UNAVAILABLE'));
    assert.equal(h.options(), undefined);
    assert.deepEqual(h.counts, { task: 0, wrapper: 0, native: 1 });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
    if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker); else delete globalThis.Worker;
  }
});
test('enforces file budget before reading any bytes', async () => {
  let read = false; const h = harness();
  await assert.rejects(extractPdf({ name: 'huge.pdf', size: 100, arrayBuffer() { read = true; } },
    { pdfjs: h.pdfjs, workerFactory: h.workerFactory, limits: { maxFileBytes: 99 } }),
  errorCode('FILE_TOO_LARGE'));
  assert.equal(read, false); assert.deepEqual(h.counts, { task: 0, wrapper: 0, native: 0 });
});
test('rejects a non-PDF signature without starting a worker', async () => {
  const h = harness();
  await assert.rejects(extractPdf(file(new TextEncoder().encode('not pdf')),
    { pdfjs: h.pdfjs, workerFactory: h.workerFactory,
      assetBaseUrl: 'http://localhost/browser-rag/vendor/' }), errorCode('INVALID_PDF'));
  assert.deepEqual(h.counts, { task: 0, wrapper: 0, native: 0 });
});
test('rejects invalid configured budgets before reading', async () => {
  const h = harness();
  for (const limits of [{ maxPages: -1 }, { maxTextUtf16: Infinity }, { typo: 2 },
    { maxFileBytes: 32 * 1024 * 1024 + 1 }, { maxPages: 513 },
    { maxItems: 100001 }, { maxTextUtf16: 2000001 }])
    await assert.rejects(run(h, { limits }), errorCode('INVALID_LIMITS'));
});
test('page count, total item and total text budgets fail safely with owned cleanup', async () => {
  for (const limits of [{ maxPages: 1 }, { maxItems: 1 }, { maxTextUtf16: 5 }]) {
    const h = harness(); await assert.rejects(run(h, { limits }), errorCode('EXTRACTION_LIMIT'));
    assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 });
  }
});
test('refuses an entirely empty/scanned document but retains empty pages in mixed PDFs', async () => {
  const empty = harness({ pages: [[], [item(' ')]] });
  await assert.rejects(run(empty), errorCode('EMPTY_DOCUMENT'));
  const mixed = await run(harness({ pages: [[], [item('TEST')]] }));
  assert.deepEqual(mixed.pages.map(p => p.status), ['empty', 'text']);
});
test('progress uses real page count and cancellation between pages prevents publication', async () => {
  const h = harness(); const signal = new AbortController(); const seen = [];
  await assert.rejects(run(h, { signal: signal.signal, onProgress(value) {
    seen.push(value); signal.abort(); } }), errorCode('ABORTED'));
  assert.deepEqual(seen, [{ completed: 1, total: 2, unit: 'pages', estimated: false }]);
  assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 });
});
test('abort during loading awaits cleanup and settles before late loader completion', async () => {
  const wait = pending(); const h = harness({ loadingWait: wait }); const abort = new AbortController();
  const result = run(h, { signal: abort.signal });
  await h.loadingEntered.promise; abort.abort();
  await assert.rejects(result, errorCode('ABORTED'));
  assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 });
  wait.resolve(h.doc);
});
test('abort during page await cannot return stale source records', async () => {
  const wait = pending(); const h = harness({ pageWait: wait }); const abort = new AbortController();
  const result = run(h, { signal: abort.signal });
  await h.pageEntered.promise; abort.abort();
  await assert.rejects(result, errorCode('ABORTED'));
  assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 }); wait.resolve();
});
test('already aborted selection does not read or allocate parser resources', async () => {
  const h = harness(); const abort = new AbortController(); abort.abort();
  await assert.rejects(run(h, { signal: abort.signal }), errorCode('ABORTED'));
  assert.deepEqual(h.counts, { task: 0, wrapper: 0, native: 0 });
});

test('abort during byte reading does not allocate a worker after the read resolves', async () => {
  const readEntered = pending(), readWait = pending(), h = harness(), abort = new AbortController();
  const result = extractPdf({ ...file(), arrayBuffer() { readEntered.resolve(); return readWait.promise; } },
    { pdfjs: h.pdfjs, workerFactory: h.workerFactory,
      assetBaseUrl: 'http://localhost/browser-rag/vendor/', signal: abort.signal });
  const rejection = assert.rejects(result, errorCode('ABORTED'));
  await readEntered.promise; abort.abort(); await rejection;
  readWait.resolve(bytes.slice().buffer);
  assert.deepEqual(h.counts, { task: 0, wrapper: 0, native: 0 });
});

test('abort during hashing does not allocate a worker after the digest resolves', async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const realCrypto = globalThis.crypto, hashEntered = pending(), hashWait = pending();
  const h = harness(), abort = new AbortController();
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: {
      async digest(...args) { hashEntered.resolve(); const digest = await realCrypto.subtle.digest(...args);
        await hashWait.promise; return digest; } } } });
    const result = run(h, { signal: abort.signal }), rejection = assert.rejects(result, errorCode('ABORTED'));
    await hashEntered.promise; abort.abort(); await rejection; hashWait.resolve();
    assert.deepEqual(h.counts, { task: 0, wrapper: 0, native: 0 });
  } finally { Object.defineProperty(globalThis, 'crypto', originalCrypto); hashWait.resolve(); }
});

test('abort inside native worker creation cleans up the resource returned after the abort', async () => {
  const abort = new AbortController(), h = harness({ workerCreate: () => abort.abort() });
  await assert.rejects(run(h, { signal: abort.signal }), errorCode('ABORTED'));
  assert.equal(h.options(), undefined);
  assert.equal(h.counts.native, 1);
});

test('abort inside parser creation cleans up the loading task returned after the abort', async () => {
  const abort = new AbortController(), h = harness({ documentCreate: () => abort.abort() });
  await assert.rejects(run(h, { signal: abort.signal }), errorCode('ABORTED'));
  assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 });
});

test('abort while waiting for native startup terminates without creating parser resources', async () => {
  const h = harness({ workerReady: false }), abort = new AbortController();
  const result = run(h, { signal: abort.signal }), rejection = assert.rejects(result, errorCode('ABORTED'));
  await h.workerEntered.promise; abort.abort(); await rejection;
  assert.deepEqual(h.counts, { task: 0, wrapper: 0, native: 1 });
  h.ready(); assert.equal(h.options(), undefined);
});

test('cancellation waits for asynchronous loading task cleanup before settling', async () => {
  const loadWait = pending(), destroyWait = pending();
  const h = harness({ loadingWait: loadWait, destroyWait }), abort = new AbortController();
  const result = run(h, { signal: abort.signal }); let settled = false;
  const rejection = assert.rejects(result, errorCode('ABORTED')).then(() => { settled = true; });
  await h.loadingEntered.promise; abort.abort(); await h.cleanupEntered.promise;
  assert.equal(settled, false); assert.equal(h.counts.native, 0);
  destroyWait.resolve(); await rejection;
  assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 }); loadWait.resolve(h.doc);
});

test('rejects a mismatched parser version and required PDF password with safe codes', async () => {
  const incompatible = harness(); incompatible.pdfjs.version = '6.4.298';
  await assert.rejects(run(incompatible), errorCode('PARSER_VERSION_UNSUPPORTED'));
  assert.deepEqual(incompatible.counts, { task: 0, wrapper: 0, native: 0 });
  const wait = pending(), locked = harness({ loadingWait: wait });
  const result = run(locked), rejection = assert.rejects(result, error =>
    error.code === 'PDF_PASSWORD_REQUIRED' && !error.message.includes('secret'));
  await locked.loadingEntered.promise;
  const passwordError = Error('secret password hint'); passwordError.name = 'PasswordException';
  wait.resolve(Promise.reject(passwordError)); await rejection;
  assert.deepEqual(locked.counts, { task: 1, wrapper: 1, native: 1 });
});
test('cleanup failure still terminates every owned layer and exposes no private text', async () => {
  const h = harness({ destroyError: true });
  await assert.rejects(run(h), error => error.code === 'CLEANUP_FAILED'
    && !error.message.includes('private'));
  assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 });
});

test('nonsettling loading task cleanup is bounded and still destroys wrapper and native worker', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const destroyWait = pending(), h = harness({ destroyWait });
  const result = run(h), rejection = assert.rejects(result, errorCode('CLEANUP_FAILED'));
  await h.cleanupEntered.promise;
  t.mock.timers.tick(5000); destroyWait.resolve(); await rejection;
  assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 });
});

test('waits for asynchronous caller-owned PDFWorker wrapper destruction', async () => {
  const h = harness(), wrapperEntered = pending(), wrapperWait = pending();
  h.wrapper.destroy = async () => { h.counts.wrapper++; wrapperEntered.resolve(); await wrapperWait.promise; };
  const result = run(h); let settled = false; result.then(() => { settled = true; });
  await wrapperEntered.promise;
  assert.equal(settled, false); assert.equal(h.counts.native, 0);
  wrapperWait.resolve(); await result;
  assert.deepEqual(h.counts, { task: 1, wrapper: 1, native: 1 });
});
test('actual pinned PDF.js legacy Node build parses the original labelled fixture (Node fake worker only)', async () => {
  const pdfjs = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const data = await readFile(new URL('../acceptance/selectable-test.pdf', import.meta.url));
  const result = await extractPdf(file(new Uint8Array(data)), { pdfjs,
    assetBaseUrl: new URL('../node_modules/pdfjs-dist/', import.meta.url).href });
  assert.equal(result.workerMode, 'node-fake'); assert.equal(result.parser.version, '6.4.299');
  assert.deepEqual(result.pages.map(p => p.pageLabel), ['i', '1']);
  assert.equal(result.numPages, 2);
  assert.match(result.pages[0].textItems.map(i => i.text).join(' '), /TEST SOURCE PAGE ONE/);
  assert.match(result.pages[1].textItems.map(i => i.text).join(' '), /TEST SOURCE PAGE TWO/);
  assert.equal(result.source.sha256, createHash('sha256').update(data).digest('hex'));
  assert.deepEqual(result.pages[0].geometry, { view: [0, 0, 612, 792], rotation: 0, userUnit: 1 });
  assert.ok(Object.isFrozen(result.pages[0].textItems[0].span));
  assert.equal(result.pages[0].textItems[0].span.quote, result.pages[0].textItems[0].text);
});

test('actual pinned PDF.js legacy Node build refuses the original empty PDF fixture', async () => {
  const pdfjs = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  const data = await readFile(new URL('../acceptance/empty-test.pdf', import.meta.url));
  await assert.rejects(extractPdf(file(new Uint8Array(data)), { pdfjs,
    assetBaseUrl: new URL('../node_modules/pdfjs-dist/', import.meta.url).href }), errorCode('EMPTY_DOCUMENT'));
});
