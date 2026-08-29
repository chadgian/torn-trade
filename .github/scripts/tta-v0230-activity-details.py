from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

s=s.replace('// @version      0.2.29','// @version      0.2.30',1)
s=s.replace("const VERSION = '0.2.29';","const VERSION = '0.2.30';",1)

old_func=r'''  function transactionCashFlows() {
    const out=[],seenTrades=new Set();
    for(const t of state.transactions||[]){
      const ts=Number(t?.timestamp)||0;if(!(ts>0))continue;
      if(t.source==='Player Trade'){
        const tradeId=Number(t.tradeId)||0;if(!(tradeId>0)||seenTrades.has(tradeId))continue;seenTrades.add(tradeId);
        const cashIn=Math.max(0,Number(t.tradeCashIn)||0),cashOut=Math.max(0,Number(t.tradeCashOut)||0);
        if(cashIn>0)out.push({id:`tradecash:${tradeId}:in`,timestamp:ts,direction:'in',amount:cashIn,category:'Player Trades',source:'Player Trade',title:t.title||`Player Trade #${tradeId}`,transfer:false});
        if(cashOut>0)out.push({id:`tradecash:${tradeId}:out`,timestamp:ts,direction:'out',amount:cashOut,category:'Player Trades',source:'Player Trade',title:t.title||`Player Trade #${tradeId}`,transfer:false});
        continue;
      }
      const total=Math.max(0,Number(t.total)||0),fee=Math.max(0,Number(t.fee)||0);
      if(t.side==='buy'&&total>0)out.push({id:`txcash:${t.id}:buy`,timestamp:ts,direction:'out',amount:total,category:t.source==='Foreign Market'?'Travel Trading':'Item Purchases',source:t.source||'Item purchase',title:t.title||`${t.source||'Item'} purchase`,transfer:false,itemId:Number(t.itemId)||0});
      if(t.side==='sell'&&total>0)out.push({id:`txcash:${t.id}:sell`,timestamp:ts,direction:'in',amount:total,category:'Item Sales',source:t.source||'Item sale',title:t.title||`${t.source||'Item'} sale`,transfer:false,itemId:Number(t.itemId)||0});
      if(t.side==='sell'&&fee>0)out.push({id:`txcash:${t.id}:fee`,timestamp:ts,direction:'out',amount:fee,category:'Fees / Taxes',source:t.source||'Sale fee',title:`${t.title||'Item sale'} fee`,transfer:false,itemId:Number(t.itemId)||0});
    }
    return out;
  }
'''
new_func=r'''  function transactionItemDetail(t) {
    const id=Number(t?.itemId)||0,q=Math.max(0,Number(t?.qty)||0);if(!(id>0)||!(q>0))return '';
    return `${qty(q)} x ${catalogItem(id).name}`;
  }
  function compactTransactionItems(rows,side) {
    const labels=[...new Set((rows||[]).filter(t=>t?.side===side).map(transactionItemDetail).filter(Boolean))];
    if(!labels.length)return '';
    const shown=labels.slice(0,3);return `${shown.join(', ')}${labels.length>3?` +${labels.length-3} more`:''}`;
  }
  function playerTradeItemDetail(rows) {
    const gave=compactTransactionItems(rows,'sell'),received=compactTransactionItems(rows,'buy'),parts=[];
    if(gave)parts.push(`Gave ${gave}`);if(received)parts.push(`Received ${received}`);return parts.join(' \u00B7 ');
  }
  function flowDetailText(x) {
    const explicit=String(x?.detail||'').trim();if(explicit)return explicit;
    const id=Number(x?.itemId)||0,q=Math.max(0,Number(x?.qty)||0);return id>0&&q>0?`${qty(q)} x ${catalogItem(id).name}`:'';
  }
  function flowActivityLabel(x) {
    const base=String(x?.title||x?.category||'Financial activity'),detail=flowDetailText(x);return detail?`${base} \u00B7 ${detail}`:base;
  }
  function transactionCashFlows() {
    const out=[],seenTrades=new Set(),transactions=state.transactions||[],tradeRows=new Map();
    for(const t of transactions){if(t?.source!=='Player Trade')continue;const id=Number(t.tradeId)||0;if(!(id>0))continue;const rows=tradeRows.get(id)||[];rows.push(t);tradeRows.set(id,rows);}
    for(const t of transactions){
      const ts=Number(t?.timestamp)||0;if(!(ts>0))continue;
      if(t.source==='Player Trade'){
        const tradeId=Number(t.tradeId)||0;if(!(tradeId>0)||seenTrades.has(tradeId))continue;seenTrades.add(tradeId);
        const cashIn=Math.max(0,Number(t.tradeCashIn)||0),cashOut=Math.max(0,Number(t.tradeCashOut)||0),detail=playerTradeItemDetail(tradeRows.get(tradeId)||[t]);
        if(cashIn>0)out.push({id:`tradecash:${tradeId}:in`,timestamp:ts,direction:'in',amount:cashIn,category:'Player Trades',source:'Player Trade',title:t.title||`Player Trade #${tradeId}`,detail,transfer:false,tradeId});
        if(cashOut>0)out.push({id:`tradecash:${tradeId}:out`,timestamp:ts,direction:'out',amount:cashOut,category:'Player Trades',source:'Player Trade',title:t.title||`Player Trade #${tradeId}`,detail,transfer:false,tradeId});
        continue;
      }
      const total=Math.max(0,Number(t.total)||0),fee=Math.max(0,Number(t.fee)||0),itemId=Number(t.itemId)||0,itemName=itemId>0?catalogItem(itemId).name:'',itemQty=Math.max(0,Number(t.qty)||0),detail=transactionItemDetail(t);
      const common={transfer:false,itemId,itemName,qty:itemQty,detail};
      if(t.side==='buy'&&total>0)out.push({id:`txcash:${t.id}:buy`,timestamp:ts,direction:'out',amount:total,category:t.source==='Foreign Market'?'Travel Trading':'Item Purchases',source:t.source||'Item purchase',title:t.title||`${t.source||'Item'} purchase`,...common});
      if(t.side==='sell'&&total>0)out.push({id:`txcash:${t.id}:sell`,timestamp:ts,direction:'in',amount:total,category:'Item Sales',source:t.source||'Item sale',title:t.title||`${t.source||'Item'} sale`,...common});
      if(t.side==='sell'&&fee>0)out.push({id:`txcash:${t.id}:fee`,timestamp:ts,direction:'out',amount:fee,category:'Fees / Taxes',source:t.source||'Sale fee',title:`${t.title||'Item sale'} fee`,...common});
    }
    return out;
  }
'''
if old_func not in s: raise SystemExit('transactionCashFlows anchor missing')
s=s.replace(old_func,new_func,1)

old_rows=r'''  function cashFlowRowsHtml(rows,limit=200){return rows.slice(0,limit).map(x=>`<tr><td><span class="tta-flowtitle">${esc(x.title||x.category)}</span><span class="tta-flowmeta">${esc(tctDateTimeStr(x.timestamp))} TCT \u00B7 ${esc(x.source||x.category)}</span></td><td><span class="tta-flowbadge ${x.direction.startsWith('transfer')?'transfer':x.direction}">${x.direction.startsWith('transfer')?'Transfer':x.direction==='in'?'Incoming':'Outgoing'}</span></td><td>${esc(x.category)}</td><td class="num ${x.direction==='in'?'pos':x.direction==='out'?'neg':'tta-transfer'}">${x.direction==='in'?'+':x.direction==='out'?'-':'\u2194 '}${money(x.amount)}</td></tr>`).join('')||'<tr><td colspan="4"><div class="tta-empty">No recognized cash flows match this period.</div></td></tr>';}
'''
new_rows=r'''  function cashFlowRowsHtml(rows,limit=200){return rows.slice(0,limit).map(x=>{const detail=flowDetailText(x);return `<tr><td><span class="tta-flowtitle">${esc(x.title||x.category)}</span>${detail?`<span class="tta-flowmeta">${esc(detail)}</span>`:''}<span class="tta-flowmeta">${esc(tctDateTimeStr(x.timestamp))} TCT \u00B7 ${esc(x.source||x.category)}</span></td><td><span class="tta-flowbadge ${x.direction.startsWith('transfer')?'transfer':x.direction}">${x.direction.startsWith('transfer')?'Transfer':x.direction==='in'?'Incoming':'Outgoing'}</span></td><td>${esc(x.category)}</td><td class="num ${x.direction==='in'?'pos':x.direction==='out'?'neg':'tta-transfer'}">${x.direction==='in'?'+':x.direction==='out'?'-':'\u2194 '}${money(x.amount)}</td></tr>`;}).join('')||'<tr><td colspan="4"><div class="tta-empty">No recognized cash flows match this period.</div></td></tr>';}
'''
if old_rows not in s: raise SystemExit('cashFlowRowsHtml anchor missing')
s=s.replace(old_rows,new_rows,1)

old_search="""if(q)rows=rows.filter(x=>`${x.title} ${x.category} ${x.source} ${x.counterpartyName||''} ${x.counterpartyId||''}`.toLowerCase().includes(q));"""
new_search="""if(q)rows=rows.filter(x=>`${x.title} ${flowDetailText(x)} ${x.itemName||''} ${x.itemId||''} ${x.category} ${x.source} ${x.counterpartyName||''} ${x.counterpartyId||''}`.toLowerCase().includes(q));"""
if old_search not in s: raise SystemExit('cash search anchor missing')
s=s.replace(old_search,new_search,1)

old_largest="""const largestSpend=spend.largest?`${spend.largest.title||spend.largest.category} \\u00B7 ${money(spend.largest.amount)}`:'\\u2014',largestIncome=income.largest?`${income.largest.title||income.largest.category} \\u00B7 ${money(income.largest.amount)}`:'\\u2014';"""
new_largest="""const largestSpend=spend.largest?`${flowActivityLabel(spend.largest)} \\u00B7 ${money(spend.largest.amount)}`:'\\u2014',largestIncome=income.largest?`${flowActivityLabel(income.largest)} \\u00B7 ${money(income.largest.amount)}`:'\\u2014';"""
if old_largest not in s: raise SystemExit('insights largest anchor missing')
s=s.replace(old_largest,new_largest,1)

old_csv="""function exportCashCsv(){const rows=allCashFlows(),head=['Timestamp TCT','Direction','Category','Title','Source','Amount','Counterparty ID','Counterparty'];const body=rows.map(x=>[tctDateTimeStr(x.timestamp),x.direction,x.category,x.title,x.source,x.amount,x.counterpartyId||'',x.counterpartyName||'']);"""
new_csv="""function exportCashCsv(){const rows=allCashFlows(),head=['Timestamp TCT','Direction','Category','Title','Details','Source','Amount','Item ID','Quantity','Counterparty ID','Counterparty'];const body=rows.map(x=>[tctDateTimeStr(x.timestamp),x.direction,x.category,x.title,flowDetailText(x),x.source,x.amount,x.itemId||'',x.qty||'',x.counterpartyId||'',x.counterpartyName||'']);"""
if old_csv not in s: raise SystemExit('CSV anchor missing')
s=s.replace(old_csv,new_csv,1)

old_help="""<h3>Cash Flow</h3><p>Shows recognized money coming in and going out, grouped into useful categories. Search and filter the ledger to inspect individual events. Internal transfers are excluded from earned/spent totals.</p>"""
new_help="""<h3>Cash Flow</h3><p>Shows recognized money coming in and going out, grouped into useful categories. Item-related rows also show the item name and quantity when available. Search and filter the ledger to inspect individual events. Internal transfers are excluded from earned/spent totals.</p>"""
if old_help not in s: raise SystemExit('help anchor missing')
s=s.replace(old_help,new_help,1)

if any(ord(ch)>=128 for ch in s): raise SystemExit('Non-ASCII characters introduced')
for required in ["function transactionItemDetail", "function flowDetailText", "playerTradeItemDetail", "Details','Source','Amount','Item ID','Quantity", "${flowDetailText(x)}"]:
    if required not in s: raise SystemExit('missing '+required)

p.write_text(s,encoding='ascii')
