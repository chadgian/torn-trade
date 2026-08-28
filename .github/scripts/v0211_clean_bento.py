from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

# Build deliberately from the known-good v0.2.1 runtime.
assert '// @version      0.2.1' in s
assert "const VERSION = '0.2.1';" in s
s=s.replace('// @version      0.2.1','// @version      0.2.11',1)
s=s.replace("const VERSION = '0.2.1';","const VERSION = '0.2.11';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with fast last-sync updates and optional full-history resync. Data stays on-device.','Torn cash-flow, spending, earnings, net-worth and trade analytics with a clean Bento dashboard, TCT daily flow and fast sync modes. Data stays on-device.',1)

# Today must always mean the current Torn City Time (UTC) day, not the previous sync day.
old="function cashFlowBoundsToday() {const now=Math.min(Number(state.sync?.lastSync)||nowSec(),nowSec());return {from:tctDayStart(now),to:now};}"
new="function cashFlowBoundsToday() {const now=nowSec();return {from:tctDayStart(now),to:now};}"
assert old in s
s=s.replace(old,new,1)

# Keep the proven v0.2.1 launcher implementation untouched. Only the financial navigation markup changes.
old_nav='''  function financialNavHtml(){return `<div class="tta-fin-nav"><button class="tta-btn secondary" data-act="cashflow"><strong>⇅ Cash Flow</strong><small>income · spending · transfers</small></button><button class="tta-btn secondary" data-act="trade"><strong>▦ Trade Analysis</strong><small>FIFO · acquisitions · profit</small></button><button class="tta-btn secondary" data-act="networth"><strong>◇ Net Worth</strong><small>assets · holdings · portfolio</small></button></div>`;}'''
new_nav='''  function financialNavHtml(){return `<div class="tta-fin-nav" aria-label="Financial tools"><button class="tta-btn secondary tta-toolcard" data-act="cashflow"><strong>↕ Cash Flow</strong><small>Money in, out & transfers</small></button><button class="tta-btn secondary tta-toolcard" data-act="trade"><strong>▦ Trade Analysis</strong><small>FIFO, acquisitions & profit</small></button><button class="tta-btn secondary tta-toolcard" data-act="networth"><strong>◇ Net Worth</strong><small>Assets, holdings & portfolio</small></button></div>`;}\n  function flowLegendHtml(){return `<div class="tta-flowlegend"><span class="in">+ Money in</span><span class="out">− Money out</span><span class="transfer">↔ Transfer</span></div>`;}'''
assert old_nav in s
s=s.replace(old_nav,new_nav,1)

# Replace only the dashboard renderer. Avoid nested template literals inside template expressions.
new_dashboard=r'''  function dashboardHtml() {
    const today=cashFlowBoundsToday();
    const sum=cashFlowSummary(today.from,today.to);
    const snap=latestFinancialSnapshot();
    const portfolio=analyzerPortfolio();
    const nw=Number(snap?.networth?.total)||0;
    const todayRows=allCashFlows().filter(x=>x.timestamp>=today.from&&x.timestamp<=today.to);
    const recent=todayRows.slice(0,12);
    const apiBanner=!hasApiKey()?'<div class="tta-banner"><strong>Preview mode.</strong> Add a Torn API key in Settings to build your financial ledger.</div>':'';
    const lastSync=state.sync?.lastSync?`Last sync ${esc(tctDateTimeStr(state.sync.lastSync))} TCT`:'Run Quick Sync to load today’s movements';
    const movementLabel=`${qty(todayRows.length)} movement${todayRows.length===1?'':'s'} recorded today`;
    const moreLabel=todayRows.length>12?`<div class="tta-morehint">Showing the latest 12 of ${qty(todayRows.length)} movements from the current TCT day.</div>`:'';
    const networthLabel=snap?.networth?money(nw):'Sync to load';
    const netClass=sum.net>=0?'pos':'neg';
    const profitClass=portfolio.realizedProfit>=0?'pos':'neg';
    return `${header('Cash Flow Analyzer',`v${VERSION} · clear financial overview`)}<div class="tta-content tta-dashboard">${apiBanner}<div class="tta-period tta-dashboard-top"><div><small>Today · Torn City Time</small><strong>${esc(tctDateStr(today.from))}</strong><span class="tta-periodhint">${lastSync}</span></div><div class="tta-syncactions"><button class="tta-btn" data-act="syncQuick" ${state.syncing?'disabled':''}>${state.syncing?'Syncing…':'⚡ Quick Sync'}</button><button class="tta-btn secondary" data-act="syncFull" ${state.syncing?'disabled':''}>⟳ Full Resync</button></div></div><div class="tta-bento-grid"><section class="tta-bento tta-bento-hero"><small>Consolidated cash flow today</small><b class="tta-consolidated ${netClass}">${money(sum.net)}</b><div class="tta-equation"><span class="pos">+ ${money(sum.earned)}</span><span>−</span><span class="neg">${money(sum.spent)}</span></div><p>Money in minus money out for the current TCT day. Transfers are tracked separately.</p></section><section class="tta-bento"><small>Money in today</small><b class="pos">+ ${money(sum.earned)}</b></section><section class="tta-bento"><small>Money out today</small><b class="neg">− ${money(sum.spent)}</b></section><section class="tta-bento tta-transfer-card"><small>Internal transfers</small><b class="tta-transfer">↔ ${money(sum.transferIn+sum.transferOut)}</b><p>Moving your own money does not count as income or spending.</p></section></div>${flowLegendHtml()}<div class="tta-sectionintro"><div><small>Explore</small><h3>Financial tools</h3></div><span>Swipe the cards</span></div>${financialNavHtml()}<div class="tta-sectionintro"><div><small>Snapshot</small><h3>Financial position</h3></div></div><div class="tta-position-grid"><section class="tta-bento"><small>Torn net worth</small><b>${networthLabel}</b></section><section class="tta-bento"><small>Recorded inventory value</small><b>${money(portfolio.marketValue)}</b></section><section class="tta-bento"><small>Realized trade profit</small><b class="${profitClass}">${money(portfolio.realizedProfit)}</b></section></div><section class="tta-glass-section"><div class="tta-sectionhead"><div><small>Current TCT day</small><h3>Today’s cash movements</h3><span class="tta-sectionhint">${movementLabel}</span></div><button class="tta-btn secondary" data-act="cashflow">Open ledger</button></div><div class="tta-table-scroll"><table class="tta-flowtable"><tbody>${cashFlowRowsHtml(recent,12)}</tbody></table></div>${moreLabel}</section></div>`;
  }
'''
pat=r"  function dashboardHtml\(\) \{.*?\n  \}\n  function cashFlowDateRange"
s2,n=re.subn(pat,new_dashboard+"  function cashFlowDateRange",s,count=1,flags=re.S)
assert n==1,n
s=s2

# Lighter, calmer Bento/glass theme. The shell cannot scroll horizontally; only explicit strips/tables can.
css=r'''
      /* v0.2.11 clean Bento UI — layered over the proven v0.2.1 runtime */
      :root{--tta-bg:#1b2a34;--tta-panel:#233641;--tta-card:#2a3e4a;--tta-soft:#344b58;--tta-line:#ffffff22;--tta-text:#f7fafc;--tta-muted:#cfdae2;--tta-faint:#aebfca;--tta-green:#79dfb3;--tta-red:#ff9da3;--tta-blue:#91cdf7;--tta-yellow:#f0cc78;--tta-shadow:0 12px 30px #08141c35}
      #tta-root{background:#0e1921b8;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
      .tta-shell{overflow-y:auto!important;overflow-x:hidden!important;background:radial-gradient(circle at 12% 0%,#3d657650 0,transparent 34%),radial-gradient(circle at 92% 18%,#376a5a3d 0,transparent 30%),linear-gradient(180deg,#1e303b,#172630)}
      .tta-content{width:min(100%,760px)!important;max-width:760px!important;min-width:0!important;overflow-x:hidden!important;padding:14px 12px 34px}
      .tta-content>*{min-width:0;max-width:100%}
      .tta-header{background:#21333edc;border-bottom-color:#ffffff20;backdrop-filter:blur(15px);-webkit-backdrop-filter:blur(15px)}
      .tta-title{font-size:16px}.tta-sub{color:#d1dce4}.tta-mark{background:linear-gradient(145deg,#3c685a,#386176)}
      .tta-btn{border-radius:12px;background:linear-gradient(135deg,#7fe2b8,#93cff7);color:#10242d!important;box-shadow:0 7px 18px #0917202f}.tta-btn.secondary,.tta-iconbtn,.tta-back,.tta-chip,.tta-history-search{background:#ffffff0e;border-color:#ffffff22;color:var(--tta-text)!important}
      .tta-chip.active{background:linear-gradient(135deg,#7fe2b8,#91dcc4);color:#123128!important;border-color:transparent}
      .tta-period{padding:11px 12px;background:#ffffff09;border:1px solid #ffffff18;border-radius:16px}.tta-periodhint{display:block;margin-top:3px;color:var(--tta-faint);font-size:9px}
      .tta-dashboard-top{align-items:flex-start}.tta-syncactions{max-width:100%}.tta-syncactions .tta-btn{min-height:34px;padding:7px 9px;font-size:10px}
      .tta-bento-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:10px 0}.tta-bento{min-width:0;padding:13px;border:1px solid #ffffff20;border-radius:18px;background:linear-gradient(145deg,#ffffff13,#ffffff08);box-shadow:var(--tta-shadow),inset 0 1px #ffffff16;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
      .tta-bento small{display:block;color:var(--tta-muted);font-size:9px;text-transform:uppercase;letter-spacing:.5px;font-weight:750}.tta-bento b{display:block;margin-top:5px;color:var(--tta-text);font-size:15px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}.tta-bento p{margin:7px 0 0;color:var(--tta-faint);font-size:9px;line-height:1.45}
      .tta-bento-hero{grid-column:1/-1;padding:17px;background:linear-gradient(135deg,#ffffff19,#6ac19f10 58%,#73bce819)}.tta-consolidated{font-size:30px!important;line-height:1.05;margin-top:7px!important}.tta-equation{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:7px;font-size:10px;font-weight:800;color:var(--tta-muted)}.tta-transfer-card{grid-column:1/-1}.tta-transfer{color:var(--tta-blue)!important}
      .tta-flowlegend{display:flex;gap:7px;overflow-x:auto;padding:1px 1px 8px;scrollbar-width:none}.tta-flowlegend::-webkit-scrollbar{display:none}.tta-flowlegend span{flex:0 0 auto;padding:5px 8px;border-radius:999px;background:#ffffff09;border:1px solid #ffffff16;font-size:9px;font-weight:750}.tta-flowlegend .in{color:var(--tta-green)}.tta-flowlegend .out{color:var(--tta-red)}.tta-flowlegend .transfer{color:var(--tta-blue)}
      .tta-sectionintro{display:flex;align-items:flex-end;justify-content:space-between;gap:9px;margin:15px 2px 8px}.tta-sectionintro small,.tta-sectionhead small{display:block;color:var(--tta-faint);font-size:8px;text-transform:uppercase;letter-spacing:.6px}.tta-sectionintro h3,.tta-sectionhead h3{margin:1px 0 0;color:var(--tta-text);font-size:14px}.tta-sectionintro>span,.tta-sectionhint,.tta-morehint{color:var(--tta-faint);font-size:8.5px}
      .tta-fin-nav{display:flex!important;gap:9px!important;grid-template-columns:none!important;width:100%;max-width:100%;overflow-x:auto!important;overflow-y:hidden!important;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;padding:1px 1px 8px;scrollbar-width:none}.tta-fin-nav::-webkit-scrollbar{display:none}.tta-fin-nav .tta-toolcard{flex:0 0 clamp(180px,62vw,220px);min-height:72px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;scroll-snap-align:start;text-align:left;background:linear-gradient(145deg,#ffffff14,#ffffff08)!important;border:1px solid #ffffff20!important}.tta-toolcard strong{font-size:11px;color:var(--tta-text)}.tta-toolcard small{margin-top:4px;color:var(--tta-faint);font-size:8.5px;white-space:normal;line-height:1.35}
      .tta-position-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:11px}.tta-position-grid .tta-bento{padding:11px}.tta-position-grid .tta-bento b{font-size:13px}
      .tta-glass-section,.tta-fin-section,.tta-chartcard,.tta-item,.tta-keycard,.tta-tos,.tta-banner,.tta-ledgerwrap{background:linear-gradient(145deg,#ffffff10,#ffffff07)!important;border:1px solid #ffffff1d!important;box-shadow:var(--tta-shadow),inset 0 1px #ffffff10;border-radius:18px!important;backdrop-filter:blur(11px);-webkit-backdrop-filter:blur(11px)}.tta-glass-section{padding:12px;margin:11px 0}.tta-fin-section{padding:12px}
      .tta-stat,.tta-cashcard,.tta-ministat{background:#ffffff0b!important;border-color:#ffffff1a!important}.tta-stat label,.tta-cashcard small,.tta-ministat small,.tta-source,.tta-snapshot-note,.tta-listmeta{color:var(--tta-muted)!important}.tta-stat b,.tta-cashcard b,.tta-ministat b{color:var(--tta-text)}
      .tta-note{color:#c7d5de;background:#ffffff08;border:1px solid #ffffff15;border-radius:12px;padding:9px 10px}.tta-history-search{color:var(--tta-text)!important}.tta-history-search::placeholder{color:#a8bac6}.tta-flowtable th{color:#b8c8d3;border-bottom-color:#ffffff1a}.tta-flowtable td{color:#eef4f7;border-bottom-color:#ffffff13}.tta-flowmeta{color:#a8bac6}.tta-flowbadge.in{background:#79dfb318}.tta-flowbadge.out{background:#ff9da318}.tta-flowbadge.transfer{background:#91cdf718}
      .tta-table-scroll,.tta-ledgerwrap{width:100%;max-width:100%;overflow-x:auto!important;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}.tta-flowtable{min-width:560px}.tta-chartviewport{max-width:100%}.tta-axis{fill:#e0e8ed!important;color:#e0e8ed!important}.tta-grid{stroke:#ffffff18}.tta-zero{stroke:#aebfca}.tta-empty{color:#c8d4dc}
      @media(max-width:520px){.tta-content{padding-left:10px;padding-right:10px}.tta-period{align-items:stretch;flex-direction:column}.tta-syncactions{width:100%;display:grid;grid-template-columns:1fr 1fr}.tta-syncactions .tta-btn{width:100%}.tta-position-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tta-position-grid .tta-bento:last-child{grid-column:1/-1}.tta-listtools{grid-template-columns:1fr}.tta-consolidated{font-size:27px!important}}
'''
marker='''      @media(prefers-reduced-motion:reduce){.tta-loadingbar span,.tta-spinner,.tta-fabspinner{animation-duration:2.2s}.tta-item,.tta-btn,.tta-chip,.tta-iconbtn,.tta-back,.tta-pin,.tta-toast{transition:none}}\n    `;'''
assert marker in s
s=s.replace(marker,marker.replace('\n    `;','\n'+css+'    `;'),1)

# Ensure the source is structurally the v0.2.1 launcher, not any later watchdog/diagnostic experiment.
for forbidden in ['TTA_DEBUG_PREFIX','__TTA_DEBUG_DUMP__','__TCFA_RUNTIME_INSTANCE__','MutationObserver','ttaFabSnapshot']:
    assert forbidden not in s, forbidden
assert "function fabIconSvg()" in s
assert "fab.style.display=state.open?'none':'inline-flex';" in s
assert "function mount()" in s

p.write_text(s)
