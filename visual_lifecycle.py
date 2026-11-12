"""Source-locked lifecycle small multiples, including every return edge."""
from html import escape as e
import hashlib,json,textwrap
PIN='5fdb4fbdf439903cd131b2697da5a0405de26522312502b0de6f34fd586e5d08'
def render_lifecycle(spec):
 if hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest()!=PIN:raise ValueError('Lifecycle source changed; review all return/alternative paths')
 nodes={x['id']:x for x in spec['states']};edges={x['id']:x for x in spec['transitions']};lanes={x['id']:x['label'] for x in spec['lanes']}
 def tx(x,y,text,cls='vf-label',width=29):
  return f'<text x="{x}" y="{y}" class="{cls}">'+''.join(f'<tspan x="{x}" dy="{0 if i==0 else 22}">{e(s)}</tspan>' for i,s in enumerate(textwrap.wrap(text,width)))+'</text>'
 def node(k,y):
  n=nodes[k];shape=f'<rect class="vf-node" x="80" y="{y}" width="280" height="128" rx="{0 if k=="gate" else 9}"/>'
  return f'<g data-node="{k}">'+shape+tx(220,y+30,n['label'],'vf-title')+tx(220,y+66,n['sublabel'])+tx(220,y+110,n['tag'])+'</g>'
 def ref(k,y):
  label=('A · Active' if k=='active' else 'G · Validate Message')
  return f'<g data-reference="{k}"><rect class="vf-port" x="95" y="{y}" width="250" height="64" rx="30"/>'+tx(220,y+38,label)+'</g>'
 def edge(k,path,x,y,width=25):
  d=edges[k];marker='life-'+k
  return f'<g data-edge="{k}" data-from="{d["from"]}" data-to="{d["to"]}"><defs><marker id="{marker}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="#3155a3"/></marker></defs><path class="vf-edge" marker-end="url(#{marker})" d="{path}"/>'+tx(x,y,d['label'],width=width)+'</g>'
 def panel(k,title,h,body):return f'<svg id="flow-lifecycle-{k}" class="flow-panel" viewBox="0 0 400 {h}" role="img" aria-label="{e(title,quote=True)}">'+tx(200,28,title,'vf-title')+body+'</svg>'
 a=node('idle',65)+node('active',270)+node('gate',475)
 a+=tx(62,300,'A','vf-title')+tx(62,505,'G','vf-title')
 a+=edge('begin','M220 193 V258',220,227)+edge('receive','M220 398 V463',220,432)
 a+=edge('progress','M80 540 H25 V334 H67',63,426,9)
 a=panel('active',lanes['main'],635,a)
 b=ref('gate',65)+node('rejected',210)+ref('active',430)
 b+=edge('reject','M220 129 V198',220,168)+edge('preserve','M220 338 V418',220,381)
 b=panel('rejected',lanes['checks'],530,b)
 c=ref('active',65)+node('local_cancel',210)+ref('active',430)
 c+=edge('cancel','M220 129 V198',220,168)+edge('next_after_cancel','M220 338 V418',220,381)
 c=panel('cancel','Alternative: cancel / replace',530,c)
 d=ref('gate',65)+node('message_terminal',210)+ref('active',430)
 d+=edge('terminal_accept','M220 129 V198',220,168)+edge('next_after_message','M220 338 V418',220,381)
 d=panel('terminal','Alternative: accept terminal',530,d)
 return '<div class="visual-flow lifecycle-visual">'+a+b+c+d+'</div><p class="owned-key">A and G reference the same Active state and Validate Message check. '+e(lanes['terminal'])+'. Cancellation is an alternative from Active, not a step after accepting a terminal.</p>'
