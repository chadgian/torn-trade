const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('torn-trade-analyzer.user.js', 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeDom(body='', head='') {
  const dom = new JSDOM(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, {
    url:'https://www.torn.com/index.php', runScripts:'outside-only', pretendToBeVisual:true,
  });
  const {window}=dom;
  Object.defineProperty(window,'innerWidth',{configurable:true,value:390});
  Object.defineProperty(window,'innerHeight',{configurable:true,value:760});
  window.confirm=()=>false;window.alert=()=>{};window.console=console;
  Object.defineProperty(window.HTMLElement.prototype,'offsetWidth',{configurable:true,get(){return this.id==='tta-fab'?40:100;}});
  Object.defineProperty(window.HTMLElement.prototype,'offsetHeight',{configurable:true,get(){return this.id==='tta-fab'?40:40;}});
  window.HTMLElement.prototype.getBoundingClientRect=function(){
    if(this.id==='tta-fab'){
      const left=Number.parseFloat(this.style.left)||336,top=Number.parseFloat(this.style.top)||634;
      return {x:left,y:top,left,top,right:left+40,bottom:top+40,width:40,height:40,toJSON(){return this;}};
    }
    return {x:0,y:0,left:0,top:0,right:390,bottom:760,width:390,height:760,toJSON(){return this;}};
  };
  return dom;
}

function assertVisible(window,label){
  const fab=window.document.getElementById('tta-fab');
  assert(fab,`${label}: #tta-fab must exist`);assert(fab.isConnected,`${label}: connected`);
  assert.strictEqual(fab.parentElement,window.document.body,`${label}: direct body child`);
  const cs=window.getComputedStyle(fab);
  assert.notStrictEqual(cs.display,'none',`${label}: display`);assert.notStrictEqual(cs.visibility,'hidden',`${label}: visibility`);assert.notStrictEqual(cs.opacity,'0',`${label}: opacity`);
  assert.strictEqual(cs.position,'fixed',`${label}: position fixed`);assert(Number.parseInt(cs.zIndex||'0',10)>=2147483000,`${label}: z-index`);
  const r=fab.getBoundingClientRect();assert(r.left>=0&&r.right<=390&&r.top>=0&&r.bottom<=760,`${label}: in viewport`);
  assert(fab.querySelector('.tta-terminal-frame'),`${label}: themed terminal SVG exists`);
  return fab;
}

function cleanup(window){try{window.__TTA_FAB_WATCHDOG_V029__?.cleanup?.();}catch(_){};}

(async()=>{
  // A. Clean-page lifecycle.
  {
    const dom=makeDom('<main id="torn-app">Torn</main>');const {window}=dom;
    window.eval(source);await wait(120);
    let fab=assertVisible(window,'fresh boot');const root=window.document.getElementById('tta-root');assert(root,'fresh root');
    const css=window.document.getElementById('tta-css-v029');assert(css,'fresh: v0.2.9 stylesheet injected');
    assert(css.textContent.includes('#tta-fab{position:fixed'),'fresh: stylesheet targets live launcher');
    assert(css.textContent.includes('#tta-fab .tta-terminal-frame'),'fresh: icon styling targets live launcher');
    fab.click();await wait(140);assert(root.classList.contains('show'),'fresh click opens analyzer');assert(root.querySelector('.tta-shell'),'fresh dashboard shell renders');
    root.querySelector('[data-act="close"]').click();await wait(80);fab=assertVisible(window,'after close');
    fab.remove();await wait(160);fab=assertVisible(window,'after fab removal');
    window.document.body.innerHTML='<main id="new-route">new Torn route</main>';await wait(200);fab=assertVisible(window,'after body replacement');assert(window.document.getElementById('tta-root'),'root restored after body replacement');
    const prior=fab,priorInstance=fab.dataset.ttaInstance;window.eval(source);await wait(160);fab=assertVisible(window,'same-version reinjection');assert.notStrictEqual(fab,prior,'reinjection replaces launcher node');assert.notStrictEqual(fab.dataset.ttaInstance,priorInstance,'reinjection gets new execution id');fab.click();await wait(140);assert(window.document.getElementById('tta-root').classList.contains('show'),'reinjected launcher opens analyzer');
    cleanup(window);dom.window.close();
  }

  // B. Realistic in-place upgrade from v0.2.8. This is the regression that clean-page
  // tests missed: old WebView DOM and stylesheet survive while the userscript updates.
  {
    const staleCss=`<style id="tcfa-css-v028">#tcfa-launcher{display:inline-flex!important}#tcfa-root{position:fixed}#tta-fab{display:none!important;visibility:hidden!important}</style>`;
    const staleBody=`<main id="torn-app">Torn</main><button id="tcfa-launcher">old</button><div id="tcfa-root"></div><button id="tta-fab" style="display:none!important;visibility:hidden!important">legacy</button>`;
    const dom=makeDom(staleBody,staleCss);const {window}=dom;
    window.__TCFA_RUNTIME_INSTANCE__={version:'0.2.8',token:'old'};
    window.__TCFA_LAUNCHER_WATCH_V028__={cleanup(){this.cleaned=true;}};
    window.eval(source);await wait(160);
    const fab=assertVisible(window,'v0.2.8 → v0.2.9 upgrade');
    assert(!window.document.getElementById('tcfa-css-v028'),'upgrade: stale v0.2.8 stylesheet removed');
    const css=window.document.getElementById('tta-css-v029');assert(css,'upgrade: new v0.2.9 stylesheet installed');
    assert(css.textContent.includes('#tta-fab{position:fixed'),'upgrade: new stylesheet targets #tta-fab');
    assert(css.textContent.includes('#tta-root{position:fixed'),'upgrade: new stylesheet targets #tta-root');
    assert(!window.document.getElementById('tcfa-launcher'),'upgrade: old launcher removed');
    assert(!window.document.getElementById('tcfa-root'),'upgrade: old root removed');
    const root=window.document.getElementById('tta-root');assert(root,'upgrade: restored root exists');
    assert.strictEqual(window.getComputedStyle(root).position,'fixed','upgrade: root receives v0.2.9 CSS');
    fab.click();await wait(140);assert(root.classList.contains('show'),'upgrade: launcher opens analyzer');assert(root.querySelector('.tta-shell'),'upgrade: dashboard renders');
    cleanup(window);dom.window.close();
  }

  console.log('PASS: v0.2.9 launcher works on clean boot and real in-place v0.2.8 upgrade, with correct stylesheet replacement and themed launcher/root selectors.');
})().catch(err=>{console.error(err.stack||err);process.exit(1);});
