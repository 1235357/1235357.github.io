import {createController} from './protocol.mjs';
import {ComputeError} from './compute-source.mjs';
import {projectEmbeddingInput,createEmbeddingStageGuard,copyEmbeddingArtifact,
  embeddingReceipt,EmbeddingWorkerError} from './embedding-source.mjs';

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
  embeddingOptions={},onState=()=>{},
  runtimeId=crypto.randomUUID(),runtimeIdFactory=()=>crypto.randomUUID()}) {
  if(typeof extract!=='function') throw new TypeError('A parser adapter is required');
  const controller=createController(runtimeId);
  let source=null,chunks=null,embeddings=null,aborter=null,status='idle',error=null,invalidating=false;
  const snapshot=()=>Object.freeze({status,error,lifecycle:controller.snapshot()});
  const notify=()=>onState(snapshot());
  function invalidate(replace,retainSource=false,nextStatus='idle',retainChunks=false) {
    invalidating=true;
    try {
      // Commit the revoked state and detach the old owner before synchronous
      // abort listeners run. Those listeners cannot start a replacement beneath
      // this transition; direct calls after it returns can retry normally.
      if(replace) controller.replaceDocument(); else controller.cancel();
      const ownedAborter=aborter;aborter=null;
      embeddings=null;if(!retainChunks)chunks=null;if(!retainSource)source=null;error=null;status=nextStatus;
      ownedAborter?.abort();
    } finally { invalidating=false; }
  }
  return {
    snapshot,
    document:()=>source,
    chunks:()=>chunks,
    embeddings:()=>embeddings,
    cancel(){ if(invalidating||controller.snapshot().active===null) return;
      invalidate(false,['chunking','embedding'].includes(status),'cancelled',status==='embedding');notify(); },
    clear(){ if(invalidating)return;invalidate(true);notify(); },
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
      let seq=0;embeddings=null;error=null;status='embedding';
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
      let seq=0;chunks=null;embeddings=null;error=null;status='chunking';notify();
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
