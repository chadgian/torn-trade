from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

old="""  function injectCss() {
    if (document.getElementById('tcfa-css-v028')) return;
    const s = document.createElement('style');
    s.id = 'tcfa-css-v028';"""
new="""  function injectCss() {
    // v0.2.8 used a different launcher/root namespace under this stylesheet id.
    // Remove it during an in-place Torn PDA update so the restored #tta-fab/#tta-root
    // contract cannot accidentally inherit stale selectors.
    document.getElementById('tcfa-css-v028')?.remove();
    if (document.getElementById('tta-css-v029')) return;
    const s = document.createElement('style');
    s.id = 'tta-css-v029';"""
assert old in s
s=s.replace(old,new,1)

# The launcher styling must use the same DOM id as the live launcher.
s=s.replace('#tcfa-launcher','#tta-fab')

bad="document.getElementById('tcfa-launcher')?.remove();document.getElementById('tta-root')?.remove();document.getElementById('tta-fab-host')?.remove();"
good="document.getElementById('tcfa-launcher')?.remove();document.getElementById('tcfa-root')?.remove();document.getElementById('tta-fab-host')?.remove();"
assert bad in s
s=s.replace(bad,good,1)

assert "s.id = 'tta-css-v029'" in s
assert "document.getElementById('tcfa-css-v028')?.remove()" in s
assert '#tta-fab{position:fixed' in s
assert '#tta-fab .tta-terminal-frame' in s
assert "document.getElementById('tcfa-root')?.remove()" in s
assert "document.getElementById('tta-root')?.remove()" not in s

p.write_text(s)
