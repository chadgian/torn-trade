from pathlib import Path
JS=Path('torn-trade-analyzer.user.js')
README=Path('README.md')
s=JS.read_text()

def rep(old,new,count=1):
    global s
    if old not in s:
        raise SystemExit('missing marker: '+old[:150])
    s=s.replace(old,new,count)

rep("    if(state.view!=='dashboard')return;", "    if(state.view!=='trade')return;")
rep("    if(state.dateMode==='all'&&allTx.length){from=Infinity;for(const x of allTx){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}if(!Number.isFinite(from))from=0;}",
    "    if(state.dateMode==='all'){from=Infinity;for(const x of allTx){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}for(const x of state.cashFlows||[]){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}if(!Number.isFinite(from))from=0;}")
rep("root.innerHTML='<div class=\"tta-openloader\"><div><span class=\"tta-spinner xl\"></span><strong>Opening Trade Analyzer</strong><small>Preparing cached history and analytics…</small></div></div>';",
    "root.innerHTML='<div class=\"tta-openloader\"><div><span class=\"tta-spinner xl\"></span><strong>Opening Cash Flow Analyzer</strong><small>Preparing cached financial history and analytics…</small></div></div>';" )
rep("aria-label=\"Close trade analyzer\"", "aria-label=\"Close cash flow analyzer\"")
rep("confirm('Reset all Torn Trade Analyzer discovered item history and local transaction data?')", "confirm('Reset all Torn Cash Flow Analyzer financial history, trade history and local snapshots?')")
rep("    state.view='dashboard';state.search='';state.demo=false;render();toast(`${x.name} added. Sync to analyze its history.`);",
    "    state.view='trade';state.search='';state.demo=false;render();toast(`${x.name} added. Sync to analyze its history.`);")
rep("if(/deposit/.test(s)&&/(bank|vault|faction|company|cayman)/.test(s))return 'transfer-out';",
    "if(/deposit/.test(s)&&/(bank|vault|faction|company|cayman|piggy|property)/.test(s))return 'transfer-out';")
rep("if(/withdraw/.test(s)&&/(bank|vault|faction|company|cayman)/.test(s))return 'transfer-in';",
    "if(/withdraw/.test(s)&&/(bank|vault|faction|company|cayman|piggy|property)/.test(s))return 'transfer-in';")
rep("if(direction?.startsWith('transfer'))return /faction/.test(s)?'Faction Transfer':/company/.test(s)?'Company Transfer':/cayman|bank/.test(s)?'Bank Transfer':'Internal Transfer';",
    "if(direction?.startsWith('transfer'))return /faction/.test(s)?'Faction Transfer':/company/.test(s)?'Company Transfer':/property|vault/.test(s)?'Property / Vault Transfer':/piggy/.test(s)?'Piggy Bank Transfer':/cayman|bank/.test(s)?'Bank Transfer':'Internal Transfer';")
old="""<div class=\"tta-cashhero\"><div class=\"tta-cashcard\"><small>Torn item holdings</small><b>${nw?money(itemTotal):'—'}</b></div><div class=\"tta-cashcard\"><small>Torn assets</small><b>${nw?money(assetTotal):'—'}</b></div><div class=\"tta-cashcard main\"><small>Points value</small><b>${nw?money(nw.points):'—'}</b></div></div><div class=\"tta-fin-section\"><h3>Money locations / liabilities</h3>${nw?moneyBreakdownHtml(nw.money):'<div class=\"tta-empty\">No Torn net-worth snapshot loaded.</div>'}</div>"""
new="""<div class=\"tta-cashhero\"><div class=\"tta-cashcard\"><small>Torn item holdings</small><b>${nw?money(itemTotal):'—'}</b></div><div class=\"tta-cashcard\"><small>Torn assets</small><b>${nw?money(assetTotal):'—'}</b></div><div class=\"tta-cashcard main\"><small>Points value</small><b>${nw?money(nw.points):'—'}</b></div></div><div class=\"tta-fin-section\"><h3>Current wealth locations · stable /user/money</h3>${snap?.money?moneyBreakdownHtml(snap.money):'<div class=\"tta-empty\">No current wealth snapshot loaded.</div>'}<div class=\"tta-snapshot-note\">This section uses Torn's stable current-wealth endpoint and is kept separate from income/spending history.</div></div><div class=\"tta-fin-section\"><h3>Net-worth money locations / liabilities</h3>${nw?moneyBreakdownHtml(nw.money):'<div class=\"tta-empty\">No Torn net-worth snapshot loaded.</div>'}</div>"""
rep(old,new)

r=README.read_text()
r=r.replace('A Torn userscript focused on automatic item acquisition/sale history, FIFO profit analysis, player trades, and mobile-friendly analytics for Torn PDA.',
            'A Torn PDA-friendly financial analytics userscript centered on cash flow, spending, earnings and net worth, with the original FIFO Trade Analyzer retained as a dedicated feature.',1)
README.write_text(r)
JS.write_text(s)
