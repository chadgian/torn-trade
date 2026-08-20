from pathlib import Path

script = Path('torn-trade-analyzer.user.js')
s = script.read_text()

assert '// @version      0.1.23' in s
assert "const VERSION = '0.1.23';" in s
s = s.replace('// @version      0.1.23', '// @version      0.1.24', 1)
s = s.replace("const VERSION = '0.1.23';", "const VERSION = '0.1.24';", 1)
s = s.replace(
    'Fast Torn trade analytics with current-server sync bounds, stale-checkpoint recovery, recent-log refresh, interactive profit charts, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.',
    'Fast Torn trade analytics with TCT day-gap recovery, current-server sync bounds, interactive profit charts, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.',
    1,
)

old_bounds = """  function selectedPeriodBounds(nowDate=new Date()) {
    const nowMs=nowDate.getTime();
    let from=0,to=Math.floor(nowMs/1000)+60;
    if(state.dateMode==='7d') from=Math.floor((nowMs-7*86400*1000)/1000);
    else if(state.dateMode==='30d') from=Math.floor((nowMs-30*86400*1000)/1000);
    else if(state.dateMode==='month') from=Math.floor(subtractCalendarMonth(nowDate).getTime()/1000);
    else if(state.dateMode==='custom') {
      if(state.customFrom) from=Math.floor(new Date(state.customFrom+'T00:00:00').getTime()/1000);
      if(state.customTo) to=Math.min(to,Math.floor(new Date(state.customTo+'T23:59:59').getTime()/1000));
    }
    if(!Number.isFinite(from)||from<0)from=0;
    if(!Number.isFinite(to))to=Math.floor(nowMs/1000)+60;
    return {from:Math.floor(from),to:Math.floor(to)};
  }
"""
assert old_bounds in s
new_bounds = old_bounds + """
  // Torn City Time (TCT) follows Torn's server timestamp. Use UTC calendar boundaries
  // for sync planning so device timezone never decides which Torn day was checked.
  function tctDayStart(ts) { return Math.floor((Number(ts)||0)/86400)*86400; }
  function tctDateStr(ts) { return new Date((Number(ts)||0)*1000).toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}); }
  function tctDateTimeStr(ts) { return new Date((Number(ts)||0)*1000).toLocaleString(undefined,{timeZone:'UTC',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}); }
  function subtractCalendarMonthTct(serverNow) {
    const d=new Date((Number(serverNow)||0)*1000),day=d.getUTCDate();
    d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);
    const maxDay=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
    d.setUTCDate(Math.min(day,maxDay));return Math.floor(d.getTime()/1000);
  }
  function selectedPeriodBoundsTct(serverNow=nowSec()) {
    serverNow=Math.floor(Number(serverNow)||nowSec());
    let from=0,to=serverNow;
    if(state.dateMode==='7d')from=serverNow-7*86400;
    else if(state.dateMode==='30d')from=serverNow-30*86400;
    else if(state.dateMode==='month')from=subtractCalendarMonthTct(serverNow);
    else if(state.dateMode==='custom'){
      if(state.customFrom){const x=Date.parse(state.customFrom+'T00:00:00Z')/1000;if(Number.isFinite(x))from=Math.floor(x);}
      if(state.customTo){const x=Date.parse(state.customTo+'T23:59:59Z')/1000;if(Number.isFinite(x))to=Math.min(to,Math.floor(x));}
    }
    if(!Number.isFinite(from)||from<0)from=0;if(!Number.isFinite(to)||to>serverNow)to=serverNow;
    return {from:Math.floor(from),to:Math.floor(to)};
  }
"""
s = s.replace(old_bounds, new_bounds, 1)

old_cache_init = "if(!c||Number(c.schema)!==SYNC_CACHE_SCHEMA_VERSION)c={schema:SYNC_CACHE_SCHEMA_VERSION,verifiedTrades:{},logCoverageFrom:null,logCoverageTo:0,tradeCoverageFrom:null,tradeCoverageTo:0};"
assert old_cache_init in s
new_cache_init = "if(!c||Number(c.schema)!==SYNC_CACHE_SCHEMA_VERSION)c={schema:SYNC_CACHE_SCHEMA_VERSION,verifiedTrades:{},logCoverageFrom:null,logCoverageTo:0,tradeCoverageFrom:null,tradeCoverageTo:0,logDayCoverage:{},tradeDayCoverage:{}};"
s = s.replace(old_cache_init, new_cache_init, 1)
old_guard = "    if(!c.verifiedTrades||typeof c.verifiedTrades!=='object')c.verifiedTrades={};\n"
assert old_guard in s
s = s.replace(old_guard, old_guard + "    if(!c.logDayCoverage||typeof c.logDayCoverage!=='object')c.logDayCoverage={};\n    if(!c.tradeDayCoverage||typeof c.tradeDayCoverage!=='object')c.tradeDayCoverage={};\n", 1)

old_incremental = """  function incrementalPeriod(period,kind) {
    const c=ensureSyncCache(),fromKey=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',toKey=kind==='trade'?'tradeCoverageTo':'logCoverageTo';
    const rawFrom=c[fromKey],coveredFrom=rawFrom==null?NaN:Number(rawFrom),coveredTo=Number(c[toKey])||0;
    const overlap=kind==='trade'?RECENT_TRADE_RECHECK_SEC:RECENT_LOG_RECHECK_SEC,now=nowSec(),liveEdge=period.to>=now-INCREMENTAL_OVERLAP_SEC;
    if(Number.isFinite(coveredFrom)&&coveredFrom<=period.from&&coveredTo>0){
      // A fully-covered live period is still refreshed because Torn logs may become visible late.
      if(period.to<=coveredTo){
        if(!liveEdge)return null;
        return {from:Math.max(period.from,now-overlap),to:period.to,incremental:true,recheck:true};
      }
      return {from:Math.max(period.from,coveredTo-overlap),to:period.to,incremental:true,recheck:liveEdge};
    }
    return {from:period.from,to:period.to,incremental:false,recheck:false};
  }
"""
assert old_incremental in s
new_incremental = """  function dayCoverageMap(c,kind) {
    const key=kind==='trade'?'tradeDayCoverage':'logDayCoverage';
    if(!c[key]||typeof c[key]!=='object')c[key]={};return c[key];
  }
  function dayCoverageContains(range,from,to) {
    return Array.isArray(range)&&Number(range[0])<=from+1&&Number(range[1])>=to-1;
  }
  function recordTctDayCoverage(c,kind,period,serverNow) {
    if(!period)return;
    let from=Number(period.from),to=Math.min(Number(period.to)||serverNow,serverNow);
    if(!(from>=0)||!(to>=from))return;
    // A from=0 all-history scan cannot be expanded from 1970. Once an actual historical
    // floor is known, normal selected-period scans populate per-day coverage from there.
    if(from===0){const fk=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',known=Number(c[fk]);if(!(known>0))return;from=known;}
    const map=dayCoverageMap(c,kind);
    for(let day=tctDayStart(from),last=tctDayStart(to);day<=last;day+=86400){
      const segFrom=Math.max(from,day),segTo=Math.min(to,day+86399),key=String(day),old=map[key];
      const oldFrom=Array.isArray(old)?Number(old[0]):NaN,oldTo=Array.isArray(old)?Number(old[1]):NaN;
      map[key]=[Number.isFinite(oldFrom)?Math.min(oldFrom,segFrom):segFrom,Number.isFinite(oldTo)?Math.max(oldTo,segTo):segTo];
    }
  }
  function incrementalPeriod(period,kind,serverNow=nowSec()) {
    const c=ensureSyncCache(),fromKey=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',toKey=kind==='trade'?'tradeCoverageTo':'logCoverageTo';
    const rawFrom=c[fromKey],coveredFrom=rawFrom==null?NaN:Number(rawFrom),coveredTo=Number(c[toKey])||0;
    const overlap=kind==='trade'?RECENT_TRADE_RECHECK_SEC:RECENT_LOG_RECHECK_SEC;
    serverNow=Math.floor(Number(serverNow)||nowSec());
    const effectiveTo=Math.min(Number(period.to)||serverNow,serverNow),liveEdge=effectiveTo>=serverNow-120;

    // Keep the all-history path efficient. Finite selected periods below use exact TCT-day coverage.
    if(!(Number(period.from)>0)){
      if(Number.isFinite(coveredFrom)&&coveredTo>0){
        if(effectiveTo<=coveredTo){if(!liveEdge)return null;return {from:Math.max(0,serverNow-overlap),to:effectiveTo,incremental:true,recheck:true,missingDays:0};}
        return {from:Math.max(0,coveredTo-overlap),to:effectiveTo,incremental:true,recheck:liveEdge,missingDays:0};
      }
      return {from:0,to:effectiveTo,incremental:false,recheck:false,missingDays:0};
    }

    const from=Math.min(Number(period.from),effectiveTo),map=dayCoverageMap(c,kind);
    let missingFrom=null,missingDays=0;
    for(let day=tctDayStart(from),last=tctDayStart(effectiveTo);day<=last;day+=86400){
      const reqFrom=Math.max(from,day),reqTo=Math.min(effectiveTo,day+86399),range=map[String(day)];
      if(!dayCoverageContains(range,reqFrom,reqTo)){missingDays++;if(missingFrom==null)missingFrom=reqFrom;}
    }
    const candidates=[];
    if(missingFrom!=null)candidates.push(missingFrom);
    if(coveredTo>0&&coveredTo<effectiveTo)candidates.push(Math.max(from,coveredTo-overlap));
    if(liveEdge)candidates.push(Math.max(from,serverNow-overlap));
    if(!candidates.length)return null;
    return {from:Math.max(from,Math.min(...candidates)),to:effectiveTo,incremental:Number.isFinite(coveredFrom)||coveredTo>0,recheck:liveEdge,missingDays};
  }
"""
s = s.replace(old_incremental, new_incremental, 1)

old_update = """  function updateSyncCoverage(job) {
    const c=ensureSyncCache();
    const apply=(kind,p)=>{
      if(!p)return;const fk=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',tk=kind==='trade'?'tradeCoverageTo':'logCoverageTo';
      const rawOldFrom=c[fk],oldFrom=rawOldFrom==null?NaN:Number(rawOldFrom);if(!p.incremental)c[fk]=Number.isFinite(oldFrom)?Math.min(oldFrom,p.from):p.from;
      c[tk]=Math.max(Number(c[tk])||0,Math.min(p.to,nowSec()));
    };
    apply('log',job.logScanPeriod);apply('trade',job.tradeScanPeriod);saveSyncCache();
  }
"""
assert old_update in s
new_update = """  function updateSyncCoverage(job) {
    const c=ensureSyncCache(),serverNow=Number(job?.tctNow)||nowSec();
    const apply=(kind,p)=>{
      if(!p)return;const fk=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',tk=kind==='trade'?'tradeCoverageTo':'logCoverageTo';
      const rawOldFrom=c[fk],oldFrom=rawOldFrom==null?NaN:Number(rawOldFrom);if(!p.incremental)c[fk]=Number.isFinite(oldFrom)?Math.min(oldFrom,p.from):p.from;
      c[tk]=Math.max(Number(c[tk])||0,Math.min(p.to,serverNow));recordTctDayCoverage(c,kind,p,serverNow);
    };
    apply('log',job.logScanPeriod);apply('trade',job.tradeScanPeriod);saveSyncCache();
  }
"""
s = s.replace(old_update, new_update, 1)

s = s.replace("const wanted=selectedPeriodBounds(),fromDiff=Math.abs((Number(job.period.from)||0)-wanted.from);", "const wanted=selectedPeriodBoundsTct(nowSec()),fromDiff=Math.abs((Number(job.period.from)||0)-wanted.from);", 1)
s = s.replace("const period=selectedPeriodBounds(),periodText=period.from>0?`${dateStr(period.from)} – ${dateStr(Math.min(period.to,nowSec()))}`:'all available history';", "const period=selectedPeriodBoundsTct(nowSec()),periodText=period.from>0?`${tctDateStr(period.from)} – ${tctDateStr(Math.min(period.to,nowSec()))} TCT`:'all available history';", 1)

old_refresh = """  async function refreshLiveSyncBounds(job) {
    let serverNow=nowSec();
    try{const t=await apiGet('/user/timestamp');serverNow=Number(t?.timestamp)||serverNow;}catch(_){}
    const wanted=selectedPeriodBounds(new Date(serverNow*1000));
    const isLive=wanted.to>=serverNow-120;
    if(!isLive)return;
    job.period={from:wanted.from,to:wanted.to};
    job.periodText=wanted.from>0?`${dateStr(wanted.from)} – ${dateStr(Math.min(wanted.to,serverNow))}`:'all available history';
    job.logScanPeriod=incrementalPeriod(job.period,'log');
    job.tradeScanPeriod=incrementalPeriod(job.period,'trade');
    job.logCursorTo=job.logScanPeriod?.to||job.period.to;
    job.tradeListParams=null;
  }
"""
assert old_refresh in s
new_refresh = """  async function refreshLiveSyncBounds(job) {
    let serverNow=nowSec();
    try{const t=await apiGet('/user/timestamp');serverNow=Number(t?.timestamp)||serverNow;}catch(_){}
    const wanted=selectedPeriodBoundsTct(serverNow);
    job.tctNow=serverNow;job.tctNowLabel=tctDateTimeStr(serverNow);
    job.period={from:wanted.from,to:wanted.to};
    job.periodText=wanted.from>0?`${tctDateStr(wanted.from)} – ${tctDateStr(Math.min(wanted.to,serverNow))} TCT`:'all available history';
    job.logScanPeriod=incrementalPeriod(job.period,'log',serverNow);
    job.tradeScanPeriod=incrementalPeriod(job.period,'trade',serverNow);
    job.logCursorTo=job.logScanPeriod?.to||job.period.to;
    job.tradeListParams=null;
  }
"""
s = s.replace(old_refresh, new_refresh, 1)

old_diag_tail = "foreignBuyRows:0,foreignBuyQty:0,recentLogRecheckHours:RECENT_LOG_RECHECK_SEC/3600,recentTradeRecheckHours:RECENT_TRADE_RECHECK_SEC/3600,incrementalLogs:!!job.logScanPeriod?.incremental,incrementalTrades:!!job.tradeScanPeriod?.incremental"
assert old_diag_tail in s
new_diag_tail = "foreignBuyRows:0,foreignBuyQty:0,recentLogRecheckHours:RECENT_LOG_RECHECK_SEC/3600,recentTradeRecheckHours:RECENT_TRADE_RECHECK_SEC/3600,tctNow:Number(job.tctNow)||0,missingLogDays:Number(job.logScanPeriod?.missingDays)||0,missingTradeDays:Number(job.tradeScanPeriod?.missingDays)||0,incrementalLogs:!!job.logScanPeriod?.incremental,incrementalTrades:!!job.tradeScanPeriod?.incremental"
s = s.replace(old_diag_tail, new_diag_tail, 1)

old_prepare_label = "if(job.logScanPeriod){const scanLabel=job.logScanPeriod.incremental?(job.logScanPeriod.recheck?'Refreshing recent logs + missing history':'Scanning new/missing logs'):'Establishing log baseline';job.phase='logs-filtered';checkpointSyncJob(job,`${scanLabel} · ${dateStr(job.logScanPeriod.from)} – ${dateStr(Math.min(job.logScanPeriod.to,nowSec()))}`);}"
assert old_prepare_label in s
new_prepare_label = "if(job.logScanPeriod){const missing=Number(job.logScanPeriod.missingDays)||0,scanLabel=missing?`Filling ${missing} missing TCT day${missing===1?'':'s'}`:(job.logScanPeriod.incremental?(job.logScanPeriod.recheck?'Refreshing current/recent TCT data':'Scanning new TCT data'):'Establishing TCT baseline');job.phase='logs-filtered';checkpointSyncJob(job,`${scanLabel} · ${tctDateStr(job.logScanPeriod.from)} – ${tctDateStr(Math.min(job.logScanPeriod.to,job.tctNow||nowSec()))} TCT`);}"
s = s.replace(old_prepare_label, new_prepare_label, 1)

old_finish = """  function finishResumableSync(job) {
    const freshCount=finalizeResumableTransactions(job),d=job.diagnostics||{};commitTradeVerifications(job);updateSyncCoverage(job);
    state.sync.lastSync=nowSec();state.sync.firstSyncComplete=true;state.sync.autoDiscoveryComplete=true;
    const oldCoverage=Number(state.sync.coverageFrom);state.sync.coverageFrom=Number.isFinite(oldCoverage)?Math.min(oldCoverage,job.period.from):job.period.from;state.sync.coverageTo=Math.max(Number(state.sync.coverageTo)||0,Math.min(job.period.to,nowSec()));state.sync.diagnostics=d;save('sync',state.sync);
    const mode=d.mode==='unfiltered-fallback'?'compatibility scan':'filtered scan';
    if(!freshCount)setSyncProgress(`Sync up to date through ${dateTimeStr(state.sync.lastSync)} · recent ${qty(d.recentLogRecheckHours||72)}h User Logs refreshed · ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);
    else setSyncProgress(`Incremental sync complete · ${qty(freshCount)} new item rows · ${qty(d.foreignBuyQty||0)} overseas-acquired item(s) seen in this scan · ${qty(d.existingRowsSkipped||0)} existing rows skipped · ${qty(d.tradeDetails||0)} missing trade details fetched.`);
    job.active=false;job.phase='done';clearSyncJob();
  }
"""
assert old_finish in s
new_finish = """  function finishResumableSync(job) {
    const freshCount=finalizeResumableTransactions(job),d=job.diagnostics||{},serverNow=Number(job.tctNow)||nowSec();commitTradeVerifications(job);updateSyncCoverage(job);
    state.sync.lastSync=serverNow;state.sync.firstSyncComplete=true;state.sync.autoDiscoveryComplete=true;
    const oldCoverage=Number(state.sync.coverageFrom);state.sync.coverageFrom=Number.isFinite(oldCoverage)?Math.min(oldCoverage,job.period.from):job.period.from;state.sync.coverageTo=Math.max(Number(state.sync.coverageTo)||0,Math.min(job.period.to,serverNow));state.sync.diagnostics=d;save('sync',state.sync);
    const repaired=Number(d.missingLogDays)||0;
    if(!freshCount)setSyncProgress(`Sync checked through ${tctDateTimeStr(serverNow)} TCT · ${repaired?`${qty(repaired)} missing TCT day(s) filled · `:''}current/recent logs refreshed · ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);
    else setSyncProgress(`Sync checked through ${tctDateTimeStr(serverNow)} TCT · ${repaired?`${qty(repaired)} missing TCT day(s) filled · `:''}${qty(freshCount)} new item rows · ${qty(d.foreignBuyQty||0)} overseas-acquired item(s) seen · ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);
    job.active=false;job.phase='done';clearSyncJob();
  }
"""
s = s.replace(old_finish, new_finish, 1)

# Make the stale-checkpoint UI wording generic instead of referring to a particular date window.
s = s.replace('Old sync checkpoint retired · starting a fresh scan through current Torn server time…', 'Old sync checkpoint retired · rebuilding TCT day coverage through current Torn server time…', 1)
s = s.replace('Expired old sync checkpoint cleared. Press Sync for current data.', 'Expired old sync checkpoint cleared. Press Sync to verify current TCT and fill missing days.', 1)

script.write_text(s)

readme = Path('README.md')
r = readme.read_text()
assert '**Current version:** v0.1.23' in r
r = r.replace('**Current version:** v0.1.23', '**Current version:** v0.1.24', 1)
r += """

## v0.1.24 TCT day-gap sync

- Sync now gets the current Torn server timestamp first and treats that as the authoritative Torn City Time (TCT) target.
- Finite selected periods are tracked by TCT calendar-day coverage, independent of the phone/browser timezone.
- A day can be marked scanned even when it contains zero item transactions, so an empty day is no longer confused with an unchecked day.
- Every Sync identifies uncovered TCT day ranges in the selected period, starts from the earliest missing segment, and fills those gaps through the current TCT target.
- The current TCT day is refreshed through the current server time, and the recent safety window remains in place for delayed Torn logs.
- Deterministic transaction IDs still prevent duplicate accounting when covered days are rechecked.
"""
readme.write_text(r)
