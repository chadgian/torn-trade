from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.2','// @version      0.2.3',1)
s=s.replace("const VERSION = '0.2.2';","const VERSION = '0.2.3';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with a clearer Bento dashboard, TCT daily flow and fast sync modes. Data stays on-device.','Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, TCT daily flow and Torn PDA compatibility fixes. Data stays on-device.',1)

# Keep the FAB above Torn SPA layers and make its base visibility explicit.
s=s.replace('z-index:2147483000;width:40px;', 'z-index:2147483646;isolation:isolate;visibility:visible;opacity:1;pointer-events:auto;width:40px;', 1)

new_breakdown = r'''  function cashBreakdownHtml(summary,limit=8){
    const rows=summary.categories.slice(0,limit);
    if(!rows.length)return '<div class="tta-empty">No recognized cash movements in this period yet.</div>';
    const body=rows.map(r=>{
      const incoming=r.earned?('+'+money(r.earned,true)):'&mdash;';
      const outgoing=r.spent?('&minus;'+money(r.spent,true)):'&mdash;';
      return `<div class="tta-breakrow"><span>${esc(r.category)}</span><b class="pos">${incoming}</b><b class="neg secondary-value">${outgoing}</b></div>`;
    }).join('');
    return `<div class="tta-breakdown"><div class="tta-breakhead"><span>Category</span><b>Money in</b><b>Money out</b></div>${body}</div>`;
  }
'''
s,n=re.subn(r"  function cashBreakdownHtml\(summary,limit=8\)\{.*?\n  \}\n(?=  function cashFlowRowsHtml)",new_breakdown,s,count=1,flags=re.S)
if n!=1:
    # v0.2.2 compressed one-line form
    s,n=re.subn(r"  function cashBreakdownHtml\(summary,limit=8\)\{.*?\}\n(?=  function cashFlowRowsHtml)",new_breakdown,s,count=1,flags=re.S)
assert n==1, f'cashBreakdownHtml replacements={n}'

new_rows = r'''  function cashFlowRowsHtml(rows,limit=200){
    const html=rows.slice(0,limit).map(x=>{
      const isTransfer=String(x.direction||'').startsWith('transfer');
      const isIn=x.direction==='in';
      const symbol=isTransfer?'&#8596;':(isIn?'&#43;':'&minus;');
      const label=isTransfer?'Transfer':(isIn?'Money in':'Money out');
      const badgeClass=isTransfer?'transfer':x.direction;
      const amountClass=isIn?'pos':(x.direction==='out'?'neg':'tta-transfer');
      return `<tr><td><span class="tta-flowtitle">${esc(x.title||x.category)}</span><span class="tta-flowmeta">${esc(tctDateTimeStr(x.timestamp))} TCT &middot; ${esc(x.source||x.category)}</span></td><td><span class="tta-flowbadge ${badgeClass}"><strong>${symbol}</strong>${label}</span></td><td>${esc(x.category)}</td><td class="num ${amountClass}">${symbol} ${money(x.amount)}</td></tr>`;
    }).join('');
    return html||'<tr><td colspan="4"><div class="tta-empty">No recognized cash flows match this period.</div></td></tr>';
  }
'''
s,n=re.subn(r"  function cashFlowRowsHtml\(rows,limit=200\)\{.*?\n  \}\n(?=  function dashboardHtml)",new_rows,s,count=1,flags=re.S)
if n!=1:
    s,n=re.subn(r"  function cashFlowRowsHtml\(rows,limit=200\)\{.*?\}\n(?=  function dashboardHtml)",new_rows,s,count=1,flags=re.S)
assert n==1, f'cashFlowRowsHtml replacements={n}'

new_dashboard = r'''  function dashboardHtml() {
    const today=cashFlowBoundsToday();
    const sum=cashFlowSummary(today.from,today.to);
    const snap=latestFinancialSnapshot();
    const portfolio=analyzerPortfolio();
    const nw=Number(snap?.networth?.total)||0;
    const todayRows=allCashFlows().filter(x=>x.timestamp>=today.from&&x.timestamp<=today.to);
    const recent=todayRows.slice(0,12);
    const movementCount=todayRows.length;
    const movementLabel=movementCount===1?'1 recorded movement today':qty(movementCount)+' recorded movements today';
    const lastSync=state.sync?.lastSync?tctDateTimeStr(state.sync.lastSync):'';
    const syncHint=lastSync?('Last sync '+esc(lastSync)+' TCT'):'Run Quick Sync to load today&#39;s movements';
    const apiBanner=hasApiKey()?'':'<div class="tta-banner"><strong>Preview mode.</strong> Add a Torn API key in Settings to build your financial ledger.</div>';
    const syncDisabled=state.syncing?'disabled':'';
    const quickLabel=state.syncing?'Syncing...':'&#9889; Quick Sync';
    const netClass=sum.net>=0?'pos':'neg';
    const profitClass=portfolio.realizedProfit>=0?'pos':'neg';
    const netWorthText=snap?.networth?money(nw):'Sync to load';
    const moreHtml=movementCount>12?('<div class="tta-morehint">Showing the latest 12 of '+qty(movementCount)+' movements from today.</div>'):'';
    return `${header('Cash Flow Analyzer',`v${VERSION} &middot; simple financial overview`)}<div class="tta-content tta-dashboard">
      ${apiBanner}
      <div class="tta-period tta-dashboard-top"><div><small>Today &middot; Torn City Time</small><strong>${esc(tctDateStr(today.from))}</strong><span class="tta-periodhint">${syncHint}</span></div><div class="tta-syncactions"><button class="tta-btn" data-act="syncQuick" ${syncDisabled}>${quickLabel}</button><button class="tta-btn secondary" data-act="syncFull" ${syncDisabled}>&#8635; Full Resync</button></div></div>
      <div class="tta-bento-grid tta-cash-bento">
        <section class="tta-bento tta-bento-hero"><div class="tta-bento-kicker">Consolidated cash flow today</div><b class="tta-consolidated ${netClass}">${money(sum.net)}</b><div class="tta-flow-equation"><span class="in">&#43; ${money(sum.earned)}</span><span>&minus;</span><span class="out">${money(sum.spent)}</span></div><small>Money in minus money out for the current TCT day. Internal transfers do not change this total.</small></section>
        <section class="tta-bento tta-bento-mini in"><span class="tta-mini-symbol">&#43;</span><div><small>Money in today</small><b>${money(sum.earned)}</b></div></section>
        <section class="tta-bento tta-bento-mini out"><span class="tta-mini-symbol">&minus;</span><div><small>Money out today</small><b>${money(sum.spent)}</b></div></section>
        <section class="tta-bento tta-bento-transfer"><span class="tta-mini-symbol">&#8596;</span><div><small>Internal transfers today</small><b>${money(sum.transferIn+sum.transferOut)}</b><em>Tracked separately so moving your own money is not treated as income or spending.</em></div></section>
      </div>
      ${flowLegendHtml()}
      <div class="tta-sectionintro"><div><small>Explore</small><h3>Financial tools</h3></div><span>Swipe cards sideways</span></div>
      ${financialNavHtml()}
      <div class="tta-sectionintro"><div><small>Snapshot</small><h3>Financial position</h3></div></div>
      <div class="tta-bento-grid tta-position-bento"><section class="tta-bento"><small>Torn net worth</small><b>${netWorthText}</b></section><section class="tta-bento"><small>Recorded inventory value</small><b>${money(portfolio.marketValue)}</b></section><section class="tta-bento"><small>Realized trade profit</small><b class="${profitClass}">${money(portfolio.realizedProfit)}</b></section></div>
      <section class="tta-glass-section"><div class="tta-sectionhead"><div><small>Current TCT day</small><h3>Today&#39;s cash movements</h3><span class="tta-sectionhint">${movementLabel}</span></div><button class="tta-btn secondary" data-act="cashflow">Open ledger</button></div><div class="tta-table-scroll"><table class="tta-flowtable"><tbody>${cashFlowRowsHtml(recent,12)}</tbody></table></div>${moreHtml}</section>
    </div>`;
  }
'''
s,n=re.subn(r"  function dashboardHtml\(\) \{.*?\n  \}\n(?=  function cashFlowDateRange)",new_dashboard,s,count=1,flags=re.S)
assert n==1, f'dashboardHtml replacements={n}'

new_cashflow = r'''  function cashFlowHtml() {
    const range=cashFlowDateRange();
    const from=range.from,to=range.to;
    const sum=cashFlowSummary(from,to);
    const q=String(state.cashSearch||'').trim().toLowerCase();
    const cat=String(state.cashCategory||'all');
    let rows=allCashFlows().filter(x=>x.timestamp>=from&&x.timestamp<=to);
    if(cat!=='all')rows=rows.filter(x=>x.category===cat);
    if(q)rows=rows.filter(x=>(String(x.title||'')+' '+String(x.category||'')+' '+String(x.source||'')).toLowerCase().includes(q));
    const cats=[...new Set(allCashFlows().map(x=>x.category))].sort();
    const netClass=sum.net>=0?'pos':'neg';
    const resultLabel=rows.length===1?'1 result':qty(rows.length)+' results';
    const options=cats.map(c=>'<option value="'+esc(c)+'" '+(cat===c?'selected':'')+'>'+esc(c)+'</option>').join('');
    return `${header('Cash Flow','Understand where your money comes from and where it goes',true)}<div class="tta-content">${periodChipsHtml()}<div class="tta-bento-grid tta-cash-bento tta-page-bento"><section class="tta-bento tta-bento-hero"><div class="tta-bento-kicker">Consolidated cash flow</div><b class="tta-consolidated ${netClass}">${money(sum.net)}</b><div class="tta-flow-equation"><span class="in">&#43; ${money(sum.earned)}</span><span>&minus;</span><span class="out">${money(sum.spent)}</span></div><small>Money in minus money out for the selected period. Transfers are shown separately.</small></section><section class="tta-bento tta-bento-mini in"><span class="tta-mini-symbol">&#43;</span><div><small>Money in</small><b>${money(sum.earned)}</b></div></section><section class="tta-bento tta-bento-mini out"><span class="tta-mini-symbol">&minus;</span><div><small>Money out</small><b>${money(sum.spent)}</b></div></section></div>${flowLegendHtml()}<section class="tta-glass-section"><div class="tta-sectionintro"><div><small>Summary</small><h3>By category</h3></div></div>${cashBreakdownHtml(sum,20)}</section><div class="tta-listtools"><input id="tta-cash-search" class="tta-history-search" placeholder="Search cash flow..." value="${esc(state.cashSearch||'')}"><select id="tta-cash-category" class="tta-history-search"><option value="all">All categories</option>${options}</select></div><section class="tta-glass-section"><div class="tta-sectionintro"><div><small>Ledger</small><h3>Money movements</h3></div><span>${resultLabel}</span></div><div class="tta-ledgerwrap"><table class="tta-flowtable"><thead><tr><th>Event</th><th>Flow</th><th>Category</th><th style="text-align:right">Amount</th></tr></thead><tbody>${cashFlowRowsHtml(rows)}</tbody></table></div></section><div class="tta-note tta-friendly-note">Transfers stay visible but are excluded from money-in and money-out totals. Item sales and purchases use the analyzer&#39;s normalized trade history.</div></div>`;
  }
'''
s,n=re.subn(r"  function cashFlowHtml\(\) \{.*?\n  \}\n(?=  function labeledKey)",new_cashflow,s,count=1,flags=re.S)
assert n==1, f'cashFlowHtml replacements={n}'

# Make the floating launcher self-healing across Torn SPA DOM replacements.
new_fab = r'''  function ensureFabMounted() {
    let fab=document.getElementById('tta-fab');
    if(!fab){
      fab=document.createElement('button');
      fab.id='tta-fab';
      fab.innerHTML=fabIconSvg();
      (document.body||document.documentElement).appendChild(fab);
    }
    bindFabDrag(fab);
    applyFabPosition(fab);
    return fab;
  }

  function updateFabState() {
    const fab=ensureFabMounted();
    const syncing=!!state.syncing;
    fab.classList.toggle('syncing',syncing);
    fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Cash Flow Analyzer');
    fab.title=syncing?'Financial history sync is running - tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?'<span class="tta-fabspinner" aria-hidden="true"></span>':fabIconSvg();
    fab.style.setProperty('display',state.open?'none':'inline-flex','important');
    fab.style.setProperty('visibility',state.open?'hidden':'visible','important');
    fab.style.setProperty('opacity','1','important');
    fab.style.setProperty('pointer-events','auto','important');
    requestAnimationFrame(()=>applyFabPosition(fab));
  }

  let fabGuardTimer=0;
  function startFabGuard(){
    if(fabGuardTimer)return;
    fabGuardTimer=window.setInterval(()=>{
      if(state.open)return;
      const fab=document.getElementById('tta-fab');
      if(!fab||!fab.isConnected){ensureFabMounted();updateFabState();}
    },1500);
  }

  function mount() {
    injectCss();
    ensureFabMounted();
    if (!document.getElementById('tta-root')) {
      const root = document.createElement('div'); root.id = 'tta-root'; document.body.appendChild(root);
    }
    updateFabState();
    startFabGuard();
    render();
  }
'''
s,n=re.subn(r"  function updateFabState\(\) \{.*?\n  \}\n  function mount\(\) \{.*?\n  \}\n(?=\n  let demoTxCache)",new_fab,s,count=1,flags=re.S)
assert n==1, f'FAB block replacements={n}'

# README release note/version.
rp=Path('README.md')
r=rp.read_text()
r=r.replace('**Current version:** v0.2.2','**Current version:** v0.2.3',1)
r += '''\n\n## v0.2.3 - Torn PDA startup compatibility\n\n- Rewrites the v0.2.2 Bento dashboard rendering to avoid nested template-string pluralization and smart punctuation in JavaScript strings.\n- Adds a self-healing floating launcher that is recreated if Torn SPA navigation removes its DOM node.\n- Gives the floating launcher explicit top-layer visibility and pointer-event rules.\n- Keeps the v0.2.2 Bento layout, current-TCT cash-flow behavior and accounting logic unchanged.\n'''
rp.write_text(r)

p.write_text(s)
