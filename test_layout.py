"""Presentation contracts; real layout/keyboard checks are recorded separately."""
import ast
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Elements(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.stack = []
        self.ids = {}
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.setdefault(attrs['id'], []).append((tag, attrs, tuple(self.stack)))
        if tag not in {'meta', 'link', 'input', 'br', 'img', 'hr'}:
            self.stack.append((tag, attrs))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break


class LayoutContractsTest(unittest.TestCase):
    def test_one_content_measure_and_no_full_bleed_homepage_stage(self):
        css = (ROOT / 'style.css').read_text(encoding='utf-8')
        lab = (ROOT / 'browser-rag/inspector.css').read_text(encoding='utf-8')
        self.assertIn('--site-measure:1120px', css)
        self.assertIn('--content-width: 1120px', lab)
        self.assertIn('minmax(0,var(--site-measure))', css)
        self.assertIn('.portfolio-page .portfolio-main>.demo-stage{grid-column:content}', css)
        self.assertNotIn('grid-column:full', css)
        self.assertIn('max-width:calc(var(--site-measure) + 2 * var(--site-gutter))', css)
        self.assertIn('max-width:calc(var(--site-measure) + 2 * var(--portfolio-gutter))', css)
        self.assertIn('max-width: calc(var(--content-width) + 2 * var(--gutter))', lab)

    def test_existing_font_sizes_remain_readable(self):
        css = (ROOT / 'browser-rag/inspector.css').read_text(encoding='utf-8')
        for rule in ('font: 500 17px/1.75 var(--ui)',
                     'font-size: clamp(36px, 4.2vw, 48px)',
                     'h2 { font-size: 28px',
                     'input, textarea, select { font-size: 16px; }'):
            self.assertIn(rule, css)
        self.assertIn('.computation-notebook .empty { margin: 10px 0; padding: 12px 0; }', css)
        self.assertNotRegex(css, r'\.empty\s*\{[^}]*display:\s*none')

    def test_every_runtime_dom_target_remains_unique(self):
        app = (ROOT / 'browser-rag/pdf-app.mjs').read_text(encoding='utf-8')
        required = ast.literal_eval(re.search(r'const required=(\[[^;]+\]);', app).group(1))
        nodes = Elements((ROOT / 'browser-rag/inspector.html').read_text(encoding='utf-8'))
        for element_id in required:
            self.assertEqual(len(nodes.ids.get(element_id, [])), 1, element_id)

    def test_native_draft_status_moves_with_its_warning_not_the_header(self):
        html = (ROOT / 'browser-rag/inspector.html').read_text(encoding='utf-8')
        nodes = Elements(html)
        ancestors = nodes.ids['header-stage'][0][2]
        self.assertFalse(any(tag == 'header' for tag, _ in ancestors))
        self.assertTrue(any('generation' in attrs.get('class', '').split() for _, attrs in ancestors))
        self.assertIn('LOCAL DRAFT · CONTEXT NOT GENERATED', html)
        self.assertNotIn('aria-live', nodes.ids['header-stage'][0][1])
        self.assertNotIn('role', nodes.ids['header-stage'][0][1])
        self.assertNotIn('class="lead-actions"', html)
        self.assertNotIn('class="lead-note"', html)
        self.assertIn('<a href="#lab-workspace">Workspace</a>', html)
        self.assertIn('<a href="#computation-notebook">Notebook</a>', html)
        self.assertIn('Your PDF stays on this device. Choose a document with readable text.', html)
        self.assertIn('Missing files download when you choose Embed passages.', html)
        self.assertIn('Privacy &amp; browser requirements', html)

    def test_empty_notebook_template_agrees_with_its_single_metadata_message(self):
        html = (ROOT / 'browser-rag/inspector.html').read_text(encoding='utf-8')
        for empty_host in ('<div id="candidate-results" class="candidate-results"></div>',
                           '<div id="context-detail"></div>',
                           '<div id="chunk-detail"></div>'):
            self.assertIn(empty_host, html)
        self.assertIn('No chunk artifact. Build from an accepted source.</p>', html)
        self.assertNotIn('No sourced candidates yet.', html)
        self.assertIn('No candidates committed.', html)
        self.assertIn('No provenance context committed.', html)

    def test_embedded_and_fullscreen_contracts_are_retained(self):
        css = (ROOT / 'browser-rag/inspector.css').read_text(encoding='utf-8')
        home = (ROOT / 'style.css').read_text(encoding='utf-8')
        self.assertIn('.embedded-lab :is(header, main, footer) { max-width: none; }', css)
        self.assertIn('.embedded-lab header { display: none; }', css)
        self.assertIn('.embedded-lab .lead h1 { position: absolute;', css)
        self.assertIn('.portfolio-page .demo-stage:fullscreen{display:flex;', home)
        self.assertIn('width:100%;height:100%;min-height:0;margin:0;', home)
        self.assertIn('if len(demos) == 1:', (ROOT / 'portfolio.py').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
