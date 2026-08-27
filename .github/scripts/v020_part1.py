from pathlib import Path

JS=Path('torn-trade-analyzer.user.js')
README=Path('README.md')
s=JS.read_text()

def rep(old,new,count=1):
    global s
    if old not in s:
        raise SystemExit('missing marker: '+old[:120])
    s=s.replace(old,new,count)

rep('// @name         Torn Trade Analyzer','// @name         Torn Cash Flow Analyzer')
rep('// @version      0.1.28','// @version      0.2.0')
rep('// @description  Fast Torn trade analytics with a cyber terminal/data-pulse launcher, 7/14/30-day presets, dedicated abroad-buy verification, continuous TCT timelines, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.',
    '// @description  Torn cash-flow, spending, earnings, net-worth and trade analytics with FIFO profit tracking. Data stays on-device.')
rep("const VERSION = '0.1.28';","const VERSION = '0.2.0';")
rep("    transactions: load('transactions', []),", "    transactions: load('transactions', []),\n    cashFlows: load('cashFlows', []),\n    financialSnapshots: load('financialSnapshots', []),\n    cashSearch: load('cashSearch', ''),\n    cashCategory: load('cashCategory', 'all'),")
rep("fab.setAttribute('aria-label',syncing?'Trade Analytics syncing':'Trade Analytics');", "fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Cash Flow Analyzer');")
rep("fab.title=syncing?'Trade history sync is running · tap to reopen':'Open Trade Analytics';", "fab.title=syncing?'Financial history sync is running · tap to reopen':'Open Cash Flow Analyzer';")

rep("    if(state.ledgerRange==='30d')return {from:Math.floor((now-30*86400e3)/1000),to:Math.floor(now/1000)+60};\n    if(state.ledgerRange==='month')return {from:Math.floor(subtractCalendarMonth(new Date(now)).getTime()/1000),to:Math.floor(now/1000)+60};",
    "    if(state.ledgerRange==='14d')return {from:Math.floor((now-14*86400e3)/1000),to:Math.floor(now/1000)+60};\n    if(state.ledgerRange==='30d')return {from:Math.floor((now-30*86400e3)/1000),to:Math.floor(now/1000)+60};")
rep('<option value="7d" ${state.ledgerRange===\'7d\'?\'selected\':\'\'}>Last 7 days</option><option value="30d" ${state.ledgerRange===\'30d\'?\'selected\':\'\'}>Last 30 days</option><option value="month" ${state.ledgerRange===\'month\'?\'selected\':\'\'}>Last 1 month</option><option value="dashboard"',
    '<option value="7d" ${state.ledgerRange===\'7d\'?\'selected\':\'\'}>Last 7 days</option><option value="14d" ${state.ledgerRange===\'14d\'?\'selected\':\'\'}>Last 14 days</option><option value="30d" ${state.ledgerRange===\'30d\'?\'selected\':\'\'}>Last 30 days</option><option value="dashboard"')

rep('  function dashboardHtml() {','  function tradeHtml() {')
rep("return `${header('Trade Analyzer', `v${VERSION} · optimized FIFO analytics`)}<div class=\"tta-content\">",
    "return `${header('Trade Analysis', `v${VERSION} · FIFO item analytics`,true)}<div class=\"tta-content\">",1)

css_marker='      .tta-loading{position:fixed;inset:0;z-index:2147483001;'
css_add=r'''      .tta-fin-nav{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.tta-fin-nav .tta-btn{min-height:44px;padding:8px 7px}.tta-fin-nav .tta-btn strong{display:block;font-size:10px}.tta-fin-nav .tta-btn small{display:block;font-size:8px;margin-top:2px;opacity:.72}
      .tta-cashhero{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 13px}.tta-cashcard{background:linear-gradient(180deg,#151f2a,#10171f);border:1px solid var(--tta-line);border-radius:14px;padding:11px;text-align:center;min-width:0}.tta-cashcard small{display:block;color:var(--tta-muted);font-size:9px;text-transform:uppercase;letter-spacing:.55px}.tta-cashcard b{display:block;margin-top:5px;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tta-cashcard.main{grid-column:auto}.tta-transfer{color:var(--tta-blue)!important}
      .tta-fin-section{background:#111922;border:1px solid var(--tta-line);border-radius:14px;padding:12px;margin:11px 0}.tta-fin-section h3{margin:0 0 9px;font-size:13px}.tta-fin-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.tta-fin-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #263746;font-size:10px}.tta-fin-row:last-child{border-bottom:0}.tta-fin-row span{color:var(--tta-muted)}.tta-fin-row b{text-align:right;color:var(--tta-text)}
      .tta-flowtable{width:100%;border-collapse:collapse;font-size:10px}.tta-flowtable th{text-align:left;color:var(--tta-muted);font-size:9px;padding:8px 6px;border-bottom:1px solid var(--tta-line)}.tta-flowtable td{padding:9px 6px;border-bottom:1px solid #263746;vertical-align:top}.tta-flowtable td.num{text-align:right;white-space:nowrap}.tta-flowtitle{font-weight:800;color:var(--tta-text)}.tta-flowmeta{display:block;color:var(--tta-faint);font-size:8.5px;margin-top:2px}.tta-flowbadge{display:inline-flex;padding:3px 6px;border-radius:999px;border:1px solid var(--tta-line);font-size:8px;font-weight:800}.tta-flowbadge.in{color:var(--tta-green);border-color:#315c4d;background:#11261f}.tta-flowbadge.out{color:var(--tta-red);border-color:#69404a;background:#27181d}.tta-flowbadge.transfer{color:var(--tta-blue);border-color:#36556d;background:#132331}
      .tta-breakdown{display:grid;gap:5px}.tta-breakrow{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:7px 8px;border:1px solid #293c4c;border-radius:9px;background:#0e161e;font-size:9.5px}.tta-breakrow span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tta-breakrow b{font-variant-numeric:tabular-nums}.tta-networth-total{font-size:26px!important}.tta-snapshot-note{font-size:9px;color:var(--tta-faint);line-height:1.45;margin-top:7px}
      @media(max-width:420px){.tta-fin-nav{grid-template-columns:1fr}.tta-cashhero{grid-template-columns:1fr 1fr}.tta-cashcard.main{grid-column:1/-1}.tta-fin-grid{grid-template-columns:1fr}.tta-breakrow{grid-template-columns:minmax(0,1fr) auto}.tta-breakrow .secondary-value{display:none}}
'''
rep(css_marker,css_add+css_marker)

parse_marker='  function tradeItemGroups(entries,userId,outgoing=true) {'
parse_add=r'''  function financialTitleContext(title) {
    return /(money|cash|bank|vault|wage|salary|pay|payment|deposit|withdraw|interest|dividend|casino|bookie|lottery|stock|share|bounty|rent|loan|fee|tax|rehab|travel|property|company|faction|donat|mug|points|award|reward|income|expense|cost|profit|loss)/i.test(String(title||''));
  }
  function flattenNumericFields(value,path='',out=[],depth=0) {
    if(value==null||depth>7)return out;
    if(typeof value==='number'&&Number.isFinite(value)){out.push({path:path.toLowerCase(),value});return out;}
    if(typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)){out.push({path:path.toLowerCase(),value:Number(value)});return out;}
    if(Array.isArray(value)){value.forEach((v,i)=>flattenNumericFields(v,`${path}.${i}`,out,depth+1));return out;}
    if(typeof value==='object')Object.entries(value).forEach(([k,v])=>flattenNumericFields(v,path?`${path}.${k}`:k,out,depth+1));
    return out;
  }
  function bestMoneyField(payload,title) {
    const rows=flattenNumericFields(payload),financial=financialTitleContext(title),bad=/(^|\.)(id|item_id|itemid|qty|quantity|count|timestamp|time|duration|rate|percent|percentage|balance|maximum|current|points)(\.|$)/i;
    let best=null;
    for(const row of rows){
      if(bad.test(row.path)||!Number.isFinite(row.value)||row.value===0)continue;
      let score=0;
      if(/money|cash/.test(row.path))score+=12;
      if(/received|gained|earned|winnings|payout|salary|wage|interest|dividend|reward|profit/.test(row.path))score+=10;
      if(/spent|paid|payment|cost|price|fee|tax|loss|lost|expense|bounty|loan/.test(row.path))score+=9;
      if(/amount|total|value/.test(row.path)&&financial)score+=4;
      if(score>0&&(!best||score>best.score||(score===best.score&&Math.abs(row.value)>Math.abs(best.value))))best={...row,score};
    }
    return best;
  }
  function cashFlowDirection(title,path='') {
    const s=`${title} ${path}`.toLowerCase();
    if(/deposit/.test(s)&&/(bank|vault|faction|company|cayman)/.test(s))return 'transfer-out';
    if(/withdraw/.test(s)&&/(bank|vault|faction|company|cayman)/.test(s))return 'transfer-in';
    if(/money_lost|cash_spent|spent|cost|fee|tax|expense|loss|lost|paid|payment|purchase|bought|buy|rehab|rent|donat|bounty placed|loan repayment/.test(s))return 'out';
    if(/money_gained|money_received|cash_received|received|gained|earned|income|wage|salary|interest|dividend|winnings|payout|reward|profit|sold|sale|win|won/.test(s))return 'in';
    if(/mugged/.test(s))return 'out';
    if(/mug/.test(s))return 'in';
    return null;
  }
  function cashFlowCategory(title,direction) {
    const s=String(title||'').toLowerCase();
    if(direction?.startsWith('transfer'))return /faction/.test(s)?'Faction Transfer':/company/.test(s)?'Company Transfer':/cayman|bank/.test(s)?'Bank Transfer':'Internal Transfer';
    if(/casino|bookie|lottery|roulette|poker|blackjack|slots/.test(s))return 'Gambling';
    if(/stock|share|dividend/.test(s))return 'Stocks / Investing';
    if(/property|rent|upkeep/.test(s))return 'Property';
    if(/travel|flight/.test(s))return 'Travel';
    if(/rehab/.test(s))return 'Rehab';
    if(/education|course/.test(s))return 'Education';
    if(/bounty/.test(s))return 'Bounties';
    if(/crime|mug/.test(s))return 'Crime / Mugging';
    if(/wage|salary|job pay|company pay/.test(s))return 'Wages / Job';
    if(/fee|tax/.test(s))return 'Fees / Taxes';
    if(/point/.test(s))return 'Points';
    if(/award|reward|mission/.test(s))return 'Rewards';
    return direction==='in'?'Other Income':'Other Spending';
  }
  function parseCashFlowEntry(entry,parsedItemRows=[]) {
    if(parsedItemRows?.length)return[];
    const logTypeId=Number(entry?.details?.id)||0,title=String(entry?.details?.title||'');
    if(KNOWN_TRANSACTION_LOGS.has(logTypeId)||/\btrade\b/i.test(title)||!financialTitleContext(title))return[];
    const payload={...(entry?.params||{}),...(entry?.data||{})},field=bestMoneyField(payload,title);if(!field)return[];
    const direction=cashFlowDirection(title,field.path);if(!direction)return[];
    const amount=Math.abs(Number(field.value)||0);if(!(amount>0))return[];
    return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction,amount,category:cashFlowCategory(title,direction),source:'Torn Log',title,logId:logTypeId,field:field.path,transfer:direction.startsWith('transfer')}];
  }
  function checkpointCashFlowRows(rows) {
    if(!rows?.length)return 0;const map=new Map((state.cashFlows||[]).map(x=>[String(x.id),x]));let added=0;
    for(const row of rows){if(!row?.id||!(Number(row.amount)>0)||map.has(String(row.id)))continue;map.set(String(row.id),row);added++;}
    if(added){state.cashFlows=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));save('cashFlows',state.cashFlows);}
    return added;
  }

'''
rep(parse_marker,parse_add+parse_marker)

rep("    const freeContext=/(crime success|organized crime success|city find|mission reward|seasonal gift|christmas town|easter egg hunt|halloween basket|job special|company special|event reward|competition reward|reward|loot|items? incoming|item.*received|item.*gained|item.*found)/i;",
    "    const freeContext=/(crime success|organized crime success|city find|mission reward|seasonal gift|christmas town|easter egg hunt|halloween basket|job special|company special|event reward|competition reward|reward|loot|items? incoming|item.*received|item.*gained|item.*found)/i;\n    const moneyContext=/(money|cash|bank|vault|wage|salary|pay|payment|deposit|withdraw|interest|dividend|casino|bookie|lottery|stock|share|bounty|rent|loan|fee|tax|rehab|travel|property|company|faction|donat|mug|points|award|income|expense|cost|profit|loss)/i;")
rep("if(id && ((paidContext.test(title) && paidAction.test(title)) || itemMovement.test(title) || freeContext.test(title) || KNOWN_TRANSACTION_LOGS.has(id)))",
    "if(id && ((paidContext.test(title) && paidAction.test(title)) || itemMovement.test(title) || freeContext.test(title) || moneyContext.test(title) || KNOWN_TRANSACTION_LOGS.has(id)))")

old_loop="""        const parsed=parseLogEntry(r);job.diagnostics.parsedRows+=parsed.length;job.diagnostics.matchedRows+=parsed.length;for(const t of parsed){if(t.side==='buy'){job.diagnostics.latestParsedAcquisitionTimestamp=Math.max(Number(job.diagnostics.latestParsedAcquisitionTimestamp)||0,Number(t.timestamp)||0);}if(t.side==='buy'&&t.source==='Foreign Market'){job.diagnostics.foreignBuyRows=(Number(job.diagnostics.foreignBuyRows)||0)+1;job.diagnostics.foreignBuyQty=(Number(job.diagnostics.foreignBuyQty)||0)+(Number(t.qty)||0);}}parsedRows.push(...parsed);"""
rep(old_loop,old_loop+"\n        const cashRows=parseCashFlowEntry(r,parsed);job.diagnostics.cashFlowRows=(Number(job.diagnostics.cashFlowRows)||0)+cashRows.length;checkpointCashFlowRows(cashRows);")
rep("return {rawRows:0,parsedRows:0,matchedRows:0,existingRowsSkipped:0,batches,logTypes,pages:0,oldestTimestamp:0,latestRawLogTimestamp:0,latestParsedAcquisitionTimestamp:0,mode,periodFrom:job.period.from,periodTo:job.period.to,tradeHeaders:0,",
    "return {rawRows:0,parsedRows:0,matchedRows:0,cashFlowRows:0,existingRowsSkipped:0,batches,logTypes,pages:0,oldestTimestamp:0,latestRawLogTimestamp:0,latestParsedAcquisitionTimestamp:0,mode,periodFrom:job.period.from,periodTo:job.period.to,tradeHeaders:0,")
JS.write_text(s)
