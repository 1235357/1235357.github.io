import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const figures = fs.readdirSync(new URL('figures/', root))
  .filter(name => name.endsWith('.archify.html')).sort();
const roles = {
  paper: '#f7f8fa', panel: '#ffffff', ink: '#172033',
  muted: '#46536b', accent: '#234ccf', line: '#d8dfeb',
  code: '#eef2f8', scope: '#6a481d',
};

// Deliberately bounded source check: inspect named declaration blocks, not a
// simulated CSS cascade. Actual browser and downloaded-image reviews are separate.
function withoutComments(css) {
  let result = '', quote = null;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (quote) {
      result += char;
      if (char === '\\') result += css[++index] || '';
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      result += char;
    } else if (char === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      assert.notEqual(end, -1, 'unterminated CSS comment');
      index = end + 1;
      result += ' ';
    } else result += char;
  }
  return result;
}

function declarations(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = withoutComments(css).match(new RegExp('(?:^|[}\\n])\\s*' + escaped + '\\s*\\{([^{}]*)\\}'));
  assert.ok(match, `missing ${selector} declaration block`);
  return Object.fromEntries(match[1].split(';').flatMap(entry => {
    const colon = entry.indexOf(':');
    return colon < 0 ? [] : [[entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()]];
  }));
}

function color(value) {
  return value?.toLowerCase().replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/,
    (_, r, g, b) => '#' + r + r + g + g + b + b);
}

function assertRoles(actual, aliases, label) {
  for (const [role, variable] of Object.entries(aliases)) {
    assert.equal(color(actual[variable]), roles[role], `${label}: ${role}`);
  }
}

test('declaration checks ignore commented rules and accept inline comments', () => {
  const css = '/* :root { --paper: #f7f8fa; } */\n' +
    ':root { /* intent: shared light surface */ color-scheme:light; --paper:#090909; }';
  const vars = declarations(css, ':root');
  assert.equal(vars['color-scheme'], 'light');
  assert.equal(vars['--paper'], '#090909');
  assert.throws(() => assertRoles(vars, {paper: '--paper'}, 'comment shadow'));
  assert.equal(withoutComments('x{content:"/* literal */"}/* real */'),
    'x{content:"/* literal */"} ');
});

function serializedPolicy(html, options) {
  const source = html.match(/      function serializeSvg\(scale, opts\) \{[\s\S]*?\n      \}\n/)?.[0];
  assert.ok(source, 'the complete actual serializer must be available');
  const element = () => ({attrs: {}, style: {}, children: [],
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key] ?? null; },
    removeAttribute(key) { delete this.attrs[key]; },
    insertBefore(child) { this.children.push(child); },
  });
  const clone = element(), host = element();
  host.setAttribute('data-theme', 'dark');
  host.setAttribute('data-preset', 'classic');
  const palettes = {light: declarations(html, '[data-theme="light"]'),
    dark: {'--bg': '#090909', '--text': '#ffffff'}};
  const document = {
    documentElement: host,
    body: {appendChild() {}, removeChild() {}},
    styleSheets: [{cssRules: [{type: 1, selectorText: ':root',
      cssText: ':root { --bg: #090909; --text: #ffffff; }'}]}],
    querySelector: () => ({viewBox: {baseVal: {x: 0, y: 0, width: 600, height: 400}},
      cloneNode: () => clone}),
    createElement: element, createElementNS: element,
    getElementById: id => id === 'archify-fonts' ? {textContent: '/* fixture font */'} : null,
  };
  const context = vm.createContext({document, cleanExportClone: () => true,
    getComputedStyle: node => ({getPropertyValue: key =>
      palettes[node.getAttribute('data-theme')]?.[key] || ''}),
    XMLSerializer: class { serializeToString() { return '<svg/>'; } }, options,
  });
  vm.runInContext(source + '\nserializeSvg(1, options)', context, {timeout: 1000});
  return {clone, style: clone.children[0], background: clone.children[1]};
}

test('profile, articles and lab retain the same semantic colors and UI family', () => {
  const style = read('style.css');
  const siteAliases = {paper: '--paper', panel: '--panel', ink: '--ink',
    muted: '--muted', accent: '--accent', line: '--line'};
  for (const selector of [':root', '.portfolio-page']) {
    const vars = declarations(style, selector);
    assertRoles(vars, siteAliases, selector);
    assert.equal(vars['color-scheme'], 'light');
    assert.match(vars['--ui'], /^Manrope\s*,/);
  }
  const lab = declarations(read('browser-rag/inspector.css'), ':root');
  assertRoles(lab, {paper: '--bg', panel: '--surface', ink: '--text',
    muted: '--muted', accent: '--accent', line: '--line'}, 'lab');
  assert.equal(lab['color-scheme'], 'light');
  assert.match(lab['--ui'], /^Manrope\s*,/);
  assertRoles(declarations(style, ':root'), {code: '--soft', scope: '--scope-ink'}, 'reading');
  assertRoles(lab, {code: '--code', scope: '--warm'}, 'lab');
  for (const path of ['build.py', 'portfolio.py', 'browser-rag/inspector.html']) {
    assert.match(read(path), /<meta name="color-scheme" content="light">/, path);
  }
});

test('every tracked figure carries the shared light palette and interface policy', () => {
  assert.ok(figures.length > 0, 'the figure directory must not silently disappear');
  for (const name of figures) {
    const html = read('figures/' + name);
    assert.match(html, /<html\b[^>]*data-theme="light"/, name);
    const base = declarations(html, '[data-theme="light"]');
    const aliases = {
      paper: '--bg', panel: '--panel', ink: '--text', muted: '--text-muted',
      accent: '--arrow-emphasis', line: '--panel-border',
    };
    assertRoles(base, aliases, name);
    for (const preset of ['signal-flow', 'blueprint', 'editorial']) {
      const override = declarations(html, `[data-preset="${preset}"][data-theme="light"]`);
      assertRoles({...base, ...override}, aliases, `${name}/${preset}`);
    }
    const policy = html.match(/<style id="site-light-policy">([\s\S]*?)<\/style>/)?.[1];
    assert.ok(policy, `${name}: missing site light policy after generation`);
    assert.equal(declarations(policy, ':root')['color-scheme'], 'light');
    const type = html.match(/<style id="site-figure-typography">([\s\S]*?)<\/style>/)?.[1];
    assert.match(type || '', /font-family:\s*Manrope/, name);
  }
});

for (const name of figures) {
  test(`${name}: actual first paint ignores legacy dark inputs and preserves presentation flags`, () => {
    const html = read('figures/' + name);
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, 'a first-paint theme script is required');
    for (const search of ['', '?theme=dark', '?theme=dark&embed=1&present=1']) {
      const attrs = {'data-theme': 'dark'};
      const context = vm.createContext({
        document: {documentElement: {setAttribute: (key, value) => { attrs[key] = value; }}},
        window: {location: {search}, localStorage: {getItem: () => 'dark'},
          matchMedia: () => ({matches: true})},
        localStorage: {getItem: () => 'dark'},
        matchMedia: () => ({matches: true}), URLSearchParams,
      });
      vm.runInContext(script, context, {timeout: 1000});
      assert.equal(attrs['data-theme'], 'light', search);
      assert.equal(attrs['data-embed'], search.includes('embed=1') ? 'true' : undefined);
      assert.equal(attrs['data-present'], search.includes('present=1') ? 'true' : undefined);
    }
  });

  test(`${name}: actual theme API cannot reintroduce dark; SVG source binding stays light`, () => {
    const html = read('figures/' + name);
    const theme = html.match(/Archify\.theme = \(function \(\) \{([\s\S]*?)\n    \}\)\(\);/)?.[0];
    assert.ok(theme, 'the viewer theme entry point must remain testable');
    const attrs = {'data-theme': 'dark'}, buttonAttrs = {}, button = {
      hidden: false, disabled: false,
      setAttribute: (key, value) => { buttonAttrs[key] = value; },
    }, label = {textContent: ''};
    const context = vm.createContext({Archify: {}, viewerText: key => key, document: {
      documentElement: {setAttribute: (key, value) => { attrs[key] = value; }},
      getElementById: id => ({'btn-theme': button, 'theme-label': label}[id]),
    }});
    vm.runInContext(theme, context, {timeout: 1000});
    assert.equal(attrs['data-theme'], 'light');
    for (let index = 0; index < 3; index++) {
      vm.runInContext('Archify.theme.toggle()', context, {timeout: 1000});
      assert.equal(attrs['data-theme'], 'light');
    }
    assert.equal(button.hidden, true);
    assert.equal(button.disabled, true);
    assert.equal(buttonAttrs.tabindex, '-1');
    assert.equal(buttonAttrs['aria-hidden'], 'true');
    assert.equal(label.textContent, 'viewer.theme.light');

    // Execute the full source with controlled DOM/color resolution. This proves
    // policy data flow in the fixture, not a browser cascade or output pixels.
    for (const options of [{}, {theme: 'dark'}, {autoTheme: true},
      {theme: 'dark', autoTheme: true}]) {
      const output = serializedPolicy(html, options);
      assert.equal(output.clone.attrs['data-theme'], 'light');
      assert.equal(output.background.attrs.fill, roles.paper);
      assert.match(output.style.textContent, /:root, svg \{ --bg: #f7f8fa; --text: #172033; \}/);
      assert.doesNotMatch(output.style.textContent, /@media\s*\(prefers-color-scheme/);
    }
  });
}
