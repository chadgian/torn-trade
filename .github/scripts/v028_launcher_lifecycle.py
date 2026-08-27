from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.7','// @version      0.2.8',1)
s=s.replace("const VERSION = '0.2.7';","const VERSION = '0.2.8';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, isolated self-healing launcher, TCT daily flow and fast sync modes. Data stays on-device.','Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, resilient Torn PDA launcher lifecycle, TCT daily flow and fast sync modes. Data stays on-device.',1)

old="""  const TCFA_RUNTIME_KEY = '__TCFA_RUNTIME_INSTANCE__';
  const existingTcfaRuntime = window[TCFA_RUNTIME_KEY];
  if(existingTcfaRuntime?.version===VERSION) return;
  const TCFA_INSTANCE_TOKEN = `${VERSION}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2,8)}`;
  window[TCFA_RUNTIME_KEY] = {version:VERSION,token:TCFA_INSTANCE_TOKEN,startedAt:Date.now()};"""
new="""  const TCFA_RUNTIME_KEY = '__TCFA_RUNTIME_INSTANCE__';
  // Torn PDA may destroy an injected userscript execution context while leaving properties
  // on window behind. Never trust a same-version marker as proof that the launcher/watchdog
  // is still alive. Every injection supersedes the previous token and remounts safely.
  const previousTcfaRuntime = window[TCFA_RUNTIME_KEY];
  const TCFA_INSTANCE_TOKEN = `${VERSION}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2,8)}`;
  window[TCFA_RUNTIME_KEY] = {version:VERSION,token:TCFA_INSTANCE_TOKEN,startedAt:Date.now()};
  try{previousTcfaRuntime?.cleanup?.();}catch(_){}"""
assert old in s
s=s.replace(old,new,1)

# New style id avoids stale CSS from older installed copies, but keeps all accounting data.
s=s.replace("if (document.getElementById('tcfa-css-v027')) return;","if (document.getElementById('tcfa-css-v028')) return;",1)
s=s.replace("s.id = 'tcfa-css-v027';","s.id = 'tcfa-css-v028';",1)
s=s.replace("const TCFA_LAUNCHER_RESET_KEY='launcherPositionResetV027';","const TCFA_LAUNCHER_RESET_KEY='launcherPositionResetV028';",1)

old_update="""  function updateFabState(){
    const fab=document.getElementById(TCFA_LAUNCHER_ID);if(!fab)return;forceFabBaseStyle(fab);
    const syncing=!!state.syncing;fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Open Cash Flow Analyzer');fab.title=syncing?'Financial history sync is running · tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?fabSpinnerSvg():fabIconSvg();
    fab.style.setProperty('display',state.open?'none':'inline-flex','important');
    if(!state.open)fab.style.setProperty('visibility','visible','important');
  }
  function fabIsInteractable(fab){
    if(!fab||state.open||!fab.isConnected)return false;const cs=getComputedStyle(fab),r=fab.getBoundingClientRect(),v=tcfaVisualViewport();"""
new_update="""  function analyzerOverlayVisible(){
    const root=document.getElementById('tcfa-root');if(!root||!root.isConnected||!state.open||!root.classList.contains('show'))return false;
    const cs=getComputedStyle(root);return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)!==0;
  }
  function updateFabState(){
    const fab=document.getElementById(TCFA_LAUNCHER_ID);if(!fab)return;forceFabBaseStyle(fab);
    const syncing=!!state.syncing,overlayVisible=analyzerOverlayVisible();fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Open Cash Flow Analyzer');fab.title=syncing?'Financial history sync is running · tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?fabSpinnerSvg():fabIconSvg();
    fab.style.setProperty('display',overlayVisible?'none':'inline-flex','important');
    if(!overlayVisible)fab.style.setProperty('visibility','visible','important');
  }
  function fabIsInteractable(fab){
    if(!fab||analyzerOverlayVisible()||!fab.isConnected)return false;const cs=getComputedStyle(fab),r=fab.getBoundingClientRect(),v=tcfaVisualViewport();"""
assert old_update in s
s=s.replace(old_update,new_update,1)

s=s.replace("if(!fab||state.open)return;forceFabBaseStyle(fab);fab.style.setProperty('display','inline-flex','important');","if(!fab||analyzerOverlayVisible())return;forceFabBaseStyle(fab);fab.style.setProperty('display','inline-flex','important');",1)

old_ensure="""  function ensureFabMounted(){
    if(!tcfaOwnsRuntime())return null;suppressLegacyUi();const parent=preferredFabParent();let fab=document.getElementById(TCFA_LAUNCHER_ID);
    if(!fab){fab=document.createElement('button');fab.id=TCFA_LAUNCHER_ID;fab.type='button';fab.dataset.tcfaVersion=VERSION;fab.innerHTML=fabIconSvg();parent.appendChild(fab);}else if(fab.parentElement!==parent){parent.appendChild(fab);}
    forceFabBaseStyle(fab);bindFabDrag(fab);updateFabState();applyFabPosition(fab);requestAnimationFrame(()=>verifyFabViewport(fab));return fab;
  }"""
new_ensure="""  function ensureFabMounted(){
    if(!tcfaOwnsRuntime())return null;const parent=preferredFabParent();if(!parent)return null;let fab=document.getElementById(TCFA_LAUNCHER_ID);
    if(!fab){fab=document.createElement('button');fab.id=TCFA_LAUNCHER_ID;fab.type='button';fab.dataset.tcfaVersion=VERSION;fab.innerHTML=fabIconSvg();parent.appendChild(fab);}else if(fab.parentElement!==parent){parent.appendChild(fab);}
    forceFabBaseStyle(fab);bindFabDrag(fab);updateFabState();applyFabPosition(fab);
    requestAnimationFrame(()=>{verifyFabViewport(fab);if(fabIsInteractable(fab))suppressLegacyUi();});
    return fab;
  }"""
assert old_ensure in s
s=s.replace(old_ensure,new_ensure,1)

old_watch="""  function installFabWatchdog(){
    const previous=window.__TCFA_LAUNCHER_WATCH_V027__;if(previous?.token===TCFA_INSTANCE_TOKEN)return;
    try{previous?.observer?.disconnect?.();if(previous?.interval)clearInterval(previous.interval);}catch(_){}
    const observer=new MutationObserver(()=>{if(!tcfaOwnsRuntime()){observer.disconnect();return;}const fab=document.getElementById(TCFA_LAUNCHER_ID),parent=preferredFabParent();if(!fab||fab.parentElement!==parent||document.getElementById('tta-fab')||document.getElementById('tta-fab-host'))ensureFabMounted();});
    observer.observe(document.documentElement,{childList:true,subtree:true});
    const interval=setInterval(()=>{if(!tcfaOwnsRuntime()){clearInterval(interval);observer.disconnect();return;}const fab=ensureFabMounted();if(fab)verifyFabViewport(fab);},900);
    const onViewport=()=>{if(!tcfaOwnsRuntime())return;const fab=document.getElementById(TCFA_LAUNCHER_ID);if(fab){applyFabPosition(fab);requestAnimationFrame(()=>verifyFabViewport(fab));}};
    window.addEventListener('resize',onViewport,{passive:true});window.visualViewport?.addEventListener('resize',onViewport,{passive:true});window.visualViewport?.addEventListener('scroll',onViewport,{passive:true});
    window.__TCFA_LAUNCHER_WATCH_V027__={token:TCFA_INSTANCE_TOKEN,observer,interval,onViewport};
  }"""
new_watch="""  function installFabWatchdog(){
    for(const key of ['__TCFA_LAUNCHER_WATCH_V027__','__TCFA_LAUNCHER_WATCH_V028__']){
      const previous=window[key];try{previous?.observer?.disconnect?.();if(previous?.interval)clearInterval(previous.interval);if(previous?.onViewport){window.removeEventListener('resize',previous.onViewport);window.visualViewport?.removeEventListener('resize',previous.onViewport);window.visualViewport?.removeEventListener('scroll',previous.onViewport);}}catch(_){}
    }
    const observer=new MutationObserver(()=>{if(!tcfaOwnsRuntime()){observer.disconnect();return;}const fab=document.getElementById(TCFA_LAUNCHER_ID),parent=preferredFabParent();if(!fab||fab.parentElement!==parent)ensureFabMounted();});
    observer.observe(document.documentElement,{childList:true,subtree:true});
    const interval=setInterval(()=>{if(!tcfaOwnsRuntime()){clearInterval(interval);observer.disconnect();return;}const fab=ensureFabMounted();if(fab)verifyFabViewport(fab);},900);
    const onViewport=()=>{if(!tcfaOwnsRuntime())return;const fab=document.getElementById(TCFA_LAUNCHER_ID);if(fab){applyFabPosition(fab);requestAnimationFrame(()=>verifyFabViewport(fab));}};
    window.addEventListener('resize',onViewport,{passive:true});window.visualViewport?.addEventListener('resize',onViewport,{passive:true});window.visualViewport?.addEventListener('scroll',onViewport,{passive:true});
    const cleanup=()=>{try{observer.disconnect();clearInterval(interval);window.removeEventListener('resize',onViewport);window.visualViewport?.removeEventListener('resize',onViewport);window.visualViewport?.removeEventListener('scroll',onViewport);}catch(_){}};
    window.__TCFA_LAUNCHER_WATCH_V028__={token:TCFA_INSTANCE_TOKEN,observer,interval,onViewport,cleanup};
    const runtime=window[TCFA_RUNTIME_KEY];if(runtime?.token===TCFA_INSTANCE_TOKEN)runtime.cleanup=cleanup;
  }"""
assert old_watch in s
s=s.replace(old_watch,new_watch,1)

old_mount="""  function mount(){
    injectCss();suppressLegacyUi();
    // One-time recovery from coordinates saved by earlier launcher implementations. Those
    // coordinates were clamped against the layout viewport, not Android's visual viewport.
    if(!load(TCFA_LAUNCHER_RESET_KEY,false)){state.fabPosition=null;save('fabPosition',null);save(TCFA_LAUNCHER_RESET_KEY,true);}
    const parent=preferredFabParent();
    if(!document.getElementById('tcfa-root')){const root=document.createElement('div');root.id='tcfa-root';parent.appendChild(root);}
    const fab=ensureFabMounted();if(fab&&fab.parentElement===parent&&fab!==parent.lastElementChild)parent.appendChild(fab);
    // The launcher must survive an unrelated UI rendering error. Do not let a dashboard
    // exception remove the only way to reopen the analyzer.
    try{render();}catch(err){console.error('[TCFA] Initial render failed',err);state.open=false;updateFabState();}
    installFabWatchdog();setTimeout(()=>{const f=ensureFabMounted();if(f)verifyFabViewport(f);},250);setTimeout(()=>{const f=ensureFabMounted();if(f)verifyFabViewport(f);},1200);
  }"""
new_mount="""  function mount(){
    injectCss();
    // One-time recovery from coordinates saved by earlier launcher implementations. Those
    // coordinates were clamped against the layout viewport, not Android's visual viewport.
    if(!load(TCFA_LAUNCHER_RESET_KEY,false)){state.fabPosition=null;save('fabPosition',null);save(TCFA_LAUNCHER_RESET_KEY,true);}
    const parent=preferredFabParent();if(!parent)return;
    if(!document.getElementById('tcfa-root')){const root=document.createElement('div');root.id='tcfa-root';parent.appendChild(root);}
    const fab=ensureFabMounted();if(fab&&fab.parentElement===parent&&fab!==parent.lastElementChild)parent.appendChild(fab);
    // The launcher must survive an unrelated UI rendering error. Do not let a dashboard
    // exception remove the only way to reopen the analyzer.
    try{render();}catch(err){console.error('[TCFA] Initial render failed',err);state.open=false;updateFabState();}
    installFabWatchdog();setTimeout(()=>{const f=ensureFabMounted();if(f)verifyFabViewport(f);},250);setTimeout(()=>{const f=ensureFabMounted();if(f)verifyFabViewport(f);},1200);
  }"""
assert old_mount in s
s=s.replace(old_mount,new_mount,1)

# If the analyzer believes it is open but the overlay was removed/replaced by Torn, recover
# the launcher instead of treating the stale boolean as authoritative.
old_boot="""  const boot=()=>{if(document.body){mount();resumePendingSync();}else setTimeout(boot,250)}; boot();
  setInterval(()=>{if(!document.getElementById(TCFA_LAUNCHER_ID)||!document.getElementById('tcfa-root'))mount();},5000);"""
new_boot="""  const boot=()=>{if(document.body){mount();resumePendingSync();}else setTimeout(boot,250)}; boot();
  setInterval(()=>{
    if(!tcfaOwnsRuntime())return;const root=document.getElementById('tcfa-root'),fab=document.getElementById(TCFA_LAUNCHER_ID);
    if(state.open&&(!root||!root.isConnected||!root.classList.contains('show'))){state.open=false;}
    if(!fab||!root)mount();else{updateFabState();verifyFabViewport(fab);}
  },3000);"""
assert old_boot in s
s=s.replace(old_boot,new_boot,1)

# README release note
r=Path('README.md')
readme=r.read_text().replace('**Current version:** v0.2.7','**Current version:** v0.2.8',1)
readme += """

## v0.2.8 — Torn PDA launcher lifecycle repair

- Root cause: Torn PDA can tear down a userscript execution context while leaving the same-version runtime marker on `window`. The old guard then returned before remounting the launcher.
- Every new injection now supersedes the prior runtime token and mounts a fresh launcher/watchdog instead of trusting a stale marker.
- Legacy launcher nodes are hidden only after the current launcher is confirmed interactable, preserving a fallback during recovery.
- Launcher visibility now depends on the actual visible analyzer overlay, not only the `state.open` boolean.
- Stale open-state recovery and old watchdog cleanup are included; Bento card scrolling remains isolated and unchanged.
"""
r.write_text(readme)

p.write_text(s)
