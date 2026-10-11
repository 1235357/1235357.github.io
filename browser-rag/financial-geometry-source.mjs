import {copyValidatedSource} from './compute-source.mjs';

// Capture only. This profile validates complete retained PDF.js records; it
// does not interpret coordinates, reconstruct tables, normalize currency or
// admit an answer. Generation's geometry-free source projection is unchanged.
export const GEOMETRY_CAPTURE_PROFILE='pdfjs-source-geometry-capture-v1';
export class GeometrySourceError extends Error {
  constructor(){super('The complete PDF.js source geometry could not be captured safely.');this.name='GeometrySourceError';this.code='INVALID_GEOMETRY_SOURCE';}
}
const fail=()=>{throw new GeometrySourceError();};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function fields(value,keys){
  if(value===null||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
  const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
  if(names.length!==keys.length||names.some(key=>!keys.includes(key)))fail();
  const output={};for(const key of keys){const descriptor=descriptors[key];if(!descriptor||!Object.hasOwn(descriptor,'value'))fail();output[key]=descriptor.value;}return output;
}
function array(value,maximum){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)fail();
  const size=Object.getOwnPropertyDescriptor(value,'length')?.value;
  if(!Number.isSafeInteger(size)||size<0||size>maximum||Reflect.ownKeys(value).length!==size+1)fail();
  const output=[];for(let index=0;index<size;index++){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!Object.hasOwn(descriptor,'value'))fail();output.push(descriptor.value);}return output;
}
function matrix(value,size){const output=array(value,size);if(output.length!==size||!output.every(finite))fail();return output;}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export function copyFinancialGeometrySource(value){
  try{
    const source=fields(value,['schemaVersion','status','source','parser','numPages','workerMode','pages']);
    source.source=fields(source.source,['sha256','name','size']);
    if(!Number.isSafeInteger(source.source.size)||source.source.size<=0||source.source.size>32*1024*1024)fail();
    source.parser=fields(source.parser,['name','version','policyVersion','disableNormalization']);
    let items=0,text=0,fontNames=0;
    source.pages=array(source.pages,512).map(original=>{
      const page=fields(original,['sourceSha256','parserVersion','policyVersion','physicalPageNumber','pageLabel','status','geometry','textItems']);
      const geometry=fields(page.geometry,['view','rotation','userUnit']);geometry.view=matrix(geometry.view,4);
      if(geometry.view[2]<=geometry.view[0]||geometry.view[3]<=geometry.view[1]
          ||!finite(geometry.rotation)||!finite(geometry.userUnit)||geometry.userUnit<=0)fail();page.geometry=geometry;
      page.textItems=array(page.textItems,100000-items).map(originalItem=>{
        const item=fields(originalItem,['itemIndex','text','dir','transform','width','height','fontName','hasEOL','span']);
        if(typeof item.text!=='string'||!['ltr','rtl','ttb'].includes(item.dir)||!finite(item.width)||item.width<0
            ||!finite(item.height)||item.height<0||typeof item.fontName!=='string'||item.fontName.length>4096||typeof item.hasEOL!=='boolean')fail();
        text+=item.text.length;fontNames+=item.fontName.length;items++;
        if(text>2000000||fontNames>2000000)fail();
        item.transform=matrix(item.transform,6);item.span=fields(item.span,['id','startUtf16','endUtf16','quote']);return item;
      });return page;
    });
    // The unchanged text oracle verifies source/parser/page/item identities,
    // exact UTF-16 quotes and complete arrays. Geometry is validated above.
    copyValidatedSource(source);
    return freeze(source);
  }catch{fail();}
}
