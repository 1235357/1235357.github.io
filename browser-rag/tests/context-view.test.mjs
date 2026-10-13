import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageRecord} from '../pdf-source.mjs';
import {chunkSource} from '../chunking.mjs';
import {EMBEDDING_SPEC} from '../embedding-contract.mjs';
import {rankCandidates} from '../retrieval.mjs';
import {queryResultReceipt} from '../query-source.mjs';
import {assembleProvenanceContext} from '../context-contract.mjs';
import {createContextView} from '../context-view.mjs';
import {NodeDouble,nodes,byTag} from './pdf-app-dom-fixture.mjs';
import {completeText,downloadHarness} from './bounded-text-dom-fixture.mjs';
import {BOUNDED_TEXT_MAX_UNITS,BOUNDED_TEXT_MAX_LINES} from '../bounded-text-view.mjs';

// Production-contract-valid controlled provenance. Tokens and 384-coordinate
// vectors are synthetic: this fixture does not run a tokenizer, encoder or model.
function controlledContext(strings=Array.from({length:200},()=>Array(128).fill('a'))){
  const sha='b'.repeat(64),parser={name:'pdfjs',version:'6.4.299',policyVersion:'text-items-v1',disableNormalization:true};
  const source={schemaVersion:1,status:'extracted-not-indexed',source:{sha256:sha,name:'CONTROLLED_SOURCE.pdf',size:1002},parser,
    numPages:strings.length,workerMode:'node-fake',pages:strings.map((items,index)=>createPageRecord({sourceSha256:sha,
      parserVersion:parser.version,physicalPageNumber:index+1,pageLabel:null,page:{view:[0,0,612,792],rotate:0,userUnit:1},
      textContent:{items:items.map(str=>({str,dir:'ltr',transform:[12,0,0,12,30,740],width:12,height:12,fontName:'controlled-f1',hasEOL:false}))}}))};
  const chunkArtifact=chunkSource(source,{maxChunkUtf16:4096,overlapUtf16:0}),axis=()=>Array.from({length:384},(_,index)=>index===0?1:0);
  const tokenIds=[101,...Array(128).fill(1037),102];
  const embeddingArtifact={schemaVersion:1,status:'embedded-not-retrieved',sourceSha256:sha,representationId:EMBEDDING_SPEC.version,
    representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',chunkIds:chunkArtifact.chunks.map(chunk=>chunk.id),
    tokenIds:chunkArtifact.chunks.map(()=>[...tokenIds]),vectors:chunkArtifact.chunks.map(axis),
    counts:{chunks:chunkArtifact.chunks.length,totalTokens:chunkArtifact.chunks.length*tokenIds.length,dimensions:384},
    receipt:{verifiedBytes:100,networkBytes:100,cacheBytes:0,elapsedMs:1}};
  const query={schemaVersion:1,status:'query-embedded-not-retrieved',representationId:EMBEDDING_SPEC.version,representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',
    tokenIds:[101,1037,102],vector:axis(),counts:{totalTokens:3,dimensions:384},receipt:{verifiedBytes:100,networkBytes:100,cacheBytes:0,elapsedMs:1}};
  const topK=chunkArtifact.chunks.length,queryResult={query,retrieval:rankCandidates(chunkArtifact,embeddingArtifact,
    {representationId:query.representationId,representation:query.representation,vector:query.vector},{topK})};
  return assembleProvenanceContext({source,chunkArtifact,embeddingArtifact,question:'CONTROLLED question',queryResult,topK,
    queryDownloadTotal:100,queryMetadata:queryResultReceipt(queryResult)});
}
const artifact=controlledContext();
assert.equal(artifact.evidenceUnits.length,200);
assert.equal(artifact.evidenceUnits.reduce((count,unit)=>count+unit.segments.length,0),51000);
const button=(root,title)=>byTag(root,'button').find(node=>node.textContent===title);
const detail=(root,title)=>byTag(root,'details').find(node=>node.children[0]?.textContent===title);
const outerDetails=root=>byTag(root,'details').filter(node=>node.children[0]?.textContent==='Inspect exact quote and all mapping segments');
const toggle=(node,open)=>{node.open=open;node.dispatch('toggle');};
const listener=(node,event)=>node.listeners.get(event)?.[0];
const mapping=outer=>detail(outer,'Complete mapping segments JSON');
const record=outer=>detail(outer,'Complete evidence unit JSON');

function mount(extra={}){
  const document={createElement:tag=>new NodeDouble(tag)},root=new NodeDouble(),harness=downloadHarness(document),calls=[],inspections=[];
  const textView=args=>{calls.push(args);return harness.textView(args);};
  const view=createContextView({document,root,isCurrent:()=>true,onInspect:(...args)=>inspections.push(args),textView,...extra});
  return {document,root,harness,calls,inspections,view};
}
function loaded(d,index=0){
  const outer=outerDetails(d.root)[index];assert.ok(outer);toggle(outer,true);
  const nested=mapping(outer);assert.ok(nested);toggle(nested,true);return {outer,nested};
}
function assertScrubbed(captured){
  for(const node of captured){assert.equal(node.textContent,'');if(['button','input','summary'].includes(node.tagName))assert.equal(node.disabled,true);}
}

test('context rendering is lazy and preserves exact metadata, selected evidence and inspection identity',()=>{
  const d=mount();d.view.render(artifact);
  assert.equal(outerDetails(d.root).length,100);assert.equal(byTag(d.root,'pre').length,0);assert.equal(d.calls.length,0);
  assert.equal(nodes(d.root).filter(node=>node.className==='quote').length,0);
  assert.ok(d.root.textContent.includes(artifact.source.sha256));assert.ok(d.root.textContent.includes(artifact.question));
  button(d.root,'Inspect E1 in retained source').dispatch('click');assert.deepEqual(d.inspections,[[artifact.evidenceUnits[0],artifact]]);
  toggle(outerDetails(d.root)[0],true);assert.equal(d.calls.length,0);
  assert.equal(nodes(d.root).find(node=>node.className==='quote').textContent,artifact.evidenceUnits[0].text);
  assert.ok(mapping(outerDetails(d.root)[0]));assert.ok(record(outerDetails(d.root)[0]));
});

test('opening the exact quote at the production 4096-unit limit preserves every Unicode and whitespace unit',()=>{
  const prefix='  汉字🧭e\u0301\t<script>literal</script>\r\n';
  const exact=prefix+'x'.repeat(4096-prefix.length),accepted=controlledContext([[exact]]),d=mount();
  assert.equal(accepted.evidenceUnits[0].text.length,4096);d.view.render(accepted);toggle(outerDetails(d.root)[0],true);
  assert.equal(nodes(d.root).find(node=>node.className==='quote').textContent,exact);assert.equal(byTag(d.root,'script').length,0);
  assert.equal(byTag(d.root,'pre').length,0);
});

test('100 simultaneously opened mapping disclosures stay within page budgets and reconstruct all 25500 visible-window segments',()=>{
  const d=mount();d.view.render(artifact);
  for(const [index,outer]of outerDetails(d.root).entries()){
    toggle(outer,true);const nested=mapping(outer);assert.ok(nested);toggle(nested,true);
    assert.equal(completeText(nested),JSON.stringify(artifact.evidenceUnits[index].segments,null,2));
  }
  const pres=byTag(d.root,'pre');assert.equal(pres.length,100);assert.equal(d.calls.length,100);
  for(const pre of pres){assert.equal(pre.className,'bounded-text-page');assert.ok(pre.textContent.length<=BOUNDED_TEXT_MAX_UNITS);assert.ok(pre.textContent.split('\n').length<=BOUNDED_TEXT_MAX_LINES);}
  assert.ok(pres.reduce((size,pre)=>size+pre.textContent.length,0)<=100*BOUNDED_TEXT_MAX_UNITS);
  assert.equal(d.harness.blobs.length,0);assert.equal(d.harness.clicked.length,0);
});

test('mapping and complete selected-evidence record downloads preserve exact native Blob bytes and rank filenames',async()=>{
  const d=mount();d.view.render(artifact);const {outer,nested}=loaded(d),unit=artifact.evidenceUnits[0];
  const full=record(outer);assert.ok(full);toggle(full,true);
  assert.equal(completeText(nested),JSON.stringify(unit.segments,null,2));assert.equal(completeText(full),JSON.stringify(unit,null,2));
  button(nested,'Download complete JSON').dispatch('click');button(full,'Download complete JSON').dispatch('click');
  assert.deepEqual(d.harness.clicked,['evidence-1-mapping.json','evidence-1-record.json']);assert.equal(d.harness.blobs.length,2);
  for(const [index,value]of [unit.segments,unit].entries()){
    assert.ok(d.harness.blobs[index] instanceof Blob);assert.equal(d.harness.blobs[index].type,'application/json;charset=utf-8');
    assert.deepEqual(Buffer.from(await d.harness.blobs[index].arrayBuffer()),Buffer.from(JSON.stringify(value,null,2),'utf8'));
  }
  toggle(outer,false);assert.deepEqual(d.harness.revoked,['blob:test-export-1','blob:test-export-2']);
});

test('closing an outer quote scrubs and disposes its nested viewers, and reopening creates fresh disclosures',()=>{
  const d=mount();d.view.render(artifact);const {outer,nested}=loaded(d),summary=outer.children[0];
  const captured=nodes(outer).filter(node=>node!==outer&&node!==summary),oldOwner=d.calls[0].current,oldToggle=listener(nested,'toggle');
  button(nested,'Download complete JSON').dispatch('click');toggle(outer,false);
  assert.deepEqual(outer.children,[summary]);assert.equal(oldOwner(),false);assertScrubbed(captured);
  assert.deepEqual(d.harness.revoked,['blob:test-export-1']);nested.open=true;oldToggle({target:nested});assert.equal(nested.textContent,'');
  toggle(outer,true);const fresh=mapping(outer);assert.notEqual(fresh,nested);toggle(fresh,true);
  assert.equal(completeText(fresh),JSON.stringify(artifact.evidenceUnits[0].segments,null,2));assert.equal(oldOwner(),false);
});

test('same-artifact rerender scrubs old nodes and makes captured inspect, navigation and disclosure callbacks inactive',()=>{
  const d=mount();d.view.render(artifact);const {outer,nested}=loaded(d),captured=nodes(d.root),owner=d.calls[0].current;
  const inspect=button(d.root,'Inspect E1 in retained source'),next=button(d.root,'Next 100 evidence units');
  const inspectCallback=listener(inspect,'click'),nextCallback=listener(next,'click'),outerCallback=listener(outer,'toggle');
  const oldControls=byTag(nested,'button'),oldClicks=oldControls.map(node=>listener(node,'click')).filter(Boolean);
  button(nested,'Download complete JSON').dispatch('click');d.view.render(artifact);const fresh=outerDetails(d.root)[0];
  assertScrubbed(captured.filter(node=>node!==d.root));assert.equal(owner(),false);assert.deepEqual(d.harness.revoked,['blob:test-export-1']);
  inspectCallback({target:inspect});nextCallback({target:next});outer.open=true;outerCallback({target:outer});
  assert.equal(d.inspections.length,0);assert.equal(outer.textContent,'');assert.equal(outerDetails(d.root)[0],fresh);
  assert.equal(outerDetails(d.root).length,100);assert.ok(d.root.textContent.includes('window 1 of 2'));
  const freshMap=loaded(d).nested;oldClicks.forEach(callback=>callback({target:oldControls[0]}));
  assert.equal(completeText(freshMap),JSON.stringify(artifact.evidenceUnits[0].segments,null,2));assert.equal(d.harness.blobs.length,1);
});

test('every evidence window visit owns a fresh token, so returning to the first window cannot revive old handles',()=>{
  const d=mount();d.view.render(artifact);const {outer,nested}=loaded(d),captured=nodes(outer),owner=d.calls[0].current;
  const inspect=button(d.root,'Inspect E1 in retained source'),oldNext=button(d.root,'Next 100 evidence units');
  const inspectCallback=listener(inspect,'click'),nextCallback=listener(oldNext,'click');
  button(nested,'Download complete JSON').dispatch('click');oldNext.dispatch('click');
  assertScrubbed(captured);assert.equal(owner(),false);assert.deepEqual(d.harness.revoked,['blob:test-export-1']);
  const second=outerDetails(d.root);assert.equal(second.length,100);assert.ok(d.root.textContent.includes('evidence 101–200'));
  for(const [index,card]of second.entries()){toggle(card,true);const map=mapping(card);assert.ok(map);toggle(map,true);assert.equal(completeText(map),JSON.stringify(artifact.evidenceUnits[index+100].segments,null,2));}
  button(d.root,'Previous 100 evidence units').dispatch('click');const fresh=outerDetails(d.root)[0];
  inspectCallback({target:inspect});nextCallback({target:oldNext});assert.equal(d.inspections.length,0);assert.equal(owner(),false);
  assert.equal(outerDetails(d.root)[0],fresh);assert.ok(d.root.textContent.includes('window 1 of 2'));
});

test('public revoke is idempotent, immediately scrubs captured content and URLs, and allows a new render',()=>{
  const d=mount();d.view.render(artifact);const {outer,nested}=loaded(d),captured=nodes(d.root),owner=d.calls[0].current;
  const callback=listener(outer,'toggle');button(nested,'Download complete JSON').dispatch('click');
  assert.equal(typeof d.view.revoke,'function');d.view.revoke();d.view.revoke();
  assert.equal(d.root.textContent,'');assert.equal(d.root.children.length,0);assert.equal(owner(),false);assertScrubbed(captured);
  assert.deepEqual(d.harness.revoked,['blob:test-export-1']);outer.open=true;callback({target:outer});assert.equal(outer.textContent,'');
  d.view.render(artifact);assert.equal(outerDetails(d.root).length,100);
});

test('rendering null retires loaded records and presents the empty state without retained exports',()=>{
  const d=mount();d.view.render(artifact);const {outer,nested}=loaded(d),captured=nodes(outer),owner=d.calls[0].current;
  button(nested,'Download complete JSON').dispatch('click');d.view.render(null);
  assertScrubbed(captured);assert.equal(owner(),false);assert.deepEqual(d.harness.revoked,['blob:test-export-1']);
  assert.equal(byTag(d.root,'details').length,0);assert.ok(d.root.textContent.includes('No provenance context committed'));
});

test('old owner predicates reject locally before calling external isCurrent after same-reference rerender',()=>{
  let checks=0;const d=mount({isCurrent:()=>{checks++;return true;}});d.view.render(artifact);loaded(d);const owner=d.calls[0].current;
  d.view.render(artifact);const before=checks;assert.equal(owner(),false);assert.equal(checks,before);
});

test('isCurrent rerender reentrancy during an inspect callback rejects its old token after the external check',()=>{
  let d,arm=false;d=mount({isCurrent:()=>{if(arm){arm=false;d.view.render(artifact);}return true;}});d.view.render(artifact);
  const inspect=button(d.root,'Inspect E1 in retained source');arm=true;inspect.dispatch('click');
  assert.equal(d.inspections.length,0);assert.equal(inspect.disabled,true);assert.equal(outerDetails(d.root).length,100);
});

test('isCurrent window-return reentrancy cannot authorize an old inspect callback',()=>{
  let d,arm=false;d=mount({isCurrent:()=>{if(arm){arm=false;button(d.root,'Next 100 evidence units').dispatch('click');button(d.root,'Previous 100 evidence units').dispatch('click');}return true;}});
  d.view.render(artifact);const inspect=button(d.root,'Inspect E1 in retained source');arm=true;inspect.dispatch('click');
  assert.equal(d.inspections.length,0);assert.equal(inspect.disabled,true);assert.ok(d.root.textContent.includes('window 1 of 2'));
});

test('isCurrent reentrancy while opening a quote cannot append to an old same-artifact render',()=>{
  let d,arm=false;d=mount({isCurrent:()=>{if(arm){arm=false;d.view.render(artifact);}return true;}});d.view.render(artifact);
  const outer=outerDetails(d.root)[0],callback=listener(outer,'toggle');arm=true;toggle(outer,true);
  assert.equal(outer.textContent,'');assert.equal(outer.open,false);assert.equal(d.calls.length,0);
  assert.equal(nodes(d.root).filter(node=>node.className==='quote').length,0);outer.open=true;callback({target:outer});assert.equal(outer.textContent,'');
});

for(const result of ['true','false','throw']){
  test(`initial isCurrent render reentrancy preserves a newer null render when the old predicate returns ${result}`,()=>{
    let d,arm=true;d=mount({isCurrent:()=>{if(arm){arm=false;d.view.render(null);if(result==='throw')throw Error('PRIVATE OLD OWNER TRACE');return result==='true';}return true;}});
    d.view.render(artifact);assert.equal(byTag(d.root,'details').length,0);assert.ok(d.root.textContent.includes('No provenance context committed'));
    assert.equal(d.calls.length,0);
  });
  test(`isCurrent navigation reentrancy preserves a newer same-artifact first window when the old predicate returns ${result}`,()=>{
    let d,arm=false;d=mount({isCurrent:()=>{if(arm){arm=false;d.view.render(artifact);if(result==='throw')throw Error('PRIVATE OLD OWNER TRACE');return result==='true';}return true;}});
    d.view.render(artifact);const next=button(d.root,'Next 100 evidence units');arm=true;next.dispatch('click');
    assert.equal(next.disabled,true);assert.ok(d.root.textContent.includes('window 1 of 2'));assert.equal(outerDetails(d.root).length,100);
  });
}

test('a stale or throwing initial owner cannot render private context or disclosure controls',()=>{
  for(const isCurrent of [()=>false,()=>{throw Error('PRIVATE INITIAL OWNER TRACE');}]){
    const d=mount({isCurrent});d.view.render(artifact);assert.equal(d.root.textContent,'');assert.equal(d.root.children.length,0);
    assert.equal(d.calls.length,0);assert.equal(d.harness.blobs.length,0);
  }
});

test('a late text factory after a same-artifact render is disposed and its late old nodes are scrubbed',()=>{
  let d,oldPre,oldOwner,disposals=0;d=mount({textView:args=>{oldOwner=args.current;d.view.render(artifact);
    oldPre=new NodeDouble('pre');oldPre.textContent='PRIVATE LATE MAPPING';args.root.append(oldPre);return {dispose(){disposals++;}};}});
  d.view.render(artifact);loaded(d);assert.equal(disposals,1);assert.equal(oldOwner(),false);assert.equal(oldPre.textContent,'');
  assert.equal(outerDetails(d.root).length,100);assert.equal(byTag(d.root,'pre').length,0);assert.doesNotMatch(d.root.textContent,/PRIVATE/);
});

test('a late text factory after revoke is disposed without retaining late private nodes',()=>{
  let d,oldPre,disposals=0;d=mount({textView:args=>{d.view.revoke();oldPre=new NodeDouble('pre');oldPre.textContent='PRIVATE LATE RECORD';args.root.append(oldPre);return {dispose(){disposals++;}};}});
  d.view.render(artifact);loaded(d);assert.equal(disposals,1);assert.equal(oldPre.textContent,'');assert.equal(d.root.textContent,'');
});

test('a late text factory after leaving and revisiting its window is disposed with a permanently stale token',()=>{
  let d,oldOwner,oldPre,disposals=0;d=mount({textView:args=>{
    oldOwner=args.current;button(d.root,'Next 100 evidence units').dispatch('click');button(d.root,'Previous 100 evidence units').dispatch('click');
    oldPre=new NodeDouble('pre');oldPre.textContent='PRIVATE OLD WINDOW';args.root.append(oldPre);return {dispose(){disposals++;}};
  }});d.view.render(artifact);loaded(d);assert.equal(disposals,1);assert.equal(oldOwner(),false);assert.equal(oldPre.textContent,'');
  assert.ok(d.root.textContent.includes('window 1 of 2'));assert.equal(byTag(d.root,'pre').length,0);
});

test('a throwing nested viewer disposer still scrubs the old window without leaking its message',()=>{
  let oldPre;const d=mount({textView:args=>{
    oldPre=new NodeDouble('pre');oldPre.textContent='PRIVATE DISPOSER RECORD';args.root.append(oldPre);return {dispose(){throw Error('PRIVATE DISPOSER TRACE');}};
  }});d.view.render(artifact);loaded(d);button(d.root,'Next 100 evidence units').dispatch('click');
  assert.equal(oldPre.textContent,'');assert.ok(d.root.textContent.includes('window 2 of 2'));assert.doesNotMatch(d.root.textContent,/PRIVATE/);
});

for(const action of ['render','window','revoke','close'])test(`a reentrant old viewer disposer during ${action} cannot scrub a newer context render`,()=>{
  let d,reenter=true,oldPre;d=mount({textView:args=>{
    const view=d.harness.textView(args);oldPre??=byTag(args.root,'pre')[0];
    return {dispose(){if(reenter){reenter=false;d.view.render(artifact);loaded(d);}view.dispose();}};
  }});d.view.render(artifact);const {outer,nested}=loaded(d),captured=nodes(outer);
  button(nested,'Download complete JSON').dispatch('click');
  if(action==='render')d.view.render(artifact);else if(action==='window')button(d.root,'Next 100 evidence units').dispatch('click');
  else if(action==='revoke')d.view.revoke();else toggle(outer,false);
  assertScrubbed(captured);assert.equal(oldPre.textContent,'');assert.deepEqual(d.harness.revoked,['blob:test-export-1']);
  assert.equal(outerDetails(d.root).length,100);const fresh=mapping(outerDetails(d.root)[0]);assert.ok(fresh);
  assert.equal(completeText(fresh),JSON.stringify(artifact.evidenceUnits[0].segments,null,2));
});

test('throwing isCurrent revokes a loaded view without exposing dependency diagnostics',()=>{
  let fail=false;const d=mount({isCurrent:()=>{if(fail)throw Error('PRIVATE OWNER TRACE');return true;}});
  d.view.render(artifact);const {outer,nested}=loaded(d),captured=nodes(outer);button(nested,'Download complete JSON').dispatch('click');
  fail=true;button(d.root,'Inspect E1 in retained source').dispatch('click');assertScrubbed(captured);
  assert.equal(d.root.textContent,'');assert.equal(d.inspections.length,0);assert.deepEqual(d.harness.revoked,['blob:test-export-1']);
});
