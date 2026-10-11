import {sha256} from './vendor/noble-hashes/sha2.js';
import {EMBEDDING_PREPARATION_PINS} from './embedding-runtime.mjs';
import {GENERATOR_PREPARATION_PINS} from './generator-native-core.mjs';

const PROFILES=Object.freeze({
  encoder:Object.freeze({modelId:'Xenova/all-MiniLM-L6-v2',revision:'751bff37182d3f1213fa05d7196b954e230abad9',pins:EMBEDDING_PREPARATION_PINS}),
  generator:Object.freeze({modelId:'onnx-community/Qwen2.5-0.5B-Instruct',revision:'22942cb7d7ba4cc81bb4673549ca4d4614469b5e',pins:GENERATOR_PREPARATION_PINS}),
});
const HEADERS=Object.freeze(['content-type','content-length','content-encoding','etag','cache-control']);
const OBSERVATION_KEYS=['logicalUrl','requestedUrl','finalOrigin','finalPath','finalUrlSha256','queryPresent','redirected','responseType','status','headers','policyAccepted'];
const RESPONSE_FIELDS=['type','status','url','redirected','bodyUsed','body','headers'];
const getters=Object.fromEntries(RESPONSE_FIELDS.map(key=>[key,Object.getOwnPropertyDescriptor(Response.prototype,key).get]));
const nativeHeader=Headers.prototype.get,streamLocked=Object.getOwnPropertyDescriptor(ReadableStream.prototype,'locked').get;
const streamCancel=ReadableStream.prototype.cancel;
const signalAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const rootURL=new URL('./',import.meta.url).href;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const digest=value=>Array.from(sha256(new TextEncoder().encode(value)),byte=>byte.toString(16).padStart(2,'0')).join('');
export class AssetTransportError extends Error {
  constructor(transportFailure=null){super('The explicit static asset transport was refused.');this.name='AssetTransportError';this.code='ASSET_TRANSPORT_REFUSED';this.transportFailure=transportFailure;}
}
const fail=diagnostic=>{throw new AssetTransportError(diagnostic??null);};
function data(raw,keys){
  if(raw===null||typeof raw!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))fail();
  const actual=Reflect.ownKeys(raw);if(actual.length!==keys.length||actual.some(key=>!keys.includes(key)))fail();
  const result={};for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(raw,key);if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail();result[key]=descriptor.value;}return result;
}
export function preparationTransport(value){if(value!=='site'&&value!=='huggingface')fail();return value;}
export function preparationTransportPlan(profile,baseURL=rootURL){
  if(typeof profile!=='string'||!Object.hasOwn(PROFILES,profile))fail();
  const base=new URL(baseURL);if(base.href!==baseURL||base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/')
    ||(!['http:','https:'].includes(base.protocol)&&baseURL!==rootURL))fail();
  const spec=PROFILES[profile],names=Object.keys(spec.pins),models=names.slice(0,5).map(name=>Object.freeze({
    logicalUrl:new URL(`models/${spec.revision}/${spec.modelId}/${name}`,base).href,
    requestedUrl:`https://huggingface.co/${spec.modelId}/resolve/${spec.revision}/${name}`,...spec.pins[name],
  }));
  return Object.freeze({models:Object.freeze(models),passthrough:Object.freeze([
    new URL(profile==='encoder'?'embedding-assets.json':'acceptance/generator-probe-assets.json',base).href,
    ...names.slice(5).map(name=>new URL(`vendor/transformers/${name}`,base).href),
  ])});
}
function route(profile,logicalUrl,baseURL){const found=preparationTransportPlan(profile,baseURL).models.find(value=>value.logicalUrl===logicalUrl);if(!found)fail();return found;}
function headers(raw){
  const value=data(raw,HEADERS);for(const entry of Object.values(value))if(entry!==null&&(typeof entry!=='string'||entry.length>2048||/[\r\n\0]/.test(entry)))fail();
  const length=value['content-length'];if(length!==null&&(!/^(0|[1-9]\d*)$/.test(length)||!integer(Number(length))))fail();
  const encoding=value['content-encoding'];if(encoding!==null&&encoding.trim().toLowerCase()!=='identity'
    &&encoding.toLowerCase().split(',').some(item=>!['gzip','br','deflate'].includes(item.trim())))fail();
  return Object.freeze(value);
}
function approvedPath(origin,path,requestedUrl){
  if(origin==='https://huggingface.co'){
    const requested=new URL(requestedUrl).pathname;
    return path===requested||path===`/api/resolve-cache/models/${requested.replace('/resolve/','/').slice(1)}`;
  }
  // Exact observed CDN compatibility, backed by the official HF hostname list.
  // Physical route acceptance still precedes unchanged full-body pin checking.
  return (origin==='https://cas-bridge.xethub.hf.co'||origin==='https://us.aws.cdn.hf.co')
    &&/^\/xet-bridge-us\/[a-f0-9]{24}\/[a-f0-9]{64}$/.test(path);
}
export function validatePreparationPhysicalMetadata(raw,profile,logicalUrl,baseURL=rootURL){
  const mapping=route(profile,logicalUrl,baseURL),value=data(raw,['responseType','status','finalUrl','redirected','headers']);
  if(typeof value.finalUrl!=='string'||value.finalUrl.length>8192||typeof value.redirected!=='boolean')fail();
  let url;try{url=new URL(value.finalUrl);}catch{fail();}
  const observation=Object.freeze({logicalUrl,requestedUrl:mapping.requestedUrl,finalOrigin:url.origin,finalPath:url.pathname,
    finalUrlSha256:digest(value.finalUrl),queryPresent:value.finalUrl.split('#',1)[0].includes('?'),redirected:value.redirected,
    responseType:value.responseType,status:value.status,headers:headers(value.headers),policyAccepted:false});
  if(url.href!==value.finalUrl||url.protocol!=='https:'||url.username||url.password||url.port||value.finalUrl.includes('#')
    ||!['cors','basic'].includes(value.responseType)||value.status!==200||url.pathname.length>512
    ||!approvedPath(url.origin,url.pathname,mapping.requestedUrl))fail(observation);
  return Object.freeze({...observation,policyAccepted:true});
}
export function copyTransportFailure(raw,profile,baseURL=rootURL){
  if(raw===null)return null;const value=data(raw,OBSERVATION_KEYS),mapping=route(profile,value.logicalUrl,baseURL);
  if(value.requestedUrl!==mapping.requestedUrl||typeof value.finalOrigin!=='string'||value.finalOrigin.length>128
    ||typeof value.finalPath!=='string'||value.finalPath.length>512||value.finalPath.includes('?')||value.finalPath.includes('#')
    ||typeof value.finalUrlSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.finalUrlSha256)
    ||typeof value.queryPresent!=='boolean'||typeof value.redirected!=='boolean'||typeof value.policyAccepted!=='boolean'
    ||!['cors','basic','default','opaque','opaqueredirect','error'].includes(value.responseType)||!integer(value.status)||value.status>599)fail();
  const origin=new URL(value.finalOrigin);if(origin.origin!==value.finalOrigin||origin.username||origin.password||!value.finalPath.startsWith('/'))fail();
  if(value.policyAccepted&&(value.status!==200||!['cors','basic'].includes(value.responseType)||!approvedPath(value.finalOrigin,value.finalPath,value.requestedUrl)))fail();
  if(value.policyAccepted&&!value.queryPresent&&value.finalUrlSha256!==digest(value.finalOrigin+value.finalPath))fail();
  return Object.freeze({...value,headers:headers(value.headers)});
}
export function copyExternalReads(raw,profile,transport,networkBytes,baseURL=rootURL){
  preparationTransport(transport);
  if(!Array.isArray(raw)||Object.getPrototypeOf(raw)!==Array.prototype||raw.length>5||Reflect.ownKeys(raw).length!==raw.length+1||!integer(networkBytes))fail();
  if(transport==='site'&&raw.length!==0)fail();const plan=preparationTransportPlan(profile,baseURL),result=[];let lastIndex=-1,total=0;
  if(networkBytes>Object.values(PROFILES[profile].pins).reduce((sum,pin)=>sum+pin.bytes,0))fail();
  for(let index=0;index<raw.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(raw,String(index));if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail();
    const value=copyTransportFailure(descriptor.value,profile,baseURL),modelIndex=plan.models.findIndex(item=>item.logicalUrl===value?.logicalUrl);
    if(!value?.policyAccepted||modelIndex<=lastIndex)fail();lastIndex=modelIndex;total+=plan.models[modelIndex].bytes;result.push(value);
  }
  if(transport==='huggingface'){
    const runtime=Object.values(PROFILES[profile].pins).slice(5).map(pin=>pin.bytes),remaining=networkBytes-total;
    if(remaining<0||!Array.from({length:8},(_,mask)=>runtime.reduce((sum,bytes,index)=>sum+((mask>>index)&1?bytes:0),0)).includes(remaining))fail();
  }
  return Object.freeze(result);
}
export function normalizePreparationBody(body){return new Response(body,{status:200});}
function cancel(response){try{const body=getters.body.call(response);if(body)Promise.resolve(streamCancel.call(body)).catch(()=>{});}catch{}}
export function validatePreparationPhysicalResponse(response,profile,logicalUrl,baseURL=rootURL){
  try{
    if(!(response instanceof Response)||RESPONSE_FIELDS.some(key=>Object.hasOwn(response,key)))fail();
    const captured=Object.fromEntries(RESPONSE_FIELDS.map(key=>[key,getters[key].call(response)]));
    if(captured.bodyUsed||!captured.body||streamLocked.call(captured.body))fail();
    const observed=Object.fromEntries(HEADERS.map(name=>[name,nativeHeader.call(captured.headers,name)]));
    const observation=validatePreparationPhysicalMetadata({responseType:captured.type,status:captured.status,finalUrl:captured.url,
      redirected:captured.redirected,headers:observed},profile,logicalUrl,baseURL);
    return Object.freeze({response:normalizePreparationBody(captured.body),observation});
  }catch(error){cancel(response);if(error instanceof AssetTransportError)throw error;fail();}
}
export function createPreparationTransport(profile,transport='site',options={}){
  preparationTransport(transport);let baseURL,fetch;
  try{
    if(options===null||typeof options!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(options))||Reflect.ownKeys(options).some(key=>!['baseURL','fetch'].includes(key)))fail();
    const own={};for(const key of Reflect.ownKeys(options)){const descriptor=Object.getOwnPropertyDescriptor(options,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))fail();own[key]=descriptor.value;}
    baseURL=own.baseURL??rootURL;fetch=own.fetch??globalThis.fetch?.bind(globalThis);if(typeof fetch!=='function')fail();
  }catch{fail();}
  const plan=preparationTransportPlan(profile,baseURL),readings=[],requested=new Set();let failure=null;
  return Object.freeze({
    async fetch(logicalUrl,request){
      failure=null;
      const own={};
      if(request!==undefined){
        if(request===null||typeof request!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(request))
          ||Reflect.ownKeys(request).some(key=>!['redirect','credentials','signal'].includes(key)))fail();
        for(const key of Reflect.ownKeys(request)){const descriptor=Object.getOwnPropertyDescriptor(request,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))fail();own[key]=descriptor.value;}
      }
      const signal=own.signal;
      if((own.redirect!==undefined&&own.redirect!=='error')||(own.credentials!==undefined&&own.credentials!=='omit'))fail();
      if(signal!==undefined)try{if(!(signal instanceof AbortSignal)||signalAborted.call(signal))fail();}catch{fail();}
      const model=plan.models.find(item=>item.logicalUrl===logicalUrl);
      if(!model&&!plan.passthrough.includes(logicalUrl))fail();
      if(transport==='site'||!model)return fetch(logicalUrl,{redirect:'error',credentials:'omit',signal});
      if(requested.has(logicalUrl))fail();requested.add(logicalUrl);
      let physical;try{
        physical=await fetch(model.requestedUrl,{mode:'cors',redirect:'follow',credentials:'omit',referrerPolicy:'no-referrer',signal});
        if(signal&&signalAborted.call(signal)){cancel(physical);fail();}
        const accepted=validatePreparationPhysicalResponse(physical,profile,logicalUrl,baseURL);readings.push(accepted.observation);return accepted.response;
      }catch(error){cancel(physical);if(error instanceof AssetTransportError){failure=error.transportFailure;throw error;}fail();}
    },
    externalReads:()=>Object.freeze([...readings]),
    // A previous accepted response is not evidence about a later failed request.
    // Body/hash/cache failures remain loader failures with no invented transport
    // observation; only a refused physical response earns this diagnostic.
    transportFailure:()=>failure,
  });
}
