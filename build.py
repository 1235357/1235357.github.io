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
import browser_release_assets as release
from portfolio import render_home

ROOT = Path(__file__).resolve().parent
FILE_BLOCK_BYTES = 1024 * 1024
PUBLIC_SITE_MAX_BYTES = 1_000_000_000


def render_page(title, content, *, section='SERIES', outline='', public_release=False, has_portfolio=False,
                stylesheet_href='style.css'):
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
    publication_label = 'Documentation · browser lab' if public_release else 'Local draft · not published'
    series_url = 'journal.html' if has_portfolio else 'index.html'
    reading_navigation = (
        '<nav aria-label="Main navigation"><a href="index.html#projects">Work</a>'
        f'<a href="{series_url}">Journal</a><a href="index.html#demo">RAG lab</a></nav>'
        if has_portfolio else
        '<nav aria-label="Main navigation"><a href="index.html">Journal</a></nav>'
    )
    footer_html = (
        '© 2026 Zhentong Ye · '
        '<a href="https://github.com/1235357/1235357.github.io">Source</a> · '
        '<a href="SITE-LICENSE.txt">Site license</a> · '
        'Native drafts and source-cell candidates remain unadjudicated.'
        if public_release else
        'Implementation evidence ≠ financial accuracy ≠ personal mastery.'
    )
    return f'''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#f7f8fa">
<title>{escape(title)} — Zhentong Ye</title><link rel="stylesheet" href="{escape(stylesheet_href, quote=True)}">
<body class="reading-page"><a class="skip-link" href="#main-content">Skip to content</a>
<header class="site-header"><a class="wordmark" href="index.html">ZHENTONG YE <span>/ ENGINEERING NOTES</span></a>
{reading_navigation}</header>
<main id="main-content" tabindex="-1"><aside><p>FIELD NOTES / {escape(section)}</p><p>Evidence, interfaces,<br>and engineering decisions.</p>
<a href="{series_url}">Series index ↗</a>{desktop_outline}</aside>{article_layout}</main>
<footer>{publication_label} · {footer_html}</footer></body></html>'''


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


def render_site(root, output, *, public_release=False):
    profile_path = root / 'portfolio.json'
    has_portfolio = profile_path.is_file()
    copy_browser_assets(root, output, public_release=public_release)
    copy_typography_assets(root, output)
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
    style_text = guard_path(root / 'style.css', root).read_text(encoding='utf-8')
    style_version = hashlib.sha256(style_text.encode('utf-8')).hexdigest()[:16]
    stylesheet_href = f'style.css?v={style_version}'
    links = []
    reader_questions = {
        '01-two-lifecycles': 'What can be prepared once, and what must happen for each question?',
        '02-contracts-before-services': 'Who owns a request, its result and its failure?',
        '03-ranking-is-not-confidence': 'Why can a high-scoring passage still miss the requested fact?',
        '04-preserve-evidence-before-embedding': 'How do text, page positions and table columns survive ingestion?',
        '05-generation-is-not-verification': 'What reaches the model, and what does a citation actually prove?',
        '06-evaluation-labels-before-scores': 'Which judgments are needed before a quality score means anything?',
        '07-operational-receipts': 'How does the reader-owned lab keep each computation inspectable?',
        '08-source-bound-startup': 'How does an installed package become a service with explicit source boundaries?',
    }
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
                                              outline=renderer.toc, public_release=public_release,
                                              has_portfolio=has_portfolio,
                                              stylesheet_href=stylesheet_href), encoding='utf-8')
        question = reader_questions.get(source.stem)
        description = f'<p class="series-summary">{escape(question)}</p>' if question else ''
        links.append(f'<li><a href="{escape(name)}">{escape(title)}</a>{description}</li>')
    featured = ''
    if (output / '07-operational-receipts.html').is_file():
        featured = '''<section class="featured-project" aria-label="Financial RAG project">
<p class="project-kicker">PROJECT / FINANCIAL RAG</p>
<h2>Ask a document. Inspect the evidence.</h2>
<p>Follow an NVIDIA document workflow from source pages to retrieval, model execution and an answer gate. Explore the browser lab and the engineering decisions behind a separately packaged Python API.</p>
<div class="project-variants">
<div><h3>Browser lab</h3><p>Choose your own local PDF. Inspect chunks, tokens, vectors and exact source spans. Native answer generation is enabled in the private local acceptance entry.</p><a href="browser-rag/inspector.html">Open the lab ↗</a></div>
<div><h3>Service contract</h3><p>Authenticated Python queries preserve request IDs and distinguish semantic refusals from dependency failures. Review the status contract and its installed-package checks.</p><a href="07-operational-receipts.html#an-enterprise-caller-needs-failure-semantics">Read the API decisions ↗</a></div>
</div>
<a href="07-operational-receipts.html">Read the execution-contract chapter ↗</a>
<p class="project-boundary">Local implementation and acceptance evidence. Financial accuracy, scale measurements and public release remain separate gates.</p>
</section>'''
        if public_release:
            featured = featured.replace('Native answer generation is enabled in the private local acceptance entry.',
                'Native generation and explicit Net income source-cell lookup are available through reader actions.')
            featured = featured.replace('Local implementation and acceptance evidence. Financial accuracy, scale measurements and public release remain separate gates.',
                'Reader-device browser lab and exposed development evidence. Native drafts and source-cell candidates remain unadjudicated; no held-out accuracy or broad-device performance claim.')
    intro = ('<h1>Building systems.<br>Checking evidence.</h1>'
        '<p>Follow a financial PDF from source pages to retrieval, an answer draft and a service interface. '
        'Each chapter explains an engineering decision through concrete examples, code and retained development evidence.</p>'
        + featured + '<h2>Choose a question to explore</h2>'
        '<p>New to RAG? Start with the two lifecycles, then follow source preservation, ranking and generation. '
        'For the working interface, open the computation lab. For an existing Python application, start with service startup.</p>'
        '<ol class="series-list">' + ''.join(links) + '</ol>')
    if has_portfolio:
        profile = json.loads(guard_path(profile_path, root).read_text(encoding='utf-8'))
        demo_script = guard_path(root / 'portfolio-demo.mjs', root)
        script_version = hashlib.sha256(demo_script.read_text(encoding='utf-8').encode('utf-8')).hexdigest()[:16]
        (output / 'index.html').write_text(render_home(profile, public_release=public_release,
            stylesheet_href=stylesheet_href,
            demo_script_href=f'portfolio-demo.mjs?v={script_version}'), encoding='utf-8')
        shutil.copyfile(demo_script, output / 'portfolio-demo.mjs')
        (output / 'journal.html').write_text(render_page('Engineering notes', intro,
            public_release=public_release, has_portfolio=True,
            stylesheet_href=stylesheet_href), encoding='utf-8')
    else:
        (output / 'index.html').write_text(render_page('Engineering notes', intro, public_release=public_release,
            stylesheet_href=stylesheet_href), encoding='utf-8')
    (output / 'style.css').write_text(guard_path(root / 'style.css', root).read_text(encoding='utf-8'), encoding='utf-8')
    return len(links)


def copy_typography_assets(root, output):
    """Copy only the named font and OFL notice; synthetic sites may omit them."""
    from site_typography_assets import TYPOGRAPHY_FILES
    source = guard_path(root / 'assets' / 'typography', root)
    if not source.exists():
        return
    for name, pin in TYPOGRAPHY_FILES.items():
        copy_verified_asset(source / name, output / 'assets' / 'typography' / name,
                            pin['bytes'], pin['sha256'], root, f'UI typography: {name}')


def copy_browser_assets(root, output, *, public_release=False):
    """Named runtime modules and pinned parser resources; not a general npm copy."""
    browser = guard_path(root / 'browser-rag', root)
    if not browser.exists():
        return
    # Pure-controller-only sites do not yet have a runtime entry point.
    if not (browser / 'inspector.html').exists():
        if public_release:
            raise ValueError('Public browser inspector is missing')
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

    for name in ('inspector.html', 'inspector.css', 'lab-presentation.js', 'pdf-entry.mjs', 'notebook-navigation.mjs', 'pdf-app.mjs', 'pdf-session.mjs',
                 'pdf-source.mjs', 'protocol.mjs', 'runtime-failure-contract.mjs', 'item-window.mjs', 'chunking.mjs',
                 'compute-source.mjs', 'compute.worker.mjs', 'embedding-contract.mjs',
                 'embedding-runtime.mjs', 'embedding-source.mjs', 'embedding.worker.mjs',
                 'retrieval.mjs', 'retrieval-inspection.mjs', 'retrieval-inspection-view.mjs',
                 'query-source.mjs', 'query.worker.mjs', 'worker-console.mjs',
                 'context-contract.mjs', 'context-view.mjs', 'generation-view.mjs', 'bounded-text-view.mjs', 'complete-record-disclosure.mjs',
                 'pdf-assets.json'):
        copy(browser / name, target / name)
    # A newly deployed entry selects its matching presentation and CSS bodies.
    inspector_entry = target / 'inspector.html'
    inspector_markup = inspector_entry.read_text(encoding='utf-8')
    presentation_reference = 'src="lab-presentation.js"'
    if public_release and inspector_markup.count(presentation_reference) != 1:
        raise ValueError('Public inspector presentation reference differs from template')
    if inspector_markup.count(presentation_reference) == 1:
        presentation_body = (target / 'lab-presentation.js').read_bytes().replace(b'\r\n', b'\n')
        presentation_version = hashlib.sha256(presentation_body).hexdigest()[:16]
        inspector_markup = inspector_markup.replace(presentation_reference,
            f'src="lab-presentation.js?v={presentation_version}"')
    css_reference = 'href="inspector.css"'
    if public_release and inspector_markup.count(css_reference) != 1:
        raise ValueError('Public inspector stylesheet reference differs from template')
    if inspector_markup.count(css_reference) == 1:
        css_body = (target / 'inspector.css').read_bytes().replace(b'\r\n', b'\n')
        css_version = hashlib.sha256(css_body).hexdigest()[:16]
        inspector_markup = inspector_markup.replace(css_reference,
            f'href="inspector.css?v={css_version}"')
    inspector_entry.write_text(inspector_markup, encoding='utf-8')
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
    if (guard_path(browser / 'verified-stream.mjs', root).exists()
            or guard_path(browser / 'verified-cache.mjs', root).exists()):
        copy_stream_assets(browser, target, root)
    if public_release:
        copy_public_generation_assets(browser, target, root)


def copy_public_generation_assets(browser, target, root):
    """Explicit production closure; diagnostics/receipts never choose assets."""
    for name in release.PUBLIC_MODULES:
        source = guard_path(browser / name, root)
        destination = guard_path(target / name, root)
        shutil.copyfile(source, destination)
    entry = target / 'inspector.html'
    markup = entry.read_text(encoding='utf-8')
    ordinary = '<script type="module" src="pdf-entry.mjs"></script>'
    if markup.count(ordinary) != 1:
        raise ValueError('Public inspector entry differs from the reviewed template')
    markup = markup.replace(ordinary, '<script type="module" src="pdf-public-entry.mjs"></script>')
    markup = markup.replace('LOCAL DRAFT · CONTEXT NOT GENERATED', 'BROWSER LAB · CONTEXT NOT GENERATED')
    markup = markup.replace('<p class="eyebrow">PAIRED QWEN / EXPLICIT ACTION</p>',
        '<p class="eyebrow">PAIRED QWEN / EXPLICIT ACTION</p><p class="hint">'
        '<a href="notices/QWEN-MODEL-CARD.txt" target="_blank" rel="noopener noreferrer" '
        'aria-label="Pinned conversion model card (opens in a new tab)">Pinned conversion model card</a> · '
        '<a href="notices/QWEN-LICENSE.txt" target="_blank" rel="noopener noreferrer" '
        'aria-label="Upstream model license (opens in a new tab)">Upstream model license</a> · '
        '<a href="notices/QWEN-ATTRIBUTION.txt" target="_blank" rel="noopener noreferrer" '
        'aria-label="Source attribution (opens in a new tab)">Source attribution</a></p>')
    entry.write_text(markup, encoding='utf-8')
    registry_path = guard_path(browser / 'acceptance/generator-probe-assets.json', root)
    with registry_path.open('rb') as registry_stream:
        registry_bytes = registry_stream.read(32769)
    if len(registry_bytes) > 32768:
        raise ValueError('Public generator registry exceeds its byte limit')
    registry = json.loads(registry_bytes)
    if type(registry) is not dict or type(registry.get('schemaVersion')) is not int or registry != release.qwen_registry():
        raise ValueError('Public generator registry differs from fixed pins')
    # The two profiles share exactly one paired runtime; do not duplicate it.
    for name, pin in release.RUNTIME_FILES.items():
        actual = file_fingerprint(guard_path(target / 'vendor/transformers' / name, root))
        if actual != (pin['bytes'], pin['sha256']):
            raise ValueError(f'Shared public runtime differs from pins: {name}')
    cache = browser / '.model-cache' / release.QWEN_REVISION
    for name, pin in release.QWEN_MODEL_FILES.items():
        copy_verified_asset(cache / name, target / 'models' / release.QWEN_REVISION / release.QWEN_MODEL_ID / name,
                            pin['bytes'], pin['sha256'], root, f'Qwen model: {name}')
    for name, pin in release.QWEN_NOTICE_FILES.items():
        copy_verified_asset(cache / pin['cacheName'], target / 'notices' / name,
                            pin['bytes'], pin['sha256'], root, f'Qwen notice: {name}')
    sources = '\n'.join(f'{name}: {pin["url"]}' for name, pin in release.QWEN_NOTICE_FILES.items())
    (target / 'notices/QWEN-ATTRIBUTION.txt').write_text(
        f'Qwen2.5-0.5B-Instruct ONNX q4\nConversion: {release.QWEN_MODEL_ID} @ {release.QWEN_REVISION}\n'
        'Base model: Qwen/Qwen2.5-0.5B-Instruct. Upstream Apache-2.0 license included unchanged.\n'
        'The conversion model card is preserved separately; it identifies its base model.\n' + sources + '\n', encoding='utf-8')
    (target / 'acceptance').mkdir()
    (target / 'acceptance/generator-probe-assets.json').write_bytes(registry_bytes)
    shutil.copyfile(guard_path(root / 'LICENSE', root), target.parent / 'SITE-LICENSE.txt')


def copy_stream_assets(browser, target, root):
    """Deliver the optional cache, verifier and pinned same-origin hash graph."""
    browser = guard_path(browser, root)
    target = guard_path(target, root)
    verifier = guard_path(browser / 'verified-stream.mjs', root)
    if not verifier.is_file():
        raise ValueError('Stream verifier is missing or not a file')
    cache = guard_path(browser / 'verified-cache.mjs', root)
    cache_destination = None
    if cache.exists():
        if not cache.is_file():
            raise ValueError('Cache module is not a file')
        cache_destination = guard_path(target / 'verified-cache.mjs', root)
    registry_path = guard_path(browser / 'noble-assets.json', root)
    registry_bytes = registry_path.read_bytes()
    registry = json.loads(registry_bytes)
    identity = {'schemaVersion': 1, 'package': '@noble/hashes', 'version': '2.4.0'}
    if not isinstance(registry, dict) or set(registry) != set(identity) | {'files'}:
        raise ValueError('Stream registry keys are incomplete or unexpected')
    if type(registry['schemaVersion']) is not int or any(
            registry[key] != value for key, value in identity.items()):
        raise ValueError('Stream registry identity or version mismatch')
    vendor = browser / 'vendor' / 'noble-hashes'
    # Registry metadata contains pins only: it cannot choose source paths.
    sources = {
        'sha2.js': vendor / 'sha2.js',
        '_md.js': vendor / '_md.js',
        '_u64.js': vendor / '_u64.js',
        'utils.js': vendor / 'utils.js',
        'LICENSE': vendor / 'LICENSE',
    }
    files = registry['files']
    if not isinstance(files, dict) or set(files) != set(sources):
        raise ValueError('Stream files registry keys are incomplete or unexpected')
    for name, source in sources.items():
        entry = files[name]
        if (not isinstance(entry, dict) or set(entry) != {'bytes', 'sha256'}
                or type(entry['bytes']) is not int or entry['bytes'] <= 0
                or not isinstance(entry['sha256'], str)
                or re.fullmatch(r'[0-9a-f]{64}', entry['sha256']) is None):
            raise ValueError(f'Stream asset metadata is invalid: {name}')
        copy_verified_asset(source, target / 'vendor' / 'noble-hashes' / name,
                            entry['bytes'], entry['sha256'], root,
                            f'Stream asset: {name}')
    destination = guard_path(target / 'verified-stream.mjs', root)
    shutil.copyfile(verifier, destination)
    guard_path(target / 'noble-assets.json', root).write_bytes(registry_bytes)
    if cache_destination is not None:
        shutil.copyfile(cache, cache_destination)


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


def build(*, public_release=False):
    if type(public_release) is not bool:
        raise ValueError('Invalid public build profile')
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
        count = render_site(root, stage, public_release=True) if public_release else render_site(root, stage)
        if public_release:
            (stage / '.nojekyll').write_bytes(b'')
            if sum(value[0] for value in manifest(stage, root).values() if value is not None) >= PUBLIC_SITE_MAX_BYTES:
                raise ValueError('Public site reaches the 1 GB artifact budget')
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
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public', action='store_true', help='Build the explicit same-origin public generation/lookup profile')
    arguments = parser.parse_args()
    build(public_release=arguments.public)
