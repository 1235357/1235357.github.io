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


def manifest(directory, root):
    entries = {}
    for path in directory.rglob('*'):
        guard_path(path, root)
        entries[str(path.relative_to(directory))] = path.read_bytes() if path.is_file() else None
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

    for name in ('inspector.html', 'inspector.css', 'pdf-app.mjs', 'pdf-session.mjs', 'pdf-source.mjs', 'protocol.mjs', 'item-window.mjs', 'pdf-assets.json'):
        copy(browser / name, target / name)
    for name, expected_hash in registry['moduleHashes'].items():
        source = guard_path(package / name, root)
        if hashlib.sha256(source.read_bytes()).hexdigest() != expected_hash:
            raise ValueError(f'PDF.js module hash mismatch: {name}')
        copy(source, target / 'vendor' / name)
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
            manifest(stage, root)  # Refuse links/junctions inside the owned stage.
            shutil.rmtree(stage)


if __name__ == '__main__':
    build()
