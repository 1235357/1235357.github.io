import * as pdfjs from './vendor/build/pdf.mjs';
import {extractPdf} from './pdf-source.mjs';
import {createPdfSession} from './pdf-session.mjs';
import {getItemWindow} from './item-window.mjs';
import {chunkInWorker} from './compute-source.mjs';
import {embedInWorker} from './embedding-source.mjs';
import {queryInWorker} from './query-source.mjs';

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
  WORKER_PROTOCOL_ERROR:'The worker reply did not match this operation. No new artifact was accepted.',
  CHUNK_LIMIT:'The requested chunk output exceeds its budget. No partial artifact was accepted.',
  INVALID_SOURCE:'The extracted records did not match the chunking source contract.',
  INVALID_CONFIG:'The chunking options are invalid.',
  EMPTY_SOURCE:'No nonblank selectable text is available for chunking.',
  INVALID_EMBEDDING_CONFIG:'The accepted chunks exceed the embedding input contract or the configuration is invalid.',
  ENCODER_INPUT_LIMIT:'An input exceeds the token budget. No text was silently truncated; source and chunks are retained.',
  GPU_UNAVAILABLE:'A confirmed non-fallback WebGPU adapter is required. No automatic CPU fallback is used.',
  GPU_DEVICE_LOST:'The encoder’s WebGPU device was lost. Retry starts a fresh worker.',
  ASSET_INTEGRITY_ERROR:'Model or paired runtime bytes did not pass verification. No vectors were committed.',
  EMBEDDING_LOAD_FAILED:'The pinned local encoder could not initialize. Source and chunks are retained.',
  EMBEDDING_FAILED:'The encoder failed. No partial vectors were committed; source and chunks are retained.',
  INVALID_EMBEDDING:'The encoder output did not satisfy the finite, normalized 384-dimensional contract.',
  EMBEDDING_TIMEOUT:'The embedding worker exceeded its readiness/work budget. Source and chunks are retained.',
  INVALID_QUERY_WORKER_CONFIG:'Enter a nonblank question of at most 4,096 UTF-16 units and a whole-number top K of 1–512.',
  QUERY_TIMEOUT:'The query worker exceeded its readiness/work budget. Source, chunks and passage vectors are retained.',
  QUERY_FAILED:'The query operation failed. Source, chunks and passage vectors are retained.'};
let lastSource=null,lastChunks=null,lastEmbeddings=null,itemWindowIndex=0,chunkWindowIndex=0;
let lastQuestion=undefined,lastQueryEmbedding=null,lastRetrieval=null;
let uiActionNonce=0,embeddingRefusal=false,queryRefusal=false;
function beginUiAction(){uiActionNonce++;if(embeddingRefusal||queryRefusal)render(session.snapshot());return uiActionNonce;}
function element(tag,text,className){const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(className)value.className=className;return value;}
function receipt(rows){const list=byId('receipt');list.replaceChildren();for(const [key,value] of rows){list.append(element('dt',key),element('dd',String(value)));}}
function inspectCandidate(candidate,source,chunks,retrieval){
  if(source!==session.document()||chunks!==session.chunks()||retrieval!==session.retrieval())return;
  const chunk=chunks.chunks[candidate.ordinal];if(!chunk||chunk.id!==candidate.chunkId)return;
  const pageIndex=source.pages.findIndex(page=>page.physicalPageNumber===chunk.physicalPageNumber);
  if(pageIndex<0)return;
  beginUiAction();chunkWindowIndex=Math.floor(candidate.ordinal/100);showChunkWindow(candidate.ordinal);
  pageSelect.value=String(pageIndex);
  const firstSource=chunk.segments.find(segment=>segment.kind==='source');
  const itemIndex=firstSource?source.pages[pageIndex].textItems.findIndex(item=>item.itemIndex===firstSource.itemIndex):0;
  itemWindowIndex=Math.floor(Math.max(0,itemIndex)/100);showPage();
}
function showQuery(){
  const question=session.question(),query=session.queryEmbedding(),retrieval=session.retrieval();
  for(const id of ['question-original','question-resolved','question-encoder'])byId(id).textContent=question??'';
  const detail=byId('query-embedding-detail'),list=byId('query-receipt'),results=byId('candidate-results');
  detail.replaceChildren();list.replaceChildren();results.replaceChildren();
  byId('query-embedding-meta').textContent=query?`${query.counts.totalTokens} actual query token IDs · ${query.counts.dimensions} dimensions.`:
    'No query vector committed. Run an explicit question against accepted passage vectors.';
  byId('candidate-meta').textContent=retrieval?`${retrieval.returnedCount} sourced candidates · requested top K ${retrieval.requestedTopK} · query norm ${retrieval.queryNorm.toFixed(6)}. Inspect each source before drawing a conclusion.`:
    'No candidates committed. An explicit query uses the retained passage vectors.';
  if(!retrieval)results.append(element('p','No sourced candidates yet. Candidates are not a verified answer.','empty'));
  else{
    const source=session.document(),chunks=session.chunks();
    for(const [index,candidate]of retrieval.candidates.entries()){
      const chunk=chunks.chunks[candidate.ordinal],row=element('article',undefined,'candidate');
      row.append(element('p',`#${index+1} · chunk ${candidate.ordinal+1} · physical page ${chunk.physicalPageNumber} · PDF label ${chunk.pageLabel===null?'not supplied':JSON.stringify(chunk.pageLabel)}`,'identity'),
        element('p',candidate.chunkId,'identity'),element('p',chunk.text,'quote'),
        element('p',`cosine ${candidate.score.toFixed(6)} · dot ${candidate.dotProduct.toFixed(6)} · query norm ${retrieval.queryNorm.toFixed(6)} · chunk norm ${candidate.chunkNorm.toFixed(6)}`,'candidate-score'));
      const button=element('button',`Inspect candidate ${index+1} in retained source`);button.type='button';
      button.addEventListener('click',()=>inspectCandidate(candidate,source,chunks,retrieval));row.append(button);results.append(row);
    }
  }
  if(!query)return;
  detail.append(element('p','First 12 query vector values · bounded preview','hint'),
    element('p',query.vector.slice(0,12).map(value=>value.toFixed(6)).join('  '),'vector-preview'));
  for(const [title,value,indent]of [[`Inspect all ${query.tokenIds.length} query token IDs including CLS / SEP`,query.tokenIds,undefined],
    ['Inspect the query vector’s full 384 values',query.vector,2]]){
    const lazy=element('details'),summary=element('summary',title);lazy.append(summary);
    lazy.addEventListener('toggle',()=>{lazy.replaceChildren(summary,...(lazy.open?[element('pre',JSON.stringify(value,null,indent))]:[]));});
    detail.append(lazy);
  }
  for(const [key,value]of [['Representation',query.representationId],['Backend',`${query.backend} · ${query.dtype}`],
    ['Verified body',`${query.receipt.verifiedBytes.toLocaleString()} bytes`],['Fetched body',`${query.receipt.networkBytes.toLocaleString()} bytes`],
    ['Cached body',`${query.receipt.cacheBytes.toLocaleString()} bytes`],['Attempt elapsed',`${query.receipt.elapsedMs.toFixed(1)} ms`]])
    list.append(element('dt',key),element('dd',value));
}
function showEmbedding(){
  const target=byId('embedding-detail'),meta=byId('embedding-meta');target.replaceChildren();
  const artifact=session.embeddings(),index=Number(byId('chunk-select').value);
  if(!artifact){meta.textContent='No vectors committed. Embed accepted chunks to inspect actual encoder output.';return;}
  const vector=artifact.vectors[index],ids=artifact.tokenIds[index];if(!vector)return;
  const norm=Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0));
  meta.textContent=`Chunk ${index+1} of ${artifact.counts.chunks} · ${ids.length} actual token IDs · ${vector.length} dimensions · L2 norm ${norm.toFixed(6)}`;
  target.append(element('p',artifact.chunkIds[index],'identity'),element('p',`Token IDs including CLS / SEP (${ids.length} total)`,'hint'),
    element('pre',JSON.stringify(ids)),element('p','First 12 vector values · bounded preview','hint'),
    element('p',vector.slice(0,12).map(value=>value.toFixed(6)).join('  '),'vector-preview'));
  const detail=element('details'),summary=element('summary','Inspect this selected vector’s full 384 values');detail.append(summary);
  detail.addEventListener('toggle',()=>{detail.replaceChildren(summary,...(detail.open?[element('pre',JSON.stringify(vector,null,2))]:[]));});
  target.append(detail);
}
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
  showEmbedding();
  const artifact=session.chunks();
  if(!artifact){
    target.append(element('p','No chunk artifact. Build from an accepted source.','empty'));
    byId('chunk-meta').textContent='No chunks committed.';return;
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
function showChunkWindow(selectedIndex){
  const select=byId('chunk-select');select.replaceChildren();
  const artifact=session.chunks(),range=getItemWindow(artifact?.chunks.length??0,chunkWindowIndex);
  chunkWindowIndex=range.windowIndex;select.disabled=!artifact;
  byId('chunks-previous').disabled=!range.hasPrevious;byId('chunks-next').disabled=!range.hasNext;
  if(!artifact)select.append(element('option','No chunks'));
  else for(let index=range.start;index<range.end;index++){
    const chunk=artifact.chunks[index],option=element('option',`#${index+1} · p${chunk.physicalPageNumber} · [${chunk.startUtf16}, ${chunk.endUtf16})`);
    option.value=index;select.append(option);
  }
  if(Number.isSafeInteger(selectedIndex)&&selectedIndex>=range.start&&selectedIndex<range.end)select.value=String(selectedIndex);
  showChunk();
}
function render(state){
  uiActionNonce++;embeddingRefusal=false;queryRefusal=false;
  const source=session.document(),chunks=session.chunks(),embeddings=session.embeddings();
  const titles={idle:'Waiting for a PDF',parsing:'Reading selected bytes',chunking:'Building source-linked windows',embedding:'Embedding accepted chunks',querying:'Finding sourced candidates','query-candidates-only':'Query candidates; not an answer',cancelled:'Commit rights revoked','runtime-error':'No new result committed','extracted-not-indexed':'Extracted; not indexed','chunked-not-embedded':'Chunked; not embedded','embedded-not-retrieved':'Embedded; not retrieved'};
  byId('status-title').textContent=titles[state.status];
  const active=state.lifecycle.active,progress=active?.progress,bar=byId('operation-progress');
  bar.hidden=!active;
  if(progress?.total!==null&&progress?.total>0){bar.max=progress.total;bar.value=progress.completed;}
  else bar.removeAttribute('value');
  let progressText;
  if(active?.operation==='query'){
    progressText=active.stage==='download'?`${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} verified asset body bytes for this query attempt.`:
      active.stage==='initialize'?'Query encoder initialization · indeterminate. No reliable initialization percentage.':
      active.stage==='encode'?`${progress.completed} / ${progress.total} actual query tokens encoded with the pinned WebGPU provider.`:
      active.stage==='rank'?`${progress.completed} / ${progress.total} retained chunks ranked. Scores select candidates; they do not verify an answer.`:
      'Waiting for the fresh query worker. Asset verification, initialization, question encoding and candidate ranking follow.';
  }else if(active?.operation==='embed'){
    progressText=active.stage==='download'?`${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} verified asset body bytes. Whole verified assets advance this bar; it is not a streamed network percentage.`:
      active.stage==='initialize'?'Encoder initialization · indeterminate. No reliable initialization percentage.':
      active.stage==='encode'?`${progress.completed} / ${progress.total} completed chunks · encoding with the pinned WebGPU provider.`:
      'Waiting for the fresh embedding worker. Asset verification, initialization and encoding follow.';
  }else if(progress){progressText=`${progress.completed} / ${progress.total??'unknown'} ${progress.unit} · ${active.stage==='index'?'chunking':active.stage==='parse'?'parsing':active.stage}.`;}
  byId('status-detail').textContent=state.error?(ERROR_HELP[state.error.code]||'Work failed. No new artifact was committed.'):
    progressText?progressText:
    state.status==='query-candidates-only'?`${session.retrieval().returnedCount} sourced candidates · ${session.queryEmbedding().counts.totalTokens} actual query tokens · ${session.queryEmbedding().counts.dimensions} dimensions. Context and generation remain disabled. This is not a verified answer.`:
    state.status==='embedded-not-retrieved'?`${embeddings.counts.chunks} chunks · ${embeddings.counts.totalTokens} actual tokens · ${embeddings.counts.dimensions} dimensions. No retrieval or generated answer yet.`:
    state.status==='chunked-not-embedded'?`${chunks.counts.chunks} chunks · ${chunks.counts.outputUtf16} output UTF-16 units · ${chunks.counts.fragments} mapping fragments. No vectors or generated answer.`:
    state.status==='extracted-not-indexed'?'Actual parser records below. No embedding index or generated answer exists.':
    state.status==='chunking'?'Waiting for the owned computation worker, then building page windows. No fabricated percentage.':
    state.status==='parsing'?'Hashing/loading/parsing are separate from accepting a result.':
    state.status==='cancelled'?(embeddings?'Late query work cannot update this session. Source, chunks and passage vectors retained for retry.':chunks?'Late embedding work cannot update this session. Source and chunks retained for retry.':source?'Late chunk work cannot update this session. Source retained for retry.':'Late work cannot update this session. Owned worker cleanup follows.'):'No source is stored. No embedding index or answer exists.';
  byId('cancel').disabled=!state.lifecycle.active;
  byId('build-chunks').disabled=!source||Boolean(state.lifecycle.active);
  byId('embed-chunks').disabled=!chunks||Boolean(state.lifecycle.active);
  byId('run-query').disabled=!embeddings||Boolean(active);
  byId('clear-query').disabled=Boolean(active)&&active.operation!=='query';
  byId('question-input').disabled=active?.operation==='query';
  byId('query-top-k').disabled=active?.operation==='query';
  byId('trace').textContent=JSON.stringify(state.lifecycle,null,2);
  if(source!==lastSource){
    lastSource=source;itemWindowIndex=0;pageSelect.replaceChildren();pageSelect.disabled=!source;
    if(!source){pageSelect.append(element('option','No document'));items.replaceChildren(element('p','Choose a PDF to inspect actual parser records.','empty'));byId('page-meta').textContent='No source committed.';showItemRange(getItemWindow(0));receipt([]);}
    else{
      source.pages.forEach((page,index)=>{const option=element('option',`${page.physicalPageNumber} · ${page.pageLabel??'no label'}`);option.value=index;pageSelect.append(option);});
      showPage();
    }
  }
  if(source)receipt([['File',source.source.name],['Bytes',source.source.size],['SHA-256',source.source.sha256],['Parser',`PDF.js ${source.parser.version}`],['Parse worker',source.workerMode],['Compute',chunks?'native · owned module worker':'no chunk result'],['Pages',source.numPages],['Epoch',state.lifecycle.documentEpoch],['Stage',session.retrieval()?'query candidates only':embeddings?'embedded; not retrieved':chunks?'chunked; not embedded':'extracted; not indexed']]);
  if(chunks!==lastChunks){lastChunks=chunks;chunkWindowIndex=0;showChunkWindow();}
  if(embeddings!==lastEmbeddings){
    lastEmbeddings=embeddings;showEmbedding();const list=byId('embedding-receipt');list.replaceChildren();
    if(embeddings){for(const [key,value]of [['Representation',embeddings.representationId],['Backend',`${embeddings.backend} · ${embeddings.dtype}`],
      ['Verified body',`${embeddings.receipt.verifiedBytes.toLocaleString()} bytes`],['Fetched body',`${embeddings.receipt.networkBytes.toLocaleString()} bytes`],
      ['Cached body',`${embeddings.receipt.cacheBytes.toLocaleString()} bytes`],['Attempt elapsed',`${embeddings.receipt.elapsedMs.toFixed(1)} ms`]])
      list.append(element('dt',key),element('dd',value));}
  }
  if(session.question()!==lastQuestion||session.queryEmbedding()!==lastQueryEmbedding||session.retrieval()!==lastRetrieval){
    lastQuestion=session.question();lastQueryEmbedding=session.queryEmbedding();lastRetrieval=session.retrieval();showQuery();
  }
}
const session=createPdfSession({extract:extractPdf,parserOptions:{pdfjs,
  assetBaseUrl:new URL('./vendor/',import.meta.url).href,
  workerFactory:url=>new Worker(url,{type:'module'})},
  compute:chunkInWorker,computeOptions:{workerFactory:url=>new Worker(url,{type:'module'})},
  embed:embedInWorker,embeddingOptions:{workerFactory:url=>new Worker(url,{type:'module'})},
  query:queryInWorker,queryOptions:{workerFactory:url=>new Worker(url,{type:'module'})},onState:render});
fileInput.addEventListener('change',()=>{const file=fileInput.files?.[0];if(file){beginUiAction();void session.select(file);}});
byId('cancel').addEventListener('click',()=>{beginUiAction();session.cancel();});
byId('clear').addEventListener('click',()=>{beginUiAction();session.clear();fileInput.value='';});
pageSelect.addEventListener('change',()=>{beginUiAction();itemWindowIndex=0;showPage();});
byId('items-first').addEventListener('click',()=>{beginUiAction();itemWindowIndex=0;showPage();});
byId('items-previous').addEventListener('click',()=>{beginUiAction();itemWindowIndex--;showPage();});
byId('items-next').addEventListener('click',()=>{beginUiAction();itemWindowIndex++;showPage();});
byId('build-chunks').addEventListener('click',()=>{beginUiAction();void session.chunk();});
byId('embed-chunks').addEventListener('click',()=>{
  const action=beginUiAction(),state=session.snapshot(),source=session.document(),chunks=session.chunks(),embeddings=session.embeddings();
  void session.embed().catch(()=>{
    const current=session.snapshot();
    // This UI-only refusal is not a worker terminal. A later action or render
    // revokes its display permission without changing accepted session state.
    if(action!==uiActionNonce||current.lifecycle.documentEpoch!==state.lifecycle.documentEpoch
        ||current.lifecycle.active!==null||source!==session.document()||chunks!==session.chunks()||embeddings!==session.embeddings())return;
    embeddingRefusal=true;
    byId('status-title').textContent='Embedding did not start';
    byId('status-detail').textContent=`INVALID_EMBEDDING_CONFIG · ${ERROR_HELP.INVALID_EMBEDDING_CONFIG} Source, chunks and any accepted vectors are retained.`;
  });
});
byId('run-query').addEventListener('click',()=>{
  const action=beginUiAction(),state=session.snapshot(),source=session.document(),chunks=session.chunks(),embeddings=session.embeddings();
  const question=session.question(),query=session.queryEmbedding(),retrieval=session.retrieval();
  const rawQuestion=byId('question-input').value,topK=Number(byId('query-top-k').value);
  void session.query(rawQuestion,{topK}).catch(()=>{
    const current=session.snapshot();
    if(action!==uiActionNonce||current.lifecycle.documentEpoch!==state.lifecycle.documentEpoch||current.lifecycle.active!==null
        ||source!==session.document()||chunks!==session.chunks()||embeddings!==session.embeddings()
        ||question!==session.question()||query!==session.queryEmbedding()||retrieval!==session.retrieval())return;
    queryRefusal=true;byId('status-title').textContent='Query did not start';
    byId('status-detail').textContent=`INVALID_QUERY_WORKER_CONFIG · ${ERROR_HELP.INVALID_QUERY_WORKER_CONFIG} Source, chunks and accepted passage vectors are retained.`;
  });
});
for(const id of ['question-input','query-top-k'])byId(id).addEventListener('input',()=>{beginUiAction();session.clearQuery();});
byId('clear-query').addEventListener('click',()=>{beginUiAction();session.clearQuery();byId('question-input').value='';});
byId('chunk-select').addEventListener('change',()=>{beginUiAction();showChunk();});
byId('chunks-previous').addEventListener('click',()=>{beginUiAction();chunkWindowIndex--;showChunkWindow();});
byId('chunks-next').addEventListener('click',()=>{beginUiAction();chunkWindowIndex++;showChunkWindow();});
window.addEventListener('pagehide',()=>{beginUiAction();session.clear();});
// A reload creates an empty session, even if browser form restoration retained
// a previous file. Release that selection so choosing the same PDF emits change.
fileInput.value='';
render(session.snapshot());
showChunkWindow();
