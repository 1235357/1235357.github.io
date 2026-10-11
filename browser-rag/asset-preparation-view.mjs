import {prepareAssetsInWorker,AssetPreparationError,copyPreparationReceipt,copyPreparationProgress} from './asset-preparation-source.mjs';

// Optional configured presentation. Its worker receives static profile/identity
// only; source is retained here solely to revoke stale UI permission.
export function createAssetPreparationView({document,root,prepare=prepareAssetsInWorker,runtimeIdFactory=()=>crypto.randomUUID()}){
  if(typeof prepare!=='function'||typeof runtimeIdFactory!=='function')throw new TypeError('Invalid asset preparation view');
  const section=document.createElement('section');section.className='asset-preparation';root.append(section);
  const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  section.append(element('h2','Prepare local model assets'),element('p','Download the files for model actions on this device: 113.63 MB for the encoder or 815.73 MB for the generator. Start explicitly, cancel at any time, or retry from completed cached files. Each preparation has a fixed 30-minute limit.'));
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
    element('p','Preparation sends no PDF, question or context and invokes no GPU device, SDK or model. Its fixed absolute 30-minute budget includes a separate 10-second worker readiness limit; progress does not renew either deadline. Encoder/query operations remain limited to 120 seconds and generation to 300 seconds. Each later operation rechecks cache bodies and may fetch a missing body within that original limit.'));section.append(contract);
  let owner=null,attempt=0,current=null,counter=0,revoking=false,renderVersion=0;
  function controls(){const disabled=revoking||owner===null||owner.active||Boolean(current);encoder.disabled=generator.disabled=disabled;cancel.disabled=!current;}
  function revoke(message='Preparation ownership was revoked. Start a new explicit preparation to retry.'){
    if(revoking)return;revoking=true;
    try{
      const previous=current;attempt++;current=null;disclosure.replaceChildren();progress.hidden=true;progress.removeAttribute('value');controls();
      if(previous)status.textContent=message;
      previous?.controller.abort();
    }finally{revoking=false;controls();}
  }
  function owns(task){return current===task&&attempt===task.attempt&&owner===task.owner&&!owner.active&&!task.controller.signal.aborted;}
  function run(profile){
    if(revoking||owner===null||owner.active||current)return;
    revoke();const controller=new AbortController(),ownedOwner=owner,id=attempt;
    const task=Object.freeze({owner:ownedOwner,attempt:id,controller});current=task;disclosure.replaceChildren();progress.hidden=false;progress.removeAttribute('value');controls();
    status.textContent=`Preparing ${profile} static assets. Fixed 30-minute deadline; waiting for a fresh worker.`;
    void(async()=>{
      try{
        const identity=Object.freeze({protocolVersion:1,runtimeId:runtimeIdFactory(),operationId:`op-${++counter}`,documentEpoch:ownedOwner.documentEpoch,operation:'prepare-assets'});
        const raw=await prepare(profile,{identity,signal:controller.signal,onProgress:value=>{
          if(!owns(task))return;
          value=copyPreparationProgress(value,profile);if(!owns(task))return;
          progress.max=value.total;progress.value=value.verified;
          status.textContent=value.mode==='verified-assets'?`${value.verified.toLocaleString()} / ${value.total.toLocaleString()} verified asset body bytes. Whole bodies advance after SHA and cache write; partial transfer is not shown.`
            :`${value.completed.toLocaleString()} decoded body bytes received; ${value.verified.toLocaleString()} / ${value.total.toLocaleString()} fully verified body bytes. No wire-traffic percentage.`;
        }});
        if(!owns(task))return;const receipt=copyPreparationReceipt(raw,profile);if(!owns(task))return;
        current=null;progress.hidden=true;controls();
        status.textContent=`${profile==='encoder'?'Encoder':'Generator'} static cache verification complete · ${receipt.verifiedBytes.toLocaleString()} body bytes · ${(receipt.elapsedMs/1000).toFixed(1)} seconds of preparation. Model loading and inference have not run.`;
        const detail=element('details'),summary=element('summary','Complete static asset preparation receipt');detail.append(summary);disclosure.append(detail);
        const acceptedAttempt=attempt,acceptedOwner=owner;
        detail.addEventListener('toggle',()=>{
          detail.replaceChildren(summary);
          if(attempt!==acceptedAttempt||owner!==acceptedOwner||owner.active||!detail.open)return;
          detail.append(element('pre',JSON.stringify(receipt,null,2)));
        });
      }catch(error){if(!owns(task))return;current=null;progress.hidden=true;disclosure.replaceChildren();controls();const safe=error instanceof AssetPreparationError?error:new AssetPreparationError();status.textContent=`${safe.code} · ${safe.message} Previously completed verified cache entries may remain; no complete preparation receipt was committed.`;}
    })();
  }
  encoder.addEventListener('click',()=>run('encoder'));generator.addEventListener('click',()=>run('generator'));
  cancel.addEventListener('click',()=>{if(current)revoke('Preparation cancelled. No complete preparation receipt was committed. Completed verified cache entries may remain for an explicit retry.');});
  return {revoke,render(state){const version=++renderVersion;revoke();if(version!==renderVersion)return;owner=Object.freeze({source:state.source,documentEpoch:state.documentEpoch,active:state.active});
    status.textContent=owner.active?'Preparation is unavailable during active source/model work.':'No current preparation receipt. Choose a profile explicitly; previous verified cache entries may remain.';controls();}};
}
