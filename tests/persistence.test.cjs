const test=require('node:test');
const assert=require('node:assert/strict');
const {harness,item}=require('./harness.cjs');
const row={id:'safe',itemId:206,side:'buy',qty:5,total:100,timestamp:100};
test('malformed saved types fall back without preventing startup',()=>{
  const {app}=harness({stored:{transactions:null,catalog:'invalid',sync:[]}});assert.equal(app.state.transactions.length,0);assert.equal(app.state.catalog.length,0);assert.equal(app.state.sync.lastSync,0);
});
test('backup roundtrip preserves history but never writes API keys',()=>{
  const {app,storage}=harness({stored:{transactions:[row],apiKey:'fixture0123456789'}});const payload=app.backupPayload();payload.data.apiKey='malicious-key';app.applyBackup(payload);assert.equal(storage.get('tta:v1:apiKey'),'"fixture0123456789"');assert.equal(JSON.parse(storage.get('tta:v1:transactions'))[0].qty,5);assert.equal(storage.has('tta:v1:importRecovery'),false);
});
test('backup validation rejects invalid rows and another account before writing',()=>{
  const {app}=harness({stored:{transactions:[row],sync:{accountId:1}}});const payload=app.backupPayload();payload.data={...payload.data,transactions:[{...row,qty:-1}]};assert.throws(()=>app.applyBackup(payload),/transaction/);payload.data={...payload.data,transactions:[row],sync:{accountId:2}};assert.throws(()=>app.applyBackup(payload),/another account/);assert.equal(app.state.transactions[0].qty,5);
});
test('failed multi-key imports restore original values from recovery journal',()=>{
  const {app,context,storage}=harness({stored:{transactions:[row],cashFlows:[]}});const payload=app.backupPayload();payload.data={...payload.data,transactions:[{...row,qty:99}]};const write=context.localStorage.setItem;let failed=false;context.localStorage.setItem=(key,value)=>{if(key==='tta:v1:cashFlows'&&!failed){failed=true;throw new Error('Storage full');}write(key,value);};assert.throws(()=>app.applyBackup(payload),/could not be saved/);assert.equal(JSON.parse(storage.get('tta:v1:transactions'))[0].qty,5);assert.equal(storage.has('tta:v1:importRecovery'),false);
});
test('corrections replace transfer, consumption and cash records, not just transactions',()=>{
  const {app}=harness();const transfer={id:'gift',timestamp:150,itemId:206,qty:1,direction:'out'},cash={id:'cash',timestamp:160,amount:100,direction:'in'};app.checkpointPlayerTransferRows([transfer]);app.checkpointPlayerTransferRows([{...transfer,qty:3}]);app.checkpointItemConsumptionRows([transfer]);app.checkpointItemConsumptionRows([{...transfer,qty:4}]);app.checkpointCashFlowRows([cash]);app.checkpointCashFlowRows([{...cash,amount:250}]);assert.equal(app.state.playerTransfers[0].qty,3);assert.equal(app.state.itemConsumptions[0].qty,4);assert.equal(app.state.cashFlows[0].amount,250);
});
test('invalid history rows cannot silently advance coverage',()=>{
  const {app}=harness();assert.throws(()=>app.pageRows({log:[{id:'broken'}]},'log'),/missing/);assert.throws(()=>app.pageRows({trades:[{completed_at:100}]},'trades'),/missing/);
});
test('manually tracked items survive before their first history row',()=>{
  const {app}=harness({stored:{catalog:[item],tracked:[item]}});assert.equal(app.effectiveTracked()[0].id,206);
});
test('CSV formula-like text is inert while numbers remain numeric',()=>{
  const {app}=harness();assert.equal(app.csvCell('=danger()'),"'=danger()");assert.equal(app.csvCell('-danger'),"'-danger");assert.equal(app.csvCell(-20),'-20');
});
test('failed full-history reset rolls back before changing visible state',async()=>{
  const {app,context,storage}=harness({stored:{transactions:[row],sync:{lastSync:200}}});const write=context.localStorage.setItem;let failed=false;context.localStorage.setItem=(key,value)=>{if(key==='tta:v1:cashFlows'&&!failed){failed=true;throw new Error('Storage full');}write(key,value);};await assert.rejects(app.resetHistoryForFullResync(),/could not start/);assert.equal(app.state.transactions[0].qty,5);assert.equal(JSON.parse(storage.get('tta:v1:transactions'))[0].qty,5);assert.equal(app.state.sync.lastSync,200);
});
test('failed final sync persistence cannot advance in-memory success watermark',async()=>{
  const {app,context}=harness({stored:{transactions:[row],sync:{lastSync:200}}});const write=context.localStorage.setItem;context.localStorage.setItem=(key,value)=>{if(key==='tta:v1:sync')throw new Error('Storage full');write(key,value);};await assert.rejects(app.finishResumableSync({id:'failure',completedSources:{log:true,trade:true},period:{from:0,to:300},tctNow:300,diagnostics:{}}),/could not be saved/);assert.equal(app.state.sync.lastSync,200);
});
test('standalone snapshot refresh rejects an injected/saved key for another account',async()=>{
  const {app,calls}=harness({stored:{apiKey:'fixture0123456789',sync:{accountId:1}},responses:{'/key/info':{info:{access:{level:4},user:{id:2}}}}});await assert.rejects(app.refreshFinancialSnapshot(),/different account/);assert.equal(calls.some(url=>url.pathname==='/v2/user/networth'),false);
});
test('stale last-sync timestamps do not truncate the visible current chart',()=>{
  const now=Math.floor(Date.now()/1000),{app}=harness({stored:{transactions:[{...row,timestamp:now-864000}],sync:{lastSync:now-864000}}});const series=app.profitSeries();assert.equal(series.at(-1).t,Math.floor(now/86400)*86400);
});
test('corrected log projections remove obsolete generic cash rows',()=>{
  const {app}=harness({stored:{cashFlows:[{id:'cashlog:shop',timestamp:100,amount:100,direction:'in'}]}});app.checkpointCashFlowRows([],['cashlog:shop']);assert.equal(app.state.cashFlows.length,0);
});
test('same-second FIFO ordering remains deterministic and is explicitly marked inferred',()=>{
  const {app}=harness();const result=app.computeFifo([row,{...row,id:'sale',side:'sell',qty:2,total:80}],item);assert.equal(result.orderingInferred,true);assert.equal(app.computeFifo([{...row,nanostamp:'100000000001'},{...row,id:'sale',side:'sell',qty:2,total:80,nanostamp:'100000000002'}],item).orderingInferred,false);
});
test('backup quota failures leave existing history untouched with an actionable error',async()=>{
  const {app,context,storage}=harness({stored:{transactions:[row],sync:{lastSync:200}}});const write=context.localStorage.setItem;
  context.localStorage.setItem=(key,value)=>{if(key==='tta:v1:fullResyncBackup')throw {code:22,name:'QuotaExceededError'};write(key,value);};
  await assert.rejects(app.resetHistoryForFullResync(),e=>e.code==='STORAGE_QUOTA');assert.equal(app.state.sync.lastSync,200);assert.equal(JSON.parse(storage.get('tta:v1:transactions'))[0].qty,5);
});
test('cancelled full rebuild checkpoints restore before they are discarded',async()=>{
  const {app,storage}=harness({stored:{transactions:[row],sync:{lastSync:200}}});await app.resetHistoryForFullResync();
  app.state.transactions=[{...row,id:'partial',qty:9}];await app.discardStaleSyncJob({id:'cancelled',fullResetDone:true,cancelled:true});assert.equal(app.state.transactions[0].id,'safe');assert.equal(app.state.sync.lastSync,200);assert.equal(storage.has('tta:v1:fullResyncBackup'),false);
});
