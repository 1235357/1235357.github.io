import {copyFinancialGeometrySource,GEOMETRY_CAPTURE_PROFILE,GeometrySourceError} from './financial-geometry-source.mjs';
import {createBoundedTextView} from './bounded-text-view.mjs';

async function sha256(bytes){
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
// Private configured presentation. No parser, model, table binder or lookup.
export function createFinancialGeometryView({document,root,digest=sha256,textView=createBoundedTextView}){
  const section=document.createElement('section');section.className='geometry-capture';root.append(section);
  let owner=null,attempt=0,activeRecord=null;
  const descendants=node=>[node,...Array.from(node.childNodes??node.children??[]).flatMap(descendants)];
  function scrub(captured){for(const node of captured){if('disabled' in node)node.disabled=true;node.removeAttribute?.('href');node.removeAttribute?.('download');node.textContent='';}}
  function release(record){
    if(!record)return;
    const captured=descendants(record.body),viewer=record.viewer;record.retired=true;record.viewer=null;
    if(activeRecord===record)activeRecord=null;
    try{viewer?.dispose?.();}catch{/* Cleanup diagnostics do not enter the presentation. */}finally{scrub(captured);}
  }
  function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  return {render({source,documentEpoch,active,cancelled}){
    const capturedOwner=Object.freeze({source,documentEpoch,active,cancelled}),previous=activeRecord;
    const oldNodes=Array.from(section.children??[]).flatMap(descendants);
    owner=capturedOwner;attempt++;activeRecord=null;release(previous);scrub(oldNodes);
    if(owner!==capturedOwner)return;section.replaceChildren();
    section.append(element('h2','PDF.js geometry source snapshot'),
      element('p','Complete retained PDF.js page/item geometry, exact parser strings and UTF-16 spans. Item extents are not glyph boxes. No table relationship or answer is established; normalized currency is unset and currency glyphs remain literal source text.','hint'));
    if(source===null||active||cancelled){section.append(element('p',source===null?'No owned parsed source. Select a PDF first.':active?'Capture is unavailable during active session work.':'Capture ownership was revoked. Start a new explicit source action before capture.','empty'));return;}
    const detail=element('details'),summary=element('summary','Complete owned PDF.js geometry snapshot · capture only');detail.append(summary);section.append(detail);
    const owns=()=>owner===capturedOwner&&owner.source===source&&owner.documentEpoch===documentEpoch
      &&!owner.active&&!owner.cancelled;
    detail.addEventListener('toggle',()=>{
      if(!owns())return;
      const id=++attempt,previous=activeRecord,oldNodes=Array.from(detail.children??[]).filter(node=>node!==summary).flatMap(descendants);
      activeRecord=null;release(previous);scrub(oldNodes);
      if(!owns()||attempt!==id)return;detail.replaceChildren(summary);
      if(!detail.open)return;
      const record={body:element('div'),viewer:null,retired:false};activeRecord=record;detail.append(record.body);
      const openAt=()=>owns()&&attempt===id&&detail.open;
      const current=()=>openAt()&&activeRecord===record&&!record.retired;
      const cancel=element('button','Cancel geometry capture');cancel.type='button';
      cancel.addEventListener('click',()=>{if(current()){
        const cancelledAttempt=++attempt;release(record);
        if(owns()&&attempt===cancelledAttempt)detail.replaceChildren(summary,element('p','Capture cancelled. Close and reopen this disclosure for an explicit retry.','hint'));
      }});
      record.body.append(element('p','Validating the complete retained source and hashing the explicit snapshot.','hint'),cancel);
      void(async()=>{
        try{
          const snapshot=copyFinancialGeometrySource(source);if(!current())return;
          const text=JSON.stringify(snapshot,null,2);if(!current())return;
          const bytes=new TextEncoder().encode(text),hash=await digest(bytes);if(!current())return;
          if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error();
          record.body.replaceChildren(
            element('p',`${GEOMETRY_CAPTURE_PROFILE} · document epoch ${documentEpoch} · parse worker ${snapshot.workerMode} · ${bytes.length.toLocaleString()} UTF-8 bytes · SHA-256 ${hash}`,'identity'),
            element('p','Digest covers the complete JSON, available in consecutive text pages and as an exact UTF-8 download without a trailing newline. It identifies this capture; it does not authenticate PDF origin or parent-page lineage. The text/span projection was independently validated. All pages and items, including whitespace and zero-area items, remain present.','hint'));
          const viewer=textView({document,root:record.body,text,current,filename:'pdfjs-geometry-snapshot.json'});record.viewer=viewer;
          if(!current()){release(record);return;}
          if(typeof viewer?.dispose!=='function')throw Error();
        }catch(error){release(record);if(openAt())detail.replaceChildren(summary,element('p',error instanceof GeometrySourceError?`${error.code} · ${error.message}`:'GEOMETRY_CAPTURE_FAILED · The snapshot could not be captured safely.','generation-refusal'));}
      })();
    });
  }};
}
