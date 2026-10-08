import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPageRecord} from '../pdf-source.mjs';
import {createPdfSession} from '../pdf-session.mjs';

const windowModule = await import('../item-window.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return null;
});
const getItemWindow = windowModule?.getItemWindow ?? (() => assert.fail('The fixed-size item preview window is missing.'));

test('item windows expose at most 100 positions without changing the total', () => {
  assert.deepEqual(getItemWindow(100000, 0), {
    start: 0, end: 100, total: 100000, windowIndex: 0, windowCount: 1000,
    hasPrevious: false, hasNext: true,
  });
  assert.deepEqual(getItemWindow(251, 1), {
    start: 100, end: 200, total: 251, windowIndex: 1, windowCount: 3,
    hasPrevious: true, hasNext: true,
  });
  assert.equal(getItemWindow(251, 2).end, 251);
});

test('empty and single windows have no navigation destinations', () => {
  assert.deepEqual(getItemWindow(0), {
    start: 0, end: 0, total: 0, windowIndex: 0, windowCount: 0,
    hasPrevious: false, hasNext: false,
  });
  for (const total of [1, 99, 100]) {
    const result = getItemWindow(total);
    assert.equal(result.start, 0);
    assert.equal(result.end, total);
    assert.equal(result.hasPrevious, false);
    assert.equal(result.hasNext, false);
  }
});

test('valid out-of-range requests clamp to a complete existing window', () => {
  assert.equal(getItemWindow(251, -1).windowIndex, 0);
  assert.deepEqual(getItemWindow(251, 500), getItemWindow(251, 2));
  assert.deepEqual(getItemWindow(0, 500), getItemWindow(0));
  const largest = getItemWindow(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  assert.equal(largest.end, Number.MAX_SAFE_INTEGER);
  assert.ok(largest.end - largest.start <= 100);
  assert.equal(largest.hasNext, false);
});

test('malformed totals and window requests are rejected', () => {
  for (const total of [-1, 1.5, '100', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => getItemWindow(total), TypeError);
  }
  for (const requested of [1.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => getItemWindow(100, requested), TypeError);
  }
});

// Only browser DOM primitives and the PDF extraction boundary are substituted.
// The actual pdf-app body, real session controller and frozen source records run.
class DomElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase(); this.children = []; this.listeners = new Map();
    this._text = ''; this._value = ''; this.disabled = false; this.open = false;
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  append(...nodes) {
    this.children.push(...nodes);
    if (this.tagName === 'SELECT' && this._value === '' && nodes.length) this.value = nodes[0].value;
  }
  replaceChildren(...nodes) {
    this.children = []; this._text = '';
    if (this.tagName === 'SELECT') this._value = '';
    this.append(...nodes);
  }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  dispatch(name) { for (const listener of this.listeners.get(name) ?? []) listener({target: this}); }
}

const appText = await readFile(new URL('../pdf-app.mjs', import.meta.url), 'utf8');
const htmlText = await readFile(new URL('../inspector.html', import.meta.url), 'utf8');
const elementsOf = (element, tag) => element.children.flatMap(child => [
  ...(child.tagName === tag.toUpperCase() ? [child] : []), ...elementsOf(child, tag),
]);

function sourceRecord(name, counts) {
  const sha256 = 'a'.repeat(64);
  const pages = counts.map((count, index) => createPageRecord({sourceSha256: sha256,
    parserVersion: '6.4.299', physicalPageNumber: index + 1, pageLabel: `label-${index + 1}`,
    page: {view: [0, 0, 612, 792], rotate: 0, userUnit: 1},
    textContent: {items: Array.from({length: count}, (_, itemIndex) => ({
      str: itemIndex === 0 ? '<img src=x onerror=alert(1)>' : `${name} page ${index + 1} item ${itemIndex}`,
      dir: 'ltr', transform: [1, 0, 0, 1, 10, 10], width: 10, height: 10, fontName: 'F1', hasEOL: false,
    }))},
  }));
  return Object.freeze({status: 'extracted-not-indexed',
    source: Object.freeze({name, sha256, size: 8}), parser: Object.freeze({version: '6.4.299'}),
    workerMode: 'native', numPages: pages.length, pages: Object.freeze(pages)});
}

function appHarness(sources) {
  const ids = new Map();
  for (const id of ['pdf-file', 'page-select', 'items', 'receipt', 'page-meta', 'status-title',
    'status-detail', 'cancel', 'clear', 'trace', 'items-first', 'items-previous', 'items-next', 'items-range']) {
    ids.set(id, new DomElement(id === 'page-select' ? 'select' : 'div'));
  }
  const document = {getElementById: id => ids.get(id), createElement: tag => new DomElement(tag)};
  const allItems = new Set(sources.flatMap(source => source.pages.flatMap(page => page.textItems)));
  const serializedItems = [];
  const checkedJson = {...JSON, stringify(value, ...args) {
    if (allItems.has(value)) serializedItems.push(value);
    return JSON.stringify(value, ...args);
  }};
  let session;
  const executable = appText.replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(new URL('../pdf-app.mjs', import.meta.url).href));
  const run = new Function('document', 'window', 'Worker', 'pdfjs', 'extractPdf',
    'createPdfSession', 'getItemWindow', 'JSON', executable);
  run(document, {addEventListener() {}}, class {}, {}, async file => sources.find(source => source.source.name === file.name),
    options => { session = createPdfSession({...options, runtimeId: 'preview-test'}); return session; }, getItemWindow, checkedJson);
  return {ids, serializedItems, select: name => session.select({name}), source: () => session.document(),
    rows: () => elementsOf(ids.get('items'), 'article')};
}

test('the actual app renders only the first 100 records and preserves hostile text as text', async () => {
  const source = sourceRecord('A', [251]); const app = appHarness([source]);
  await app.select('A');
  assert.equal(app.rows().length, 100);
  assert.equal(app.rows()[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(elementsOf(app.ids.get('items'), 'img').length, 0);
  assert.equal(app.source(), source);
  assert.equal(source.pages[0].textItems.length, 251);
  assert.equal(Object.isFrozen(source.pages[0].textItems), true);
  assert.match(app.ids.get('items-range').textContent, /1\D+100.*251/);
  assert.equal(app.ids.get('items-first').disabled, true);
  assert.equal(app.ids.get('items-previous').disabled, true);
  assert.equal(app.ids.get('items-next').disabled, false);
});

test('the actual app reaches every record through next previous and first controls', async () => {
  const source = sourceRecord('A', [251]); const app = appHarness([source]);
  await app.select('A');
  app.ids.get('items-next').dispatch('click');
  assert.equal(app.rows().length, 100);
  assert.match(app.rows()[0].children[0].textContent, /^ITEM 100 /);
  assert.match(app.ids.get('items-range').textContent, /101\D+200.*251/);
  app.ids.get('items-next').dispatch('click');
  assert.equal(app.rows().length, 51);
  assert.match(app.rows()[50].children[0].textContent, /^ITEM 250 /);
  assert.equal(app.ids.get('items-next').disabled, true);
  app.ids.get('items-previous').dispatch('click');
  assert.match(app.rows()[0].children[0].textContent, /^ITEM 100 /);
  app.ids.get('items-first').dispatch('click');
  assert.match(app.rows()[0].children[0].textContent, /^ITEM 0 /);
  assert.equal(app.source(), source);
  assert.equal(source.pages[0].textItems[250].text, 'A page 1 item 250');
});

test('the actual app serializes item details only while opened and releases text when closed', async () => {
  const app = appHarness([sourceRecord('A', [251])]); await app.select('A');
  assert.equal(app.serializedItems.length, 0, 'Collapsed item details must not serialize source records.');
  assert.equal(elementsOf(app.ids.get('items'), 'pre').length, 0);
  const detail = elementsOf(app.rows()[0], 'details')[0];
  detail.open = true; detail.dispatch('toggle');
  assert.equal(app.serializedItems.length, 1);
  assert.equal(elementsOf(detail, 'pre').length, 1);
  assert.match(elementsOf(detail, 'pre')[0].textContent, /"itemIndex": 0/);
  detail.open = false; detail.dispatch('toggle');
  assert.equal(elementsOf(detail, 'pre').length, 0);
  assert.equal(detail.children.length, 1, 'The summary remains available after releasing generated JSON text.');
  detail.open = true; detail.dispatch('toggle');
  assert.equal(app.serializedItems.length, 2);
});

test('the actual app resets the preview when physical page or source changes', async () => {
  const a = sourceRecord('A', [251, 201, 0]), b = sourceRecord('B', [202]);
  const app = appHarness([a, b]); await app.select('A');
  app.ids.get('items-next').dispatch('click');
  app.ids.get('page-select').value = 1; app.ids.get('page-select').dispatch('change');
  assert.match(app.rows()[0].children[0].textContent, /^ITEM 0 /);
  assert.match(app.ids.get('items-range').textContent, /1\D+100.*201/);
  app.ids.get('items-next').dispatch('click');
  await app.select('B');
  assert.match(app.rows()[0].children[0].textContent, /^ITEM 0 /);
  assert.match(app.ids.get('items-range').textContent, /1\D+100.*202/);
  await app.select('A');
  app.ids.get('page-select').value = 2; app.ids.get('page-select').dispatch('change');
  assert.equal(app.rows().length, 0);
  assert.match(app.ids.get('items-range').textContent, /0.*0/);
  for (const id of ['items-first', 'items-previous', 'items-next']) assert.equal(app.ids.get(id).disabled, true);
  app.ids.get('clear').dispatch('click');
  assert.equal(app.source(), null);
  assert.match(app.ids.get('items-range').textContent, /0.*0/);
});

test('the source inspector has visible accessible item navigation without inline handlers', () => {
  for (const id of ['items-first', 'items-previous', 'items-next', 'items-range']) {
    assert.match(htmlText, new RegExp(`id="${id}"`));
  }
  assert.match(htmlText, /aria-label="Text item preview"/);
  assert.doesNotMatch(htmlText, /\son(?:click|change|toggle)=/i);
  assert.doesNotMatch(appText, /\.innerHTML\s*=/);
});
