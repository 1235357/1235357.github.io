import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfSession} from '../pdf-session.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const source = name => ({status:'extracted-not-indexed',source:{name,sha256:'a'.repeat(64),size:8},parser:{version:'6.4.299'},numPages:2,pages:[]});

test('source records commit only after a matching metadata terminal', async () => {
  const session = createPdfSession({extract:async()=>source('A'),runtimeId:'owner-a'});
  await session.select({name:'A'});
  assert.equal(session.snapshot().status,'extracted-not-indexed');
  assert.equal(session.document().source.name,'A');
  assert.equal(session.snapshot().lifecycle.terminal.payload.data.sourceSha256,'a'.repeat(64));
  assert.equal(Object.hasOwn(session.snapshot().lifecycle.terminal.payload.data,'pages'),false);
});

test('replaced A cannot commit after B is selected', async () => {
  const a=deferred(), b=deferred(); const calls=[];
  const session=createPdfSession({runtimeId:'owner-a',extract:(file,options)=>{
    calls.push(options); return file.name==='A'?a.promise:b.promise;
  }});
  const first=session.select({name:'A'}); const second=session.select({name:'B'});
  assert.equal(calls.length,2,'each selected document starts its owned extraction');
  assert.equal(calls[0].signal.aborted,true);
  const before=session.snapshot(); a.resolve(source('A')); await first;
  assert.deepEqual(session.snapshot(),before);
  assert.equal(session.document(),null);
  b.resolve(source('B')); await second;
  assert.equal(session.document().source.name,'B');
  assert.equal(session.snapshot().lifecycle.terminal.documentEpoch,2);
});

test('clear revokes identity and source without a late completion restoring it', async () => {
  const wait=deferred(); const session=createPdfSession({runtimeId:'owner-a',extract:()=>wait.promise});
  const operation=session.select({name:'A'}); session.clear();
  const cleared=session.snapshot(); wait.resolve(source('A')); await operation;
  assert.deepEqual(session.snapshot(),cleared);
  assert.equal(session.document(),null);
  assert.equal(session.snapshot().status,'idle');
});

test('cancelled operation cannot publish a late error or progress', async () => {
  const wait=deferred(); let onProgress;
  const session=createPdfSession({runtimeId:'owner-a',extract:(_,options)=>{onProgress=options.onProgress;return wait.promise;}});
  const operation=session.select({name:'A'}); session.cancel(); const cancelled=session.snapshot();
  assert.equal(typeof onProgress,'function','extraction receives its progress adapter');
  onProgress({completed:1,total:2,unit:'pages',estimated:false});
  wait.reject(Object.assign(new Error('private details'),{code:'PDF_INVALID'})); await operation;
  assert.deepEqual(session.snapshot(),cancelled);
  assert.equal(session.snapshot().status,'cancelled');
});

test('runtime errors are typed without persisting arbitrary exception text', async () => {
  const session=createPdfSession({runtimeId:'owner-a',extract:async()=>{throw new Error('private document text');}});
  await session.select({name:'A'});
  assert.equal(session.snapshot().status,'runtime-error');
  assert.equal(session.snapshot().error.code,'PDF_PARSE_ERROR');
  assert.equal(JSON.stringify(session.snapshot()).includes('private document text'),false);
});

test('malformed progress does not suppress a subsequent valid completion', async () => {
  const session=createPdfSession({runtimeId:'owner-a',extract:async(_,options)=>{
    options.onProgress({completed:5,total:2,unit:'pages',estimated:false});return source('A');
  }});
  await session.select({name:'A'});
  assert.equal(session.snapshot().status,'extracted-not-indexed');
});

test('documented parser error codes remain actionable without persisting exception text', async () => {
  for (const code of ['INVALID_INPUT','PARSER_VERSION_UNSUPPORTED','PDF_PASSWORD_REQUIRED']) {
    const session=createPdfSession({runtimeId:'error-owner',extract:async()=>{
      throw Object.assign(new Error('private text'),{code});
    }});
    await session.select({name:'A'});
    assert.equal(session.snapshot().error.code,code);
    assert.equal(JSON.stringify(session.snapshot()).includes('private text'),false);
  }
});
