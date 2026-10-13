import test from 'node:test';
import assert from 'node:assert/strict';
import {NodeDouble,nodes,byTag} from './pdf-app-dom-fixture.mjs';
import {completeText,downloadHarness} from './bounded-text-dom-fixture.mjs';
import {createBoundedTextView} from '../bounded-text-view.mjs';

const module=await import('../complete-record-disclosure.mjs').catch(()=>({}));
const FAILED='RECORD_DISCLOSURE_FAILED · The complete record could not be displayed safely.';
const button=(root,label)=>byTag(root,'button').find(node=>node.textContent===label);
const toggle=(disclosure,open)=>{disclosure.node.open=open;disclosure.node.dispatch('toggle');};

function mount(extra={}){
  assert.equal(typeof module.createCompleteRecordDisclosure,'function','The complete record disclosure helper must exist');
  const document={createElement:tag=>new NodeDouble(tag)},host=new NodeDouble(),harness=downloadHarness(document);
  const calls=[],views=[];
  const textView=args=>{calls.push(args);const view=harness.textView(args);views.push(view);return view;};
  const disclosure=module.createCompleteRecordDisclosure({document,title:'Complete source record',read:()=>({source:'exact'}),current:()=>true,filename:'complete-record.json',textView,...extra});
  host.append(disclosure.node);
  return {document,host,disclosure,root:disclosure.node,harness,calls,views};
}

test('the frozen disclosure stays lazy while closed and reads only an open current record',()=>{
  let reads=0,checks=0;
  const d=mount({read:()=>{reads++;return {source:'exact'};},current:()=>{checks++;return true;}});
  assert.ok(Object.isFrozen(d.disclosure));assert.equal(d.root.tagName,'details');
  assert.equal(reads,0);assert.equal(checks,0);assert.equal(d.calls.length,0);
  assert.equal(d.root.children.length,1);assert.equal(d.root.children[0].tagName,'summary');
  assert.equal(d.root.textContent,'Complete source record');
  toggle(d.disclosure,true);assert.equal(reads,1);assert.ok(checks>0);
  assert.equal(completeText(d.root),JSON.stringify({source:'exact'},null,2));
  assert.equal(d.calls[0].format,'json');assert.equal(d.calls[0].filename,'complete-record.json');
  assert.equal(d.harness.blobs.length,0);assert.equal(d.harness.clicked.length,0);
});

test('all TXT pages and native Blob bytes preserve exact Unicode, CRLF and whitespace without an added newline',async()=>{
  const text='  汉字🧭e\u0301\t<script>literal</script>\r\n'.repeat(12000)+'\t FINAL  Z';
  const d=mount({read:()=>text,format:'text',filename:'complete-source.txt'});
  toggle(d.disclosure,true);assert.equal(completeText(d.root),text);
  assert.equal(d.harness.blobs.length,0);assert.equal(byTag(d.root,'pre').length,1);
  assert.ok(byTag(d.root,'pre')[0].textContent.length<=24*1024);assert.equal(byTag(d.root,'script').length,0);
  button(d.root,'Download complete text').dispatch('click');assert.equal(d.harness.blobs.length,1);
  assert.equal(d.harness.blobs[0].type,'text/plain;charset=utf-8');
  assert.deepEqual(Buffer.from(await d.harness.blobs[0].arrayBuffer()),Buffer.from(text,'utf8'));
  assert.deepEqual(d.harness.clicked,['complete-source.txt']);
  toggle(d.disclosure,false);assert.deepEqual(d.harness.revoked,['blob:test-export-1']);
});

test('full nested JSON pages and downloads equal JSON.stringify with the requested indentation',async()=>{
  const value={empty:'',zero:0,no:false,nothing:null,rows:Array.from({length:3000},(_,i)=>({i,nested:{text:`汉字🧪 ${i}\r\n`,values:[i,false,null,{last:i===2999?'EXACT FINAL NESTED VALUE':'other'}]}}))};
  const expected=JSON.stringify(value,null,4),d=mount({read:()=>value,indent:4});
  toggle(d.disclosure,true);assert.equal(completeText(d.root),expected);assert.equal(d.harness.blobs.length,0);
  button(d.root,'Download complete JSON').dispatch('click');
  assert.deepEqual(Buffer.from(await d.harness.blobs[0].arrayBuffer()),Buffer.from(expected,'utf8'));
  assert.equal(d.harness.blobs[0].type,'application/json;charset=utf-8');assert.equal(expected.at(-1),'}');
});

test('close preserves only the summary, scrubs captured descendants and retained callbacks cannot revive the old view',()=>{
  let reads=0;const d=mount({read:()=>({read:++reads,private:'PRIVATE OLD SOURCE\n'.repeat(200)})});
  const summary=d.root.children[0];toggle(d.disclosure,true);
  const captured=nodes(d.root).filter(node=>node!==d.root&&node!==summary),pre=byTag(d.root,'pre')[0];
  const oldButtons=byTag(d.root,'button'),callbacks=oldButtons.flatMap(node=>node.listeners.get('click')??[]),oldOwner=d.calls[0].current;
  button(d.root,'Download complete JSON').dispatch('click');toggle(d.disclosure,false);
  assert.deepEqual(d.root.children,[summary]);assert.equal(pre.textContent,'');assert.equal(oldOwner(),false);
  captured.forEach(node=>assert.equal(node.textContent,''));oldButtons.forEach(node=>assert.equal(node.disabled,true));
  callbacks.forEach(callback=>callback({target:oldButtons[0]}));oldButtons.forEach(node=>node.dispatch('click'));
  assert.equal(d.harness.blobs.length,1);assert.deepEqual(d.harness.revoked,['blob:test-export-1']);
  toggle(d.disclosure,true);assert.equal(reads,2);assert.match(completeText(d.root),/"read": 2/);
  callbacks.forEach(callback=>callback({target:oldButtons[0]}));assert.equal(oldOwner(),false);
  assert.match(completeText(d.root),/"read": 2/);assert.equal(d.harness.blobs.length,1);
});

test('reopening rereads a mutated same-object record rather than retaining an old serialized value',()=>{
  const value={nested:{version:1}},d=mount({read:()=>value});
  toggle(d.disclosure,true);assert.equal(completeText(d.root),JSON.stringify(value,null,2));
  toggle(d.disclosure,false);value.nested.version=2;value.last='fresh field';toggle(d.disclosure,true);
  assert.equal(completeText(d.root),JSON.stringify(value,null,2));assert.equal(d.calls.length,2);
});

test('permanent idempotent disposal closes and scrubs the details, captured summary and old controls',()=>{
  const d=mount(),summary=d.root.children[0],toggleListener=d.root.listeners.get('toggle')[0];
  toggle(d.disclosure,true);const captured=nodes(d.root),oldButtons=byTag(d.root,'button'),owner=d.calls[0].current;
  button(d.root,'Download complete JSON').dispatch('click');d.disclosure.dispose();d.disclosure.dispose();
  assert.equal(d.root.open,false);assert.equal(d.root.textContent,'');assert.equal(summary.textContent,'');
  assert.equal(d.root.children.length,0);assert.equal(owner(),false);assert.equal((d.root.listeners.get('toggle')??[]).length,0);
  captured.forEach(node=>assert.equal(node.textContent,''));oldButtons.forEach(node=>assert.equal(node.disabled,true));
  d.root.open=true;toggleListener({target:d.root});assert.equal(d.root.open,false);assert.equal(d.root.textContent,'');
  oldButtons.forEach(node=>node.dispatch('click'));assert.equal(d.harness.blobs.length,1);
  assert.deepEqual(d.harness.revoked,['blob:test-export-1']);
});

test('initially stale or throwing current predicates revoke without reading, rendering private data or downloading',()=>{
  for(const current of [()=>false,()=>{throw Error('PRIVATE OWNER FAILURE');}]){
    let reads=0;const d=mount({read:()=>{reads++;return {private:'PRIVATE SOURCE'};},current});
    toggle(d.disclosure,true);assert.equal(reads,0);assert.equal(d.calls.length,0);assert.equal(d.root.textContent,'');
    assert.equal(d.root.open,false);assert.equal(d.harness.blobs.length,0);
  }
});

test('read, serialization and viewer failures display only the canonical error while preserving the summary',()=>{
  const cyclic={private:'PRIVATE CYCLIC VALUE'};cyclic.self=cyclic;
  const cases=[
    {read:()=>{throw Error('PRIVATE READ TOKEN');}},
    {read:()=>cyclic},
    {read:()=>({get secret(){throw Error('PRIVATE GETTER TOKEN');}})},
    {read:()=>undefined},
    {read:()=>42,format:'text'},
    {textView:()=>{throw Error('PRIVATE FACTORY TRACE');}},
    {format:'html'},
  ];
  for(const extra of cases){
    const d=mount(extra),summary=d.root.children[0];toggle(d.disclosure,true);
    assert.equal(d.root.textContent,summary.textContent+FAILED);assert.doesNotMatch(d.root.textContent,/PRIVATE/);
    assert.equal(byTag(d.root,'pre').length,0);assert.equal(d.harness.blobs.length,0);
    toggle(d.disclosure,false);assert.deepEqual(d.root.children,[summary]);assert.equal(d.root.textContent,summary.textContent);
  }
});

test('a factory that appends private controls and then fails leaves no captured private descendants',()=>{
  let captured;const d=mount({textView:({root})=>{
    const pre=new NodeDouble('pre'),control=new NodeDouble('button');pre.textContent='PRIVATE FACTORY SOURCE';control.textContent='PRIVATE FACTORY BUTTON';
    root.append(pre,control);captured=[root,pre,control];throw Error('PRIVATE FACTORY FAILURE');
  }});
  toggle(d.disclosure,true);assert.match(d.root.textContent,new RegExp(FAILED));
  assert.doesNotMatch(d.root.textContent,/PRIVATE/);captured.forEach(node=>assert.equal(node.textContent,''));assert.equal(captured[2].disabled,true);
});

test('closing synchronously inside read prevents serialization, viewer construction and private rendering',()=>{
  let d,serialized=0;d=mount({read:()=>{toggle(d.disclosure,false);return {toJSON(){serialized++;return 'PRIVATE OLD VALUE';}};}});
  toggle(d.disclosure,true);assert.equal(serialized,0);assert.equal(d.calls.length,0);
  assert.equal(d.root.textContent,'Complete source record');assert.equal(d.root.children.length,1);
});

test('a synchronous close and reopen inside read keeps only the newer read and viewer',()=>{
  let d,reads=0;d=mount({read:()=>{if(++reads===1){toggle(d.disclosure,false);toggle(d.disclosure,true);return {private:'PRIVATE OLD READ'};}return {fresh:'NEW READ'};}});
  toggle(d.disclosure,true);assert.equal(reads,2);assert.equal(d.calls.length,1);
  assert.equal(completeText(d.root),JSON.stringify({fresh:'NEW READ'},null,2));assert.doesNotMatch(d.root.textContent,/PRIVATE OLD READ/);
});

test('serialization reentrancy cannot overwrite a fresh same-details reopen',()=>{
  let d,reads=0;d=mount({read:()=>++reads===1?{toJSON(){toggle(d.disclosure,false);toggle(d.disclosure,true);return {private:'PRIVATE OLD SERIALIZATION'};}}:{fresh:'NEW SERIALIZATION'}});
  toggle(d.disclosure,true);assert.equal(reads,2);assert.equal(d.calls.length,1);
  assert.equal(completeText(d.root),JSON.stringify({fresh:'NEW SERIALIZATION'},null,2));
});

test('current predicate reentrancy uses the fresh toggle revision before any read',()=>{
  let d,arm=true,reads=0;d=mount({read:()=>({fresh:++reads}),current:()=>{if(arm){arm=false;toggle(d.disclosure,false);toggle(d.disclosure,true);}return true;}});
  toggle(d.disclosure,true);assert.equal(reads,1);assert.equal(d.calls.length,1);assert.equal(completeText(d.root),JSON.stringify({fresh:1},null,2));
});

test('ownership loss during read or serialization prevents factory calls and revokes the details',()=>{
  for(const stage of ['read','serialize']){
    let owned=true,factories=0;const d=mount({current:()=>owned,read:()=>{
      if(stage==='read'){owned=false;return {private:'PRIVATE READ'};}
      return {toJSON(){owned=false;return {private:'PRIVATE SERIALIZED'};}};
    },textView:()=>{factories++;return {dispose(){}};}});
    toggle(d.disclosure,true);assert.equal(factories,0);assert.equal(d.root.textContent,'');assert.equal(d.root.open,false);
  }
});

test('factory reentrancy disposes the late old viewer and scrubs only its old body',()=>{
  let d,reads=0,factories=0,lateDisposals=0,oldArgs,oldPre;
  d=mount({read:()=>({version:++reads}),textView:args=>{
    if(++factories===1){oldArgs=args;oldPre=new NodeDouble('pre');oldPre.textContent='PRIVATE OLD FACTORY';args.root.append(oldPre);
      toggle(d.disclosure,false);toggle(d.disclosure,true);return {dispose(){lateDisposals++;}};
    }
    return createBoundedTextView(args);
  }});
  toggle(d.disclosure,true);assert.equal(lateDisposals,1);assert.equal(oldArgs.current(),false);assert.equal(oldPre.textContent,'');assert.equal(oldArgs.root.textContent,'');
  assert.equal(completeText(d.root),JSON.stringify({version:2},null,2));assert.equal(byTag(d.root,'pre').length,1);
});

test('permanent disposal inside the factory still disposes its late returned viewer and late appended nodes',()=>{
  let d,lateDisposals=0,oldPre,owner;
  d=mount({textView:args=>{owner=args.current;d.disclosure.dispose();oldPre=new NodeDouble('pre');oldPre.textContent='PRIVATE LATE SOURCE';args.root.append(oldPre);return {dispose(){lateDisposals++;}};}});
  toggle(d.disclosure,true);assert.equal(lateDisposals,1);assert.equal(owner(),false);assert.equal(oldPre.textContent,'');assert.equal(d.root.textContent,'');assert.equal(d.root.open,false);
});

test('ownership loss after a factory returns disposes that viewer before displaying any private data',()=>{
  let owned=true,disposals=0,captured;
  const d=mount({current:()=>owned,textView:args=>{captured=new NodeDouble('pre');captured.textContent='PRIVATE FACTORY VALUE';args.root.append(captured);owned=false;return {dispose(){disposals++;}};}});
  toggle(d.disclosure,true);assert.equal(disposals,1);assert.equal(captured.textContent,'');assert.equal(d.root.textContent,'');assert.equal(d.root.open,false);
});

test('a reentrant old viewer disposer cannot wipe a newer same-details reopen',()=>{
  let d,reads=0,reopen=true,oldPre,oldOwner;
  d=mount({read:()=>({version:++reads}),textView:args=>{
    const view=createBoundedTextView(args);if(reads!==1)return view;
    oldPre=byTag(args.root,'pre')[0];oldOwner=args.current;
    return {dispose(){if(reopen){reopen=false;toggle(d.disclosure,true);}view.dispose();}};
  }});
  toggle(d.disclosure,true);toggle(d.disclosure,false);
  assert.equal(reads,2);assert.equal(oldPre.textContent,'');assert.equal(oldOwner(),false);
  assert.equal(d.root.open,true);assert.equal(completeText(d.root),JSON.stringify({version:2},null,2));
});

test('a reentrant disposer cannot wipe a replacement root render',()=>{
  let d,oldPre;const replacement=new NodeDouble();replacement.textContent='NEW ROOT RENDER';
  d=mount({textView:args=>{const view=createBoundedTextView(args);oldPre=byTag(args.root,'pre')[0];return {dispose(){d.host.replaceChildren(replacement);view.dispose();}};}});
  toggle(d.disclosure,true);toggle(d.disclosure,false);
  assert.deepEqual(d.host.children,[replacement]);assert.equal(d.host.textContent,'NEW ROOT RENDER');assert.equal(oldPre.textContent,'');
});

test('a throwing disposer still scrubs captured source and leaves the canonical error area private-free',()=>{
  let captured;const d=mount({textView:args=>{captured=new NodeDouble('pre');captured.textContent='PRIVATE DISPOSER SOURCE';args.root.append(captured);return {dispose(){throw Error('PRIVATE DISPOSER TRACE');}};}});
  toggle(d.disclosure,true);toggle(d.disclosure,false);assert.equal(captured.textContent,'');assert.equal(d.root.textContent,'Complete source record');
  d.disclosure.dispose();assert.equal(d.root.textContent,'');
});
