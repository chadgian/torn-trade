const test=require('node:test');
const assert=require('node:assert/strict');
const {harness,item,log}=require('./harness.cjs');

const mission=(id,data,title='Mission buy reward item')=>log(id,987654,title,100,data);

test('mission credit purchases have $0 cash basis and retain actual credit cost',()=>{
  const {app}=harness({stored:{catalog:[item]}});
  const event=mission('mission1',{item_id:206,quantity:2,cost_total:58});
  const rows=app.parseLogEntry(event);
  assert.equal(rows.length,1);
  assert.equal(rows[0].qty,2);
  assert.equal(rows[0].total,0);
  assert.equal(rows[0].netTotal,0);
  assert.equal(rows[0].fee,0);
  assert.equal(rows[0].costKnown,true);
  assert.equal(rows[0].currency,'mission_credits');
  assert.equal(rows[0].missionCreditsSpent,58);
  assert.equal(rows[0].source,'Mission Credits');
  assert.equal(rows[0].free,true);
  assert.equal(app.parseCashFlowEntry(event,rows).length,0);
});

test('mission credit reward purchase never becomes a generic cash expense',()=>{
  const {app}=harness();
  for(const data of [
    {item:206,quantity:1,cost:14},
    {item:206,quantity:1,price:14},
    {item:206,quantity:1,cost_total:14},
    {item:206,quantity:1,money:14}
  ]){
    const event=mission('mission2',data);
    assert.equal(app.parseCashFlowEntry(event).length,0);
    assert.equal(app.unrecognizedRowFor(event),null);
    assert.equal(app.parseLogEntry(event)[0].total,0);
  }
});

test('mission credit amount uses explicit costs, not balances, other currency or item value',()=>{
  const {app}=harness();
  assert.equal(app.missionCreditPurchaseAmount({credits_spent:8,credits:110},1),8);
  assert.equal(app.missionCreditPurchaseAmount({quantity:2,cost:12},2),24);
  assert.equal(app.missionCreditPurchaseAmount({credits:230,market_value:400000},1),null);
  const row=app.parseLogEntry(mission('mission3',{item:206,quantity:1,credits:500,total_value:1000000}))[0];
  assert.equal(row.total,0);
  assert.equal(row.missionCreditsSpent,null);
});

test('official Mission Buy Reward Item catalog title is selected without guessing log ID',()=>{
  const {app}=harness();
  const types=app.relevantLogTypes([
    {id:987654,title:'Mission buy reward item'},
    {id:987655,title:'Mission reward'},
    {id:987656,title:'Mission credits exchanged'},
    {id:987657,title:'Item shop buy'}
  ]);
  assert.ok(types.some(x=>x.id===987654));
  assert.ok(types.some(x=>x.id===987656));
  assert.equal(app.isMissionCreditPurchase('Mission buy reward item'),true);
  assert.equal(app.isMissionCreditPurchase('Mission reward'),false);
  assert.equal(app.isMissionCreditPurchase('Item shop buy'),false);
});

test('mission cash reward remains cash income; ordinary shop purchases remain cash expenses',()=>{
  const {app}=harness();
  const reward=log('reward',987651,'Mission reward',100,{money_gained:2300});
  assert.equal(app.parseCashFlowEntry(reward)[0].direction,'in');
  assert.equal(app.parseCashFlowEntry(reward)[0].amount,2300);
  const cityShop=log('shop',4200,'Item shop buy',100,{item:206,quantity:1,cost_total:300});
  assert.equal(app.parseLogEntry(cityShop)[0].total,300);
});

test('mission credit acquisitions stay in FIFO and ledger but never count as spending',()=>{
  const sample=mission('mission4',{item:206,quantity:1,cost:22});
  const initial=harness();
  const parsed=initial.app.parseLogEntry(sample)[0];
  const {app}=harness({stored:{catalog:[item],transactions:[parsed]}});
  const summary=app.cashFlowSummary(0,200);
  assert.equal(summary.spent,0);
  assert.equal(app.transactionCashFlows().length,0);
  assert.equal(app.financialTypeKey(parsed),'mission_credits');
  const lot=app.fifoAnalytics(206).ledger[0];
  assert.equal(lot.costTotal,0);
  assert.equal(lot.unitCost,0);
  assert.equal(lot.missionCreditsSpent,22);
  assert.equal(lot.method,'Mission Credits');
  const html=app.ledgerRowHtml(lot);
  assert.match(html,/Mission Credits/);
  assert.match(html,/22 mission credits/);
  assert.doesNotMatch(html,/\$22/);
});

test('cached misclassified mission purchases are corrected without inventing past credit amounts',()=>{
  const legacy={id:'oldmission:206',timestamp:100,itemId:206,side:'buy',qty:1,total:50,netTotal:50,fee:0,source:'Mission buy reward item',title:'Mission buy reward item',costKnown:true};
  const badCash={id:'cashlog:oldmission',timestamp:100,direction:'out',amount:50,category:'Other Spending',source:'Torn Log',title:'Mission buy reward item'};
  const legitimate={id:'goodincome',timestamp:101,direction:'in',amount:250,category:'Wages / Job',source:'Torn Log',title:'Job wage'};
  const {app,storage}=harness({stored:{catalog:[item],transactions:[legacy],cashFlows:[badCash,legitimate]}});
  assert.equal(app.cashFlowSummary(0,200).spent,0,'old entries must be hidden before migration');
  assert.equal(app.cashFlowSummary(0,200).earned,250);
  const result=app.repairMissionCreditAccounting();
  assert.equal(result.transactions,1);
  assert.equal(result.cashFlows,1);
  assert.equal(app.state.transactions[0].total,0);
  assert.equal(app.state.transactions[0].netTotal,0);
  assert.equal(app.state.transactions[0].currency,'mission_credits');
  assert.equal(app.state.transactions[0].missionCreditsSpent,null);
  assert.equal(app.state.cashFlows.length,1);
  assert.equal(app.fifoAnalytics(206).ledger[0].costTotal,0);
  assert.equal(JSON.parse(storage.get('tta:v1:transactions'))[0].total,0);
  assert.equal(JSON.parse(storage.get('tta:v1:cashFlows')).length,1);
  assert.equal(app.repairMissionCreditAccounting().transactions,0,'idempotent');
});

test('mission credits from a purchase are not misclassified as cash during recheck',()=>{
  const {app}=harness();
  const logRow=mission('mission5',{item:206,quantity:1,cost_total:77});
  const cash=app.parseCashFlowEntry(logRow,app.parseLogEntry(logRow));
  assert.equal(cash.length,0);
  assert.equal(app.unrecognizedRowFor(logRow),null);
  const old=app.state.cashFlows;
  app.state.cashFlows=[{id:'cashlog:mission5',timestamp:100,direction:'out',amount:77,title:'Mission buy reward item'}];
  app.checkpointCashFlowRows(cash,['cashlog:mission5']);
  assert.equal(app.state.cashFlows.length,0);
  app.state.cashFlows=old;
});
