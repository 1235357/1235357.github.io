"""Source-pinned, narrow-column sequence SVGs. No inferred interactions."""
import hashlib
import json
import textwrap
from html import escape

PINS = {'owned-generation': 'a4d315fec0ea34a38c8e9365b36488f901aa01c09b07f91c41afc2b528c63017', 'table-cell-selection': '9f1e0c5856f2c6398256b1f0a185913b3381108b2dc4b9f765e15585f906dbe1'}

def source_digest(spec):
    return hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()

STYLE = '''
.sq-panel{display:block;width:100%;max-width:480px;height:auto;background:#fff;color:#182b45;font-family:Arial,sans-serif}
.sq-panel .sq-title{font-family:Arial,sans-serif;font-size:20px;font-weight:700;font-weight:700;fill:#182b45}
.sq-panel .sq-role{font-family:Arial,sans-serif;font-size:17px;font-weight:700;font-weight:700;fill:#182b45}
.sq-panel .sq-message{font-family:Arial,sans-serif;font-size:18px;font-weight:400;fill:#182b45}
.sq-panel .sq-note{font-family:Arial,sans-serif;font-size:17px;font-weight:400;fill:#39526d}
.sq-panel .sq-line{fill:none;stroke:#426488;stroke-width:2.5}
.sq-panel .sq-life{stroke:#b3c2d1;stroke-width:1.5;stroke-dasharray:4 6}
.sq-panel .sq-return{stroke-dasharray:6 4}
.sq-panel .sq-security{stroke:#a24d22}
'''

def render_sequence(spec, name):
    if name not in PINS or source_digest(spec) != PINS[name]:
        raise ValueError('Sequence source changed: review exact semantics '+name)
    participants = spec['participants']
    ids = [p['id'] for p in participants]
    if any(len(textwrap.wrap(p['label'],7,break_long_words=False,break_on_hyphens=False)) > 2 for p in participants):
        raise ValueError('Participant label exceeds reviewed two-line header: review layout')
    positions = {k: 36+i*(288/(len(ids)-1)) for i,k in enumerate(ids)}
    palette=['#e3eefb','#e6f1eb','#f0e9fa','#fff0db','#f8e4e5']
    def tx(x,y,label,cls='sq-message',width=32):
        lines=textwrap.wrap(label,width,break_long_words=False,break_on_hyphens=False) or ['']
        return '<text class="'+cls+'" text-anchor="middle" x="'+str(x)+'" y="'+str(y)+'">'+''.join('<tspan x="'+str(x)+'" dy="'+str(0 if i==0 else 23)+'">'+escape(s)+'</tspan>' for i,s in enumerate(lines))+'</text>'
    panels=[]
    assigned=[]
    for index,segment in enumerate(spec['segments']):
        messages=[(i+1,m) for i,m in enumerate(spec['messages']) if segment['from'] <= m['y'] <= segment['to']]
        if not messages: raise ValueError('Empty segment')
        assigned += [m['id'] for _,m in messages]
        alternative=name=='owned-generation' and index==3
        title=segment['label']
        title_lines=len(textwrap.wrap(title,29))
        head=38+23*(title_lines-1)
        role_top=head+33
        content_top=role_top+82
        heights=[max(1,len(textwrap.wrap(m['label'],32,break_long_words=False,break_on_hyphens=False)))*23+65 for _,m in messages]
        height=content_top+sum(heights)+78
        prefix='sq-'+name+'-'+str(index+1)
        out=f'<svg class="sq-panel flow-panel" data-segment="{index+1}" data-alternative="{str(alternative).lower()}" viewBox="0 0 360 {height}" role="img" aria-labelledby="{prefix}-title" style="width:100%;max-width:480px;height:auto">'
        out+=f'<title id="{prefix}-title">'+escape(title)+'</title><style>'+STYLE+'</style>'
        out+='<rect x="1" y="1" width="358" height="'+str(height-2)+'" rx="12" fill="#fff" stroke="'+('#cf875c' if alternative else '#d2dfeb')+'"/>'
        out+=tx(180,32,title,'sq-title',29)
        if alternative:
            out+=tx(180,head+25,'Alternative, not a next success step','sq-note',36)
            role_top+=27;content_top+=27;height+=27
            # The layout height is fixed before drawing so cancellation labels cannot clip.
            out=out.replace(f'viewBox="0 0 360 {height-27}"',f'viewBox="0 0 360 {height}"').replace(f'height="{height-29}"',f'height="{height-2}"')
        for j,p in enumerate(participants):
            x=positions[p['id']]
            out+=f'<g data-participant="{p["id"]}"><line class="sq-life" x1="{x}" x2="{x}" y1="{role_top+53}" y2="{height-39}"/>'
            out+=f'<rect x="{x-33}" y="{role_top-20}" width="66" height="64" rx="8" fill="{palette[j]}"/>'
            out+=tx(x,role_top+3,p['label'],'sq-role',7)+'</g>'
        y=content_top
        for (order,m),step in zip(messages,heights):
            x1,x2=positions[m['from']],positions[m['to']]
            lines=len(textwrap.wrap(m['label'],32,break_long_words=False,break_on_hyphens=False))
            arrow_y=y+lines*23+20
            marker=prefix+'-'+m['id']
            color='#a24d22' if m.get('variant')=='security' else '#315a8a'
            out+=f'<g data-message="{m["id"]}" data-from="{m["from"]}" data-to="{m["to"]}" data-order="{order}" data-source-y="{m["y"]}" data-variant="{m.get("variant", "default")}">'
            out+=f'<rect x="10" y="{y-18}" width="340" height="{lines*23+5}" rx="5" fill="#fff"/>'
            out+=tx(180,y,m['label'])
            out+=f'<defs><marker id="{marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill="{color}"/></marker></defs>'
            classes='sq-line'+(' sq-return' if m.get('variant')=='return' else '')+(' sq-security' if m.get('variant')=='security' else '')
            out+=f'<path class="{classes}" d="M{x1} {arrow_y} H{x2}" marker-end="url(#{marker})"/>'
            out+=f'<circle cx="{x1}" cy="{arrow_y}" r="4" fill="{color}"/>'
            # Source order is a small annotation, never an additional event.
            out+=tx(180,arrow_y+25,str(order),'sq-note')+'</g>'
            y+=step
        footer='Alternative exit only' if alternative else ('Continues in phase '+str(index+2) if index<len(spec['segments'])-1 and not(name=='owned-generation' and index==2) else 'End of this path')
        out+=tx(180,height-15,footer,'sq-note',35)+'</svg>'
        panels.append(out)
    if assigned != [m['id'] for m in spec['messages']]:
        raise ValueError('Messages must belong to exactly one segment in source order')
    note='Dashed arrows are returns; solid arrows are requests or commands. Message numbers preserve source order. Repeated headers refer to the same participants across phases.'
    if name=='owned-generation':note+=' Cancellation/deadline is an alternative from any active stage, not a step required after draft inspection.'
    else:note+=' Participants are roles in one local Python replay, not separate network services. Synthetic controls and lexical presence are not financial accuracy evidence.'
    return '<div class="visual-sequence" data-source-digest="'+source_digest(spec)+'">'+''.join(panels)+'<p class="visual-legend">'+escape(note)+'</p></div>'
