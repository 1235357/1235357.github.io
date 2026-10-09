import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPageRecord} from '../pdf-source.mjs';
import {createPdfSession} from '../pdf-session.mjs';
import {createComputeCommandHandler} from '../compute.worker.mjs';
import {embedInWorker,embeddingReceipt} from '../embedding-source.mjs';
import {EMBEDDING_SPEC} from '../embedding-contract.mjs';

const windowModule = await import('../item-window.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return null;
});
const getItemWindow = windowModule?.getItemWindow ?? (() => assert.fail('The fixed-size item preview window is missing.'));

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
  dispatch(name) { for (const listener of this.listeners.get(name) ?? []) listener({target: this}); }
  removeAttribute(name) { if (name === 'value') this._value = ''; }
}

const appText = await readFile(new URL('../pdf-app.mjs', import.meta.url), 'utf8');
const htmlText = await readFile(new URL('../inspector.html', import.meta.url), 'utf8');
const elementsOf = (element, tag) => element.children.flatMap(child => [
  ...(child.tagName === tag.toUpperCase() ? [child] : []), ...elementsOf(child, tag),
]);

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

function appHarness(sources, computeOverride, {embed = embedInWorker, runtimeIdFactory} = {}) {
  const ids = new Map();
  for (const id of ['pdf-file', 'page-select', 'items', 'receipt', 'page-meta', 'status-title',
    'status-detail', 'cancel', 'clear', 'trace', 'items-first', 'items-previous', 'items-next', 'items-range',
    'build-chunks','chunk-select','chunk-detail','chunk-meta','chunks-previous','chunks-next',
    'embed-chunks','embedding-detail','embedding-meta','embedding-receipt','operation-progress']) {
    ids.set(id, new DomElement(['page-select','chunk-select'].includes(id) ? 'select' : 'div'));
  }
  const document = {getElementById: id => ids.get(id), createElement: tag => new DomElement(tag)};
  const allItems = new Set(sources.flatMap(source => source.pages.flatMap(page => page.textItems)));
  const serializedItems = [],serializedChunks=[];
  const checkedJson = {...JSON, stringify(value, ...args) {
    if (allItems.has(value)) serializedItems.push(value);
    if(value?.segments&&value?.id)serializedChunks.push(value);
    return JSON.stringify(value, ...args);
  }};
  let session;
  const executable = appText.replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(new URL('../pdf-app.mjs', import.meta.url).href));
  const run = new Function('document', 'window', 'Worker', 'pdfjs', 'extractPdf',
    'createPdfSession', 'getItemWindow', 'JSON', 'chunkInWorker', 'embedInWorker', executable);
  const compute=computeOverride??(async(source,{identity,onProgress,chunkOptions})=>{
    const packets=[];createComputeCommandHandler(packet=>packets.push(packet))({kind:'chunk-source',identity,source,options:chunkOptions??{}});
    onProgress(packets[0].event);
    const terminal=packets.at(-1);if(terminal.event.kind==='error')throw Object.assign(new Error('safe test error'),{code:terminal.event.payload.code});
    return terminal;
  });
  let runtimeNumber=0;
  run(document, {addEventListener() {}}, class {}, {}, async file => sources.find(source => source.source.name === file.name),
    options => { session = createPdfSession({...options, runtimeId: 'preview-test',runtimeIdFactory:runtimeIdFactory??(()=>`compute-test-${++runtimeNumber}`)}); return session; }, getItemWindow, checkedJson,compute,embed);
  return {ids, serializedItems,serializedChunks, select: name => session.select({name}), source: () => session.document(),
    chunk:options=>session.chunk(options),chunks:()=>session.chunks(),embeddings:()=>session.embeddings(),state:()=>session.snapshot(),
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
  assert.equal(app.serializedItems.length, 1);
  assert.equal(elementsOf(detail, 'pre').length, 1);
  assert.match(elementsOf(detail, 'pre')[0].textContent, /"itemIndex": 0/);
  detail.open = false; detail.dispatch('toggle');
  assert.equal(elementsOf(detail, 'pre').length, 0);
  assert.equal(detail.children.length, 1, 'The summary remains available after releasing generated JSON text.');
  detail.open = true; detail.dispatch('toggle');
  assert.equal(app.serializedItems.length, 2);
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
  detail.open=true;detail.dispatch('toggle');assert.equal(app.serializedChunks.length,1);
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
