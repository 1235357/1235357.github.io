import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {preparationTransportPlan,createPreparationTransport,validatePreparationPhysicalMetadata,
  validatePreparationPhysicalResponse,copyTransportFailure,copyExternalReads,normalizePreparationBody,AssetTransportError} from '../asset-preparation-transport.mjs';
import {verifyAssetResponse} from '../verified-stream.mjs';
const base='https://reader.test/project/browser-rag/';
const sha=value=>createHash('sha256').update(value).digest('hex');
const observedHeaders=overrides=>({'content-type':'application/json','content-length':null,'content-encoding':null,etag:null,'cache-control':null,...overrides});
const model=(profile='encoder',index=0)=>preparationTransportPlan(profile,base).models[index];
const metadata=(profile='encoder',index=0,overrides={})=>({responseType:'cors',status:200,finalUrl:model(profile,index).requestedUrl,redirected:false,headers:observedHeaders(),...overrides});
const observe=(profile='encoder',index=0,overrides={})=>validatePreparationPhysicalMetadata(metadata(profile,index,overrides),profile,model(profile,index).logicalUrl,base);
const safe=error=>{assert.ok(error instanceof AssetTransportError);assert.equal(error.code,'ASSET_TRANSPORT_REFUSED');assert.doesNotMatch(error.message,/PRIVATE|Signature/);assert.equal(error.cause,undefined);return true;};
// Pure metadata/body controls establish no browser CORS/provider availability.
test('preparation transport owns exactly five immutable external model mappings per profile',()=>{
  for(const profile of ['encoder','generator']){
    const plan=preparationTransportPlan(profile,base);
    assert.equal(plan.models.length,5);assert.equal(plan.passthrough.length,4);
    assert.ok(plan.models.every(item=>/^https:\/\/huggingface.co\/[^?]+\/resolve\/[a-f0-9]{40}\//.test(item.requestedUrl)));
    assert.ok(plan.models.every(item=>item.logicalUrl.startsWith('https://reader.test/project/browser-rag/models/')));
  }
});
test('default site transport and HF runtime/registry routes use only logical site URLs',async()=>{
  for(const profile of ['encoder','generator'])for(const choice of ['site','huggingface']){
    const calls=[],transport=createPreparationTransport(profile,choice,{baseURL:base,fetch:async(url,options)=>{calls.push({url,options});return new Response('site');}});
    for(const url of preparationTransportPlan(profile,base).passthrough)await transport.fetch(url);
    if(choice==='site')for(const asset of preparationTransportPlan(profile,base).models)await transport.fetch(asset.logicalUrl);
    assert.ok(calls.every(call=>call.url.startsWith(base)&&call.options.redirect==='error'&&call.options.credentials==='omit'));
    assert.deepEqual(transport.externalReads(),[]);assert.equal(transport.transportFailure(),null);
  }
});
test('HF uses exact immutable requested URLs and credential/referrer omission without fallback',async()=>{
  for(const profile of ['encoder','generator']){
    const calls=[],transport=createPreparationTransport(profile,'huggingface',{baseURL:base,fetch:async(url,options)=>{calls.push({url,options});throw Error('PRIVATE signed URL');}});
    for(const item of preparationTransportPlan(profile,base).models)await assert.rejects(transport.fetch(item.logicalUrl),safe);
    assert.deepEqual(calls.map(call=>call.url),preparationTransportPlan(profile,base).models.map(item=>item.requestedUrl));
    assert.ok(calls.every(call=>call.options.mode==='cors'&&call.options.redirect==='follow'&&call.options.credentials==='omit'&&call.options.referrerPolicy==='no-referrer'));
    assert.deepEqual(transport.externalReads(),[]);assert.equal(transport.transportFailure(),null);
  }
});
test('unknown enum/profile/options and getters are refused before fetch',async()=>{
  let reads=0,calls=0;const fetch=async()=>{calls++;throw Error('PRIVATE');};
  for(const choice of ['auto','https://huggingface.co',null])assert.throws(()=>createPreparationTransport('encoder',choice,{baseURL:base,fetch}),safe);
  assert.throws(()=>createPreparationTransport('unknown','site',{baseURL:base,fetch}),safe);
  for(const key of ['fetch','context']){const options={baseURL:base};Object.defineProperty(options,key,{get(){reads++;},enumerable:true});assert.throws(()=>createPreparationTransport('encoder','site',options),safe);}
  const transport=createPreparationTransport('encoder','huggingface',{baseURL:base,fetch});
  for(const key of ['signal','context']){const request={};Object.defineProperty(request,key,{get(){reads++;},enumerable:true});await assert.rejects(transport.fetch(model().logicalUrl,request),safe);}
  assert.equal(reads,0);assert.equal(calls,0);
});
for(const altered of [url=>url+'?x=1',url=>url+'#x',url=>url.replace('751bff','main00'),url=>url.replace('config.json','unknown.json'),url=>url.replace('reader.test','other.test'),url=>url.replace('reader.test','reader.test:444'),url=>url.replace('https://','https://user@')]){
  test(`altered logical route refuses before network: ${altered.toString()}`,async()=>{let calls=0;const transport=createPreparationTransport('encoder','huggingface',{baseURL:base,fetch:async()=>{calls++;}});await assert.rejects(transport.fetch(altered(model().logicalUrl)),safe);assert.equal(calls,0);});
}
test('exact HF resolve/cache paths and narrow CAS policy copy no signed queries',()=>{
  for(const profile of ['encoder','generator'])for(let index=0;index<5;index++){
    const item=model(profile,index),resolve=observe(profile,index);
    const cache=observe(profile,index,{finalUrl:`https://huggingface.co/api/resolve-cache/models/${new URL(item.requestedUrl).pathname.replace('/resolve/','/').slice(1)}`,redirected:true});
    const signedUrl=`https://cas-bridge.xethub.hf.co/xet-bridge-us/${'a'.repeat(24)}/${'b'.repeat(64)}?Signature=PRIVATE`,signed=observe(profile,index,{finalUrl:signedUrl,redirected:true});
    for(const value of [resolve,cache,signed]){assert.deepEqual(copyTransportFailure(value,profile,base),value);assert.equal(value.policyAccepted,true);assert.ok(Object.isFrozen(value.headers));}
    assert.equal(signed.queryPresent,true);assert.equal(signed.finalUrlSha256,sha(signedUrl));assert.doesNotMatch(JSON.stringify(signed),/Signature|PRIVATE|\?/);
  }
});
for(const finalUrl of ['http://huggingface.co/','https://huggingface.co.evil.test/','https://cdn-lfs.huggingface.co/asset',
  'https://cas-bridge.xethub.hf.co:444/xet-bridge-us/'+'a'.repeat(24)+'/'+'b'.repeat(64),
  'https://cas-bridge.xethub.hf.co/xet-bridge-us/'+'A'.repeat(24)+'/'+'b'.repeat(64),
  'https://cas-bridge.xethub.hf.co/xet-bridge-us/'+'a'.repeat(23)+'/'+'b'.repeat(64),
  'https://cas-bridge.xethub.hf.co/xet-bridge-us/'+'a'.repeat(24)+'/'+'b'.repeat(64)+'/extra',
  'https://huggingface.co/user/repo/resolve/main/config.json',model('generator').requestedUrl,
  model().requestedUrl+'#x',model().requestedUrl.replace('https://','https://user@'),model().requestedUrl.replace('config.json','%63onfig.json'),model().requestedUrl+'?'+'x'.repeat(8192)]){
  test(`unapproved final URL refuses: ${finalUrl.slice(0,80)}`,()=>assert.throws(()=>observe('encoder',0,{finalUrl}),safe));
}
for(const changes of [{status:206},{status:404},{responseType:'opaque'},{responseType:'opaqueredirect'},{responseType:'error'},
  {headers:observedHeaders({'content-encoding':'compress'})},{headers:observedHeaders({'content-encoding':'gzip,'})},{headers:observedHeaders({'content-encoding':'gzip, identity'})},
  {headers:observedHeaders({'content-length':'01'})},{headers:observedHeaders({'content-length':'9007199254740992'})},{headers:observedHeaders({etag:'PRIVATE\nline'})}]){
  test(`physical metadata refuses safely: ${JSON.stringify(changes)}`,()=>assert.throws(()=>observe('encoder',0,changes),safe));
}
test('native response brand/shadows/status/used/locked/absent bodies refuse and cancel unread owned bodies',async()=>{
  let cancelled=0,reads=0;const response=new Response(new ReadableStream({cancel(){cancelled++;}}));Object.defineProperty(response,'url',{get(){reads++;throw Error('PRIVATE');}});
  assert.throws(()=>validatePreparationPhysicalResponse(response,'encoder',model().logicalUrl,base),safe);await Promise.resolve();assert.equal(reads,0);assert.equal(cancelled,1);
  for(const response of [{status:200},Object.create(Response.prototype),new Response(null),new Response('x',{status:404}),await fetch('data:text/plain,x')])assert.throws(()=>validatePreparationPhysicalResponse(response,'encoder',model().logicalUrl,base),safe);
  const used=new Response('x');await used.text();assert.throws(()=>validatePreparationPhysicalResponse(used,'encoder',model().logicalUrl,base),safe);
  const locked=new Response('x'),reader=locked.body.getReader();assert.throws(()=>validatePreparationPhysicalResponse(locked,'encoder',model().logicalUrl,base),safe);await reader.cancel();reader.releaseLock();
});
test('refused observation is separate and redacted; failure before headers invents none',async()=>{
  let diagnostic;try{validatePreparationPhysicalMetadata(metadata('encoder',0,{finalUrl:model().requestedUrl+'#bad'}),'encoder',model().logicalUrl,base);}catch(error){diagnostic=error.transportFailure;}
  assert.equal(diagnostic.policyAccepted,false);assert.doesNotMatch(JSON.stringify(diagnostic),/#bad/);assert.deepEqual(copyTransportFailure(diagnostic,'encoder',base),diagnostic);
  const transport=createPreparationTransport('encoder','huggingface',{baseURL:base,fetch:async()=>{throw Error('PRIVATE');}});await assert.rejects(transport.fetch(model().logicalUrl),safe);assert.equal(transport.transportFailure(),null);
});
test('HF model observations reconcile with whole-body runtime subset; site has none',()=>{
  for(const profile of ['encoder','generator']){
    const plan=preparationTransportPlan(profile,base),readings=[observe(profile,1),observe(profile,4)],modelBytes=plan.models[1].bytes+plan.models[4].bytes;
    assert.deepEqual(copyExternalReads(readings,profile,'huggingface',modelBytes+22528676,base),readings);assert.deepEqual(copyExternalReads([],profile,'huggingface',0,base),[]);assert.deepEqual(copyExternalReads([],profile,'site',profile==='encoder'?113629084:815725938,base),[]);
    for(const [raw,bytes]of [[readings,modelBytes-1],[readings,modelBytes+1],[[readings[1],readings[0]],modelBytes],[[readings[0],readings[0]],modelBytes],[[{...readings[0],policyAccepted:false}],plan.models[1].bytes]])assert.throws(()=>copyExternalReads(raw,profile,'huggingface',bytes,base),safe);
    assert.throws(()=>copyExternalReads(readings,profile,'site',modelBytes,base),safe);
  }
});
test('record copier refuses extra fields/getters/holes/changed identity/unsigned hash tampering',()=>{
  let reads=0;const value=observe(),getter={...value};Object.defineProperty(getter,'headers',{get(){reads++;},enumerable:true});
  for(const raw of [getter,{...value,secret:'PRIVATE'},{...value,requestedUrl:model('generator').requestedUrl},{...value,status:206},{...value,finalUrlSha256:'a'.repeat(64)},{...value,finalPath:value.finalPath+'?Signature=PRIVATE'}])assert.throws(()=>copyTransportFailure(raw,'encoder',base),safe);
  assert.throws(()=>copyExternalReads(Array(1),'encoder','huggingface',650,base),safe);assert.equal(reads,0);
});
for(const encoding of [null,'gzip','br','deflate','gzip, br'])test(`decoded EOF/SHA stays exact while physical CL/CE omitted: ${encoding}`,async()=>{
  const observation=observe('encoder',0,{headers:observedHeaders({'content-length':'2','content-encoding':encoding})});assert.equal(observation.headers['content-length'],'2');
  const response=normalizePreparationBody(new Response('abc').body);assert.equal(response.headers.get('content-length'),null);assert.equal(response.headers.get('content-encoding'),null);assert.equal(response.redirected,false);assert.equal(response.url,'');
  const verified=verifyAssetResponse(response,{url:model().logicalUrl,bytes:3,sha256:sha('abc')});assert.equal(await verified.response.text(),'abc');assert.deepEqual(await verified.completion,{bytes:3,sha256:sha('abc')});
});
for(const body of ['ab','abcd','abd'])test(`decoded short/long/same-length corruption refuses: ${body}`,async()=>{
  const verified=verifyAssetResponse(normalizePreparationBody(new Response(body).body),{url:model().logicalUrl,bytes:3,sha256:sha('abc')});await assert.rejects(verified.response.text(),error=>error.code==='ASSET_INTEGRITY_ERROR');await assert.rejects(verified.completion,error=>error.code==='ASSET_INTEGRITY_ERROR');
});
test('decoded stream read failure and cancellation cannot earn verification',async()=>{
  const verified=verifyAssetResponse(normalizePreparationBody(new ReadableStream({pull(){throw Error('PRIVATE read');}})),{url:model().logicalUrl,bytes:3,sha256:sha('abc')});await assert.rejects(verified.response.text(),error=>error.code==='ASSET_INTEGRITY_ERROR');await assert.rejects(verified.completion,error=>error.code==='ASSET_INTEGRITY_ERROR');
  const controller=new AbortController();controller.abort();const cancelled=verifyAssetResponse(normalizePreparationBody(new Response('abc').body),{url:model().logicalUrl,bytes:3,sha256:sha('abc')},{signal:controller.signal});await assert.rejects(cancelled.response.text(),error=>error.code==='ABORTED');await assert.rejects(cancelled.completion,error=>error.code==='ABORTED');
});
