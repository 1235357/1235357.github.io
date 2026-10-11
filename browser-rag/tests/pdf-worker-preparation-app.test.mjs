import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {dom,act,deferred,adapterControl} from './pdf-app-dom-fixture.mjs';
import {tick,inputOf} from './financial-generation-fixture.mjs';

const fixture=new URL('./pdf-app-dom-fixture.mjs',import.meta.url).href;
const hooks=registerHooks({load(url,context,next){if(url.endsWith('/pdf-app.mjs'))return {format:'module',source:readFileSync(new URL(url),'utf8').replaceAll('import.meta.url',JSON.stringify('https://example.test/browser-rag/pdf-app.mjs')),shortCircuit:true};return next(url,context);},resolve(specifier,context,next){
  if(context.parentURL?.endsWith('/pdf-app.mjs')){
    if(specifier==='./vendor/build/pdf.mjs')return {url:'data:text/javascript,export const version="6.4.299";',shortCircuit:true};
    if(['./pdf-source.mjs','./compute-source.mjs','./embedding-source.mjs','./query-source.mjs'].includes(specifier))return {url:fixture,shortCircuit:true};
  }return next(specifier,context);
}});
const {mountPdfApp}=await import('../pdf-app.mjs');hooks.deregister();
const mount=options=>{const d=dom();mountPdfApp({document:d.document,root:d.root,...options});return d;};
const select=async(d,name)=>{d.get('pdf-file').files=[{name}];await act(d.get('pdf-file'),'change');};
const receipt=()=>Object.freeze({schemaVersion:1,status:'static-pdf-worker-body-verified',parserVersion:'6.4.299',
  url:'https://example.test/browser-rag/vendor/build/pdf.worker.mjs',bytes:2229713,
  sha256:'07ceb740d746e5d9012fcf9f27d5c7dea09f7d2f5e74f5c8109e5787551a2333',elapsedMs:2,cacheScope:'browser-http-cache-advisory'});

test('public-only hook receives owned signal/progress, no selected file/question, and completes before extraction',async()=>{
  const wait=deferred(),calls=[];let captured;
  adapterControl.extract=async file=>{calls.push(file.name);return inputOf().source;};
  try{
    const d=mount({preparePdfWorker:options=>{captured=options;return wait.promise;}});
    await select(d,'SECRET.pdf');assert.deepEqual(calls,[]);
    assert.deepEqual(Reflect.ownKeys(captured),['signal','onProgress']);assert.ok(Object.isFrozen(captured));
    assert.ok(captured.signal instanceof AbortSignal);assert.equal(captured.signal.aborted,false);
    captured.onProgress({completed:123,total:2229713,unit:'bytes',estimated:false});
    assert.match(d.get('status-title').textContent,/Preparing pinned parser script/);
    assert.match(d.get('status-detail').textContent,/received|integrity/i);assert.doesNotMatch(d.get('status-detail').textContent,/SECRET/);
    wait.resolve(receipt());await tick();await tick();assert.deepEqual(calls,['SECRET.pdf']);
    assert.match(d.get('status-title').textContent,/Extracted/);
    assert.match(d.get('receipt').textContent,/browser-http-cache-advisory/);
  }finally{adapterControl.extract=null;}
});

for(const action of ['cancel','clear','pagehide','replace'])test(`${action} revokes late A preparation; it cannot invoke extraction or update B`,async()=>{
  const a=deferred(),b=deferred(),signals=[],calls=[];
  adapterControl.extract=async file=>{calls.push(file.name);const source=inputOf().source;source.source.name=file.name;return source;};
  try{
    const d=mount({preparePdfWorker:options=>{signals.push(options);return signals.length===1?a.promise:b.promise;}});
    await select(d,'A.pdf');
    if(action==='pagehide')await act(d.window,'pagehide');else if(action!=='replace')await act(d.get(action));
    await select(d,'B.pdf');assert.equal(signals[0].signal.aborted,true);
    const before=[d.get('status-title').textContent,d.get('status-detail').textContent];
    a.resolve(receipt());signals[0].onProgress({completed:2000000,total:2229713,unit:'bytes',estimated:false});
    await tick();await tick();assert.deepEqual(calls,[]);assert.deepEqual([d.get('status-title').textContent,d.get('status-detail').textContent],before);
    b.resolve(receipt());await tick();await tick();assert.deepEqual(calls,['B.pdf']);assert.match(d.get('receipt').textContent,/B.pdf/);
    await act(d.get('clear'));assert.doesNotMatch(d.get('receipt').textContent,/static-pdf-worker-body-verified/);
  }finally{adapterControl.extract=null;}
});

test('finite preparation refusal stays typed, inert, and never invokes extraction',async()=>{
  let calls=0;adapterControl.extract=async()=>{calls++;return inputOf().source;};
  try{
    const d=mount({preparePdfWorker:async()=>{throw Object.assign(new Error('private text <img>'),{code:'PDF_WORKER_PREPARATION_TIMEOUT'});}});
    await select(d,'A.pdf');assert.equal(calls,0);assert.match(d.get('status-detail').textContent,/120|fixed.*budget/i);
    assert.doesNotMatch(d.get('status-detail').textContent,/private text|<img>/);
  }finally{adapterControl.extract=null;}
});

test('invalid preflight hooks fail before listeners; ordinary/private entry and direct extraction remain unchanged',async()=>{
  const d=dom();assert.throws(()=>mountPdfApp({document:d.document,root:d.root,preparePdfWorker:true}),TypeError);
  assert.equal([...d.root.nodes.values()].flatMap(node=>[...node.listeners.values()].flat()).length,0);
  const ordinary=mount();await select(ordinary,'DIRECT.pdf');assert.match(ordinary.get('status-title').textContent,/Extracted/);
  for(const name of ['pdf-entry.mjs','pdf-private-entry.mjs'])assert.doesNotMatch(readFileSync(new URL(`../${name}`,import.meta.url),'utf8'),/preparePdfWorker|pdf-worker-preparation/);
  const publicEntry=readFileSync(new URL('../pdf-public-entry.mjs',import.meta.url),'utf8');assert.match(publicEntry,/pdf-worker-preparation/);assert.match(publicEntry,/preparePdfWorker/);
  const source=readFileSync(new URL('../pdf-source.mjs',import.meta.url),'utf8');assert.match(source,/WORKER_STARTUP_TIMEOUT_MS = 10000/);assert.doesNotMatch(source,/preparation/);
});
test('preparer rejection getters are normalized before entering the existing parser session',async()=>{
  let reads=0,calls=0;const hostile={};Object.defineProperty(hostile,'code',{get(){reads++;throw Error('private getter');}});
  adapterControl.extract=async()=>{calls++;return inputOf().source;};
  try{
    const d=mount({preparePdfWorker:async()=>{throw hostile;}});await select(d,'A.pdf');
    assert.equal(reads,0);assert.equal(calls,0);assert.match(d.get('status-detail').textContent,/Static parser preparation failed/);assert.doesNotMatch(d.get('trace').textContent,/private getter/);
  }finally{adapterControl.extract=null;}
});
