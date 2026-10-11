import { preflightGeneration, inspectGeneratedSequence } from '../generator-contract.mjs';
import { PROBE_MODEL, PROBE_REVISION, PROBE_ASSET_BYTES, PROBE_STAGES, ProbeError, runNativeGenerator } from '../generator-native-core.mjs';
export { PROBE_MODEL, PROBE_REVISION, PROBE_STAGES, PROBE_MESSAGES, ProbeError, PROBE_ASSET_BYTES,
  PROBE_MAX_PACKETS, copyProbeByteProgress, createProbeByteGuard, generatorAssetPlan } from '../generator-native-core.mjs';

export const PROBE_IDS = Object.freeze([151644,8948,198,2610,525,264,10950,17847,13,151645,198,151644,872,198,45764,23811,26753,323,6286,419,374,264,1602,2613,2205,1273,13,151645,198,151644,77091,198]);
const fail=code=>{throw new ProbeError(code);};
const record=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>record(value)&&Reflect.ownKeys(value).length===keys.length&&Reflect.ownKeys(value).every(key=>keys.includes(key));
const dense=(value,length)=>Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length===length
  &&Reflect.ownKeys(value).length===length+1&&Array.from({length},(_,i)=>Object.hasOwn(value,i)).every(Boolean);
const elapsed=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=300000;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
function sameCanonical(value,expected) {
  if(expected===null||typeof expected!=='object')return Object.is(value,expected);
  if(Array.isArray(expected))return dense(value,expected.length)&&expected.every((item,index)=>sameCanonical(value[index],item));
  const keys=Object.keys(expected);
  return exact(value,keys)&&keys.every(key=>sameCanonical(value[key],expected[key]));
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


function tokenFrame(value) {
  try {
    if(!record(value)||!dense(value.input_ids,32)||!dense(value.attention_mask,32)
      ||PROBE_IDS.some((id,index)=>value.input_ids[index]!==id||value.attention_mask[index]!==1)) fail('TOKENIZER_MISMATCH');
    return PROBE_IDS;
  } catch {fail('TOKENIZER_MISMATCH');}
}

/** Backwards-compatible fixed C3 facade over the shared owned native loader. */
export async function runGeneratorProbe(options={}) {
  const receipt=await runNativeGenerator(async(tokenizer,wait)=>{
    const prompt=await wait(()=>tokenizer.apply_chat_template([{role:'system',content:'You are a helpful assistant.'},
      {role:'user',content:'Say hello briefly and mention this is a very small local test.'}],{tokenize:false,add_generation_prompt:true}),'TOKENIZER_MISMATCH');
    const ids=tokenFrame(await wait(()=>tokenizer(prompt,{add_special_tokens:false,truncation:false,padding:false,return_tensor:false}),'TOKENIZER_MISMATCH'));
    return {tokenIds:ids,attentionMask:Array(32).fill(1),preflight:preflightGeneration(ids,{contextWindowTokens:40,maxNewTokens:8})};
  },options,1024);
  const {generationMode,...fixed}=receipt;
  return copyProbeReceipt({...fixed,status:'local-smoke-complete'});
}
