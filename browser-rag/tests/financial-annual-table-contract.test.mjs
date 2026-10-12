import test from 'node:test';
import assert from 'node:assert/strict';
import {annualSource,annualRequest,itemOf,fixAnnualSpans} from './annual-table-fixture.mjs';
import {FinancialTableError,FINANCIAL_TABLE_PROFILE} from '../financial-table-contract.mjs';
const annual=await import('../financial-annual-table-contract.mjs').catch(()=>({}));
function run(source,request=annualRequest()){
  assert.equal(typeof annual.deriveAnnualFinancialTableLookup,'function');
  return annual.deriveAnnualFinancialTableLookup(source,request);
}
function refuses(source,request=annualRequest()){
  assert.throws(()=>run(source,request),error=>error instanceof FinancialTableError&&!error.message.includes('SECRET'));
}
for(const split of [false,true])test(`three ${split?'split':'complete'} dates retain actual individual source records and fiscal-year meaning`,()=>{
  const source=annualSource({split,reverse:true,dx:41,dy:29,amounts:['9,017','23','708'],
    statement:split?'CONSOLIDATED STATEMENTS OF INCOME':'Consolidated Statements of Income'});
  const dates=split?['January 31, 2021','January 26, 2020','January 27, 2019']:['Jan 25, 2026','Jan 26, 2025','Jan 28, 2024'];
  for(const [index,date] of dates.entries()){
    const result=run(source,annualRequest({statement:split?'CONSOLIDATED STATEMENTS OF INCOME':'Consolidated Statements of Income',periodEndLiteral:date}));
    assert.equal(result.schemaVersion,2);assert.equal(result.amountLiteral,['9,017','23','708'][index]);
    assert.equal(result.periodKind,'fiscal_year');assert.equal(result.durationMonths,null);
    assert.equal(result.generationMode,'not-run');assert.equal(result.financialCorrectness,'unadjudicated');
    assert.equal(result.normalizedCurrency,null);assert.equal(result.columns.length,3);
    assert.deepEqual(result.snapshot,source);assert.notEqual(result.snapshot,source);
    assert.equal(result.bindings.duration.item.text,'Year Ended');
    for(const binding of Object.values(result.bindings).filter(Boolean)){
      assert.deepEqual(binding.item,source.pages[0].textItems[binding.item.itemIndex]);
      assert.equal(binding.item.span.quote,binding.item.text);
      assert.deepEqual(binding.sourceRecordPath,['pages',0,'textItems',binding.item.itemIndex]);
    }
    if(split){assert.equal(result.bindings.date_year.item.text,String(2021-index));
      assert.notEqual(result.bindings.date.item.itemIndex,result.bindings.date_year.item.itemIndex);
      assert.equal(source.pages[0].textItems.some(item=>item.text===date),false);}
    else assert.equal(result.bindings.date.item.text,date);
    assert.ok(Object.isFrozen(result.snapshot.pages[0].textItems[0]));
  }
});
test('annual tolerance is independent and rejects just outside its declared bound',()=>{
  const source=annualSource({offset:8/6});const result=run(source);
  assert.equal(result.geometry.epsilon,8/6);assert.equal(FINANCIAL_TABLE_PROFILE.rowToleranceDivisor,8);
  itemOf(source,'781').transform[5]+=0.0001;refuses(source);
});
test('date meaning follows native relabeling rather than ordinal or expected amount',()=>{
  const source=annualSource(),a=itemOf(source,'Jan 25, 2026'),b=itemOf(source,'Jan 26, 2025');
  [a.text,b.text]=[b.text,a.text];fixAnnualSpans(source);refuses(source);
});
for(const [label,change] of [
  ['missing period',s=>s.pages[0].textItems=s.pages[0].textItems.filter(i=>i.text!=='Year Ended')],
  ['duplicate period',s=>s.pages[0].textItems.push(structuredClone(itemOf(s,'Year Ended')))],
  ['unknown header',s=>{const i=structuredClone(itemOf(s,'Year Ended'));i.text='Unaudited estimate';i.transform[5]-=5;s.pages[0].textItems.push(i);}],
  ['duplicate title',s=>s.pages[0].textItems.push(structuredClone(itemOf(s,'Consolidated Statements of Income')))],
  ['wrong unit',s=>itemOf(s,'(In millions, except per share data)').text='(In thousands)'],
  ['competing unit',s=>{const i=structuredClone(itemOf(s,'Year Ended'));i.text='(In thousands)';i.transform[5]+=4;s.pages[0].textItems.push(i);}],
  ['period displaced',s=>itemOf(s,'Year Ended').transform[4]+=2],
  ['duplicate date',s=>itemOf(s,'Jan 26, 2025').text='Jan 25, 2026'],
  ['missing date',s=>s.pages[0].textItems=s.pages[0].textItems.filter(i=>i.text!=='Jan 28, 2024')],
  ['invalid date',s=>itemOf(s,'Jan 25, 2026').text='Feb 31, 2026'],
  ['mixed layout',s=>{const i=structuredClone(itemOf(s,'Jan 25, 2026'));i.text='2026';i.transform[5]-=8;s.pages[0].textItems.push(i);}],
  ['overlapping dates',s=>itemOf(s,'Jan 26, 2025').transform[4]=280],
  ['date above period',s=>itemOf(s,'Jan 25, 2026').transform[5]=690],
  ['duplicate metric',s=>s.pages[0].textItems.push(structuredClone(itemOf(s,'Net income')))],
  ['near competing row',s=>itemOf(s,'Other row').transform[5]=303],
  ['unknown row token',s=>{const i=structuredClone(itemOf(s,'Other row'));i.text='footnote';i.transform[5]=300;s.pages[0].textItems.push(i);}],
  ['amount across band',s=>{const i=itemOf(s,'781');i.transform[4]=280;i.width=100;}],
  ['glyph across band',s=>{const i=itemOf(s,'$');i.transform[4]=250;i.width=50;}],
  ['duplicate amount',s=>s.pages[0].textItems.push(structuredClone(itemOf(s,'781')))],
  ['missing glyph',s=>s.pages[0].textItems=s.pages[0].textItems.filter(i=>i.itemIndex!==itemOf(s,'$').itemIndex)],
  ['zero height',s=>itemOf(s,'781').height=0],
  ['rtl',s=>itemOf(s,'781').dir='rtl'],
  ['shear',s=>itemOf(s,'781').transform[1]=0.1],
  ['rotation',s=>s.pages[0].geometry.rotation=90],
  ['userUnit',s=>s.pages[0].geometry.userUnit=2],
  ['unequal scale',s=>itemOf(s,'781').transform[3]=9],
])test(`annual refuses ${label}`,()=>{const source=annualSource();change(source);fixAnnualSpans(source);refuses(source);});
for(const amount of ['-781','(781)','781.0','—','1 234','1,23','781 $'])test(`annual refuses unsupported amount ${amount}`,()=>{
  const source=annualSource();itemOf(source,'781').text=amount;fixAnnualSpans(source);refuses(source);
});
for(const [label,change] of [
  ['missing year',s=>s.pages[0].textItems=s.pages[0].textItems.filter(i=>i.text!=='2021')],
  ['duplicate year',s=>itemOf(s,'2020').text='2021'],
  ['cross-paired year',s=>itemOf(s,'2021').transform[4]+=90],
  ['day-year centers outside bound',s=>itemOf(s,'2021').transform[4]+=2],
  ['unknown date line item',s=>{const i=structuredClone(itemOf(s,'2021'));i.text='approx';s.pages[0].textItems.push(i);}],
])test(`annual split layout refuses ${label}`,()=>{const source=annualSource({split:true});change(source);fixAnnualSpans(source);
  refuses(source,annualRequest({periodEndLiteral:'January 31, 2021'}));});
test('invalid exact request descriptors refuse before source access without private contents',()=>{
  let reads=0;const source=new Proxy({},{get(){reads++;throw Error('SECRET');}});
  for(const extra of [{periodKind:'months'},{periodKind:'12_months'},{durationMonths:12},{durationMonths:3},
    {metric:'Revenue'},{statement:'Consolidated Statements of Comprehensive Income'},
    {currencyGlyph:'USD'},{periodEndLiteral:'Feb 31, 2026'},{periodEndLiteral:'Jan 1, 0000'},{extra:true}]){
    assert.throws(()=>run(source,annualRequest(extra)),e=>e.code==='UNSUPPORTED_LOOKUP_REQUEST');
  }
  const accessor=annualRequest();Object.defineProperty(accessor,'periodKind',{get(){reads++;throw Error('SECRET');},enumerable:true});
  const missing=annualRequest();delete missing.periodKind;
  for(const value of [accessor,missing,Object.assign(Object.create({foreign:true}),annualRequest())])
    assert.throws(()=>run(source,value),e=>e.code==='UNSUPPORTED_LOOKUP_REQUEST');
  assert.equal(reads,0);
});
