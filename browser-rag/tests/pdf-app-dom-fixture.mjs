import {inputOf,syntheticRun,tick} from './financial-generation-fixture.mjs';
import {createComputeCommandHandler} from '../compute.worker.mjs';
import {embeddingReceipt} from '../embedding-source.mjs';
import {rankCandidates} from '../retrieval.mjs';
import {queryResultReceipt} from '../query-source.mjs';
import {createFinancialGenerationCommandHandler} from '../financial-generation.worker.mjs';

// Explicit test-only DOM/SDK doubles. They do not establish browser/model execution.
export class NodeDouble {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners=new Map();this.attributes=new Map();this._text='';this.value='';this.disabled=false;this.open=false;this.hidden=false;this.files=[];}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(value){throw Error('HTML execution forbidden in this DOM double');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this._text='';this.children=[...nodes];}
  addEventListener(type,listener){const list=this.listeners.get(type)??[];list.push(listener);this.listeners.set(type,list);}
  removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)??[]).filter(value=>value!==listener));}
  dispatch(type){for(const listener of this.listeners.get(type)??[])listener({target:this});}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  removeAttribute(key){this.attributes.delete(key);}
  focus(){this.focused=true;}
  querySelector(selector){return this.nodes?.get(selector.slice(1))??null;}
}
export function dom(){
  const root=new NodeDouble(),window=new NodeDouble('window');
  root.nodes=new Map();
  const ids=['pdf-file','page-select','items','status-title','status-detail','operation-progress','pipeline-steps','computation-notebook','cancel','clear','build-chunks','embed-chunks','run-query','assemble-context','generate-answer','clear-query','question-input','query-top-k','trace','receipt','embedding-receipt','query-receipt','context-detail','context-meta','context-title','context-caption','generation-detail','generation-meta','generation-contract','generation-guidance','header-stage','candidate-results','candidate-meta','question-original','question-resolved','question-encoder','query-embedding-detail','query-embedding-meta','chunk-select','chunk-detail','chunk-meta','chunks-previous','chunks-next','embedding-detail','embedding-meta','items-range','items-first','items-previous','items-next','page-meta'];
  for(const id of ids)root.nodes.set(id,new NodeDouble());
  root.nodes.set('source-cell-lookup',new NodeDouble());
  root.nodes.set('retrieval-calculation-view',new NodeDouble());
  root.nodes.set('asset-preparation',new NodeDouble());
  root.nodes.get('query-top-k').value='2';
  const document={createElement:tag=>new NodeDouble(tag),querySelector:selector=>root.querySelector(selector),defaultView:window};
  return {root,document,window,get:id=>root.nodes.get(id)};
}
export const nodes=root=>[root,...root.children.flatMap(nodes)];
export const byTag=(root,tag)=>nodes(root).filter(node=>node.tagName===tag);
export const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
export const adapterControl={extract:null,embed:null,query:null};
export async function extractPdf(file){if(adapterControl.extract)return adapterControl.extract(file);const source=inputOf().source;source.source.name=file.name;return source;}
export async function chunkInWorker(source,options){const packets=[];createComputeCommandHandler(packet=>packets.push(packet))({kind:'chunk-source',identity:options.identity,source,options:options.chunkOptions});for(const p of packets.slice(0,-1))options.onProgress(p.event);return packets.at(-1);}
const BYTES=113629084;
function progress(options,stages){stages.forEach(([stage,completed,total,unit],i)=>options.onProgress({...options.identity,kind:'progress',stage,seq:i+1,payload:{completed,total,unit,estimated:false}}));}
export async function embedInWorker(input,options){
  if(adapterControl.embed)return adapterControl.embed(input,options);
  const artifact=inputOf().embeddingArtifact;artifact.chunkIds=input.chunks.map(c=>c.id);artifact.sourceSha256=input.source.sha256;
  artifact.receipt={verifiedBytes:BYTES,networkBytes:BYTES,cacheBytes:0,elapsedMs:2};
  progress(options,[['download',0,BYTES,'bytes'],['download',BYTES,BYTES,'bytes'],['initialize',0,null,'chunks'],['encode',0,input.counts.chunks,'chunks'],['encode',input.counts.chunks,input.counts.chunks,'chunks']]);
  return {event:{...options.identity,kind:'result',stage:'encode',seq:6,payload:{data:embeddingReceipt(artifact)}},artifact};
}
export async function queryInWorker(input,passages,question,options){
  if(adapterControl.query)return adapterControl.query(input,passages,question,options);
  const query=inputOf().queryResult.query;query.receipt={verifiedBytes:BYTES,networkBytes:0,cacheBytes:BYTES,elapsedMs:1};
  const retrieval=rankCandidates(input,passages,{representationId:query.representationId,representation:query.representation,vector:query.vector},{topK:options.topK}),artifact={query,retrieval};
  progress(options,[['download',0,BYTES,'bytes'],['download',BYTES,BYTES,'bytes'],['initialize',0,null,'tokens'],['encode',0,3,'tokens'],['encode',3,3,'tokens'],['rank',0,input.counts.chunks,'chunks'],['rank',input.counts.chunks,input.counts.chunks,'chunks']]);
  return {event:{...options.identity,kind:'result',stage:'rank',seq:8,payload:{data:queryResultReceipt(artifact)}},artifact};
}
export async function generationPackets(input,settings,options){const packets=[];await createFinancialGenerationCommandHandler(p=>packets.push(p),{run:syntheticRun})({kind:'generate-financial',identity:options.identity,contextInput:input,generationOptions:settings});return packets;}
export async function generate(input,settings,options){const packets=await generationPackets(input,settings,options);for(const p of packets.slice(0,-1))options.onProgress(p);return packets.at(-1);}
export async function act(node,type='click'){node.dispatch(type);await tick();await tick();}
