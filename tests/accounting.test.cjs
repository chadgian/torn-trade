const test=require('node:test');
const assert=require('node:assert/strict');
const {harness,item,log,trade,entry}=require('./harness.cjs');
const tx=(id,side,timestamp,qty,total,extra={})=>({id,itemId:206,side,timestamp,qty,total,netTotal:total,source:'Torn Shop',...extra});
test('city shop totals, nested fields, explicit zero, missing values and aliases',()=>{
  const {app}=harness();
  for(const data of [{item:206,quantity:3,cost_total:600},{purchase:{item_id:206,quantity:3,cost_each:200}}]){const rows=app.parseLogEntry(log('shop',4200,'Item shop buy',100,data));assert.equal(rows.length,1);assert.equal(rows[0].qty,3);assert.equal(rows[0].total,600);}
  assert.equal(app.normalizeItems({item:206,item_id:206,quantity:2})[0].qty,2);
  assert.equal(app.normalizeItems({item:206,quantity:0}).length,0);
  assert.equal(app.parseLogEntry(log('zero',4200,'Item shop buy',100,{item:206,quantity:1,cost_total:0}))[0].costKnown,true);
  assert.equal(app.parseLogEntry(log('unknown',4200,'Item shop buy',100,{item:206,quantity:1}))[0].costKnown,false);
});
test('one FIFO engine conserves lots across sales, gifts and consumption',()=>{
  const {app}=harness();const rows=[tx('a','buy',100,10,1000),tx('b','buy',200,5,1000),tx('c','transfer-out',210,2,0),tx('d','consume-out',220,1,0),tx('e','sell',300,9,1800)];
  const result=app.computeFifo(rows,item);assert.equal(result.remainingQty,3);assert.equal(result.remainingCost,600);assert.equal(result.events.at(-1).realizedProfit,700);assert.equal(result.ledger.reduce((n,x)=>n+x.realizedProfit,0),700);assert.equal(result.ledger[0].status,'depleted');assert.equal(result.ledger[1].soldQty,2);
});
test('unmatched sales and unknown costs are excluded from profit',()=>{
  const {app}=harness();const result=app.computeFifo([tx('a','buy',100,2,0,{costKnown:false}),tx('b','sell',200,3,900)],item);
  assert.equal(result.events[1].unknownCostQty,2);assert.equal(result.events[1].unmatchedQty,1);assert.equal(result.events[1].realizedProfit,0);
});
test('latest matched sale time and source agree across city shops and trades',()=>{
  const {app}=harness({stored:{catalog:[item],transactions:[tx('a','buy',100,10,100),tx('b','sell',200,2,50),tx('c','sell',300,3,90,{source:'Player Trade',tradeId:42})]}});
  const row=app.acquisitionLedgerRows()[0];assert.equal(row.lastSoldAt,300);assert.equal(row.lastSaleSource,'Player Trade');assert.equal(row.soldQty,5);app.state.dateMode='all';assert.equal(app.latestSalesRows()[0].tradeId,42);
});
test('corrected cached transactions invalidate FIFO and acquisition views immediately',()=>{
  const {app}=harness({stored:{catalog:[item],transactions:[tx('a','buy',100,5,100),tx('b','sell',200,1,30)]}});assert.equal(app.fifoAnalytics(206).remainingQty,4);app.checkpointTransactionRows({id:'sync',diagnostics:{}},[tx('b','sell',200,3,90)]);assert.equal(app.fifoAnalytics(206).remainingQty,2);assert.equal(app.acquisitionLedgerRows()[0].soldQty,3);
});
test('mixed trade allocations preserve net cash and mark estimates',()=>{
  const {app}=harness({stored:{catalog:[item,{id:258,name:'Plushie',marketPrice:50}]}});const rows=app.parsePlayerTrade(trade(10,100,[entry(1,'Item',206,2),entry(2,'Item',258,1),entry(2,'Money',0,400)]),1);
  assert.equal(rows.filter(x=>x.side==='sell').reduce((n,x)=>n+x.total,0)-rows.filter(x=>x.side==='buy').reduce((n,x)=>n+x.total,0),400);assert.equal(rows.every(x=>x.estimated),true);
});
test('single-item cash trades use actual cash; unsupported assets exclude item profit',()=>{
  const {app}=harness({stored:{catalog:[item]}});const exact=app.parsePlayerTrade(trade(11,100,[entry(1,'Item',206,2),entry(2,'Money',0,400)]),1)[0];assert.equal(exact.total,400);assert.equal(exact.estimated,false);
  const unknown=app.parsePlayerTrade(trade(12,100,[entry(1,'Item',206,2),entry(2,'Property',1,1)]),1)[0];assert.equal(unknown.proceedsKnown,false);
});
test('custom periods use TCT regardless of device timezone',()=>{
  const {app}=harness();app.state.dateMode='custom';app.state.customFrom='2026-09-10';app.state.customTo='2026-09-11';const range=app.dateRange();assert.equal(range.from,Date.parse('2026-09-10T00:00:00Z')/1000);assert.equal(range.to,Date.parse('2026-09-11T23:59:59Z')/1000);
});
test('crime reward items and money project independently without counting quantity as cash',()=>{
  const {app}=harness();const raw=log('crime',999,'Crime success',100,{items_gained:{206:2},money_gained:1000});const rows=app.parseLogEntry(raw);assert.equal(rows[0].total,0);assert.equal(app.parseCashFlowEntry(raw,rows)[0].amount,1000);assert.equal(app.parseCashFlowEntry(log('c2',999,'Crime success',100,{items_gained:{206:1}}),[]).length,0);
});
test('profit attribution stays on acquisition date, sold quantity stays on sale date',()=>{
  const now=Math.floor(Date.now()/1000),{app}=harness({stored:{catalog:[item],transactions:[tx('a','buy',now-10*86400,2,100),tx('b','sell',now-100,1,100)]}});app.state.dateMode='7d';const sum=app.summaryFor(206);assert.equal(sum.sold,1);assert.equal(sum.profit,0);assert.equal(app.acquisitionLedgerRows()[0].realizedProfit,50);
});
