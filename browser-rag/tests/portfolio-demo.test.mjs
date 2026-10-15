import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../../portfolio-demo.mjs',import.meta.url),'utf8');
function fixture({supported=true,reject=false}={}){
  const listeners={},attrs={},status={textContent:''},button={hidden:true,textContent:'Expand workspace',setAttribute:(k,v)=>attrs[k]=v,addEventListener:(k,v)=>listeners[k]=v};
  let writes=0,requests=0,exits=0,loads=0,childReads=0;
  const frame={get src(){return 'https://example.test/browser-rag/inspector.html';},set src(_v){writes++;},addEventListener:(k,fn)=>{if(k==='load')loads++;},get contentDocument(){childReads++;throw new Error('The lab owns its own presentation');},get contentWindow(){childReads++;throw new Error('The lab owns its own window');}};
  const document={fullscreenEnabled:supported,fullscreenElement:null,addEventListener:(k,fn)=>listeners[k]=fn,exitFullscreen:async()=>{exits++;document.fullscreenElement=null;listeners.fullscreenchange();},querySelector:()=>stage};
  const stage={querySelector:s=>({'#project-demo':frame,'.demo-fullscreen-link':{href:'unchanged'},'.demo-expand-button':button,'.demo-expand-status':status}[s]),querySelectorAll:()=>[],requestFullscreen:async()=>{requests++;if(reject)throw new Error('private exception');document.fullscreenElement=stage;listeners.fullscreenchange();}};
  vm.runInNewContext(script,{document,URL,window:{location:{href:'https://example.test/index.html',origin:'https://example.test'}}});
  return {document,stage,button,attrs,status,listeners,get writes(){return writes;},get requests(){return requests;},get exits(){return exits;},get loads(){return loads;},get childReads(){return childReads;}};
}
test('expansion and explicit exit retain the exact existing iframe document',async()=>{
  const f=fixture();assert.equal(f.button.hidden,false);assert.equal(f.loads,0);assert.equal(f.childReads,0);await f.listeners.click();assert.equal(f.document.fullscreenElement,f.stage);assert.equal(f.attrs['aria-expanded'],'true');assert.equal(f.button.textContent,'Exit expanded workspace');await f.listeners.click();assert.equal(f.document.fullscreenElement,null);assert.equal(f.attrs['aria-expanded'],'false');assert.equal(f.requests,1);assert.equal(f.exits,1);assert.equal(f.writes,0);assert.equal(f.childReads,0);
});
test('browser Escape updates the label without reloading or recreating the frame',async()=>{
  const f=fixture();await f.listeners.click();f.document.fullscreenElement=null;f.listeners.fullscreenchange();assert.equal(f.button.textContent,'Expand workspace');assert.equal(f.attrs['aria-expanded'],'false');assert.equal(f.writes,0);
});
test('unsupported fullscreen stays hidden and a rejected request gives a safe link fallback',async()=>{
  const unsupported=fixture({supported:false});assert.equal(unsupported.button.hidden,true);assert.equal(unsupported.listeners.click,undefined);
  const f=fixture({reject:true});await f.listeners.click();assert.match(f.status.textContent,/Open in a full page/);assert.doesNotMatch(f.status.textContent,/private exception/);assert.equal(f.attrs['aria-expanded'],'false');assert.equal(f.writes,0);await f.listeners.click();assert.equal(f.requests,2);
});
