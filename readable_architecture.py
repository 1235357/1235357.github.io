"""Build an accessible relationship map from the existing Archify specification.
No runtime, source or receipt claims are changed; the full figure stays separate.
"""
from html import escape

def render_relationship_map(spec, prefix):
    nodes = spec['components']
    by_id = {n['id']: n for n in nodes}
    if len(by_id) != len(nodes):
        raise ValueError('Duplicate component identity')
    edges = spec['connections']
    for edge in edges:
        if edge['from'] not in by_id or edge['to'] not in by_id:
            raise ValueError('Unknown relationship endpoint')
    e = escape
    rows = []
    lanes = {lane['id']: lane['label'] for lane in spec.get('lanes', [])}
    for boundary in spec.get('boundaries', []):
        if not set(boundary['wraps']) <= set(by_id):
            raise ValueError('Unknown boundary member')
    for node in nodes:
        affiliations = [b['label'] for b in spec.get('boundaries', []) if node['id'] in b['wraps']]
        if 'lane' in node:
            if node['lane'] not in lanes: raise ValueError('Unknown lane')
            affiliations.append(lanes[node['lane']])
        context = ''.join('<p class="relationship-context">'+e(label)+'</p>' for label in affiliations)
        context += '<p class="relationship-tag">'+e(node['tag'])+'</p>' if node.get('tag') else ''
        links = ''.join(f'<li data-edge="{e(edge["id"],quote=True)}"><span>{e(edge.get("label", "Connection"))}</span><span aria-hidden="true">→</span><a href="#{e(prefix+"-"+edge["to"],quote=True)}">{e(by_id[edge["to"]]["label"])}</a></li>' for edge in edges if edge['from']==node['id'])
        rows.append(f'<section id="{e(prefix+"-"+node["id"],quote=True)}" class="relationship-node"><h4>{e(node["label"])}</h4>{context}<p>{e(node.get("sublabel",""))}</p>'+(f'<ul aria-label="Outgoing relationships">{links}</ul>' if links else '<p class="relationship-terminal">No outgoing connection in this source diagram.</p>')+'</section>')
    return '<div class="relationship-map" aria-label="Readable architecture relationships">'+''.join(rows)+'</div>'

def render_reading_map(spec, prefix):
    kind = spec.get('diagram_type')
    if kind == 'architecture':
        return render_relationship_map(spec, prefix)
    if kind == 'lifecycle':
        converted = dict(spec, components=spec['states'], connections=spec['transitions'])
        return render_relationship_map(converted, prefix)
    if kind == 'sequence':
        names = {p['id']:p['label'] for p in spec['participants']}
        rows=[]
        previous_segment = None
        for message in sorted(spec['messages'], key=lambda m:m['y']):
            if message['from'] not in names or message['to'] not in names:
                raise ValueError('Unknown message endpoint')
            segment = [s['label'] for s in spec.get('segments', []) if s['from'] <= message['y'] <= s['to']]
            if len(segment) > 1: raise ValueError('Ambiguous segment membership')
            segment_label = segment[0] if segment else 'Outside declared segments'
            if segment_label != previous_segment:
                rows.append('<li class="relationship-segment">'+escape(segment_label)+'</li>')
                previous_segment = segment_label
            rows.append('<li data-edge="'+escape(message['id'],quote=True)+'"><strong>'+escape(names[message['from']])+' → '+escape(names[message['to']])+'</strong><span>'+escape(message['label'])+(' · '+escape(message['variant']) if message.get('variant') else '')+'</span></li>')
        return '<ol class="relationship-sequence" aria-label="Messages in source diagram order">'+''.join(rows)+'</ol>'
    raise ValueError('Unsupported architecture schema')

def render_calculation_reading(source, prefix):
    """Read this project's small PlantUML flow; reject unrecognized edge syntax."""
    import re
    nodes = []
    for label, identity in re.findall(r'^rectangle "([^"\n]+)" as (\w+)', source, re.M):
        title, _, subtitle = label.partition('\\n')
        nodes.append({'id': identity, 'label': title, 'sublabel': subtitle})
    edges = []
    for line in source.splitlines():
        match = re.fullmatch(r'(\w+) (-(?:right|left)->|\.(?:down|left)\.>) (\w+)(?: : (.+))?', line)
        if match:
            a, arrow, b, label = match.groups()
            edges.append({'id': a+'-'+b, 'from': a, 'to': b,
                          'label': ('proposed: '+label if label and label != 'proposed' else 'proposed path') if arrow.startswith('.') else 'implemented document path',
                          'variant': 'proposed' if arrow.startswith('.') else 'implemented'})
    if len(nodes) != 7 or len(edges) != 6:
        raise ValueError('Review the changed calculation diagram contract')
    return render_relationship_map({'components': nodes, 'connections': edges}, prefix)
