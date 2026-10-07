"""Local static build. No network, publication or credential access."""
from pathlib import Path
from html import escape
import shutil
import re
import markdown

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


def build():
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    figure_output = output / 'figures'
    figure_output.mkdir(exist_ok=True)
    for figure in (ROOT / 'figures').iterdir():
        archify_notice = figure.name in {
            'ARCHIFY-LICENSE.txt', 'ARCHIFY-THIRD-PARTY-NOTICES.txt',
            'JetBrainsMono-OFL.txt',
        }
        archify_output = figure.name.endswith(('.archify.html', '.archify.json'))
        if figure.is_file() and (figure.suffix in {'.drawio', '.puml', '.svg', '.png'}
                                 or archify_output or archify_notice):
            shutil.copyfile(figure, figure_output / figure.name)
    links = []
    for source in sorted((ROOT / 'articles').glob('*.md')):
        raw = source.read_text(encoding='utf-8')
        if raw.startswith('---\n'):
            raw = raw.split('---\n', 2)[2]
        title = next(line[2:] for line in raw.splitlines() if line.startswith('# '))
        renderer = markdown.Markdown(extensions=['fenced_code', 'tables', 'toc'],
                                     extension_configs={'toc': {'toc_depth': '2-2'}})
        html = renderer.convert(raw)
        name = source.stem + '.html'
        (output / name).write_text(render_page(title, html, section=source.stem.split('-', 1)[0],
                                              outline=renderer.toc), encoding='utf-8')
        links.append(f'<li><a href="{escape(name)}">{escape(title)}</a></li>')
    intro = '<h1>Building systems.<br>Checking evidence.</h1><p>A technical learning series on financial retrieval, software boundaries and evaluation. Drafts describe verified implementation and unresolved limitations separately.</p><h2>Read the series</h2><ol>' + ''.join(links) + '</ol>'
    (output / 'index.html').write_text(render_page('Engineering notes', intro), encoding='utf-8')
    (output / 'style.css').write_text((ROOT / 'style.css').read_text(encoding='utf-8'), encoding='utf-8')
    print(f'Built {len(links)} article(s) and index in {output}')


if __name__ == '__main__':
    build()
