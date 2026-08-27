from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.2','// @version      0.2.3',1)
s=s.replace("const VERSION = '0.2.2';","const VERSION = '0.2.3';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with a clearer Bento dashboard, TCT daily flow and fast sync modes. Data stays on-device.','Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, reliable floating launcher, TCT daily flow and fast sync modes. Data stays on-device.',1)

old="#tta-fab{position:fixed;right:14px;bottom:86px;z-index:2147483000;width:40px;height:40px;min-width:40px;min-height:40px;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;border:1px solid #38566a;border-radius:50%;background:linear-gradient(135deg,#1a352f,#183951);color:#fff;box-shadow:0 8px 22px #0008;padding:0;font:700 18px/1 system-ui;display:inline-flex;align-items:center;justify-content:center;text-align:center}"
new="#tta-fab{position:fixed!important;right:14px;bottom:86px;z-index:2147483646!important;width:40px;height:40px;min-width:40px;min-height:40px;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;border:1px solid #38566a;border-radius:50%;background:linear-gradient(135deg,#1a352f,#183951);color:#fff;box-shadow:0 8px 22px #0008;padding:0;font:700 18px/1 system-ui;display:inline-flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;align-items:center;justify-content:center;text-align:center;isolation:isolate}#tta-fab.tta-fab-hidden{display:none!important}"
assert old in s
s=s.replace(old,new,1)

old2="fab.style.display=state.open?'none':'inline-flex';"
new2="fab.classList.toggle('tta-fab-hidden',!!state.open);fab.style.removeProperty('display');"
assert old2 in s
s=s.replace(old2,new2,1)

old3="""  function mount() {
    injectCss();
    if (!document.getElementById('tta-fab')) {
      const fab = document.createElement('button'); fab.id = 'tta-fab';
      fab.innerHTML = fabIconSvg();
      document.body.appendChild(fab);bindFabDrag(fab);requestAnimationFrame(()=>applyFabPosition(fab));
    } else { const fab=document.getElementById('tta-fab');bindFabDrag(fab);applyFabPosition(fab); }
    if (!document.getElementById('tta-root')) {
      const root = document.createElement('div'); root.id = 'tta-root'; document.body.appendChild(root);
    }
    updateFabState();
    render();
  }
"""
new3="""  function ensureFabMounted() {
    let fab=document.getElementById('tta-fab');
    if(!fab){fab=document.createElement('button');fab.id='tta-fab';fab.innerHTML=fabIconSvg();(document.body||document.documentElement).appendChild(fab);bindFabDrag(fab);}
    else if(!fab.isConnected)(document.body||document.documentElement).appendChild(fab);
    bindFabDrag(fab);updateFabState();requestAnimationFrame(()=>applyFabPosition(fab));return fab;
  }
  function mount() {
    injectCss();
    ensureFabMounted();
    if (!document.getElementById('tta-root')) {
      const root = document.createElement('div'); root.id = 'tta-root'; (document.body||document.documentElement).appendChild(root);
    }
    render();
    if(!window.__ttaFabWatch){window.__ttaFabWatch=true;const host=document.documentElement;new MutationObserver(()=>{if(!document.getElementById('tta-fab'))ensureFabMounted();}).observe(host,{childList:true,subtree:true});setInterval(()=>{if(!document.getElementById('tta-fab'))ensureFabMounted();else updateFabState();},3000);}
  }
"""
assert old3 in s
s=s.replace(old3,new3,1)

# Keep stale saved coordinates from hiding the launcher after viewport/layout changes.
old4="""  function applyFabPosition(fab) {
    if(!fab)return;
    if(state.fabPosition && Number.isFinite(state.fabPosition.left) && Number.isFinite(state.fabPosition.top)){
      const p=clampFabPosition(state.fabPosition.left,state.fabPosition.top,fab);
      fab.style.left=`${p.left}px`;fab.style.top=`${p.top}px`;fab.style.right='auto';fab.style.bottom='auto';
      state.fabPosition=p;save('fabPosition',p);
    }
  }
"""
new4="""  function applyFabPosition(fab) {
    if(!fab)return;
    if(state.fabPosition && Number.isFinite(state.fabPosition.left) && Number.isFinite(state.fabPosition.top)){
      const p=clampFabPosition(state.fabPosition.left,state.fabPosition.top,fab);
      fab.style.left=`${p.left}px`;fab.style.top=`${p.top}px`;fab.style.right='auto';fab.style.bottom='auto';
      state.fabPosition=p;save('fabPosition',p);
    } else {fab.style.removeProperty('left');fab.style.removeProperty('top');fab.style.right='14px';fab.style.bottom='86px';}
  }
"""
assert old4 in s
s=s.replace(old4,new4,1)

p.write_text(s)

r=Path('README.md')
rs=r.read_text()
rs=rs.replace('**Current version:** v0.2.2','**Current version:** v0.2.3',1)
rs += '\n\n## v0.2.3 — Floating launcher reliability\n\n- Restores the compact floating launcher after the Bento UI refresh.\n- Gives the launcher an isolated top-level stacking context and explicit visible/hidden state.\n- Recreates the launcher automatically if Torn page navigation removes it.\n- Re-clamps saved launcher coordinates to the current viewport.\n'
r.write_text(rs)
