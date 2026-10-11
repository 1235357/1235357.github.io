import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {dom,byTag,deferred,act} from './pdf-app-dom-fixture.mjs';
import {inputOf} from './financial-generation-fixture.mjs';
const module=await import('../financial-geometry-view.mjs').catch(()=>({}));
const source=()=>inputOf().source;
const title='Complete owned PDF.js geometry snapshot · capture only';
function mount(extra={}){assert.equal(typeof module.createFinancialGeometryView,'function');const d=dom(),v=module.createFinancialGeometryView({document:d.document,root:d.root,...extra});return {...d,v};}
const detail=d=>byTag(d.root,'details').find(node=>node.children[0].textContent===title);
test('private capture is explicit/lazy, complete/inert and hashes exact displayed UTF8 bytes',async()=>{
  let calls=0;const d=mount({digest:async bytes=>{calls++;return createHash('sha256').update(bytes).digest('hex');}}),input=source();
  d.v.render({source:input,documentEpoch:7,active:false,cancelled:false});assert.equal(calls,0);assert.equal(byTag(d.root,'pre').length,0);
  const node=detail(d);node.open=true;await act(node,'toggle');assert.equal(calls,1);
  const text=byTag(node,'pre')[0].textContent;assert.equal(text,JSON.stringify(input,null,2));assert.deepEqual(JSON.parse(text),input);
  assert.match(node.textContent,new RegExp(createHash('sha256').update(text).digest('hex')));assert.match(node.textContent,/document epoch 7/);
  assert.match(d.root.textContent,/normalized currency is unset/);assert.match(d.root.textContent,/not glyph boxes/);assert.equal(byTag(d.root,'img').length,0);
});
test('pending A digest and detached callbacks cannot publish after cancellation, source replacement or epoch change',async()=>{
  for(const action of ['cancel','source','epoch']){
    const pending=deferred(),d=mount({digest:()=>pending.promise}),a=source();d.v.render({source:a,documentEpoch:1,active:false,cancelled:false});
    const old=detail(d);old.open=true;old.dispatch('toggle');
    d.v.render({source:action==='source'?source():a,documentEpoch:action==='epoch'?2:1,active:false,cancelled:action==='cancel'});
    pending.resolve('a'.repeat(64));await act(old,'toggle');assert.equal(byTag(old,'pre').length,0);assert.equal(byTag(d.root,'pre').length,0);
  }
});
test('same-source retry B owns its snapshot after late A and clearing leaves no disclosure',async()=>{
  const pending=deferred();let calls=0;const d=mount({digest:bytes=>++calls===1?pending.promise:Promise.resolve(createHash('sha256').update(bytes).digest('hex'))}),a=source();
  d.v.render({source:a,documentEpoch:1,active:false,cancelled:false});const old=detail(d);old.open=true;old.dispatch('toggle');
  d.v.render({source:a,documentEpoch:1,active:false,cancelled:true});d.v.render({source:a,documentEpoch:1,active:false,cancelled:false});
  const current=detail(d);current.open=true;await act(current,'toggle');assert.deepEqual(JSON.parse(byTag(current,'pre')[0].textContent),a);
  pending.resolve('f'.repeat(64));await act(old,'toggle');assert.equal(byTag(old,'pre').length,0);
  d.v.render({source:null,documentEpoch:2,active:false,cancelled:false});current.dispatch('toggle');assert.equal(byTag(current,'pre').length,0);assert.equal(detail(d),undefined);
});
test('explicit capture cancellation and a detached A toggle cannot consume a pending retry B',async()=>{
  const a=deferred(),b=deferred();let calls=0;const d=mount({digest:()=>++calls===1?a.promise:b.promise}),input=source();
  d.v.render({source:input,documentEpoch:1,active:false,cancelled:false});const old=detail(d);old.open=true;old.dispatch('toggle');
  const cancel=byTag(old,'button').find(node=>node.textContent==='Cancel geometry capture');assert.ok(cancel);cancel.dispatch('click');
  assert.match(old.textContent,/Capture cancelled/);assert.equal(byTag(old,'pre').length,0);
  d.v.render({source:input,documentEpoch:1,active:false,cancelled:false});const current=detail(d);current.open=true;current.dispatch('toggle');
  old.dispatch('toggle');a.resolve('a'.repeat(64));b.resolve('b'.repeat(64));await act(current,'unused');
  assert.equal(byTag(old,'pre').length,0);assert.deepEqual(JSON.parse(byTag(current,'pre')[0].textContent),input);
});
