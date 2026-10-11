import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once,getEventListeners} from 'node:events';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {registerHooks} from 'node:module';

// Controlled loopback transport and a test-only module URL. No remote service,
// PDF, model, native browser or Worker is used by these static-body tests.
const actual=readFileSync(new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs',import.meta.url));
const digest='07ceb740d746e5d9012fcf9f27d5c7dea09f7d2f5e74f5c8109e5787551a2333';
const nativeFetch=globalThis.fetch,realTimeout=globalThis.setTimeout,realClear=globalThis.clearTimeout;
let scenario={},requests=[];
const server=createServer((request,response)=>{
  requests.push({url:request.url,method:request.method,cookie:request.headers.cookie});
  if(request.url==='/redirect'){response.writeHead(302,{Location:'/browser-rag/vendor/build/pdf.worker.mjs'});response.end();return;}
  const body=scenario.body??actual,wire=scenario.gzip?gzipSync(body):body;
  response.writeHead(scenario.status??200,scenario.noLength?{}:{'Content-Length':String(wire.length),...(scenario.gzip?{'Content-Encoding':'gzip'}:{})});
  if(scenario.stall){response.write(wire.subarray(0,3));return;}if(scenario.stallEof){response.write(wire);return;}response.end(wire);
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`,moduleURL=`${base}/browser-rag/pdf-worker-preparation.mjs`;
const assetURL=`${base}/browser-rag/vendor/build/pdf.worker.mjs`;
const oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
Object.defineProperty(globalThis,'location',{value:{href:`${base}/browser-rag/inspector.html`},configurable:true,writable:true});
const target=new URL('../pdf-worker-preparation.mjs',import.meta.url).href;
const hooks=registerHooks({load(url,context,next){
  if(url===target){return {format:'module',source:readFileSync(new URL(url),'utf8').replaceAll('import.meta.url',JSON.stringify(moduleURL)),shortCircuit:true};}
  return next(url,context);
}});
let api,importError;try{api=await import('../pdf-worker-preparation.mjs');}catch(error){importError=error;}hooks.deregister();
after(async()=>{if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else delete globalThis.location;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const code=expected=>error=>{assert.equal(error.name,'PdfWorkerPreparationError');assert.equal(error.code,expected);assert.equal(error.cause,undefined);return true;};
const run=options=>{assert.equal(importError,undefined,'public static preparer must exist and import without side effects');return api.preparePdfWorker({signal:new AbortController().signal,...options});};
const reset=()=>{scenario={};requests=[];globalThis.location={href:`${base}/browser-rag/inspector.html`};};
function fakeDeadline(t){
  let fire,cleared=0;const token={test:'120-second-static-deadline'};
  t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>{if(ms===120000){assert.equal(fire,undefined,'one nonrenewed timer');fire=callback;return token;}return realTimeout(callback,ms,...args);});
  t.mock.method(globalThis,'clearTimeout',id=>{if(id===token){cleared++;return;}return realClear(id);});
  return {fire:()=>{assert.equal(typeof fire,'function');fire();},cleared:()=>cleared};
}

test('fixed worker pin matches the existing registry and independently hashed installed npm body',()=>{
  assert.equal(importError,undefined);assert.equal(typeof api.preparePdfWorker,'function');
  assert.equal(actual.length,2229713);assert.equal(createHash('sha256').update(actual).digest('hex'),digest);
  const registry=JSON.parse(readFileSync(new URL('../pdf-assets.json',import.meta.url),'utf8'));
  assert.equal(api.PDF_WORKER_PREPARATION_SPEC.parserVersion,registry.version);
  assert.equal(api.PDF_WORKER_PREPARATION_SPEC.sha256,registry.moduleHashes['build/pdf.worker.mjs']);
  assert.equal(api.PDF_WORKER_PREPARATION_SPEC.bytes,actual.length);assert.equal(api.PDF_WORKER_PREPARATION_SPEC.deadlineMs,120000);assert.ok(Object.isFrozen(api.PDF_WORKER_PREPARATION_SPEC));
});

test('one exact native same-origin request consumes EOF before returning a bounded immutable static receipt',async t=>{
  reset();const calls=[],progress=[],timer=fakeDeadline(t);
  t.mock.method(globalThis,'fetch',(url,options)=>{calls.push({url,options});return nativeFetch(url,options);});
  const aborter=new AbortController(),receipt=await run({signal:aborter.signal,onProgress:value=>progress.push(value)});
  assert.equal(calls.length,1);assert.equal(calls[0].url,assetURL);
  assert.deepEqual(Object.keys(calls[0].options).sort(),['cache','credentials','mode','redirect','referrerPolicy','signal'].sort());
  assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.mode,'same-origin');assert.equal(calls[0].options.cache,'default');assert.equal(calls[0].options.referrerPolicy,'no-referrer');
  assert.deepEqual(requests,[{url:'/browser-rag/vendor/build/pdf.worker.mjs',method:'GET',cookie:undefined}]);
  assert.equal(receipt.status,'static-pdf-worker-body-verified');assert.equal(receipt.url,assetURL);assert.equal(receipt.bytes,actual.length);assert.equal(receipt.sha256,digest);assert.equal(receipt.cacheScope,'browser-http-cache-advisory');assert.ok(Object.isFrozen(receipt));
  assert.ok(progress.length>1);assert.ok(progress.every(value=>Object.keys(value).join(',')==='completed,total,unit,estimated'&&Object.isFrozen(value)));
  assert.ok(progress.every(value=>value.unit==='bytes'&&value.total===actual.length&&value.estimated===false));
  assert.equal(progress.at(-1).completed,actual.length);assert.equal(timer.cleared(),1);
  assert.equal(getEventListeners(aborter.signal,'abort').length,0);
});

test('native gzip delivery verifies decoded EOF size/SHA rather than compressed Content-Length',async()=>{reset();scenario.gzip=true;const result=await run();assert.equal(result.bytes,2229713);assert.equal(result.sha256,digest);});
for(const [name,body] of [['short',actual.subarray(0,-1)],['extra',Buffer.concat([actual,Buffer.from('x')])],['corrupt',Buffer.concat([Buffer.from('!'),actual.subarray(1)])]])test(`refuses ${name} body before static success`,async()=>{reset();scenario.body=body;scenario.noLength=true;await assert.rejects(run(),code('PDF_WORKER_PREPARATION_INTEGRITY'));});
test('non-200 static response refuses without claiming preparation',async()=>{reset();scenario.status=503;await assert.rejects(run(),code('PDF_WORKER_PREPARATION_INTEGRITY'));});
test('native redirect error is a finite failure, with no follow-up request',async()=>{reset();let calls=0;const result=run();await result;assert.equal(requests.length,1);requests=[];const original=globalThis.fetch;try{globalThis.fetch=(url,options)=>{calls++;return nativeFetch(`${base}/redirect`,options);};await assert.rejects(run(),code('PDF_WORKER_PREPARATION_FAILED'));assert.equal(calls,1);assert.equal(requests.length,1);}finally{globalThis.fetch=original;}});
test('different final URL and followed redirect are refused',async t=>{reset();t.mock.method(globalThis,'fetch',()=>nativeFetch(`${base}/other`));await assert.rejects(run(),code('PDF_WORKER_PREPARATION_INTEGRITY'));t.mock.restoreAll();t.mock.method(globalThis,'fetch',()=>nativeFetch(`${base}/redirect`));await assert.rejects(run(),code('PDF_WORKER_PREPARATION_INTEGRITY'));});

test('already aborted input never calls fetch',async t=>{reset();let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;});const aborter=new AbortController();aborter.abort();await assert.rejects(run({signal:aborter.signal}),code('ABORTED'));assert.equal(calls,0);});
for(const phase of ['fetch','body'])test(`120s deadline settles when ${phase} ignores AbortSignal, without timer renewal`,async t=>{
  reset();const deadline=fakeDeadline(t),wait=deferred(),reading=deferred();let fetchSignal;
  if(phase==='fetch')t.mock.method(globalThis,'fetch',(_,options)=>{fetchSignal=options.signal;return wait.promise;});
  else{scenario.stall=true;t.mock.method(globalThis,'fetch',(url,options)=>{fetchSignal=options.signal;return nativeFetch(url);});}
  const attempt=run({onProgress:value=>{if(value.completed>0)reading.resolve();}});if(phase==='body')await reading.promise;else{await tick();await tick();}deadline.fire();await assert.rejects(attempt,code('PDF_WORKER_PREPARATION_TIMEOUT'));
  assert.equal(fetchSignal.aborted,true);assert.equal(deadline.cleared(),1);
  if(phase==='fetch'){scenario={};wait.resolve(await nativeFetch(assetURL));await tick();}
});
for(const phase of ['fetch','body'])test(`external cancellation settles when ${phase} ignores AbortSignal and suppresses late progress`,async t=>{
  reset();const wait=deferred(),reading=deferred(),aborter=new AbortController(),progress=[];let fetchSignal;
  if(phase==='fetch')t.mock.method(globalThis,'fetch',(_,options)=>{fetchSignal=options.signal;return wait.promise;});
  else{scenario.stall=true;t.mock.method(globalThis,'fetch',(url,options)=>{fetchSignal=options.signal;return nativeFetch(url);});}
  const attempt=run({signal:aborter.signal,onProgress:value=>{progress.push(value);if(value.completed>0)reading.resolve();}});if(phase==='body')await reading.promise;else{await tick();await tick();}aborter.abort();await assert.rejects(attempt,code('ABORTED'));
  const count=progress.length;assert.equal(fetchSignal.aborted,true);if(phase==='fetch'){scenario={};wait.resolve(await nativeFetch(assetURL));await tick();}assert.equal(progress.length,count);
  assert.equal(getEventListeners(aborter.signal,'abort').length,0);
});
test('a progress callback can revoke ownership before preparation returns',async()=>{reset();const aborter=new AbortController();await assert.rejects(run({signal:aborter.signal,onProgress:value=>{if(value.completed>0)aborter.abort();}}),code('ABORTED'));});
for(const options of [{file:'private.pdf'},{question:'private'},{url:'https://elsewhere.test'},{deadlineMs:999999},{signal:null}])test(`refuses unsupported options ${Object.keys(options).join(',')} without a request`,async()=>{reset();await assert.rejects(run(options),code('INVALID_PDF_WORKER_PREPARATION'));assert.equal(requests.length,0);});
test('unknown option getters are not evaluated',async()=>{reset();let reads=0;const options={signal:new AbortController().signal};Object.defineProperty(options,'file',{enumerable:true,get(){reads++;return 'private';}});await assert.rejects(api.preparePdfWorker(options),code('INVALID_PDF_WORKER_PREPARATION'));assert.equal(reads,0);assert.equal(requests.length,0);});
test('cross-origin page context refuses before any static fetch',async()=>{reset();globalThis.location={href:'https://different.test/'};await assert.rejects(run(),code('INVALID_PDF_WORKER_PREPARATION'));assert.equal(requests.length,0);reset();});
test('arbitrary fetch failure getters cannot escape the finite typed-error boundary',async t=>{
  reset();let reads=0;const hostile={};Object.defineProperty(hostile,'code',{get(){reads++;throw new Error('private getter');}});
  t.mock.method(globalThis,'fetch',()=>Promise.reject(hostile));await assert.rejects(run(),code('PDF_WORKER_PREPARATION_FAILED'));assert.equal(reads,0);
});
test('a throwing rejection prototype trap remains a fixed preparation failure',async t=>{
  reset();const hostile=new Proxy({},{getPrototypeOf(){throw Error('private prototype trap');}});
  t.mock.method(globalThis,'fetch',()=>Promise.reject(hostile));await assert.rejects(run(),code('PDF_WORKER_PREPARATION_FAILED'));
});
test('receiving every pinned byte without EOF cannot renew the timer or yield success',async t=>{
  reset();scenario.noLength=true;scenario.stallEof=true;const deadline=fakeDeadline(t),full=deferred();
  const attempt=run({onProgress:value=>{if(value.completed===actual.length)full.resolve();}});await full.promise;
  deadline.fire();await assert.rejects(attempt,code('PDF_WORKER_PREPARATION_TIMEOUT'));assert.equal(deadline.cleared(),1);
});
test('each explicit preparation reads and verifies the body again; no shared success memo is reused',async()=>{
  reset();const a=await run(),b=await run();assert.notEqual(a,b);assert.equal(requests.length,2);assert.equal(a.sha256,b.sha256);
});
