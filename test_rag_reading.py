"""Reading routes, fidelity and no-runtime regression tests."""
import ast
import re
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch
import markdown
import build
from rag_reading import BEGINNER_PATH, CHAPTERS, chapter_aids, render_guide

ROOT = Path(__file__).resolve().parent

class Elements(HTMLParser):
    def __init__(self):
        super().__init__()
        self.elements = []
        self.text = []
    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))
    def handle_data(self, data):
        if data.strip():
            self.text.append(data.strip())

def parsed(html):
    value = Elements()
    value.feed(html)
    return value

def original_html(slug):
    raw = (ROOT / 'articles' / (slug + '.md')).read_text(encoding='utf-8')
    if raw.startswith('---\n'):
        raw = raw.split('---\n', 2)[2]
    return markdown.markdown(raw, extensions=['fenced_code', 'tables', 'toc'],
        extension_configs={'toc': {'toc_depth': '2-3'}})

class RAGReadingTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='.dist-stage-reading-test-', dir=ROOT)
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name)
        # Only the output needed for rendering. No fixture is a runtime claim.
        def copy_stub(root, output, **kwargs):
            (output / 'browser-rag').mkdir()
            (output / 'browser-rag' / 'inspector.html').write_text('<html><nav class="lab-navigation" aria-label="Project navigation"></nav></html>', encoding='utf-8')
        with patch.object(build, 'copy_browser_assets', copy_stub):
            build.render_site(ROOT, self.output, public_release=True)

    def test_fixture_text_io_explicitly_uses_utf8(self):
        # Catch locale-dependent reads before Windows decodes UTF-8 as cp1252.
        source = Path(__file__).read_text(encoding='utf-8')
        for node in ast.walk(ast.parse(source)):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in ('read_text', 'write_text')):
                encoding = next((x.value for x in node.keywords if x.arg == 'encoding'), None)
                self.assertIsInstance(encoding, ast.Constant, f'Line {node.lineno}')
                self.assertEqual(encoding.value, 'utf-8', f'Line {node.lineno}')

    def test_directory_route_is_built_with_no_automatic_model_or_iframe(self):
        html = (self.output / 'browser-rag/index.html').read_text(encoding='utf-8')
        self.assertIn('No model runs on this page', html)
        self.assertFalse(any(tag in ('script', 'iframe') for tag, _ in parsed(html).elements))
        self.assertIn('MiniLM', html)
        self.assertIn('Qwen', html)
        self.assertIn('BGE', html)
        self.assertIn('TF-IDF', html)
        self.assertIn('not generated answers', html)
        self.assertIn('Fictional teaching example', html)
        self.assertIn('unseen financial questions', html)

    def test_guide_matches_the_build_generation_profile(self):
        local = render_guide()
        public = render_guide(public_release=True)
        self.assertIn('Qwen generation is disabled in this local build', local)
        self.assertNotIn('816 MB', local)
        self.assertIn('optional Qwen answer drafts in this public build', public)
        self.assertIn('816 MB', public)
        default_output = self.output / 'local-profile'
        default_output.mkdir()
        def copy_stub(root, output, **kwargs):
            (output / 'browser-rag').mkdir()
            (output / 'browser-rag/inspector.html').write_text('<html></html>', encoding='utf-8')
        with patch.object(build, 'copy_browser_assets', copy_stub):
            build.render_site(ROOT, default_output, public_release=False)
        self.assertIn('Qwen generation is disabled in this local build',
                      (default_output / 'browser-rag/index.html').read_text(encoding='utf-8'))

    def test_exercise_does_not_reveal_the_answer_before_disclosure(self):
        html = render_guide()
        table = html.split('<table>', 1)[1].split('</table>', 1)[0]
        self.assertIn('<td>240</td><td>180</td>', table)
        self.assertNotIn('example-value', html)
        answer = html.split('<summary>Check your reasoning</summary>', 1)[1]
        self.assertIn('240 million dollars', answer)

    def test_wide_figure_chapters_have_section_returns_without_an_overlay(self):
        for slug in CHAPTERS:
            html = (self.output / (slug + '.html')).read_text(encoding='utf-8')
            h2_count = len(re.findall(r'<h2(?:[ >])', html))
            self.assertGreater(h2_count, 0)
            self.assertEqual(html.count('class="section-return"'), h2_count)
            self.assertIn('href="#main-content">Back to contents', html)
            self.assertIn('id="main-content"', html)

    def test_lab_has_a_way_back_to_the_reading_guide(self):
        html = (self.output / 'browser-rag/inspector.html').read_text(encoding='utf-8')
        self.assertIn('<a href="index.html" target="_top">Reading guide</a>', html)

    def test_nested_header_footer_and_styles_point_to_the_root(self):
        html = (self.output / 'browser-rag/index.html').read_text(encoding='utf-8')
        links = [attrs.get('href') for tag, attrs in parsed(html).elements if tag in ('a', 'link')]
        for required in ('../index.html', '../index.html#projects', '../journal.html',
                         '../SITE-LICENSE.txt', '../browser-rag/index.html', 'inspector.html'):
            self.assertIn(required, links)
        self.assertTrue(any(x.startswith('../style.css?v=') for x in links if x))
        self.assertNotIn('style.css', links)
        self.assertNotIn('SITE-LICENSE.txt', links)

    def test_reading_order_is_distinct_from_publication_numbering(self):
        self.assertEqual([slug[:2] for slug in BEGINNER_PATH], ['01', '04', '03', '05', '06'])
        html = render_guide()
        self.assertIn("not the lab's operation stages", html)
        for n, slug in enumerate(BEGINNER_PATH[:-1]):
            self.assertIn(f'href="{BEGINNER_PATH[n + 1]}.html"', chapter_aids(slug)[1])

    def test_every_chapter_has_reachable_first_pass_and_preserved_ids_and_iframes(self):
        for slug in CHAPTERS:
            with self.subTest(slug=slug):
                current = (self.output / (slug + '.html')).read_text(encoding='utf-8')
                before = parsed(original_html(slug))
                after = parsed(current)
                current_ids = {a['id'] for _, a in after.elements if 'id' in a}
                original_ids = {a['id'] for _, a in before.elements if 'id' in a}
                self.assertTrue(original_ids <= current_ids)
                self.assertEqual([(a.get('src') + '&embed=1' if re.fullmatch(r'figures/[a-z0-9-]+\.archify\.html\?theme=light', a.get('src', '')) else a.get('src')) for t, a in before.elements if t == 'iframe'],
                                 [a.get('src') for t, a in after.elements if t == 'iframe'])
                for anchor, _ in CHAPTERS[slug][3]:
                    self.assertIn(anchor, current_ids)
                    self.assertIn(f'href="#{anchor}"', current)
                for text in before.text:
                    self.assertIn(text, after.text)
                self.assertIn('aria-label="Continue reading"', current)
                self.assertIn('href="browser-rag/index.html"', current)
                self.assertIn('href="browser-rag/inspector.html"', current)

    def test_guide_local_links_and_fragments_resolve_without_directory_exceptions(self):
        guide = self.output / 'browser-rag/index.html'
        refs = build.PageReferences()
        refs.feed(guide.read_text(encoding='utf-8'))
        from urllib.parse import urlsplit
        for target in refs.targets:
            url = urlsplit(target)
            if url.scheme or url.netloc:
                continue
            path = (guide.parent / url.path).resolve() if url.path else guide
            # License is copied by the full build, outside render_site.
            if path.name == 'SITE-LICENSE.txt':
                continue
            self.assertTrue(path.is_file(), target)
            if url.fragment:
                ids = build.PageReferences()
                ids.feed(path.read_text(encoding='utf-8'))
                self.assertIn(url.fragment, ids.ids, target)

    def test_tables_have_a_keyboard_scroll_region_and_original_cells(self):
        html = (self.output / '04-preserve-evidence-before-embedding.html').read_text(encoding='utf-8')
        regions = [a for t, a in parsed(html).elements if a.get('class') == 'reading-table']
        self.assertGreater(len(regions), 0)
        self.assertTrue(all(a.get('tabindex') == '0' and a.get('role') == 'region' for a in regions))
        self.assertIn('240', html)
        self.assertIn('180', html)

    def test_guide_without_portfolio_prefixes_its_journal_link(self):
        html = build.render_page('Guide', render_guide(), path_prefix='../',
                                 stylesheet_href='../style.css')
        self.assertIn('href="../index.html">Journal', html)

if __name__ == '__main__':
    unittest.main()
