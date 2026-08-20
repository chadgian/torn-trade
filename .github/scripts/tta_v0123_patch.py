from pathlib import Path

script = Path('torn-trade-analyzer.user.js')
s = script.read_text()

assert '// @version      0.1.22' in s
assert "const VERSION = '0.1.22';" in s
s = s.replace('// @version      0.1.22', '// @version      0.1.23', 1)
s = s.replace("const VERSION = '0.1.22';", "const VERSION = '0.1.23';", 1)
s = s.replace(
    'Fast Torn trade analytics with recent-log freshness recovery, spacious interactive profit charts, acquisition-date attribution, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.',
    'Fast Torn trade analytics with current-server sync bounds, stale-checkpoint recovery, recent-log refresh, interactive profit charts, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.',
    1,
)

old_series = """    const result=[...m.entries()].sort((a,b)=>a[0]-b[0]).map(([t,v])=>({t,v}));perfCache.series.set(cacheKey,result);return result;\n"""
new_series = """    const boundary=Math.min(to,nowSec());\n    // Keep a live/current bucket visible even when today's acquisition-attributed profit is $0.\n    // This prevents a current sync from looking stale merely because the latest realized-profit lot is older.\n    if(m.size&&boundary>=from){const k=keyFn(boundary);if(!m.has(k))m.set(k,0);}\n    const result=[...m.entries()].sort((a,b)=>a[0]-b[0]).map(([t,v])=>({t,v}));perfCache.series.set(cacheKey,result);return result;\n"""
assert old_series in s
s = s.replace(old_series, new_series, 1)

old_constants = """  const RECENT_LOG_RECHECK_SEC = 72 * 3600;\n  const RECENT_TRADE_RECHECK_SEC = 6 * 3600;\n  let resumeBootStarted=false,resumableTxMap=null,resumableTxJob='',syncCacheMem=null;\n"""
new_constants = """  const RECENT_LOG_RECHECK_SEC = 72 * 3600;\n  const RECENT_TRADE_RECHECK_SEC = 6 * 3600;\n  const STALE_SYNC_JOB_SEC = 5 * 60;\n  let resumeBootStarted=false,resumableTxMap=null,resumableTxJob='',syncCacheMem=null;\n"""
assert old_constants in s
s = s.replace(old_constants, new_constants, 1)

old_clear = """  function clearSyncJob(){saveSyncJob(null);}\n  function syncJobCancelled(job){return !!(state.syncCancel||job?.cancelled);}\n"""
new_clear = """  function clearSyncJob(){saveSyncJob(null);}\n  function syncJobIsStale(job) {\n    if(!job?.period)return false;\n    const now=nowSec(),end=Number(job.period.to)||0,updated=Number(job.updatedAt)||0;\n    return (end>0&&end<now-STALE_SYNC_JOB_SEC)||(updated>0&&updated<now-6*3600);\n  }\n  function syncJobMatchesCurrentSelection(job) {\n    if(!job?.period)return false;\n    const wanted=selectedPeriodBounds(),fromDiff=Math.abs((Number(job.period.from)||0)-wanted.from);\n    return fromDiff<=STALE_SYNC_JOB_SEC&&!syncJobIsStale(job);\n  }\n  function discardStaleSyncJob(job) {\n    if(!job)return;\n    commitTradeVerifications(job);\n    abandonResumableMarkers(job);\n    clearSyncJob();\n  }\n  function syncJobCancelled(job){return !!(state.syncCancel||job?.cancelled);}\n"""
assert old_clear in s
s = s.replace(old_clear, new_clear, 1)

old_prepare = """  async function prepareResumableSync(job) {\n    await ensureCatalog();setBusyDetail('Verifying API access and incremental coverage…');\n    const keyInfo=await inspectActiveKey();if(!keyInfo.hasUserLog)throw new Error('This API key does not include User → Log access.');\n"""
new_prepare = """  async function refreshLiveSyncBounds(job) {\n    let serverNow=nowSec();\n    try{const t=await apiGet('/user/timestamp');serverNow=Number(t?.timestamp)||serverNow;}catch(_){}\n    const wanted=selectedPeriodBounds(new Date(serverNow*1000));\n    const isLive=wanted.to>=serverNow-120;\n    if(!isLive)return;\n    job.period={from:wanted.from,to:wanted.to};\n    job.periodText=wanted.from>0?`${dateStr(wanted.from)} – ${dateStr(Math.min(wanted.to,serverNow))}`:'all available history';\n    job.logScanPeriod=incrementalPeriod(job.period,'log');\n    job.tradeScanPeriod=incrementalPeriod(job.period,'trade');\n    job.logCursorTo=job.logScanPeriod?.to||job.period.to;\n    job.tradeListParams=null;\n  }\n  async function prepareResumableSync(job) {\n    await refreshLiveSyncBounds(job);\n    await ensureCatalog();setBusyDetail('Verifying API access and incremental coverage…');\n    const keyInfo=await inspectActiveKey();if(!keyInfo.hasUserLog)throw new Error('This API key does not include User → Log access.');\n"""
assert old_prepare in s
s = s.replace(old_prepare, new_prepare, 1)

old_syncall = """  async function syncAll(options={}) {\n    if(state.syncing)return;\n    if(!hasApiKey()){state.demo=true;toast('Add a Torn API key in Settings → API Key to sync real history.');return;}\n    let job=options?.job||loadSyncJob();\n    if(job?.cancelled){abandonResumableMarkers(job);clearSyncJob();job=null;}\n    if(!job)job=createResumableSyncJob();\n    return runResumableSync(job,!!options?.resume||Number(job.resumedCount)>0||job.phase!=='setup');\n  }\n  function resumePendingSync() {\n    if(resumeBootStarted||state.syncing)return;\n    const job=loadSyncJob();if(!job)return;\n    if(job.cancelled){abandonResumableMarkers(job);clearSyncJob();return;}\n    resumeBootStarted=true;syncAll({job,resume:true});\n  }\n"""
new_syncall = """  async function syncAll(options={}) {\n    if(state.syncing)return;\n    if(!hasApiKey()){state.demo=true;toast('Add a Torn API key in Settings → API Key to sync real history.');return;}\n    let job=options?.job||loadSyncJob();\n    if(job?.cancelled){abandonResumableMarkers(job);clearSyncJob();job=null;}\n    // Manual Sync must never stay trapped on an old saved window. Keep recent checkpoints resumable,\n    // but retire stale/mismatched ones while preserving already-downloaded rows and verified trades.\n    if(job&&!options?.job&&!syncJobMatchesCurrentSelection(job)){discardStaleSyncJob(job);job=null;setSyncProgress('Old sync checkpoint retired · starting a fresh scan through current Torn server time…');}\n    if(!job)job=createResumableSyncJob();\n    return runResumableSync(job,!!options?.resume||Number(job.resumedCount)>0||job.phase!=='setup');\n  }\n  function resumePendingSync() {\n    if(resumeBootStarted||state.syncing)return;\n    const job=loadSyncJob();if(!job)return;\n    if(job.cancelled){abandonResumableMarkers(job);clearSyncJob();return;}\n    // Do not auto-resume checkpoints whose end time is already stale; the next manual Sync starts fresh.\n    if(syncJobIsStale(job)){discardStaleSyncJob(job);setSyncProgress('Expired old sync checkpoint cleared. Press Sync for current data.');return;}\n    resumeBootStarted=true;syncAll({job,resume:true});\n  }\n"""
assert old_syncall in s
s = s.replace(old_syncall, new_syncall, 1)

script.write_text(s)

readme = Path('README.md')
r = readme.read_text()
r = r.replace('**Current version:** v0.1.22', '**Current version:** v0.1.23', 1)
r += """\n\n## v0.1.23 live-date / stale checkpoint fix\n\n- Manual Sync no longer resumes an old saved checkpoint indefinitely. A stale or date-range-mismatched checkpoint is retired safely, while rows already downloaded remain cached.\n- Fresh sync setup asks Torn's `/user/timestamp` endpoint for current server time and refreshes the live scan window before requesting logs/trades.\n- Old checkpoints are not automatically resumed on page load once their end time is stale.\n- Profit charts now append the current selected Day/Week/Month bucket at `$0` when necessary, so an up-to-date sync does not visually look two days old simply because there was no acquisition-attributed profit today.\n- The existing 72-hour User Log recheck remains enabled for delayed overseas/travel acquisition logs.\n"""
readme.write_text(r)
