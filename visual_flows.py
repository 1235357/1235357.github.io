"""Explicitly reviewed visual layouts. Semantic data stays in source JSON."""
from html import escape
import hashlib,json,textwrap
PINS = {'two-lifecycles': 'a8ca6df8ea22629267ee4b3405332b888772c5604e100431f55aad2f7a0e1813', 'corpus-startup': 'dafc711cb4b04ddf9012b05f011958c4a08cb859c321f6af3b74c93544b05660'}

PINS['browser-native'] = '3b7944a6edeb1ec2fca55e9883af1900ebdedcddce328e165a2df120f0ae84ea'

PINS['evidence-calculation'] = '98b72b7127be9eebf3021e5afe59f8df42fd311588613260ef900b119fd85d8b'

PINS['structured-income-selection'] = 'f16fab082fcc031842ef9ad10dbe98ad95c9dcabfa1c4814c173ef7e2c27b1bc'

def calculation_spec(source):
    import re
    if hashlib.sha256(source.encode()).hexdigest() != "c91905507141d64f4c9312ae0536d2a728b260100073ae2ba8808c6db5cd55f5":
        raise ValueError('Calculation source changed: review exact semantics')
    nodes=[];edges=[]
    for label,identity in re.findall(r'^rectangle "([^"\n]+)" as (\w+)',source,re.M):
        title,_,subtitle=label.partition('\\n');nodes.append({'id':identity,'label':title,'sublabel':subtitle})
    for line in source.splitlines():
        m=re.fullmatch(r'(\w+) (-(?:right|left)->|\.(?:down|left)\.>) (\w+)(?: : (.+))?',line)
        if m:
            a,arrow,b,label=m.groups();edges.append({'id':a+'-'+b,'from':a,'to':b,'label':label or '', 'variant':'proposed' if arrow.startswith('.') else 'implemented'})
    return {'components':nodes,'connections':edges,'original_source_sha256':hashlib.sha256(source.encode()).hexdigest()}

def source_digest(spec): return hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest()

def render_flow(spec,name):
    if source_digest(spec)!=PINS[name]: raise ValueError('Source changed: review visual layout '+name)
    ns={n['id']:n for n in spec['components']}; es={n['id']:n for n in spec['connections']}
    def tx(x,y,value,cls='vf-label',width=30):
        lines=textwrap.wrap(value,width,break_long_words=False,break_on_hyphens=False)
        return '<text class="'+cls+'" x="'+str(x)+'" y="'+str(y)+'">'+''.join('<tspan x="'+str(x)+'" dy="'+str(0 if i==0 else 22)+'">'+escape(line)+'</tspan>' for i,line in enumerate(lines))+'</text>'
    def node(k,y,x=60,w=280):
        n=ns[k];warning=' style="fill:#FFF4E5"' if name=='evidence-calculation' and k=='hold' else '';height=200 if name=='browser-native' else 160;out=f'<g data-node="{k}"><rect class="vf-node"{warning} x="{x}" y="{y}" width="{w}" height="{height}" rx="8"/>'
        if name=='browser-native' and k in ('main-thread','computation-worker'):
            out+='<circle cx="44" cy="'+str(y+27)+'" r="17" fill="#e8f1ea" stroke="#28705a"/>'+tx(44,y+33,'M' if k=='main-thread' else 'C','vf-title')
        if k=='query' and name=='structured-income-selection':out+='<circle cx="'+str(x-16)+'" cy="'+str(y+27)+'" r="17" fill="#e8f1ea" stroke="#28705a"/>'+tx(x-16,y+33,'Q','vf-title')
        if k=='index':out+='<circle cx="44" cy="'+str(y+27)+'" r="17" fill="#e8f1ea" stroke="#28705a"/>'+tx(44,y+33,'I','vf-title')
        if name=='evidence-calculation' and k in ('retrieval','review'):
            out+='<circle cx="44" cy="'+str(y+27)+'" r="17" fill="#e8f1ea" stroke="#28705a"/>'+tx(44,y+33,'R' if k=='retrieval' else 'V','vf-title')
        out+=tx(x+w/2,y+30,n['label'],'vf-title',24 if w>=270 else 19)
        out+=tx(x+w/2,y+78,n.get('sublabel',''),'vf-label',29 if w>=270 else 22)
        if n.get('tag'):out+=tx(x+w/2,y+(150 if name=='browser-native' else 122),n['tag'],'vf-tag',24 if name=='browser-native' else 30)
        return out+'</g>'
    def edge(k,d,x,y,width=24):
        edge=es[k];marker=name+'-'+k
        dash=' stroke-dasharray="7 5"' if edge.get('variant') in ('proposed','dashed') else ''
        return f'<g data-edge="{k}" data-from="{edge["from"]}" data-to="{edge["to"]}"><defs><marker id="{marker}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="#3155a3"/></marker></defs><path class="vf-edge"{dash} marker-end="url(#{marker})" d="{d}"/>'+tx(x,y,edge.get('label',''),'vf-label',width)+'</g>'
    def panel(key,title,h,body):
        return f'<svg class="flow-panel" id="flow-{name}-{key}" viewBox="0 0 400 {h}" role="img" aria-label="{escape(title,quote=True)}">'+tx(200,26,title,'vf-title',32)+body+'</svg>'
    if name=='two-lifecycles':
        a=node('chunks',55)+node('encoding',250)+node('index',445)
        a+=edge('chunks-to-encoding','M200 215 V237',200,215)+edge('encoding-to-index','M200 410 V432',200,410)
        # The I badge is attached to the actual index node, not a separate node.
        b=node('query',55)+node('ranking',340)+node('context',535)
        b+='<g data-reference="index"><rect class="vf-port" x="12" y="221" width="150" height="72" rx="30"/>'+tx(87,249,'I · shared index','vf-label',17)+'</g>'
        b+=edge('query-to-ranking','M200 215 V327',248,213)
        b+=edge('index-to-ranking','M87 293 V315 H145 V327',83,317,17)
        b+=edge('ranking-to-context','M200 500 V522',200,500)
        body=panel('prepare','Prepare corpus once',655,a)+panel('query','Each request',710,b)
    elif name=='corpus-startup':
        ys={'settings':55,'corpus':255,'snapshot':455,'application':680,'recheck':880,'listener':1080}
        body=''
        for k,y in ys.items():body+=node(k,y,140 if k=='snapshot' else 80,240 if k=='snapshot' else 280)
        for k,a,b in [('settings-corpus','settings','corpus'),('corpus-snapshot','corpus','snapshot'),('snapshot-app','snapshot','application'),('app-recheck','application','recheck'),('recheck-listener','recheck','listener')]:
            x1=260 if a=='snapshot' else 220;x2=260 if b=='snapshot' else 220;y1=ys[a]+160;y2=ys[b]-12
            body+=edge(k,f'M{x1} {y1} V{y1+22} H{x2} V{y2}',230,y1+22,22)
        body+=edge('corpus-app-without-index','M80 315 H25 V744 H67',72,610,10)
        body=panel('startup','Startup before listening',1280,body)
    elif name=='structured-income-selection':
        a=node('pdfs',55)+node('builder',275)+node('index',495)
        a+=edge('source-read','M200 215 V263',200,242)+edge('cells-built','M200 435 V483',200,463)
        a=panel('cells','Build source-bound cells',695,a)
        b=node('query',55,160,220)+node('parser',345)+node('selector',590)+node('outcome',810)
        b+='<g data-reference="index"><rect class="vf-port" x="12" y="85" width="120" height="72" rx="25"/>'+tx(72,113,'I · source cells','vf-label',14)+'</g>'
        b+=edge('literal-input','M270 215 V333',270,268,18)
        b+=edge('row-vocabulary','M72 157 V300 H140 V333',72,240,13)
        b+=edge('exact-cells','M12 120 H7 V670 H47',35,545,8)
        b+=edge('parsed-fields','M200 505 V578',200,545)+edge('result','M200 750 V798',200,777)
        b=panel('select','Select an exact field',1010,b)
        c='<g data-reference="query"><rect class="vf-port" x="75" y="55" width="250" height="64" rx="25"/>'+tx(200,93,'Q · Original question')+'</g>'
        c+=node('dense',205)+node('dense_trace',425)
        c+=edge('baseline-input','M200 119 V193',200,159)+edge('baseline-trace','M200 365 V413',200,393)
        c=panel('baseline','Separate dense comparison',625,c)
        body=a+b+c
    elif name=='evidence-calculation':
        a=node('report',55)+node('extraction',270)+node('retrieval',485)
        a+=edge('report-extraction','M200 215 V258',200,242)+edge('extraction-retrieval','M200 430 V473',200,458)
        b='<g data-reference="retrieval"><rect class="vf-port" x="70" y="55" width="260" height="64" rx="25"/>'+tx(200,93,'R · Retrieved candidates')+'</g>'
        b+=node('review',210)+node('accepted',450)+node('calculate',690)
        b+=edge('retrieval-review','M200 119 V198',200,165)+edge('review-accepted','M200 370 V438',200,410)+edge('accepted-calculate','M200 610 V678',200,650)
        c='<g data-reference="review"><rect class="vf-port" x="70" y="55" width="260" height="64" rx="25"/>'+tx(200,93,'V · Review source')+'</g>'+node('hold',230)
        c+=edge('review-hold','M200 119 V218',200,175)
        body=panel('document','Implemented document path',685,a)+panel('proposed','Proposed acceptance path',890,b)+panel('withhold','Alternative: unresolved',430,c)
        body+='<p class="visual-legend">Solid arrows: implemented document path. Dashed arrows: proposed review and calculation. R and V refer to the same retrieval and review shown in the preceding panels. The unresolved branch is an alternative to accepting a row, not a step after calculation. No implemented SQL agent or verified calculation service is claimed.</p>'
    elif name=='browser-native':
        a=node('reader-input',55)+node('main-thread',315)+node('pdf-worker',575)+node('computation-worker',835)
        a+=edge('select-source','M200 255 V303',200,282)+edge('parse-selected-bytes','M200 515 V563',200,542)+edge('parsed-document','M200 775 V823',200,802)
        def port(k,y,label):
            return '<g data-reference="'+k+'"><rect class="vf-port" x="65" y="'+str(y)+'" width="270" height="80" rx="25"/>'+tx(200,y+35,label)+'</g>'
        b=port('main-thread',75,'M · Main thread')+port('computation-worker',335,'C · Compute worker')
        b+=edge('ask-or-cancel','M145 155 V323',128,225,16)+edge('computed-outcome','M335 375 H375 V115 H347',326,260,13)
        c=node('model-assets',55)+port('computation-worker',355,'C · Compute worker')+node('model-cache',535)
        c+=edge('download-model-assets','M200 255 V343',200,302)+edge('owned-model-cache','M200 435 V523',200,476,23)
        body='<p class="visual-legend"><strong>Historical October 7 design · NOT IMPLEMENTED at that checkpoint.</strong> These panels reproduce the source design, not evidence of current runtime behavior. M and C reference the same main thread and computation worker. Spans travel via the main-thread proxy, not directly between workers.</p>'
        body+=panel('source','Planned document lineage',1075,a)+panel('control','Request and return',465,b)+panel('models','Models, not uploaded documents',775,c)
    else:raise ValueError('Unsupported reviewed flow')
    return '<div class="visual-flow visual-'+name+'" data-source-digest="'+source_digest(spec)+'">'+body+'</div>'
