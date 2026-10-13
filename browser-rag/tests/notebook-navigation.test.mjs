import test from 'node:test';
import assert from 'node:assert/strict';
import {installNotebookNavigation} from '../notebook-navigation.mjs';

// Small event/DOM doubles test navigation ownership, not browser rendering.
function fixture(hash = '') {
  const listeners = new Map(), windowListeners = new Map();
  const summary = {focus(options) {this.focusOptions = options;}};
  const notebook = {tagName: 'DETAILS', open: false, parentElement: null,
    querySelector: () => summary, contains: node => node === notebook || node === section,
    scrollIntoView(options) {this.scrollOptions = options;}};
  const section = {tagName: 'SECTION', parentElement: notebook,
    focus(options) {this.focusOptions = options;},
    scrollIntoView(options) {this.scrollOptions = options;}};
  const document = {getElementById: id => id === 'computation-notebook' ? notebook : id === 'notebook-source' ? section : null,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {if (listeners.get(type) === fn) listeners.delete(type);}};
  const window = {location: {href: `https://example.test/inspector.html${hash}`, hash},
    addEventListener: (type, fn) => windowListeners.set(type, fn),
    removeEventListener: (type, fn) => {if (windowListeners.get(type) === fn) windowListeners.delete(type);}};
  const dispose = installNotebookNavigation(document, window);
  function click(href, options = {}) {
    const link = {href, target: options.target || '', hasAttribute: name => name === 'download' && !!options.download};
    const event = {button: 0, target: {closest: () => link}, ...options};
    listeners.get('click')?.(event);
    return event;
  }
  return {notebook, section, summary, listeners, windowListeners, window, click, dispose};
}

test('notebook link reveals the promised content and focuses summary without cancelling native history', () => {
  const f = fixture();
  const event = f.click('#computation-notebook');
  assert.equal(f.notebook.open, true);
  assert.deepEqual(f.summary.focusOptions, {preventScroll: true});
  assert.equal(f.notebook.scrollOptions.behavior, 'instant');
  assert.equal(event.defaultPrevented, undefined);
});
test('direct section link opens its closed notebook and focuses only that destination', () => {
  const f = fixture();
  f.click('#notebook-source');
  assert.equal(f.notebook.open, true);
  assert.deepEqual(f.section.focusOptions, {preventScroll: true});
  assert.equal(f.summary.focusOptions, undefined);
});
test('initial URL, same-hash revisit and history hash changes all reveal the destination', () => {
  const f = fixture('#notebook-source');
  assert.equal(f.notebook.open, true);
  f.notebook.open = false;
  f.click('#notebook-source');
  assert.equal(f.notebook.open, true);
  f.notebook.open = false;
  f.window.location.hash = '#computation-notebook';
  f.windowListeners.get('hashchange')();
  assert.equal(f.notebook.open, true);
  assert.ok(f.summary.focusOptions);
});
test('modified, handled, download and new-tab clicks leave current notebook untouched', () => {
  for (const options of [{ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {altKey: true},
    {button: 1}, {defaultPrevented: true}, {download: true}, {target: '_blank'}]) {
    const f = fixture();
    f.click('#notebook-source', options);
    assert.equal(f.notebook.open, false);
  }
});
test('external pages, distinct query entries and unrelated or malformed fragments are never intercepted', () => {
  for (const href of ['https://other.test/inspector.html#notebook-source', '/other.html#notebook-source',
    '?entry=private#notebook-source', '#lab-workspace', '#notebook-missing', '#%E0%A4%A']) {
    const f = fixture();
    f.click(href);
    assert.equal(f.notebook.open, false);
  }
});
test('navigation cannot reveal an ID outside the owned notebook and disposal removes both listeners', () => {
  const f = fixture();
  f.notebook.contains = () => false;
  f.click('#notebook-source');
  assert.equal(f.notebook.open, false);
  f.dispose();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.windowListeners.size, 0);
});
