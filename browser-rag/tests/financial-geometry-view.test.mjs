import {completeText,downloadHarness} from './bounded-text-dom-fixture.mjs';
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

test('native URL disposal preserves a newer source B geometry render at epoch 9',async()=>{
  const d=mount({digest:async bytes=>createHash('sha256').update(bytes).digest('hex')}),a=source(),b=source();b.source.name='GEOMETRY_B.pdf';
  const downloads=[],create=d.document.createElement.bind(d.document),revoke=URL.revokeObjectURL;
  d.document.createElement=tag=>{const node=create(tag);if(tag==='a')node.click=()=>downloads.push(node.attributes.get('href'));return node;};
  d.v.render({source:a,documentEpoch:1,active:false,cancelled:false});const old=detail(d);old.open=true;await act(old,'toggle');
  const oldPre=byTag(old,'pre')[0],oldDownload=byTag(old,'button').find(node=>node.textContent==='Download complete JSON');oldDownload.dispatch('click');
  assert.deepEqual(Buffer.from(await(await fetch(downloads[0])).arrayBuffer()),Buffer.from(JSON.stringify(a,null,2),'utf8'));
  let reentered=false,newDetail;
  try{
    URL.revokeObjectURL=url=>{revoke(url);if(!reentered){reentered=true;d.v.render({source:b,documentEpoch:9,active:false,cancelled:false});newDetail=detail(d);}};
    d.v.render({source:a,documentEpoch:2,active:false,cancelled:false});
  }finally{URL.revokeObjectURL=revoke;}
  assert.equal(reentered,true);assert.equal(detail(d),newDetail,'Old cleanup must preserve the newer geometry pane');
  assert.equal(oldPre.textContent,'');await assert.rejects(fetch(downloads[0]));
  newDetail.open=true;await act(newDetail,'toggle');assert.equal(completeText(newDetail),JSON.stringify(b,null,2));assert.match(newDetail.textContent,/document epoch 9/);
  old.dispatch('toggle');oldDownload.dispatch('click');assert.equal(completeText(newDetail),JSON.stringify(b,null,2));assert.equal(downloads.length,1);
});

test('a geometry viewer returned after a factory renders B is immediately disposed with its late old nodes',async()=>{
  const d=dom(),a=source(),b=source();b.source.name='LATE_GEOMETRY_B.pdf';let v,latePre,disposals=0;
  v=module.createFinancialGeometryView({document:d.document,root:d.root,digest:async()=> 'a'.repeat(64),textView:args=>{
    v.render({source:b,documentEpoch:9,active:false,cancelled:false});latePre=d.document.createElement('pre');latePre.textContent='PRIVATE LATE GEOMETRY';args.root.append(latePre);
    return {dispose(){disposals++;}};
  }});
  v.render({source:a,documentEpoch:1,active:false,cancelled:false});const old=detail(d);old.open=true;await act(old,'toggle');
  assert.equal(disposals,1);assert.equal(latePre.textContent,'');assert.equal(byTag(old,'pre').length,0);assert.equal(byTag(d.root,'pre').length,0);
  assert.notEqual(detail(d),old);assert.doesNotMatch(d.root.textContent,/PRIVATE/);
});

test('geometry disclosure close and source rerender revoke actual full exports without stale callbacks clearing the next viewer',async()=>{
  const d=dom(),exports=downloadHarness(d.document),input=source();
  const v=module.createFinancialGeometryView({document:d.document,root:d.root,textView:exports.textView,digest:async bytes=>createHash('sha256').update(bytes).digest('hex')});
  const render=epoch=>v.render({source:input,documentEpoch:epoch,active:false,cancelled:false});
  render(1);const old=detail(d);old.open=true;await act(old,'toggle');
  const oldPre=byTag(old,'pre')[0],oldDownload=byTag(old,'button').find(n=>n.textContent==='Download complete JSON');
  oldDownload.dispatch('click');assert.equal(await exports.blobs[0].text(),JSON.stringify(input,null,2));
  assert.deepEqual(exports.clicked,['pdfjs-geometry-snapshot.json']);
  old.open=false;await act(old,'toggle');assert.equal(oldPre.textContent,'');assert.deepEqual(exports.revoked,['blob:test-export-1']);
  old.open=true;await act(old,'toggle');byTag(old,'button').find(n=>n.textContent==='Download complete JSON').dispatch('click');
  render(2);assert.deepEqual(exports.revoked,['blob:test-export-1','blob:test-export-2']);
  const current=detail(d);current.open=true;await act(current,'toggle');const text=completeText(current);
  old.dispatch('toggle');oldDownload.dispatch('click');assert.equal(completeText(current),text);assert.equal(exports.blobs.length,2);
});
test('private capture is explicit/lazy, complete/inert and hashes exact displayed UTF8 bytes',async()=>{
  let calls=0;const d=mount({digest:async bytes=>{calls++;return createHash('sha256').update(bytes).digest('hex');}}),input=source();
  d.v.render({source:input,documentEpoch:7,active:false,cancelled:false});assert.equal(calls,0);assert.equal(byTag(d.root,'pre').length,0);
  const node=detail(d);node.open=true;await act(node,'toggle');assert.equal(calls,1);
  const text=completeText(node);assert.equal(text,JSON.stringify(input,null,2));assert.deepEqual(JSON.parse(text),input);
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
  const current=detail(d);current.open=true;await act(current,'toggle');assert.deepEqual(JSON.parse(completeText(current)),a);
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
  assert.equal(byTag(old,'pre').length,0);assert.deepEqual(JSON.parse(completeText(current)),input);
});
