import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../lab-presentation.js', import.meta.url), 'utf8');
const inaccessible = new Proxy({}, {get(_target, property) {
  throw new Error(`Presentation must not inspect another window: ${String(property)}`);
}});

function observe({embedded}) {
  const classes = new Set(['existing-theme']);
  const access = [];
  const self = {};
  const window = new Proxy({self, top: embedded ? inaccessible : self}, {
    get(target, property) {
      assert.ok(property === 'self' || property === 'top', `Unexpected window access: ${String(property)}`);
      access.push(property);
      return target[property];
    },
    set() { assert.fail('Presentation must not change a window property'); },
  });
  const document = new Proxy({}, {get(_target, property) {
    assert.equal(property, 'documentElement');
    assert.ok(embedded, 'Standalone presentation must leave the document alone');
    return {classList: {add: value => classes.add(value)}};
  }, set() { assert.fail('Presentation must not change document ownership or content'); }});
  vm.runInNewContext(script, {window, document}, {timeout: 1000});
  return {classes: [...classes], access};
}

test('standalone lab keeps its introduction and existing document untouched', () => {
  const result = observe({embedded: false});
  assert.deepEqual(result.classes, ['existing-theme']);
  assert.deepEqual(result.access, ['self', 'top']);
});

test('every embedded lab selects compact presentation without reading its host or starting work', () => {
  const result = observe({embedded: true});
  assert.deepEqual(result.classes, ['existing-theme', 'embedded-lab']);
  assert.deepEqual(result.access, ['self', 'top']);
});

test('shared early classic script runs under the existing CSP before styles and every module profile', () => {
  const template = readFileSync(new URL('../inspector.html', import.meta.url), 'utf8');
  const bootstrap = '<script src="lab-presentation.js"></script>';
  assert.equal(template.split(bootstrap).length - 1, 1);
  assert.ok(template.indexOf('Content-Security-Policy') < template.indexOf(bootstrap));
  assert.ok(template.indexOf(bootstrap) < template.indexOf('<link rel="stylesheet"'));
  assert.doesNotMatch(template, /unsafe-inline|<script\s+(?:async|defer)/);
  assert.match(template, /<h1 id="lab-title">Ask your document\./);
  for (const entry of ['pdf-entry.mjs', 'pdf-public-entry.mjs', 'pdf-private-entry.mjs']) {
    const markup = template.replace('src="pdf-entry.mjs"', `src="${entry}"`);
    assert.ok(markup.indexOf(bootstrap) < markup.indexOf(`src="${entry}"`), entry);
    assert.match(readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8'), /mountPdfApp\(/);
  }
});
