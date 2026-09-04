from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')


def rep(old,new,count=1):
    global s
    found=s.count(old)
    if found < count:
        raise SystemExit(f'anchor not found enough times: {old[:140]!r} found={found}')
    s=s.replace(old,new,count)

# Version.
rep('// @version      0.2.45','// @version      0.2.46')
rep("const VERSION = '0.2.45';","const VERSION = '0.2.46';")

# Sync-cache v4: do not consider a canonical playerTrades event alone proof that
# the FIFO transaction rows were written. Also use practical foreground/background
# safety windows so delayed Torn API rows are revisited without making every
# one-minute background sync scan hours of history.
old_constants="""  const SYNC_CACHE_SCHEMA_VERSION = 3;
  const INCREMENTAL_OVERLAP_SEC = 300;
  // Torn User Logs can appear after an earlier sync has already advanced coverage.
  // Always recheck a recent safety window; deterministic transaction IDs make this duplicate-safe.
  const RECENT_LOG_RECHECK_SEC = 72 * 3600;
  const RECENT_TRADE_RECHECK_SEC = 6 * 3600;
  const STALE_SYNC_JOB_SEC = 5 * 60;
"""
new_constants="""  const SYNC_CACHE_SCHEMA_VERSION = 4;
  const INCREMENTAL_OVERLAP_SEC = 300;
  // Torn User Logs and finished Player Trades can become visible after a sync has
  // already advanced lastSync. Foreground Quick Sync uses a wider repair window;
  // the one-minute background sync uses a small overlap to stay lightweight.
  const RECENT_LOG_RECHECK_SEC = 6 * 3600;
  const RECENT_TRADE_RECHECK_SEC = 24 * 3600;
  const BACKGROUND_LOG_RECHECK_SEC = 15 * 60;
  const BACKGROUND_TRADE_RECHECK_SEC = 60 * 60;
  const STALE_SYNC_JOB_SEC = 5 * 60;
"""
rep(old_constants,new_constants)

# A Net Worth-only canonical trade row must not suppress re-fetching the detailed
# trade if the FIFO buy/sell rows were never persisted.
rep("    for(const t of state.playerTrades||[]){const id=Number(t?.tradeId)||0;if(id>0&&!c.verifiedTrades[id]){c.verifiedTrades[id]=Number(t.timestamp)||1;seeded=true;}}\n","")

# Existing deterministic transaction IDs may need corrected values after a delayed
# or previously incomplete API response. Upsert changed rows instead of skipping
# them forever. Existing-row corrections are not tagged as newly discovered rows.
pat=r"  function checkpointTransactionRows\(job,rows\) \{.*?\n  \}\n  function finalizeResumableTransactions\(job\) \{"
new="""  function checkpointTransactionRows(job,rows) {
    if(!rows?.length)return 0;
    if(!resumableTxMap||resumableTxJob!==job.id){
      resumableTxMap=new Map((state.transactions||[]).filter(Boolean).map(x=>[String(x.id),x]));
      resumableTxJob=job.id;
    }
    let added=0,updated=0,changed=false;
    for(const row of rows){
      if(row?.id==null)continue;const key=String(row.id),prev=resumableTxMap.get(key);
      if(prev){
        const clean={...prev};delete clean.syncRunId;
        if(JSON.stringify(clean)===JSON.stringify(row)){if(job.diagnostics)job.diagnostics.existingRowsSkipped=(Number(job.diagnostics.existingRowsSkipped)||0)+1;continue;}
        resumableTxMap.set(key,{...row});updated++;changed=true;continue;
      }
      resumableTxMap.set(key,{...row,syncRunId:job.id});added++;changed=true;
    }
    if(job.diagnostics&&updated)job.diagnostics.transactionRowsUpdated=(Number(job.diagnostics.transactionRowsUpdated)||0)+updated;
    if(!changed)return 0;
    const next=[...resumableTxMap.values()];localStorage.setItem(NS+'transactions',JSON.stringify(next));state.transactions=next;return added;
  }
  function finalizeResumableTransactions(job) {"""
s,n=re.subn(pat,lambda m:new,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'checkpointTransactionRows replace failed {n}')

# Finished-trade details are authoritative for FIFO. Do not mark a trade verified
# when detailed items are empty/not ready or when Item rows did not fully parse.
# Such trades are deferred and become eligible again on the next recent-window scan.
pat=r"  async function runResumableTradeDetails\(job\) \{.*?\n  \}\n  async function refreshLiveSyncBounds\(job\) \{"
new="""  async function runResumableTradeDetails(job) {
    const headers=job.tradeHeaders||[];
    while((Number(job.tradeDetailIndex)||0)<headers.length&&!syncJobCancelled(job)){
      const i=Number(job.tradeDetailIndex)||0,h=headers[i];
      if(isTradeVerified(job,h.id)){
        job.diagnostics.tradeDetailsSkipped=(Number(job.diagnostics.tradeDetailsSkipped)||0)+1;job.tradeDetailIndex=i+1;
        checkpointSyncJob(job,`Player trades \\u00B7 ${i+1}/${headers.length} \\u00B7 already verified, skipped`);continue;
      }
      checkpointSyncJob(job,`Player trades \\u00B7 ${i+1}/${headers.length} \\u00B7 fetching missing detailed trade #${Number(h.id)}`);
      const data=await syncApiGet(`/user/${Number(h.id)}/trade`);job.diagnostics.tradeDetails=(Number(job.diagnostics.tradeDetails)||0)+1;
      const trade=data?.trade,detailEntries=Array.isArray(trade?.items)?trade.items:[];
      const tradeEvent=parsePlayerTradeEvent(trade,job.userId),rows=parsePlayerTrade(trade,job.userId);
      const rawItemEntries=detailEntries.filter(x=>String(x?.type||'').toLowerCase()==='item');
      const expectedItemQty=rawItemEntries.reduce((n,x)=>n+Math.max(0,Number(x?.details?.amount)||0),0);
      const parsedItemQty=rows.reduce((n,x)=>n+Math.max(0,Number(x?.qty)||0),0);
      const itemParseComplete=expectedItemQty<=0||Math.abs(parsedItemQty-expectedItemQty)<1e-7;
      const detailReady=detailEntries.length>0||!!tradeEvent||rows.length>0;
      if(!detailReady||!itemParseComplete||(rawItemEntries.length>0&&!rows.length)){
        job.diagnostics.tradeDetailsDeferred=(Number(job.diagnostics.tradeDetailsDeferred)||0)+1;job.tradeDetailIndex=i+1;
        const why=!detailReady?'detail payload not ready':'item rows incomplete';
        checkpointSyncJob(job,`Player trades \\u00B7 ${i+1}/${headers.length} \\u00B7 ${why}; deferred for the next sync`);
        if(job.tradeDetailIndex<headers.length&&!syncJobCancelled(job))await sleep(REQUEST_GAP_MS);
        continue;
      }
      if(tradeEvent){checkpointPlayerTradeEvents([tradeEvent]);job.diagnostics.playerTradeEvents=(Number(job.diagnostics.playerTradeEvents)||0)+1;}
      const soldRows=rows.filter(x=>x.side==='sell'),boughtRows=rows.filter(x=>x.side==='buy');
      if(rows.length){
        job.diagnostics.tradesWithItems=(Number(job.diagnostics.tradesWithItems)||0)+1;
        job.diagnostics.tradeTransactions=(Number(job.diagnostics.tradeTransactions)||0)+rows.length;
        job.diagnostics.tradeSoldQty=(Number(job.diagnostics.tradeSoldQty)||0)+soldRows.reduce((n,x)=>n+(Number(x.qty)||0),0);
        job.diagnostics.tradeBoughtQty=(Number(job.diagnostics.tradeBoughtQty)||0)+boughtRows.reduce((n,x)=>n+(Number(x.qty)||0),0);
        checkpointTransactionRows(job,rows);
      }
      markTradeVerified(job,h.id,h.completed_at);job.tradeDetailIndex=i+1;checkpointSyncJob(job,`Player trades \\u00B7 ${i+1}/${headers.length} \\u00B7 detail verified and FIFO rows cached`);
      if(job.tradeDetailIndex<headers.length&&!syncJobCancelled(job))await sleep(REQUEST_GAP_MS);
    }
    if(!syncJobCancelled(job)){job.phase='finalize';checkpointSyncJob(job,'Finalizing cached history and FIFO inputs\\u2026');return true;}return false;
  }
  async function refreshLiveSyncBounds(job) {"""
s,n=re.subn(pat,lambda m:new,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'runResumableTradeDetails replace failed {n}')

# Actually apply the recent safety windows. The previous implementation declared
# them but set both scan periods to lastSync -> now, so delayed sales could be lost.
pat=r"  async function refreshLiveSyncBounds\(job\) \{.*?\n  \}\n  async function prepareResumableSync\(job\) \{"
new="""  async function refreshLiveSyncBounds(job) {
    let serverNow=nowSec();
    try{const t=await apiGet('/user/timestamp');serverNow=Number(t?.timestamp)||serverNow;}catch(_){}
    const mode=job.syncMode==='full'?'full':'quick',last=Number(state.sync?.lastSync)||0,fallback=tctDayStart(serverNow);
    const logWindow=job.background?BACKGROUND_LOG_RECHECK_SEC:RECENT_LOG_RECHECK_SEC,tradeWindow=job.background?BACKGROUND_TRADE_RECHECK_SEC:RECENT_TRADE_RECHECK_SEC;
    const logFrom=mode==='full'?0:(last>0?Math.max(0,Math.min(last,serverNow-logWindow)):fallback);
    const tradeFrom=mode==='full'?0:(last>0?Math.max(0,Math.min(last,serverNow-tradeWindow)):fallback);
    const from=Math.min(logFrom,tradeFrom);
    job.tctNow=serverNow;job.tctNowLabel=tctDateTimeStr(serverNow);
    job.period={from,to:serverNow};
    job.periodText=mode==='full'?'all available history':`${tctDateTimeStr(from)} \\u2013 ${tctDateTimeStr(serverNow)} TCT`;
    job.logScanPeriod={from:logFrom,to:serverNow,incremental:mode==='quick',recheck:mode==='quick'&&last>0,missingDays:0};
    job.tradeScanPeriod={from:tradeFrom,to:serverNow,incremental:mode==='quick',recheck:mode==='quick'&&last>0,missingDays:0};
    job.logCursorTo=serverNow;job.tradeListParams=null;
  }
  async function prepareResumableSync(job) {"""
s,n=re.subn(pat,lambda m:new,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'refreshLiveSyncBounds replace failed {n}')

# Update settings fallback wording for upgraded diagnostics.
rep("recentLogRecheckHours||72","recentLogRecheckHours||6")
rep("recentTradeRecheckHours||6","recentTradeRecheckHours||24")

# Guardrails.
required=[
    "// @version      0.2.46",
    "const VERSION = '0.2.46';",
    "const SYNC_CACHE_SCHEMA_VERSION = 4;",
    "const BACKGROUND_LOG_RECHECK_SEC = 15 * 60;",
    "const BACKGROUND_TRADE_RECHECK_SEC = 60 * 60;",
    "transactionRowsUpdated",
    "tradeDetailsDeferred",
    "detail verified and FIFO rows cached",
    "job.logScanPeriod={from:logFrom",
    "job.tradeScanPeriod={from:tradeFrom",
]
for needle in required:
    if needle not in s: raise SystemExit(f'missing required output: {needle}')
if "for(const t of state.playerTrades||[]){const id=Number(t?.tradeId)||0;if(id>0&&!c.verifiedTrades[id])" in s:
    raise SystemExit('playerTrades still seeds verifiedTrades cache')
s.encode('ascii')
p.write_text(s,encoding='ascii')
print('v0.2.46 trade-profit repair applied')
