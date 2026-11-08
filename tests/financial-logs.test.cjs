const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./harness.cjs');
// IDs in these fixtures are placeholders. Actual IDs come from /torn/logtypes.
function log(title,data={},id=99001,category='General'){
  return {id:'sample-'+title,details:{id,title,category},timestamp:1762600000,data,params:{}};
}
function rows(title,data,category){return Array.from(harness().app.parseCashFlowEntry(log(title,data,99001,category)));}
test('live Torn logtypes supply IDs for supported domains without guessed hardcoded IDs',()=>{
  const {app}=harness();
  const ids=app.relevantLogTypes([
    {id:12345,title:'Gym membership purchased'},
    {id:12346,title:'Education course started'},
    {id:12347,title:'Car upgrade purchased'},
    {id:12348,title:'Casino roulette spin'},
    {id:12349,title:'Property sold'},
    {id:12350,title:'Hunting session'},
    {id:12351,title:'Gym trained'}
  ]).map(x=>x.id);
  for(const id of [12345,12346,12347,12348,12349,12350])assert.ok(ids.includes(id),'missing '+id);
  assert.equal(ids.includes(12351),false,'routine energy training is not cash');
});
test('gym membership purchase is a cash expense, training energy is not',()=>{
  assert.deepEqual(rows('Gym membership purchased',{cost:150000}).map(r=>[r.direction,r.amount,r.category]),[['out',150000,'Gym Memberships']]);
  assert.equal(rows('Gym trained',{energy:50,stat_gain:2500}).length,0);
});
test('education course start fee captured, completion not charged',()=>{
  assert.equal(rows('Education course started',{cost:4500})[0].amount,4500);
  assert.equal(rows('Education course completed',{cost:4500}).length,0);
});
test('racing cash upgrade requires a cash-specific field, never racing points cost',()=>{
  assert.equal(rows('Racing car upgrade purchased',{points:20,cost:200}).length,0);
  const {app}=harness(),e=log('Racing car upgrade purchased',{points:20,cost:200});
  assert.equal(app.unrecognizedRowFor(e)?.reason,'Domain log requires confirmed cash amount/direction');
  assert.equal(rows('Racing car upgrade purchased',{cash_spent:100000,points:20})[0].amount,100000);
});
test('casino gross bet and payout are distinct exact cash movements',()=>{
  const r=rows('Casino roulette spin',{bet:100000,payout:250000});
  assert.deepEqual(r.map(x=>[x.direction,x.amount]),[['out',100000],['in',250000]]);
  assert.equal(r[0].id.endsWith(':stake'),true);
  assert.equal(r[1].id.endsWith(':payout'),true);
});
test('casino net money gained is not double-counted as a second gross payout',()=>{
  const r=rows('Casino blackjack won',{money_gained:50000,bet:100000,payout:150000});
  assert.equal(r.length,1);assert.equal(r[0].direction,'in');assert.equal(r[0].amount,50000);
});
test('casino ambiguous winnings are quarantined instead of assumed gross',()=>{
  const {app}=harness(),e=log('Casino poker won',{bet:100,winnings:200});
  assert.equal(app.parseCashFlowEntry(e).length,0);
  assert.ok(app.unrecognizedRowFor(e));
});
test('property sales only count explicitly received proceeds, never cost alone',()=>{
  assert.equal(rows('Property sold',{cost:500000000}).length,0);
  const {app}=harness();
  assert.equal(app.unrecognizedRowFor(log('Property sold',{cost:500000000})).field,'cost');
  const r=rows('Property sold',{money_received:500000000,cost:100000});
  assert.deepEqual(r.map(x=>[x.direction,x.amount]),[['transfer-in',500000000]]);
});
test('property purchase treated as an asset transfer, not spending loss',()=>{
  const r=rows('Property purchased',{cost:100000000});
  assert.equal(r[0].direction,'transfer-out');
  assert.equal(r[0].transfer,true);
});
test('rent collected and rent paid remain opposite cash directions',()=>{
  assert.equal(rows('Property rent collected',{rent:300000})[0].direction,'in');
  assert.equal(rows('Property rent paid',{rent:80000})[0].direction,'out');
  assert.equal(rows('Property rented',{rent:80000}).length,0,'title alone does not identify rent payer');
});
test('bank matured principal is a transfer and interest is income',()=>{
  const r=rows('Bank investment matured',{principal:2000000,interest:200000});
  assert.deepEqual(r.map(x=>[x.direction,x.amount]),[['in',200000],['transfer-in',2000000]]);
});
test('bank deposits are transfers, not personal expenses',()=>{
  const r=rows('Bank deposit',{amount:1000000});
  assert.equal(r[0].direction,'transfer-out');
});
test('stock purchases and sales are capital transfers while dividends remain income',()=>{
  assert.equal(rows('Stock shares purchased',{cost:350000})[0].direction,'transfer-out');
  assert.equal(rows('Stock shares sold',{proceeds:400000,cost:250000})[0].direction,'transfer-in');
  assert.equal(rows('Stock dividend paid',{money_received:8000})[0].direction,'in');
});
test('stock quantity without confirmed sale cash stays unclassified',()=>{
  const {app}=harness(),e=log('Stock shares sold',{shares:100,price:80});
  assert.equal(app.parseCashFlowEntry(e).length,0);
  assert.ok(app.unrecognizedRowFor(e));
});
test('hunting fees and cash gains are separate exact movements',()=>{
  const r=rows('Hunting expedition',{cost:2000,money_gained:5000});
  assert.deepEqual(r.map(x=>[x.direction,x.amount]),[['out',2000],['in',5000]]);
});
test('cashier checks are transfers, not new income or expenses',()=>{
  assert.equal(rows("Cashier's check issued",{amount:250000})[0].direction,'transfer-out');
  assert.equal(rows("Cashier's check cashed",{amount:250000})[0].direction,'transfer-in');
});
test('bail paid, auction fees and service fees are captured conservatively',()=>{
  assert.equal(rows('Bail paid',{cost:50000})[0].direction,'out');
  assert.equal(rows('Auction listing fee',{fee:1200})[0].direction,'out');
  assert.equal(rows('Fortune teller paid',{money_spent:100})[0].direction,'out');
});
test('loan repayment distinguishes debt principal from interest paid',()=>{
  const r=rows('Loan repayment',{total_paid:120000,interest:20000});
  assert.deepEqual(r.map(x=>[x.direction,x.amount]),[['out',20000],['transfer-out',100000]]);
});
test('company daily operating result is retained but never mixed into personal cash flow',()=>{
  const {app}=harness({stored:{cashFlows:[
    {id:'company-adjustment:5:0',timestamp:100,source:'Company Daily Adjustment',direction:'in',amount:9000,category:'Company Profit / Loss'},
    {id:'cashlog:1',timestamp:100,source:'Torn Log',direction:'in',amount:500,category:'Wages / Job'}
  ]}});
  assert.equal(app.state.cashFlows.length,2);
  assert.equal(app.allCashFlows().length,1);
  assert.equal(app.cashFlowSummary(0,200).earned,500);
});
test('Data Quality shows unreconciled financial log IDs without retaining raw payloads',()=>{
  const {app}=harness({stored:{unrecognizedFinancial:[{
    id:'unmapped:abc',timestamp:100,logId:77664,title:'Property sold',
    category:'Property',field:'cost',amount:200000,reason:'Domain log requires confirmed cash amount/direction'
  }]}});
  const html=app.diagnosticsHtml(),report=app.diagnosticReport();
  assert.match(html,/Unclassified Financial Logs \(1\)/);
  assert.match(html,/77664/);
  assert.equal(report.unclassifiedFinance[0].logId,77664);
  assert.equal(JSON.stringify(report).includes('rawPayload'),false);
});
