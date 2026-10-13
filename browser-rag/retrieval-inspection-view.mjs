import {createRetrievalInspection} from './retrieval-inspection.mjs';
import {createCompleteRecordDisclosure} from './complete-record-disclosure.mjs';

const RANK_WINDOW=50,COMPONENT_WINDOW=64;
const descendants=node=>[node,...Array.from(node.childNodes??node.children??[]).flatMap(descendants)];
const concise=value=>Number(value).toPrecision(8);

// Native disclosure is immediate; bounded tables reveal accepted computation,
// never run an encoder or add events to the worker's historical receipt.
export function createRetrievalInspectionView({document,root,read,isCurrent,onInspect,textView}){
  let rendered=null;
  const local=(owner,part)=>rendered===owner&&!owner.retired&&(part===undefined||owner.active!==null&&owner.node.open&&!part.retired);
  function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  function scrub(captured){for(const node of captured){
    if('disabled' in node)node.disabled=true;if('value' in node)node.value='';
    node.removeAttribute?.('href');node.removeAttribute?.('download');node.textContent='';
  }}
  function release(part){
    if(!part||part.retired)return;
    const captured=part.nodes.flatMap(descendants),parts=part.parts,entries=part.entries,listeners=part.listeners;
    part.retired=true;part.nodes=[];part.parts=[];part.entries=[];part.listeners=[];
    for(const [node,type,handler]of listeners)node.removeEventListener(type,handler);
    try{for(const nested of parts)release(nested);for(const entry of entries)entry.dispose();}finally{scrub(captured);}
  }
  const part=()=>({retired:false,nodes:[],parts:[],entries:[],listeners:[]});
  function retireOwner(owner){
    if(!owner||owner.retired)return;
    const captured=descendants(owner.node),previous=owner.active;
    owner.retired=true;owner.active=null;owner.node.open=false;
    owner.node.removeEventListener('toggle',owner.toggle);owner.node.replaceChildren();
    try{release(previous);}finally{scrub(captured);}
  }
  function revoke(){const previous=rendered;rendered=null;root.replaceChildren();retireOwner(previous);}
  function current(owner,scope){
    if(!local(owner,scope))return false;
    let accepted=false;try{accepted=isCurrent(owner.binding)===true;}catch{/* Private ownership diagnostics are never rendered. */}
    if(!local(owner,scope))return false;
    if(!accepted){revoke();return false;}return true;
  }
  function listen(scope,node,type,handler){node.addEventListener(type,handler);scope.listeners.push([node,type,handler]);}
  function addRecord(owner,scope,host,title,record,filename){
    const entry=createCompleteRecordDisclosure({document,title,read:()=>record,current:()=>current(owner,scope),filename,textView});
    scope.entries.push(entry);host.append(entry.node);
  }
  function table(caption,headings,className){
    const scroll=element('div',undefined,'retrieval-table-scroll');scroll.tabIndex=0;
    scroll.setAttribute('role','region');scroll.setAttribute('aria-label',caption);
    const value=element('table',undefined,`retrieval-table ${className}`),head=element('thead'),row=element('tr'),body=element('tbody');
    value.append(element('caption',caption));
    for(const title of headings){const cell=element('th',title);cell.setAttribute('scope','col');row.append(cell);}
    head.append(row);value.append(head,body);scroll.append(value);return {scroll,body};
  }
  function navigation(owner,scope,host,total,index,size,label,previousTitle,nextTitle,go){
    const count=Math.ceil(total/size),start=index*size,end=Math.min(total,start+size);
    const range=element('p',`Showing ${label} ${start+1}–${end} of ${total} · window ${index+1} of ${count}`,'retrieval-range');
    range.setAttribute('role','status');range.setAttribute('aria-live','polite');
    const buttons=element('div',undefined,'item-navigation-buttons');
    for(const [title,destination,enabled]of count>1?[[previousTitle,index-1,index>0],[nextTitle,index+1,index+1<count]]:[]){
      const button=element('button',title);button.type='button';button.disabled=!enabled;
      listen(scope,button,'click',()=>{if(enabled&&current(owner,scope))go(destination);});buttons.append(button);
    }
    host.append(range);if(count>1)host.append(buttons);return {start,end};
  }
  function componentWindow(owner,record,selection,index){
    if(!current(owner,selection)||record.selection!==selection)return;
    const previous=selection.window,window=part();selection.window=window;selection.parts=[window];
    selection.windowHost.replaceChildren();release(previous);if(!current(owner,window)||selection.retired)return;
    const nav=element('nav'),values=selection.values;
    nav.setAttribute('aria-label','Vector component calculation pages');
    const {start,end}=navigation(owner,window,nav,values.components.length,index,COMPONENT_WINDOW,'dimensions',
      'Previous 64 dimensions','Next 64 dimensions',destination=>componentWindow(owner,record,selection,destination));
    const {scroll,body}=table('Exact component products and cumulative dot product',
      ['Dimension','Query qᵢ','Passage pᵢ','Product qᵢ × pᵢ','Cumulative dot'],'retrieval-components');
    for(let i=start;i<end;i++){
      const value=values.components[i],row=element('tr');
      for(const number of [value.dimension,value.queryValue,value.passageValue,value.product,value.cumulativeDot])row.append(element('td',String(number)));
      body.append(row);
    }
    window.nodes=[nav,scroll];if(!current(owner,window)||selection.retired){release(window);return;}
    selection.windowHost.append(...window.nodes);
  }
  function choose(owner,record,ordinal){
    if(!current(owner,record))return;
    const previous=record.selection,selection=part();record.selection=selection;
    record.componentHost.replaceChildren();release(previous);if(!current(owner,selection))return;
    const values=record.inspection.components(ordinal);selection.values=values;
    const heading=element('h3',`Calculate chunk ${ordinal+1} · rank ${values.rank}`),identity=element('p',
      `${values.chunkId} · physical page ${values.physicalPageNumber} · PDF label ${values.pageLabel===null?'not supplied':JSON.stringify(values.pageLabel)}`,'identity');
    const formula=element('p',`${String(values.dotProduct)} ÷ (${String(values.queryNorm)} × ${String(values.chunkNorm)}) = ${String(values.score)}`,'retrieval-formula');
    const scalars=element('dl',undefined,'retrieval-scalars');
    for(const [key,value]of [['Query sum of squares',values.querySquared],['Passage sum of squares',values.passageSquared],
      ['Query norm',values.queryNorm],['Passage norm',values.chunkNorm],['Norm product',values.denominator],['Dot product',values.dotProduct],['Cosine',values.score]])
      scalars.append(element('dt',key),element('dd',String(value)));
    const note=element('p','Each row multiplies the same model coordinate in the query and passage. Coordinates have no individual semantic labels. The final cumulative dot equals the accepted scalar; the table recomputes retained vectors and is not a new inference or worker timing trace.','retrieval-note');
    const exportHost=element('div'),windowHost=element('div');selection.windowHost=windowHost;
    addRecord(owner,selection,exportHost,'Complete 384-component calculation JSON',values,`chunk-${ordinal+1}-cosine-calculation.json`);
    const inspect=element('button',`Inspect chunk ${ordinal+1} in retained source`);inspect.type='button';
    listen(selection,inspect,'click',()=>{if(current(owner,selection)&&record.selection===selection)onInspect(values,owner.binding);});
    selection.nodes=[heading,identity,formula,scalars,note,inspect,exportHost,windowHost];record.parts=[record.rankWindow,selection].filter(Boolean);
    if(!current(owner,selection)){release(selection);return;}
    record.componentHost.append(...selection.nodes);componentWindow(owner,record,selection,0);
  }
  function rankWindow(owner,record,index){
    if(!current(owner,record))return;
    const previous=record.rankWindow,oldSelection=record.selection,window=part();record.rankWindow=window;record.selection=null;record.parts=[window];
    record.rankHost.replaceChildren();record.componentHost.replaceChildren();release(previous);release(oldSelection);
    if(!current(owner,window))return;
    const nav=element('nav');nav.setAttribute('aria-label','All passage similarity pages');
    const rows=record.inspection.record.rankedChunks;
    const {start,end}=navigation(owner,window,nav,rows.length,index,RANK_WINDOW,'ranked chunks',
      'Previous 50 ranked chunks','Next 50 ranked chunks',destination=>rankWindow(owner,record,destination));
    const {scroll,body}=table('All retained passages ranked by exact cosine similarity',
      ['Rank','Source chunk / page','Selection','Cosine −1 to +1','Calculation'],'retrieval-ranking');
    for(let index=start;index<end;index++){
      const value=rows[index],row=element('tr');row.className=value.selected?'retrieval-selected':'retrieval-unselected';
      if(index===record.inspection.record.returnedCount)row.className+=' retrieval-boundary';
      const identity=element('td');identity.append(element('span',`Chunk ${value.ordinal+1} · physical page ${value.physicalPageNumber}`),
        element('span',`PDF label ${value.pageLabel===null?'not supplied':JSON.stringify(value.pageLabel)}`,'identity'));
      const score=element('td'),track=element('div',undefined,'retrieval-score-track'),bar=element('span',undefined,
        `retrieval-score-bar ${value.score<0?'retrieval-score-negative':'retrieval-score-positive'}`);
      track.setAttribute('role','img');track.setAttribute('aria-label',`Chunk ${value.ordinal+1} cosine ${String(value.score)}, zero-centered range minus one to plus one`);
      const visual=Math.max(-1,Math.min(1,value.score));bar.setAttribute('data-signed-score',String(visual));
      if(bar.style)bar.style.width=`${Math.abs(visual)*50}%`;track.append(bar);
      const scale=element('div',undefined,'retrieval-score-scale');scale.setAttribute('aria-hidden','true');
      for(const label of ['−1','0','+1'])scale.append(element('span',label));
      score.append(element('span',concise(value.score),'retrieval-score-number'),track,scale);
      const action=element('td'),button=element('button',`Calculate chunk ${value.ordinal+1}`);button.type='button';
      listen(window,button,'click',()=>{if(current(owner,window))choose(owner,record,value.ordinal);});action.append(button);
      row.append(element('td',String(value.rank)),identity,element('td',value.selected?'Selected for context':'Outside Top K'),score,action);body.append(row);
    }
    window.nodes=[nav,scroll];if(!current(owner,window)){release(window);return;}record.rankHost.append(...window.nodes);
  }
  function open(owner){
    const attempt=++owner.revision,previous=owner.active;owner.active=null;owner.node.replaceChildren(owner.summary);release(previous);
    if(!local(owner)||!owner.node.open||owner.revision!==attempt)return;
    const record=part();record.body=element('div',undefined,'retrieval-inspection-body');record.nodes=[record.body];owner.active=record;
    const owns=()=>current(owner,record)&&owner.node.open&&owner.revision===attempt&&owner.active===record;
    if(!owns())return;
    try{
      const input=read(owner.binding);if(!owns())return;
      record.inspection=createRetrievalInspection(input);if(!owns())return;
      const value=record.inspection.record,caption=element('p',
        `Ranked ${value.chunkCount} retained chunks · selected ${value.returnedCount} · requested Top K ${value.requestedTopK}. Equal cosine values use source chunk order.`,'retrieval-overview');
      const note=element('p','Post-acceptance inspection: these scores are recomputed from retained query and passage vectors and checked exactly against the accepted selection. No model runs again. Similarity ranks candidates; it does not prove that a passage answers the question.','retrieval-note');
      const source=element('p',`${value.source.name} · SHA-256 ${value.source.sha256}`,'identity');
      const legend=element('p','Cosine: −1 opposite direction · 0 perpendicular · +1 same direction. The bar shows the signed numeric range; it is not an answer confidence percentage.','retrieval-note');
      const exportHost=element('div');addRecord(owner,record,exportHost,'Complete ranked passage scores JSON',value,'retrieval-ranked-scores.json');
      record.rankHost=element('div');record.componentHost=element('section',undefined,'retrieval-calculation');
      record.componentHost.setAttribute('aria-label','Selected passage cosine calculation');
      record.body.append(caption,note,source,legend,exportHost,record.rankHost,record.componentHost);
      if(!owns()){release(record);return;}owner.node.append(record.body);rankWindow(owner,record,0);
    }catch{
      if(!owns())return;
      owner.active=null;owner.node.replaceChildren(owner.summary);release(record);
      if(!local(owner)||owner.revision!==attempt||!owner.node.open)return;
      const error=part(),message=element('p','INVALID_RETRIEVAL_INSPECTION · The retained artifacts do not agree. No calculated inspection is displayed.','retrieval-note');
      error.nodes=[message];owner.active=error;if(current(owner,error))owner.node.append(message);
    }
  }
  return Object.freeze({revoke,render(binding){
    const previous=rendered,owner={binding,node:element('details',undefined,'retrieval-inspection'),summary:element('summary','Inspect how similarity selects passages'),active:null,retired:false,revision:0,toggle:null};
    rendered=owner;root.replaceChildren();retireOwner(previous);if(!current(owner))return;
    owner.toggle=()=>{if(local(owner))open(owner);else owner.node.open=false;};owner.node.addEventListener('toggle',owner.toggle);
    owner.node.append(owner.summary);root.append(owner.node);
  }});
}
