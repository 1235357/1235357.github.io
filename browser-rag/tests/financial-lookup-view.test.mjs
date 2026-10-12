import {completeText,downloadHarness} from './bounded-text-dom-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dom,nodes,byTag,deferred,act} from './pdf-app-dom-fixture.mjs';
import {deriveFinancialTableLookup} from '../financial-table-contract.mjs';
import {createPageRecord} from '../pdf-source.mjs';
const module=await import('../financial-lookup-view.mjs').catch(()=>({}));
// Archived native development source; these DOM doubles run no browser/parser/model.
const source=()=>JSON.parse(readFileSync(new URL('../../docs/acceptance-2026-10-11/native-pdfjs-full-geometry.json',import.meta.url),'utf8'));
const request={statement:'Condensed Consolidated Statements of Income',metric:'Net income',durationMonths:3,periodEndLiteral:'Jul 28, 2024',unitHeadingLiteral:'(In millions, except per share data)',currencyGlyph:'$'};
const financialFields=['statement','metric','duration','date','unit','glyph'];
const fields=['basis',...financialFields];
const get=(d,key)=>{const node=nodes(d.root).find(node=>node.id===`source-cell-${key}`);assert.ok(node,`Required explicit lookup control: ${key}`);return node;};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const annualRequest={statement:'Consolidated Statements of Income',metric:'Net income',periodKind:'fiscal_year',durationMonths:null,periodEndLiteral:'Jan 25, 2026',unitHeadingLiteral:'(In millions, except per share data)',currencyGlyph:'$'};
// Test-only native-record construction, independent of the annual binder's tests.
// This is synthetic geometry and source text, not execution of a PDF parser.
function annualSource({split=false,statement=annualRequest.statement,amounts=['781','2,309','8,157'],reverse=false,dx=0,dy=0}={}){
  const item=(str,x,y,width=40,height=8)=>({str,dir:'ltr',transform:[8,0,0,8,x+dx,y+dy],width,height,fontName:'annual-view-synthetic',hasEOL:false});
  let items=[item(statement,100,720,400),item(annualRequest.unitHeadingLiteral,200,708,200),item('Year Ended',365,670,50)];
  if(split)items.push(...[['January 31,','2021'],['January 26,','2020'],['January 27,','2019']].flatMap(([date,year],index)=>[item(date,260+90*index,658,80),item(year,290+90*index,650,20)]));
  else items.push(...['Jan 25, 2026','Jan 26, 2025','Jan 28, 2024'].map((date,index)=>item(date,270+90*index,658,60)));
  items.push(item('Net income',20,300,50),...amounts.flatMap((value,index)=>[item('$',260+90*index,301.1,5),item(value,310+90*index,301.1,20)]),item('Other row',20,280,50),item('',200,300,0,0));
  if(reverse)items.reverse();const sha='c'.repeat(64),parser={name:'pdfjs',version:'6.4.299',policyVersion:'text-items-v1',disableNormalization:true};
  return structuredClone({schemaVersion:1,status:'extracted-not-indexed',source:{sha256:sha,name:'annual-view-synthetic.pdf',size:800},parser,numPages:1,workerMode:'node-fake',pages:[createPageRecord({sourceSha256:sha,parserVersion:parser.version,physicalPageNumber:1,pageLabel:null,page:{view:[dx,dy,700+dx,800+dy],rotate:0,userUnit:1},textContent:{items}})]});
}
function mount(extra={}){assert.equal(typeof module.createFinancialLookupView,'function');const d=dom(),v=module.createFinancialLookupView({document:d.document,root:d.root,digest:async bytes=>hash(bytes),...extra});return {...d,v};}
function fill(d,req=request){get(d,'basis').value=req.periodKind??'months';get(d,'basis').dispatch('change');const values=[req.statement,req.metric,req.durationMonths===null?'':String(req.durationMonths),req.periodEndLiteral,req.unitHeadingLiteral,req.currencyGlyph];financialFields.forEach((key,i)=>{get(d,key).value=values[i];get(d,key).dispatch('input');});}
const render=(d,input=source(),extra={})=>d.v.render({source:input,documentEpoch:7,active:false,cancelled:false,...extra});
const detail=(d,text)=>byTag(d.root,'details').find(node=>node.children[0].textContent===text);

test('complete source-cell exports match paginated evidence and all source/request invalidations revoke old download rights',async()=>{
  for(const action of [...fields,'close','clear','render','source','epoch','active','cancelled']){
    const d=dom(),exports=downloadHarness(d.document),input=source();
    d.v=module.createFinancialLookupView({document:d.document,root:d.root,digest:async bytes=>hash(bytes),textView:exports.textView});
    render(d,input);fill(d);await act(get(d,'run'));
    const old=detail(d,'Complete source-cell lookup receipt');old.open=true;await act(old,'toggle');
    const text=completeText(old),pre=byTag(old,'pre')[0],download=byTag(old,'button').find(n=>n.textContent==='Download complete JSON');
    assert.ok(text.length>24*1024);download.dispatch('click');
    const bytes=Buffer.from(await exports.blobs[0].arrayBuffer());assert.deepEqual(bytes,Buffer.from(text,'utf8'));
    assert.deepEqual(JSON.parse(text).result.snapshot,input);assert.deepEqual(exports.clicked,['source-cell-lookup-receipt.json']);
    if(fields.includes(action))get(d,action).dispatch('input');
    else if(action==='close'){old.open=false;old.dispatch('toggle');}
    else if(action==='clear')get(d,'clear').dispatch('click');
    else render(d,action==='source'?source():input,{documentEpoch:action==='epoch'?8:7,active:action==='active',cancelled:action==='cancelled'});
    assert.equal(pre.textContent,'');assert.deepEqual(exports.revoked,['blob:test-export-1']);
    old.dispatch('toggle');download.dispatch('click');assert.equal(exports.blobs.length,1);assert.equal(pre.textContent,'');
  }
});

test('seven initially empty fields perform no work until explicit lookup; pending amount waits for exact-byte receipt',async()=>{
  const pending=deferred();let calls=0,bytes;const d=mount({digest:value=>{calls++;bytes=value;return pending.promise;}}),input=source();render(d,input);
  fields.forEach(key=>assert.equal(get(d,key).value,''));assert.equal(calls,0);assert.equal(byTag(d.root,'pre').length,0);
  fill(d);get(d,'run').dispatch('click');assert.equal(calls,1);assert.match(get(d,'status').textContent,/computing snapshot digest/);assert.equal(byTag(d.root,'details').length,0);
  assert.equal(nodes(d.root).filter(node=>node.className==='lookup-amount').length,0);
  assert.equal(new TextDecoder().decode(bytes),JSON.stringify(input,null,2));pending.resolve(hash(bytes));await act(get(d,'run'),'unused');
  const expected=deriveFinancialTableLookup(input,request);assert.equal(nodes(d.root).find(node=>node.className==='lookup-amount').textContent,expected.amountLiteral);
  assert.match(get(d,'result').textContent,/financial correctness unadjudicated/);assert.match(get(d,'result').textContent,/normalized currency is unset/);
  assert.equal(byTag(d.root,'pre').length,0);assert.equal(get(d,'cancel').disabled,true);
  const snapshot=detail(d,'Complete lookup geometry snapshot · exact digest bytes');snapshot.open=true;await act(snapshot,'toggle');
  const text=completeText(snapshot);assert.equal(text,JSON.stringify(input,null,2));assert.deepEqual(JSON.parse(text),input);assert.match(snapshot.textContent,new RegExp(hash(bytes)));
  const receipt=detail(d,'Complete source-cell lookup receipt');receipt.open=true;await act(receipt,'toggle');
  const saved=JSON.parse(completeText(receipt));assert.deepEqual(saved.result,expected);assert.equal(saved.viewReceipt.snapshot.sha256,hash(bytes));assert.equal(saved.viewReceipt.snapshot.utf8Bytes,bytes.length);assert.equal(saved.viewReceipt.ownership.documentEpoch,7);
  const bindings=detail(d,'Exact source roles and all dated columns');bindings.open=true;await act(bindings,'toggle');
  const proof=JSON.parse(completeText(bindings));assert.deepEqual(proof.selected,expected.bindings);assert.deepEqual(proof.columns,expected.columns);assert.equal(calls,1);assert.equal(byTag(d.root,'img').length,0);
});

test('missing or unsupported explicit fields refuse before reading source or invoking digest',async()=>{
  let reads=0,calls=0;const input=new Proxy({},{get(){reads++;throw Error('SECRET SOURCE');}}),d=mount({digest:()=>{calls++;}});render(d,input);
  await act(get(d,'run'));assert.match(get(d,'status').textContent,/UNSUPPORTED_LOOKUP_REQUEST/);assert.equal(reads,0);assert.equal(calls,0);
  fill(d,{...request,metric:'Revenue'});await act(get(d,'run'));assert.equal(reads,0);assert.equal(calls,0);
  fill(d,{...request,unitHeadingLiteral:'USD millions'});await act(get(d,'run'));assert.equal(reads,0);assert.equal(calls,0);assert.doesNotMatch(d.root.textContent,/SECRET/);assert.equal(byTag(d.root,'details').length,0);
});

test('each of seven request edits revokes a committed result and a pending digest without leaking previous selections',async()=>{
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
  const receipt=detail(d,'Complete source-cell lookup receipt');receipt.open=true;await act(receipt,'toggle');assert.equal(JSON.parse(completeText(receipt)).result.request.durationMonths,6);
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

test('Period basis is empty and explicit, with duration disabled until months is chosen',()=>{
  const d=mount();render(d);assert.ok(get(d,'basis'),'Period basis control must exist');assert.equal(get(d,'basis').value,'');
  assert.deepEqual(get(d,'basis').children.map(option=>option.value),['','months','fiscal_year']);
  assert.equal(get(d,'duration').disabled,true);assert.equal(get(d,'statement').disabled,true);
  get(d,'basis').value='months';get(d,'basis').dispatch('change');assert.equal(get(d,'duration').disabled,false);assert.equal(get(d,'duration').value,'');
  assert.deepEqual(get(d,'statement').children.map(option=>option.value),['',request.statement,'Condensed Consolidated Statements of Comprehensive Income']);
  financialFields.forEach(key=>assert.equal(get(d,key).value,''));
});

test('basis switch clears every financial input and preserves annual statement literal case without selecting a value',()=>{
  const d=mount();render(d);fill(d);get(d,'basis').value='fiscal_year';get(d,'basis').dispatch('change');
  financialFields.forEach(key=>assert.equal(get(d,key).value,''));assert.equal(get(d,'duration').disabled,true);
  assert.deepEqual(get(d,'statement').children.map(option=>option.value),['','Consolidated Statements of Income','CONSOLIDATED STATEMENTS OF INCOME']);
  assert.match(get(d,'date-hint').textContent,/split/);assert.match(get(d,'date-hint').textContent,/January 31, 2021/);
  assert.equal(get(d,'date').attributes.get('aria-describedby'),'source-cell-date-hint');
  get(d,'statement').value='CONSOLIDATED STATEMENTS OF INCOME';get(d,'basis').value='months';get(d,'basis').dispatch('input');
  financialFields.forEach(key=>assert.equal(get(d,key).value,''));assert.equal(get(d,'duration').disabled,false);
  assert.deepEqual(get(d,'statement').children.map(option=>option.value),['',request.statement,'Condensed Consolidated Statements of Comprehensive Income']);
});

test('missing and unknown basis refuse before source access even with otherwise complete quarterly inputs',async()=>{
  let reads=0,calls=0;const input=new Proxy({},{get(){reads++;throw Error('SECRET SOURCE');}}),d=mount({digest:()=>{calls++;}});render(d,input);
  for(const basis of ['', 'other', 'fiscal_year']){
    get(d,'basis').value=basis;get(d,'basis').dispatch('change');
    const values=[request.statement,request.metric,'3',request.periodEndLiteral,request.unitHeadingLiteral,request.currencyGlyph];
    financialFields.forEach((key,index)=>{get(d,key).value=values[index];});
    await act(get(d,'run'));assert.match(get(d,'status').textContent,/UNSUPPORTED_LOOKUP_REQUEST/);assert.equal(reads,0);assert.equal(calls,0);
    assert.equal(byTag(d.root,'details').length,0);assert.doesNotMatch(d.root.textContent,/SECRET/);
  }
});

test('basis change while quarterly digest is pending revokes its commit and cleared source roles',async()=>{
  const pending=deferred();let bytes;const d=mount({digest:value=>{bytes=value;return pending.promise;}});render(d);fill(d);get(d,'run').dispatch('click');
  get(d,'basis').value='fiscal_year';get(d,'basis').dispatch('change');pending.resolve(hash(bytes));await act(get(d,'run'),'unused');
  assert.equal(byTag(d.root,'details').length,0);assert.equal(nodes(d.root).filter(node=>node.className==='lookup-amount').length,0);
  financialFields.forEach(key=>assert.equal(get(d,key).value,''));assert.equal(get(d,'duration').disabled,true);assert.equal(get(d,'run').disabled,false);
});

test('basis value changed without an event still revokes a late digest through complete captured-value comparison',async()=>{
  const pending=deferred();let bytes;const d=mount({digest:value=>{bytes=value;return pending.promise;}});render(d);fill(d);get(d,'run').dispatch('click');
  get(d,'basis').value='fiscal_year';pending.resolve(hash(bytes));await act(get(d,'run'),'unused');
  assert.equal(byTag(d.root,'details').length,0);assert.equal(nodes(d.root).filter(node=>node.className==='lookup-amount').length,0);
});

test('Statement and Unit use stable full-width classes rather than field order',()=>{
  const d=mount();render(d);const wide=nodes(d.root).filter(node=>node.className==='lookup-field-wide');
  assert.deepEqual(wide.map(node=>node.children[1].id),['source-cell-statement','source-cell-unit']);
  const css=readFileSync(new URL('../inspector.css',import.meta.url),'utf8');
  assert.match(css,/\.lookup-fields\s*>\s*\.lookup-field-wide/);assert.doesNotMatch(css,/\.lookup-fields\s*>\s*div:nth-child\(5\)/);
});

test('annual full-date lookup commits one exact cell only after its complete snapshot digest and labels schema 2',async()=>{
  const pending=deferred();let bytes,calls=0;const d=mount({digest:value=>{bytes=value;calls++;return pending.promise;}}),input=annualSource({reverse:true,dx:41,dy:19});render(d,input);fill(d,annualRequest);
  get(d,'run').dispatch('click');assert.equal(calls,1);assert.equal(nodes(d.root).filter(node=>node.className==='lookup-amount').length,0);
  assert.equal(new TextDecoder().decode(bytes),JSON.stringify(input,null,2));pending.resolve(hash(bytes));await act(get(d,'run'),'unused');
  assert.equal(nodes(d.root).find(node=>node.className==='lookup-amount').textContent,'781');assert.match(get(d,'result').textContent,/Net income · Year ended Jan 25, 2026/);
  const receipt=detail(d,'Complete source-cell lookup receipt');receipt.open=true;await act(receipt,'toggle');const saved=JSON.parse(completeText(receipt));
  assert.equal(saved.schemaVersion,2);assert.equal(saved.result.schemaVersion,2);assert.deepEqual(saved.result.request,annualRequest);assert.deepEqual(saved.result.snapshot,input);assert.equal(saved.result.columns.length,3);
  assert.equal(saved.result.amountLiteral,'781');assert.equal(saved.result.currencyGlyph,'$');assert.equal(saved.result.normalizedCurrency,null);assert.equal(saved.result.generationMode,'not-run');assert.equal(saved.result.financialCorrectness,'unadjudicated');
  assert.equal(saved.viewReceipt.snapshot.sha256,hash(bytes));assert.equal(saved.viewReceipt.snapshot.utf8Bytes,bytes.length);assert.equal(saved.viewReceipt.ownership.documentEpoch,7);
  assert.match(receipt.textContent,/schema 2/);const roles=detail(d,'Exact source roles and all dated columns');roles.open=true;await act(roles,'toggle');
  assert.match(roles.textContent,/all 3 dated columns/);assert.doesNotMatch(roles.textContent,/all four/);assert.equal(JSON.parse(completeText(roles)).columns.length,3);
});

test('annual split-date lookup preserves uppercase statement and discloses separate native date and date_year roles',async()=>{
  const input=annualSource({split:true,statement:'CONSOLIDATED STATEMENTS OF INCOME',amounts:['6,141','73','1,057']}),d=mount(),req={...annualRequest,statement:'CONSOLIDATED STATEMENTS OF INCOME',periodEndLiteral:'January 31, 2021'};
  render(d,input);fill(d,req);await act(get(d,'run'));const amount=nodes(d.root).find(node=>node.className==='lookup-amount');assert.ok(amount,'Annual split-date candidate must commit');assert.equal(amount.textContent,'6,141');
  assert.match(get(d,'result').textContent,/Net income · Year ended January 31, 2021/);const roles=detail(d,'Exact source roles and all dated columns');roles.open=true;await act(roles,'toggle');
  const proof=JSON.parse(completeText(roles)),bindings=Object.values(proof.selected);
  const date=bindings.find(binding=>binding?.role==='date'),year=bindings.find(binding=>binding?.role==='date_year');
  assert.equal(date.item.text,'January 31,');assert.equal(year.item.text,'2021');assert.notEqual(date.item.itemIndex,year.item.itemIndex);
  for(const binding of [date,year]){assert.deepEqual(binding.item,input.pages[0].textItems[binding.item.itemIndex]);assert.equal(binding.item.span.quote,binding.item.text);}
  assert.equal(bindings.some(binding=>binding?.item?.text==='January 31, 2021'),false);assert.equal(proof.columns.length,3);
});

test('annual edits, source replacement, session renders and clear revoke delayed digests and retained disclosures',async()=>{
  for(const action of ['basis','metric','render','source','epoch','active','cancelled','clear']){
    const pending=deferred();let bytes;const input=annualSource(),d=mount({digest:value=>{bytes=value;return pending.promise;}});render(d,input);fill(d,annualRequest);get(d,'run').dispatch('click');assert.ok(bytes);
    if(action==='basis'){get(d,'basis').value='months';get(d,'basis').dispatch('change');}
    else if(action==='metric'){get(d,'metric').value='Revenue';get(d,'metric').dispatch('input');}
    else if(action==='clear')await act(get(d,'clear'));
    else render(d,action==='source'?annualSource():input,{documentEpoch:action==='epoch'?8:7,active:action==='active',cancelled:action==='cancelled'});
    pending.resolve(hash(bytes));await act(get(d,'run'),'unused');assert.equal(byTag(d.root,'details').length,0);assert.equal(nodes(d.root).filter(node=>node.className==='lookup-amount').length,0);
    if(['source','epoch'].includes(action))fields.forEach(key=>assert.equal(get(d,key).value,''));
  }
  const d=mount();render(d,annualSource());fill(d,annualRequest);await act(get(d,'run'));const receipt=detail(d,'Complete source-cell lookup receipt');receipt.open=true;await act(receipt,'toggle');
  const values=fields.map(key=>get(d,key).value);await act(get(d,'clear'));assert.deepEqual(fields.map(key=>get(d,key).value),values);assert.equal(byTag(receipt,'pre').length,0);receipt.dispatch('toggle');assert.equal(byTag(receipt,'pre').length,0);
});

test('cancel annual A then run quarterly B preserves B after late A without leaking schemas or columns',async()=>{
  const a=deferred(),b=deferred();let calls=0,bytes;const d=mount({digest:value=>{bytes=value;return ++calls===1?a.promise:b.promise;}}),annual=annualSource();render(d,annual);fill(d,annualRequest);get(d,'run').dispatch('click');assert.equal(calls,1);
  await act(get(d,'cancel'));render(d,source(),{documentEpoch:8});fill(d);get(d,'run').dispatch('click');assert.equal(calls,2);a.resolve('a'.repeat(64));await act(get(d,'run'),'unused');assert.equal(byTag(d.root,'details').length,0);
  b.resolve(hash(bytes));await act(get(d,'run'),'unused');const receipt=detail(d,'Complete source-cell lookup receipt');receipt.open=true;await act(receipt,'toggle');const saved=JSON.parse(completeText(receipt));
  assert.equal(saved.schemaVersion,1);assert.deepEqual(saved.result,deriveFinancialTableLookup(source(),request));assert.equal(saved.result.columns.length,4);assert.equal(Object.hasOwn(saved.result.request,'periodKind'),false);
  assert.match(get(d,'result').textContent,/3 months ended Jul 28, 2024/);assert.equal(saved.viewReceipt.ownership.documentEpoch,8);
});

test('annual binder and digest failures withhold results and never display private exception text',async()=>{
  let calls=0;const d=mount({digest:()=>{calls++;return Promise.reject(Error('SECRET ANNUAL DIGEST'));}});render(d,annualSource());fill(d,annualRequest);await act(get(d,'run'));assert.equal(calls,1);
  assert.match(get(d,'status').textContent,/LOOKUP_RECEIPT_FAILED/);assert.doesNotMatch(d.root.textContent,/SECRET/);assert.equal(byTag(d.root,'details').length,0);
  const input=annualSource();input.pages[0].geometry.rotation=90;render(d,input);fill(d,annualRequest);await act(get(d,'run'));assert.equal(calls,1);assert.match(get(d,'status').textContent,/UNSUPPORTED_TABLE_GEOMETRY/);assert.equal(byTag(d.root,'details').length,0);
});

test('a nonempty duration in the disabled annual control refuses before reading the owned source',async()=>{
  let reads=0,calls=0;const input=new Proxy({},{get(){reads++;throw Error('SECRET SOURCE');}}),d=mount({digest:()=>{calls++;}});render(d,input);fill(d,annualRequest);get(d,'duration').value='12';
  await act(get(d,'run'));assert.match(get(d,'status').textContent,/UNSUPPORTED_LOOKUP_REQUEST/);assert.equal(reads,0);assert.equal(calls,0);assert.doesNotMatch(d.root.textContent,/SECRET/);
});

test('prototype property names cannot become statement choices or start a source lookup',async()=>{
  let reads=0,calls=0;const input=new Proxy({},{get(){reads++;throw Error('SECRET SOURCE');}}),d=mount({digest:()=>{calls++;}});render(d,input);
  for(const value of ['constructor','__proto__','toString']){
    get(d,'basis').value=value;assert.doesNotThrow(()=>get(d,'basis').dispatch('change'));
    assert.deepEqual(get(d,'statement').children.map(option=>option.value),['']);assert.equal(get(d,'duration').disabled,true);assert.equal(get(d,'statement').disabled,true);
    await act(get(d,'run'));assert.match(get(d,'status').textContent,/UNSUPPORTED_LOOKUP_REQUEST/);
  }
  assert.equal(reads,0);assert.equal(calls,0);assert.doesNotMatch(d.root.textContent,/SECRET/);
});

test('cancel quarterly A then run annual B preserves only schema 2 after late A',async()=>{
  const a=deferred(),b=deferred();let calls=0,bytes;const d=mount({digest:value=>{bytes=value;return ++calls===1?a.promise:b.promise;}});render(d);fill(d);get(d,'run').dispatch('click');assert.equal(calls,1);
  await act(get(d,'cancel'));render(d,annualSource(),{documentEpoch:8});fill(d,annualRequest);get(d,'run').dispatch('click');assert.equal(calls,2);
  a.resolve('a'.repeat(64));await act(get(d,'run'),'unused');assert.equal(byTag(d.root,'details').length,0);assert.equal(get(d,'cancel').disabled,false);
  b.resolve(hash(bytes));await act(get(d,'run'),'unused');const receipt=detail(d,'Complete source-cell lookup receipt');assert.ok(receipt);receipt.open=true;await act(receipt,'toggle');const saved=JSON.parse(completeText(receipt));
  assert.equal(saved.schemaVersion,2);assert.equal(saved.result.schemaVersion,2);assert.equal(saved.result.columns.length,3);assert.equal(saved.result.request.periodKind,'fiscal_year');assert.equal(saved.result.request.durationMonths,null);
  assert.equal(saved.viewReceipt.ownership.documentEpoch,8);assert.equal(saved.result.amountLiteral,'781');assert.match(get(d,'result').textContent,/Year ended Jan 25, 2026/);
});
