import {copyFinancialGeometrySource} from './financial-geometry-source.mjs';
import {FinancialTableError} from './financial-table-contract.mjs';

// This annual geometry profile is independent of the quarterly contract.
// Native date/year records stay separate even when their semantic date is composed.
export const FINANCIAL_ANNUAL_TABLE_PROFILE=Object.freeze({version:'pdfjs-net-income-annual-horizontal-v1',
  rowToleranceDivisor:6,columnCount:3,normalizedCurrency:null,
  amountGrammar:'unsigned integer or comma groups; no signs, decimals, parentheses or split tokens'});
const TITLES=['Consolidated Statements of Income','CONSOLIDATED STATEMENTS OF INCOME'];
const UNIT='(In millions, except per share data)';
const AMOUNT=/^(?:\d+|\d{1,3}(?:,\d{3})+)$/;
const SHORT_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const LONG_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const fail=code=>{throw new FinancialTableError(code);};
function dateOf(text){
  if(typeof text!=='string')return null;
  const match=/^([A-Z][a-z]+) ([1-9]|[12]\d|3[01]), (\d{4})$/.exec(text);if(!match)return null;
  const month=Math.max(SHORT_MONTHS.indexOf(match[1]),LONG_MONTHS.indexOf(match[1])),year=Number(match[3]),day=Number(match[2]);
  if(month<0||year<1)return null;
  const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return day<=days[month]?{year,month,day,ordinal:year*10000+(month+1)*100+day}:null;
}
const datePart=text=>typeof text==='string'&&/^([A-Z][a-z]+) ([1-9]|[12]\d|3[01]),$/.test(text);
function requestOf(value){
  try{
    const keys=['statement','metric','periodKind','durationMonths','periodEndLiteral','unitHeadingLiteral','currencyGlyph'];
    if(value===null||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error();
    const descriptors=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(descriptors);
    if(names.length!==keys.length||names.some(key=>!keys.includes(key)))throw Error();
    const request={};for(const key of keys){if(!Object.hasOwn(descriptors[key],'value'))throw Error();request[key]=descriptors[key].value;}
    if(!TITLES.includes(request.statement)||request.metric!=='Net income'||request.periodKind!=='fiscal_year'
      ||request.durationMonths!==null||!dateOf(request.periodEndLiteral)||request.unitHeadingLiteral!==UNIT||request.currencyGlyph!=='$')throw Error();
    return Object.freeze(request);
  }catch{fail('UNSUPPORTED_LOOKUP_REQUEST');}
}
const nonblank=item=>item.text.trim().length>0;
const x=item=>item.transform[4],y=item=>item.transform[5],right=item=>x(item)+item.width,center=item=>x(item)+item.width/2;
function one(items){if(items.length!==1)fail(items.length===0?'TABLE_EVIDENCE_MISSING':'TABLE_EVIDENCE_AMBIGUOUS');return items[0];}
function three(items){if(items.length!==3)fail(items.length<3?'TABLE_EVIDENCE_MISSING':'TABLE_EVIDENCE_AMBIGUOUS');return items;}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

export function deriveAnnualFinancialTableLookup(value,explicitRequest){
  const request=requestOf(explicitRequest); // Refuse unsupported scope before inspecting source.
  let snapshot;try{snapshot=copyFinancialGeometrySource(value);}catch{fail('INVALID_LOOKUP_SOURCE');}
  try{
    const titles=snapshot.pages.flatMap(page=>page.textItems.filter(item=>item.text===request.statement).map(item=>({page,item})));
    const {page,item:title}=one(titles),metric=one(page.textItems.filter(item=>item.text===request.metric));
    const view=page.geometry.view,h=metric.height,epsilon=h/FINANCIAL_ANNUAL_TABLE_PROFILE.rowToleranceDivisor;
    if(page.geometry.rotation!==0||page.geometry.userUnit!==1||h<=0)fail('UNSUPPORTED_TABLE_GEOMETRY');
    function supported(item){
      const t=item.transform;
      if(item.width<=0||item.height<=0||item.dir!=='ltr'||t[1]!==0||t[2]!==0||t[0]<=0||t[3]<=0||t[0]!==t[3]
        ||Math.abs(item.height-h)>epsilon||Math.abs(t[0]-h)>epsilon||Math.abs(t[0]-item.height)>epsilon
        ||x(item)<view[0]||right(item)>view[2]||y(item)<view[1]||y(item)>view[3])fail('UNSUPPORTED_TABLE_GEOMETRY');
    }
    supported(title);supported(metric);
    const region=page.textItems.filter(item=>nonblank(item)&&y(item)<y(title)&&y(item)>y(metric));
    const unit=one(region.filter(item=>item.text===request.unitHeadingLiteral)),heading=one(region.filter(item=>item.text==='Year Ended'));
    supported(unit);supported(heading);
    if(Math.abs(center(unit)-center(title))>epsilon)fail('TABLE_BINDING_REFUSED');
    const complete=region.filter(item=>dateOf(item.text)),parts=region.filter(item=>datePart(item.text));
    const years=region.filter(item=>/^\d{4}$/.test(item.text));
    let dates,dateYears;
    if(complete.length){
      dates=three(complete).sort((a,b)=>center(a)-center(b));dateYears=[null,null,null];
      if(parts.length||years.length)fail('TABLE_BINDING_REFUSED');
    }else{
      dates=three(parts).sort((a,b)=>center(a)-center(b));dateYears=three(years).sort((a,b)=>center(a)-center(b));
    }
    for(const item of [...dates,...dateYears.filter(Boolean)])supported(item);
    const dateY=y(dates[0]),yearY=dateYears[0]?y(dateYears[0]):null,headingY=y(heading);
    if(dates.some(item=>Math.abs(y(item)-dateY)>epsilon)||y(title)<=y(unit)||y(unit)<=headingY
      ||headingY<=Math.max(...dates.map(y))||headingY-dateY<=2*epsilon||headingY-dateY>2*h
      ||Math.min(...dates.map(y))<=y(metric))fail('TABLE_BINDING_REFUSED');
    if(yearY!==null&&(dateYears.some(item=>Math.abs(y(item)-yearY)>epsilon)||Math.min(...dates.map(y))<=Math.max(...dateYears.map(y))
      ||dateY-yearY<=2*epsilon||dateY-yearY>2*h||Math.min(...dateYears.map(y))<=y(metric)
      ||dates.some((item,index)=>Math.abs(center(item)-center(dateYears[index]))>epsilon)))fail('TABLE_BINDING_REFUSED');
    const headerRegion=page.textItems.filter(item=>nonblank(item)&&y(item)<=y(title)+epsilon
      &&y(item)>=Math.min(...[...dates,...dateYears.filter(Boolean)].map(y))-epsilon);
    const explained=[title,unit,heading,...dates,...dateYears.filter(Boolean)];
    if(headerRegion.length!==explained.length||headerRegion.some(item=>!explained.includes(item)))fail('TABLE_BINDING_REFUSED');
    const literals=dates.map((item,index)=>dateYears[index]?`${item.text} ${dateYears[index].text}`:item.text);
    const meanings=literals.map(dateOf);
    if(meanings.some(item=>!item)||meanings.some((item,index)=>index>0
      &&(item.ordinal>=meanings[index-1].ordinal||item.year!==meanings[index-1].year-1)))fail('TABLE_BINDING_REFUSED');
    // Column centers come from actual headers, never parser item order or an amount label.
    const centers=(yearY===null?dates:dateYears).map(center);
    for(let index=1;index<3;index++)if(centers[index]<=centers[index-1]||x(dates[index])<=right(dates[index-1]))fail('TABLE_BINDING_REFUSED');
    const boundaries=[centers[0]-(centers[1]-centers[0])/2,(centers[0]+centers[1])/2,
      (centers[1]+centers[2])/2,centers[2]+(centers[2]-centers[1])/2];
    if(boundaries[0]<view[0]||boundaries[3]>view[2])fail('UNSUPPORTED_TABLE_GEOMETRY');
    function inBand(item,index){return x(item)>boundaries[index]+epsilon&&right(item)<boundaries[index+1]-epsilon;}
    for(let index=0;index<3;index++)if(!inBand(dates[index],index)||(dateYears[index]&&!inBand(dateYears[index],index)))fail('TABLE_BINDING_REFUSED');
    if(Math.abs(center(heading)-(centers[0]+centers[2])/2)>epsilon
      ||x(heading)<=boundaries[0]+epsilon||right(heading)>=boundaries[3]-epsilon)fail('TABLE_BINDING_REFUSED');
    const row=page.textItems.filter(item=>nonblank(item)&&Math.abs(y(item)-y(metric))<=epsilon);
    for(const item of row)supported(item);
    if(right(metric)>=boundaries[0]-epsilon||row.some(item=>item!==metric&&item.text!==request.currencyGlyph&&!AMOUNT.test(item.text)))fail('TABLE_BINDING_REFUSED');
    if(page.textItems.some(item=>nonblank(item)&&Math.abs(y(item)-y(metric))>epsilon&&Math.abs(y(item)-y(metric))<=4*epsilon))fail('TABLE_BINDING_REFUSED');
    const glyphs=three(row.filter(item=>item.text===request.currencyGlyph)),amounts=three(row.filter(item=>AMOUNT.test(item.text)));
    const bind=(role,item)=>({role,physicalPageNumber:page.physicalPageNumber,pageLabel:page.pageLabel,sourceSha256:snapshot.source.sha256,
      sourceRecordPath:['pages',page.physicalPageNumber-1,'textItems',item.itemIndex],item});
    const columns=dates.map((date,index)=>{
      const glyph=one(glyphs.filter(item=>inBand(item,index))),amount=one(amounts.filter(item=>inBand(item,index)));
      if(right(glyph)>=x(amount))fail('TABLE_BINDING_REFUSED');
      return {periodKind:'fiscal_year',durationMonths:null,periodEndLiteral:literals[index],band:{left:boundaries[index],right:boundaries[index+1]},
        duration:bind('duration',heading),date:bind('date',date),date_year:dateYears[index]?bind('date_year',dateYears[index]):null,
        currency:bind('currency',glyph),value:bind('value',amount)};
    });
    if(glyphs.some(item=>columns.filter(column=>column.currency.item===item).length!==1)
      ||amounts.some(item=>columns.filter(column=>column.value.item===item).length!==1))fail('TABLE_BINDING_REFUSED');
    const selected=one(columns.filter(column=>column.periodEndLiteral===request.periodEndLiteral));
    return freeze({schemaVersion:2,status:'source-cell-candidate',generationMode:'not-run',financialCorrectness:'unadjudicated',
      profile:FINANCIAL_ANNUAL_TABLE_PROFILE,snapshot,request,source:snapshot.source,physicalPageNumber:page.physicalPageNumber,pageLabel:page.pageLabel,
      amountLiteral:selected.value.item.text,unitHeadingLiteral:unit.text,currencyGlyph:selected.currency.item.text,normalizedCurrency:null,
      periodKind:'fiscal_year',durationMonths:null,
      bindings:{statement:bind('statement',title),unit:bind('unit',unit),annotation:null,metric:bind('metric',metric),
        duration:selected.duration,date:selected.date,date_year:selected.date_year,currency:selected.currency,value:selected.value},
      geometry:{height:h,epsilon,rowBaseline:y(metric),durationBaseline:headingY,dateBaseline:dateY,yearBaseline:yearY,columnBoundaries:boundaries},columns});
  }catch(error){if(error instanceof FinancialTableError)throw error;fail('TABLE_BINDING_REFUSED');}
}
