import unittest
import tempfile
import hashlib
import io
import os
import stat
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch
import xml.etree.ElementTree as ET
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import build


def file_snapshot(root):
    return {str(path.relative_to(root)): independent_fingerprint(path)
            for path in root.rglob('*') if path.is_file()}


def independent_fingerprint(path):
    """Test oracle: stream independently of the build's block size and helpers."""
    digest = hashlib.sha256()
    count = 0
    with path.open('rb') as stream:
        while block := stream.read(65536):
            count += len(block)
            digest.update(block)
    return count, digest.hexdigest()


def write_multiblock_fixture(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('wb') as stream:
        stream.write(bytes(range(256)) * 4096)
        stream.write(bytes(reversed(range(256))) * 4096)
        stream.write(b'non-aligned tail\x00\xff' * 19)
    return independent_fingerprint(path)


def reparse_stat(details):
    values = {name: getattr(details, name) for name in dir(details) if name.startswith('st_')}
    values['st_file_attributes'] = values.get('st_file_attributes', 0) | stat.FILE_ATTRIBUTE_REPARSE_POINT
    return SimpleNamespace(**values)


class BoundedBinaryReader:
    """Fail on full-file or oversized reads while retaining real I/O semantics."""
    def __init__(self, stream):
        self.stream = stream

    def __enter__(self):
        self.stream.__enter__()
        return self

    def __exit__(self, *args):
        return self.stream.__exit__(*args)

    def __getattr__(self, name):
        return getattr(self.stream, name)

    def read(self, size=-1):
        if type(size) is not int or not 0 < size <= 1048576:
            raise AssertionError(f'Binary reads must be bounded: {size}')
        return self.stream.read(size)


@contextmanager
def bounded_binary_reads(selected=lambda path: True):
    real_open = Path.open

    def open_bounded(path, mode='r', *args, **kwargs):
        stream = real_open(path, mode, *args, **kwargs)
        return BoundedBinaryReader(stream) if mode == 'rb' and selected(path) else stream

    with patch.object(Path, 'open', open_bounded):
        yield


class FileFingerprintTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='rag-fingerprint-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_manifest_uses_length_and_digest_for_multiblock_files_and_none_for_directories(self):
        source = self.root / 'nested' / 'large.bin'
        expected = write_multiblock_fixture(source)
        (self.root / 'empty.bin').touch()
        (self.root / 'empty-directory').mkdir()
        with bounded_binary_reads():
            actual = build.manifest(self.root, self.root)
        self.assertEqual(actual, {
            'nested': None, str(Path('nested') / 'large.bin'): expected,
            'empty.bin': (0, hashlib.sha256(b'').hexdigest()),
            'empty-directory': None,
        })

    def test_fingerprint_counts_actual_multiblock_stream_and_accepts_empty_file(self):
        self.assertTrue(callable(getattr(build, 'file_fingerprint', None)),
                        'Build needs a streaming file fingerprint function')
        source = self.root / 'large.bin'
        expected = write_multiblock_fixture(source)
        empty = self.root / 'empty.bin'
        empty.touch()
        with bounded_binary_reads():
            self.assertEqual(build.file_fingerprint(source), expected)
            self.assertEqual(build.file_fingerprint(empty), (0, hashlib.sha256(b'').hexdigest()))

    def test_manifest_guards_empty_directory_before_walking_it(self):
        real_lstat = Path.lstat

        def reparse_directory(path, *args, **kwargs):
            if path == self.root:
                return reparse_stat(real_lstat(path, *args, **kwargs))
            return real_lstat(path, *args, **kwargs)

        with patch.object(Path, 'lstat', reparse_directory):
            with self.assertRaisesRegex(ValueError, 'reparse'):
                build.manifest(self.root, self.root)


class VerifiedAssetCopyTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='rag-verified-copy-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / 'source.bin'
        self.expected = write_multiblock_fixture(self.source)
        self.destination = self.root / '.dist-stage-test' / 'nested' / 'asset.bin'

    def copy(self, size=None, digest=None, destination=None):
        self.assertTrue(callable(getattr(build, 'copy_verified_asset', None)),
                        'Build needs a streaming verified asset copy function')
        return build.copy_verified_asset(
            self.source, destination or self.destination,
            self.expected[0] if size is None else size,
            self.expected[1] if digest is None else digest,
            self.root, 'fixture asset')

    def test_verified_multiblock_copy_returns_fingerprint_of_exact_written_bytes(self):
        opened = []
        real_open = Path.open

        def record_open(path, mode='r', *args, **kwargs):
            stream = real_open(path, mode, *args, **kwargs)
            if path in (self.source, self.destination):
                opened.append((path, mode, stream))
            return BoundedBinaryReader(stream) if mode == 'rb' else stream

        with patch.object(Path, 'open', record_open):
            result = self.copy(digest=self.expected[1].upper())
        self.assertEqual(result, self.expected)
        self.assertEqual(independent_fingerprint(self.destination), self.expected)
        self.assertEqual([(path, mode) for path, mode, stream in opened],
                         [(self.source, 'rb'), (self.destination, 'xb')])
        self.assertTrue(all(stream.closed for path, mode, stream in opened))

    def test_invalid_expected_metadata_refuses_before_creating_destination(self):
        for size in (0, -1, True, 1.0, '1'):
            with self.subTest(size=size):
                with self.assertRaisesRegex(ValueError, 'metadata|bytes'):
                    self.copy(size=size)
                self.assertFalse(self.destination.exists())
        for digest in ('z' * 64, '0' * 63, 1):
            with self.subTest(digest=digest):
                with self.assertRaisesRegex(ValueError, 'metadata|hash'):
                    self.copy(digest=digest)
                self.assertFalse(self.destination.exists())
        with self.assertRaisesRegex(ValueError, 'metadata|hash'):
            build.copy_verified_asset(self.source, self.destination, self.expected[0], None,
                                      self.root, 'fixture asset')
        self.assertFalse(self.destination.exists())

    def test_existing_destination_and_source_aliases_preserve_all_existing_bytes(self):
        self.destination.parent.mkdir(parents=True)
        self.destination.write_bytes(b'KEEP DESTINATION')
        with self.assertRaises(FileExistsError):
            self.copy()
        self.assertEqual(self.destination.read_bytes(), b'KEEP DESTINATION')
        before = independent_fingerprint(self.source)
        with self.assertRaisesRegex(ValueError, 'same|identical|alias'):
            self.copy(destination=self.source)
        with self.assertRaisesRegex(ValueError, 'same|identical|alias'):
            self.copy(destination=self.root / 'unused' / '..' / self.source.name)
        alias = self.root / 'hardlink.bin'
        os.link(self.source, alias)
        with self.assertRaisesRegex(ValueError, 'same|identical|alias'):
            self.copy(destination=alias)
        self.assertEqual(independent_fingerprint(self.source), before)
        self.assertEqual(independent_fingerprint(alias), before)

    def test_source_must_be_a_file_and_both_paths_must_stay_inside_root(self):
        self.source.unlink()
        self.source.mkdir()
        with self.assertRaisesRegex(ValueError, 'missing|file'):
            self.copy()
        self.assertFalse(self.destination.exists())
        self.source.rmdir()
        write_multiblock_fixture(self.source)
        outside = self.root.parent / (self.root.name + '-outside.bin')
        with self.assertRaisesRegex(ValueError, 'escapes'):
            self.copy(destination=outside)
        with self.assertRaisesRegex(ValueError, 'escapes'):
            build.copy_verified_asset(outside, self.destination, *self.expected,
                                      self.root, 'fixture asset')
        self.assertFalse(self.destination.exists())
        self.assertFalse(outside.exists())

    def test_reparse_source_or_destination_parent_refuses_before_writing(self):
        self.destination.parent.mkdir(parents=True)
        real_lstat = Path.lstat
        for blocked in (self.source, self.destination.parent):
            def reparse_path(path, *args, **kwargs):
                if path == blocked:
                    return reparse_stat(real_lstat(path, *args, **kwargs))
                return real_lstat(path, *args, **kwargs)

            with self.subTest(blocked=blocked), patch.object(Path, 'lstat', reparse_path):
                with self.assertRaisesRegex(ValueError, 'reparse'):
                    self.copy()
                self.assertFalse(self.destination.exists())

    def test_actual_short_overlong_and_wrong_hash_streams_are_rejected(self):
        original = self.source.read_bytes()  # Small synthetic fixture, independent oracle above.
        real_open = Path.open
        cases = (('short', original[:-1], 'bytes'),
                 ('overlong', original + b'!', 'bytes'),
                 ('wrong hash', bytes([original[0] ^ 1]) + original[1:], 'hash'))
        for name, actual, error in cases:
            destination = self.destination.with_name(name + '.bin')

            def different_source_stream(path, mode='r', *args, **kwargs):
                if path == self.source and mode == 'rb':
                    return BoundedBinaryReader(io.BytesIO(actual))
                return real_open(path, mode, *args, **kwargs)

            with self.subTest(case=name), patch.object(Path, 'open', different_source_stream):
                with self.assertRaisesRegex(ValueError, error):
                    self.copy(destination=destination)
            if name == 'overlong':
                # The third block would exceed the promised length; none of it is written.
                self.assertTrue(destination.is_file())
                self.assertEqual(destination.stat().st_size, 2097152)

    def test_new_destination_parent_is_rechecked_for_reparse_before_opening_files(self):
        real_mkdir = Path.mkdir
        real_lstat = Path.lstat
        real_open = Path.open
        parent_created = False

        def create_reparse_parent(path, *args, **kwargs):
            nonlocal parent_created
            result = real_mkdir(path, *args, **kwargs)
            if path == self.destination.parent:
                parent_created = True
            return result

        def newly_reparse_parent(path, *args, **kwargs):
            details = real_lstat(path, *args, **kwargs)
            return reparse_stat(details) if parent_created and path == self.destination.parent else details

        def refuse_file_open(path, mode='r', *args, **kwargs):
            if path in (self.source, self.destination) and mode in ('rb', 'xb'):
                raise AssertionError('Reparse refusal must happen before either file is opened')
            return real_open(path, mode, *args, **kwargs)

        with patch.object(Path, 'mkdir', create_reparse_parent), \
                patch.object(Path, 'lstat', newly_reparse_parent), \
                patch.object(Path, 'open', refuse_file_open):
            with self.assertRaisesRegex(ValueError, 'reparse'):
                self.copy()
        self.assertTrue(parent_created)
        self.assertFalse(self.destination.exists())
        self.assertEqual(independent_fingerprint(self.source), self.expected)


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

    def test_homepage_script_url_changes_with_content_and_is_stable_across_line_endings(self):
        # A returning browser must not reuse an older UI script for new markup.
        (self.root / 'portfolio.json').write_bytes(Path(__file__).with_name('portfolio.json').read_bytes())
        script = self.root / 'portfolio-demo.mjs'
        def render(name, body):
            script.write_bytes(body)
            output = self.root / name
            output.mkdir()
            build.render_site(self.root, output)
            class Modules(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.urls = []
                def handle_starttag(self, tag, attrs):
                    values = dict(attrs)
                    if tag == 'script' and values.get('type') == 'module':
                        self.urls.append(values['src'])
            parsed = Modules()
            parsed.feed((output / 'index.html').read_text(encoding='utf-8'))
            self.assertEqual(len(parsed.urls), 1)
            url = urlsplit(parsed.urls[0])
            self.assertEqual(url.path, 'portfolio-demo.mjs')
            self.assertRegex(url.query, r'^v=[0-9a-f]{16}$')
            self.assertEqual((output / url.path).read_bytes(), body)
            return parsed.urls[0]
        first = render('first', b'const state = "one";\n')
        changed = render('changed', b'const state = "two";\n')
        normalized = render('normalized', b'const state = "two";\r\n')
        self.assertNotEqual(first, changed)
        self.assertEqual(changed, normalized)

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

    def test_multiblock_unchanged_bytes_and_same_size_change_control_promotion(self):
        figure = self.root / 'figures' / 'large.png'
        write_multiblock_fixture(figure)
        with bounded_binary_reads():
            build.build()
            result = build.build()
        self.assertEqual(result['status'], 'unchanged')
        self.assertIsNone(result['recovery_path'])
        self.assertFalse((self.root / '.build-recovery').exists())
        self.assertEqual(list(self.root.glob('.dist-stage-*')), [])
        before = file_snapshot(self.root / 'dist')
        with figure.open('r+b') as stream:
            stream.seek(1048576 + 7)
            stream.write(b'!')
        with bounded_binary_reads():
            changed = build.build()
        self.assertEqual(changed['status'], 'built')
        self.assertEqual(file_snapshot(changed['recovery_path']), before)
        self.assertEqual(independent_fingerprint(self.root / 'dist' / 'figures' / figure.name),
                         independent_fingerprint(figure))
        self.assertEqual(list(self.root.glob('.dist-stage-*')), [])

    def test_empty_directory_changes_are_not_treated_as_unchanged_output(self):
        build.build()
        (self.root / 'dist' / 'obsolete-empty-directory').mkdir()
        result = build.build()
        self.assertEqual(result['status'], 'built')
        self.assertTrue((result['recovery_path'] / 'obsolete-empty-directory').is_dir())
        self.assertFalse((self.root / 'dist' / 'obsolete-empty-directory').exists())

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
    def test_lifecycles_opens_with_question_and_answer_status_before_architecture(self):
        build.build()
        article = (build.ROOT / 'dist' / '01-two-lifecycles.html').read_text(encoding='utf-8')
        architecture_at = article.index('id="current-architecture"')
        opening = article[:architecture_at]
        question = "What was NVIDIA's annual revenue in FY2025?"
        status = 'Current answer status'
        self.assertIn(question, opening)
        self.assertIn(status, opening)
        self.assertLess(opening.index(question), opening.index(status))
        self.assertIn('Generation is <strong>OFF</strong>', opening)
        self.assertIn('candidate evidence, not a generated revenue answer', opening)
        self.assertIn('2026-10-04', opening)
        self.assertIn('<strong>REFUSE</strong>', opening)
        self.assertIn('<strong>no answer released</strong>', opening)
        self.assertIn('href="#a-real-failure-at-the-generation-boundary"', opening)

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
            'browser-operation.archify.json', 'browser-operation.archify.html',
            'ARCHIFY-LICENSE.txt', 'ARCHIFY-THIRD-PARTY-NOTICES.txt',
            'JetBrainsMono-OFL.txt',
        ]
        for name in names:
            with self.subTest(asset=name):
                source = build.ROOT / 'figures' / name
                target = build.ROOT / 'dist' / 'figures' / name
                self.assertTrue(target.is_file(), name)
                self.assertEqual(source.read_bytes(), target.read_bytes())
        for stem in ('two-lifecycles', 'browser-native', 'browser-operation'):
            with self.subTest(private_receipt=stem):
                self.assertFalse((build.ROOT / 'dist' / 'figures' /
                                  f'{stem}.archify.delivery.json').exists())
        article = (build.ROOT / 'dist' / '02-contracts-before-services.html').read_text(encoding='utf-8')
        self.assertIn('src="figures/browser-operation.archify.html?theme=dark"', article)
        self.assertIn('href="figures/browser-operation.archify.json"', article)
        self.assertIn('not repository-provenance validation or PDF/model execution', article)

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

    def test_personal_entry_preserves_complete_journal_and_project_access(self):
        build.build()
        output = (build.ROOT / 'dist' / 'index.html').read_text(encoding='utf-8')
        self.assertIn('id="personal-title"', output)
        for project in ('nvidia-rag', 'llava-gi', 'osef', 'artisk', 'ecommerce-agents', 'lead-qualification'):
            self.assertIn(f'id="{project}"', output)
        self.assertIn('href="browser-rag/inspector.html"', output)
        self.assertIn('href="journal.html"', output)
        self.assertIn('id="demo"', output)
        self.assertIn('id="project-demo"', output)
        self.assertIn('src="browser-rag/inspector.html" loading="lazy"', output)
        self.assertIn('https://www.linkedin.com/in/tony-zhentong-ye/', output)
        self.assertIn('media.licdn.com/dms/image/', output)
        self.assertTrue((build.ROOT / 'dist' / 'portfolio-demo.mjs').is_file())
        journal = (build.ROOT / 'dist' / 'journal.html').read_text(encoding='utf-8')
        self.assertIn('FIELD NOTES / SERIES</p>', journal)
        for source in (build.ROOT / 'articles').glob('*.md'):
            self.assertIn(f'href="{source.stem}.html"', journal)
            article = (build.ROOT / 'dist' / (source.stem + '.html')).read_text(encoding='utf-8')
            self.assertIn('href="journal.html">Series index', article)

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
