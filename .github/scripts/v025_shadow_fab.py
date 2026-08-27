from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()
s=s.replace('// @version      0.2.4','// @version      0.2.5',1)
s=s.replace("const VERSION = '0.2.4';","const VERSION = '0.2.5';",1)
s=s.replace('with a Bento dashboard, isolated floating launcher, TCT daily flow and fast sync modes. Data stays on-device.','with a Bento dashboard, Shadow DOM floating launcher, TCT daily flow and fast sync modes. Data stays on-device.',1)

old='''  function updateFabState() {
    const fab=document.getElementById('tta-fab');if(!fab)return;
    forceFabBaseStyle(fab);const syncing=!!state.syncing;
    fab.classList.toggle('syncing',syncing);
    fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Cash Flow Analyzer');
    fab.title=syncing?'Financial history sync is running · tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?'<span class="tta-fabspinner" aria-hidden="true"></span>':fabIconSvg();
    fab.classList.toggle('tta-fab-hidden',!!state.open);fab.style.setProperty('display',state.open?'none':'inline-flex','important');
    requestAnimationFrame(()=>{applyFabPosition(fab);forceFabBaseStyle(fab);verifyFabViewport(fab);});
  }
  function ensureFabMounted() {
    let fab=document.getElementById('tta-fab');const host=document.documentElement;
    if(!fab){fab=document.createElement('button');fab.id='tta-fab';fab.type='button';fab.innerHTML=fabIconSvg();host.appendChild(fab);bindFabDrag(fab);}
    else if(fab.parentElement!==host){host.appendChild(fab);}
    forceFabBaseStyle(fab);bindFabDrag(fab);updateFabState();requestAnimationFrame(()=>{applyFabPosition(fab);verifyFabViewport(fab);});return fab;
  }
  function mount() {
    injectCss();
    ensureFabMounted();
    if (!document.getElementById('tta-root')) {
      const root = document.createElement('div'); root.id = 'tta-root'; (document.body||document.documentElement).appendChild(root);
    }
    render();
    if(!window.__ttaFabWatch){window.__ttaFabWatch=true;const host=document.documentElement;new MutationObserver(()=>{const fab=document.getElementById('tta-fab');if(!fab||fab.parentElement!==host)ensureFabMounted();}).observe(host,{childList:true,subtree:true});setInterval(()=>{const fab=document.getElementById('tta-fab');if(!fab||fab.parentElement!==host)ensureFabMounted();else{updateFabState();verifyFabViewport(fab);}},1500);}
  }
'''
new='''  function getFabHost() {return document.getElementById('tta-fab-host');}
  function getFab() {return getFabHost()?.shadowRoot?.getElementById('tta-fab')||null;}
  function styleFabHost(host) {
    if(!host)return;const st=host.style,set=(k,v)=>st.setProperty(k,v,'important');
    set('position','fixed');set('left','0');set('top','0');set('width','0');set('height','0');set('z-index','2147483647');set('display','block');set('visibility','visible');set('opacity','1');set('overflow','visible');set('pointer-events','none');set('margin','0');set('padding','0');set('border','0');set('contain','none');set('isolation','isolate');
  }
  function shadowFabMarkup() {
    return `<style>:host{all:initial}#tta-fab{position:fixed;right:14px;bottom:86px;z-index:2147483647;width:40px;height:40px;min-width:40px;min-height:40px;max-width:40px;max-height:40px;padding:0;margin:0;border:1px solid #4f768b;border-radius:50%;background:linear-gradient(135deg,#244c42,#254d68);color:#fff;box-shadow:0 10px 26px #0008,0 0 0 1px #ffffff12 inset;display:inline-flex;align-items:center;justify-content:center;text-align:center;visibility:visible;opacity:1;pointer-events:auto;overflow:visible;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-appearance:none;appearance:none;font:700 18px/1 system-ui;cursor:grab;box-sizing:border-box}#tta-fab.dragging{cursor:grabbing}#tta-fab.syncing{border-color:#ff9aa8;background:linear-gradient(135deg,#5d2931,#7b333e)}.tta-fabspinner{width:14px;height:14px;display:block;border:2px solid #ffccd244;border-top-color:#ffb0ba;border-right-color:#ffb0ba;border-radius:50%;animation:ttaFabSpin .78s linear infinite}@keyframes ttaFabSpin{to{transform:rotate(360deg)}}</style><button id="tta-fab" type="button" aria-label="Cash Flow Analyzer"></button>`;
  }
  function updateFabState() {
    const fab=getFab();if(!fab)return;
    forceFabBaseStyle(fab);const syncing=!!state.syncing;
    fab.classList.toggle('syncing',syncing);
    fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Cash Flow Analyzer');
    fab.title=syncing?'Financial history sync is running · tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?'<span class="tta-fabspinner" aria-hidden="true"></span>':fabIconSvg();
    fab.style.setProperty('display',state.open?'none':'inline-flex','important');
    requestAnimationFrame(()=>{applyFabPosition(fab);forceFabBaseStyle(fab);verifyFabViewport(fab);});
  }
  function ensureFabMounted() {
    const parent=document.body||document.documentElement;let host=getFabHost();
    if(!host){host=document.createElement('div');host.id='tta-fab-host';parent.appendChild(host);}else if(host.parentElement!==parent){parent.appendChild(host);}
    styleFabHost(host);let shadow=host.shadowRoot;if(!shadow)shadow=host.attachShadow({mode:'open'});
    let fab=shadow.getElementById('tta-fab');if(!fab){shadow.innerHTML=shadowFabMarkup();fab=shadow.getElementById('tta-fab');}
    forceFabBaseStyle(fab);bindFabDrag(fab);updateFabState();requestAnimationFrame(()=>{applyFabPosition(fab);verifyFabViewport(fab);});return fab;
  }
  function mount() {
    injectCss();
    ensureFabMounted();
    if (!document.getElementById('tta-root')) {
      const root = document.createElement('div'); root.id = 'tta-root'; (document.body||document.documentElement).appendChild(root);
    }
    render();
    if(!window.__ttaFabWatch){window.__ttaFabWatch=true;const rootNode=document.documentElement;new MutationObserver(()=>{const parent=document.body||document.documentElement,host=getFabHost();if(!host||host.parentElement!==parent||!host.shadowRoot?.getElementById('tta-fab'))ensureFabMounted();}).observe(rootNode,{childList:true,subtree:true});setInterval(()=>{const parent=document.body||document.documentElement,host=getFabHost(),fab=getFab();if(!host||host.parentElement!==parent||!fab)ensureFabMounted();else{styleFabHost(host);updateFabState();verifyFabViewport(fab);}},1200);}
  }
'''
assert old in s, 'launcher block not found'
s=s.replace(old,new,1)
p.write_text(s)

r=Path('README.md')
text=r.read_text().replace('**Current version:** v0.2.4','**Current version:** v0.2.5',1)
text += '''\n\n## v0.2.5 — Shadow DOM launcher\n\n- Moves the floating launcher into a valid host under `body` instead of placing the button directly under `html`.\n- Isolates the launcher button in Shadow DOM so Torn/Torn PDA page CSS cannot hide or restyle it.\n- Reattaches the Shadow DOM host if Torn SPA navigation replaces the body content.\n- Keeps the compact draggable terminal/data-pulse button and sync spinner.\n'''
r.write_text(text)
