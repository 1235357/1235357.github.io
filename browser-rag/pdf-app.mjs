import * as pdfjs from './vendor/build/pdf.mjs';
import {extractPdf} from './pdf-source.mjs';
import {createPdfSession} from './pdf-session.mjs';
import {getItemWindow} from './item-window.mjs';
import {chunkInWorker} from './compute-source.mjs';
import {embedInWorker} from './embedding-source.mjs';
import {queryInWorker} from './query-source.mjs';
import {createContextView} from './context-view.mjs';
import {ContextError} from './context-contract.mjs';
import {createGenerationView} from './generation-view.mjs';

const mounts=new WeakMap();
export function mountPdfApp(options={}) {
  if(options===null||typeof options!=='object'||Array.isArray(options)
      ||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw new TypeError('Invalid PDF mount options');
  const keys=Reflect.ownKeys(options);
  if(keys.some(key=>!['document','root','generate','createGeometryView','createLookupView','createAssetPreparationView','preparePdfWorker'].includes(key)))throw new TypeError('Unknown PDF mount option');
  const captured={};for(const key of keys)captured[key]=options[key];
  const document=captured.document===undefined?globalThis.document:captured.document;
  const root=captured.root===undefined?document:captured.root,generate=captured.generate,createGeometryView=captured.createGeometryView,createLookupView=captured.createLookupView,createAssetPreparationView=captured.createAssetPreparationView,preparePdfWorker=captured.preparePdfWorker;
  if(!document||typeof document.createElement!=='function'||!root||typeof root.querySelector!=='function'
      ||(generate!==undefined&&typeof generate!=='function')
      ||(createGeometryView!==undefined&&typeof createGeometryView!=='function')
      ||(createLookupView!==undefined&&typeof createLookupView!=='function')
      ||(createAssetPreparationView!==undefined&&typeof createAssetPreparationView!=='function')
      ||(preparePdfWorker!==undefined&&typeof preparePdfWorker!=='function'))throw new TypeError('Invalid PDF mount configuration');
  const window=document.defaultView??globalThis.window;
  if(!window||typeof window.addEventListener!=='function')throw new TypeError('A PDF mount window is required');
  if(mounts.has(root))throw new TypeError('PDF root is already mounted');
  const byId=id=>root.querySelector(`#${id}`);
  // Resolve the complete template before registering a single listener.
  const required=['pdf-file','page-select','items','status-title','status-detail','operation-progress','pipeline-steps','computation-notebook','cancel','clear','build-chunks','embed-chunks','run-query','assemble-context','generate-answer','clear-query','question-input','query-top-k','trace','receipt','embedding-receipt','query-receipt','context-detail','context-meta','context-title','context-caption','generation-detail','generation-meta','generation-contract','generation-guidance','header-stage','candidate-results','candidate-meta','question-original','question-resolved','question-encoder','query-embedding-detail','query-embedding-meta','chunk-select','chunk-detail','chunk-meta','chunks-previous','chunks-next','embedding-detail','embedding-meta','items-range','items-first','items-previous','items-next','page-meta','source-cell-lookup'];
  const preparationHost=byId('asset-preparation');
  if(required.some(id=>byId(id)==null)||(createAssetPreparationView!==undefined&&preparationHost==null))throw new TypeError('Incomplete PDF mount template');
  mounts.set(root,true);
const fileInput=byId('pdf-file'),pageSelect=byId('page-select'),items=byId('items');
fileInput.disabled=true;
const ERROR_HELP={FILE_TOO_LARGE:'The PDF exceeds the 32 MiB input budget.',
  INVALID_PDF_WORKER_PREPARATION:'The static parser preparation configuration was refused. No native parser was started.',
  PDF_WORKER_PREPARATION_TIMEOUT:'The pinned parser script exceeded its separate fixed 120-second preparation budget. No native parser was started.',
  PDF_WORKER_PREPARATION_INTEGRITY:'The parser script body did not match its exact decoded size and SHA-256. No native parser was started.',
  PDF_WORKER_PREPARATION_FAILED:'Static parser preparation failed. No native parser was started.',
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
  QUERY_FAILED:'The query operation failed. Source, chunks and passage vectors are retained.',
  INVALID_CONTEXT_INPUT:'The provenance context input is invalid. Retry from an accepted retrieval.',
  INVALID_CONTEXT_ARTIFACT:'The accepted provenance artifacts are inconsistent. No context was accepted.',
  CONTEXT_FAILED:'The provenance context could not be assembled safely. Retry from an accepted retrieval.',
  INVALID_GENERATION_SESSION:'The financial generation preflight did not accept this attempt. Source, question and context are retained.',
  GENERATION_UNAVAILABLE:'This entry has no financial generation adapter.',
  GENERATION_INPUT_LIMIT:'The full prompt exceeds the generation token budget. No evidence was silently truncated.',
  PROMPT_INPUT_LIMIT:'The full prompt exceeds its text budget. No evidence was silently truncated.',
  GENERATION_TIMEOUT:'The financial generation worker exceeded its time budget. Question and context are retained for retry.',
  MODEL_LOAD_FAILED:'The pinned local generator could not initialize. Question and context are retained for retry.',
  GENERATION_FAILED:'Native financial generation failed. Question and context are retained for retry.',
  GPU_UNCAPTURED_ERROR:'The owned WebGPU device reported an error. Question and context are retained for retry.',
  ASSET_CACHE_ERROR:'The verified generation asset cache could not complete. Question and context are retained for retry.',
  TOKENIZER_MISMATCH:'The paired tokenizer frame did not match the pinned contract.',
  INVALID_FINANCIAL_RECEIPT:'The complete native financial receipt did not satisfy its contract.'};
let lastSource=null,lastChunks=null,lastEmbeddings=null,itemWindowIndex=0,chunkWindowIndex=0;
let parserPreparation=null;
let lastQuestion=undefined,lastQueryEmbedding=null,lastRetrieval=null;
let lastContext=undefined,contextOwner=null,contextView;
let lastGeneration=undefined,lastInspection=undefined,generationOwner=null,generationView;
let generationReplay=null;
let geometryView,lookupView,preparationView;
function renderLookup(state){lookupView?.render({source:session.document(),documentEpoch:state.lifecycle.documentEpoch,active:Boolean(state.lifecycle.active),cancelled:state.status==='cancelled'});}
const GENERATION_IDENTITY_KEYS=['protocolVersion','runtimeId','operationId','documentEpoch','operation'];
const sameGenerationAttempt=(identity,event)=>event!==null&&event!==undefined
  &&GENERATION_IDENTITY_KEYS.every(key=>identity[key]===event[key]);
let uiActionNonce=0,embeddingRefusal=false,queryRefusal=false,contextRefusal=false,generationRefusal=false;
let lastOperation=null,cancelledOperation=null;
function beginUiAction(){preparationView?.revoke();uiActionNonce++;if(embeddingRefusal||queryRefusal||contextRefusal||generationRefusal)render(session.snapshot());return uiActionNonce;}
function currentGeneration(raw,inspection){
  const terminal=session.snapshot().lifecycle.terminal;
  return generationOwner!==null&&generationOwner.raw===raw&&generationOwner.inspection===inspection
    &&(generationOwner.replay===null||generationOwner.replay===generationReplay)
    &&raw===session.generation()&&inspection===session.generationInspection()
    &&generationOwner.source===session.document()&&generationOwner.chunks===session.chunks()
    &&generationOwner.question===session.question()&&generationOwner.query===session.queryEmbedding()
    &&generationOwner.retrieval===session.retrieval()&&generationOwner.context===session.context()
    &&terminal!==null&&['runtimeId','operationId','documentEpoch','operation','kind','stage','seq']
      .every(key=>generationOwner.terminal[key]===terminal[key])&&session.snapshot().lifecycle.active===null;
}
function currentContext(artifact){
  return contextOwner!==null&&contextOwner.artifact===artifact&&artifact===session.context()
    &&contextOwner.source===session.document()&&contextOwner.chunks===session.chunks()
    &&contextOwner.retrieval===session.retrieval()&&session.snapshot().lifecycle.active===null;
}
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
  byId('computation-notebook').open=true;pageSelect.focus();
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
  uiActionNonce++;embeddingRefusal=false;queryRefusal=false;contextRefusal=false;generationRefusal=false;
  if(parserPreparation&&(parserPreparation.documentEpoch!==state.lifecycle.documentEpoch||state.status==='cancelled'))parserPreparation=null;
  const source=session.document(),chunks=session.chunks(),embeddings=session.embeddings();
  preparationView?.render({source,documentEpoch:state.lifecycle.documentEpoch,active:Boolean(state.lifecycle.active)});
  const raw=session.generation(),inspection=session.generationInspection();
  const titles={idle:'Waiting for a PDF',parsing:'Reading selected bytes',chunking:'Building source-linked windows',embedding:'Embedding accepted chunks',querying:'Finding sourced candidates',generating:'Generating financial output','unverified-financial-draft':'UNVERIFIED financial draft','financial-output-refused':'Financial output refused','query-candidates-only':'Query candidates; not an answer','context-not-generated':'Context assembled; not generated',cancelled:'Commit rights revoked','runtime-error':'No new result committed','extracted-not-indexed':'Extracted; not indexed','chunked-not-embedded':'Chunked; not embedded','embedded-not-retrieved':'Embedded; not retrieved'};
  byId('status-title').textContent=titles[state.status];
  if(preparePdfWorker&&state.status==='parsing'&&state.lifecycle.active?.progress?.unit==='bytes')byId('status-title').textContent='Preparing pinned parser script';
  const active=state.lifecycle.active,progress=active?.progress,bar=byId('operation-progress');
  if(generationReplay&&((!raw&&active?.operation!=='generate')
      ||!sameGenerationAttempt(generationReplay.identity,active??state.lifecycle.terminal)
      ||generationReplay.source!==source||generationReplay.chunks!==chunks
      ||generationReplay.embeddings!==embeddings||generationReplay.question!==session.question()
      ||generationReplay.query!==session.queryEmbedding()||generationReplay.retrieval!==session.retrieval()
      ||generationReplay.context!==session.context()))generationReplay=null;
  const pipeline=byId('pipeline-steps');pipeline.replaceChildren();
  for(const [index,[name,title,accepted,running]]of [
    ['parse','Read PDF',Boolean(source),state.status==='parsing'],
    ['chunk','Build chunks',Boolean(chunks),state.status==='chunking'],
    ['embed','Embed passages',Boolean(embeddings),active?.operation==='embed'],
    ['query','Retrieve candidates',Boolean(session.retrieval()),active?.operation==='query'],
    ['context','Assemble evidence',Boolean(session.context()),false],
    ['generate','Generate draft',Boolean(raw),active?.operation==='generate'],
  ].entries()){
    const step=element('li',undefined,`pipeline-step ${running?'running':accepted?'accepted':'pending'}`);
    step.setAttribute('data-stage',name);
    if(running)step.setAttribute('aria-current','step');
    const label=running?'running':accepted?'accepted artifact':name==='generate'&&!generate?'private entry only':'pending';
    step.append(element('span',String(index+1).padStart(2,'0'),'pipeline-number'),element('span',title,'pipeline-title'),element('span',label,'pipeline-state'));
    pipeline.append(step);
  }
  if(active)lastOperation=active.operation;
  else if(state.status==='cancelled'){cancelledOperation=lastOperation;lastOperation=null;}
  else{lastOperation=null;cancelledOperation=null;}
  bar.hidden=!active;
  if(progress?.total!==null&&progress?.total>0){bar.max=progress.total;bar.value=progress.completed;}
  else bar.removeAttribute('value');
  let progressText;
  if(active?.operation==='generate'){
    const packet=session.generationProgress(),event=packet?.event,detail=packet?.detail;
    if(detail){
      // Each byte event describes one prepare/consume read. SDK rereads never
      // accumulate into a one-only download percentage.
      progressText=`${event.stage} · ${detail.stage} · asset ${detail.assetIndex+1} of 8 (index ${detail.assetIndex}) · ${detail.receivedBytes.toLocaleString()} received body bytes · ${detail.verifiedBytes.toLocaleString()} verified body bytes · ${detail.totalBytes.toLocaleString()} total asset body bytes · ${detail.elapsedMs.toFixed(1)} ms elapsed. ${detail.stage==='consume'?'SDK read; repeated reads are counted separately.':'Asset preparation; received bytes are not yet verified bytes.'}`;
    }else progressText=event?`${event.stage} · ${event.payload.completed.toFixed(1)} ms measured elapsed · indeterminate stage. No token streaming or time-to-first-token measurement.`:
      'Waiting for the fresh financial worker. Adapter, assets, SDK, tokenizer, model, generation, reads and cleanup follow.';
  }else if(active?.operation==='query'){
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
  }else if(preparePdfWorker&&state.status==='parsing'&&progress?.unit==='bytes'){
    progressText=`Preparing pinned parser script · received ${progress.completed.toLocaleString()} / ${progress.total===null?'unknown':progress.total.toLocaleString()} decoded body bytes; integrity is checked at EOF. These are static-script bytes, not PDF pages or verified bytes.`;
  }else if(preparePdfWorker&&state.status==='parsing'&&parserPreparation&&progress?.unit==='pages'&&progress.total===null){
    progressText='Pinned parser script body verified. PDF hashing and native worker readiness follow with the unchanged 10-second readiness limit. HTTP cache reuse is advisory.';
  }else if(progress){progressText=`${progress.completed} / ${progress.total??'unknown'} ${progress.unit} · ${active.stage==='index'?'chunking':active.stage==='parse'?'parsing':active.stage}.`;}
  byId('status-detail').textContent=state.error?(ERROR_HELP[state.error.code]||'Work failed. No new artifact was committed.'):
    progressText?progressText:
    raw?`${raw.promptTokenIds.length} actual prompt tokens · ${raw.generatedTokenIds.length} generated token IDs · ${raw.inspection.termination} termination. Native execution is committed; output ${inspection.artifact?'shape and citation identity accepted, financial correctness unestablished':'inspection refused; complete raw output retained'}.`:
    state.status==='context-not-generated'?`${session.context().evidenceUnits.length} evidence units with complete source provenance. No prompt was built and no answer was generated.`:
    state.status==='query-candidates-only'?`${session.retrieval().returnedCount} sourced candidates · ${session.queryEmbedding().counts.totalTokens} actual query tokens · ${session.queryEmbedding().counts.dimensions} dimensions. Assemble their complete provenance context to inspect the evidence.${generate?' An explicit generation action then becomes available.':' Generation remains disabled in this entry.'}`:
    state.status==='embedded-not-retrieved'?`${embeddings.counts.chunks} chunks · ${embeddings.counts.totalTokens} actual tokens · ${embeddings.counts.dimensions} dimensions. No retrieval or generated answer yet.`:
    state.status==='chunked-not-embedded'?`${chunks.counts.chunks} chunks · ${chunks.counts.outputUtf16} output UTF-16 units · ${chunks.counts.fragments} mapping fragments. No vectors or generated answer.`:
    state.status==='extracted-not-indexed'?'Actual parser records below. No embedding index or generated answer exists.':
    state.status==='chunking'?'Waiting for the owned computation worker, then building page windows. No fabricated percentage.':
    state.status==='parsing'?'Hashing/loading/parsing are separate from accepting a result.':
    state.status==='cancelled'?(cancelledOperation==='generate'?'Late generation work cannot update this session. Source, accepted question, candidates and context retained for explicit retry.':cancelledOperation==='query'?'Late query work cannot update this session. Source, chunks and passage vectors retained for retry.':cancelledOperation==='embed'?'Late passage embedding work cannot update this session. Source and chunks retained for retry.':source?'Late chunk work cannot update this session. Source retained for retry.':'Late parsing work cannot update this session. Owned worker cleanup follows.'):'No source is stored. No embedding index or answer exists.';
  byId('cancel').disabled=!state.lifecycle.active;
  byId('build-chunks').disabled=!source||Boolean(state.lifecycle.active);
  byId('embed-chunks').disabled=!chunks||Boolean(state.lifecycle.active);
  byId('run-query').disabled=!embeddings||Boolean(active);
  byId('assemble-context').disabled=!session.retrieval()||Boolean(active);
  byId('generate-answer').disabled=!generate||!session.retrieval()||!session.context()||Boolean(active);
  byId('clear-query').disabled=Boolean(active)&&!['query','generate'].includes(active.operation);
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
  const stage=raw?`native generation · ${inspection.artifact?'unverified financial draft':'output inspection refused'}`:active?.operation==='generate'?'generating financial output':session.context()?'context; not generated':session.retrieval()?'query candidates only':embeddings?'embedded; not retrieved':chunks?'chunked; not embedded':'extracted; not indexed';
  byId('header-stage').textContent=raw?(inspection.artifact?'NATIVE RECEIPT · UNVERIFIED DRAFT':'NATIVE RECEIPT · OUTPUT REFUSED'):active?.operation==='generate'?'READER DEVICE · GENERATING':generate?'BROWSER LAB · CONTEXT NOT GENERATED':'LOCAL DRAFT · CONTEXT NOT GENERATED';
  if(source)receipt([['File',source.source.name],['Bytes',source.source.size],['SHA-256',source.source.sha256],['Parser',`PDF.js ${source.parser.version}`],['Parse worker',source.workerMode],['Compute',chunks?'native · owned module worker':'no chunk result'],['Pages',source.numPages],['Epoch',state.lifecycle.documentEpoch],['Stage',stage]]);
  else receipt([]);
  if(parserPreparation){
    const value=element('dd','');value.append(element('pre',JSON.stringify(parserPreparation.receipt,null,2)));
    byId('receipt').append(element('dt','Static parser script receipt · HTTP cache advisory'),value);
  }
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
  if(session.context()!==lastContext){
    lastContext=session.context();contextOwner=lastContext?{artifact:lastContext,source,chunks,retrieval:session.retrieval()}:null;
    contextView.render(lastContext);
  }
  byId('context-title').textContent=raw?'Retained provenance context':'Context; not generated';
  byId('context-caption').textContent=raw?'COMPLETE PROVENANCE / NATIVE OUTPUT INSPECTED SEPARATELY':'COMPLETE PROVENANCE / NO GENERATED ANSWER';
  byId('context-meta').textContent=lastContext?`${lastContext.evidenceUnits.length} evidence units · requested top K ${lastContext.retrieval.requestedTopK} · ${raw?'retained after native generation':'context not generated'}. No selected evidence was omitted.`:'No provenance context committed. Assemble an accepted retrieval to inspect its complete evidence.';
  if(raw!==lastGeneration||inspection!==lastInspection){
    lastGeneration=raw;lastInspection=inspection;
    generationOwner=raw&&inspection?{raw,inspection,source,chunks,question:session.question(),query:session.queryEmbedding(),retrieval:session.retrieval(),context:session.context(),terminal:state.lifecycle.terminal,replay:generationReplay}:null;
    generationView.render(raw,inspection,generationOwner?.replay?.input??null);
  }
  byId('generation-meta').textContent=raw?`Complete native receipt accepted at cleanup · ${inspection.status} · financial support unestablished.`:generate?'Native generation is available after accepted retrieval and explicit context assembly. Start only with Generate answer; its pinned model/runtime bodies total 815.73 MB (777.94 MiB). A first run downloads uncached assets to this device.':'Generation remains disabled in the ordinary entry. No generation adapter is configured.';
  geometryView?.render({source,documentEpoch:state.lifecycle.documentEpoch,active:Boolean(active),cancelled:state.status==='cancelled'});
  renderLookup(state);
}
function captureGenerationInput(input,settings,workerOptions){
  // The session supplies its detached, deeply frozen canonical eight-field
  // input. Retain that exact argument, never reconstruct it from prompt context.
  generationReplay=Object.freeze({input,
    identity:Object.freeze(Object.fromEntries(GENERATION_IDENTITY_KEYS.map(key=>[key,workerOptions.identity[key]]))),
    source:session.document(),chunks:session.chunks(),embeddings:session.embeddings(),
    question:session.question(),query:session.queryEmbedding(),retrieval:session.retrieval(),context:session.context()});
  return generate(input,settings,workerOptions);
}
function copyParserPreparation(raw){
  const keys=['schemaVersion','status','parserVersion','url','bytes','sha256','elapsedMs','cacheScope'];
  if(!raw||typeof raw!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(raw))
      ||Reflect.ownKeys(raw).length!==keys.length||Reflect.ownKeys(raw).some(key=>!keys.includes(key)))throw Object.assign(new Error('Invalid static parser receipt'),{code:'PDF_WORKER_PREPARATION_FAILED'});
  const value={};for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(raw,key);
    if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)throw Object.assign(new Error('Invalid static parser receipt'),{code:'PDF_WORKER_PREPARATION_FAILED'});value[key]=descriptor.value;}
  let url;try{url=new URL(value.url);}catch{}
  if(value.schemaVersion!==1||value.status!=='static-pdf-worker-body-verified'||value.parserVersion!=='6.4.299'
      ||value.bytes!==2229713||value.sha256!=='07ceb740d746e5d9012fcf9f27d5c7dea09f7d2f5e74f5c8109e5787551a2333'
      ||typeof value.url!=='string'||!url||!['http:','https:'].includes(url.protocol)||url.href!==value.url||url.search||url.hash||url.username||url.password
      ||value.url!==new URL('./vendor/build/pdf.worker.mjs',import.meta.url).href
      ||typeof value.elapsedMs!=='number'||!Number.isFinite(value.elapsedMs)||value.elapsedMs<0||value.elapsedMs>=120000||value.cacheScope!=='browser-http-cache-advisory')
    throw Object.assign(new Error('Invalid static parser receipt'),{code:'PDF_WORKER_PREPARATION_FAILED'});
  return Object.freeze(value);
}
async function extractWithPreparation(file,parserOptions){
  const {signal,onProgress}=parserOptions,epoch=session.snapshot().lifecycle.documentEpoch;
  const aborted=()=>Object.assign(new Error('Static parser preparation cancelled'),{code:'ABORTED'});
  if(signal.aborted)throw aborted();
  let listener,preparing=true;
  const revoked=new Promise((_,reject)=>{listener=()=>reject(aborted());signal.addEventListener('abort',listener,{once:true});});
  try{
    const options=Object.freeze({signal,onProgress:value=>{if(preparing&&!signal.aborted)onProgress(value);}});
    const prepared=await Promise.race([Promise.resolve().then(()=>{
      if(signal.aborted)throw aborted();return preparePdfWorker(options);
    }),revoked]);
    if(signal.aborted)throw aborted();
    const copied=copyParserPreparation(prepared);if(signal.aborted)throw aborted();
    parserPreparation=Object.freeze({documentEpoch:epoch,receipt:copied});
    preparing=false;onProgress(Object.freeze({completed:0,total:null,unit:'pages',estimated:false}));
    if(signal.aborted)throw aborted();
  }catch(error){
    if(signal.aborted)throw aborted();
    // Only this optional preparation boundary normalizes arbitrary hook values.
    // Do not evaluate rejection getters in the existing parser session.
    let code='PDF_WORKER_PREPARATION_FAILED';
    try{
      const property=error!==null&&['object','function'].includes(typeof error)?Object.getOwnPropertyDescriptor(error,'code'):null;
      if(property&&Object.hasOwn(property,'value')&&typeof property.value==='string'
          &&['INVALID_PDF_WORKER_PREPARATION','PDF_WORKER_PREPARATION_TIMEOUT','PDF_WORKER_PREPARATION_INTEGRITY','PDF_WORKER_PREPARATION_FAILED','ABORTED'].includes(property.value))code=property.value;
    }catch{}
    throw Object.assign(new Error('Static parser preparation did not complete safely'),{code});
  }finally{preparing=false;signal.removeEventListener('abort',listener);}
  // Preserve every original extraction result/error after preparation succeeds.
  return extractPdf(file,parserOptions);
}
const session=createPdfSession({extract:preparePdfWorker===undefined?extractPdf:extractWithPreparation,parserOptions:{pdfjs,
  assetBaseUrl:new URL('./vendor/',import.meta.url).href,
  workerFactory:url=>new Worker(url,{type:'module'})},
  compute:chunkInWorker,computeOptions:{workerFactory:url=>new Worker(url,{type:'module'})},
  embed:embedInWorker,embeddingOptions:{workerFactory:url=>new Worker(url,{type:'module'})},
  query:queryInWorker,queryOptions:{workerFactory:url=>new Worker(url,{type:'module'})},
  generate:generate===undefined?undefined:captureGenerationInput,onState:render});
if(preparationHost!=null)preparationHost.hidden=createAssetPreparationView===undefined;
if(createAssetPreparationView!==undefined){
  preparationView=createAssetPreparationView({document,root:preparationHost});
  if(!preparationView||typeof preparationView.render!=='function'||typeof preparationView.revoke!=='function')throw new TypeError('Invalid asset preparation view');
}
contextView=createContextView({document,root:byId('context-detail'),isCurrent:currentContext,
  onInspect:(unit,artifact)=>{if(currentContext(artifact))inspectCandidate(unit,contextOwner.source,contextOwner.chunks,contextOwner.retrieval);}});
generationView=createGenerationView({document,root:byId('generation-detail'),isCurrent:currentGeneration,
  onInspect:(binding,raw,inspection)=>{if(currentGeneration(raw,inspection))inspectCandidate(binding,generationOwner.source,generationOwner.chunks,generationOwner.retrieval);}});
// Only the private entry owns geometry imports. The shared app forwards its
// accepted source/epoch to an explicitly configured presentation factory.
if(createGeometryView!==undefined){
  geometryView=createGeometryView({document,root:byId('computation-notebook')});
  if(!geometryView||typeof geometryView.render!=='function')throw new TypeError('Invalid geometry view');
}
byId('source-cell-lookup').hidden=createLookupView===undefined;
if(createLookupView!==undefined){
  lookupView=createLookupView({document,root:byId('source-cell-lookup')});
  if(!lookupView||typeof lookupView.render!=='function')throw new TypeError('Invalid lookup view');
}
byId('generation-contract').hidden=!generate;
byId('generation-guidance').textContent=generate?'Assemble all selected evidence first, then explicitly generate with the paired Qwen model. Inspect the original native output and each cited source; a draft is unverified.':'Assemble context after an accepted retrieval to inspect every selected evidence unit. Generation remains disabled in this entry. Sourced candidates are not a verified answer.';
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
byId('assemble-context').addEventListener('click',()=>{
  const action=beginUiAction(),state=session.snapshot(),source=session.document(),chunks=session.chunks(),embeddings=session.embeddings();
  const question=session.question(),query=session.queryEmbedding(),retrieval=session.retrieval(),context=session.context();
  if(state.lifecycle.active!==null||retrieval===null)return;
  try{session.assembleContext();}catch(cause){
    const current=session.snapshot();
    if(action!==uiActionNonce||current.lifecycle.documentEpoch!==state.lifecycle.documentEpoch||current.lifecycle.active!==null
        ||source!==session.document()||chunks!==session.chunks()||embeddings!==session.embeddings()
        ||question!==session.question()||query!==session.queryEmbedding()||retrieval!==session.retrieval()||context!==session.context())return;
    const safe=new ContextError(cause instanceof ContextError?cause.code:undefined);
    contextRefusal=true;byId('status-title').textContent='Context did not assemble';
    byId('status-detail').textContent=`${safe.code} · ${ERROR_HELP[safe.code]} Source, chunks and accepted query artifacts are retained.`;
  }
});
byId('generate-answer').addEventListener('click',()=>{
  const action=beginUiAction(),state=session.snapshot(),source=session.document(),chunks=session.chunks();
  const question=session.question(),query=session.queryEmbedding(),retrieval=session.retrieval(),context=session.context();
  if(!generate||!retrieval||!context||state.lifecycle.active!==null)return;
  void session.generate().catch(()=>{
    const current=session.snapshot();
    if(action!==uiActionNonce||current.lifecycle.documentEpoch!==state.lifecycle.documentEpoch||current.lifecycle.active!==null
      ||source!==session.document()||chunks!==session.chunks()||question!==session.question()
      ||query!==session.queryEmbedding()||retrieval!==session.retrieval()||context!==session.context())return;
    generationRefusal=true;byId('status-title').textContent='Generation did not start';
    byId('status-detail').textContent=`INVALID_GENERATION_SESSION · ${ERROR_HELP.INVALID_GENERATION_SESSION}`;
  });
});
// clearQuery can be a no-op before any query exists; the private comparator
// still revokes its independent request/digest on every main-question edit.
for(const id of ['question-input','query-top-k'])byId(id).addEventListener('input',()=>{beginUiAction();session.clearQuery();renderLookup(session.snapshot());});
byId('clear-query').addEventListener('click',()=>{beginUiAction();session.clearQuery();byId('question-input').value='';renderLookup(session.snapshot());});
byId('chunk-select').addEventListener('change',()=>{beginUiAction();showChunk();});
byId('chunks-previous').addEventListener('click',()=>{beginUiAction();chunkWindowIndex--;showChunkWindow();});
byId('chunks-next').addEventListener('click',()=>{beginUiAction();chunkWindowIndex++;showChunkWindow();});
window.addEventListener('pagehide',()=>{beginUiAction();session.clear();fileInput.value='';});
window.addEventListener('pageshow',()=>{
  if(session.document()===null&&session.snapshot().lifecycle.active===null)fileInput.value='';
});
// A reload creates an empty session, even if browser form restoration retained
// a previous file. Release that selection so choosing the same PDF emits change.
fileInput.value='';
render(session.snapshot());
showChunkWindow();
// Allow selection only after this mount owns its listeners and initial view.
fileInput.disabled=false;
return Object.freeze({root});
}
