from pathlib import Path
JS=Path('torn-trade-analyzer.user.js')
s=JS.read_text()

def rep(old,new,count=1):
    global s
    if old not in s: raise SystemExit('missing marker: '+old[:150])
    s=s.replace(old,new,count)

rep("  const SYNC_JOB_SCHEMA_VERSION = 1;", "  const SYNC_JOB_SCHEMA_VERSION = 2;")
rep("  const SYNC_CACHE_SCHEMA_VERSION = 1;", "  // v0.2.0 expands User Log scope from trade/item history to money events.\n  // Bump the schema so old trade-only day coverage cannot suppress the first cash-flow backfill.\n  const SYNC_CACHE_SCHEMA_VERSION = 2;")
marker="  function cashFlowHtml() {\n    const {from,to}=dateRange(),sum=cashFlowSummary(from,to)"
replacement="""  function cashFlowDateRange() {
    const serverNow=Math.min(Number(state.sync?.lastSync)||nowSec(),nowSec()),bounds=selectedPeriodBoundsTct(serverNow);let from=bounds.from,to=bounds.to;
    if(state.dateMode==='all'){from=Infinity;for(const x of allCashFlows()){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}if(!Number.isFinite(from))from=0;}
    return {from,to};
  }
  function cashFlowHtml() {
    const {from,to}=cashFlowDateRange(),sum=cashFlowSummary(from,to)"""
rep(marker,replacement)
rep("Purpose: personal statistical analysis of automatically discovered item acquisitions and sales.", "Purpose: personal cash-flow, spending, earnings, net-worth and trade analysis from recognized Torn financial/item activity.")
rep("${qty(state.sync.diagnostics.rawRows||0)} raw logs · ${qty(state.sync.diagnostics.pages||0)} log pages · ${qty(state.sync.diagnostics.logTypes||0)} candidate log types.", "${qty(state.sync.diagnostics.rawRows||0)} raw logs · ${qty(state.sync.diagnostics.pages||0)} log pages · ${qty(state.sync.diagnostics.logTypes||0)} candidate log types · ${qty(state.sync.diagnostics.cashFlowRows||0)} direct cash-flow rows recognized.")
JS.write_text(s)
