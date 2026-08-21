from pathlib import Path

p = Path('torn-trade-analyzer.user.js')
s = p.read_text()

s = s.replace('// @version      0.1.26', '// @version      0.1.27', 1)
s = s.replace('// @description  Fast Torn trade analytics with dedicated abroad-buy verification, continuous TCT timelines, gap recovery, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.', '// @description  Fast Torn trade analytics with compact launcher, 7/14/30-day presets, dedicated abroad-buy verification, continuous TCT timelines, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.', 1)
s = s.replace("const VERSION = '0.1.26';", "const VERSION = '0.1.27';", 1)

state_anchor = """  };

  function load(k, fallback) {
"""
state_insert = """  };

  // v0.1.27 removes the old calendar-month preset. Migrate saved users to 30 days.
  if(state.dateMode==='month'){state.dateMode='30d';save('dateMode','30d');}

  function load(k, fallback) {
"""
if state_anchor not in s:
    raise SystemExit('state migration anchor not found')
s = s.replace(state_anchor, state_insert, 1)

old_css = """      #tta-fab{position:fixed;right:14px;bottom:86px;z-index:2147483000;min-height:42px;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;border:1px solid #38566a;border-radius:18px;background:linear-gradient(135deg,#1a352f,#183951);color:#fff;box-shadow:0 12px 35px #0009;padding:11px 14px;font:700 12px/1.1 system-ui;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-align:center}
"""
new_css = """      #tta-fab{position:fixed;right:14px;bottom:86px;z-index:2147483000;width:40px;height:40px;min-width:40px;min-height:40px;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;border:1px solid #38566a;border-radius:50%;background:linear-gradient(135deg,#1a352f,#183951);color:#fff;box-shadow:0 8px 22px #0008;padding:0;font:700 18px/1 system-ui;display:inline-flex;align-items:center;justify-content:center;text-align:center}
      #tta-fab .tta-fabicon{display:block;font-size:18px;line-height:1;pointer-events:none}
"""
if old_css not in s:
    raise SystemExit('fab CSS anchor not found')
s = s.replace(old_css, new_css, 1)

old_state = """    fab.innerHTML=syncing?'<span class=\"tta-fabspinner\" aria-hidden=\"true\"></span><span>Syncing…</span>':'<span class=\"dot\"></span><span>Trade Analytics</span>';
"""
new_state = """    fab.innerHTML=syncing?'<span class=\"tta-fabspinner\" aria-hidden=\"true\"></span>':'<span class=\"tta-fabicon\" aria-hidden=\"true\">📈</span>';
"""
if old_state not in s:
    raise SystemExit('fab state anchor not found')
s = s.replace(old_state, new_state, 1)

old_mount = """      fab.innerHTML = '<span class=\"dot\"></span><span>Trade Analytics</span>';
"""
new_mount = """      fab.innerHTML = '<span class=\"tta-fabicon\" aria-hidden=\"true\">📈</span>';
"""
if old_mount not in s:
    raise SystemExit('fab mount anchor not found')
s = s.replace(old_mount, new_mount, 1)

old_local = """    if(state.dateMode==='7d') from=Math.floor((nowMs-7*86400*1000)/1000);
    else if(state.dateMode==='30d') from=Math.floor((nowMs-30*86400*1000)/1000);
    else if(state.dateMode==='month') from=Math.floor(subtractCalendarMonth(nowDate).getTime()/1000);
"""
new_local = """    if(state.dateMode==='7d') from=Math.floor((nowMs-7*86400*1000)/1000);
    else if(state.dateMode==='14d') from=Math.floor((nowMs-14*86400*1000)/1000);
    else if(state.dateMode==='30d') from=Math.floor((nowMs-30*86400*1000)/1000);
"""
if old_local not in s:
    raise SystemExit('local period anchor not found')
s = s.replace(old_local, new_local, 1)

old_tct = """    if(state.dateMode==='7d')from=serverNow-7*86400;
    else if(state.dateMode==='30d')from=serverNow-30*86400;
    else if(state.dateMode==='month')from=subtractCalendarMonthTct(serverNow);
"""
new_tct = """    if(state.dateMode==='7d')from=serverNow-7*86400;
    else if(state.dateMode==='14d')from=serverNow-14*86400;
    else if(state.dateMode==='30d')from=serverNow-30*86400;
"""
if old_tct not in s:
    raise SystemExit('TCT period anchor not found')
s = s.replace(old_tct, new_tct, 1)

old_chips = """[['7d','7 days'],['30d','30 days'],['month','1 month'],['all','All'],['custom','Custom']]"""
new_chips = """[['7d','7 days'],['14d','14 days'],['30d','30 days'],['all','All'],['custom','Custom']]"""
if old_chips not in s:
    raise SystemExit('period chips anchor not found')
s = s.replace(old_chips, new_chips, 1)

p.write_text(s)

r = Path('README.md')
rs = r.read_text()
rs = rs.replace('**Current version:** v0.1.26', '**Current version:** v0.1.27', 1)
rs += "\n\n## v0.1.27 period presets and compact launcher\n\n- Dashboard period presets are now **7 days, 14 days, 30 days, All, and Custom**.\n- The former **1 month** preset was removed; saved users on that preset are migrated to **30 days**.\n- The draggable floating launcher is now a compact 40x40 icon-only button so it covers less of the Torn interface.\n- While sync is running, the compact launcher shows only the spinner and remains tappable to reopen sync progress.\n"
r.write_text(rs)
