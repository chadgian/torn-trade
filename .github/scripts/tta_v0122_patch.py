from pathlib import Path

script_path = Path('torn-trade-analyzer.user.js')
readme_path = Path('README.md')
s = script_path.read_text()


def replace_once(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'Missing expected pattern: {label}')
    s = s.replace(old, new, 1)

replace_once('// @version      0.1.21', '// @version      0.1.22', 'metadata version')
replace_once("const VERSION = '0.1.21';", "const VERSION = '0.1.22';", 'runtime version')
replace_once(
    'Fast Torn trade analytics with spacious scrollable daily profit charts, top-anchored exact-value tooltips, acquisition-date attribution, FIFO ledger, and incremental sync. Data stays on-device.',
    'Fast Torn trade analytics with recent-log freshness recovery, spacious interactive profit charts, acquisition-date attribution, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.',
    'description'
)

replace_once(
    "  const INCREMENTAL_OVERLAP_SEC = 300;\n",
    "  const INCREMENTAL_OVERLAP_SEC = 300;\n  // Torn User Logs can appear after an earlier sync has already advanced coverage.\n  // Always recheck a recent safety window; deterministic transaction IDs make this duplicate-safe.\n  const RECENT_LOG_RECHECK_SEC = 72 * 3600;\n  const RECENT_TRADE_RECHECK_SEC = 6 * 3600;\n",
    'sync constants'
)

old_incremental = """  function incrementalPeriod(period,kind) {
    const c=ensureSyncCache(),fromKey=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',toKey=kind==='trade'?'tradeCoverageTo':'logCoverageTo';
    const rawFrom=c[fromKey],coveredFrom=rawFrom==null?NaN:Number(rawFrom),coveredTo=Number(c[toKey])||0;
    if(Number.isFinite(coveredFrom)&&coveredFrom<=period.from&&coveredTo>0){
      if(period.to<=coveredTo)return null;
      return {from:Math.max(period.from,coveredTo-INCREMENTAL_OVERLAP_SEC),to:period.to,incremental:true};
    }
    return {from:period.from,to:period.to,incremental:false};
  }
"""
new_incremental = """  function incrementalPeriod(period,kind) {
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
replace_once(old_incremental, new_incremental, 'incrementalPeriod')

replace_once(
    "    const itemKeys=new Set(['items','item','items_bought','items_sold','item_bought','item_sold','items_gained','item_gained','items_received','item_received','reward_items','reward_item','loot_items','loot_item','found_items','found_item']);",
    "    const itemKeys=new Set(['items','item','item_id','itemid','item_ids','itemids','items_bought','items_sold','item_bought','item_sold','items_gained','item_gained','items_received','item_received','reward_items','reward_item','loot_items','loot_item','found_items','found_item']);",
    'item key aliases'
)
replace_once(
    "      const id=v.id??v.item_id??v.itemId;",
    "      const id=v.id??v.item_id??v.itemId??v.itemID??v.itemid;",
    'item id aliases'
)
replace_once(
    "        else if(val && typeof val==='object' && depth<2 && /item|reward|loot|gain|receive|find|found/.test(lk)) visit(val,defaultQty,depth+1);",
    "        else if(val && typeof val==='object' && depth<3 && /item|reward|loot|gain|receive|find|found|purchase|bought|buy|sale|sold|sell|abroad|foreign|travel|market|shop/.test(lk)) visit(val,defaultQty,depth+1);",
    'nested item schema traversal'
)
replace_once(
    "    const totalKeys=['cost_total','total_cost','total','price_total','money','amount_paid','proceeds','revenue','sale_total','total_value'];",
    "    const totalKeys=['cost_total','total_cost','total','price_total','total_price','money','amount_paid','price_paid','cost_paid','proceeds','revenue','sale_total','total_value'];",
    'cash aliases'
)

replace_once(
    "    return {rawRows:0,parsedRows:0,matchedRows:0,existingRowsSkipped:0,batches,logTypes,pages:0,oldestTimestamp:0,mode,periodFrom:job.period.from,periodTo:job.period.to,tradeHeaders:0,tradeListPages:0,tradeDetails:0,tradeDetailsSkipped:0,tradesWithItems:0,tradeTransactions:0,tradeSoldQty:0,tradeBoughtQty:0,incrementalLogs:!!job.logScanPeriod?.incremental,incrementalTrades:!!job.tradeScanPeriod?.incremental};",
    "    return {rawRows:0,parsedRows:0,matchedRows:0,existingRowsSkipped:0,batches,logTypes,pages:0,oldestTimestamp:0,mode,periodFrom:job.period.from,periodTo:job.period.to,tradeHeaders:0,tradeListPages:0,tradeDetails:0,tradeDetailsSkipped:0,tradesWithItems:0,tradeTransactions:0,tradeSoldQty:0,tradeBoughtQty:0,foreignBuyRows:0,foreignBuyQty:0,recentLogRecheckHours:RECENT_LOG_RECHECK_SEC/3600,recentTradeRecheckHours:RECENT_TRADE_RECHECK_SEC/3600,incrementalLogs:!!job.logScanPeriod?.incremental,incrementalTrades:!!job.tradeScanPeriod?.incremental};",
    'diagnostics schema'
)

replace_once(
    "        const parsed=parseLogEntry(r);job.diagnostics.parsedRows+=parsed.length;job.diagnostics.matchedRows+=parsed.length;parsedRows.push(...parsed);",
    "        const parsed=parseLogEntry(r);job.diagnostics.parsedRows+=parsed.length;job.diagnostics.matchedRows+=parsed.length;for(const t of parsed){if(t.side==='buy'&&t.source==='Foreign Market'){job.diagnostics.foreignBuyRows=(Number(job.diagnostics.foreignBuyRows)||0)+1;job.diagnostics.foreignBuyQty=(Number(job.diagnostics.foreignBuyQty)||0)+(Number(t.qty)||0);}}parsedRows.push(...parsed);",
    'foreign market diagnostics'
)

replace_once(
    "    if(job.logScanPeriod){job.phase='logs-filtered';checkpointSyncJob(job,`${job.logScanPeriod.incremental?'Scanning only new/missing logs':'Establishing log baseline'} · ${dateStr(job.logScanPeriod.from)} – ${dateStr(Math.min(job.logScanPeriod.to,nowSec()))}`);}",
    "    if(job.logScanPeriod){const scanLabel=job.logScanPeriod.incremental?(job.logScanPeriod.recheck?'Refreshing recent logs + missing history':'Scanning new/missing logs'):'Establishing log baseline';job.phase='logs-filtered';checkpointSyncJob(job,`${scanLabel} · ${dateStr(job.logScanPeriod.from)} – ${dateStr(Math.min(job.logScanPeriod.to,nowSec()))}`);}",
    'freshness progress label'
)

replace_once(
    "    if(!freshCount)setSyncProgress(`Sync up to date for ${job.periodText} · ${qty(d.existingRowsSkipped||0)} existing rows skipped · ${qty(d.tradeDetailsSkipped||0)} verified trade details skipped.`);\n    else setSyncProgress(`Incremental sync complete · ${qty(freshCount)} new item rows · ${qty(d.existingRowsSkipped||0)} existing rows skipped · ${qty(d.tradeDetailsSkipped||0)} verified trades skipped · ${qty(d.tradeDetails||0)} missing trade details fetched.`);",
    "    if(!freshCount)setSyncProgress(`Sync up to date through ${dateTimeStr(state.sync.lastSync)} · recent ${qty(d.recentLogRecheckHours||72)}h User Logs refreshed · ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);\n    else setSyncProgress(`Incremental sync complete · ${qty(freshCount)} new item rows · ${qty(d.foreignBuyQty||0)} overseas-acquired item(s) seen in this scan · ${qty(d.existingRowsSkipped||0)} existing rows skipped · ${qty(d.tradeDetails||0)} missing trade details fetched.`);",
    'finish progress'
)

old_diag = "Player trades: ${qty(state.sync.diagnostics.tradesWithItems||0)} with items · ${qty(state.sync.diagnostics.tradeDetails||0)} missing details fetched · ${qty(state.sync.diagnostics.tradeDetailsSkipped||0)} already verified details skipped · ${qty(state.sync.diagnostics.tradeTransactions||0)} allocated item rows · ${qty(state.sync.diagnostics.tradeSoldQty||0)} items sold via trades.<br>Incremental cache: ${qty(state.sync.diagnostics.existingRowsSkipped||0)} existing transaction rows skipped."
new_diag = "Player trades: ${qty(state.sync.diagnostics.tradesWithItems||0)} with items · ${qty(state.sync.diagnostics.tradeDetails||0)} missing details fetched · ${qty(state.sync.diagnostics.tradeDetailsSkipped||0)} already verified details skipped · ${qty(state.sync.diagnostics.tradeTransactions||0)} allocated item rows · ${qty(state.sync.diagnostics.tradeSoldQty||0)} items sold via trades.<br>Foreign Market acquisitions in last scan: ${qty(state.sync.diagnostics.foreignBuyRows||0)} row(s) · ${qty(state.sync.diagnostics.foreignBuyQty||0)} item(s).<br>Freshness safety window: recheck recent ${qty(state.sync.diagnostics.recentLogRecheckHours||72)}h of User Logs and ${qty(state.sync.diagnostics.recentTradeRecheckHours||6)}h of Player Trades on live-period syncs.<br>Incremental cache: ${qty(state.sync.diagnostics.existingRowsSkipped||0)} existing transaction rows skipped."
replace_once(old_diag, new_diag, 'settings diagnostics')

script_path.write_text(s)

r = readme_path.read_text()
r = r.replace('**Current version:** v0.1.21', '**Current version:** v0.1.22', 1)
r = r.replace(
    '- Incremental syncing: previously known records are skipped and only missing/new data is added where possible.',
    '- Incremental syncing: previously known records are skipped while live-period syncs also recheck the most recent 72 hours of User Logs so delayed travel/market logs can be recovered.',
    1
)
r = r.replace(
    '- After historical coverage is established, routine syncs focus mainly on the interval since the last successful sync, with a small overlap for safety.',
    '- After historical coverage is established, routine live-period syncs still recheck the most recent **72 hours of User Logs** and **6 hours of Player Trades**. This deliberately catches late-visible Torn logs while deterministic transaction IDs prevent duplicate accounting.',
    1
)
r += "\n\n## v0.1.22 freshness fix\n\n- Live-period Sync now rechecks the most recent 72 hours of User Logs instead of only a five-minute overlap.\n- This is intended to recover delayed Foreign Market/travel purchases that may appear after a previous sync already advanced coverage.\n- Player Trades use a six-hour recent recheck window; already verified trade details remain skipped.\n- Foreign Market acquisition rows and quantities detected in the latest scan are shown in Settings diagnostics.\n- Item-log parsing accepts additional item/cash field aliases and nested purchase/travel structures for resilience against API schema variation.\n"
readme_path.write_text(r)

# Release guards
out = script_path.read_text()
assert '// @version      0.1.22' in out
assert "const VERSION = '0.1.22';" in out
assert 'const RECENT_LOG_RECHECK_SEC = 72 * 3600;' in out
assert 'const RECENT_TRADE_RECHECK_SEC = 6 * 3600;' in out
assert "t.side==='buy'&&t.source==='Foreign Market'" in out
assert 'Foreign Market acquisitions in last scan:' in out
assert '**Current version:** v0.1.22' in readme_path.read_text()
print('PATCH PASS: v0.1.22 recent sync + foreign acquisition recovery')
