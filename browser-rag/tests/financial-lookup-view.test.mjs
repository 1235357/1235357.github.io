import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dom,nodes,byTag,deferred,act} from './pdf-app-dom-fixture.mjs';
import {deriveFinancialTableLookup} from '../financial-table-contract.mjs';
const module=await import('../financial-lookup-view.mjs').catch(()=>({}));
// Archived native development source; these DOM doubles run no browser/parser/model.
const source=()=>JSON.parse(readFileSync(new URL('../../docs/acceptance-2026-10-11/native-pdfjs-full-geometry.json',import.meta.url),'utf8'));
const request={statement:'Condensed Consolidated Statements of Income',metric:'Net income',durationMonths:3,periodEndLiteral:'Jul 28, 2024',unitHeadingLiteral:'(In millions, except per share data)',currencyGlyph:'$'};
const fields=['statement','metric','duration','date','unit','glyph'];
const get=(d,key)=>nodes(d.root).find(node=>node.id===`source-cell-${key}`);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function mount(extra={}){assert.equal(typeof module.createFinancialLookupView,'function');const d=dom(),v=module.createFinancialLookupView({document:d.document,root:d.root,digest:async bytes=>hash(bytes),...extra});return {...d,v};}
function fill(d,req=request){const values=[req.statement,req.metric,String(req.durationMonths),req.periodEndLiteral,req.unitHeadingLiteral,req.currencyGlyph];fields.forEach((key,i)=>{get(d,key).value=values[i];get(d,key).dispatch('input');});}
const render=(d,input=source(),extra={})=>d.v.render({source:input,documentEpoch:7,active:false,cancelled:false,...extra});
const detail=(d,text)=>byTag(d.root,'details').find(node=>node.children[0].textContent===text);

test('six initially empty fields perform no work until explicit lookup; pending amount waits for exact-byte receipt',async()=>{
  const pending=deferred();let calls=0,bytes;const d=mount({digest:value=>{calls++;bytes=value;return pending.promise;}}),input=source();render(d,input);
  fields.forEach(key=>assert.equal(get(d,key).value,''));assert.equal(calls,0);assert.equal(byTag(d.root,'pre').length,0);
  fill(d);get(d,'run').dispatch('click');assert.equal(calls,1);assert.match(get(d,'status').textContent,/computing snapshot digest/);assert.equal(byTag(d.root,'details').length,0);
  assert.equal(nodes(d.root).filter(node=>node.className==='lookup-amount').length,0);
  assert.equal(new TextDecoder().decode(bytes),JSON.stringify(input,null,2));pending.resolve(hash(bytes));await act(get(d,'run'),'unused');
  const expected=deriveFinancialTableLookup(input,request);assert.equal(nodes(d.root).find(node=>node.className==='lookup-amount').textContent,expected.amountLiteral);
  assert.match(get(d,'result').textContent,/financial correctness unadjudicated/);assert.match(get(d,'result').textContent,/normalized currency is unset/);
  assert.equal(byTag(d.root,'pre').length,0);assert.equal(get(d,'cancel').disabled,true);
  const snapshot=detail(d,'Complete lookup geometry snapshot · exact digest bytes');snapshot.open=true;await act(snapshot,'toggle');
  const text=byTag(snapshot,'pre')[0].textContent;assert.equal(text,JSON.stringify(input,null,2));assert.deepEqual(JSON.parse(text),input);assert.match(snapshot.textContent,new RegExp(hash(bytes)));
  const receipt=detail(d,'Complete source-cell lookup receipt');receipt.open=true;await act(receipt,'toggle');
  const saved=JSON.parse(byTag(receipt,'pre')[0].textContent);assert.deepEqual(saved.result,expected);assert.equal(saved.viewReceipt.snapshot.sha256,hash(bytes));assert.equal(saved.viewReceipt.snapshot.utf8Bytes,bytes.length);assert.equal(saved.viewReceipt.ownership.documentEpoch,7);
  const bindings=detail(d,'Exact source roles and all dated columns');bindings.open=true;await act(bindings,'toggle');
  const proof=JSON.parse(byTag(bindings,'pre')[0].textContent);assert.deepEqual(proof.selected,expected.bindings);assert.deepEqual(proof.columns,expected.columns);assert.equal(calls,1);assert.equal(byTag(d.root,'img').length,0);
});

test('missing or unsupported explicit fields refuse before reading source or invoking digest',async()=>{
  let reads=0,calls=0;const input=new Proxy({},{get(){reads++;throw Error('SECRET SOURCE');}}),d=mount({digest:()=>{calls++;}});render(d,input);
  await act(get(d,'run'));assert.match(get(d,'status').textContent,/UNSUPPORTED_LOOKUP_REQUEST/);assert.equal(reads,0);assert.equal(calls,0);
  fill(d,{...request,metric:'Revenue'});await act(get(d,'run'));assert.equal(reads,0);assert.equal(calls,0);
  fill(d,{...request,unitHeadingLiteral:'USD millions'});await act(get(d,'run'));assert.equal(reads,0);assert.equal(calls,0);assert.doesNotMatch(d.root.textContent,/SECRET/);assert.equal(byTag(d.root,'details').length,0);
});

test('each of six request edits revokes a committed result and a pending digest without leaking previous selections',async()=>{
  for(const key of fields){
    const a=deferred();let calls=0;const d=mount({digest:bytes=>++calls===1?Promise.resolve(hash(bytes)):a.promise});render(d);fill(d);await act(get(d,'run'));
    const old=detail(d,'Complete source-cell lookup receipt');old.open=true;await act(old,'toggle');assert.equal(byTag(old,'pre').length,1);
    get(d,key).dispatch('input');assert.equal(byTag(d.root,'details').length,0);assert.equal(byTag(old,'pre').length,0);old.dispatch('toggle');assert.equal(byTag(old,'pre').length,0);
    get(d,'run').dispatch('click');assert.equal(calls,2);get(d,key).value='changed';get(d,key).dispatch('change');a.resolve('a'.repeat(64));await act(get(d,key),'unused');
    assert.equal(byTag(d.root,'details').length,0);assert.equal(nodes(d.root).filter(n=>n.className==='lookup-amount').length,0);assert.match(get(d,'status').textContent,/Fields changed/);
  }
});

test('every core render/source epoch/activity/cancellation/clear invalidates delayed output and obsolete disclosures',async()=>{
  for(const action of ['render','source','epoch','active','cancelled','clear']){
    const pending=deferred(),d=mount({digest:()=>pending.promise}),input=source();render(d,input);fill(d);get(d,'run').dispatch('click');
    render(d,action==='clear'?null:action==='source'?source():input,{documentEpoch:action==='epoch'?8:7,active:action==='active',cancelled:action==='cancelled'});
    pending.resolve('b'.repeat(64));await act(get(d,'run'),'unused');assert.equal(byTag(d.root,'details').length,0);assert.equal(byTag(d.root,'pre').length,0);
    if(['source','epoch','clear'].includes(action))fields.forEach(key=>assert.equal(get(d,key).value,''));
  }
});

test('cancel A then retry B keeps B current after late A; Clear result retains selections and revokes detached lazy callbacks',async()=>{
  const a=deferred(),b=deferred();let calls=0,bytes;const d=mount({digest:value=>{bytes=value;return ++calls===1?a.promise:b.promise;}});render(d);fill(d);
  get(d,'run').dispatch('click');await act(get(d,'cancel'));assert.match(get(d,'status').textContent,/cancelled/);assert.equal(get(d,'run').disabled,false);
  get(d,'duration').value='6';get(d,'duration').dispatch('change');get(d,'run').dispatch('click');a.resolve('a'.repeat(64));await act(get(d,'run'),'unused');
  assert.equal(get(d,'cancel').disabled,false);assert.equal(byTag(d.root,'details').length,0);b.resolve(hash(bytes));await act(get(d,'run'),'unused');
  const receipt=detail(d,'Complete source-cell lookup receipt');receipt.open=true;await act(receipt,'toggle');assert.equal(JSON.parse(byTag(receipt,'pre')[0].textContent).result.request.durationMonths,6);
  const values=fields.map(key=>get(d,key).value);await act(get(d,'clear'));assert.deepEqual(fields.map(key=>get(d,key).value),values);assert.equal(byTag(d.root,'details').length,0);assert.equal(byTag(receipt,'pre').length,0);receipt.dispatch('toggle');assert.equal(byTag(receipt,'pre').length,0);
});

test('clear pending digest and a fresh mount have no shared candidate or receipt',async()=>{
  const pending=deferred(),d=mount({digest:()=>pending.promise});render(d);fill(d);get(d,'run').dispatch('click');await act(get(d,'clear'));pending.resolve('c'.repeat(64));await act(get(d,'run'),'unused');assert.equal(byTag(d.root,'details').length,0);
  const other=mount();render(other);fields.forEach(key=>assert.equal(get(other,key).value,''));assert.equal(byTag(other.root,'details').length,0);
});

test('binding and digest failures use safe refusal text and never retain an old candidate',async()=>{
  const d=mount({digest:()=>Promise.reject(Error('SECRET DIGEST'))});render(d);fill(d);await act(get(d,'run'));assert.match(get(d,'status').textContent,/LOOKUP_RECEIPT_FAILED/);assert.doesNotMatch(d.root.textContent,/SECRET/);assert.equal(byTag(d.root,'details').length,0);
  const input=source();input.pages[0].geometry.rotation=90;render(d,input);fill(d);await act(get(d,'run'));assert.match(get(d,'status').textContent,/UNSUPPORTED_TABLE_GEOMETRY/);assert.equal(byTag(d.root,'details').length,0);
});
