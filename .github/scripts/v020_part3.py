from pathlib import Path
JS=Path('torn-trade-analyzer.user.js')
README=Path('README.md')
s=JS.read_text()
def rep(old,new,count=1):
    global s
    if old not in s: raise SystemExit('missing marker: '+old[:120])
    s=s.replace(old,new,count)

rep("state.view==='add'?addItemHtml():state.view==='settings'?settingsHtml():state.view==='ledger'?ledgerHtml():dashboardHtml()",
    "state.view==='add'?addItemHtml():state.view==='settings'?settingsHtml():state.view==='ledger'?ledgerHtml():state.view==='cash'?cashFlowHtml():state.view==='networth'?netWorthHtml():state.view==='trade'?tradeHtml():dashboardHtml()")
rep("else if(act==='back'){state.view='dashboard';state.search='';render();}", "else if(act==='back'){state.view=state.view==='ledger'?'trade':'dashboard';state.search='';render();}")
rep("else if(act==='settings'){state.view='settings';render();}", "else if(act==='settings'){state.view='settings';render();}\n      else if(act==='cashflow'){state.view='cash';render({preserveScroll:false});}\n      else if(act==='trade'){state.view='trade';render({preserveScroll:false});}\n      else if(act==='networth'){state.view='networth';render({preserveScroll:false});}\n      else if(act==='refreshFinancial'){await withBusy('Refreshing finances','Loading current Torn money and net-worth snapshots…',async()=>refreshFinancialSnapshot());render();toast('Financial snapshot refreshed.');}")
rep("      }else if(target.id==='tta-ledger-search'){", "      }else if(target.id==='tta-cash-search'){\n        state.cashSearch=target.value;save('cashSearch',state.cashSearch);clearTimeout(perfCache.searchTimer);perfCache.searchTimer=setTimeout(()=>render({preserveScroll:true}),140);\n      }else if(target.id==='tta-ledger-search'){")
rep("      if(target.dataset.ledgerFilter){", "      if(target.id==='tta-cash-category'){state.cashCategory=target.value;save('cashCategory',state.cashCategory);render({preserveScroll:true});return;}\n      if(target.dataset.ledgerFilter){")
rep("['tracked','transactions','sync','syncJob','syncCache','logTypesUpdatedAt'", "['tracked','transactions','cashFlows','financialSnapshots','sync','syncJob','syncCache','logTypesUpdatedAt'")
rep("state.tracked=[];state.transactions=[];state.pinnedIds=[];", "state.tracked=[];state.transactions=[];state.cashFlows=[];state.financialSnapshots=[];state.pinnedIds=[];")
rep("${qty(state.transactions.length)} normalized transaction entries · ${qty(state.catalog.length)} Torn items cached.", "${qty(state.transactions.length)} normalized item transactions · ${qty(state.cashFlows.length)} direct cash-flow logs · ${qty(state.financialSnapshots.length)} financial snapshots · ${qty(state.catalog.length)} Torn items cached.")
rep("else if(job.phase==='finalize'){finishResumableSync(job);break;}", "else if(job.phase==='finalize'){await refreshFinancialSnapshot();finishResumableSync(job);break;}")

r=README.read_text()
r=r.replace('# Torn Trade Analyzer','# Torn Cash Flow Analyzer',1)
r=r.replace('**Current version:** v0.1.28','**Current version:** v0.2.0',1)
r=r.replace('Torn Trade Analyzer builds a local trading/item ledger from Torn API data and turns it into profit analytics without requiring you to manually record every item.', 'Torn Cash Flow Analyzer builds a local financial ledger from Torn API data. Cash flow, spending, earnings and net worth are the primary system; the original FIFO Trade Analyzer remains available as a dedicated feature.')
r += '''\n\n## v0.2.0 — Cash Flow Analyzer\n\nThe project is now centered on financial analysis rather than only trading.\n\n- **Today overview (TCT):** earned, spent, net cash flow, and internal transfers.\n- **Cash Flow ledger:** recognized incoming/outgoing money movements with categories and searchable history.\n- **Transfers:** bank/vault/faction/company transfers are recorded but excluded from earnings/spending totals.\n- **Trade Analysis:** the original FIFO acquisition/sale/profit system remains as a separate feature.\n- **Net Worth:** current Torn-reported money, item holdings, assets and points from `/user/networth`, plus `/user/money` snapshots.\n- **Analyzer portfolio:** acquisition cost, remaining FIFO basis, current analyzer-recorded market value, unrealized gain/loss, realized profit, and acquisition-source breakdown.\n- **Player Trades:** cash-flow uses actual cash exchanged; allocated item values remain confined to trade accounting.\n\nTorn currently marks API v2 `/user/networth` as unstable. The analyzer therefore labels Torn-reported snapshots separately from locally calculated accounting history.\n'''
README.write_text(r)
JS.write_text(s)
