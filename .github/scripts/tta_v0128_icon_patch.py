from pathlib import Path

p = Path('torn-trade-analyzer.user.js')
s = p.read_text()

s = s.replace('// @version      0.1.27', '// @version      0.1.28', 1)
s = s.replace(
    '// @description  Fast Torn trade analytics with compact launcher, 7/14/30-day presets, dedicated abroad-buy verification, continuous TCT timelines, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.',
    '// @description  Fast Torn trade analytics with a cyber terminal/data-pulse launcher, 7/14/30-day presets, dedicated abroad-buy verification, continuous TCT timelines, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.',
    1,
)
s = s.replace("const VERSION = '0.1.27';", "const VERSION = '0.1.28';", 1)

old_css = "#tta-fab .tta-fabicon{display:block;font-size:18px;line-height:1;pointer-events:none}"
new_css = "#tta-fab .tta-fabicon{display:grid;place-items:center;width:23px;height:23px;pointer-events:none}#tta-fab .tta-fabicon svg{display:block;width:23px;height:23px;overflow:visible;filter:drop-shadow(0 0 4px #63efb144)}#tta-fab .tta-terminal-frame{fill:#0a1219;stroke:#7fc1ff;stroke-width:1.35}#tta-fab .tta-terminal-bar{stroke:#38566a;stroke-width:1.15}#tta-fab .tta-terminal-prompt{fill:none;stroke:#63efb1;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}#tta-fab .tta-terminal-cursor{stroke:#b9c8d6;stroke-width:1.35;stroke-linecap:round}#tta-fab .tta-data-pulse{fill:none;stroke:url(#ttaFabPulse);stroke-width:1.55;stroke-linecap:round;stroke-linejoin:round}"
if old_css not in s:
    raise SystemExit('FAB icon CSS anchor not found')
s = s.replace(old_css, new_css, 1)

anchor = "  function updateFabState() {\n"
icon_fn = '''  function fabIconSvg() {\n    return `<span class="tta-fabicon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><defs><linearGradient id="ttaFabPulse" x1="5" y1="0" x2="20" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#63efb1"/><stop offset="1" stop-color="#7fc1ff"/></linearGradient></defs><rect class="tta-terminal-frame" x="2.5" y="3.25" width="19" height="17.5" rx="3"/><path class="tta-terminal-bar" d="M3.25 7h17.5"/><circle cx="5.25" cy="5.2" r=".65" fill="#63efb1"/><circle cx="7.45" cy="5.2" r=".65" fill="#7fc1ff"/><path class="tta-terminal-prompt" d="M5.4 10.1l2 1.8-2 1.8"/><path class="tta-terminal-cursor" d="M8.8 13.7h2.2"/><path class="tta-data-pulse" d="M5 17.25h2.15l1.05-2.05 1.45 3.5 1.75-5.15 1.55 3.7h1.85l1.1-1.8 1.05 1.8H19"/></svg></span>`;\n  }\n\n'''
if anchor not in s:
    raise SystemExit('updateFabState anchor not found')
s = s.replace(anchor, icon_fn + anchor, 1)

old_update = "fab.innerHTML=syncing?'<span class=\"tta-fabspinner\" aria-hidden=\"true\"></span>':'<span class=\"tta-fabicon\" aria-hidden=\"true\">📈</span>';"
new_update = "fab.innerHTML=syncing?'<span class=\"tta-fabspinner\" aria-hidden=\"true\"></span>':fabIconSvg();"
if old_update not in s:
    raise SystemExit('updateFabState emoji markup not found')
s = s.replace(old_update, new_update, 1)

old_mount = "fab.innerHTML = '<span class=\"tta-fabicon\" aria-hidden=\"true\">📈</span>';"
new_mount = "fab.innerHTML = fabIconSvg();"
if old_mount not in s:
    raise SystemExit('mount emoji markup not found')
s = s.replace(old_mount, new_mount, 1)

p.write_text(s)

r = Path('README.md')
rs = r.read_text()
rs = rs.replace('**Current version:** v0.1.27', '**Current version:** v0.1.28', 1)
if 'terminal/data-pulse launcher' not in rs:
    rs += '\n\n## v0.1.28 launcher icon\n\n- Replaced the floating launcher emoji with a custom inline SVG terminal/data-pulse icon.\n- The icon uses the analyzer\'s green/blue cyber palette and remains a compact 40×40 draggable button.\n- During sync, the launcher still switches to the compact spinner-only state.\n'
r.write_text(rs)
