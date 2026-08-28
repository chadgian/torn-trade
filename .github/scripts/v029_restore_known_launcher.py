from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.8','// @version      0.2.9',1)
s=s.replace("const VERSION = '0.2.8';","const VERSION = '0.2.9';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, resilient Torn PDA launcher lifecycle, TCT daily flow and fast sync modes. Data stays on-device.','Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, restored proven floating launcher, TCT daily flow and fast sync modes. Data stays on-device.',1)

# Replace the accumulated v0.2.7/v0.2.8 runtime ownership layer with a tiny migration cleanup.
runtime_pat=r"  const TCFA_RUNTIME_KEY = '__TCFA_RUNTIME_INSTANCE__';.*?  const API_KEY = '_###PDA-APIKEY###_';"
runtime_new="""  const TTA_INSTANCE_ID = `v${VERSION}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2,8)}`;
  // Retire experimental v0.2.7/v0.2.8 launcher runtimes if this userscript is updated
  // without a full WebView restart. Their watchdogs stop when their runtime token changes.
  try{window.__TCFA_RUNTIME_INSTANCE__?.cleanup?.();}catch(_){}
  try{window.__TCFA_LAUNCHER_WATCH_V027__?.cleanup?.();}catch(_){}
  try{window.__TCFA_LAUNCHER_WATCH_V028__?.cleanup?.();}catch(_){}
  window.__TCFA_RUNTIME_INSTANCE__={version:VERSION,token:`superseded:${TTA_INSTANCE_ID}`};
  const API_KEY = '_###PDA-APIKEY###_';"""
s,n=re.subn(runtime_pat,runtime_new,s,count=1,flags=re.S)
assert n==1, 'runtime block not replaced'

launcher_new=r'''  function clampFabPosition(left,top,fab) {
    const pad=8,w=fab?.offsetWidth||40,h=fab?.offsetHeight||40,vw=Math.max(1,window.innerWidth||document.documentElement.clientWidth||360),vh=Math.max(1,window.innerHeight||document.documentElement.clientHeight||640);
    return {left:Math.max(pad,Math.min(Number(left)||0,vw-w-pad)),top:Math.max(pad,Math.min(Number(top)||0,vh-h-pad))};
  }
  function defaultFabPosition(fab) {
    const w=fab?.offsetWidth||40,h=fab?.offsetHeight||40,vw=Math.max(1,window.innerWidth||document.documentElement.clientWidth||360),vh=Math.max(1,window.innerHeight||document.documentElement.clientHeight||640);
    return clampFabPosition(vw-w-14,Math.max(72,vh-h-86),fab);
  }
  function forceFabVisibleStyle(fab) {
    if(!fab)return;const st=fab.style,set=(k,v)=>st.setProperty(k,v,'important');
    set('position','fixed');set('z-index','2147483647');set('width','40px');set('height','40px');set('min-width','40px');set('min-height','40px');set('max-width','40px');set('max-height','40px');
    set('padding','0');set('margin','0');set('border-radius','50%');set('visibility','visible');set('opacity','1');set('pointer-events','auto');set('align-items','center');set('justify-content','center');set('overflow','visible');
    set('clip','auto');set('clip-path','none');set('contain','none');set('isolation','isolate');set('-webkit-appearance','none');set('appearance','none');set('touch-action','none');
  }
  function applyFabPosition(fab) {
    if(!fab)return;const saved=state.fabPosition;
    const p=saved&&Number.isFinite(Number(saved.left))&&Number.isFinite(Number(saved.top))?clampFabPosition(Number(saved.left),Number(saved.top),fab):defaultFabPosition(fab);
    fab.style.setProperty('left',`${Math.round(p.left)}px`,'important');fab.style.setProperty('top',`${Math.round(p.top)}px`,'important');fab.style.setProperty('right','auto','important');fab.style.setProperty('bottom','auto','important');
    state.fabPosition=p;save('fabPosition',p);
  }
  function bindFabDrag(fab) {
    if(!fab||fab.dataset.dragBound==='1')return;fab.dataset.dragBound='1';
    let startX=0,startY=0,startLeft=0,startTop=0,moved=false,pointerId=null;
    fab.addEventListener('pointerdown',e=>{if(e.button!=null&&e.button!==0)return;pointerId=e.pointerId;moved=false;startX=e.clientX;startY=e.clientY;const r=fab.getBoundingClientRect();startLeft=r.left;startTop=r.top;try{fab.setPointerCapture(pointerId);}catch(_){}});
    fab.addEventListener('pointermove',e=>{if(pointerId==null||e.pointerId!==pointerId)return;const dx=e.clientX-startX,dy=e.clientY-startY;if(!moved&&Math.hypot(dx,dy)<5)return;moved=true;fab.classList.add('dragging');e.preventDefault();const p=clampFabPosition(startLeft+dx,startTop+dy,fab);fab.style.setProperty('left',`${p.left}px`,'important');fab.style.setProperty('top',`${p.top}px`,'important');fab.style.setProperty('right','auto','important');fab.style.setProperty('bottom','auto','important');});
    const finish=e=>{if(pointerId==null||e.pointerId!==pointerId)return;try{fab.releasePointerCapture(pointerId);}catch(_){}pointerId=null;fab.classList.remove('dragging');if(moved){const r=fab.getBoundingClientRect();state.fabPosition=clampFabPosition(r.left,r.top,fab);save('fabPosition',state.fabPosition);fab.dataset.suppressClick='1';setTimeout(()=>fab.dataset.suppressClick='0',250);}};
    fab.addEventListener('pointerup',finish);fab.addEventListener('pointercancel',finish);
    fab.addEventListener('click',e=>{if(fab.dataset.suppressClick==='1'){e.preventDefault();e.stopPropagation();return;}openAnalyzer();});
  }
  function fabIconSvg() {
    return `<span class="tta-fabicon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><defs><linearGradient id="ttaFabPulse" x1="5" y1="0" x2="20" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#77ddb0"/><stop offset="1" stop-color="#8bc9f7"/></linearGradient></defs><rect class="tta-terminal-frame" x="2.5" y="3.25" width="19" height="17.5" rx="3"/><path class="tta-terminal-bar" d="M3.25 7h17.5"/><circle cx="5.25" cy="5.2" r=".65" fill="#77ddb0"/><circle cx="7.45" cy="5.2" r=".65" fill="#8bc9f7"/><path class="tta-terminal-prompt" d="M5.4 10.1l2 1.8-2 1.8"/><path class="tta-terminal-cursor" d="M8.8 13.7h2.2"/><path class="tta-data-pulse" d="M5 17.25h2.15l1.05-2.05 1.45 3.5 1.75-5.15 1.55 3.7h1.85l1.1-1.8 1.05 1.8H19"/></svg></span>`;
  }
  function updateFabState() {
    const fab=document.getElementById('tta-fab');if(!fab)return;forceFabVisibleStyle(fab);const syncing=!!state.syncing;
    fab.classList.toggle('syncing',syncing);fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Open Cash Flow Analyzer');fab.title=syncing?'Financial history sync is running · tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?'<span class="tta-fabspinner" aria-hidden="true"></span>':fabIconSvg();fab.style.setProperty('display',state.open?'none':'inline-flex','important');if(!state.open)fab.style.setProperty('visibility','visible','important');
    if(!state.open)requestAnimationFrame(()=>applyFabPosition(fab));
  }
  function ensureAnalyzerRoot() {
    const parent=document.body||document.documentElement;if(!parent)return null;let root=document.getElementById('tta-root');
    if(!root){root=document.createElement('div');root.id='tta-root';parent.appendChild(root);}else if(root.parentElement!==parent)parent.appendChild(root);return root;
  }
  function ensureFabMounted() {
    const parent=document.body||document.documentElement;if(!parent)return null;let fab=document.getElementById('tta-fab');
    // Always replace a launcher from a previous execution context. This guarantees that the
    // click/drag listeners belong to the currently-running userscript even after Torn PDA reinjects it.
    if(!fab||fab.dataset.ttaInstance!==TTA_INSTANCE_ID){const fresh=document.createElement('button');fresh.id='tta-fab';fresh.type='button';fresh.dataset.ttaInstance=TTA_INSTANCE_ID;fresh.innerHTML=fabIconSvg();if(fab)fab.replaceWith(fresh);else parent.appendChild(fresh);fab=fresh;}
    else if(fab.parentElement!==parent)parent.appendChild(fab);
    forceFabVisibleStyle(fab);bindFabDrag(fab);applyFabPosition(fab);updateFabState();return fab;
  }
  function mount() {
    injectCss();
    // Remove only the experimental alternate nodes. The production UI contract is again
    // the original #tta-root + #tta-fab pair used by the stylesheet and known-working launcher.
    document.getElementById('tcfa-launcher')?.remove();document.getElementById('tcfa-root')?.remove();document.getElementById('tta-fab-host')?.remove();
    ensureAnalyzerRoot();ensureFabMounted();
    try{render();}catch(err){console.error('[TTA] Initial render failed',err);state.open=false;updateFabState();}
  }
  function installFabWatchdog() {
    try{window.__TTA_FAB_WATCHDOG_V029__?.cleanup?.();}catch(_){}
    const tick=()=>{if(!document.documentElement)return;const root=ensureAnalyzerRoot();if(state.open&&(!root||!root.classList.contains('show')))state.open=false;ensureFabMounted();};
    const observer=new MutationObserver(()=>{if(!document.getElementById('tta-fab')||!document.getElementById('tta-root'))tick();});observer.observe(document.documentElement,{childList:true,subtree:true});
    const interval=setInterval(tick,1200),onViewport=()=>{const fab=document.getElementById('tta-fab');if(fab&&!state.open)applyFabPosition(fab);};
    window.addEventListener('resize',onViewport,{passive:true});window.addEventListener('pageshow',tick,{passive:true});
    const cleanup=()=>{try{observer.disconnect();clearInterval(interval);window.removeEventListener('resize',onViewport);window.removeEventListener('pageshow',tick);}catch(_){}};
    window.__TTA_FAB_WATCHDOG_V029__={instance:TTA_INSTANCE_ID,cleanup,observer,interval};
  }

'''
launcher_pat=r"  const TCFA_LAUNCHER_ID='tcfa-launcher';.*?\n  let demoTxCache=null;"
s,n=re.subn(launcher_pat,launcher_new+'  let demoTxCache=null;',s,count=1,flags=re.S)
assert n==1, 'launcher subsystem not replaced'

# Restore the original root contract everywhere else in the analyzer.
s=s.replace("'tcfa-root'","'tta-root'").replace('"tcfa-root"','"tta-root"').replace('#tcfa-root','#tta-root')
s=s.replace('TCFA_LAUNCHER_ID',"'tta-fab'")

# Replace the experimental runtime boot/viewport loop with a simple known-root bootstrap.
boot_pat=r"  const boot=\(\)=>\{if\(document\.body\)\{mount\(\);resumePendingSync\(\);\}else setTimeout\(boot,250\)\}; boot\(\);.*?\n\}\)\(\);"
boot_new="""  const boot=()=>{if(document.body){mount();installFabWatchdog();resumePendingSync();}else setTimeout(boot,250)}; boot();
})();"""
s,n=re.subn(boot_pat,boot_new,s,count=1,flags=re.S)
assert n==1, 'boot block not replaced'

# The production contract must not depend on the alternate launcher/root namespace anymore.
assert "const TCFA_LAUNCHER_ID" not in s
assert "function suppressLegacyUi" not in s
assert "function tcfaOwnsRuntime" not in s
assert "document.getElementById('tcfa-root')" not in s.replace("document.getElementById('tcfa-root')?.remove()",'')
assert "document.getElementById('tta-fab')" in s
assert "document.getElementById('tta-root')" in s
assert "fab.id='tta-fab'" in s
assert "root.id='tta-root'" in s

p.write_text(s)

readme=Path('README.md')
r=readme.read_text()
r=re.sub(r'\*\*Current version:\*\* v[^\n]+','**Current version:** v0.2.9',r,count=1)
r += '''\n\n## v0.2.9 — Floating launcher restoration\n\n- Restores the original known-working `#tta-fab` / `#tta-root` DOM contract used before the launcher regression.\n- Removes the experimental alternate launcher namespace and legacy-suppression stack.\n- The launcher uses inline visibility safeguards and is recreated if Torn SPA navigation removes it.\n- Same-version userscript reinjection replaces the launcher node so click/drag listeners always belong to the live execution context.\n- Automated DOM validation checks initial visibility, click-to-open, removal recovery, body replacement recovery, and reinjection.\n'''
readme.write_text(r)
