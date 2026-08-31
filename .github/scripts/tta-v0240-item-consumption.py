from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

def rep(old,new,label):
    global s
    if old not in s:
        raise SystemExit(f'missing anchor: {label}')
    s=s.replace(old,new,1)

rep('// @version      0.2.39','// @version      0.2.40','version header')
rep("const VERSION = '0.2.39';","const VERSION = '0.2.40';",'version const')
rep("    playerTransfers: load('playerTransfers', []),\n","    playerTransfers: load('playerTransfers', []),\n    itemConsumptions: load('itemConsumptions', []),\n",'state consumptions')

rep("|| itemMovement.test(title) || freeContext.test(title)","|| itemMovement.test(title) || /^item use\\b/i.test(title) || freeContext.test(title)",'item use discovery')

marker="  function unrecognizedRowFor(entry) {\n"
insert=r'''  function itemUseTitle(title) { return /^item use\b/i.test(String(title||'')); }
  function consumedItemsFromPayload(payload) {
    payload=payload||{};const out=[],seen=new Set();
    const add=(id,q=1)=>{id=Number(id);q=Math.max(1,Number(q)||1);if(!(id>0)||seen.has(id))return;seen.add(id);out.push({id,qty:q});};
    const read=(v,fallbackQty=1)=>{
      if(v==null)return;
      if(typeof v==='number'||(typeof v==='string'&&/^\d+$/.test(v))){add(v,fallbackQty);return;}
      if(typeof v!=='object')return;
      const id=Number(v.id??v.item_id??v.itemid??v.itemID??v.itemId),q=Number(v.qty??v.quantity??v.amount??v.count??fallbackQty)||1;
      if(id>0)add(id,q);
    };
    const fallbackQty=Number(payload.qty??payload.quantity??payload.amount??payload.count)||1;
    read(payload.item,fallbackQty);read(payload.item_used,fallbackQty);read(payload.used_item,fallbackQty);read(payload.consumed_item,fallbackQty);
    for(const k of ['item_id','itemid','itemId','used_item_id','item_used_id','consumed_item_id'])if(payload[k]!=null)add(payload[k],fallbackQty);
    if(!out.length){const normalized=normalizeItems(payload);if(normalized.length)add(normalized[0].id,normalized[0].qty);}
    return out;
  }
  function parseItemConsumptionEntry(entry) {
    const title=String(entry?.details?.title||'');if(!itemUseTitle(title))return[];
    const payload={...(entry?.params||{}),...(entry?.data||{})},items=consumedItemsFromPayload(payload),logTypeId=Number(entry?.details?.id)||0;
    return items.map((x,i)=>({id:`consume:${entry.id}:${x.id}:${i}`,timestamp:Number(entry?.timestamp)||0,itemId:Number(x.id),qty:Number(x.qty)||1,logId:logTypeId,title,source:'Item Use',useType:title.replace(/^item use\s*/i,'').trim()||'Item'}));
  }
  function checkpointItemConsumptionRows(rows) {
    if(!rows?.length)return 0;const map=new Map((state.itemConsumptions||[]).map(x=>[String(x.id),x]));let added=0;
    for(const row of rows){if(!row?.id||map.has(String(row.id)))continue;map.set(String(row.id),row);added++;}
    if(added){state.itemConsumptions=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)).slice(-10000);save('itemConsumptions',state.itemConsumptions);resetAnalyticsCache();}return added;
  }
'''
rep(marker,insert+marker,'consumption parser')

rep("const transferRows=parsePlayerTransferEntry(r);job.diagnostics.playerTransferRows=(Number(job.diagnostics.playerTransferRows)||0)+transferRows.length;checkpointPlayerTransferRows(transferRows);\n        const cashRows=parseCashFlowEntry(r,parsed);", "const transferRows=parsePlayerTransferEntry(r);job.diagnostics.playerTransferRows=(Number(job.diagnostics.playerTransferRows)||0)+transferRows.length;checkpointPlayerTransferRows(transferRows);\n        const consumptionRows=parseItemConsumptionEntry(r);job.diagnostics.itemConsumptionRows=(Number(job.diagnostics.itemConsumptionRows)||0)+consumptionRows.length;checkpointItemConsumptionRows(consumptionRows);\n        const cashRows=parseCashFlowEntry(r,parsed);", 'sync consumption')
rep("cashRows.length>0||transferRows.length>0||parsed.length>0","cashRows.length>0||transferRows.length>0||consumptionRows.length>0||parsed.length>0",'handled consumption')

rep("state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.unrecognizedFinancial=[];\n    save('transactions',[]);save('cashFlows',[]);save('playerTransfers',[]);save('unrecognizedFinancial',[]);", "state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.itemConsumptions=[];state.unrecognizedFinancial=[];\n    save('transactions',[]);save('cashFlows',[]);save('playerTransfers',[]);save('itemConsumptions',[]);save('unrecognizedFinancial',[]);", 'full reset consumption')
rep("'transactions','cashFlows','playerTransfers','unrecognizedFinancial'","'transactions','cashFlows','playerTransfers','itemConsumptions','unrecognizedFinancial'",'reset keys')
rep("state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.unrecognizedFinancial=[];","state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.itemConsumptions=[];state.unrecognizedFinancial=[];",'reset state')

rep("data:{transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,unrecognizedFinancial:","data:{transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,itemConsumptions:state.itemConsumptions,unrecognizedFinancial:",'backup consumption')
rep("const keys=['transactions','cashFlows','playerTransfers','unrecognizedFinancial'","const keys=['transactions','cashFlows','playerTransfers','itemConsumptions','unrecognizedFinancial'",'import consumption')

old="""    const sent=(state.playerTransfers||[]).filter(x=>x?.type==='item'&&x?.direction==='out'&&Number(x.itemId)===id&&Number(x.qty)>0).map(x=>({...x,id:`transfer:${x.id}`,side:'transfer-out',total:0,netTotal:0,source:'Player Transfer'}));\n    const timeline=[...tx,...sent].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)||String(a.id).localeCompare(String(b.id)));"""
new="""    const sent=(state.playerTransfers||[]).filter(x=>x?.type==='item'&&x?.direction==='out'&&Number(x.itemId)===id&&Number(x.qty)>0).map(x=>({...x,id:`transfer:${x.id}`,side:'transfer-out',total:0,netTotal:0,source:'Player Transfer'}));\n    const consumed=(state.itemConsumptions||[]).filter(x=>Number(x.itemId)===id&&Number(x.qty)>0).map(x=>({...x,id:`consume:${x.id}`,side:'consume-out',total:0,netTotal:0,source:'Item Use'}));\n    const timeline=[...tx,...sent,...consumed].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)||String(a.id).localeCompare(String(b.id)));"""
rep(old,new,'fifo timeline')
rep("}else if(t.side==='transfer-out'){\n        const c=consume(t.qty);events.push({...t,costBasis:c.basis,realizedProfit:0,matchedQty:c.matched,unmatchedQty:c.remain,transferredQty:c.matched});", "}else if(t.side==='transfer-out'||t.side==='consume-out'){\n        const c=consume(t.qty);events.push({...t,costBasis:c.basis,realizedProfit:0,matchedQty:c.matched,unmatchedQty:c.remain,transferredQty:t.side==='transfer-out'?c.matched:0,consumedQty:t.side==='consume-out'?c.matched:0});", 'fifo consume branch')

rep("const itemIds=new Set(idx.itemIds);for(const t of state.playerTransfers||[])if(t?.type==='item'&&t?.direction==='out'&&Number(t.itemId)>0)itemIds.add(Number(t.itemId));", "const itemIds=new Set(idx.itemIds);for(const t of state.playerTransfers||[])if(t?.type==='item'&&t?.direction==='out'&&Number(t.itemId)>0)itemIds.add(Number(t.itemId));for(const t of state.itemConsumptions||[])if(Number(t?.itemId)>0)itemIds.add(Number(t.itemId));", 'ledger item ids')
old="""      const tx=idx.byItem.get(itemId)||[],sent=(state.playerTransfers||[]).filter(x=>x?.type==='item'&&x?.direction==='out'&&Number(x.itemId)===Number(itemId)&&Number(x.qty)>0).map(x=>({...x,id:`transfer:${x.id}`,side:'transfer-out',source:'Player Transfer'}));\n      const timeline=[...tx,...sent].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)||String(a.id).localeCompare(String(b.id))),lots=[];let lotHead=0;"""
new="""      const tx=idx.byItem.get(itemId)||[],sent=(state.playerTransfers||[]).filter(x=>x?.type==='item'&&x?.direction==='out'&&Number(x.itemId)===Number(itemId)&&Number(x.qty)>0).map(x=>({...x,id:`transfer:${x.id}`,side:'transfer-out',source:'Player Transfer'})),consumed=(state.itemConsumptions||[]).filter(x=>Number(x.itemId)===Number(itemId)&&Number(x.qty)>0).map(x=>({...x,id:`consume:${x.id}`,side:'consume-out',source:'Item Use'}));\n      const timeline=[...tx,...sent,...consumed].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)||String(a.id).localeCompare(String(b.id))),lots=[];let lotHead=0;"""
rep(old,new,'ledger timeline')
rep("transferredQty:0,soldProceeds:0","transferredQty:0,consumedQty:0,soldProceeds:0",'ledger consumed qty')
rep("lastTransferredAt:0,saleSources:[]","lastTransferredAt:0,lastConsumedAt:0,saleSources:[]",'ledger consumed time')
rep("}else if(t.side==='sell'||t.side==='transfer-out'){\n          let remain=q;const isSale=t.side==='sell',net=isSale?Math.max(0,Number(t.netTotal??t.total)||0):0,saleUnit=isSale&&q?net/q:0;", "}else if(t.side==='sell'||t.side==='transfer-out'||t.side==='consume-out'){\n          let remain=q;const isSale=t.side==='sell',isConsume=t.side==='consume-out',net=isSale?Math.max(0,Number(t.netTotal??t.total)||0):0,saleUnit=isSale&&q?net/q:0;", 'ledger consume branch')
rep("else{row.transferredQty+=take;if(at>row.lastTransferredAt)row.lastTransferredAt=at;}","else if(isConsume){row.consumedQty+=take;if(at>row.lastConsumedAt)row.lastConsumedAt=at;}else{row.transferredQty+=take;if(at>row.lastTransferredAt)row.lastTransferredAt=at;}",'ledger consume accounting')
rep("row.unsoldQty=Math.max(0,row.qty-row.soldQty-row.transferredQty);row.status=row.unsoldQty<=1e-9?(row.soldQty>1e-9?'sold':'transferred'):(row.soldQty>1e-9||row.transferredQty>1e-9?'partial':'unsold');", "row.unsoldQty=Math.max(0,row.qty-row.soldQty-row.transferredQty-row.consumedQty);row.status=row.unsoldQty<=1e-9?(row.soldQty>=row.qty-1e-9?'sold':row.consumedQty>=row.qty-1e-9?'consumed':row.transferredQty>=row.qty-1e-9?'transferred':'depleted'):(row.soldQty>1e-9||row.transferredQty>1e-9||row.consumedQty>1e-9?'partial':'unsold');", 'ledger status')
rep("transferText=row.transferredQty>0?` \\u00B7 Sent ${qty(row.transferredQty)}${row.lastTransferredAt?` (${dateTimeStr(row.lastTransferredAt)})`:''}`:'';", "transferText=row.transferredQty>0?` \\u00B7 Sent ${qty(row.transferredQty)}${row.lastTransferredAt?` (${dateTimeStr(row.lastTransferredAt)})`:''}`:'',consumeText=row.consumedQty>0?` \\u00B7 Used ${qty(row.consumedQty)}${row.lastConsumedAt?` (${dateTimeStr(row.lastConsumedAt)})`:''}`:'';", 'ledger display consumed')
rep("row.status==='transferred'?'Transferred':row.status==='partial'?'Partial':'Unsold'","row.status==='transferred'?'Transferred':row.status==='consumed'?'Consumed':row.status==='depleted'?'Depleted':row.status==='partial'?'Partial':'Unsold'",'ledger status label')
rep("${esc(transferText)}</small>","${esc(transferText)}${esc(consumeText)}</small>",'ledger consume text')
rep("<option value=\"unsold\" ${state.ledgerStatus==='unsold'?'selected':''}>Unsold</option>","<option value=\"unsold\" ${state.ledgerStatus==='unsold'?'selected':''}>Unsold</option><option value=\"consumed\" ${state.ledgerStatus==='consumed'?'selected':''}>Consumed</option><option value=\"depleted\" ${state.ledgerStatus==='depleted'?'selected':''}>Depleted</option>",'ledger filters')
rep(".tta-statuspill.transferred{background:#13283a;border-color:#365a74;color:var(--tta-blue)}", ".tta-statuspill.transferred{background:#13283a;border-color:#365a74;color:var(--tta-blue)}.tta-statuspill.consumed{background:#302317;border-color:#6d5434;color:var(--tta-yellow)}.tta-statuspill.depleted{background:#2a202a;border-color:#604765;color:#d9b9ff}", 'consumed css')

nw_anchor="""    for(const t of state.playerTransfers||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to||t?.type!=='item')continue;const item=catalogItem(t.itemId),q=Math.max(0,Number(t.qty)||0),market=q*Math.max(0,Number(item.marketPrice)||0),incoming=t.direction==='in',who=t.counterpartyName||((Number(t.counterpartyId)||0)>0?`#${t.counterpartyId}`:'another player');rows.push({timestamp:ts,kind:incoming?'player-item-in':'player-item-out',icon:incoming?'\\u21E3':'\\u21E1',title:`${incoming?'Received':'Sent'} ${qty(q)} \\u00D7 ${item.name}`,meta:`Player transfer ${incoming?'from':'to'} ${who}${t.message?` \\u00B7 ${t.message}`:''}${market?` \\u00B7 Est. value ${money(market)}`:''}`,value:market,valueClass:incoming?'pos':'neg',prefix:incoming?'+':'-'});}\n"""
nw_new=nw_anchor+r'''    for(const t of state.itemConsumptions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to)continue;const item=catalogItem(t.itemId),q=Math.max(0,Number(t.qty)||0);if(!(q>0))continue;const market=q*Math.max(0,Number(item.marketPrice)||0),evt=(fifoAnalytics(t.itemId).events||[]).find(e=>String(e.id)===`consume:${t.id}`),basis=Math.max(0,Number(evt?.costBasis)||0);rows.push({timestamp:ts,kind:'item-consumed',icon:'\u2212',title:`Used ${qty(q)} \u00D7 ${item.name}`,meta:`${t.title||'Item use'}${market?` \u00B7 Est. value removed ${money(market)}`:''}${basis?` \u00B7 FIFO cost basis removed ${money(basis)}`:''}`,value:market||basis,valueClass:'neg',prefix:'-'});}
'''
rep(nw_anchor,nw_new,'net worth consumption activity')

# Help text and disclaimer clarity.
rep("Player money and item transfers are shown as daily changes, sold items include realized FIFO profit/loss", "Player money and item transfers are shown as daily changes, used/consumed items reduce recorded inventory and appear as Net Worth changes, sold items include realized FIFO profit/loss", 'help consumption')
rep("Direct items sent to other players consume the oldest available FIFO lots, reducing inventory/cost basis without creating item-sale profit.", "Direct items sent to other players and items used/consumed consume the oldest available FIFO lots, reducing inventory/cost basis without creating item-sale profit.", 'portfolio note consumption')

# Verification
need=['itemConsumptions: load','parseItemConsumptionEntry','checkpointItemConsumptionRows','consume-out','Used ${qty(q)}','tta-statuspill.consumed','// @version      0.2.40']
for x in need:
    if x not in s: raise SystemExit(f'missing result {x}')
if any(ord(ch)>=128 for ch in s): raise SystemExit('non-ASCII introduced')
p.write_text(s,encoding='ascii')
