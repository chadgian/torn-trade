const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync('torn-trade-analyzer.user.js', 'utf8');
const dom = new JSDOM('<!doctype html><html><head></head><body><main id="torn-app">Torn page</main></body></html>', {
  url: 'https://www.torn.com/index.php',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
Object.defineProperty(window, 'innerHeight', { configurable: true, value: 760 });
window.confirm = () => false;
window.alert = () => {};
window.console = console;

// jsdom has no layout engine. Give the launcher realistic geometry so drag/position
// code and visibility assertions can be exercised instead of returning 0x0 boxes.
Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() { return this.id === 'tta-fab' ? 40 : 100; }
});
Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() { return this.id === 'tta-fab' ? 40 : 40; }
});
window.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.id === 'tta-fab') {
    const left = Number.parseFloat(this.style.left) || 336;
    const top = Number.parseFloat(this.style.top) || 634;
    return { x:left, y:top, left, top, right:left+40, bottom:top+40, width:40, height:40, toJSON(){return this;} };
  }
  return { x:0, y:0, left:0, top:0, right:390, bottom:760, width:390, height:760, toJSON(){return this;} };
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function launcher() { return window.document.getElementById('tta-fab'); }
function root() { return window.document.getElementById('tta-root'); }
function assertLauncherVisible(label) {
  const fab = launcher();
  assert(fab, `${label}: #tta-fab must exist`);
  assert(fab.isConnected, `${label}: launcher must be connected`);
  assert.strictEqual(fab.parentElement, window.document.body, `${label}: launcher must be a direct body child`);
  const cs = window.getComputedStyle(fab);
  assert.notStrictEqual(cs.display, 'none', `${label}: launcher display must not be none`);
  assert.notStrictEqual(cs.visibility, 'hidden', `${label}: launcher visibility must not be hidden`);
  assert.notStrictEqual(cs.opacity, '0', `${label}: launcher opacity must not be zero`);
  assert.strictEqual(cs.position, 'fixed', `${label}: launcher must be fixed`);
  assert(Number.parseInt(cs.zIndex || '0', 10) >= 2147483000, `${label}: launcher z-index must stay above Torn UI`);
  const r = fab.getBoundingClientRect();
  assert(r.left >= 0 && r.right <= 390 && r.top >= 0 && r.bottom <= 760, `${label}: launcher must be inside viewport`);
  return fab;
}

(async () => {
  // 1. Fresh userscript boot.
  window.eval(source);
  await wait(120);
  let fab = assertLauncherVisible('fresh boot');
  assert(root(), 'fresh boot: #tta-root must exist');
  assert(!window.document.getElementById('tcfa-launcher'), 'fresh boot: experimental tcfa launcher must not exist');
  assert(!window.document.getElementById('tcfa-root'), 'fresh boot: experimental tcfa root must not exist');
  const firstInstance = fab.dataset.ttaInstance;
  assert(firstInstance, 'fresh boot: launcher must carry current execution instance id');

  // 2. The thing the user actually needs: tap floating button -> analyzer opens.
  fab.click();
  await wait(160);
  assert(root().classList.contains('show'), 'click: analyzer root must open');
  assert(root().querySelector('.tta-shell'), 'click: analyzer dashboard shell must render');
  assert.strictEqual(window.getComputedStyle(fab).display, 'none', 'click: launcher hides only while analyzer is open');

  // Close using the real delegated UI action; launcher must return.
  const close = root().querySelector('[data-act="close"]');
  assert(close, 'close: rendered analyzer must have a close control');
  close.click();
  await wait(100);
  fab = assertLauncherVisible('after close');

  // 3. Torn SPA removes only the floating node. Watchdog must restore it.
  fab.remove();
  await wait(180);
  fab = assertLauncherVisible('after launcher removal');
  assert.notStrictEqual(fab, null);

  // 4. Torn SPA replaces body contents. Both root and launcher must recover.
  window.document.body.innerHTML = '<main id="torn-app-new">New Torn route</main>';
  await wait(220);
  fab = assertLauncherVisible('after body replacement');
  assert(root(), 'after body replacement: analyzer root must be recreated');

  // 5. Torn PDA reinjects the same userscript version. The node must be replaced so
  // listeners belong to the new execution context, rather than a dead old closure.
  const beforeReinject = fab;
  const beforeInstance = fab.dataset.ttaInstance;
  window.eval(source);
  await wait(180);
  fab = assertLauncherVisible('after same-version reinjection');
  assert.notStrictEqual(fab, beforeReinject, 'reinjection: launcher DOM node must be replaced');
  assert.notStrictEqual(fab.dataset.ttaInstance, beforeInstance, 'reinjection: execution instance id must change');

  // And click-to-open must still work after reinjection.
  fab.click();
  await wait(160);
  assert(root().classList.contains('show'), 'reinjection click: analyzer must still open');
  assert(root().querySelector('.tta-shell'), 'reinjection click: dashboard shell must render');

  console.log('PASS: launcher is visible, opens analyzer, recovers from DOM removal/body replacement, and survives same-version reinjection.');
  window.close();
})().catch(err => {
  console.error(err.stack || err);
  window.close();
  process.exit(1);
});
