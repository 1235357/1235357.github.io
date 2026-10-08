"""Synthetic filesystem tests, not real parser/worker acceptance."""
import hashlib
import json
import subprocess
import unittest
import test_build as fixtures
import build


class InspectorMarkupTest(unittest.TestCase):
    def test_pdf_acceptance_fixtures_disable_git_text_diff_and_merge(self):
        paths = (
            'browser-rag/acceptance/selectable-test.pdf',
            'browser-rag/acceptance/empty-test.pdf',
            'browser-rag/acceptance/pagination-test.pdf',
        )
        result = subprocess.run(
            ['git', 'check-attr', 'text', 'diff', 'merge', '--', *paths],
            cwd=build.ROOT, check=True, capture_output=True, text=True,
        )
        self.assertEqual(result.stdout.splitlines(), [
            f'{path}: {attribute}: unset'
            for path in paths for attribute in ('text', 'diff', 'merge')
        ])

    def test_extraction_lab_is_embedded_in_the_existing_article_not_just_linked(self):
        article = (build.ROOT / 'articles' / '01-two-lifecycles.md').read_text(encoding='utf-8')
        self.assertIn('id="browser-source-lab"', article)
        self.assertIn('src="browser-rag/inspector.html"', article)
        self.assertIn('Extracted; not indexed', article)

    def test_reader_file_is_explicit_and_the_inspector_does_not_claim_an_answer(self):
        entry = build.ROOT / 'browser-rag' / 'inspector.html'
        self.assertTrue(entry.is_file(), 'the extraction inspector does not exist')
        markup = entry.read_text(encoding='utf-8')
        self.assertIn('type="file"', markup)
        self.assertIn('id="pdf-file"', markup)
        self.assertIn('id="cancel"', markup)
        self.assertIn('id="clear"', markup)
        self.assertIn('Extracted; not indexed', markup)
        self.assertIn('Content-Security-Policy', markup)
        self.assertIn("form-action 'none'", markup)
        self.assertIn('src="pdf-app.mjs"', markup)
        self.assertNotIn('https://', markup)

    def test_chunk_inspection_is_explicit_bounded_and_not_an_embedding_claim(self):
        markup = (build.ROOT / 'browser-rag' / 'inspector.html').read_text(encoding='utf-8')
        for identifier in ('build-chunks', 'chunk-select', 'chunk-detail', 'chunk-meta'):
            self.assertIn(f'id="{identifier}"', markup)
        self.assertIn('Chunked; not embedded', markup)
        self.assertIn('one chunk at a time', markup)
        self.assertIn('no source span', markup)
        self.assertNotIn('type="search"', markup)


class BrowserAssetsTest(unittest.TestCase):
    def setUp(self):
        fixtures.FreshBuildTest.setUp(self)
        self.browser = self.root / 'browser-rag'
        self.browser.mkdir()
        for name in ('inspector.html', 'inspector.css', 'pdf-app.mjs', 'pdf-session.mjs', 'pdf-source.mjs', 'protocol.mjs', 'item-window.mjs', 'chunking.mjs', 'compute-source.mjs', 'compute.worker.mjs'):
            (self.browser / name).write_text('<!-- fixture -->' if name.endswith('.html') else 'fixture', encoding='utf-8')
        self.package = self.browser / 'node_modules' / 'pdfjs-dist'
        (self.package / 'build').mkdir(parents=True)
        (self.package / 'package.json').write_text(json.dumps({'version': '6.4.299'}))
        modules = {'build/pdf.mjs': b'API FIXTURE', 'build/pdf.worker.mjs': b'WORKER FIXTURE'}
        for name, data in modules.items():
            (self.package / name).write_bytes(data)
        (self.package / 'LICENSE').write_bytes(b'LICENSE FIXTURE')
        (self.package / 'standard_fonts').mkdir()
        (self.package / 'standard_fonts' / 'example.ttf').write_bytes(b'FONT FIXTURE')
        (self.package / 'standard_fonts' / 'LICENSE_FOXIT').write_bytes(b'NOTICE FIXTURE')
        (self.package / 'standard_fonts' / 'private.txt').write_bytes(b'NOT A RUNTIME ASSET')
        (self.browser / 'secret.env').write_bytes(b'NOT A RUNTIME ASSET')
        self.registry = {'version': '6.4.299', 'moduleHashes': {
            name: hashlib.sha256(data).hexdigest() for name, data in modules.items()}}
        (self.browser / 'pdf-assets.json').write_text(json.dumps(self.registry))

    def test_only_named_browser_assets_and_paired_resources_are_delivered(self):
        build.build()
        output = self.root / 'dist' / 'browser-rag'
        self.assertTrue((output / 'pdf-source.mjs').is_file(), 'fresh build omits the PDF source module')
        self.assertTrue((output / 'item-window.mjs').is_file(), 'fresh build omits the bounded preview module')
        self.assertEqual((output / 'pdf-source.mjs').read_bytes(), (self.browser / 'pdf-source.mjs').read_bytes())
        self.assertEqual((output / 'vendor' / 'build' / 'pdf.worker.mjs').read_bytes(), b'WORKER FIXTURE')
        self.assertTrue((output / 'vendor' / 'standard_fonts' / 'example.ttf').is_file())
        self.assertTrue((output / 'vendor' / 'standard_fonts' / 'LICENSE_FOXIT').is_file())
        self.assertFalse((output / 'secret.env').exists())
        self.assertFalse((output / 'vendor' / 'standard_fonts' / 'private.txt').exists())
        self.assertFalse((output / 'node_modules').exists())

    def test_named_compute_modules_are_delivered_without_test_sources(self):
        (self.browser / 'tests').mkdir()
        (self.browser / 'tests' / 'compute-source.test.mjs').write_bytes(b'NOT RUNTIME')
        build.build()
        output = self.root / 'dist' / 'browser-rag'
        for name in ('chunking.mjs', 'compute-source.mjs', 'compute.worker.mjs'):
            self.assertEqual((output / name).read_bytes(), (self.browser / name).read_bytes())
        self.assertFalse((output / 'tests').exists())

    def test_missing_compute_worker_preserves_previous_build(self):
        build.build()
        before = fixtures.file_snapshot(self.root / 'dist')
        (self.browser / 'compute.worker.mjs').unlink()
        with self.assertRaisesRegex((ValueError, FileNotFoundError), 'compute.worker'):
            build.build()
        self.assertEqual(fixtures.file_snapshot(self.root / 'dist'), before)

    def test_missing_core_asset_cannot_borrow_previous_build(self):
        build.build()
        before = fixtures.file_snapshot(self.root / 'dist')
        (self.browser / 'pdf-source.mjs').unlink()
        with self.assertRaisesRegex((ValueError, FileNotFoundError), 'pdf-source'):
            build.build()
        self.assertEqual(fixtures.file_snapshot(self.root / 'dist'), before)

    def test_wrong_package_version_and_changed_worker_bytes_fail_before_promotion(self):
        (self.package / 'package.json').write_text(json.dumps({'version': 'OLD'}))
        with self.assertRaisesRegex(ValueError, 'version'):
            build.build()
        self.assertFalse((self.root / 'dist').exists())
        (self.package / 'package.json').write_text(json.dumps({'version': '6.4.299'}))
        (self.package / 'build' / 'pdf.worker.mjs').write_bytes(b'STALE WORKER')
        with self.assertRaisesRegex(ValueError, 'hash'):
            build.build()
        self.assertFalse((self.root / 'dist').exists())
