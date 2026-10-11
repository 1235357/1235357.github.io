import { readFileSync } from 'node:fs';
import { createPageRecord } from '../pdf-source.mjs';
import { chunkSource } from '../chunking.mjs';
import { EMBEDDING_SPEC } from '../embedding-contract.mjs';
import { projectEmbeddingInput } from '../embedding-source.mjs';
import { copyQueryPassages, queryResultReceipt } from '../query-source.mjs';
import { rankCandidates } from '../retrieval.mjs';
import { runFinancialGenerator } from '../financial-generator-runtime.mjs';

// Declared SDK and Worker doubles only. Provenance, framing and native resource
// lifecycle use the production contracts. This fixture proves no model run.
export const identity = () => ({protocolVersion:1,runtimeId:'financial-test',operationId:'op-1',documentEpoch:0,operation:'generate'});
const sha='a'.repeat(64),vector=axis=>Array.from({length:384},(_,i)=>i===axis?1:0);
export function inputOf(strings=[' PRIVATE_ALPHA 😀\n ','PRIVATE_BETA','PRIVATE_GAMMA']) {
  const parser={name:'pdfjs',version:'6.4.299',policyVersion:'text-items-v1',disableNormalization:true};
  const source={schemaVersion:1,status:'extracted-not-indexed',source:{sha256:sha,name:'PRIVATE.pdf',size:1002},
    parser,numPages:strings.length,workerMode:'node-fake',pages:strings.map((str,i)=>createPageRecord({
      sourceSha256:sha,parserVersion:parser.version,physicalPageNumber:i+1,pageLabel:i===0?null:'i',
      page:{view:[0,0,612,792],rotate:0,userUnit:1},textContent:{items:[{str,dir:'ltr',transform:[1,0,0,1,30,740],width:120,height:12,fontName:'f1',hasEOL:false}]}}))};
  const chunkArtifact=chunkSource(source,{maxChunkUtf16:4096,overlapUtf16:0}),projection=projectEmbeddingInput(chunkArtifact),count=projection.chunks.length;
  const embeddingArtifact={schemaVersion:1,status:'embedded-not-retrieved',sourceSha256:sha,representationId:EMBEDDING_SPEC.version,
    representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',chunkIds:projection.chunks.map(c=>c.id),tokenIds:projection.chunks.map(()=>[101,42,102]),
    vectors:projection.chunks.map((_,i)=>vector(i)),counts:{chunks:count,totalTokens:count*3,dimensions:384},receipt:{verifiedBytes:200,networkBytes:150,cacheBytes:50,elapsedMs:2}};
  const query={schemaVersion:1,status:'query-embedded-not-retrieved',representationId:EMBEDDING_SPEC.version,representation:{...EMBEDDING_SPEC},
    backend:'webgpu',dtype:'fp32',tokenIds:[101,44,102],vector:vector(1),counts:{totalTokens:3,dimensions:384},receipt:{verifiedBytes:100,networkBytes:70,cacheBytes:30,elapsedMs:1}};
  const topK=2,passages=copyQueryPassages(embeddingArtifact,projection),queryResult={query,retrieval:rankCandidates(projection,passages,
    {representationId:query.representationId,representation:query.representation,vector:query.vector},{topK})};
  return structuredClone({source,chunkArtifact,embeddingArtifact,question:'  PRIVATE 財報 😀\uD800\n\t ',queryResult,topK,queryDownloadTotal:100,queryMetadata:queryResultReceipt(queryResult)});
}
export async function syntheticRun(input,options,callbacks={}) {
  const ids=Array.from({length:23},(_,i)=>i+10),suffix=options.maxNewTokens===3?[5,6,7]:[5,151645];
  function tokenizer(){return {input_ids:ids,attention_mask:ids.map(()=>1)};}
  tokenizer.apply_chat_template=messages=>`<|im_start|>system\n${messages[0].content}<|im_end|>\n<|im_start|>user\n${messages[1].content}<|im_end|>\n<|im_start|>assistant\n`;
  tokenizer.decode=()=> ' {"answer":"invented $9 trillion","citations":["E2"],"insufficient_evidence":false} \n';
  class Tensor {constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){}}
  const device={lost:new Promise(()=>{}),addEventListener(){},removeEventListener(){},destroy(){}};
  const adapter={info:{isFallbackAdapter:false},requestDevice:()=>device};
  const model={generate({input_ids}){const data=BigInt64Array.from([...input_ids.data,...suffix.map(BigInt)]);return new Tensor('int64',data,[1,data.length]);},dispose(){}};
  const library={env:{backends:{onnx:{wasm:{},webgpu:{}}}},Tensor,AutoTokenizer:{from_pretrained:()=>tokenizer},
    AutoModelForCausalLM:{async from_pretrained(){await library.env.backends.onnx.webgpu.adapter.requestDevice();return model;}}};
  const registry=JSON.parse(readFileSync(new URL('../acceptance/generator-probe-assets.json',import.meta.url)));
  const sizes=Object.values({...registry.modelFiles,...registry.runtimeFiles}).map(pin=>pin.bytes),bytes=sizes.reduce((a,b)=>a+b,0);
  let clock=0,emitBytes;
  return runFinancialGenerator(input,options,{...callbacks,baseURL:'http://127.0.0.1:8766/browser-rag/',now:()=>++clock,
    gpu:{requestAdapter:()=>adapter},cacheStorage:{open(){}},fetch:()=>new Response(JSON.stringify(registry)),
    prepare(plan,{onProgress}) {emitBytes=onProgress;for(const [assetIndex,asset] of plan.assets.entries()) {
      onProgress({stage:'prepare',assetIndex,completed:0,total:asset.bytes,unit:'bytes',estimated:false,verified:false});
      onProgress({stage:'prepare',assetIndex,completed:asset.bytes,total:asset.bytes,unit:'bytes',estimated:false,verified:true});
    }return {cache:{},receipt:{assets:8,verifiedBytes:bytes,networkBytes:0,cacheBytes:bytes},finishReads:()=>({reads:5,verifiedBytes:sizes.slice(0,5).reduce((a,b)=>a+b,0)}),close(){}};},
    importer(){for(let assetIndex=0;assetIndex<5;assetIndex++)for(const verified of [false,true])emitBytes({stage:'consume',assetIndex,completed:verified?sizes[assetIndex]:0,total:sizes[assetIndex],unit:'bytes',estimated:false,verified});return library;}});
}
export const ready=()=>({kind:'generation-ready',protocolVersion:1,workerVersion:'financial-generation-v1'});
export class WorkerDouble {
  constructor(){this.listeners=new Map();this.sent=[];this.terminated=0;}
  addEventListener(type,listener){this.listeners.set(type,listener);}
  removeEventListener(type,listener){if(this.listeners.get(type)===listener)this.listeners.delete(type);}
  postMessage(command){this.sent.push(command);}
  terminate(){this.terminated++;}
  receive(packet){this.listeners.get('message')?.({data:packet});}
}
export const commandOf=(contextInput=inputOf(),generationOptions={maxNewTokens:17})=>({kind:'generate-financial',identity:identity(),contextInput,generationOptions});
export const tick=()=>new Promise(resolve=>setImmediate(resolve));
