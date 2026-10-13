import test from 'node:test';
import assert from 'node:assert/strict';
import {createRetrievalInspectionView} from '../retrieval-inspection-view.mjs';
import {createBoundedTextView} from '../bounded-text-view.mjs';
import {inspectionInput,axis} from './retrieval-inspection-fixture.mjs';
import {dom,act,byTag,nodes} from './pdf-app-dom-fixture.mjs';
import {completeText} from './bounded-text-dom-fixture.mjs';

function fixture(input=inspectionInput(),extra={}){
  const d=dom(),root=d.document.createElement('div'),downloads=[];
  const create=d.document.createElement.bind(d.document);
  d.document.createElement=tag=>{const node=create(tag);if(tag==='a')node.click=()=>downloads.push({url:node.attributes.get('href'),filename:node.attributes.get('download')});return node;};
  let binding={input},inspected=[];
  const view=createRetrievalInspectionView({document:d.document,root,read:value=>value.input,
    isCurrent:value=>value===binding,onInspect:value=>inspected.push(value),...extra});
  view.render(binding);return {...d,root,downloads,view,inspected,get binding(){return binding;},set binding(value){binding=value;}};
}
const named=(root,tag,title)=>byTag(root,tag).find(node=>node.textContent===title);
const disclosure=(root,title)=>byTag(root,'details').find(node=>node.children[0]?.textContent===title);
async function open(d){const outer=disclosure(d.root,'Inspect how similarity selects passages');outer.open=true;await act(outer,'toggle');return outer;}
async function exportRecord(d,title){const detail=disclosure(d.root,title);detail.open=true;await act(detail,'toggle');
  const exact=completeText(detail),button=named(detail,'button','Download complete JSON');await act(button);const download=d.downloads.at(-1);
  assert.deepEqual(Buffer.from(await(await fetch(download.url)).arrayBuffer()),Buffer.from(exact,'utf8'));return {detail,button,download,exact};}

test('calculation stays lazy, names selected and unselected rows, and draws signed scores about zero',async()=>{
  const d=fixture(inspectionInput({topK:1,vectors:[axis(0,-1),axis(1),axis()]}));
  assert.equal(byTag(d.root,'table').length,0);await open(d);
  assert.equal(byTag(d.root,'table').length,1);assert.match(d.root.textContent,/Post-acceptance inspection/);
  assert.match(d.root.textContent,/Outside Top K/);assert.match(d.root.textContent,/Selected for context/);
  assert.equal(named(d.root,'button','Next 50 ranked chunks'),undefined,'one window has no dead paging actions');
  const bars=nodes(d.root).filter(n=>n.className?.startsWith('retrieval-score-bar'));
  assert.deepEqual(bars.map(n=>n.attributes.get('data-signed-score')),['1','0','-1']);
  assert.match(bars[0].className,/positive/);assert.match(bars[2].className,/negative/);
  await act(named(d.root,'button','Calculate chunk 1'));
  assert.match(d.root.textContent,/-1 ÷ \(1 × 1\) = -1/);
  assert.equal(byTag(d.root,'table').length,2);await act(named(d.root,'button','Inspect chunk 1 in retained source'));
  assert.equal(d.inspected[0].ordinal,0);d.view.revoke();
});
test('512 ranks and every 384 component row remain reachable through bounded tables',async()=>{
  const d=fixture(inspectionInput({count:512,topK:5}));await open(d);const ranks=[];
  for(let i=0;i<11;i++){
    const table=byTag(d.root,'table')[0],body=byTag(table,'tbody')[0],rows=byTag(body,'tr');assert.ok(rows.length<=50);
    ranks.push(...rows.map(row=>Number(row.children[0].textContent)));
    if(i<10)await act(named(d.root,'button','Next 50 ranked chunks'));
  }
  assert.deepEqual(ranks,Array.from({length:512},(_,i)=>i+1));await act(named(d.root,'button','Calculate chunk 512'));
  const dimensions=[];
  for(let i=0;i<6;i++){
    const table=byTag(d.root,'table')[1],rows=byTag(byTag(table,'tbody')[0],'tr');assert.equal(rows.length,64);
    dimensions.push(...rows.map(row=>Number(row.children[0].textContent)));
    if(i<5)await act(named(d.root,'button','Next 64 dimensions'));
  }
  assert.deepEqual(dimensions,Array.from({length:384},(_,i)=>i+1));d.view.revoke();
});
test('exact full records revoke old native URLs on selection, close, same-binding rerender and ownership loss',async()=>{
  const d=fixture();let outer=await open(d);await act(named(d.root,'button','Calculate chunk 1'));
  const selected=await exportRecord(d,'Complete 384-component calculation JSON');assert.equal(JSON.parse(selected.exact).components.length,384);
  const ranking=await exportRecord(d,'Complete ranked passage scores JSON');assert.equal(JSON.parse(ranking.exact).rankedChunks.length,3);
  await act(named(d.root,'button','Calculate chunk 2'));await assert.rejects(fetch(selected.download.url));assert.equal(selected.button.disabled,true);
  selected.button.dispatch('click');assert.equal(d.downloads.length,2);assert.equal((await fetch(ranking.download.url)).ok,true);
  outer.open=false;await act(outer,'toggle');await assert.rejects(fetch(ranking.download.url));assert.equal(ranking.button.disabled,true);
  ranking.detail.open=true;ranking.detail.dispatch('toggle');ranking.button.dispatch('click');assert.equal(d.downloads.length,2);
  outer.open=true;await act(outer,'toggle');const again=await exportRecord(d,'Complete ranked passage scores JSON');
  d.view.render(d.binding);await assert.rejects(fetch(again.download.url));assert.equal(again.button.disabled,true);
  outer=await open(d);const final=await exportRecord(d,'Complete ranked passage scores JSON');d.binding=null;
  final.button.dispatch('click');await assert.rejects(fetch(final.download.url));assert.equal(d.root.textContent,'');assert.equal(d.downloads.length,4);
});
test('inconsistent artifacts are withheld with the fixed explanation and no partial rows',async()=>{
  const input=inspectionInput();input.retrieval.candidates[0].score+=1e-6;const d=fixture(input);await open(d);
  assert.match(d.root.textContent,/INVALID_RETRIEVAL_INSPECTION/);assert.equal(byTag(d.root,'table').length,0);
  assert.equal(named(d.root,'button','Download complete JSON'),undefined);d.view.revoke();
});
test('reentrant disposal preserves the newer owner and retires the old calculation controls',async()=>{
  let d,trigger=false;
  d=fixture(inspectionInput(),{textView:settings=>{
    const value=createBoundedTextView(settings);return {...value,dispose(){value.dispose();if(trigger){trigger=false;d.view.render(d.binding);}}};
  }});await open(d);await act(named(d.root,'button','Calculate chunk 1'));
  const selected=await exportRecord(d,'Complete 384-component calculation JSON');trigger=true;
  await act(named(d.root,'button','Calculate chunk 2'));await assert.rejects(fetch(selected.download.url));
  assert.equal(byTag(d.root,'details').length,1);assert.equal(d.root.textContent,'Inspect how similarity selects passages');
  await open(d);assert.equal(byTag(d.root,'table').length,1);selected.button.dispatch('click');assert.equal(d.downloads.length,1);d.view.revoke();
});
