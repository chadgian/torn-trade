from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

# Version / metadata
s=s.replace('// @version      0.2.6','// @version      0.2.7',1)
s=s.replace("const VERSION = '0.2.6';","const VERSION = '0.2.7';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, reliable direct floating launcher, TCT daily flow and fast sync modes. Data stays on-device.','Torn cash-flow, spending, earnings, net-worth and trade analytics with a Bento dashboard, isolated self-healing launcher, TCT daily flow and fast sync modes. Data stays on-device.',1)

# Give the current UI its own root/style IDs so an older installed copy cannot
# reuse or overwrite the current overlay or prevent CSS injection.
s=s.replace('tta-root','tcfa-root')
s=s.replace("document.getElementById('tta-css')","document.getElementById('tcfa-css-v027')",1)
s=s.replace("s.id = 'tta-css';","s.id = 'tcfa-css-v027';",1)

# Install an ownership token early. A second copy of the same current release exits,
# while a future release can take ownership and cause this release's watchdog to stop.
needle="  const VERSION = '0.2.7';\n"
assert needle in s
runtime="""  const VERSION = '0.2.7';
  const TCFA_RUNTIME_KEY = '__TCFA_RUNTIME_INSTANCE__';
  const existingTcfaRuntime = window[TCFA_RUNTIME_KEY];
  if(existingTcfaRuntime?.version===VERSION) return;
  const TCFA_INSTANCE_TOKEN = `${VERSION}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2,8)}`;
  window[TCFA_RUNTIME_KEY] = {version:VERSION,token:TCFA_INSTANCE_TOKEN,startedAt:Date.now()};
"""
s=s.replace(needle,runtime,1)

new_launcher=r'''  const TCFA_LAUNCHER_ID='tcfa-launcher';
  const TCFA_LAUNCHER_RESET_KEY='launcherPositionResetV027';

  function tcfaOwnsRuntime(){return window[TCFA_RUNTIME_KEY]?.token===TCFA_INSTANCE_TOKEN;}
  function tcfaVisualViewport(){
    const vv=window.visualViewport;
    const left=vv&&Number.isFinite(vv.offsetLeft)?vv.offsetLeft:0,top=vv&&Number.isFinite(vv.offsetTop)?vv.offsetTop:0;
    const width=vv&&Number.isFinite(vv.width)&&vv.width>0?vv.width:Math.max(1,window.innerWidth||document.documentElement.clientWidth||360);
    const height=vv&&Number.isFinite(vv.height)&&vv.height>0?vv.height:Math.max(1,window.innerHeight||document.documentElement.clientHeight||640);
    return {left,top,width,height,right:left+width,bottom:top+height};
  }
  function tcfaDefaultFabPosition(fab,slot=0){
    const v=tcfaVisualViewport(),w=fab?.offsetWidth||40,h=fab?.offsetHeight||40,pad=12;
    const candidates=[
      {left:v.right-w-pad,top:v.top+Math.max(72,Math.min(v.height-h-pad,v.height*.64))},
      {left:v.right-w-pad,top:v.top+Math.max(72,Math.min(v.height-h-pad,v.height*.38))},
      {left:v.left+pad,top:v.top+Math.max(72,Math.min(v.height-h-pad,v.height*.56))},
      {left:v.right-w-pad,top:v.top+Math.min(v.height-h-pad,96)},
    ];
    return candidates[Math.max(0,Math.min(candidates.length-1,slot))];
  }
  function clampFabPosition(left,top,fab){
    const v=tcfaVisualViewport(),pad=8,w=fab?.offsetWidth||40,h=fab?.offsetHeight||40;
    return {left:Math.max(v.left+pad,Math.min(Number(left)||0,v.right-w-pad)),top:Math.max(v.top+pad,Math.min(Number(top)||0,v.bottom-h-pad))};
  }
  function setFabPosition(fab,pos,persist=true){
    if(!fab||!pos)return;const p=clampFabPosition(pos.left,pos.top,fab);
    fab.style.setProperty('left',`${Math.round(p.left)}px`,'important');fab.style.setProperty('top',`${Math.round(p.top)}px`,'important');
    fab.style.setProperty('right','auto','important');fab.style.setProperty('bottom','auto','important');
    if(persist){state.fabPosition=p;save('fabPosition',p);}return p;
  }
  function applyFabPosition(fab){
    if(!fab)return;
    const saved=state.fabPosition;
    if(saved&&Number.isFinite(Number(saved.left))&&Number.isFinite(Number(saved.top)))setFabPosition(fab,{left:Number(saved.left),top:Number(saved.top)},true);
    else setFabPosition(fab,tcfaDefaultFabPosition(fab,0),true);
  }
  function suppressLegacyUi(){
    // Old copies used these shared IDs. Removing/hiding them prevents legacy watchdogs,
    // style tags and roots from fighting the current runtime. The data namespace stays shared.
    for(const id of ['tta-fab-host','tta-fab','tta-root','tta-css']){
      const el=document.getElementById(id);if(!el)continue;
      try{if(id==='tta-fab')el.style.setProperty('display','none','important');else el.remove();}catch(_){}
    }
  }
  function forceFabBaseStyle(fab){
    if(!fab)return;const st=fab.style,set=(k,v)=>st.setProperty(k,v,'important');
    set('position','fixed');set('z-index','2147483647');set('width','42px');set('height','42px');set('min-width','42px');set('min-height','42px');set('max-width','42px');set('max-height','42px');
    set('padding','0');set('margin','0');set('border','1px solid #6b93a8');set('border-radius','50%');set('background','linear-gradient(145deg,#294f45,#28526e)');set('color','#fff');
    set('box-shadow','0 10px 28px #0009,0 0 0 1px #ffffff1b inset');set('visibility','visible');set('opacity','1');set('pointer-events','auto');set('align-items','center');set('justify-content','center');set('text-align','center');set('overflow','visible');
    set('clip','auto');set('clip-path','none');set('contain','none');set('isolation','isolate');set('touch-action','none');set('font','700 18px/1 system-ui');set('-webkit-appearance','none');set('appearance','none');
    // Force a dedicated compositor layer in Android WebView without using a transformed ancestor.
    set('transform','translate3d(0,0,0)');set('will-change','transform');set('backface-visibility','hidden');set('-webkit-backface-visibility','hidden');
  }
  function fabIconSvg(){
    // No CSS classes, shared SVG ids, gradients or external styling: older scripts/page CSS
    // cannot make the icon disappear even when multiple userscripts are installed.
    return `<span aria-hidden="true" style="display:grid;place-items:center;width:24px;height:24px;pointer-events:none"><svg viewBox="0 0 24 24" focusable="false" style="display:block;width:24px;height:24px;overflow:visible"><rect x="2.5" y="3.25" width="19" height="17.5" rx="3" fill="#10202a" stroke="#8bc9f7" stroke-width="1.35"/><path d="M3.25 7h17.5" fill="none" stroke="#547084" stroke-width="1.15"/><circle cx="5.25" cy="5.2" r=".68" fill="#77ddb0"/><circle cx="7.45" cy="5.2" r=".68" fill="#8bc9f7"/><path d="M5.4 10.1l2 1.8-2 1.8" fill="none" stroke="#77ddb0" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.8 13.7h2.2" fill="none" stroke="#d7e4ec" stroke-width="1.35" stroke-linecap="round"/><path d="M5 17.25h2.15l1.05-2.05 1.45 3.5 1.75-5.15 1.55 3.7" fill="none" stroke="#77ddb0" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.95 17.25h1.85l1.1-1.8 1.05 1.8H19" fill="none" stroke="#8bc9f7" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  }
  function fabSpinnerSvg(){return `<svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" style="display:block"><circle cx="12" cy="12" r="8" fill="none" stroke="#ffffff35" stroke-width="2.4"/><path d="M12 4a8 8 0 0 1 8 8" fill="none" stroke="#ffd2d8" stroke-width="2.6" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite"/></path></svg>`;}
  function bindFabDrag(fab){
    if(!fab||fab.dataset.tcfaDragBound==='1')return;fab.dataset.tcfaDragBound='1';
    let startX=0,startY=0,startLeft=0,startTop=0,moved=false,pointerId=null;
    fab.addEventListener('pointerdown',e=>{if(e.button!=null&&e.button!==0)return;pointerId=e.pointerId;moved=false;startX=e.clientX;startY=e.clientY;const r=fab.getBoundingClientRect();startLeft=r.left;startTop=r.top;try{fab.setPointerCapture(pointerId);}catch(_){};});
    fab.addEventListener('pointermove',e=>{if(pointerId==null||e.pointerId!==pointerId)return;const dx=e.clientX-startX,dy=e.clientY-startY;if(!moved&&Math.hypot(dx,dy)<5)return;moved=true;e.preventDefault();setFabPosition(fab,{left:startLeft+dx,top:startTop+dy},false);});
    const finish=e=>{if(pointerId==null||e.pointerId!==pointerId)return;try{fab.releasePointerCapture(pointerId);}catch(_){}pointerId=null;if(moved){const r=fab.getBoundingClientRect();state.fabPosition=clampFabPosition(r.left,r.top,fab);save('fabPosition',state.fabPosition);fab.dataset.suppressClick='1';setTimeout(()=>fab.dataset.suppressClick='0',220);}};
    fab.addEventListener('pointerup',finish);fab.addEventListener('pointercancel',finish);
    fab.addEventListener('click',e=>{if(fab.dataset.suppressClick==='1'){e.preventDefault();e.stopPropagation();return;}openAnalyzer();});
  }
  function updateFabState(){
    const fab=document.getElementById(TCFA_LAUNCHER_ID);if(!fab)return;forceFabBaseStyle(fab);
    const syncing=!!state.syncing;fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Open Cash Flow Analyzer');fab.title=syncing?'Financial history sync is running · tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?fabSpinnerSvg():fabIconSvg();
    fab.style.setProperty('display',state.open?'none':'inline-flex','important');
    if(!state.open)fab.style.setProperty('visibility','visible','important');
  }
  function fabIsInteractable(fab){
    if(!fab||state.open||!fab.isConnected)return false;const cs=getComputedStyle(fab),r=fab.getBoundingClientRect(),v=tcfaVisualViewport();
    if(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)<=0||r.width<30||r.height<30||r.right<=v.left||r.left>=v.right||r.bottom<=v.top||r.top>=v.bottom)return false;
    const x=Math.max(v.left+1,Math.min(v.right-1,r.left+r.width/2)),y=Math.max(v.top+1,Math.min(v.bottom-1,r.top+r.height/2));
    const top=document.elementFromPoint?.(x,y);return !top||top===fab||fab.contains(top);
  }
  function verifyFabViewport(fab){
    if(!fab||state.open)return;forceFabBaseStyle(fab);fab.style.setProperty('display','inline-flex','important');
    const v=tcfaVisualViewport(),r=fab.getBoundingClientRect();
    if(!Number.isFinite(r.left)||!Number.isFinite(r.top)||r.width<30||r.height<30||r.right<v.left+2||r.bottom<v.top+2||r.left>v.right-2||r.top>v.bottom-2){setFabPosition(fab,tcfaDefaultFabPosition(fab,0),true);fab.dataset.recoverySlot='0';return;}
    if(fabIsInteractable(fab)){fab.dataset.recoverySlot='0';return;}
    const next=Math.min(3,(Number(fab.dataset.recoverySlot)||0)+1);fab.dataset.recoverySlot=String(next);setFabPosition(fab,tcfaDefaultFabPosition(fab,next),true);
  }
  function preferredFabParent(){return document.body||document.documentElement;}
  function ensureFabMounted(){
    if(!tcfaOwnsRuntime())return null;suppressLegacyUi();const parent=preferredFabParent();let fab=document.getElementById(TCFA_LAUNCHER_ID);
    if(!fab){fab=document.createElement('button');fab.id=TCFA_LAUNCHER_ID;fab.type='button';fab.dataset.tcfaVersion=VERSION;fab.innerHTML=fabIconSvg();parent.appendChild(fab);}else if(fab.parentElement!==parent){parent.appendChild(fab);}
    forceFabBaseStyle(fab);bindFabDrag(fab);updateFabState();applyFabPosition(fab);requestAnimationFrame(()=>verifyFabViewport(fab));return fab;
  }
  function installFabWatchdog(){
    const previous=window.__TCFA_LAUNCHER_WATCH_V027__;if(previous?.token===TCFA_INSTANCE_TOKEN)return;
    try{previous?.observer?.disconnect?.();if(previous?.interval)clearInterval(previous.interval);}catch(_){}
    const observer=new MutationObserver(()=>{if(!tcfaOwnsRuntime()){observer.disconnect();return;}const fab=document.getElementById(TCFA_LAUNCHER_ID),parent=preferredFabParent();if(!fab||fab.parentElement!==parent||document.getElementById('tta-fab')||document.getElementById('tta-fab-host'))ensureFabMounted();});
    observer.observe(document.documentElement,{childList:true,subtree:true});
    const interval=setInterval(()=>{if(!tcfaOwnsRuntime()){clearInterval(interval);observer.disconnect();return;}const fab=ensureFabMounted();if(fab)verifyFabViewport(fab);},900);
    const onViewport=()=>{if(!tcfaOwnsRuntime())return;const fab=document.getElementById(TCFA_LAUNCHER_ID);if(fab){applyFabPosition(fab);requestAnimationFrame(()=>verifyFabViewport(fab));}};
    window.addEventListener('resize',onViewport,{passive:true});window.visualViewport?.addEventListener('resize',onViewport,{passive:true});window.visualViewport?.addEventListener('scroll',onViewport,{passive:true});
    window.__TCFA_LAUNCHER_WATCH_V027__={token:TCFA_INSTANCE_TOKEN,observer,interval,onViewport};
  }
  function mount(){
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
  }

'''
pat=r"  function clampFabPosition\(left,top,fab\) \{.*?\n  let demoTxCache=null;"
s2,n=re.subn(pat,new_launcher+"  let demoTxCache=null;",s,count=1,flags=re.S)
assert n==1, f'launcher block replacement count={n}'
s=s2

# README
rp=Path('README.md');r=rp.read_text();r=r.replace('**Current version:** v0.2.6','**Current version:** v0.2.7',1)
r += '''\n\n## v0.2.7 — Launcher runtime isolation\n\n- Root-cause hardening after comparing the last known-good pre-Bento launcher with the Bento-era releases. The Bento commit did not delete the launcher functions, so the repair now targets indirect/runtime conflicts instead of only CSS.\n- Uses new isolated DOM ids for the current launcher, analyzer root and style tag so older installed/stale copies cannot move, hide or restyle the current UI.\n- Uses a runtime ownership token so duplicate copies of the same current release do not create competing watchdogs.\n- Suppresses legacy `#tta-fab`, `#tta-fab-host`, `#tta-root` and `#tta-css` UI nodes while keeping the existing local accounting data namespace intact.\n- Resets the old saved launcher coordinate once and clamps future positions against Android's visual viewport.\n- Adds element hit-testing and several safe fallback positions when a DOM layer covers the button.\n- Forces the launcher into its own compositor layer and keeps it alive even if dashboard rendering throws.\n'''
rp.write_text(r)

p.write_text(s)
