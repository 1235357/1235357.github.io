import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetPreparationView} from '../asset-preparation-view.mjs';
import {dom,nodes,byTag,deferred,act} from './pdf-app-dom-fixture.mjs';
import {receipt,progress} from './asset-preparation-fixture.mjs';
import {AssetPreparationError} from '../asset-preparation-source.mjs';
import {preparationTransportPlan,validatePreparationPhysicalMetadata} from '../asset-preparation-transport.mjs';
const setup=prepare=>{const d=dom(),view=createAssetPreparationView({document:d.document,root:d.root,prepare,runtimeIdFactory:()=> 'prep-view'});view.render({source:null,documentEpoch:0,active:false});return {...d,view,get:id=>nodes(d.root).find(node=>node.id===id)};};
test('mount performs no preparation; explicit profile action sends identity only and lazily discloses exact receipt',async()=>{
  let calls=0,forwarded;const d=setup(async(profile,options)=>{calls++;forwarded={profile,options};options.onProgress(progress(profile,650));options.onProgress(progress(profile,receipt(profile).verifiedBytes));return receipt(profile);});
  assert.equal(calls,0);assert.match(d.root.textContent,/113.63 MB/);assert.match(d.root.textContent,/815.73 MB/);assert.match(d.root.textContent,/30-minute/);
  await act(d.get('prepare-encoder'));assert.equal(calls,1);assert.deepEqual(Object.keys(forwarded.options),['transport','identity','signal','onProgress']);assert.equal(forwarded.options.transport,'site');assert.equal(forwarded.profile,'encoder');assert.equal(forwarded.options.identity.documentEpoch,0);
  const detail=byTag(d.get('asset-preparation-receipt'),'details')[0];assert.ok(detail);assert.equal(byTag(detail,'pre').length,0);detail.open=true;await act(detail,'toggle');assert.deepEqual(JSON.parse(byTag(detail,'pre')[0].textContent),receipt());assert.match(d.get('asset-preparation-status').textContent,/inference have not run/);
});
test('encoder progress reports complete verified bodies and generator progress separates received from verified',async()=>{
  const gate=deferred();let opts;const d=setup(async(_profile,options)=>{opts=options;return gate.promise;});await act(d.get('prepare-generator'));
  opts.onProgress(progress('generator',1000,0));assert.match(d.get('asset-preparation-status').textContent,/1,000 decoded body bytes received; 0/);assert.equal(d.get('asset-preparation-progress').value,0);
  await act(d.get('cancel-preparation'));assert.ok(opts.signal.aborted);gate.resolve(receipt('generator'));await act(d.get('prepare-encoder'));await act(d.get('cancel-preparation'));
});
test('cancel A then explicit retry B cannot publish late A receipt/progress',async()=>{
  const a=deferred(),b=deferred(),calls=[];const d=setup((profile,options)=>{calls.push({profile,options});return calls.length===1?a.promise:b.promise;});
  await act(d.get('prepare-encoder'));await act(d.get('cancel-preparation'));assert.ok(calls[0].options.signal.aborted);await act(d.get('prepare-generator'));
  calls[0].options.onProgress(progress('encoder',650));a.resolve(receipt('encoder'));await act(d.get('prepare-generator'));assert.equal(byTag(d.get('asset-preparation-receipt'),'details').length,0);
  b.resolve(receipt('generator'));await act(d.get('prepare-generator'));assert.match(d.get('asset-preparation-status').textContent,/Generator static cache verification complete/);
});
for(const state of [{source:{},documentEpoch:1,active:false},{source:null,documentEpoch:0,active:true},{source:null,documentEpoch:2,active:false}]){
  test(`source/core render revokes in-flight work ${JSON.stringify(state)}`,async()=>{
    const gate=deferred();let opts;const d=setup((_profile,options)=>{opts=options;return gate.promise;});await act(d.get('prepare-encoder'));d.view.render(state);assert.ok(opts.signal.aborted);gate.resolve(receipt());await act(d.get('cancel-preparation'));assert.equal(byTag(d.get('asset-preparation-receipt'),'details').length,0);assert.equal(d.get('prepare-encoder').disabled,state.active);
  });
}
test('clear/main action revokes detached disclosure and fresh mount never inherits a receipt',async()=>{
  const d=setup(async()=>receipt());await act(d.get('prepare-encoder'));const detail=byTag(d.get('asset-preparation-receipt'),'details')[0];d.view.revoke();detail.open=true;await act(detail,'toggle');assert.equal(byTag(detail,'pre').length,0);const other=setup(async()=>receipt());assert.equal(byTag(other.get('asset-preparation-receipt'),'details').length,0);
});
test('abort callback cannot start retry beneath revocation or overwrite a newer core render',async()=>{
  const gate=deferred();let calls=0,options;const d=setup((_profile,opts)=>{calls++;options=opts;return gate.promise;});await act(d.get('prepare-encoder'));
  options.signal.addEventListener('abort',()=>{d.get('prepare-generator').dispatch('click');d.view.render({source:null,documentEpoch:9,active:true});});
  d.view.render({source:null,documentEpoch:1,active:false});assert.equal(calls,1);assert.equal(d.get('prepare-generator').disabled,true);
  gate.resolve(receipt());await act(d.get('cancel-preparation'));assert.equal(byTag(d.get('asset-preparation-receipt'),'details').length,0);
});
test('bad receipt or private failure produces only fixed refusal and enables explicit retry',async()=>{
  for(const prepare of [async()=>{throw Error('PRIVATE');},async()=>({...receipt(),modelId:'PRIVATE'})]){
    const d=setup(prepare);await act(d.get('prepare-encoder'));assert.doesNotMatch(d.root.textContent,/PRIVATE/);assert.equal(d.get('prepare-encoder').disabled,false);assert.equal(byTag(d.get('asset-preparation-receipt'),'details').length,0);
  }
});
test('transport selection is explicit, defaults to site and changing A to B revokes before cleanup',async()=>{
  const a=deferred(),b=deferred(),calls=[],d=setup((profile,options)=>{calls.push(options);return calls.length===1?a.promise:b.promise;});
  assert.equal(d.get('asset-preparation-transport').value,'site');await act(d.get('prepare-encoder'));assert.equal(calls[0].transport,'site');
  d.get('asset-preparation-transport').value='huggingface';await act(d.get('asset-preparation-transport'),'change');assert.ok(calls[0].signal.aborted);
  await act(d.get('prepare-generator'));assert.equal(calls[1].transport,'huggingface');a.resolve(receipt());await act(d.get('asset-preparation-transport'),'blur');assert.equal(byTag(d.get('asset-preparation-receipt'),'details').length,0);
  b.resolve(receipt('generator','huggingface'));await act(d.get('asset-preparation-transport'),'blur');assert.match(d.get('asset-preparation-status').textContent,/Generator static cache verification complete/);
  const detail=byTag(d.get('asset-preparation-receipt'),'details')[0];d.get('asset-preparation-transport').value='site';await act(d.get('asset-preparation-transport'),'input');detail.open=true;await act(detail,'toggle');assert.equal(byTag(detail,'pre').length,0);assert.match(d.get('asset-preparation-status').textContent,/source changed/);
});
test('an otherwise valid site receipt cannot satisfy an explicitly selected HF action',async()=>{
  const d=setup(async()=>receipt());d.get('asset-preparation-transport').value='huggingface';await act(d.get('prepare-encoder'));assert.equal(byTag(d.get('asset-preparation-receipt'),'details').length,0);assert.match(d.get('asset-preparation-status').textContent,/WORKER_PROTOCOL_ERROR/);
});
test('typed HF failure has a lazy separate redacted observation, cleared by edits; timeout invents none',async()=>{
  const base=new URL('../',import.meta.url).href,item=preparationTransportPlan('encoder',base).models[0];let diagnostic;
  try{validatePreparationPhysicalMetadata({responseType:'cors',status:200,finalUrl:'https://unapproved.test/body?Signature=PRIVATE',redirected:true,
    headers:{'content-type':null,'content-length':null,'content-encoding':null,etag:null,'cache-control':null}},'encoder',item.logicalUrl,base);}catch(error){diagnostic=error.transportFailure;}
  const d=setup(async()=>{throw new AssetPreparationError('ASSET_TRANSPORT_REFUSED',diagnostic);});d.get('asset-preparation-transport').value='huggingface';await act(d.get('prepare-encoder'));
  const detail=byTag(d.get('asset-preparation-receipt'),'details')[0];assert.match(detail.textContent,/Incomplete transport observation/);assert.equal(byTag(detail,'pre').length,0);detail.open=true;await act(detail,'toggle');assert.equal(JSON.parse(byTag(detail,'pre')[0].textContent).status,'incomplete-transport-observation-not-verified');assert.doesNotMatch(d.root.textContent,/PRIVATE|Signature/);
  d.view.revoke();await act(detail,'toggle');assert.equal(byTag(detail,'pre').length,0);
  const timeout=setup(async()=>{throw new AssetPreparationError('ASSET_PREPARATION_TIMEOUT');});await act(timeout.get('prepare-generator'));assert.equal(byTag(timeout.get('asset-preparation-receipt'),'details').length,0);
});
