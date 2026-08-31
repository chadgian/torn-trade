from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')


def rep(old,new,count=1):
    global s
    n=s.count(old)
    if n < count:
        raise SystemExit(f'anchor not found enough times: {old[:120]!r} found={n}')
    s=s.replace(old,new,count)

# Version
rep('// @version      0.2.44','// @version      0.2.45')
rep("const VERSION = '0.2.44';","const VERSION = '0.2.45';")

# Canonical player-trade state.
rep("    playerTransfers: load('playerTransfers', []),\n    itemConsumptions: load('itemConsumptions', []),",
    "    playerTransfers: load('playerTransfers', []),\n    playerTrades: load('playerTrades', []),\n    itemConsumptions: load('itemConsumptions', []),")

# Ignore director/admin wage-setting logs. These change employee configuration, not the director's personal cash.
anchor="  function financialTitleContext(title) {\n"
insert="""  function isNonCashCompanyAdminLog(title) {
    const text=String(title||'').toLowerCase();
    return /company.*wage.*change|wage.*change.*company|company wage change|employee wage change/.test(text);
  }
"""
rep(anchor,insert+anchor)

rep("    const logTypeId=Number(entry?.details?.id)||0,title=entryTitle;\n    const payload=",
    "    const logTypeId=Number(entry?.details?.id)||0,title=entryTitle;\n    if(isNonCashCompanyAdminLog(title))return[];\n    const payload=")

rep("    if(!financialTitleContext(`${title} ${category}`)||EXPLICIT_CASH_LOGS.has(logTypeId)",
    "    if(isNonCashCompanyAdminLog(title)||!financialTitleContext(`${title} ${category}`)||EXPLICIT_CASH_LOGS.has(logTypeId)")

rep("      if(/company/i.test(title)&&/\\b(deposit|withdraw(?:al)?)\\b/i.test(title)){changed=true;continue;}",
    "      if(isNonCashCompanyAdminLog(title)||(/company/i.test(title)&&/\\b(deposit|withdraw(?:al)?)\\b/i.test(title))){changed=true;continue;}")

# Canonical Player Trade events, including cash-only trades.
trade_money_anchor="""  function tradeMoneyFor(entries,userId,owned=true) {
    const me=Number(userId);let total=0;
    for(const entry of entries||[]){
      if(entry?.type!=='Money')continue;
      const mine=Number(entry?.user_id)===me;if((owned&&!mine)||(!owned&&mine))continue;
      total+=Math.max(0,Number(entry?.details?.amount)||0);
    }
    return total;
  }
"""
trade_helpers=trade_money_anchor+"""
  function parsePlayerTradeEvent(trade,userId) {
    const tradeId=Number(trade?.id)||0,ts=Number(trade?.completed_at||trade?.timestamp)||0,me=Number(userId),entries=Array.isArray(trade?.items)?trade.items:[];
    if(!(tradeId>0)||!(ts>0)||!(me>0)||!entries.length)return null;
    const outgoing=tradeItemGroups(entries,me,true),incoming=tradeItemGroups(entries,me,false),cashOut=tradeMoneyFor(entries,me,true),cashIn=tradeMoneyFor(entries,me,false);
    if(!outgoing.length&&!incoming.length&&!(cashOut>0)&&!(cashIn>0))return null;
    const user=trade?.user||{},trader=trade?.trader||{},other=Number(user?.id)===me?trader:user;
    return {id:`playertrade:${tradeId}`,tradeId,timestamp:ts,counterpartyId:Number(other?.id)||0,counterpartyName:String(other?.name||''),cashIn,cashOut,incomingItems:incoming.map(x=>({itemId:Number(x.itemId),qty:Number(x.qty)||0})),outgoingItems:outgoing.map(x=>({itemId:Number(x.itemId),qty:Number(x.qty)||0}))};
  }
  function checkpointPlayerTradeEvents(rows) {
    const list=(rows||[]).filter(Boolean);if(!list.length)return 0;const map=new Map((state.playerTrades||[]).map(x=>[String(x.id),x]));let changed=0;
    for(const row of list){if(!row?.id)continue;const key=String(row.id),prev=map.get(key),next={...(prev||{}),...row};if(!prev||JSON.stringify(prev)!==JSON.stringify(next)){map.set(key,next);changed++;}}
    if(changed){state.playerTrades=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)).slice(-5000);save('playerTrades',state.playerTrades);}return changed;
  }
  function reconstructedPlayerTradeEvents() {
    const groups=new Map();
    for(const t of state.transactions||[]){if(t?.source!=='Player Trade'||!(Number(t.tradeId)>0))continue;const id=Number(t.tradeId);let g=groups.get(id);if(!g){g={id:`playertrade:${id}`,tradeId:id,timestamp:Number(t.timestamp)||0,counterpartyId:Number(t.counterpartyId)||0,counterpartyName:String(t.counterpartyName||''),cashIn:Math.max(0,Number(t.tradeCashIn)||0),cashOut:Math.max(0,Number(t.tradeCashOut)||0),incomingItems:[],outgoingItems:[]};groups.set(id,g);}g.timestamp=Math.max(g.timestamp,Number(t.timestamp)||0);if(t.side==='buy')g.incomingItems.push({itemId:Number(t.itemId)||0,qty:Number(t.qty)||0});else if(t.side==='sell')g.outgoingItems.push({itemId:Number(t.itemId)||0,qty:Number(t.qty)||0});}
    return [...groups.values()];
  }
  function effectivePlayerTradeEvents() {
    const map=new Map();for(const x of reconstructedPlayerTradeEvents())map.set(String(x.id),x);for(const x of state.playerTrades||[])if(x?.id)map.set(String(x.id),x);return [...map.values()].sort((a,b)=>(Number(b.timestamp)||0)-(Number(a.timestamp)||0));
  }
  function playerTradeEventRows(evt) {
    return [...(evt?.outgoingItems||[]).map(x=>({...x,side:'sell'})),...(evt?.incomingItems||[]).map(x=>({...x,side:'buy'}))];
  }
"""
rep(trade_money_anchor,trade_helpers)

# Cash Flow should consume canonical Player Trade events so cash-only trades are included too.
pat=r"  function transactionCashFlows\(\) \{.*?\n  \}\n  function allCashFlows\(\) \{"
new="""  function transactionCashFlows() {
    const out=[],transactions=state.transactions||[];
    for(const evt of effectivePlayerTradeEvents()){
      const tradeId=Number(evt.tradeId)||0,ts=Number(evt.timestamp)||0;if(!(tradeId>0&&ts>0))continue;
      const cashIn=Math.max(0,Number(evt.cashIn)||0),cashOut=Math.max(0,Number(evt.cashOut)||0),detail=playerTradeItemDetail(playerTradeEventRows(evt)),title=evt.counterpartyName?`Player Trade with ${evt.counterpartyName}`:`Player Trade #${tradeId}`;
      if(cashIn>0)out.push({id:`tradecash:${tradeId}:in`,timestamp:ts,direction:'in',amount:cashIn,category:'Player Trades',source:'Player Trade',title,detail,transfer:false,tradeId,counterpartyId:Number(evt.counterpartyId)||0,counterpartyName:String(evt.counterpartyName||'')});
      if(cashOut>0)out.push({id:`tradecash:${tradeId}:out`,timestamp:ts,direction:'out',amount:cashOut,category:'Player Trades',source:'Player Trade',title,detail,transfer:false,tradeId,counterpartyId:Number(evt.counterpartyId)||0,counterpartyName:String(evt.counterpartyName||'')});
    }
    for(const t of transactions){
      const ts=Number(t?.timestamp)||0;if(!(ts>0)||t.source==='Player Trade')continue;
      const total=Math.max(0,Number(t.total)||0),fee=Math.max(0,Number(t.fee)||0),itemId=Number(t.itemId)||0,itemName=itemId>0?catalogItem(itemId).name:'',itemQty=Math.max(0,Number(t.qty)||0),detail=transactionItemDetail(t);
      const common={transfer:false,itemId,itemName,qty:itemQty,detail};
      if(t.side==='buy'&&total>0)out.push({id:`txcash:${t.id}:buy`,timestamp:ts,direction:'out',amount:total,category:t.source==='Foreign Market'?'Travel Trading':'Item Purchases',source:t.source||'Item purchase',title:t.title||`${t.source||'Item'} purchase`,...common});
      if(t.side==='sell'&&total>0)out.push({id:`txcash:${t.id}:sell`,timestamp:ts,direction:'in',amount:total,category:'Item Sales',source:t.source||'Item sale',title:t.title||`${t.source||'Item'} sale`,...common});
      if(t.side==='sell'&&fee>0)out.push({id:`txcash:${t.id}:fee`,timestamp:ts,direction:'out',amount:fee,category:'Fees / Taxes',source:t.source||'Sale fee',title:`${t.title||'Item sale'} fee`,...common});
    }
    return out;
  }
  function allCashFlows() {"""
s,n=re.subn(pat,new,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'transactionCashFlows replace failed {n}')

# Generic cash movements that exchange cash for another asset should remain visible but not be treated as known NW impact.
anchor="  function dailyNetWorthActivity(dayStart=null) {\n"
helpers="""  function cashFlowNetWorthImpactKnown(x) {
    const text=`${x?.category||''} ${x?.title||''} ${x?.source||''}`.toLowerCase();
    if(/points market|point market/.test(text))return false;
    if(/stock|share/.test(text)&&!/(dividend|interest|payout)/.test(text))return false;
    if(/property/.test(text)&&/(buy|bought|purchase|sell|sold|sale)/.test(text))return false;
    if(/auction/.test(text)&&/(buy|bought|won|purchase|sell|sold|sale)/.test(text))return false;
    return true;
  }
  function flattenNetWorthLeaves(value,path='',out=new Map(),depth=0) {
    if(value==null||depth>8)return out;
    if(typeof value==='number'&&Number.isFinite(value)){if(!/(^|\.)(total|timestamp|parsetime|parse_time)$/i.test(path))out.set(path,value);return out;}
    if(Array.isArray(value)){value.forEach((v,i)=>flattenNetWorthLeaves(v,path?`${path}.${i}`:String(i),out,depth+1));return out;}
    if(typeof value==='object')for(const [k,v] of Object.entries(value)){const next=path?`${path}.${k}`:k;flattenNetWorthLeaves(v,next,out,depth+1);}return out;
  }
  function netWorthComponentChanges(first,last) {
    if(!first||!last)return[];const a=flattenNetWorthLeaves(first),b=flattenNetWorthLeaves(last),keys=new Set([...a.keys(),...b.keys()]),rows=[];
    for(const key of keys){const before=Number(a.get(key))||0,after=Number(b.get(key))||0,delta=after-before;if(Math.abs(delta)>=1)rows.push({key,before,after,delta});}
    return rows.sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta)||x.key.localeCompare(y.key));
  }
  function netWorthComponentLabel(path) {return String(path||'Other').split('.').filter(Boolean).map(x=>labeledKey(x)).join(' / ');}
"""
rep(anchor,helpers+anchor)

# Skip synthetic Player Trade transaction rows in generic buy/sell NW logic.
rep("    for(const t of state.transactions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to||Number(t?.logId)===4103)continue;",
    "    for(const t of state.transactions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to||Number(t?.logId)===4103||t?.source==='Player Trade')continue;")

# Insert one canonical Player Trade NW row per trade, before direct player item transfers.
player_transfer_loop="    for(const t of state.playerTransfers||[]){"
trade_nw="""    for(const evt of effectivePlayerTradeEvents()){
      const ts=Number(evt?.timestamp)||0;if(ts<from||ts>to)continue;const incoming=evt.incomingItems||[],outgoing=evt.outgoingItems||[],cashIn=Math.max(0,Number(evt.cashIn)||0),cashOut=Math.max(0,Number(evt.cashOut)||0);
      let itemInValue=0,itemOutValue=0,missingValue=false;for(const x of incoming){const q=Math.max(0,Number(x.qty)||0),v=q*Math.max(0,Number(catalogItem(x.itemId).marketPrice)||0);if(q>0&&!(v>0))missingValue=true;itemInValue+=v;}for(const x of outgoing){const q=Math.max(0,Number(x.qty)||0),v=q*Math.max(0,Number(catalogItem(x.itemId).marketPrice)||0);if(q>0&&!(v>0))missingValue=true;itemOutValue+=v;}
      const impactKnown=!missingValue,impact=cashIn-cashOut+itemInValue-itemOutValue,detail=playerTradeItemDetail(playerTradeEventRows(evt)),who=evt.counterpartyName||((Number(evt.counterpartyId)||0)>0?`#${evt.counterpartyId}`:`#${evt.tradeId}`),metaParts=[];
      if(cashIn>0)metaParts.push(`Cash received +${money(cashIn)}`);if(cashOut>0)metaParts.push(`Cash given -${money(cashOut)}`);if(itemInValue>0)metaParts.push(`Items received +${money(itemInValue)}`);if(itemOutValue>0)metaParts.push(`Items given -${money(itemOutValue)}`);if(detail)metaParts.push(detail);metaParts.push(impactKnown?`Est. net-worth impact ${impact>=0?'+':''}${money(impact)}`:'Net-worth impact unavailable because at least one traded item has no market value');
      rows.push({timestamp:ts,kind:'player-trade',icon:'\\u21C4',title:`Player Trade with ${who}`,meta:metaParts.join(' \\u00B7 '),value:impactKnown?Math.abs(impact):0,valueClass:impactKnown?(impact>=0?'pos':'neg'):'',prefix:impactKnown?(impact>=0?'+':'-'):'',impact:impactKnown?impact:null,impactKnown});
    }
"""
rep(player_transfer_loop,trade_nw+player_transfer_loop,1)

# Cash-loop: mark asset exchanges as unvalued instead of falsely counting cash alone as wealth loss/gain.
old="""    for(const x of state.cashFlows||[]){const ts=Number(x?.timestamp)||0;if(ts<from||ts>to||x?.transfer||String(x?.direction||'').startsWith('transfer'))continue;const amount=Math.max(0,Number(x?.amount)||0);if(!(amount>0))continue;const incoming=x.direction==='in',impact=incoming?amount:-amount,isCompany=x.category==='Company Profit / Loss'||x.source==='Company Daily Adjustment';if(isCompany){companySeen=true;companyNet+=impact;}const companyMeta=isCompany?`Company daily adjustment \\u00B7 Gross ${money(x.grossIncome)} \\u00B7 Wages ${money(x.wages)} \\u00B7 Advertising ${money(x.advertisementBudget)}`:`${x.category||'Cash'} \\u00B7 ${x.source||'Torn Log'}`;rows.push({timestamp:ts,kind:isCompany?'company-pl':(incoming?'money-in':'money-out'),icon:isCompany?'\\u25A3':(incoming?'\\u2191':'\\u2193'),title:x.title||x.category||(incoming?'Money received':'Money spent'),meta:companyMeta,value:amount,valueClass:incoming?'pos':'neg',prefix:incoming?'+':'-',impact,impactKnown:true});}
"""
new="""    for(const x of state.cashFlows||[]){const ts=Number(x?.timestamp)||0;if(ts<from||ts>to||x?.transfer||String(x?.direction||'').startsWith('transfer')||isNonCashCompanyAdminLog(x?.title))continue;const amount=Math.max(0,Number(x?.amount)||0);if(!(amount>0))continue;const incoming=x.direction==='in',impact=incoming?amount:-amount,isCompany=x.category==='Company Profit / Loss'||x.source==='Company Daily Adjustment',impactKnown=isCompany||cashFlowNetWorthImpactKnown(x);if(isCompany){companySeen=true;companyNet+=impact;}const companyMeta=isCompany?`Company daily adjustment \\u00B7 Gross ${money(x.grossIncome)} \\u00B7 Wages ${money(x.wages)} \\u00B7 Advertising ${money(x.advertisementBudget)}`:`${x.category||'Cash'} \\u00B7 ${x.source||'Torn Log'}${impactKnown?'':' \\u00B7 Cash side shown; counterpart asset value is not safely known'}`;rows.push({timestamp:ts,kind:isCompany?'company-pl':(incoming?'money-in':'money-out'),icon:isCompany?'\\u25A3':(incoming?'\\u2191':'\\u2193'),title:x.title||x.category||(incoming?'Money received':'Money spent'),meta:companyMeta,value:impactKnown?amount:0,valueClass:impactKnown?(incoming?'pos':'neg'):'',prefix:impactKnown?(incoming?'+':'-'):'',impact:impactKnown?impact:null,impactKnown});}
"""
rep(old,new)

# Include authoritative snapshot component changes in return.
rep("rows.sort((a,b)=>b.timestamp-a.timestamp||String(a.title).localeCompare(String(b.title)));return {from,to,snapshots,before,latest,baseline,delta,rows,companyNet:companySeen?companyNet:null,detectedNet,valuedEvents:valuedRows.length,unvaluedEvents};",
    "const componentChanges=baseline&&latest?netWorthComponentChanges(baseline.networth,latest.networth):[];rows.sort((a,b)=>b.timestamp-a.timestamp||String(a.title).localeCompare(String(b.title)));return {from,to,snapshots,before,latest,baseline,delta,rows,companyNet:companySeen?companyNet:null,detectedNet,valuedEvents:valuedRows.length,unvaluedEvents,componentChanges};")

# Add component breakdown to daily HTML and stronger reconciliation wording.
rep("    const rows=d.rows.slice(0,20).map(x=>`<div class=\\\"tta-nw-change\\\">",
    "    const componentHtml=(d.componentChanges||[]).length?`<div class=\\\"tta-fin-section\\\"><div class=\\\"tta-sectionhead\\\"><div><small>Torn snapshot components</small><h3>What changed between stored snapshots</h3></div><span class=\\\"tta-sectionhint\\\">${qty(d.componentChanges.length)} changed</span></div><div class=\\\"tta-breakdown\\\">${d.componentChanges.slice(0,12).map(c=>`<div class=\\\"tta-fin-row\\\"><span>${esc(netWorthComponentLabel(c.key))}</span><b class=\\\"${c.delta>=0?'pos':'neg'}\\\">${c.delta>=0?'+':''}${money(c.delta)}</b></div>`).join('')}</div>${d.componentChanges.length>12?`<div class=\\\"tta-morehint\\\">Showing the 12 largest component movements.</div>`:''}</div>`:'';\n    const rows=d.rows.slice(0,20).map(x=>`<div class=\\\"tta-nw-change\\\">")

rep("</div></div><div class=\"tta-nw-change-list\">${rows||",
    "</div></div>${componentHtml}<div class=\"tta-nw-change-list\">${rows||")

rep("Company P/L is included when recorded.</div></section>`;",
    "Company P/L is included when recorded. Player Trades use actual trade cash plus current catalog values of items received/given. Administrative company wage-setting logs are excluded because they do not move the director's personal wealth. Snapshot component changes provide the authoritative fallback for Torn net-worth categories that cannot be safely attributed to a specific log.</div></section>`;")

# Backup/import/reset/full-resync storage for canonical trades.
rep("transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,itemConsumptions:state.itemConsumptions",
    "transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,playerTrades:state.playerTrades,itemConsumptions:state.itemConsumptions")
rep("const keys=['transactions','cashFlows','playerTransfers','itemConsumptions'",
    "const keys=['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions'")
rep("['tracked','transactions','cashFlows','playerTransfers','itemConsumptions'",
    "['tracked','transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions'")
rep("state.tracked=[];state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.itemConsumptions=[];",
    "state.tracked=[];state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.playerTrades=[];state.itemConsumptions=[];")
rep("state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.itemConsumptions=[];state.unrecognizedFinancial=[];",
    "state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.playerTrades=[];state.itemConsumptions=[];state.unrecognizedFinancial=[];")
rep("save('transactions',[]);save('cashFlows',[]);save('playerTransfers',[]);save('itemConsumptions',[]);",
    "save('transactions',[]);save('cashFlows',[]);save('playerTransfers',[]);save('playerTrades',[]);save('itemConsumptions',[]);")

# Local-data settings count.
rep("${qty(state.playerTransfers.length)} player item-transfer rows \\u00B7 ${qty(state.unrecognizedFinancial.length)}",
    "${qty(state.playerTransfers.length)} player item-transfer rows \\u00B7 ${qty(state.playerTrades.length)} canonical player-trade rows \\u00B7 ${qty(state.unrecognizedFinancial.length)}")

# Bump sync cache so verified item trades seed from transactions, while previously skipped cash-only trades are re-fetched once.
rep('const SYNC_CACHE_SCHEMA_VERSION = 2;','const SYNC_CACHE_SCHEMA_VERSION = 3;')

# Seed verification from canonical player trade events too.
seed_anchor="""    for(const t of state.transactions||[]){
      const id=Number(t?.tradeId)||0;
      if(t?.source==='Player Trade'&&id>0&&!c.verifiedTrades[id]){c.verifiedTrades[id]=Number(t.timestamp)||1;seeded=true;}
    }
"""
seed_new=seed_anchor+"""    for(const t of state.playerTrades||[]){const id=Number(t?.tradeId)||0;if(id>0&&!c.verifiedTrades[id]){c.verifiedTrades[id]=Number(t.timestamp)||1;seeded=true;}}
"""
rep(seed_anchor,seed_new)

# Store canonical event whenever trade detail is fetched, including cash-only trades.
rep("      const data=await syncApiGet(`/user/${Number(h.id)}/trade`);job.diagnostics.tradeDetails=(Number(job.diagnostics.tradeDetails)||0)+1;\n      const rows=parsePlayerTrade(data?.trade,job.userId);",
    "      const data=await syncApiGet(`/user/${Number(h.id)}/trade`);job.diagnostics.tradeDetails=(Number(job.diagnostics.tradeDetails)||0)+1;\n      const tradeEvent=parsePlayerTradeEvent(data?.trade,job.userId);if(tradeEvent){checkpointPlayerTradeEvents([tradeEvent]);job.diagnostics.playerTradeEvents=(Number(job.diagnostics.playerTradeEvents)||0)+1;}\n      const rows=parsePlayerTrade(data?.trade,job.userId);")

# Diagnostics field.
rep("tradeHeaders:0,tradeListPages:0,tradeDetails:0,tradeDetailsSkipped:0,",
    "tradeHeaders:0,tradeListPages:0,tradeDetails:0,tradeDetailsSkipped:0,playerTradeEvents:0,")

# More accurate phase-specific Full Resync ETA using prior run depth + observed per-request timing.
eta_pat=r"  function fullResyncProgressMetrics\(job\) \{.*?\n  \}\n  function decorateSyncProgress\(job,progress\) \{.*?\n  \}"
eta_new="""  function etaUnitTiming(job,phase,unit,defaultMs=1150) {
    const now=Date.now();if(!job.etaStats||typeof job.etaStats!=='object')job.etaStats={};let st=job.etaStats[phase]||{lastAt:now,lastUnit:Number(unit)||0,msPerUnit:0,samples:0};
    const u=Number(unit)||0,du=u-(Number(st.lastUnit)||0),dt=now-(Number(st.lastAt)||now);
    if(du>0&&dt>50&&dt<30000){const sample=dt/du+REQUEST_GAP_MS;st.msPerUnit=st.msPerUnit>0?st.msPerUnit*.72+sample*.28:sample;st.samples=(Number(st.samples)||0)+du;}
    st.lastAt=now;st.lastUnit=u;job.etaStats[phase]=st;return st.msPerUnit>0?st.msPerUnit:defaultMs;
  }
  function priorFullSyncDiagnostics() {const d=state.sync?.diagnostics;return d&&d.syncMode==='full'?d:(d||{});}
  function fullResyncProgressMetrics(job) {
    if(!job||job.syncMode!=='full')return null;const phase=String(job.phase||'setup'),d=job.diagnostics||{},prior=priorFullSyncDiagnostics();let pct=1,eta=null,etaNote='estimating time left';
    const pageMs=etaUnitTiming(job,phase,phase==='logs-filtered'||phase==='logs-fallback'?Number(d.pages)||0:phase==='logs-abroad-verify'?Number(d.abroadVerifyPages)||0:phase==='trades-list'?Number(d.tradeListPages)||0:phase==='trade-details'?Number(job.tradeDetailIndex)||0:0,1150);
    const priorTradePages=Math.max(1,Number(prior.tradeListPages)||1),priorTrades=Math.max(0,Number(prior.tradeHeaders)||0),priorAbroadPages=Math.max(1,Number(prior.abroadVerifyPages)||1),detailMs=phase==='trade-details'?pageMs:1150;
    if(phase==='setup'){pct=2;etaNote='preparing scan';}
    else if(phase==='logs-filtered'){
      const totalBatches=Math.max(1,Math.ceil((job.logTypeIds||[]).length/MAX_LOG_IDS_PER_REQUEST)),doneBatches=Math.max(0,Math.min(totalBatches,Number(job.logBatchIndex)||0)),currentPages=Math.max(0,Number(job.logPage)||0),pagesDone=Math.max(0,Number(d.pages)||0),priorPages=Math.max(totalBatches,Number(prior.pages)||0);
      let predictedTotalPages=priorPages;if(doneBatches>0){const completedPages=Math.max(1,pagesDone-currentPages),avg=completedPages/doneBatches;predictedTotalPages=Math.max(pagesDone+1,avg*totalBatches);predictedTotalPages=priorPages>0?predictedTotalPages*.72+priorPages*.28:predictedTotalPages;}else if(!(priorPages>0))predictedTotalPages=Math.max(pagesDone+totalBatches*4,totalBatches*5);
      const remainingPages=Math.max(0,predictedTotalPages-pagesDone),futureMs=priorAbroadPages*1150+priorTradePages*1150+Math.max(priorTrades,10)*1150+4000;eta=remainingPages*pageMs+futureMs;pct=5+55*Math.min(1,pagesDone/Math.max(1,predictedTotalPages));etaNote=doneBatches>0||priorPages>0?`~${formatEtaDuration(eta)} left`:'learning history depth';
    }else if(phase==='logs-fallback'){
      const pages=Math.max(0,Number(d.pages)||0),priorPages=Math.max(1,Number(prior.pages)||10),remaining=Math.max(1,priorPages-pages);pct=60+10*Math.min(.95,pages/Math.max(1,pages+remaining));eta=remaining*pageMs+priorAbroadPages*1150+priorTradePages*1150+Math.max(priorTrades,10)*1150+4000;etaNote=`~${formatEtaDuration(eta)} left`;
    }else if(phase==='logs-abroad-verify'){
      const pages=Math.max(0,Number(d.abroadVerifyPages)||0),pred=Math.max(pages+1,priorAbroadPages),remaining=Math.max(0,pred-pages);pct=70+6*Math.min(.95,pages/Math.max(1,pred));eta=remaining*pageMs+priorTradePages*1150+Math.max(priorTrades,10)*1150+4000;etaNote=`~${formatEtaDuration(eta)} left`;
    }else if(phase==='trades-list'){
      const pages=Math.max(0,Number(d.tradeListPages)||0),pred=Math.max(pages+1,priorTradePages),remainingPages=Math.max(0,pred-pages),known=Math.max((job.tradeHeaders||[]).length,priorTrades);pct=76+8*Math.min(.95,pages/Math.max(1,pred));eta=remainingPages*pageMs+Math.max(known,5)*1150+3500;etaNote=`~${formatEtaDuration(eta)} left`;
    }else if(phase==='trade-details'){
      const total=Math.max(0,(job.tradeHeaders||[]).length),done=Math.max(0,Number(job.tradeDetailIndex)||0),remaining=Math.max(0,total-done);pct=84+13*(total>0?Math.min(1,done/total):1);eta=remaining*detailMs+3500;etaNote=total>0?`~${formatEtaDuration(eta)} left`:'finishing trade scan';
    }else if(phase==='finalize'){pct=99;eta=2500;etaNote='~3s left';}
    pct=Math.max(Number(job.progressPercent)||0,Math.min(99,pct));job.progressPercent=pct;return {percent:pct,etaMs:eta,etaNote};
  }
  function decorateSyncProgress(job,progress) {
    const text=String(progress||''),m=fullResyncProgressMetrics(job);if(!m)return text;const pc=Math.max(0,Math.min(99,Math.round(m.percent))),eta=m.etaNote||(m.etaMs!=null?`~${formatEtaDuration(m.etaMs)} left`:'estimating time left');return `${pc}% \\u00B7 ${eta} \\u00B7 ${text}`;
  }"""
s,n=re.subn(eta_pat,eta_new,s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'ETA replacement failed {n}')

# Help text: player trades and admin wage setting distinction.
rep("Player money and item transfers are shown as daily changes, used/consumed items reduce recorded inventory",
    "Player money/item transfers and completed Player Trades are shown as daily changes, used/consumed items reduce recorded inventory")

# Assertions
assert "@version      0.2.45" in s
assert "const VERSION = '0.2.45';" in s
assert "playerTrades: load('playerTrades', [])" in s
assert "function parsePlayerTradeEvent" in s
assert "function effectivePlayerTradeEvents" in s
assert "kind:'player-trade'" in s
assert "isNonCashCompanyAdminLog" in s
assert "netWorthComponentChanges" in s
assert "SYNC_CACHE_SCHEMA_VERSION = 3" in s
assert "function etaUnitTiming" in s
assert "Cash side shown; counterpart asset value is not safely known" in s

# Keep source ASCII-only for Torn PDA encoding safety.
s.encode('ascii')
p.write_text(s,encoding='ascii')
