import {getItemWindow} from './item-window.mjs';
import {createCompleteRecordDisclosure} from './complete-record-disclosure.mjs';

const descendants=node=>[node,...Array.from(node.childNodes??node.children??[]).flatMap(descendants)];

// Presentation only. The session owns the immutable provenance artifact;
// windows bound DOM work, never change which evidence the context contains.
export function createContextView({document,root,isCurrent,onInspect,textView}) {
  let rendered=null;
  const local=(owner,window)=>owner!==null&&rendered===owner&&!owner.retired
    &&(window===undefined||owner.window===window&&!window.retired);
  function scrub(captured){
    for(const node of captured){
      if('disabled' in node)node.disabled=true;
      if('value' in node)node.value='';
      node.removeAttribute?.('href');node.removeAttribute?.('download');node.textContent='';
    }
  }
  function releaseWindow(window){
    if(!window||window.retired)return;
    const captured=window.nodes.flatMap(descendants),cards=window.cards,listeners=window.listeners;
    window.retired=true;window.nodes=[];window.cards=[];window.listeners=[];
    for(const [node,type,listener]of listeners)node.removeEventListener(type,listener);
    try{for(const card of cards)card.dispose();}finally{scrub(captured);}
  }
  function releaseRender(owner){
    if(!owner||owner.retired)return;
    // Capture old nodes before a nested viewer disposer can render a new owner.
    const captured=owner.nodes.flatMap(descendants),window=owner.window;
    owner.retired=true;owner.window=null;owner.nodes=[];
    try{releaseWindow(window);}finally{scrub(captured);}
  }
  function revoke(){
    const previous=rendered;rendered=null;root.replaceChildren();releaseRender(previous);
  }
  function current(owner,window,owns=()=>true){
    // The external predicate can synchronously render or change a window.
    if(!local(owner,window)||!owns())return false;
    let accepted=false;try{accepted=isCurrent(owner.artifact)===true;}catch{/* Owner diagnostics never enter the presentation. */}
    if(!local(owner,window)||!owns())return false;
    if(!accepted){revoke();return false;}return true;
  }
  function element(tag,text,className) {
    const node=document.createElement(tag);
    if(text!==undefined)node.textContent=text;
    if(className)node.className=className;
    return node;
  }
  function evidenceCard(unit,owner,window) {
    const card=element('article',undefined,'context-evidence');
    card.append(element('p',`${unit.citationId} · rank ${unit.rank} · source chunk ${unit.ordinal+1}`,'identity'),
      element('p',unit.chunkId,'identity'),
      element('p',`physical page ${unit.physicalPageNumber} · PDF label ${unit.pageLabel===null?'not supplied':JSON.stringify(unit.pageLabel)} · joined-page UTF-16 [${unit.startUtf16}, ${unit.endUtf16})`,'identity'),
      element('p',`cosine ${unit.score.toFixed(6)} · dot ${unit.dotProduct.toFixed(6)} · chunk norm ${unit.chunkNorm.toFixed(6)}`,'candidate-score'));
    const detail=element('details'),summary=element('summary','Inspect exact quote and all mapping segments');
    detail.append(summary);
    let alive=true,revision=0,active=null;
    const openAt=attempt=>alive&&detail.open===true&&revision===attempt;
    const owns=record=>openAt(record.revision)&&active===record&&!record.retired;
    const owned=record=>current(owner,window,()=>owns(record));
    function release(record){
      if(!record||record.retired)return;
      const captured=descendants(record.body),disclosures=record.disclosures;
      record.retired=true;record.disclosures=[];
      if(active===record){active=null;detail.replaceChildren(...(alive?[summary]:[]));}
      try{for(const disclosure of disclosures)disclosure.dispose();}finally{scrub(captured);}
    }
    function toggle(){
      if(!alive){detail.open=false;return;}
      const attempt=++revision,previous=active;active=null;
      detail.replaceChildren(summary);release(previous);
      if(!openAt(attempt))return;
      const record={revision:attempt,body:element('div'),disclosures:[],retired:false};active=record;
      if(!owned(record)){release(record);return;}
      record.body.append(element('p',unit.text,'quote'),element('p','All source and inserted presentation mapping segments','hint'));
      for(const [title,read,filename]of [
        ['Complete mapping segments JSON',()=>unit.segments,`evidence-${unit.rank}-mapping.json`],
        ['Complete evidence unit JSON',()=>unit,`evidence-${unit.rank}-record.json`],
      ]){
        const disclosure=createCompleteRecordDisclosure({document,title,read,current:()=>owned(record),filename,textView});
        record.disclosures.push(disclosure);record.body.append(disclosure.node);
      }
      if(!owned(record)){release(record);return;}
      detail.append(record.body);
    }
    detail.addEventListener('toggle',toggle);
    const inspect=element('button',`Inspect ${unit.citationId} in retained source`);inspect.type='button';
    const inspectClick=()=>{if(alive&&current(owner,window))onInspect(unit,owner.artifact);};
    inspect.addEventListener('click',inspectClick);card.append(detail,inspect);
    return {node:card,dispose(){
      if(!alive)return;
      const captured=descendants(card),previous=active;
      alive=false;revision++;active=null;detail.open=false;
      detail.removeEventListener('toggle',toggle);inspect.removeEventListener('click',inspectClick);card.replaceChildren();
      try{release(previous);}finally{scrub(captured);}
    }};
  }
  function showWindow(owner,requestedWindow,list,navigation,expectedWindow) {
    if(!local(owner)||owner.window!==expectedWindow)return;
    // Every visit is a distinct owner, including returning to the same index.
    const previous=owner.window,window={retired:false,nodes:[],cards:[],listeners:[]};owner.window=window;
    navigation.replaceChildren();list.replaceChildren();releaseWindow(previous);
    if(!current(owner,window))return;
    const artifact=owner.artifact;
    const range=getItemWindow(artifact.evidenceUnits.length,requestedWindow);
    const label=element('p',`Showing evidence ${range.start+1}–${range.end} of ${range.total} · window ${range.windowIndex+1} of ${range.windowCount}`,'hint');
    label.setAttribute('role','status');label.setAttribute('aria-live','polite');
    const buttons=element('div',undefined,'item-navigation-buttons');
    for(const [name,title,destination,enabled]of [
      ['context-previous','Previous 100 evidence units',range.windowIndex-1,range.hasPrevious],
      ['context-next','Next 100 evidence units',range.windowIndex+1,range.hasNext],
    ]){
      const button=element('button',title,name);button.type='button';button.disabled=!enabled;
      const click=()=>{if(current(owner,window)&&enabled)showWindow(owner,destination,list,navigation,window);};
      button.addEventListener('click',click);window.listeners.push([button,'click',click]);
      buttons.append(button);
    }
    for(let index=range.start;index<range.end;index++)window.cards.push(evidenceCard(artifact.evidenceUnits[index],owner,window));
    window.nodes=[label,buttons,...window.cards.map(card=>card.node)];
    if(!current(owner,window)){releaseWindow(window);return;}
    navigation.append(label,buttons);list.scrollTop=0;list.append(...window.cards.map(card=>card.node));
  }
  return {revoke,render(artifact) {
    const previous=rendered,owner={artifact,retired:false,window:null,nodes:[]};rendered=owner;
    root.replaceChildren();releaseRender(previous);
    if(!local(owner))return;
    if(artifact===null){owner.nodes=[element('p','No provenance context committed. Assemble an accepted retrieval to inspect every selected evidence unit.','empty')];root.append(...owner.nodes);return;}
    if(!current(owner))return;
    const source=element('dl',undefined,'receipt context-receipt');
    for(const [key,value]of [['File',artifact.source.name],['Bytes',artifact.source.size],['SHA-256',artifact.source.sha256],
      ['Parser',`${artifact.parser.name} ${artifact.parser.version}`],['Parser policy',artifact.parser.policyVersion],
      ['Normalization disabled',artifact.parser.disableNormalization],['Parse worker',artifact.workerMode],['Physical pages',artifact.numPages]])
      source.append(element('dt',key),element('dd',String(value)));
    const navigation=element('nav',undefined,'item-navigation context-navigation');navigation.setAttribute('aria-label','Context evidence preview');
    const list=element('div',undefined,'context-evidence-list');
    owner.nodes=[element('p','Exact captured question','eyebrow'),element('p',artifact.question,'context-question'),source,
      element('p',`omissions: ${JSON.stringify(artifact.omissions)}`,'context-omissions'),
      element('p','All selected evidence is retained. Cards open the complete quote, mapping and evidence record; windows change the preview only.','hint'),navigation,list];
    if(!current(owner))return;
    root.append(...owner.nodes);showWindow(owner,0,list,navigation,null);
  }};
}
