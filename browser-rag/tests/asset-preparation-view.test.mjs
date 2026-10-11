import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetPreparationView} from '../asset-preparation-view.mjs';
import {dom,nodes,byTag,deferred,act} from './pdf-app-dom-fixture.mjs';
import {receipt,progress} from './asset-preparation-fixture.mjs';
const setup=prepare=>{const d=dom(),view=createAssetPreparationView({document:d.document,root:d.root,prepare,runtimeIdFactory:()=> 'prep-view'});view.render({source:null,documentEpoch:0,active:false});return {...d,view,get:id=>nodes(d.root).find(node=>node.id===id)};};
test('mount performs no preparation; explicit profile action sends identity only and lazily discloses exact receipt',async()=>{
  let calls=0,forwarded;const d=setup(async(profile,options)=>{calls++;forwarded={profile,options};options.onProgress(progress(profile,650));options.onProgress(progress(profile,receipt(profile).verifiedBytes));return receipt(profile);});
  assert.equal(calls,0);assert.match(d.root.textContent,/113.63 MB/);assert.match(d.root.textContent,/815.73 MB/);assert.match(d.root.textContent,/30-minute/);
  await act(d.get('prepare-encoder'));assert.equal(calls,1);assert.deepEqual(Object.keys(forwarded.options),['identity','signal','onProgress']);assert.equal(forwarded.profile,'encoder');assert.equal(forwarded.options.identity.documentEpoch,0);
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
