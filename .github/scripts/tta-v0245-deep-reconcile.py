from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

def one(old,new,label):
    global s
    n=s.count(old)
    if n!=1:
        raise SystemExit(f'{label}: expected 1 anchor, found {n}')
    s=s.replace(old,new,1)

def sub(pattern,repl,label,flags=0):
    global s
    s2,n=re.subn(pattern,repl,s,count=1,flags=flags)
    if n!=1:
        raise SystemExit(f'{label}: expected 1 regex match, found {n}')
    s=s2

one('// @version      0.2.44','// @version      0.2.45','metadata version')
one("const VERSION = '0.2.44';","const VERSION = '0.2.45';",'runtime version')
one("    playerTransfers: load('playerTransfers', []),\n    itemConsumptions: load('itemConsumptions', []),","    playerTransfers: load('playerTransfers', []),\n    playerTrades: load('playerTrades', []),\n    itemConsumptions: load('itemConsumptions', []),",'state playerTrades')
one("  purgeBogusCrimeCashRows();\n  // v0.2.39 records", "  purgeBogusCrimeCashRows();\n  purgeBogusCompanyAdminCashRows();\n  migratePlayerTradeSummariesFromTransactions();\n  // v0.2.39 records", 'startup migrations')
one('const SYNC_CACHE_SCHEMA_VERSION = 2;','const SYNC_CACHE_SCHEMA_VERSION = 3;','sync cache schema')

helpers=r'''  function isNonCashCompanyAdminLog(title,logTypeId=0) {
    const id=Number(logTypeId)||0;if(id===6220||id===6221)return false;
    const s=String(title||'').toLowerCase();
    return /\b(company|employee|director)\b/.test(s)&&/\b(wage|salary|pay|advertis(?:e|ing|ement)|budget)\b/.test(s)&&/\b(change|changed|set|setting|update|updated|edit|edited|adjust|adjusted)\b/.test(s);
  }
  function purgeBogusCompanyAdminCashRows() {
    const before=(state.cashFlows||[]).length;
    state.cashFlows=(state.cashFlows||[]).filter(x=>!isNonCashCompanyAdminLog(x?.title,x?.logId));
    if(state.cashFlows.length!==before)save('cashFlows',state.cashFlows);
    state.unrecognizedFinancial=(state.unrecognizedFinancial||[]).filter(x=>!isNonCashCompanyAdminLog(x?.title,x?.logId));
    save('unrecognizedFinancial',state.unrecognizedFinancial);
  }
  function summarizeTradeItems(entries,userId,outgoing) {
    const me=Number(userId),map=new Map();
    for(const e of entries||[]){if(e?.type!=='Item')continue;const mine=Number(e?.user_id)===me;if((outgoing&&!mine)||(!outgoing&&mine))continue;const id=Number(e?.details?.id)||0,q=Math.max(0,Number(e?.details?.amount)||0);if(id>0&&q>0)map.set(id,(map.get(id)||0)+q);}
    return [...map.entries()].map(([itemId,qty])=>({itemId,qty}));
  }
  function parsePlayerTradeSummary(trade,userId) {
    const tradeId=Number(trade?.id)||0,ts=Number(trade?.completed_at||trade?.timestamp)||0,me=Number(userId),entries=Array.isArray(trade?.items)?trade.items:[];
    if(!(tradeId>0&&ts>0&&me>0))return null;
    let cashIn=0,cashOut=0,companyIn=0,companyOut=0,unsupportedIn=0,unsupportedOut=0,counterpartyId=0;
    for(const e of entries){const mine=Number(e?.user_id)===me;if(!mine&&Number(e?.user_id)>0)counterpartyId=Number(e.user_id);const incoming=!mine,type=String(e?.type||'');if(type==='Money'){const v=Math.max(0,Number(e?.details?.amount)||0);if(incoming)cashIn+=v;else cashOut+=v;}else if(type==='Company'){const v=Math.max(0,Number(e?.details?.value)||0);if(incoming)companyIn+=v;else companyOut+=v;}else if(type==='Property'||type==='Faction'||type==='NAP'){if(incoming)unsupportedIn++;else unsupportedOut++;}}
    const itemsIn=summarizeTradeItems(entries,me,false),itemsOut=summarizeTradeItems(entries,me,true);
    return {id:tradeId,timestamp:ts,counterpartyId,cashIn,cashOut,companyIn,companyOut,itemsIn,itemsOut,unsupportedIn,unsupportedOut,complete:true};
  }
  function checkpointPlayerTradeSummary(row) {
    if(!row?.id)return 0;const map=new Map((state.playerTrades||[]).map(x=>[Number(x.id),x])),prev=map.get(Number(row.id));map.set(Number(row.id),{...(prev||{}),...row});state.playerTrades=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)).slice(-5000);save('playerTrades',state.playerTrades);return prev?0:1;
  }
  function migratePlayerTradeSummariesFromTransactions() {
    if((state.playerTrades||[]).length)return;const map=new Map();
    for(const t of state.transactions||[]){if(t?.source!=='Player Trade'||!(Number(t.tradeId)>0))continue;const id=Number(t.tradeId),g=map.get(id)||{id,timestamp:Number(t.timestamp)||0,cashIn:0,cashOut:0,companyIn:0,companyOut:0,itemsIn:[],itemsOut:[],unsupportedIn:0,unsupportedOut:0,complete:false};g.timestamp=Math.max(g.timestamp,Number(t.timestamp)||0);g.cashIn=Math.max(g.cashIn,Math.max(0,Number(t.tradeCashIn)||0));g.cashOut=Math.max(g.cashOut,Math.max(0,Number(t.tradeCashOut)||0));const side=t.side==='buy'?'itemsIn':t.side==='sell'?'itemsOut':null;if(side&&Number(t.itemId)>0&&Number(t.qty)>0){const prev=g[side].find(x=>Number(x.itemId)===Number(t.itemId));if(prev)prev.qty+=Number(t.qty);else g[side].push({itemId:Number(t.itemId),qty:Number(t.qty)});}map.set(id,g);}
    if(map.size){state.playerTrades=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));save('playerTrades',state.playerTrades);}
  }
  function playerTradeItemValue(items) {let total=0,known=true;for(const x of items||[]){const p=Math.max(0,Number(catalogItem(x.itemId)?.marketPrice)||0),q=Math.max(0,Number(x.qty)||0);if(q>0&&!p)known=false;total+=p*q;}return {total,known};}
  function playerTradeItemText(items,verb) {const list=(items||[]).map(x=>`${qty(x.qty)} x ${catalogItem(x.itemId).name}`);return list.length?`${verb} ${list.slice(0,3).join(', ')}${list.length>3?` +${list.length-3} more`:''}`:'';}
  function playerTradeNetWorthRow(tr) {
    const inItems=playerTradeItemValue(tr.itemsIn),outItems=playerTradeItemValue(tr.itemsOut),unsupported=(Number(tr.unsupportedIn)||0)+(Number(tr.unsupportedOut)||0),complete=tr.complete!==false;
    const impact=(Number(tr.cashIn)||0)-(Number(tr.cashOut)||0)+inItems.total-outItems.total+(Number(tr.companyIn)||0)-(Number(tr.companyOut)||0),known=complete&&inItems.known&&outItems.known&&!unsupported;
    const parts=[];if(Number(tr.cashIn)>0)parts.push(`Cash received +${money(tr.cashIn)}`);if(Number(tr.cashOut)>0)parts.push(`Cash sent -${money(tr.cashOut)}`);const got=playerTradeItemText(tr.itemsIn,'Received'),gave=playerTradeItemText(tr.itemsOut,'Gave');if(got)parts.push(got);if(gave)parts.push(gave);if(Number(tr.companyIn)>0)parts.push(`Company value received +${money(tr.companyIn)}`);if(Number(tr.companyOut)>0)parts.push(`Company value given -${money(tr.companyOut)}`);if(unsupported)parts.push(`${qty(unsupported)} property/faction/NAP asset${unsupported===1?'':'s'} require Torn snapshot reconciliation`);if(!complete)parts.push('Legacy summary - run Full Resync for complete trade details');
    return {timestamp:Number(tr.timestamp)||0,kind:'player-trade',icon:'\u21C4',title:`Player Trade #${Number(tr.id)||0}`,meta:parts.join(' \u00B7 ')||'Completed Player Trade',value:known?Math.abs(impact):0,valueClass:known?(impact>=0?'pos':'neg'):'',prefix:known?(impact>=0?'+':'-'):'',impact:known?impact:null,impactKnown:known};
  }
  function playerTradeSummaryCashFlows() {const out=[];for(const t of state.playerTrades||[]){const ts=Number(t?.timestamp)||0,id=Number(t?.id)||0;if(!(ts>0&&id>0))continue;const detail=[playerTradeItemText(t.itemsOut,'Gave'),playerTradeItemText(t.itemsIn,'Received')].filter(Boolean).join(' \u00B7 ');if(Number(t.cashIn)>0)out.push({id:`tradecash:${id}:in`,timestamp:ts,direction:'in',amount:Number(t.cashIn),category:'Player Trades',source:'Player Trade',title:`Player Trade #${id}`,detail,transfer:false,tradeId:id});if(Number(t.cashOut)>0)out.push({id:`tradecash:${id}:out`,timestamp:ts,direction:'out',amount:Number(t.cashOut),category:'Player Trades',source:'Player Trade',title:`Player Trade #${id}`,detail,transfer:false,tradeId:id});}return out;}
  function currentPointUnitValue(){const snap=latestFinancialSnapshot(),pointCount=Math.max(0,Number(snap?.money?.points)||0),pointValue=Math.max(0,Number(snap?.networth?.points)||0);return pointCount>0&&pointValue>0?pointValue/pointCount:0;}
  function netWorthCashEventImpact(x){const amount=Math.max(0,Number(x?.amount)||0),incoming=x?.direction==='in',text=`${x?.title||''} ${x?.category||''} ${x?.source||''}`.toLowerCase(),id=Number(x?.logId)||0;if(id===5010||id===5011){const q=Math.max(0,Number(x?.assetQty)||0),unit=currentPointUnitValue();if(q>0&&unit>0){const asset=q*unit,impact=id===5010?asset-amount:amount-asset;return {known:true,impact,meta:`Points asset value ${id===5010?'+':'-'}${money(asset)}`};}return {known:false,impact:null,meta:'Points asset exchange - point quantity/value unavailable for exact Net Worth impact'};}if((/stock|share/.test(text)&&id!==5531)||/\b(property|company)\b/.test(text)&&/buy|bought|purchase|sell|sold|sale/.test(text)||/\bloan\b/.test(text)&&/borrow|repay|payment/.test(text))return {known:false,impact:null,meta:'Asset/liability exchange - reconcile with Torn snapshot'};return {known:true,impact:incoming?amount:-amount,meta:''};}
  function pointQuantityFromPayload(payload){const seen=new Set();function walk(v,key=''){if(v==null||typeof v!=='object')return 0;if(seen.has(v))return 0;seen.add(v);for(const [k,val] of Object.entries(v)){const name=String(k).toLowerCase();if((name==='points'||name==='point_amount'||name==='points_amount'||name==='quantity')&&Number(val)>0)return Number(val);if(val&&typeof val==='object'){const r=walk(val,k);if(r>0)return r;}}return 0;}return walk(payload);}
'''
one('  function tradeItemGroups(entries,userId,outgoing=true) {',helpers+'\n  function tradeItemGroups(entries,userId,outgoing=true) {','insert reconciliation helpers')

one("    const payload={...(entry?.params||{}),...(entry?.data||{})},explicit=EXPLICIT_CASH_LOGS.get(logTypeId);\n    if(explicit){", "    const payload={...(entry?.params||{}),...(entry?.data||{})},explicit=EXPLICIT_CASH_LOGS.get(logTypeId);\n    if(isNonCashCompanyAdminLog(title,logTypeId))return[];\n    if(explicit){", 'company admin parser guard')
one("counterpartyId:cp.id||0,counterpartyName:cp.name||''}];", "counterpartyId:cp.id||0,counterpartyName:cp.name||'',assetQty:(logTypeId===5010||logTypeId===5011)?pointQuantityFromPayload(payload):0}];", 'point quantity on explicit cash')
one("    if(!financialTitleContext(`${title} ${category}`)||EXPLICIT_CASH_LOGS.has(logTypeId)||PLAYER_ITEM_LOGS.has(logTypeId)||KNOWN_TRANSACTION_LOGS.has(logTypeId)||/\\btrade\\b/i.test(title))return null;", "    if(isNonCashCompanyAdminLog(title,logTypeId)||!financialTitleContext(`${title} ${category}`)||EXPLICIT_CASH_LOGS.has(logTypeId)||PLAYER_ITEM_LOGS.has(logTypeId)||KNOWN_TRANSACTION_LOGS.has(logTypeId)||/\\btrade\\b/i.test(title))return null;", 'unrecognized admin guard')

one("    const map=new Map();for(const x of state.cashFlows||[])if(x?.id)map.set(String(x.id),x);for(const x of transactionCashFlows())map.set(String(x.id),x);", "    const map=new Map();for(const x of state.cashFlows||[])if(x?.id)map.set(String(x.id),x);for(const x of transactionCashFlows())map.set(String(x.id),x);for(const x of playerTradeSummaryCashFlows())map.set(String(x.id),x);", 'cash flow trade summaries')

one("      const data=await syncApiGet(`/user/${Number(h.id)}/trade`);job.diagnostics.tradeDetails=(Number(job.diagnostics.tradeDetails)||0)+1;\n      const rows=parsePlayerTrade(data?.trade,job.userId);", "      const requestStarted=Date.now(),data=await syncApiGet(`/user/${Number(h.id)}/trade`);recordSyncRequestSample(job,'trade-detail',requestStarted);job.diagnostics.tradeDetails=(Number(job.diagnostics.tradeDetails)||0)+1;\n      const summary=parsePlayerTradeSummary(data?.trade,job.userId);if(summary)checkpointPlayerTradeSummary(summary);\n      const rows=parsePlayerTrade(data?.trade,job.userId);", 'checkpoint detailed trade summary')

one("    for(const t of state.transactions||[]){\n      const id=Number(t?.tradeId)||0;\n      if(t?.source==='Player Trade'&&id>0&&!c.verifiedTrades[id]){c.verifiedTrades[id]=Number(t.timestamp)||1;seeded=true;}\n    }", "    for(const t of state.playerTrades||[]){\n      const id=Number(t?.id)||0;\n      if(t?.complete&&id>0&&!c.verifiedTrades[id]){c.verifiedTrades[id]=Number(t.timestamp)||1;seeded=true;}\n    }", 'verified trade seed')

old_reset="""  function resetHistoryForFullResync() {
    stripSyncRunMarkers();
    state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.itemConsumptions=[];state.unrecognizedFinancial=[];
    save('transactions',[]);save('cashFlows',[]);save('playerTransfers',[]);save('itemConsumptions',[]);save('unrecognizedFinancial',[]);
"""
new_reset="""  function resetHistoryForFullResync() {
    stripSyncRunMarkers();
    const companyRows=(state.cashFlows||[]).filter(x=>x?.category==='Company Profit / Loss'||x?.source==='Company Daily Adjustment');
    state.transactions=[];state.cashFlows=companyRows;state.playerTransfers=[];state.playerTrades=[];state.itemConsumptions=[];state.unrecognizedFinancial=[];
    save('transactions',[]);save('cashFlows',companyRows);save('playerTransfers',[]);save('playerTrades',[]);save('itemConsumptions',[]);save('unrecognizedFinancial',[]);
"""
one(old_reset,new_reset,'preserve company PL on full resync')

one("data:{transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,itemConsumptions:state.itemConsumptions", "data:{transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,playerTrades:state.playerTrades,itemConsumptions:state.itemConsumptions", 'backup playerTrades')
one("const keys=['transactions','cashFlows','playerTransfers','itemConsumptions'", "const keys=['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions'", 'import playerTrades')

# Net Worth: skip item-level Player Trade rows when a summary exists, then add one combined trade row.
one("    const latestTotal=Number(latest?.networth?.total),baselineTotal=Number(baseline?.networth?.total);const delta=Number.isFinite(latestTotal)&&Number.isFinite(baselineTotal)&&latest!==baseline?latestTotal-baselineTotal:null,rows=[];let companyNet=0,companySeen=false;\n    for(const t of state.transactions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to||Number(t?.logId)===4103)continue;", "    const latestTotal=Number(latest?.networth?.total),baselineTotal=Number(baseline?.networth?.total);const delta=Number.isFinite(latestTotal)&&Number.isFinite(baselineTotal)&&latest!==baseline?latestTotal-baselineTotal:null,rows=[];let companyNet=0,companySeen=false;\n    const summarizedTradeIds=new Set((state.playerTrades||[]).map(x=>Number(x?.id)||0).filter(Boolean));\n    for(const t of state.transactions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to||Number(t?.logId)===4103||(t?.source==='Player Trade'&&summarizedTradeIds.has(Number(t.tradeId)||0)))continue;", 'skip summarized player trade item rows')
one("    for(const t of state.playerTransfers||[]){", "    for(const tr of state.playerTrades||[]){const ts=Number(tr?.timestamp)||0;if(ts<from||ts>to)continue;const row=playerTradeNetWorthRow(tr);if(row)rows.push(row);}\n    for(const t of state.playerTransfers||[]){", 'add combined player trade NW rows')

sub(r"    for\(const x of state\.cashFlows\|\|\[\]\)\{[^\n]*\}\n    rows\.sort", """    for(const x of state.cashFlows||[]){
      const ts=Number(x?.timestamp)||0;if(ts<from||ts>to||x?.transfer||String(x?.direction||'').startsWith('transfer')||isNonCashCompanyAdminLog(x?.title,x?.logId))continue;
      const amount=Math.max(0,Number(x?.amount)||0);if(!(amount>0))continue;const incoming=x.direction==='in',isCompany=x.category==='Company Profit / Loss'||x.source==='Company Daily Adjustment',nw=netWorthCashEventImpact(x);if(isCompany){companySeen=true;companyNet+=incoming?amount:-amount;}
      const companyMeta=isCompany?`Company daily adjustment \\u00B7 Gross ${money(x.grossIncome)} \\u00B7 Wages ${money(x.wages)} \\u00B7 Advertising ${money(x.advertisementBudget)}`:`${x.category||'Cash'} \\u00B7 ${x.source||'Torn Log'}${nw.meta?` \\u00B7 ${nw.meta}`:''}`;
      const impact=nw.known?Number(nw.impact)||0:null;rows.push({timestamp:ts,kind:isCompany?'company-pl':(incoming?'money-in':'money-out'),icon:isCompany?'\\u25A3':(incoming?'\\u2191':'\\u2193'),title:x.title||x.category||(incoming?'Money received':'Money spent'),meta:companyMeta,value:nw.known?Math.abs(impact):0,valueClass:nw.known?(impact>=0?'pos':'neg'):'',prefix:nw.known?(impact>=0?'+':'-'):'',impact,impactKnown:nw.known});
    }
    for(const u of state.unrecognizedFinancial||[]){const ts=Number(u?.timestamp)||0;if(ts<from||ts>to||isNonCashCompanyAdminLog(u?.title,u?.logId))continue;rows.push({timestamp:ts,kind:'unclassified-financial',icon:'?',title:u.title||'Unclassified financial event',meta:`Not included in detected movement \\u00B7 ${u.field||'money field'} ${money(u.amount||0)}`,value:0,valueClass:'',prefix:'',impact:null,impactKnown:false});}
    rows.sort""",'conservative NW cash loop')

# More accurate Full Resync ETA: measure actual request durations and use exact remaining trade detail count; historical page depth is learned before showing ETA.
progress_helpers=r'''  function recordSyncRequestSample(job,kind,startedAt){if(!job||job.syncMode!=='full')return;const ms=Math.min(60000,Math.max(1,Date.now()-Number(startedAt||Date.now()))+REQUEST_GAP_MS),bag=job.progressRequestSamples||(job.progressRequestSamples={}),arr=Array.isArray(bag[kind])?bag[kind]:[];arr.push(ms);if(arr.length>12)arr.shift();bag[kind]=arr;}
  function syncRequestAverage(job,kind,fallback=1400){const a=job?.progressRequestSamples?.[kind];return Array.isArray(a)&&a.length?a.reduce((n,x)=>n+Number(x||0),0)/a.length:fallback;}
  function projectedFullResyncEta(job){if(!job||job.syncMode!=='full')return null;const phase=String(job.phase||''),d=job.diagnostics||{},avgLog=syncRequestAverage(job,'log'),avgTradeList=syncRequestAverage(job,'trade-list'),avgTrade=syncRequestAverage(job,'trade-detail',1800),avgAbroad=syncRequestAverage(job,'abroad');if(phase==='trade-details'){const remain=Math.max(0,(job.tradeHeaders||[]).length-(Number(job.tradeDetailIndex)||0));return remain*avgTrade+2500;}if(phase==='finalize')return 1200;if(phase==='trades-list'){const seen=Math.max(1,Number(d.tradeListPages)||0);const projected=Math.max(seen+1,Math.ceil(seen*1.25));return Math.max(1,projected-seen)*avgTradeList+Math.max(0,(job.tradeHeaders||[]).length)*avgTrade+3000;}if(phase==='logs-abroad-verify'){const seen=Math.max(0,Number(d.abroadVerifyPages)||0);return Math.max(1,Math.ceil((seen||1)*.35))*avgAbroad+4*avgTradeList+3000;}if(phase==='logs-filtered'||phase==='logs-fallback'){const batches=Math.max(1,Number(d.batches)||Math.ceil((job.logTypeIds||[]).length/MAX_LOG_IDS_PER_REQUEST)||1),batch=Math.max(0,Number(job.logBatchIndex)||0),pages=Math.max(0,Number(d.pages)||0);if(batch<1&&pages<4)return null;const completedEquivalent=Math.max(1,batch+(Number(job.logPage)||0>0?.5:0)),pagesPerBatch=Math.max(1,pages/completedEquivalent),remainingBatches=Math.max(0,batches-batch),currentPage=Math.max(0,Number(job.logPage)||0),remainingPages=Math.max(1,remainingBatches*pagesPerBatch-currentPage);return remainingPages*avgLog+3*avgAbroad+4*avgTradeList+5000;}return null;}
'''
one('  function fullResyncProgressMetrics(job) {',progress_helpers+'\n  function fullResyncProgressMetrics(job) {','ETA helpers')
one("    const active=Math.max(0,Number(job.progressActiveMs)||0);let eta=null;\n    if(pct>=3&&active>=2500&&pct<99){const raw=active*((100-pct)/pct),prev=Number(job.progressEtaMs)||0;eta=prev>0?(prev*.65+raw*.35):raw;job.progressEtaMs=eta;}", "    const active=Math.max(0,Number(job.progressActiveMs)||0);let eta=projectedFullResyncEta(job);\n    if(eta!=null&&pct<99){const prev=Number(job.progressEtaMs)||0;eta=prev>0?(prev*.45+eta*.55):eta;job.progressEtaMs=eta;}else if(eta==null&&active>=2500&&pct>=84&&pct<99){const raw=active*((100-pct)/pct),prev=Number(job.progressEtaMs)||0;eta=prev>0?(prev*.45+raw*.55):raw;job.progressEtaMs=eta;}", 'replace ETA formula')

# Record request timings at the main expensive API calls.
one("      const data=await syncApiGet('/user/log',params),rows=Array.isArray(data?.log)?data.log:[];", "      const requestStarted=Date.now(),data=await syncApiGet('/user/log',params);recordSyncRequestSample(job,'log',requestStarted);const rows=Array.isArray(data?.log)?data.log:[];", 'time log requests')
one("      const data=await syncApiGet('/user/log',{limit:100,log:'4201',from:verifyFrom,to:cursor}),rows=Array.isArray(data?.log)?data.log:[];", "      const requestStarted=Date.now(),data=await syncApiGet('/user/log',{limit:100,log:'4201',from:verifyFrom,to:cursor});recordSyncRequestSample(job,'abroad',requestStarted);const rows=Array.isArray(data?.log)?data.log:[];", 'time abroad requests')
one("      const data=await syncApiGet('/user/trades',params),rows=Array.isArray(data?.trades)?data.trades:[];job.diagnostics.tradeListPages=page;", "      const requestStarted=Date.now(),data=await syncApiGet('/user/trades',params);recordSyncRequestSample(job,'trade-list',requestStarted);const rows=Array.isArray(data?.trades)?data.trades:[];job.diagnostics.tradeListPages=page;", 'time trade list requests')

# Initialize request samples on new jobs.
one("progressEtaMs:0};", "progressEtaMs:0,progressRequestSamples:{}};", 'new job timing samples')

# Add playerTrades to common reset/import clear sequence if present.
s=s.replace("state.playerTransfers=[];state.itemConsumptions=[];", "state.playerTransfers=[];state.playerTrades=[];state.itemConsumptions=[];")
s=s.replace("save('playerTransfers',[]);save('itemConsumptions',[]);", "save('playerTransfers',[]);save('playerTrades',[]);save('itemConsumptions',[]);")

# Sanity checks.
required=["@version      0.2.45","const VERSION = '0.2.45'","playerTrades: load('playerTrades', [])","parsePlayerTradeSummary","checkpointPlayerTradeSummary(summary)","isNonCashCompanyAdminLog","playerTradeNetWorthRow","projectedFullResyncEta","progressRequestSamples","Company Profit / Loss"]
for token in required:
    if token not in s:raise SystemExit('missing '+token)
if any(ord(ch)>127 for ch in s):raise SystemExit('runtime is no longer ASCII-safe')
p.write_text(s,encoding='ascii')
print('patched v0.2.45')
