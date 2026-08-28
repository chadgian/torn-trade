from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.9','// @version      0.2.10',1)
s=s.replace("const VERSION = '0.2.9';","const VERSION = '0.2.10';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, restored proven floating launcher, TCT daily flow and fast sync modes. Data stays on-device.','Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, launcher diagnostics, TCT daily flow and fast sync modes. Data stays on-device.',1)

anchor="  const TTA_INSTANCE_ID = `v${VERSION}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2,8)}`;\n"
assert anchor in s
insert=r'''  const TTA_DEBUG_PREFIX='[TTA]';
  const TTA_DEBUG_STARTED_AT=Date.now();
  function ttaDebug(stage,data){
    try{if(arguments.length>1)console.log(`${TTA_DEBUG_PREFIX} ${stage}`,data);else console.log(`${TTA_DEBUG_PREFIX} ${stage}`);}catch(_){}
  }
  function ttaDebugError(stage,err,extra){
    try{console.error(`${TTA_DEBUG_PREFIX} ${stage}`,{message:String(err?.message||err||'Unknown error'),stack:String(err?.stack||''),extra:extra||null});}catch(_){}
  }
  function ttaElementSummary(el){
    if(!el)return null;
    return {tag:String(el.tagName||'').toLowerCase(),id:String(el.id||''),className:typeof el.className==='string'?el.className:String(el.className?.baseVal||''),connected:!!el.isConnected,parent:el.parentElement?`${String(el.parentElement.tagName||'').toLowerCase()}#${el.parentElement.id||''}`:null};
  }
  function ttaFabSnapshot(label,fab=document.getElementById('tta-fab')){
    try{
      const vv=window.visualViewport;
      const rect=fab?.getBoundingClientRect?.();
      const cs=fab?getComputedStyle(fab):null;
      let topElement=null;
      if(fab&&rect&&rect.width>0&&rect.height>0&&document.elementFromPoint){
        const x=Math.max(0,Math.min((window.innerWidth||0)-1,rect.left+rect.width/2)),y=Math.max(0,Math.min((window.innerHeight||0)-1,rect.top+rect.height/2));
        topElement=ttaElementSummary(document.elementFromPoint(x,y));
      }
      const data={
        label,version:VERSION,instance:TTA_INSTANCE_ID,uptimeMs:Date.now()-TTA_DEBUG_STARTED_AT,
        href:String(location.href),readyState:document.readyState,bodyPresent:!!document.body,
        stateOpen:typeof state!=='undefined'?!!state.open:null,stateSyncing:typeof state!=='undefined'?!!state.syncing:null,
        savedFabPosition:typeof state!=='undefined'?state.fabPosition:null,
        fab:ttaElementSummary(fab),
        rect:rect?{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}:null,
        computed:cs?{display:cs.display,visibility:cs.visibility,opacity:cs.opacity,position:cs.position,zIndex:cs.zIndex,pointerEvents:cs.pointerEvents,transform:cs.transform}:null,
        inlineStyle:fab?.getAttribute?.('style')||'',
        viewport:{innerWidth:window.innerWidth,innerHeight:window.innerHeight,scrollX:window.scrollX,scrollY:window.scrollY,visualViewport:vv?{width:vv.width,height:vv.height,offsetLeft:vv.offsetLeft,offsetTop:vv.offsetTop,scale:vv.scale}:null},
        topElementAtFabCenter:topElement,
        root:ttaElementSummary(document.getElementById('tta-root')),
        css:{current:!!document.getElementById('tta-css-v029'),old028:!!document.getElementById('tcfa-css-v028'),legacy:!!document.getElementById('tta-css')}
      };
      ttaDebug(`FAB SNAPSHOT: ${label}`,data);return data;
    }catch(err){ttaDebugError(`FAB SNAPSHOT FAILED: ${label}`,err);return null;}
  }
  window.__TTA_DEBUG_DUMP__=()=>ttaFabSnapshot('manual __TTA_DEBUG_DUMP__');
  window.addEventListener('error',e=>ttaDebugError('WINDOW ERROR EVENT',e?.error||e?.message,{filename:e?.filename||'',lineno:e?.lineno||0,colno:e?.colno||0}),true);
  window.addEventListener('unhandledrejection',e=>ttaDebugError('UNHANDLED REJECTION',e?.reason||'Unknown rejection'),true);
  ttaDebug('BOOT: script evaluated',{version:VERSION,instance:TTA_INSTANCE_ID,href:String(location.href),readyState:document.readyState,bodyPresent:!!document.body,userAgent:navigator.userAgent});
'''
s=s.replace(anchor,anchor+insert,1)

state_anchor="  // v0.1.27 removes the old calendar-month preset. Migrate saved users to 30 days.\n"
assert state_anchor in s
s=s.replace(state_anchor,"  ttaDebug('STATE: initialized',{open:state.open,view:state.view,syncing:state.syncing,fabPosition:state.fabPosition,lastSync:state.sync?.lastSync||0});\n\n"+state_anchor,1)

old="""  function injectCss() {
    // v0.2.8 used a different launcher/root namespace under this stylesheet id.
"""
new="""  function injectCss() {
    ttaDebug('CSS: injectCss start',{headPresent:!!document.head,current:!!document.getElementById('tta-css-v029'),old028:!!document.getElementById('tcfa-css-v028')});
    // v0.2.8 used a different launcher/root namespace under this stylesheet id.
"""
assert old in s
s=s.replace(old,new,1)
s=s.replace("    document.getElementById('tcfa-css-v028')?.remove();\n    if (document.getElementById('tta-css-v029')) return;","    const old028=document.getElementById('tcfa-css-v028');if(old028){ttaDebug('CSS: removing stale v0.2.8 stylesheet',ttaElementSummary(old028));old028.remove();}\n    if (document.getElementById('tta-css-v029')) {ttaDebug('CSS: current stylesheet already present');return;}",1)
s=s.replace("    document.head.appendChild(s);\n  }\n\n  function clampFabPosition", "    document.head.appendChild(s);\n    ttaDebug('CSS: stylesheet appended',{id:s.id,length:s.textContent.length,connected:s.isConnected});\n  }\n\n  function clampFabPosition",1)

old="""  function applyFabPosition(fab) {
    if(!fab)return;const saved=state.fabPosition;
    const p=saved&&Number.isFinite(Number(saved.left))&&Number.isFinite(Number(saved.top))?clampFabPosition(Number(saved.left),Number(saved.top),fab):defaultFabPosition(fab);
    fab.style.setProperty('left',`${Math.round(p.left)}px`,'important');fab.style.setProperty('top',`${Math.round(p.top)}px`,'important');fab.style.setProperty('right','auto','important');fab.style.setProperty('bottom','auto','important');
    state.fabPosition=p;save('fabPosition',p);
  }
"""
new="""  function applyFabPosition(fab) {
    if(!fab){ttaDebug('FAB: apply position skipped · no element');return;}const saved=state.fabPosition;
    const p=saved&&Number.isFinite(Number(saved.left))&&Number.isFinite(Number(saved.top))?clampFabPosition(Number(saved.left),Number(saved.top),fab):defaultFabPosition(fab);
    fab.style.setProperty('left',`${Math.round(p.left)}px`,'important');fab.style.setProperty('top',`${Math.round(p.top)}px`,'important');fab.style.setProperty('right','auto','important');fab.style.setProperty('bottom','auto','important');
    state.fabPosition=p;save('fabPosition',p);
    const sig=`${Math.round(p.left)},${Math.round(p.top)}|${window.innerWidth}x${window.innerHeight}`;if(fab.dataset.ttaDebugPosition!==sig){fab.dataset.ttaDebugPosition=sig;ttaDebug('FAB: position applied',{saved:!!saved,position:p,viewport:{width:window.innerWidth,height:window.innerHeight}});}
  }
"""
assert old in s
s=s.replace(old,new,1)

s=s.replace("    if(!fab||fab.dataset.dragBound==='1')return;fab.dataset.dragBound='1';","    if(!fab||fab.dataset.dragBound==='1')return;fab.dataset.dragBound='1';ttaDebug('FAB: binding drag/click handlers',ttaElementSummary(fab));",1)
s=s.replace("    fab.addEventListener('click',e=>{if(fab.dataset.suppressClick==='1'){e.preventDefault();e.stopPropagation();return;}openAnalyzer();});","    fab.addEventListener('click',e=>{ttaDebug('FAB: click received',{suppressed:fab.dataset.suppressClick==='1',stateOpen:state.open});if(fab.dataset.suppressClick==='1'){e.preventDefault();e.stopPropagation();return;}openAnalyzer();});",1)

old="""  function updateFabState() {
    const fab=document.getElementById('tta-fab');if(!fab)return;forceFabVisibleStyle(fab);const syncing=!!state.syncing;
    fab.classList.toggle('syncing',syncing);fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Open Cash Flow Analyzer');fab.title=syncing?'Financial history sync is running · tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?'<span class=\"tta-fabspinner\" aria-hidden=\"true\"></span>':fabIconSvg();fab.style.setProperty('display',state.open?'none':'inline-flex','important');if(!state.open)fab.style.setProperty('visibility','visible','important');
    if(!state.open)requestAnimationFrame(()=>applyFabPosition(fab));
  }
"""
new="""  function updateFabState() {
    const fab=document.getElementById('tta-fab');if(!fab){ttaDebug('FAB: updateFabState · element missing',{stateOpen:state.open,stateSyncing:state.syncing});return;}forceFabVisibleStyle(fab);const syncing=!!state.syncing;
    fab.classList.toggle('syncing',syncing);fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Open Cash Flow Analyzer');fab.title=syncing?'Financial history sync is running · tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?'<span class=\"tta-fabspinner\" aria-hidden=\"true\"></span>':fabIconSvg();fab.style.setProperty('display',state.open?'none':'inline-flex','important');if(!state.open)fab.style.setProperty('visibility','visible','important');
    const sig=`${state.open?'open':'closed'}|${syncing?'syncing':'idle'}|${fab.style.display}`;if(fab.dataset.ttaDebugState!==sig){fab.dataset.ttaDebugState=sig;ttaDebug('FAB: state applied',{stateOpen:state.open,syncing,display:fab.style.display,visibility:fab.style.visibility});requestAnimationFrame(()=>ttaFabSnapshot('after updateFabState',fab));}
    if(!state.open)requestAnimationFrame(()=>applyFabPosition(fab));
  }
"""
assert old in s
s=s.replace(old,new,1)

old="""  function ensureAnalyzerRoot() {
    const parent=document.body||document.documentElement;if(!parent)return null;let root=document.getElementById('tta-root');
    if(!root){root=document.createElement('div');root.id='tta-root';parent.appendChild(root);}else if(root.parentElement!==parent)parent.appendChild(root);return root;
  }
"""
new="""  function ensureAnalyzerRoot() {
    const parent=document.body||document.documentElement;if(!parent){ttaDebug('ROOT: no mount parent available');return null;}let root=document.getElementById('tta-root');
    if(!root){root=document.createElement('div');root.id='tta-root';parent.appendChild(root);ttaDebug('ROOT: created',ttaElementSummary(root));}else if(root.parentElement!==parent){ttaDebug('ROOT: reparenting',{before:ttaElementSummary(root),target:ttaElementSummary(parent)});parent.appendChild(root);}return root;
  }
"""
assert old in s
s=s.replace(old,new,1)

old="""  function ensureFabMounted() {
    const parent=document.body||document.documentElement;if(!parent)return null;let fab=document.getElementById('tta-fab');
    // Always replace a launcher from a previous execution context. This guarantees that the
    // click/drag listeners belong to the currently-running userscript even after Torn PDA reinjects it.
    if(!fab||fab.dataset.ttaInstance!==TTA_INSTANCE_ID){const fresh=document.createElement('button');fresh.id='tta-fab';fresh.type='button';fresh.dataset.ttaInstance=TTA_INSTANCE_ID;fresh.innerHTML=fabIconSvg();if(fab)fab.replaceWith(fresh);else parent.appendChild(fresh);fab=fresh;}
    else if(fab.parentElement!==parent)parent.appendChild(fab);
    forceFabVisibleStyle(fab);bindFabDrag(fab);applyFabPosition(fab);updateFabState();return fab;
  }
"""
new="""  function ensureFabMounted() {
    const parent=document.body||document.documentElement;if(!parent){ttaDebug('FAB: ensure mounted failed · no parent');return null;}let fab=document.getElementById('tta-fab');
    const prior=fab,wrongInstance=!!fab&&fab.dataset.ttaInstance!==TTA_INSTANCE_ID,wrongParent=!!fab&&fab.parentElement!==parent;
    // Always replace a launcher from a previous execution context. This guarantees that the
    // click/drag listeners belong to the currently-running userscript even after Torn PDA reinjects it.
    if(!fab||wrongInstance){const fresh=document.createElement('button');fresh.id='tta-fab';fresh.type='button';fresh.dataset.ttaInstance=TTA_INSTANCE_ID;fresh.innerHTML=fabIconSvg();if(fab){ttaDebug('FAB: replacing stale launcher',{prior:ttaElementSummary(fab),priorInstance:fab.dataset.ttaInstance||'',currentInstance:TTA_INSTANCE_ID});fab.replaceWith(fresh);}else{ttaDebug('FAB: creating launcher',{parent:ttaElementSummary(parent)});parent.appendChild(fresh);}fab=fresh;}
    else if(wrongParent){ttaDebug('FAB: reparenting launcher',{fab:ttaElementSummary(fab),target:ttaElementSummary(parent)});parent.appendChild(fab);}
    forceFabVisibleStyle(fab);bindFabDrag(fab);applyFabPosition(fab);updateFabState();
    if(!prior||wrongInstance||wrongParent)requestAnimationFrame(()=>ttaFabSnapshot('after ensureFabMounted',fab));return fab;
  }
"""
assert old in s
s=s.replace(old,new,1)

old="""  function mount() {
    injectCss();
    // Remove only the experimental alternate nodes. The production UI contract is again
    // the original #tta-root + #tta-fab pair used by the stylesheet and known-working launcher.
    document.getElementById('tcfa-launcher')?.remove();document.getElementById('tcfa-root')?.remove();document.getElementById('tta-fab-host')?.remove();
    ensureAnalyzerRoot();ensureFabMounted();
    try{render();}catch(err){console.error('[TTA] Initial render failed',err);state.open=false;updateFabState();}
  }
"""
new="""  function mount() {
    ttaDebug('MOUNT: start',{body:ttaElementSummary(document.body),existingFab:ttaElementSummary(document.getElementById('tta-fab')),existingRoot:ttaElementSummary(document.getElementById('tta-root')),stateOpen:state.open});
    injectCss();
    // Remove only the experimental alternate nodes. The production UI contract is again
    // the original #tta-root + #tta-fab pair used by the stylesheet and known-working launcher.
    const stale={tcfaLauncher:ttaElementSummary(document.getElementById('tcfa-launcher')),tcfaRoot:ttaElementSummary(document.getElementById('tcfa-root')),fabHost:ttaElementSummary(document.getElementById('tta-fab-host'))};ttaDebug('MOUNT: stale-node scan',stale);
    document.getElementById('tcfa-launcher')?.remove();document.getElementById('tcfa-root')?.remove();document.getElementById('tta-fab-host')?.remove();
    const root=ensureAnalyzerRoot(),fab=ensureFabMounted();ttaDebug('MOUNT: root/fab ensured',{root:ttaElementSummary(root),fab:ttaElementSummary(fab)});
    try{ttaDebug('RENDER: initial render start',{stateOpen:state.open,view:state.view});render();ttaDebug('RENDER: initial render complete',{stateOpen:state.open,view:state.view});}catch(err){ttaDebugError('RENDER: initial render failed',err);state.open=false;updateFabState();}
    requestAnimationFrame(()=>ttaFabSnapshot('mount requestAnimationFrame',fab));setTimeout(()=>ttaFabSnapshot('mount +500ms'),500);setTimeout(()=>ttaFabSnapshot('mount +2000ms'),2000);
  }
"""
assert old in s
s=s.replace(old,new,1)

old="""  function installFabWatchdog() {
    try{window.__TTA_FAB_WATCHDOG_V029__?.cleanup?.();}catch(_){}
    const tick=()=>{if(!document.documentElement)return;const root=ensureAnalyzerRoot();if(state.open&&(!root||!root.classList.contains('show')))state.open=false;ensureFabMounted();};
    const observer=new MutationObserver(()=>{if(!document.getElementById('tta-fab')||!document.getElementById('tta-root'))tick();});observer.observe(document.documentElement,{childList:true,subtree:true});
    const interval=setInterval(tick,1200),onViewport=()=>{const fab=document.getElementById('tta-fab');if(fab&&!state.open)applyFabPosition(fab);};
    window.addEventListener('resize',onViewport,{passive:true});window.addEventListener('pageshow',tick,{passive:true});
    const cleanup=()=>{try{observer.disconnect();clearInterval(interval);window.removeEventListener('resize',onViewport);window.removeEventListener('pageshow',tick);}catch(_){}};
    window.__TTA_FAB_WATCHDOG_V029__={instance:TTA_INSTANCE_ID,cleanup,observer,interval};
  }
"""
new="""  function installFabWatchdog() {
    ttaDebug('WATCHDOG: install start');try{window.__TTA_FAB_WATCHDOG_V029__?.cleanup?.();ttaDebug('WATCHDOG: prior v0.2.9 watchdog cleanup attempted');}catch(err){ttaDebugError('WATCHDOG: prior cleanup failed',err);}
    const tick=()=>{if(!document.documentElement){ttaDebug('WATCHDOG: tick skipped · no documentElement');return;}const beforeFab=document.getElementById('tta-fab'),beforeRoot=document.getElementById('tta-root'),root=ensureAnalyzerRoot();if(state.open&&(!root||!root.classList.contains('show'))){ttaDebug('WATCHDOG: stale open state repaired',{root:ttaElementSummary(root)});state.open=false;}if(!beforeFab||!beforeRoot)ttaDebug('WATCHDOG: missing UI detected',{fab:ttaElementSummary(beforeFab),root:ttaElementSummary(beforeRoot)});ensureFabMounted();};
    const observer=new MutationObserver(()=>{if(!document.getElementById('tta-fab')||!document.getElementById('tta-root')){ttaDebug('WATCHDOG: mutation detected missing UI');tick();}});observer.observe(document.documentElement,{childList:true,subtree:true});
    const interval=setInterval(tick,1200),onViewport=()=>{const fab=document.getElementById('tta-fab');if(fab&&!state.open){ttaDebug('WATCHDOG: viewport event',{innerWidth:window.innerWidth,innerHeight:window.innerHeight});applyFabPosition(fab);}};
    window.addEventListener('resize',onViewport,{passive:true});window.addEventListener('pageshow',()=>{ttaDebug('WATCHDOG: pageshow');tick();},{passive:true});
    const cleanup=()=>{try{observer.disconnect();clearInterval(interval);window.removeEventListener('resize',onViewport);}catch(err){ttaDebugError('WATCHDOG: cleanup failed',err);}};
    window.__TTA_FAB_WATCHDOG_V029__={instance:TTA_INSTANCE_ID,cleanup,observer,interval};ttaDebug('WATCHDOG: installed',{intervalMs:1200});
  }
"""
assert old in s
s=s.replace(old,new,1)

s=s.replace("  async function openAnalyzer() {\n    state.open=true;", "  async function openAnalyzer() {\n    ttaDebug('OPEN: requested',{stateOpenBefore:state.open,view:state.view,fab:ttaElementSummary(document.getElementById('tta-fab')),root:ttaElementSummary(document.getElementById('tta-root'))});\n    state.open=true;",1)
s=s.replace("    const root=document.getElementById('tta-root');if(!root)return;", "    const root=document.getElementById('tta-root');if(!root){ttaDebug('OPEN: aborted · root missing');return;}",1)
s=s.replace("    await nextPaint();render({preserveScroll:false});\n  }", "    await nextPaint();ttaDebug('OPEN: calling render',{view:state.view});render({preserveScroll:false});ttaDebug('OPEN: complete',{root:ttaElementSummary(root)});\n  }",1)

old="""  function render(options={}) {
    const root=document.getElementById('tta-root');if(!root)return;
"""
new="""  function render(options={}) {
    const root=document.getElementById('tta-root');if(!root){ttaDebug('RENDER: skipped · root missing',{stateOpen:state.open,view:state.view});return;}
    ttaDebug('RENDER: enter',{stateOpen:state.open,view:state.view,preserveScroll:options.preserveScroll});
"""
assert old in s
s=s.replace(old,new,1)
s=s.replace("    if(!state.open){root.classList.remove('show');root.setAttribute('aria-hidden','true');return;}", "    if(!state.open){root.classList.remove('show');root.setAttribute('aria-hidden','true');ttaDebug('RENDER: analyzer closed · FAB should be visible');requestAnimationFrame(()=>ttaFabSnapshot('render closed'));return;}",1)
s=s.replace("    if(preserveScroll){const shell=root.querySelector('.tta-shell');if(shell)shell.scrollTop=previousScroll;}positionDailyChartsToLatest(root);\n  }", "    if(preserveScroll){const shell=root.querySelector('.tta-shell');if(shell)shell.scrollTop=previousScroll;}positionDailyChartsToLatest(root);ttaDebug('RENDER: complete',{view:state.view,stateOpen:state.open,rootClass:root.className});\n  }",1)

s=s.replace("      if(act==='close'){state.open=false;if(!state.syncing)setBusy(false);render();}\n      else if(act==='minimizeSync'){state.open=false;render();}", "      if(act==='close'){ttaDebug('UI: close requested',{view:state.view});state.open=false;if(!state.syncing)setBusy(false);render();}\n      else if(act==='minimizeSync'){ttaDebug('UI: minimize sync requested');state.open=false;render();}",1)

old_boot="  const boot=()=>{if(document.body){mount();installFabWatchdog();resumePendingSync();}else setTimeout(boot,250)}; boot();\n})();"
new_boot=r'''  let ttaBootAttempts=0;
  const boot=()=>{
    ttaBootAttempts++;ttaDebug('BOOT: attempt',{attempt:ttaBootAttempts,readyState:document.readyState,bodyPresent:!!document.body,documentElementPresent:!!document.documentElement});
    if(document.body){
      try{ttaDebug('BOOT: calling mount');mount();ttaDebug('BOOT: calling installFabWatchdog');installFabWatchdog();ttaDebug('BOOT: calling resumePendingSync');resumePendingSync();ttaDebug('BOOT: completed');requestAnimationFrame(()=>ttaFabSnapshot('boot complete RAF'));}
      catch(err){ttaDebugError('BOOT: fatal exception',err,{attempt:ttaBootAttempts});setTimeout(()=>ttaFabSnapshot('after boot fatal'),0);}
    }else setTimeout(boot,250);
  }; boot();
})();'''
assert old_boot in s
s=s.replace(old_boot,new_boot,1)

# README debug release notes.
r=Path('README.md')
readme=r.read_text().replace('**Current version:** v0.2.9','**Current version:** v0.2.10',1)
readme += '''\n\n## v0.2.10 — Launcher diagnostics\n\n- Adds structured console diagnostics prefixed with `[TTA]` around userscript boot, CSS injection, root/FAB mounting, state application, rendering and Torn-SPA watchdog recovery.\n- FAB snapshots report its DOM attachment, bounding rectangle, computed display/visibility/opacity/z-index/pointer-events, saved coordinates, viewport metrics, and the topmost element at the launcher center.\n- Browser/runtime errors and unhandled promise rejections are surfaced with `[TTA]` diagnostics.\n- Run `window.__TTA_DEBUG_DUMP__()` in the console for an on-demand launcher snapshot.\n- This release is diagnostic only; cash-flow, sync, trade/FIFO, net-worth and Bento accounting behavior are unchanged.\n'''
r.write_text(readme)
p.write_text(s)
