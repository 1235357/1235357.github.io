import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {dom,act,adapterControl,byTag,nodes,deferred} from './pdf-app-dom-fixture.mjs';
import {completeText} from './bounded-text-dom-fixture.mjs';
import {inputOf,tick} from './financial-generation-fixture.mjs';
import {embeddingReceipt} from '../embedding-source.mjs';
import {queryResultReceipt} from '../query-source.mjs';
import {rankCandidates} from '../retrieval.mjs';
import {createRuntimeFailure} from '../runtime-failure-contract.mjs';

// Only the parser/native worker adapters are doubled. The actual app, session,
// complete disclosure, bounded pages, native Blob and object URLs execute here.
// These tests do not establish a browser, GPU or model execution.
const fixture=new URL('./pdf-app-dom-fixture.mjs',import.meta.url).href;
const hooks=registerHooks({resolve(specifier,context,next){
  if(context.parentURL?.endsWith('/pdf-app.mjs')){
    if(specifier==='./vendor/build/pdf.mjs')return {url:'data:text/javascript,export const version="6.4.299";',shortCircuit:true};
    if(['./pdf-source.mjs','./compute-source.mjs','./embedding-source.mjs','./query-source.mjs'].includes(specifier))return {url:fixture,shortCircuit:true};
  }return next(specifier,context);
}});
let app;try{app=await import('../pdf-app.mjs');}finally{hooks.deregister();}
const BYTES=113629084;
const ids=()=>[101,...Array.from({length:254},(_,i)=>i+1000),102];
function progress(options,stages){stages.forEach(([stage,completed,total,unit],i)=>options.onProgress({...options.identity,kind:'progress',stage,seq:i+1,payload:{completed,total,unit,estimated:false}}));}
function denseAdapters(){
  adapterControl.embed=async(input,options)=>{
    const artifact=inputOf().embeddingArtifact;artifact.chunkIds=input.chunks.map(c=>c.id);artifact.sourceSha256=input.source.sha256;
    artifact.tokenIds=input.chunks.map(ids);artifact.counts.totalTokens=input.chunks.length*256;
    artifact.receipt={verifiedBytes:BYTES,networkBytes:BYTES,cacheBytes:0,elapsedMs:2};
    progress(options,[['download',0,BYTES,'bytes'],['download',BYTES,BYTES,'bytes'],['initialize',0,null,'chunks'],['encode',0,input.counts.chunks,'chunks'],['encode',input.counts.chunks,input.counts.chunks,'chunks']]);
    return {event:{...options.identity,kind:'result',stage:'encode',seq:6,payload:{data:embeddingReceipt(artifact)}},artifact};
  };
  adapterControl.query=async(input,passages,question,options)=>{
    const query=inputOf().queryResult.query;query.tokenIds=ids();query.counts.totalTokens=256;
    query.receipt={verifiedBytes:BYTES,networkBytes:0,cacheBytes:BYTES,elapsedMs:1};
    const retrieval=rankCandidates(input,passages,{representationId:query.representationId,representation:query.representation,vector:query.vector},{topK:options.topK}),artifact={query,retrieval};
    progress(options,[['download',0,BYTES,'bytes'],['download',BYTES,BYTES,'bytes'],['initialize',0,null,'tokens'],['encode',0,256,'tokens'],['encode',256,256,'tokens'],['rank',0,input.counts.chunks,'chunks'],['rank',input.counts.chunks,input.counts.chunks,'chunks']]);
    return {event:{...options.identity,kind:'result',stage:'rank',seq:8,payload:{data:queryResultReceipt(artifact)}},artifact};
  };
}
function mount(extra={}){
  const d=dom(),downloads=[],create=d.document.createElement.bind(d.document);
  d.document.createElement=tag=>{const node=create(tag);if(tag==='a')node.click=()=>downloads.push({href:node.attributes.get('href'),filename:node.attributes.get('download')});return node;};
  app.mountPdfApp({document:d.document,root:d.root,...extra});return {...d,downloads};
}
async function accepted(d){d.get('pdf-file').files=[{name:'RECORDS.pdf'}];await act(d.get('pdf-file'),'change');await act(d.get('build-chunks'));await act(d.get('embed-chunks'));d.get('question-input').value='  exact question 🧭\r\n  ';await act(d.get('run-query'));}
const disclosure=(root,text)=>byTag(root,'details').find(node=>node.children[0]?.textContent===text);
async function open(d,host,title){const detail=disclosure(d.get(host),title);assert.ok(detail,`${title} must exist`);assert.equal(byTag(detail,'pre').length,0);detail.open=true;await act(detail,'toggle');return detail;}
async function exported(d,host,title){const detail=await open(d,host,title),text=completeText(detail),pre=byTag(detail,'pre')[0],download=byTag(detail,'button').find(node=>node.textContent==='Download complete JSON');assert.ok(download);download.dispatch('click');const entry=d.downloads.at(-1);return {detail,text,pre,download,...entry,toggle:detail.listeners.get('toggle')[0],click:download.listeners.get('click')[0]};}
async function revoked(record){assert.equal(record.pre.textContent,'');assert.equal(record.download.disabled,true);assert.equal(record.detail.open,false);await assert.rejects(fetch(record.href));record.detail.open=true;record.toggle();record.click();assert.equal(byTag(record.detail,'pre').length,0);}
const selectedTitles=['Inspect all 256 selected token IDs including CLS / SEP','Inspect this selected vector’s full 384 values'];
const queryTitles=['Inspect all 256 query token IDs including CLS / SEP','Inspect the query vector’s full 384 values'];

test('selected and query arrays stay lazy and export every original value through native Blob URLs',async()=>{
  denseAdapters();try{const d=mount();await accepted(d);
    assert.equal(byTag(d.get('embedding-detail'),'pre').length,0,'Selected token IDs must not mount eagerly');
    assert.equal(byTag(d.get('query-embedding-detail'),'pre').length,0);
    const expected=[ids(),inputOf().embeddingArtifact.vectors[0],ids(),inputOf().queryResult.query.vector],records=[];
    for(const [host,title]of [['embedding-detail',selectedTitles[0]],['embedding-detail',selectedTitles[1]],['query-embedding-detail',queryTitles[0]],['query-embedding-detail',queryTitles[1]]])records.push(await exported(d,host,title));
    assert.deepEqual(records.map(r=>r.filename),['selected-token-ids-1.json','selected-vector-1.json','query-token-ids.json','query-vector.json']);
    for(let index=0;index<records.length;index++){
      assert.deepEqual(JSON.parse(records[index].text),expected[index]);
      assert.deepEqual(Buffer.from(await(await fetch(records[index].href)).arrayBuffer()),Buffer.from(JSON.stringify(expected[index],null,2),'utf8'));
      assert.ok(records[index].pre.textContent.length<=24576);assert.ok(records[index].pre.textContent.split('\n').length<=160);
    }await act(d.get('clear'));for(const record of records)await revoked(record);
  }finally{adapterControl.embed=null;adapterControl.query=null;}
});

test('selected record callbacks and URLs revoke on each selector or source artifact invalidation',async()=>{
  denseAdapters();try{for(const action of ['repeat','selection','reembed','rechunk','replacement','clear','pagehide']){
    const d=mount();await accepted(d);const records=[];for(const title of selectedTitles)records.push(await exported(d,'embedding-detail',title));
    if(action==='repeat'||action==='selection'){if(action==='selection')d.get('chunk-select').value='1';await act(d.get('chunk-select'),'change');}
    else if(action==='replacement'){d.get('pdf-file').files=[{name:'REPLACEMENT.pdf'}];await act(d.get('pdf-file'),'change');}
    else await act(action==='pagehide'?d.window:d.get(action==='reembed'?'embed-chunks':action==='rechunk'?'build-chunks':action),action==='pagehide'?'pagehide':'click');
    const before=d.get('embedding-detail').textContent;for(const record of records)await revoked(record);assert.equal(d.get('embedding-detail').textContent,before);assert.equal(d.downloads.length,2);
    if(action==='repeat'||action==='selection'){const index=action==='selection'?1:0,fresh=await exported(d,'embedding-detail',selectedTitles[1]);assert.equal(fresh.filename,`selected-vector-${index+1}.json`);assert.deepEqual(JSON.parse(fresh.text),inputOf().embeddingArtifact.vectors[index]);}
    await act(d.get('clear'));
  }}finally{adapterControl.embed=null;adapterControl.query=null;}
});

test('query records and candidate source callbacks revoke on edits, retries and every source invalidation',async()=>{
  denseAdapters();try{for(const action of ['edit','topK','clear-query','requery','reembed','rechunk','replacement','clear','pagehide']){
    const d=mount();await accepted(d);const records=[];for(const title of queryTitles)records.push(await exported(d,'query-embedding-detail',title));
    const quotes=nodes(d.get('candidate-results')).filter(node=>node.className==='quote'),candidate=byTag(d.get('candidate-results'),'button')[0],click=candidate.listeners.get('click')[0];assert.ok(quotes.some(n=>n.textContent.length));
    const questionNodes=['question-original','question-resolved','question-encoder','query-embedding-meta','candidate-meta'].map(id=>d.get(id).children[0]),receiptNodes=[...d.get('query-receipt').children];
    if(action==='edit'||action==='topK'){const node=d.get(action==='edit'?'question-input':'query-top-k');await act(node,'input');}
    else if(action==='replacement'){d.get('pdf-file').files=[{name:'REPLACEMENT.pdf'}];await act(d.get('pdf-file'),'change');}
    else await act(action==='pagehide'?d.window:d.get(action==='requery'?'run-query':action==='reembed'?'embed-chunks':action==='rechunk'?'build-chunks':action),action==='pagehide'?'pagehide':'click');
    for(const record of records)await revoked(record);assert.equal(candidate.disabled,true);for(const node of [...quotes,...questionNodes,...receiptNodes])assert.equal(node.textContent,'');
    d.get('computation-notebook').open=false;d.get('page-select').focused=false;const before=[d.get('page-select').value,d.get('chunk-select').value,d.get('candidate-results').textContent];click();
    assert.equal(d.get('computation-notebook').open,false);assert.equal(d.get('page-select').focused,false);assert.deepEqual([d.get('page-select').value,d.get('chunk-select').value,d.get('candidate-results').textContent],before);assert.equal(d.downloads.length,2);
    if(action==='requery'){const fresh=await exported(d,'query-embedding-detail',queryTitles[1]);assert.deepEqual(JSON.parse(fresh.text),inputOf().queryResult.query.vector);}
    await act(d.get('clear'));
  }}finally{adapterControl.embed=null;adapterControl.query=null;}
});

test('selected cleanup cannot erase a same-source replacement presentation entered by URL revocation',async()=>{
  denseAdapters();const revokeURL=URL.revokeObjectURL;try{const d=mount();await accepted(d);const old=await exported(d,'embedding-detail',selectedTitles[1]);let reentered=false;
    URL.revokeObjectURL=url=>{revokeURL(url);if(url===old.href&&!reentered){reentered=true;d.get('chunk-select').value='1';d.get('chunk-select').dispatch('change');}};
    await act(d.get('chunk-select'),'change');assert.equal(reentered,true);assert.match(d.get('embedding-meta').textContent,/Chunk 2 of 3/);
    await revoked(old);const fresh=await exported(d,'embedding-detail',selectedTitles[1]);assert.equal(fresh.filename,'selected-vector-2.json');assert.deepEqual(JSON.parse(fresh.text),inputOf().embeddingArtifact.vectors[1]);await act(d.get('clear'));
  }finally{URL.revokeObjectURL=revokeURL;adapterControl.embed=null;adapterControl.query=null;}
});

test('query cleanup cannot scrub fresh question and candidates after a reentrant query retry',async()=>{
  denseAdapters();const revokeURL=URL.revokeObjectURL;try{const d=mount();await accepted(d);const old=await exported(d,'query-embedding-detail',queryTitles[1]);let reentered=false;
    URL.revokeObjectURL=url=>{revokeURL(url);if(url===old.href&&!reentered){reentered=true;d.get('question-input').value='Fresh question B';d.get('run-query').dispatch('click');}};
    await act(d.get('question-input'),'input');await tick();assert.equal(reentered,true);assert.equal(d.get('question-original').textContent,'Fresh question B');assert.match(d.get('candidate-results').textContent,/PRIVATE_BETA/);
    const before=d.get('candidate-results').textContent;await revoked(old);assert.equal(d.get('candidate-results').textContent,before);const fresh=await exported(d,'query-embedding-detail',queryTitles[1]);assert.deepEqual(JSON.parse(fresh.text),inputOf().queryResult.query.vector);await act(d.get('clear'));
  }finally{URL.revokeObjectURL=revokeURL;adapterControl.embed=null;adapterControl.query=null;}
});

test('unrelated source navigation and generation retain valid selected and query records',async()=>{
  denseAdapters();try{const gate=deferred(),d=mount({generate:()=>gate.promise});await accepted(d);await act(d.get('assemble-context'));
    const selected=await exported(d,'embedding-detail',selectedTitles[1]),query=await exported(d,'query-embedding-detail',queryTitles[1]);
    await act(d.get('page-select'),'change');await act(d.get('generate-answer'));
    for(const record of [selected,query]){assert.ok(record.pre.textContent.length>0);assert.equal((await fetch(record.href)).ok,true);assert.equal(completeText(record.detail),record.text);}
    await act(d.get('cancel'));await act(d.get('clear'));for(const record of [selected,query])await revoked(record);
  }finally{adapterControl.embed=null;adapterControl.query=null;}
});

test('failure disclosure proactively clears retained diagnostic text and callbacks after a no-op edit',async()=>{
  adapterControl.embed=async(input,options)=>{throw Object.assign(new Error('private diagnostic'),{code:'WORKER_UNAVAILABLE',diagnostic:createRuntimeFailure(options.identity,{allowedCode:'WORKER_UNAVAILABLE',failureOrigin:'native-worker-error',readyObserved:false,commandPosted:false,lastSeq:0,elapsedMs:1})});};
  try{const d=mount();d.get('pdf-file').files=[{name:'FAILURE.pdf'}];await act(d.get('pdf-file'),'change');await act(d.get('build-chunks'));await act(d.get('embed-chunks'));
    const detail=byTag(d.get('embedding-detail'),'details').find(n=>n.textContent.includes('failure boundary'));assert.ok(detail);detail.open=true;await act(detail,'toggle');const pre=byTag(detail,'pre')[0],toggle=detail.listeners.get('toggle')[0];assert.ok(pre.textContent.includes('encoder-client'));
    await act(d.get('question-input'),'input');assert.equal(pre.textContent,'','Detached diagnostics must also be scrubbed');detail.open=true;toggle();assert.equal(byTag(detail,'pre').length,0);assert.doesNotMatch(d.get('embedding-detail').textContent,/private diagnostic/);
  }finally{adapterControl.embed=null;}
});
