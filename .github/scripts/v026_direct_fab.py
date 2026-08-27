from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.5','// @version      0.2.6',1)
s=s.replace("const VERSION = '0.2.5';","const VERSION = '0.2.6';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, Shadow DOM floating launcher, TCT daily flow and fast sync modes. Data stays on-device.','Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, reliable direct floating launcher, TCT daily flow and fast sync modes. Data stays on-device.',1)

start=s.index('  function forceFabBaseStyle(fab) {')
end=s.index('\n  let demoTxCache=null;', start)
new_block=r'''  function forceFabBaseStyle(fab) {
    if(!fab)return;const st=fab.style,set=(k,v)=>st.setProperty(k,v,'important');
    set('position','fixed');set('z-index','2147483647');set('width','40px');set('height','40px');set('min-width','40px');set('min-height','40px');set('max-width','40px');set('max-height','40px');set('padding','0');set('margin','0');set('border','1px solid #4f768b');set('border-radius','50%');set('background','linear-gradient(135deg,#244c42,#254d68)');set('color','#fff');set('box-shadow','0 10px 26px #0008,0 0 0 1px #ffffff12 inset');set('visibility','visible');set('opacity','1');set('pointer-events','auto');set('align-items','center');set('justify-content','center');set('text-align','center');set('overflow','visible');set('transform','none');set('filter','none');set('clip','auto');set('clip-path','none');set('contain','none');set('isolation','isolate');set('touch-action','none');set('font','700 18px/1 system-ui');set('-webkit-appearance','none');set('appearance','none');
  }
  function resetFabToDefault(fab) {
    state.fabPosition=null;save('fabPosition',null);fab.style.removeProperty('left');fab.style.removeProperty('top');fab.style.setProperty('right','14px','important');fab.style.setProperty('bottom','96px','important');
  }
  function verifyFabViewport(fab) {
    if(!fab||state.open)return;const r=fab.getBoundingClientRect(),bad=!Number.isFinite(r.left)||!Number.isFinite(r.top)||r.width<20||r.height<20||r.right<4||r.bottom<4||r.left>window.innerWidth-4||r.top>window.innerHeight-4;
    if(bad){resetFabToDefault(fab);requestAnimationFrame(()=>applyFabPosition(fab));}
  }
  function updateFabState() {
    const fab=document.getElementById('tta-fab');if(!fab)return;
    forceFabBaseStyle(fab);const syncing=!!state.syncing;
    fab.classList.toggle('syncing',syncing);
    fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Cash Flow Analyzer');
    fab.title=syncing?'Financial history sync is running · tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?'<span class="tta-fabspinner" aria-hidden="true"></span>':fabIconSvg();
    fab.style.setProperty('display',state.open?'none':'inline-flex','important');
    requestAnimationFrame(()=>{applyFabPosition(fab);forceFabBaseStyle(fab);fab.style.setProperty('display',state.open?'none':'inline-flex','important');verifyFabViewport(fab);});
  }
  function ensureFabMounted() {
    const parent=document.body||document.documentElement;
    const staleHost=document.getElementById('tta-fab-host');if(staleHost)staleHost.remove();
    let fab=document.getElementById('tta-fab');
    if(!fab){fab=document.createElement('button');fab.id='tta-fab';fab.type='button';fab.innerHTML=fabIconSvg();parent.appendChild(fab);}else if(fab.parentElement!==parent){parent.appendChild(fab);}
    forceFabBaseStyle(fab);bindFabDrag(fab);updateFabState();requestAnimationFrame(()=>{applyFabPosition(fab);verifyFabViewport(fab);});return fab;
  }
  function mount() {
    injectCss();
    const parent=document.body||document.documentElement;
    if(!document.getElementById('tta-root')){const root=document.createElement('div');root.id='tta-root';parent.appendChild(root);}
    const fab=ensureFabMounted();
    // Keep the launcher as the final top-level node. This avoids Torn/Android compositor
    // stacking quirks introduced by glass/backdrop layers while preserving the Bento UI.
    if(fab&&fab.parentElement===parent&&fab!==parent.lastElementChild)parent.appendChild(fab);
    render();
    if(!window.__ttaFabWatch){
      window.__ttaFabWatch=true;
      new MutationObserver(()=>{const p=document.body||document.documentElement,f=document.getElementById('tta-fab');if(!f||f.parentElement!==p)ensureFabMounted();}).observe(document.documentElement,{childList:true,subtree:true});
      setInterval(()=>{const p=document.body||document.documentElement,f=document.getElementById('tta-fab');if(!f||f.parentElement!==p)ensureFabMounted();else{forceFabBaseStyle(f);updateFabState();verifyFabViewport(f);}},1200);
    }
  }
'''
s=s[:start]+new_block+s[end:]

# The direct-DOM architecture makes this legacy guard valid again; keep it explicit.
old="setInterval(()=>{if(!document.getElementById('tta-fab')||!document.getElementById('tta-root'))mount();},5000);"
assert old in s
s=s.replace(old,"setInterval(()=>{if(!document.getElementById('tta-fab')||!document.getElementById('tta-root'))mount();},5000);",1)

# Ensure no Shadow DOM FAB helpers remain.
for marker in ['function getFabHost()', 'function getFab()', 'function styleFabHost(host)', 'function shadowFabMarkup()', "attachShadow({mode:'open'})"]:
    assert marker not in s, marker
assert "document.getElementById('tta-fab')" in s
assert "parent.appendChild(fab)" in s
assert "z-index','2147483647'" in s

p.write_text(s)

r=Path('README.md')
text=r.read_text()
text=re.sub(r'\*\*Current version:\*\* v[0-9.]+','**Current version:** v0.2.6',text,count=1)
text += '''\n\n## v0.2.6 — Floating launcher reliability\n\n- Reverted the floating launcher from the experimental Shadow DOM/zero-size host architecture to the known-working direct document-body button model.\n- The launcher is appended after the analyzer root and forced to the top compositor layer with a maximum practical z-index.\n- Removed the Shadow DOM lookup mismatch that caused the watchdog to repeatedly think the FAB was missing.\n- Keeps draggable position, terminal/data-pulse icon, sync spinner and automatic remount checks.\n- Bento dashboard and financial UI remain unchanged.\n'''
r.write_text(text)
