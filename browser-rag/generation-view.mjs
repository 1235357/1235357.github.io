import {createBoundedTextView} from './bounded-text-view.mjs';

// Presentation only: the session separately owns a complete native receipt and
// a pure output inspection. Inspection never establishes financial truth.
export function createGenerationView({document,root,isCurrent,onInspect,textView=createBoundedTextView}) {
  let owner=null,disclosures=[];
  const current=captured=>{
    const owned=()=>owner===captured&&captured.raw!==null&&captured.inspection!==null;
    if(!owned())return false;
    try{return Boolean(isCurrent(captured.raw,captured.inspection))&&owned();}catch{return false;}
  };
  function scrub(node){for(const child of Array.from(node.children??[]))scrub(child);if(node.tagName?.toLowerCase()==='button')node.disabled=true;node.textContent='';}
  function disposeRendered(){const previous=disclosures,oldNodes=Array.from(root.children??[]);disclosures=[];for(const entry of previous){entry.viewer?.dispose();entry.viewer=null;}for(const node of oldNodes)scrub(node);}
  function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  function lazy(title,read,captured,filename,plain=false){
    const detail=element('details'),summary=element('summary',title),entry={viewer:null};detail.append(summary);disclosures.push(entry);
    detail.addEventListener('toggle',()=>{
      entry.viewer?.dispose();entry.viewer=null;
      detail.replaceChildren(summary);
      const owns=()=>detail.open&&current(captured);
      if(!owns())return;
      try{
        const value=read();if(!owns())return;
        const text=plain?value:JSON.stringify(value,null,2);if(!owns())return;
        const viewer=textView({document,root:detail,text,current:owns,filename,format:plain?'text':'json'});
        if(owns())entry.viewer=viewer;else viewer.dispose();
      }catch{if(owns()){entry.viewer?.dispose();entry.viewer=null;detail.replaceChildren(summary,element('p','GENERATION_DISCLOSURE_FAILED · The complete evidence could not be displayed safely.','generation-refusal'));}}
    });return detail;
  }
  return {render(raw,inspection,canonicalInput=null){
    const captured=Object.freeze({raw,inspection,canonicalInput});owner=captured;disposeRendered();if(owner!==captured)return;root.replaceChildren();
    // The session status already explains the next action. Keep the technical
    // empty receipt out of the reading flow until there is a native result.
    root.hidden=raw===null||inspection===null;
    if(raw===null||inspection===null){root.append(element('p','No native generation receipt committed. An explicit generation action follows an accepted query and assembled context.','empty'));return;}
    if(!current(captured))return;
    root.append(element('p','Exact captured question','eyebrow'),element('p',raw.preparedPrompt.context.question,'context-question'));
    if(!current(captured))return;
    root.append(element('p',`Native execution receipt · ${raw.generationMode} · ${raw.device} · ${raw.dtype}`,'identity'),
      element('p','Native output and shape/citation inspection are separate evidence. Financial correctness and claim support remain unestablished.','hint'));
    const artifact=inspection.artifact;
    if(!current(captured))return;
    if(artifact===null){
      root.append(element('h3','Financial output refused'),element('p',`${inspection.error.code} · ${inspection.error.message}`,'generation-refusal'),
        element('p','The complete RAW native output remains available below; no draft answer was accepted.','hint'));
    }else{
      root.append(element('h3',artifact.disposition==='abstained'?'MODEL ABSTENTION · unverified disposition':'UNVERIFIED financial draft'));
      root.append(element('p',artifact.answer,artifact.disposition==='abstained'?'generation-abstention':'generation-answer'));
      root.append(element('p','Shape and citation identity accepted. Check the source evidence for each claim; this is not a verified financial answer.','hint'));
      for(let index=0;current(captured)&&index<artifact.citationBindings.length;index++){
        const binding=artifact.citationBindings[index],card=element('article',undefined,'generation-citation');
        card.append(element('p',`${binding.citationId} · source chunk ${binding.ordinal+1} · physical page ${binding.physicalPageNumber} · PDF label ${binding.pageLabel===null?'not supplied':JSON.stringify(binding.pageLabel)}`,'identity'),element('p',binding.chunkId,'identity'));
        const button=element('button',`Inspect ${binding.citationId} in retained source`);button.type='button';
        button.addEventListener('click',()=>{if(current(captured))onInspect(binding,raw,inspection);});
        card.append(button,lazy('Inspect exact cited quote and complete source mapping',()=>({text:binding.text,segments:binding.segments}),captured,`citation-${index+1}-source.json`));root.append(card);
      }
      root.append(lazy('Complete pure shape/citation inspection (generationMode: not-run)',()=>inspection.artifact,captured,'shape-citation-inspection.json'));
    }
    if(!current(captured))return;
    const preparation=raw.cachePreparation,reads=raw.sdkReads;
    const metrics=element('dl',undefined,'generation-metrics');
    for(const [title,value]of [['Prompt',`${raw.promptTokenIds.length.toLocaleString()} tokens`],['Output',`${raw.generatedTokenIds.length.toLocaleString()} token IDs`],['Attempt',`${(raw.elapsedMs/1000).toFixed(2)} s`],['Termination',raw.inspection.termination]])
      metrics.append(element('dt',title),element('dd',value));
    root.append(metrics);
    const timing=element('details',undefined,'generation-timing'),timingSummary=element('summary','Measured native stage intervals');timing.append(timingSummary);
    timing.addEventListener('toggle',()=>{
      timing.replaceChildren(timingSummary);
      if(!timing.open||!current(captured))return;
      const table=element('table',undefined,'stage-timings');
      table.append(element('caption','Stage start → next stage start; cleanup ends at the complete receipt.'));
      const head=element('thead'),heading=element('tr');
      for(const title of ['Stage','Start (ms)','Interval (ms)','Share of attempt'])heading.append(element('th',title));
      head.append(heading);table.append(head);const body=element('tbody');
      for(const [index,stage]of raw.stages.entries()){
        if(!current(captured))return;
        const end=raw.stages[index+1]?.elapsedMs??raw.elapsedMs,duration=end-stage.elapsedMs,row=element('tr');
        row.append(element('th',stage.stage),element('td',stage.elapsedMs.toFixed(1)),element('td',duration.toFixed(1)));
        const cell=element('td'),meter=element('meter');meter.min=0;meter.max=raw.elapsedMs||1;meter.value=duration;
        meter.setAttribute('aria-label',`${stage.stage}: ${duration.toFixed(1)} ms of ${raw.elapsedMs.toFixed(1)} ms attempt`);
        cell.append(meter,element('span',`${(raw.elapsedMs===0?0:100*duration/raw.elapsedMs).toFixed(1)}%`));row.append(cell);body.append(row);
      }
      table.append(body);timing.append(element('p','These measured wall-clock intervals include surrounding work. They are not isolated GPU/kernel timings, token streaming or time to first token.','hint'),table);
    });
    root.append(timing);
    root.append(element('p',`Preparation: ${preparation.verifiedBytes.toLocaleString()} verified body bytes · ${preparation.networkBytes.toLocaleString()} network body bytes · ${preparation.cacheBytes.toLocaleString()} cached body bytes. SDK reads: ${reads.reads} reads · ${reads.verifiedBytes.toLocaleString()} verified body bytes including repeated reads.`,'generation-counts'));
    if(canonicalInput!==null)root.append(lazy('Original canonical generation input · replay only',()=>canonicalInput,captured,'original-generation-input.json'));
    else root.append(element('p','The original canonical generation input was not captured for this receipt. Its assembled prompt context alone cannot reproduce the citation gate.','hint'));
    for(const [title,read,filename,plain]of [
      ['RAW native output · complete decoded text',()=>raw.text,'native-output.txt',true],
      ['Full rendered prompt',()=>raw.preparedPrompt.renderedPrompt,'rendered-prompt.txt',true],
      ['Full prompt messages',()=>raw.preparedPrompt.messages,'prompt-messages.json'],
      ['Full model input and retained evidence',()=>raw.preparedPrompt.modelInput,'model-input.json'],
      ['Prepared prompt token IDs',()=>raw.preparedPrompt.tokenIds,'prepared-token-ids.json'],
      ['Prepared attention mask',()=>raw.preparedPrompt.attentionMask,'prepared-attention-mask.json'],
      ['Prepared prompt preflight and actual generation budget',()=>raw.preparedPrompt.preflight,'prepared-preflight.json'],
      ['Native prompt token IDs',()=>raw.promptTokenIds,'native-prompt-token-ids.json'],
      ['Native generated token IDs',()=>raw.generatedTokenIds,'native-generated-token-ids.json'],
      ['Native sequence preflight',()=>raw.preflight,'native-preflight.json'],
      ['Asset cache preparation receipt',()=>raw.cachePreparation,'asset-preparation-receipt.json'],
      ['Repeated SDK read receipt',()=>raw.sdkReads,'sdk-read-receipt.json'],
      ['Native stage trace',()=>raw.stages,'native-stage-trace.json'],
      ['Native resource cleanup receipt',()=>raw.cleanup,'native-cleanup-receipt.json'],
      ['Complete RAW native receipt',()=>raw,'native-generation-receipt.json'],
    ])root.append(lazy(title,read,captured,filename,plain));
  }};
}
