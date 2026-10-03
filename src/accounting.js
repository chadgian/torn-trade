  let demoTxCache=null;
  const perfCache={
    txRef:null,byItem:new Map(),lastById:new Map(),itemIds:[],fifo:new Map(),summaries:new Map(),series:new Map(),overall:new Map(),
    catalogRef:null,catalogMap:new Map(),trackedTxRef:null,trackedCatalogRef:null,tracked:[],ledgerTxRef:null,ledgerRows:[],ledgerByItem:new Map(),searchTimer:null,legacySearchTimer:null,ledgerSearchTimer:null
  };

  function resetAnalyticsCache() {
    perfCache.txRef=null;perfCache.byItem=new Map();perfCache.lastById=new Map();perfCache.itemIds=[];
    perfCache.fifo.clear();perfCache.summaries.clear();perfCache.series.clear();perfCache.overall.clear();
    perfCache.trackedTxRef=null;perfCache.trackedCatalogRef=null;perfCache.tracked=[];
    perfCache.ledgerTxRef=null;perfCache.ledgerRows=[];perfCache.ledgerByItem=new Map();
  }

  function effectiveTransactions() {
    if (state.transactions.length || !state.demo) return state.transactions;
    if(!demoTxCache)demoTxCache=demoTransactions();
    return demoTxCache;
  }

  function ensureTxIndex() {
    const tx=effectiveTransactions();
    if(perfCache.txRef===tx)return perfCache;
    const byItem=new Map(),lastById=new Map();
    for(const t of tx){
      const id=Number(t?.itemId);if(!(id>0))continue;
      if(!byItem.has(id))byItem.set(id,[]);
      byItem.get(id).push(t);
      const ts=Number(t?.timestamp)||0;if(ts>(lastById.get(id)||0))lastById.set(id,ts);
    }
    for(const rows of byItem.values())rows.sort((a,b)=>a.timestamp-b.timestamp||String(a.id).localeCompare(String(b.id)));
    perfCache.txRef=tx;perfCache.byItem=byItem;perfCache.lastById=lastById;perfCache.itemIds=[...byItem.keys()];
    perfCache.fifo.clear();perfCache.summaries.clear();perfCache.series.clear();perfCache.overall.clear();
    perfCache.trackedTxRef=null;perfCache.trackedCatalogRef=null;perfCache.tracked=[];
    return perfCache;
  }

  function getCatalogMap() {
    if(perfCache.catalogRef===state.catalog)return perfCache.catalogMap;
    perfCache.catalogRef=state.catalog;
    perfCache.catalogMap=new Map((state.catalog||[]).map(x=>[Number(x.id),x]));
    perfCache.trackedCatalogRef=null;
    return perfCache.catalogMap;
  }

  function catalogItem(id) {
    id=Number(id);
    const found=getCatalogMap().get(id);
    return found || {id,name:`Item #${id}`,type:'Item',image:`https://www.torn.com/images/items/${id}/large.png`,marketPrice:0};
  }

  function effectiveTracked() {
    const idx=ensureTxIndex();
    if(!idx.itemIds.length&&state.demo)return demoTracked();
    if(perfCache.trackedTxRef===idx.txRef&&perfCache.trackedCatalogRef===state.catalog)return perfCache.tracked;
    perfCache.tracked=[...new Set([...idx.itemIds,...state.tracked.map(x=>Number(x.id)).filter(x=>x>0)])].map(catalogItem).sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
    perfCache.trackedTxRef=idx.txRef;perfCache.trackedCatalogRef=state.catalog;
    return perfCache.tracked;
  }

  function periodCacheKey() {
    const r=dateRange();
    return `${state.dateMode}|${state.customFrom}|${state.customTo}|${Math.floor(r.from/60)}|${Math.floor(r.to/60)}`;
  }

  const SORT_OPTIONS=[
    {id:'recent',label:'Recent'},
    {id:'profit',label:'Profit'},
    {id:'acquired',label:'Acquired'},
    {id:'sold',label:'Sold'},
    {id:'name',label:'Name'}
  ];
  function sortLabel(){return SORT_OPTIONS.find(x=>x.id===state.sortMode)?.label||'Recent';}
  function historyItemRows() {
    const q=String(state.itemSearch||'').trim().toLowerCase();
    const pinned=new Set((state.pinnedIds||[]).map(Number));
    const hidden=new Set((state.hiddenIds||[]).map(Number));
    const idx=ensureTxIndex();
    const rows=effectiveTracked()
      .filter(item=>!hidden.has(Number(item.id)) && (!q || item.name.toLowerCase().includes(q) || String(item.id).includes(q)))
      .map(item=>({item,summary:summaryFor(item.id),lastActivity:idx.lastById.get(Number(item.id))||0,pinned:pinned.has(Number(item.id))}))
      .filter(row=>row.summary.events.length>0||state.tracked.some(item=>Number(item.id)===Number(row.item.id)));
    rows.sort((a,b)=>{
      if(a.pinned!==b.pinned)return a.pinned?-1:1;
      let d=0;
      if(state.sortMode==='profit')d=b.summary.profit-a.summary.profit;
      else if(state.sortMode==='acquired')d=b.summary.bought-a.summary.bought;
      else if(state.sortMode==='sold')d=b.summary.sold-a.summary.sold;
      else if(state.sortMode==='name')d=a.item.name.localeCompare(b.item.name);
      else d=b.lastActivity-a.lastActivity;
      return d || a.item.name.localeCompare(b.item.name) || a.item.id-b.item.id;
    });
    return rows;
  }

  function selectedPeriodBounds(nowDate=new Date()) {
    return selectedPeriodBoundsTct(Math.floor(nowDate.getTime()/1000));
  }

  // Torn City Time (TCT) follows Torn's server timestamp. Use UTC calendar boundaries
  // for sync planning so device timezone never decides which Torn day was checked.
  function tctDayStart(ts) { return Math.floor((Number(ts)||0)/86400)*86400; }
  function tctWeekStart(ts) { const d=new Date((Number(ts)||0)*1000),wd=(d.getUTCDay()+6)%7;d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-wd);return Math.floor(d.getTime()/1000); }
  function tctMonthStart(ts) { const d=new Date((Number(ts)||0)*1000);return Math.floor(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)/1000); }
  function nextTctMonthStart(ts) { const d=new Date((Number(ts)||0)*1000);return Math.floor(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000); }
  function tctDateStr(ts) { return new Date((Number(ts)||0)*1000).toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}); }
  function tctDateTimeStr(ts) { return new Date((Number(ts)||0)*1000).toLocaleString(undefined,{timeZone:'UTC',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}); }
  function subtractCalendarMonthTct(serverNow) {
    const d=new Date((Number(serverNow)||0)*1000),day=d.getUTCDate();
    d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);
    const maxDay=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
    d.setUTCDate(Math.min(day,maxDay));return Math.floor(d.getTime()/1000);
  }
  function selectedPeriodBoundsTct(serverNow=nowSec()) {
    serverNow=Math.floor(Number(serverNow)||nowSec());
    let from=0,to=serverNow;
    if(state.dateMode==='7d')from=serverNow-7*86400;
    else if(state.dateMode==='14d')from=serverNow-14*86400;
    else if(state.dateMode==='30d')from=serverNow-30*86400;
    else if(state.dateMode==='custom'){
      if(state.customFrom){const x=Date.parse(state.customFrom+'T00:00:00Z')/1000;if(Number.isFinite(x))from=Math.floor(x);}
      if(state.customTo){const x=Date.parse(state.customTo+'T23:59:59Z')/1000;if(Number.isFinite(x))to=Math.min(to,Math.floor(x));}
    }
    if(!Number.isFinite(from)||from<0)from=0;if(!Number.isFinite(to)||to>serverNow)to=serverNow;
    return {from:Math.floor(from),to:Math.floor(to)};
  }

  function dateRange() {
    const allTx=effectiveTransactions();
    const bounds=selectedPeriodBounds();
    let from=bounds.from,to=bounds.to;
    if(state.dateMode==='all'){from=Infinity;for(const x of allTx){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}for(const x of state.cashFlows||[]){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}if(!Number.isFinite(from))from=0;}
    return {from,to};
  }

  function fifoAnalytics(itemId) {
    const id=Number(itemId),idx=ensureTxIndex();
    if(perfCache.fifo.has(id))return perfCache.fifo.get(id);
    const tx=idx.byItem.get(id)||[];
    const sent=(state.playerTransfers||[]).filter(x=>x?.type==='item'&&x?.direction==='out'&&Number(x.itemId)===id&&Number(x.qty)>0).map(x=>({...x,id:`transfer:${x.id}`,side:'transfer-out',total:0,netTotal:0,source:'Player Transfer'}));
    const consumed=(state.itemConsumptions||[]).filter(x=>Number(x.itemId)===id&&Number(x.qty)>0).map(x=>({...x,id:`consume:${x.id}`,side:'consume-out',total:0,netTotal:0,source:'Item Use'}));
    const result=computeFifo([...tx,...sent,...consumed],catalogItem(id));perfCache.fifo.set(id,result);return result;
  }

  function acquisitionMethod(t) {
    const source=String(t?.source||''),text=`${source} ${t?.title||''}`.toLowerCase();
    if(source==='Player Trade')return 'Player Trade';
    if(/item receive|item received|player transfer/i.test(`${source} ${t?.title||''}`))return 'Player Transfer / Gift';
    if(/crime/.test(text))return 'Crime';
    if(/seasonal gift|christmas|easter|halloween|\bgift\b/.test(text))return 'Gift / Event';
    if(/mission reward|job \/ company reward|job special|company special|event reward|competition reward/.test(text))return 'Reward';
    if(/city find|item.*found|found item/.test(text))return 'City Find';
    if(source==='Foreign Market'||/foreign market|abroad|travel/.test(text))return 'Bought overseas';
    if(source==='Item Market'||/item market/.test(text))return 'Item Market';
    if(source==='Bazaar'||/bazaar/.test(text))return 'Bazaar';
    if(source==='Torn Shop'||/torn shop|item shop/.test(text))return 'Torn Shop';
    if(t?.free)return 'Free / Reward';
    return source||'Other';
  }

  function acquisitionLedgerRows() {
    const idx=ensureTxIndex();
    if(perfCache.ledgerTxRef===idx.txRef)return perfCache.ledgerRows;
    const ledger=[],ledgerByItem=new Map();
    const itemIds=new Set(idx.itemIds);for(const t of state.playerTransfers||[])if(t?.type==='item'&&t?.direction==='out'&&Number(t.itemId)>0)itemIds.add(Number(t.itemId));for(const t of state.itemConsumptions||[])if(Number(t?.itemId)>0)itemIds.add(Number(t.itemId));
    for(const itemId of itemIds){const rows=fifoAnalytics(itemId).ledger;ledger.push(...rows);ledgerByItem.set(Number(itemId),rows);}
    ledger.sort((a,b)=>b.acquiredAt-a.acquiredAt||String(b.id).localeCompare(String(a.id)));perfCache.ledgerTxRef=idx.txRef;perfCache.ledgerRows=ledger;perfCache.ledgerByItem=ledgerByItem;return ledger;
  }

  function ledgerRowsForItem(itemId) {
    acquisitionLedgerRows();return perfCache.ledgerByItem.get(Number(itemId))||[];
  }
  function acquisitionAttributedProfit(itemId,from,to) {
    let profit=0;for(const row of ledgerRowsForItem(itemId)){if(row.acquiredAt>=from&&row.acquiredAt<=to)profit+=Number(row.realizedProfit)||0;}return profit;
  }

  function ledgerRangeBounds() {
    const now=Date.now();
    if(state.ledgerRange==='7d')return {from:Math.floor((now-7*86400e3)/1000),to:Math.floor(now/1000)+60};
    if(state.ledgerRange==='14d')return {from:Math.floor((now-14*86400e3)/1000),to:Math.floor(now/1000)+60};
    if(state.ledgerRange==='30d')return {from:Math.floor((now-30*86400e3)/1000),to:Math.floor(now/1000)+60};
    if(state.ledgerRange==='dashboard')return dateRange();
    return {from:0,to:Number.MAX_SAFE_INTEGER};
  }

  function filteredLedgerRows() {
    const q=String(state.ledgerSearch||'').trim().toLowerCase(),source=String(state.ledgerSource||'all'),status=String(state.ledgerStatus||'all'),range=ledgerRangeBounds();
    const rows=acquisitionLedgerRows().filter(row=>{
      if(row.acquiredAt<range.from||row.acquiredAt>range.to)return false;
      if(source!=='all'&&row.method!==source)return false;
      if(status!=='all'&&row.status!==status)return false;
      if(q){const hay=`${row.itemName} ${row.itemId} ${row.method} ${row.source} ${row.title} ${(row.saleSources||[]).join(' ')}`.toLowerCase();if(!hay.includes(q))return false;}
      return true;
    });
    const key=String(state.ledgerSort||'acquiredAt'),dir=state.ledgerSortDir==='asc'?1:-1;
    rows.sort((a,b)=>{
      let av,bv;
      if(key==='item'){av=a.itemName.toLowerCase();bv=b.itemName.toLowerCase();}
      else if(key==='method'){av=a.method.toLowerCase();bv=b.method.toLowerCase();}
      else if(key==='status'){av=a.status;bv=b.status;}
      else{av=Number(a[key])||0;bv=Number(b[key])||0;}
      let d=typeof av==='string'?av.localeCompare(bv):av-bv;return d*dir||(b.acquiredAt-a.acquiredAt)||a.itemName.localeCompare(b.itemName);
    });
    return rows;
  }

  function ledgerSortArrow(key){return state.ledgerSort===key?(state.ledgerSortDir==='asc'?' \u2191':' \u2193'):'';}
  function ledgerMethodOptions(){return [...new Set(acquisitionLedgerRows().map(x=>x.method).filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
  function ledgerSummary(rows){return {lots:rows.length,qty:rows.reduce((n,x)=>n+x.qty,0),sold:rows.reduce((n,x)=>n+x.soldQty,0),profit:rows.reduce((n,x)=>n+x.realizedProfit,0)};}

  function ledgerRowHtml(row) {
    const saleWhen=row.lastSoldAt?dateTimeStr(row.lastSoldAt):'Not sold yet',saleSources=row.saleSources.length?row.saleSources.join(' \u00B7 '):'',transferText=row.transferredQty>0?` \u00B7 Sent ${qty(row.transferredQty)}${row.lastTransferredAt?` (${dateTimeStr(row.lastTransferredAt)})`:''}`:'',consumeText=row.consumedQty>0?` \u00B7 Used ${qty(row.consumedQty)}${row.lastConsumedAt?` (${dateTimeStr(row.lastConsumedAt)})`:''}`:'';
    const costText=row.costKnown===false?'Unknown':row.free&&row.costTotal<=1e-7?'$0 \u00B7 Free':money(row.costTotal);
    const profitText=row.soldQty>0?money(row.realizedProfit):'\u2014';
    return `<tr role="row">
      <td role="cell" data-label="Date / time"><strong>${esc(dateTimeStr(row.acquiredAt))}</strong></td>
      <td role="cell" data-label="Item" class="tta-ledgeritem"><strong>${esc(row.itemName)}</strong><small>#${row.itemId} \u00B7 ${esc(row.itemType)}</small><small class="tta-ledger-compact-meta">${esc(dateTimeStr(row.acquiredAt))} \u00B7 ${esc(row.method)}</small><small class="tta-ledger-mobile-status"><span class="tta-statuspill ${row.status}">${row.status==='sold'?'Sold':row.status==='transferred'?'Transferred':row.status==='consumed'?'Consumed':row.status==='depleted'?'Depleted':row.status==='partial'?'Partial':'Unsold'}</span> \u00B7 Sold ${qty(row.soldQty)}/${qty(row.qty)}${row.soldQty?' \u00B7 '+esc(money(row.soldProceeds)):''}</small></td>
      <td role="cell" data-label="Qty" class="num">${qty(row.qty)}</td>
      <td role="cell" data-label="Acquired via" class="tta-ledgermethod"><strong>${esc(row.method)}</strong><small>${esc(row.source||row.title||'Recorded acquisition')}</small></td>
      <td role="cell" data-label="Bought for" class="num">${esc(costText)}<br><small>${row.qty?esc(money(row.unitCost))+'/ea':''}</small></td>
      <td role="cell" data-label="Sold qty" class="num">${qty(row.soldQty)} / ${qty(row.qty)}</td>
      <td role="cell" data-label="Sold for" class="num">${row.soldQty?money(row.soldProceeds):'\u2014'}</td>
      <td role="cell" data-label="Profit" class="num ${row.realizedProfit>=0?'pos':'neg'}">${esc(profitText)}</td>
      <td role="cell" data-label="Status" class="tta-ledgerstatus"><span class="tta-statuspill ${row.status}">${row.status==='sold'?'Sold':row.status==='transferred'?'Transferred':row.status==='consumed'?'Consumed':row.status==='depleted'?'Depleted':row.status==='partial'?'Partial':'Unsold'}</span><small class="tta-ledger-hidden-sale">Sold ${qty(row.soldQty)}/${qty(row.qty)}${row.soldQty?' \u00B7 '+esc(money(row.soldProceeds)):''}</small><small>${esc(saleWhen)}${saleSources?` \u00B7 ${esc(saleSources)}`:''}${esc(transferText)}${esc(consumeText)}</small></td>
    </tr>`;
  }

  function ledgerTableBodyHtml(rows) {
    const shown=rows.slice(0,Math.max(1,Number(state.ledgerLimit)||200));
    return shown.length?shown.map(ledgerRowHtml).join(''):'<tr role="row"><td role="cell" colspan="9"><div class="tta-empty">No acquisition lots match the current filters.</div></td></tr>';
  }

  function renderLedgerRows() {
    if(state.view!=='ledger')return;
    const rows=filteredLedgerRows(),sum=ledgerSummary(rows),limit=Math.max(1,Number(state.ledgerLimit)||200),shown=Math.min(limit,rows.length);
    const body=document.getElementById('tta-ledger-body');if(body)body.innerHTML=ledgerTableBodyHtml(rows);
    const meta=document.getElementById('tta-ledger-meta');if(meta)meta.textContent=`Showing ${qty(shown)} of ${qty(rows.length)} acquisition lots`;
    const more=document.getElementById('tta-ledger-more');if(more)more.hidden=shown>=rows.length;
    const lots=document.getElementById('tta-ledger-lots');if(lots)lots.textContent=qty(sum.lots);
    const acquired=document.getElementById('tta-ledger-qty');if(acquired)acquired.textContent=qty(sum.qty);
    const sold=document.getElementById('tta-ledger-sold');if(sold)sold.textContent=qty(sum.sold);
    const profit=document.getElementById('tta-ledger-profit');if(profit){profit.textContent=money(sum.profit,true);profit.className=sum.profit>=0?'pos':'neg';}
    document.querySelectorAll('#tta-root [data-act="ledgerSort"]').forEach(btn=>{const key=btn.dataset.key;btn.classList.toggle('active',state.ledgerSort===key);btn.textContent=`${btn.dataset.label}${ledgerSortArrow(key)}`;});
    const clear=document.querySelector('#tta-root [data-act="clearLedgerSearch"]');if(clear)clear.hidden=!state.ledgerSearch;
  }

  function ledgerHtml() {
    const rows=filteredLedgerRows(),sum=ledgerSummary(rows),methods=ledgerMethodOptions(),limit=Math.max(1,Number(state.ledgerLimit)||200),shown=Math.min(limit,rows.length);
    const sortTh=(key,label)=>`<th scope="col" role="columnheader"><button data-act="ledgerSort" data-key="${key}" data-label="${esc(label)}" class="${state.ledgerSort===key?'active':''}">${esc(label)}${ledgerSortArrow(key)}</button></th>`;
    return `${header('Acquisition History','FIFO lot ledger \u00B7 cached acquisition and sale history',true)}<div class="tta-content">
      <div class="tta-ledgerintro"><div><strong>Acquisition ledger</strong><small>Each row is one recorded acquisition lot. Later sales are matched back to it using the same FIFO method as the dashboard. Realized profit is attributed to this acquisition date, not the later sale date.</small></div></div>
      <div class="tta-ledgerfilters"><div class="tta-searchwrap tta-ledgersearch"><span class="tta-searchglyph">\u2315</span><input id="tta-ledger-search" class="tta-history-search" placeholder="Search item, ID, source or sale method\u2026" value="${esc(state.ledgerSearch||'')}" autocomplete="off"><button class="tta-clearsearch" data-act="clearLedgerSearch" aria-label="Clear ledger search" ${state.ledgerSearch?'':'hidden'}>\u00D7</button></div><select data-ledger-filter="source"><option value="all">All acquisition types</option>${methods.map(x=>`<option value="${esc(x)}" ${state.ledgerSource===x?'selected':''}>${esc(x)}</option>`).join('')}</select><select data-ledger-filter="status"><option value="all" ${state.ledgerStatus==='all'?'selected':''}>All sale statuses</option><option value="sold" ${state.ledgerStatus==='sold'?'selected':''}>Sold</option><option value="partial" ${state.ledgerStatus==='partial'?'selected':''}>Partial</option><option value="unsold" ${state.ledgerStatus==='unsold'?'selected':''}>Unsold</option><option value="consumed" ${state.ledgerStatus==='consumed'?'selected':''}>Consumed</option><option value="depleted" ${state.ledgerStatus==='depleted'?'selected':''}>Depleted</option></select><select data-ledger-filter="range"><option value="all" ${state.ledgerRange==='all'?'selected':''}>All cached history</option><option value="7d" ${state.ledgerRange==='7d'?'selected':''}>Last 7 days</option><option value="14d" ${state.ledgerRange==='14d'?'selected':''}>Last 14 days</option><option value="30d" ${state.ledgerRange==='30d'?'selected':''}>Last 30 days</option><option value="dashboard" ${state.ledgerRange==='dashboard'?'selected':''}>Dashboard period</option></select></div>
      <div class="tta-ledgersummary"><div class="tta-ministat"><small>Acquisition lots</small><b id="tta-ledger-lots">${qty(sum.lots)}</b></div><div class="tta-ministat"><small>Items acquired</small><b id="tta-ledger-qty">${qty(sum.qty)}</b></div><div class="tta-ministat"><small>FIFO units sold</small><b id="tta-ledger-sold">${qty(sum.sold)}</b></div><div class="tta-ministat"><small>Realized profit</small><b id="tta-ledger-profit" class="${sum.profit>=0?'pos':'neg'}">${money(sum.profit,true)}</b></div></div>
      <div class="tta-ledgermeta"><span id="tta-ledger-meta">Showing ${qty(shown)} of ${qty(rows.length)} acquisition lots</span><span>Tap a column heading to sort</span></div>
      <div class="tta-ledgerwrap"><table class="tta-ledgertable tta-compact-table" role="table" aria-label="Acquisition history"><thead role="rowgroup"><tr role="row">${sortTh('acquiredAt','Date / time')}${sortTh('item','Item')}${sortTh('qty','Qty')}${sortTh('method','Acquired via')}${sortTh('costTotal','Bought for')}${sortTh('soldQty','Sold qty')}${sortTh('soldProceeds','Sold for')}${sortTh('realizedProfit','Profit')}${sortTh('status','Status')}</tr></thead><tbody role="rowgroup" id="tta-ledger-body">${ledgerTableBodyHtml(rows)}</tbody></table></div>
      <div class="tta-ledgermore"><button id="tta-ledger-more" class="tta-btn secondary" data-act="ledgerMore" ${shown>=rows.length?'hidden':''}>Load 200 more</button></div>
      <div class="tta-note">For free acquisitions such as crimes, gifts, finds and rewards, cost basis is $0. Player Trade acquisition/sale values use the analyzer's market-value allocation plus the equal cash surplus/deficit rule. A partially sold lot shows only realized proceeds/profit for the FIFO-matched quantity. Dashboard profit periods and charts use the acquisition date of each matched lot.</div>
    </div>`;
  }

  function summaryFor(itemId) {
    const id=Number(itemId),key=`${periodCacheKey()}|${id}`;
    if(perfCache.summaries.has(key))return perfCache.summaries.get(key);
    const {from,to}=dateRange(),a=fifoAnalytics(id),events=[];let bought=0,sold=0,buySpend=0,sellRevenue=0,profit=0,unmatched=0;const sources=new Set();
    for(const x of a.events){
      if(x.timestamp<from||x.timestamp>to)continue;
      events.push(x);
      if(x.side==='buy'){bought+=x.qty;buySpend+=x.total;if(x.source)sources.add(x.source);}
      else if(x.side==='sell'){sold+=x.qty;sellRevenue+=(x.netTotal??x.total);unmatched+=(x.unmatchedQty||0);}
    }
    profit=acquisitionAttributedProfit(id,from,to);
    const result={bought,sold,buySpend,sellRevenue,profit,sources:[...sources],unmatched,events,remainingQty:a.remainingQty,remainingCost:a.remainingCost};
    perfCache.summaries.set(key,result);return result;
  }

  function overall() {
    const key=periodCacheKey();if(perfCache.overall.has(key))return perfCache.overall.get(key);
    let profit=0,bought=0,sold=0,unmatched=0;
    for(const id of ensureTxIndex().itemIds){const x=summaryFor(id);profit+=x.profit;bought+=x.bought;sold+=x.sold;unmatched+=x.unmatched;}
    const result={profit,bought,sold,unmatched};perfCache.overall.set(key,result);return result;
  }

  function profitSeries(itemId=null) {
    const cacheKey=`${periodCacheKey()}|${state.granularity}|${itemId==null?'all':Number(itemId)}`;
    if(perfCache.series.has(cacheKey))return perfCache.series.get(cacheKey);
    const {from,to}=dateRange(),m=new Map(),rows=itemId==null?acquisitionLedgerRows():ledgerRowsForItem(Number(itemId));
    const keyFn=state.granularity==='week'?tctWeekStart:state.granularity==='month'?tctMonthStart:tctDayStart;
    for(const row of rows){
      if(row.acquiredAt<from||row.acquiredAt>to||row.soldQty<=0)continue;
      const k=keyFn(row.acquiredAt);m.set(k,(m.get(k)||0)+(Number(row.realizedProfit)||0));
    }
    const boundary=Math.min(to,nowSec());
    if(boundary>=from){
      let start;
      if(state.dateMode==='all'){
        const existing=[...m.keys()].sort((a,b)=>a-b);
        start=existing.length?existing[0]:keyFn(boundary);
      }else start=keyFn(from);
      const end=keyFn(boundary);
      if(state.granularity==='month'){
        for(let k=start;k<=end;k=nextTctMonthStart(k))if(!m.has(k))m.set(k,0);
      }else{
        const step=state.granularity==='week'?7*86400:86400;
        for(let k=start;k<=end;k+=step)if(!m.has(k))m.set(k,0);
      }
    }
    const result=[...m.entries()].sort((a,b)=>a[0]-b[0]).map(([t,v])=>({t,v}));perfCache.series.set(cacheKey,result);return result;
  }
