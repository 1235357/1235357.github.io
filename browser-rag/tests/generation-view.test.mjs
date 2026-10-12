import test from 'node:test';
import assert from 'node:assert/strict';
import {inputOf,syntheticRun} from './financial-generation-fixture.mjs';
import {inspectFinancialOutput} from '../financial-output-contract.mjs';
import {dom,byTag,nodes} from './pdf-app-dom-fixture.mjs';
import {completeText,downloadHarness} from './bounded-text-dom-fixture.mjs';

const module=await import('../generation-view.mjs').catch(()=>({}));
const detailNamed=(root,title)=>byTag(root,'details').find(n=>n.children[0].textContent===title);
async function artifacts(){const input=inputOf(),raw=await syntheticRun(input,{maxNewTokens:17});const artifact=inspectFinancialOutput(raw.text,[...raw.promptTokenIds,...raw.generatedTokenIds],raw.preflight,input);return {raw,inspection:Object.freeze({status:'shape-and-citation-identity-accepted',artifact,error:null})};}
function view(pair){assert.equal(typeof module.createGenerationView,'function','presentation-only generation view exists');const d=dom(),root=d.root;let current=true,inspected=[];const result=module.createGenerationView({document:d.document,root,isCurrent:(raw,inspection)=>current&&raw===pair.raw&&inspection===pair.inspection,onInspect:(...values)=>inspected.push(values)});return {root,result,inspected,stale(){current=false;}};}

test('canonical-input-only replacement revokes detached citation buttons',async()=>{
  const pair=await artifacts(),v=view(pair);v.result.render(pair.raw,pair.inspection,inputOf());const old=byTag(v.root,'button')[0];
  v.result.render(pair.raw,pair.inspection,inputOf());old.dispatch('click');assert.equal(v.inspected.length,0);
});
test('null render immediately scrubs an already opened detached source pre',async()=>{
  const pair=await artifacts(),v=view(pair);v.result.render(pair.raw,pair.inspection,inputOf());
  const old=byTag(v.root,'details').find(n=>n.children[0].textContent==='Original canonical generation input · replay only');old.open=true;old.dispatch('toggle');const pre=byTag(old,'pre')[0];assert.ok(pre.textContent);
  v.result.render(null,null,null);assert.equal(pre.textContent,'');assert.equal(byTag(old,'pre').length,0);
});
test('identical reference rerender revokes detached disclosures and citation buttons',async()=>{
  const pair=await artifacts(),v=view(pair),input=inputOf();v.result.render(pair.raw,pair.inspection,input);
  const old=byTag(v.root,'details')[0],button=byTag(v.root,'button')[0];v.result.render(pair.raw,pair.inspection,input);
  old.open=true;old.dispatch('toggle');button.dispatch('click');assert.equal(byTag(old,'pre').length,0);assert.equal(v.inspected.length,0);
});

test('large generation presentation strings and JSON keep every unit and export the whole payload with truthful MIME',async()=>{
  const pair=await artifacts(),d=dom(),exports=downloadHarness(d.document);
  // Presentation stress only: these expanded strings are not native model outputs.
  const raw={...pair.raw,text:'  汉字🧭\r\n'.repeat(90000)+'FINAL  ',preparedPrompt:{...pair.raw.preparedPrompt,renderedPrompt:'X'.repeat(300000)+'🧭END'}};
  const input={...inputOf(),presentationStress:'Z'.repeat(600000)+'EXACT LAST VALUE'};
  const v=module.createGenerationView({document:d.document,root:d.root,isCurrent:()=>true,onInspect:()=>{},textView:exports.textView});
  v.render(raw,pair.inspection,input);
  const cases=[['RAW native output · complete decoded text',raw.text,'native-output.txt','text/plain;charset=utf-8'],
    ['Full rendered prompt',raw.preparedPrompt.renderedPrompt,'rendered-prompt.txt','text/plain;charset=utf-8'],
    ['Original canonical generation input · replay only',JSON.stringify(input,null,2),'original-generation-input.json','application/json;charset=utf-8'],
    ['Complete RAW native receipt',JSON.stringify(raw,null,2),'native-generation-receipt.json','application/json;charset=utf-8']];
  for(const [title,text,filename,mime]of cases){
    const detail=detailNamed(d.root,title);detail.open=true;detail.dispatch('toggle');assert.equal(completeText(detail),text);
    const label=mime.startsWith('text/')?'Download complete text':'Download complete JSON';
    byTag(detail,'button').find(n=>n.textContent===label).dispatch('click');const blob=exports.blobs.at(-1);
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()),Buffer.from(text,'utf8'));assert.equal(blob.type,mime);assert.equal(exports.clicked.at(-1),filename);
    const pre=byTag(detail,'pre')[0];detail.open=false;detail.dispatch('toggle');assert.equal(pre.textContent,'');
  }
  assert.equal(exports.blobs.length,4);assert.equal(exports.revoked.length,4);
});

test('opened downloads revoke on identical rerender and old callbacks cannot clear a new viewer',async()=>{
  const pair=await artifacts(),d=dom(),exports=downloadHarness(d.document),input=inputOf();
  const v=module.createGenerationView({document:d.document,root:d.root,isCurrent:()=>true,onInspect:()=>{},textView:exports.textView});
  v.render(pair.raw,pair.inspection,input);const old=detailNamed(d.root,'Original canonical generation input · replay only');old.open=true;old.dispatch('toggle');
  const oldPre=byTag(old,'pre')[0],download=byTag(old,'button').find(n=>n.textContent==='Download complete JSON');download.dispatch('click');
  v.render(pair.raw,pair.inspection,input);assert.equal(oldPre.textContent,'');assert.deepEqual(exports.revoked,['blob:test-export-1']);
  const next=detailNamed(d.root,'Original canonical generation input · replay only');next.open=true;next.dispatch('toggle');
  old.dispatch('toggle');download.dispatch('click');assert.equal(completeText(next),JSON.stringify(input,null,2));assert.equal(exports.blobs.length,1);
  v.render(null,null);assert.equal(byTag(next,'pre').length,0);
});

test('reentrant owner checks and a late viewer factory cannot remount obsolete content',async()=>{
  const pair=await artifacts();
  for(const stage of ['owner','factory']){
    const d=dom(),exports=downloadHarness(d.document);let view,invalid=false,disposals=0;
    view=module.createGenerationView({document:d.document,root:d.root,onInspect:()=>{},
      isCurrent:()=>{if(stage==='owner'&&invalid){invalid=false;view.render(null,null);}return true;},
      textView:args=>{const viewer=exports.textView(args);view.render(null,null);return {dispose(){disposals++;viewer.dispose();}};}});
    view.render(pair.raw,pair.inspection,inputOf());const old=detailNamed(d.root,'Original canonical generation input · replay only');
    invalid=true;old.open=true;old.dispatch('toggle');assert.equal(byTag(old,'pre').length,0);assert.equal(byTag(d.root,'pre').length,0);
    assert.match(d.root.textContent,/No native generation receipt/);assert.equal(disposals,stage==='factory'?1:0);
  }
});

test('a newer render started during old viewer disposal survives outer cleanup and empty guidance',async()=>{
  const pair=await artifacts(),d=dom(),exports=downloadHarness(d.document),input=inputOf();let v,reenter=false;
  v=module.createGenerationView({document:d.document,root:d.root,isCurrent:()=>true,onInspect:()=>{},textView:args=>{
    const viewer=exports.textView(args);return {dispose(){viewer.dispose();if(reenter){reenter=false;v.render(pair.raw,pair.inspection,input);}}};
  }});
  v.render(pair.raw,pair.inspection,input);const old=detailNamed(d.root,'Original canonical generation input · replay only');old.open=true;old.dispatch('toggle');
  reenter=true;v.render(null,null);assert.match(d.root.textContent,/UNVERIFIED/);assert.ok(detailNamed(d.root,'Original canonical generation input · replay only'));
  assert.equal(byTag(old,'pre').length,0);
});

test('disclosure read and viewer failures display only canonical safe diagnostics',async()=>{
  const pair=await artifacts();
  for(const stage of ['read','factory']){
    const d=dom(),raw={...pair.raw};if(stage==='read')Object.defineProperty(raw,'text',{get(){throw Error('PRIVATE RAW SOURCE');}});
    const v=module.createGenerationView({document:d.document,root:d.root,isCurrent:()=>true,onInspect:()=>{},
      textView:()=>{throw Error('PRIVATE VIEWER TRACE');}});
    v.render(raw,pair.inspection);const old=detailNamed(d.root,'RAW native output · complete decoded text');old.open=true;old.dispatch('toggle');
    assert.match(old.textContent,/GENERATION_DISCLOSURE_FAILED/);assert.doesNotMatch(old.textContent,/PRIVATE/);assert.equal(byTag(old,'pre').length,0);
  }
});
test('empty generation receipt guidance applies to the public entry',()=>{const v=view({raw:null,inspection:null});v.result.render(null,null);assert.match(v.root.textContent,/An explicit generation action follows/);assert.doesNotMatch(v.root.textContent,/private generation/);});
test('native draft is question-first, explicitly UNVERIFIED and binds exact retained citation identity',async()=>{const pair=await artifacts(),v=view(pair);v.result.render(pair.raw,pair.inspection);assert.match(v.root.textContent,/UNVERIFIED/);assert.match(v.root.textContent,/PRIVATE 財報/);assert.match(v.root.textContent,/invented \$9 trillion/);assert.match(v.root.textContent,/native-run/);const button=byTag(v.root,'button').find(n=>n.textContent.includes('E2'));button.dispatch('click');assert.equal(v.inspected[0][0],pair.inspection.artifact.citationBindings[0]);assert.equal(v.inspected[0][1],pair.raw);assert.equal(v.inspected[0][2],pair.inspection);assert.equal(v.inspected[0][0].ordinal,1);assert.equal(v.inspected[0][0].physicalPageNumber,2);});
test('refusal keeps complete raw output separate and has no draft answer card',async()=>{const {raw}=await artifacts(),pair={raw,inspection:Object.freeze({status:'refused',artifact:null,error:Object.freeze({code:'INVALID_FINANCIAL_OUTPUT_JSON',message:'The financial output is not a complete supported JSON object.'})})},v=view(pair);v.result.render(raw,pair.inspection);assert.match(v.root.textContent,/refused/i);assert.equal(nodes(v.root).filter(n=>n.className==='generation-answer').length,0);const detail=byTag(v.root,'details').find(n=>n.textContent.includes('RAW native output'));detail.open=true;detail.dispatch('toggle');assert.ok(byTag(detail,'pre').some(n=>n.textContent===raw.text));});
test('HTML-looking model/question/source text remains inert textContent',async()=>{const pair=await artifacts(),answer='<img src=x onerror=alert(1)> [x](javascript:alert(2))';pair.inspection={...pair.inspection,artifact:{...pair.inspection.artifact,answer}};const v=view(pair);v.result.render(pair.raw,pair.inspection);assert.ok(v.root.textContent.includes(answer));assert.equal(byTag(v.root,'img').length,0);assert.equal(byTag(v.root,'a').length,0);});
test('all lazy generation fields reconstruct exact complete payloads through bounded pages',async()=>{
  const pair=await artifacts(),v=view(pair),input=inputOf();v.result.render(pair.raw,pair.inspection,input);
  const expected=new Map([
    ['Inspect exact cited quote and complete source mapping',JSON.stringify({text:pair.inspection.artifact.citationBindings[0].text,segments:pair.inspection.artifact.citationBindings[0].segments},null,2)],
    ['Complete pure shape/citation inspection (generationMode: not-run)',JSON.stringify(pair.inspection.artifact,null,2)],
    ['Original canonical generation input · replay only',JSON.stringify(input,null,2)],
    ['RAW native output · complete decoded text',pair.raw.text],
    ['Full rendered prompt',pair.raw.preparedPrompt.renderedPrompt],
    ['Full prompt messages',JSON.stringify(pair.raw.preparedPrompt.messages,null,2)],
    ['Full model input and retained evidence',JSON.stringify(pair.raw.preparedPrompt.modelInput,null,2)],
    ['Prepared prompt token IDs',JSON.stringify(pair.raw.preparedPrompt.tokenIds,null,2)],
    ['Prepared attention mask',JSON.stringify(pair.raw.preparedPrompt.attentionMask,null,2)],
    ['Prepared prompt preflight and actual generation budget',JSON.stringify(pair.raw.preparedPrompt.preflight,null,2)],
    ['Native prompt token IDs',JSON.stringify(pair.raw.promptTokenIds,null,2)],
    ['Native generated token IDs',JSON.stringify(pair.raw.generatedTokenIds,null,2)],
    ['Native sequence preflight',JSON.stringify(pair.raw.preflight,null,2)],
    ['Asset cache preparation receipt',JSON.stringify(pair.raw.cachePreparation,null,2)],
    ['Repeated SDK read receipt',JSON.stringify(pair.raw.sdkReads,null,2)],
    ['Native stage trace',JSON.stringify(pair.raw.stages,null,2)],
    ['Native resource cleanup receipt',JSON.stringify(pair.raw.cleanup,null,2)],
    ['Complete RAW native receipt',JSON.stringify(pair.raw,null,2)],
  ]);
  for(const detail of byTag(v.root,'details')){
    const title=detail.children[0].textContent;if(!expected.has(title))continue;
    detail.open=true;detail.dispatch('toggle');assert.equal(completeText(detail),expected.get(title));expected.delete(title);
    detail.open=false;detail.dispatch('toggle');assert.equal(byTag(detail,'pre').length,0);
  }
  assert.equal(expected.size,0);
});
test('stale buttons and lazy details never descend into old artifacts',async()=>{const pair=await artifacts(),v=view(pair);v.result.render(pair.raw,pair.inspection);const details=byTag(v.root,'details'),button=byTag(v.root,'button')[0];v.stale();for(const d of details){d.open=true;d.dispatch('toggle');assert.equal(byTag(d,'pre').length,0);}button.dispatch('click');assert.equal(v.inspected.length,0);});
test('new render revokes detached A callbacks even if its caller owner remains current',async()=>{const a=await artifacts(),b=await artifacts(),d=dom(),inspected=[];assert.equal(typeof module.createGenerationView,'function');const v=module.createGenerationView({document:d.document,root:d.root,isCurrent:()=>true,onInspect:(...args)=>inspected.push(args)});v.render(a.raw,a.inspection);const old=byTag(d.root,'details')[0],button=byTag(d.root,'button')[0];v.render(b.raw,b.inspection);old.open=true;old.dispatch('toggle');button.dispatch('click');assert.equal(byTag(old,'pre').length,0);assert.equal(inspected.length,0);});

test('replacing only the canonical input revokes its detached lazy disclosure',async()=>{
  const pair=await artifacts(),d=dom(),a=inputOf(),b=inputOf();
  const v=module.createGenerationView({document:d.document,root:d.root,isCurrent:()=>true,onInspect:()=>{}});
  v.render(pair.raw,pair.inspection,a);
  const old=byTag(d.root,'details').find(node=>node.children[0].textContent==='Original canonical generation input · replay only');
  assert.ok(old);assert.equal(byTag(old,'pre').length,0);
  v.render(pair.raw,pair.inspection,b);
  old.open=true;old.dispatch('toggle');assert.equal(byTag(old,'pre').length,0);
  const current=byTag(d.root,'details').find(node=>node.children[0].textContent==='Original canonical generation input · replay only');
  current.open=true;current.dispatch('toggle');assert.equal(completeText(current),JSON.stringify(b,null,2));
});

test('a receipt without original canonical input explicitly discloses the replay limitation',async()=>{
  const pair=await artifacts(),v=view(pair);v.result.render(pair.raw,pair.inspection);
  assert.match(v.root.textContent,/original canonical generation input was not captured/);
  assert.match(v.root.textContent,/assembled prompt context alone cannot reproduce the citation gate/);
  assert.equal(byTag(v.root,'details').some(node=>node.children[0].textContent==='Original canonical generation input · replay only'),false);
});

test('native stage meters represent start-to-next-boundary intervals and never isolated GPU time',async()=>{
  const pair=await artifacts(),v=view(pair);v.result.render(pair.raw,pair.inspection);
  const detail=byTag(v.root,'details').find(node=>node.className==='generation-timing');
  assert.ok(detail);assert.equal(byTag(detail,'table').length,0);detail.open=true;detail.dispatch('toggle');
  const meters=byTag(detail,'meter');assert.equal(meters.length,pair.raw.stages.length);
  for(const [index,stage]of pair.raw.stages.entries()){
    const end=pair.raw.stages[index+1]?.elapsedMs??pair.raw.elapsedMs;
    assert.equal(meters[index].value,end-stage.elapsedMs);assert.equal(meters[index].max,pair.raw.elapsedMs||1);
    assert.match(meters[index].attributes.get('aria-label'),/ms of/);
  }
  assert.match(detail.textContent,/not isolated GPU/);assert.match(detail.textContent,/cleanup ends at the complete receipt/);
  v.stale();detail.dispatch('toggle');assert.equal(byTag(detail,'table').length,0);
});
