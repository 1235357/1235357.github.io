"""Offline boundaries for the local generator probe; no bound HTTP server."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import tempfile
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / 'browser-rag' / 'acceptance' / 'serve-generator-probe.py'
SPEC = importlib.util.spec_from_file_location('generator_probe_server', SCRIPT)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)

REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'
MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct'
MODEL_PREFIX = f'/browser-rag/models/{REVISION}/{MODEL_ID}/'
EMBEDDING_PREFIX = '/browser-rag/models/751bff37182d3f1213fa05d7196b954e230abad9/Xenova/all-MiniLM-L6-v2/'
EMBEDDING_NAMES = frozenset(('config.json', 'tokenizer.json', 'tokenizer_config.json',
                           'special_tokens_map.json', 'onnx/model.onnx'))
MODEL_FILES = {
    'config.json': (678, '777e01f0fbb3346eb229cb6fb278ed6533c1e4dcb9ebf4bed0f6e94ef17fa1b5'),
    'tokenizer.json': (7031673, 'a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf'),
    'tokenizer_config.json': (7849, '6a14243f0ae04884e597b3f032c05e15de9f417318fdcac24ab4e2680e691430'),
    'generation_config.json': (242, 'f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3'),
    'onnx/model_q4.onnx': (786156820, '09235a3b1c135cd04ef570e5053b5c079e028078a2cc5f76ba6a251e91bf3296'),
}
RUNTIME_FILES = {
    'transformers.min.js': (888173, 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa'),
    'ort-wasm-simd-threaded.jsep.mjs': (44484, '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9'),
    'ort-wasm-simd-threaded.jsep.wasm': (21596019, 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'),
}
DIAGNOSTICS = frozenset(('generator-probe.html', 'generator-probe.mjs',
    'generator-probe.worker.mjs', 'generator-probe-runtime.mjs', 'generator-probe-assets.json'))
SOURCE_MODULES = frozenset(('generator-contract.mjs', 'generator-native-core.mjs', 'receipt-snapshot.mjs',
    'financial-generation-input.mjs', 'financial-generation-source.mjs', 'financial-generation.worker.mjs',
    'financial-generator-runtime.mjs', 'financial-generator-contract.mjs', 'prompt-contract.mjs', 'financial-output-contract.mjs',
    'financial-geometry-source.mjs', 'financial-geometry-view.mjs',
    'financial-table-contract.mjs', 'financial-annual-table-contract.mjs', 'financial-lookup-view.mjs'))


def pinned_manifest():
    return {'schemaVersion': 1, 'modelId': MODEL_ID, 'revision': REVISION,
            'modelFiles': {name: {'bytes': count, 'sha256': digest}
                           for name, (count, digest) in MODEL_FILES.items()},
            'runtimeFiles': {name: {'bytes': count, 'sha256': digest}
                             for name, (count, digest) in RUNTIME_FILES.items()}}


class ProbeFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='generator-probe-tests-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.dist = self.root / 'dist'
        self.dist.mkdir()
        self.browser = self.root / 'browser-rag'
        self.acceptance = self.browser / 'acceptance'
        self.acceptance.mkdir(parents=True)
        self.write(self.dist / 'index.html', b'<html>local draft</html>')
        for name in DIAGNOSTICS:
            self.write(self.acceptance / name, b'authored diagnostic')
        for name in SOURCE_MODULES:
            self.write(self.browser / name, b'authored module')
        self.write(self.browser / 'pdf-private-entry.mjs', b'authored private entry')
        for name in ('inspector.html', 'inspector.css', 'pdf-entry.mjs', 'pdf-app.mjs', 'pdf-session.mjs',
                     'pdf-source.mjs', 'protocol.mjs', 'runtime-failure-contract.mjs', 'item-window.mjs', 'chunking.mjs', 'compute-source.mjs',
                     'compute.worker.mjs', 'embedding-contract.mjs', 'embedding-runtime.mjs', 'embedding-source.mjs',
                     'embedding.worker.mjs', 'retrieval.mjs', 'retrieval-inspection.mjs', 'retrieval-inspection-view.mjs',
                     'query-source.mjs', 'query.worker.mjs', 'worker-console.mjs',
                     'context-contract.mjs', 'context-view.mjs', 'generation-view.mjs', 'bounded-text-view.mjs', 'complete-record-disclosure.mjs',
                     'verified-stream.mjs', 'verified-cache.mjs', 'vendor/build/pdf.mjs', 'vendor/build/pdf.worker.mjs'):
            self.write(self.dist / 'browser-rag' / name, b'built shared inspector')
        for name in MODEL_FILES:
            self.write(self.browser / '.model-cache' / REVISION / name, b'tiny route fixture')
        self.write_manifest(pinned_manifest())
        self.write(self.browser / 'embedding-assets.json', json.dumps({
            'runtimeFiles': pinned_manifest()['runtimeFiles'],
        }).encode('utf-8'))

    def write(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def write_manifest(self, value):
        self.manifest_path = self.acceptance / 'generator-probe-assets.json'
        self.manifest_path.write_text(json.dumps(value), encoding='utf-8')


class ConfigurationTest(ProbeFixture):
    def test_default_port_and_cli_accepts_only_a_valid_port(self):
        parser = probe.create_parser()
        self.assertIsNotNone(parser, 'missing port-only command line parser')
        self.assertEqual(parser.parse_args([]).port, 8766)
        for value in ('1', '8766', '65535'):
            self.assertEqual(parser.parse_args(['--port', value]).port, int(value))
        for value in ('0', '-1', '65536', 'not-a-port', '1.5'):
            with self.subTest(value=value), self.assertRaises(SystemExit), \
                    patch('sys.stderr', new=io.StringIO()):
                parser.parse_args(['--port', value])
        with self.assertRaises(SystemExit), patch('sys.stderr', new=io.StringIO()):
            parser.parse_args(['--host', '0.0.0.0'])

    def test_cli_does_not_accept_abbreviated_port_option(self):
        with self.assertRaises(SystemExit), patch('sys.stderr', new=io.StringIO()):
            probe.create_parser().parse_args(['--p', '8766'])

    def test_main_refuses_bad_startup_before_constructing_a_server(self):
        self.write_manifest({'schemaVersion': 1})
        with patch.object(probe, 'REPOSITORY_ROOT', self.root), \
                patch.object(probe, 'HTTPServer', side_effect=AssertionError('bound before verification')):
            with self.assertRaisesRegex(SystemExit, 'startup refused'):
                probe.main([])

    def test_exact_hardcoded_manifest_is_accepted(self):
        self.assertEqual(probe.read_manifest(self.root), pinned_manifest())

    def test_manifest_rejects_changed_pins_unknown_keys_and_wrong_types(self):
        mutations = (
            lambda value: value.update(extra=True),
            lambda value: value.update(schemaVersion=True),
            lambda value: value.update(modelId='other/model'),
            lambda value: value.update(revision='a' * 40),
            lambda value: value['modelFiles'].update(private={'bytes': 1, 'sha256': 'a' * 64}),
            lambda value: value['modelFiles']['config.json'].update(bytes=1),
            lambda value: value['modelFiles']['config.json'].update(sha256='a' * 64),
            lambda value: value['modelFiles']['config.json'].update(url='https://example.test'),
            lambda value: value['runtimeFiles']['transformers.min.js'].update(bytes=888173.0),
            lambda value: value['runtimeFiles'].pop('transformers.min.js'),
        )
        for index, mutate in enumerate(mutations):
            value = pinned_manifest()
            mutate(value)
            self.write_manifest(value)
            with self.subTest(index=index), self.assertRaises(ValueError):
                probe.read_manifest(self.root)

    def test_manifest_read_is_bounded_and_duplicate_json_fields_are_rejected(self):
        self.manifest_path.write_bytes(b' ' * 32769)
        with self.assertRaises(ValueError):
            probe.read_manifest(self.root)
        raw = json.dumps(pinned_manifest()).replace('"schemaVersion": 1',
                                                 '"schemaVersion": 1, "schemaVersion": 1')
        self.manifest_path.write_text(raw, encoding='utf-8')
        with self.assertRaises(ValueError):
            probe.read_manifest(self.root)

    def test_startup_fails_when_dist_is_missing(self):
        shutil.rmtree(self.dist)
        with self.assertRaises(ValueError):
            probe.verify_startup(self.root)

    def test_startup_accepts_actual_public_inspector_inventory_and_authored_private_routes(self):
        # Inventory check only: do not read the large model bodies or bind a
        # socket. The real build/module closure is used instead of fabricated
        # shared fixture names; separate tests enforce production asset pins.
        with patch.object(probe, 'verify_file', return_value=None):
            probe.verify_startup(ROOT)
        self.assertTrue(probe.SOURCE_MODULES.isdisjoint(probe.SHARED_INSPECTOR_FILES))
        for name in probe.SOURCE_MODULES:
            with self.subTest(private=name):
                self.assertFalse((ROOT / 'dist' / 'browser-rag' / name).exists())
                self.assertEqual(probe.resolve_request(ROOT, '/browser-rag/' + name),
                                 ROOT / 'browser-rag' / name)
        self.assertFalse((ROOT / 'dist' / 'browser-rag' / 'pdf-private-entry.mjs').exists())
        self.assertEqual(probe.resolve_request(ROOT, '/browser-rag/pdf-entry.mjs'),
                         ROOT / 'browser-rag' / 'pdf-private-entry.mjs')

    def test_private_entry_does_not_hide_a_missing_built_ordinary_entry(self):
        (self.dist / 'browser-rag' / 'pdf-entry.mjs').unlink()
        with patch.object(probe, 'verify_file', return_value=None), \
                self.assertRaisesRegex(ValueError, 'built inspector.*pdf-entry.mjs'):
            probe.verify_startup(self.root)

    def test_startup_does_not_accept_tiny_files_under_real_production_pins(self):
        with self.assertRaisesRegex(ValueError, 'bytes|size|length'):
            probe.verify_startup(self.root)

    def test_startup_requires_every_authored_diagnostic(self):
        (self.acceptance / 'generator-probe.worker.mjs').unlink()
        with self.assertRaisesRegex(ValueError, 'missing|file'):
            probe.verify_startup(self.root)

    def test_missing_native_core_refuses_startup_before_binding(self):
        (self.browser / 'generator-native-core.mjs').unlink()
        with patch.object(probe, 'REPOSITORY_ROOT', self.root), \
                patch.object(probe, 'verify_file', return_value=None), \
                patch.object(probe, 'HTTPServer', side_effect=AssertionError('bound without native core')):
            with self.assertRaisesRegex(SystemExit, 'startup refused'):
                probe.main([])

    def test_missing_receipt_snapshot_refuses_startup_before_binding(self):
        (self.browser / 'receipt-snapshot.mjs').unlink()
        with patch.object(probe, 'REPOSITORY_ROOT', self.root), \
                patch.object(probe, 'verify_file', return_value=None), \
                patch.object(probe, 'HTTPServer', side_effect=AssertionError('bound without static dependency')):
            with self.assertRaisesRegex(SystemExit, 'startup refused'):
                probe.main([])

    def test_startup_rejects_runtime_registry_drift(self):
        self.write(self.browser / 'embedding-assets.json', b'{"runtimeFiles": {}}')
        with self.assertRaisesRegex(ValueError, 'runtime|registry|pins'):
            probe.verify_startup(self.root)


class IntegrityTest(ProbeFixture):
    def test_stream_verification_uses_bounded_reads_and_checks_actual_bytes_and_hash(self):
        data = b'x' * (2 * 1024 * 1024 + 17)
        class BoundedReader(io.BytesIO):
            def read(self, count=-1):
                if not 0 < count <= 1024 * 1024:
                    raise AssertionError('unbounded asset read')
                return super().read(count)
        expected = (len(data), hashlib.sha256(data).hexdigest())
        self.assertEqual(probe.verify_stream(BoundedReader(data), *expected), expected)

    def test_exact_tiny_fixture_descriptor_uses_real_file_verification(self):
        data = b'fixture bytes, not production model bytes'
        path = self.write(self.root / 'fixture.bin', data)
        expected = (len(data), hashlib.sha256(data).hexdigest())
        self.assertEqual(probe.verify_file(path, self.root, *expected), expected)

    def test_stream_rejects_short_long_and_wrong_hash_data(self):
        data = b'abc'
        for expected in ((2, hashlib.sha256(data).hexdigest()),
                         (4, hashlib.sha256(data).hexdigest()), (3, 'a' * 64)):
            with self.subTest(expected=expected), self.assertRaises(ValueError):
                probe.verify_stream(io.BytesIO(data), *expected)

    def test_stream_rejects_invalid_descriptors(self):
        for expected in ((True, 'a' * 64), (0, 'a' * 64), (-1, 'a' * 64),
                         (1.0, 'a' * 64), (1, 'A' * 64), (1, 'z' * 64), (1, 'a' * 63)):
            with self.subTest(expected=expected), self.assertRaises(ValueError):
                probe.verify_stream(io.BytesIO(b'a'), *expected)

    def test_guard_rejects_escaping_paths_and_directory_verification(self):
        with self.assertRaises(ValueError):
            probe.guard_path(self.root.parent / 'outside.bin', self.root)
        with self.assertRaises(ValueError):
            probe.verify_file(self.dist, self.root, 1, 'a' * 64)

    def test_guard_rejects_symlink_file_directory_and_root(self):
        target = self.write(self.root / 'target.bin', b'abc')
        try:
            (self.root / 'linked.bin').symlink_to(target)
            (self.root / 'linked-dir').symlink_to(self.dist, target_is_directory=True)
            (self.root / 'linked-root').symlink_to(self.dist, target_is_directory=True)
        except OSError as error:
            self.skipTest(f'symlink permission unavailable: {error}')
        for path, root in ((self.root / 'linked.bin', self.root),
                           (self.root / 'linked-dir' / 'index.html', self.root),
                           (self.root / 'linked-root' / 'index.html', self.root / 'linked-root')):
            with self.subTest(path=path), self.assertRaises(ValueError):
                probe.guard_path(path, root)

    @unittest.skipUnless(os.name == 'nt', 'Windows junction boundary')
    def test_guard_rejects_windows_directory_junction(self):
        import subprocess
        junction = self.root / 'junction'
        result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(junction), str(self.dist)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.addCleanup(lambda: junction.rmdir() if junction.exists() else None)
        with self.assertRaises(ValueError):
            probe.guard_path(junction / 'index.html', self.root)


class RoutingTest(ProbeFixture):
    def test_root_and_static_file_resolve_only_into_dist(self):
        self.assertEqual(probe.resolve_request(self.root, '/'), self.dist / 'index.html')
        path = self.write(self.dist / 'browser-rag' / 'vendor' / 'transformers' / 'runtime.wasm', b'wasm')
        self.assertEqual(probe.resolve_request(self.root, '/browser-rag/vendor/transformers/runtime.wasm'), path)

    def test_exact_diagnostic_allowlist_and_authored_contract_resolve_from_source(self):
        for name in DIAGNOSTICS:
            with self.subTest(name=name):
                self.assertEqual(probe.resolve_request(self.root, f'/browser-rag/acceptance/{name}'),
                                 self.acceptance / name)
        self.assertEqual(getattr(probe, 'SOURCE_MODULES', None), SOURCE_MODULES)
        for name in SOURCE_MODULES:
            with self.subTest(name=name):
                self.assertEqual(probe.resolve_request(self.root, f'/browser-rag/{name}'),
                                 self.browser / name)

    def test_unknown_source_modules_and_cache_paths_are_not_exposed(self):
        for name in ('pdf-private-entry.mjs', 'private.mjs', 'private.json',
                     '.model-cache/private.onnx'):
            self.write(self.browser / name, b'private source module')
            with self.subTest(name=name), self.assertRaises((ValueError, FileNotFoundError)):
                probe.resolve_request(self.root, f'/browser-rag/{name}')

    def test_model_urls_resolve_only_to_five_exact_pinned_cache_files(self):
        for name in MODEL_FILES:
            with self.subTest(name=name):
                self.assertEqual(probe.resolve_request(self.root, MODEL_PREFIX + name),
                                 self.browser / '.model-cache' / REVISION / name)

    def test_unknown_model_and_acceptance_routes_never_fall_through_to_dist(self):
        for target in (MODEL_PREFIX + 'onnx/model.onnx', MODEL_PREFIX + 'private.json',
                       '/browser-rag/models/other/model/config.json',
                       '/browser-rag/acceptance/private.txt', '/browser-rag/acceptance/'):
            self.write(self.dist / target.lstrip('/') / ('index.html' if target.endswith('/') else ''), b'private')
            with self.subTest(target=target), self.assertRaises((ValueError, FileNotFoundError)):
                probe.resolve_request(self.root, target)

    def test_query_fragment_percent_traversal_and_non_origin_targets_are_rejected(self):
        for target in ('/index.html?cache=1', '/index.html?', '/index.html#fragment', '/index.html#',
                       '/%69ndex.html', '/%2e%2e/private', '/%252e%252e/private', '/../private',
                       '/browser-rag/./generator-contract.mjs', '/browser-rag//generator-contract.mjs',
                       '/browser-rag\\generator-contract.mjs', '//example.test/index.html',
                       'http://example.test/index.html', 'index.html', '/index.html\x00'):
            with self.subTest(target=target), self.assertRaises(ValueError):
                probe.resolve_request(self.root, target)

    def test_missing_files_and_directories_are_not_listed_or_indexed(self):
        self.write(self.dist / 'private-dir' / 'index.html', b'no implicit directory index')
        for target in ('/missing.html', '/private-dir', '/private-dir/', '/browser-rag', '/browser-rag/'):
            with self.subTest(target=target), self.assertRaises((ValueError, FileNotFoundError)):
                probe.resolve_request(self.root, target)

    def test_javascript_and_wasm_mime_are_explicit(self):
        for name, expected in (('probe.js', 'application/javascript'), ('probe.mjs', 'application/javascript'),
                               ('runtime.wasm', 'application/wasm'), ('config.json', 'application/json'),
                               ('index.html', 'text/html; charset=utf-8'), ('weights.onnx', 'application/octet-stream')):
            with self.subTest(name=name):
                self.assertEqual(probe.content_type(Path(name)), expected)


class MemoryConnection:
    """Feed real HTTP handler bytes without opening or binding a socket."""
    def __init__(self, request):
        self.input = io.BytesIO(request)
        self.output = io.BytesIO()

    def makefile(self, mode, buffering=None):
        return self.input

    def sendall(self, data):
        self.output.write(data)


class HandlerTest(ProbeFixture):
    def request(self, method, target, client='127.0.0.1', repository_root=None):
        connection = MemoryConnection(f'{method} {target} HTTP/1.0\r\nHost: localhost\r\n\r\n'.encode('ascii'))
        server = types.SimpleNamespace(repository_root=repository_root or self.root, server_name='localhost', server_port=8766)
        class QuietHandler(probe.ProbeRequestHandler):
            def log_message(self, format, *args):
                pass
        QuietHandler(connection, (client, 54321), server)
        wire = connection.output.getvalue()
        headers, body = wire.split(b'\r\n\r\n', 1)
        lines = headers.decode('iso-8859-1').split('\r\n')
        return int(lines[0].split()[1]), dict(line.split(': ', 1) for line in lines[1:]), body

    def test_get_streams_exact_content_length_and_explicit_mime(self):
        data = b'export const probe = true;\n'
        self.write(self.acceptance / 'generator-probe.mjs', data)
        status, headers, body = self.request('GET', '/browser-rag/acceptance/generator-probe.mjs')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Length'], str(len(data)))
        self.assertEqual(headers['Content-Type'], 'application/javascript')
        self.assertEqual(body, data)

    def test_owned_generation_figure_exact_dark_query_and_json_get_head_use_public_dist(self):
        for target,relative in (('/figures/owned-generation.archify.html','figures/owned-generation.archify.html'),
                                ('/figures/owned-generation.archify.html?theme=dark','figures/owned-generation.archify.html'),
                                ('/figures/owned-generation.archify.json','figures/owned-generation.archify.json')):
            data=(ROOT / 'dist' / relative).read_bytes()
            for method in ('GET','HEAD'):
                with self.subTest(target=target,method=method):
                    status,headers,body=self.request(method,target,repository_root=ROOT)
                    self.assertEqual(status,200)
                    self.assertEqual(probe.resolve_request(ROOT,target),ROOT / 'dist' / relative)
                    self.assertEqual(headers['Content-Length'],str(len(data)))
                    self.assertEqual(headers['Content-Type'],'application/json' if relative.endswith('.json') else 'text/html; charset=utf-8')
                    self.assertEqual(body,data if method=='GET' else b'')
        for target in ('/figures/owned-generation.archify.html?theme=light',
                       '/figures/owned-generation.archify.html?theme=dark&private=1',
                       '/figures/owned-generation.archify.html?theme=dark#fragment',
                       '/figures/owned-generation.archify.json?theme=dark',
                       '/figures/%6fwned-generation.archify.html?theme=dark',
                       '/figures/./owned-generation.archify.html?theme=dark',
                       '/figures/other.archify.html?theme=dark'):
            for method in ('GET','HEAD'):
                with self.subTest(alias=target,method=method):
                    self.assertEqual(self.request(method,target,repository_root=ROOT)[0],404)

    def test_real_public_encoder_closure_get_head_preserve_verified_bytes_and_mime(self):
        # Stream into a digest sink, never retain the 90 MB ONNX body. These
        # are real delivered files and the real handler, with no bound socket.
        class DigestConnection(MemoryConnection):
            def __init__(self, request):
                super().__init__(request)
                self.header_buffer = bytearray()
                self.headers = None
                self.body_bytes = 0
                self.body_sha = hashlib.sha256()
                self.max_body_block = 0

            def sendall(self, data):
                if self.headers is None:
                    self.header_buffer.extend(data)
                    split = self.header_buffer.find(b'\r\n\r\n')
                    if split < 0:
                        if len(self.header_buffer) > 16384:
                            raise AssertionError('unbounded HTTP header')
                        return
                    self.headers = bytes(self.header_buffer[:split])
                    data = bytes(self.header_buffer[split + 4:])
                    self.header_buffer.clear()
                self.body_bytes += len(data)
                self.body_sha.update(data)
                self.max_body_block = max(self.max_body_block, len(data))

        registry = json.loads((ROOT / 'dist' / 'browser-rag' / 'embedding-assets.json').read_bytes())
        self.assertEqual(set(registry['modelFiles']), EMBEDDING_NAMES)
        for name, descriptor in registry['modelFiles'].items():
            for method in ('GET', 'HEAD'):
                with self.subTest(name=name, method=method):
                    target = EMBEDDING_PREFIX + name
                    connection = DigestConnection(f'{method} {target} HTTP/1.0\r\nHost: localhost\r\n\r\n'.encode('ascii'))
                    server = types.SimpleNamespace(repository_root=ROOT, server_name='localhost', server_port=8766)
                    class QuietHandler(probe.ProbeRequestHandler):
                        def log_message(self, format, *args):
                            pass
                    QuietHandler(connection, ('127.0.0.1', 54321), server)
                    lines = connection.headers.decode('iso-8859-1').split('\r\n')
                    self.assertEqual(int(lines[0].split()[1]), 200)
                    headers = dict(line.split(': ', 1) for line in lines[1:])
                    self.assertEqual(headers['Content-Length'], str(descriptor['bytes']))
                    self.assertEqual(headers['Content-Type'], 'application/octet-stream' if name.endswith('.onnx') else 'application/json')
                    self.assertEqual(headers['Cache-Control'], 'no-store')
                    self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
                    self.assertEqual(probe.resolve_request(ROOT, target), ROOT / 'dist' / target[1:])
                    self.assertEqual(connection.body_bytes, descriptor['bytes'] if method == 'GET' else 0)
                    self.assertLessEqual(connection.max_body_block, probe.FILE_BLOCK_BYTES)
                    if method == 'GET':
                        self.assertEqual(connection.body_sha.hexdigest(), descriptor['sha256'])

    def test_unknown_encoder_and_generator_models_do_not_fall_through_to_public_dist(self):
        targets = (EMBEDDING_PREFIX + 'private.json', EMBEDDING_PREFIX + 'onnx/model_q4.onnx',
                   EMBEDDING_PREFIX.replace('751bff37182d3f1213fa05d7196b954e230abad9', 'a' * 40) + 'config.json',
                   EMBEDDING_PREFIX.replace('Xenova/', 'Other/') + 'config.json',
                   MODEL_PREFIX + 'onnx/model.onnx', MODEL_PREFIX + 'private.json')
        for target in targets:
            self.write(self.dist / target[1:], b'PRIVATE dist bytes')
            for method in ('GET', 'HEAD'):
                with self.subTest(target=target, method=method):
                    status, headers, body = self.request(method, target)
                    self.assertEqual(status, 404)
                    self.assertNotIn(b'PRIVATE dist bytes', body)
        for target in (EMBEDDING_PREFIX + 'config.json?cache=1', EMBEDDING_PREFIX + '%63onfig.json',
                       EMBEDDING_PREFIX + './config.json', EMBEDDING_PREFIX + 'config.json.bak',
                       EMBEDDING_PREFIX + 'onnx/../config.json', EMBEDDING_PREFIX + 'config.json/'):
            for method in ('GET', 'HEAD'):
                with self.subTest(alias=target, method=method):
                    self.assertEqual(self.request(method, target)[0], 404)

    def test_get_and_head_native_core_read_the_same_exact_authored_file(self):
        data = b'export const nativeCore = "fixture, not a model run";\n'
        self.write(self.browser / 'generator-native-core.mjs', data)
        for method in ('GET', 'HEAD'):
            with self.subTest(method=method):
                status, headers, body = self.request(method, '/browser-rag/generator-native-core.mjs')
                self.assertEqual(status, 200)
                self.assertEqual(headers['Content-Length'], str(len(data)))
                self.assertEqual(headers['Content-Type'], 'application/javascript')
                self.assertEqual(headers['Cache-Control'], 'no-store')
                self.assertEqual(body, data if method == 'GET' else b'')

    def test_exact_entry_get_head_uses_authored_private_bytes_before_dist(self):
        data = b'import {mountPdfApp} from "./pdf-app.mjs";\n// private exact route\n'
        self.write(self.browser / 'pdf-private-entry.mjs', data)
        self.write(self.dist / 'browser-rag' / 'pdf-entry.mjs', b'PUBLIC ENTRY BYTES')
        for method in ('GET', 'HEAD'):
            status, headers, body = self.request(method, '/browser-rag/pdf-entry.mjs')
            self.assertEqual(status, 200)
            self.assertEqual(headers['Content-Length'], str(len(data)))
            self.assertEqual(headers['Content-Type'], 'application/javascript')
            self.assertEqual(headers.get('X-Content-SHA256'), hashlib.sha256(data).hexdigest())
            self.assertEqual(body, data if method == 'GET' else b'')
        self.write(self.dist / 'browser-rag' / 'pdf-private-entry.mjs', b'PRIVATE BYTES')
        for target in ('/browser-rag/pdf-private-entry.mjs', '/browser-rag/pdf-entry.mjs?private=1',
                       '/browser-rag/%70df-entry.mjs', '/browser-rag/./pdf-entry.mjs'):
            self.assertEqual(self.request('GET', target)[0], 404)
        (self.browser / 'pdf-private-entry.mjs').unlink()
        self.assertEqual(self.request('GET', '/browser-rag/pdf-entry.mjs')[0], 404)

    def test_exact_financial_source_get_head_bytes_mime_length_and_hash(self):
        for name in SOURCE_MODULES:
            data = (ROOT / 'browser-rag' / name).read_bytes()
            self.write(self.browser / name, data)
            for method in ('GET', 'HEAD'):
                with self.subTest(name=name, method=method):
                    status, headers, body = self.request(method, '/browser-rag/' + name)
                    self.assertEqual(status, 200)
                    self.assertEqual(headers['Content-Type'], 'application/javascript')
                    self.assertEqual(headers['Content-Length'], str(len(data)))
                    self.assertEqual(headers.get('X-Content-SHA256'), hashlib.sha256(data).hexdigest())
                    self.assertEqual(body, data if method == 'GET' else b'')

    def test_geometry_and_lookup_routes_are_exact_private_authored_modules_and_deny_aliases(self):
        for name in ('financial-geometry-source.mjs', 'financial-geometry-view.mjs',
                     'financial-table-contract.mjs', 'financial-lookup-view.mjs'):
            data = (ROOT / 'browser-rag' / name).read_bytes()
            self.write(self.browser / name, data)
            self.write(self.dist / 'browser-rag' / name, b'PRIVATE FALLTHROUGH TRAP')
            for method in ('GET', 'HEAD'):
                status, headers, body = self.request(method, '/browser-rag/' + name)
                self.assertEqual(status, 200)
                self.assertEqual(headers['Content-Length'], str(len(data)))
                self.assertEqual(headers.get('X-Content-SHA256'), hashlib.sha256(data).hexdigest())
                self.assertEqual(body, data if method == 'GET' else b'')
            for target in ('/browser-rag/' + name + '?capture=1', '/browser-rag/./' + name,
                           '/browser-rag/%66' + name[1:], '/browser-rag//'+name,
                           '/browser-rag/financial-table-contract-private.mjs',
                           '/browser-rag/financial-lookup-view-private.mjs'):
                self.assertEqual(self.request('GET', target)[0], 404, target)
            (self.browser / name).unlink()
            self.assertEqual(self.request('GET', '/browser-rag/' + name)[0], 404)

    def test_private_inspector_actual_dependency_graph_including_workers_and_session_imports(self):
        html = (ROOT / 'dist' / 'browser-rag' / 'inspector.html').read_text(encoding='utf-8')
        entries = re.findall(r'<script\s+type="module"\s+src="([^"]+)"', html)
        self.assertEqual(entries, ['pdf-entry.mjs'])
        pending = ['/browser-rag/' + entries[0]]
        static = re.compile(r'^\s*(?:import|export)\s+(?:[^;]*?\bfrom\s+)?[\'"]([^\'"]+)[\'"]\s*;', re.MULTILINE)
        worker = re.compile(r'new\s+URL\s*\(\s*[\'"]([^\'"]+\.mjs)[\'"]\s*,\s*import\.meta\.url')
        dynamic = re.compile(r'import\(\s*[\'"]([^\'"]+)[\'"]\s*\)')
        visited = set()
        while pending:
            target = pending.pop()
            if target in visited:
                continue
            visited.add(target)
            status, headers, body = self.request('GET', target, repository_root=ROOT)
            self.assertEqual(status, 200, target)
            path = probe.resolve_request(ROOT, target)
            self.assertEqual(body, path.read_bytes(), target)
            source = body.decode('utf-8')
            references = static.findall(source) + worker.findall(source)
            if target == '/browser-rag/pdf-session.mjs':
                references += dynamic.findall(source)
            for reference in references:
                self.assertTrue(reference.startswith(('./', '../')), reference)
                pending.append(posixpath.normpath(posixpath.join(posixpath.dirname(target), reference)))
        self.assertTrue({'/browser-rag/' + name for name in SOURCE_MODULES}.issubset(visited))
        self.assertIn('/browser-rag/financial-generation.worker.mjs', visited)
        self.assertIn('/browser-rag/financial-generator-runtime.mjs', visited)
        self.assertIn('/browser-rag/generation-view.mjs', visited)
        self.assertIn('/browser-rag/bounded-text-view.mjs', visited)
        self.assertNotIn('/browser-rag/pdf-private-entry.mjs', visited)

    def test_get_and_head_receipt_snapshot_serve_exact_local_bytes_and_sha(self):
        data = (ROOT / 'browser-rag' / 'receipt-snapshot.mjs').read_bytes()
        expected_sha = hashlib.sha256(data).hexdigest()
        self.write(self.browser / 'receipt-snapshot.mjs', data)
        for repository_root in (self.root, ROOT):
            for method in ('GET', 'HEAD'):
                with self.subTest(repository_root=repository_root, method=method):
                    status, headers, body = self.request(method, '/browser-rag/receipt-snapshot.mjs',
                                                         repository_root=repository_root)
                    self.assertEqual(status, 200)
                    self.assertEqual(headers['Content-Length'], str(len(data)))
                    self.assertEqual(headers['Content-Type'], 'application/javascript')
                    self.assertEqual(headers['Cache-Control'], 'no-store')
                    self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
                    self.assertEqual(body, data if method == 'GET' else b'')
                    if method == 'GET':
                        self.assertEqual(hashlib.sha256(body).hexdigest(), expected_sha)

    def test_native_probe_static_module_closure_is_served_from_actual_authored_entry(self):
        # Follow the actual page module, its literal native Worker entry and
        # static import/export graph. Dynamic pinned SDK/model loading is a
        # separate acceptance boundary; this executes no JavaScript or sockets.
        html = (ROOT / 'browser-rag' / 'acceptance' / 'generator-probe.html').read_text(encoding='utf-8')
        entries = re.findall(r'<script\s+type="module"\s+src="([^"]+)"', html)
        self.assertEqual(entries, ['./generator-probe.mjs'])
        pending = [posixpath.normpath('/browser-rag/acceptance/' + name) for name in entries]
        static_module = re.compile(r'^\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?[\'"]([^\'"]+)[\'"]\s*;', re.MULTILINE)
        native_worker = re.compile(r'new\s+Worker\s*\(\s*new\s+URL\s*\(\s*[\'"]([^\'"]+)[\'"]\s*,\s*import\.meta\.url')
        visited = set()
        while pending:
            target = pending.pop()
            if target in visited:
                continue
            visited.add(target)
            with self.subTest(target=target):
                status, headers, body = self.request('GET', target, repository_root=ROOT)
                self.assertEqual(status, 200)
                path = probe.resolve_request(ROOT, target)
                data = path.read_bytes()
                self.assertEqual(headers['Content-Length'], str(len(data)))
                self.assertEqual(headers['Content-Type'], 'application/javascript')
                self.assertEqual(body, data)
                self.assertEqual(hashlib.sha256(body).hexdigest(), hashlib.sha256(data).hexdigest())
                source = data.decode('utf-8')
                for name in static_module.findall(source) + native_worker.findall(source):
                    self.assertTrue(name.startswith('./') or name.startswith('../'), name)
                    pending.append(posixpath.normpath(posixpath.join(posixpath.dirname(target), name)))
        self.assertIn('/browser-rag/acceptance/generator-probe.worker.mjs', visited)
        self.assertIn('/browser-rag/receipt-snapshot.mjs', visited)
        self.assertIn('/browser-rag/generator-native-core.mjs', visited)
        self.assertIn('/browser-rag/generator-contract.mjs', visited)
        self.assertFalse((ROOT / 'dist' / 'browser-rag' / 'receipt-snapshot.mjs').exists())

    def test_private_aliases_remain_404(self):
        for name in ('pdf-private-entry.mjs', 'receipt-snapshot-private.mjs', 'private.mjs',
                     '.model-cache/private.onnx'):
            self.write(self.browser / name, b'PRIVATE source bytes')
            for repository_root in (self.root, ROOT):
                for method in ('GET', 'HEAD'):
                    with self.subTest(name=name, method=method, repository_root=repository_root):
                        status, headers, body = self.request(method, '/browser-rag/' + name,
                                                             repository_root=repository_root)
                        self.assertEqual(status, 404)
                        self.assertNotIn(b'PRIVATE source bytes', body)
        for target in ('/browser-rag/receipt-snapshot.mjs?cache=1', '/browser-rag/receipt-snapshot.mjs#fragment',
                       '/browser-rag/%72eceipt-snapshot.mjs', '/browser-rag/./receipt-snapshot.mjs',
                       '/browser-rag//receipt-snapshot.mjs', '/browser-rag/receipt-snapshot.mjs/',
                       '/browser-rag/receipt-snapshot.mjs.bak'):
            with self.subTest(target=target):
                status, headers, body = self.request('GET', target)
                self.assertEqual(status, 404)

    def test_head_has_get_length_and_mime_with_no_body(self):
        data = b'\x00asm fixture'
        self.write(self.dist / 'runtime.wasm', data)
        status, headers, body = self.request('HEAD', '/runtime.wasm')
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Length'], str(len(data)))
        self.assertEqual(headers['Content-Type'], 'application/wasm')
        self.assertEqual(body, b'')

    def test_get_each_exact_model_route_streams_its_fixture_length_mime_and_body(self):
        for name in MODEL_FILES:
            data = f'GET fixture for {name}'.encode('ascii')
            self.write(self.browser / '.model-cache' / REVISION / name, data)
            with self.subTest(name=name):
                status, headers, body = self.request('GET', MODEL_PREFIX + name)
                self.assertEqual(status, 200)
                self.assertEqual(headers['Content-Length'], str(len(data)))
                expected_mime = 'application/octet-stream' if name.endswith('.onnx') else 'application/json'
                self.assertEqual(headers['Content-Type'], expected_mime)
                self.assertEqual(body, data)

    def test_head_each_exact_model_route_has_fixture_length_mime_and_no_body(self):
        for name in MODEL_FILES:
            data = f'HEAD fixture for {name}'.encode('ascii')
            self.write(self.browser / '.model-cache' / REVISION / name, data)
            with self.subTest(name=name):
                status, headers, body = self.request('HEAD', MODEL_PREFIX + name)
                self.assertEqual(status, 200)
                self.assertEqual(headers['Content-Length'], str(len(data)))
                expected_mime = 'application/octet-stream' if name.endswith('.onnx') else 'application/json'
                self.assertEqual(headers['Content-Type'], expected_mime)
                self.assertEqual(body, b'')

    def test_rejected_targets_return_no_directory_listing(self):
        for target in ('/browser-rag/acceptance/', '/missing', '/index.html?x=1', '/../private'):
            with self.subTest(target=target):
                status, headers, body = self.request('GET', target)
                self.assertIn(status, (400, 404))
                self.assertNotIn(b'Directory listing', body)
                self.assertNotIn(b'authored diagnostic', body)

    def test_wire_double_slash_path_is_rejected_before_http_parser_normalization(self):
        status, headers, body = self.request('GET', '//index.html')
        self.assertEqual(status, 404)
        self.assertNotIn(b'local draft', body)

    def test_nonloopback_clients_are_rejected_before_file_content(self):
        for client in ('192.0.2.10', '10.0.0.2', '::ffff:192.0.2.10', 'invalid'):
            with self.subTest(client=client):
                status, headers, body = self.request('GET', '/', client)
                self.assertEqual(status, 403)
                self.assertNotIn(b'local draft', body)

    def test_ipv6_loopback_is_accepted_by_client_guard(self):
        status, headers, body = self.request('GET', '/', '::1')
        self.assertEqual(status, 200)
        self.assertEqual(body, b'<html>local draft</html>')


if __name__ == '__main__':
    unittest.main()
