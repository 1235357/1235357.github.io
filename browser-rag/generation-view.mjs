// Presentation only: the session separately owns a complete native receipt and
// a pure output inspection. Inspection never establishes financial truth.
export function createGenerationView({document,root,isCurrent,onInspect}) {
  let renderedRaw=null,renderedInspection=null,renderedInput=null;
  const current=(raw,inspection,input=renderedInput)=>{
    const owned=()=>raw!==null&&inspection!==null&&raw===renderedRaw
      &&inspection===renderedInspection&&input===renderedInput;
    return owned()&&isCurrent(raw,inspection)&&owned();
  };
  function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  function lazy(title,read,raw,inspection,plain=false,input=renderedInput){
    const detail=element('details'),summary=element('summary',title);detail.append(summary);
    detail.addEventListener('toggle',()=>{
      detail.replaceChildren(summary);
      if(!detail.open||!current(raw,inspection,input))return;
      const value=read();
      if(!current(raw,inspection,input))return;
      const text=plain?value:JSON.stringify(value,null,2);
      if(current(raw,inspection,input))detail.append(element('pre',text));
    });return detail;
  }
  return {render(raw,inspection,canonicalInput=null){
    renderedRaw=raw;renderedInspection=inspection;renderedInput=canonicalInput;root.replaceChildren();
    if(raw===null||inspection===null){root.append(element('p','No native generation receipt committed. An explicit private generation action follows an accepted query and assembled context.','empty'));return;}
    if(!current(raw,inspection))return;
    root.append(element('p','Exact captured question','eyebrow'),element('p',raw.preparedPrompt.context.question,'context-question'));
    if(!current(raw,inspection))return;
    root.append(element('p',`Native execution receipt · ${raw.generationMode} · ${raw.device} · ${raw.dtype}`,'identity'),
      element('p','Native output and shape/citation inspection are separate evidence. Financial correctness and claim support remain unestablished.','hint'));
    const artifact=inspection.artifact;
    if(!current(raw,inspection))return;
    if(artifact===null){
      root.append(element('h3','Financial output refused'),element('p',`${inspection.error.code} · ${inspection.error.message}`,'generation-refusal'),
        element('p','The complete RAW native output remains available below; no draft answer was accepted.','hint'));
    }else{
      root.append(element('h3',artifact.disposition==='abstained'?'MODEL ABSTENTION · unverified disposition':'UNVERIFIED financial draft'));
      root.append(element('p',artifact.answer,artifact.disposition==='abstained'?'generation-abstention':'generation-answer'));
      root.append(element('p','Shape and citation identity accepted. Check the source evidence for each claim; this is not a verified financial answer.','hint'));
      for(let index=0;current(raw,inspection)&&index<artifact.citationBindings.length;index++){
        const binding=artifact.citationBindings[index],card=element('article',undefined,'generation-citation');
        card.append(element('p',`${binding.citationId} · source chunk ${binding.ordinal+1} · physical page ${binding.physicalPageNumber} · PDF label ${binding.pageLabel===null?'not supplied':JSON.stringify(binding.pageLabel)}`,'identity'),element('p',binding.chunkId,'identity'));
        const button=element('button',`Inspect ${binding.citationId} in retained source`);button.type='button';
        button.addEventListener('click',()=>{if(current(raw,inspection))onInspect(binding,raw,inspection);});
        card.append(button,lazy('Inspect exact cited quote and complete source mapping',()=>({text:binding.text,segments:binding.segments}),raw,inspection));root.append(card);
      }
      root.append(lazy('Complete pure shape/citation inspection (generationMode: not-run)',()=>inspection.artifact,raw,inspection));
    }
    if(!current(raw,inspection))return;
    const preparation=raw.cachePreparation,reads=raw.sdkReads;
    const metrics=element('dl',undefined,'generation-metrics');
    for(const [title,value]of [['Prompt',`${raw.promptTokenIds.length.toLocaleString()} tokens`],['Output',`${raw.generatedTokenIds.length.toLocaleString()} token IDs`],['Attempt',`${(raw.elapsedMs/1000).toFixed(2)} s`],['Termination',raw.inspection.termination]])
      metrics.append(element('dt',title),element('dd',value));
    root.append(metrics);
    const timing=element('details',undefined,'generation-timing'),timingSummary=element('summary','Measured native stage intervals');timing.append(timingSummary);
    timing.addEventListener('toggle',()=>{
      timing.replaceChildren(timingSummary);
      if(!timing.open||!current(raw,inspection))return;
      const table=element('table',undefined,'stage-timings');
      table.append(element('caption','Stage start → next stage start; cleanup ends at the complete receipt.'));
      const head=element('thead'),heading=element('tr');
      for(const title of ['Stage','Start (ms)','Interval (ms)','Share of attempt'])heading.append(element('th',title));
      head.append(heading);table.append(head);const body=element('tbody');
      for(const [index,stage]of raw.stages.entries()){
        if(!current(raw,inspection))return;
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
    if(canonicalInput!==null)root.append(lazy('Original canonical generation input · replay only',()=>canonicalInput,raw,inspection));
    else root.append(element('p','The original canonical generation input was not captured for this receipt. Its assembled prompt context alone cannot reproduce the citation gate.','hint'));
    for(const [title,read,plain]of [
      ['RAW native output · complete decoded text',()=>raw.text,true],
      ['Full rendered prompt',()=>raw.preparedPrompt.renderedPrompt,true],
      ['Full prompt messages',()=>raw.preparedPrompt.messages],
      ['Full model input and retained evidence',()=>raw.preparedPrompt.modelInput],
      ['Prepared prompt token IDs',()=>raw.preparedPrompt.tokenIds],
      ['Prepared attention mask',()=>raw.preparedPrompt.attentionMask],
      ['Prepared prompt preflight and actual generation budget',()=>raw.preparedPrompt.preflight],
      ['Native prompt token IDs',()=>raw.promptTokenIds],
      ['Native generated token IDs',()=>raw.generatedTokenIds],
      ['Native sequence preflight',()=>raw.preflight],
      ['Asset cache preparation receipt',()=>raw.cachePreparation],
      ['Repeated SDK read receipt',()=>raw.sdkReads],
      ['Native stage trace',()=>raw.stages],
      ['Native resource cleanup receipt',()=>raw.cleanup],
      ['Complete RAW native receipt',()=>raw],
    ])root.append(lazy(title,read,raw,inspection,plain));
  }};
}
