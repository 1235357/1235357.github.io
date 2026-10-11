import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPageRecord} from '../pdf-source.mjs';
const module=await import('../financial-table-contract.mjs').catch(()=>({}));
const statement='Condensed Consolidated Statements of Income',unit='(In millions, except per share data)';
const req=(extra={})=>({statement,metric:'Net income',durationMonths:3,periodEndLiteral:'Jul 28, 2024',unitHeadingLiteral:unit,currencyGlyph:'$',...extra});
function sourceOf({amounts=['17','23','42','59'],reverse=false,dx=0,dy=0}={}){
  const item=(str,x,y,width=40,height=8)=>({str,dir:'ltr',transform:[8,0,0,8,x+dx,y+dy],width,height,fontName:'f1',hasEOL:false});
  let items=[item(statement,100,720,400),item(unit,200,708,200),item('Three Months Ended',285,670,80),item('Six Months Ended',465,670,80),
    ...['Jul 28, 2024','Jul 30, 2023','Jul 28, 2024','Jul 30, 2023'].map((text,i)=>item(text,260+90*i,658)),item('Net income',20,300,50),
    ...amounts.flatMap((text,i)=>[item('$',240+90*i,300.7,5),item(text,290+90*i,300.7,20)]),item(' ',200,300,50,0),item('',20,280,0,0),item('Other row',20,280,50)];
  if(reverse)items=items.reverse();
  const sha='b'.repeat(64),parser={name:'pdfjs',version:'6.4.299',policyVersion:'text-items-v1',disableNormalization:true};
  return structuredClone({schemaVersion:1,status:'extracted-not-indexed',source:{sha256:sha,name:'synthetic.pdf',size:700},parser,numPages:1,workerMode:'node-fake',pages:[createPageRecord({sourceSha256:sha,parserVersion:parser.version,physicalPageNumber:1,pageLabel:'different',page:{view:[dx,dy,700+dx,800+dy],rotate:0,userUnit:1},textContent:{items}})]});
}
function fixSpans(source){for(const page of source.pages)page.textItems.forEach((item,index)=>{item.itemIndex=index;item.span={id:`${source.source.sha256}/pdfjs-${source.parser.version}/${source.parser.policyVersion}/p${page.physicalPageNumber}/i${index}/u16-0-${item.text.length}`,startUtf16:0,endUtf16:item.text.length,quote:item.text};});return source;}
const textItem=(source,text)=>source.pages[0].textItems.find(item=>item.text===text);
function run(source,request=req()){assert.equal(typeof module.deriveFinancialTableLookup,'function');return module.deriveFinancialTableLookup(source,request);}
test('pure explicit-field lookup preserves complete source and returns exact source-cell bindings, no fingerprint or currency inference',()=>{
  const source=sourceOf(),result=run(source);assert.equal(result.amountLiteral,'17');assert.equal(result.normalizedCurrency,null);assert.equal(result.currencyGlyph,'$');assert.equal(result.unitHeadingLiteral,unit);
  assert.deepEqual(result.snapshot,source);assert.notEqual(result.snapshot,source);assert.equal(Object.hasOwn(result,'snapshotSha256'),false);assert.equal(result.generationMode,'not-run');
  assert.equal(result.bindings.value.item.text,'17');assert.equal(result.bindings.value.item.span.quote,'17');assert.equal(result.bindings.date.item.text,'Jul 28, 2024');assert.equal(result.bindings.duration.item.text,'Three Months Ended');
  assert.equal(result.snapshot.pages[0].textItems.filter(i=>!i.text.trim()).length,2);
  assert.deepEqual(result.bindings.value.sourceRecordPath,['pages',0,'textItems',result.bindings.value.item.itemIndex]);
  function frozen(value){if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));for(const child of Object.values(value))frozen(child);}}frozen(result);
});
test('geometry selection is independent of source amount strings, original indices and absolute coordinates',()=>{
  const source=sourceOf({amounts:['801','905','1,234','7,890'],reverse:true,dx:51,dy:37});
  assert.equal(run(source,req({durationMonths:6})).amountLiteral,'1,234');assert.equal(run(source,req({durationMonths:6,periodEndLiteral:'Jul 30, 2023'})).amountLiteral,'7,890');
  assert.equal(run(source).bindings.value.item.text,'801');
});
test('valid duration and date relabeling binds meaning actually stated at compatible geometry',()=>{
  const source=sourceOf(),a=textItem(source,'Three Months Ended'),b=textItem(source,'Six Months Ended');[a.text,b.text]=[b.text,a.text];fixSpans(source);
  assert.equal(run(source).amountLiteral,'42');assert.equal(run(source,req({durationMonths:6})).amountLiteral,'17');
  const dates=source.pages[0].textItems.filter(i=>i.text.startsWith('Jul')).sort((a,b)=>a.transform[4]-b.transform[4]);
  [dates[0].text,dates[1].text]=[dates[1].text,dates[0].text];fixSpans(source);
  assert.equal(run(source,req({durationMonths:6})).amountLiteral,'23');
});
test('row tolerance covers measured-style offset and rejects a value beyond h/8',()=>{
  const source=sourceOf();assert.equal(run(source).geometry.epsilon,1);
  textItem(source,'17').transform[5]=301.01;assert.throws(()=>run(source),e=>e instanceof module.FinancialTableError);
});
test('supported unsigned integer grammar and captured request remain exact and immutable',()=>{
  const source=sourceOf({amounts:['0','9','12,345','123,456,789']}),request=req({durationMonths:6}),result=run(source,request);
  assert.equal(result.amountLiteral,'12,345');assert.notEqual(result.request,request);request.durationMonths=3;
  assert.equal(result.request.durationMonths,6);assert.ok(Object.isFrozen(result.request));assert.equal(run(source).amountLiteral,'0');
});
test('optional unique Unaudited annotation is preserved with exact source lineage and cannot override header roles',()=>{
  const source=sourceOf(),annotation=structuredClone(textItem(source,unit));annotation.text='(Unaudited)';annotation.transform[4]=275;annotation.transform[5]=690;annotation.width=50;
  source.pages[0].textItems.push(annotation);fixSpans(source);const result=run(source);assert.equal(result.bindings.annotation.item.text,'(Unaudited)');
  assert.deepEqual(result.bindings.annotation.item,source.pages[0].textItems.at(-1));
  const duplicate=structuredClone(source);duplicate.pages[0].textItems.push(structuredClone(duplicate.pages[0].textItems.at(-1)));fixSpans(duplicate);assert.throws(()=>run(duplicate),e=>e.code==='TABLE_EVIDENCE_AMBIGUOUS');
  const misplaced=structuredClone(source);misplaced.pages[0].textItems.at(-1).transform[5]=710;assert.throws(()=>run(misplaced),e=>e.code==='TABLE_BINDING_REFUSED');
});
for(const [name,mutate]of [
  ['missing duration',s=>s.pages[0].textItems=s.pages[0].textItems.filter(i=>i.text!=='Six Months Ended')],
  ['duplicate duration',s=>s.pages[0].textItems.push(structuredClone(textItem(s,'Three Months Ended')))],
  ['missing date',s=>s.pages[0].textItems=s.pages[0].textItems.filter(i=>i.itemIndex!==4)],
  ['duplicate dated text in group',s=>s.pages[0].textItems[5].text='Jul 28, 2024'],
  ['overlapping date extents',s=>s.pages[0].textItems[5].transform[4]=s.pages[0].textItems[4].transform[4]+10],
  ['displaced duration center',s=>textItem(s,'Three Months Ended').transform[4]+=4],
  ['date above duration',s=>s.pages[0].textItems.filter(i=>i.text.startsWith('Jul')).forEach(i=>i.transform[5]=680)],
  ['duplicate statement',s=>s.pages[0].textItems.push(structuredClone(textItem(s,statement)))],
  ['competing unknown statement on title baseline',s=>{const i=structuredClone(textItem(s,statement));i.text='Other Statement';s.pages[0].textItems.push(i);} ],
  ['duplicate unit',s=>s.pages[0].textItems.push(structuredClone(textItem(s,unit)))],
  ['competing unit on exact baseline',s=>{const i=structuredClone(textItem(s,unit));i.text='(In thousands)';s.pages[0].textItems.push(i);} ],
  ['competing unit on separate preheader line',s=>{const i=structuredClone(textItem(s,unit));i.text='(In thousands)';i.transform[5]-=5;s.pages[0].textItems.push(i);} ],
  ['unknown duration on exact baseline',s=>{const i=structuredClone(textItem(s,'Three Months Ended'));i.text='Nine Months Ended';s.pages[0].textItems.push(i);} ],
  ['unknown duration between heading and dated line',s=>{const i=structuredClone(textItem(s,'Three Months Ended'));i.text='Nine Months Ended';i.transform[5]-=5;s.pages[0].textItems.push(i);} ],
  ['unknown token on date baseline',s=>{const i=structuredClone(textItem(s,'Jul 28, 2024'));i.text='Estimated';s.pages[0].textItems.push(i);} ],
  ['different dated sets across groups',s=>s.pages[0].textItems[7].text='Jul 31, 2023'],
  ['wrong unit',s=>textItem(s,unit).text='(In thousands)'],
  ['misaligned unit',s=>textItem(s,unit).transform[4]+=5],
  ['unit below metric',s=>textItem(s,unit).transform[5]=250],
  ['duplicate metric',s=>s.pages[0].textItems.push(structuredClone(textItem(s,'Net income')))],
  ['near competing row',s=>textItem(s,'Other row').transform[5]=302],
  ['unknown nonblank row item',s=>{const extra=structuredClone(textItem(s,'Other row'));extra.text='footnote';extra.transform[5]=300;s.pages[0].textItems.push(extra);} ],
  ['value crosses band though center remains inside',s=>{const i=textItem(s,'17');i.transform[4]=280;i.width=70;}],
  ['glyph crosses band',s=>{const i=textItem(s,'$');i.transform[4]=230;i.width=20;}],
  ['duplicate value',s=>s.pages[0].textItems.push(structuredClone(textItem(s,'17')))],
  ['missing glyph',s=>s.pages[0].textItems=s.pages[0].textItems.filter(i=>i.itemIndex!==9)],
  ['Net income per share is different metric',s=>textItem(s,'Net income').text='Net income per share:'],
  ['selected zero-area',s=>textItem(s,'17').height=0],['RTL',s=>textItem(s,'17').dir='rtl'],
  ['shear',s=>textItem(s,'17').transform[1]=0.01],['rotation',s=>s.pages[0].geometry.rotation=90],['userUnit',s=>s.pages[0].geometry.userUnit=2],
  ['unequal diagonal',s=>textItem(s,'17').transform[3]=9],['out-of-view title',s=>textItem(s,statement).transform[4]=-1],
  ['compounded scale drift exceeds metric-height tolerance',s=>{const i=textItem(s,'17');i.height=8.8;i.transform[0]=i.transform[3]=9.6;}],
  ['out-of-view metric baseline',s=>textItem(s,'Net income').transform[5]=-1],
])test(`refuses ${name} without choosing another numeric cell`,()=>{const source=sourceOf();mutate(source);fixSpans(source);assert.throws(()=>run(source),e=>e instanceof module.FinancialTableError&&!e.message.includes('SECRET'));});
for(const literal of ['-17','(17)','17.0','17%','—','1 234','1,23'])test(`unsupported amount grammar ${literal} refuses`,()=>{const source=sourceOf();textItem(source,'17').text=literal;fixSpans(source);assert.throws(()=>run(source),e=>e instanceof module.FinancialTableError);});
test('unsupported request refuses before touching source, and no caller fingerprint is admitted',()=>{
  let reads=0;const source={get pages(){reads++;throw Error('SECRET');}};
  for(const extra of [{metric:'Revenue'},{durationMonths:12},{unitHeadingLiteral:'USD millions'},{currencyGlyph:'USD'},{periodEndLiteral:'Feb 31, 2024'},{snapshotSha256:'a'.repeat(64)}])assert.throws(()=>run(source,req(extra)),e=>e.code==='UNSUPPORTED_LOOKUP_REQUEST');
  assert.equal(reads,0);
});
test('request accessor, missing field and foreign prototype refuse without source access or secret leakage',()=>{
  let reads=0;const source={get pages(){reads++;throw Error('SECRET');}},accessor=req();Object.defineProperty(accessor,'metric',{get(){reads++;throw Error('SECRET');},enumerable:true});
  const missing=req();delete missing.currencyGlyph;const foreign=Object.assign(Object.create({inherited:true}),req());
  for(const request of [accessor,missing,foreign])assert.throws(()=>run(source,request),e=>e.code==='UNSUPPORTED_LOOKUP_REQUEST'&&!e.message.includes('SECRET'));
  assert.equal(reads,0);
});
test('actual native development archive derives four dated cells for each explicit statement with complete item bindings',()=>{
  const source=JSON.parse(readFileSync(new URL('../../docs/acceptance-2026-10-11/native-pdfjs-full-geometry.json',import.meta.url)));
  for(const page of source.pages){
    const title=page.textItems.find(i=>i.text.startsWith('Condensed Consolidated Statements of')).text;
    const literal=page.textItems.find(i=>i.text.startsWith('(In millions')).text;
    const dates=[...new Set(page.textItems.filter(i=>/^Jul \d{1,2}, \d{4}$/.test(i.text)).map(i=>i.text))];
    for(const durationMonths of [3,6])for(const periodEndLiteral of dates){
      const result=run(source,req({statement:title,unitHeadingLiteral:literal,durationMonths,periodEndLiteral}));
      const bound=page.textItems[result.bindings.value.item.itemIndex];assert.equal(result.amountLiteral,bound.text);assert.deepEqual(result.bindings.value.item,bound);
      assert.equal(result.bindings.date.item.text,periodEndLiteral);assert.equal(result.bindings.duration.item.text,durationMonths===3?'Three Months Ended':'Six Months Ended');
      assert.equal(result.normalizedCurrency,null);assert.deepEqual(result.snapshot,source);
      assert.deepEqual(result.bindings.annotation.item,page.textItems.find(i=>i.text==='(Unaudited)'));
    }
  }
});
test('mutated native archive controls refuse competing unit/duration on or between header baselines',()=>{
  const original=JSON.parse(readFileSync(new URL('../../docs/acceptance-2026-10-11/native-pdfjs-full-geometry.json',import.meta.url)));
  for(const [oldText,newText,delta=0]of [[unit,'(In thousands)'],[unit,'(In thousands)',-5],['Three Months Ended','Nine Months Ended'],['Three Months Ended','Nine Months Ended',-5],['Jul 28, 2024','Estimated']]){
    const source=structuredClone(original),item=structuredClone(textItem(source,oldText));item.text=newText;item.transform[5]+=delta;source.pages[0].textItems.push(item);fixSpans(source);
    assert.throws(()=>run(source),e=>e.code==='TABLE_BINDING_REFUSED');
  }
});
