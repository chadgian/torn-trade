const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./harness.cjs');

const key='test-token';
const head=Array.from({length:100},(_,i)=>({id:i+1,completed_at:200-i}));
const sameSecond=[{id:100,completed_at:101},{id:101,completed_at:101}];
const older=[{id:102,completed_at:98},{id:103,completed_at:80}];
const job=()=>({id:'trade-full-page-recovery',tradeScanPeriod:{from:0,to:300},diagnostics:{},tradeHeaders:[]});
const repeated='https://api.torn.com/v2/user/trades?cat=finished&limit=100&sort=DESC&from=0&to=300';

test('real incident: 100 trades, repeated first-page link, then older history, no skipped boundary IDs',async()=>{
  const calls=[];
  const responses={'/user/trades':url=>{
    const to=Number(url.searchParams.get('to')),from=Number(url.searchParams.get('from')||0);
    calls.push({from,to});
    if(from===100&&to===101)return {trades:sameSecond,_metadata:{links:{next:null}}};
    if(to===100)return {trades:older,_metadata:{links:{next:null}}};
    if(to===300)return {trades:head,_metadata:{links:{next:repeated}}};
    throw Error('Unexpected trade time window '+from+'..'+to);
  }};
  const {app}=harness({stored:{apiKey:key},responses});const scan=job();
  await app.runResumableTradeList(scan);
  assert.equal(scan.completedSources.trade,true);
  assert.equal(scan.tradeHeaders.length,103);
  assert.deepEqual([...new Set(Array.from(scan.tradeHeaders,r=>r.id))].sort((a,b)=>a-b),Array.from({length:103},(_,i)=>i+1));
  assert.equal(scan.diagnostics.tradeBoundaryRecoveries,1);
  assert.ok(calls.some(x=>x.from===100&&x.to===101));
  assert.ok(calls.some(x=>x.to===100));
  assert.ok(app.state.notices.some(n=>n.code==='PAGE_BOUNDARY_RECOVERED'));
});

test('100-trade page without a continuation link is independently verified',async()=>{
  const responses={'/user/trades':url=>{
    const to=Number(url.searchParams.get('to')),from=Number(url.searchParams.get('from')||0);
    if(from===100&&to===101)return {trades:[{id:100,completed_at:101}]};
    if(to===100)return {trades:[]};
    return {trades:head,_metadata:{links:{next:null}}};
  }};
  const {app}=harness({stored:{apiKey:key},responses});const scan=job();
  await app.runResumableTradeList(scan);
  assert.equal(scan.tradeHeaders.length,100);
  assert.equal(scan.completedSources.trade,true);
  assert.equal(scan.diagnostics.tradeBoundaryRecoveries,1);
});

test('unverifiable 100-record same-second boundary stays paused, never marked complete',async()=>{
  const dense=Array.from({length:100},(_,i)=>({id:i+1,completed_at:101}));
  const responses={'/user/trades':()=>({trades:dense,_metadata:{links:{next:repeated}}})};
  const {app}=harness({stored:{apiKey:key},responses});const scan=job();
  await assert.rejects(app.runResumableTradeList(scan),error=>error.code==='PAGE_BOUNDARY_UNVERIFIED');
  assert.notEqual(scan.completedSources?.trade,true);
  assert.equal(app.state.sync.firstSyncComplete,false);
});

test('a provider that ignores date range cannot be silently treated as older history',async()=>{
  const responses={'/user/trades':url=>{
    const to=Number(url.searchParams.get('to')),from=Number(url.searchParams.get('from')||0);
    if(from===100&&to===101)return {trades:[{id:100,completed_at:101}]};
    return {trades:head,_metadata:{links:{next:repeated}}};
  }};
  const {app}=harness({stored:{apiKey:key},responses});const scan=job();
  await assert.rejects(app.runResumableTradeList(scan),error=>error.code==='PAGE_BOUNDARY_UNVERIFIED');
  assert.notEqual(scan.completedSources?.trade,true);
});

test('trade scan does not advance when repeated cursor fails after initial row checkpoint',async()=>{
  const responses={'/user/trades':()=>({trades:head,_metadata:{links:{next:repeated}}})};
  const {app}=harness({stored:{apiKey:key},responses});const scan=job();
  await assert.rejects(app.runResumableTradeList(scan),error=>error.code==='PAGE_BOUNDARY_UNVERIFIED');
  assert.notEqual(scan.completedSources?.trade,true);
  assert.equal(scan.tradeListParams,undefined);
  assert.equal(app.state.sync.lastSync,0);
});
