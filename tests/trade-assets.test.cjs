const test=require('node:test');
const assert=require('node:assert/strict');
const {harness,item,trade,entry}=require('./harness.cjs');
const now=Math.floor(Date.now()/1000);
const participant=(id,type,details)=>({user_id:id,type,details});
const sample=(id,entries)=>trade(id,now-30,entries);
const property=participant(1,'Property',{id:100,happiness:4250});
const company=participant(1,'Company',{id:110,name:'Example company',value:150000000});
const faction=participant(2,'Faction',{id:220,name:'Example faction',respect:500000});
const nap=participant(2,'NAP',{days:20,factions:[1,2]});

test('asset-only Property trades remain visible in the trade event ledger',()=>{
  const {app}=harness();
  const event=app.parsePlayerTradeEvent(sample(6537824,[property]),1);
  assert.ok(event);
  assert.equal(event.tradeId,6537824);
  assert.equal(event.cashIn,0);
  assert.equal(event.cashOut,0);
  assert.deepEqual(Array.from(event.otherAssets,a=>[a.type,a.direction,a.assetId]),[['Property','out',100]]);
  assert.equal(app.parsePlayerTrade(sample(6537824,[property]),1).length,0);
  app.checkpointPlayerTradeEvents([event]);
  assert.equal(app.state.playerTrades.length,1);
  assert.equal(app.transactionCashFlows().length,0);
  assert.equal(app.state.notices.some(x=>x.code==='TRADE_ASSET_UNVALUED'),false);
});

test('Company transfer for money retains exact dollars without inventing earned profit',()=>{
  const {app}=harness();
  const t=sample(11,[company,entry(2,'Money',0,2000000)]);
  const event=app.parsePlayerTradeEvent(t,1);
  assert.equal(event.otherAssets[0].type,'Company');
  assert.equal(event.otherAssets[0].direction,'out');
  assert.equal(event.otherAssets[0].assetId,110);
  assert.equal(event.cashIn,2000000);
  assert.equal(app.parsePlayerTrade(t,1).length,0);
  app.checkpointPlayerTradeEvents([event]);
  const cash=app.transactionCashFlows();
  assert.equal(cash.length,1);
  assert.equal(cash[0].amount,2000000);
  assert.equal(cash[0].direction,'transfer-in');
  assert.equal(cash[0].transfer,true);
  assert.equal(cash[0].category,'Trade Asset Exchanges');
  assert.match(cash[0].detail,/Gave Company/);
  assert.equal(app.cashFlowSummary(0,now).earned,0);
  assert.equal(app.cashFlowSummary(0,now).transferIn,2000000);
  assert.equal(app.state.notices.some(x=>x.code==='TRADE_ASSET_UNVALUED'),false);
});

test('Property acquisition for cash is a transfer, not a personal expense',()=>{
  const {app}=harness();
  const event=app.parsePlayerTradeEvent(sample(12,[participant(2,'Property',{id:111,happiness:4500}),entry(1,'Money',0,3500000)]),1);
  app.checkpointPlayerTradeEvents([event]);
  const cash=app.transactionCashFlows();
  assert.equal(cash.length,1);
  assert.equal(cash[0].direction,'transfer-out');
  assert.equal(cash[0].amount,3500000);
  assert.equal(app.cashFlowSummary(0,now).spent,0);
  assert.equal(app.cashFlowSummary(0,now).transferOut,3500000);
});

test('Faction and NAP exchanges are preserved without assigning a dollar valuation',()=>{
  const {app}=harness();
  const t=sample(13,[faction,nap]);
  const event=app.parsePlayerTradeEvent(t,1);
  assert.deepEqual(Array.from(event.otherAssets,x=>x.type),['Faction','NAP']);
  assert.deepEqual(Array.from(event.otherAssets,x=>x.direction),['in','in']);
  assert.equal(event.otherAssets[1].assetId,0);
  assert.equal(app.playerTradeAssetDetail(event),'Received Faction, NAP');
  app.checkpointPlayerTradeEvents([event]);
  assert.equal(app.dailyNetWorthActivity().rows.find(x=>x.kind==='player-trade')?.impactKnown,false);
  assert.equal(app.state.notices.some(x=>x.code==='TRADE_ASSET_UNVALUED'),false);
});

test('mixed item and Property barter warns only about unvalued item allocation',()=>{
  const {app}=harness({stored:{catalog:[item]}});
  const t=sample(14,[entry(1,'Item',206,2),participant(2,'Property',{id:121,happiness:4700}),entry(2,'Money',0,10000)]);
  const rows=app.parsePlayerTrade(t,1);
  assert.equal(rows.length,1);
  assert.equal(rows[0].side,'sell');
  assert.equal(rows[0].proceedsKnown,false);
  assert.equal(rows[0].costKnown,false);
  const notice=app.state.notices.find(x=>x.code==='TRADE_ASSET_UNVALUED');
  assert.ok(notice);
  assert.equal(notice.context.tradeId,14);
  assert.equal(notice.context.status,'Property');
  assert.match(notice.message,/Cash is recorded/);
  const event=app.parsePlayerTradeEvent(t,1);
  app.checkpointPlayerTradeEvents([event]);
  const cash=app.transactionCashFlows();
  assert.equal(cash[0].amount,10000);
  assert.equal(cash[0].direction,'transfer-in');
  assert.equal(app.cashFlowSummary(0,now).earned,0);
  assert.equal(app.dailyNetWorthActivity().rows.find(x=>x.kind==='player-trade')?.impactKnown,false);
});

test('unknown trade asset type is recorded conservatively as Other with no fake item proceeds',()=>{
  const {app}=harness({stored:{catalog:[item]}});
  const t=sample(15,[entry(1,'Item',206,1),participant(2,'UnknownFutureAsset',{id:171,amount:99999999})]);
  const rows=app.parsePlayerTrade(t,1);
  assert.equal(rows.length,1);
  assert.equal(rows[0].proceedsKnown,false);
  const event=app.parsePlayerTradeEvent(t,1);
  assert.equal(event.otherAssets[0].type,'Other');
  assert.equal(event.otherAssets[0].assetId,171);
  assert.equal(event.cashIn,0);
});

test('Item-and-Money-only trades retain exact earned/spent directions and FIFO basis',()=>{
  const {app}=harness({stored:{catalog:[item]}});
  const t=sample(16,[entry(1,'Item',206,2),entry(2,'Money',0,500)]);
  const rows=app.parsePlayerTrade(t,1);
  assert.equal(rows[0].proceedsKnown,true);
  assert.equal(rows[0].total,500);
  const event=app.parsePlayerTradeEvent(t,1);
  assert.equal(event.otherAssets.length,0);
  app.checkpointPlayerTradeEvents([event]);
  const cash=app.transactionCashFlows();
  assert.equal(cash[0].direction,'in');
  assert.equal(cash[0].transfer,false);
  assert.equal(app.cashFlowSummary(0,now).earned,500);
  assert.equal(app.state.notices.some(x=>x.code==='TRADE_ASSET_UNVALUED'),false);
});

test('Trade event resync overwrites stale asset list without retaining removed asset legs',()=>{
  const {app}=harness();
  const previous=app.parsePlayerTradeEvent(sample(17,[property,entry(2,'Money',0,20)]),1);
  app.checkpointPlayerTradeEvents([previous]);
  const updated=app.parsePlayerTradeEvent(sample(17,[entry(1,'Money',0,10),entry(2,'Money',0,20)]),1);
  app.checkpointPlayerTradeEvents([updated]);
  assert.equal(app.state.playerTrades.length,1);
  assert.equal(app.state.playerTrades[0].otherAssets.length,0);
  assert.deepEqual(Array.from(app.transactionCashFlows(),x=>x.direction),['out','in']);
});

test('Company reference value and Property happiness never masquerade as the executed cash price',()=>{
  const {app}=harness({stored:{catalog:[item]}});
  const t=sample(18,[entry(1,'Item',206,1),company,property]);
  const e=app.parsePlayerTradeEvent(t,1),rows=app.parsePlayerTrade(t,1);
  assert.equal(e.cashIn,0);
  assert.equal(e.cashOut,0);
  assert.equal(e.otherAssets.length,2);
  assert.equal(rows[0].proceedsKnown,false);
  assert.equal(app.transactionCashFlows().length,0);
});
