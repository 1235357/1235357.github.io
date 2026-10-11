import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {createPdfSession,GenerationSessionError} from '../pdf-session.mjs';
import {createPageRecord} from '../pdf-source.mjs';
import {createComputeCommandHandler} from '../compute.worker.mjs';
import {EMBEDDING_SPEC} from '../embedding-contract.mjs';
import {embeddingReceipt} from '../embedding-source.mjs';
import {queryResultReceipt} from '../query-source.mjs';
import {rankCandidates} from '../retrieval.mjs';
import {createFinancialGenerationCommandHandler} from '../financial-generation.worker.mjs';
import {financialGenerationResultReceipt,FinancialGenerationWorkerError} from '../financial-generation-source.mjs';
import {syntheticRun,tick} from './financial-generation-fixture.mjs';

// The real context-session parser/chunker/query harness, including the pinned
// query download total. Synthetic vectors and the declared synthetic native run
// prove session ownership contracts, not model execution or financial accuracy.
const SHA='a'.repeat(64),DOWNLOAD_BYTES=113629084;
const RAW='  PRIVATE_QUESTION\n財報 😀?  ',CHUNK_OPTIONS={maxChunkUtf16:4096,overlapUtf16:0};
const vector=axis=>Array.from({length:384},(_,index)=>index===axis?1:0);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function extracted(name='PRIVATE_SOURCE.pdf'){
  const parser={name:'pdfjs',version:'6.4.299',policyVersion:'text-items-v1',disableNormalization:true};
  return structuredClone({schemaVersion:1,status:'extracted-not-indexed',source:{name,sha256:SHA,size:1002},
    parser,workerMode:'node-fake',numPages:3,pages:[['  PRIVATE_ALPHA\n😀  ','','尾\t'],['PRIVATE_BETA'],['PRIVATE_GAMMA']]
      .map((strings,index)=>createPageRecord({sourceSha256:SHA,parserVersion:parser.version,
        physicalPageNumber:index+1,pageLabel:[null,'i','i'][index],page:{view:[0,0,612,792],rotate:0,userUnit:1},
        textContent:{items:strings.map(str=>({str,dir:'ltr',transform:[1,0,0,1,30,740],
          width:120,height:12,fontName:'f1',hasEOL:false}))}}))});
}
function harness(extra={}){
  const computes=[],embeds=[],queries=[],generations=[],states=[];let incarnation=0;
  const pending=(tasks,record,options,rest={})=>{const task={record,options,...rest,...deferred()};tasks.push(task);return task.promise;};
  const session=createPdfSession({runtimeId:'context-parser',runtimeIdFactory:()=>`context-${++incarnation}`,
    extract:async file=>extracted(file.name),compute:(record,options)=>pending(computes,record,options),
    embed:(record,options)=>pending(embeds,record,options),
    query:(record,passages,question,options)=>pending(queries,record,options,{passages,question}),
    generate:(record,settings,options)=>pending(generations,record,options,{settings}),...extra,
    onState:state=>{states.push(state);extra.onState?.(state);}});
  return {session,computes,embeds,queries,generations,states};
}
function finishChunk(task){
  const packets=[];createComputeCommandHandler(packet=>packets.push(packet))(
    {kind:'chunk-source',identity:task.options.identity,source:task.record,options:task.options.chunkOptions});
  assert.equal(packets.at(-1).event.kind,'result');
  for(const packet of packets.slice(0,-1))task.options.onProgress(packet.event);
  const result=structuredClone(packets.at(-1));task.resolve(result);return result;
}
function progress(task,stages){
  stages.forEach(([stage,completed,total,unit],index)=>task.options.onProgress({...task.options.identity,
    kind:'progress',stage,seq:index+1,payload:{completed,total,unit,estimated:false}}));
}
function finishEmbedding(task){
  const count=task.record.counts.chunks;
  progress(task,[['download',0,DOWNLOAD_BYTES,'bytes'],['download',DOWNLOAD_BYTES,DOWNLOAD_BYTES,'bytes'],
    ['initialize',0,null,'chunks'],['encode',0,count,'chunks'],['encode',count,count,'chunks']]);
  const artifact={schemaVersion:1,status:'embedded-not-retrieved',sourceSha256:SHA,
    representationId:EMBEDDING_SPEC.version,representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',
    chunkIds:task.record.chunks.map(chunk=>chunk.id),tokenIds:task.record.chunks.map(()=>[101,42,102]),
    vectors:task.record.chunks.map((_,index)=>vector(index)),counts:{chunks:count,totalTokens:count*3,dimensions:384},
    receipt:{verifiedBytes:DOWNLOAD_BYTES,networkBytes:DOWNLOAD_BYTES,cacheBytes:0,elapsedMs:2}};
  const result={event:{...task.options.identity,kind:'result',stage:'encode',seq:6,
    payload:{data:structuredClone(embeddingReceipt(artifact))}},artifact};task.resolve(result);return result;
}
function finishQuery(task){
  const count=task.record.counts.chunks;
  progress(task,[['download',0,DOWNLOAD_BYTES,'bytes'],['download',DOWNLOAD_BYTES,DOWNLOAD_BYTES,'bytes'],
    ['initialize',0,null,'tokens'],['encode',0,3,'tokens'],['encode',3,3,'tokens'],
    ['rank',0,count,'chunks'],['rank',count,count,'chunks']]);
  const query={schemaVersion:1,status:'query-embedded-not-retrieved',representationId:EMBEDDING_SPEC.version,
    representation:{...EMBEDDING_SPEC},backend:'webgpu',dtype:'fp32',tokenIds:[101,44,102],vector:vector(1),
    counts:{totalTokens:3,dimensions:384},receipt:{verifiedBytes:DOWNLOAD_BYTES,networkBytes:0,cacheBytes:DOWNLOAD_BYTES,elapsedMs:1}};
  const artifact={query,retrieval:structuredClone(rankCandidates(task.record,task.passages,
    {representationId:query.representationId,representation:query.representation,vector:query.vector},{topK:task.options.topK}))};
  const result={event:{...task.options.identity,kind:'result',stage:'rank',seq:8,
    payload:{data:structuredClone(queryResultReceipt(artifact))}},artifact};task.resolve(result);return result;
}
async function ready(extra={}){
  const h=harness(extra);await h.session.select({name:'PRIVATE_SOURCE.pdf'});
  const chunk=h.session.chunk(CHUNK_OPTIONS);finishChunk(h.computes.at(-1));await chunk;
  const embed=h.session.embed();finishEmbedding(h.embeds.at(-1));await embed;return h;
}
async function accepted(extra={},raw=RAW,topK=3){
  const h=await ready(extra),query=h.session.query(raw,{topK});h.packet=finishQuery(h.queries.at(-1));await query;return h;
}
const safe=code=>error=>error.code===code&&!/PRIVATE|財報|😀|\.pdf|http/.test(error.message)&&!Object.hasOwn(error,'cause');
function frozen(value){if(value!==null&&typeof value==='object'){assert.ok(Object.isFrozen(value));Object.values(value).forEach(frozen);}}
function state(s){return {snapshot:s.snapshot(),source:s.document(),chunks:s.chunks(),embeddings:s.embeddings(),
  question:s.question(),query:s.queryEmbedding(),retrieval:s.retrieval(),context:s.context(),
  generation:s.generation(),inspection:s.generationInspection(),progress:s.generationProgress()};}
async function start(h,settings={},options={}){
  assert.equal(typeof h.session.generate,'function','explicit query-bound session.generate action');
  const pending=h.session.generate(settings,options);await tick();
  assert.ok(h.generations.at(-1),'configured adapter started');return {pending,task:h.generations.at(-1)};
}
async function packetsOf(task){
  const packets=[];await createFinancialGenerationCommandHandler(packet=>packets.push(packet),{run:syntheticRun})(
    {kind:'generate-financial',identity:task.options.identity,contextInput:task.record,generationOptions:task.settings});
  assert.equal(packets.at(-1).event.kind,'result');return structuredClone(packets);
}
async function finish(task,change=()=>{}){
  const packets=await packetsOf(task);for(const packet of packets.slice(0,-1))task.options.onProgress(packet);
  const result=packets.at(-1);change(result);task.resolve(result);return result;
}
function privateFree(snapshots){for(const value of snapshots)assert.ok(!/PRIVATE|財報|😀|invented|trillion|promptTokenIds|generatedTokenIds|attentionMask|"answer"|"citations"|"vector"|preparedPrompt/.test(JSON.stringify(value)));}

test('a literal generation import failure preserves the accepted query/context and cannot start adapter',async()=>{
  const h=await accepted();h.session.assembleContext();const before=state(h.session);let attempts=0;
  const hooks=registerHooks({resolve(specifier,context,next){
    if(specifier.includes('financial-')){attempts++;throw Error('PRIVATE import diagnostic');}return next(specifier,context);
  }});
  try{await assert.rejects(h.session.generate({maxNewTokens:17}),safe('INVALID_GENERATION_SESSION'));
    assert.ok(attempts>0);assert.deepEqual(state(h.session),before);assert.equal(h.generations.length,0);}
  finally{hooks.deregister();}
});

test('explicit generation preserves complete query authority and commits native execution separately from pure inspection',async()=>{
  const h=await accepted(),s=h.session,context=s.assembleContext(),before=s.snapshot();
  assert.equal(s.generation(),null);assert.equal(s.generationInspection(),null);assert.equal(s.generationProgress(),null);
  const {pending,task}=await start(h,{maxNewTokens:17});
  assert.equal(s.context(),context);assert.equal(task.record.question,RAW);assert.equal(task.record.topK,3);
  assert.equal(task.record.queryDownloadTotal,DOWNLOAD_BYTES);assert.deepEqual(task.record.queryMetadata,before.lifecycle.terminal.payload.data);
  assert.deepEqual(Object.keys(task.record),['source','chunkArtifact','embeddingArtifact','question','queryResult','topK','queryDownloadTotal','queryMetadata']);
  assert.notEqual(task.record.source,s.document());assert.notEqual(task.record.embeddingArtifact,s.embeddings());frozen(task.record);
  const result=await finish(task);assert.equal(await pending,undefined);assert.deepEqual(s.generation(),result.artifact);frozen(s.generation());
  const inspection=s.generationInspection();frozen(inspection);assert.equal(inspection.status,'shape-and-citation-identity-accepted');
  assert.equal(inspection.artifact.answer,'invented $9 trillion');assert.deepEqual(inspection.artifact.citations,['E2']);
  assert.equal(inspection.artifact.citationBindings[0].text,'PRIVATE_BETA');assert.equal(inspection.artifact.financialCorrectness,'unestablished');
  assert.equal(inspection.artifact.claimSupport,'unestablished');assert.equal(inspection.artifact.generationMode,'not-run');
  assert.equal(s.generation().generationMode,'native-run');assert.equal(s.snapshot().status,'unverified-financial-draft');
  assert.equal(s.snapshot().lifecycle.terminal.stage,'cleanup');assert.equal(s.snapshot().lifecycle.active,null);privateFree(h.states);
  privateFree([s.generationProgress()]);assert.equal(s.context(),context);
  const second=await start(h,{maxNewTokens:17});await finish(second.task);await second.pending;
  assert.notEqual(second.task.options.identity.runtimeId,task.options.identity.runtimeId);
});

test('constructor and call settings merge before defaults and own worker fields once',async()=>{
  let reads=0;const h=await accepted({generationOptions:{contextWindowTokens:800,maxNewTokens:30},generationWorkerOptions:{readyTimeoutMs:9}});
  const {pending,task}=await start(h,{get maxNewTokens(){reads++;return 17;}},{workTimeoutMs:50});
  assert.equal(reads,1);assert.deepEqual(task.settings,{contextWindowTokens:800,maxNewTokens:17});
  assert.equal(task.options.readyTimeoutMs,9);assert.equal(task.options.workTimeoutMs,50);
  assert.equal(task.options.signal instanceof AbortSignal,true);assert.equal(task.options.identity.operation,'generate');
  await finish(task);await pending;
});

test('default absent adapter refuses before importing financial modules or reading input/settings',async()=>{
  const h=await accepted({generate:undefined});let reads=0;
  Object.defineProperty(h.session.document().source,'name',{get(){reads++;throw Error('PRIVATE');}});
  await assert.rejects(h.session.generate({get maxNewTokens(){reads++;return 17;}}),safe('GENERATION_UNAVAILABLE'));
  assert.equal(reads,0);assert.equal(h.session.snapshot().status,'query-candidates-only');
  const code=readFileSync(new URL('../pdf-session.mjs',import.meta.url),'utf8');
  assert.equal(/^import .*financial/m.test(code),false);assert.equal(/contextInput\s*[:(]/.test(code),false);
});

for(const [name,settings,worker]of [
  ['unknown generation key',{temperature:0},{}],['zero budget',{maxNewTokens:0},{}],
  ['unknown worker key',{}, {run(){}}],['reserved identity',{}, {identity:{}}],['reserved signal',{}, {signal:{}}],
  ['reserved callback',{}, {onProgress(){}}],['ready ceiling',{}, {readyTimeoutMs:10001}],['work ceiling',{}, {workTimeoutMs:300001}],
])test(`invalid ${name} preserves accepted outcomes`,async()=>{
  const h=await accepted(),first=await start(h,{maxNewTokens:17});await finish(first.task);await first.pending;
  const before=state(h.session);await assert.rejects(h.session.generate(settings,worker),safe('INVALID_GENERATION_SESSION'));
  assert.deepEqual(state(h.session),before);assert.equal(h.generations.length,1);
});

test('unknown option keys reject before any value getter',async()=>{
  const h=await accepted();let reads=0;
  for(const worker of [false,true]){const options={get unexpected(){reads++;throw Error('PRIVATE');},get maxNewTokens(){reads++;return 17;}};
    await assert.rejects(worker?h.session.generate({},options):h.session.generate(options),safe('INVALID_GENERATION_SESSION'));}
  assert.equal(reads,0);
});

for(const mode of ['throw','reuse'])test(`runtime factory ${mode} preserves accepted query and context`,async()=>{
  let fail=false,n=0;const h=await accepted({runtimeIdFactory(){if(fail){if(mode==='throw')throw Error('PRIVATE');return 'context-parser';}return `fresh-${++n}`;}});
  h.session.assembleContext();const before=state(h.session);fail=true;
  await assert.rejects(h.session.generate({maxNewTokens:17}),safe('INVALID_GENERATION_SESSION'));assert.deepEqual(state(h.session),before);
  assert.equal(h.generations.length,0);
});

for(const action of ['cancel','clear','clearQuery','select','query','chunk','embed'])test(`option getter ${action} revokes generation preflight`,async()=>{
  const h=await accepted(),s=h.session;let actionTask;
  const options={get maxNewTokens(){actionTask=action==='select'?s.select({name:'replacement.pdf'}):action==='query'?s.query('next')
    :action==='chunk'?s.chunk(CHUNK_OPTIONS):s[action]();return 17;}};
  await assert.rejects(s.generate(options),safe('INVALID_GENERATION_SESSION'));assert.equal(h.generations.length,0);
  if(action==='query')finishQuery(h.queries.at(-1));if(action==='chunk')finishChunk(h.computes.at(-1));if(action==='embed')finishEmbedding(h.embeds.at(-1));await actionTask;
  assert.equal(s.generation(),null);assert.equal(s.generationInspection(),null);
  if(action==='cancel'){assert.equal(s.question(),RAW);assert.ok(s.retrieval());}
});

test('preflight token refuses caught recursive generate and active work before reading nested settings',async()=>{
  const h=await accepted();let nested,reads=0;
  const outer=h.session.generate({get maxNewTokens(){nested=assert.rejects(h.session.generate({get maxNewTokens(){reads++;return 17;}}),safe('INVALID_GENERATION_SESSION'));return 17;}});
  await tick();await nested;
  await tick();const task=h.generations.at(-1);assert.ok(task);assert.equal(reads,0);
  await assert.rejects(h.session.generate({get maxNewTokens(){reads++;return 17;}}),safe('INVALID_GENERATION_SESSION'));assert.equal(reads,0);
  await finish(task);await outer;
});

for(const [name,text,settings]of [
  ['length',null,{maxNewTokens:3}],['malformed','{',{}],['trailing','{"answer":"x","citations":["E2"],"insufficient_evidence":false} x',{}],
  ['duplicate key','{"answer":"x","answer":"y","citations":["E2"],"insufficient_evidence":false}',{}],
  ['unknown citation','{"answer":"x","citations":["E99"],"insufficient_evidence":false}',{}],
  ['duplicate citation','{"answer":"x","citations":["E2","E2"],"insufficient_evidence":false}',{}],
])test(`${name} output retains complete native receipt with a refused draft`,async()=>{
  const h=await accepted(),{pending,task}=await start(h,{maxNewTokens:17,...settings});
  const result=await finish(task,p=>{if(text!==null)p.artifact.text=text;});await pending;
  assert.deepEqual(h.session.generation(),result.artifact);assert.equal(h.session.generationInspection().status,'refused');
  assert.equal(h.session.generationInspection().artifact,null);assert.equal(h.session.snapshot().status,'financial-output-refused');
  assert.equal(h.session.generation().text,text??result.artifact.text);frozen(h.session.generation());privateFree(h.states);
});

for(const [name,change]of [
  ['missing receipt',p=>delete p.artifact],['prompt',p=>p.artifact.preparedPrompt.renderedPrompt+=' '],
  ['settings',p=>p.artifact.preflight.maxNewTokens++],['context',p=>p.artifact.preparedPrompt.context.source.name='other.pdf'],
  ['cleanup',p=>p.artifact.cleanup.devicesDestroyed=0],['metadata',p=>p.event.payload.data.elapsedMs++],
  ['stage timestamp',p=>p.artifact.stages[7].elapsedMs++],['SDK reads',p=>p.artifact.sdkReads.reads++],
  ['identity',p=>p.event.runtimeId='other'],['sequence',p=>p.event.seq++],['stage',p=>p.event.stage='reads'],
])test(`malformed result ${name} never commits raw output`,async()=>{
  const h=await accepted(),{pending,task}=await start(h,{maxNewTokens:17});await finish(task,change);await pending;
  assert.equal(h.session.generation(),null);assert.equal(h.session.snapshot().status,'runtime-error');
  assert.equal(h.session.snapshot().error.code,'WORKER_PROTOCOL_ERROR');assert.equal(h.session.snapshot().lifecycle.active,null);privateFree(h.states);
});

for(const [name,change]of [
  ['identity',p=>p.event.runtimeId='other'],['gap',p=>p.event.seq++],['terminal budget',p=>p.event.seq=4096],
  ['stage reorder',p=>p.event.stage='assets'],['wrong unit',p=>p.event.payload.unit='tokens'],
  ['estimated',p=>p.event.payload.estimated=true],['detail shape',p=>p.detail={}],
  ['extra packet',p=>p.extra='PRIVATE'],['payload mismatch',p=>p.event.payload.total=1],
])test(`invalid current progress ${name} latches failure even when adapter catches callback`,async()=>{
  const h=await accepted(),{pending,task}=await start(h,{maxNewTokens:17}),packets=await packetsOf(task),p=structuredClone(packets[0]);change(p);
  try{task.options.onProgress(p);}catch(error){assert.ok(safe('WORKER_PROTOCOL_ERROR')(error));}
  for(const packet of packets.slice(0,-1))task.options.onProgress(packet);task.resolve(packets.at(-1));await pending;
  assert.equal(h.session.generation(),null);assert.equal(h.session.snapshot().error.code,'WORKER_PROTOCOL_ERROR');
  assert.equal(h.session.snapshot().lifecycle.active,null);assert.equal(task.options.signal.aborted,true);
});

test('cancelled A retains accepted query/context for retry B; late A cannot inspect getters or clear B',async()=>{
  const h=await accepted(),s=h.session,context=s.assembleContext(),a=await start(h,{maxNewTokens:17});s.cancel();
  assert.equal(a.task.options.signal.aborted,true);assert.equal(s.context(),context);assert.equal(s.question(),RAW);assert.ok(s.retrieval());
  const b=await start(h,{maxNewTokens:17});let reads=0;
  a.task.options.onProgress({get event(){reads++;throw Error('PRIVATE');}});a.task.resolve({get event(){reads++;throw Error('PRIVATE');}});await a.pending;
  assert.equal(reads,0);assert.equal(b.task.options.signal.aborted,false);assert.equal(s.snapshot().status,'generating');
  await finish(b.task);await b.pending;assert.equal(s.snapshot().status,'unverified-financial-draft');assert.equal(s.context(),context);
});

for(const action of ['clear','clearQuery','select','query','chunk','embed'])test(`${action} discards accepted generation and its persistent query authority`,async()=>{
  const h=await accepted(),s=h.session,a=await start(h,{maxNewTokens:17});await finish(a.task);await a.pending;
  const p=action==='select'?s.select({name:'same-sha.pdf'}):action==='query'?s.query('replacement'):action==='chunk'?s.chunk(CHUNK_OPTIONS):s[action]();
  assert.equal(s.generation(),null);assert.equal(s.generationInspection(),null);assert.equal(s.context(),null);
  if(action==='query')finishQuery(h.queries.at(-1));if(action==='chunk')finishChunk(h.computes.at(-1));if(action==='embed')finishEmbedding(h.embeds.at(-1));await p;
  if(action!=='query')await assert.rejects(s.generate(),safe('INVALID_GENERATION_SESSION'));
});

test('explicit successful context reassembly clears generation and error while a failed reassembly preserves outcomes',async()=>{
  const h=await accepted(),s=h.session,a=await start(h,{maxNewTokens:17});await finish(a.task);await a.pending;
  const before=state(s);s.chunks().chunks[0].segments[0].quote='forged';assert.throws(()=>s.assembleContext());assert.deepEqual(state(s),before);
  s.chunks().chunks[0].segments[0].quote='  PRIVATE_ALPHA\n😀  ';const context=s.assembleContext();
  assert.equal(s.context(),context);assert.equal(s.generation(),null);assert.equal(s.generationInspection(),null);
  assert.equal(s.snapshot().status,'context-not-generated');assert.equal(s.snapshot().error,null);
});

test('default adapter refusal runs before literal import resolution',async()=>{
  const h=await accepted({generate:undefined});let attempts=0;
  const hooks=registerHooks({resolve(specifier,context,next){
    if(specifier.includes('financial-')){attempts++;throw Error('PRIVATE import diagnostic');}return next(specifier,context);
  }});
  try{await assert.rejects(h.session.generate(),safe('GENERATION_UNAVAILABLE'));assert.equal(attempts,0);}
  finally{hooks.deregister();}
});

test('absent accepted query refuses before reading generation settings',async()=>{
  const h=await ready();let reads=0;const before=state(h.session);
  await assert.rejects(h.session.generate({get maxNewTokens(){reads++;throw Error('PRIVATE');}}),safe('INVALID_GENERATION_SESSION'));
  assert.equal(reads,0);assert.deepEqual(state(h.session),before);
});

test('copy and settings are detached before adapter invocation and cannot be retargeted by caller mutation',async()=>{
  const configured={contextWindowTokens:800,maxNewTokens:17},h=await accepted({generationOptions:configured});
  const {pending,task}=await start(h);configured.contextWindowTokens=999;configured.maxNewTokens=3;
  h.session.document().source.name='changed.pdf';h.session.chunks().chunks[0].segments[0].quote='changed';
  assert.equal(task.record.source.source.name,'PRIVATE_SOURCE.pdf');assert.equal(task.record.question,RAW);
  assert.equal(task.record.chunkArtifact.chunks[0].segments[0].quote,'  PRIVATE_ALPHA\n😀  ');
  assert.deepEqual(task.settings,{contextWindowTokens:800,maxNewTokens:17});
  await finish(task);await pending;assert.equal(h.session.generation().preparedPrompt.context.source.name,'PRIVATE_SOURCE.pdf');
});

for(const at of ['constructor settings','call settings','constructor worker','call worker'])test(`${at} getter is owned once and recursive generation cannot start`,async()=>{
  let nested,reads=0;const options={get maxNewTokens(){reads++;nested=assert.rejects(h.session.generate(),safe('INVALID_GENERATION_SESSION'));return 17;}};
  const worker={get workTimeoutMs(){reads++;nested=assert.rejects(h.session.generate(),safe('INVALID_GENERATION_SESSION'));return 50;}};
  const h=await accepted(at==='constructor settings'?{generationOptions:options}:at==='constructor worker'?{generationWorkerOptions:worker}:{});
  const a=await start(h,at==='call settings'?options:{},at==='call worker'?worker:{});await nested;
  assert.equal(reads,1);assert.equal(h.generations.length,1);await finish(a.task);await a.pending;
});

for(const action of ['cancel','clear','clearQuery','select','query','chunk','embed'])test(`original source getter ${action} cannot start generation with revoked input`,async()=>{
  const h=await accepted(),s=h.session;let once=false,p;
  Object.defineProperty(s.document().source,'name',{get(){if(!once){once=true;p=action==='select'?s.select({name:'same-sha.pdf'})
    :action==='query'?s.query('next'):action==='chunk'?s.chunk(CHUNK_OPTIONS):s[action]();}return 'PRIVATE_SOURCE.pdf';}});
  await assert.rejects(s.generate({maxNewTokens:17}),safe('INVALID_GENERATION_SESSION'));assert.equal(h.generations.length,0);
  if(action==='query')finishQuery(h.queries.at(-1));if(action==='chunk')finishChunk(h.computes.at(-1));if(action==='embed')finishEmbedding(h.embeds.at(-1));await p;
});

for(const action of ['cancel','clear','clearQuery','select','query','chunk','embed'])test(`runtime factory ${action} reentry cannot launch the old generation adapter`,async()=>{
  let h,armed=false,n=0,p;h=await accepted({runtimeIdFactory(){if(armed){armed=false;const s=h.session;
    p=action==='select'?s.select({name:'same-sha.pdf'}):action==='query'?s.query('next'):action==='chunk'?s.chunk(CHUNK_OPTIONS):s[action]();}return `factory-${++n}`;}});
  armed=true;await assert.rejects(h.session.generate({maxNewTokens:17}),safe('INVALID_GENERATION_SESSION'));assert.equal(h.generations.length,0);
  if(action==='query')finishQuery(h.queries.at(-1));if(action==='chunk')finishChunk(h.computes.at(-1));if(action==='embed')finishEmbedding(h.embeds.at(-1));await p;
});

for(const position of ['packet','header','payload','detail','result packet','result header','raw receipt','metadata'])
for(const action of ['cancel','clear','clearQuery','select'])test(`${position} getter ${action} cannot commit or return stale generation`,async()=>{
  const h=await accepted(),s=h.session,{pending,task}=await start(h,{maxNewTokens:17}),packets=await packetsOf(task);let p,triggered=false;
  const perform=()=>{if(!triggered){triggered=true;p=action==='select'?s.select({name:'same-sha.pdf'}):s[action]();}};
  let target,key,value;
  if(position==='packet'){target=packets[0];key='event';}
  if(position==='header'){target=packets[0].event;key='stage';}
  if(position==='payload'){target=packets[0].event.payload;key='completed';}
  if(position==='detail'){target=packets[2].detail;key='elapsedMs';}
  if(position==='result packet'){target=packets.at(-1);key='artifact';}
  if(position==='result header'){target=packets.at(-1).event;key='stage';}
  if(position==='raw receipt'){target=packets.at(-1).artifact;key='text';}
  if(position==='metadata'){target=packets.at(-1).event.payload.data;key='elapsedMs';}
  value=target[key];Object.defineProperty(target,key,{get(){perform();return value;}});
  for(const packet of packets.slice(0,-1))task.options.onProgress(packet);task.resolve(packets.at(-1));await pending;await p;
  assert.equal(triggered,true);assert.equal(s.generation(),null);assert.equal(s.generationInspection(),null);assert.equal(s.snapshot().lifecycle.active,null);
  if(action==='cancel'){assert.equal(s.question(),RAW);assert.ok(s.retrieval());}
});

for(const position of ['header','payload','detail','result'])test(`${position} callback reentry closes the current attempt even if caught`,async()=>{
  const h=await accepted(),{pending,task}=await start(h,{maxNewTokens:17}),packets=await packetsOf(task);let triggered=false;
  const target=position==='header'?packets[0].event:position==='payload'?packets[0].event.payload:position==='detail'?packets[2].detail:packets.at(-1).artifact;
  const key=position==='header'?'stage':position==='payload'?'completed':position==='detail'?'elapsedMs':'text',value=target[key];
  Object.defineProperty(target,key,{get(){if(!triggered){triggered=true;try{task.options.onProgress(packets[0]);}catch(error){assert.ok(safe('WORKER_PROTOCOL_ERROR')(error));}}return value;}});
  for(const packet of packets.slice(0,-1))try{task.options.onProgress(packet);}catch(error){assert.ok(safe('WORKER_PROTOCOL_ERROR')(error));}
  task.resolve(packets.at(-1));await pending;assert.equal(h.session.generation(),null);assert.equal(h.session.snapshot().error.code,'WORKER_PROTOCOL_ERROR');
  assert.equal(task.options.signal.aborted,true);
});

test('packet/event/payload/detail accessors have one observation and last progress is deeply frozen',async()=>{
  const h=await accepted(),{pending,task}=await start(h,{maxNewTokens:17}),packets=await packetsOf(task),reads=new Map();
  const observe=(value,name)=>{for(const key of Object.keys(value)){const original=value[key],id=`${name}.${key}`;
    Object.defineProperty(value,key,{get(){reads.set(id,(reads.get(id)??0)+1);assert.equal(reads.get(id),1,id);return original;}});}};
  const p=packets[2];observe(p.event.payload,'payload');observe(p.detail,'detail');observe(p.event,'event');observe(p,'packet');
  for(const packet of packets.slice(0,-1))task.options.onProgress(packet);task.resolve(packets.at(-1));await pending;
  assert.equal(h.session.snapshot().status,'unverified-financial-draft');assert.equal(reads.size,21);frozen(h.session.generationProgress());
});

for(const [name,change]of [
  ['byte total',p=>p.detail.totalBytes++],['byte scalar correspondence',p=>p.event.payload.completed++],
  ['byte header stage',p=>p.event.stage='sdk'],['byte detail stage',p=>p.detail.stage='consume'],
  ['unbounded elapsed',p=>{p.detail.elapsedMs=300001;}],['wrong asset',p=>p.detail.assetIndex=8],
])test(`${name} refuses before a valid result can commit`,async()=>{
  const h=await accepted(),{pending,task}=await start(h,{maxNewTokens:17}),packets=await packetsOf(task),changed=structuredClone(packets[2]);change(changed);
  task.options.onProgress(packets[0]);task.options.onProgress(packets[1]);
  assert.throws(()=>task.options.onProgress(changed),safe('WORKER_PROTOCOL_ERROR'));
  task.resolve(packets.at(-1));await pending;assert.equal(h.session.generation(),null);assert.equal(h.session.snapshot().error.code,'WORKER_PROTOCOL_ERROR');
});

for(const omitted of ['prepare','consume'])test(`complete native receipt cannot replace missing observed ${omitted} bytes`,async()=>{
  const h=await accepted(),{pending,task}=await start(h,{maxNewTokens:17}),packets=await packetsOf(task);let seq=0;
  for(const packet of packets.slice(0,-1)){if(packet.detail?.stage===omitted)continue;packet.event.seq=++seq;
    try{task.options.onProgress(packet);}catch(error){assert.ok(safe('WORKER_PROTOCOL_ERROR')(error));}}
  packets.at(-1).event.seq=++seq;task.resolve(packets.at(-1));await pending;
  assert.equal(h.session.generation(),null);assert.equal(h.session.snapshot().error.code,'WORKER_PROTOCOL_ERROR');
});

for(const at of ['start','progress','accepted','refused'])test(`throwing ${at} subscriber cannot strand work or leave accepted output`,async()=>{
  let armed=false;const h=await accepted({onState(state){if(!armed)return;
    const trigger=at==='start'?state.status==='generating'&&state.lifecycle.active.lastSeq===0
      :at==='progress'?state.status==='generating'&&state.lifecycle.active.lastSeq>0
      :at==='accepted'?state.status==='unverified-financial-draft':state.status==='financial-output-refused';
    if(trigger)throw Error('PRIVATE question source diagnostic');}});armed=true;
  const pending=h.session.generate({maxNewTokens:at==='refused'?3:17});await tick();
  if(at==='start')assert.equal(h.generations.length,0);
  else{const task=h.generations.at(-1),packets=await packetsOf(task);for(const p of packets.slice(0,-1))try{task.options.onProgress(p);}catch{}
    task.resolve(packets.at(-1));}await pending;
  assert.equal(h.session.snapshot().lifecycle.active,null);assert.equal(h.session.generation(),null);
  assert.equal(h.session.generationInspection().status,'refused');assert.equal(h.session.snapshot().status,'runtime-error');privateFree(h.states);
});

for(const at of ['start','progress','accepted'])
for(const action of ['cancel','clear','clearQuery','select'])test(`${at} subscriber ${action} observes committed ownership and cannot resurrect old output`,async()=>{
  let armed=false,s,p,acted=false;const h=await accepted({onState(state){if(!armed||acted)return;
    const trigger=at==='start'?state.status==='generating'&&state.lifecycle.active.lastSeq===0
      :at==='progress'?state.status==='generating'&&state.lifecycle.active.lastSeq>0:state.status==='unverified-financial-draft';
    if(trigger){acted=true;if(at==='accepted'){assert.ok(s.generation());assert.ok(s.generationInspection().artifact);assert.equal(state.lifecycle.active,null);}
      p=action==='select'?s.select({name:'same-sha.pdf'}):s[action]();}}});s=h.session;armed=true;
  const pending=s.generate({maxNewTokens:17});await tick();
  if(at==='start')assert.equal(h.generations.length,0);
  else{const task=h.generations.at(-1);await finish(task);}await pending;await p;
  assert.equal(acted,true);if(at==='accepted'&&action==='cancel')assert.ok(s.generation());else assert.equal(s.generation(),null);
});

for(const action of ['generate','query','chunk','embed'])test(`active generation refuses ${action} recursion without changing current state`,async()=>{
  const h=await accepted(),a=await start(h,{maxNewTokens:17}),before=state(h.session);
  await assert.rejects(h.session[action](action==='query'?'next':{}));assert.deepEqual(state(h.session),before);
  assert.equal(h.generations.length,1);await finish(a.task);await a.pending;
});

test('terminal subscriber recursive generation refuses without changing an accepted outer commit',async()=>{
  let s,recursive;const h=await accepted({onState(state){if(state.status==='unverified-financial-draft')
    recursive=assert.rejects(s.generate(),safe('INVALID_GENERATION_SESSION'));}});s=h.session;
  const a=await start(h,{maxNewTokens:17});await finish(a.task);await a.pending;await recursive;
  assert.equal(s.snapshot().status,'unverified-financial-draft');assert.ok(s.generation());assert.equal(h.generations.length,1);
});

test('abort listener cannot start replacement underneath cancellation, but B can retry afterwards',async()=>{
  const h=await accepted(),s=h.session,a=await start(h,{maxNewTokens:17});let nested;
  a.task.options.signal.addEventListener('abort',()=>{nested=assert.rejects(s.generate(),safe('INVALID_GENERATION_SESSION'));s.clearQuery();});
  s.cancel();await nested;assert.equal(s.question(),RAW);assert.ok(s.retrieval());
  const b=await start(h,{maxNewTokens:17});await finish(b.task);await b.pending;a.task.reject(Error('PRIVATE'));await a.pending;
  assert.ok(s.generation());assert.equal(b.task.options.signal.aborted,false);
});

test('same SHA selection advances epoch and permanently rejects previous generation receipt',async()=>{
  const h=await accepted(),s=h.session,a=await start(h,{maxNewTokens:17}),packets=await packetsOf(a.task),oldEpoch=a.task.options.identity.documentEpoch;
  await s.select({name:'same-sha.pdf'});assert.equal(s.document().source.sha256,SHA);assert.ok(s.snapshot().lifecycle.documentEpoch>oldEpoch);
  a.task.resolve(packets.at(-1));await a.pending;assert.equal(s.generation(),null);assert.equal(s.question(),null);
});

for(const action of ['extract','chunk','embed'])test(`clearQuery leaves unrelated active ${action} ownership intact`,async()=>{
  let parser;const h=await ready(action==='extract'?{extract:async file=>file.name==='pending.pdf'?(parser=deferred()).promise:extracted(file.name)}:{}),s=h.session;
  const p=action==='extract'?s.select({name:'pending.pdf'}):action==='chunk'?s.chunk(CHUNK_OPTIONS):s.embed(),before=s.snapshot();s.clearQuery();
  assert.deepEqual(s.snapshot(),before);
  if(action==='extract')parser.resolve(extracted('pending.pdf'));if(action==='chunk')finishChunk(h.computes.at(-1));if(action==='embed')finishEmbedding(h.embeds.at(-1));await p;
  assert.equal(s.snapshot().lifecycle.active,null);
});

test('model abstention is still unverified and preserves the pure inspector generationMode',async()=>{
  const h=await accepted(),a=await start(h,{maxNewTokens:17});await finish(a.task,p=>{p.artifact.text='{"answer":"cannot establish","citations":[],"insufficient_evidence":true}';});await a.pending;
  assert.equal(h.session.generationInspection().artifact.disposition,'abstained');assert.equal(h.session.generationInspection().artifact.financialCorrectness,'unestablished');
  assert.equal(h.session.generationInspection().artifact.generationMode,'not-run');assert.equal(h.session.snapshot().status,'unverified-financial-draft');
});

for(const outcome of ['cancelled','runtime-error','financial-output-refused'])test(`context reassembly after ${outcome} uses historical query authority and clears generation error`,async()=>{
  const h=await accepted(),s=h.session,a=await start(h,{maxNewTokens:outcome==='financial-output-refused'?3:17});
  if(outcome==='cancelled'){s.cancel();a.task.reject(Error('PRIVATE'));}
  if(outcome==='runtime-error')a.task.reject(Error('PRIVATE'));
  if(outcome==='financial-output-refused')await finish(a.task);await a.pending;
  assert.equal(s.snapshot().status,outcome);const lifecycle=s.snapshot().lifecycle;
  const context=s.assembleContext();assert.equal(context.question,RAW);assert.equal(s.context(),context);
  assert.equal(s.generation(),null);assert.equal(s.generationInspection(),null);assert.equal(s.generationProgress(),null);
  assert.equal(s.snapshot().error,null);assert.equal(s.snapshot().status,'context-not-generated');assert.deepEqual(s.snapshot().lifecycle,lifecycle);
});

for(const at of ['progress packet','progress header','progress payload','result packet','result header','result payload'])
test(`${at} cancellation is rechecked before descending into the next private field boundary`,async()=>{
  const h=await accepted(),s=h.session,a=await start(h,{maxNewTokens:17}),packets=await packetsOf(a.task);let reads=0;
  const final=packets.at(-1),first=packets[0];let cancelling,key,forbidden,nextKey;
  if(at==='progress packet'){cancelling=first;key='detail';forbidden=first.event;nextKey='stage';}
  if(at==='progress header'){cancelling=first.event;key='stage';forbidden=first.event.payload;nextKey='completed';}
  if(at==='progress payload'){cancelling=packets[2].event.payload;key='completed';forbidden=packets[2].detail;nextKey='elapsedMs';}
  if(at==='result packet'){cancelling=final;key='artifact';forbidden=final.event;nextKey='stage';}
  if(at==='result header'){cancelling=final.event;key='stage';forbidden=final.event.payload;nextKey='data';}
  if(at==='result payload'){cancelling=final.event.payload;key='data';forbidden=final.artifact;nextKey='text';}
  const original=cancelling[key],next=forbidden[nextKey];Object.defineProperty(cancelling,key,{get(){s.cancel();return original;}});
  Object.defineProperty(forbidden,nextKey,{get(){reads++;return next;}});
  for(const packet of packets.slice(0,-1))a.task.options.onProgress(packet);a.task.resolve(final);await a.pending;
  assert.equal(reads,0);assert.equal(s.generation(),null);assert.equal(s.snapshot().status,'cancelled');
});

test('adapter rejection cannot forward a mutable worker error message into accepted failure state',async()=>{
  const h=await accepted(),a=await start(h,{maxNewTokens:17}),bad=new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');
  bad.message='PRIVATE question and source.pdf';a.task.reject(bad);assert.equal(await a.pending,undefined);
  const expected=new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');
  assert.deepEqual(h.session.snapshot().error,{code:expected.code,message:expected.message});
  assert.deepEqual(h.session.generationInspection().error,h.session.snapshot().error);
  assert.deepEqual(h.session.snapshot().lifecycle.terminal.payload,h.session.snapshot().error);
  assert.equal(a.task.options.signal.aborted,true);assert.equal(h.session.snapshot().lifecycle.active,null);privateFree(h.states);
});

test('throwing adapter error code getter is normalized and closes the still-owned generation attempt',async()=>{
  const h=await accepted(),a=await start(h,{maxNewTokens:17}),bad=new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');let reads=0;
  Object.defineProperty(bad,'code',{get(){reads++;throw Error('PRIVATE getter diagnostic');}});
  a.task.reject(bad);assert.equal(await a.pending,undefined);assert.equal(reads,1);
  assert.equal(h.session.snapshot().status,'runtime-error');assert.equal(h.session.snapshot().lifecycle.active,null);
  assert.equal(a.task.options.signal.aborted,true);assert.equal(h.session.generation(),null);
  assert.equal(h.session.generationInspection().status,'refused');privateFree(h.states);
});

test('adapter error message getter is never read and cannot clear then resurrect session state',async()=>{
  const h=await accepted(),a=await start(h,{maxNewTokens:17}),bad=new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');let reads=0;
  Object.defineProperty(bad,'message',{get(){reads++;h.session.clear();return 'PRIVATE';}});
  a.task.reject(bad);assert.equal(await a.pending,undefined);assert.equal(reads,0);
  assert.equal(h.session.snapshot().status,'runtime-error');assert.ok(h.session.document());
  assert.equal(h.session.snapshot().lifecycle.active,null);assert.equal(a.task.options.signal.aborted,true);privateFree(h.states);
});

for(const code of [null,undefined,1,Symbol('PRIVATE'),()=>{},
  {toString(){throw Error('PRIVATE ToPropertyKey diagnostic');}},
  {[Symbol.toPrimitive](){throw Error('PRIVATE ToPropertyKey diagnostic');}},'PRIVATE_UNKNOWN'])
test(`GenerationSessionError ignores noncanonical ${typeof code} codes without coercion`,()=>{
  const error=new GenerationSessionError(code);assert.equal(error.code,'GENERATION_SESSION_FAILED');
  assert.equal(error.message,'The financial generation session did not complete safely.');assert.equal(Object.hasOwn(error,'cause'),false);
});

for(const action of ['clear','clearQuery','cancel','select'])test(`adapter error code getter ${action} cannot overwrite the revoked owner`,async()=>{
  const h=await accepted(),a=await start(h,{maxNewTokens:17}),bad=new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');let p,reads=0;
  Object.defineProperty(bad,'code',{get(){reads++;p=action==='select'?h.session.select({name:'same-sha.pdf'}):h.session[action]();return 'WORKER_PROTOCOL_ERROR';}});
  a.task.reject(bad);assert.equal(await a.pending,undefined);await p;assert.equal(reads,1);
  assert.equal(h.session.generation(),null);assert.equal(h.session.generationInspection(),null);
  assert.equal(h.session.snapshot().error,null);assert.equal(h.session.snapshot().lifecycle.active,null);
  assert.equal(h.session.snapshot().status,action==='clear'?'idle':action==='clearQuery'?'embedded-not-retrieved'
    :action==='cancel'?'cancelled':'extracted-not-indexed');privateFree(h.states);
});

test('adapter error code getter cancellation and retry B cannot let failed A clear B ownership',async()=>{
  const h=await accepted(),a=await start(h,{maxNewTokens:17}),bad=new FinancialGenerationWorkerError('WORKER_PROTOCOL_ERROR');let b;
  Object.defineProperty(bad,'code',{get(){h.session.cancel();b=h.session.generate({maxNewTokens:17});return 'WORKER_PROTOCOL_ERROR';}});
  a.task.reject(bad);assert.equal(await a.pending,undefined);await tick();const task=h.generations.at(-1);
  assert.notEqual(task,a.task);assert.equal(task.options.signal.aborted,false);assert.equal(h.session.snapshot().status,'generating');
  assert.equal(h.session.snapshot().error,null);await finish(task);await b;assert.equal(h.session.snapshot().status,'unverified-financial-draft');
});
