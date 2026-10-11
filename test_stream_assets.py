"""Build acceptance for the pinned streaming verifier graph; no model execution."""
import json
import re
import subprocess
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import build
import test_build as fixtures
import test_browser_assets as browser_fixtures


REPOSITORY_BROWSER = Path(__file__).resolve().parent / 'browser-rag'
NOBLE_FILES = {
    'sha2.js': (18997, '471746bba6ec4c6238ca41358d1d3b40b6ff31cf3363f0b4d550c649c1a8e83b'),
    '_md.js': (9175, '60cf3010fda89e3e4d3f0e7ff1ce249e9c467f34b4fd41b6fd6101d9f69be763'),
    '_u64.js': (4794, 'b09da8c07fe8187c07649494cdb7cd0bcf13df90b506a9473d19e4d5f8c2e102'),
    'utils.js': (26035, '037ad49adb78168b6b699598fd33f85f7877456b1d28b4d032e2a1a16807947c'),
    'LICENSE': (1109, '4f221aee6e072336700c408c68ab3b96a3fc09f6aebe6f48f1bd99e5ef13faec'),
}
STATIC_RELATIVE_MODULE_IMPORT = re.compile(
    r"^[ \t]*(?:import|export)[ \t]+(?:[^;]*?\bfrom[ \t]+)?['\"](\.{1,2}/[^'\"]+\.(?:js|mjs))['\"][ \t]*;",
    re.MULTILINE,
)


def static_module_graph(directory, entry):
    """Follow literal relative static imports across real .js and .mjs files."""
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
        imports = STATIC_RELATIVE_MODULE_IMPORT.findall(module.read_text(encoding='utf-8'))
        graph[relative] = set(imports)
        pending.extend(module.parent / reference for reference in imports)
    return graph


class StreamAssetsTest(unittest.TestCase):
    def setUp(self):
        # Retain the existing tiny PDF package fixtures. Only the C1 graph uses
        # the exact real source bytes: no fake hasher or graph substitute.
        browser_fixtures.BrowserAssetsTest.setUp(self)
        self.vendor = self.browser / 'vendor' / 'noble-hashes'
        self.vendor.mkdir(parents=True)
        self.registry = {
            'schemaVersion': 1, 'package': '@noble/hashes', 'version': '2.4.0',
            'files': {name: {'bytes': count, 'sha256': digest}
                      for name, (count, digest) in NOBLE_FILES.items()},
        }
        for name in NOBLE_FILES:
            (self.vendor / name).write_bytes(
                (REPOSITORY_BROWSER / 'vendor' / 'noble-hashes' / name).read_bytes())
        (self.browser / 'verified-stream.mjs').write_bytes(
            (REPOSITORY_BROWSER / 'verified-stream.mjs').read_bytes())
        self.write_registry()

    def write_registry(self):
        (self.browser / 'noble-assets.json').write_text(json.dumps(self.registry), encoding='utf-8')

    def install_cache_module(self):
        data = (REPOSITORY_BROWSER / 'verified-cache.mjs').read_bytes()
        (self.browser / 'verified-cache.mjs').write_bytes(data)
        return data

    def build_last_good(self):
        build.build()
        previous = self.root / 'dist' / 'prior-output' / 'binary.bin'
        previous.parent.mkdir()
        previous.write_bytes(bytes(range(256)))
        return fixtures.file_snapshot(self.root / 'dist')

    def assert_rejected_preserving_dist(self, before, error='[Ss]tream|[Nn]oble|registry|metadata|asset|bytes|hash|reparse'):
        with self.assertRaisesRegex((ValueError, FileNotFoundError), error):
            build.build()
        self.assertEqual(fixtures.file_snapshot(self.root / 'dist'), before)
        self.assertFalse((self.root / '.build-recovery').exists())
        self.assertEqual(list(self.root.glob('.dist-stage-*')), [])

    def test_git_preserves_exact_pinned_vendor_bytes_without_text_conversion(self):
        paths = [f'browser-rag/vendor/noble-hashes/{name}' for name in NOBLE_FILES]
        result = subprocess.run(
            ['git', 'check-attr', 'text', '--', *paths],
            cwd=REPOSITORY_BROWSER.parent, check=True, capture_output=True, text=True,
        )
        self.assertEqual(result.stdout.splitlines(), [f'{path}: text: unset' for path in paths])

    def test_real_verifier_registry_and_exact_five_file_graph_are_delivered(self):
        # An arbitrary source beside the pinned graph must not become public.
        for source in (self.vendor / 'private.js',
                       self.browser / 'vendor' / 'other-package' / 'private.js',
                       self.browser / 'tests' / 'verified-stream.test.mjs'):
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(b'PRIVATE NON-RUNTIME SOURCE')
        build.build()
        output = self.root / 'dist' / 'browser-rag'
        self.assertTrue((output / 'verified-stream.mjs').is_file(),
                        'fresh build omits the streaming verifier')
        self.assertEqual((output / 'verified-stream.mjs').read_bytes(),
                         (self.browser / 'verified-stream.mjs').read_bytes())
        self.assertEqual((output / 'noble-assets.json').read_bytes(),
                         (self.browser / 'noble-assets.json').read_bytes())
        delivered = output / 'vendor' / 'noble-hashes'
        self.assertEqual({path.name for path in delivered.iterdir()}, set(NOBLE_FILES))
        for name, expected in NOBLE_FILES.items():
            with self.subTest(name=name):
                self.assertEqual(fixtures.independent_fingerprint(self.vendor / name), expected)
                self.assertEqual(fixtures.independent_fingerprint(delivered / name), expected)
                self.assertEqual((delivered / name).read_bytes(), (self.vendor / name).read_bytes())
        notice = (delivered / 'LICENSE').read_text(encoding='utf-8')
        self.assertIn('MIT License', notice)
        self.assertIn('Copyright (c) 2022 Paul Miller', notice)
        for name in ('vendor/other-package', 'node_modules', 'tests'):
            self.assertFalse((output / name).exists(), name)

    def test_real_transitive_js_and_mjs_static_import_graph_closes_in_output(self):
        build.build()
        output = self.root / 'dist' / 'browser-rag'
        graph = static_module_graph(output, 'verified-stream.mjs')
        self.assertEqual(graph, {
            'verified-stream.mjs': {'./vendor/noble-hashes/sha2.js'},
            'vendor/noble-hashes/sha2.js': {'./_md.js', './_u64.js', './utils.js'},
            'vendor/noble-hashes/_md.js': {'./_u64.js', './utils.js'},
            'vendor/noble-hashes/_u64.js': set(),
            'vendor/noble-hashes/utils.js': set(),
        })
        for name in graph:
            self.assertEqual((output / name).read_bytes(), (self.browser / name).read_bytes(), name)

    def test_optional_authored_cache_is_copied_exactly_without_other_cache_sources(self):
        cache_bytes = self.install_cache_module()
        for source in (self.browser / 'cache-private.mjs',
                       self.browser / 'tests' / 'verified-cache.test.mjs'):
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(b'PRIVATE NON-RUNTIME SOURCE')
        build.build()
        output = self.root / 'dist' / 'browser-rag'
        delivered = output / 'verified-cache.mjs'
        self.assertTrue(delivered.is_file(), 'fresh build omits the optional authored cache module')
        self.assertEqual(delivered.read_bytes(), cache_bytes)
        self.assertFalse((output / 'cache-private.mjs').exists())
        self.assertFalse((output / 'tests').exists())
        self.assertEqual({path.name for path in (output / 'vendor' / 'noble-hashes').iterdir()},
                         set(NOBLE_FILES))

    def test_real_cache_static_import_graph_closes_over_existing_stream_graph(self):
        self.install_cache_module()
        build.build()
        output = self.root / 'dist' / 'browser-rag'
        self.assertTrue((output / 'verified-cache.mjs').is_file(),
                        'fresh build omits the optional authored cache module')
        graph = static_module_graph(output, 'verified-cache.mjs')
        self.assertEqual(graph, {
            'verified-cache.mjs': {'./verified-stream.mjs'},
            'verified-stream.mjs': {'./vendor/noble-hashes/sha2.js'},
            'vendor/noble-hashes/sha2.js': {'./_md.js', './_u64.js', './utils.js'},
            'vendor/noble-hashes/_md.js': {'./_u64.js', './utils.js'},
            'vendor/noble-hashes/_u64.js': set(),
            'vendor/noble-hashes/utils.js': set(),
        })
        for name in graph:
            self.assertEqual((output / name).read_bytes(), (self.browser / name).read_bytes(), name)

    def test_cache_without_stream_verifier_preserves_all_last_good_bytes(self):
        self.install_cache_module()
        before = self.build_last_good()
        (self.browser / 'verified-stream.mjs').unlink()
        self.assert_rejected_preserving_dist(before, '[Ss]tream|[Cc]ache')

    def test_cache_directory_is_refused_preserving_all_last_good_bytes(self):
        self.install_cache_module()
        before = self.build_last_good()
        source = self.browser / 'verified-cache.mjs'
        source.unlink()
        source.mkdir()
        self.assert_rejected_preserving_dist(before, '[Cc]ache')

    def test_cache_source_and_destination_reparse_guards_refuse_named_module(self):
        self.install_cache_module()
        before = self.build_last_good()
        source = self.browser / 'verified-cache.mjs'
        real_lstat = Path.lstat

        def source_reparse(path, *args, **kwargs):
            details = real_lstat(path, *args, **kwargs)
            return fixtures.reparse_stat(details) if path == source else details

        with patch.object(Path, 'lstat', source_reparse):
            self.assert_rejected_preserving_dist(before, 'reparse')

        target = self.root / '.dist-stage-direct' / 'browser-rag'
        target.mkdir(parents=True)
        destination = target / 'verified-cache.mjs'
        destination.write_bytes(b'PRIOR DESTINATION')

        def destination_reparse(path, *args, **kwargs):
            details = real_lstat(path, *args, **kwargs)
            return fixtures.reparse_stat(details) if path == destination else details

        with patch.object(Path, 'lstat', destination_reparse):
            with self.assertRaisesRegex(ValueError, 'reparse'):
                build.copy_stream_assets(self.browser, target, self.root)
        self.assertEqual(destination.read_bytes(), b'PRIOR DESTINATION')
        self.assertEqual(list(target.iterdir()), [destination])

    def test_cache_does_not_add_registry_controlled_paths(self):
        self.install_cache_module()
        before = self.build_last_good()
        self.registry['files']['verified-cache.mjs'] = {
            'bytes': 1, 'sha256': '0' * 64,
        }
        self.write_registry()
        self.assert_rejected_preserving_dist(before, 'registry')

    def test_missing_registry_or_each_pinned_file_preserves_all_last_good_bytes(self):
        before = self.build_last_good()
        for source in (self.browser / 'noble-assets.json',
                       *(self.vendor / name for name in NOBLE_FILES)):
            with self.subTest(name=source.name):
                data = source.read_bytes()
                source.unlink()
                try:
                    self.assert_rejected_preserving_dist(before)
                finally:
                    source.write_bytes(data)

    def test_short_overlong_and_same_size_tampering_preserve_all_last_good_bytes(self):
        before = self.build_last_good()
        for name in NOBLE_FILES:
            source = self.vendor / name
            data = source.read_bytes()
            for damaged in (data[:-1], data + b'!', bytes([data[0] ^ 1]) + data[1:]):
                with self.subTest(name=name, bytes=len(damaged)):
                    source.write_bytes(damaged)
                    try:
                        self.assert_rejected_preserving_dist(before, 'bytes|hash')
                    finally:
                        source.write_bytes(data)

    def test_registry_requires_exact_top_level_keys_and_object_shape(self):
        before = self.build_last_good()
        original = deepcopy(self.registry)
        for value in ([], None, dict(original, source='../../secret.env'),
                      {key: item for key, item in original.items() if key != 'files'}):
            with self.subTest(value=value):
                self.registry = value
                self.write_registry()
                try:
                    self.assert_rejected_preserving_dist(before, 'registry')
                finally:
                    self.registry = deepcopy(original)
                    self.write_registry()

    def test_registry_requires_exact_pinned_identity_and_integer_schema(self):
        before = self.build_last_good()
        original = deepcopy(self.registry)
        for key, value in (('schemaVersion', 2), ('schemaVersion', True), ('schemaVersion', 1.0),
                           ('package', 'other-package'), ('version', '2.3.0')):
            with self.subTest(key=key, value=value):
                self.registry[key] = value
                self.write_registry()
                try:
                    self.assert_rejected_preserving_dist(before, 'identity|version')
                finally:
                    self.registry = deepcopy(original)
                    self.write_registry()

    def test_registry_file_names_are_exact_and_cannot_supply_paths(self):
        before = self.build_last_good()
        original = deepcopy(self.registry)
        wrong_groups = (None, [], {},
                        {name: entry for name, entry in original['files'].items() if name != 'LICENSE'},
                        *(dict(original['files'], **{name: {'bytes': 1, 'sha256': '0' * 64}})
                          for name in ('extra.js', '../../secret.env', '/absolute.js', r'C:\outside.js')))
        for files in wrong_groups:
            with self.subTest(files=files):
                self.registry['files'] = files
                self.write_registry()
                try:
                    self.assert_rejected_preserving_dist(before, 'registry')
                finally:
                    self.registry = deepcopy(original)
                    self.write_registry()

    def test_each_file_requires_positive_integer_counts_and_lowercase_sha256_only(self):
        before = self.build_last_good()
        original = deepcopy(self.registry)
        count, digest = NOBLE_FILES['sha2.js']
        cases = ({'bytes': count, 'sha256': digest, 'source': '../../secret.env'},
                 {'bytes': count}, {'sha256': digest}, None, [],
                 *({'bytes': value, 'sha256': digest} for value in (0, -1, True, float(count), str(count))),
                 *({'bytes': count, 'sha256': value} for value in
                   (digest.upper(), 'z' * 64, digest[:-1], None, 123)))
        for name in NOBLE_FILES:
            for entry in cases:
                with self.subTest(name=name, entry=entry):
                    self.registry['files'][name] = entry
                    self.write_registry()
                    try:
                        self.assert_rejected_preserving_dist(before, 'metadata')
                    finally:
                        self.registry = deepcopy(original)
                        self.write_registry()

    def test_pdf_only_fixture_ignores_stream_graph_when_verifier_is_absent(self):
        (self.browser / 'verified-stream.mjs').unlink()
        (self.browser / 'noble-assets.json').write_text('not valid JSON', encoding='utf-8')
        (self.vendor / 'sha2.js').unlink()
        build.build()
        output = self.root / 'dist' / 'browser-rag'
        self.assertEqual((output / 'pdf-source.mjs').read_bytes(),
                         (self.browser / 'pdf-source.mjs').read_bytes())
        for name in ('verified-stream.mjs', 'verified-cache.mjs', 'noble-assets.json',
                     'vendor/noble-hashes'):
            self.assertFalse((output / name).exists(), name)

    def test_unchanged_stream_graph_does_not_create_recovery_copies(self):
        build.build()
        before = fixtures.file_snapshot(self.root / 'dist')
        result = build.build()
        self.assertEqual(result['status'], 'unchanged')
        self.assertIsNone(result['recovery_path'])
        self.assertEqual(fixtures.file_snapshot(self.root / 'dist'), before)
        self.assertFalse((self.root / '.build-recovery').exists())
        self.assertEqual(list(self.root.glob('.dist-stage-*')), [])

    def test_named_copy_path_refuses_escaping_source_and_destination(self):
        target = self.root / '.dist-stage-direct' / 'browser-rag'
        target.mkdir(parents=True)
        for browser, destination in ((self.root.parent / 'escaped-browser', target),
                                     (self.browser, self.root.parent / 'escaped-output')):
            with self.subTest(browser=browser, destination=destination):
                with self.assertRaisesRegex(ValueError, 'escapes'):
                    build.copy_stream_assets(browser, destination, self.root)
        self.assertEqual(list(target.iterdir()), [])

    def test_source_and_destination_reparse_guards_refuse_before_promotion(self):
        before = self.build_last_good()
        real_lstat = Path.lstat
        for source in (self.browser / 'noble-assets.json', self.vendor,
                       *(self.vendor / name for name in NOBLE_FILES)):
            def source_reparse(path, *args, **kwargs):
                details = real_lstat(path, *args, **kwargs)
                return fixtures.reparse_stat(details) if path == source else details

            with self.subTest(source=source), patch.object(Path, 'lstat', source_reparse):
                self.assert_rejected_preserving_dist(before, 'reparse')

        target = self.root / '.dist-stage-direct' / 'browser-rag'
        target.mkdir(parents=True)

        def destination_reparse(path, *args, **kwargs):
            details = real_lstat(path, *args, **kwargs)
            return fixtures.reparse_stat(details) if path == target else details

        with patch.object(Path, 'lstat', destination_reparse):
            with self.assertRaisesRegex(ValueError, 'reparse'):
                build.copy_stream_assets(self.browser, target, self.root)
        self.assertEqual(list(target.iterdir()), [])

    def test_copied_asset_uses_bounded_verified_reads_of_the_written_bytes(self):
        # Returning a same-length altered read while the on-disk source stays
        # intact detects verify-then-copy or plain-copy integration mistakes.
        before = self.build_last_good()
        source = self.vendor / 'sha2.js'
        real_open = Path.open
        data = source.read_bytes()
        damaged = bytes([data[0] ^ 1]) + data[1:]

        def altered_reader(path, mode='r', *args, **kwargs):
            if path == source and mode == 'rb':
                import io
                return fixtures.BoundedBinaryReader(io.BytesIO(damaged))
            return real_open(path, mode, *args, **kwargs)

        with patch.object(Path, 'open', altered_reader):
            self.assert_rejected_preserving_dist(before, 'hash')
        self.assertEqual(source.read_bytes(), data)


if __name__ == '__main__':
    unittest.main()
