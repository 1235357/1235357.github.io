import {createController} from './protocol.mjs';

const SAFE_CODES = new Set(['INVALID_RECORD','INVALID_INPUT','FILE_TOO_LARGE','INVALID_PDF',
  'PARSER_VERSION_UNSUPPORTED','WORKER_UNAVAILABLE','INVALID_LIMITS','EXTRACTION_LIMIT','EMPTY_DOCUMENT',
  'PDF_PASSWORD_REQUIRED','EXTRACTION_FAILED','CLEANUP_FAILED','ABORTED']);

export function createPdfSession({extract,parserOptions={},onState=()=>{},runtimeId=crypto.randomUUID()}) {
  if(typeof extract!=='function') throw new TypeError('A parser adapter is required');
  const controller=createController(runtimeId);
  let source=null,aborter=null,status='idle',error=null;
  const snapshot=()=>Object.freeze({status,error,lifecycle:controller.snapshot()});
  const notify=()=>onState(snapshot());
  function invalidate(replace) {
    // Revoking commit rights is synchronous and precedes physical cancellation.
    if(replace) controller.replaceDocument(); else controller.cancel();
    aborter?.abort(); aborter=null; source=null; error=null;
  }
  return {
    snapshot,
    document:()=>source,
    cancel(){ if(controller.snapshot().active===null) return; invalidate(false); status='cancelled';notify(); },
    clear(){ invalidate(true);status='idle';notify(); },
    async select(file){
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
