from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

s=s.replace('// @version      0.2.38','// @version      0.2.39',1)
s=s.replace("const VERSION = '0.2.38';","const VERSION = '0.2.39';",1)

state_anchor="""    granularity: load('granularity', 'day'),
    expanded: null,
"""
state_new="""    granularity: load('granularity', 'day'),
    netWorthDate: load('netWorthDate', ''),
    netWorthTrackingStartedAt: load('netWorthTrackingStartedAt', 0),
    expanded: null,
"""
if state_anchor not in s: raise SystemExit('state anchor not found')
s=s.replace(state_anchor,state_new,1)

migration_anchor="""  // v0.2.34 removes false Crime Reward rows created when an item quantity such as
  // items_gained.1 = 1 was misread as $1 of crime income.
  purgeBogusCrimeCashRows();
"""
migration_new="""  // v0.2.34 removes false Crime Reward rows created when an item quantity such as
  // items_gained.1 = 1 was misread as $1 of crime income.
  purgeBogusCrimeCashRows();
  // v0.2.39 records the first locally observed Net Worth tracking day. Existing
  // installs migrate to their earliest stored financial snapshot; Full Resync
  // history from before analyzer use must not expand the selectable Net Worth days.
  if(!(Number(state.netWorthTrackingStartedAt)>0)){
    const firstStored=(state.financialSnapshots||[]).map(x=>Number(x?.networth?.timestamp||x?.timestamp)||0).filter(x=>x>0).sort((a,b)=>a-b)[0]||nowSec();
    state.netWorthTrackingStartedAt=firstStored;save('netWorthTrackingStartedAt',firstStored);
  }
"""
if migration_anchor not in s: raise SystemExit('migration anchor not found')
s=s.replace(migration_anchor,migration_new,1)

activity_anchor="""  function dailyNetWorthActivity() {
    const now=nowSec(),from=tctDayStart(now),to=now;
"""
helpers=r'''  function tctInputDate(ts) { return new Date(tctDayStart(ts)*1000).toISOString().slice(0,10); }
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

  function dailyNetWorthActivity(dayStart=null) {
    const now=nowSec(),bounds=netWorthTrackingBounds(),selected=dayStart==null?selectedNetWorthDay().dayStart:tctDayStart(Number(dayStart)||bounds.today),from=Math.max(bounds.first,Math.min(bounds.today,selected)),to=from===bounds.today?now:from+86399;
'''
if activity_anchor not in s: raise SystemExit('daily activity anchor not found')
s=s.replace(activity_anchor,helpers,1)

old_decl="""    const latest=snapshots[snapshots.length-1]||null,baseline=before||snapshots[0]||null;
    const latestTotal=Number(latest?.networth?.total),baselineTotal=Number(baseline?.networth?.total);const delta=Number.isFinite(latestTotal)&&Number.isFinite(baselineTotal)&&latest!==baseline?latestTotal-baselineTotal:null,rows=[];
"""
new_decl="""    const latest=snapshots[snapshots.length-1]||null,baseline=before||snapshots[0]||null;
    const latestTotal=Number(latest?.networth?.total),baselineTotal=Number(baseline?.networth?.total);const delta=Number.isFinite(latestTotal)&&Number.isFinite(baselineTotal)&&latest!==baseline?latestTotal-baselineTotal:null,rows=[];let companyNet=0,companySeen=false;
"""
if old_decl not in s: raise SystemExit('activity declaration anchor not found')
s=s.replace(old_decl,new_decl,1)

old_cash="""    for(const x of state.cashFlows||[]){const ts=Number(x?.timestamp)||0;if(ts<from||ts>to||x?.transfer||String(x?.direction||'').startsWith('transfer'))continue;const amount=Math.max(0,Number(x?.amount)||0);if(!(amount>0))continue;const incoming=x.direction==='in';rows.push({timestamp:ts,kind:incoming?'money-in':'money-out',icon:incoming?'\\u2191':'\\u2193',title:x.title||x.category||(incoming?'Money received':'Money spent'),meta:`${x.category||'Cash'} \\u00B7 ${x.source||'Torn Log'}`,value:amount,valueClass:incoming?'pos':'neg',prefix:incoming?'+':'-'});}
    rows.sort((a,b)=>b.timestamp-a.timestamp||String(a.title).localeCompare(String(b.title)));return {from,to,snapshots,before,latest,baseline,delta,rows};
"""
new_cash="""    for(const x of state.cashFlows||[]){const ts=Number(x?.timestamp)||0;if(ts<from||ts>to||x?.transfer||String(x?.direction||'').startsWith('transfer'))continue;const amount=Math.max(0,Number(x?.amount)||0);if(!(amount>0))continue;const incoming=x.direction==='in',isCompany=x.category==='Company Profit / Loss'||x.source==='Company Daily Adjustment';if(isCompany){companySeen=true;companyNet+=incoming?amount:-amount;}const companyMeta=isCompany?`Company daily adjustment \\u00B7 Gross ${money(x.grossIncome)} \\u00B7 Wages ${money(x.wages)} \\u00B7 Advertising ${money(x.advertisementBudget)}`:`${x.category||'Cash'} \\u00B7 ${x.source||'Torn Log'}`;rows.push({timestamp:ts,kind:isCompany?'company-pl':(incoming?'money-in':'money-out'),icon:isCompany?'\\u25A3':(incoming?'\\u2191':'\\u2193'),title:x.title||x.category||(incoming?'Money received':'Money spent'),meta:companyMeta,value:amount,valueClass:incoming?'pos':'neg',prefix:incoming?'+':'-'});}
    rows.sort((a,b)=>b.timestamp-a.timestamp||String(a.title).localeCompare(String(b.title)));return {from,to,snapshots,before,latest,baseline,delta,rows,companyNet:companySeen?companyNet:null};
"""
if old_cash not in s: raise SystemExit('cash flow activity anchor not found')
s=s.replace(old_cash,new_cash,1)

pattern=r"  function dailyNetWorthChangesHtml\(\) \{.*?\n  \}\n  function netWorthHtml\(\) \{"
m=re.search(pattern,s,re.S)
if not m: raise SystemExit('dailyNetWorthChangesHtml block not found')
new_func=r'''  function dailyNetWorthChangesHtml() {
    const selection=selectedNetWorthDay(),d=dailyNetWorthActivity(selection.dayStart),baselineTs=Number(d.baseline?.networth?.timestamp||d.baseline?.timestamp)||0,latestTs=Number(d.latest?.networth?.timestamp||d.latest?.timestamp)||0,isToday=d.from===selection.today;
    const deltaText=d.delta==null?'Waiting for comparable snapshots':`${d.delta>=0?'+':''}${money(d.delta)}`;
    const deltaClass=d.delta==null?'':d.delta>=0?'pos':'neg';
    const baselineText=d.delta==null?(d.latest?`Latest snapshot ${tctDateTimeStr(latestTs)} TCT`:`No stored net-worth snapshot for ${tctDateStr(d.from)}`):`Compared with ${baselineTs<d.from?'the latest pre-day snapshot':'the first snapshot that day'} \u00B7 ${tctDateTimeStr(baselineTs)} TCT`;
    const companyText=d.companyNet==null?'No recorded company P/L':`${d.companyNet>=0?'+':''}${money(d.companyNet)}`;
    const companyClass=d.companyNet==null?'':d.companyNet>=0?'pos':'neg';
    const rows=d.rows.slice(0,20).map(x=>`<div class="tta-nw-change"><div class="tta-nw-change-icon">${esc(x.icon)}</div><div class="tta-nw-change-copy"><strong>${esc(x.title)}</strong><small>${esc(tctDateTimeStr(x.timestamp))} TCT \u00B7 ${esc(x.meta)}</small></div><div class="tta-nw-change-value ${x.valueClass||''}">${x.prefix||''}${money(x.value||0)}</div></div>`).join('');
    return `<section class="tta-fin-section tta-nw-daily"><div class="tta-sectionhead"><div><small>${isToday?'Current':'Selected'} TCT day</small><h3>${esc(tctDateStr(d.from))} net-worth changes</h3></div><span class="tta-sectionhint">${qty(d.rows.length)} detected event${d.rows.length===1?'':'s'}</span></div><div class="tta-nw-daypicker"><label><span>View TCT date</span><input id="tta-networth-date" type="date" min="${tctInputDate(selection.first)}" max="${tctInputDate(selection.today)}" value="${esc(selection.date)}"></label><div class="tta-nw-dayrange">Available from <b>${esc(tctDateStr(selection.first))}</b>, when local Net Worth tracking began.</div><button class="tta-btn secondary" data-act="netWorthToday" ${isToday?'disabled':''}>Today</button></div><div class="tta-nw-daily-metrics"><div class="tta-nw-delta"><div><small>Torn-reported net-worth movement</small><b class="${deltaClass}">${esc(deltaText)}</b></div><span>${esc(baselineText)}</span></div><div class="tta-nw-company-delta"><small>Recorded company profit / loss</small><b class="${companyClass}">${esc(companyText)}</b><span>${d.companyNet==null?'No company adjustment was recorded for this TCT day.':'Included in analyzer-detected Net Worth activity at the recorded 18:00 TCT company cycle.'}</span></div></div><div class="tta-nw-change-list">${rows||`<div class="tta-empty">No item acquisitions, player transfers, sales, cash events or company P/L have been detected for ${esc(tctDateStr(d.from))}.</div>`}</div>${d.rows.length>20?`<div class="tta-morehint">Showing the latest 20 of ${qty(d.rows.length)} detected events for this TCT day.</div>`:''}<div class="tta-nw-disclaimer">The Torn total change is calculated only from stored /user/networth snapshots. Company P/L is included in the analyzer-detected activity list and summary, but the analyzer does not rewrite Torn's official net-worth total. The event list may explain movement; it is not a guaranteed one-to-one reconciliation.</div></section>`;
  }
  function netWorthHtml() {'''
s=s[:m.start()]+new_func+s[m.end():]

# Date change handler.
change_anchor="""    root.addEventListener('change',async e=>{
      const target=e.target;
      if(target.id==='tta-cash-category')"""
change_new="""    root.addEventListener('change',async e=>{
      const target=e.target;
      if(target.id==='tta-networth-date'){const ts=tctDateInputStart(target.value),bounds=netWorthTrackingBounds();if(Number.isFinite(ts)){const day=Math.max(bounds.first,Math.min(bounds.today,tctDayStart(ts)));state.netWorthDate=tctInputDate(day);save('netWorthDate',state.netWorthDate);render({preserveScroll:true});}return;}
      if(target.id==='tta-cash-category')"""
if change_anchor not in s: raise SystemExit('change handler anchor not found')
s=s.replace(change_anchor,change_new,1)

click_anchor="""      else if(act==='networth'){state.view='networth';render({preserveScroll:false});}
      else if(act==='refreshFinancial')"""
click_new="""      else if(act==='networth'){state.view='networth';render({preserveScroll:false});}
      else if(act==='netWorthToday'){state.netWorthDate=tctInputDate(nowSec());save('netWorthDate',state.netWorthDate);render({preserveScroll:true});}
      else if(act==='refreshFinancial')"""
if click_anchor not in s: raise SystemExit('click handler anchor not found')
s=s.replace(click_anchor,click_new,1)

# Help copy.
s=s.replace("and the page now includes a timeline plus asset allocation.","and the page includes a selectable daily-change view, recorded Company P/L activity, a timeline and asset allocation.",1)

css_anchor="""      .tta-nw-daily{margin-top:9px}.tta-nw-delta{gap:8px;padding:9px 10px;margin:6px 0 8px}.tta-nw-delta b{font-size:clamp(16px,5vw,19px)}.tta-nw-delta span{max-width:190px}.tta-nw-change-list{gap:5px}.tta-nw-change{grid-template-columns:30px minmax(0,1fr) auto;gap:7px;padding:7px 8px;border-radius:11px}.tta-nw-change-icon{width:30px;height:30px;border-radius:9px;font-size:14px}.tta-nw-change-copy strong{font-size:10px;white-space:normal;line-height:1.3}.tta-nw-change-copy small{font-size:8px;line-height:1.3}.tta-nw-change-value{font-size:clamp(8.5px,2.6vw,9.5px);max-width:120px;overflow:hidden;text-overflow:ellipsis}.tta-nw-disclaimer{margin-top:6px;line-height:1.4}
"""
css_new=css_anchor+r'''      /* v0.2.39 selectable Net Worth day */
      .tta-nw-daypicker{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(180px,1.4fr) auto;gap:8px;align-items:end;margin:8px 0}.tta-nw-daypicker label{display:grid;gap:4px;min-width:0}.tta-nw-daypicker label span{color:var(--tta-muted);font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.45px}.tta-nw-daypicker input{width:100%;min-height:36px;border:1px solid var(--tta-line);border-radius:10px;background:var(--tta-card);color:var(--tta-text);padding:7px 9px;font:inherit;font-size:10px;color-scheme:dark;outline:none}.tta-nw-daypicker input:focus{border-color:var(--tta-blue);box-shadow:0 0 0 2px #7fc1ff22}.tta-nw-dayrange{align-self:center;color:var(--tta-faint);font-size:8.5px;line-height:1.4}.tta-nw-dayrange b{color:var(--tta-muted)}.tta-nw-daypicker .tta-btn{min-height:36px}.tta-nw-daypicker .tta-btn:disabled{opacity:.45;cursor:default}.tta-nw-daily-metrics{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:7px;margin-bottom:8px}.tta-nw-daily-metrics .tta-nw-delta{margin:0;height:100%}.tta-nw-company-delta{display:flex;flex-direction:column;justify-content:center;padding:9px 10px;border:1px solid #ffffff1c;border-radius:14px;background:#ffffff09;min-width:0}.tta-nw-company-delta small{color:var(--tta-muted);font-size:8.5px}.tta-nw-company-delta b{display:block;margin-top:3px;font-size:clamp(14px,4.5vw,18px);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.tta-nw-company-delta span{display:block;margin-top:4px;color:var(--tta-faint);font-size:8px;line-height:1.35}
      @media(max-width:620px){.tta-nw-daypicker{grid-template-columns:minmax(0,1fr) auto}.tta-nw-dayrange{grid-column:1/-1;grid-row:2}.tta-nw-daily-metrics{grid-template-columns:1fr}}
      @media(max-width:380px){.tta-nw-daypicker{grid-template-columns:1fr}.tta-nw-daypicker .tta-btn{width:100%}.tta-nw-dayrange{grid-column:auto;grid-row:auto}}
'''
if css_anchor not in s: raise SystemExit('Net Worth CSS anchor not found')
s=s.replace(css_anchor,css_new,1)

if '// @version      0.2.39' not in s or "const VERSION = '0.2.39';" not in s: raise SystemExit('version bump failed')
for needle in ['tta-networth-date','netWorthTrackingStartedAt','Recorded company profit / loss','function selectedNetWorthDay()','netWorthToday']:
    if needle not in s: raise SystemExit(f'missing {needle}')
if any(ord(ch)>=128 for ch in s): raise SystemExit('non-ASCII character introduced')
p.write_text(s,encoding='ascii')
