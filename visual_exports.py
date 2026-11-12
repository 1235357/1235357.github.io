"""Version-bound static SVG exports of the actual inline visual panels."""
import re,json,hashlib
from xml.etree import ElementTree as ET
from html.parser import HTMLParser
import textwrap


class _Legends(HTMLParser):
    """Retain reader-visible qualifications when a panel leaves its page."""
    def __init__(self, html):
        super().__init__()
        self.depth = 0
        self.parts = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if self.depth:
            self.depth += 1
        elif "visual-legend" in dict(attrs).get("class", "").split():
            self.depth = 1

    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1
            if not self.depth:
                self.parts.append(" ")

    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)


def write_exports(html, name, spec, output, style):
    # Export only diagram styling, never the host site's font faces or URLs.
    style = '\n'.join(selector.strip()+'{'+body+'}' for selector,body in re.findall(r'([^{}]+)\{([^{}]*)\}',style) if ('owned-panel' in selector or 'flow-panel' in selector or '.v-' in selector) and '@' not in selector and 'url(' not in body and '@import' not in body)
    style=style.replace('font:16px var(--ui)', 'font-family:Arial,sans-serif;font-size:16px')
    if 'var(' in style or '@font-face' in style: raise ValueError('Export CSS must use explicit portable values')
    digest=hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest()
    panels=re.findall(r'<svg\b.*?</svg>',html,re.S)
    entries=[]
    context=" ".join("".join(_Legends(html).parts).split())
    for index,panel in enumerate(panels,1):
        layout=hashlib.sha256(panel.encode()).hexdigest()
        filename=f'{name}-panel-{index}-{layout[:10]}.svg'
        viewbox=re.search(r'viewBox="0 0 (\d+) (\d+)"',panel)
        if not viewbox: raise ValueError('Export needs explicit dimensions')
        width,height=map(int,viewbox.groups())
        original_height = height
        # Parse the inline SVG before adding export-only dimensions. Replacing the
        # root text added a second style attribute to sequence panels, producing
        # invalid XML that forgiving raster renderers could silently accept.
        root = ET.fromstring(panel)
        root.set('xmlns', 'http://www.w3.org/2000/svg')
        if context:
            # A separately downloaded panel must keep the historical/proposed
            # status and arrow/reference legend that qualified it on the page.
            lines = textwrap.wrap(context, max(20, (width-32)//8),
                                  break_long_words=False, break_on_hyphens=False)
            height += 34 + 22*len(lines)
            root.set('viewBox', f'0 0 {width} {height}')
            desc = ET.SubElement(root, 'desc', {'id': f'{name}-export-context-{index}'})
            desc.text = context
            root.set('aria-describedby', desc.get('id'))
            footer = ET.SubElement(root, 'g', {'data-export-context': 'true'})
            ET.SubElement(footer, 'rect', {'x':'0','y':str(original_height),
                'width':str(width),'height':str(height-original_height),'fill':'#fff'})
            caption = ET.SubElement(footer, 'text', {'x':'16','y':str(original_height+24),
                'style':'font-family:Arial,sans-serif;font-size:16px;font-weight:400;fill:#182b45;text-anchor:start'})
            for line_index, line in enumerate(lines):
                ET.SubElement(caption, 'tspan', {'x':'16','dy':str(0 if line_index==0 else 22)}).text=line
        root.set('width', str(width))
        root.set('height', str(height))
        inline_style = root.get('style', '').strip().rstrip(';')
        root.set('style', (inline_style+';' if inline_style else '') +
                 f'width:{width}px;height:{height}px;max-width:none')
        exported_style = ET.Element('style')
        exported_style.text = style
        root.insert(0, exported_style)
        svg = ET.tostring(root, encoding='unicode')
        filename=f'{name}-panel-{index}-{layout[:10]}-{hashlib.sha256(svg.encode()).hexdigest()[:10]}.svg'
        (output/filename).write_bytes(svg.encode('utf-8'))
        entries.append({'file':filename,'source_digest':digest,'layout_digest':layout,'svg_sha256':hashlib.sha256(svg.encode()).hexdigest(),'width':width,'height':height,'panel_height':original_height,'export_context':context,'style_digest':hashlib.sha256(style.encode()).hexdigest(),'font':'Arial/sans-serif fallback; self-contained export, no external font fetch'})
    (output/(name+'-exports.json')).write_text(json.dumps(entries,indent=2),encoding='utf-8')
    return '<p class="visual-export-links">SVG panels: '+ ' · '.join(f'<a href="figures/{x["file"]}">Panel {i}</a>' for i,x in enumerate(entries,1)) +f' · <a href="figures/{name}-exports.json">Version mapping</a></p>'
