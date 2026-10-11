// Inert boundary observations only. No exception text, URL, PDF or model data.
const IDENTITY_KEYS=['protocolVersion','runtimeId','operationId','documentEpoch','operation'];
const WORKER_KEYS=['component','phase','assetIndex','allowedCode'];
const SAFE_KEYS=[...WORKER_KEYS,'failureOrigin','readyObserved','commandPosted','lastSeq','elapsedMs'];
const PREP_CODES=['INVALID_ASSET_PREPARATION','ASSET_PREPARATION_FAILED','ASSET_PREPARATION_TIMEOUT','ASSET_TRANSPORT_REFUSED','WORKER_UNAVAILABLE','WORKER_PROTOCOL_ERROR','ABORTED'];
const ENCODER_CODES=['INVALID_EMBEDDING_CONFIG','ENCODER_INPUT_LIMIT','INVALID_EMBEDDING','GPU_UNAVAILABLE','GPU_DEVICE_LOST','ASSET_INTEGRITY_ERROR','EMBEDDING_LOAD_FAILED','EMBEDDING_FAILED','ABORTED'];
const CODES=Object.freeze({
  'preparation-client':PREP_CODES,
  'preparation-loader':['INVALID_EMBEDDING_CONFIG','INVALID_PROBE_CONFIG','INVALID_CACHE_CONFIG','ASSET_INTEGRITY_ERROR','ASSET_CACHE_ERROR','ASSET_TRANSPORT_REFUSED','WORKER_PROTOCOL_ERROR','ASSET_PREPARATION_TIMEOUT','ASSET_PREPARATION_FAILED','ABORTED'],
  'encoder-client':[...ENCODER_CODES,'INVALID_EMBEDDING_WORKER_CONFIG','WORKER_UNAVAILABLE','WORKER_PROTOCOL_ERROR','EMBEDDING_TIMEOUT'],
  'encoder-initializer':ENCODER_CODES,
  'query-client':['INVALID_QUERY_WORKER_CONFIG','INVALID_EMBEDDING_CONFIG','ENCODER_INPUT_LIMIT','INVALID_EMBEDDING','GPU_UNAVAILABLE','GPU_DEVICE_LOST','ASSET_INTEGRITY_ERROR','EMBEDDING_LOAD_FAILED','EMBEDDING_FAILED','INVALID_RETRIEVAL_INPUT','QUERY_FAILED','QUERY_TIMEOUT','WORKER_UNAVAILABLE','WORKER_PROTOCOL_ERROR','ABORTED'],
});
const CLIENT_PHASES=['worker-readiness','worker-operation','unknown'];
const PHASES=Object.freeze({
  'preparation-client':CLIENT_PHASES,'encoder-client':CLIENT_PHASES,'query-client':CLIENT_PHASES,
  'preparation-loader':['registry-request','registry-read','registry-validate','cache-open','cache-match','asset-fetch','asset-verify-and-store','unknown'],
  'encoder-initializer':['sdk-import','sdk-configure','tokenizer-load','input-preflight','model-load','model-handle-validate','unknown'],
});
const ORIGINS=['client-readiness-deadline','client-operation-deadline','native-worker-error','channel-validation','worker-reported-error'];
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const invalid=()=>{throw new TypeError('Invalid runtime failure diagnostic');};
function data(raw,keys){
  if(raw===null||typeof raw!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))invalid();
  const actual=Reflect.ownKeys(raw);
  if(actual.length!==keys.length||actual.some(key=>!keys.includes(key)))invalid();
  const value={};for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(raw,key);if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))invalid();value[key]=descriptor.value;}
  return value;
}
function identity(raw){
  const value=data(raw,IDENTITY_KEYS);
  if(value.protocolVersion!==1||!['embed','prepare-assets','query'].includes(value.operation)||typeof value.runtimeId!=='string'||!value.runtimeId.trim()||value.runtimeId.length>256
      ||typeof value.operationId!=='string'||!/^op-[1-9]\d{0,15}$/.test(value.operationId)||!integer(Number(value.operationId.slice(3)),Number.MAX_SAFE_INTEGER)
      ||!integer(value.documentEpoch,Number.MAX_SAFE_INTEGER))invalid();
  return Object.freeze(value);
}
function worker(raw,expected){
  const value=data(raw,WORKER_KEYS),component=value.component;
  if(!Object.hasOwn(CODES,component)||(expected!==undefined&&component!==expected)||!PHASES[component].includes(value.phase)||!CODES[component].includes(value.allowedCode))invalid();
  if(value.assetIndex!==null&&(!integer(value.assetIndex,7)||component!=='preparation-loader'||!['cache-match','asset-fetch','asset-verify-and-store'].includes(value.phase)))invalid();
  return Object.freeze(value);
}
export function copyWorkerFailure(raw,expected){try{return worker(raw,expected);}catch{invalid();}}
export function copyRuntimeFailure(raw,expectedIdentity,minimumSeq=0){
  try{
    const value=data(raw,['schemaVersion','identity','safeError']),owned=identity(value.identity),expected=identity(expectedIdentity);
    if(value.schemaVersion!==1||IDENTITY_KEYS.some(key=>owned[key]!==expected[key])||!integer(minimumSeq,Number.MAX_SAFE_INTEGER))invalid();
    const safe=data(value.safeError,SAFE_KEYS),prep=owned.operation==='prepare-assets',query=owned.operation==='query';
    const boundary=worker(Object.fromEntries(WORKER_KEYS.map(key=>[key,safe[key]])));
    if(!(query?boundary.component==='query-client':boundary.component.startsWith(prep?'preparation-':'encoder-'))||!ORIGINS.includes(safe.failureOrigin)
        ||typeof safe.readyObserved!=='boolean'||typeof safe.commandPosted!=='boolean'||safe.commandPosted&&!safe.readyObserved
        ||!integer(safe.lastSeq,prep?4096:Number.MAX_SAFE_INTEGER)||safe.lastSeq<minimumSeq
        ||(safe.elapsedMs!==null&&(typeof safe.elapsedMs!=='number'||!Number.isFinite(safe.elapsedMs)||safe.elapsedMs<0||safe.elapsedMs>(prep?1800000:130000))))invalid();
    const fromWorker=safe.failureOrigin==='worker-reported-error';
    if((!query&&fromWorker!==['preparation-loader','encoder-initializer'].includes(safe.component))
        ||query&&fromWorker&&safe.phase!=='unknown'
        ||fromWorker&&(!safe.readyObserved||!safe.commandPosted||safe.lastSeq===0)
        ||safe.failureOrigin==='client-readiness-deadline'&&(safe.readyObserved||safe.commandPosted||safe.phase!=='worker-readiness')
        ||safe.failureOrigin==='client-operation-deadline'&&((!prep&&!safe.readyObserved)||safe.phase!=='worker-operation'))invalid();
    return Object.freeze({schemaVersion:1,identity:owned,safeError:Object.freeze(safe)});
  }catch{invalid();}
}
export function createRuntimeFailure(rawIdentity,observation,rawWorker=null){
  const owned=identity(rawIdentity),prep=owned.operation==='prepare-assets',query=owned.operation==='query';
  const observed=data(observation,['failureOrigin','readyObserved','commandPosted','lastSeq','elapsedMs','allowedCode']);
  const cap=prep?1800000:130000,elapsed=observed.elapsedMs;
  if(query&&rawWorker!==null)invalid();
  const boundary=rawWorker===null?{component:prep?'preparation-client':query?'query-client':'encoder-client',phase:observed.failureOrigin==='client-readiness-deadline'?'worker-readiness':observed.failureOrigin==='client-operation-deadline'?'worker-operation':'unknown',assetIndex:null,allowedCode:observed.allowedCode}
    :copyWorkerFailure(rawWorker,prep?'preparation-loader':'encoder-initializer');
  return copyRuntimeFailure({schemaVersion:1,identity:owned,safeError:{...boundary,...observed,allowedCode:boundary.allowedCode,elapsedMs:typeof elapsed==='number'&&Number.isFinite(elapsed)&&elapsed>=0&&elapsed<=cap?elapsed:null}},owned);
}
export function ownData(raw,key){try{if(raw===null||!['object','function'].includes(typeof raw))return null;const descriptor=Object.getOwnPropertyDescriptor(raw,key);return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:null;}catch{return null;}}
export function diagnosticCode(error,component,fallback){let code;try{const descriptor=Object.getOwnPropertyDescriptor(error,'code');if(descriptor?.enumerable&&Object.hasOwn(descriptor,'value'))code=descriptor.value;}catch{}return CODES[component]?.includes(code)?code:fallback;}
export function createWorkerFailureTracker(component,onDiagnostic){
  const fallback=component==='preparation-loader'?'ASSET_PREPARATION_FAILED':'EMBEDDING_FAILED';
  let current=copyWorkerFailure({component,phase:'unknown',assetIndex:null,allowedCode:fallback},component);
  function publish(value){current=copyWorkerFailure(value,component);try{onDiagnostic?.(current);}catch{}return current;}
  return Object.freeze({
    enter(phase,assetIndex=null){return publish({component,phase,assetIndex,allowedCode:fallback});},
    failure(code){return publish({...current,allowedCode:CODES[component].includes(code)?code:fallback});},
    snapshot(){return current;},
    attach(error,code){Object.defineProperty(error,'workerFailure',{value:publish({...current,allowedCode:CODES[component].includes(code)?code:fallback}),enumerable:true});return error;},
  });
}
