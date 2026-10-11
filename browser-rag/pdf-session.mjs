import {createController} from './protocol.mjs';
import {ComputeError} from './compute-source.mjs';
import {projectEmbeddingInput,createEmbeddingStageGuard,copyEmbeddingArtifact,
  embeddingReceipt,EmbeddingWorkerError} from './embedding-source.mjs';
import {copyQueryPassages,createQueryStageGuard,copyQueryResult,queryResultReceipt,
  QueryWorkerError} from './query-source.mjs';
import {assembleProvenanceContext,ContextError} from './context-contract.mjs';

const SAFE_CODES = new Set(['INVALID_RECORD','INVALID_INPUT','FILE_TOO_LARGE','INVALID_PDF',
  'PARSER_VERSION_UNSUPPORTED','WORKER_UNAVAILABLE','INVALID_LIMITS','EXTRACTION_LIMIT','EMPTY_DOCUMENT',
  'PDF_PASSWORD_REQUIRED','EXTRACTION_FAILED','CLEANUP_FAILED','ABORTED']);

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>record(value)&&Reflect.ownKeys(value).length===keys.length
  &&Reflect.ownKeys(value).every(key=>keys.includes(key));
const COUNT_KEYS=['chunks','outputUtf16','fragments'];
const IDENTITY_KEYS=['protocolVersion','runtimeId','operationId','documentEpoch','operation'];
const EVENT_KEYS=[...IDENTITY_KEYS,'kind','stage','seq','payload'];
const DOWNLOAD_BYTES=113629084;
const fields=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]]));
const QUERY_OPTION_KEYS=['topK','workerFactory','readyTimeoutMs','workTimeoutMs','identity','signal','onProgress'];
function queryOptionsSnapshot(value){
  // Plain option records may come from another window/realm. Reserved adapter
  // fields are read once but are always replaced with session-owned values.
  const prototype=value!==null&&typeof value==='object'?Object.getPrototypeOf(value):undefined;
  const plain=prototype===null||(prototype&&Object.getPrototypeOf(prototype)===null
    &&Object.getOwnPropertyDescriptor(prototype,'constructor')?.value?.name==='Object');
  if(!plain||Array.isArray(value))throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG');
  const keys=Reflect.ownKeys(value);
  if(keys.some(key=>!QUERY_OPTION_KEYS.includes(key)))
    throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG');
  return fields(value,keys);
}

// The adapter validates the full artifact. This small boundary guard prevents
// accidental source/chunk data from ever entering the lifecycle controller.
function chunkReceipt(result,source) {
  if(!exact(result,['event','artifact'])||result.event?.kind!=='result'||result.event.stage!=='index'
      ||!exact(result.event.payload,['data']))return false;
  const data=result.event.payload.data,artifact=result.artifact;
  return exact(data,['sourceSha256','parserVersion','pageCount','status','chunkerVersion','counts'])
    &&data.sourceSha256===source.source.sha256&&data.parserVersion===source.parser.version
    &&data.pageCount===source.numPages&&data.status==='chunked-not-embedded'
    &&data.chunkerVersion==='page-parser-order-v1'&&exact(data.counts,COUNT_KEYS)
    &&COUNT_KEYS.every(key=>Number.isSafeInteger(data.counts[key])&&data.counts[key]>0)
    &&record(artifact)&&artifact.source?.sha256===data.sourceSha256
    &&artifact.parser?.version===data.parserVersion&&artifact.numPages===data.pageCount
    &&artifact.status===data.status&&artifact.chunker?.version===data.chunkerVersion
    &&exact(artifact.counts,COUNT_KEYS)&&COUNT_KEYS.every(key=>artifact.counts[key]===data.counts[key])
    &&Array.isArray(artifact.chunks)&&artifact.chunks.length===data.counts.chunks;
}

export function createPdfSession({extract,parserOptions={},compute,computeOptions={},embed:embeddingAdapter,
  embeddingOptions={},query:queryAdapter,queryOptions={},onState=()=>{},
  runtimeId=crypto.randomUUID(),runtimeIdFactory=()=>crypto.randomUUID()}) {
  if(typeof extract!=='function') throw new TypeError('A parser adapter is required');
  const controller=createController(runtimeId);
  let source=null,chunks=null,embeddings=null,question=null,queryEmbedding=null,retrieval=null;
  let aborter=null,status='idle',error=null,invalidating=false,queryRevision=0;
  let acceptedQuery=null,contextArtifact=null,assemblingContext=false;
  const snapshot=()=>Object.freeze({status,error,lifecycle:controller.snapshot()});
  const notify=()=>onState(snapshot());
  const discardQuery=()=>{queryRevision++;question=null;queryEmbedding=null;retrieval=null;
    acceptedQuery=null;contextArtifact=null;};
  function ownsContext(owner){
    if(owner===null||invalidating||acceptedQuery!==owner||queryRevision!==owner.revision
        ||source!==owner.input.source||chunks!==owner.input.chunkArtifact||embeddings!==owner.input.embeddingArtifact
        ||question!==owner.input.question||queryEmbedding!==owner.input.queryResult.query
        ||retrieval!==owner.input.queryResult.retrieval
        ||!['query-candidates-only','context-not-generated'].includes(status))return false;
    const lifecycle=controller.snapshot(),terminal=lifecycle.terminal;
    return lifecycle.active===null&&lifecycle.runtimeId===owner.identity.runtimeId
      &&lifecycle.documentEpoch===owner.identity.documentEpoch&&terminal!==null
      &&IDENTITY_KEYS.every(key=>terminal[key]===owner.identity[key])
      &&terminal.kind==='result'&&terminal.stage==='rank'&&terminal.seq===owner.terminal.seq;
  }
  function invalidate(replace,retainSource=false,nextStatus='idle',retainChunks=false,retainEmbeddings=false) {
    invalidating=true;
    try {
      // Commit the revoked state and detach the old owner before synchronous
      // abort listeners run. Those listeners cannot start a replacement beneath
      // this transition; direct calls after it returns can retry normally.
      if(replace) controller.replaceDocument(); else controller.cancel();
      const ownedAborter=aborter;aborter=null;
      discardQuery();if(!retainEmbeddings)embeddings=null;if(!retainChunks)chunks=null;if(!retainSource)source=null;error=null;status=nextStatus;
      ownedAborter?.abort();
    } finally { invalidating=false; }
  }
  return {
    snapshot,
    document:()=>source,
    chunks:()=>chunks,
    embeddings:()=>embeddings,
    question:()=>question,
    queryEmbedding:()=>queryEmbedding,
    retrieval:()=>retrieval,
    context:()=>contextArtifact,
    assembleContext(){
      const owner=acceptedQuery;
      if(assemblingContext||!ownsContext(owner))throw new ContextError('CONTEXT_FAILED');
      assemblingContext=true;
      try{
        let artifact;
        try{artifact=assembleProvenanceContext(owner.input);}
        catch(cause){
          if(!ownsContext(owner))throw new ContextError('CONTEXT_FAILED');
          throw new ContextError(cause instanceof ContextError?cause.code:undefined);
        }
        // The contract may read mutable caller source/chunk getters. Recheck
        // their query owner before committing, and again after subscribers run.
        if(!ownsContext(owner))throw new ContextError('CONTEXT_FAILED');
        contextArtifact=artifact;status='context-not-generated';
        try{notify();}catch{throw new ContextError('CONTEXT_FAILED');}
        if(!ownsContext(owner)||contextArtifact!==artifact)throw new ContextError('CONTEXT_FAILED');
        return artifact;
      }finally{assemblingContext=false;}
    },
    cancel(){ if(invalidating||controller.snapshot().active===null) return;
      const querying=status==='querying';
      invalidate(false,querying||['chunking','embedding'].includes(status),'cancelled',querying||status==='embedding',querying);notify(); },
    clear(){ if(invalidating)return;invalidate(true);notify(); },
    clearQuery(){
      if(invalidating)return;
      // A clear also revokes a preflight currently reading an option getter,
      // without touching an unrelated parser/chunker/passage encoder.
      queryRevision++;
      const active=controller.snapshot().active;
      if(active!==null&&active.operation!=='query')return;
      if(active===null&&question===null&&queryEmbedding===null&&retrieval===null)return;
      invalidate(false,true,embeddings?'embedded-not-retrieved':status,true,true);notify();
    },
    async query(rawQuestion,options={}){
      const capturedRevision=queryRevision,ownedSource=source,ownedChunks=chunks,ownedEmbeddings=embeddings;
      const preflightOwned=()=>!invalidating&&queryRevision===capturedRevision&&source===ownedSource
        &&chunks===ownedChunks&&embeddings===ownedEmbeddings&&controller.snapshot().active===null;
      let configured,input,passages,incarnation;
      try{
        if(!preflightOwned()||source===null||chunks===null||embeddings===null
            ||typeof queryAdapter!=='function'||typeof runtimeIdFactory!=='function'
            ||typeof rawQuestion!=='string'||rawQuestion.trim().length===0||rawQuestion.length>4096)
          throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG');
        configured={...queryOptionsSnapshot(queryOptions),...queryOptionsSnapshot(options)};
        if(configured.topK===undefined)configured.topK=5;
        if(!Number.isSafeInteger(configured.topK)||configured.topK<1||configured.topK>512
            ||(configured.workerFactory!==undefined&&typeof configured.workerFactory!=='function')
            ||['readyTimeoutMs','workTimeoutMs'].some(key=>configured[key]!==undefined
              &&(!Number.isSafeInteger(configured[key])||configured[key]<1||configured[key]>2147483647)))
          throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG');
        const selectedSourceSha256=ownedSource.source.sha256;
        input=projectEmbeddingInput(ownedChunks);
        if(input.source.sha256!==selectedSourceSha256)throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG');
        passages=copyQueryPassages(ownedEmbeddings,input);
        if(!preflightOwned())throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG');
        incarnation=runtimeIdFactory();
        if(typeof incarnation!=='string'||incarnation.length>256||incarnation.trim().length===0||!preflightOwned())
          throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG');
        controller.replaceRuntime(incarnation);
      }catch{throw new QueryWorkerError('INVALID_QUERY_WORKER_CONFIG');}
      const identity=controller.begin('query'),ownedAborter=new AbortController();aborter=ownedAborter;
      const stages=createQueryStageGuard(input.counts.chunks),topK=configured.topK;
      let seq=0;discardQuery();question=rawQuestion;error=null;status='querying';
      const ownsOperation=()=>{
        const active=controller.snapshot().active;
        return aborter===ownedAborter&&!ownedAborter.signal.aborted&&active!==null
          &&IDENTITY_KEYS.every(key=>active[key]===identity[key]);
      };
      function checkedEvent(raw,kind){
        if(!exact(raw,EVENT_KEYS))throw new QueryWorkerError('WORKER_PROTOCOL_ERROR');
        const event=fields(raw,EVENT_KEYS);
        if(event.kind!==kind||!IDENTITY_KEYS.every(key=>event[key]===identity[key])
            ||!Number.isSafeInteger(event.seq)||event.seq<=seq||event.seq<1
            ||(kind==='progress'&&event.seq===Number.MAX_SAFE_INTEGER))
          throw new QueryWorkerError('WORKER_PROTOCOL_ERROR');
        return event;
      }
      notify();
      if(!ownsOperation())return;
      try{
        const result=await queryAdapter(input,passages,rawQuestion,{...configured,identity,signal:ownedAborter.signal,
          onProgress:raw=>{
            if(!ownsOperation())return;
            try{
              const event=checkedEvent(raw,'progress');
              if(!exact(event.payload,['completed','total','unit','estimated']))return;
              const payload=fields(event.payload,['completed','total','unit','estimated']);
              if(event.stage==='download'&&payload.total!==DOWNLOAD_BYTES)return;
              if(!ownsOperation()||event.seq<=seq)return;
              event.payload=stages.accept(event.stage,payload);
              if(controller.accept(event).accepted){seq=event.seq;notify();}
            }catch{ /* malformed/stale progress consumes neither stage nor sequence */ }
          }});
        if(!ownsOperation())return;
        if(!exact(result,['event','artifact']))throw new QueryWorkerError('WORKER_PROTOCOL_ERROR');
        const event=checkedEvent(result.event,'result');
        if(event.stage!=='rank'||!exact(event.payload,['data']))throw new QueryWorkerError('WORKER_PROTOCOL_ERROR');
        const artifact=copyQueryResult(result.artifact,input,passages,topK,stages.downloadTotal,event.payload.data);
        stages.assertComplete(artifact.query.counts.totalTokens);
        event.payload={data:queryResultReceipt(artifact)};
        if(!ownsOperation())return;
        // The exact ranker is recomputed against captured inputs before one
        // synchronous metadata/artifact/status commit and any subscriber call.
        if(controller.accept(event).accepted){queryEmbedding=artifact.query;retrieval=artifact.retrieval;
          // Retain the original eight-field input privately. A future prompt
          // adapter must receive this capture, never the assembled context.
          const terminal=controller.snapshot().terminal;
          acceptedQuery=Object.freeze({revision:queryRevision,identity,terminal,
            input:Object.freeze({source:ownedSource,chunkArtifact:ownedChunks,embeddingArtifact:ownedEmbeddings,
              question:rawQuestion,queryResult:Object.freeze({query:artifact.query,retrieval:artifact.retrieval}),
              topK,queryDownloadTotal:stages.downloadTotal,queryMetadata:terminal.payload.data})});
          status='query-candidates-only';aborter=null;notify();}
        else throw new QueryWorkerError('WORKER_PROTOCOL_ERROR');
      }catch(cause){
        if(!ownsOperation())return;
        let code;try{code=cause?.code;}catch{ /* untrusted diagnostic getters stay private */ }
        if(!ownsOperation())return;
        const safe=new QueryWorkerError(code),event={...identity,kind:'error',stage:stages.stage,seq:seq+1,
          payload:{code:safe.code,message:safe.message}};
        if(controller.accept(event).accepted){discardQuery();error=Object.freeze({...event.payload});
          status='runtime-error';aborter=null;notify();}
      }
    },
    async embed(options={}){
      if(invalidating||source===null||chunks===null||controller.snapshot().active!==null
          ||typeof embeddingAdapter!=='function'||typeof runtimeIdFactory!=='function')
        throw new EmbeddingWorkerError('INVALID_EMBEDDING_CONFIG');
      // Snapshot the accepted chunk input once. The adapter only sees this
      // detached, frozen projection; attribution remains in the source artifact.
      const input=projectEmbeddingInput(chunks);
      try{
        const incarnation=runtimeIdFactory();
        if(typeof incarnation!=='string'||incarnation.length>256||incarnation.trim().length===0)
          throw new EmbeddingWorkerError('INVALID_EMBEDDING_CONFIG');
        controller.replaceRuntime(incarnation);
      }catch{throw new EmbeddingWorkerError('INVALID_EMBEDDING_CONFIG');}
      const identity=controller.begin('embed'),ownedAborter=new AbortController();aborter=ownedAborter;
      const stages=createEmbeddingStageGuard(input.counts.chunks);
      let seq=0;discardQuery();embeddings=null;error=null;status='embedding';
      const ownsOperation=()=>{
        const active=controller.snapshot().active;
        return aborter===ownedAborter&&!ownedAborter.signal.aborted&&active!==null
          &&IDENTITY_KEYS.every(key=>active[key]===identity[key]);
      };
      function checkedEvent(raw,kind){
        if(!exact(raw,EVENT_KEYS))throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR');
        const event=fields(raw,EVENT_KEYS);
        if(event.kind!==kind||!IDENTITY_KEYS.every(key=>event[key]===identity[key])
            ||!Number.isSafeInteger(event.seq)||event.seq<=seq||event.seq<1
            ||(kind==='progress'&&event.seq===Number.MAX_SAFE_INTEGER))
          throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR');
        return event;
      }
      notify();
      try{
        const result=await embeddingAdapter(input,{...embeddingOptions,...options,identity,signal:ownedAborter.signal,
          onProgress:raw=>{
            if(!ownsOperation())return;
            try{
              const event=checkedEvent(raw,'progress');
              if(!exact(event.payload,['completed','total','unit','estimated']))return;
              const payload=fields(event.payload,['completed','total','unit','estimated']);
              if(event.stage==='download'&&payload.total!==DOWNLOAD_BYTES)return;
              // Header, sequence and primitive snapshots are valid BEFORE the
              // stage guard advances. A stale/invalid packet consumes nothing.
              if(!ownsOperation())return;
              event.payload=stages.accept(event.stage,payload);
              if(controller.accept(event).accepted){seq=event.seq;notify();}
            }catch{ /* untrusted progress cannot publish diagnostics or consume sequence */ }
          }});
        if(!ownsOperation())return;
        if(!exact(result,['event','artifact']))throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR');
        const event=checkedEvent(result.event,'result');
        if(event.stage!=='encode'||!exact(event.payload,['data']))throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR');
        stages.assertComplete();
        const artifact=copyEmbeddingArtifact(result.artifact,input,stages.downloadTotal,event.payload.data);
        event.payload={data:embeddingReceipt(artifact)};
        if(!ownsOperation())return;
        // Original identity/kind/stage/sequence survive validation. Commit all
        // owned state synchronously before a subscriber can reenter the session.
        if(controller.accept(event).accepted){embeddings=artifact;status='embedded-not-retrieved';aborter=null;notify();}
        else throw new EmbeddingWorkerError('WORKER_PROTOCOL_ERROR');
      }catch(cause){
        if(!ownsOperation())return;
        let code;try{code=cause?.code;}catch{ /* private thrown getters stay private */ }
        const safe=new EmbeddingWorkerError(code);
        const event={...identity,kind:'error',stage:stages.stage,seq:seq+1,payload:{code:safe.code,message:safe.message}};
        if(controller.accept(event).accepted){embeddings=null;error=Object.freeze({...event.payload});status='runtime-error';aborter=null;notify();}
      }
    },
    async chunk(options={}){
      if(invalidating||source===null||controller.snapshot().active!==null||typeof compute!=='function'
          ||typeof runtimeIdFactory!=='function')throw new ComputeError('INVALID_COMPUTE_CONFIG');
      // Validate the incarnation before changing accepted state. The existing
      // controller rejects every previously used ID, including A -> B -> A.
      try{
        const incarnation=runtimeIdFactory();
        if(typeof incarnation!=='string'||incarnation.length>256||incarnation.trim().length===0)
          throw new ComputeError('INVALID_COMPUTE_CONFIG');
        controller.replaceRuntime(incarnation);
      }catch{throw new ComputeError('INVALID_COMPUTE_CONFIG');}
      const identity=controller.begin('ingest'),ownedSource=source;
      const ownedAborter=new AbortController();aborter=ownedAborter;
      let seq=0;discardQuery();chunks=null;embeddings=null;error=null;status='chunking';notify();
      const failure=code=>({...identity,kind:'error',stage:'index',seq:seq+1,
        payload:{code:code.code,message:code.message}});
      try{
        const result=await compute(ownedSource,{...computeOptions,identity,signal:ownedAborter.signal,
          onProgress:event=>{
            // Reserve the last safe sequence for a terminal so even an adapter
            // refusal after progress can close this operation with a safe error.
            if(event?.kind!=='progress'||event.stage!=='index'||event.seq===Number.MAX_SAFE_INTEGER)return;
            if(controller.accept(event).accepted){seq=event.seq;notify();}
          },chunkOptions:options});
        if(!chunkReceipt(result,ownedSource))throw new ComputeError('WORKER_PROTOCOL_ERROR');
        // Preserve the original worker terminal. No await or notification can
        // interleave acceptance with the artifact/status commit.
        if(controller.accept(result.event).accepted){
          chunks=result.artifact;status='chunked-not-embedded';aborter=null;notify();
        }else if(!ownedAborter.signal.aborted){
          throw new ComputeError('WORKER_PROTOCOL_ERROR');
        }
      }catch(cause){
        const safe=new ComputeError(cause?.code);
        if(controller.accept(failure(safe)).accepted){
          error=Object.freeze({code:safe.code,message:safe.message});status='runtime-error';aborter=null;notify();
        }
      }
    },
    async select(file){
      if(invalidating)throw new ComputeError('INVALID_COMPUTE_CONFIG');
      invalidate(true);
      const identity=controller.begin('ingest');
      const ownedAborter=new AbortController(); aborter=ownedAborter;
      let seq=0;status='parsing';notify();
      const event=(kind,payload)=>({...identity,kind,stage:'parse',seq:++seq,payload});
      try {
        const candidate=await extract(file,{...parserOptions,signal:ownedAborter.signal,
          onProgress:progress=>{
            if(controller.accept(event('progress',progress)).accepted) notify();
          }});
        const metadata={sourceSha256:candidate.source.sha256,parserVersion:candidate.parser.version,
          pageCount:candidate.numPages,status:'extracted-not-indexed'};
        // No await between acceptance and source commit. The source itself never
        // enters the lifecycle controller's bounded metadata state.
        if(controller.accept(event('result',{data:metadata})).accepted){
          source=candidate;status='extracted-not-indexed';aborter=null;notify();
        }
      } catch(cause){
        const code=SAFE_CODES.has(cause?.code)?cause.code:'PDF_PARSE_ERROR';
        const message='PDF extraction did not complete. No source was committed.';
        if(controller.accept(event('error',{code,message})).accepted){
          error=Object.freeze({code,message});status='runtime-error';aborter=null;notify();
        }
      }
    },
  };
}
