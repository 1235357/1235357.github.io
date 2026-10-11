import {copyFinancialGeometrySource,GEOMETRY_CAPTURE_PROFILE,GeometrySourceError} from './financial-geometry-source.mjs';

async function sha256(bytes){
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
// Private configured presentation. No parser, model, table binder or lookup.
export function createFinancialGeometryView({document,root,digest=sha256}){
  const section=document.createElement('section');section.className='geometry-capture';root.append(section);
  let owner=null,attempt=0;
  function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  return {render({source,documentEpoch,active,cancelled}){
    owner=Object.freeze({source,documentEpoch,active,cancelled});attempt++;section.replaceChildren();
    section.append(element('h2','PDF.js geometry source snapshot'),
      element('p','Complete retained PDF.js page/item geometry, exact parser strings and UTF-16 spans. Item extents are not glyph boxes. No table relationship or answer is established; normalized currency is unset and currency glyphs remain literal source text.','hint'));
    if(source===null||active||cancelled){section.append(element('p',source===null?'No owned parsed source. Select a PDF first.':active?'Capture is unavailable during active session work.':'Capture ownership was revoked. Start a new explicit source action before capture.','empty'));return;}
    const capturedOwner=owner,detail=element('details'),summary=element('summary','Complete owned PDF.js geometry snapshot · capture only');detail.append(summary);section.append(detail);
    const owns=()=>owner===capturedOwner&&owner.source===source&&owner.documentEpoch===documentEpoch
      &&!owner.active&&!owner.cancelled;
    const current=id=>owns()&&attempt===id&&detail.open;
    detail.addEventListener('toggle',()=>{
      detail.replaceChildren(summary);if(!owns())return;
      const id=++attempt;
      if(!current(id))return;
      const cancel=element('button','Cancel geometry capture');cancel.type='button';
      cancel.addEventListener('click',()=>{if(current(id)){attempt++;detail.replaceChildren(summary,element('p','Capture cancelled. Close and reopen this disclosure for an explicit retry.','hint'));}});
      detail.append(element('p','Validating the complete retained source and hashing the explicit snapshot.','hint'),cancel);
      void(async()=>{
        try{
          const snapshot=copyFinancialGeometrySource(source);if(!current(id))return;
          const text=JSON.stringify(snapshot,null,2);if(!current(id))return;
          const bytes=new TextEncoder().encode(text),hash=await digest(bytes);if(!current(id))return;
          if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error();
          detail.replaceChildren(summary,
            element('p',`${GEOMETRY_CAPTURE_PROFILE} · document epoch ${documentEpoch} · parse worker ${snapshot.workerMode} · ${bytes.length.toLocaleString()} UTF-8 bytes · SHA-256 ${hash}`,'identity'),
            element('p','Digest covers exactly the UTF-8 bytes of the JSON displayed below, without a trailing newline. It identifies this capture; it does not authenticate PDF origin or parent-page lineage. The text/span projection was independently validated. All pages and items, including whitespace and zero-area items, remain present.','hint'),
            element('pre',text));
        }catch(error){if(current(id))detail.replaceChildren(summary,element('p',error instanceof GeometrySourceError?`${error.code} · ${error.message}`:'GEOMETRY_CAPTURE_FAILED · The snapshot could not be captured safely.','generation-refusal'));}
      })();
    });
  }};
}
