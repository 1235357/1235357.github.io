"""Reviewed small-multiple layout for the source-owned browser graph."""
from html import escape as e
from hashlib import sha256
import json

def render_owned_graph(spec):
    # Authored layout and aliases are reviewed against this exact source revision.
    source_digest = sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest()
    if source_digest != '578fcdd31013f88962106d283d094d84d14b20d7467eb63c8e99b9ea6c76361d':
        raise ValueError('Source changed: review layout, labels, ownership and export mapping')
    nodes={n['id']:n for n in spec['components']}
    edges={n['id']:n for n in spec['connections']}
    expected={'select':('session','parser'),'source-retrieval':('parser','retrieval'),'context-generation':('retrieval','generation'),'generation-inspection':('generation','inspection'),'source-lookup':('parser','lookup'),'explicit-lookup':('session','lookup'),'retrieval-assets':('retrieval','preparation'),'generation-assets':('generation','preparation'),'asset-fetch':('preparation','assets')}
    if set(edges)!=set(expected) or any((edges[k]['from'],edges[k]['to'])!=v for k,v in expected.items()): raise ValueError('Graph changed: independently review visual routing')
    if set(nodes)!={'session','parser','retrieval','generation','inspection','lookup','preparation','assets'}: raise ValueError('Node contract changed')
    fingerprint=sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest()
    def text(x,y,lines,cls='v-label'):
        return f'<text x="{x}" y="{y}" class="{cls}">'+''.join(f'<tspan x="{x}" dy="{0 if i==0 else 23}">{e(line)}</tspan>' for i,line in enumerate(lines))+'</text>'
    markers = {'session':'A1','parser':'A2','retrieval':'A3','generation':'A4','inspection':'A5'}
    def node(k,y,subtitle):
        if ' '.join(subtitle) != nodes[k]['sublabel']: raise ValueError('Subtitle differs from source')
        badge = ('<circle cx="29" cy="'+str(y+22)+'" r="18" class="v-badge"/>'+text(29,y+28,[markers[k]],'v-badge-text')) if k in markers else ''
        return f'<g data-node="{k}"><rect x="45" y="{y}" width="270" height="94" rx="9" class="v-node"/>'+badge+text(180,y+31,[nodes[k]['label']],'v-node-title')+text(180,y+59,subtitle)+'</g>'
    def edge(k,path,x,y,lines):
        if " ".join(lines) != edges[k]["label"]: raise ValueError("Edge label differs from source")
        return f'<g data-edge="{k}" data-from="{edges[k]["from"]}" data-to="{edges[k]["to"]}"><path d="{path}" class="v-edge" marker-end="url(#arrow-{k})"/><defs><marker id="arrow-{k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#3155a3"/></marker></defs>'+text(x,y,lines)+'</g>'
    def ref(k,x,y,lines):
        return f'<g data-reference="{k}"><rect x="{x-76}" y="{y-24}" width="152" height="63" rx="25" class="v-port"/>'+text(x,y,lines)+'</g>'
    def panel(key,title,height,body):
        return f'<svg id="owned-panel-{key}" class="owned-panel owned-{key}" viewBox="0 0 360 {height}" role="img" aria-labelledby="owned-{key}-title"><title id="owned-{key}-title">{e(title)}</title>'+body+'</svg>'
    body=text(180,28,['A · Draft path'],'v-panel-title')
    ys=[52,221,390,559,728]
    ids=['session','parser','retrieval','generation','inspection']
    subs=[['Actions; stale work revoked'],['Native text + geometry'],['MiniLM workers; cosine rank'],['Evidence; fresh GPU worker'],['Draft/refusal; unadjudicated']]
    for k,y,sub in zip(ids,ys,subs):body+=node(k,y,sub)
    for k,y,label in zip(['select','source-retrieval','context-generation','generation-inspection'],ys,['Select PDF','Via session','Assemble; then Generate','Raw + receipt']):
        body+=edge(k,f'M180 {y+94} V{y+158}',180,y+126,[label])
    # labels sit on white backing rather than being crossed by arrow shafts.
    main=panel('draft','A. Draft path: five source responsibilities',844,body)
    body=text(180,28,['B · Explicit source-cell lookup'],'v-panel-title')
    body+=ref('session',90,85,['A1 · Session'])+ref('parser',270,85,['A2 · Parser'])
    body+=edge('explicit-lookup','M90 124 V225 H145 V252',85,166,['Explicit','fields'])
    body+=edge('source-lookup','M270 124 V225 H215 V252',276,166,['Owned','snapshot'])
    body+=node('lookup',265,['Six fields; bind or refuse'])
    lookup=panel('lookup','B. Session fields and parser snapshot converge on lookup',390,body)
    body=text(180,28,['C · Asset access'],'v-panel-title')
    body+=ref('retrieval',90,85,['A3 · Retrieval'])+ref('generation',270,85,['A4 · Context','+ Qwen'])
    body+=edge('retrieval-assets','M90 124 V218 H145 V245',85,165,['Own verified','reads'])
    body+=edge('generation-assets','M270 124 V218 H215 V245',276,165,['Own verified','reads'])
    body+=node('preparation',258,['Optional worker; shared cache'])
    body+='<path d="M15 402 H345" class="v-boundary"/>'+text(180,430,['External asset host'])
    body+=edge('asset-fetch','M180 352 V370 H26 V535 H45',105,389,['Fetch pinned files'])
    body+=node('assets',488,['Site; explicit HF preparation'])
    assets=panel('assets','C. Owned reads and external pinned assets',610,body)
    return f'<div class="owned-visual" data-source-digest="{fingerprint}"><p class="owned-boundary-label">{e(spec['boundaries'][0]['label'])}</p><div class="owned-panels">{main}{lookup}{assets}</div><p class="owned-key">Rounded ports A1–A4 in B/C refer to the same responsibilities in A; matching badges identify them. Arrows show owned relationships, not direct worker-to-worker channels. The external asset host lies below the dashed boundary in C.</p></div>'
