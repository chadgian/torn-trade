from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.1.25','// @version      0.1.26',1)
s=s.replace('// @description  Fast Torn trade analytics with continuous TCT timelines, TCT day-gap recovery, current-server sync bounds, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.','// @description  Fast Torn trade analytics with dedicated abroad-buy verification, continuous TCT timelines, gap recovery, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.',1)
s=s.replace("const VERSION = '0.1.25';","const VERSION = '0.1.26';",1)
s=s.replace('const MAX_LOG_IDS_PER_REQUEST = 24;','const MAX_LOG_IDS_PER_REQUEST = 10;',1)

old="""  function newSyncDiagnostics(job,mode,logTypes,batches) {
    return {rawRows:0,parsedRows:0,matchedRows:0,existingRowsSkipped:0,batches,logTypes,pages:0,oldestTimestamp:0,mode,periodFrom:job.period.from,periodTo:job.period.to,tradeHeaders:0,tradeListPages:0,tradeDetails:0,tradeDetailsSkipped:0,tradesWithItems:0,tradeTransactions:0,tradeSoldQty:0,tradeBoughtQty:0,foreignBuyRows:0,foreignBuyQty:0,recentLogRecheckHours:RECENT_LOG_RECHECK_SEC/3600,recentTradeRecheckHours:RECENT_TRADE_RECHECK_SEC/3600,tctNow:Number(job.tctNow)||0,missingLogDays:Number(job.logScanPeriod?.missingDays)||0,missingTradeDays:Number(job.tradeScanPeriod?.missingDays)||0,incrementalLogs:!!job.logScanPeriod?.incremental,incrementalTrades:!!job.tradeScanPeriod?.incremental};
  }
"""
new="""  function newSyncDiagnostics(job,mode,logTypes,batches) {
    return {rawRows:0,parsedRows:0,matchedRows:0,existingRowsSkipped:0,batches,logTypes,pages:0,oldestTimestamp:0,latestRawLogTimestamp:0,latestParsedAcquisitionTimestamp:0,mode,periodFrom:job.period.from,periodTo:job.period.to,tradeHeaders:0,tradeListPages:0,tradeDetails:0,tradeDetailsSkipped:0,tradesWithItems:0,tradeTransactions:0,tradeSoldQty:0,tradeBoughtQty:0,foreignBuyRows:0,foreignBuyQty:0,abroadVerifyPages:0,abroadVerifyRawRows:0,abroadVerifyParsedRows:0,abroadVerifyQty:0,abroadVerifyLatestRawTimestamp:0,recentLogRecheckHours:RECENT_LOG_RECHECK_SEC/3600,recentTradeRecheckHours:RECENT_TRADE_RECHECK_SEC/3600,tctNow:Number(job.tctNow)||0,missingLogDays:Number(job.logScanPeriod?.missingDays)||0,missingTradeDays:Number(job.tradeScanPeriod?.missingDays)||0,incrementalLogs:!!job.logScanPeriod?.incremental,incrementalTrades:!!job.tradeScanPeriod?.incremental};
  }
"""
if old not in s: raise SystemExit('diagnostics block not found')
s=s.replace(old,new,1)

old="""      for(const r of rows){
        const ts=Number(r?.timestamp)||0;if(ts<scanPeriod.from||ts>scanPeriod.to)continue;
        const parsed=parseLogEntry(r);job.diagnostics.parsedRows+=parsed.length;job.diagnostics.matchedRows+=parsed.length;for(const t of parsed){if(t.side==='buy'&&t.source==='Foreign Market'){job.diagnostics.foreignBuyRows=(Number(job.diagnostics.foreignBuyRows)||0)+1;job.diagnostics.foreignBuyQty=(Number(job.diagnostics.foreignBuyQty)||0)+(Number(t.qty)||0);}}parsedRows.push(...parsed);
      }
"""
new="""      for(const r of rows){
        const ts=Number(r?.timestamp)||0;if(ts<scanPeriod.from||ts>scanPeriod.to)continue;
        if(ts>Number(job.diagnostics.latestRawLogTimestamp||0))job.diagnostics.latestRawLogTimestamp=ts;
        const parsed=parseLogEntry(r);job.diagnostics.parsedRows+=parsed.length;job.diagnostics.matchedRows+=parsed.length;for(const t of parsed){if(t.side==='buy'){job.diagnostics.latestParsedAcquisitionTimestamp=Math.max(Number(job.diagnostics.latestParsedAcquisitionTimestamp)||0,Number(t.timestamp)||0);}if(t.side==='buy'&&t.source==='Foreign Market'){job.diagnostics.foreignBuyRows=(Number(job.diagnostics.foreignBuyRows)||0)+1;job.diagnostics.foreignBuyQty=(Number(job.diagnostics.foreignBuyQty)||0)+(Number(t.qty)||0);}}parsedRows.push(...parsed);
      }
"""
if old not in s: raise SystemExit('regular log parse block not found')
s=s.replace(old,new,1)

anchor="""  function compactTradeHeader(row) {
"""
insert="""  async function runAbroadBuyVerification(job) {
    const serverNow=Number(job.tctNow)||nowSec();
    const verifyFrom=Number(job.period?.from)>0?Number(job.period.from):Math.max(0,serverNow-30*86400);
    const verifyTo=Math.min(Number(job.period?.to)||serverNow,serverNow);
    if(!(verifyTo>=verifyFrom)){job.phase='trades-list';checkpointSyncJob(job,'Abroad Buy verification skipped · no overlapping selected period.');return true;}
    let cursor=verifyTo,page=0,previousSignature='';
    while(!syncJobCancelled(job)){
      page++;checkpointSyncJob(job,`Abroad Buy verification · page ${page} · ${tctDateStr(verifyFrom)} – ${tctDateStr(Math.min(cursor,serverNow))} TCT`);
      const data=await syncApiGet('/user/log',{limit:100,log:'4201',from:verifyFrom,to:cursor}),rows=Array.isArray(data?.log)?data.log:[];
      job.diagnostics.abroadVerifyPages=(Number(job.diagnostics.abroadVerifyPages)||0)+1;
      job.diagnostics.abroadVerifyRawRows=(Number(job.diagnostics.abroadVerifyRawRows)||0)+rows.length;
      if(!rows.length)break;
      const parsedRows=[];
      for(const r of rows){
        const ts=Number(r?.timestamp)||0;if(ts<verifyFrom||ts>verifyTo)continue;
        job.diagnostics.abroadVerifyLatestRawTimestamp=Math.max(Number(job.diagnostics.abroadVerifyLatestRawTimestamp)||0,ts);
        job.diagnostics.latestRawLogTimestamp=Math.max(Number(job.diagnostics.latestRawLogTimestamp)||0,ts);
        const parsed=parseLogEntry(r).filter(t=>t.side==='buy'&&t.source==='Foreign Market');
        for(const t of parsed){
          job.diagnostics.abroadVerifyParsedRows=(Number(job.diagnostics.abroadVerifyParsedRows)||0)+1;
          job.diagnostics.abroadVerifyQty=(Number(job.diagnostics.abroadVerifyQty)||0)+(Number(t.qty)||0);
          job.diagnostics.latestParsedAcquisitionTimestamp=Math.max(Number(job.diagnostics.latestParsedAcquisitionTimestamp)||0,Number(t.timestamp)||0);
        }
        parsedRows.push(...parsed);
      }
      checkpointTransactionRows(job,parsedRows);
      const timestamps=rows.map(r=>Number(r?.timestamp)).filter(Number.isFinite);if(!timestamps.length)break;
      const oldest=Math.min(...timestamps),signature=rows.map(rawLogKey).join('|');
      if(oldest<=verifyFrom)break;
      let nextTo=oldest;if(signature===previousSignature)nextTo=oldest-1;
      if(!Number.isFinite(nextTo)||nextTo>=cursor)break;
      previousSignature=signature;cursor=nextTo;await sleep(REQUEST_GAP_MS);
    }
    job.phase='trades-list';checkpointSyncJob(job,`Abroad Buy verification complete · ${qty(job.diagnostics.abroadVerifyRawRows||0)} raw 4201 logs · ${qty(job.diagnostics.abroadVerifyQty||0)} overseas item(s) parsed.`);return true;
  }

  function compactTradeHeader(row) {
"""
if anchor not in s: raise SystemExit('compactTradeHeader anchor not found')
s=s.replace(anchor,insert,1)

s=s.replace("else{job.phase='trades-list';checkpointSyncJob(job,`Checking only missing player trades for ${job.periodText}…`);}","else{job.phase='logs-abroad-verify';checkpointSyncJob(job,'Verifying Foreign/Abroad Buy logs independently…');}",1)
s=s.replace("else if(job.phase==='logs-fallback'){await runResumableLogPhase(job,'unfiltered');if(syncJobCancelled(job))break;job.phase='trades-list';checkpointSyncJob(job,`Checking only missing player trades for ${job.periodText}…`);}","else if(job.phase==='logs-fallback'){await runResumableLogPhase(job,'unfiltered');if(syncJobCancelled(job))break;job.phase='logs-abroad-verify';checkpointSyncJob(job,'Verifying Foreign/Abroad Buy logs independently…');}\n        else if(job.phase==='logs-abroad-verify')await runAbroadBuyVerification(job);",1)

oldset="""<br>Foreign Market acquisitions in last scan: ${qty(state.sync.diagnostics.foreignBuyRows||0)} row(s) · ${qty(state.sync.diagnostics.foreignBuyQty||0)} item(s).<br>Freshness safety window:"""
newset="""<br>Foreign Market acquisitions in mixed scan: ${qty(state.sync.diagnostics.foreignBuyRows||0)} row(s) · ${qty(state.sync.diagnostics.foreignBuyQty||0)} item(s).<br>Dedicated Abroad Buy (4201) verification: ${qty(state.sync.diagnostics.abroadVerifyRawRows||0)} raw log(s) · ${qty(state.sync.diagnostics.abroadVerifyParsedRows||0)} parsed row(s) · ${qty(state.sync.diagnostics.abroadVerifyQty||0)} item(s).${state.sync.diagnostics.abroadVerifyLatestRawTimestamp?`<br>Latest raw Abroad Buy log: ${esc(tctDateTimeStr(state.sync.diagnostics.abroadVerifyLatestRawTimestamp))} TCT.`:''}${state.sync.diagnostics.latestParsedAcquisitionTimestamp?`<br>Latest parsed acquisition: ${esc(tctDateTimeStr(state.sync.diagnostics.latestParsedAcquisitionTimestamp))} TCT.`:''}<br>Freshness safety window:"""
if oldset not in s: raise SystemExit('settings foreign diagnostics anchor not found')
s=s.replace(oldset,newset,1)

p.write_text(s)

r=Path('README.md');rs=r.read_text();rs=rs.replace('**Current version:** v0.1.25','**Current version:** v0.1.26',1)
rs += "\n\n## v0.1.26 abroad acquisition verification\n\n- User Log filtering is split into batches of at most 10 log IDs.\n- Every Sync performs an independent `4201` (Item abroad Buy) verification pass, so Foreign Market acquisitions do not depend on a larger mixed-log filter batch.\n- The dedicated verification uses the selected finite period; for All History it checks the latest 30 days to keep routine API usage bounded.\n- Settings diagnostics show raw 4201 rows, parsed rows/items, the latest raw Abroad Buy timestamp, and the latest parsed acquisition timestamp.\n- Existing transaction IDs remain duplicate-safe, so the dedicated verification can recover missing purchases without double-counting rows already stored.\n"
r.write_text(rs)
