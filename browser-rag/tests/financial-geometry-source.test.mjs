import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageRecord} from '../pdf-source.mjs';
import {copyValidatedSource} from '../compute-source.mjs';
const module=await import('../financial-geometry-source.mjs').catch(()=>({}));
export function sourceOf(){
  const sha='a'.repeat(64),parser={name:'pdfjs',version:'6.4.299',policyVersion:'text-items-v1',disableNormalization:true};
  const items=['Net income',' ','','16,599','😀'];
  return {schemaVersion:1,status:'extracted-not-indexed',source:{sha256:sha,name:'<reader>.pdf',size:74085},parser,workerMode:'native',numPages:1,
    pages:[createPageRecord({sourceSha256:sha,parserVersion:parser.version,physicalPageNumber:1,pageLabel:'3',page:{view:[0,0,612,792],rotate:90,userUnit:2},
      textContent:{items:items.map((str,index)=>({str,dir:index===4?'rtl':'ltr',transform:[1,0.25,0,1,20+index*30,600],width:str.trim()?40:0,height:str.trim()?10:0,fontName:'f1',hasEOL:index===4}))}})]};
}
function copy(value){assert.equal(typeof module.copyFinancialGeometrySource,'function');return module.copyFinancialGeometrySource(value);}
test('capture preserves every known native source/page/item value, whitespace and zero-area items in a detached frozen record',()=>{
  const source=structuredClone(sourceOf()),snapshot=copy(source);assert.deepEqual(snapshot,source);assert.notEqual(snapshot,source);
  assert.deepEqual(copyValidatedSource(snapshot),copyValidatedSource(source));assert.equal(snapshot.pages[0].pageLabel,'3');assert.equal(snapshot.pages[0].physicalPageNumber,1);
  function frozen(value){if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));for(const child of Object.values(value))frozen(child);}}
  frozen(snapshot);source.pages[0].textItems[0].transform[4]=999;source.pages[0].geometry.view[0]=-10;
  assert.equal(snapshot.pages[0].textItems[0].transform[4],20);assert.equal(snapshot.pages[0].geometry.view[0],0);
  assert.equal(snapshot.pages[0].textItems[1].text,' ');assert.equal(snapshot.pages[0].textItems[2].width,0);
  // Capture validates and retains geometry; interpretation/unsupported-layout refusal belongs to a later binder.
  assert.equal(snapshot.pages[0].geometry.rotation,90);assert.equal(snapshot.pages[0].geometry.userUnit,2);
});
for(const [name,mutate]of [
  ['missing geometry',s=>delete s.pages[0].geometry],['nonfinite matrix',s=>s.pages[0].textItems[0].transform[4]=Infinity],
  ['wrong matrix length',s=>s.pages[0].textItems[0].transform.pop()],['negative width',s=>s.pages[0].textItems[0].width=-1],
  ['nonfinite view',s=>s.pages[0].geometry.view[0]=NaN],['zero user unit',s=>s.pages[0].geometry.userUnit=0],
  ['inverted view',s=>s.pages[0].geometry.view=[612,0,0,792]],['zero-area view',s=>s.pages[0].geometry.view=[0,0,612,0]],
  ['bad direction',s=>s.pages[0].textItems[0].dir='guessed'],['wrong EOL',s=>s.pages[0].textItems[0].hasEOL='false'],
  ['foreign span',s=>s.pages[0].textItems[0].span.id='foreign'],['altered quote',s=>s.pages[0].textItems[0].span.quote='changed'],
  ['wrong parser',s=>s.parser.version='another'],['foreign page hash',s=>s.pages[0].sourceSha256='b'.repeat(64)],
  ['sparse items',s=>delete s.pages[0].textItems[1]],['unexpected root',s=>s.extra='private'],
  ['unexpected item',s=>s.pages[0].textItems[0].bbox=[1,2,3,4]],['over file limit',s=>s.source.size=32*1024*1024+1],
  ['over page limit',s=>{s.numPages=513;s.pages=new Array(513);}],['over item limit',s=>s.pages[0].textItems=new Array(100001)],
])test(`independent geometry capture safely refuses ${name}`,()=>{
  const source=structuredClone(sourceOf());mutate(source);assert.throws(()=>copy(source),error=>error.code==='INVALID_GEOMETRY_SOURCE'&&error.message==='The complete PDF.js source geometry could not be captured safely.');
});
test('accessor failures and private exception messages are never read or leaked by capture',()=>{
  const source=structuredClone(sourceOf());let reads=0;Object.defineProperty(source.pages[0].textItems[0],'width',{get(){reads++;throw Error('SECRET');},enumerable:true});
  assert.throws(()=>copy(source),error=>error.code==='INVALID_GEOMETRY_SOURCE'&&!error.message.includes('SECRET'));assert.equal(reads,0);
});
