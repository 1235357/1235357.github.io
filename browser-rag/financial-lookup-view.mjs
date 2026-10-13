import {deriveFinancialTableLookup,FinancialTableError} from './financial-table-contract.mjs';
import {deriveAnnualFinancialTableLookup} from './financial-annual-table-contract.mjs';
import {createBoundedTextView} from './bounded-text-view.mjs';

async function sha256(bytes){
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const statements=Object.freeze({months:['Condensed Consolidated Statements of Income','Condensed Consolidated Statements of Comprehensive Income'],
  fiscal_year:['Consolidated Statements of Income','CONSOLIDATED STATEMENTS OF INCOME']});

// Private configured comparator. The shared app imports none of this module.
export function createFinancialLookupView({document,root,digest=sha256,textView=createBoundedTextView}){
  const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const identified=(node,key)=>{node.id=`source-cell-${key}`;return node;};
  const section=element('section',undefined,'source-cell-lookup');root.replaceChildren(section);root.hidden=false;
  section.append(element('p','INDEPENDENT SOURCE COMPARATOR','eyebrow'),element('h2','Source-cell lookup · explicit fields'),
    element('p','Bind one Net income cell from the accepted PDF.js source. Choose every field explicitly. This action needs no chunks, encoder or generator. It preserves the native generation result separately.','hint'));
  const fieldHost=element('div',undefined,'lookup-fields'),controls={};section.append(fieldHost);
  function choicesFor(input,choices){
    const placeholder=element('option','Choose explicitly');placeholder.value='';input.replaceChildren(placeholder);
    for(const [value,text]of choices){const option=element('option',text);option.value=value;input.append(option);}input.value='';
  }
  function field(key,label,choices){
    const input=identified(element(choices?'select':'input'),key);input.value='';
    if(choices)choicesFor(input,choices);
    else{input.type='text';input.autocomplete='off';input.spellcheck=false;}
    const labelNode=element('label',label);labelNode.setAttribute('for',input.id);const container=element('div',undefined,['statement','unit'].includes(key)?'lookup-field-wide':undefined);container.append(labelNode,input);fieldHost.append(container);controls[key]=input;
    for(const event of ['input','change'])input.addEventListener(event,()=>{
      if(key==='basis'&&controls.basis.value!==periodBasis){
        periodBasis=controls.basis.value;for(const name of financialKeys)controls[name].value='';refreshPeriodOptions();
      }
      requestRevision++;const capturedOwner=owner,id=revoke();if(owner!==capturedOwner||attempt!==id)return;
      status.textContent=available()?'Fields changed. Run lookup explicitly to bind this request.':unavailable();updateButtons();
    });
  }
  field('basis','Period basis',[['months','Months'],['fiscal_year','Fiscal year']]);
  field('statement','Statement',[]);
  field('metric','Metric');field('duration','Duration (months)',[['3','3 months'],['6','6 months']]);
  field('date','Period-end date (exact PDF text)');field('unit','Unit heading (exact PDF text)');field('glyph','Currency glyph');
  const dateHint=identified(element('p','Use the exact dated heading from the PDF.','hint'),'date-hint');controls.date.setAttribute('aria-describedby',dateHint.id);section.append(dateHint);
  section.append(element('p','Supported metric: Net income. Use the exact dated heading, exact unit heading and currency glyph from your source. Missing or unsupported fields refuse; $ does not establish USD.','hint'));
  const buttons=element('div',undefined,'buttons'),run=identified(element('button','Run source-cell lookup'),'run'),cancel=identified(element('button','Cancel lookup'),'cancel'),clear=identified(element('button','Clear result'),'clear');
  for(const button of [run,cancel,clear])button.type='button';buttons.append(run,cancel,clear);section.append(buttons);
  const status=identified(element('p','No owned parsed source. Select a PDF first.','lookup-status hint'),'status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const resultHost=identified(element('div',undefined,'lookup-result'),'result');section.append(status,resultHost);
  let owner=null,renderRevision=0,requestRevision=0,attempt=0,pending=false,disclosures=[],periodBasis='';
  const financialKeys=['statement','metric','duration','date','unit','glyph'],keys=['basis',...financialKeys];
  const available=()=>owner!==null&&owner.source!==null&&!owner.active&&!owner.cancelled;
  const unavailable=()=>owner?.source===null||owner===null?'No owned parsed source. Select a PDF first.':owner.active?'Lookup is unavailable during active session work.':'Session ownership was revoked. Start a new explicit source action before lookup.';
  const descendants=node=>[node,...Array.from(node.childNodes??node.children??[]).flatMap(descendants)];
  function scrub(captured){for(const node of captured){if('disabled' in node)node.disabled=true;node.removeAttribute?.('href');node.removeAttribute?.('download');node.textContent='';}}
  function release(disclosure,record){
    if(!record)return;
    const captured=descendants(record.body),viewer=record.viewer;record.retired=true;record.viewer=null;
    if(disclosure.active===record){disclosure.active=null;disclosure.detail.replaceChildren(...(disclosure.alive?[disclosure.summary]:[]));}
    try{viewer?.dispose?.();}catch{/* Cleanup diagnostics do not enter the presentation. */}finally{scrub(captured);}
  }
  function revoke(){
    const id=++attempt,previous=disclosures,oldNodes=Array.from(resultHost.children??[]).flatMap(descendants);
    pending=false;disclosures=[];resultHost.replaceChildren();
    for(const disclosure of previous){
      disclosure.alive=false;disclosure.revision++;disclosure.detail.open=false;
      disclosure.detail.removeEventListener('toggle',disclosure.toggle);release(disclosure,disclosure.active);
    }
    scrub(oldNodes);return id;
  }
  function refreshPeriodOptions(){
    const supported=Object.hasOwn(statements,periodBasis)?statements[periodBasis]:[];
    choicesFor(controls.statement,supported.map(value=>[value,value]));
    dateHint.textContent=periodBasis==='fiscal_year'
      ?'For a split annual header, enter its exact month/day and year together, for example January 31, 2021. The original date and year items remain separate source bindings.'
      :'Use the exact dated heading from the PDF.';
  }
  function updateButtons(){const ready=available();run.disabled=!ready||pending;cancel.disabled=!pending;clear.disabled=!ready&&!pending;for(const input of Object.values(controls))input.disabled=!ready;
    controls.duration.disabled=!ready||controls.basis.value!=='months';controls.statement.disabled=!ready||!Object.hasOwn(statements,controls.basis.value);}
  function lazy(title,read,current,caption,filename){
    const detail=element('details'),summary=element('summary',title),disclosure={detail,summary,active:null,alive:true,revision:0,toggle:null};detail.append(summary);disclosures.push(disclosure);resultHost.append(detail);
    disclosure.toggle=()=>{
      if(!disclosure.alive)return;
      const revision=++disclosure.revision,previous=disclosure.active;disclosure.active=null;
      detail.replaceChildren(summary);release(disclosure,previous);
      const openAt=()=>disclosure.alive&&disclosure.revision===revision&&detail.open&&current();
      if(!openAt())return;
      const record={body:element('div'),viewer:null,retired:false};disclosure.active=record;detail.append(record.body);
      const owns=()=>openAt()&&disclosure.active===record&&!record.retired;
      try{
        const text=read();if(!owns()){release(disclosure,record);return;}
        record.body.append(element('p',caption,'hint'));
        const viewer=textView({document,root:record.body,text,current:owns,filename});record.viewer=viewer;
        if(!owns()){release(disclosure,record);return;}
        if(typeof viewer?.dispose!=='function')throw Error();
      }catch{release(disclosure,record);if(openAt())detail.append(element('p','LOOKUP_DISCLOSURE_FAILED · Complete evidence could not be displayed safely.','generation-refusal'));}
    };
    detail.addEventListener('toggle',disclosure.toggle);
  }
  run.addEventListener('click',()=>{
    if(!available()||pending)return;
    const capturedOwner=owner,capturedRevision=requestRevision,capturedValues=keys.map(key=>controls[key].value),id=revoke();
    if(owner!==capturedOwner||attempt!==id||requestRevision!==capturedRevision||!available()||keys.some((key,index)=>controls[key].value!==capturedValues[index]))return;
    const values=Object.fromEntries(keys.map((key,index)=>[key,capturedValues[index]]));
    const annual=values.basis==='fiscal_year';
    const request={statement:values.statement,metric:values.metric,durationMonths:annual?null:Number(values.duration),periodEndLiteral:values.date,unitHeadingLiteral:values.unit,currencyGlyph:values.glyph};
    if(annual)request.periodKind='fiscal_year';
    const current=()=>owner===capturedOwner&&available()&&owner.source===capturedOwner.source&&owner.documentEpoch===capturedOwner.documentEpoch
      &&attempt===id&&requestRevision===capturedRevision&&keys.every((key,index)=>controls[key].value===capturedValues[index]);
    pending=true;status.textContent='Binding source / computing snapshot digest. No candidate has committed.';updateButtons();
    void(async()=>{
      try{
        if(!current())return;if(!Object.hasOwn(statements,values.basis)||(annual&&values.duration!==''))throw new FinancialTableError('UNSUPPORTED_LOOKUP_REQUEST');
        const result=(annual?deriveAnnualFinancialTableLookup:deriveFinancialTableLookup)(capturedOwner.source,request);if(!current())return;
        const snapshotText=JSON.stringify(result.snapshot,null,2);if(!current())return;
        const bytes=new TextEncoder().encode(snapshotText),hash=await digest(bytes);if(!current())return;
        if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error();
        const receipt=freeze({schemaVersion:annual?2:1,result,viewReceipt:{kind:'owned-source-cell-lookup-view',
          serialization:'JSON.stringify(snapshot, null, 2), UTF-8, no trailing newline',snapshot:{sha256:hash,utf8Bytes:bytes.length},
          ownership:{documentEpoch:capturedOwner.documentEpoch,coreRenderRevision:capturedOwner.renderRevision,requestRevision:capturedRevision,attempt:id}}});
        pending=false;status.textContent='Source-cell candidate committed · financial correctness unadjudicated.';updateButtons();
        const periodText=annual?`Year ended ${result.request.periodEndLiteral}`:`${result.request.durationMonths} months ended ${result.request.periodEndLiteral}`;
        resultHost.append(element('p',result.amountLiteral,'lookup-amount'),element('p',`${result.request.metric} · ${periodText}`,'lookup-period'),
          element('p',`${result.request.statement} · ${result.unitHeadingLiteral} · currency glyph ${result.currencyGlyph}`,'identity'),
          element('p',`Physical page ${result.physicalPageNumber} · PDF label ${result.pageLabel} · ${result.profile.version}`,'identity'),
          element('p','Source-cell candidate · financial correctness unadjudicated; normalized currency is unset. The amount is an exact source item. Native Qwen output and its receipt remain separate.','hint'));
        lazy('Complete lookup geometry snapshot · exact digest bytes',()=>snapshotText,current,
          `${bytes.length.toLocaleString()} UTF-8 bytes · SHA-256 ${hash}. Digest covers the complete JSON in consecutive text pages and the exact download, without a trailing newline. Item extents are not glyph boxes. PDF labels do not authenticate parent-report lineage.`,'lookup-geometry-snapshot.json');
        lazy('Exact source roles and all dated columns',()=>JSON.stringify({selected:result.bindings,columns:result.columns,geometry:result.geometry},null,2),current,
          `Exact selected item records and UTF-16 spans, optional annotation, all ${result.columns.length} dated columns and derived geometry. Split date and date_year roles retain their separate native items. No PyMuPDF coordinates or expected-answer values entered this lookup.`,'lookup-source-bindings.json');
        lazy('Complete source-cell lookup receipt',()=>JSON.stringify(receipt,null,2),current,
          `Lookup receipt schema ${receipt.schemaVersion}. Complete immutable pure result plus this view’s owner-computed snapshot digest and request/attempt ownership. This receipt identifies the supplied bytes; it does not authenticate financial correctness or PDF origin.`,'source-cell-lookup-receipt.json');
      }catch(error){
        if(!current())return;pending=false;resultHost.replaceChildren();status.textContent=error instanceof FinancialTableError?`${error.code} · ${error.message}`:'LOOKUP_RECEIPT_FAILED · The complete snapshot receipt could not be prepared safely.';updateButtons();
      }
    })();
  });
  cancel.addEventListener('click',()=>{if(!pending)return;const capturedOwner=owner,id=revoke();if(owner!==capturedOwner||attempt!==id)return;status.textContent='Lookup cancelled. Commit rights revoked; run explicitly to retry. Synchronous binding cannot be interrupted.';updateButtons();});
  clear.addEventListener('click',()=>{const capturedOwner=owner,id=revoke();if(owner!==capturedOwner||attempt!==id)return;status.textContent=available()?'Result cleared. Field selections retained; run explicitly to retry.':unavailable();updateButtons();});
  updateButtons();
  return {render({source,documentEpoch,active,cancelled}){
    const changed=owner===null||owner.source!==source||owner.documentEpoch!==documentEpoch;
    const revision=++renderRevision,capturedOwner=Object.freeze({source,documentEpoch,active,cancelled,renderRevision:revision});owner=capturedOwner;
    const id=revoke();if(owner!==capturedOwner||renderRevision!==revision||attempt!==id)return;
    if(changed){requestRevision++;for(const input of Object.values(controls))input.value='';periodBasis='';refreshPeriodOptions();}
    status.textContent=available()?'Owned parsed source ready. Choose the period basis and every required field, then run explicitly.':unavailable();updateButtons();
  }};
}
