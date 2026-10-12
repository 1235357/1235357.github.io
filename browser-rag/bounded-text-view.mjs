export const BOUNDED_TEXT_MAX_UNITS=24*1024;
export const BOUNDED_TEXT_MAX_LINES=160;

// Store only offsets. Consecutive half-open ranges cover every original code unit.
// A Unicode pair and CRLF stay together; a trailing newline counts as another line.
function textRanges(text){
  const ranges=[];let start=0;
  while(start<text.length){
    let end=start,lines=1;
    while(end<text.length){
      const code=text.charCodeAt(end),next=text.charCodeAt(end+1);
      const pair=code>=0xd800&&code<=0xdbff&&next>=0xdc00&&next<=0xdfff;
      const crlf=code===13&&next===10,size=pair||crlf?2:1;
      if(end-start+size>BOUNDED_TEXT_MAX_UNITS)break;
      end+=size;
      if(code===10||code===13){lines++;if(lines===BOUNDED_TEXT_MAX_LINES)break;}
    }
    ranges.push([start,end]);start=end;
  }
  return ranges.length?ranges:[[0,0]];
}

// Complete immutable text stays in this owned viewer; only one bounded page enters
// the DOM. The caller disposes on disclosure close/source revocation/re-render.
export function createBoundedTextView({document,root,text,current,format='json',filename=format==='text'?'source.txt':'source.json',Blob:BlobCtor=globalThis.Blob,URL:URLApi=globalThis.URL}){
  if(typeof text!=='string'||typeof current!=='function'||typeof filename!=='string'||!['json','text'].includes(format))throw new TypeError('Invalid bounded text viewer input.');
  const contentName=format==='text'?'text':'JSON',mime=format==='text'?'text/plain;charset=utf-8':'application/json;charset=utf-8';
  let source=text,ranges=[],index=0,alive=true,objectURL=null,activeAnchor=null,downloading=false;
  const listeners=[];
  const element=(tag,content,className)=>{const node=document.createElement(tag);if(content!==undefined)node.textContent=content;if(className)node.className=className;return node;};
  const wrapper=element('div',undefined,'bounded-text-view'),note=element('p',`The complete ${contentName} is retained. View each page or download the complete ${contentName}.`,'bounded-text-note hint');
  wrapper.setAttribute('role','group');wrapper.setAttribute('aria-label',format==='text'?'Complete text viewer':'Complete JSON text viewer');
  const range=element('p','', 'bounded-text-range');range.setAttribute('role','status');range.setAttribute('aria-live','polite');
  const controls=element('div',undefined,'bounded-text-controls'),previous=element('button','Previous page'),next=element('button','Next page');
  const label=element('label','Page ', 'bounded-text-jump'),input=element('input'),jump=element('button','Go to page'),download=element('button',`Download complete ${contentName}`);
  input.type='number';input.setAttribute('aria-label','Page number');input.setAttribute('min','1');input.setAttribute('step','1');
  for(const button of [previous,next,jump,download])button.type='button';label.append(input);controls.append(previous,next,label,jump,download);
  const pre=element('pre','', 'bounded-text-page');pre.setAttribute('tabindex','0');pre.setAttribute('aria-label',format==='text'?'Text page':'JSON text page');
  const status=element('p','', 'bounded-text-status hint');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const downloadHost=element('span');downloadHost.hidden=true;
  wrapper.append(note,range,controls,pre,status,downloadHost);
  const scrubAnchor=anchor=>{if(anchor){anchor.removeAttribute('href');anchor.removeAttribute('download');anchor.textContent='';}};
  function revokeURL(){
    const old=objectURL;objectURL=null;
    if(old!==null){try{URLApi.revokeObjectURL(old);}catch{/* Cleanup never exposes a dependency's diagnostic text. */}}
  }
  function dispose(){
    if(!alive){scrubAnchor(activeAnchor);activeAnchor=null;downloadHost.replaceChildren();revokeURL();return;}
    alive=false;source='';ranges=[];
    for(const node of [previous,next,jump,download,input])node.disabled=true;
    input.value='';pre.textContent='';range.textContent='';status.textContent='';note.textContent='';
    scrubAnchor(activeAnchor);activeAnchor=null;downloadHost.replaceChildren();
    for(const [node,event,listener]of listeners)node.removeEventListener(event,listener);listeners.length=0;
    revokeURL();wrapper.replaceChildren();
  }
  function owned(){
    if(!alive){dispose();return false;}
    let accepted=false;try{accepted=current()===true;}catch{/* A failed owner check revokes the same way as a stale owner. */}
    if(!accepted||!alive){dispose();return false;}return true;
  }
  const bind=(node,event,listener)=>{node.addEventListener(event,listener);listeners.push([node,event,listener]);};
  function renderPage(pageIndex){
    if(!owned()||!Number.isSafeInteger(pageIndex)||pageIndex<0||pageIndex>=ranges.length)return;
    index=pageIndex;const [start,end]=ranges[index];pre.textContent=source.slice(start,end);
    range.textContent=`Page ${index+1} of ${ranges.length} · UTF-16 units ${(source.length?start+1:0).toLocaleString('en-US')}–${end.toLocaleString('en-US')} of ${source.length.toLocaleString('en-US')}`;
    input.value=String(index+1);previous.disabled=index===0;next.disabled=index===ranges.length-1;status.textContent='';owned();
  }
  function goToPage(){
    if(!owned())return;
    const value=input.value,pageNumber=/^[1-9]\d*$/.test(value)?Number(value):NaN;
    if(!Number.isSafeInteger(pageNumber)||pageNumber>ranges.length){status.textContent=`TEXT_PAGE_OUT_OF_RANGE · Choose a page from 1 to ${ranges.length}.`;return;}
    renderPage(pageNumber-1);
  }
  bind(previous,'click',()=>renderPage(index-1));bind(next,'click',()=>renderPage(index+1));bind(jump,'click',goToPage);
  bind(input,'keydown',event=>{if(event.key==='Enter'){event.preventDefault?.();goToPage();}});
  bind(download,'click',()=>{
    // Owner and URL dependencies may synchronously dispatch another click.
    // Acquire before checking ownership so their callbacks cannot recurse.
    if(downloading)return;downloading=true;let anchor=null;
    try{
      if(!owned())return;revokeURL();if(!owned())return;
      const blob=new BlobCtor([new TextEncoder().encode(source)],{type:mime});if(!owned())return;
      objectURL=URLApi.createObjectURL(blob);
      if(!owned())return;
      if(typeof objectURL!=='string'||!objectURL.startsWith('blob:'))throw new Error();
      anchor=element('a');activeAnchor=anchor;anchor.setAttribute('href',objectURL);anchor.setAttribute('download',filename);
      const allowClick=event=>{if(!owned())event.preventDefault?.();};anchor.addEventListener('click',allowClick);
      downloadHost.append(anchor);
      try{if(!owned())return;anchor.click();}finally{anchor.removeEventListener('click',allowClick);}
      if(owned())status.textContent=`Complete ${contentName} download requested.`;
    }catch{
      revokeURL();if(owned())status.textContent=`TEXT_DOWNLOAD_FAILED · The complete ${contentName} could not be downloaded.`;
    }finally{
      scrubAnchor(anchor);activeAnchor=null;downloadHost.replaceChildren();
      downloading=false;
    }
  });
  if(owned()){
    ranges=textRanges(source);
    if(owned()){input.setAttribute('max',String(ranges.length));root.append(wrapper);renderPage(0);}
  }
  return Object.freeze({dispose});
}
