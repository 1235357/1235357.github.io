import {createPageRecord} from '../pdf-source.mjs';

export const annualRequest=(extra={})=>({statement:'Consolidated Statements of Income',metric:'Net income',
  periodKind:'fiscal_year',durationMonths:null,periodEndLiteral:'Jan 25, 2026',
  unitHeadingLiteral:'(In millions, except per share data)',currencyGlyph:'$',...extra});

export function annualSource({split=false,reverse=false,dx=0,dy=0,offset=1.1,
  amounts=['781','253','6,179'],statement='Consolidated Statements of Income'}={}){
  const item=(str,x,y,width=40,height=8)=>({str,dir:'ltr',transform:[8,0,0,8,x+dx,y+dy],
    width,height,fontName:'synthetic-annual',hasEOL:false});
  let items=[item(statement,100,720,400),item('(In millions, except per share data)',200,708,200),
    item('Year Ended',350,680,80),
    ...(split?['January 31,','January 26,','January 27,'].flatMap((text,i)=>[
      item(text,275+90*i,668,50),item(String(2021-i),290+90*i,660,20)])
      :['Jan 25, 2026','Jan 26, 2025','Jan 28, 2024'].map((text,i)=>item(text,275+90*i,668,50))),
    item('Net income',20,300,50),...amounts.flatMap((text,i)=>[
      item('$',280+90*i,300+offset,5),item(text,310+90*i,300+offset,20)]),
    item('Other row',20,280,50),item(' ',200,300,40,0),item('',20,275,0,0)];
  if(reverse)items=items.reverse();
  const sha='c'.repeat(64),parser={name:'pdfjs',version:'6.4.299',policyVersion:'text-items-v1',disableNormalization:true};
  return structuredClone({schemaVersion:1,status:'extracted-not-indexed',source:{sha256:sha,name:'annual-synthetic.pdf',size:900},
    parser,numPages:1,workerMode:'node-fake',pages:[createPageRecord({sourceSha256:sha,parserVersion:parser.version,
      physicalPageNumber:1,pageLabel:null,page:{view:[dx,dy,700+dx,800+dy],rotate:0,userUnit:1},textContent:{items}})]});
}
export const itemOf=(source,text)=>source.pages[0].textItems.find(item=>item.text===text);
export function fixAnnualSpans(source){for(const page of source.pages)page.textItems.forEach((item,index)=>{
  item.itemIndex=index;item.span={id:`${source.source.sha256}/pdfjs-${source.parser.version}/${source.parser.policyVersion}/p${page.physicalPageNumber}/i${index}/u16-0-${item.text.length}`,
    startUtf16:0,endUtf16:item.text.length,quote:item.text};});return source;}
