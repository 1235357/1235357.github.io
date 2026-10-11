import test from 'node:test';
import assert from 'node:assert/strict';
import {inputOf,syntheticRun} from './financial-generation-fixture.mjs';
import {inspectFinancialOutput} from '../financial-output-contract.mjs';
import {dom,byTag,nodes} from './pdf-app-dom-fixture.mjs';

const module=await import('../generation-view.mjs').catch(()=>({}));
async function artifacts(){const input=inputOf(),raw=await syntheticRun(input,{maxNewTokens:17});const artifact=inspectFinancialOutput(raw.text,[...raw.promptTokenIds,...raw.generatedTokenIds],raw.preflight,input);return {raw,inspection:Object.freeze({status:'shape-and-citation-identity-accepted',artifact,error:null})};}
function view(pair){assert.equal(typeof module.createGenerationView,'function','presentation-only generation view exists');const d=dom(),root=d.root;let current=true,inspected=[];const result=module.createGenerationView({document:d.document,root,isCurrent:(raw,inspection)=>current&&raw===pair.raw&&inspection===pair.inspection,onInspect:(...values)=>inspected.push(values)});return {root,result,inspected,stale(){current=false;}};}
test('empty generation receipt guidance applies to the public entry',()=>{const v=view({raw:null,inspection:null});v.result.render(null,null);assert.match(v.root.textContent,/An explicit generation action follows/);assert.doesNotMatch(v.root.textContent,/private generation/);});
test('native draft is question-first, explicitly UNVERIFIED and binds exact retained citation identity',async()=>{const pair=await artifacts(),v=view(pair);v.result.render(pair.raw,pair.inspection);assert.match(v.root.textContent,/UNVERIFIED/);assert.match(v.root.textContent,/PRIVATE 財報/);assert.match(v.root.textContent,/invented \$9 trillion/);assert.match(v.root.textContent,/native-run/);const button=byTag(v.root,'button').find(n=>n.textContent.includes('E2'));button.dispatch('click');assert.equal(v.inspected[0][0],pair.inspection.artifact.citationBindings[0]);assert.equal(v.inspected[0][1],pair.raw);assert.equal(v.inspected[0][2],pair.inspection);assert.equal(v.inspected[0][0].ordinal,1);assert.equal(v.inspected[0][0].physicalPageNumber,2);});
test('refusal keeps complete raw output separate and has no draft answer card',async()=>{const {raw}=await artifacts(),pair={raw,inspection:Object.freeze({status:'refused',artifact:null,error:Object.freeze({code:'INVALID_FINANCIAL_OUTPUT_JSON',message:'The financial output is not a complete supported JSON object.'})})},v=view(pair);v.result.render(raw,pair.inspection);assert.match(v.root.textContent,/refused/i);assert.equal(nodes(v.root).filter(n=>n.className==='generation-answer').length,0);const detail=byTag(v.root,'details').find(n=>n.textContent.includes('RAW native output'));detail.open=true;detail.dispatch('toggle');assert.ok(byTag(detail,'pre').some(n=>n.textContent===raw.text));});
test('HTML-looking model/question/source text remains inert textContent',async()=>{const pair=await artifacts(),answer='<img src=x onerror=alert(1)> [x](javascript:alert(2))';pair.inspection={...pair.inspection,artifact:{...pair.inspection.artifact,answer}};const v=view(pair);v.result.render(pair.raw,pair.inspection);assert.ok(v.root.textContent.includes(answer));assert.equal(byTag(v.root,'img').length,0);assert.equal(byTag(v.root,'a').length,0);});
test('all lazy fields retain complete untruncated prompt/token/trace/native payloads',async()=>{const pair=await artifacts(),v=view(pair);v.result.render(pair.raw,pair.inspection);for(const detail of byTag(v.root,'details')){detail.open=true;detail.dispatch('toggle');}const text=v.root.textContent;for(const value of [pair.raw.preparedPrompt.renderedPrompt,JSON.stringify(pair.raw.preparedPrompt.messages,null,2),JSON.stringify(pair.raw.preparedPrompt.modelInput,null,2),JSON.stringify(pair.raw.preparedPrompt.tokenIds,null,2),JSON.stringify(pair.raw.preparedPrompt.attentionMask,null,2),JSON.stringify(pair.raw.preparedPrompt.preflight,null,2),JSON.stringify(pair.raw.promptTokenIds,null,2),JSON.stringify(pair.raw.generatedTokenIds,null,2),JSON.stringify(pair.raw.cachePreparation,null,2),JSON.stringify(pair.raw.sdkReads,null,2),JSON.stringify(pair.raw.stages,null,2),JSON.stringify(pair.raw.cleanup,null,2),JSON.stringify(pair.raw,null,2)])assert.ok(text.includes(value));});
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
  current.open=true;current.dispatch('toggle');assert.equal(byTag(current,'pre')[0].textContent,JSON.stringify(b,null,2));
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
