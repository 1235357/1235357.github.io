import {prepareAssetsInWorker,AssetPreparationError,copyPreparationReceipt,copyPreparationProgress,copyPreparationFailure} from './asset-preparation-source.mjs';
import {copyRuntimeFailure,ownData} from './runtime-failure-contract.mjs';
import {createCompleteRecordDisclosure} from './complete-record-disclosure.mjs';

// Optional configured presentation. Its worker receives static profile/identity
// only; source is retained here solely to revoke stale UI permission.
export function createAssetPreparationView({document,root,prepare=prepareAssetsInWorker,runtimeIdFactory=()=>crypto.randomUUID()}){
  if(typeof prepare!=='function'||typeof runtimeIdFactory!=='function')throw new TypeError('Invalid asset preparation view');
  const section=document.createElement('section');section.className='asset-preparation';root.append(section);
  const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  section.append(element('h2','Prepare local model assets'),element('p','Download the files for model actions on this device: 113.63 MB for the encoder or 815.73 MB for the generator. Start explicitly, cancel at any time, or retry from completed cached files. Each preparation has a fixed 30-minute limit.'));
  const transportLabel=element('label','Model download source'),transport=element('select');transport.id='asset-preparation-transport';
  for(const [value,text]of [['site','This site (default)'],['huggingface','Hugging Face · explicit model files only']]){const option=element('option',text);option.value=value;transport.append(option);}
  transport.value='site';transportLabel.append(transport);section.append(transportLabel);
  const transportHint=element('p','Hugging Face sends static model-file requests to that provider; no PDF, question or context is sent. Runtime files stay on this site. Choose explicitly; there is no automatic fallback or speed guarantee.');transportHint.className='hint';section.append(transportHint);
  const buttons=element('div');buttons.className='buttons';
  const encoder=element('button','Prepare encoder · 113.63 MB'),generator=element('button','Prepare generator · 815.73 MB');
  encoder.id='prepare-encoder';generator.id='prepare-generator';encoder.type=generator.type='button';buttons.append(encoder,generator);section.append(buttons);
  const cancel=element('button','Cancel preparation');cancel.id='cancel-preparation';cancel.type='button';cancel.disabled=true;section.append(cancel);
  const status=element('p','No preparation receipt. Choose a profile to begin.');status.id='asset-preparation-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const progress=element('progress');progress.id='asset-preparation-progress';progress.hidden=true;
  const disclosure=element('div');disclosure.id='asset-preparation-receipt';section.append(status,progress,disclosure);
  const hint=element('p','Preparation downloads and checks files; it does not produce an answer. Files are rechecked for every model action. The browser may evict cached files, so a completed receipt does not guarantee they remain available.');hint.className='hint';section.append(hint);
  const contract=element('details'),contractSummary=element('summary','Preparation contract');contract.append(contractSummary,
    element('p','Encoder: 113,629,084 bytes. Generator: 815,725,938 bytes. Counts describe decoded asset bodies, not HTTP wire traffic or GPU memory. Only complete byte-count, SHA-256 and cache-write verification earns a preparation receipt.'),
    element('p','Preparation sends no PDF, question or context and invokes no GPU device, SDK or model. Its fixed absolute 30-minute budget includes a separate 10-second worker readiness limit; progress does not renew either deadline. Encoder/query operations remain limited to 120 seconds and generation to 300 seconds. Each later operation rechecks cache bodies and may fetch a missing body within that original limit.'),
    element('p','The optional provider transport permits only five fixed immutable model URLs and a narrow final-host/path policy. Browser CORS or an unapproved redirect can refuse preparation. A response observation records only exposed headers, not intermediate redirect hops; an absent header is unknown. Signed queries are omitted. The observed full-URL hash cannot be recomputed from a redacted archive. Cache hits create no external request record. Only the complete receipt also establishes decoded-body SHA and cache-write verification.'));section.append(contract);
  let owner=null,attempt=0,current=null,counter=0,revoking=false,renderVersion=0;
  let records=[];
  function disposeRecords(){
    const previous=records;records=[];disclosure.replaceChildren();
    for(const entry of previous)entry.dispose();
  }
  function controls(){const disabled=revoking||owner===null||owner.active||Boolean(current);encoder.disabled=generator.disabled=disabled;cancel.disabled=!current;}
  function revoke(message='Preparation ownership was revoked. Start a new explicit preparation to retry.'){
    if(revoking)return;revoking=true;
    try{
      const previous=current;attempt++;current=null;disposeRecords();progress.hidden=true;progress.removeAttribute('value');controls();
      if(previous)status.textContent=message;
      previous?.controller.abort();
    }finally{revoking=false;controls();}
  }
  function owns(task){return current===task&&attempt===task.attempt&&owner===task.owner&&!owner.active&&!task.controller.signal.aborted&&transport.value===task.transport;}
  function disclose(caption,value){
    const acceptedAttempt=attempt,acceptedOwner=owner,acceptedTransport=transport.value;
    const filenames={'Complete static asset preparation receipt':'static-asset-preparation.json',
      'Incomplete transport observation · no verified asset receipt':'incomplete-transport-observation.json',
      'Inspect current preparation failure boundary · no success receipt':'preparation-failure-boundary.json'};
    const entry=createCompleteRecordDisclosure({document,title:caption,read:()=>value,
      current:()=>attempt===acceptedAttempt&&owner===acceptedOwner&&!owner.active&&transport.value===acceptedTransport,
      filename:filenames[caption]});records.push(entry);disclosure.append(entry.node);
  }
  function run(profile){
    if(revoking||owner===null||owner.active||current)return;
    const ownedOwner=owner,version=renderVersion,chosenTransport=transport.value;
    revoke();
    // Disposing a downloaded receipt may synchronously replace this owner.
    if(revoking||owner!==ownedOwner||renderVersion!==version||ownedOwner.active||current||transport.value!==chosenTransport)return;
    const controller=new AbortController(),id=attempt;
    const task=Object.freeze({owner:ownedOwner,attempt:id,controller,transport:chosenTransport});current=task;disclosure.replaceChildren();progress.hidden=false;progress.removeAttribute('value');controls();
    status.textContent=`Preparing ${profile} static assets via ${task.transport==='huggingface'?'Hugging Face':'this site'}. Fixed 30-minute deadline; waiting for a fresh worker.`;
    void(async()=>{
      let identity;
      try{
        identity=Object.freeze({protocolVersion:1,runtimeId:runtimeIdFactory(),operationId:`op-${++counter}`,documentEpoch:ownedOwner.documentEpoch,operation:'prepare-assets'});
        if(!owns(task))return;
        const raw=await prepare(profile,{transport:task.transport,identity,signal:controller.signal,onProgress:value=>{
          if(!owns(task))return;
          value=copyPreparationProgress(value,profile);if(!owns(task))return;
          progress.max=value.total;progress.value=value.verified;
          status.textContent=value.mode==='verified-assets'?`${value.verified.toLocaleString()} / ${value.total.toLocaleString()} verified asset body bytes. Whole bodies advance after SHA and cache write; partial transfer is not shown.`
            :`${value.completed.toLocaleString()} decoded body bytes received; ${value.verified.toLocaleString()} / ${value.total.toLocaleString()} fully verified body bytes. No wire-traffic percentage.`;
        }});
        if(!owns(task))return;const receipt=copyPreparationReceipt(raw,profile,undefined,task.transport);if(!owns(task))return;
        current=null;progress.hidden=true;controls();
        status.textContent=`${profile==='encoder'?'Encoder':'Generator'} static cache verification complete · ${receipt.verifiedBytes.toLocaleString()} body bytes · ${(receipt.elapsedMs/1000).toFixed(1)} seconds of preparation. Model loading and inference have not run.`;
        disclose('Complete static asset preparation receipt',receipt);
      }catch(error){
        if(!owns(task))return;let safe=new AssetPreparationError(),diagnostic=null,boundary=null;
        try{if(error instanceof AssetPreparationError)safe=error;}catch{}
        if(!owns(task))return;
        const rawBoundary=ownData(error,'diagnostic');if(!owns(task))return;
        try{if(rawBoundary!==null)boundary=copyRuntimeFailure(rawBoundary,identity);}catch{}
        if(!owns(task))return;
        try{diagnostic=copyPreparationFailure({code:safe.code,message:safe.message,transportFailure:safe.transportFailure},profile,task.transport).transportFailure;}catch{safe=new AssetPreparationError();}
        if(!owns(task))return;current=null;progress.hidden=true;disclosure.replaceChildren();controls();status.textContent=`${safe.code} · ${safe.message} Previously completed verified cache entries may remain; no complete preparation receipt was committed.`;
        if(diagnostic)disclose('Incomplete transport observation · no verified asset receipt',{schemaVersion:2,status:'incomplete-transport-observation-not-verified',profile,transport:task.transport,code:safe.code,transportFailure:diagnostic});
        if(boundary)disclose('Inspect current preparation failure boundary · no success receipt',boundary);
      }
    })();
  }
  encoder.addEventListener('click',()=>run('encoder'));generator.addEventListener('click',()=>run('generator'));
  cancel.addEventListener('click',()=>{if(current)revoke('Preparation cancelled. No complete preparation receipt was committed. Completed verified cache entries may remain for an explicit retry.');});
  const editTransport=()=>{revoke();status.textContent='Download source changed. Start a new explicit preparation; no previous receipt belongs to this choice.';};
  transport.addEventListener('input',editTransport);transport.addEventListener('change',editTransport);
  return {revoke,render(state){const version=++renderVersion;revoke();if(version!==renderVersion)return;owner=Object.freeze({source:state.source,documentEpoch:state.documentEpoch,active:state.active});
    status.textContent=owner.active?'Preparation is unavailable during active source/model work.':'No current preparation receipt. Choose a profile explicitly; previous verified cache entries may remain.';controls();}};
}
