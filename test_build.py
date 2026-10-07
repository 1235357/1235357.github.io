import unittest
import tempfile
from unittest.mock import patch
import xml.etree.ElementTree as ET
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import build


def file_snapshot(root):
    return {str(path.relative_to(root)): path.read_bytes()
            for path in root.rglob('*') if path.is_file()}


class FreshBuildTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='rag-site-build-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'articles').mkdir()
        (self.root / 'figures').mkdir()
        (self.root / 'articles' / '01-test.md').write_text('# Test\n\nA source.\n', encoding='utf-8')
        (self.root / 'style.css').write_text('body { color: white; }', encoding='utf-8')
        self.root_patch = patch.object(build, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def test_stale_asset_cannot_rescue_missing_source(self):
        # A reused dist would accept a link whose source has disappeared.
        (self.root / 'dist' / 'figures').mkdir(parents=True)
        (self.root / 'dist' / 'figures' / 'missing.svg').write_bytes(b'OLD SVG')
        (self.root / 'dist' / 'index.html').write_bytes(b'LAST GOOD INDEX')
        before = file_snapshot(self.root / 'dist')
        (self.root / 'articles' / '01-test.md').write_text(
            '# Test\n\n![Missing](figures/missing.svg)\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'missing.svg'):
            build.build()
        self.assertEqual(file_snapshot(self.root / 'dist'), before)

    def test_successful_rebuild_contains_only_current_assets_and_retains_recovery(self):
        # Old output must not ship arbitrary receipts or obsolete pages.
        (self.root / 'dist' / 'figures').mkdir(parents=True)
        (self.root / 'dist' / 'obsolete.html').write_bytes(b'OLD PAGE')
        (self.root / 'dist' / 'figures' / 'old.archify.delivery.json').write_bytes(b'PRIVATE')
        (self.root / 'dist' / 'figures' / 'old.svg').write_bytes(b'OLD FIGURE')
        before = file_snapshot(self.root / 'dist')
        source_before = file_snapshot(self.root / 'articles')
        result = build.build()
        self.assertEqual(set(file_snapshot(self.root / 'dist')),
                         {'index.html', '01-test.html', 'style.css'})
        self.assertEqual(file_snapshot(result['recovery_path']), before)
        self.assertEqual(file_snapshot(self.root / 'articles'), source_before)

    def test_failed_render_preserves_last_good_output(self):
        # Reading a malformed article must not mutate the old public directory.
        (self.root / 'articles' / '02-later.md').write_text('# Later\n\nOriginal.', encoding='utf-8')
        build.build()
        before = file_snapshot(self.root / 'dist')
        (self.root / 'articles' / '01-test.md').write_text('# Test\n\nChanged.', encoding='utf-8')
        (self.root / 'articles' / '02-later.md').write_text('No title heading', encoding='utf-8')
        with self.assertRaises(Exception) as captured:
            build.build()
        self.assertIsInstance(captured.exception, ValueError)
        self.assertEqual(file_snapshot(self.root / 'dist'), before)

    def test_nested_html_reference_is_validated_before_promotion(self):
        (self.root / 'figures' / 'test.archify.html').write_text(
            '<img src="missing.svg">', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'missing.svg'):
            build.build()
        self.assertFalse((self.root / 'dist').exists())

    def test_unchanged_build_does_not_accumulate_recovery_copies(self):
        build.build()
        result = build.build()
        self.assertIsInstance(result, dict)
        self.assertEqual(result['status'], 'unchanged')
        self.assertIsNone(result['recovery_path'])
        self.assertFalse((self.root / '.build-recovery').exists())

    def test_failed_promotion_restores_previous_output(self):
        build.build()
        before = file_snapshot(self.root / 'dist')
        (self.root / 'articles' / '01-test.md').write_text('# Test\n\nChanged.', encoding='utf-8')
        real_rename = Path.rename

        def rename_with_blocked_promotion(path, target):
            if path.name.startswith('.dist-stage-') and Path(target) == self.root / 'dist':
                raise OSError('simulated Windows promotion lock')
            return real_rename(path, target)

        with patch.object(Path, 'rename', rename_with_blocked_promotion):
            with self.assertRaisesRegex(OSError, 'promotion lock'):
                build.build()
        self.assertEqual(file_snapshot(self.root / 'dist'), before)


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if 'id' in attributes:
            self.ids.add(attributes['id'])
        for key in ('href', 'src'):
            if key in attributes:
                self.targets.append(attributes[key])


class StageStructure(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.figure_parents = []
        self.heading_parents = []

    def handle_starttag(self, tag, attrs):
        if tag == 'figure':
            self.figure_parents.append(tuple(self.stack))
        if tag in ('h1', 'h2'):
            self.heading_parents.append(tuple(self.stack))
        if tag not in ('meta', 'link', 'br', 'img', 'input', 'hr'):
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in self.stack:
            self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]


class NavigationTest(unittest.TestCase):
    def test_architecture_stage_is_not_squeezed_inside_the_reading_column(self):
        content = ('<h1>Test</h1><p>Before</p>'
                   '<figure class="architecture-figure"><iframe title="Diagram"></iframe>'
                   '<figcaption>Current implementation</figcaption></figure>'
                   '<h2 id="after">After</h2><p>Explanation</p>')
        parsed = StageStructure()
        parsed.feed(build.render_page('Test', content))
        self.assertEqual(len(parsed.figure_parents), 1)
        self.assertIn('main', parsed.figure_parents[0])
        self.assertNotIn('article', parsed.figure_parents[0])
        self.assertEqual(len(parsed.heading_parents), 2)
        for parents in parsed.heading_parents:
            self.assertIn('article', parents)
    def test_local_links_and_fragments_resolve(self):
        build.build()
        output = build.ROOT / 'dist'
        pages = {}
        for path in output.glob('*.html'):
            parsed = PageReferences()
            parsed.feed(path.read_text(encoding='utf-8'))
            pages[path.resolve()] = parsed
        for path, page in pages.items():
            for reference in page.targets:
                url = urlsplit(reference)
                if url.scheme or url.netloc:
                    continue  # Network URLs require separate live verification.
                target = (path.parent / unquote(url.path)).resolve() if url.path else path
                with self.subTest(page=path.name, reference=reference):
                    self.assertTrue(target.is_relative_to(output.resolve()), reference)
                    self.assertTrue(target.is_file(), reference)
                    if url.fragment and target in pages:
                        self.assertIn(unquote(url.fragment), pages[target].ids, reference)

    def test_editable_figure_sources_are_distributed_unchanged(self):
        build.build()
        for source in (build.ROOT / 'figures').iterdir():
            if source.suffix not in {'.drawio', '.puml', '.svg', '.png'}:
                continue
            name = source.name
            self.assertEqual((build.ROOT / 'figures' / name).read_bytes(),
                             (build.ROOT / 'dist' / 'figures' / name).read_bytes())
        article = (build.ROOT / 'dist' / '01-two-lifecycles.html').read_text(encoding='utf-8')
        self.assertIn('href="figures/two-lifecycles.drawio"', article)
        self.assertIn('href="figures/two-lifecycles.puml"', article)

    def test_interactive_figures_and_license_notices_reach_the_static_site(self):
        # Dropping the viewer/spec or its bundled notices breaks local inspection.
        # Only named Archify outputs are public assets, not arbitrary JSON files.
        build.build()
        names = [
            'two-lifecycles.archify.json', 'two-lifecycles.archify.html',
            'browser-native.archify.json', 'browser-native.archify.html',
            'ARCHIFY-LICENSE.txt', 'ARCHIFY-THIRD-PARTY-NOTICES.txt',
            'JetBrainsMono-OFL.txt',
        ]
        for name in names:
            with self.subTest(asset=name):
                source = build.ROOT / 'figures' / name
                target = build.ROOT / 'dist' / 'figures' / name
                self.assertTrue(target.is_file(), name)
                self.assertEqual(source.read_bytes(), target.read_bytes())
        for stem in ('two-lifecycles', 'browser-native'):
            with self.subTest(private_receipt=stem):
                self.assertFalse((build.ROOT / 'dist' / 'figures' /
                                  f'{stem}.archify.delivery.json').exists())

    def test_evidence_diagram_keeps_implemented_and_proposed_edges_separate(self):
        # Structural acceptance only; this does not invoke a graphical renderer.
        root = ET.parse(build.ROOT / 'figures' / '04-evidence-to-calculation.drawio')
        cells = root.findall('.//mxCell')
        identifiers = [cell.attrib['id'] for cell in cells]
        self.assertEqual(len(identifiers), len(set(identifiers)))
        vertices = {cell.attrib['id'] for cell in cells if cell.get('vertex') == '1'}
        edges = [cell for cell in cells if cell.get('edge') == '1']
        expected = {
            ('report', 'extract'): False, ('extract', 'retrieve'): False,
            ('retrieve', 'review'): True, ('review', 'accept'): True,
            ('accept', 'calculate'): True, ('review', 'hold'): True,
        }
        actual = {}
        for edge in edges:
            source, target = edge.get('source'), edge.get('target')
            self.assertIn(source, vertices)
            self.assertIn(target, vertices)
            pair = (source, target)
            self.assertNotIn(pair, actual)
            actual[pair] = 'dashed=1;' in edge.get('style', '')
        self.assertEqual(actual, expected)

    def test_article_uses_its_filename_number(self):
        build.build()
        for source in (build.ROOT / 'articles').glob('*.md'):
            number = source.stem.split('-', 1)[0]
            output = (build.ROOT / 'dist' / (source.stem + '.html')).read_text(encoding='utf-8')
            self.assertIn('FIELD NOTES / ' + number + '</p>', output)

    def test_index_has_series_label_not_chapter_one(self):
        build.build()
        output = (build.ROOT / 'dist' / 'index.html').read_text(encoding='utf-8')
        self.assertIn('FIELD NOTES / SERIES</p>', output)

    def test_article_has_generated_section_navigation(self):
        # Removing the generated outline should fail even if headings still render.
        build.build()
        article = (build.ROOT / 'dist' / '02-contracts-before-services.html').read_text(encoding='utf-8')
        self.assertIn('aria-label="Article sections"', article)
        self.assertIn('href="#follow-one-http-request"', article)
        self.assertIn('<summary>On this page</summary>', article)
        self.assertLess(article.index('</h1>'), article.index('<summary>On this page</summary>'))
        index = (build.ROOT / 'dist' / 'index.html').read_text(encoding='utf-8')
        self.assertNotIn('aria-label="Article sections"', index)


if __name__ == '__main__':
    unittest.main()
