import * as pdfjs from './vendor/build/pdf.mjs';
import {extractPdf} from './pdf-source.mjs';
import {createPdfSession} from './pdf-session.mjs';
import {getItemWindow} from './item-window.mjs';
import {chunkInWorker} from './compute-source.mjs';

const byId=id=>document.getElementById(id);
const fileInput=byId('pdf-file'),pageSelect=byId('page-select'),items=byId('items');
const ERROR_HELP={FILE_TOO_LARGE:'The PDF exceeds the 32 MiB input budget.',
  EMPTY_DOCUMENT:'No selectable text was extracted. This lab does not perform OCR.',
  PDF_PASSWORD_REQUIRED:'Password-protected PDFs are not supported by this inspector.',
  EXTRACTION_LIMIT:'The document exceeds a page, text or item budget.',
  INVALID_PDF:'The selected bytes are not a usable PDF.',
  WORKER_UNAVAILABLE:'The native worker could not start. No new artifact was committed. If extraction succeeded, its source records are retained for retry.',
  PARSER_VERSION_UNSUPPORTED:'The paired parser runtime is incompatible.',
  CLEANUP_FAILED:'Owned parser resource cleanup did not complete.',
  COMPUTE_TIMEOUT:'The computation worker exceeded its readiness/work time budget. Retry from the retained source.',
  WORKER_PROTOCOL_ERROR:'The computation worker reply did not match this operation. No chunk artifact was accepted.',
  CHUNK_LIMIT:'The requested chunk output exceeds its budget. No partial artifact was accepted.',
  INVALID_SOURCE:'The extracted records did not match the chunking source contract.',
  INVALID_CONFIG:'The chunking options are invalid.',
  EMPTY_SOURCE:'No nonblank selectable text is available for chunking.'};
let lastSource=null,lastChunks=null,itemWindowIndex=0,chunkWindowIndex=0;
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
function showChunk(){
  const target=byId('chunk-detail');target.replaceChildren();
  const artifact=session.chunks();
  if(!artifact){
    target.append(element('p','No chunk artifact. Build from an accepted source.','empty'));
    byId('chunk-meta').textContent='No chunks committed. No embedding index exists.';return;
  }
  const chunk=artifact.chunks[Number(byId('chunk-select').value)];
  if(!chunk)return;
  byId('chunk-meta').textContent=`Chunk ${Number(byId('chunk-select').value)+1} of ${artifact.counts.chunks} · physical page ${chunk.physicalPageNumber} · label ${chunk.pageLabel===null?'not supplied':JSON.stringify(chunk.pageLabel)} · joined-page UTF-16 [${chunk.startUtf16}, ${chunk.endUtf16})`;
  target.append(element('p',chunk.id,'identity'),element('p',chunk.text,'quote'));
  const scroll=element('div',undefined,'segment-scroll'),table=element('table',undefined,'segments');
  const caption=element('caption','Exact source/presentation mapping');table.append(caption);
  const head=element('thead'),heading=element('tr');
  for(const title of ['Type','Item / source range','Chunk range','Escaped text'])heading.append(element('th',title));
  head.append(heading);table.append(head);
  const body=element('tbody');
  for(const segment of chunk.segments){
    const row=element('tr');
    const sourceRange=segment.kind==='source'?`item ${segment.itemIndex} · [${segment.startUtf16}, ${segment.endUtf16})`:'inserted · no source span';
    const text=segment.kind==='source'?segment.quote:segment.text;
    for(const value of [segment.kind,sourceRange,`[${segment.chunkStartUtf16}, ${segment.chunkEndUtf16})`,JSON.stringify(text)])row.append(element('td',value));
    body.append(row);
  }
  table.append(body);scroll.append(table);target.append(scroll);
  const detail=element('details'),summary=element('summary','Inspect this chunk’s full source-span identities');detail.append(summary);
  detail.addEventListener('toggle',()=>{detail.replaceChildren(summary,...(detail.open?[element('pre',JSON.stringify(chunk,null,2))]:[]));});
  target.append(detail);
}
function showChunkWindow(){
  const select=byId('chunk-select');select.replaceChildren();
  const artifact=session.chunks(),range=getItemWindow(artifact?.chunks.length??0,chunkWindowIndex);
  chunkWindowIndex=range.windowIndex;select.disabled=!artifact;
  byId('chunks-previous').disabled=!range.hasPrevious;byId('chunks-next').disabled=!range.hasNext;
  if(!artifact)select.append(element('option','No chunks'));
  else for(let index=range.start;index<range.end;index++){
    const chunk=artifact.chunks[index],option=element('option',`#${index+1} · p${chunk.physicalPageNumber} · [${chunk.startUtf16}, ${chunk.endUtf16})`);
    option.value=index;select.append(option);
  }
  showChunk();
}
function render(state){
  const source=session.document(),chunks=session.chunks();
  const titles={idle:'Waiting for a PDF',parsing:'Reading selected bytes',chunking:'Building source-linked windows',cancelled:'Commit rights revoked','runtime-error':'No result committed','extracted-not-indexed':'Extracted; not indexed','chunked-not-embedded':'Chunked; not embedded'};
  byId('status-title').textContent=titles[state.status];
  const progress=state.lifecycle.active?.progress;
  byId('status-detail').textContent=state.error?(ERROR_HELP[state.error.code]||'Work failed. No new artifact was committed.'):
    progress?`${progress.completed} / ${progress.total??'unknown'} ${progress.unit} · ${state.status==='chunking'?'chunking, not embedding':'parsing'}.`:
    state.status==='chunked-not-embedded'?`${chunks.counts.chunks} chunks · ${chunks.counts.outputUtf16} output UTF-16 units · ${chunks.counts.fragments} mapping fragments. No vectors or generated answer.`:
    state.status==='extracted-not-indexed'?'Actual parser records below. No embedding index or generated answer exists.':
    state.status==='chunking'?'Waiting for the owned computation worker, then building page windows. No fabricated percentage.':
    state.status==='parsing'?'Hashing/loading/parsing are separate from accepting a result.':
    state.status==='cancelled'?(source?'Late chunk work cannot update this session. Source retained for retry.':'Late work cannot update this session. Owned worker cleanup follows.'):'No source is stored. No embedding index or answer exists.';
  byId('cancel').disabled=!state.lifecycle.active;
  byId('build-chunks').disabled=!source||Boolean(state.lifecycle.active);
  byId('trace').textContent=JSON.stringify(state.lifecycle,null,2);
  if(source!==lastSource){
    lastSource=source;itemWindowIndex=0;pageSelect.replaceChildren();pageSelect.disabled=!source;
    if(!source){pageSelect.append(element('option','No document'));items.replaceChildren(element('p','Choose a PDF to inspect actual parser records.','empty'));byId('page-meta').textContent='No source committed.';showItemRange(getItemWindow(0));receipt([]);}
    else{
      source.pages.forEach((page,index)=>{const option=element('option',`${page.physicalPageNumber} · ${page.pageLabel??'no label'}`);option.value=index;pageSelect.append(option);});
      showPage();
    }
  }
  if(source)receipt([['File',source.source.name],['Bytes',source.source.size],['SHA-256',source.source.sha256],['Parser',`PDF.js ${source.parser.version}`],['Parse worker',source.workerMode],['Compute',chunks?'native · owned module worker':'no chunk result'],['Pages',source.numPages],['Epoch',state.lifecycle.documentEpoch],['Stage',chunks?'chunked; not embedded':'extracted; not indexed']]);
  if(chunks!==lastChunks){lastChunks=chunks;chunkWindowIndex=0;showChunkWindow();}
}
const session=createPdfSession({extract:extractPdf,parserOptions:{pdfjs,
  assetBaseUrl:new URL('./vendor/',import.meta.url).href,
  workerFactory:url=>new Worker(url,{type:'module'})},
  compute:chunkInWorker,computeOptions:{workerFactory:url=>new Worker(url,{type:'module'})},onState:render});
fileInput.addEventListener('change',()=>{const file=fileInput.files?.[0];if(file)void session.select(file);});
byId('cancel').addEventListener('click',()=>session.cancel());
byId('clear').addEventListener('click',()=>{session.clear();fileInput.value='';});
pageSelect.addEventListener('change',()=>{itemWindowIndex=0;showPage();});
byId('items-first').addEventListener('click',()=>{itemWindowIndex=0;showPage();});
byId('items-previous').addEventListener('click',()=>{itemWindowIndex--;showPage();});
byId('items-next').addEventListener('click',()=>{itemWindowIndex++;showPage();});
byId('build-chunks').addEventListener('click',()=>{void session.chunk();});
byId('chunk-select').addEventListener('change',showChunk);
byId('chunks-previous').addEventListener('click',()=>{chunkWindowIndex--;showChunkWindow();});
byId('chunks-next').addEventListener('click',()=>{chunkWindowIndex++;showChunkWindow();});
window.addEventListener('pagehide',()=>session.clear());
render(session.snapshot());
showChunkWindow();
