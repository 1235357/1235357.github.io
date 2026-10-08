import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPageRecord, extractPdf } from '../pdf-source.mjs';
import { chunkSource, ChunkingError } from '../chunking.mjs';

const SHA = 'a'.repeat(64);
const parser = { name: 'pdfjs', version: '6.4.299', policyVersion: 'text-items-v1',
  disableNormalization: true };
function sourceOf(texts = [['Alpha', ' Beta']], sha256 = SHA) {
  return { schemaVersion: 1, status: 'extracted-not-indexed',
    source: { name: 'owned-fixture.pdf', size: 1002, sha256 }, parser: { ...parser },
    workerMode: 'node-fake', numPages: texts.length,
    pages: texts.map((strings, index) => createPageRecord({ sourceSha256: sha256,
      parserVersion: parser.version, physicalPageNumber: index + 1,
      pageLabel: index === 0 ? 'i' : String(index),
      page: { view: [0, 0, 612, 792], rotate: 0, userUnit: 1 },
      textContent: { items: strings.map(str => ({ str, dir: 'ltr',
        transform: [1, 0, 0, 1, 30, 740], width: 120, height: 12,
        fontName: 'f1', hasEOL: false })) } })) };
}
const mutableSource = texts => structuredClone(sourceOf(texts));
const joined = page => page.textItems.filter(item => item.text.length).map(item => item.text).join('\n');
const sortedKeys = value => Object.keys(value).sort();
const errorCode = code => error => error instanceof ChunkingError
  && error.name === 'ChunkingError' && error.code === code;
function insidePair(text, offset) {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1])
    && /[\uDC00-\uDFFF]/.test(text[offset]);
}
function assertMappings(source, result) {
  assert.equal(result.counts.chunks, result.chunks.length);
  assert.equal(result.counts.outputUtf16, result.chunks.reduce((n, chunk) => n + chunk.text.length, 0));
  assert.equal(result.counts.fragments, result.chunks.reduce((n, chunk) => n + chunk.segments.length, 0));
  for (const page of source.pages) {
    const text = joined(page), chunks = result.chunks.filter(chunk =>
      chunk.physicalPageNumber === page.physicalPageNumber);
    if (page.status === 'empty') { assert.equal(chunks.length, 0); continue; }
    const coverage = new Uint32Array(text.length);
    let previousStart = -1;
    for (const chunk of chunks) {
      assert.ok(chunk.startUtf16 > previousStart); previousStart = chunk.startUtf16;
      assert.equal(chunk.pageLabel, page.pageLabel);
      assert.equal(chunk.text, text.slice(chunk.startUtf16, chunk.endUtf16));
      assert.ok(chunk.text.length > 0 && chunk.text.length <= result.chunker.maxChunkUtf16);
      assert.equal(insidePair(text, chunk.startUtf16), false);
      assert.equal(insidePair(text, chunk.endUtf16), false);
      assert.equal(chunk.id, `${source.source.sha256}/pdfjs-6.4.299/text-items-v1/`
        + `page-parser-order-v1/m${result.chunker.maxChunkUtf16}/o${result.chunker.overlapUtf16}`
        + `/p${page.physicalPageNumber}/u16-${chunk.startUtf16}-${chunk.endUtf16}`);
      let offset = 0, reconstructed = '';
      for (const segment of chunk.segments) {
        assert.equal(segment.chunkStartUtf16, offset);
        assert.ok(segment.chunkEndUtf16 > offset);
        if (segment.kind === 'source') {
          assert.deepEqual(sortedKeys(segment), ['kind', 'sourceSpanId', 'itemIndex', 'startUtf16',
            'endUtf16', 'quote', 'chunkStartUtf16', 'chunkEndUtf16'].sort());
          const item = page.textItems[segment.itemIndex];
          assert.equal(segment.sourceSpanId, item.span.id);
          assert.equal(segment.quote, item.text.slice(segment.startUtf16, segment.endUtf16));
          assert.equal(segment.quote, chunk.text.slice(offset, segment.chunkEndUtf16));
          reconstructed += segment.quote;
        } else {
          assert.equal(segment.kind, 'presentation');
          assert.deepEqual(sortedKeys(segment), ['kind', 'text', 'chunkStartUtf16', 'chunkEndUtf16'].sort());
          assert.equal(segment.text, '\n');
          assert.equal(chunk.text.slice(offset, segment.chunkEndUtf16), '\n');
          reconstructed += segment.text;
        }
        offset = segment.chunkEndUtf16;
      }
      assert.equal(offset, chunk.text.length);
      assert.equal(reconstructed, chunk.text);
      for (let n = chunk.startUtf16; n < chunk.endUtf16; n++) coverage[n]++;
    }
    assert.ok(coverage.every(count => count >= 1), 'every joined-page UTF-16 unit is covered');
  }
}

test('exact parser-item text uses attributed fragments and separate authored separators', () => {
  const source = sourceOf(), result = chunkSource(source);
  const spanPrefix = `${SHA}/pdfjs-6.4.299/text-items-v1/p1`;
  assert.deepEqual(result, { schemaVersion: 1, status: 'chunked-not-embedded',
    source: { sha256: SHA, name: 'owned-fixture.pdf', size: 1002 }, parser,
    numPages: 1, workerMode: 'node-fake', chunker: { version: 'page-parser-order-v1',
      maxChunkUtf16: 512, overlapUtf16: 64, separator: '\n', order: 'parser-item-order' },
    counts: { chunks: 1, outputUtf16: 11, fragments: 3 }, chunks: [{
      id: `${SHA}/pdfjs-6.4.299/text-items-v1/page-parser-order-v1/m512/o64/p1/u16-0-11`,
      physicalPageNumber: 1, pageLabel: 'i', startUtf16: 0, endUtf16: 11,
      text: 'Alpha\n Beta', segments: [
        { kind: 'source', sourceSpanId: `${spanPrefix}/i0/u16-0-5`, itemIndex: 0,
          startUtf16: 0, endUtf16: 5, quote: 'Alpha', chunkStartUtf16: 0, chunkEndUtf16: 5 },
        { kind: 'presentation', text: '\n', chunkStartUtf16: 5, chunkEndUtf16: 6 },
        { kind: 'source', sourceSpanId: `${spanPrefix}/i1/u16-0-5`, itemIndex: 1,
          startUtf16: 0, endUtf16: 5, quote: ' Beta', chunkStartUtf16: 6, chunkEndUtf16: 11 },
      ] }] });
  assertMappings(source, result);
});

test('skips blank physical pages but retains exact whitespace and original item indices', () => {
  const source = sourceOf([['', ' A ', ''], [], [' \t'], ['B']]);
  const result = chunkSource(source);
  assert.deepEqual(result.chunks.map(chunk => [chunk.physicalPageNumber, chunk.text]), [[1, ' A '], [4, 'B']]);
  assert.equal(result.chunks[0].segments[0].itemIndex, 1);
  assertMappings(source, result);
});

test('an entirely blank source reports EMPTY_SOURCE', () => {
  assert.throws(() => chunkSource(sourceOf([[], ['', ' \t\n']])), errorCode('EMPTY_SOURCE'));
});

test('null-prototype options and native worker metadata are accepted', () => {
  const source = mutableSource(); source.workerMode = 'native';
  const options = Object.assign(Object.create(null), { maxChunkUtf16: 4, overlapUtf16: 1 });
  const result = chunkSource(source, options);
  assert.equal(result.workerMode, 'native'); assertMappings(source, result);
});

test('honors known non-enumerable options and refuses their undefined values', () => {
  const options = Object.defineProperties({}, { maxChunkUtf16: { value: 4 }, overlapUtf16: { value: 1 } });
  const result = chunkSource(sourceOf(), options);
  assert.equal(result.chunker.maxChunkUtf16, 4); assert.equal(result.chunker.overlapUtf16, 1);
  const undefinedOption = Object.defineProperty({}, 'maxChunkUtf16', { value: undefined });
  assert.throws(() => chunkSource(sourceOf(), undefinedOption), errorCode('INVALID_CONFIG'));
});

const invalidOptions = [null, [], true, 2, 'bad', new Date(), Object.create({ inherited: true }),
  { typo: 2 }, { [Symbol('unknown')]: 1 }, { maxChunkUtf16: undefined },
  { maxChunkUtf16: 1 }, { maxChunkUtf16: 4097 }, { maxChunkUtf16: NaN },
  { maxChunkUtf16: Infinity }, { maxChunkUtf16: 2.5 }, { maxChunkUtf16: '4' },
  { maxChunkUtf16: 2 }, { overlapUtf16: -1 }, { overlapUtf16: 512 },
  { overlapUtf16: NaN }, { overlapUtf16: Infinity }, { overlapUtf16: 0.5 },
  { overlapUtf16: undefined }, ...['maxChunks', 'maxOutputUtf16', 'maxFragments'].flatMap(key =>
    [0, -1, NaN, Infinity, 1.5, undefined].map(value => ({ [key]: value }))),
  { maxChunks: 10001 }, { maxOutputUtf16: 4000001 }, { maxFragments: 200001 }];
for (const [index, options] of invalidOptions.entries()) {
  test(`rejects invalid configuration ${index + 1}`, () => {
    assert.throws(() => chunkSource(sourceOf(), options), errorCode('INVALID_CONFIG'));
  });
}

const invalidMutations = {
  schema: s => { s.schemaVersion = 2; }, status: s => { s.status = 'chunked-not-embedded'; },
  missingSource: s => { s.source = null; }, hash: s => { s.source.sha256 = 'A'.repeat(64); },
  shortHash: s => { s.source.sha256 = 'a'.repeat(63); }, name: s => { s.source.name = 4; },
  zeroSize: s => { s.source.size = 0; }, fractionalSize: s => { s.source.size = 1.5; },
  unsafeSize: s => { s.source.size = Number.MAX_SAFE_INTEGER + 1; },
  missingParser: s => { s.parser = null; }, parserName: s => { s.parser.name = 'other'; },
  parserVersion: s => { s.parser.version = '6.4.298'; }, parserPolicy: s => { s.parser.policyVersion = 'v2'; },
  normalization: s => { s.parser.disableNormalization = false; },
  worker: s => { s.workerMode = 'fallback'; }, pageCount: s => { s.numPages = 2; },
  zeroPages: s => { s.numPages = 0; }, fractionalPages: s => { s.numPages = 1.5; },
  missingPages: s => { s.pages = null; }, sparsePages: s => { delete s.pages[0]; },
  physicalPage: s => { s.pages[0].physicalPageNumber = 2; }, label: s => { s.pages[0].pageLabel = 4; },
  missingLabel: s => { delete s.pages[0].pageLabel; }, pageHash: s => { s.pages[0].sourceSha256 = 'b'.repeat(64); },
  pageParser: s => { s.pages[0].parserVersion = '6.4.298'; }, pagePolicy: s => { s.pages[0].policyVersion = 'v2'; },
  pageStatus: s => { s.pages[0].status = 'empty'; }, noItems: s => { s.pages[0].textItems = null; },
  sparseItems: s => { delete s.pages[0].textItems[0]; }, reversedItems: s => { s.pages[0].textItems.reverse(); },
  duplicateIndex: s => { s.pages[0].textItems[1].itemIndex = 0; },
  nonString: s => { s.pages[0].textItems[0].text = 4; },
  noSpan: s => { s.pages[0].textItems[0].span = null; },
  spanId: s => { s.pages[0].textItems[0].span.id += '-wrong'; },
  spanStart: s => { s.pages[0].textItems[0].span.startUtf16 = 1; },
  spanEnd: s => { s.pages[0].textItems[0].span.endUtf16 = 4; },
  spanQuote: s => { s.pages[0].textItems[0].span.quote = 'different'; },
};
for (const [name, mutate] of Object.entries(invalidMutations)) {
  test(`rejects inconsistent source field: ${name}`, () => {
    const source = mutableSource(); mutate(source);
    assert.throws(() => chunkSource(source), errorCode('INVALID_SOURCE'));
  });
}

test('rejects null and non-record source inputs with a safe error', () => {
  for (const source of [undefined, null, [], true, 1, 'private document text'])
    assert.throws(() => chunkSource(source), errorCode('INVALID_SOURCE'));
});

const sourceRecordPaths = {
  root: [], header: ['source'], parser: ['parser'], page: ['pages', 0],
  item: ['pages', 0, 'textItems', 0], span: ['pages', 0, 'textItems', 0, 'span'],
};
const nonJsonRecordFactories = {
  Date: value => Object.assign(new Date(0), value),
  class: value => Object.assign(new class CustomRecord {}(), value),
  inherited: value => Object.create(value),
};
for (const [recordName, path] of Object.entries(sourceRecordPaths)) {
  for (const [prototypeName, wrap] of Object.entries(nonJsonRecordFactories)) {
    test(`rejects non-JSON record prototypes: ${recordName} ${prototypeName}`, () => {
      let source = mutableSource();
      if (!path.length) source = wrap(source);
      else {
        const parent = path.slice(0, -1).reduce((value, key) => value[key], source);
        const key = path.at(-1); parent[key] = wrap(parent[key]);
      }
      assert.throws(() => chunkSource(source), errorCode('INVALID_SOURCE'));
    });
  }
}

for (const [recordName, path] of Object.entries(sourceRecordPaths)) {
  for (const [prototypeName, prototype] of [['Object.prototype', Object.prototype], ['null', null]]) {
    test(`rejects re-prototyped arrays as records: ${recordName} ${prototypeName}`, () => {
      let source = mutableSource();
      const wrap = value => Object.assign(Object.setPrototypeOf([], prototype), value);
      if (!path.length) source = wrap(source);
      else {
        const parent = path.slice(0, -1).reduce((value, key) => value[key], source);
        const key = path.at(-1); parent[key] = wrap(parent[key]);
      }
      assert.throws(() => chunkSource(source), errorCode('INVALID_SOURCE'));
    });
  }
}

test('accepts null-prototype source records at every consumed record boundary', () => {
  const nullRecords = value => {
    if (Array.isArray(value)) return value.map(nullRecords);
    if (value !== null && typeof value === 'object') {
      const result = Object.create(null);
      for (const [key, child] of Object.entries(value)) result[key] = nullRecords(child);
      return result;
    }
    return value;
  };
  const source = nullRecords(sourceOf()), result = chunkSource(source);
  assert.equal(result.chunks[0].text, 'Alpha\n Beta'); assertMappings(source, result);
});

test('rejects reversed physical pages instead of silently reordering them', () => {
  const source = mutableSource([['First'], ['Second']]); source.pages.reverse();
  assert.throws(() => chunkSource(source), errorCode('INVALID_SOURCE'));
});

test('validates every page before joining even after an earlier nonblank page', () => {
  const source = mutableSource([['Alpha'], [' \t']]); source.pages[1].status = 'text';
  assert.throws(() => chunkSource(source), errorCode('INVALID_SOURCE'));
});

test('does not require or copy unused page geometry or item metadata', () => {
  const source = mutableSource(); delete source.pages[0].geometry;
  for (const item of source.pages[0].textItems) {
    delete item.transform; delete item.dir; delete item.fontName;
  }
  const result = chunkSource(source); assertMappings(source, result);
  assert.equal('geometry' in result.chunks[0], false);
});

test('rejects over-limit page and full item arrays before scanning entries', () => {
  const tooManyPages = mutableSource(); tooManyPages.numPages = 513;
  tooManyPages.pages = Array(513).fill(tooManyPages.pages[0]);
  assert.throws(() => chunkSource(tooManyPages), errorCode('INVALID_SOURCE'));
  const tooManyItems = mutableSource();
  tooManyItems.pages[0].textItems = Array(100001).fill(tooManyItems.pages[0].textItems[0]);
  assert.throws(() => chunkSource(tooManyItems), errorCode('INVALID_SOURCE'));
  const sparseItems = mutableSource(); sparseItems.pages[0].textItems = new Array(2 ** 32 - 1);
  assert.throws(() => chunkSource(sparseItems), errorCode('INVALID_SOURCE'));
});

test('enforces aggregate item and UTF-16 input caps across pages', () => {
  const tooManyItems = mutableSource([Array(50000).fill(''), Array(50001).fill('')]);
  assert.throws(() => chunkSource(tooManyItems), errorCode('INVALID_SOURCE'));
  const tooMuchText = sourceOf([['A'.repeat(1000000)], ['B'.repeat(1000001)]]);
  assert.throws(() => chunkSource(tooMuchText), errorCode('INVALID_SOURCE'));
});

test('preserves valid surrogate pairs even with a two-unit window', () => {
  const source = sourceOf([['A😀B']]), result = chunkSource(source, { maxChunkUtf16: 2, overlapUtf16: 0 });
  assert.deepEqual(result.chunks.map(c => [c.startUtf16, c.endUtf16, c.text]), [[0, 1, 'A'], [1, 3, '😀'], [3, 4, 'B']]);
  assertMappings(source, result);
});

test('surrogate-aware next offsets advance with high overlap', () => {
  const source = sourceOf([['😀😀😀A']]), result = chunkSource(source, { maxChunkUtf16: 2, overlapUtf16: 1 });
  assert.deepEqual(result.chunks.map(c => c.text), ['😀', '😀', '😀', 'A']);
  assertMappings(source, result);
});

test('preserves lone surrogate units and mixed Unicode without normalization', () => {
  const source = sourceOf([['\uD800x\uDC00😀e\u0301\uD800\uD800\uDC00Z']]);
  for (const overlapUtf16 of [0, 1, 2]) {
    const result = chunkSource(source, { maxChunkUtf16: 3, overlapUtf16 });
    assertMappings(source, result);
  }
});

test('maximum overlap covers every character with strictly increasing starts', () => {
  const source = sourceOf([['abcdefgh']]), result = chunkSource(source, { maxChunkUtf16: 4, overlapUtf16: 3 });
  assert.equal(result.counts.chunks, 5);
  assert.deepEqual(result.chunks.map(c => c.startUtf16), [0, 1, 2, 3, 4]);
  assertMappings(source, result);
});

test('retains whitespace-only windows inside a nonblank page', () => {
  const source = sourceOf([['A    B']]), result = chunkSource(source, { maxChunkUtf16: 2, overlapUtf16: 0 });
  assert.deepEqual(result.chunks.map(c => c.text), ['A ', '  ', ' B']); assertMappings(source, result);
});

test('chunk identity changes with source, window and physical page but not label', () => {
  const source = sourceOf([['abcdef']]), options = { maxChunkUtf16: 4, overlapUtf16: 1 };
  const id = chunkSource(source, options).chunks[0].id;
  assert.equal(chunkSource(source, options).chunks[0].id, id);
  assert.notEqual(chunkSource(sourceOf([['abcdef']], 'b'.repeat(64)), options).chunks[0].id, id);
  assert.notEqual(chunkSource(source, { ...options, maxChunkUtf16: 5 }).chunks[0].id, id);
  assert.notEqual(chunkSource(source, { ...options, overlapUtf16: 0 }).chunks[0].id, id);
  assert.notEqual(chunkSource(sourceOf([[], ['abcdef']]), options).chunks[0].id, id);
  const relabelled = structuredClone(source); relabelled.pages[0].pageLabel = 'custom';
  assert.equal(chunkSource(relabelled, options).chunks[0].id, id);
  relabelled.pages[0].pageLabel = null;
  assert.equal(chunkSource(relabelled, options).chunks[0].pageLabel, null);
});

test('returns an exactly shaped detached, deeply frozen artifact without freezing the input', () => {
  const source = mutableSource(), before = structuredClone(source), result = chunkSource(source);
  assert.deepEqual(source, before); assert.equal(Object.isFrozen(source), false);
  assert.equal(Object.isFrozen(source.pages[0].textItems[0].span), false);
  const visit = value => {
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) visit(child);
    }
  };
  visit(result);
  assert.deepEqual(sortedKeys(result), ['schemaVersion', 'status', 'source', 'parser', 'numPages',
    'workerMode', 'chunker', 'counts', 'chunks'].sort());
  assert.deepEqual(sortedKeys(result.chunks[0]), ['id', 'physicalPageNumber', 'pageLabel',
    'startUtf16', 'endUtf16', 'text', 'segments'].sort());
  source.source.name = 'later'; source.parser.version = 'later'; source.pages[0].textItems[0].text = 'later';
  assert.equal(result.source.name, 'owned-fixture.pdf'); assert.equal(result.parser.version, '6.4.299');
  assert.equal(result.chunks[0].text, 'Alpha\n Beta');
  assert.throws(() => { result.chunks[0].segments[0].quote = 'changed'; }, TypeError);
});

test('exact output budgets pass and one-below budgets throw without a partial return', () => {
  const source = sourceOf([['abcd']]), options = { maxChunkUtf16: 2, overlapUtf16: 0,
    maxChunks: 2, maxOutputUtf16: 4, maxFragments: 2 };
  const result = chunkSource(source, options);
  assert.deepEqual(result.counts, { chunks: 2, outputUtf16: 4, fragments: 2 }); assertMappings(source, result);
  for (const key of ['maxChunks', 'maxOutputUtf16', 'maxFragments']) {
    let returned = null;
    assert.throws(() => { returned = chunkSource(source, { ...options, [key]: options[key] - 1 }); }, errorCode('CHUNK_LIMIT'));
    assert.equal(returned, null);
  }
});

test('authored newline fragments consume the exact fragment budget', () => {
  const source = sourceOf([['A', 'B']]);
  const result = chunkSource(source, { maxFragments: 3 });
  assert.equal(result.counts.fragments, 3); assertMappings(source, result);
  assert.throws(() => chunkSource(source, { maxFragments: 2 }), errorCode('CHUNK_LIMIT'));
});

test('overlapped chunks consume the chunk budget before any partial result can return', () => {
  const source = sourceOf([['abcdefgh']]), options = { maxChunkUtf16: 4, overlapUtf16: 3 };
  assert.equal(chunkSource(source, { ...options, maxChunks: 5 }).counts.chunks, 5);
  let returned = null;
  assert.throws(() => { returned = chunkSource(source, { ...options, maxChunks: 4 }); }, errorCode('CHUNK_LIMIT'));
  assert.equal(returned, null);
});

test('errors expose only fixed generic messages and supported safe codes', () => {
  const secret = 'private document text';
  for (const code of ['INVALID_SOURCE', 'INVALID_CONFIG', 'CHUNK_LIMIT', 'EMPTY_SOURCE']) {
    const error = new ChunkingError(code);
    assert.equal(error.code, code); assert.equal(error.name, 'ChunkingError');
    assert.equal(typeof error.message, 'string'); assert.ok(error.message.length > 0);
    assert.equal(error.message.includes(secret), false);
  }
  const source = mutableSource([[secret]]); source.source.name = secret;
  const errors = [];
  for (const mutate of [s => { s.pages[0].textItems[0].span.quote = 'wrong'; },
    s => { s.pages[0].textItems[0].span.id = secret; }]) {
    const candidate = structuredClone(source); mutate(candidate);
    try { chunkSource(candidate); } catch (error) { errors.push(error); }
  }
  assert.equal(errors.length, 2); assert.equal(errors[0].message, errors[1].message);
  assert.equal(errors[0].message, new ChunkingError('INVALID_SOURCE').message);
  assert.equal(errors[0].message.includes(secret), false);
});

test('direct error construction cannot expose an arbitrary private code or message', () => {
  for (const code of ['private document text', '__proto__', undefined, Symbol('private')]) {
    const error = new ChunkingError(code);
    assert.equal(error.code, 'INVALID_SOURCE');
    assert.equal(error.message, new ChunkingError('INVALID_SOURCE').message);
  }
});

for (const fixture of ['selectable-test.pdf', 'pagination-test.pdf']) {
  test(`actual legacy PDF.js extraction maps all chunks from ${fixture} (Node fake worker only)`, async () => {
    const pdfjs = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const bytes = await readFile(new URL(`../acceptance/${fixture}`, import.meta.url));
    const source = await extractPdf({ name: fixture, size: bytes.byteLength,
      arrayBuffer: async () => new Uint8Array(bytes).slice().buffer }, { pdfjs,
      assetBaseUrl: new URL('../node_modules/pdfjs-dist/', import.meta.url).href });
    assert.equal(source.source.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(source.workerMode, 'node-fake'); assert.deepEqual(source.pages.map(p => p.pageLabel), ['i', '1']);
    if (fixture === 'pagination-test.pdf') assert.equal(source.pages[0].textItems.length, 240);
    const result = chunkSource(source, { maxChunkUtf16: 32, overlapUtf16: 8 });
    assert.equal(result.numPages, 2);
    assert.equal(result.workerMode, 'node-fake'); assertMappings(source, result);
  });
}
