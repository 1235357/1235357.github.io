import * as pdfjs from './vendor/build/pdf.mjs';
import {extractPdf} from './pdf-source.mjs';
import {createPdfSession} from './pdf-session.mjs';
import {getItemWindow} from './item-window.mjs';

const byId=id=>document.getElementById(id);
const fileInput=byId('pdf-file'),pageSelect=byId('page-select'),items=byId('items');
const ERROR_HELP={FILE_TOO_LARGE:'The PDF exceeds the 32 MiB input budget.',
  EMPTY_DOCUMENT:'No selectable text was extracted. This lab does not perform OCR.',
  PDF_PASSWORD_REQUIRED:'Password-protected PDFs are not supported by this inspector.',
  EXTRACTION_LIMIT:'The document exceeds a page, text or item budget.',
  INVALID_PDF:'The selected bytes are not a usable PDF.',
  WORKER_UNAVAILABLE:'The native parsing worker could not start.',
  PARSER_VERSION_UNSUPPORTED:'The paired parser runtime is incompatible.',
  CLEANUP_FAILED:'Owned parser resource cleanup did not complete.'};
let lastSource=null,itemWindowIndex=0;
function element(tag,text,className){const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(className)value.className=className;return value;}
function receipt(rows){const list=byId('receipt');list.replaceChildren();for(const [key,value] of rows){list.append(element('dt',key),element('dd',String(value)));}}
function showItemRange(range){
  byId('items-range').textContent=range.total===0?'Showing 0 items of 0.':
    `Showing items ${range.start+1}–${range.end} of ${range.total} · preview window ${range.windowIndex+1} of ${range.windowCount}`;
  byId('items-first').disabled=!range.hasPrevious;
  byId('items-previous').disabled=!range.hasPrevious;
  byId('items-next').disabled=!range.hasNext;
}
function showPage(){
  items.replaceChildren();items.scrollTop=0;const source=session.document();if(!source){showItemRange(getItemWindow(0));return;}
  const page=source.pages[Number(pageSelect.value)];
  const range=getItemWindow(page.textItems.length,itemWindowIndex);itemWindowIndex=range.windowIndex;showItemRange(range);
  byId('page-meta').textContent=`Physical page ${page.physicalPageNumber} · PDF label ${page.pageLabel===null?'not supplied':JSON.stringify(page.pageLabel)} · ${page.textItems.length} items · rotation ${page.geometry.rotation}°`;
  if(range.total===0){items.append(element('p','No selectable text on this page. No OCR was invented.','empty'));return;}
  for(let index=range.start;index<range.end;index++){
    const item=page.textItems[index];
    const row=element('article',undefined,'item');
    row.append(element('p',`ITEM ${item.itemIndex} · UTF-16 [${item.span.startUtf16}, ${item.span.endUtf16})`,'identity'),element('p',item.text||'(empty parser item)','quote'));
    const detail=element('details'),summary=element('summary','Inspect span identity and geometry');detail.append(summary);
    detail.addEventListener('toggle',()=>{
      detail.replaceChildren(summary,...(detail.open?[element('pre',JSON.stringify(item,null,2))]:[]));
    });
    row.append(detail);items.append(row);
  }
}
function render(state){
  const titles={idle:'Waiting for a PDF',parsing:'Reading selected bytes',cancelled:'Commit rights revoked','runtime-error':'No source committed','extracted-not-indexed':'Extracted; not indexed'};
  byId('status-title').textContent=titles[state.status];
  const progress=state.lifecycle.active?.progress;
  byId('status-detail').textContent=state.error?(ERROR_HELP[state.error.code]||'PDF extraction failed. The previous source was cleared.'):
    progress?`${progress.completed} / ${progress.total??'unknown'} ${progress.unit} parsed.`:
    state.status==='extracted-not-indexed'?'Actual parser records below. No embedding index or generated answer exists.':
    state.status==='parsing'?'Hashing/loading/parsing are separate from accepting a result.':
    state.status==='cancelled'?'Late work cannot update this session. Owned worker cleanup follows.':'No source is stored. No embedding index or answer exists.';
  byId('cancel').disabled=state.status!=='parsing';
  byId('trace').textContent=JSON.stringify(state.lifecycle,null,2);
  const source=session.document();
  if(source!==lastSource){
    lastSource=source;itemWindowIndex=0;pageSelect.replaceChildren();pageSelect.disabled=!source;
    if(!source){pageSelect.append(element('option','No document'));items.replaceChildren(element('p','Choose a PDF to inspect actual parser records.','empty'));byId('page-meta').textContent='No source committed.';showItemRange(getItemWindow(0));receipt([]);}
    else{
      source.pages.forEach((page,index)=>{const option=element('option',`${page.physicalPageNumber} · ${page.pageLabel??'no label'}`);option.value=index;pageSelect.append(option);});
      receipt([['File',source.source.name],['Bytes',source.source.size],['SHA-256',source.source.sha256],['Parser',`PDF.js ${source.parser.version}`],['Worker',source.workerMode],['Pages',source.numPages],['Epoch',state.lifecycle.documentEpoch],['Stage','extracted; not indexed']]);showPage();
    }
  }
}
const session=createPdfSession({extract:extractPdf,parserOptions:{pdfjs,
  assetBaseUrl:new URL('./vendor/',import.meta.url).href,
  workerFactory:url=>new Worker(url,{type:'module'})},onState:render});
fileInput.addEventListener('change',()=>{const file=fileInput.files?.[0];if(file)void session.select(file);});
byId('cancel').addEventListener('click',()=>session.cancel());
byId('clear').addEventListener('click',()=>{session.clear();fileInput.value='';});
pageSelect.addEventListener('change',()=>{itemWindowIndex=0;showPage();});
byId('items-first').addEventListener('click',()=>{itemWindowIndex=0;showPage();});
byId('items-previous').addEventListener('click',()=>{itemWindowIndex--;showPage();});
byId('items-next').addEventListener('click',()=>{itemWindowIndex++;showPage();});
window.addEventListener('pagehide',()=>session.clear());
render(session.snapshot());
