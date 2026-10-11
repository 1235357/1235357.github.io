import {getItemWindow} from './item-window.mjs';

// Presentation only. The session owns the immutable provenance artifact;
// windows bound DOM work, never change which evidence the context contains.
export function createContextView({document,root,isCurrent,onInspect}) {
  let rendered=null;
  const current=artifact=>artifact!==null&&rendered===artifact&&isCurrent(artifact);
  function element(tag,text,className) {
    const node=document.createElement(tag);
    if(text!==undefined)node.textContent=text;
    if(className)node.className=className;
    return node;
  }
  function evidenceCard(unit,artifact) {
    const card=element('article',undefined,'context-evidence');
    card.append(element('p',`${unit.citationId} · rank ${unit.rank} · source chunk ${unit.ordinal+1}`,'identity'),
      element('p',unit.chunkId,'identity'),
      element('p',`physical page ${unit.physicalPageNumber} · PDF label ${unit.pageLabel===null?'not supplied':JSON.stringify(unit.pageLabel)} · joined-page UTF-16 [${unit.startUtf16}, ${unit.endUtf16})`,'identity'),
      element('p',`cosine ${unit.score.toFixed(6)} · dot ${unit.dotProduct.toFixed(6)} · chunk norm ${unit.chunkNorm.toFixed(6)}`,'candidate-score'));
    const detail=element('details'),summary=element('summary','Inspect exact quote and all mapping segments');
    detail.append(summary);
    detail.addEventListener('toggle',()=>{
      detail.replaceChildren(summary);
      if(!current(artifact)||!detail.open)return;
      detail.append(element('p',unit.text,'quote'),element('p','All source and inserted presentation mapping segments','hint'),
        element('pre',JSON.stringify(unit.segments,null,2)));
    });
    const inspect=element('button',`Inspect ${unit.citationId} in retained source`);inspect.type='button';
    inspect.addEventListener('click',()=>{if(current(artifact))onInspect(unit,artifact);});
    card.append(detail,inspect);return card;
  }
  function showWindow(artifact,requestedWindow,list,navigation) {
    if(!current(artifact))return;
    const range=getItemWindow(artifact.evidenceUnits.length,requestedWindow);
    const label=element('p',`Showing evidence ${range.start+1}–${range.end} of ${range.total} · window ${range.windowIndex+1} of ${range.windowCount}`,'hint');
    label.setAttribute('role','status');label.setAttribute('aria-live','polite');
    const buttons=element('div',undefined,'item-navigation-buttons');
    for(const [name,title,destination,enabled]of [
      ['context-previous','Previous 100 evidence units',range.windowIndex-1,range.hasPrevious],
      ['context-next','Next 100 evidence units',range.windowIndex+1,range.hasNext],
    ]){
      const button=element('button',title,name);button.type='button';button.disabled=!enabled;
      button.addEventListener('click',()=>{if(current(artifact)&&enabled)showWindow(artifact,destination,list,navigation);});
      buttons.append(button);
    }
    navigation.replaceChildren(label,buttons);list.replaceChildren();list.scrollTop=0;
    for(let index=range.start;index<range.end;index++)list.append(evidenceCard(artifact.evidenceUnits[index],artifact));
  }
  return {render(artifact) {
    rendered=artifact;root.replaceChildren();
    if(artifact===null){root.append(element('p','No provenance context committed. Assemble an accepted retrieval to inspect every selected evidence unit.','empty'));return;}
    if(!current(artifact)){rendered=null;return;}
    const source=element('dl',undefined,'receipt context-receipt');
    for(const [key,value]of [['File',artifact.source.name],['Bytes',artifact.source.size],['SHA-256',artifact.source.sha256],
      ['Parser',`${artifact.parser.name} ${artifact.parser.version}`],['Parser policy',artifact.parser.policyVersion],
      ['Normalization disabled',artifact.parser.disableNormalization],['Parse worker',artifact.workerMode],['Physical pages',artifact.numPages]])
      source.append(element('dt',key),element('dd',String(value)));
    const navigation=element('nav',undefined,'item-navigation context-navigation');navigation.setAttribute('aria-label','Context evidence preview');
    const list=element('div',undefined,'context-evidence-list');
    root.append(element('p','Exact captured question','eyebrow'),element('p',artifact.question,'context-question'),source,
      element('p',`omissions: ${JSON.stringify(artifact.omissions)}`,'context-omissions'),
      element('p','All selected evidence is retained. Cards open the complete quote and mapping; windows change the preview only.','hint'),navigation,list);
    showWindow(artifact,0,list,navigation);
  }};
}
