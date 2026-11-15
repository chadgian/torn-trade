const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./harness.cjs');
const log=(id,title,data={},category='General')=>({
  id,details:{id:6020,title,category},timestamp:1762600000,data,params:{}
});

test('hunting log 6020 reads cash cost and income, not hunting skill or session type',()=>{
  const {app}=harness();
  const event=log('hunt-profit','Hunting session',{cost:500,income:850,hunting_skill:72,hunting_skill_gain:0.05,session_type:2});
  const rows=app.parseCashFlowEntry(event);
  assert.deepEqual(Array.from(rows,r=>[r.direction,r.amount,r.category,r.field]),[
    ['out',500,'Hunting','cost'],['in',850,'Hunting','income']
  ]);
  assert.equal(rows[0].id,'cashlog:hunt-profit:cost');
  assert.equal(rows[1].id,'cashlog:hunt-profit:reward');
  assert.equal(app.unrecognizedRowFor(event)?.reason,undefined);
});

test('loss-making hunt still records both money movements, with negative net cash',()=>{
  const event=log('hunt-loss','Hunting session',{cost:500,income:200});
  const {app}=harness({stored:{cashFlows:[...harness().app.parseCashFlowEntry(event)]}});
  const sum=app.cashFlowSummary(0,2000000000);
  assert.equal(sum.spent,500);
  assert.equal(sum.earned,200);
  assert.equal(sum.net,-300);
});

test('a zero-income hunt is fully observed and records the $500 cost only',()=>{
  const {app}=harness();
  const event=log('hunt-zero','Hunting session',{cost:500,income:0,hunting_skill_gain:1});
  assert.deepEqual(Array.from(app.parseCashFlowEntry(event),r=>[r.direction,r.amount]),[['out',500]]);
  assert.equal(app.unrecognizedRowFor(event)?.reason,undefined);
});

test('hunting income missing raises a partial-classification Data Quality record, even when cost is recognized',()=>{
  const {app}=harness(),event=log('hunt-missing','Hunting session',{cost:500,hunting_skill:20});
  const rows=app.parseCashFlowEntry(event);
  assert.equal(rows.length,1);
  assert.equal(rows[0].amount,500);
  app.checkpointUnrecognizedFinancial(event,true);
  assert.equal(app.state.unrecognizedFinancial.length,1);
  assert.match(app.state.unrecognizedFinancial[0].reason,/payout missing or unverified/);
  assert.equal(app.state.unrecognizedFinancial[0].amountKnown,false);
  assert.match(app.diagnosticsHtml(),/Hunting cash cost recorded/);
});

test('missing hunting cost is flagged despite income being recorded',()=>{
  const {app}=harness(),event=log('hunt-no-cost','Hunting session',{income:850});
  const result=app.parseCashFlowEntry(event);
  assert.equal(result.length,1);
  assert.equal(result[0].direction,'in');
  assert.equal(result[0].amount,850);
  app.checkpointUnrecognizedFinancial(event,true);
  assert.equal(app.state.unrecognizedFinancial.length,1);
  assert.equal(app.state.unrecognizedFinancial[0].field,'cost (missing)');
});

test('a later complete hunting record resolves the old partial-classification audit',()=>{
  const {app}=harness();
  const first=log('hunt-recheck','Hunting session',{cost:500});
  app.checkpointUnrecognizedFinancial(first,true);
  assert.equal(app.state.unrecognizedFinancial.length,1);
  const updated=log('hunt-recheck','Hunting session',{cost:500,income:700});
  app.checkpointUnrecognizedFinancial(updated,true);
  assert.equal(app.state.unrecognizedFinancial.length,0);
});

test('hunting with explicit alternative money-gained field is recognized, without counting both payout aliases',()=>{
  const {app}=harness();
  const row=app.parseCashFlowEntry(log('hunt-alias','Hunting expedition',{cost:500,money_gained:670,income:680}));
  assert.equal(row.length,2);
  assert.equal(row[1].amount,680);
  assert.equal(row[1].field,'income');
});

test('non-hunting egg hunts are never treated as South Africa Hunting',()=>{
  const {app}=harness();
  const egg=log('egg','Easter egg hunt',{cost:40,income:500});
  assert.equal(app.parseCashFlowEntry(egg).length,0);
  const types=app.relevantLogTypes([{id:9201,title:'Easter egg hunt'}]);
  assert.ok(types.some(r=>r.id===9201),'existing event item scanning remains intact');
});

test('generic money_received and cash_spent work on an unrecognized activity title',()=>{
  const {app}=harness(),evt=log('mystery','Surprise incident',{money_received:750,cash_spent:50});
  const rows=app.parseCashFlowEntry(evt);
  assert.deepEqual(Array.from(rows,r=>[r.direction,r.amount,r.field]),[
    ['out',50,'cash_spent'],['in',750,'money_received']
  ]);
  assert.deepEqual(Array.from(rows,r=>r.id),['cashlog:mystery:out','cashlog:mystery:in']);
  assert.equal(new Set(rows.map(r=>r.id)).size,2);
});

test('generic cash aliases are not doubled if both money and cash fields describe the same movement',()=>{
  const {app}=harness(),evt=log('alias','Uncategorized activity',{money_gained:550,cash_gained:550,earnings:550});
  const rows=app.parseCashFlowEntry(evt);
  assert.equal(rows.length,1);
  assert.equal(rows[0].amount,550);
  assert.equal(rows[0].id,'cashlog:alias');
});

test('generic nested cash fields are supported only under recognized finance containers',()=>{
  const {app}=harness();
  assert.equal(app.parseCashFlowEntry(log('nested','Unknown reward',{result:{money_received:123}}))[0].amount,123);
  assert.equal(app.parseCashFlowEntry(log('hidden','Unknown reward',{items:{money_received:123}})).length,0);
});

test('ambiguous cost, income, balance and item value never become generic dollars',()=>{
  const {app}=harness();
  for(const data of [{cost:100},{income:100},{balance:100},{value:100},{amount:100},{items:{money_gained:100}}]){
    const evt=log('ambiguous','Uncategorized activity',data);
    assert.equal(app.parseCashFlowEntry(evt).length,0,JSON.stringify(data));
  }
});

test('noncash resource logs cannot become income or spending even with generic cash-looking fields',()=>{
  const {app}=harness();
  for(const title of ['Mission credits spent','Job points spent','Racing points earned','Merits awarded']){
    const evt=log('no-money',title,{cost:100,money_spent:100,points:10});
    assert.equal(app.parseCashFlowEntry(evt).length,0,title);
  }
});

test('specific domain rules override general cash detection and remain a single transfer',()=>{
  const {app}=harness();
  const evt=log('property','Property sold',{money_received:2000000,cash_received:2000000});
  const rows=app.parseCashFlowEntry(evt);
  assert.equal(rows.length,1);
  assert.equal(rows[0].direction,'transfer-in');
  assert.equal(rows[0].amount,2000000);
});

test('financial log catalogue discovers payout title and finance-category events without including gym training',()=>{
  const {app}=harness();
  const types=app.relevantLogTypes([
    {id:601,title:'Compensated for service'},
    {id:602,title:'Mysterious payout'},
    {id:603,title:'Unknown adjustment',category:'Financial'},
    {id:604,title:'Gym trained'},
    {id:605,title:'Job points spent'}
  ]).map(x=>x.id);
  for(const id of [601,602,603])assert.ok(types.includes(id));
  assert.equal(types.includes(604),false);
});

test('full resync rechecking hunting records replaces old cost-only cash row with both exact components',()=>{
  const {app}=harness({stored:{cashFlows:[{
    id:'cashlog:hunt-legacy',timestamp:1762600000,direction:'out',amount:500,category:'Hunting',source:'Torn Log',title:'Hunting session'
  }]}});
  const rows=app.parseCashFlowEntry(log('hunt-legacy','Hunting session',{cost:500,income:750}));
  app.checkpointCashFlowRows(rows,['cashlog:hunt-legacy','cashlog:hunt-legacy:cost','cashlog:hunt-legacy:reward']);
  const sum=app.cashFlowSummary(0,2000000000);
  assert.equal(sum.earned,750);
  assert.equal(sum.spent,500);
  assert.equal(sum.net,250);
  assert.equal(app.state.cashFlows.length,2);
});
