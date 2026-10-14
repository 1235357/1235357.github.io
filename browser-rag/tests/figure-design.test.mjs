import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const figures = new URL('../../figures/', import.meta.url);
const names = fs.readdirSync(figures).filter(name => name.endsWith('.archify.html')).sort();

test('all figure interfaces share the portfolio font across visual presets', () => {
  assert.equal(names.length, 8);
  for (const name of names) {
    const html = fs.readFileSync(new URL(name, figures), 'utf8');
    const policy = html.match(/<style id="site-figure-typography">([\s\S]*?)<\/style>/)?.[1];
    assert.ok(policy, `${name}: shared interface typography is present`);
    assert.match(policy, /font-family:\s*Manrope/);
    assert.match(policy, /\.\.\/assets\/typography\/Manrope-Variable\.ttf/);
    assert.match(policy, /\.card\s*\{\s*overflow-wrap:\s*anywhere;\s*\}/,
      `${name}: complete source hashes in cards wrap instead of widening the page`);
    for (const selector of ['body', 'html[data-preset] h1', 'html[data-preset] .card h3',
      'html[data-preset] .header-row::after', 'html[data-preset] .diagram-container::after']) {
      assert.ok(policy.includes(selector), `${name}: ${selector} stays in the shared UI family`);
    }
    assert.ok(html.indexOf('id="site-figure-typography"') > html.indexOf('font-family: Georgia'),
      `${name}: shared typography wins over preset fonts`);
  }
});

for (const name of names) {
  for (const entry of ['rasterize', 'renderShareCard', 'recordWebm']) {
    test(`${name}: ${entry} waits for actual shared-font availability before drawing`, async () => {
      const html = fs.readFileSync(new URL(name, figures), 'utf8');
      const helper = html.match(/      \/\/ Shared interface font export gate\n([\s\S]*?)      \/\/ End shared interface font export gate/);
      assert.ok(helper, `${name}: export font gate exists`);
      const wrapper = html.match(new RegExp(`      function ${entry}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n      \\}\\n\\n      function ${entry}Ready`));
      assert.ok(wrapper, `${name}: ${entry} uses the font gate`);
      let releases = [], loads = [], drawings = 0;
      const fonts = {load(spec) {loads.push(spec); return new Promise(resolve => releases.push(resolve));}};
      const context = vm.createContext({document: {fonts}, Promise, Error,
        [entry + 'Ready']: arg => {drawings++; return arg;}});
      vm.runInContext(helper[1] + `\nfunction ${entry}(${wrapper[1]}) {${wrapper[2]}\n}`, context);
      const pending = vm.runInContext(`${entry}('requested-output')`, context);
      await Promise.resolve();
      assert.equal(drawings, 0, 'no raster, share-card or recorder work while fonts are pending');
      assert.deepEqual(loads, ['650 24px Manrope', '400 14px Manrope']);
      releases[0]([{}]);
      await Promise.resolve();
      assert.equal(drawings, 0, 'both title and subtitle weights must be ready');
      releases[1]([{}]);
      assert.equal(await pending, 'requested-output');
      assert.equal(drawings, 1);

      for (const unavailable of [undefined, {load: () => Promise.resolve([])},
        {load: () => Promise.reject(new Error('font request failed'))}]) {
        context.document.fonts = unavailable;
        await assert.rejects(vm.runInContext(`${entry}('unavailable-output')`, context), error =>
          error.archifyViewerMessage === 'Load the interface font, then retry the export.');
        assert.equal(drawings, 1, 'failed or unavailable fonts never produce a fallback-font export');
      }
    });
  }
}
