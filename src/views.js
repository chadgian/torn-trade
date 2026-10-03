  function chartBucketLabel(ts) {
    const d=new Date((Number(ts)||0)*1000);
    if(state.granularity==='month')return d.toLocaleDateString(undefined,{timeZone:'UTC',month:'long',year:'numeric'});
    if(state.granularity==='week')return `Week of ${tctDateStr(ts)}`;
    return tctDateStr(ts);
  }
  function hideChartTooltip(wrap,force=false) {
    if(!wrap)return;const tip=wrap.querySelector('.tta-charttooltip');if(!tip)return;
    if(!force&&tip.dataset.pinned==='1')return;tip.classList.remove('show','pos','neg');tip.dataset.pinned='0';wrap.querySelectorAll('.tta-profitbar.active').forEach(x=>x.classList.remove('active'));
  }
  function showChartTooltip(bar,pinned=false) {
    const wrap=bar?.closest?.('.tta-chartinteractive'),tip=wrap?.querySelector('.tta-charttooltip');if(!wrap||!tip)return;
    wrap.querySelectorAll('.tta-profitbar.active').forEach(x=>x.classList.remove('active'));bar.classList.add('active');
    const value=Number(bar.dataset.profit)||0,ts=Number(bar.dataset.time)||0;
    tip.innerHTML=`<strong>${esc(money(value))}</strong><small>${esc(chartBucketLabel(ts))} \u00B7 acquisition date</small>`;
    tip.classList.remove('pos','neg');tip.classList.add(value>=0?'pos':'neg','show');tip.dataset.pinned=pinned?'1':'0';
    const wr=wrap.getBoundingClientRect(),br=bar.getBoundingClientRect();
    requestAnimationFrame(()=>{const tw=tip.offsetWidth||120;let left=br.left-wr.left+br.width/2;left=Math.max(tw/2+4,Math.min(wr.width-tw/2-4,left));tip.style.left=`${left}px`;tip.style.top='4px';});
  }

  function chartSvg(series, h=160) {
    if (!series.length) return '<div class="tta-empty">No realized sales profit in this period yet.</div>';
    const dayMode=state.granularity==='day',padL=52,padR=8,padT=10,padB=25;
    const w=dayMode?Math.max(360,padL+padR+series.length*30):360,innerW=w-padL-padR,innerH=h-padT-padB;
    let min=Math.min(0,...series.map(x=>x.v)),max=Math.max(0,...series.map(x=>x.v)); if(max===min){max+=1;min-=1}
    const y=v=>padT+(max-v)/(max-min)*innerH; const zero=y(0); const gap=innerW/series.length; const bw=Math.max(dayMode?12:5,Math.min(dayMode?20:22,gap*.62));
    const grid=[0,.25,.5,.75,1].map(p=>{const yy=padT+p*innerH;const val=max-p*(max-min);return `<line class="tta-grid" x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}"/><text class="tta-axis" x="3" y="${yy+3}">${esc(money(val,true))}</text>`}).join('');
    const bars=series.map((p,i)=>{const cx=padL+gap*i+gap/2;const yy=y(p.v);const top=Math.min(yy,zero);const bh=Math.max(2,Math.abs(zero-yy));const label=`${chartBucketLabel(p.t)}: ${money(p.v)}`;return `<rect class="tta-profitbar ${p.v>=0?'tta-bar-pos':'tta-bar-neg'}" data-profit="${Number(p.v)||0}" data-time="${Number(p.t)||0}" tabindex="0" role="button" aria-label="${esc(label)}" x="${cx-bw/2}" y="${top}" width="${bw}" height="${bh}" rx="2"><title>${esc(label)}</title></rect>`}).join('');
    const labelStride=dayMode?Math.max(1,Math.ceil(series.length/12)):Math.max(1,Math.ceil(series.length/6));
    const labels=series.map((p,i)=>{if(series.length>10 && i%labelStride!==0 && i!==series.length-1)return''; const d=new Date(p.t*1000);const lab=state.granularity==='month'?d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short'}):d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'});const x=padL+gap*i+gap/2;return `<text class="tta-axis" text-anchor="middle" x="${x}" y="${h-6}">${esc(lab)}</text>`}).join('');
    return `<div class="tta-chartinteractive ${dayMode?'day':''}" ${dayMode?`style="--tta-chart-width:${w}px"`:''}><div class="tta-charttooltip" role="status" aria-live="polite" data-pinned="0"></div><div class="tta-chartviewport"><svg class="tta-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Interactive profit chart; hover or tap a bar for exact profit">${grid}<line class="tta-zero" x1="${padL}" y1="${zero}" x2="${w-padR}" y2="${zero}"/>${bars}${labels}</svg></div></div>`;
  }

  function positionDailyChartsToLatest(scope=document) {
    requestAnimationFrame(()=>scope.querySelectorAll?.('.tta-chartinteractive.day .tta-chartviewport').forEach(v=>{if(v.dataset.positioned==='1')return;v.scrollLeft=Math.max(0,v.scrollWidth-v.clientWidth);v.dataset.positioned='1';}));
  }

  function itemIcon(item) {
    const fallback = '<span class="tta-thumbfallback" style="display:grid">\u25C7</span>';
    if (!item || !item.image) return `<div class="tta-thumbwrap">${fallback}</div>`;
    return `<div class="tta-thumbwrap"><img class="tta-thumb" src="${esc(item.image)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="tta-thumbfallback">\u25C7</span></div>`;
  }

  function header(title, sub, back=false) {
    const views=[['dashboard','Overview','dashboard'],['cash','Cash Flow','cashflow'],['trade','Trade Analysis','trade'],['ledger','Acquisitions','ledger'],['networth','Net Worth','networth'],['insights','Insights & Goals','insights']];
    return `<div class="tta-header">${back?'<button class="tta-back" data-act="back" aria-label="Back" title="Back">\u2039</button>':''}<div class="tta-brand"><div class="tta-brandcopy"><div class="tta-title">${esc(title)}${state.demo?'<span class="tta-demo">DEMO</span>':''}</div><div class="tta-sub">${esc(sub)}</div></div></div><button class="tta-iconbtn" data-act="help" aria-label="Help and guide" title="Help">?</button><button class="tta-iconbtn" data-act="settings" aria-label="Settings" title="Settings">\u2699</button><button class="tta-iconbtn" data-act="close" aria-label="Close cash flow analyzer" title="Close">\u00D7</button></div><nav class="tta-workspaces" aria-label="Financial workspaces">${views.map(([view,label,action])=>`<button data-act="${action}" aria-current="${state.view===view?'page':'false'}">${label}</button>`).join('')}</nav>`;
  }

  function pinnedCountFor(items) {
    const pins=new Set((state.pinnedIds||[]).map(Number));let n=0;for(const x of items)if(pins.has(Number(x.id)))n++;return n;
  }
  function financialNavHtml(){return '';}

  function itemListMetaText(rows,allItems) {
    return `${qty(rows.length)} in this period \u00B7 ${qty(allItems.length)} discovered total \u00B7 ${qty(pinnedCountFor(allItems))} pinned`;
  }

  function itemListHtml(rows,allItems) {
    if(rows.length)return rows.map(r=>itemCard(r.item,r.summary)).join('');
    if(state.itemSearch)return `<div class="tta-empty">No items match \u201C${esc(state.itemSearch)}\u201D in this period.</div>`;
    return `<div class="tta-empty">${allItems.length?'No item activity exists in the selected period. Try a longer period or Sync to backfill it.':'No item history has been discovered yet. Press Sync to scan your Torn logs.'}</div>`;
  }

  function renderItemList() {
    if(state.view!=='trade')return;
    const list=document.getElementById('tta-item-list');if(!list)return;
    const shell=document.querySelector('#tta-root .tta-shell'),scroll=shell?.scrollTop||0;
    const rows=historyItemRows(),allItems=effectiveTracked();
    list.innerHTML=itemListHtml(rows,allItems);
    const meta=document.getElementById('tta-list-meta');if(meta)meta.textContent=itemListMetaText(rows,allItems);
    const count=document.getElementById('tta-item-count');if(count)count.textContent=qty(rows.length);
    const sort=document.getElementById('tta-sort-btn');if(sort)sort.textContent=`\u21C5 ${sortLabel()}`;
    const clear=document.querySelector('[data-act="clearItemSearch"]');if(clear)clear.hidden=!state.itemSearch;
    if(shell)shell.scrollTop=scroll;positionDailyChartsToLatest(list);
  }

  function tradeHtml() {
    const s=overall(),rows=historyItemRows(),allItems=effectiveTracked(),range=dateRange();
    const salesTab=state.tradeTab==='sales',sales=salesTab?latestSalesRows():[];
    const profit=salesTab?sales.reduce((total,row)=>total+row.realizedProfit,0):s.profit;
    const sold=salesTab?sales.reduce((total,row)=>total+Number(row.qty),0):s.sold;
    const proceeds=sales.reduce((total,row)=>total+(row.proceedsKnown===false?0:Number(row.netTotal??row.total)||0),0);
    const requested=selectedPeriodBounds();
    const coverageFrom=Number(state.sync?.coverageFrom);
    const needsBackfill=hasApiKey()&&state.sync?.firstSyncComplete&&requested.from>0&&(!Number.isFinite(coverageFrom)||coverageFrom>requested.from);
    const periodLabel=state.dateMode==='all'?'All available history':`${dateStr(range.from)} \u2013 ${dateStr(Math.min(range.to,nowSec()))}`;
    const lastSync=state.sync?.lastSync?`Last sync ${tctDateTimeStr(state.sync.lastSync)} TCT`:'Not synced yet';
    return `${header('Trade Analysis', `v${VERSION} \u00B7 FIFO item analytics`,true)}<div class="tta-content">
      ${!hasApiKey()?`<div class="tta-banner"><strong>${state.demo?'Preview mode.':'API disconnected.'}</strong> Connect a key in Settings to check current history.</div>`:''}
      ${hasApiKey()&&!state.sync?.autoDiscoveryComplete?`<div class="tta-banner"><strong>History discovery:</strong> Run Sync once to discover recognizable acquisitions and sales for your selected period.</div>`:''}
      ${needsBackfill?`<div class="tta-banner">This period starts before checked history. Use Full Resync to load older acquisitions.</div>`:''}
      <div class="tta-period"><div><small>Date period</small><strong>${esc(periodLabel)}</strong><span class="tta-periodhint">${esc(lastSync)} \u00B7 ${qty(state.transactions.length)} cached rows</span></div><div class="tta-syncactions"><button class="tta-btn" data-act="syncQuick" ${state.syncing?'disabled':''}>${state.syncing?'Syncing\u2026':'\u26A1 Quick Sync'}</button><button class="tta-btn secondary" data-act="syncFull" ${state.syncing?'disabled':''}>\u27F3 Full Resync</button></div></div>
      ${state.syncProgress?`<div class="tta-banner tta-status-banner"><span class="tta-status-dot"></span><span id="tta-sync-progress-text">${esc(state.syncProgress)}</span></div>`:''}
      <div class="tta-chips">${[['7d','7 days'],['14d','14 days'],['30d','30 days'],['all','All'],['custom','Custom']].map(([k,l])=>`<button class="tta-chip ${state.dateMode===k?'active':''}" data-date="${k}">${l}</button>`).join('')}</div>
      ${state.dateMode==='custom'?`<div class="tta-customdates"><input type="date" data-custom="from" value="${esc(state.customFrom)}"><input type="date" data-custom="to" value="${esc(state.customTo)}"></div>`:''}
      <div class="tta-seg tta-view-tabs"><button data-act="tradeTab" data-tab="items" class="${state.tradeTab==='items'?'active':''}">Items</button><button data-act="tradeTab" data-tab="sales" class="${state.tradeTab==='sales'?'active':''}">Latest sales</button></div>
      <div class="tta-summary"><div class="tta-stat main"><label>${salesTab?'FIFO profit / sale date':'Profit / acquisition date'}</label><b class="${profit>=0?'pos':'neg'}">${money(profit)}</b></div><div class="tta-stat"><label>${salesTab?'Known net proceeds':'Acquired'}</label><b>${salesTab?money(proceeds):qty(s.bought)}</b></div><div class="tta-stat"><label>Sold</label><b>${qty(sold)}</b></div></div>
      ${salesTab?'':`<div class="tta-chartcard"><div class="tta-charthead"><h3>Profit by acquisition date</h3><div class="tta-seg">${['day','week','month'].map(g=>`<button class="${state.granularity===g?'active':''}" data-gran="${g}">${g[0].toUpperCase()+g.slice(1)}</button>`).join('')}</div></div>${chartSvg(profitSeries())}</div>`}
      ${state.tradeTab==='sales'?latestSalesHtml():`<div class="tta-sectionhead"><h3>Items in selected period \u00B7 <span id="tta-item-count">${qty(rows.length)}</span></h3><button class="tta-btn secondary" data-act="ledger">Acquisition history</button></div>
      <div class="tta-listtools"><div class="tta-searchwrap"><span class="tta-searchglyph">\u2315</span><input id="tta-history-search" class="tta-history-search" placeholder="Search item name or ID\u2026" value="${esc(state.itemSearch||'')}" autocomplete="off" aria-label="Search discovered items"><button class="tta-clearsearch" data-act="clearItemSearch" aria-label="Clear search" ${state.itemSearch?'':'hidden'}>\u00D7</button></div><select id="tta-sort-select" class="tta-history-search" aria-label="Sort items">${SORT_OPTIONS.map(option=>`<option value="${option.id}" ${state.sortMode===option.id?'selected':''}>${esc(option.label)}</option>`).join('')}</select></div>
      <div id="tta-list-meta" class="tta-listmeta">${esc(itemListMetaText(rows,allItems))}</div>
      <div id="tta-item-list" class="tta-liststage">${itemListHtml(rows,allItems)}</div>`}
    </div>`;
  }

  function transactionItemDetail(t) {
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
  function allCashFlows() {
    const map=new Map();for(const x of state.cashFlows||[])if(x?.id)map.set(String(x.id),x);for(const x of transactionCashFlows())map.set(String(x.id),x);
    return [...map.values()].sort((a,b)=>(Number(b.timestamp)||0)-(Number(a.timestamp)||0));
  }
  function cashFlowBoundsToday() {const now=nowSec();return {from:tctDayStart(now),to:now};}
  function cashFlowSummary(from,to) {
    let earned=0,spent=0,transferIn=0,transferOut=0,count=0;const categories=new Map();
    for(const x of allCashFlows()){const ts=Number(x.timestamp)||0;if(ts<from||ts>to)continue;count++;const amount=Math.max(0,Number(x.amount)||0);let row=categories.get(x.category)||{category:x.category,earned:0,spent:0,transfers:0};
      if(x.direction==='in'){earned+=amount;row.earned+=amount;}else if(x.direction==='out'){spent+=amount;row.spent+=amount;}else if(x.direction==='transfer-in'){transferIn+=amount;row.transfers+=amount;}else if(x.direction==='transfer-out'){transferOut+=amount;row.transfers+=amount;}categories.set(x.category,row);}
    return {earned,spent,net:earned-spent,transferIn,transferOut,count,categories:[...categories.values()].sort((a,b)=>(b.earned+b.spent+b.transfers)-(a.earned+a.spent+a.transfers))};
  }
  function latestFinancialSnapshot(){return (state.financialSnapshots||[]).slice().sort((a,b)=>(Number(b.timestamp)||0)-(Number(a.timestamp)||0))[0]||null;}
  async function refreshFinancialSnapshot() {
    if(!hasApiKey())return null;const snap={timestamp:nowSec(),networth:null,money:null};
    await requireAccountIdentity();
    try{const n=await apiGet('/user/networth');if(!n?.networth)throw new Error('Missing networth');snap.networth=n.networth;snap.timestamp=Number(n.networth.timestamp)||snap.timestamp;resolveDiagnostic('NETWORTH_UNAVAILABLE');}catch(_){reportDiagnostic('NETWORTH_UNAVAILABLE','warning','Net-worth snapshot could not be refreshed.',{source:'/user/networth'});}
    try{const m=await apiGet('/user/money');if(!m?.money)throw new Error('Missing money');snap.money=m.money;resolveDiagnostic('MONEY_UNAVAILABLE');}catch(_){reportDiagnostic('MONEY_UNAVAILABLE','warning','Current money snapshot could not be refreshed.',{source:'/user/money'});}
    if(!snap.networth&&!snap.money)return null;
    const list=(state.financialSnapshots||[]).filter(x=>Math.abs((Number(x.timestamp)||0)-snap.timestamp)>300);list.push(snap);const next=list.sort((a,b)=>a.timestamp-b.timestamp).slice(-180);await saveDurable('financialSnapshots',next);state.financialSnapshots=next;return snap;
  }
  async function refreshCompanyDailyAdjustment(userId,serverNow=nowSec()) {
    const me=Number(userId)||0;if(!(me>0))return null;
    let profileData;
    try{profileData=await apiGet('/company/profile');resolveDiagnostic('COMPANY_UNAVAILABLE');}catch(error){if([6,7,16].includes(error.context?.apiCode))resolveDiagnostic(error.code,'/company/profile');else reportDiagnostic('COMPANY_UNAVAILABLE','warning','Company profit could not be refreshed.',{source:'/company/profile'});return null;}
    const profile=profileData?.profile;
    if(!profile||Number(profile?.director?.id)!==me)return null;
    let employeesData;
    try{employeesData=await apiGet('/company/employees');resolveDiagnostic('COMPANY_WAGES_UNAVAILABLE');}catch(_){reportDiagnostic('COMPANY_WAGES_UNAVAILABLE','warning','Company wages could not be loaded; company profit was not recalculated.',{source:'/company/employees'});return null;}
    const employees=Array.isArray(employeesData?.employees)?employeesData.employees:[];
    const grossIncome=Number(profile?.income?.daily)||0;
    const wages=employees.reduce((n,e)=>n+Math.max(0,Number(e?.wage)||0),0);
    const advertisementBudget=Math.max(0,Number(profile?.advertisement_budget)||0);
    const adjustment=grossIncome-wages-advertisementBudget;
    const serverTs=Number(serverNow)||nowSec();
    // Torn company daily figures are treated as an 18:00 TCT cycle. Before 18:00,
    // keep updating the previous cycle instead of creating a new midnight-dated row.
    const cycleDay=tctDayStart(serverTs-(18*3600)),calculatedAt=cycleDay+(18*3600),companyId=Number(profile?.id)||0;
    if(!(companyId>0))return null;
    const id=`company-adjustment:${companyId}:${cycleDay}`;
    // Remove legacy rows that older builds may have created after 00:00 but before
    // the next 18:00 TCT company calculation.
    const prefix=`company-adjustment:${companyId}:`;
    const beforeCompanyCleanup=(state.cashFlows||[]).length;
    state.cashFlows=(state.cashFlows||[]).filter(x=>{
      const xid=String(x?.id||'');
      if(!xid.startsWith(prefix))return true;
      const storedCycle=Number(xid.slice(prefix.length));
      return !Number.isFinite(storedCycle)||storedCycle<=cycleDay;
    });
    if(state.cashFlows.length!==beforeCompanyCleanup)save('cashFlows',state.cashFlows);
    if(!Number.isFinite(adjustment)||Math.abs(adjustment)<1){upsertCashFlowRow({id,amount:0});return null;}
    const direction=adjustment>0?'in':'out';
    const row={id,timestamp:calculatedAt,direction,amount:Math.abs(adjustment),category:'Company Profit / Loss',source:'Company Daily Adjustment',title:`${String(profile?.name||'Company')} daily ${adjustment>0?'profit':'loss'}`,transfer:false,companyId,grossIncome,wages,advertisementBudget,netAdjustment:adjustment};
    upsertCashFlowRow(row);return row;
  }
  function sumNumeric(obj){return Object.values(obj||{}).reduce((n,v)=>n+(typeof v==='number'&&Number.isFinite(v)?v:0),0);}
  function analyzerPortfolio() {
    const rows=acquisitionLedgerRows();let acquiredCost=0,remainingCost=0,marketValue=0,realizedProfit=0,acquiredQty=0,remainingQty=0,transferredQty=0;const byMethod=new Map();
    for(const r of rows){const item=catalogItem(r.itemId),rem=Math.max(0,Number(r.unsoldQty)||0),mv=rem*Math.max(0,Number(item.marketPrice)||0);acquiredCost+=Number(r.costTotal)||0;remainingCost+=rem*(Number(r.unitCost)||0);marketValue+=mv;realizedProfit+=Number(r.realizedProfit)||0;acquiredQty+=Number(r.qty)||0;remainingQty+=rem;transferredQty+=Math.max(0,Number(r.transferredQty)||0);const m=byMethod.get(r.method)||{method:r.method,qty:0,cost:0,remaining:0,market:0,profit:0,transferred:0};m.qty+=Number(r.qty)||0;m.cost+=Number(r.costTotal)||0;m.remaining+=rem;m.market+=mv;m.profit+=Number(r.realizedProfit)||0;m.transferred+=Math.max(0,Number(r.transferredQty)||0);byMethod.set(r.method,m);}
    return {acquiredCost,remainingCost,marketValue,unrealized:marketValue-remainingCost,realizedProfit,acquiredQty,remainingQty,transferredQty,byMethod:[...byMethod.values()].sort((a,b)=>b.market-a.market||b.cost-a.cost)};
  }
  function periodChipsHtml(){return `<div class="tta-chips">${[['7d','7 days'],['14d','14 days'],['30d','30 days'],['all','All'],['custom','Custom']].map(([k,l])=>`<button class="tta-chip ${state.dateMode===k?'active':''}" data-date="${k}">${l}</button>`).join('')}</div>${state.dateMode==='custom'?`<div class="tta-customdates"><input type="date" data-custom="from" value="${esc(state.customFrom)}"><input type="date" data-custom="to" value="${esc(state.customTo)}"></div>`:''}`;}
  function flowLegendHtml(){return `<div class="tta-flowlegend"><span class="in">+ Money in</span><span class="out">\u2212 Money out</span><span class="transfer">\u2194 Transfer</span></div>`;}
  function cashBreakdownHtml(summary,limit=8){const rows=summary.categories.slice(0,limit);return rows.length?`<div class="tta-breakdown">${rows.map(r=>`<div class="tta-breakrow"><span>${esc(r.category)}</span><b class="pos">${r.earned?money(r.earned,true):'\u2014'}</b><b class="neg secondary-value">${r.spent?money(r.spent,true):'\u2014'}</b></div>`).join('')}</div>`:'<div class="tta-empty">No recognized cash movements in this period yet.</div>';}
  function cashFlowRowsHtml(rows,limit=200){return rows.slice(0,limit).map(x=>{const detail=flowDetailText(x);return `<tr role="row"><td role="cell" data-label="Event"><span class="tta-flowtitle">${esc(x.title||x.category)}</span><span class="tta-cash-compact-flow tta-flowbadge ${x.direction.startsWith('transfer')?'transfer':x.direction}">${x.direction.startsWith('transfer')?'Transfer':x.direction==='in'?'Incoming':'Outgoing'}</span>${detail?`<span class="tta-flowmeta">${esc(detail)}</span>`:''}<span class="tta-flowmeta">${esc(tctDateTimeStr(x.timestamp))} TCT \u00B7 ${esc(x.source||x.category)}</span></td><td role="cell" data-label="Flow"><span class="tta-flowbadge ${x.direction.startsWith('transfer')?'transfer':x.direction}">${x.direction.startsWith('transfer')?'Transfer':x.direction==='in'?'Incoming':'Outgoing'}</span></td><td role="cell" data-label="Category">${esc(x.category)}</td><td role="cell" data-label="Amount" class="num ${x.direction==='in'?'pos':x.direction==='out'?'neg':'tta-transfer'}">${x.direction==='in'?'+':x.direction==='out'?'-':'\u2194 '}${money(x.amount)}</td></tr>`;}).join('')||'<tr role="row"><td role="cell" colspan="4"><div class="tta-empty">No recognized cash flows match this period.</div></td></tr>';}
  function dashboardHtml() {
    const today=cashFlowBoundsToday();
    const sum=cashFlowSummary(today.from,today.to);
    const snap=latestFinancialSnapshot();
    const portfolio=analyzerPortfolio();
    const nw=Number(snap?.networth?.total)||0;
    const todayRows=allCashFlows().filter(x=>x.timestamp>=today.from&&x.timestamp<=today.to);
    const recent=todayRows.slice(0,12);
    let apiBanner='';
    if(!hasApiKey())apiBanner=`<div class="tta-banner"><strong>${state.demo?'Preview mode.':'API disconnected.'}</strong> Connect a key in Settings to check current history.</div>`;
    let lastSync='Run Quick Sync to load today&#39;s movements';
    if(state.sync?.lastSync)lastSync='Last sync '+esc(tctDateTimeStr(state.sync.lastSync))+' TCT';
    let movementLabel=qty(todayRows.length)+' movement';
    if(todayRows.length!==1)movementLabel+='s';
    movementLabel+=' recorded today';
    let moreLabel='';
    if(todayRows.length>12)moreLabel='<div class="tta-morehint">Showing the latest 12 of '+qty(todayRows.length)+' movements from the current TCT day.</div>';
    const networthLabel=snap?.networth?money(nw):'Sync to load';
    const netClass=sum.net>=0?'pos':'neg';
    const profitClass=portfolio.realizedProfit>=0?'pos':'neg';
    const dashboardHeader=header('Cash Flow Analyzer','v'+VERSION+' \u00B7 clear financial overview');
    return `${dashboardHeader}<div class="tta-content tta-dashboard">${apiBanner}<div class="tta-period tta-dashboard-top"><div><small>Today \u00B7 Torn City Time</small><strong>${esc(tctDateStr(today.from))}</strong><span class="tta-periodhint">${lastSync}</span></div><div class="tta-syncactions"><button class="tta-btn" data-act="syncQuick" ${state.syncing?'disabled':''}>${state.syncing?'Syncing\u2026':'\u26A1 Quick Sync'}</button><button class="tta-btn secondary" data-act="syncFull" ${state.syncing?'disabled':''}>\u27F3 Full Resync</button></div></div><div class="tta-bento-grid"><section class="tta-bento tta-bento-hero"><small>Consolidated cash flow today</small><b class="tta-consolidated ${netClass}">${money(sum.net)}</b><div class="tta-equation"><span class="pos">+ ${money(sum.earned)}</span><span>\u2212</span><span class="neg">${money(sum.spent)}</span></div><p>Money in minus money out for the current TCT day.</p></section><section class="tta-bento"><small>Money in today</small><b class="pos">+ ${money(sum.earned)}</b></section><section class="tta-bento"><small>Money out today</small><b class="neg">\u2212 ${money(sum.spent)}</b></section></div>${financialNavHtml()}<div class="tta-sectionintro"><div><small>Snapshot</small><h3>Financial position</h3></div></div><div class="tta-position-grid"><section class="tta-bento"><small>Torn net worth</small><b>${networthLabel}</b></section><section class="tta-bento"><small>Recorded inventory value</small><b>${money(portfolio.marketValue)}</b></section><section class="tta-bento"><small>Realized trade profit</small><b class="${profitClass}">${money(portfolio.realizedProfit)}</b></section></div><section class="tta-glass-section"><div class="tta-sectionhead"><div><small>Current TCT day</small><h3>Today&#39;s cash movements</h3><span class="tta-sectionhint">${movementLabel}</span></div><button class="tta-btn secondary" data-act="cashflow">Open ledger</button></div><div class="tta-table-scroll"><table class="tta-flowtable tta-cashflow-table tta-compact-table" role="table" aria-label="Cash movements"><tbody role="rowgroup">${cashFlowRowsHtml(recent,12)}</tbody></table></div>${moreLabel}</section></div>`;
  }
  function cashFlowDateRange() {
    const bounds=selectedPeriodBoundsTct(nowSec());let from=bounds.from,to=bounds.to;
    if(state.dateMode==='all'){from=Infinity;for(const x of allCashFlows()){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}if(!Number.isFinite(from))from=0;}
    return {from,to};
  }
  function cashFlowSeries() {
    const {from,to}=cashFlowDateRange(),keyFn=state.granularity==='week'?tctWeekStart:state.granularity==='month'?tctMonthStart:tctDayStart,m=new Map();
    for(const x of allCashFlows()){
      const ts=Number(x?.timestamp)||0;if(ts<from||ts>to)continue;
      if(x.direction!=='in'&&x.direction!=='out')continue;
      const k=keyFn(ts),row=m.get(k)||{t:k,moneyIn:0,moneyOut:0,net:0};
      const amount=Math.max(0,Number(x.amount)||0);if(x.direction==='in')row.moneyIn+=amount;else row.moneyOut+=amount;row.net=row.moneyIn-row.moneyOut;m.set(k,row);
    }
    if(!m.size)return[];
    let start=state.dateMode==='all'?Math.min(...m.keys()):keyFn(from),end=keyFn(to);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return[...m.values()].sort((a,b)=>a.t-b.t);
    if(state.granularity==='month'){
      for(let k=start;k<=end;k=nextTctMonthStart(k))if(!m.has(k))m.set(k,{t:k,moneyIn:0,moneyOut:0,net:0});
    }else{
      const step=state.granularity==='week'?7*86400:86400;for(let k=start;k<=end;k+=step)if(!m.has(k))m.set(k,{t:k,moneyIn:0,moneyOut:0,net:0});
    }
    return [...m.values()].sort((a,b)=>a.t-b.t);
  }
  function cashFlowBucketLabel(ts) {
    const d=new Date((Number(ts)||0)*1000);
    if(state.granularity==='month')return d.toLocaleDateString(undefined,{timeZone:'UTC',month:'long',year:'numeric'});
    if(state.granularity==='week')return `Week of ${tctDateStr(ts)}`;
    return tctDateStr(ts);
  }
  function showCashFlowTooltip(point,pinned=false) {
    const wrap=point?.closest?.('.tta-cash-chart'),tip=wrap?.querySelector('.tta-charttooltip');if(!wrap||!tip)return;
    wrap.querySelectorAll('.tta-cashpoint.active').forEach(x=>x.classList.remove('active'));point.classList.add('active');
    const incoming=Number(point.dataset.moneyIn)||0,outgoing=Number(point.dataset.moneyOut)||0,net=Number(point.dataset.net)||0,label=String(point.dataset.label||'Cash flow');
    tip.innerHTML=`<strong>${esc(label)}</strong><span class="pos">Money in: ${esc(money(incoming))}</span><span class="neg">Money out: ${esc(money(outgoing))}</span><span class="${net>=0?'pos':'neg'}">Net: ${esc(money(net))}</span>`;
    tip.classList.add('show','tta-cashtooltip');tip.dataset.pinned=pinned?'1':'0';
    const wr=wrap.getBoundingClientRect(),pr=point.getBoundingClientRect();
    requestAnimationFrame(()=>{const tw=tip.offsetWidth||170;let left=pr.left-wr.left+pr.width/2;left=Math.max(tw/2+4,Math.min(wr.width-tw/2-4,left));tip.style.left=`${left}px`;tip.style.top='4px';});
  }
  function hideCashFlowTooltip(wrap,force=false) {
    if(!wrap)return;const tip=wrap.querySelector('.tta-charttooltip');if(!tip)return;if(!force&&tip.dataset.pinned==='1')return;
    tip.classList.remove('show','tta-cashtooltip');tip.dataset.pinned='0';wrap.querySelectorAll('.tta-cashpoint.active').forEach(x=>x.classList.remove('active'));
  }
  function cashFlowChartSvg(series) {
    if(!series.length)return '<div class="tta-empty">No incoming or outgoing cash flow is recorded in this period yet.</div>';
    const h=214,axisW=56,padL=8,padR=10,padT=18,padB=28,gap=Math.max(24,Math.min(42,620/Math.max(1,series.length))),w=Math.max(334,Math.ceil(padL+padR+series.length*gap)),innerH=h-padT-padB;
    const peak=Math.max(1,...series.flatMap(x=>[Math.abs(Number(x.moneyIn)||0),Math.abs(Number(x.moneyOut)||0),Math.abs(Number(x.net)||0)])),max=peak*1.08,min=-max,y=v=>padT+(max-v)/(max-min)*innerH,zero=y(0);
    const x=i=>padL+gap*i+gap/2,pathFor=key=>series.map((r,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(key==='moneyOut'?-(Number(r[key])||0):(Number(r[key])||0)).toFixed(2)}`).join(' ');
    const ticks=[-1,-.5,0,.5,1];
    const grid=ticks.map(f=>{const yy=y(max*f);return `<line class="tta-grid" x1="0" y1="${yy}" x2="${w-padR}" y2="${yy}"/>`}).join('');
    const axis=ticks.map(f=>{const yy=y(max*f),v=max*f;return `<g><line class="tta-axis-tick" x1="${axisW-6}" y1="${yy}" x2="${axisW}" y2="${yy}"/><text class="tta-axis tta-cash-axis-label" text-anchor="end" x="${axisW-9}" y="${yy+3}">${esc(money(v,true))}</text></g>`}).join('');
    const labelStride=Math.max(1,Math.ceil(series.length/10)),labels=series.map((r,i)=>{if(series.length>10&&i%labelStride!==0&&i!==series.length-1)return'';const d=new Date(r.t*1000),lab=state.granularity==='month'?d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short'}):d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'});return `<text class="tta-axis" text-anchor="middle" x="${x(i)}" y="${h-7}">${esc(lab)}</text>`}).join('');
    const hits=series.map((r,i)=>{const left=padL+gap*i,label=cashFlowBucketLabel(r.t),aria=`${label}: money in ${money(r.moneyIn)}, money out ${money(r.moneyOut)}, net ${money(r.net)}`;return `<rect class="tta-cashpoint" x="${left}" y="${padT}" width="${gap}" height="${innerH}" tabindex="0" role="button" aria-label="${esc(aria)}" data-label="${esc(label)}" data-money-in="${Number(r.moneyIn)||0}" data-money-out="${Number(r.moneyOut)||0}" data-net="${Number(r.net)||0}"></rect>`}).join('');
    return `<div class="tta-chartinteractive tta-cash-chart ${state.granularity==='day'?'day':''}"><div class="tta-charttooltip" role="status" aria-live="polite" data-pinned="0"></div><div class="tta-cash-chartframe"><div class="tta-cash-axis-wrap" aria-hidden="true"><svg class="tta-cash-axis-svg" viewBox="0 0 ${axisW} ${h}" preserveAspectRatio="none">${axis}</svg></div><div class="tta-chartviewport"><svg class="tta-svg tta-cash-svg" viewBox="0 0 ${w} ${h}" style="min-width:${w}px" role="img" aria-label="Cash flow trend with a fixed money scale, money in above zero, money out below zero and net cash flow"><line class="tta-zero" x1="0" y1="${zero}" x2="${w-padR}" y2="${zero}"/>${grid}<path class="tta-cashline in" d="${pathFor('moneyIn')}"></path><path class="tta-cashline out" d="${pathFor('moneyOut')}"></path><path class="tta-cashline net" d="${pathFor('net')}"></path>${hits}${labels}</svg></div></div></div>`;
  }
  function cashFlowChartHtml() {
    const series=cashFlowSeries();
    return `<div class="tta-chartcard tta-cashflow-chartcard"><div class="tta-charthead"><div><h3>Cash flow over time</h3><small>Money out is plotted below zero \u00B7 tap or hover a period for exact values</small></div><div class="tta-seg">${['day','week','month'].map(g=>`<button class="${state.granularity===g?'active':''}" data-gran="${g}">${g[0].toUpperCase()+g.slice(1)}</button>`).join('')}</div></div><div class="tta-cashlegend"><span class="in">Money in</span><span class="out">Money out</span><span class="net">Net cash flow</span></div>${cashFlowChartSvg(series)}</div>`;
  }

  function cashFlowHtml() {
    const {from,to}=cashFlowDateRange(),sum=cashFlowSummary(from,to),q=String(state.cashSearch||'').trim().toLowerCase(),cat=String(state.cashCategory||'all');let rows=allCashFlows().filter(x=>x.timestamp>=from&&x.timestamp<=to);if(cat!=='all')rows=rows.filter(x=>x.category===cat);if(q)rows=rows.filter(x=>`${x.title} ${flowDetailText(x)} ${x.itemName||''} ${x.itemId||''} ${x.category} ${x.source} ${x.counterpartyName||''} ${x.counterpartyId||''}`.toLowerCase().includes(q));const cats=[...new Set(allCashFlows().map(x=>x.category))].sort();
    return `${header('Cash Flow','Every recognized incoming/outgoing money movement',true)}<div class="tta-content">${periodChipsHtml()}<div class="tta-cashhero"><div class="tta-cashcard"><small>Earned</small><b class="pos">${money(sum.earned)}</b></div><div class="tta-cashcard"><small>Spent</small><b class="neg">${money(sum.spent)}</b></div><div class="tta-cashcard main"><small>Net cash flow</small><b class="${sum.net>=0?'pos':'neg'}">${money(sum.net)}</b></div></div>${cashFlowChartHtml()}<div class="tta-fin-section"><h3>Category breakdown</h3>${cashBreakdownHtml(sum,20)}</div><div class="tta-listtools"><input id="tta-cash-search" class="tta-history-search" placeholder="Search cash flow\u2026" value="${esc(state.cashSearch||'')}"><select id="tta-cash-category" class="tta-history-search"><option value="all">All categories</option>${cats.map(c=>`<option value="${esc(c)}" ${cat===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div><div class="tta-ledgerwrap"><table class="tta-flowtable tta-cashflow-table tta-compact-table" role="table" aria-label="Cash movements"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Event</th><th role="columnheader" scope="col">Flow</th><th role="columnheader" scope="col">Category</th><th role="columnheader" scope="col" style="text-align:right">Amount</th></tr></thead><tbody role="rowgroup">${cashFlowRowsHtml(rows,state.cashLimit||200)}</tbody></table></div><div class="tta-morehint">Showing ${qty(Math.min(rows.length,state.cashLimit||200))} of ${qty(rows.length)} movements ${rows.length>(state.cashLimit||200)?'<button class="tta-btn secondary" data-act="cashMore">Load more</button>':''}</div><div class="tta-note">Internal transfers remain visible but are excluded from earned/spent totals. Direct player-to-player money sent/received is counted as outgoing/incoming cash. Item gifts/transfers are tracked in Net Worth instead of Cash Flow. Item buys/sales come from the normalized trade ledger; Player Trade cash uses the actual cash exchanged, not the analyzer's allocated item valuation.</div></div>`;
  }
  function labeledKey(k){return String(k).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
  function moneyBreakdownHtml(obj){return Object.entries(obj||{}).map(([k,v])=>{if(typeof v==='object'&&v){const amount=Number(v.amount??v.money??0)||0;return `<div class="tta-fin-row"><span>${esc(labeledKey(k))}</span><b>${money(amount)}</b></div>`;}return typeof v==='number'?`<div class="tta-fin-row"><span>${esc(labeledKey(k))}</span><b>${money(v)}</b></div>`:'';}).join('');}

  function analysisRange() {return cashFlowDateRange();}
  function analyticsRows(direction) {const {from,to}=analysisRange();return allCashFlows().filter(x=>{const ts=Number(x.timestamp)||0;return ts>=from&&ts<=to&&!x.transfer&&!String(x.direction||'').startsWith('transfer')&&x.direction===direction;});}
  function analyticsSummary(direction) {
    const rows=analyticsRows(direction),total=rows.reduce((n,x)=>n+Math.max(0,Number(x.amount)||0),0),{from,to}=analysisRange(),days=Math.max(1,Math.ceil(Math.max(1,to-from)/86400)),cats=new Map();
    for(const x of rows)cats.set(x.category,(cats.get(x.category)||0)+Math.max(0,Number(x.amount)||0));
    const categories=[...cats.entries()].map(([category,amount])=>({category,amount,pct:total?amount/total*100:0})).sort((a,b)=>b.amount-a.amount),largest=rows.slice().sort((a,b)=>(Number(b.amount)||0)-(Number(a.amount)||0))[0]||null;
    let previous=null;if(state.dateMode!=='all'&&from>0&&to>from){const span=to-from,prev=cashFlowSummary(Math.max(0,from-span),Math.max(0,from-1));previous=direction==='in'?prev.earned:prev.spent;}
    return {rows,total,days,avg:total/days,categories,largest,previous,changePct:previous>0?(total-previous)/previous*100:null};
  }
  function categoryAnalyticsHtml(summary,kind) {if(!summary.categories.length)return '<div class="tta-empty">No recognized activity in this period.</div>';return `<div class="tta-analytics-bars">${summary.categories.slice(0,8).map(r=>`<div class="tta-analytics-row"><div class="tta-analytics-label"><span>${esc(r.category)}</span><b>${money(r.amount,true)}</b></div><div class="tta-analytics-track"><span style="width:${Math.max(2,Math.min(100,r.pct)).toFixed(1)}%"></span></div><small>${r.pct.toFixed(1)}% of ${kind}</small></div>`).join('')}</div>`;}
  function currentGoalValue(goal) {const snap=latestFinancialSnapshot();if(goal.type==='networth')return Number(snap?.networth?.total)||0;if(goal.type==='cash')return sumMoneyTree(snap?.money)||0;if(goal.type==='dailyIncome'){const d=cashFlowBoundsToday();return cashFlowSummary(d.from,d.to).earned;}return 0;}
  function goalTypeLabel(type){return type==='networth'?'Net worth':type==='cash'?'Accessible cash':'Daily income';}
  function goalsHtml() {const cards=(state.goals||[]).map(g=>{const current=currentGoalValue(g),target=Math.max(1,Number(g.target)||1),pct=Math.max(0,Math.min(100,current/target*100));return `<div class="tta-goal"><div class="tta-goal-head"><div><strong>${esc(g.label||goalTypeLabel(g.type))}</strong><small>${esc(goalTypeLabel(g.type))} target</small></div><button class="tta-iconbtn tta-goal-remove" data-act="removeGoal" data-id="${esc(g.id)}" title="Remove goal">\u00D7</button></div><div class="tta-goal-values"><b>${money(current)}</b><span>of ${money(target)}</span></div><div class="tta-goal-track"><span style="width:${pct.toFixed(1)}%"></span></div><small>${pct.toFixed(1)}% complete</small></div>`;}).join('');return `<div class="tta-goal-form"><input id="tta-goal-label" class="tta-history-search" placeholder="Goal name (optional)"><select id="tta-goal-type" class="tta-history-search"><option value="networth">Net worth target</option><option value="cash">Accessible cash target</option><option value="dailyIncome">Daily income target</option></select><input id="tta-goal-target" class="tta-history-search" type="number" min="1" inputmode="numeric" placeholder="Target amount"><button class="tta-btn" data-act="addGoal">Add goal</button></div><div class="tta-goal-list">${cards||'<div class="tta-empty">No goals yet. Add a target to track progress from your latest synced data.</div>'}</div>`;}
  function insightsHtml() {const spend=analyticsSummary('out'),income=analyticsSummary('in'),u=(state.unrecognizedFinancial||[]).slice(0,20),range=analysisRange(),rangeLabel=state.dateMode==='all'?'All cached history':`${tctDateStr(range.from)} \u2013 ${tctDateStr(range.to)}`;const largestSpend=spend.largest?`${flowActivityLabel(spend.largest)} \u00B7 ${money(spend.largest.amount)}`:'\u2014',largestIncome=income.largest?`${flowActivityLabel(income.largest)} \u00B7 ${money(income.largest.amount)}`:'\u2014';return `${header('Insights & Goals','Spending, income, coverage and targets',true)}<div class="tta-content">${periodChipsHtml()}<div class="tta-period"><div><small>Analytics period</small><strong>${esc(rangeLabel)}</strong></div></div><div class="tta-insight-grid"><section class="tta-fin-section"><div class="tta-sectionhead"><div><small>Expenses</small><h3>Spending analytics</h3></div></div><div class="tta-fin-grid"><div class="tta-stat"><label>Total spent</label><b class="neg">${money(spend.total)}</b></div><div class="tta-stat"><label>Average / day</label><b>${money(spend.avg)}</b></div><div class="tta-stat"><label>Largest expense</label><b title="${esc(largestSpend)}">${spend.largest?money(spend.largest.amount,true):'\u2014'}</b></div><div class="tta-stat"><label>vs previous period</label><b class="${spend.changePct==null?'':spend.changePct<=0?'pos':'neg'}">${spend.changePct==null?'\u2014':`${spend.changePct>=0?'+':''}${spend.changePct.toFixed(1)}%`}</b></div></div>${categoryAnalyticsHtml(spend,'spending')}<div class="tta-snapshot-note">Largest: ${esc(largestSpend)}</div></section><section class="tta-fin-section"><div class="tta-sectionhead"><div><small>Income</small><h3>Income analytics</h3></div></div><div class="tta-fin-grid"><div class="tta-stat"><label>Total income</label><b class="pos">${money(income.total)}</b></div><div class="tta-stat"><label>Average / day</label><b>${money(income.avg)}</b></div><div class="tta-stat"><label>Largest income</label><b title="${esc(largestIncome)}">${income.largest?money(income.largest.amount,true):'\u2014'}</b></div><div class="tta-stat"><label>vs previous period</label><b class="${income.changePct==null?'':income.changePct>=0?'pos':'neg'}">${income.changePct==null?'\u2014':`${income.changePct>=0?'+':''}${income.changePct.toFixed(1)}%`}</b></div></div>${categoryAnalyticsHtml(income,'income')}<div class="tta-snapshot-note">Largest: ${esc(largestIncome)}</div></section></div><section class="tta-fin-section"><div class="tta-sectionhead"><div><small>Coverage diagnostics</small><h3>Unrecognized financial events</h3></div><span class="tta-sectionhint">${qty(state.unrecognizedFinancial.length)} cached</span></div>${u.length?`<div class="tta-unmapped-list">${u.map(x=>`<div class="tta-unmapped"><div><strong>${esc(x.title)}</strong><small>${esc(tctDateTimeStr(x.timestamp))} TCT \u00B7 log ${x.logId} \u00B7 ${esc(x.field||'money field')}</small></div><b>${money(x.amount||0)}</b></div>`).join('')}</div>`:'<div class="tta-empty">No currently unrecognized money-bearing logs are cached.</div>'}<div class="tta-note">These events are excluded from totals until the analyzer can classify them safely. Only normalized diagnostic details are stored; raw Torn logs are not retained.</div></section><section class="tta-fin-section"><div class="tta-sectionhead"><div><small>Targets</small><h3>Financial goals</h3></div></div>${goalsHtml()}</section></div>`;}
  function sumMoneyTree(v){if(typeof v==='number'&&Number.isFinite(v))return v;if(Array.isArray(v))return v.reduce((n,x)=>n+sumMoneyTree(x),0);if(v&&typeof v==='object')return Object.values(v).reduce((n,x)=>n+sumMoneyTree(x),0);return 0;}
  function netWorthHistoryPoints(){const {from,to}=selectedPeriodBoundsTct(nowSec()),byDay=new Map();for(const s of state.financialSnapshots||[]){const ts=Number(s?.networth?.timestamp||s?.timestamp)||0,total=Number(s?.networth?.total);if(!(ts>0)||!Number.isFinite(total)||(state.dateMode!=='all'&&(ts<from||ts>to)))continue;const day=tctDayStart(ts),prev=byDay.get(day);if(!prev||ts>prev.ts)byDay.set(day,{ts,total});}return [...byDay.values()].sort((a,b)=>a.ts-b.ts);}
  function netWorthTimelineHtml(){const pts=netWorthHistoryPoints();if(pts.length<2)return '<div class="tta-empty tta-nw-empty"><strong>Timeline starts after two TCT days are stored.</strong><small>Keep syncing normally; the analyzer keeps the latest snapshot for each day.</small></div>';const w=360,h=150,padL=53,padR=8,padT=12,padB=24,min=Math.min(...pts.map(x=>x.total)),max=Math.max(...pts.map(x=>x.total)),span=Math.max(1,max-min),x=i=>padL+(w-padL-padR)*(pts.length===1?0:i/(pts.length-1)),y=v=>padT+(h-padT-padB)*(1-(v-min)/span),line=pts.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join(' ');return `<div class="tta-nw-chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Net worth history"><line class="tta-grid" x1="${padL}" y1="${padT}" x2="${padL}" y2="${h-padB}"/><line class="tta-grid" x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}"/><text class="tta-axis" x="2" y="${padT+4}">${esc(money(max,true))}</text><text class="tta-axis" x="2" y="${h-padB+4}">${esc(money(min,true))}</text><path class="tta-nw-line" d="${line}"/>${pts.map((p,i)=>`<circle class="tta-nw-point" cx="${x(i)}" cy="${y(p.total)}" r="2.4"><title>${esc(tctDateStr(p.ts))}: ${esc(money(p.total))}</title></circle>`).join('')}</svg><div class="tta-nw-chart-meta"><span>${esc(tctDateStr(pts[0].ts))}</span><b class="${pts[pts.length-1].total>=pts[0].total?'pos':'neg'}">${money(pts[pts.length-1].total-pts[0].total)}</b><span>${esc(tctDateStr(pts[pts.length-1].ts))}</span></div></div>`;}
  function assetAllocationHtml(nw){if(!nw)return '<div class="tta-empty">No Torn net-worth snapshot loaded.</div>';const groups=[['Money',sumMoneyTree(nw.money)],['Items',sumMoneyTree(nw.items)],['Points',Number(nw.points)||0],['Other assets',sumMoneyTree(nw.assets)]].filter(x=>x[1]>0),total=groups.reduce((n,x)=>n+x[1],0);return groups.length?`<div class="tta-allocation">${groups.map(([label,value])=>{const pct=total?value/total*100:0;return `<div class="tta-allocation-row"><div><span>${esc(label)}</span><b>${money(value,true)}</b></div><div class="tta-analytics-track"><span style="width:${Math.max(2,pct).toFixed(1)}%"></span></div><small>${pct.toFixed(1)}%</small></div>`;}).join('')}</div>`:'<div class="tta-empty">No positive asset categories are present in the latest snapshot.</div>';}
  function csvCell(v){const s=(typeof v==='string'&&/^\s*[=+@-]/.test(v)?"'":'')+String(v??'');return /[",]/.test(s)||s.includes(String.fromCharCode(10))||s.includes(String.fromCharCode(13))?`"${s.replace(/"/g,'""')}"`:s;}
  function downloadTextFile(name,text,type='text/plain;charset=utf-8'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function backupPayload(){return {schema:1,app:'Torn Cash Flow Analyzer',version:VERSION,exportedAt:nowSec(),data:{transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,playerTrades:state.playerTrades,itemConsumptions:state.itemConsumptions,unrecognizedFinancial:state.unrecognizedFinancial,financialSnapshots:state.financialSnapshots,goals:state.goals,tracked:state.tracked,pinnedIds:state.pinnedIds,hiddenIds:state.hiddenIds,sync:state.sync,dateMode:state.dateMode,customFrom:state.customFrom,customTo:state.customTo,granularity:state.granularity,netWorthDate:state.netWorthDate,netWorthTrackingStartedAt:state.netWorthTrackingStartedAt}};}
  function exportBackup(){downloadTextFile(`torn-cash-flow-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backupPayload(),null,2),'application/json;charset=utf-8');}
  function exportCashCsv(){const rows=allCashFlows(),head=['Timestamp TCT','Direction','Category','Title','Details','Source','Amount','Item ID','Quantity','Counterparty ID','Counterparty'];const body=rows.map(x=>[tctDateTimeStr(x.timestamp),x.direction,x.category,x.title,flowDetailText(x),x.source,x.amount,x.itemId||'',x.qty||'',x.counterpartyId||'',x.counterpartyName||'']);downloadTextFile(`torn-cash-flow-${new Date().toISOString().slice(0,10)}.csv`,[head,...body].map(r=>r.map(csvCell).join(',')).join(String.fromCharCode(10)),'text/csv;charset=utf-8');}
  function exportNetWorthCsv(){const head=['Timestamp TCT','Total','Money','Items','Points','Other assets'];const body=(state.financialSnapshots||[]).filter(x=>x?.networth).map(x=>{const n=x.networth;return [tctDateTimeStr(n.timestamp||x.timestamp),n.total,sumMoneyTree(n.money),sumMoneyTree(n.items),Number(n.points)||0,sumMoneyTree(n.assets)];});downloadTextFile(`torn-net-worth-${new Date().toISOString().slice(0,10)}.csv`,[head,...body].map(r=>r.map(csvCell).join(',')).join(String.fromCharCode(10)),'text/csv;charset=utf-8');}
  function importBackup() {
    if(state.syncing||state.backgroundSyncing)throw new AnalyzerError('IMPORT_SYNC_ACTIVE','Stop the active sync before importing history.');
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.style.display='none';document.body.appendChild(input);
    input.addEventListener('change',()=>{
      const file=input.files?.[0];if(!file){input.remove();return;}
      const reader=new FileReader();
      reader.onerror=()=>{reportDiagnostic('IMPORT_READ','error','The backup file could not be read.',{source:'import'});input.remove();render();};
      reader.onload=async()=>{
        try{
          if(state.syncing||state.backgroundSyncing)throw new AnalyzerError('IMPORT_SYNC_ACTIVE','A sync started while choosing the backup. Stop it before importing.');
          await applyBackup(JSON.parse(String(reader.result||'')));
          toast('Backup imported. Reloading analyzer...');setTimeout(()=>location.reload(),450);
        }catch(error){diagnosticFromError(error,'import');render();toast('Import failed. Existing history retained; see Data Quality.');}
        finally{input.remove();}
      };
      reader.readAsText(file);
    });input.click();
  }

  function tctInputDate(ts) { return new Date(tctDayStart(ts)*1000).toISOString().slice(0,10); }
  function tctDateInputStart(value) {
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return NaN;
    const ts=Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/1000);
    return Number.isFinite(ts)?ts:NaN;
  }
  function netWorthTrackingBounds() {
    const today=tctDayStart(nowSec()),stored=Number(state.netWorthTrackingStartedAt)||0;
    const snapshotStart=(state.financialSnapshots||[]).map(x=>Number(x?.networth?.timestamp||x?.timestamp)||0).filter(x=>x>0).sort((a,b)=>a-b)[0]||0;
    let first=tctDayStart(stored||snapshotStart||today);if(snapshotStart>0)first=Math.min(first,tctDayStart(snapshotStart));
    first=Math.min(today,Math.max(0,first));return {first,today};
  }
  function selectedNetWorthDay() {
    const bounds=netWorthTrackingBounds();let day=tctDateInputStart(state.netWorthDate);
    if(!Number.isFinite(day))day=bounds.today;day=Math.max(bounds.first,Math.min(bounds.today,tctDayStart(day)));
    const normalized=tctInputDate(day);if(state.netWorthDate!==normalized){state.netWorthDate=normalized;save('netWorthDate',normalized);}
    return {...bounds,dayStart:day,date:normalized};
  }

  function cashFlowNetWorthImpactKnown(x) {
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
  function dailyNetWorthActivity(dayStart=null) {
    const now=nowSec(),bounds=netWorthTrackingBounds(),selected=dayStart==null?selectedNetWorthDay().dayStart:tctDayStart(Number(dayStart)||bounds.today),from=Math.max(bounds.first,Math.min(bounds.today,selected)),to=from===bounds.today?now:from+86399;
    const snapshots=(state.financialSnapshots||[]).filter(x=>{const ts=Number(x?.networth?.timestamp||x?.timestamp)||0;return ts>=from&&ts<=to&&x?.networth;}).slice().sort((a,b)=>(Number(a?.networth?.timestamp||a?.timestamp)||0)-(Number(b?.networth?.timestamp||b?.timestamp)||0));
    const before=(state.financialSnapshots||[]).filter(x=>x?.networth&&(Number(x?.networth?.timestamp||x?.timestamp)||0)<from).slice().sort((a,b)=>(Number(b?.networth?.timestamp||b?.timestamp)||0)-(Number(a?.networth?.timestamp||a?.timestamp)||0))[0]||null;
    const latest=snapshots[snapshots.length-1]||null,baseline=snapshots.length>=2?snapshots[0]:null;
    const latestTotal=Number(latest?.networth?.total),baselineTotal=Number(baseline?.networth?.total);const delta=Number.isFinite(latestTotal)&&Number.isFinite(baselineTotal)&&latest!==baseline?latestTotal-baselineTotal:null,rows=[];let companyNet=0,companySeen=false;
    for(const t of state.transactions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to||Number(t?.logId)===4103||t?.source==='Player Trade')continue;const item=catalogItem(t.itemId),q=Math.max(0,Number(t.qty)||0);if(!(q>0))continue;if(t.side==='buy'){const cost=Math.max(0,Number(t.total)||0),market=q*Math.max(0,Number(item.marketPrice)||0),free=!!t.free,marketKnown=market>0,impact=free?(marketKnown?market:0):(marketKnown?market-cost:0),impactKnown=free?marketKnown:marketKnown,costLabel=t.source==='Player Trade'?'Allocated trade cash':'Cash paid',impactMeta=impactKnown?` \u00B7 Est. net-worth impact ${impact>=0?'+':''}${money(impact)}`:' \u00B7 Net-worth impact unavailable (no item market value)';rows.push({timestamp:ts,kind:'item-in',icon:'\uFF0B',title:`${free?'Acquired':'Bought'} ${qty(q)} \u00D7 ${item.name}`,meta:`${t.source||'Item acquisition'} \u00B7 ${free?'Free / $0 cost':`${costLabel} -${money(cost)}`}${marketKnown?` \u00B7 Item value +${money(market)}`:''}${impactMeta}`,value:impactKnown?Math.abs(impact):0,valueClass:impactKnown?(impact>=0?'pos':'neg'):'',prefix:impactKnown?(impact>=0?'+':'-'):'',impact:impactKnown?impact:null,impactKnown});}else if(t.side==='sell'){const proceeds=Math.max(0,Number(t.netTotal??t.total)||0),market=q*Math.max(0,Number(item.marketPrice)||0),marketKnown=market>0,impact=marketKnown?proceeds-market:0,evt=(fifoAnalytics(t.itemId).events||[]).find(e=>String(e.id)===String(t.id)),profit=Number(evt?.realizedProfit),profitKnown=Number.isFinite(profit),impactMeta=marketKnown?` \u00B7 Est. net-worth impact ${impact>=0?'+':''}${money(impact)}`:' \u00B7 Net-worth impact unavailable (no item market value)';rows.push({timestamp:ts,kind:'item-sale',icon:'\u2197',title:`Sold ${qty(q)} \u00D7 ${item.name}`,meta:`${t.source||'Item sale'} \u00B7 Cash received +${money(proceeds)}${marketKnown?` \u00B7 Item value removed -${money(market)}`:''}${impactMeta}${profitKnown?` \u00B7 FIFO trade ${profit>=0?'profit':'loss'} ${money(Math.abs(profit))}`:' \u00B7 FIFO profit/loss unavailable'}`,value:marketKnown?Math.abs(impact):0,valueClass:marketKnown?(impact>=0?'pos':'neg'):'',prefix:marketKnown?(impact>=0?'+':'-'):'',impact:marketKnown?impact:null,impactKnown:marketKnown});}}
    for(const evt of effectivePlayerTradeEvents()){
      const ts=Number(evt?.timestamp)||0;if(ts<from||ts>to)continue;const incoming=evt.incomingItems||[],outgoing=evt.outgoingItems||[],cashIn=Math.max(0,Number(evt.cashIn)||0),cashOut=Math.max(0,Number(evt.cashOut)||0);
      let itemInValue=0,itemOutValue=0,missingValue=false;for(const x of incoming){const q=Math.max(0,Number(x.qty)||0),v=q*Math.max(0,Number(catalogItem(x.itemId).marketPrice)||0);if(q>0&&!(v>0))missingValue=true;itemInValue+=v;}for(const x of outgoing){const q=Math.max(0,Number(x.qty)||0),v=q*Math.max(0,Number(catalogItem(x.itemId).marketPrice)||0);if(q>0&&!(v>0))missingValue=true;itemOutValue+=v;}
      const impactKnown=!missingValue,impact=cashIn-cashOut+itemInValue-itemOutValue,detail=playerTradeItemDetail(playerTradeEventRows(evt)),who=evt.counterpartyName||((Number(evt.counterpartyId)||0)>0?`#${evt.counterpartyId}`:`#${evt.tradeId}`),metaParts=[];
      if(cashIn>0)metaParts.push(`Cash received +${money(cashIn)}`);if(cashOut>0)metaParts.push(`Cash given -${money(cashOut)}`);if(itemInValue>0)metaParts.push(`Items received +${money(itemInValue)}`);if(itemOutValue>0)metaParts.push(`Items given -${money(itemOutValue)}`);if(detail)metaParts.push(detail);metaParts.push(impactKnown?`Est. net-worth impact ${impact>=0?'+':''}${money(impact)}`:'Net-worth impact unavailable because at least one traded item has no market value');
      rows.push({timestamp:ts,kind:'player-trade',icon:'\u21C4',title:`Player Trade with ${who}`,meta:metaParts.join(' \u00B7 '),value:impactKnown?Math.abs(impact):0,valueClass:impactKnown?(impact>=0?'pos':'neg'):'',prefix:impactKnown?(impact>=0?'+':'-'):'',impact:impactKnown?impact:null,impactKnown});
    }
    for(const t of state.playerTransfers||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to||t?.type!=='item')continue;const item=catalogItem(t.itemId),q=Math.max(0,Number(t.qty)||0),market=q*Math.max(0,Number(item.marketPrice)||0),incoming=t.direction==='in',who=t.counterpartyName||((Number(t.counterpartyId)||0)>0?`#${t.counterpartyId}`:'another player'),impactKnown=market>0,impact=impactKnown?(incoming?market:-market):0;rows.push({timestamp:ts,kind:incoming?'player-item-in':'player-item-out',icon:incoming?'\u21E3':'\u21E1',title:`${incoming?'Received':'Sent'} ${qty(q)} \u00D7 ${item.name}`,meta:`Player transfer ${incoming?'from':'to'} ${who}${t.message?` \u00B7 ${t.message}`:''}${market?` \u00B7 Est. value ${money(market)}`:' \u00B7 Net-worth impact unavailable (no item market value)'}`,value:impactKnown?market:0,valueClass:impactKnown?(incoming?'pos':'neg'):'',prefix:impactKnown?(incoming?'+':'-'):'',impact:impactKnown?impact:null,impactKnown});}
    const consumptionGroups=new Map();
    for(const t of state.itemConsumptions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to)continue;const itemId=Number(t?.itemId)||0,q=Math.max(0,Number(t?.qty)||0);if(!(itemId>0&&q>0))continue;const item=catalogItem(itemId),market=q*Math.max(0,Number(item.marketPrice)||0),evt=(fifoAnalytics(itemId).events||[]).find(e=>String(e.id)===`consume:${t.id}`),basis=Math.max(0,Number(evt?.costBasis)||0),minute=Math.floor(ts/60),useTitle=String(t?.title||'Item use'),key=`${itemId}|${useTitle}|${minute}`;let g=consumptionGroups.get(key);if(!g){g={timestamp:ts,itemId,itemName:item.name,title:useTitle,qty:0,market:0,basis:0,count:0};consumptionGroups.set(key,g);}g.timestamp=Math.min(g.timestamp,ts);g.qty+=q;g.market+=market;g.basis+=basis;g.count++;}
    for(const g of consumptionGroups.values()){const impactValue=g.market||g.basis,impact=impactValue>0?-impactValue:0,impactKnown=impactValue>0;rows.push({timestamp:g.timestamp,kind:'item-consumed',icon:'\u2212',title:`Used ${qty(g.qty)} \u00D7 ${g.itemName}`,meta:`${g.title}${g.count>1?` \u00B7 ${qty(g.count)} use logs combined`:''}${g.market?` \u00B7 Est. value removed ${money(g.market)}`:''}${g.basis?` \u00B7 FIFO cost basis removed ${money(g.basis)}`:''}${!g.market&&g.basis?' \u00B7 Using FIFO cost basis as value fallback':''}`,value:impactKnown?impactValue:0,valueClass:impactKnown?'neg':'',prefix:impactKnown?'-':'',impact:impactKnown?impact:null,impactKnown});}
    for(const x of state.cashFlows||[]){const ts=Number(x?.timestamp)||0;if(ts<from||ts>to||x?.transfer||String(x?.direction||'').startsWith('transfer')||isNonCashCompanyAdminLog(x?.title))continue;const amount=Math.max(0,Number(x?.amount)||0);if(!(amount>0))continue;const incoming=x.direction==='in',impact=incoming?amount:-amount,isCompany=x.category==='Company Profit / Loss'||x.source==='Company Daily Adjustment',impactKnown=isCompany||cashFlowNetWorthImpactKnown(x);if(isCompany){companySeen=true;companyNet+=impact;}const companyMeta=isCompany?`Company daily adjustment \u00B7 Gross ${money(x.grossIncome)} \u00B7 Wages ${money(x.wages)} \u00B7 Advertising ${money(x.advertisementBudget)}`:`${x.category||'Cash'} \u00B7 ${x.source||'Torn Log'}${impactKnown?'':' \u00B7 Cash side shown; counterpart asset value is not safely known'}`;rows.push({timestamp:ts,kind:isCompany?'company-pl':(incoming?'money-in':'money-out'),icon:isCompany?'\u25A3':(incoming?'\u2191':'\u2193'),title:x.title||x.category||(incoming?'Money received':'Money spent'),meta:companyMeta,value:impactKnown?amount:0,valueClass:impactKnown?(incoming?'pos':'neg'):'',prefix:impactKnown?(incoming?'+':'-'):'',impact:impactKnown?impact:null,impactKnown});}
    const valuedRows=rows.filter(x=>x.impactKnown!==false&&Number.isFinite(Number(x.impact))),detectedNet=valuedRows.reduce((n,x)=>n+Number(x.impact),0),unvaluedEvents=rows.length-valuedRows.length;const componentChanges=baseline&&latest?netWorthComponentChanges(baseline.networth,latest.networth):[];rows.sort((a,b)=>b.timestamp-a.timestamp||String(a.title).localeCompare(String(b.title)));return {from,to,snapshots,before,latest,baseline,delta,rows,companyNet:companySeen?companyNet:null,detectedNet,valuedEvents:valuedRows.length,unvaluedEvents,componentChanges};
  }
  function dailyNetWorthChangesHtml() {
    const selection=selectedNetWorthDay(),d=dailyNetWorthActivity(selection.dayStart),baselineTs=Number(d.baseline?.networth?.timestamp||d.baseline?.timestamp)||0,latestTs=Number(d.latest?.networth?.timestamp||d.latest?.timestamp)||0,isToday=d.from===selection.today;
    const deltaText=d.delta==null?'Waiting for comparable snapshots':`${d.delta>=0?'+':''}${money(d.delta)}`;
    const deltaClass=d.delta==null?'':d.delta>=0?'pos':'neg';
    const baselineText=!d.latest?`No stored net-worth snapshot for ${tctDateStr(d.from)}`:d.delta==null?`Only one Torn snapshot this day \u00B7 ${tctDateTimeStr(latestTs)} TCT \u00B7 sync again later for a within-day snapshot movement`:`From first snapshot ${tctDateTimeStr(baselineTs)} to latest ${tctDateTimeStr(latestTs)} TCT`;
    const companyText=d.companyNet==null?'No recorded company P/L':`${d.companyNet>=0?'+':''}${money(d.companyNet)}`;
    const companyClass=d.companyNet==null?'':d.companyNet>=0?'pos':'neg';
    const detectedText=`${d.detectedNet>=0?'+':''}${money(d.detectedNet)}`,detectedClass=d.detectedNet>=0?'pos':'neg',gap=d.delta==null?null:d.delta-d.detectedNet,gapText=gap==null?'Waiting for comparable Torn snapshots':`${gap>=0?'+':''}${money(gap)} difference vs Torn snapshot`;
    const componentHtml=(d.componentChanges||[]).length?`<div class="tta-fin-section"><div class="tta-sectionhead"><div><small>Torn snapshot components</small><h3>What changed between stored snapshots</h3></div><span class="tta-sectionhint">${qty(d.componentChanges.length)} changed</span></div><div class="tta-breakdown">${d.componentChanges.slice(0,12).map(c=>`<div class="tta-fin-row"><span>${esc(netWorthComponentLabel(c.key))}</span><b class="${c.delta>=0?'pos':'neg'}">${c.delta>=0?'+':''}${money(c.delta)}</b></div>`).join('')}</div>${d.componentChanges.length>12?`<div class="tta-morehint">Showing the 12 largest component movements.</div>`:''}</div>`:'';
    const rows=d.rows.slice(0,20).map(x=>`<div class="tta-nw-change"><div class="tta-nw-change-icon">${esc(x.icon)}</div><div class="tta-nw-change-copy"><strong>${esc(x.title)}</strong><small>${esc(tctDateTimeStr(x.timestamp))} TCT \u00B7 ${esc(x.meta)}</small></div><div class="tta-nw-change-value ${x.valueClass||''}">${x.impactKnown===false?'\u2014':`${x.prefix||''}${money(x.value||0)}`}</div></div>`).join('');
    return `<section class="tta-fin-section tta-nw-daily"><div class="tta-sectionhead"><div><small>${isToday?'Current':'Selected'} TCT day</small><h3>${esc(tctDateStr(d.from))} net-worth changes</h3></div><span class="tta-sectionhint">${qty(d.rows.length)} detected event${d.rows.length===1?'':'s'}</span></div><div class="tta-nw-daypicker"><label><span>View TCT date</span><input id="tta-networth-date" type="date" min="${tctInputDate(selection.first)}" max="${tctInputDate(selection.today)}" value="${esc(selection.date)}"></label><button class="tta-btn secondary" data-act="netWorthToday" ${isToday?'disabled':''}>Today</button><div class="tta-nw-dayrange">Tracking since <b>${esc(tctDateStr(selection.first))}</b>.</div></div><div class="tta-nw-daily-metrics"><div class="tta-nw-metric-card tta-nw-delta"><div><small>Analyzer-detected movement</small><b class="${detectedClass}">${esc(detectedText)}</b></div><span>${qty(d.valuedEvents)} valued event${d.valuedEvents===1?'':'s'}${d.unvaluedEvents?` \u00B7 ${qty(d.unvaluedEvents)} unvalued`:''}<br>${esc(gapText)}</span></div><div class="tta-nw-metric-card tta-nw-company-delta"><small>Torn snapshot movement</small><b class="${deltaClass}">${esc(deltaText)}</b><span>${esc(baselineText)}</span></div><div class="tta-nw-metric-card tta-nw-company-delta tta-nw-company-card"><small>Recorded company P/L</small><b class="${companyClass}">${esc(companyText)}</b><span>${d.companyNet==null?'No company adjustment for this TCT day.':'Included at the recorded 18:00 TCT company cycle.'}</span></div></div>${componentHtml}<div class="tta-nw-change-list">${rows||`<div class="tta-empty tta-nw-empty">No item, cash, transfer, sale or company P/L events were detected for ${esc(tctDateStr(d.from))}.</div>`}</div>${d.rows.length>20?`<div class="tta-morehint">Showing the latest 20 of ${qty(d.rows.length)} detected events for this TCT day.</div>`:''}<details class="tta-nw-method"><summary>How these movements are calculated</summary><p>Analyzer-detected movement is the signed sum of valued events shown for this TCT day. Paid item buys use cash paid versus estimated item value gained; sales use cash received versus estimated item value removed. Torn snapshot movement needs at least two stored snapshots inside the selected TCT day. Catalog repricing, unrecognized assets, snapshot timing and Torn's own valuation rules can create a difference. Company P/L is included when recorded, and Player Trades use actual trade cash plus current catalog values of items received or given.</p></details></section>`;
  }
  function netWorthHtml() {
    const snap=latestFinancialSnapshot(),nw=snap?.networth,portfolio=analyzerPortfolio(),all=cashFlowSummary(0,Number.MAX_SAFE_INTEGER);const itemTotal=nw?sumNumeric(nw.items):0,assetTotal=nw?sumNumeric(nw.assets):0;
    const snapshotDetails=`<details class="tta-nw-breakdowns"><summary>Detailed Torn wealth locations</summary><div class="tta-fin-section"><h3>Current wealth locations \u00B7 /user/money</h3>${snap?.money?moneyBreakdownHtml(snap.money):'<div class="tta-empty tta-nw-empty">No current wealth snapshot loaded.</div>'}</div><div class="tta-fin-section"><h3>Net-worth money / liabilities</h3>${nw?moneyBreakdownHtml(nw.money):'<div class="tta-empty tta-nw-empty">No Torn net-worth snapshot loaded.</div>'}</div><div class="tta-fin-section"><h3>Items by Torn location</h3>${nw?moneyBreakdownHtml(nw.items):''}</div><div class="tta-fin-section"><h3>Other assets</h3>${nw?moneyBreakdownHtml(nw.assets):''}</div></details>`;
    return `${header('Net Worth','Torn snapshot + analyzer acquisition portfolio',true)}<div class="tta-content tta-networth-page">${periodChipsHtml()}<div class="tta-fin-section tta-nw-snapshot-hero"><div class="tta-stat main"><label>Torn-reported total net worth</label><b class="tta-networth-total">${nw?money(nw.total):'No snapshot yet'}</b></div><div class="tta-snapshot-note">${nw?`Snapshot ${esc(tctDateTimeStr(nw.timestamp||snap.timestamp))} TCT \u00B7 Torn currently marks API v2 networth as unstable.`:'Run Sync to request /user/networth and /user/money.'}</div></div>${dailyNetWorthChangesHtml()}<div class="tta-fin-section"><div class="tta-sectionhead"><div><small>History</small><h3>Net-worth timeline</h3></div><span class="tta-sectionhint">Daily latest snapshots</span></div>${netWorthTimelineHtml()}</div><div class="tta-fin-section"><div class="tta-sectionhead"><div><small>Latest snapshot</small><h3>Asset allocation</h3></div></div>${assetAllocationHtml(nw)}</div><div class="tta-cashhero tta-nw-quickstats"><div class="tta-cashcard"><small>Torn item holdings</small><b>${nw?money(itemTotal):'\u2014'}</b></div><div class="tta-cashcard"><small>Torn assets</small><b>${nw?money(assetTotal):'\u2014'}</b></div><div class="tta-cashcard main"><small>Points value</small><b>${nw?money(nw.points):'\u2014'}</b></div></div>${snapshotDetails}<div class="tta-fin-section"><h3>Analyzer item portfolio</h3><div class="tta-fin-grid tta-nw-portfolio-grid"><div class="tta-stat"><label>Historical acquisition cost</label><b>${money(portfolio.acquiredCost)}</b></div><div class="tta-stat"><label>Recorded remaining cost basis</label><b>${money(portfolio.remainingCost)}</b></div><div class="tta-stat"><label>Recorded remaining market value</label><b>${money(portfolio.marketValue)}</b></div><div class="tta-stat"><label>Unrealized gain / loss</label><b class="${portfolio.unrealized>=0?'pos':'neg'}">${money(portfolio.unrealized)}</b></div><div class="tta-stat"><label>Realized FIFO profit</label><b class="${portfolio.realizedProfit>=0?'pos':'neg'}">${money(portfolio.realizedProfit)}</b></div><div class="tta-stat"><label>All recognized cash-flow net</label><b class="${all.net>=0?'pos':'neg'}">${money(all.net)}</b></div></div></div><div class="tta-fin-section"><h3>Items acquired by method</h3><div class="tta-breakdown">${portfolio.byMethod.map(r=>`<div class="tta-breakrow"><span>${esc(r.method)} \u00B7 ${qty(r.qty)} acquired \u00B7 ${qty(r.remaining)} remaining</span><b>${money(r.market,true)}</b><b class="${r.profit>=0?'pos':'neg'} secondary-value">${money(r.profit,true)}</b></div>`).join('')||'<div class="tta-empty tta-nw-empty">No acquisition history yet.</div>'}</div><details class="tta-nw-method"><summary>About analyzer portfolio values</summary><p>Market value uses current Torn catalog price \u00D7 analyzer-recorded remaining quantity. Sent or consumed items reduce the oldest FIFO lots without creating sale profit. This accounting view does not replace Torn's official net-worth total.</p></details></div><div class="tta-settings-actions tta-nw-actions"><button class="tta-btn secondary" data-act="refreshFinancial">Refresh financial snapshot</button><button class="tta-btn secondary" data-act="trade">Open Trade Analysis</button></div></div>`;
  }

  function itemCard(item,precomputed=null) {
    const s=precomputed||summaryFor(item.id),exp=Number(state.expanded)===Number(item.id);
    const pinned=(state.pinnedIds||[]).map(Number).includes(Number(item.id));
    const marketPrice=Math.max(0,Number(item.marketPrice)||0),marketText=marketPrice?money(marketPrice):'Market unavailable';
    const itemType=String(item.type||'Item');
    const src=s.sources.length?s.sources.slice(0,3).join(' \u00B7 '):'No acquisitions in selected period';
    let details='';
    if(exp){
      const series=profitSeries(item.id),avgBuy=s.bought?s.buySpend/s.bought:0,avgSell=s.sold?s.sellRevenue/s.sold:0;
      const freeQty=s.events.filter(x=>x.side==='buy'&&x.free).reduce((n,x)=>n+x.qty,0);
      const playerTradeCount=new Set(s.events.filter(x=>x.source==='Player Trade').map(x=>x.tradeId)).size;
      const recordedInventoryValue=marketPrice*Math.max(0,Number(s.remainingQty)||0);
      details=`<div class="tta-minirow"><div class="tta-ministat"><small>Avg cost</small><b>${money(avgBuy,true)}</b></div><div class="tta-ministat"><small>Avg sell</small><b>${money(avgSell,true)}</b></div><div class="tta-ministat"><small>Inventory</small><b>${qty(s.remainingQty)}</b></div></div><div class="tta-minirow"><div class="tta-ministat"><small>Market value</small><b>${marketPrice?money(marketPrice,true):'\u2014'}</b></div><div class="tta-ministat"><small>Recorded inventory value</small><b>${marketPrice?money(recordedInventoryValue,true):'\u2014'}</b></div><div class="tta-ministat"><small>FIFO cost basis</small><b>${money(s.remainingCost,true)}</b></div></div><div class="tta-charthead"><h3>${esc(item.name)} profit</h3><small>#${item.id} \u00B7 ${esc(itemType)} \u00B7 ${s.events.length} events</small></div>${chartSvg(series,92)}<div class="tta-note">Market value is Torn's catalog market price per item. Recorded inventory value is your analyzer-recorded remaining quantity \u00D7 that market value; it is not a live inventory count.${playerTradeCount?` \u00B7 ${qty(playerTradeCount)} player trade(s) use each item type's market-value subtotal plus an equal share of that trade's cash surplus/deficit.`:''} Sold quantity counts every recognized sale event, including outgoing items from authoritative completed player-trade details. Profit uses FIFO: each sale is matched against your oldest recorded acquisitions, but the realized profit is attributed to the date that matched lot was acquired rather than the sale date. ${s.unmatched?`\u26A0 ${qty(s.unmatched)} sold item(s) have no earlier recorded acquisition cost, so those units are excluded from realized profit.`:'All sold units in this period have recorded cost basis.'}${freeQty?` \u00B7 ${qty(freeQty)} free-acquired item(s) use a $0 cost basis.`:''}</div>`;
    }
    return `<div class="tta-item ${exp?'expanded':''}" data-item="${item.id}"><div class="tta-itemtop" data-act="toggleItem" data-id="${item.id}" role="button" tabindex="0" aria-expanded="${exp?'true':'false'}">${itemIcon(item)}<div class="tta-itemcopy"><div class="tta-itemname">${esc(item.name)}</div><div class="tta-source">${esc(src)}</div><div class="tta-itemfacts"><span class="tta-factpill market">Market ${esc(marketText)}</span><span class="tta-factpill">${esc(itemType)}</span><span class="tta-factpill">#${item.id}</span></div></div><div class="tta-profitbox"><div class="tta-cardactions"><button class="tta-pin ${pinned?'active':''}" data-act="togglePin" data-id="${item.id}" aria-pressed="${pinned?'true':'false'}" aria-label="${pinned?'Unpin':'Pin'} ${esc(item.name)}" title="${pinned?'Unpin item':'Pin item to top'}">${pinned?'\uD83D\uDCCC':'\u2606'}</button><button class="tta-hideitem" data-act="hideItem" data-id="${item.id}" aria-label="Hide ${esc(item.name)}" title="Hide item">\uD83D\uDE48</button></div><div class="tta-profit ${s.profit>=0?'pos':'neg'}">${money(s.profit,true)}</div><div class="tta-chevron">${exp?'\u25B2 details':'\u25BC details'}</div></div></div><div class="tta-metrics"><div class="tta-metric"><small>Acquired</small><b>${qty(s.bought)}</b></div><div class="tta-metric"><small>Sold</small><b>${qty(s.sold)}</b></div><div class="tta-metric"><small>Profit</small><b class="${s.profit>=0?'pos':'neg'}">${money(s.profit,true)}</b></div></div><div class="tta-accordion">${details}</div></div>`;
  }

  function addItemHtml() {
    const q=state.search.trim().toLowerCase();
    const available=(state.catalog||[]).filter(x=>!state.tracked.some(t=>Number(t.id)===Number(x.id)));
    const results=available.filter(x=>!q || x.name.toLowerCase().includes(q) || String(x.id)===q);
    return `${header('Add item','Search the complete Torn item catalog',true)}<div class="tta-content"><div class="tta-search"><input id="tta-search" placeholder="Search item name or ID\u2026" value="${esc(state.search)}" autocomplete="off" aria-label="Search Torn items"></div>${!hasApiKey()?'<div class="tta-banner"><strong>Catalog preview:</strong> sample search results are available below. Add an API key in Settings to load the complete current Torn item catalog.</div>':`<div class="tta-catalogmeta"><strong>${qty(results.length)}</strong>&nbsp;matching \u00B7 ${qty(state.catalog.length)} total Torn items loaded</div>`}${results.length?results.map(x=>`<div class="tta-result">${itemIcon(x)}<div class="tta-resultcopy"><div class="tta-itemname">${esc(x.name)}</div><small>#${x.id} \u00B7 ${esc(x.type||'Item')}</small></div><button class="tta-btn" data-act="confirmAdd" data-id="${x.id}">Add</button></div>`).join(''):'<div class="tta-empty">No matching items.</div>'}</div>`;
  }


  function helpHtml() {
    return `${header('Help & Guide','How to use the Cash Flow Analyzer',true)}<div class="tta-content"><section class="tta-help-intro"><h2>Cash Flow Analyzer Guide</h2><p>Use this page as a quick reference for navigation, syncing and understanding each financial workspace. Your analyzed data stays in this device's local storage.</p></section><div class="tta-help-grid"><section class="tta-help-card wide"><div class="tta-help-card-head"><div class="icon">\uD83D\uDE80</div><h3>Getting started</h3></div><p>Open <b>Settings</b> and tap <b>Create key</b> to have Torn generate a custom API key with the analyzer's required selections. Copy the generated key back into Settings, tap <b>Save & test</b>, then run <b>Quick Sync</b>. Torn PDA's injected API key is also supported.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u2301</div><h3>Background Quick Sync</h3></div><p>While the script is active, it checks for new data about every minute. It runs silently and does not interrupt scrolling, inputs or the page you are using.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u26A1</div><h3>Quick Sync vs Full Resync</h3></div><p><b>Quick Sync</b> checks from the last successful sync forward. <b>Full Resync</b> rebuilds discovered local history from the beginning and should mainly be used for repairs or major backfills.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u2195</div><h3>Cash Flow</h3></div><p>Shows recognized money coming in and going out, grouped into useful categories. Item-related rows also show the item name and quantity when available. Search and filter the ledger to inspect individual events. Internal transfers are excluded from earned/spent totals.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u25A6</div><h3>Trade Analysis</h3></div><p>Uses FIFO accounting to match sales against your oldest recorded acquisitions. Tap an item for details, use the period selector for date ranges, and open Acquisition History for lot-level records.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u25C7</div><h3>Net Worth</h3></div><p>Combines Torn's official net-worth/current-money snapshots with analyzer-recorded item activity. Player money/item transfers and completed Player Trades are shown as daily changes, used/consumed items reduce recorded inventory and appear as Net Worth changes, sold items include realized FIFO profit/loss, and the page includes a selectable daily-change view, recorded Company P/L activity, a timeline and asset allocation.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u25EB</div><h3>Insights & Goals</h3></div><p>Breaks income and spending into categories, compares periods, surfaces unrecognized money-bearing logs, and tracks net-worth, cash or daily-income goals.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u2637</div><h3>Acquisition History</h3></div><p>Shows individual acquisition lots, source/method, quantity, cost, sold status and realized FIFO results. Search, filter and sort to audit where your inventory came from.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\uD83D\uDCC5</div><h3>Periods, charts and filters</h3></div><p>Use 7, 14, 30 days, All or Custom periods. Day/week/month chart grouping changes visualization only; it does not alter the underlying cached history.</p></section><section class="tta-help-card wide"><div class="tta-help-card-head"><div class="icon">\uD83D\uDD12</div><h3>Data, backup & privacy</h3></div><p>Normalized analyzer data and financial snapshots are stored locally on the device. Raw Torn logs are not retained. Settings can export/import a local JSON backup plus Cash Flow and Net Worth CSV files. Your API key is excluded from backups and sent only to Torn's official API.</p></section><section class="tta-help-card wide"><div class="tta-help-card-head"><div class="icon">\uD83D\uDCA1</div><h3>Useful tip</h3></div><p>If a date range looks incomplete, run Quick Sync first. Use Full Resync only if historical data still appears missing. Net-worth daily change is snapshot-based, so more snapshots during the day give a clearer before-and-after comparison.</p></section></div></div>`;
  }
