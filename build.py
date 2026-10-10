"""Local static build. No network, publication or credential access."""
from pathlib import Path
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
from datetime import datetime, timezone
import stat
import shutil
import tempfile
import uuid
import re
import markdown
import json
import hashlib

ROOT = Path(__file__).resolve().parent
FILE_BLOCK_BYTES = 1024 * 1024


def render_page(title, content, *, section='SERIES', outline=''):
    desktop_outline = f'<nav aria-label="Article sections">{outline}</nav>' if outline else ''
    if outline:
        mobile_outline = ('<details class="mobile-outline"><summary>On this page</summary>'
                          f'<nav aria-label="Article sections (mobile)">{outline}</nav></details>')
        content = content.replace('</h1>', '</h1>' + mobile_outline, 1)
    # Wide authored figures are main-grid stages, not 780px text-column children.
    # Keep the prose before/after each stage in normal article columns.
    parts = re.split(r'(<figure class="architecture-figure"(?=\s|>)[^>]*>.*?</figure>)',
                     content, flags=re.DOTALL)
    article_layout = ''.join(
        part if part.startswith('<figure class="architecture-figure"')
        else f'<article>{part}</article>' for part in parts if part.strip()
    )
    return f'''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)} — Zhentong Ye</title><link rel="stylesheet" href="style.css">
<header><a href="index.html">ZHENTONG YE / ENGINEERING NOTES</a>
<span>Local draft · not published</span></header>
<main><aside><p>FIELD NOTES / {escape(section)}</p><p>Evidence, interfaces,<br>and engineering decisions.</p>
<a href="index.html">Series index ↗</a>{desktop_outline}</aside>{article_layout}</main>
<footer>Implementation evidence ≠ financial accuracy ≠ personal mastery.</footer></html>'''


class PageReferences(HTMLParser):
    """Literal HTML dependencies only; not a JS/WASM module-graph validator."""
    def __init__(self):
        super().__init__()
        self.targets = []
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if attributes.get('id'):
            self.ids.add(attributes['id'])
        for key in ('href', 'src'):
            if attributes.get(key):
                self.targets.append(attributes[key])


def guard_path(path, root):
    """Refuse escapes and Windows junctions before traversing or moving paths."""
    path = path.absolute()
    if not path.is_relative_to(root) or not path.resolve().is_relative_to(root):
        raise ValueError(f'Path escapes build root: {path}')
    current = path
    while True:
        if current.exists() or current.is_symlink():
            details = current.lstat()
            reparse = getattr(details, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
            if current.is_symlink() or reparse:
                raise ValueError(f'Build path is a link or reparse point: {current}')
        if current == root:
            break
        current = current.parent
    return path


def file_fingerprint(path):
    """Return actual stream length and SHA-256 without retaining file contents."""
    count = 0
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while block := source.read(FILE_BLOCK_BYTES):
            count += len(block)
            digest.update(block)
    return count, digest.hexdigest()


def copy_verified_asset(source, destination, expected_bytes, expected_sha256, root, label):
    """Verify the chunks written to a new private-stage asset; caller owns cleanup."""
    if (type(expected_bytes) is not int or expected_bytes <= 0
            or not isinstance(expected_sha256, str)
            or re.fullmatch(r'[0-9a-fA-F]{64}', expected_sha256) is None):
        raise ValueError(f'Asset metadata is invalid: {label}')
    source = guard_path(source, root)
    destination = guard_path(destination, root)
    if not source.is_file():
        raise ValueError(f'Asset missing or not a file: {label}')
    if (source.resolve() == destination.resolve()
            or (destination.exists() and source.samefile(destination))):
        raise ValueError(f'Asset source and destination are the same file: {label}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination = guard_path(destination, root)
    count = 0
    digest = hashlib.sha256()
    with source.open('rb') as reader, destination.open('xb') as writer:
        while block := reader.read(FILE_BLOCK_BYTES):
            if count + len(block) > expected_bytes:
                raise ValueError(f'Asset bytes mismatch: {label}')
            if writer.write(block) != len(block):
                raise OSError(f'Asset write was incomplete: {label}')
            count += len(block)
            digest.update(block)
        if count != expected_bytes:
            raise ValueError(f'Asset bytes mismatch: {label}')
        if digest.hexdigest() != expected_sha256.lower():
            raise ValueError(f'Asset hash mismatch: {label}')
    return count, digest.hexdigest()


def manifest(directory, root):
    directory = guard_path(directory, root)
    entries = {}
    for path in directory.rglob('*'):
        guard_path(path, root)
        entries[str(path.relative_to(directory))] = file_fingerprint(path) if path.is_file() else None
    return entries


def validate_local_references(output):
    pages = {}
    for path in output.rglob('*.html'):
        parsed = PageReferences()
        parsed.feed(path.read_text(encoding='utf-8'))
        pages[path.resolve()] = parsed
    for path, page in pages.items():
        for reference in page.targets:
            url = urlsplit(reference)
            if url.scheme or url.netloc:
                continue  # External availability has its own live acceptance gate.
            if url.path.startswith('/'):
                target = (output / unquote(url.path).lstrip('/')).resolve()
            else:
                target = (path.parent / unquote(url.path)).resolve() if url.path else path
            if not target.is_relative_to(output) or not target.is_file():
                raise ValueError(f'Missing or escaping local reference in {path.name}: {reference}')
            if url.fragment and target in pages and unquote(url.fragment) not in pages[target].ids:
                raise ValueError(f'Missing HTML fragment in {path.name}: {reference}')


def render_site(root, output):
    copy_browser_assets(root, output)
    figure_output = output / 'figures'
    figure_output.mkdir()
    for figure in guard_path(root / 'figures', root).iterdir():
        guard_path(figure, root)
        archify_notice = figure.name in {
            'ARCHIFY-LICENSE.txt', 'ARCHIFY-THIRD-PARTY-NOTICES.txt',
            'JetBrainsMono-OFL.txt',
        }
        archify_output = figure.name.endswith(('.archify.html', '.archify.json'))
        if figure.is_file() and (figure.suffix in {'.drawio', '.puml', '.svg', '.png'}
                                 or archify_output or archify_notice):
            shutil.copyfile(figure, figure_output / figure.name)
    links = []
    for source in sorted(guard_path(root / 'articles', root).glob('*.md')):
        guard_path(source, root)
        raw = source.read_text(encoding='utf-8')
        if raw.startswith('---\n'):
            parts = raw.split('---\n', 2)
            if len(parts) != 3:
                raise ValueError(f'Unclosed front matter in {source.name}')
            raw = parts[2]
        title = next((line[2:] for line in raw.splitlines() if line.startswith('# ')), None)
        if title is None:
            raise ValueError(f'Missing title heading in {source.name}')
        renderer = markdown.Markdown(extensions=['fenced_code', 'tables', 'toc'],
                                     extension_configs={'toc': {'toc_depth': '2-2'}})
        html = renderer.convert(raw)
        name = source.stem + '.html'
        (output / name).write_text(render_page(title, html, section=source.stem.split('-', 1)[0],
                                              outline=renderer.toc), encoding='utf-8')
        links.append(f'<li><a href="{escape(name)}">{escape(title)}</a></li>')
    intro = '<h1>Building systems.<br>Checking evidence.</h1><p>A technical learning series on financial retrieval, software boundaries and evaluation. Drafts describe verified implementation and unresolved limitations separately.</p><h2>Read the series</h2><ol>' + ''.join(links) + '</ol>'
    (output / 'index.html').write_text(render_page('Engineering notes', intro), encoding='utf-8')
    (output / 'style.css').write_text(guard_path(root / 'style.css', root).read_text(encoding='utf-8'), encoding='utf-8')
    return len(links)


def copy_browser_assets(root, output):
    """Named runtime modules and pinned parser resources; not a general npm copy."""
    browser = guard_path(root / 'browser-rag', root)
    if not browser.exists():
        return
    # Pure-controller-only sites do not yet have a runtime entry point.
    if not (browser / 'inspector.html').exists():
        return
    registry = json.loads(guard_path(browser / 'pdf-assets.json', root).read_text(encoding='utf-8'))
    package = guard_path(browser / 'node_modules' / 'pdfjs-dist', root)
    installed = json.loads(guard_path(package / 'package.json', root).read_text(encoding='utf-8'))
    if installed.get('version') != registry.get('version') or registry.get('version') != '6.4.299':
        raise ValueError('PDF.js package version mismatch')
    expected_modules = {'build/pdf.mjs', 'build/pdf.worker.mjs'}
    if set(registry.get('moduleHashes', {})) != expected_modules:
        raise ValueError('PDF.js module hash registry is incomplete')
    target = output / 'browser-rag'
    target.mkdir()

    def copy(source, destination):
        guard_path(source, root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)

    for name in ('inspector.html', 'inspector.css', 'pdf-app.mjs', 'pdf-session.mjs',
                 'pdf-source.mjs', 'protocol.mjs', 'item-window.mjs', 'chunking.mjs',
                 'compute-source.mjs', 'compute.worker.mjs', 'embedding-contract.mjs',
                 'embedding-runtime.mjs', 'embedding-source.mjs', 'embedding.worker.mjs',
                 'retrieval.mjs', 'query-source.mjs', 'query.worker.mjs', 'worker-console.mjs',
                 'pdf-assets.json'):
        copy(browser / name, target / name)
    for name, expected_hash in registry['moduleHashes'].items():
        source = guard_path(package / name, root)
        copy_verified_asset(source, target / 'vendor' / name, source.stat().st_size,
                            expected_hash, root, f'PDF.js module: {name}')
    copy(package / 'LICENSE', target / 'vendor' / 'LICENSE')
    # Only runtime-resource suffixes and their license notices in these named
    # package directories. Never ship the npm tree, logs, fixtures or .env files.
    groups = {'cmaps': {'.bcmap'}, 'standard_fonts': {'.pfb', '.ttf'},
              'wasm': {'.wasm', '.js'}, 'iccs': {'.icc'}}
    for directory, suffixes in groups.items():
        source_dir = guard_path(package / directory, root)
        if not source_dir.exists():
            continue
        for source in source_dir.iterdir():
            guard_path(source, root)
            if source.is_file() and (source.suffix in suffixes or source.name.startswith('LICENSE')):
                copy(source, target / 'vendor' / directory / source.name)
    copy_embedding_assets(browser, target, root)


def copy_embedding_assets(browser, target, root):
    """Verify and deliver only the pinned same-origin embedding asset allowlist."""
    registry_path = guard_path(browser / 'embedding-assets.json', root)
    if not registry_path.exists():
        return  # Keep synthetic PDF-only builds independent of model assets.
    registry_bytes = registry_path.read_bytes()
    registry = json.loads(registry_bytes)
    identity = {
        'schemaVersion': 1,
        'modelId': 'Xenova/all-MiniLM-L6-v2',
        'revision': '751bff37182d3f1213fa05d7196b954e230abad9',
        'libraryVersion': '3.8.1',
        'ortVersion': '1.22.0-dev.20250409-89f8206ba4',
    }
    if not isinstance(registry, dict) or set(registry) != set(identity) | {
            'modelFiles', 'runtimeFiles', 'noticeFiles'}:
        raise ValueError('Embedding registry keys are incomplete or unexpected')
    if type(registry['schemaVersion']) is not int or any(
            registry[key] != value for key, value in identity.items()):
        raise ValueError('Embedding registry identity or version mismatch')
    transformers = browser / 'node_modules' / '@huggingface' / 'transformers'
    for package, version in ((transformers, identity['libraryVersion']),
                             (browser / 'node_modules' / 'onnxruntime-web', identity['ortVersion'])):
        installed = json.loads(guard_path(package / 'package.json', root).read_bytes())
        if not isinstance(installed, dict) or installed.get('version') != version:
            raise ValueError(f'Embedding package version mismatch: {package.name}')
    models = browser / '.model-cache' / identity['revision']
    model_names = ('config.json', 'tokenizer.json', 'tokenizer_config.json',
                   'special_tokens_map.json', 'onnx/model.onnx')
    runtime_names = ('transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs',
                     'ort-wasm-simd-threaded.jsep.wasm')
    # Source locations are authored here, never accepted from registry metadata.
    notice_sources = {
        'TRANSFORMERS-LICENSE.txt': transformers / 'LICENSE',
        'JINJA-LICENSE.txt': browser / 'node_modules' / '@huggingface' / 'jinja' / 'LICENSE',
        'FLATBUFFERS-LICENSE.txt': browser / 'node_modules' / 'flatbuffers' / 'LICENSE',
        'LONG-LICENSE.txt': browser / 'node_modules' / 'long' / 'LICENSE',
        'PLATFORM-LICENSE.txt': browser / 'node_modules' / 'platform' / 'LICENSE',
        'PROTOBUFJS-LICENSE.txt': browser / 'node_modules' / 'protobufjs' / 'LICENSE',
        'MODEL-CARD.txt': models / 'README.md',
        'ONNXRUNTIME-LICENSE.txt': browser / 'notices' / 'ONNXRUNTIME-LICENSE.txt',
        'ONNXRUNTIME-ThirdPartyNotices.txt': browser / 'notices' / 'ONNXRUNTIME-ThirdPartyNotices.txt',
        'ATTRIBUTION.txt': browser / 'notices' / 'ATTRIBUTION.txt',
    }
    groups = (
        ('modelFiles', {name: models / name for name in model_names},
         target / 'models' / identity['revision'] / identity['modelId']),
        ('runtimeFiles', {name: transformers / 'dist' / name for name in runtime_names},
         target / 'vendor' / 'transformers'),
        ('noticeFiles', notice_sources, target / 'notices'),
    )
    for group, sources, destination in groups:
        metadata = registry[group]
        if not isinstance(metadata, dict) or set(metadata) != set(sources):
            raise ValueError(f'Embedding {group} registry keys are incomplete or unexpected')
        for name, source in sources.items():
            entry = metadata[name]
            if (not isinstance(entry, dict) or set(entry) != {'bytes', 'sha256'}
                    or type(entry['bytes']) is not int or entry['bytes'] <= 0
                    or not isinstance(entry['sha256'], str)
                    or re.fullmatch(r'[0-9a-fA-F]{64}', entry['sha256']) is None):
                raise ValueError(f'Embedding asset metadata is invalid: {group}/{name}')
            source = guard_path(source, root)
            if not source.is_file():
                raise ValueError(f'Embedding asset missing: {group}/{name}')
            copy_verified_asset(source, destination / name, entry['bytes'], entry['sha256'],
                                root, f'Embedding asset: {group}/{name}')
    (target / 'embedding-assets.json').write_bytes(registry_bytes)


def build():
    root = ROOT.absolute()
    if root == root.parent or root != root.resolve():
        raise ValueError(f'Build root must be an explicit real directory: {root}')
    guard_path(root, root)
    output = guard_path(root / 'dist', root)
    recovery_root = guard_path(root / '.build-recovery', root)
    stage = Path(tempfile.mkdtemp(prefix='.dist-stage-', dir=root))
    stage_identity = (stage.stat().st_dev, stage.stat().st_ino)
    recovery = None
    try:
        count = render_site(root, stage)
        validate_local_references(stage)
        if output.exists():
            if not output.is_dir():
                raise ValueError(f'Build output is not a directory: {output}')
            if manifest(stage, root) == manifest(output, root):
                print(f'Unchanged: {count} article(s) and index in {output}')
                return {'status': 'unchanged', 'output_path': output, 'recovery_path': None}
            recovery_root.mkdir(exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            recovery = guard_path(recovery_root / f'{stamp}-{uuid.uuid4().hex}', root)
            if recovery.exists():
                raise FileExistsError(f'Recovery collision: {recovery}')
            output.rename(recovery)
        try:
            stage.rename(output)
        except OSError as promotion_error:
            if recovery is not None:
                try:
                    recovery.rename(output)
                except OSError as rollback_error:
                    raise OSError(f'Promotion failed; restore also failed. Previous output retained at '
                                  f'{recovery}; promotion: {promotion_error}; restore: {rollback_error}') from rollback_error
            raise
        print(f'Built {count} article(s) and index in {output}')
        if recovery is not None:
            print(f'Previous output retained at {recovery}')
        return {'status': 'built', 'output_path': output, 'recovery_path': recovery}
    finally:
        # Only remove this invocation's disposable staging directory, never dist.
        if stage.exists():
            guard_path(stage, root)
            if stage.parent != root or not stage.name.startswith('.dist-stage-'):
                raise ValueError(f'Refusing unexpected stage cleanup: {stage}')
            if (stage.stat().st_dev, stage.stat().st_ino) != stage_identity:
                raise ValueError(f'Refusing replaced stage cleanup: {stage}')
            for path in stage.rglob('*'):
                guard_path(path, root)  # Refuse links/junctions without reading file contents.
            shutil.rmtree(stage)


if __name__ == '__main__':
    build()
