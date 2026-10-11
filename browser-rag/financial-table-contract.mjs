import {copyFinancialGeometrySource} from './financial-geometry-source.mjs';

// Pure source-cell candidate derivation. No tokenizer/model, expected-answer
// labels, absolute page coordinates, trusted caller digest or output repair.
export const FINANCIAL_TABLE_PROFILE=Object.freeze({version:'pdfjs-net-income-horizontal-v1',rowToleranceDivisor:8,
  columnCount:4,normalizedCurrency:null,amountGrammar:'unsigned integer or comma groups; no signs, decimals, parentheses or split tokens'});
const UNITS=Object.freeze({
  'Condensed Consolidated Statements of Income':'(In millions, except per share data)',
  'Condensed Consolidated Statements of Comprehensive Income':'(In millions)',
});
const DURATIONS=Object.freeze({'Three Months Ended':3,'Six Months Ended':6});
const MESSAGES=Object.freeze({UNSUPPORTED_LOOKUP_REQUEST:'Choose supported explicit statement, metric, duration, date, unit literal and currency glyph fields.',
  INVALID_LOOKUP_SOURCE:'The complete owned source could not be validated for lookup.',
  TABLE_EVIDENCE_MISSING:'A required unique table item or column is missing.',TABLE_EVIDENCE_AMBIGUOUS:'The source contains ambiguous table items or columns.',
  UNSUPPORTED_TABLE_GEOMETRY:'The selected table is outside the supported horizontal geometry profile.',
  TABLE_BINDING_REFUSED:'The table relationships do not support one complete unambiguous source-cell binding.'});
export class FinancialTableError extends Error {
  constructor(code){const safe=Object.hasOwn(MESSAGES,code)?code:'TABLE_BINDING_REFUSED';super(MESSAGES[safe]);this.name='FinancialTableError';this.code=safe;}
}
const fail=code=>{throw new FinancialTableError(code);};
const AMOUNT=/^(?:\d+|\d{1,3}(?:,\d{3})+)$/;
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dateLiteral(text){
  if(typeof text!=='string')return false;
  const match=/^([A-Z][a-z]{2}) ([1-9]|[12]\d|3[01]), (\d{4})$/.exec(text);if(!match)return false;
  const month=MONTHS.indexOf(match[1]),year=Number(match[3]);if(month<0||year<1)return false;
  const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];return Number(match[2])<=days[month];
}
function requestOf(value){
  try{
    const keys=['statement','metric','durationMonths','periodEndLiteral','unitHeadingLiteral','currencyGlyph'];
    if(value===null||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error();
    const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
    if(names.length!==keys.length||names.some(key=>!keys.includes(key)))throw Error();
    const request={};for(const key of keys){if(!Object.hasOwn(descriptors[key],'value'))throw Error();request[key]=descriptors[key].value;}
    if(typeof request.statement!=='string'||!Object.hasOwn(UNITS,request.statement)||request.metric!=='Net income'
        ||![3,6].includes(request.durationMonths)||!dateLiteral(request.periodEndLiteral)
        ||request.unitHeadingLiteral!==UNITS[request.statement]||request.currencyGlyph!=='$')throw Error();
    return Object.freeze(request);
  }catch{fail('UNSUPPORTED_LOOKUP_REQUEST');}
}
const nonblank=item=>item.text.trim().length>0;
const x=item=>item.transform[4],y=item=>item.transform[5],right=item=>x(item)+item.width,center=item=>x(item)+item.width/2;
function one(items){if(items.length!==1)fail(items.length===0?'TABLE_EVIDENCE_MISSING':'TABLE_EVIDENCE_AMBIGUOUS');return items[0];}
function four(items){if(items.length!==4)fail(items.length<4?'TABLE_EVIDENCE_MISSING':'TABLE_EVIDENCE_AMBIGUOUS');return items;}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

export function deriveFinancialTableLookup(value,explicitRequest){
  const request=requestOf(explicitRequest); // Unknown scope never reads source.
  let snapshot;try{snapshot=copyFinancialGeometrySource(value);}catch{fail('INVALID_LOOKUP_SOURCE');}
  try{
    const titles=snapshot.pages.flatMap(page=>page.textItems.filter(item=>item.text===request.statement).map(item=>({page,item})));
    const {page,item:title}=one(titles),metric=one(page.textItems.filter(item=>item.text===request.metric));
    const view=page.geometry.view,h=metric.height,epsilon=h/FINANCIAL_TABLE_PROFILE.rowToleranceDivisor;
    if(page.geometry.rotation!==0||page.geometry.userUnit!==1||h<=0)fail('UNSUPPORTED_TABLE_GEOMETRY');
    function supported(item){
      const t=item.transform;
      if(item.width<=0||item.height<=0||item.dir!=='ltr'||t[1]!==0||t[2]!==0||t[0]<=0||t[3]<=0||t[0]!==t[3]
          ||Math.abs(item.height-h)>epsilon||Math.abs(t[0]-h)>epsilon||Math.abs(t[0]-item.height)>epsilon
          ||x(item)<view[0]||right(item)>view[2]||y(item)<view[1]||y(item)>view[3])fail('UNSUPPORTED_TABLE_GEOMETRY');
    }
    supported(title);supported(metric);
    const region=page.textItems.filter(item=>nonblank(item)&&y(item)<y(title)&&y(item)>y(metric));
    const unit=one(region.filter(item=>item.text===request.unitHeadingLiteral));supported(unit);
    if(Math.abs(center(unit)-center(title))>epsilon)fail('TABLE_BINDING_REFUSED');
    const headings=[one(region.filter(item=>item.text==='Three Months Ended')),one(region.filter(item=>item.text==='Six Months Ended'))];
    const dates=four(region.filter(item=>dateLiteral(item.text))).sort((a,b)=>center(a)-center(b));
    for(const item of [...headings,...dates])supported(item);
    const headingY=y(headings[0]),dateY=y(dates[0]);
    // Explain the whole title→date header region, including between baselines.
    // Literal filters alone cannot exclude competing units/durations/titles.
    const headerRegion=page.textItems.filter(item=>nonblank(item)&&y(item)<=y(title)+epsilon
      &&y(item)>=Math.min(...dates.map(y))-epsilon);
    const annotations=headerRegion.filter(item=>item.text==='(Unaudited)');
    if(annotations.length>1)fail('TABLE_EVIDENCE_AMBIGUOUS');
    const annotation=annotations[0]??null;
    if(annotation){supported(annotation);if(y(annotation)>=y(unit)||y(annotation)<=Math.max(...headings.map(y))
      ||Math.abs(center(annotation)-center(title))>epsilon)fail('TABLE_BINDING_REFUSED');}
    const explained=[title,unit,...headings,...dates,...annotations];
    if(headerRegion.length!==explained.length||headerRegion.some(item=>!explained.includes(item)))fail('TABLE_BINDING_REFUSED');
    if(Math.abs(y(headings[1])-headingY)>epsilon||dates.some(item=>Math.abs(y(item)-dateY)>epsilon)
        ||y(title)<=y(unit)||y(unit)<=Math.max(...headings.map(y))||Math.min(...headings.map(y))<=Math.max(...dates.map(y))
        ||Math.min(...dates.map(y))<=y(metric)||headingY-dateY<=2*epsilon||headingY-dateY>2*h)fail('TABLE_BINDING_REFUSED');
    const centers=dates.map(center);
    for(let index=1;index<dates.length;index++)if(centers[index]<=centers[index-1]||x(dates[index])<=right(dates[index-1]))fail('TABLE_BINDING_REFUSED');
    const boundaries=[centers[0]-(centers[1]-centers[0])/2,...centers.slice(0,-1).map((c,index)=>(c+centers[index+1])/2),centers[3]+(centers[3]-centers[2])/2];
    if(boundaries[0]<view[0]||boundaries[4]>view[2])fail('UNSUPPORTED_TABLE_GEOMETRY');
    function inBand(item,index){return x(item)>boundaries[index]+epsilon&&right(item)<boundaries[index+1]-epsilon;}
    for(let index=0;index<dates.length;index++)if(!inBand(dates[index],index))fail('TABLE_BINDING_REFUSED');
    const groups=[null,null];
    for(const heading of headings){
      const matches=[0,1].filter(index=>Math.abs(center(heading)-(centers[2*index]+centers[2*index+1])/2)<=epsilon);
      const index=one(matches);
      if(groups[index]!==null||x(heading)<=boundaries[2*index]+epsilon||right(heading)>=boundaries[2*index+2]-epsilon)fail('TABLE_BINDING_REFUSED');
      groups[index]=heading;
    }
    const pair0=dates.slice(0,2).map(item=>item.text),pair1=dates.slice(2).map(item=>item.text);
    if(new Set(pair0).size!==2||new Set(pair1).size!==2||pair0.some(text=>!pair1.includes(text)))fail('TABLE_EVIDENCE_AMBIGUOUS');
    const row=page.textItems.filter(item=>nonblank(item)&&Math.abs(y(item)-y(metric))<=epsilon);
    for(const item of row)supported(item);
    if(right(metric)>=boundaries[0]-epsilon||row.some(item=>item!==metric&&item.text!==request.currencyGlyph&&!AMOUNT.test(item.text)))fail('TABLE_BINDING_REFUSED');
    if(page.textItems.some(item=>nonblank(item)&&Math.abs(y(item)-y(metric))>epsilon&&Math.abs(y(item)-y(metric))<=4*epsilon))fail('TABLE_BINDING_REFUSED');
    const glyphs=four(row.filter(item=>item.text===request.currencyGlyph)),amounts=four(row.filter(item=>AMOUNT.test(item.text)));
    function member(items,index){return one(items.filter(item=>inBand(item,index)));}
    const bind=(role,item)=>({role,physicalPageNumber:page.physicalPageNumber,pageLabel:page.pageLabel,sourceSha256:snapshot.source.sha256,
      sourceRecordPath:['pages',page.physicalPageNumber-1,'textItems',item.itemIndex],item});
    const columns=dates.map((date,index)=>{
      const glyph=member(glyphs,index),amount=member(amounts,index),heading=groups[Math.floor(index/2)];
      if(right(glyph)>=x(amount)||glyphs.filter(item=>inBand(item,index)).length!==1||amounts.filter(item=>inBand(item,index)).length!==1)fail('TABLE_BINDING_REFUSED');
      return {durationMonths:DURATIONS[heading.text],periodEndLiteral:date.text,band:{left:boundaries[index],right:boundaries[index+1]},
        duration:bind('duration',heading),date:bind('date',date),currency:bind('currency',glyph),value:bind('value',amount)};
    });
    // No unexplained or unassigned row token may be hidden by candidate filters.
    if(glyphs.some(item=>columns.filter(column=>column.currency.item===item).length!==1)
        ||amounts.some(item=>columns.filter(column=>column.value.item===item).length!==1))fail('TABLE_BINDING_REFUSED');
    const selected=one(columns.filter(column=>column.durationMonths===request.durationMonths&&column.periodEndLiteral===request.periodEndLiteral));
    return freeze({schemaVersion:1,status:'source-cell-candidate',generationMode:'not-run',financialCorrectness:'unadjudicated',
      profile:FINANCIAL_TABLE_PROFILE,snapshot,request,source:snapshot.source,physicalPageNumber:page.physicalPageNumber,pageLabel:page.pageLabel,
      amountLiteral:selected.value.item.text,unitHeadingLiteral:unit.text,currencyGlyph:selected.currency.item.text,normalizedCurrency:null,
      bindings:{statement:bind('statement',title),unit:bind('unit',unit),annotation:annotation?bind('annotation',annotation):null,
        metric:bind('metric',metric),duration:selected.duration,date:selected.date,currency:selected.currency,value:selected.value},
      geometry:{height:h,epsilon,rowBaseline:y(metric),durationBaseline:headingY,dateBaseline:dateY,columnBoundaries:boundaries},columns});
  }catch(error){if(error instanceof FinancialTableError)throw error;fail('TABLE_BINDING_REFUSED');}
}
