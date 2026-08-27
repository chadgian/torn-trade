from pathlib import Path
p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

# Current stylesheet must target only the isolated current launcher.
s=s.replace('#tta-fab','#tcfa-launcher')

# Keep legacy DOM lookups only inside suppressLegacyUi/watchdog conflict detection;
# the active launcher lifecycle must use TCFA_LAUNCHER_ID.
old="const fab=document.getElementById('tta-fab');if(fab)fab.style.display='none';"
new="const fab=document.getElementById(TCFA_LAUNCHER_ID);if(fab)fab.style.setProperty('display','none','important');"
assert old in s
s=s.replace(old,new,1)

old="setInterval(()=>{if(!document.getElementById('tta-fab')||!document.getElementById('tcfa-root'))mount();},5000);"
new="setInterval(()=>{if(!document.getElementById(TCFA_LAUNCHER_ID)||!document.getElementById('tcfa-root'))mount();},5000);"
assert old in s
s=s.replace(old,new,1)

# Verify the only direct old-id lookups left are intentional legacy neutralization/conflict detection.
assert "document.querySelectorAll('#tcfa-root" in s
assert "document.getElementById(TCFA_LAUNCHER_ID)" in s
assert '#tta-fab' not in s
p.write_text(s)
