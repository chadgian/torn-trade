const test=require('node:test');
const assert=require('node:assert/strict');
const {harness,log}=require('./harness.cjs');

const error=(name='UnknownError')=>Object.assign(new Error('simulated storage failure'),{name});
function nativeFixture(write=async()=>{}){
  const db=new Map(),counts=new Map();
  const pda={
    get:async(k,fallback)=>db.has(k)?db.get(k):fallback,
    set:async(k,v)=>{counts.set(k,(counts.get(k)||0)+1);await write(k,v,counts.get(k));db.set(k,JSON.parse(JSON.stringify(v)));},
    delete:async k=>{db.delete(k);},
    usage:async()=>({used:1024,quota:1024*1024*50})
  };
  return {db,counts,pda};
}

test('100 raw financial logs require only one unrecognized-financial durable write per log page',async()=>{
  const native=nativeFixture(),records=Array.from({length:90},(_,i)=>log('audit-'+i,777,'Money adjustment',200-i,{amount:100+i}));
  const responses={'/user/log':{log:records}};
  const {app}=harness({stored:{apiKey:'fixture0123456789'},pdaStorage:native.pda,responses});
  await app.initializeDurableStorage();
  const job={id:'batch-page',syncMode:'full',period:{from:0,to:300},logScanPeriod:{from:0,to:300},logTypeIds:[777],logMode:'filtered',diagnostics:{parsedRows:0,matchedRows:0}};
  await app.runResumableLogPhase(job,'filtered');
  assert.equal(job.diagnostics.rawRows,90);
  assert.equal(native.counts.get('tta:v1:unrecognizedFinancial'),1);
  assert.equal(native.db.get('tta:v1:unrecognizedFinancial').length,90);
  assert.equal(job.completedSources.log,true);
  job.logBatchIndex=0;job.logPage=0;job.logPageParams=null;job.logPageSeen=[];
  await app.runResumableLogPhase(job,'filtered');
  assert.equal(native.counts.get('tta:v1:unrecognizedFinancial'),1,'unchanged rescan must not rewrite audit data');
});

test('batch audit updates preserve the newest 300 and remove reclassified records',async()=>{
  const {app}=harness();
  const events=Array.from({length:320},(_,i)=>({entry:log('id-'+i,777,'Money adjustment',2000-i,{amount:50}),recognized:false}));
  assert.equal(app.checkpointUnrecognizedFinancialBatch(events),true);
  assert.equal(app.state.unrecognizedFinancial.length,300);
  assert.equal(app.state.unrecognizedFinancial[0].id,'unmapped:id-0');
  assert.equal(app.checkpointUnrecognizedFinancialBatch(events),false);
  assert.equal(app.checkpointUnrecognizedFinancialBatch([{entry:events[0].entry,recognized:true}]),true);
  assert.equal(app.state.unrecognizedFinancial.some(x=>x.id==='unmapped:id-0'),false);
});

test('same-key writes in one event loop coalesce to the latest durable value',async()=>{
  const native=nativeFixture(),{app}=harness({pdaStorage:native.pda});
  await app.initializeDurableStorage();
  for(let i=0;i<65;i++)app.save('unrecognizedFinancial',[{id:'draft',timestamp:i}]);
  await app.flushDurableStorage();
  assert.equal(native.counts.get('tta:v1:unrecognizedFinancial'),1);
  assert.equal(native.db.get('tta:v1:unrecognizedFinancial')[0].timestamp,64);
});

test('transient IndexedDB-like aborts are retried and never log a false permanent storage warning',async()=>{
  let remaining=2;
  const native=nativeFixture(async key=>{if(key==='tta:v1:unrecognizedFinancial'&&remaining-->0)throw error('AbortError');});
  const {app}=harness({pdaStorage:native.pda});
  await app.initializeDurableStorage();
  app.save('unrecognizedFinancial',[{id:'recovered',timestamp:1}]);
  await app.flushDurableStorage();
  assert.equal(native.counts.get('tta:v1:unrecognizedFinancial'),3);
  assert.equal(native.db.get('tta:v1:unrecognizedFinancial')[0].id,'recovered');
  assert.equal(app.state.notices.some(n=>n.code==='STORAGE_WRITE'),false);
});

test('failed durable audit write blocks sync checkpoint and preserves last good checkpoint',async()=>{
  let failing=true;
  const native=nativeFixture(async key=>{if(key==='tta:v1:unrecognizedFinancial'&&failing)throw error('UnknownError');});
  const {app,storage}=harness({pdaStorage:native.pda});
  await app.initializeDurableStorage();
  const prior={schema:3,active:true,id:'older',period:{from:0,to:100},updatedAt:100};
  storage.set('tta:v1:syncJob',JSON.stringify(prior));
  app.save('unrecognizedFinancial',[{id:'new',timestamp:200}]);
  const job={id:'newer',schema:3,active:true,period:{from:0,to:300},syncMode:'full',phase:'logs-filtered',diagnostics:{}};
  await assert.rejects(app.checkpointSyncJob(job,'page complete'),/simulated storage failure/);
  assert.equal(JSON.parse(storage.get('tta:v1:syncJob')).id,'older');
  assert.equal(native.db.has('tta:v1:unrecognizedFinancial'),false);
  assert.equal(app.state.notices.some(n=>n.code==='STORAGE_WRITE'&&n.context.source==='unrecognizedFinancial'),true);
  failing=false;
  await app.checkpointSyncJob(job,'recovered page');
  assert.equal(JSON.parse(storage.get('tta:v1:syncJob')).id,'newer');
  assert.equal(native.db.get('tta:v1:unrecognizedFinancial')[0].id,'new');
});

test('another key succeeding cannot mask a pending failed finance-audit write',async()=>{
  let failing=true;
  const native=nativeFixture(async key=>{if(key==='tta:v1:unrecognizedFinancial'&&failing)throw error('NotReadableError');});
  const {app}=harness({pdaStorage:native.pda});
  await app.initializeDurableStorage();
  app.save('unrecognizedFinancial',[{id:'needed'}]);
  app.save('catalog',[{id:206,name:'Xanax'}]);
  await assert.rejects(app.flushDurableStorage(),/simulated storage failure/);
  assert.equal(native.db.has('tta:v1:catalog'),false);
  failing=false;
  await app.flushDurableStorage();
  assert.equal(native.db.get('tta:v1:unrecognizedFinancial')[0].id,'needed');
  assert.equal(native.db.get('tta:v1:catalog')[0].id,206);
});

test('quota failures are not repeatedly retried and retain quota-specific diagnostic',async()=>{
  const native=nativeFixture(async key=>{if(key==='tta:v1:unrecognizedFinancial')throw error('QuotaExceededError');});
  const {app}=harness({pdaStorage:native.pda});
  await app.initializeDurableStorage();
  app.save('unrecognizedFinancial',[{id:'quota'}]);
  await assert.rejects(app.flushDurableStorage(),/simulated storage failure/);
  assert.equal(native.counts.get('tta:v1:unrecognizedFinancial'),1,'quota errors are not retried within an attempted checkpoint');
  assert.equal(app.state.notices.some(n=>n.code==='STORAGE_QUOTA'),true);
});
