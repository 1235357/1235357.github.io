"""Serve the C3 diagnostic locally, after verifying its fixed asset pins.

This is an offline acceptance tool, separate from the static site build. It
exposes five authored diagnostics, the generation contract, shared native core
and its bounded receipt snapshot helper, five
verified ignored-cache model files, and guarded regular files under ``dist``.
It does not run a model or publish the diagnostic.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import re
import stat
from types import MappingProxyType


REPOSITORY_ROOT = Path(__file__).absolute().parents[2]
HOST = '127.0.0.1'
DEFAULT_PORT = 8766
FILE_BLOCK_BYTES = 1024 * 1024
MANIFEST_BYTE_LIMIT = 32768
REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e'
MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct'
MODEL_PREFIX = f'/browser-rag/models/{REVISION}/{MODEL_ID}/'
ACCEPTANCE_PREFIX = '/browser-rag/acceptance/'
DIAGNOSTICS = frozenset(('generator-probe.html', 'generator-probe.mjs',
    'generator-probe.worker.mjs', 'generator-probe-runtime.mjs', 'generator-probe-assets.json'))
SOURCE_MODULES = frozenset(('generator-contract.mjs', 'generator-native-core.mjs', 'receipt-snapshot.mjs'))

# These pins are deliberately independent of the editable JSON manifest.
# Tiny fixture descriptors may exercise verify_file/verify_stream, but cannot
# replace the production configuration used by verify_startup and main.
MODEL_FILES = MappingProxyType({
    'config.json': (678, '777e01f0fbb3346eb229cb6fb278ed6533c1e4dcb9ebf4bed0f6e94ef17fa1b5'),
    'tokenizer.json': (7031673, 'a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf'),
    'tokenizer_config.json': (7849, '6a14243f0ae04884e597b3f032c05e15de9f417318fdcac24ab4e2680e691430'),
    'generation_config.json': (242, 'f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3'),
    'onnx/model_q4.onnx': (786156820, '09235a3b1c135cd04ef570e5053b5c079e028078a2cc5f76ba6a251e91bf3296'),
})
RUNTIME_FILES = MappingProxyType({
    'transformers.min.js': (888173, 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa'),
    'ort-wasm-simd-threaded.jsep.mjs': (44484, '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9'),
    'ort-wasm-simd-threaded.jsep.wasm': (21596019, 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'),
})


def parse_port(value):
    try:
        port = int(value)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError('port must be an integer from 1 to 65535') from None
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError('port must be an integer from 1 to 65535')
    return port


def guard_path(path, root):
    """Refuse lexical escapes, symlinks and Windows reparse points."""
    path, root = Path(path).absolute(), Path(root).absolute()
    if not path.is_relative_to(root) or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('path escapes the allowed root')
    current = path
    while True:
        try:
            details = current.lstat()
        except FileNotFoundError:
            details = None
        if details is not None and (stat.S_ISLNK(details.st_mode)
                or getattr(details, 'st_file_attributes', 0)
                & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)):
            raise ValueError('path is a link or reparse point')
        if current == root:
            break
        current = current.parent
    return path


def verify_stream(source, expected_bytes, expected_sha256):
    """Verify actual bytes with bounded reads; never retain an asset in RAM."""
    if (type(expected_bytes) is not int or expected_bytes < 1
            or not isinstance(expected_sha256, str)
            or re.fullmatch(r'[0-9a-f]{64}', expected_sha256) is None):
        raise ValueError('invalid asset descriptor')
    count, digest = 0, hashlib.sha256()
    while block := source.read(FILE_BLOCK_BYTES):
        count += len(block)
        if count > expected_bytes:
            raise ValueError('asset bytes exceed pinned length')
        digest.update(block)
    if count != expected_bytes:
        raise ValueError('asset bytes differ from pinned length')
    actual = digest.hexdigest()
    if actual != expected_sha256:
        raise ValueError('asset SHA-256 differs from pinned hash')
    return count, actual


def verify_file(path, root, expected_bytes, expected_sha256):
    path = guard_path(path, root)
    if not path.is_file():
        raise ValueError('asset is missing or not a regular file')
    with path.open('rb') as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError('asset is not a regular file')
        return verify_stream(source, expected_bytes, expected_sha256)


def _unique_json_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate JSON field')
        value[key] = item
    return value


def _read_registry(path, root):
    path = guard_path(path, root)
    if not path.is_file():
        raise ValueError('registry is missing or not a regular file')
    with path.open('rb') as source:
        data = source.read(MANIFEST_BYTE_LIMIT + 1)
    if len(data) > MANIFEST_BYTE_LIMIT:
        raise ValueError('registry exceeds bounded byte limit')
    try:
        return json.loads(data.decode('utf-8'), object_pairs_hook=_unique_json_object)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError('invalid JSON registry') from None


def _check_pins(group, expected, label):
    if type(group) is not dict or set(group) != set(expected):
        raise ValueError(f'{label} registry file set differs from fixed pins')
    for name, (count, digest) in expected.items():
        entry = group[name]
        if (type(entry) is not dict or set(entry) != {'bytes', 'sha256'}
                or type(entry['bytes']) is not int or entry['bytes'] != count
                or type(entry['sha256']) is not str or entry['sha256'] != digest):
            raise ValueError(f'{label} registry descriptor differs from fixed pins')


def read_manifest(repository_root):
    root = Path(repository_root).absolute()
    manifest = _read_registry(root / 'browser-rag' / 'acceptance' / 'generator-probe-assets.json', root)
    if (type(manifest) is not dict
            or set(manifest) != {'schemaVersion', 'modelId', 'revision', 'modelFiles', 'runtimeFiles'}
            or type(manifest['schemaVersion']) is not int or manifest['schemaVersion'] != 1
            or manifest['modelId'] != MODEL_ID or manifest['revision'] != REVISION):
        raise ValueError('generator registry metadata differs from fixed configuration')
    _check_pins(manifest['modelFiles'], MODEL_FILES, 'model')
    _check_pins(manifest['runtimeFiles'], RUNTIME_FILES, 'runtime')
    return manifest


def verify_startup(repository_root):
    """Fail before binding unless all production assets have their real pins."""
    root = Path(repository_root).absolute()
    dist = guard_path(root / 'dist', root)
    if not dist.is_dir():
        raise ValueError('dist is missing or not a regular directory; build the site first')
    for name in sorted(DIAGNOSTICS):
        path = guard_path(root / 'browser-rag' / 'acceptance' / name, root)
        if not path.is_file():
            raise ValueError('authored diagnostic is missing or not a regular file')
    for name in sorted(SOURCE_MODULES):
        resolve_request(root, f'/browser-rag/{name}')
    resolve_request(root, '/')
    read_manifest(root)
    embedding = _read_registry(root / 'browser-rag' / 'embedding-assets.json', root)
    if type(embedding) is not dict:
        raise ValueError('invalid embedding runtime registry')
    _check_pins(embedding.get('runtimeFiles'), RUNTIME_FILES, 'embedding runtime')
    cache = root / 'browser-rag' / '.model-cache' / REVISION
    for name, expected in MODEL_FILES.items():
        verify_file(cache / name, root, *expected)
    runtime = dist / 'browser-rag' / 'vendor' / 'transformers'
    for name, expected in RUNTIME_FILES.items():
        verify_file(runtime / name, dist, *expected)


def resolve_request(repository_root, target):
    """Resolve an exact origin path; URL aliases and directory indexes fail."""
    root = Path(repository_root).absolute()
    if (not isinstance(target, str) or not target.startswith('/')
            or target.startswith('//') or any(char in target for char in '%?#\\:')
            or any(ord(char) < 32 or ord(char) == 127 for char in target)):
        raise ValueError('invalid request target')
    if target != '/':
        parts = target[1:].split('/')
        if any(part in ('', '.', '..') or part.endswith(('.', ' ')) for part in parts):
            raise ValueError('invalid request path')
    if target.startswith(ACCEPTANCE_PREFIX):
        name = target[len(ACCEPTANCE_PREFIX):]
        if name not in DIAGNOSTICS:
            raise FileNotFoundError('unknown diagnostic route')
        path, allowed_root = root / 'browser-rag' / 'acceptance' / name, root
    elif target in {f'/browser-rag/{name}' for name in SOURCE_MODULES}:
        name = target[len('/browser-rag/'):]
        path, allowed_root = root / 'browser-rag' / name, root
    elif target.startswith('/browser-rag/models/'):
        name = target[len(MODEL_PREFIX):] if target.startswith(MODEL_PREFIX) else None
        if name not in MODEL_FILES:
            raise FileNotFoundError('unknown model route')
        path, allowed_root = root / 'browser-rag' / '.model-cache' / REVISION / name, root
    else:
        allowed_root = root / 'dist'
        path = allowed_root / ('index.html' if target == '/' else target[1:])
    path = guard_path(path, allowed_root)
    if not path.is_file():
        raise FileNotFoundError('route is missing or not a regular file')
    return path


def content_type(path):
    suffix = Path(path).suffix.lower()
    exact = {'.js': 'application/javascript', '.mjs': 'application/javascript',
             '.wasm': 'application/wasm', '.json': 'application/json',
             '.html': 'text/html; charset=utf-8', '.onnx': 'application/octet-stream'}
    return exact.get(suffix) or mimetypes.guess_type(str(path))[0] or 'application/octet-stream'


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--port', type=parse_port, default=DEFAULT_PORT,
                        help=f'local port from 1 to 65535 (default: {DEFAULT_PORT})')
    return parser


class ProbeRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._serve(head_only=False)

    def do_HEAD(self):
        self._serve(head_only=True)

    def _serve(self, *, head_only):
        try:
            address = ipaddress.ip_address(self.client_address[0])
        except ValueError:
            address = None
        if address is None or not address.is_loopback:
            self.send_error(403, 'Loopback clients only')
            return
        try:
            # BaseHTTPRequestHandler normalizes a leading // to /. Validate
            # the original request target so that alias cannot bypass routing.
            target = self.requestline.split()[1]
            path = resolve_request(self.server.repository_root, target)
            source = path.open('rb')
            details = os.fstat(source.fileno())
            if not stat.S_ISREG(details.st_mode):
                source.close()
                raise ValueError('not a regular file')
        except (ValueError, OSError):
            self.send_error(404, 'File not available')
            return
        with source:
            self.send_response(200)
            self.send_header('Content-Type', content_type(path))
            self.send_header('Content-Length', str(details.st_size))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            if not head_only:
                remaining = details.st_size
                while remaining:
                    block = source.read(min(FILE_BLOCK_BYTES, remaining))
                    if not block:
                        self.close_connection = True
                        break
                    self.wfile.write(block)
                    remaining -= len(block)


def main(argv=None):
    args = create_parser().parse_args(argv)
    try:
        verify_startup(REPOSITORY_ROOT)
    except (ValueError, OSError) as error:
        raise SystemExit(f'Generator probe startup refused: {error}') from None
    with HTTPServer((HOST, args.port), ProbeRequestHandler) as server:
        server.repository_root = REPOSITORY_ROOT
        print(f'Generator probe: http://{HOST}:{args.port}/browser-rag/acceptance/generator-probe.html', flush=True)
        print('Pinned local assets verified; this server does not establish model execution.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
