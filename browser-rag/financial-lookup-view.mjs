import {deriveFinancialTableLookup,FinancialTableError} from './financial-table-contract.mjs';

async function sha256(bytes){
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

// Private configured comparator. The shared app imports none of this module.
export function createFinancialLookupView({document,root,digest=sha256}){
  const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const identified=(node,key)=>{node.id=`source-cell-${key}`;return node;};
  const section=element('section',undefined,'source-cell-lookup');root.replaceChildren(section);root.hidden=false;
  section.append(element('p','INDEPENDENT SOURCE COMPARATOR','eyebrow'),element('h2','Source-cell lookup · explicit fields'),
    element('p','Bind one Net income cell from the accepted PDF.js source. Choose every field explicitly. This action needs no chunks, encoder or generator. It preserves the native generation result separately.','hint'));
  const fieldHost=element('div',undefined,'lookup-fields'),controls={};section.append(fieldHost);
  function field(key,label,choices){
    const input=identified(element(choices?'select':'input'),key);input.value='';
    if(choices){input.append(element('option','Choose explicitly'));input.children[0].value='';for(const [value,text]of choices){const option=element('option',text);option.value=value;input.append(option);}}
    else{input.type='text';input.autocomplete='off';input.spellcheck=false;}
    const labelNode=element('label',label);labelNode.setAttribute('for',input.id);const container=element('div');container.append(labelNode,input);fieldHost.append(container);controls[key]=input;
    for(const event of ['input','change'])input.addEventListener(event,()=>{requestRevision++;revoke();status.textContent=available()?'Fields changed. Run lookup explicitly to bind this request.':unavailable();updateButtons();});
  }
  field('statement','Statement',[
    ['Condensed Consolidated Statements of Income','Condensed Consolidated Statements of Income'],
    ['Condensed Consolidated Statements of Comprehensive Income','Condensed Consolidated Statements of Comprehensive Income']]);
  field('metric','Metric');field('duration','Duration (months)',[['3','3 months'],['6','6 months']]);
  field('date','Period-end date (exact PDF text)');field('unit','Unit heading (exact PDF text)');field('glyph','Currency glyph');
  section.append(element('p','Supported metric: Net income. Use the exact dated heading, exact unit heading and currency glyph from your source. Missing or unsupported fields refuse; $ does not establish USD.','hint'));
  const buttons=element('div',undefined,'buttons'),run=identified(element('button','Run source-cell lookup'),'run'),cancel=identified(element('button','Cancel lookup'),'cancel'),clear=identified(element('button','Clear result'),'clear');
  for(const button of [run,cancel,clear])button.type='button';buttons.append(run,cancel,clear);section.append(buttons);
  const status=identified(element('p','No owned parsed source. Select a PDF first.','lookup-status hint'),'status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const resultHost=identified(element('div',undefined,'lookup-result'),'result');section.append(status,resultHost);
  let owner=null,renderRevision=0,requestRevision=0,attempt=0,pending=false,disclosures=[];
  const keys=['statement','metric','duration','date','unit','glyph'];
  const available=()=>owner!==null&&owner.source!==null&&!owner.active&&!owner.cancelled;
  const unavailable=()=>owner?.source===null||owner===null?'No owned parsed source. Select a PDF first.':owner.active?'Lookup is unavailable during active session work.':'Session ownership was revoked. Start a new explicit source action before lookup.';
  function revoke(){attempt++;pending=false;for(const {detail,summary}of disclosures)detail.replaceChildren(summary);disclosures=[];resultHost.replaceChildren();}
  function updateButtons(){const ready=available();run.disabled=!ready||pending;cancel.disabled=!pending;clear.disabled=!ready&&!pending;for(const input of Object.values(controls))input.disabled=!ready;}
  function lazy(title,read,current,caption){
    const detail=element('details'),summary=element('summary',title);detail.append(summary);disclosures.push({detail,summary});resultHost.append(detail);
    detail.addEventListener('toggle',()=>{
      detail.replaceChildren(summary);if(!detail.open||!current())return;
      try{const text=read();if(!current())return;detail.append(element('p',caption,'hint'),element('pre',text));}
      catch{if(current())detail.append(element('p','LOOKUP_DISCLOSURE_FAILED · Complete evidence could not be displayed safely.','generation-refusal'));}
    });
  }
  run.addEventListener('click',()=>{
    if(!available()||pending)return;
    revoke();const id=attempt,capturedOwner=owner,capturedRevision=requestRevision,capturedValues=keys.map(key=>controls[key].value);
    const request={statement:capturedValues[0],metric:capturedValues[1],durationMonths:Number(capturedValues[2]),periodEndLiteral:capturedValues[3],unitHeadingLiteral:capturedValues[4],currencyGlyph:capturedValues[5]};
    const current=()=>owner===capturedOwner&&available()&&owner.source===capturedOwner.source&&owner.documentEpoch===capturedOwner.documentEpoch
      &&attempt===id&&requestRevision===capturedRevision&&keys.every((key,index)=>controls[key].value===capturedValues[index]);
    pending=true;status.textContent='Binding source / computing snapshot digest. No candidate has committed.';updateButtons();
    void(async()=>{
      try{
        if(!current())return;const result=deriveFinancialTableLookup(capturedOwner.source,request);if(!current())return;
        const snapshotText=JSON.stringify(result.snapshot,null,2);if(!current())return;
        const bytes=new TextEncoder().encode(snapshotText),hash=await digest(bytes);if(!current())return;
        if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error();
        const receipt=freeze({schemaVersion:1,result,viewReceipt:{kind:'owned-source-cell-lookup-view',
          serialization:'JSON.stringify(snapshot, null, 2), UTF-8, no trailing newline',snapshot:{sha256:hash,utf8Bytes:bytes.length},
          ownership:{documentEpoch:capturedOwner.documentEpoch,coreRenderRevision:capturedOwner.renderRevision,requestRevision:capturedRevision,attempt:id}}});
        pending=false;status.textContent='Source-cell candidate committed · financial correctness unadjudicated.';updateButtons();
        resultHost.append(element('p',result.amountLiteral,'lookup-amount'),element('p',`${result.request.metric} · ${result.request.durationMonths} months ended ${result.request.periodEndLiteral}`,'lookup-period'),
          element('p',`${result.request.statement} · ${result.unitHeadingLiteral} · currency glyph ${result.currencyGlyph}`,'identity'),
          element('p',`Physical page ${result.physicalPageNumber} · PDF label ${result.pageLabel} · ${result.profile.version}`,'identity'),
          element('p','Source-cell candidate · financial correctness unadjudicated; normalized currency is unset. The amount is an exact source item. Native Qwen output and its receipt remain separate.','hint'));
        lazy('Complete lookup geometry snapshot · exact digest bytes',()=>snapshotText,current,
          `${bytes.length.toLocaleString()} UTF-8 bytes · SHA-256 ${hash}. Digest covers exactly this complete JSON, without a trailing newline. Item extents are not glyph boxes. PDF labels do not authenticate parent-report lineage.`);
        lazy('Exact source roles and all dated columns',()=>JSON.stringify({selected:result.bindings,columns:result.columns,geometry:result.geometry},null,2),current,
          'Exact selected item records and UTF-16 spans, optional annotation, all four dated columns and derived geometry. No PyMuPDF coordinates or expected-answer values entered this lookup.');
        lazy('Complete source-cell lookup receipt',()=>JSON.stringify(receipt,null,2),current,
          'Complete immutable pure result plus this view’s owner-computed snapshot digest and request/attempt ownership. This receipt identifies the supplied bytes; it does not authenticate financial correctness or PDF origin.');
      }catch(error){
        if(!current())return;pending=false;resultHost.replaceChildren();status.textContent=error instanceof FinancialTableError?`${error.code} · ${error.message}`:'LOOKUP_RECEIPT_FAILED · The complete snapshot receipt could not be prepared safely.';updateButtons();
      }
    })();
  });
  cancel.addEventListener('click',()=>{if(!pending)return;revoke();status.textContent='Lookup cancelled. Commit rights revoked; run explicitly to retry. Synchronous binding cannot be interrupted.';updateButtons();});
  clear.addEventListener('click',()=>{revoke();status.textContent=available()?'Result cleared. Field selections retained; run explicitly to retry.':unavailable();updateButtons();});
  updateButtons();
  return {render({source,documentEpoch,active,cancelled}){
    const changed=owner===null||owner.source!==source||owner.documentEpoch!==documentEpoch;
    revoke();owner=Object.freeze({source,documentEpoch,active,cancelled,renderRevision:++renderRevision});
    if(changed){requestRevision++;for(const input of Object.values(controls))input.value='';}
    status.textContent=available()?'Owned parsed source ready. Choose all six fields and run explicitly.':unavailable();updateButtons();
  }};
}
