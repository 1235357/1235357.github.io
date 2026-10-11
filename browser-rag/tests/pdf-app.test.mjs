import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dom,act,generate,deferred,generationPackets,adapterControl,byTag,nodes} from './pdf-app-dom-fixture.mjs';
import {tick} from './financial-generation-fixture.mjs';
import {inspectFinancialOutput} from '../financial-output-contract.mjs';
import {createFinancialGeometryView} from '../financial-geometry-view.mjs';
import {createFinancialLookupView} from '../financial-lookup-view.mjs';

const fixture=new URL('./pdf-app-dom-fixture.mjs',import.meta.url).href;
const hooks=registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/pdf-app.mjs')){if(specifier==='./vendor/build/pdf.mjs')return {url:'data:text/javascript,export const version="6.4.299";',shortCircuit:true};if(['./pdf-source.mjs','./compute-source.mjs','./embedding-source.mjs','./query-source.mjs'].includes(specifier))return {url:fixture,shortCircuit:true};}return next(specifier,context);}});
let app,importError;try{app=await import('../pdf-app.mjs');}catch(error){importError=error;}
hooks.deregister();
function mount(extra={}){assert.equal(importError,undefined,'import must not touch DOM or mount');assert.equal(typeof app.mountPdfApp,'function');const d=dom();d.get('pdf-file').disabled=true;const mounted=app.mountPdfApp({document:d.document,root:d.root,...extra});assert.equal(d.get('pdf-file').disabled,false,'completed mount enables the PDF chooser');assert.equal(d.get('pdf-file').listeners.get('change').length,1,'enabled chooser has its owned handler');return {...d,mounted};}
async function accepted(d){d.get('pdf-file').files=[{name:'READER.pdf'}];await act(d.get('pdf-file'),'change');await act(d.get('build-chunks'));await act(d.get('embed-chunks'));d.get('question-input').value='READER question';await act(d.get('run-query'));await act(d.get('assemble-context'));}
test('import without a document has no DOM/session/mount side effects',()=>{assert.equal(importError,undefined,'Node import is inert');assert.equal(typeof app.mountPdfApp,'function');});
test('unknown/invalid options and duplicate roots fail before listener registration',()=>{const d=mount();const count=[...d.root.nodes.values()].reduce((n,node)=>n+[...node.listeners.values()].flat().length,0);assert.throws(()=>app.mountPdfApp({document:d.document,root:d.root,generate}),/mount|already/i);assert.equal([...d.root.nodes.values()].reduce((n,node)=>n+[...node.listeners.values()].flat().length,0),count);for(const options of [{evil:1},{generate:true},{createGeometryView:true},{createLookupView:true},{createAssetPreparationView:true},{document:null},{root:null}]){const e=dom();assert.throws(()=>app.mountPdfApp({document:e.document,root:e.root,...options}),TypeError);assert.equal([...e.root.nodes.values()].flatMap(n=>[...n.listeners.values()].flat()).length,0);}});
test('ordinary entry is OFF while private entry composes one shared mount',async()=>{const d=mount();await accepted(d);assert.equal(d.get('generate-answer').disabled,true);const ordinary=readFileSync(new URL('../pdf-entry.mjs',import.meta.url),'utf8'),privateEntry=readFileSync(new URL('../pdf-private-entry.mjs',import.meta.url),'utf8');assert.match(ordinary,/mountPdfApp\(\)/);assert.match(privateEntry,/mountPdfApp\(\{generate:generateFinancialInWorker,createGeometryView:createFinancialGeometryView,createLookupView:createFinancialLookupView\}\)/);assert.equal(d.get('pdf-file').value,'');assert.equal(byTag(d.get('computation-notebook'),'details').length,0);assert.equal(d.get('source-cell-lookup').hidden,true);assert.equal(d.get('source-cell-lookup').children.length,0);});
test('private generation requires explicit context/button and updates native evidence captions',async()=>{let calls=0;const d=mount({generate:async(...args)=>{calls++;return generate(...args);}});await accepted(d);assert.equal(calls,0);assert.equal(d.get('generate-answer').disabled,false);await act(d.get('generate-answer'));await tick();assert.equal(calls,1);assert.match(d.get('status-title').textContent,/unverified/i);assert.match(d.get('generation-detail').textContent,/UNVERIFIED/);assert.match(d.get('receipt').textContent,/native generation/i);assert.match(d.get('header-stage').textContent,/UNVERIFIED/);assert.doesNotMatch(d.get('context-meta').textContent,/context not generated/);await act(d.get('assemble-context'));assert.doesNotMatch(d.get('generation-detail').textContent,/invented/);});
test('clear/edit/pagehide revoke generation and release same file selection',async()=>{for(const action of ['clear','edit','pagehide']){const d=mount({generate});await accepted(d);await act(d.get('generate-answer'));await tick();assert.match(d.get('generation-detail').textContent,/invented/);d.get('pdf-file').value='restored.pdf';if(action==='edit')await act(d.get('question-input'),'input');else if(action==='pagehide')await act(d.window,'pagehide');else await act(d.get('clear'));assert.doesNotMatch(d.get('generation-detail').textContent,/invented/);if(action!=='edit')assert.equal(d.get('pdf-file').value,'');}});
test('generation cancellation retains question/context for explicit retry and labels the operation',async()=>{const task=deferred();let options;const d=mount({generate:(input,settings,opts)=>{options=opts;return task.promise;}});await accepted(d);await act(d.get('generate-answer'));assert.match(d.get('status-title').textContent,/generating/i);await act(d.get('cancel'));assert.ok(options.signal.aborted);assert.match(d.get('status-detail').textContent,/generation/i);assert.match(d.get('context-detail').textContent,/READER question/);assert.equal(d.get('generate-answer').disabled,false);});
test('preflight rejection is UI-only and cannot overwrite a newer action',async()=>{const d=mount({generate});await accepted(d);const hooks=registerHooks({resolve(specifier,context,next){if(specifier.includes('financial-generation-source'))throw Error('private diagnostic');return next(specifier,context);}});try{d.get('generate-answer').dispatch('click');d.get('clear').dispatch('click');await tick();assert.equal(d.get('status-title').textContent,'Waiting for a PDF');assert.doesNotMatch(d.get('status-detail').textContent,/private diagnostic/);}finally{hooks.deregister();}});
test('late A native receipt after clear/query B never publishes an answer',async()=>{const pending=deferred();let capture;const d=mount({generate:(...args)=>{capture=args;return pending.promise;}});await accepted(d);await act(d.get('generate-answer'));await act(d.get('clear-query'));d.get('question-input').value='NEW question B';await act(d.get('run-query'));await act(d.get('assemble-context'));const packets=await generationPackets(...capture);for(const packet of packets.slice(0,-1))capture[2].onProgress(packet);pending.resolve(packets.at(-1));await tick();assert.doesNotMatch(d.get('generation-detail').textContent,/invented/);assert.match(d.get('context-detail').textContent,/NEW question B/);});

test('stage rail reflects accepted artifacts and generation ownership rather than an overall percentage',async()=>{
  const pending=deferred(),d=mount({generate:()=>pending.promise});await accepted(d);
  const before=d.get('pipeline-steps').children;
  assert.equal(before.length,6);assert.ok(before.slice(0,5).every(step=>step.className==='pipeline-step accepted'));
  assert.equal(before[5].className,'pipeline-step pending');
  await act(d.get('generate-answer'));
  assert.equal(d.get('pipeline-steps').children[5].className,'pipeline-step running');
  assert.equal(d.get('pipeline-steps').children[5].attributes.get('aria-current'),'step');
  assert.equal(d.get('operation-progress').attributes.has('value'),false);
  await act(d.get('cancel'));
  assert.equal(d.get('pipeline-steps').children[5].className,'pipeline-step pending');
  assert.ok(d.get('pipeline-steps').children.slice(0,5).every(step=>step.className==='pipeline-step accepted'));
  await act(d.get('clear'));
  assert.ok(d.get('pipeline-steps').children.every(step=>step.className==='pipeline-step pending'));
});

test('inspect native citation opens the computation notebook at its retained physical page',async()=>{
  const d=mount({generate});await accepted(d);await act(d.get('generate-answer'));await tick();
  const citation=byTag(d.get('generation-detail'),'button').find(node=>node.textContent.includes('E2'));
  assert.ok(citation);assert.equal(d.get('computation-notebook').open,false);await act(citation);
  assert.equal(d.get('computation-notebook').open,true);assert.equal(d.get('page-select').focused,true);
  assert.equal(d.get('page-select').value,'1');assert.match(d.get('page-meta').textContent,/Physical page 2/);
});

test('reader document order presents question then draft then the expandable computation notebook',()=>{
  const html=readFileSync(new URL('../inspector.html',import.meta.url),'utf8');
  assert.match(html,/<input id="pdf-file"[^>]*\bdisabled(?:\s|>)/,'unmounted HTML cannot accept an unhandled file selection');
  assert.match(html,/<div id="asset-preparation" hidden><\/div>/);
  assert.ok(html.indexOf('This app does not upload selected PDF bytes')<html.indexOf('id="asset-preparation"'));
  assert.ok(html.indexOf('id="question-input"')<html.indexOf('id="generation-title"'));
  assert.ok(html.indexOf('id="generation-detail"')<html.indexOf('id="computation-notebook"'));
  assert.ok(html.indexOf('id="source-cell-lookup"')>html.indexOf('id="generation-detail"'));
  assert.ok(html.indexOf('id="source-cell-lookup"')<html.indexOf('id="computation-notebook"'));
  assert.match(html,/<div id="source-cell-lookup" hidden><\/div>/);
  assert.match(html,/<details id="computation-notebook" class="computation-notebook">/);
});

test('asset preparation factory is optional, stays isolated from generation and receives core invalidation/pagehide',async()=>{
  const events=[];let revokes=0,injectedRoot;
  const d=mount({createAssetPreparationView:({root})=>{injectedRoot=root;return {render:value=>events.push(value),revoke:()=>{revokes++;}};}});
  assert.equal(injectedRoot,d.get('asset-preparation'));
  assert.equal(d.get('asset-preparation').hidden,false);assert.equal(events.at(-1).source,null);assert.equal(events.at(-1).documentEpoch,0);
  const before=revokes;await act(d.get('question-input'),'input');assert.ok(revokes>before);
  d.get('pdf-file').files=[{name:'READER.pdf'}];await act(d.get('pdf-file'),'change');assert.equal(events.at(-1).source.source.name,'READER.pdf');assert.equal(events.at(-1).documentEpoch,1);
  await act(d.window,'pagehide');assert.equal(events.at(-1).source,null);assert.ok(revokes>before+1);
  const ordinary=mount();assert.equal(ordinary.get('asset-preparation').hidden,true);assert.equal(ordinary.get('asset-preparation').children.length,0);
  const legacy=dom();legacy.root.nodes.delete('asset-preparation');assert.doesNotThrow(()=>app.mountPdfApp({document:legacy.document,root:legacy.root}));
  const missing=dom();missing.root.nodes.delete('asset-preparation');assert.throws(()=>app.mountPdfApp({document:missing.document,root:missing.root,createAssetPreparationView:()=>({render(){},revoke(){}})}),/Incomplete/);
  assert.equal([...missing.root.nodes.values()].flatMap(node=>[...node.listeners.values()].flat()).length,0);
});

test('private source-cell comparator needs only source parse and main-question no-op edits still revoke its receipt',async()=>{
  const original=JSON.parse(readFileSync(new URL('../../docs/acceptance-2026-10-11/native-pdfjs-full-geometry.json',import.meta.url),'utf8'));
  let calls=0;adapterControl.extract=async()=>structuredClone(original);
  try{
    const d=mount({generate:()=>{calls++;},createLookupView:options=>createFinancialLookupView({...options,digest:async bytes=>createHash('sha256').update(bytes).digest('hex')})});
    d.get('pdf-file').files=[{name:'READER.pdf'}];await act(d.get('pdf-file'),'change');const host=d.get('source-cell-lookup'),get=key=>nodes(host).find(node=>node.id===`source-cell-${key}`);
    assert.equal(host.hidden,false);assert.match(d.get('status-title').textContent,/Extracted/);
    const values={statement:'Condensed Consolidated Statements of Income',metric:'Net income',duration:'6',date:'Jul 28, 2024',unit:'(In millions, except per share data)',glyph:'$'};
    for(const [key,value]of Object.entries(values)){get(key).value=value;get(key).dispatch('input');}await act(get('run'));
    const detail=byTag(host,'details').find(node=>node.children[0].textContent==='Complete source-cell lookup receipt');assert.ok(detail);detail.open=true;await act(detail,'toggle');assert.deepEqual(JSON.parse(byTag(detail,'pre')[0].textContent).result.snapshot,original);
    assert.equal(calls,0);assert.match(d.get('generation-detail').textContent,/No native generation receipt/);assert.equal(d.get('run-query').disabled,true);
    d.get('question-input').value='Editing before any vector query';await act(d.get('question-input'),'input');assert.equal(byTag(host,'details').length,0);assert.equal(byTag(detail,'pre').length,0);assert.equal(get('duration').value,'6');
    await act(get('run'));assert.ok(byTag(host,'details').length);await act(d.get('clear-query'));assert.equal(byTag(host,'details').length,0);
    await act(get('run'));assert.ok(byTag(host,'details').length);await act(d.get('clear'));assert.equal(byTag(host,'details').length,0);assert.equal(get('statement').value,'');assert.equal(get('run').disabled,true);
  }finally{adapterControl.extract=null;}
});

test('lazy replay disclosure is the exact immutable eight-field input forwarded to native generation',async()=>{
  let forwarded,raw;
  const d=mount({generate:async(...args)=>{forwarded=args;const packet=await generate(...args);raw=packet.artifact;return packet;}});
  await accepted(d);await act(d.get('generate-answer'));await tick();
  const input=forwarded[0],keys=['source','chunkArtifact','embeddingArtifact','question','queryResult','topK','queryDownloadTotal','queryMetadata'];
  assert.deepEqual(Object.keys(input),keys);
  function frozen(value){if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));for(const child of Object.values(value))frozen(child);}}
  frozen(input);
  const detail=byTag(d.get('generation-detail'),'details').find(node=>node.children[0].textContent==='Original canonical generation input · replay only');
  assert.ok(detail,'explicit archive replay disclosure exists');assert.equal(byTag(detail,'pre').length,0);
  detail.open=true;await act(detail,'toggle');
  const text=byTag(detail,'pre')[0].textContent;assert.equal(text,JSON.stringify(input,null,2));
  const sidecar=JSON.parse(text);assert.deepEqual(sidecar,input);
  const inspected=inspectFinancialOutput(raw.text,[...raw.promptTokenIds,...raw.generatedTokenIds],raw.preflight,sidecar);
  assert.equal(inspected.disposition,'draft');assert.equal(inspected.citationBindings[0].citationId,'E2');
  await act(d.get('clear-query'));detail.dispatch('toggle');assert.equal(byTag(detail,'pre').length,0);
});

test('cancelled input A cannot leak into the accepted input B replay disclosure after a late receipt',async()=>{
  const pending=deferred();let a,b;
  const d=mount({generate:(...args)=>{if(!a){a=args;return pending.promise;}b=args;return generate(...args);}});
  await accepted(d);await act(d.get('generate-answer'));await act(d.get('cancel'));
  assert.equal(byTag(d.get('generation-detail'),'details').length,0);
  d.get('question-input').value='RETRY B question';await act(d.get('question-input'),'input');
  await act(d.get('run-query'));await act(d.get('assemble-context'));await act(d.get('generate-answer'));await tick();
  assert.notEqual(a[0],b[0]);assert.equal(b[0].question,'RETRY B question');
  const packets=await generationPackets(...a);for(const packet of packets.slice(0,-1))a[2].onProgress(packet);pending.resolve(packets.at(-1));await tick();
  const detail=byTag(d.get('generation-detail'),'details').find(node=>node.children[0].textContent==='Original canonical generation input · replay only');
  assert.ok(detail);detail.open=true;await act(detail,'toggle');
  assert.deepEqual(JSON.parse(byTag(detail,'pre')[0].textContent),b[0]);
});

test('canonical replay disclosure is revoked by source replacement and is never shared with a new mount',async()=>{
  const d=mount({generate});await accepted(d);await act(d.get('generate-answer'));await tick();
  const old=byTag(d.get('generation-detail'),'details').find(node=>node.children[0].textContent==='Original canonical generation input · replay only');
  assert.ok(old);old.open=true;await act(old,'toggle');assert.equal(byTag(old,'pre').length,1);
  const other=mount({generate});await accepted(other);
  assert.equal(byTag(other.get('generation-detail'),'details').length,0);
  d.get('pdf-file').files=[{name:'REPLACEMENT.pdf'}];await act(d.get('pdf-file'),'change');
  assert.equal(byTag(d.get('generation-detail'),'details').length,0);
  old.dispatch('toggle');assert.equal(byTag(old,'pre').length,0);
});

test('only configured private geometry factory receives current source/epoch; opening capture invokes no generation',async()=>{
  let calls=0;const d=mount({generate:()=>{calls++;},createGeometryView:options=>createFinancialGeometryView({...options,digest:async bytes=>createHash('sha256').update(bytes).digest('hex')})});
  d.get('pdf-file').files=[{name:'READER.pdf'}];await act(d.get('pdf-file'),'change');
  const detail=byTag(d.get('computation-notebook'),'details').find(node=>node.children[0].textContent==='Complete owned PDF.js geometry snapshot · capture only');
  assert.ok(detail);assert.equal(byTag(detail,'pre').length,0);detail.open=true;await act(detail,'toggle');
  const snapshot=JSON.parse(byTag(detail,'pre')[0].textContent);assert.equal(snapshot.source.name,'READER.pdf');assert.ok(snapshot.pages[0].geometry);assert.ok(snapshot.pages[0].textItems[0].transform);
  assert.match(detail.textContent,/document epoch 1/);assert.equal(calls,0);
  d.get('pdf-file').files=[{name:'REPLACEMENT.pdf'}];await act(d.get('pdf-file'),'change');detail.dispatch('toggle');assert.equal(byTag(detail,'pre').length,0);
  const replacement=byTag(d.get('computation-notebook'),'details').find(node=>node.children[0].textContent==='Complete owned PDF.js geometry snapshot · capture only');replacement.open=true;await act(replacement,'toggle');
  assert.equal(JSON.parse(byTag(replacement,'pre')[0].textContent).source.name,'REPLACEMENT.pdf');assert.match(replacement.textContent,/document epoch 2/);
  await act(d.get('clear'));replacement.dispatch('toggle');assert.equal(byTag(replacement,'pre').length,0);
});
