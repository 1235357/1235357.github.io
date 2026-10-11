"""Fetch fixed pinned model bodies into ignored cache; never replace originals."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import urllib.request
from urllib.parse import urlsplit

REPOSITORY = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPOSITORY))
import browser_release_assets as release
BLOCK_BYTES = 1024 * 1024

def guard(path, root):
    root, path = root.absolute(), path.absolute()
    if root != root.resolve() or root == root.parent or not path.is_relative_to(root) or not path.resolve().is_relative_to(root):
        raise ValueError('Asset destination escapes repository')
    current = path
    while True:
        if current.exists() or current.is_symlink():
            details = current.lstat()
            if current.is_symlink() or getattr(details, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
                raise ValueError('Asset path is a link or reparse point')
        if current == root: break
        current = current.parent
    return path

def fingerprint(path):
    count, digest = 0, hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(BLOCK_BYTES), b''):
            count += len(block);digest.update(block)
    return {'bytes': count, 'sha256': digest.hexdigest()}

def materialize_asset(root, asset, opener=urllib.request.urlopen):
    # Descriptors originate only from release.download_plan; CLI accepts no URL
    # or destination registry. The guard also protects focused test injection.
    destination = guard(root / asset['relativePath'], root)
    expected = {key: asset[key] for key in ('bytes', 'sha256')}
    if destination.exists():
        if not destination.is_file() or fingerprint(destination) != expected:
            raise ValueError('Existing asset differs from fixed pins; preserved: ' + destination.name)
        return 'verified-cache'
    destination.parent.mkdir(parents=True, exist_ok=True);guard(destination, root)
    descriptor, temporary_name = tempfile.mkstemp(prefix=destination.name + '.', suffix='.part', dir=destination.parent)
    temporary = guard(Path(temporary_name), root)
    count, digest = 0, hashlib.sha256()
    try:
        with os.fdopen(descriptor, 'wb') as output, opener(asset['url'], timeout=120) as response:
            if hasattr(response, 'geturl'):
                final = urlsplit(response.geturl())
                if final.scheme != 'https' or not final.netloc or final.username or final.password:
                    raise ValueError('Asset response is not HTTPS')
            while block := response.read(BLOCK_BYTES):
                if count + len(block) > expected['bytes']: raise ValueError('Asset exceeded pinned size')
                if output.write(block) != len(block): raise ValueError('Incomplete asset write')
                count += len(block);digest.update(block)
            if {'bytes': count, 'sha256': digest.hexdigest()} != expected: raise ValueError('Asset body differs from fixed pins')
        guard(destination, root);guard(temporary, root)
        # Exclusive hard-link installation cannot overwrite a file created by
        # another process. The temporary link is removed; build writes new files.
        os.link(temporary, destination)
        return 'downloaded'
    except ValueError: raise
    except Exception: raise ValueError('Asset download/install failed: ' + destination.name) from None
    finally:
        guard(temporary, root)
        temporary.unlink()

def verify_runtime(root):
    browser = root / 'browser-rag'
    for package, version in [('node_modules/@huggingface/transformers', '3.8.1'), ('node_modules/onnxruntime-web', '1.22.0-dev.20250409-89f8206ba4')]:
        path = guard(browser / package / 'package.json', root)
        if json.loads(path.read_bytes()).get('version') != version: raise ValueError('Paired npm runtime version differs')
    for name, pin in release.RUNTIME_FILES.items():
        path = guard(browser / 'node_modules/@huggingface/transformers/dist' / name, root)
        if fingerprint(path) != pin: raise ValueError('Paired npm runtime body differs: ' + name)

def materialize(root=REPOSITORY, *, embedding_only=False, opener=urllib.request.urlopen):
    verify_runtime(root)
    results = []
    for asset in release.download_plan(embedding_only=embedding_only):
        status = materialize_asset(root, asset, opener)
        results.append({'path': asset['relativePath'], 'status': status, 'bytes': asset['bytes'], 'sha256': asset['sha256']})
        print(f'{status}: {asset["relativePath"]} ({asset["bytes"]} bytes)')
    return results

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--embedding-only', action='store_true', help='Materialize only MiniLM and its model card for ordinary build checks')
    args = parser.parse_args()
    materialize(embedding_only=args.embedding_only)
