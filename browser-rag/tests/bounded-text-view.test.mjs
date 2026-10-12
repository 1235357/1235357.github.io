import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NodeDouble,nodes,byTag} from './pdf-app-dom-fixture.mjs';
const module=await import('../bounded-text-view.mjs').catch(()=>({}));
const MAX_UNITS=24*1024,MAX_LINES=160;
const hash=value=>createHash('sha256').update(value).digest('hex');
const button=(d,label)=>byTag(d.root,'button').find(node=>node.textContent===label);
const page=d=>byTag(d.root,'pre')[0];
const range=d=>nodes(d.root).find(node=>node.className==='bounded-text-range');

test('plain text pages and explicit TXT download preserve exact whitespace and UTF-8 bytes without JSON quoting',async()=>{
  const text='  RAW <script>literal</script> 汉字🧭\r\n'.repeat(12000)+'\tFINAL  \n',d=mount(text,{format:'text',filename:undefined});
  assert.equal(allPages(d).join(''),text);assert.equal(d.created.length,0);
  assert.equal(page(d).attributes.get('aria-label'),'Text page');
  assert.equal(nodes(d.root).find(n=>n.className==='bounded-text-view').attributes.get('aria-label'),'Complete text viewer');
  assert.match(d.root.textContent,/The complete text is retained/);assert.ok(button(d,'Download complete text'));
  assert.equal(button(d,'Download complete JSON'),undefined);assert.equal(byTag(d.root,'script').length,0);
  button(d,'Download complete text').dispatch('click');
  assert.deepEqual(Buffer.from(await d.blobs[0].arrayBuffer()),Buffer.from(text,'utf8'));
  assert.equal(d.blobs[0].type,'text/plain;charset=utf-8');assert.equal(d.clicked[0].download,'source.txt');
  assert.match(d.root.textContent,/Complete text download requested/);d.v.dispose();assert.deepEqual(d.revoked,['blob:controlled-1']);
});

test('unknown format refuses before rendering or coercing values and plain download failures keep truthful canonical labels',()=>{
  let coerced=0;for(const format of ['html','toString',null,1,{toString(){coerced++;throw Error('PRIVATE FORMAT');}}]){
    const root=new NodeDouble();let created=0;
    assert.throws(()=>module.createBoundedTextView({document:{createElement(){created++;}},root,text:'private',current:()=>true,format}),/Invalid bounded text viewer input/);
    assert.equal(created,0);assert.equal(root.textContent,'');
  }
  assert.equal(coerced,0);
  const d=mount('raw',{format:'text',filename:'native-output.txt',Blob:class{constructor(){throw Error('PRIVATE BLOB');}}});
  button(d,'Download complete text').dispatch('click');assert.match(d.root.textContent,/TEXT_DOWNLOAD_FAILED · The complete text could not be downloaded\./);assert.doesNotMatch(d.root.textContent,/PRIVATE/);
});

// Native Blob bytes with explicit test-only DOM and object-URL lifecycle doubles.
function mount(text,extra={}){
  assert.equal(typeof module.createBoundedTextView,'function');
  const root=new NodeDouble(),anchors=[],blobs=[],created=[],revoked=[],clicked=[];
  const document={createElement(tag){const node=new NodeDouble(tag);if(tag==='a'){
    anchors.push(node);node.click=()=>{for(const listener of node.listeners.get('click')??[])listener({target:node,preventDefault(){node.prevented=true;}});if(!node.prevented)clicked.push({href:node.attributes.get('href'),download:node.attributes.get('download')});};
  }return node;}};
  class RecordedBlob extends Blob{constructor(parts,options){super(parts,options);blobs.push(this);}}
  const URL={createObjectURL(blob){created.push(blob);return `blob:controlled-${created.length}`;},revokeObjectURL(url){revoked.push(url);}};
  const v=module.createBoundedTextView({document,root,text,current:()=>true,filename:'complete-source.json',Blob:RecordedBlob,URL,...extra});
  return {root,document,v,anchors,blobs,created,revoked,clicked};
}
function assertBounded(d){
  const pres=byTag(d.root,'pre');assert.equal(pres.length,1);const text=pres[0].textContent;
  assert.ok(text.length<=MAX_UNITS,`${text.length} UTF-16 units exceed the DOM limit`);
  assert.ok(text.split(/\r\n|[\r\n]/).length<=MAX_LINES,'Too many hard lines enter the DOM');
  assert.ok(nodes(d.root).length<=18,'Navigation must not mount other text pages');
  assert.equal(byTag(d.root,'a').length,0);
}
function allPages(d){
  const slices=[];for(let count=0;count<10000;count++){
    assertBounded(d);const text=page(d).textContent;
    assert.doesNotMatch(text,/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/,'A Unicode pair was cut across pages');
    slices.push(text);if(button(d,'Next page').disabled)return slices;
    button(d,'Next page').dispatch('click');
  }assert.fail('Pagination did not reach the final page');
}

test('a multi-megabyte one-line JSON remains DOM-bounded and every page reconstructs its exact original',()=>{
  const text=JSON.stringify({source:'文档🧭e\u0301'.repeat(450000),last:'EXACT FINAL ITEM'}),d=mount(text);
  assert.ok(Buffer.byteLength(text)>3*1024*1024);assert.equal(d.blobs.length,0);assert.equal(d.created.length,0);
  const slices=allPages(d);assert.ok(slices.length>100);assert.equal(slices.join(''),text);assert.equal(hash(slices.join('')),hash(text));
  assert.match(range(d).textContent,new RegExp(`of ${text.length.toLocaleString('en-US')}`));assert.match(page(d).textContent,/EXACT FINAL ITEM/);
});

test('many short lines and mixed newline forms remain limited to 160 lines without lost separators or Unicode',()=>{
  const text=Array.from({length:65000},(_,i)=>`${i} 汉字 🧪 e\u0301${i%3===0?'\r\n':i%3===1?'\r':'\n'}`).join(''),d=mount(text);
  assert.equal(allPages(d).join(''),text);assert.equal(d.blobs.length,0);
});

test('a surrogate pair and CRLF exactly at a size boundary stay together, including empty and trailing-line text',()=>{
  for(const text of ['','\n','A'.repeat(MAX_UNITS-1)+'🧭Z','A'.repeat(MAX_UNITS-1)+'\r\nZ','\n'.repeat(159)+'last\n']){
    const d=mount(text),slices=allPages(d);assert.equal(slices.join(''),text);
    if(text.includes('\r\n'))assert.ok(!slices.some(slice=>slice.endsWith('\r')),'CRLF must stay together');
  }
});

test('accessible immediate navigation and explicit validated page jumps keep the current range truthful',()=>{
  const text='A'.repeat(MAX_UNITS)+'B'.repeat(MAX_UNITS)+'C'.repeat(20),d=mount(text),input=byTag(d.root,'input')[0];
  assert.equal(range(d).attributes.get('role'),'status');assert.equal(range(d).attributes.get('aria-live'),'polite');
  assert.equal(page(d).attributes.get('tabindex'),'0');assert.equal(input.attributes.get('aria-label'),'Page number');
  assert.equal(button(d,'Previous page').disabled,true);assert.equal(input.value,'1');assert.match(range(d).textContent,/Page 1 of 3/);
  button(d,'Next page').dispatch('click');assert.equal(page(d).textContent,'B'.repeat(MAX_UNITS));assert.equal(input.value,'2');
  input.value='3';button(d,'Go to page').dispatch('click');assert.equal(page(d).textContent,'C'.repeat(20));assert.equal(button(d,'Next page').disabled,true);
  button(d,'Previous page').dispatch('click');assert.equal(input.value,'2');
  for(const bad of ['0','4','1.5','1e0','PRIVATE JUMP VALUE']){
    input.value=bad;button(d,'Go to page').dispatch('click');assert.equal(page(d).textContent,'B'.repeat(MAX_UNITS));
    assert.match(d.root.textContent,/TEXT_PAGE_OUT_OF_RANGE/);assert.doesNotMatch(d.root.textContent,/PRIVATE JUMP VALUE/);
  }
  input.value='1';for(const listener of input.listeners.get('keydown')??[])listener({key:'Enter',preventDefault(){}});
  assert.equal(page(d).textContent,'A'.repeat(MAX_UNITS));assert.match(range(d).textContent,/UTF-16 units 1–24,576/);
});

test('only an explicit download click creates a Blob containing the full exact UTF-8 JSON without added newline',async()=>{
  const text=JSON.stringify({text:'汉字🧭\r\n'.repeat(10000),last:'last value'},null,2),d=mount(text);
  button(d,'Next page').dispatch('click');assert.equal(d.blobs.length,0);assert.equal(d.created.length,0);assert.equal(d.clicked.length,0);
  button(d,'Download complete JSON').dispatch('click');assert.equal(d.blobs.length,1);assert.equal(d.created.length,1);
  const bytes=Buffer.from(await d.blobs[0].arrayBuffer());assert.equal(d.blobs[0].type,'application/json;charset=utf-8');
  assert.deepEqual(bytes,Buffer.from(text,'utf8'));assert.equal(hash(bytes),hash(Buffer.from(text,'utf8')));assert.notEqual(bytes.at(-1),10);
  assert.deepEqual(d.clicked,[{href:'blob:controlled-1',download:'complete-source.json'}]);
  assert.equal(byTag(d.root,'a').length,0);assert.equal(d.anchors[0].attributes.has('href'),false);assert.equal(d.anchors[0].attributes.has('download'),false);
  assert.deepEqual(d.revoked,[]);d.v.dispose();assert.deepEqual(d.revoked,['blob:controlled-1']);
});

test('repeat downloads retain at most one object URL and idempotent disposal removes even captured source and controls',()=>{
  const d=mount('{"source":"PRIVATE SOURCE"}'),pre=page(d),oldButtons=byTag(d.root,'button'),download=button(d,'Download complete JSON');
  download.dispatch('click');download.dispatch('click');assert.deepEqual(d.revoked,['blob:controlled-1']);
  d.v.dispose();d.v.dispose();assert.deepEqual(d.revoked,['blob:controlled-1','blob:controlled-2']);assert.equal(d.root.textContent,'');assert.equal(pre.textContent,'');
  assert.equal(byTag(d.root,'button').length,0);oldButtons.forEach(node=>assert.equal(node.disabled,true));
  oldButtons.forEach(node=>node.dispatch('click'));assert.equal(d.created.length,2);assert.equal(d.root.textContent,'');
});

test('each stale navigation or download handler clears source, removes controls and revokes any existing URL',()=>{
  for(const action of ['Next page','Previous page','Go to page','Download complete JSON']){
    let owned=true;const d=mount('PRIVATE SOURCE\n'.repeat(200),{current:()=>owned}),pre=page(d),old=button(d,action);
    button(d,'Download complete JSON').dispatch('click');owned=false;old.dispatch('click');
    assert.equal(d.root.textContent,'');assert.equal(pre.textContent,'');assert.equal(byTag(d.root,'pre').length,0);assert.equal(byTag(d.root,'button').length,0);
    assert.deepEqual(d.revoked,['blob:controlled-1']);assert.equal(d.created.length,1);old.dispatch('click');assert.equal(d.root.textContent,'');
  }
});

test('initially stale or throwing ownership predicates never render text or create a download',()=>{
  for(const current of [()=>false,()=>{throw Error('PRIVATE OWNER FAILURE');}]){
    const d=mount('PRIVATE SOURCE',{current});assert.equal(d.root.textContent,'');assert.equal(byTag(d.root,'pre').length,0);assert.equal(d.created.length,0);d.v.dispose();
  }
});

test('ownership loss during Blob creation or object URL creation cannot start a download and revokes a newly made URL',()=>{
  for(const stage of ['blob','url']){
    let owned=true;const revoked=[],created=[];
    class RevokingBlob extends Blob{constructor(parts,options){super(parts,options);if(stage==='blob')owned=false;}}
    const d=mount('{"private":"source"}',{current:()=>owned,Blob:RevokingBlob,URL:{createObjectURL(blob){created.push(blob);owned=false;return 'blob:late-url';},revokeObjectURL(url){revoked.push(url);}}});
    button(d,'Download complete JSON').dispatch('click');assert.equal(d.root.textContent,'');assert.equal(d.clicked.length,0);
    assert.equal(created.length,stage==='url'?1:0);assert.deepEqual(revoked,stage==='url'?['blob:late-url']:[]);
  }
});

test('denied Blob, URL or download activation failures use canonical text without exposing error secrets or retaining links',()=>{
  for(const stage of ['blob','url','click']){
    const revoked=[];let created=0;const d=mount('{"safe":true}',{
      Blob:stage==='blob'?class{constructor(){throw Error('PRIVATE BLOB KEY');}}:Blob,
      URL:{createObjectURL(){created++;if(stage==='url')throw Error('PRIVATE URL TOKEN');return 'blob:denied-click';},revokeObjectURL(url){revoked.push(url);}}
    });
    if(stage==='click'){const create=d.document.createElement;d.document.createElement=tag=>{const node=create(tag);if(tag==='a')node.click=()=>{throw Error('PRIVATE CLICK TRACE');};return node;};}
    button(d,'Download complete JSON').dispatch('click');
    assert.match(d.root.textContent,/TEXT_DOWNLOAD_FAILED · The complete JSON could not be downloaded\./);assert.doesNotMatch(d.root.textContent,/PRIVATE/);
    assert.equal(byTag(d.root,'a').length,0);d.anchors.forEach(node=>assert.equal(node.attributes.has('href'),false));
    assert.equal(created,stage==='blob'?0:1);assert.deepEqual(revoked,stage==='click'?['blob:denied-click']:[]);d.v.dispose();
  }
});

test('reentrant disposal during an owner check or URL creation cannot create bytes or leave a late URL usable',()=>{
  let view,invalidate=false;const d=mount('{"private":"source"}',{current:()=>{if(invalidate)view.dispose();return true;}});
  view=d.v;invalidate=true;button(d,'Download complete JSON').dispatch('click');assert.equal(d.root.textContent,'');assert.equal(d.blobs.length,0);
  const revoked=[];let lateView;const late=mount('{"private":"source"}',{URL:{createObjectURL(){lateView.dispose();return 'blob:returned-after-dispose';},revokeObjectURL(url){revoked.push(url);}}});
  lateView=late.v;button(late,'Download complete JSON').dispatch('click');assert.equal(late.root.textContent,'');assert.equal(late.clicked.length,0);
  assert.deepEqual(revoked,['blob:returned-after-dispose']);late.v.dispose();assert.deepEqual(revoked,['blob:returned-after-dispose']);
});

for(const stage of ['owner','revoke'])test(`synchronous ${stage} callbacks cannot nest downloads or orphan an object URL`,async()=>{
    let d,reenter=false;const created=[],revoked=[];
    d=mount('{"exact":"汉字🧭"}',{current:()=>{
      if(stage==='owner'&&reenter){reenter=false;button(d,'Download complete JSON').dispatch('click');}return true;
    },URL:{createObjectURL(){const url=`blob:reentrant-${created.length+1}`;created.push(url);return url;},
      revokeObjectURL(url){revoked.push(url);if(stage==='revoke'&&reenter){reenter=false;button(d,'Download complete JSON').dispatch('click');}}}});
    button(d,'Download complete JSON').dispatch('click');reenter=true;
    button(d,'Download complete JSON').dispatch('click');
    assert.equal(d.blobs.length,2,`${stage} callback must not start a nested download`);
    assert.deepEqual(created,['blob:reentrant-1','blob:reentrant-2']);assert.deepEqual(revoked,['blob:reentrant-1']);
    assert.equal(d.clicked.length,2);assert.equal(byTag(d.root,'a').length,0);
    // The synchronous guard must release after each action, including repeat downloads.
    button(d,'Download complete JSON').dispatch('click');assert.equal(d.blobs.length,3);
    for(const blob of d.blobs)assert.deepEqual(Buffer.from(await blob.arrayBuffer()),Buffer.from('{"exact":"汉字🧭"}','utf8'));
    d.v.dispose();d.v.dispose();assert.deepEqual(revoked,created);
});

test('ownership lost while revoking the previous URL prevents constructing any new download bytes',()=>{
  let owned=true,loseOwner=false;const created=[],revoked=[];
  const d=mount('{"private":"retained"}',{current:()=>owned,URL:{
    createObjectURL(){const url=`blob:owned-${created.length+1}`;created.push(url);return url;},
    revokeObjectURL(url){revoked.push(url);if(loseOwner)owned=false;},
  }});
  button(d,'Download complete JSON').dispatch('click');const pre=page(d),download=button(d,'Download complete JSON');
  loseOwner=true;download.dispatch('click');
  assert.equal(d.blobs.length,1);assert.deepEqual(created,['blob:owned-1']);assert.deepEqual(revoked,created);
  assert.equal(d.clicked.length,1);assert.equal(pre.textContent,'');assert.equal(d.root.textContent,'');
  d.v.dispose();assert.deepEqual(revoked,created);
});
