const test=require('node:test');
const assert=require('node:assert/strict');
const {harness,item,log,trade,entry}=require('./harness.cjs');
const now=Math.floor(Date.now()/1000),key='fixture0123456789';
const baseResponses=()=>({'/user/timestamp':{timestamp:now},'/key/info':{info:{access:{level:4},user:{id:1},selections:{user:['log']}}},'/torn/items':{items:[{...item,value:{market_price:150}}]},'/torn/logtypes':{logtypes:[{id:4210,title:'Item shop sell'}]},'/user/log':{log:[],_metadata:{links:{next:null}}},'/user/trades':{trades:[],_metadata:{links:{next:null}}},'/user/networth':{networth:{total:5000,timestamp:now}},'/user/money':{money:{wallet:100}},'/company/profile':{profile:null}});
test('precise pagination retains nanostamp and strips secrets from links',()=>{
  const {app}=harness();const seen=[],params={to:100,from:50,limit:100,log:'4210'};
  const next=app.nextHistoryPage({_metadata:{links:{next:'https://api.torn.com/v2/user/log?to=90&nanostamp=90000000001&key=secret&log=999'}}},params,[{id:1}],seen);
  assert.equal(next.nanostamp,'90000000001');assert.equal(next.log,'4210');assert.equal(next.from,50);assert.equal('key'in next,false);
  assert.throws(()=>app.nextHistoryPage({_metadata:{links:{next:'https://api.torn.com/v2/user/log?to=90&nanostamp=90000000001'}}},params,[{id:1}],seen),/repeated/);
});
test('full pages without a cursor and foreign pagination sources never imply full coverage',()=>{
  const {app}=harness();assert.throws(()=>app.nextHistoryPage({}, {limit:100},Array.from({length:100},(_,id)=>({id})),[]),/no continuation/);
  assert.throws(()=>app.nextLogPageParams({_metadata:{links:{next:'https://elsewhere.example/path?key=secret'}}},{}),/invalid pagination/);
  const job={id:'incomplete',tctNow:now,period:{from:0,to:now},diagnostics:{}};return assert.rejects(app.finishResumableSync(job),/did not finish/).then(()=>assert.equal(app.state.sync.lastSync,0));
});
test('quick sync recovers delayed city-shop sales and updates visible accounting',async()=>{
  const responses=baseResponses(),raw=log('shop-sale',4210,'Item shop sell',now-3600,{item:206,quantity:3,cost_total:600});responses['/user/log']=url=>({log:url.searchParams.get('log').split(',').includes('4210')?[raw]:[],_metadata:{links:{next:null}}});
  const {app}=harness({stored:{apiKey:key,catalog:[item],transactions:[{id:'buy',itemId:206,side:'buy',qty:10,total:1000,timestamp:now-86400,source:'Torn Shop'}],sync:{lastSync:now-60,firstSyncComplete:false}},responses});app.fifoAnalytics(206);await app.syncAll({background:true});assert.equal(app.state.sync.lastSync,now);assert.equal(app.fifoAnalytics(206).remainingQty,7);assert.equal(app.acquisitionLedgerRows()[0].lastSaleSource,'Torn Shop');assert.equal(app.state.renderPending,true);assert.equal(app.state.sync.firstSyncComplete,false);
});
test('deferred trade details are retried outside the overlap window',async()=>{
  const responses=baseResponses();const h={id:20,completed_at:now-10*86400};responses['/user/20/trade']={trade:trade(20,h.completed_at,[])};
  const {app}=harness({stored:{apiKey:key,catalog:[item]},responses});const job={id:'a',tradeHeaders:[h],tradeDetailIndex:0,userId:1,diagnostics:{},active:true};await app.runResumableTradeDetails(job);assert.equal(app.ensureSyncCache().pendingTrades[20].id,20);assert.equal(app.isTradeVerified(job,h),false);
  responses['/user/20/trade']={trade:trade(20,h.completed_at,[entry(1,'Item',206,2),entry(2,'Money',0,500)])};
  const next={id:'b',tradeScanPeriod:{from:now-60,to:now},tradeHeaders:[],tradeDetailIndex:0,diagnostics:{},userId:1,active:true};await app.runResumableTradeList(next);assert.equal(next.tradeHeaders[0].id,20);await app.runResumableTradeDetails(next);assert.equal(app.state.transactions[0].total,500);assert.equal(next.verifiedTradeIds[0],20);
});
test('authoritative trade corrections remove obsolete rows and replace existing values',async()=>{
  const responses=baseResponses(),h={id:21,completed_at:now-100};responses['/user/21/trade']={trade:trade(21,h.completed_at,[entry(1,'Item',206,2),entry(2,'Money',0,500)])};
  const old=[{id:'trade:21:1:sell:206',tradeId:21,itemId:206,qty:1,total:200,side:'sell',timestamp:now-100,source:'Player Trade'},{id:'trade:21:1:sell:258',tradeId:21,itemId:258,qty:1,total:50,side:'sell',timestamp:now-100,source:'Player Trade'}];
  const {app}=harness({stored:{apiKey:key,catalog:[item],transactions:old},responses});await app.runResumableTradeDetails({id:'correct',tradeHeaders:[h],tradeDetailIndex:0,userId:1,diagnostics:{}});assert.equal(app.state.transactions.length,1);assert.equal(app.state.transactions[0].qty,2);assert.equal(app.state.transactions[0].total,500);
});
test('trade detail source mismatch fails without verifying or adding rows',async()=>{
  const responses=baseResponses();responses['/user/22/trade']={trade:trade(23,now,[entry(1,'Item',206,1)])};const {app}=harness({stored:{apiKey:key},responses});const job={id:'mismatch',tradeHeaders:[{id:22,completed_at:now}],tradeDetailIndex:0,userId:1,diagnostics:{}};await assert.rejects(app.runResumableTradeDetails(job),/do not match/);assert.equal(app.state.transactions.length,0);
});
test('legacy transaction existence is not evidence of trade detail verification',()=>{
  const {app}=harness({stored:{transactions:[{id:'old',itemId:206,source:'Player Trade',tradeId:8,timestamp:now-864000}],syncCache:{schema:5,verifiedTrades:{8:now-864000}}}});assert.equal(app.isTradeVerified({}, {id:8,completed_at:now-864000}),false);
});
test('history schema errors keep the last successful sync unchanged',async()=>{
  const responses=baseResponses();responses['/user/log']={wrong:[]};const {app}=harness({stored:{apiKey:key,sync:{lastSync:now-500}},responses});await app.syncAll({background:true});assert.equal(app.state.sync.lastSync,now-500);assert.equal(app.state.notices.some(x=>x.code==='SYNC_PAUSED'),true);assert.equal(app.state.backgroundSyncing,false);
});
test('full resync can restore previous rows and coverage after cancellation',async()=>{
  const original=[{id:'safe',itemId:206,side:'buy',qty:1,total:50,timestamp:100}],{app}=harness({stored:{transactions:original,sync:{lastSync:200,firstSyncComplete:true}}});await app.resetHistoryForFullResync();assert.equal(app.state.transactions.length,0);await app.restoreFullResyncBackup({fullResetDone:true});assert.equal(app.state.transactions[0].id,'safe');assert.equal(app.state.sync.lastSync,200);
});
test('diagnostics whitelist context and redact API keys and URLs',()=>{
  const {app}=harness({stored:{apiKey:key}});app.reportDiagnostic('TEST','warning',`Failed https://api.torn.com/?key=${key} key=${key}`,{source:'/user/log',raw:{key},url:`https://x/?key=${key}`,itemId:206});const report=JSON.stringify(app.diagnosticReport());assert.equal(report.includes(key),false);assert.equal(report.includes('https://'),false);assert.equal(report.includes('"raw"'),false);assert.equal(JSON.stringify(app.backupPayload()).includes(key),false);
});
test('Data Quality provides suggested actions and developer contact for non-user-fix errors',()=>{
  const {app}=harness();
  app.reportDiagnostic('API_SCHEMA','error','Unexpected response',{source:'trades',phase:'trade-details'});
  const html=app.diagnosticsHtml(),report=app.diagnosticReport(),row=report.notices.find(n=>n.code==='API_SCHEMA');
  assert.equal(html.includes('Suggested action'),true);
  assert.equal(html.includes('https://www.torn.com/profiles.php?XID=4325416'),true);
  assert.equal(html.includes('v0.4.2'),true);
  assert.equal(row.supportDetail.includes('API_SCHEMA'),true);
  assert.equal(row.suggestedAction.length>20,true);
  assert.equal(JSON.stringify(report).includes('https://'),false);
});
test('What\'s New page lists user-facing releases from v0.3.0 through current',()=>{
  const {app}=harness(),html=app.updatesHtml();
  for(const version of ['v0.3.0','v0.3.7','v0.3.9','v0.4.0','v0.4.1','v0.4.2'])assert.equal(html.includes(version),true);
  assert.equal(html.includes('native per-script storage'),true);
  assert.equal(html.includes('Net Worth'),true);
});
test('Torn API error 16 is classified as a non-retryable API access problem',async()=>{
  const {app}=harness({stored:{apiKey:key},responses:{'/test':{error:{code:16,error:'Access level of this key is not high enough'}}}});
  await assert.rejects(app.apiGet('/test'),e=>e.code==='API_ACCESS'&&e.context.apiCode===16&&!e.retryable);
  const notice=app.state.notices.find(n=>n.code==='API_ACCESS');
  assert.equal(notice.context.source,'/test');
  assert.equal(app.diagnosticsHtml().includes('Settings \u2192 Create key'),true);
});
test('custom keys report missing analyzer User selections before sync',async()=>{
  const responses={'/key/info':{info:{access:{level:2,type:'Custom'},user:{id:1},selections:{user:['log','trades']}}}};
  const {app}=harness({stored:{apiKey:key},responses});
  const info=await app.inspectActiveKey();
  assert.deepEqual(Array.from(info.missingUserSelections),['trade','money','networth']);
  assert.equal(info.hasUserLog,true);
});
test('API rate limits expose only code and context, never provider text or secrets',async()=>{
  const {app}=harness({stored:{apiKey:key},responses:{'/test':{error:{code:5,error:`secret ${key}`}}}});await assert.rejects(app.apiGet('/test'),e=>e.code==='RATE_LIMIT'&&e.retryable);assert.equal(app.state.notices[0].context.apiCode,5);assert.equal(JSON.stringify(app.state.notices).includes(key),false);
});
test('permanent key errors are not retried',async()=>{
  const responses=baseResponses();responses['/user/log']={error:{code:2,error:'Incorrect Key'}};const {app,calls}=harness({stored:{apiKey:key},responses});await app.syncAll({background:true});assert.equal(calls.filter(x=>x.pathname==='/v2/user/log').length,1);
});
test('a dense same-second city-shop page continues with nanostamp without losing sales',async()=>{
  const first=Array.from({length:100},(_,i)=>log('sale-'+i,4210,'Item shop sell',100,{item:206,quantity:1,cost_total:20}));
  const second=Array.from({length:50},(_,i)=>log('sale-'+(100+i),4210,'Item shop sell',100,{item:206,quantity:1,cost_total:20}));
  const responses={'/user/log':url=>url.searchParams.has('nanostamp')?{log:second}:{log:first,_metadata:{links:{next:'https://api.torn.com/v2/user/log?to=100&nanostamp=100000000123'}}}};
  const {app,calls}=harness({stored:{apiKey:key,catalog:[item]},responses});const job={id:'dense',period:{from:90,to:110},logScanPeriod:{from:90,to:110},logTypeIds:[4210],logMode:'filtered',diagnostics:{parsedRows:0,matchedRows:0}};
  await app.runResumableLogPhase(job,'filtered');assert.equal(app.state.transactions.length,150);assert.equal(calls[1].searchParams.get('nanostamp'),'100000000123');assert.equal(job.completedSources.log,true);
});
test('another-tab sync lock prevents writes and unnecessary API calls',async()=>{
  const {app,context,calls,storage}=harness({stored:{apiKey:key}});context.navigator={locks:{request:async(name,options,callback)=>callback(null)}};await app.syncAll({background:true});assert.equal(calls.length,0);assert.equal(storage.has('tta:v1:syncJob'),false);assert.equal(app.state.notices[0].code,'SYNC_OTHER_TAB');
});
test('Torn PDA native HTTP responses follow the same safe API parser',async()=>{
  const {app,context,calls}=harness({stored:{apiKey:key}});context.window.PDA_httpGet=async()=>({status:200,responseText:JSON.stringify({value:123})});assert.equal((await app.apiGet('/test')).value,123);assert.equal(calls.length,0);
});
test('metadata nanostamp advances even when the link repeats an inclusive second',async()=>{
  const responses={'/user/log':url=>{
    const cursor=url.searchParams.get('nanostamp');
    if(cursor==='100000000002')return {log:[]};
    return {log:[log(cursor?'second':'first',4210,'Item shop sell',100,{item:206,quantity:1,cost_total:20})],_metadata:{nanostamp:cursor?'100000000002':'100000000003',links:{next:'https://api.torn.com/v2/user/log?limit=100&to=100&nanostamp=100000000003'}}};
  }};
  const {app,calls}=harness({stored:{apiKey:key,catalog:[item]},responses});
  const job={id:'precise',period:{from:90,to:100},logScanPeriod:{from:90,to:100},logTypeIds:[4210],logMode:'filtered',diagnostics:{parsedRows:0,matchedRows:0}};
  await app.runResumableLogPhase(job,'filtered');assert.equal(app.state.transactions.length,2);assert.equal(calls.length,3);assert.equal(job.completedSources.log,true);
});
test('99-row nanostamp pages are not assumed to be terminal',()=>{
  const {app}=harness();const next=app.nextHistoryPage({_metadata:{nanostamp:'100000000001'}},{limit:100,to:100},Array.from({length:99},(_,id)=>({id})),[]);assert.equal(next.nanostamp,'100000000001');
});
test('player trade list actually requests each next page instead of repeating page one',async()=>{
  const responses=baseResponses();responses['/user/trades']=url=>url.searchParams.get('to')==='150'?{trades:[{id:2,completed_at:100}]}:{trades:[{id:1,completed_at:200}],_metadata:{links:{next:'https://api.torn.com/v2/user/trades?to=150&limit=100'}}};
  const {app,calls}=harness({stored:{apiKey:key},responses});const job={id:'pages',tradeScanPeriod:{from:50,to:300},diagnostics:{},tradeHeaders:[]};
  await app.runResumableTradeList(job);assert.deepEqual(Array.from(job.tradeHeaders,x=>x.id),[1,2]);assert.equal(calls[1].searchParams.get('to'),'150');assert.equal(job.completedSources.trade,true);
});
test('short repeated Player Trades page is verified with an older date boundary',async()=>{
  let calls=0;
  const responses=baseResponses();responses['/user/trades']=url=>{
    calls++;
    const to=Number(url.searchParams.get('to'));
    if(to===99)return {trades:[],_metadata:{links:{next:null}}};
    return {trades:[{id:1,completed_at:200},{id:2,completed_at:100}],_metadata:{links:{next:'https://api.torn.com/v2/user/trades?cat=finished&limit=100&sort=DESC&from=50&to=300'}}};
  };
  const {app}=harness({stored:{apiKey:key},responses});const job={id:'repeated-trades',tradeScanPeriod:{from:50,to:300},diagnostics:{},tradeHeaders:[]};
  await app.runResumableTradeList(job);
  assert.deepEqual(Array.from(job.tradeHeaders,x=>x.id),[1,2]);
  assert.equal(job.completedSources.trade,true);
  assert.equal(calls,4);
  assert.equal(app.state.notices.some(n=>n.code==='PAGE_BOUNDARY_RECOVERED'&&n.context.source==='trades'),true);
});
test('dense repeated Player Trades pages remain incomplete rather than skipping same-second trades',async()=>{
  const rows=Array.from({length:99},(_,i)=>({id:i+1,completed_at:100}));
  const responses=baseResponses();responses['/user/trades']={trades:rows,_metadata:{links:{next:'https://api.torn.com/v2/user/trades?cat=finished&limit=100&sort=DESC&from=50&to=300'}}};
  const {app}=harness({stored:{apiKey:key},responses});const job={id:'dense-repeated-trades',tradeScanPeriod:{from:50,to:300},diagnostics:{},tradeHeaders:[]};
  await assert.rejects(app.runResumableTradeList(job),e=>e.code==='PAGE_REPEATED');
});
test('stalled pages retry without mutating committed cursors or skipping same-second rows',async()=>{
  let requests=0;const {app}=harness({stored:{apiKey:key},responses:{'/user/log':()=>({log:[log('sale',4210,'Item shop sell',100,{item:206,quantity:1,cost_total:20})],_metadata:{nanostamp:++requests<3?'100000000003':'100000000002'}})}});
  const seen=[];const result=await app.historyPage('/user/log',{to:100,limit:100,nanostamp:'100000000003'},seen);
  assert.equal(requests,3);assert.equal(seen.length,0);assert.equal(result.rows[0].id,'sale');assert.equal(result.next.nanostamp,'100000000002');assert.equal(app.state.notices[0].code,'PAGE_RETRY');
});
test('permanently stalled cursors remain errors rather than false completed coverage',async()=>{
  const {app,calls}=harness({stored:{apiKey:key},responses:{'/user/log':{log:[log('sale',4210,'Item shop sell',100,{item:206,quantity:1,cost_total:20})],_metadata:{nanostamp:'100000000003'}}}});
  await assert.rejects(app.historyPage('/user/log',{to:100,nanostamp:'100000000003'},[],'log',['sale']),e=>e.code==='PAGE_BOUNDARY_UNVERIFIED');assert.equal(calls.length,4);assert.equal(app.state.sync.lastSync,0);
});
test('history pagination rejects a different endpoint on the same API origin',()=>{
  const {app}=harness();assert.throws(()=>app.nextHistoryPage({_metadata:{links:{next:'https://api.torn.com/v2/user/trades?to=100'}}},{to:100},[{id:1}],[]),e=>e.code==='PAGE_SOURCE_MISMATCH');
});
test('quota exceptions have actionable codes and errors keep their real source',()=>{
  const {app}=harness();app.diagnosticFromError({code:22,name:'QuotaExceededError'},'sync');assert.equal(app.state.notices[0].code,'STORAGE_QUOTA');
  app.diagnosticFromError(new app.AnalyzerError('PAGE_REPEATED','History stalled',{source:'log',count:100}),'sync');assert.equal(app.state.notices[0].context.source,'log');
});
test('failed attempt diagnostics remain separate from the last successful scan',()=>{
  const {app}=harness({stored:{sync:{lastSync:200,diagnostics:{pages:67}},syncJob:{schema:3,active:true,period:{from:0,to:300},syncMode:'full',phase:'logs-filtered',lastError:'fixture',diagnostics:{pages:4,rawRows:300}},fullResyncBackup:{sync:{lastSync:200}}}});
  const report=app.diagnosticReport();assert.equal(report.counts.pages,67);assert.equal(report.pendingSync.counts.pages,4);assert.equal(report.pendingSync.paused,true);assert.equal(report.pendingSync.recoveryAvailable,true);
});
test('long full rebuilds remain resumable instead of expiring after five minutes',()=>{
  const {app}=harness(),job={syncMode:'full',period:{from:0,to:now-3600},updatedAt:now};
  assert.equal(app.syncJobIsStale(job),false);assert.equal(app.syncJobIsStale({...job,syncMode:'quick'}),true);assert.equal(app.syncJobIsStale({...job,updatedAt:now-7*3600}),true);
});
test('successful full rebuild retires old sync errors without hiding unrelated storage errors',async()=>{
  const responses=baseResponses();responses['/user/log']=url=>({log:url.searchParams.get('log').includes('4210')?[log('shop-sale',4210,'Item shop sell',now-3600,{item:206,quantity:2,cost_total:500})]:[]});
  const {app,storage}=harness({stored:{apiKey:key,catalog:[item],sync:{lastSync:now-500}},responses});
  app.reportDiagnostic(22,'error','Old error',{source:'sync'});app.reportDiagnostic('PAGE_REPEATED','error','Old cursor',{source:'sync'});app.reportDiagnostic('STORAGE_WRITE','error','Catalog unavailable',{source:'catalog'});
  await app.syncAll({mode:'full'});assert.equal(app.state.sync.lastSync,now);assert.equal(app.state.sync.firstSyncComplete,true);assert.equal(app.state.transactions.length,1);assert.equal(storage.has('tta:v1:fullResyncBackup'),false);assert.equal(storage.has('tta:v1:syncJob'),false);
  assert.equal(app.state.notices.some(n=>n.code===22||n.code==='PAGE_REPEATED'),false);assert.equal(app.state.notices.some(n=>n.code==='STORAGE_WRITE'&&n.context.source==='catalog'),true);
});
test('failed full rebuild retains recovery and switching to quick sync restores original history',async()=>{
  const responses=baseResponses();responses['/user/log']={error:{code:2}};
  const original={id:'safe',itemId:206,side:'buy',qty:5,total:100,timestamp:100};
  const {app,storage}=harness({stored:{apiKey:key,catalog:[item],transactions:[original],sync:{lastSync:now-500,firstSyncComplete:true}},responses});
  await app.syncAll({mode:'full'});assert.equal(storage.has('tta:v1:fullResyncBackup'),true);assert.equal(app.diagnosticReport().pendingSync.paused,true);
  await app.syncAll({mode:'quick'});assert.equal(app.state.transactions[0].id,'safe');assert.equal(app.state.sync.lastSync,now-500);assert.equal(storage.has('tta:v1:fullResyncBackup'),false);
});

const boundarySale=(id,second=100)=>log(id,4210,'Item shop sell',second,{item:206,quantity:1,cost_total:20});
const boundaryJob=()=>({id:'boundary',period:{from:0,to:110},logScanPeriod:{from:0,to:110},logTypeIds:[4210],logMode:'filtered',diagnostics:{parsedRows:0,matchedRows:0}});

test('continuation links never narrow full or quick scan lower bounds',()=>{
  const {app}=harness();
  for(const from of [0,50]){
    const next=app.nextHistoryPage({_metadata:{nanostamp:'100000000003',links:{next:'https://api.torn.com/v2/user/log?from=100&to=100&log=999'}}},{from,to:110,log:'4210'},[boundarySale('a')],[]);
    assert.equal(next.from,from);assert.equal(next.to,110);assert.equal(next.log,'4210');
  }
});

test('inclusive one-row terminal boundary is verified without losing its sale',async()=>{
  const {app,calls}=harness({stored:{apiKey:key,catalog:[item]},responses:{'/user/log':url=>url.searchParams.get('nanostamp')==='100000000002'?{log:[]}:{log:[boundarySale('last')],_metadata:{nanostamp:'100000000003',links:{next:'https://api.torn.com/v2/user/log?from=100&to=110'}}}}});
  const job=boundaryJob();await app.runResumableLogPhase(job,'filtered');
  assert.equal(app.state.transactions.length,1);assert.equal(job.completedSources.log,true);assert.equal(job.diagnostics.boundaryRecoveries,1);
  assert.equal(calls.length,5);assert.equal(calls.every(u=>u.searchParams.get('from')==='0'&&u.searchParams.get('to')==='110'),true);
  assert.equal(calls.at(-1).searchParams.get('nanostamp'),'100000000002');
});

test('boundary probes retain consecutive nanosecond records in the same second',async()=>{
  const {app}=harness({stored:{apiKey:key,catalog:[item]},responses:{'/user/log':url=>{
    const cursor=url.searchParams.get('nanostamp');
    if(cursor==='100000000001')return {log:[]};
    if(cursor==='100000000002')return {log:[boundarySale('older')],_metadata:{nanostamp:cursor}};
    return {log:[boundarySale('last')],_metadata:{nanostamp:'100000000003'}};
  }}});
  const job=boundaryJob();await app.runResumableLogPhase(job,'filtered');
  assert.equal(app.state.transactions.length,2);assert.equal(app.state.transactions.reduce((n,r)=>n+r.total,0),40);assert.equal(job.completedSources.log,true);assert.equal(job.diagnostics.boundaryRecoveries,2);
});

test('fresh stalled boundary records are checkpointed before exclusion',async()=>{
  const {app,calls}=harness({stored:{apiKey:key},responses:{'/user/log':{log:[boundarySale('new')],_metadata:{nanostamp:'100000000003'}}}});
  const params={from:0,to:110,nanostamp:'100000000003'};
  const result=await app.historyPage('/user/log',params,[],'log',['old']);
  assert.equal(result.rows[0].id,'new');assert.equal(result.next.nanostamp,params.nanostamp);assert.equal(calls.length,3);
});

test('full and 99-row repeated boundaries remain incomplete, never probed away',async()=>{
  for(const count of [99,100]){
    const rows=Array.from({length:count},(_,i)=>boundarySale('sale-'+i));
    const {app,calls}=harness({stored:{apiKey:key},responses:{'/user/log':{log:rows,_metadata:{nanostamp:'100000000003'}}}});
    await assert.rejects(app.historyPage('/user/log',{from:0,to:110,limit:100,nanostamp:'100000000003'},[],'log',rows.map(r=>r.id)),e=>e.code==='PAGE_REPEATED');
    assert.equal(calls.length,3);assert.equal(app.state.sync.lastSync,0);
  }
});

test('unverified, out-of-range and malformed probes do not advance coverage',async()=>{
  for(const probe of [{log:[boundarySale('newer',101)]},{log:[boundarySale('outside',40)]},{wrong:[]},{error:{code:5}}]){
    const {app}=harness({stored:{apiKey:key,sync:{lastSync:77}},responses:{'/user/log':url=>url.searchParams.get('nanostamp')==='100000000002'?probe:{log:[boundarySale('last')],_metadata:{nanostamp:'100000000003'}}}});
    await assert.rejects(app.historyPage('/user/log',{from:50,to:110,nanostamp:'100000000003'},[],'log',['last']));
    assert.equal(app.state.sync.lastSync,77);
  }
});

test('unsafe numeric and oversized precise cursors are rejected',()=>{
  const {app}=harness();
  for(const nanostamp of [1791018262000000000,'1'.repeat(31),'https://secret.example'])assert.throws(()=>app.nextHistoryPage({_metadata:{nanostamp}},{from:0,to:110},[boundarySale('last')],[]),e=>e.code==='API_SCHEMA');
  assert.throws(()=>app.nextHistoryPage({_metadata:{nanostamp:'100000000004'}},{from:0,to:110,nanostamp:'100000000003'},[boundarySale('last')],[]),e=>e.code==='PAGE_SOURCE_MISMATCH');
});

test('diagnostic cursors retain exact precision but never arbitrary strings',()=>{
  const {app}=harness();app.reportDiagnostic('CURSOR','warning','Boundary',{cursor:'1791018262000000001',nextCursor:'https://secret.example?key='+key});
  const report=JSON.stringify(app.diagnosticReport());assert.equal(report.includes('1791018262000000001'),true);assert.equal(report.includes('secret.example'),false);assert.equal(report.includes(key),false);
});

test('old verified history requires a full recheck, not just a quick sync',async()=>{
  const {app}=harness({stored:{apiKey:key,catalog:[item],sync:{lastSync:now-100,firstSyncComplete:true,accountingVersion:'0.3.3'}},responses:baseResponses()});
  assert.equal(app.dataQualityNotices().some(n=>n.code==='HISTORY_COVERAGE_RECHECK'),true);
  await app.syncAll({mode:'quick'});assert.equal(app.dataQualityNotices().some(n=>n.code==='HISTORY_COVERAGE_RECHECK'),true);
  await app.syncAll({mode:'full'});assert.equal(app.dataQualityNotices().some(n=>n.code==='HISTORY_COVERAGE_RECHECK'),false);assert.equal(app.state.sync.historyPaginationVersion,3);
});

test('reported 215-row legacy checkpoint rewinds and completes with recovery preserved',async()=>{
  const responses=baseResponses();let checkedBackup=false;
  const first=Array.from({length:100},(_,i)=>boundarySale('sale-'+i,102));
  const second=Array.from({length:99},(_,i)=>boundarySale('sale-'+(100+i),101));
  const third=Array.from({length:16},(_,i)=>boundarySale('sale-'+(199+i),100));
  let instance;
  responses['/user/log']=url=>{
    if(url.searchParams.get('log')!=='4210')return {log:[]};
    assert.equal(url.searchParams.get('from'),'0');checkedBackup=instance.storage.has('tta:v1:fullResyncBackup');
    const cursor=url.searchParams.get('nanostamp');
    if(!cursor)return {log:first,_metadata:{nanostamp:'102000000001'}};
    if(cursor==='102000000001')return {log:second,_metadata:{nanostamp:'101000000001'}};
    if(cursor==='101000000001')return {log:third,_metadata:{nanostamp:'100000000003'}};
    if(cursor==='100000000003')return {log:[third.at(-1)],_metadata:{nanostamp:cursor}};
    return {log:[]};
  };
  const job={schema:3,id:'legacy',active:true,syncMode:'full',phase:'logs-filtered',fullResetDone:true,period:{from:0,to:now},logScanPeriod:{from:0,to:now},tradeScanPeriod:{from:0,to:now},tctNow:now,userId:1,logTypeIds:[4210],logMode:'filtered',logPageParams:{from:100,to:now,nanostamp:'100000000003'},logPageSeen:[],updatedAt:now,diagnostics:{rawRows:215,pages:5},lastError:'Old cursor'};
  instance=harness({stored:{apiKey:key,catalog:[item],syncJob:job,fullResyncBackup:{transactions:[],sync:{lastSync:0}},transactions:[{id:'sale-0:206',itemId:206,side:'sell',qty:1,total:20,timestamp:102}]},responses});
  instance.app.reportDiagnostic(22,'error','Old quota',{source:'sync'});instance.app.reportDiagnostic('PAGE_REPEATED','error','Old boundary',{source:'log'});
  await instance.app.runResumableSync(job,true);
  assert.equal(checkedBackup,true);assert.equal(instance.app.state.sync.firstSyncComplete,true);assert.equal(instance.app.state.sync.lastSync,now);
  assert.equal(instance.app.state.transactions.filter(r=>r.timestamp>=100&&r.timestamp<=102).length,215);
  assert.equal(instance.storage.has('tta:v1:fullResyncBackup'),false);assert.equal(instance.app.state.notices.some(n=>n.code===22||n.code==='PAGE_REPEATED'),false);
});

test('resume checkpoint failures release loading state and preserve full rebuild recovery',async()=>{
  const job={schema:3,id:'resume',active:true,syncMode:'full',phase:'logs-filtered',fullResetDone:true,period:{from:0,to:now},updatedAt:now,progress:'Paused'};
  const {app,context,storage}=harness({stored:{apiKey:key,syncJob:job,fullResyncBackup:{sync:{lastSync:77}}}});
  const before=storage.get('tta:v1:syncJob');const save=context.localStorage.setItem;
  context.localStorage.setItem=(k,v)=>{if(k==='tta:v1:syncJob')throw new Error('Disk full');save(k,v);};
  await app.runResumableSync(job,true);
  assert.equal(app.state.syncing,false);assert.equal(app.state.backgroundSyncing,false);assert.equal(storage.get('tta:v1:syncJob'),before);assert.equal(storage.has('tta:v1:fullResyncBackup'),true);
});

test('saved boundary IDs survive reload before an exclusive probe',async()=>{
  const job={...boundaryJob(),schema:3,active:true,syncMode:'full',paginationVersion:2,phase:'logs-filtered',fullResetDone:true,logPageParams:{from:0,to:110,nanostamp:'100000000003'},logLastPageIds:['last'],logPageSeen:[],logPage:1};
  const {app,calls}=harness({stored:{apiKey:key,catalog:[item],syncJob:job,transactions:[{id:'last:206',itemId:206,side:'sell',qty:1,total:20,timestamp:100}],fullResyncBackup:{sync:{lastSync:77}}},responses:{'/user/log':url=>url.searchParams.get('nanostamp')==='100000000002'?{log:[]}:{log:[boundarySale('last')],_metadata:{nanostamp:'100000000003'}}}});
  await app.runResumableLogPhase(JSON.parse(JSON.stringify(job)),'filtered');assert.equal(calls.length,4);assert.equal(app.state.transactions.length,1);
});

test('ignored boundary probe preserves paused full checkpoint, recovery and success date',async()=>{
  const responses=baseResponses();responses['/user/log']=url=>url.searchParams.get('log')?.split(',').includes('4210')?{log:[boundarySale('last')],_metadata:{nanostamp:'100000000003'}}:{log:[]};
  const {app,storage}=harness({stored:{apiKey:key,catalog:[item],sync:{lastSync:77,firstSyncComplete:true},transactions:[{id:'original',itemId:206,side:'buy',qty:5,total:100,timestamp:50}]},responses});
  await app.syncAll({mode:'full'});
  assert.equal(app.state.sync.lastSync,0); // Full rebuild clears live coverage, original remains in recovery.
  assert.equal(JSON.parse(storage.get('tta:v1:fullResyncBackup')).sync.lastSync,77);
  const report=app.diagnosticReport();assert.equal(report.pendingSync.paused,true);assert.equal(report.pendingSync.lastErrorCode,'PAGE_BOUNDARY_UNVERIFIED');assert.equal(report.pendingSync.recoveryAvailable,true);
  assert.equal(app.state.syncing,false);assert.equal(app.state.backgroundSyncing,false);
});

test('separate log filters keep independent boundary identities and complete both batches',async()=>{
  const {app,calls}=harness({stored:{apiKey:key,catalog:[item]},responses:{'/user/log':url=>{
    if(url.searchParams.get('nanostamp')==='100000000002')return {log:[]};
    return {log:[boundarySale(url.searchParams.get('log')==='4210'?'second-filter':'first-filter')],_metadata:{nanostamp:'100000000003'}};
  }}});
  const job={...boundaryJob(),logTypeIds:[1,2,3,4,5,6,7,8,9,10,4210]};await app.runResumableLogPhase(job,'filtered');
  assert.equal(app.state.transactions.length,2);assert.equal(job.completedSources.log,true);assert.equal(job.diagnostics.boundaryRecoveries,2);
  assert.equal(calls.filter(u=>u.searchParams.get('log')==='4210').length,5);
});

function zeroPage(rows,params,value='0') {
  return {log:rows,_metadata:{nanostamp:value,links:{next:`https://api.torn.com/v2/user/log?from=${params.from}&to=${params.to}&nanostamp=0&limit=100`}}};
}

test('zero numeric/string metadata and zero-only links never become continuation cursors',()=>{
  const {app}=harness();const params={from:50,to:110,limit:100};
  for(const value of [0,'0','000'])assert.equal(app.nextHistoryPage(zeroPage([boundarySale('last')],params,value),params,[boundarySale('last')],[]),null);
  const linked=zeroPage([boundarySale('last')],params);delete linked._metadata.nanostamp;
  assert.equal(app.nextHistoryPage(linked,params,linked.log,[]),null);
  linked._metadata.links.next='https://api.torn.com/v2/user/log?to=0&nanostamp=0';assert.equal(app.nextHistoryPage(linked,params,linked.log,[]),null);
});

test('zero metadata retains a usable positive link cursor or older timestamp',()=>{
  const {app}=harness(),params={from:0,to:110,limit:100},rows=[boundarySale('last')];
  for(const query of ['to=100&nanostamp=100000000001','to=90&nanostamp=0']){
    const next=app.nextHistoryPage({log:rows,_metadata:{nanostamp:'0',links:{next:'https://api.torn.com/v2/user/log?'+query}}},params,rows,[]);
    assert.equal(next.from,0);assert.equal(next.to,query.startsWith('to=100')?'100':'90');assert.notEqual(next.nanostamp,'0');
  }
});

test('zero terminal pages are independently checked without sending zero or skipping a second',async()=>{
  for(const value of [0,'0',undefined]){
    const {app,calls}=harness({stored:{apiKey:key,catalog:[item]},responses:{'/user/log':url=>{
      const data=zeroPage([boundarySale('last')],Object.fromEntries(url.searchParams),value);if(value===undefined)delete data._metadata.nanostamp;return data;
    }}});
    const job=boundaryJob();await app.runResumableLogPhase(job,'filtered');
    assert.equal(calls.length,2);assert.equal(calls[1].searchParams.get('to'),'100');assert.equal(calls.every(u=>!u.searchParams.has('nanostamp')),true);
    assert.equal(app.state.transactions.length,1);assert.equal(job.completedSources.log,true);assert.equal(job.diagnostics.boundaryRecoveries,1);
  }
});

test('date verification loads older unseen logs after a zero cursor',async()=>{
  const {app,calls}=harness({stored:{apiKey:key,catalog:[item]},responses:{'/user/log':url=>{
    const to=Number(url.searchParams.get('to')),rows=to>100?[boundarySale('newest')]:to===100?[boundarySale('last',90)]:[boundarySale('last',90)];
    return zeroPage(rows,Object.fromEntries(url.searchParams));
  }}});
  const job=boundaryJob();await app.runResumableLogPhase(job,'filtered');assert.equal(app.state.transactions.length,2);assert.equal(job.completedSources.log,true);
  assert.equal(calls.map(u=>u.searchParams.get('to')).join(','),'110,100,90,90');
});

test('same-second zero verification checkpoints additional IDs before terminal confirmation',async()=>{
  let requests=0;
  const {app}=harness({stored:{apiKey:key,catalog:[item]},responses:{'/user/log':url=>zeroPage([boundarySale(++requests%2?'a':'b')],Object.fromEntries(url.searchParams))}});
  const job=boundaryJob();await app.runResumableLogPhase(job,'filtered');assert.equal(requests,4);assert.equal(app.state.transactions.length,2);assert.equal(job.completedSources.log,true);
});

test('zero after a positive nanostamp verifies the boundary and retains every row',async()=>{
  const {app,calls}=harness({stored:{apiKey:key,catalog:[item]},responses:{'/user/log':url=>{
    if(!url.searchParams.has('nanostamp')&&url.searchParams.get('to')==='110')return {log:[boundarySale('first',101)],_metadata:{nanostamp:'101000000001'}};
    return zeroPage([boundarySale('last')],Object.fromEntries(url.searchParams));
  }}});
  const job=boundaryJob();await app.runResumableLogPhase(job,'filtered');assert.equal(app.state.transactions.length,2);assert.equal(job.completedSources.log,true);assert.equal(calls.length,3);assert.equal(calls.at(-1).searchParams.has('nanostamp'),false);
});

test('dense zero-cursor pages pause rather than silently losing same-second logs',async()=>{
  for(const count of [99,100]){
    const rows=Array.from({length:count},(_,i)=>boundarySale('sale-'+i));
    const {app,calls}=harness({stored:{apiKey:key},responses:{'/user/log':url=>zeroPage(rows,Object.fromEntries(url.searchParams))}});
    await assert.rejects(app.historyPage('/user/log',{from:0,to:110,limit:100},[]),e=>e.code==='PAGE_INCOMPLETE');assert.equal(calls.length,3);assert.equal(app.state.sync.lastSync,0);
  }
});

test('zero verification failures and unbounded responses keep history incomplete',async()=>{
  for(const probe of [{log:[boundarySale('ignored',101)],_metadata:{nanostamp:0}},{log:[boundarySale('out-of-range',40)],_metadata:{nanostamp:0}},{wrong:[]},{error:{code:2}}]){
    const {app}=harness({stored:{apiKey:key,sync:{lastSync:77}},responses:{'/user/log':url=>url.searchParams.get('to')==='100'?probe:zeroPage([boundarySale('last')],Object.fromEntries(url.searchParams))}});
    await assert.rejects(app.historyPage('/user/log',{from:50,to:110},[]));assert.equal(app.state.sync.lastSync,77);
  }
});

test('saved zero cursor is removed before a valid positive cursor arrives',async()=>{
  const {app,calls}=harness({stored:{apiKey:key},responses:{'/user/log':{log:[boundarySale('last')],_metadata:{nanostamp:'100000000003'}}}});
  const result=await app.historyPage('/user/log',{from:50,to:110,nanostamp:'0'},[]);
  assert.equal(calls[0].searchParams.has('nanostamp'),false);assert.equal(result.next.nanostamp,'100000000003');assert.equal(app.state.notices.some(n=>n.code==='PAGE_SOURCE_MISMATCH'),false);
});

test('reported paused v0.3.5 quick scan and Full Resync complete with zero metadata',async()=>{
  const responses=baseResponses();responses['/user/log']=url=>{
    const params=Object.fromEntries(url.searchParams),to=Number(params.to);
    const rows=params.log?.split(',').includes('4210')?Array.from({length:to>now-30?4:1},(_,i)=>boundarySale('sale-'+i,now-30)):[];
    return zeroPage(rows,params);
  };
  const job={schema:3,id:'reported-zero',active:true,syncMode:'quick',paginationVersion:2,phase:'logs-filtered',period:{from:now-259200,to:now},logScanPeriod:{from:now-259200,to:now},tradeScanPeriod:{from:now-259200,to:now},logPageParams:{from:now-259200,to:now,nanostamp:'0'},logLastPageIds:['sale-0'],updatedAt:now,diagnostics:{rawRows:4,pages:12},lastErrorCode:'PAGE_REPEATED',lastError:'Old zero cursor'};
  const {app,calls,storage}=harness({stored:{apiKey:key,catalog:[item],syncJob:job,sync:{lastSync:now-500,firstSyncComplete:true,accountingVersion:'0.3.3',historyPaginationVersion:2}},responses});
  app.reportDiagnostic('PAGE_SOURCE_MISMATCH','error','Old zero forward cursor',{source:'log',cursor:'0',nextCursor:'1790294845787692899'});
  app.reportDiagnostic('PAGE_SOURCE_MISMATCH','error','Unrelated source',{source:'catalog'});
  await app.runResumableSync(job,true);assert.equal(app.state.sync.lastSync,now);assert.equal(storage.has('tta:v1:syncJob'),false);assert.equal(app.state.transactions.length,4);
  await app.syncAll({mode:'full'});assert.equal(app.state.sync.historyPaginationVersion,3);assert.equal(app.state.transactions.length,4);assert.equal(storage.has('tta:v1:fullResyncBackup'),false);
  assert.equal(calls.filter(u=>u.pathname==='/v2/user/log').every(u=>u.searchParams.get('nanostamp')!=='0'),true);
  assert.equal(app.state.notices.some(n=>n.code==='PAGE_SOURCE_MISMATCH'&&n.context.source==='log'),false);assert.equal(app.state.notices.some(n=>n.code==='PAGE_SOURCE_MISMATCH'&&n.context.source==='catalog'),true);
});

test('Full Resync takes over a paused quick zero checkpoint instead of resuming quick mode',async()=>{
  const responses=baseResponses();responses['/user/log']=url=>zeroPage([],Object.fromEntries(url.searchParams));
  const paused={schema:3,id:'quick',active:true,syncMode:'quick',paginationVersion:2,phase:'logs-filtered',period:{from:now-60,to:now},updatedAt:now,logPageParams:{nanostamp:'0'},lastError:'Zero cursor'};
  const {app,storage}=harness({stored:{apiKey:key,catalog:[item],syncJob:paused,sync:{lastSync:now-100}},responses});
  await app.syncAll({mode:'full'});assert.equal(app.state.sync.firstSyncComplete,true);assert.equal(app.state.sync.coverageFrom,0);assert.equal(app.state.sync.historyPaginationVersion,3);assert.equal(storage.has('tta:v1:syncJob'),false);
});
