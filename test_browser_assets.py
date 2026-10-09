"""Synthetic filesystem tests, not real parser/worker acceptance."""
import hashlib
import json
import re
import subprocess
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
import test_build as fixtures
import build


REPOSITORY_BROWSER = Path(__file__).resolve().parent / 'browser-rag'
STATIC_RELATIVE_MJS_IMPORT = re.compile(
    r"^[ \t]*(?:import|export)[ \t]+(?:[^;]*?\bfrom[ \t]+)?['\"](\.{1,2}/[^'\"]+\.mjs)['\"][ \t]*;",
    re.MULTILINE,
)


def static_mjs_graph(directory, entry):
    """Literal relative static .mjs imports only; do not execute SDK/worker URLs."""
    directory = directory.resolve()
    pending = [directory / entry]
    graph = {}
    while pending:
        module = pending.pop().resolve()
        if not module.is_relative_to(directory) or not module.is_file():
            raise AssertionError(f'Missing or escaping static module: {module}')
        relative = module.relative_to(directory).as_posix()
        if relative in graph:
            continue
        imports = STATIC_RELATIVE_MJS_IMPORT.findall(module.read_text(encoding='utf-8'))
        graph[relative] = set(imports)
        pending.extend(module.parent / reference for reference in imports)
    return graph


class InspectorMarkupTest(unittest.TestCase):
    def test_csp_allows_same_origin_wasm_without_broad_eval_or_remote_workers(self):
        markup = (build.ROOT / 'browser-rag' / 'inspector.html').read_text(encoding='utf-8')
        policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', markup)
        self.assertIsNotNone(policy)
        directives = {parts[0]: parts[1:] for directive in policy.group(1).split(';')
                      if (parts := directive.split())}
        self.assertEqual(directives['script-src'], ["'self'", "'wasm-unsafe-eval'"])
        self.assertEqual(directives['worker-src'], ["'self'"])
        self.assertEqual(directives['connect-src'], ["'self'"])
        self.assertEqual(directives['form-action'], ["'none'"])
        self.assertNotIn("'unsafe-eval'", policy.group(1))
        self.assertNotIn('https:', policy.group(1))

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

    def test_embedding_inspection_is_explicit_and_evidence_bounded(self):
        markup = (build.ROOT / 'browser-rag' / 'inspector.html').read_text(encoding='utf-8')
        for identifier in ('embed-chunks', 'embedding-detail', 'embedding-meta', 'operation-progress'):
            self.assertIn(f'id="{identifier}"', markup)
        for text in ('113,629,084', '751bff37182d3f1213fa05d7196b954e230abad9',
                     '512 chunks', '256 tokens', '131,072', 'Embedded; not retrieved',
                     'UTF-16', 'CPU fallback', 'pooling', 'GPU memory'):
            self.assertIn(text, markup)
        self.assertNotIn('NO MODEL', markup)
        app = (build.ROOT / 'browser-rag' / 'pdf-app.mjs').read_text(encoding='utf-8')
        self.assertNotIn('innerHTML', app)
        self.assertIn('session.embed()', app)
        self.assertIn('lastEmbeddings', app)


class BrowserAssetsTest(unittest.TestCase):
    def setUp(self):
        fixtures.FreshBuildTest.setUp(self)
        self.browser = self.root / 'browser-rag'
        self.browser.mkdir()
        for name in ('inspector.html', 'inspector.css', 'pdf-app.mjs', 'pdf-session.mjs', 'pdf-source.mjs', 'protocol.mjs', 'item-window.mjs', 'chunking.mjs', 'compute-source.mjs', 'compute.worker.mjs', 'embedding-contract.mjs', 'embedding-runtime.mjs', 'embedding-source.mjs', 'embedding.worker.mjs'):
            if name.endswith('.mjs'):
                (self.browser / name).write_bytes((REPOSITORY_BROWSER / name).read_bytes())
            else:
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

    def test_pdf_only_build_closes_the_real_static_module_graph_without_model_assets(self):
        # Real paired PDF.js module bodies also remain data-only build inputs.
        for name in self.registry['moduleHashes']:
            data = (REPOSITORY_BROWSER / 'node_modules' / 'pdfjs-dist' / name).read_bytes()
            (self.package / name).write_bytes(data)
            self.registry['moduleHashes'][name] = hashlib.sha256(data).hexdigest()
        (self.browser / 'pdf-assets.json').write_text(json.dumps(self.registry))
        build.build()
        output = self.root / 'dist' / 'browser-rag'
        graph = static_mjs_graph(output, 'pdf-app.mjs')
        self.assertIn('./pdf-session.mjs', graph['pdf-app.mjs'])
        self.assertIn('./embedding-source.mjs', graph['pdf-session.mjs'])
        self.assertIn('./embedding-contract.mjs', graph['embedding-source.mjs'])
        self.assertEqual(graph['embedding-contract.mjs'], set())
        self.assertNotIn('embedding-runtime.mjs', graph,
                         'The app static graph must not eagerly import the model runtime.')
        worker_graph = static_mjs_graph(output, 'embedding.worker.mjs')
        self.assertIn('./embedding-runtime.mjs', worker_graph['embedding.worker.mjs'])
        self.assertIn('./embedding-contract.mjs', worker_graph['embedding-runtime.mjs'])
        for name in set(graph) | set(worker_graph):
            source = (self.package / name.removeprefix('vendor/') if name.startswith('vendor/')
                      else REPOSITORY_BROWSER / name)
            self.assertEqual((output / name).read_bytes(), source.read_bytes(), name)
        for relative in ('embedding-assets.json', 'models', 'vendor/transformers', 'notices',
                         'node_modules', 'tests', 'secret.env'):
            self.assertFalse((output / relative).exists(), relative)

    def test_pdf_only_missing_contract_refuses_before_promotion_and_retains_all_previous_bytes(self):
        build.build()
        previous_binary = self.root / 'dist' / 'prior-output' / 'binary.bin'
        previous_binary.parent.mkdir()
        previous_binary.write_bytes(bytes(range(256)))
        before = fixtures.file_snapshot(self.root / 'dist')
        (self.browser / 'embedding-contract.mjs').unlink()
        (self.browser / 'inspector.css').write_bytes(b'CHANGED CORE STYLE')
        with self.assertRaisesRegex((ValueError, FileNotFoundError), 'embedding-contract'):
            build.build()
        self.assertEqual(fixtures.file_snapshot(self.root / 'dist'), before)
        self.assertFalse((self.root / '.build-recovery').exists(),
                         'A missing core module must refuse before moving the old output.')
        self.assertEqual(list(self.root.glob('.dist-stage-*')), [])

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

    def test_named_embedding_modules_are_delivered_without_unknown_files(self):
        (self.browser / 'unknown.mjs').write_bytes(b'PRIVATE UNKNOWN')
        build.build()
        output = self.root / 'dist' / 'browser-rag'
        for name in ('embedding-runtime.mjs', 'embedding-source.mjs', 'embedding.worker.mjs'):
            self.assertTrue((output / name).is_file(), f'fresh build omits {name}')
            self.assertEqual((output / name).read_bytes(), (self.browser / name).read_bytes())
        self.assertFalse((output / 'unknown.mjs').exists())

    def test_missing_each_embedding_module_preserves_previous_build(self):
        build.build()
        before = fixtures.file_snapshot(self.root / 'dist')
        for name in ('embedding-runtime.mjs', 'embedding-source.mjs', 'embedding.worker.mjs'):
            with self.subTest(name=name):
                source = self.browser / name
                data = source.read_bytes()
                source.unlink()
                try:
                    with self.assertRaisesRegex((ValueError, FileNotFoundError), re.escape(name)):
                        build.build()
                    self.assertEqual(fixtures.file_snapshot(self.root / 'dist'), before)
                finally:
                    source.write_bytes(data)

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


MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
MODEL_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9'
LIBRARY_VERSION = '3.8.1'
ORT_VERSION = '1.22.0-dev.20250409-89f8206ba4'
MODEL_NAMES = ('config.json', 'tokenizer.json', 'tokenizer_config.json',
               'special_tokens_map.json', 'onnx/model.onnx')
RUNTIME_NAMES = ('transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs',
                 'ort-wasm-simd-threaded.jsep.wasm')
NOTICE_SOURCES = {
    'TRANSFORMERS-LICENSE.txt': 'node_modules/@huggingface/transformers/LICENSE',
    'JINJA-LICENSE.txt': 'node_modules/@huggingface/jinja/LICENSE',
    'FLATBUFFERS-LICENSE.txt': 'node_modules/flatbuffers/LICENSE',
    'LONG-LICENSE.txt': 'node_modules/long/LICENSE',
    'PLATFORM-LICENSE.txt': 'node_modules/platform/LICENSE',
    'PROTOBUFJS-LICENSE.txt': 'node_modules/protobufjs/LICENSE',
    'MODEL-CARD.txt': f'.model-cache/{MODEL_REVISION}/README.md',
    'ONNXRUNTIME-LICENSE.txt': 'notices/ONNXRUNTIME-LICENSE.txt',
    'ONNXRUNTIME-ThirdPartyNotices.txt': 'notices/ONNXRUNTIME-ThirdPartyNotices.txt',
    'ATTRIBUTION.txt': 'notices/ATTRIBUTION.txt',
}


def metadata(data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


class EmbeddingAssetsTest(unittest.TestCase):
    """Exercise fresh builds with tiny, explicitly named package/model fixtures."""
    def setUp(self):
        BrowserAssetsTest.setUp(self)
        self.transformers = self.browser / 'node_modules' / '@huggingface' / 'transformers'
        self.ort = self.browser / 'node_modules' / 'onnxruntime-web'
        self.models = self.browser / '.model-cache' / MODEL_REVISION
        self.embedding_registry = {
            'schemaVersion': 1, 'modelId': MODEL_ID, 'revision': MODEL_REVISION,
            'libraryVersion': LIBRARY_VERSION, 'ortVersion': ORT_VERSION,
            'modelFiles': {}, 'runtimeFiles': {}, 'noticeFiles': {},
        }
        for package, version in ((self.transformers, LIBRARY_VERSION), (self.ort, ORT_VERSION)):
            package.mkdir(parents=True)
            (package / 'package.json').write_text(json.dumps({'version': version}))
        for name in MODEL_NAMES:
            self.add_asset('modelFiles', name, self.models / name, b'MODEL ' + name.encode())
        for name in RUNTIME_NAMES:
            self.add_asset('runtimeFiles', name, self.transformers / 'dist' / name,
                           b'RUNTIME ' + name.encode())
        for name, relative_source in NOTICE_SOURCES.items():
            self.add_asset('noticeFiles', name, self.browser / relative_source,
                           b'NOTICE ' + name.encode())
        (self.browser / 'embedding-contract.mjs').write_bytes(b'CONTRACT FIXTURE')
        self.write_registry()

    def add_asset(self, group, name, source, data):
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(data)
        self.embedding_registry[group][name] = metadata(data)

    def write_registry(self):
        (self.browser / 'embedding-assets.json').write_text(json.dumps(self.embedding_registry))

    def source_for(self, group, name):
        if group == 'modelFiles':
            return self.models / name
        if group == 'runtimeFiles':
            return self.transformers / 'dist' / name
        return self.browser / NOTICE_SOURCES[name]

    def assert_rejected_preserving_dist(self, error='[Ee]mbedding|version|hash|bytes|registry|asset'):
        before = fixtures.file_snapshot(self.root / 'dist')
        with self.assertRaisesRegex((ValueError, FileNotFoundError), error):
            build.build()
        self.assertEqual(fixtures.file_snapshot(self.root / 'dist'), before)
        self.assertEqual(list(self.root.glob('.dist-stage-*')), [])

    def test_pinned_assets_are_copied_to_named_same_origin_paths_only(self):
        for source in (self.transformers / 'dist' / 'transformers.web.js',
                       self.models / 'onnx' / 'model_quantized.onnx',
                       self.browser / 'acceptance' / 'private.pdf',
                       self.browser / 'tests' / 'embedding.test.mjs'):
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(b'NOT A SHIPPED ASSET')
        build.build()
        output = self.root / 'dist' / 'browser-rag'
        self.assertTrue((output / 'embedding-assets.json').is_file(), 'embedding registry was not delivered')
        self.assertEqual((output / 'embedding-assets.json').read_bytes(),
                         (self.browser / 'embedding-assets.json').read_bytes())
        self.assertEqual((output / 'embedding-contract.mjs').read_bytes(), b'CONTRACT FIXTURE')
        for group, prefix in (('modelFiles', f'models/{MODEL_REVISION}/{MODEL_ID}'),
                              ('runtimeFiles', 'vendor/transformers'), ('noticeFiles', 'notices')):
            for name in self.embedding_registry[group]:
                with self.subTest(group=group, name=name):
                    self.assertEqual((output / prefix / name).read_bytes(),
                                     self.source_for(group, name).read_bytes())
        actual = set(fixtures.file_snapshot(output))
        self.assertFalse(any(name.startswith(('.model-cache', 'node_modules', 'tests', 'acceptance'))
                             for name in actual))
        self.assertFalse(any('quantized' in name or 'transformers.web.js' in name for name in actual))

    def test_every_missing_pinned_asset_preserves_previous_build(self):
        build.build()
        for group in ('modelFiles', 'runtimeFiles', 'noticeFiles'):
            for name in self.embedding_registry[group]:
                with self.subTest(group=group, name=name):
                    source = self.source_for(group, name)
                    data = source.read_bytes()
                    source.unlink()
                    try:
                        self.assert_rejected_preserving_dist()
                    finally:
                        source.write_bytes(data)

    def test_changed_bytes_and_same_length_wrong_hashes_preserve_previous_build(self):
        build.build()
        for group, name in (('modelFiles', 'onnx/model.onnx'),
                            ('runtimeFiles', 'transformers.min.js'),
                            ('noticeFiles', 'ATTRIBUTION.txt')):
            source = self.source_for(group, name)
            data = source.read_bytes()
            for damaged in (data + b'!', bytes([data[0] ^ 1]) + data[1:]):
                with self.subTest(group=group, bytes=len(damaged)):
                    source.write_bytes(damaged)
                    try:
                        self.assert_rejected_preserving_dist('bytes|hash')
                    finally:
                        source.write_bytes(data)

    def test_wrong_pinned_registry_identity_preserves_previous_build(self):
        build.build()
        original = deepcopy(self.embedding_registry)
        cases = (('schemaVersion', 2), ('schemaVersion', True), ('schemaVersion', 1.0),
                 ('modelId', 'attacker/model'), ('revision', '0' * 40),
                 ('libraryVersion', '3.8.0'), ('ortVersion', '1.22.0'))
        for key, value in cases:
            with self.subTest(key=key, value=value):
                self.embedding_registry[key] = value
                self.write_registry()
                try:
                    self.assert_rejected_preserving_dist()
                finally:
                    self.embedding_registry = deepcopy(original)
                    self.write_registry()

    def test_wrong_installed_versions_preserve_previous_build(self):
        build.build()
        for package, version in ((self.transformers, LIBRARY_VERSION), (self.ort, ORT_VERSION)):
            with self.subTest(package=package.name):
                source = package / 'package.json'
                source.write_text(json.dumps({'version': 'OLD'}))
                try:
                    self.assert_rejected_preserving_dist('version')
                finally:
                    source.write_text(json.dumps({'version': version}))

    def test_registry_rejects_missing_extra_and_escaping_file_keys(self):
        build.build()
        original = deepcopy(self.embedding_registry)
        for group in ('modelFiles', 'runtimeFiles', 'noticeFiles'):
            for action in ('missing', 'extra', 'escape'):
                with self.subTest(group=group, action=action):
                    name = next(iter(self.embedding_registry[group]))
                    if action == 'missing':
                        del self.embedding_registry[group][name]
                    else:
                        added = 'surprise.txt' if action == 'extra' else '../../secret.env'
                        self.embedding_registry[group][added] = metadata(b'ignored')
                    self.write_registry()
                    try:
                        self.assert_rejected_preserving_dist('registry')
                    finally:
                        self.embedding_registry = deepcopy(original)
                        self.write_registry()

    def test_registry_requires_positive_integer_bytes_and_sha256_metadata(self):
        build.build()
        original = deepcopy(self.embedding_registry)
        cases = ({'bytes': 0, 'sha256': '0' * 64},
                 {'bytes': -1, 'sha256': '0' * 64},
                 {'bytes': True, 'sha256': '0' * 64},
                 {'bytes': 1.0, 'sha256': '0' * 64},
                 {'bytes': '1', 'sha256': '0' * 64},
                 {'bytes': 1, 'sha256': 'z' * 64},
                 {'bytes': 1, 'sha256': '0' * 63},
                 {'bytes': 1, 'sha256': None},
                 {'bytes': 1}, {'bytes': 1, 'sha256': '0' * 64, 'source': '../../secret.env'})
        for group in ('modelFiles', 'runtimeFiles', 'noticeFiles'):
            for value in cases:
                with self.subTest(group=group, value=value):
                    self.embedding_registry[group][next(iter(self.embedding_registry[group]))] = value
                    self.write_registry()
                    try:
                        self.assert_rejected_preserving_dist('metadata')
                    finally:
                        self.embedding_registry = deepcopy(original)
                        self.write_registry()

    def test_registry_top_level_keys_are_exact_and_required(self):
        build.build()
        original = deepcopy(self.embedding_registry)
        for action in ('extra', 'missing'):
            with self.subTest(action=action):
                if action == 'extra':
                    self.embedding_registry['source'] = '../../secret.env'
                else:
                    del self.embedding_registry['noticeFiles']
                self.write_registry()
                try:
                    self.assert_rejected_preserving_dist('registry')
                finally:
                    self.embedding_registry = deepcopy(original)
                    self.write_registry()

    def test_missing_contract_preserves_previous_build(self):
        build.build()
        (self.browser / 'embedding-contract.mjs').unlink()
        self.assert_rejected_preserving_dist('embedding-contract')

    def test_absent_registry_keeps_pdf_only_build_compatible_without_model_packages(self):
        build.build()
        before = fixtures.file_snapshot(self.root / 'dist')
        (self.browser / 'embedding-assets.json').unlink()
        (self.transformers / 'package.json').unlink()
        (self.ort / 'package.json').unlink()
        (self.models / 'onnx' / 'model.onnx').unlink()
        result = build.build()
        output = self.root / 'dist' / 'browser-rag'
        self.assertEqual((output / 'pdf-source.mjs').read_bytes(),
                         (self.browser / 'pdf-source.mjs').read_bytes())
        self.assertTrue((output / 'embedding-contract.mjs').is_file(),
                        'The PDF-only static module graph needs the pure embedding contract.')
        self.assertEqual((output / 'embedding-contract.mjs').read_bytes(),
                         (self.browser / 'embedding-contract.mjs').read_bytes())
        for relative in ('embedding-assets.json', 'models', 'vendor/transformers', 'notices'):
            self.assertFalse((output / relative).exists(), relative)
        self.assertEqual(fixtures.file_snapshot(result['recovery_path']), before)

    def test_unchanged_pinned_assets_do_not_accumulate_recovery_copies(self):
        build.build()
        result = build.build()
        self.assertEqual(result['status'], 'unchanged')
        self.assertIsNone(result['recovery_path'])
        self.assertFalse((self.root / '.build-recovery').exists())

    def test_failed_embedding_promotion_restores_previous_output(self):
        build.build()
        before = fixtures.file_snapshot(self.root / 'dist')
        (self.browser / 'inspector.css').write_bytes(b'CHANGED CORE STYLE')
        real_rename = Path.rename

        def blocked_promotion(path, target):
            if path.name.startswith('.dist-stage-') and Path(target) == self.root / 'dist':
                raise OSError('simulated embedding build promotion lock')
            return real_rename(path, target)

        with patch.object(Path, 'rename', blocked_promotion):
            with self.assertRaisesRegex(OSError, 'promotion lock'):
                build.build()
        self.assertEqual(fixtures.file_snapshot(self.root / 'dist'), before)
        self.assertEqual(list(self.root.glob('.dist-stage-*')), [])

    def test_failed_embedding_restore_retains_recovery_and_reports_its_path(self):
        build.build()
        before = fixtures.file_snapshot(self.root / 'dist')
        (self.browser / 'inspector.css').write_bytes(b'CHANGED CORE STYLE')
        real_rename = Path.rename

        def blocked_promotion_and_restore(path, target):
            if Path(target) == self.root / 'dist':
                if path.name.startswith('.dist-stage-'):
                    raise OSError('simulated embedding build promotion lock')
                if path.parent == self.root / '.build-recovery':
                    raise OSError('simulated embedding build restore lock')
            return real_rename(path, target)

        with patch.object(Path, 'rename', blocked_promotion_and_restore):
            with self.assertRaisesRegex(OSError, 'Promotion failed; restore also failed') as captured:
                build.build()
        recovery = list((self.root / '.build-recovery').iterdir())
        self.assertEqual(len(recovery), 1)
        self.assertEqual(fixtures.file_snapshot(recovery[0]), before)
        self.assertIn(str(recovery[0]), str(captured.exception))
        self.assertFalse((self.root / 'dist').exists())
        self.assertEqual(list(self.root.glob('.dist-stage-*')), [])


class RealEmbeddingRegistryTest(unittest.TestCase):
    def test_recorded_metadata_matches_all_named_installed_bytes_without_inference(self):
        browser = build.ROOT / 'browser-rag'
        self.assertTrue((browser / 'embedding-assets.json').is_file(), 'pinned embedding registry is missing')
        registry = json.loads((browser / 'embedding-assets.json').read_text(encoding='utf-8'))
        self.assertEqual(registry['schemaVersion'], 1)
        self.assertEqual(registry['modelId'], MODEL_ID)
        self.assertEqual(registry['revision'], MODEL_REVISION)
        self.assertEqual(registry['libraryVersion'], LIBRARY_VERSION)
        self.assertEqual(registry['ortVersion'], ORT_VERSION)
        expected_model = {
            'config.json': (650, '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7'),
            'tokenizer.json': (711661, 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0'),
            'tokenizer_config.json': (366, '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3'),
            'special_tokens_map.json': (125, 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3'),
            'onnx/model.onnx': (90387606, '759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e'),
        }
        expected_runtime = {
            'transformers.min.js': (888173, 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa'),
            'ort-wasm-simd-threaded.jsep.mjs': (44484, '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9'),
            'ort-wasm-simd-threaded.jsep.wasm': (21596019, 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'),
        }
        for group, expected, directory in (
            ('modelFiles', expected_model, browser / '.model-cache' / MODEL_REVISION),
            ('runtimeFiles', expected_runtime, browser / 'node_modules' / '@huggingface' / 'transformers' / 'dist'),
        ):
            self.assertEqual(set(registry[group]), set(expected))
            for name, (size, digest) in expected.items():
                with self.subTest(group=group, name=name):
                    self.assertEqual(registry[group][name], {'bytes': size, 'sha256': digest})
                    self.assertEqual(metadata((directory / name).read_bytes()), registry[group][name])
        self.assertEqual(set(registry['noticeFiles']), set(NOTICE_SOURCES))
        for name, relative_source in NOTICE_SOURCES.items():
            with self.subTest(notice=name):
                self.assertEqual(metadata((browser / relative_source).read_bytes()), registry['noticeFiles'][name])
