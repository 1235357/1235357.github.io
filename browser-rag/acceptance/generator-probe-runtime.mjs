import { prepareVerifiedAssetCache } from '../verified-cache.mjs';
import { preflightGeneration, inspectGeneratedSequence } from '../generator-contract.mjs';

export const PROBE_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
export const PROBE_REVISION = '22942cb7d7ba4cc81bb4673549ca4d4614469b5e';
export const PROBE_IDS = Object.freeze([151644,8948,198,2610,525,264,10950,17847,13,151645,198,151644,872,198,45764,23811,26753,323,6286,419,374,264,1602,2613,2205,1273,13,151645,198,151644,77091,198]);
export const PROBE_STAGES = Object.freeze(['adapter','assets','sdk','tokenizer','model','generate','reads','cleanup']);
export const PROBE_MESSAGES = Object.freeze({
  INVALID_PROBE_CONFIG:'The local diagnostic configuration is invalid.',
  ASSET_INTEGRITY_ERROR:'The pinned local assets could not be verified.',
  ASSET_CACHE_ERROR:'The verified asset cache operation failed.',
  GPU_UNAVAILABLE:'A non-fallback WebGPU adapter and owned device are required.',
  GPU_DEVICE_LOST:'The owned WebGPU device was lost.',
  GPU_UNCAPTURED_ERROR:'The owned WebGPU device reported an uncaptured error.',
  TOKENIZER_MISMATCH:'The fixed diagnostic token frame did not match.',
  MODEL_LOAD_FAILED:'The pinned local generator could not be loaded.',
  GENERATION_FAILED:'The local diagnostic generation failed.',
  INVALID_GENERATION_OUTPUT:'The local diagnostic output was invalid.',
  ABORTED:'The local diagnostic was cancelled.',
  WORKER_PROTOCOL_ERROR:'The diagnostic worker channel was invalid.',
  WORKER_UNAVAILABLE:'A native diagnostic worker is unavailable.',
  PROBE_TIMEOUT:'The diagnostic worker exceeded its time budget.',
});
export class ProbeError extends Error {
  constructor(code) { const safe=Object.hasOwn(PROBE_MESSAGES,code)?code:'GENERATION_FAILED';super(PROBE_MESSAGES[safe]);this.name='ProbeError';this.code=safe; }
}
const fail=code=>{throw new ProbeError(code);};
const record=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>record(value)&&Reflect.ownKeys(value).length===keys.length&&Reflect.ownKeys(value).every(key=>keys.includes(key));
const dense=(value,length)=>Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length===length
  &&Reflect.ownKeys(value).length===length+1&&Array.from({length},(_,i)=>Object.hasOwn(value,i)).every(Boolean);
const elapsed=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=300000;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const quiet=task=>{try {Promise.resolve(task()).catch(()=>{});}catch {}};
// Traverse only the fixed canonical shape. Array lengths and exact record
// keys are checked before values, so alternative valid budgets cannot be
// accepted and then silently rewritten in the projected runtime receipt.
function sameCanonical(value,expected) {
  if(expected===null||typeof expected!=='object')return Object.is(value,expected);
  if(Array.isArray(expected))return dense(value,expected.length)&&expected.every((item,index)=>sameCanonical(value[index],item));
  const keys=Object.keys(expected);
  return exact(value,keys)&&keys.every(key=>sameCanonical(value[key],expected[key]));
}
const MODEL_PINS=Object.freeze({
  'config.json':Object.freeze({bytes:678,sha256:'777e01f0fbb3346eb229cb6fb278ed6533c1e4dcb9ebf4bed0f6e94ef17fa1b5'}),
  'tokenizer.json':Object.freeze({bytes:7031673,sha256:'a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf'}),
  'tokenizer_config.json':Object.freeze({bytes:7849,sha256:'6a14243f0ae04884e597b3f032c05e15de9f417318fdcac24ab4e2680e691430'}),
  'generation_config.json':Object.freeze({bytes:242,sha256:'f7e7ce458658b2d40d9eb213b91b77a8bf698845ab89360976722d7ac46928a3'}),
  'onnx/model_q4.onnx':Object.freeze({bytes:786156820,sha256:'09235a3b1c135cd04ef570e5053b5c079e028078a2cc5f76ba6a251e91bf3296'}),
});
const RUNTIME_PINS=Object.freeze({
  'transformers.min.js':Object.freeze({bytes:888173,sha256:'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa'}),
  'ort-wasm-simd-threaded.jsep.mjs':Object.freeze({bytes:44484,sha256:'08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9'}),
  'ort-wasm-simd-threaded.jsep.wasm':Object.freeze({bytes:21596019,sha256:'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'}),
});
export const PROBE_ASSET_BYTES=Object.values({...MODEL_PINS,...RUNTIME_PINS}).reduce((total,pin)=>total+pin.bytes,0);
const ASSET_SIZES=Object.freeze(Object.values({...MODEL_PINS,...RUNTIME_PINS}).map(pin=>pin.bytes));
export const PROBE_MAX_PACKETS=4096;

export function copyProbeByteProgress(value) {
  try {
    if(!exact(value,['stage','assetIndex','receivedBytes','verifiedBytes','totalBytes','elapsedMs'])
      ||!['prepare','consume'].includes(value.stage)||!integer(value.assetIndex,0,7)
      ||value.totalBytes!==ASSET_SIZES[value.assetIndex]||!integer(value.receivedBytes,0,value.totalBytes)
      ||![0,value.totalBytes].includes(value.verifiedBytes)||value.verifiedBytes>value.receivedBytes
      ||!elapsed(value.elapsedMs))fail('WORKER_PROTOCOL_ERROR');
    return Object.freeze({stage:value.stage,assetIndex:value.assetIndex,receivedBytes:value.receivedBytes,
      verifiedBytes:value.verifiedBytes,totalBytes:value.totalBytes,elapsedMs:value.elapsedMs});
  } catch {fail('WORKER_PROTOCOL_ERROR');}
}
export function createProbeByteGuard() {
  const previous=new Map();let preparedNext=0,consumeReads=0;
  return Object.freeze({accept(raw){
    const value=copyProbeByteProgress(raw),key=`${value.stage}:${value.assetIndex}`,last=previous.get(key);
    const newRead=!last||(value.stage==='consume'&&last.verifiedBytes===last.totalBytes&&value.receivedBytes===0);
    if(value.stage==='prepare'&&value.assetIndex!==preparedNext)fail('WORKER_PROTOCOL_ERROR');
    if(newRead){if(value.receivedBytes!==0||value.verifiedBytes!==0)fail('WORKER_PROTOCOL_ERROR');if(value.stage==='consume'&&++consumeReads>64)fail('WORKER_PROTOCOL_ERROR');}
    else if(last.verifiedBytes!==0||value.receivedBytes<last.receivedBytes||value.elapsedMs<last.elapsedMs)fail('WORKER_PROTOCOL_ERROR');
    previous.set(key,value);if(value.stage==='prepare'&&value.verifiedBytes===value.totalBytes)preparedNext++;
    return value;
  }});
}

function base(value) {
  const url=new URL(value);
  if(url.href!==String(value)||!['http:','https:'].includes(url.protocol)||url.username||url.password
    ||url.search||url.hash||!url.pathname.endsWith('/')) fail('INVALID_PROBE_CONFIG');
  const origin=globalThis.location?.origin;
  if(origin&&origin!=='null'&&origin!==url.origin) fail('INVALID_PROBE_CONFIG');
  return url.href;
}
export function generatorAssetPlan(registry,baseURL) {
  try {
    const root=base(baseURL);
    if(!exact(registry,['schemaVersion','modelId','revision','modelFiles','runtimeFiles'])||registry.schemaVersion!==1
      ||registry.modelId!==PROBE_MODEL||registry.revision!==PROBE_REVISION) fail('ASSET_INTEGRITY_ERROR');
    const assets=[];
    for(const [group,pins,prefix] of [['modelFiles',MODEL_PINS,`models/${PROBE_REVISION}/${PROBE_MODEL}/`],['runtimeFiles',RUNTIME_PINS,'vendor/transformers/']]) {
      if(!exact(registry[group],Object.keys(pins))) fail('ASSET_INTEGRITY_ERROR');
      for(const [name,pin] of Object.entries(pins)) {
        const value=registry[group][name];
        if(!exact(value,['bytes','sha256'])||value.bytes!==pin.bytes||value.sha256!==pin.sha256) fail('ASSET_INTEGRITY_ERROR');
        assets.push(Object.freeze({url:new URL(prefix+name,root).href,...pin,aliases:Object.freeze(group==='modelFiles'
          ?[`https://huggingface.co/${PROBE_MODEL}/resolve/${PROBE_REVISION}/${name}`]:[])}));
      }
    }
    return Object.freeze({cacheName:`financial-rag-generator-${PROBE_REVISION}-smoke-v1`,assets:Object.freeze(assets)});
  } catch {fail('ASSET_INTEGRITY_ERROR');}
}

export function copyProbeReceipt(value) {
  try {
    if(!exact(value,['schemaVersion','status','modelId','revision','device','dtype','promptTokenIds','generatedTokenIds','text',
      'preflight','inspection','cachePreparation','sdkReads','elapsedMs','stages','cleanup'])||value.schemaVersion!==1
      ||value.status!=='local-smoke-complete'||value.modelId!==PROBE_MODEL||value.revision!==PROBE_REVISION
      ||value.device!=='webgpu'||value.dtype!=='q4'||!dense(value.promptTokenIds,32)
      ||PROBE_IDS.some((id,index)=>value.promptTokenIds[index]!==id)||!Array.isArray(value.generatedTokenIds)
      ||!integer(value.generatedTokenIds.length,1,8)||!dense(value.generatedTokenIds,value.generatedTokenIds.length)
      ||typeof value.text!=='string'||!value.text.trim()||value.text.length>1024||!elapsed(value.elapsedMs)) fail('WORKER_PROTOCOL_ERROR');
    const preflight=preflightGeneration(PROBE_IDS,{contextWindowTokens:40,maxNewTokens:8});
    if(!sameCanonical(value.preflight,preflight))fail('WORKER_PROTOCOL_ERROR');
    const checked=inspectGeneratedSequence([...PROBE_IDS,...value.generatedTokenIds],preflight);
    if(!['eos','length'].includes(checked.termination)||!exact(value.inspection,Object.keys(checked))
      ||JSON.stringify(value.inspection)!==JSON.stringify(checked)) fail('WORKER_PROTOCOL_ERROR');
    const prep=value.cachePreparation,reads=value.sdkReads,cleanup=value.cleanup;
    if(!exact(prep,['assets','verifiedBytes','networkBytes','cacheBytes'])||prep.assets!==8||prep.verifiedBytes!==PROBE_ASSET_BYTES
      ||!integer(prep.networkBytes,0,PROBE_ASSET_BYTES)||!integer(prep.cacheBytes,0,PROBE_ASSET_BYTES)
      ||prep.networkBytes+prep.cacheBytes!==PROBE_ASSET_BYTES||!exact(reads,['reads','verifiedBytes'])
      ||!integer(reads.reads,1,64)||!integer(reads.verifiedBytes,1,PROBE_ASSET_BYTES*64)
      ||!dense(value.stages,8)||!exact(cleanup,['inputsDisposed','resultDisposed','modelDisposed','cacheClosed','devicesDestroyed'])
      ||cleanup.inputsDisposed!==2||cleanup.resultDisposed!==true||cleanup.modelDisposed!==true
      ||cleanup.cacheClosed!==true||cleanup.devicesDestroyed!==1) fail('WORKER_PROTOCOL_ERROR');
    let previous=0;
    const stages=value.stages.map((item,index)=>{
      if(!exact(item,['stage','elapsedMs'])||item.stage!==PROBE_STAGES[index]||!elapsed(item.elapsedMs)
        ||item.elapsedMs<previous||item.elapsedMs>value.elapsedMs) fail('WORKER_PROTOCOL_ERROR');
      previous=item.elapsedMs;return Object.freeze({stage:item.stage,elapsedMs:item.elapsedMs});
    });
    return Object.freeze({schemaVersion:1,status:'local-smoke-complete',modelId:PROBE_MODEL,revision:PROBE_REVISION,
      device:'webgpu',dtype:'q4',promptTokenIds:PROBE_IDS,generatedTokenIds:checked.generatedTokenIds,text:value.text,
      preflight,inspection:checked,cachePreparation:Object.freeze({...prep}),sdkReads:Object.freeze({...reads}),
      elapsedMs:value.elapsedMs,stages:Object.freeze(stages),cleanup:Object.freeze({...cleanup})});
  } catch {fail('WORKER_PROTOCOL_ERROR');}
}

function dependencies(options) {
  try {
    if(!record(options)||Reflect.ownKeys(options).some(key=>!['baseURL','gpu','fetch','cacheStorage','importer','prepare','signal','onProgress','onByteProgress','now'].includes(key))) fail('INVALID_PROBE_CONFIG');
    const config={baseURL:base(options.baseURL??new URL('../',import.meta.url).href),gpu:options.gpu??globalThis.navigator?.gpu,
      fetch:options.fetch??globalThis.fetch?.bind(globalThis),cacheStorage:options.cacheStorage??globalThis.caches,
      importer:options.importer??(url=>import(url)),prepare:options.prepare??prepareVerifiedAssetCache,
      now:options.now??(()=>performance.now()),signal:options.signal,onProgress:options.onProgress,onByteProgress:options.onByteProgress};
    if(typeof config.fetch!=='function'||typeof config.importer!=='function'||typeof config.prepare!=='function'
      ||typeof config.now!=='function'||typeof config.cacheStorage?.open!=='function'
      ||(config.signal!==undefined&&!(config.signal instanceof AbortSignal))
      ||(config.onProgress!==undefined&&typeof config.onProgress!=='function')
      ||(config.onByteProgress!==undefined&&typeof config.onByteProgress!=='function')) fail('INVALID_PROBE_CONFIG');
    return config;
  } catch {fail('INVALID_PROBE_CONFIG');}
}
function lifecycle(config) {
  const abortController=new AbortController();let reason,closed=false,rejectStop;
  const stopped=new Promise((_,reject)=>{rejectStop=reject;});stopped.catch(()=>{});
  const check=()=>{if(reason)fail(reason);};
  const stop=code=>{if(reason||closed)return;reason=code;abortController.abort();rejectStop(new ProbeError(code));};
  const aborted=()=>stop('ABORTED');config.signal?.addEventListener('abort',aborted,{once:true});if(config.signal?.aborted)aborted();
  return {signal:abortController.signal,check,stop,get closed(){return closed;},
    async wait(task,code,late=()=>{}) {
      check();const operation=Promise.resolve().then(()=>{check();return task();}).then(value=>{
        if(reason||closed){quiet(()=>late(value));fail(reason??'ABORTED');}return value;
      });
      try {const value=await Promise.race([operation,stopped]);check();return value;}
      catch(error){if(reason)fail(reason);if(error instanceof ProbeError)throw error;fail(code);}
    },
    close(){closed=true;config.signal?.removeEventListener('abort',aborted);},
  };
}
async function readRegistry(config,scope) {
  const url=new URL('acceptance/generator-probe-assets.json',config.baseURL).href;
  let reader,response,finished=false;
  try {
    response=await scope.wait(()=>config.fetch(url,{redirect:'error',credentials:'omit',signal:scope.signal}),'ASSET_INTEGRITY_ERROR',value=>value?.body?.cancel());
    if(!(response instanceof Response)||!response.ok||response.redirected||(response.url&&response.url!==url)||!response.body) fail('ASSET_INTEGRITY_ERROR');
    const length=response.headers.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>32768)) fail('ASSET_INTEGRITY_ERROR');
    reader=response.body.getReader();const bytes=new Uint8Array(32768);let count=0;
    for(;;){const part=await scope.wait(()=>reader.read(),'ASSET_INTEGRITY_ERROR');if(part.done)break;
      if(!(part.value instanceof Uint8Array)||part.value.byteLength>32768-count)fail('ASSET_INTEGRITY_ERROR');bytes.set(part.value,count);count+=part.value.byteLength;}
    const registry=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count)));
    finished=true;return generatorAssetPlan(registry,config.baseURL);
  } catch(error){if(error instanceof ProbeError)throw error;fail('ASSET_INTEGRITY_ERROR');}
  finally {if(!finished)quiet(()=>reader?reader.cancel():response?.body?.cancel());quiet(()=>reader?.releaseLock());}
}
function tokenFrame(value) {
  try {
    if(!record(value)||!dense(value.input_ids,32)||!dense(value.attention_mask,32)
      ||PROBE_IDS.some((id,index)=>value.input_ids[index]!==id||value.attention_mask[index]!==1)) fail('TOKENIZER_MISMATCH');
    return PROBE_IDS;
  } catch {fail('TOKENIZER_MISMATCH');}
}
function fullSequence(tensor) {
  try {
    // Validate type, bounded rank and shape before touching or copying data.
    if(!tensor||tensor.type!=='int64'||!dense(tensor.dims,2)||tensor.dims[0]!==1
      ||!integer(tensor.dims[1],32,40)) fail('INVALID_GENERATION_OUTPUT');
    const data=tensor.data;if(!(data instanceof BigInt64Array)||data.length!==tensor.dims[1]) fail('INVALID_GENERATION_OUTPUT');
    return Array.from(data);
  } catch {fail('INVALID_GENERATION_OUTPUT');}
}

/** Native GPU/SDK calls occur only in the owned worker. Injectable dependencies
 * isolate unit boundaries; synthetic test receipts establish no browser run. */
export async function runGeneratorProbe(options={}) {
  const config=dependencies(options),scope=lifecycle(config),released=new WeakSet(),devices=new Set(),listeners=new Map();
  let prepared,model,result,inputIds,mask,receipt,error;
  const cleanup={inputsDisposed:0,resultDisposed:false,modelDisposed:false,cacheClosed:false,devicesDestroyed:0};
  const clock=()=>{const value=config.now();if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)fail('INVALID_PROBE_CONFIG');return value;};
  const started=clock(),stages=[];
  const stage=name=>{scope.check();const elapsedMs=clock()-started;if(!elapsed(elapsedMs))fail('INVALID_PROBE_CONFIG');
    stages.push(Object.freeze({stage:name,elapsedMs}));config.onProgress?.(name,elapsedMs);scope.check();};
  const byteGuard=createProbeByteGuard();let lastByteSent=-Infinity;
  const bytes=event=>{
    scope.check();
    if(!exact(event,['stage','assetIndex','completed','total','unit','estimated','verified'])
      ||event.unit!=='bytes'||event.estimated!==false||typeof event.verified!=='boolean'
      ||(event.verified&&event.completed!==event.total))fail('WORKER_PROTOCOL_ERROR');
    const current=stages.at(-1)?.stage;
    if((event.stage==='prepare'&&current!=='assets')||(event.stage==='consume'&&!['sdk','tokenizer','model','generate','reads'].includes(current)))fail('WORKER_PROTOCOL_ERROR');
    const progress=byteGuard.accept({stage:event.stage,assetIndex:event.assetIndex,receivedBytes:event.completed,
      verifiedBytes:event.verified?event.completed:0,totalBytes:event.total,elapsedMs:clock()-started});
    // Every counter is actual C2 progress. Intermediate updates are limited to
    // ten per second; each read's zero and verified final event always survive.
    if(progress.receivedBytes===0||event.verified||progress.elapsedMs-lastByteSent>=100){
      lastByteSent=progress.elapsedMs;config.onByteProgress?.(progress);
    }
    scope.check();
  };
  const releaseDevice=device=>{if(!device||released.has(device))return;released.add(device);quiet(()=>device.removeEventListener('uncapturederror',listeners.get(device)));try{device.destroy();cleanup.devicesDestroyed++;}catch{}};
  const releaseTensor=tensor=>{if(!tensor||released.has(tensor))return false;released.add(tensor);tensor.dispose();return true;};
  const releaseModel=async value=>{if(!value||released.has(value))return;released.add(value);await value.dispose();if(value===model)cleanup.modelDisposed=true;};
  try {
    stage('adapter');if(typeof config.gpu?.requestAdapter!=='function')fail('GPU_UNAVAILABLE');
    const adapter=await scope.wait(()=>config.gpu.requestAdapter({powerPreference:'high-performance'}),'GPU_UNAVAILABLE');
    const fallback=typeof adapter?.info?.isFallbackAdapter==='boolean'?adapter.info.isFallbackAdapter:adapter?.isFallbackAdapter;
    if(!adapter||fallback!==false||typeof adapter.requestDevice!=='function')fail('GPU_UNAVAILABLE');
    const ownedAdapter=new Proxy(adapter,{get(target,key){
      if(key==='requestDevice')return (...args)=>scope.wait(()=>Reflect.apply(target.requestDevice,target,args),'GPU_UNAVAILABLE',releaseDevice).then(device=>{
        if(scope.closed){releaseDevice(device);fail('ABORTED');}
        if(typeof device?.destroy!=='function'||typeof device?.lost?.then!=='function'
          ||typeof device.addEventListener!=='function'||typeof device.removeEventListener!=='function') {releaseDevice(device);fail('GPU_UNAVAILABLE');}
        devices.add(device);const uncaptured=()=>scope.stop('GPU_UNCAPTURED_ERROR');listeners.set(device,uncaptured);
        device.addEventListener('uncapturederror',uncaptured);device.lost.then(()=>scope.stop('GPU_DEVICE_LOST'),()=>scope.stop('GPU_DEVICE_LOST'));scope.check();return device;
      });
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    stage('assets');const plan=await readRegistry(config,scope);
    prepared=await scope.wait(()=>config.prepare(plan,{fetch:config.fetch,cacheStorage:config.cacheStorage,signal:scope.signal,onProgress:bytes}),'ASSET_CACHE_ERROR',value=>value?.close());
    stage('sdk');const library=await scope.wait(()=>config.importer(new URL('vendor/transformers/transformers.min.js',config.baseURL).href),'MODEL_LOAD_FAILED');
    if(typeof library?.AutoTokenizer?.from_pretrained!=='function'||typeof library?.AutoModelForCausalLM?.from_pretrained!=='function'
      ||typeof library.Tensor!=='function'||!library.env?.backends?.onnx?.wasm||!library.env.backends.onnx.webgpu)fail('MODEL_LOAD_FAILED');
    const env=library.env;env.allowLocalModels=true;env.allowRemoteModels=false;env.localModelPath=new URL(`models/${PROBE_REVISION}/`,config.baseURL).href;
    env.useBrowserCache=false;env.useFSCache=false;env.useCustomCache=true;env.customCache=prepared.cache;
    env.backends.onnx.wasm.wasmPaths={mjs:new URL('vendor/transformers/ort-wasm-simd-threaded.jsep.mjs',config.baseURL).href,
      wasm:new URL('vendor/transformers/ort-wasm-simd-threaded.jsep.wasm',config.baseURL).href};
    env.backends.onnx.wasm.proxy=false;env.backends.onnx.wasm.numThreads=1;env.backends.onnx.webgpu.adapter=ownedAdapter;
    stage('tokenizer');const settings={revision:PROBE_REVISION,local_files_only:true};
    const tokenizer=await scope.wait(()=>library.AutoTokenizer.from_pretrained(PROBE_MODEL,settings),'MODEL_LOAD_FAILED');
    if(typeof tokenizer!=='function'||typeof tokenizer.apply_chat_template!=='function')fail('TOKENIZER_MISMATCH');
    const prompt=await scope.wait(()=>tokenizer.apply_chat_template([{role:'system',content:'You are a helpful assistant.'},
      {role:'user',content:'Say hello briefly and mention this is a very small local test.'}],{tokenize:false,add_generation_prompt:true}),'TOKENIZER_MISMATCH');
    const ids=tokenFrame(await scope.wait(()=>tokenizer(prompt,{add_special_tokens:false,truncation:false,padding:false,return_tensor:false}),'TOKENIZER_MISMATCH'));
    const preflight=preflightGeneration(ids,{contextWindowTokens:40,maxNewTokens:8});
    stage('model');model=await scope.wait(()=>library.AutoModelForCausalLM.from_pretrained(PROBE_MODEL,{...settings,device:'webgpu',dtype:'q4',
      use_external_data_format:false,session_options:{executionProviders:['webgpu']}}),'MODEL_LOAD_FAILED',releaseModel);
    if(typeof model?.generate!=='function'||typeof model.dispose!=='function'||devices.size!==1)fail('MODEL_LOAD_FAILED');
    inputIds=new library.Tensor('int64',BigInt64Array.from(ids,BigInt),[1,32]);mask=new library.Tensor('int64',new BigInt64Array(32).fill(1n),[1,32]);
    stage('generate');result=await scope.wait(()=>model.generate({input_ids:inputIds,attention_mask:mask,
      generation_config:{...preflight.settings,eos_token_id:[...preflight.settings.eos_token_id],generation_kwargs:{}}}),'GENERATION_FAILED',releaseTensor);
    let inspection;try {inspection=inspectGeneratedSequence(fullSequence(result),preflight);}catch{fail('INVALID_GENERATION_OUTPUT');}
    if(!['eos','length'].includes(inspection.termination)||typeof tokenizer.decode!=='function')fail('INVALID_GENERATION_OUTPUT');
    const text=await scope.wait(()=>tokenizer.decode([...inspection.generatedTokenIds],{skip_special_tokens:true}),'INVALID_GENERATION_OUTPUT');
    if(typeof text!=='string'||!text.trim()||text.length>1024)fail('INVALID_GENERATION_OUTPUT');
    stage('reads');const sdkReads=await scope.wait(()=>prepared.finishReads(),'ASSET_CACHE_ERROR');
    receipt={schemaVersion:1,status:'local-smoke-complete',modelId:PROBE_MODEL,revision:PROBE_REVISION,device:'webgpu',dtype:'q4',
      promptTokenIds:ids,generatedTokenIds:inspection.generatedTokenIds,text,preflight,inspection,
      cachePreparation:prepared.receipt,sdkReads,stages,cleanup};
    stage('cleanup');
  } catch(value) {error=value instanceof ProbeError?value:new ProbeError('GENERATION_FAILED');}
  finally {
    for(const tensor of [inputIds,mask])try{if(releaseTensor(tensor))cleanup.inputsDisposed++;}catch{error??=new ProbeError('GENERATION_FAILED');}
    try{cleanup.resultDisposed=releaseTensor(result);}catch{error??=new ProbeError('GENERATION_FAILED');}
    if(model&&!released.has(model))try{const disposal=releaseModel(model);quiet(()=>disposal);await scope.wait(()=>disposal,'GENERATION_FAILED');}catch(value){error??=value instanceof ProbeError?value:new ProbeError('GENERATION_FAILED');}
    try{if(prepared){prepared.close();cleanup.cacheClosed=true;}}catch{error??=new ProbeError('ASSET_CACHE_ERROR');}
    scope.close();for(const device of devices)releaseDevice(device);
  }
  if(error)throw error;
  receipt.elapsedMs=clock()-started;return copyProbeReceipt(receipt);
}
