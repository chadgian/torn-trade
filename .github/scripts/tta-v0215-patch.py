from pathlib import Path
import re

path = Path("torn-trade-analyzer.user.js")
s = path.read_text(encoding="utf-8")

def once(old, new, label):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    s = s.replace(old, new, 1)

def sub_once(pattern, repl, label, flags=0):
    global s
    s2, count = re.subn(pattern, repl, s, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 regex match, found {count}")
    s = s2

once("// @version      0.2.14", "// @version      0.2.15", "metadata version")
once("const VERSION = '0.2.14';", "const VERSION = '0.2.15';", "runtime version")

css_marker = '''      .tta-position-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:11px}.tta-position-grid .tta-bento{padding:11px}.tta-position-grid .tta-bento b{font-size:13px}
'''
css_add = '''      .tta-feature-portal{position:relative;margin:14px 0 18px;padding:13px;border:1px solid #91cdf74d;border-radius:21px;background:linear-gradient(145deg,#91cdf719,#79dfb30e 48%,#ffffff09);box-shadow:0 16px 34px #07151e45,inset 0 1px #ffffff20;overflow:hidden}.tta-feature-portal:before{content:"";position:absolute;inset:0 auto auto 0;width:56%;height:2px;background:linear-gradient(90deg,var(--tta-blue),var(--tta-green),transparent)}.tta-portal-head{position:relative;display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin:0 2px 11px}.tta-portal-head small{display:block;color:var(--tta-blue);font-size:8px;font-weight:900;letter-spacing:1px}.tta-portal-head h3{margin:2px 0 0;color:var(--tta-text);font-size:15px}.tta-portal-head>span{color:var(--tta-muted);font-size:9px;font-weight:750}.tta-feature-portal .tta-fin-nav{padding:1px 1px 3px}.tta-feature-portal .tta-toolcard{position:relative;flex:0 0 clamp(205px,70vw,245px);min-height:104px;padding:13px 14px;display:grid!important;grid-template-columns:42px minmax(0,1fr);gap:11px;align-items:center;text-align:left;border:1px solid #ffffff2b!important;border-radius:17px;background:linear-gradient(145deg,#ffffff1c,#ffffff0a)!important;color:var(--tta-text)!important;box-shadow:0 10px 24px #07151e3d,inset 0 1px #ffffff18;overflow:hidden}.tta-feature-portal .tta-toolcard:after{content:"›";position:absolute;right:12px;top:9px;color:#ffffff65;font-size:24px;font-weight:300}.tta-feature-portal .tta-toolcard:active{transform:scale(.985);border-color:#91cdf780!important;background:linear-gradient(145deg,#ffffff24,#91cdf712)!important}.tta-tool-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:linear-gradient(145deg,#79dfb325,#91cdf726);border:1px solid #ffffff28;font-size:21px;color:var(--tta-text)}.tta-toolcopy{min-width:0;display:block}.tta-toolcopy strong{display:block;font-size:13px!important;color:var(--tta-text)}.tta-toolcopy small{display:block;margin-top:4px!important;padding-right:12px;color:var(--tta-muted)!important;font-size:9px!important;line-height:1.4}.tta-toolcopy em{display:block;margin-top:8px;color:var(--tta-blue);font-size:8.5px;font-style:normal;font-weight:900;text-transform:uppercase;letter-spacing:.45px}.tta-help-intro{padding:14px;margin-bottom:11px;border:1px solid #91cdf73b;border-radius:18px;background:linear-gradient(145deg,#91cdf715,#79dfb30b)}.tta-help-intro h2{margin:0 0 5px;font-size:17px}.tta-help-intro p{margin:0;color:var(--tta-muted);font-size:10px;line-height:1.55}.tta-help-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.tta-help-card{padding:12px;border:1px solid #ffffff1d;border-radius:16px;background:linear-gradient(145deg,#ffffff11,#ffffff07);box-shadow:var(--tta-shadow),inset 0 1px #ffffff0e}.tta-help-card.wide{grid-column:1/-1}.tta-help-card .icon{display:grid;place-items:center;width:34px;height:34px;margin-bottom:8px;border-radius:11px;background:#ffffff0d;border:1px solid #ffffff1c;font-size:17px}.tta-help-card h3{margin:0 0 5px;font-size:12px;color:var(--tta-text)}.tta-help-card p{margin:0;color:var(--tta-muted);font-size:9px;line-height:1.55}.tta-help-card b{color:var(--tta-text)}.tta-nw-daily{margin-top:11px}.tta-nw-delta{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 12px;margin:8px 0 10px;border:1px solid #ffffff1c;border-radius:14px;background:#ffffff09}.tta-nw-delta small{display:block;color:var(--tta-muted);font-size:9px}.tta-nw-delta b{display:block;margin-top:3px;font-size:19px;font-variant-numeric:tabular-nums}.tta-nw-delta span{max-width:210px;text-align:right;color:var(--tta-faint);font-size:8.5px;line-height:1.35}.tta-nw-change-list{display:grid;gap:7px}.tta-nw-change{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px 10px;border:1px solid #ffffff18;border-radius:13px;background:#ffffff08}.tta-nw-change-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:#ffffff0c;border:1px solid #ffffff18;font-size:16px}.tta-nw-change-copy{min-width:0}.tta-nw-change-copy strong{display:block;color:var(--tta-text);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tta-nw-change-copy small{display:block;margin-top:2px;color:var(--tta-faint);font-size:8.3px;line-height:1.35;white-space:normal}.tta-nw-change-value{text-align:right;font-size:10px;font-weight:900;white-space:nowrap}.tta-nw-disclaimer{margin-top:8px;color:var(--tta-faint);font-size:8.5px;line-height:1.45}
'''
once(css_marker, css_add + css_marker, "feature portal/help/networth CSS")

old_mobile = '''      @media(max-width:520px){.tta-content{padding-left:10px;padding-right:10px}.tta-period{align-items:stretch;flex-direction:column}.tta-syncactions{width:100%;display:grid;grid-template-columns:1fr 1fr}.tta-syncactions .tta-btn{width:100%}.tta-position-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tta-position-grid .tta-bento:last-child{grid-column:1/-1}.tta-listtools{grid-template-columns:1fr}.tta-consolidated{font-size:27px!important}}'''
new_mobile = '''      @media(max-width:520px){.tta-content{padding-left:10px;padding-right:10px}.tta-period{align-items:stretch;flex-direction:column}.tta-syncactions{width:100%;display:grid;grid-template-columns:1fr 1fr}.tta-syncactions .tta-btn{width:100%}.tta-position-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tta-position-grid .tta-bento:last-child{grid-column:1/-1}.tta-listtools{grid-template-columns:1fr}.tta-consolidated{font-size:27px!important}.tta-help-grid{grid-template-columns:1fr}.tta-help-card.wide{grid-column:auto}.tta-portal-head{align-items:flex-start;flex-direction:column}.tta-nw-delta{grid-template-columns:1fr}.tta-nw-delta span{text-align:left;max-width:none}.tta-nw-change{grid-template-columns:32px minmax(0,1fr)}.tta-nw-change-value{grid-column:2;text-align:left}}'''
once(old_mobile, new_mobile, "mobile CSS")

sub_once(
    r'''  function header\(title, sub, back=false\) \{\n    return `.*?`;\n  \}''',
    '''  function header(title, sub, back=false) {
    return `<div class="tta-header">${back?'<button class="tta-back" data-act="back" aria-label="Back" title="Back">‹</button>':''}<div class="tta-brand"><div class="tta-mark" aria-hidden="true">📈</div><div class="tta-brandcopy"><div class="tta-title">${esc(title)}${state.demo?'<span class="tta-demo">DEMO</span>':''}</div><div class="tta-sub">${esc(sub)}</div></div></div>${!back?'<button class="tta-iconbtn" data-act="help" aria-label="Help and guide" title="Help">?</button><button class="tta-iconbtn" data-act="settings" aria-label="Settings" title="Settings">⚙</button>':''}<button class="tta-iconbtn" data-act="close" aria-label="Close cash flow analyzer" title="Close">×</button></div>`;
  }''',
    "header help button",
    re.S,
)

sub_once(
    r'''  function financialNavHtml\(\)\{return `.*?`;\}''',
    '''  function financialNavHtml(){return `<section class="tta-feature-portal"><div class="tta-portal-head"><div><small>FEATURE PORTAL</small><h3>Open a financial workspace</h3></div><span>Choose a tool →</span></div><div class="tta-fin-nav portal" aria-label="Financial tools"><button class="tta-toolcard" data-act="cashflow"><span class="tta-tool-icon">↕</span><span class="tta-toolcopy"><strong>Cash Flow</strong><small>Review recognized income, spending, categories and transaction details.</small><em>Open Cash Flow →</em></span></button><button class="tta-toolcard" data-act="trade"><span class="tta-tool-icon">▦</span><span class="tta-toolcopy"><strong>Trade Analysis</strong><small>Explore FIFO profit, acquisitions, sales and item history.</small><em>Open Trade Analysis →</em></span></button><button class="tta-toolcard" data-act="networth"><span class="tta-tool-icon">◇</span><span class="tta-toolcopy"><strong>Net Worth</strong><small>Inspect Torn wealth snapshots, daily changes and your recorded portfolio.</small><em>Open Net Worth →</em></span></button></div></section>`;}''',
    "financial tools portal",
    re.S,
)

transfer_card = '<section class="tta-bento tta-transfer-card"><small>Internal transfers</small><b class="tta-transfer">↔ ${money(sum.transferIn+sum.transferOut)}</b><p>Moving your own money does not count as income or spending.</p></section>'
once(transfer_card, "", "remove dashboard internal transfer card")
once("Money in minus money out for the current TCT day. Transfers are tracked separately.", "Money in minus money out for the current TCT day.", "dashboard hero copy")
once('${flowLegendHtml()}<div class="tta-sectionintro"><div><small>Explore</small><h3>Financial tools</h3></div><span>Swipe the cards</span></div>${financialNavHtml()}', '${financialNavHtml()}', "remove dashboard transfer legend and old tools heading")

help_html = '''
  function helpHtml() {
    return `${header('Help & Guide','How to use the Cash Flow Analyzer',true)}<div class="tta-content"><section class="tta-help-intro"><h2>Cash Flow Analyzer Guide</h2><p>Use this page as a quick reference for navigation, syncing and understanding each financial workspace. Your analyzed data stays in this device's local storage.</p></section><div class="tta-help-grid"><section class="tta-help-card wide"><div class="icon">🚀</div><h3>Getting started</h3><p>Open <b>Settings</b>, add a Torn API key with <b>User → Log</b> access, then run <b>Quick Sync</b>. The analyzer discovers recognizable cash movements, item acquisitions, sales and completed player trades. Torn PDA's injected API key is also supported.</p></section><section class="tta-help-card"><div class="icon">⌁</div><h3>Background Quick Sync</h3><p>While the script is active, it checks for new data about every minute. It runs silently and does not interrupt scrolling, inputs or the page you are using.</p></section><section class="tta-help-card"><div class="icon">⚡</div><h3>Quick Sync vs Full Resync</h3><p><b>Quick Sync</b> checks from the last successful sync forward. <b>Full Resync</b> rebuilds discovered local history from the beginning and should mainly be used for repairs or major backfills.</p></section><section class="tta-help-card"><div class="icon">↕</div><h3>Cash Flow</h3><p>Shows recognized money coming in and going out, grouped into useful categories. Search and filter the ledger to inspect individual events. Internal transfers are excluded from earned/spent totals.</p></section><section class="tta-help-card"><div class="icon">▦</div><h3>Trade Analysis</h3><p>Uses FIFO accounting to match sales against your oldest recorded acquisitions. Tap an item for details, use the period selector for date ranges, and open Acquisition History for lot-level records.</p></section><section class="tta-help-card"><div class="icon">◇</div><h3>Net Worth</h3><p>Combines Torn's official net-worth/current-money snapshots with analyzer-recorded item activity. The <b>Today's recent changes</b> section shows daily snapshot movement plus detected item and cash events that may explain it.</p></section><section class="tta-help-card"><div class="icon">☷</div><h3>Acquisition History</h3><p>Shows individual acquisition lots, source/method, quantity, cost, sold status and realized FIFO results. Search, filter and sort to audit where your inventory came from.</p></section><section class="tta-help-card"><div class="icon">📅</div><h3>Periods, charts and filters</h3><p>Use 7, 14, 30 days, All or Custom periods. Day/week/month chart grouping changes visualization only; it does not alter the underlying cached history.</p></section><section class="tta-help-card wide"><div class="icon">🔒</div><h3>Data and privacy</h3><p>Normalized analyzer data and financial snapshots are stored locally on the device. Raw Torn logs are not retained. Your API key is sent only to Torn's official API and is not uploaded to GitHub or shared with us.</p></section><section class="tta-help-card wide"><div class="icon">💡</div><h3>Useful tip</h3><p>If a date range looks incomplete, run Quick Sync first. Use Full Resync only if historical data still appears missing. Net-worth daily change is snapshot-based, so more snapshots during the day give a clearer before-and-after comparison.</p></section></div></div>`;
  }

'''
once("  function settingsHtml() {", help_html + "  function settingsHtml() {", "help page")

daily_functions = '''
  function dailyNetWorthActivity() {
    const now=nowSec(),from=tctDayStart(now),to=now;
    const snapshots=(state.financialSnapshots||[]).filter(x=>{const ts=Number(x?.networth?.timestamp||x?.timestamp)||0;return ts>=from&&ts<=to&&x?.networth;}).slice().sort((a,b)=>(Number(a?.networth?.timestamp||a?.timestamp)||0)-(Number(b?.networth?.timestamp||b?.timestamp)||0));
    const before=(state.financialSnapshots||[]).filter(x=>x?.networth&&(Number(x?.networth?.timestamp||x?.timestamp)||0)<from).slice().sort((a,b)=>(Number(b?.networth?.timestamp||b?.timestamp)||0)-(Number(a?.networth?.timestamp||a?.timestamp)||0))[0]||null;
    const latest=snapshots[snapshots.length-1]||null,baseline=before||snapshots[0]||null;
    const latestTotal=Number(latest?.networth?.total),baselineTotal=Number(baseline?.networth?.total);
    const delta=Number.isFinite(latestTotal)&&Number.isFinite(baselineTotal)&&latest!==baseline?latestTotal-baselineTotal:null;
    const rows=[];
    for(const t of state.transactions||[]){
      const ts=Number(t?.timestamp)||0;if(ts<from||ts>to)continue;
      const item=catalogItem(t.itemId),q=Math.max(0,Number(t.qty)||0);if(!(q>0))continue;
      if(t.side==='buy'){
        const cost=Math.max(0,Number(t.total)||0),market=q*Math.max(0,Number(item.marketPrice)||0),free=!!t.free;
        rows.push({timestamp:ts,kind:'item-in',icon:'＋',title:`Acquired ${qty(q)} × ${item.name}`,meta:`${t.source||'Item acquisition'} · ${free?'Free / $0 cost':`Cost ${money(cost)}`}${market?` · Est. current value ${money(market)}`:''}`,value:market||cost,valueClass:'pos'});
      }else if(t.side==='sell'){
        const proceeds=Math.max(0,Number(t.netTotal??t.total)||0);
        rows.push({timestamp:ts,kind:'item-out',icon:'−',title:`Sold ${qty(q)} × ${item.name}`,meta:`${t.source||'Item sale'} · Net proceeds ${money(proceeds)}`,value:proceeds,valueClass:'pos'});
      }
    }
    for(const x of state.cashFlows||[]){
      const ts=Number(x?.timestamp)||0;if(ts<from||ts>to||x?.transfer||String(x?.direction||'').startsWith('transfer'))continue;
      const amount=Math.max(0,Number(x?.amount)||0);if(!(amount>0))continue;
      const incoming=x.direction==='in';
      rows.push({timestamp:ts,kind:incoming?'money-in':'money-out',icon:incoming?'↑':'↓',title:x.title||x.category||(incoming?'Money received':'Money spent'),meta:`${x.category||'Cash'} · ${x.source||'Torn Log'}`,value:amount,valueClass:incoming?'pos':'neg',prefix:incoming?'+':'-'});
    }
    rows.sort((a,b)=>b.timestamp-a.timestamp||String(a.title).localeCompare(String(b.title)));
    return {from,to,snapshots,baseline,latest,delta,rows};
  }
  function dailyNetWorthChangesHtml() {
    const d=dailyNetWorthActivity(),baselineTs=Number(d.baseline?.networth?.timestamp||d.baseline?.timestamp)||0,latestTs=Number(d.latest?.networth?.timestamp||d.latest?.timestamp)||0;
    const deltaText=d.delta==null?'Waiting for another comparable snapshot':`${d.delta>=0?'+':''}${money(d.delta)}`;
    const deltaClass=d.delta==null?'':d.delta>=0?'pos':'neg';
    const baselineText=d.delta==null?(d.latest?`Latest snapshot ${tctDateTimeStr(latestTs)} TCT`:'Run Sync to create a net-worth snapshot'):`Compared with ${baselineTs<d.from?'the latest pre-day snapshot':'the first snapshot today'} · ${tctDateTimeStr(baselineTs)} TCT`;
    const rows=d.rows.slice(0,20).map(x=>`<div class="tta-nw-change"><div class="tta-nw-change-icon">${esc(x.icon)}</div><div class="tta-nw-change-copy"><strong>${esc(x.title)}</strong><small>${esc(tctDateTimeStr(x.timestamp))} TCT · ${esc(x.meta)}</small></div><div class="tta-nw-change-value ${x.valueClass||''}">${x.prefix||''}${money(x.value||0)}</div></div>`).join('');
    return `<section class="tta-fin-section tta-nw-daily"><div class="tta-sectionhead"><div><small>Current TCT day</small><h3>Today&#39;s recent net-worth changes</h3></div><span class="tta-sectionhint">${qty(d.rows.length)} detected event${d.rows.length===1?'':'s'}</span></div><div class="tta-nw-delta"><div><small>Torn-reported net-worth movement</small><b class="${deltaClass}">${esc(deltaText)}</b></div><span>${esc(baselineText)}</span></div><div class="tta-nw-change-list">${rows||'<div class="tta-empty">No item acquisitions, sales or non-transfer cash events have been detected for the current TCT day yet.</div>'}</div>${d.rows.length>20?`<div class="tta-morehint">Showing the latest 20 of ${qty(d.rows.length)} detected events today.</div>`:''}<div class="tta-nw-disclaimer">The Torn total change is calculated from stored /user/networth snapshots. The event list is analyzer-detected activity that may explain the movement; it is not a guaranteed one-to-one reconciliation of Torn's total.</div></section>`;
  }
'''
once("  function netWorthHtml() {", daily_functions + "  function netWorthHtml() {", "daily networth helper functions")
once('</div><div class="tta-cashhero"><div class="tta-cashcard"><small>Torn item holdings</small>', '</div>${dailyNetWorthChangesHtml()}<div class="tta-cashhero"><div class="tta-cashcard"><small>Torn item holdings</small>', "daily networth section insertion")

old_render = '''root.innerHTML=`<div class="tta-shell">${state.view==='add'?addItemHtml():state.view==='settings'?settingsHtml():state.view==='ledger'?ledgerHtml():state.view==='cash'?cashFlowHtml():state.view==='networth'?netWorthHtml():state.view==='trade'?tradeHtml():dashboardHtml()}</div>${loadingHtml()}<div id="tta-toast" class="tta-toast ${state.toast?'show':''}">${esc(state.toast||'')}</div>`;'''
new_render = '''root.innerHTML=`<div class="tta-shell">${state.view==='add'?addItemHtml():state.view==='settings'?settingsHtml():state.view==='help'?helpHtml():state.view==='ledger'?ledgerHtml():state.view==='cash'?cashFlowHtml():state.view==='networth'?netWorthHtml():state.view==='trade'?tradeHtml():dashboardHtml()}</div>${loadingHtml()}<div id="tta-toast" class="tta-toast ${state.toast?'show':''}">${esc(state.toast||'')}</div>`;'''
once(old_render, new_render, "help render route")
once("      else if(act==='settings'){state.view='settings';render();}\n", "      else if(act==='settings'){state.view='settings';render();}\n      else if(act==='help'){state.view='help';render({preserveScroll:false});}\n", "help click route")

path.write_text(s, encoding="utf-8")
