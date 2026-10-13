import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPageRecord} from '../pdf-source.mjs';
import {createPdfSession} from '../pdf-session.mjs';
import {createComputeCommandHandler} from '../compute.worker.mjs';
import {embedInWorker,embeddingReceipt} from '../embedding-source.mjs';
import {queryInWorker,queryResultReceipt} from '../query-source.mjs';
import {rankCandidates} from '../retrieval.mjs';
import {ContextError} from '../context-contract.mjs';
import {createGenerationView} from '../generation-view.mjs';
import {createRetrievalInspectionView} from '../retrieval-inspection-view.mjs';
import {createCompleteRecordDisclosure} from '../complete-record-disclosure.mjs';
import {EMBEDDING_SPEC} from '../embedding-contract.mjs';

const windowModule = await import('../item-window.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return null;
});
const getItemWindow = windowModule?.getItemWindow ?? (() => assert.fail('The fixed-size item preview window is missing.'));
const contextModule = await import('../context-view.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return null;
});
const createContextView = contextModule?.createContextView ?? (() => assert.fail('The provenance context view is missing.'));

test('item windows expose at most 100 positions without changing the total', () => {
  assert.deepEqual(getItemWindow(100000, 0), {
    start: 0, end: 100, total: 100000, windowIndex: 0, windowCount: 1000,
    hasPrevious: false, hasNext: true,
  });
  assert.deepEqual(getItemWindow(251, 1), {
    start: 100, end: 200, total: 251, windowIndex: 1, windowCount: 3,
    hasPrevious: true, hasNext: true,
  });
  assert.equal(getItemWindow(251, 2).end, 251);
});

test('empty and single windows have no navigation destinations', () => {
  assert.deepEqual(getItemWindow(0), {
    start: 0, end: 0, total: 0, windowIndex: 0, windowCount: 0,
    hasPrevious: false, hasNext: false,
  });
  for (const total of [1, 99, 100]) {
    const result = getItemWindow(total);
    assert.equal(result.start, 0);
    assert.equal(result.end, total);
    assert.equal(result.hasPrevious, false);
    assert.equal(result.hasNext, false);
  }
});

test('valid out-of-range requests clamp to a complete existing window', () => {
  assert.equal(getItemWindow(251, -1).windowIndex, 0);
  assert.deepEqual(getItemWindow(251, 500), getItemWindow(251, 2));
  assert.deepEqual(getItemWindow(0, 500), getItemWindow(0));
  const largest = getItemWindow(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  assert.equal(largest.end, Number.MAX_SAFE_INTEGER);
  assert.ok(largest.end - largest.start <= 100);
  assert.equal(largest.hasNext, false);
});

test('malformed totals and window requests are rejected', () => {
  for (const total of [-1, 1.5, '100', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => getItemWindow(total), TypeError);
  }
  for (const requested of [1.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => getItemWindow(100, requested), TypeError);
  }
});

// DOM/extraction/worker-channel boundaries are substituted. Actual app body,
// session controller and source/chunk transforms run; this is not native-worker
// or real-browser acceptance.
class DomElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase(); this.children = []; this.listeners = new Map();
    this._text = ''; this._value = ''; this.disabled = false; this.open = false;
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  append(...nodes) {
    this.children.push(...nodes);
    if (this.tagName === 'SELECT' && this._value === '' && nodes.length) this.value = nodes[0].value;
  }
  replaceChildren(...nodes) {
    this.children = []; this._text = '';
    if (this.tagName === 'SELECT') this._value = '';
    this.append(...nodes);
  }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  removeEventListener(name,listener){this.listeners.set(name,(this.listeners.get(name)??[]).filter(value=>value!==listener));}
  dispatch(name) { for (const listener of this.listeners.get(name) ?? []) listener({target: this}); }
  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute(name) { if (name === 'value') this._value = ''; }
  focus() { this.focused = true; }
}

const appText = await readFile(new URL('../pdf-app.mjs', import.meta.url), 'utf8');
const htmlText = await readFile(new URL('../inspector.html', import.meta.url), 'utf8');
const elementsOf = (element, tag) => element.children.flatMap(child => [
  ...(child.tagName === tag.toUpperCase() ? [child] : []), ...elementsOf(child, tag),
]);
function completeRecordText(detail){
  const pre=elementsOf(detail,'pre')[0];assert.ok(pre);
  if(pre.className!=='bounded-text-page')return pre.textContent;
  const button=name=>elementsOf(detail,'button').find(n=>n.textContent===name),previous=button('Previous page'),next=button('Next page'),parts=[];
  while(!previous.disabled)previous.dispatch('click');
  for(let i=0;i<100000;i++){assert.ok(pre.textContent.length<=24576);assert.ok(pre.textContent.split(/\r\n|[\r\n]/).length<=160);parts.push(pre.textContent);if(next.disabled)return parts.join('');next.dispatch('click');}
  assert.fail('Complete record did not reach final page');
}

function sourceRecord(name, counts, firstText = '<img src=x onerror=alert(1)>') {
  const sha256 = 'a'.repeat(64);
  const pages = counts.map((count, index) => createPageRecord({sourceSha256: sha256,
    parserVersion: '6.4.299', physicalPageNumber: index + 1, pageLabel: `label-${index + 1}`,
    page: {view: [0, 0, 612, 792], rotate: 0, userUnit: 1},
    textContent: {items: Array.from({length: count}, (_, itemIndex) => ({
      str: itemIndex === 0 ? firstText : `${name} page ${index + 1} item ${itemIndex}`,
      dir: 'ltr', transform: [1, 0, 0, 1, 10, 10], width: 10, height: 10, fontName: 'F1', hasEOL: false,
    }))},
  }));
  return Object.freeze({schemaVersion:1,status: 'extracted-not-indexed',
    source: Object.freeze({name, sha256, size: 8}), parser: Object.freeze({name:'pdfjs',version: '6.4.299',policyVersion:'text-items-v1',disableNormalization:true}),
    workerMode: 'native', numPages: pages.length, pages: Object.freeze(pages)});
}

function appHarness(sources, computeOverride, {embed = embedInWorker,query = queryInWorker,runtimeIdFactory,onState} = {}) {
  const ids = new Map();
  for (const id of ['pdf-file', 'page-select', 'items', 'receipt', 'page-meta', 'status-title',
    'status-detail', 'cancel', 'clear', 'trace', 'items-first', 'items-previous', 'items-next', 'items-range',
    'build-chunks','chunk-select','chunk-detail','chunk-meta','chunks-previous','chunks-next',
    'embed-chunks','embedding-detail','embedding-meta','embedding-receipt','operation-progress',
    'question-input','query-top-k','run-query','clear-query','question-original','question-resolved','question-encoder',
    'candidate-results','candidate-meta','query-embedding-detail','query-embedding-meta','query-receipt',
    'assemble-context','generate-answer','context-detail','context-meta','context-title','context-caption',
    'generation-detail','generation-meta','generation-contract','generation-guidance','header-stage',
    'pipeline-steps','computation-notebook','source-cell-lookup']) {
    ids.set(id, new DomElement(['page-select','chunk-select'].includes(id) ? 'select' : 'div'));
  }
  ids.get('assemble-context').disabled=true;ids.get('generate-answer').disabled=true;
  ids.get('query-top-k').value=5;
  const document = {getElementById: id => ids.get(id), querySelector: selector => ids.get(selector.slice(1)), createElement: tag => new DomElement(tag)};
  const allItems = new Set(sources.flatMap(source => source.pages.flatMap(page => page.textItems)));
  const serializedItems = [],serializedChunks=[];
  const checkedJson = {...JSON, stringify(value, ...args) {
    if (allItems.has(value)) serializedItems.push(value);
    if(value?.segments&&value?.id)serializedChunks.push(value);
    return JSON.stringify(value, ...args);
  }};
  let session;
  const executable = appText.replace(/^import .*;\r?\n/gm, '')
    .replace(/^export function mountPdfApp/m, 'function mountPdfApp')
    .replaceAll('import.meta.url', JSON.stringify(new URL('../pdf-app.mjs', import.meta.url).href));
  const run = new Function('document', 'window', 'Worker', 'pdfjs', 'extractPdf',
    'createPdfSession', 'getItemWindow', 'JSON', 'chunkInWorker', 'embedInWorker', 'queryInWorker',
    'createContextView','createGenerationView','createCompleteRecordDisclosure','createRetrievalInspectionView','ContextError',`${executable}\ndocument.defaultView=window;mountPdfApp({document,root:document});`);
  const compute=computeOverride??(async(source,{identity,onProgress,chunkOptions})=>{
    const packets=[];createComputeCommandHandler(packet=>packets.push(packet))({kind:'chunk-source',identity,source,options:chunkOptions??{}});
    onProgress(packets[0].event);
    const terminal=packets.at(-1);if(terminal.event.kind==='error')throw Object.assign(new Error('safe test error'),{code:terminal.event.payload.code});
    return terminal;
  });
  let runtimeNumber=0;
  run(document, {addEventListener() {}}, class {}, {}, async file => sources.find(source => source.source.name === file.name),
    options => { session = createPdfSession({...options,onState:state=>{options.onState(state);onState?.(state,session);},
      runtimeId: 'preview-test',runtimeIdFactory:runtimeIdFactory??(()=>`compute-test-${++runtimeNumber}`)}); return session; },
    getItemWindow,checkedJson,compute,embed,query,createContextView,createGenerationView,createCompleteRecordDisclosure,createRetrievalInspectionView,ContextError);
  return {ids, serializedItems,serializedChunks, select: name => session.select({name}), source: () => session.document(),
    chunk:options=>session.chunk(options),embed:()=>session.embed(),query:(question,options)=>session.query(question,options),
    context:()=>session.context(),retrieval:()=>session.retrieval(),chunks:()=>session.chunks(),embeddings:()=>session.embeddings(),state:()=>session.snapshot(),
    rows: () => elementsOf(ids.get('items'), 'article')};
}

test('the actual app renders only the first 100 records and preserves hostile text as text', async () => {
  const source = sourceRecord('A', [251]); const app = appHarness([source]);
  await app.select('A');
  assert.equal(app.rows().length, 100);
  assert.equal(app.rows()[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(elementsOf(app.ids.get('items'), 'img').length, 0);
  assert.equal(app.source(), source);
  assert.equal(source.pages[0].textItems.length, 251);
  assert.equal(Object.isFrozen(source.pages[0].textItems), true);
  assert.match(app.ids.get('items-range').textContent, /1\D+100.*251/);
  assert.equal(app.ids.get('items-first').disabled, true);
  assert.equal(app.ids.get('items-previous').disabled, true);
  assert.equal(app.ids.get('items-next').disabled, false);
});

test('the actual app reaches every record through next previous and first controls', async () => {
  const source = sourceRecord('A', [251]); const app = appHarness([source]);
  await app.select('A');
  app.ids.get('items-next').dispatch('click');
  assert.equal(app.rows().length, 100);
  assert.match(app.rows()[0].children[0].textContent, /^ITEM 100 /);
  assert.match(app.ids.get('items-range').textContent, /101\D+200.*251/);
  app.ids.get('items-next').dispatch('click');
  assert.equal(app.rows().length, 51);
  assert.match(app.rows()[50].children[0].textContent, /^ITEM 250 /);
  assert.equal(app.ids.get('items-next').disabled, true);
  app.ids.get('items-previous').dispatch('click');
  assert.match(app.rows()[0].children[0].textContent, /^ITEM 100 /);
  app.ids.get('items-first').dispatch('click');
  assert.match(app.rows()[0].children[0].textContent, /^ITEM 0 /);
  assert.equal(app.source(), source);
  assert.equal(source.pages[0].textItems[250].text, 'A page 1 item 250');
});

test('the actual app serializes item details only while opened and releases text when closed', async () => {
  const app = appHarness([sourceRecord('A', [251])]); await app.select('A');
  assert.equal(app.serializedItems.length, 0, 'Collapsed item details must not serialize source records.');
  assert.equal(elementsOf(app.ids.get('items'), 'pre').length, 0);
  const detail = elementsOf(app.rows()[0], 'details')[0];
  detail.open = true; detail.dispatch('toggle');
  assert.deepEqual(JSON.parse(completeRecordText(detail)),app.source().pages[0].textItems[0]);
  assert.equal(elementsOf(detail, 'pre').length, 1);
  assert.match(elementsOf(detail, 'pre')[0].textContent, /"itemIndex": 0/);
  detail.open = false; detail.dispatch('toggle');
  assert.equal(elementsOf(detail, 'pre').length, 0);
  assert.equal(detail.children.length, 1, 'The summary remains available after releasing generated JSON text.');
  detail.open = true; detail.dispatch('toggle');
  assert.deepEqual(JSON.parse(completeRecordText(detail)),app.source().pages[0].textItems[0]);
});

test('the actual app resets the preview when physical page or source changes', async () => {
  const a = sourceRecord('A', [251, 201, 0]), b = sourceRecord('B', [202]);
  const app = appHarness([a, b]); await app.select('A');
  app.ids.get('items-next').dispatch('click');
  app.ids.get('page-select').value = 1; app.ids.get('page-select').dispatch('change');
  assert.match(app.rows()[0].children[0].textContent, /^ITEM 0 /);
  assert.match(app.ids.get('items-range').textContent, /1\D+100.*201/);
  app.ids.get('items-next').dispatch('click');
  await app.select('B');
  assert.match(app.rows()[0].children[0].textContent, /^ITEM 0 /);
  assert.match(app.ids.get('items-range').textContent, /1\D+100.*202/);
  await app.select('A');
  app.ids.get('page-select').value = 2; app.ids.get('page-select').dispatch('change');
  assert.equal(app.rows().length, 0);
  assert.match(app.ids.get('items-range').textContent, /0.*0/);
  for (const id of ['items-first', 'items-previous', 'items-next']) assert.equal(app.ids.get(id).disabled, true);
  app.ids.get('clear').dispatch('click');
  assert.equal(app.source(), null);
  assert.match(app.ids.get('items-range').textContent, /0.*0/);
});

test('the source inspector has visible accessible item navigation without inline handlers', () => {
  for (const id of ['items-first', 'items-previous', 'items-next', 'items-range']) {
    assert.match(htmlText, new RegExp(`id="${id}"`));
  }
  assert.match(htmlText, /aria-label="Text item preview"/);
  assert.doesNotMatch(htmlText, /\son(?:click|change|toggle)=/i);
  assert.doesNotMatch(appText, /\.innerHTML\s*=/);
});

test('the actual app shows attributable chunks and authored separators without treating hostile text as HTML',async()=>{
  const app=appHarness([sourceRecord('A',[3])]);await app.select('A');
  assert.equal(app.ids.get('build-chunks').disabled,false);await app.chunk();
  assert.equal(app.ids.get('status-title').textContent,'Chunked; not embedded');
  assert.equal(app.ids.get('chunk-select').disabled,false);
  assert.equal(app.ids.get('chunk-select').children.length,1);
  assert.match(app.ids.get('chunk-meta').textContent,/physical page 1/);
  assert.match(app.ids.get('chunk-detail').textContent,/<img src=x onerror=alert\(1\)>/);
  assert.match(app.ids.get('chunk-detail').textContent,/inserted · no source span/);
  assert.equal(elementsOf(app.ids.get('chunk-detail'),'img').length,0);
  assert.equal(app.serializedChunks.length,0);
  const detail=elementsOf(app.ids.get('chunk-detail'),'details')[0];
  detail.open=true;detail.dispatch('toggle');assert.deepEqual(JSON.parse(completeRecordText(detail)),app.chunks().chunks[0]);
  detail.open=false;detail.dispatch('toggle');assert.equal(elementsOf(detail,'pre').length,0);
});

test('a computation-worker startup failure does not misidentify the parser or discard accepted source',async()=>{
  const source=sourceRecord('A',[2]);
  const app=appHarness([source],async()=>{throw Object.assign(new Error('private worker diagnostic'),{code:'WORKER_UNAVAILABLE'});});
  await app.select('A');await app.chunk();
  assert.equal(app.source(),source);assert.equal(app.chunks(),null);
  assert.equal(app.ids.get('build-chunks').disabled,false);
  assert.match(app.ids.get('status-detail').textContent,/native worker could not start/i);
  assert.doesNotMatch(app.ids.get('status-detail').textContent,/parsing worker|private worker diagnostic/i);
});

test('chunk selector windows stay bounded and clear old artifacts on clear or identical-hash replacement',async()=>{
  const app=appHarness([sourceRecord('A',[251]),sourceRecord('B',[2])]);await app.select('A');
  await app.chunk({maxChunkUtf16:8,overlapUtf16:0});
  assert.ok(app.chunks().chunks.length>100);
  assert.equal(app.ids.get('chunk-select').children.length,100);
  app.ids.get('chunks-next').dispatch('click');
  assert.equal(app.ids.get('chunk-select').children.length,100);
  assert.equal(app.ids.get('chunk-select').children[0].value,'100');
  assert.match(app.ids.get('chunk-meta').textContent,/Chunk 101 /);
  app.ids.get('chunks-previous').dispatch('click');assert.match(app.ids.get('chunk-meta').textContent,/Chunk 1 /);
  await app.select('B');assert.equal(app.chunks(),null);assert.equal(app.ids.get('chunk-select').disabled,true);
  assert.doesNotMatch(app.ids.get('chunk-detail').textContent,/A page/);
  await app.chunk();app.ids.get('clear').dispatch('click');
  assert.equal(app.chunks(),null);assert.equal(app.source(),null);assert.equal(app.ids.get('build-chunks').disabled,true);
  assert.equal(app.ids.get('chunks-previous').disabled,true);assert.equal(app.ids.get('chunks-next').disabled,true);
});

test('chunk cancellation keeps the source and retry control while preventing a late UI result',async()=>{
  let resolve;const pending=new Promise(done=>{resolve=done;});
  const app=appHarness([sourceRecord('A',[2])],()=>pending);await app.select('A');
  const operation=app.chunk();assert.equal(app.ids.get('cancel').disabled,false);
  assert.equal(app.ids.get('build-chunks').disabled,true);app.ids.get('cancel').dispatch('click');
  assert.equal(app.source().source.name,'A');assert.equal(app.chunks(),null);
  assert.equal(app.ids.get('build-chunks').disabled,false);assert.equal(app.ids.get('cancel').disabled,true);
  const before=app.ids.get('chunk-detail').textContent;resolve({});await operation;
  assert.equal(app.ids.get('status-title').textContent,'Commit rights revoked');
  assert.equal(app.ids.get('chunk-detail').textContent,before);
});

const uiTurn = () => new Promise(resolve => setImmediate(resolve));
const acceptedAppState = app => ({source:app.source(),chunks:app.chunks(),embeddings:app.embeddings(),state:app.state(),
  page:app.ids.get('page-select').value,chunk:app.ids.get('chunk-select').value,
  chunkDetail:app.ids.get('chunk-detail').textContent,embeddingDetail:app.ids.get('embedding-detail').textContent,
  trace:app.ids.get('trace').textContent});
function assertPreflightRefusal(app) {
  assert.equal(app.ids.get('status-title').textContent,'Embedding did not start');
  assert.equal(app.ids.get('status-detail').textContent,
    'INVALID_EMBEDDING_CONFIG · The accepted chunks exceed the embedding input contract or the configuration is invalid. Source, chunks and any accepted vectors are retained.');
  assert.equal(app.ids.get('operation-progress').hidden,true);
}
function successfulEmbedding(input,{identity,onProgress}) {
  const count=input.counts.chunks,bytes=113629084;
  const artifact={schemaVersion:1,status:'embedded-not-retrieved',sourceSha256:input.source.sha256,
    representationId:EMBEDDING_SPEC.version,representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',
    counts:{chunks:count,totalTokens:count*3,dimensions:384},
    receipt:{verifiedBytes:bytes,networkBytes:bytes,cacheBytes:0,elapsedMs:12.5},
    chunkIds:input.chunks.map(chunk=>chunk.id),tokenIds:input.chunks.map(()=>[101,1000,102]),
    vectors:input.chunks.map(()=>[1,...Array(383).fill(0)])};
  for(const [index,[stage,completed,total,unit]] of [
    ['download',0,bytes,'bytes'],['download',bytes,bytes,'bytes'],['initialize',0,null,'chunks'],
    ['encode',0,count,'chunks'],['encode',count,count,'chunks'],
  ].entries())onProgress({...identity,kind:'progress',stage,seq:index+1,payload:{completed,total,unit,estimated:false}});
  return {event:{...identity,kind:'result',stage:'encode',seq:6,payload:{data:embeddingReceipt(artifact)}},artifact};
}
const axisVector = axis => Array.from({length:384},(_,index)=>index===axis?1:0);
function distinctEmbedding(input,options) {
  const result=successfulEmbedding(input,options);
  result.artifact.vectors=input.chunks.map((_,index)=>axisVector(index===1?1:0));
  return result;
}
function successfulQuery(input,passages,question,{identity,onProgress,topK}) {
  const count=input.counts.chunks,bytes=113629084;
  for(const [index,[stage,completed,total,unit]] of [
    ['download',0,bytes,'bytes'],['download',bytes,bytes,'bytes'],['initialize',0,null,'tokens'],
    ['encode',0,3,'tokens'],['encode',3,3,'tokens'],['rank',0,count,'chunks'],['rank',count,count,'chunks'],
  ].entries())onProgress({...identity,kind:'progress',stage,seq:index+1,payload:{completed,total,unit,estimated:false}});
  const query={schemaVersion:1,status:'query-embedded-not-retrieved',representationId:EMBEDDING_SPEC.version,
    representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',tokenIds:[101,44,102],vector:axisVector(1),
    counts:{totalTokens:3,dimensions:384},receipt:{verifiedBytes:bytes,networkBytes:0,cacheBytes:bytes,elapsedMs:1}};
  const artifact={query,retrieval:rankCandidates(input,passages,
    {representationId:query.representationId,representation:query.representation,vector:query.vector},{topK})};
  return {event:{...identity,kind:'result',stage:'rank',seq:8,payload:{data:queryResultReceipt(artifact)}},artifact};
}
const RAW_CONTEXT_QUESTION='  <img src=x onerror=alert(1)>\n財報 😀?  ';
const contextRows=app=>elementsOf(app.ids.get('context-detail'),'article');
const contextButton=(app,className)=>elementsOf(app.ids.get('context-detail'),'button').find(button=>button.className===className);
async function contextApp({large=false,source,onState}={}) {
  const app=appHarness([source??sourceRecord('A',large?Array(251).fill(1):[2,1,1],
    '  EXACT <script>alert(1)</script>\n證據 😀  '),sourceRecord('B',[1])],undefined,
  {embed:distinctEmbedding,query:successfulQuery,onState});
  await app.select('A');await app.chunk();await app.embed();
  app.ids.get('question-input').value=RAW_CONTEXT_QUESTION;app.ids.get('query-top-k').value=large?251:3;
  return app;
}
async function commitContext(app) {
  app.ids.get('run-query').dispatch('click');await uiTurn();
  assert.equal(app.state().status,'query-candidates-only');
  app.ids.get('assemble-context').dispatch('click');
  assert.equal(app.state().status,'context-not-generated');
  return app.context();
}

test('the actual app enables Assemble only for an accepted retrieval and preserves the rank terminal on context success',async()=>{
  const app=await contextApp();
  assert.equal(app.ids.get('assemble-context').disabled,true);
  assert.equal(app.ids.get('generate-answer').disabled,true);
  const before=app.state();app.ids.get('assemble-context').dispatch('click');assert.deepEqual(app.state(),before);
  app.ids.get('run-query').dispatch('click');
  assert.equal(app.ids.get('assemble-context').disabled,true,'In-flight rank work has no context commit rights.');
  await uiTurn();assert.equal(app.ids.get('assemble-context').disabled,false);
  const lifecycle=app.state().lifecycle,trace=app.ids.get('trace').textContent;
  app.ids.get('assemble-context').dispatch('click');
  assert.equal(app.context().status,'context-not-generated');
  assert.equal(app.ids.get('status-title').textContent,'Context assembled; not generated');
  assert.match(app.ids.get('status-detail').textContent,/3 evidence units/);
  assert.match(app.ids.get('receipt').textContent,/context; not generated/);
  assert.deepEqual(app.state().lifecycle,lifecycle);assert.equal(app.ids.get('trace').textContent,trace);
  assert.equal(app.ids.get('operation-progress').hidden,true);
  assert.equal(app.ids.get('generate-answer').disabled,true);
  assert.match(app.ids.get('context-meta').textContent,/3 evidence units/);
});

test('the actual app displays exact question and provenance while lazy details retain full quotes and segment JSON',async()=>{
  const app=await contextApp();const context=await commitContext(app),root=app.ids.get('context-detail');
  const question=root.children.find(child=>child.className==='context-question');
  assert.equal(question.textContent,RAW_CONTEXT_QUESTION);
  for(const value of [context.source.sha256,context.source.name,String(context.source.size),
    context.parser.name,context.parser.version,context.parser.policyVersion])assert.ok(root.textContent.includes(value));
  assert.ok(root.textContent.includes('omissions: []'));
  const first=contextRows(app)[0],unit=context.evidenceUnits[0];
  assert.equal(unit.citationId,'E2');assert.equal(unit.rank,1);assert.equal(unit.ordinal,1);
  assert.match(first.textContent,/E2 · rank 1 · source chunk 2/);
  assert.match(first.textContent,/physical page 2 · PDF label "label-2"/);
  assert.ok(first.textContent.includes(`UTF-16 [${unit.startUtf16}, ${unit.endUtf16})`));
  assert.ok(first.textContent.includes(unit.chunkId));
  assert.equal(first.textContent.includes(unit.text),false,'Full quote stays out of collapsed cards.');
  assert.equal(elementsOf(first,'pre').length,0);
  const detail=elementsOf(first,'details')[0];detail.open=true;detail.dispatch('toggle');
  assert.equal(elementsOf(detail,'p').find(child=>child.className==='quote').textContent,unit.text);
  const mapping=elementsOf(detail,'details').find(node=>node.children[0]?.textContent==='Complete mapping segments JSON');
  mapping.open=true;mapping.dispatch('toggle');assert.equal(completeRecordText(mapping),JSON.stringify(unit.segments,null,2));
  assert.equal(elementsOf(root,'script').length,0);assert.equal(elementsOf(root,'img').length,0);
  detail.open=false;detail.dispatch('toggle');assert.equal(detail.children.length,1);assert.equal(elementsOf(detail,'pre').length,0);
  assert.equal(detail.textContent.includes(unit.text),false);
  const mappedIndex=context.evidenceUnits.findIndex(evidence=>evidence.segments.length>1),mappedUnit=context.evidenceUnits[mappedIndex];
  assert.ok(mappedUnit.segments.some(segment=>segment.kind==='presentation'),'Fixture includes authored separators and multiple exact source spans.');
  const mappedDetail=elementsOf(contextRows(app)[mappedIndex],'details')[0];mappedDetail.open=true;mappedDetail.dispatch('toggle');
  const mappedJSON=elementsOf(mappedDetail,'details').find(node=>node.children[0]?.textContent==='Complete mapping segments JSON');
  mappedJSON.open=true;mappedJSON.dispatch('toggle');assert.equal(completeRecordText(mappedJSON),JSON.stringify(mappedUnit.segments,null,2));
  assert.equal(elementsOf(mappedDetail,'p').find(child=>child.className==='quote').textContent,mappedUnit.text);
  mappedDetail.open=false;mappedDetail.dispatch('toggle');
  const source=app.source(),chunks=app.chunks(),retrieval=app.retrieval();
  elementsOf(first,'button')[0].dispatch('click');
  assert.equal(app.ids.get('page-select').value,'1');assert.match(app.ids.get('chunk-meta').textContent,/Chunk 2 /);
  assert.equal(app.source(),source);assert.equal(app.chunks(),chunks);assert.equal(app.retrieval(),retrieval);assert.equal(app.context(),context);
  assert.equal(contextRows(app)[0],first,'Source inspection must not recreate an unchanged context artifact.');
});

test('the actual app reaches all selected context evidence through bounded windows without omission',async()=>{
  const app=await contextApp({large:true}),context=await commitContext(app),source=app.source(),chunks=app.chunks();
  assert.equal(context.evidenceUnits.length,251);assert.equal(Object.isFrozen(context.evidenceUnits),true);
  const seen=[];
  for(let window=0;window<3;window++){
    const rows=contextRows(app);assert.equal(rows.length,window===2?51:100);
    for(const [index,row]of rows.entries()){
      const unit=context.evidenceUnits[window*100+index];assert.ok(row.textContent.startsWith(`${unit.citationId} · rank ${unit.rank} · source chunk ${unit.ordinal+1}`));
      const detail=elementsOf(row,'details')[0];detail.open=true;detail.dispatch('toggle');
      assert.equal(elementsOf(detail,'p').find(child=>child.className==='quote').textContent,unit.text);
      detail.open=false;detail.dispatch('toggle');seen.push(unit.citationId);
    }
    const next=contextButton(app,'context-next');assert.equal(next.disabled,window===2);if(window<2)next.dispatch('click');
  }
  assert.deepEqual(seen,context.evidenceUnits.map(unit=>unit.citationId));assert.equal(new Set(seen).size,251);
  const last=contextRows(app).at(-1),lastUnit=context.evidenceUnits.at(-1);elementsOf(last,'button')[0].dispatch('click');
  assert.equal(app.ids.get('page-select').value,String(lastUnit.physicalPageNumber-1));
  assert.equal(app.ids.get('chunk-select').value,String(lastUnit.ordinal));
  contextButton(app,'context-previous').dispatch('click');assert.equal(contextRows(app).length,100);
  assert.ok(contextRows(app)[0].textContent.startsWith(`${context.evidenceUnits[100].citationId} · rank 101`));
  contextButton(app,'context-previous').dispatch('click');assert.equal(contextButton(app,'context-previous').disabled,true);
  assert.equal(app.context(),context);assert.equal(app.source(),source);assert.equal(app.chunks(),chunks);
  assert.deepEqual(context.omissions,[]);
});

for(const action of ['clear','clear-query','edit','topK','replacement','rechunk','reembed','requery'])
test(`saved context handlers cannot reveal or navigate old evidence after ${action}`,async()=>{
  const app=await contextApp();await commitContext(app);
  const oldRow=contextRows(app)[0],detail=elementsOf(oldRow,'details')[0],inspect=elementsOf(oldRow,'button')[0];
  const next=contextButton(app,'context-next'),previous=contextButton(app,'context-previous');
  if(action==='clear'||action==='clear-query')app.ids.get(action).dispatch('click');
  else if(action==='edit'||action==='topK'){
    const input=app.ids.get(action==='edit'?'question-input':'query-top-k');input.value=action==='edit'?'new question':2;input.dispatch('input');
  }else if(action==='replacement')await app.select('B');
  else if(action==='rechunk')await app.chunk();
  else if(action==='reembed')await app.embed();
  else{await app.query('new question',{topK:3});app.ids.get('assemble-context').dispatch('click');}
  const rootText=app.ids.get('context-detail').textContent,page=app.ids.get('page-select').value,chunk=app.ids.get('chunk-select').value;
  detail.open=true;detail.dispatch('toggle');next.dispatch('click');previous.dispatch('click');inspect.dispatch('click');
  assert.equal(detail.children.length,0);assert.equal(elementsOf(detail,'pre').length,0);
  assert.equal(app.ids.get('context-detail').textContent,rootText);
  assert.equal(app.ids.get('page-select').value,page);assert.equal(app.ids.get('chunk-select').value,chunk);
  assert.equal(app.ids.get('generate-answer').disabled,true);
  if(action!=='requery'){assert.equal(app.context(),null);assert.equal(contextRows(app).length,0);assert.equal(elementsOf(app.ids.get('context-detail'),'nav').length,0);}
});

test('the context component independently requires both its rendered artifact and current owner before saved handlers run',async()=>{
  const app=await contextApp({large:true}),context=await commitContext(app),root=new DomElement('div');let inspections=0,current=true;
  const view=createContextView({document:{createElement:tag=>new DomElement(tag)},root,isCurrent:()=>current,onInspect:()=>{inspections++;}});
  view.render(context);const detail=elementsOf(root,'details')[0],buttons=elementsOf(root,'button');view.render(null);
  const empty=root.textContent;detail.open=true;detail.dispatch('toggle');for(const button of buttons)button.dispatch('click');
  assert.equal(root.textContent,empty);assert.equal(elementsOf(root,'article').length,0);assert.equal(elementsOf(root,'nav').length,0);
  assert.equal(detail.children.length,0);assert.equal(inspections,0);
  view.render(context);const ownerDetail=elementsOf(root,'details')[0],ownerButtons=elementsOf(root,'button'),before=root.textContent;current=false;
  ownerDetail.open=true;ownerDetail.dispatch('toggle');for(const button of ownerButtons)button.dispatch('click');
  assert.ok(before.length>0);assert.equal(root.textContent,'');assert.equal(ownerDetail.children.length,0);assert.equal(inspections,0);
});

test('the actual app reports a canonical ContextError without fabricating lifecycle progress or leaking diagnostics',async()=>{
  const source=structuredClone(sourceRecord('A',[2,1,1]));const app=await contextApp({source});
  app.ids.get('run-query').dispatch('click');await uiTurn();const before=app.state(),trace=app.ids.get('trace').textContent;
  Object.defineProperty(source.pages[0].textItems[0],'text',{get(){throw Error('PRIVATE_CONTEXT_DIAGNOSTIC');},configurable:true});
  app.ids.get('assemble-context').dispatch('click');
  assert.equal(app.ids.get('status-title').textContent,'Context did not assemble');
  assert.match(app.ids.get('status-detail').textContent,/^INVALID_CONTEXT_ARTIFACT · /);
  assert.doesNotMatch(app.ids.get('status-detail').textContent,/PRIVATE|Error|stack/);
  assert.equal(app.context(),null);assert.equal(app.ids.get('assemble-context').disabled,false);
  assert.equal(app.ids.get('generate-answer').disabled,true);assert.equal(app.ids.get('operation-progress').hidden,true);
  assert.deepEqual(app.state(),before);assert.equal(app.ids.get('trace').textContent,trace);
});

test('the actual app suppresses a context refusal after reentrant source invalidation',async()=>{
  const source=structuredClone(sourceRecord('A',[2,1,1]));const app=await contextApp({source});
  app.ids.get('run-query').dispatch('click');await uiTurn();
  Object.defineProperty(source.pages[0].textItems[0],'text',{get(){app.ids.get('clear').dispatch('click');throw Error('PRIVATE_STALE_CONTEXT');},configurable:true});
  app.ids.get('assemble-context').dispatch('click');
  assert.equal(app.state().status,'idle');assert.equal(app.ids.get('status-title').textContent,'Waiting for a PDF');
  assert.doesNotMatch(app.ids.get('status-detail').textContent,/CONTEXT|PRIVATE/);assert.equal(app.context(),null);
});

test('the actual Embed click visibly refuses an oversized accepted chunk set without adapter effects or lost selection',async()=>{
  const source=sourceRecord('large.pdf',[1],'A'.repeat(300000));let calls=0;
  const app=appHarness([source],undefined,{embed:()=>{calls++;throw new Error('private adapter diagnostic');}});
  await app.select('large.pdf');await app.chunk();
  assert.equal(app.chunks().counts.chunks,670);assert.equal(app.ids.get('embed-chunks').disabled,false);
  app.ids.get('chunks-next').dispatch('click');app.ids.get('chunk-select').value=117;app.ids.get('chunk-select').dispatch('change');
  const before=acceptedAppState(app);
  app.ids.get('embed-chunks').dispatch('click');await uiTurn();
  assertPreflightRefusal(app);assert.equal(calls,0);assert.deepEqual(acceptedAppState(app),before);
});

test('the actual Embed click visibly refuses a reused chunk incarnation without an unhandled rejection or state change',async()=>{
  let calls=0;const source=sourceRecord('A',[1]);
  const app=appHarness([source],undefined,{runtimeIdFactory:()=> 'used-chunk-incarnation',
    embed:()=>{calls++;throw new Error('private adapter diagnostic');}});
  await app.select('A');await app.chunk();const before=acceptedAppState(app);
  app.ids.get('embed-chunks').dispatch('click');await uiTurn();
  assertPreflightRefusal(app);assert.equal(calls,0);assert.deepEqual(acceptedAppState(app),before);
  assert.doesNotMatch(app.ids.get('status-detail').textContent,/private|used-chunk-incarnation/);
});

test('a preflight refusal preserves already accepted vectors and the selected vector detail',async()=>{
  const incarnations=['chunk-incarnation','embedding-incarnation','embedding-incarnation'];let calls=0;
  const app=appHarness([sourceRecord('A',[2])],undefined,{runtimeIdFactory:()=>incarnations.shift(),
    embed:(input,options)=>{calls++;return successfulEmbedding(input,options);}});
  await app.select('A');await app.chunk({maxChunkUtf16:20,overlapUtf16:0});
  app.ids.get('chunk-select').value=1;app.ids.get('chunk-select').dispatch('change');
  app.ids.get('embed-chunks').dispatch('click');await uiTurn();
  assert.equal(app.state().status,'embedded-not-retrieved');const before=acceptedAppState(app);
  app.ids.get('embed-chunks').dispatch('click');await uiTurn();
  assertPreflightRefusal(app);assert.equal(calls,1);assert.deepEqual(acceptedAppState(app),before);
});

test('the next legitimate Embed retry clears the preflight refusal and uses the existing session progress rendering',async()=>{
  const incarnations=['chunk-incarnation','chunk-incarnation','fresh-embedding-incarnation'];let finish,calls=0;
  const app=appHarness([sourceRecord('A',[1])],undefined,{runtimeIdFactory:()=>incarnations.shift(),
    embed:(input,options)=>{calls++;return new Promise(resolve=>{finish=()=>resolve(successfulEmbedding(input,options));});}});
  await app.select('A');await app.chunk();const source=app.source(),chunks=app.chunks();
  app.ids.get('embed-chunks').dispatch('click');await uiTurn();assertPreflightRefusal(app);
  app.ids.get('embed-chunks').dispatch('click');
  assert.equal(calls,1);assert.equal(app.ids.get('status-title').textContent,'Embedding accepted chunks');
  assert.doesNotMatch(app.ids.get('status-detail').textContent,/INVALID_EMBEDDING_CONFIG/);
  assert.equal(app.ids.get('operation-progress').hidden,false);
  finish();await uiTurn();assert.equal(app.state().status,'embedded-not-retrieved');
  assert.equal(app.source(),source);assert.equal(app.chunks(),chunks);assert.equal(app.embeddings().vectors[0].length,384);
});

test('a rapid valid Embed retry is not overwritten by the earlier preflight rejection',async()=>{
  const incarnations=['chunk-incarnation','chunk-incarnation','fresh-embedding-incarnation'];let finish,calls=0;
  const app=appHarness([sourceRecord('A',[1])],undefined,{runtimeIdFactory:()=>incarnations.shift(),
    embed:(input,options)=>{calls++;return new Promise(resolve=>{finish=()=>resolve(successfulEmbedding(input,options));});}});
  await app.select('A');await app.chunk();const source=app.source(),chunks=app.chunks();
  app.ids.get('embed-chunks').dispatch('click');app.ids.get('embed-chunks').dispatch('click');await uiTurn();
  assert.equal(calls,1);assert.equal(app.state().status,'embedding');
  assert.equal(app.ids.get('status-title').textContent,'Embedding accepted chunks');
  assert.doesNotMatch(app.ids.get('status-detail').textContent,/INVALID_EMBEDDING_CONFIG/);
  finish();await uiTurn();assert.equal(app.state().status,'embedded-not-retrieved');
  assert.equal(app.source(),source);assert.equal(app.chunks(),chunks);
});

test('chunk inspection clears a shown preflight refusal without changing accepted state',async()=>{
  const app=appHarness([sourceRecord('A',[2])],undefined,{runtimeIdFactory:()=> 'used-incarnation'});
  await app.select('A');await app.chunk();const before=acceptedAppState(app);
  app.ids.get('embed-chunks').dispatch('click');await uiTurn();assertPreflightRefusal(app);
  app.ids.get('chunk-select').dispatch('change');
  assert.equal(app.ids.get('status-title').textContent,'Chunked; not embedded');
  assert.doesNotMatch(app.ids.get('status-detail').textContent,/INVALID_EMBEDDING_CONFIG/);
  assert.deepEqual(acceptedAppState(app),before);
});

for(const action of ['clear','replacement','rechunk','inspection'])test(`a stale Embed preflight rejection cannot overwrite a subsequent ${action} UI action`,async()=>{
  const incarnations=['used-incarnation','used-incarnation','fresh-incarnation'];let calls=0;
  const app=appHarness([sourceRecord('A',[2]),sourceRecord('B',[1])],undefined,{runtimeIdFactory:()=>incarnations.shift(),
    embed:()=>{calls++;throw new Error('private adapter diagnostic');}});
  await app.select('A');await app.chunk();const before=acceptedAppState(app);
  app.ids.get('embed-chunks').dispatch('click');
  if(action==='replacement'){
    app.ids.get('pdf-file').files=[{name:'B'}];app.ids.get('pdf-file').dispatch('change');
  }else app.ids.get(action==='clear'?'clear':action==='rechunk'?'build-chunks':'chunk-select').dispatch(action==='inspection'?'change':'click');
  await uiTurn();assert.equal(calls,0);
  assert.equal(app.ids.get('status-title').textContent,action==='clear'?'Waiting for a PDF':action==='replacement'?'Extracted; not indexed':'Chunked; not embedded');
  assert.doesNotMatch(app.ids.get('status-detail').textContent,/INVALID_EMBEDDING_CONFIG/);
  if(action==='clear'){assert.equal(app.source(),null);assert.equal(app.chunks(),null);assert.equal(app.state().lifecycle.documentEpoch,before.state.lifecycle.documentEpoch+1);}
  else if(action==='replacement'){assert.equal(app.source().source.name,'B');assert.equal(app.chunks(),null);assert.equal(app.state().lifecycle.documentEpoch,before.state.lifecycle.documentEpoch+1);}
  else if(action==='rechunk'){assert.equal(app.source(),before.source);assert.notEqual(app.chunks(),before.chunks);}
  else assert.deepEqual(acceptedAppState(app),before);
});

for(const action of ['clear','replacement','rechunk'])test(`a shown Embed preflight refusal is cleared by ${action}`,async()=>{
  const incarnations=['used-incarnation','used-incarnation','fresh-incarnation'];
  const app=appHarness([sourceRecord('A',[2]),sourceRecord('B',[1])],undefined,{runtimeIdFactory:()=>incarnations.shift()});
  await app.select('A');await app.chunk();app.ids.get('embed-chunks').dispatch('click');await uiTurn();assertPreflightRefusal(app);
  if(action==='replacement'){
    app.ids.get('pdf-file').files=[{name:'B'}];app.ids.get('pdf-file').dispatch('change');
  }else app.ids.get(action==='clear'?'clear':'build-chunks').dispatch('click');
  await uiTurn();
  assert.equal(app.ids.get('status-title').textContent,action==='clear'?'Waiting for a PDF':action==='replacement'?'Extracted; not indexed':'Chunked; not embedded');
  assert.doesNotMatch(app.ids.get('status-detail').textContent,/INVALID_EMBEDDING_CONFIG/);
});
