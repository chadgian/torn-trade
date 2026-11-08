const test=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./harness.cjs');

test('this tab publishes Quick Sync activity and clears it after completion',()=>{
  const {app,storage}=harness();
  app.beginSyncActivity({syncMode:'quick',progress:'Preparing scan'},true);
  const active=JSON.parse(storage.get('tta:v1:syncActivity'));
  assert.equal(active.mode,'quick');
  assert.equal(active.background,true);
  assert.match(app.syncActivityIndicatorHtml(),/This tab/);
  assert.match(app.syncActivityIndicatorHtml(),/data-act="syncActivityDetails"/);
  assert.match(app.syncActivityIndicatorHtml(),/Background Quick Sync/);
  app.updateSyncActivityProgress('Checking history page 2');
  app.publishSyncActivity(true);
  assert.equal(JSON.parse(storage.get('tta:v1:syncActivity')).progress,'Checking history page 2');
  app.endSyncActivity();
  assert.equal(storage.has('tta:v1:syncActivity'),false);
  assert.equal(app.getSyncActivity(),null);
});

test('a separate tab displays Full Resync without pretending it owns it',()=>{
  const {app,storage}=harness();
  storage.set('tta:v1:syncActivity',JSON.stringify({
    tabId:'foreign-tab',mode:'full',background:false,progress:'48% complete',startedAt:Date.now()-1000,updatedAt:Date.now()
  }));
  assert.equal(app.getSyncActivity().tabId,'foreign-tab');
  const html=app.syncActivityIndicatorHtml();
  assert.match(html,/Other tab/);
  assert.match(html,/Full Resync/);
  assert.match(html,/48% complete/);
  assert.doesNotMatch(html,/This tab/);
});

test('abandoned sync activity expires and never blocks viewing',()=>{
  const {app,storage}=harness();
  storage.set('tta:v1:syncActivity',JSON.stringify({
    tabId:'closed-tab',mode:'quick',background:true,updatedAt:Date.now()-100000
  }));
  assert.equal(app.getSyncActivity(),null);
  assert.match(app.syncActivityIndicatorHtml(),/hidden/);
});

test('finishing this tab does not erase a newer tab owner',()=>{
  const {app,storage}=harness();
  app.beginSyncActivity({syncMode:'quick'},false);
  const replacement={tabId:'new-owner',mode:'full',updatedAt:Date.now()};
  storage.set('tta:v1:syncActivity',JSON.stringify(replacement));
  app.endSyncActivity();
  assert.equal(JSON.parse(storage.get('tta:v1:syncActivity')).tabId,'new-owner');
});

test('BroadcastChannel activity still works if localStorage is unavailable',()=>{
  const {app,context}=harness();
  context.localStorage.getItem=()=>{throw new Error('storage disabled');};
  app.acceptSyncActivityMessage({type:'sync-status',activity:{
    tabId:'channel-peer',mode:'quick',background:true,updatedAt:Date.now(),progress:'Reading page'
  }});
  assert.equal(app.getSyncActivity().tabId,'channel-peer');
  assert.match(app.syncActivityIndicatorHtml(),/Other tab/);
  app.acceptSyncActivityMessage({type:'sync-status',activity:null});
  assert.equal(app.getSyncActivity(),null);
});

test('background Quick Sync uses static dark-green badge while manual sync spins',()=>{
  const {app,context,storage}=harness();
  const classes=new Set();
  const fab={
    dataset:{},style:{},innerHTML:'',title:'',
    classList:{toggle:(name,enabled)=>enabled?classes.add(name):classes.delete(name)},
    setAttribute(name,value){this[name]=value;}
  };
  context.document.getElementById=id=>id==='tta-fab'?fab:null;
  app.beginSyncActivity({syncMode:'quick',progress:'Checking logs'},true);
  app.updateFabState();
  assert.equal(fab.dataset.syncStatus,'own-background');
  assert.match(fab.innerHTML,/tta-fabicon/);
  assert.match(fab.innerHTML,/tta-fab-background/);
  assert.doesNotMatch(fab.innerHTML,/tta-fabspinner/);
  assert.equal(classes.has('syncing-background'),true);
  assert.equal(classes.has('syncing-other'),false);
  const header=app.syncActivityIndicatorHtml();
  assert.match(header,/tta-sync-activity background/);
  assert.doesNotMatch(header,/tta-spinner/);
  assert.match(header,/Background Quick Sync/);
  app.endSyncActivity();
  app.beginSyncActivity({syncMode:'quick',progress:'Manual sync'},false);
  app.updateFabState();
  assert.equal(fab.dataset.syncStatus,'own-manual');
  assert.match(fab.innerHTML,/tta-fabspinner/);
  assert.doesNotMatch(fab.innerHTML,/tta-fab-background/);
  assert.equal(classes.has('syncing-background'),false);
  assert.match(app.syncActivityIndicatorHtml(),/tta-spinner/);
  app.endSyncActivity();
  assert.equal(fab.dataset.syncStatus,'idle');
  assert.doesNotMatch(fab.innerHTML,/tta-fab-background|tta-fabspinner/);
  storage.set('tta:v1:syncActivity',JSON.stringify({
    tabId:'remote',mode:'quick',background:true,updatedAt:Date.now()
  }));
  app.updateFabState();
  assert.equal(fab.dataset.syncStatus,'other');
  assert.match(fab.innerHTML,/tta-fab-other/);
  assert.equal(classes.has('syncing-other'),true);
  assert.equal(classes.has('syncing-background'),false);
});


test('pagehide retires active background Quick Sync instead of leaving Other tab indicator',()=>{
  const {app,storage,windowEvents}=harness();
  app.setupSyncActivityLifecycle();
  app.beginSyncActivity({syncMode:'quick',progress:'Page 3'},true);
  assert.equal(windowEvents.has('pagehide'),true);
  assert.equal(windowEvents.has('beforeunload'),true);
  windowEvents.get('pagehide')[0]();
  assert.equal(storage.has('tta:v1:syncActivity'),false);
  assert.equal(app.getSyncActivity(),null);
  assert.match(app.syncActivityIndicatorHtml(),/hidden/);
  windowEvents.get('beforeunload')[0](); // teardown is idempotent
});

test('reload recovers from missed pagehide and clears only the retired document',()=>{
  const session=new Map();
  const first=harness({sessionState:session,navigationType:'navigate'});
  first.app.beginSyncActivity({syncMode:'quick',progress:'In progress'},true);
  const previous=JSON.parse(first.storage.get('tta:v1:syncActivity'));
  assert.ok(previous.tabSessionId);
  // Simulate a browser lifecycle where pagehide failed to fire.
  const reloaded=harness({sessionState:session,navigationType:'reload',stored:{syncActivity:previous}});
  assert.match(reloaded.app.syncActivityIndicatorHtml(),/Other tab/);
  reloaded.app.setupSyncActivityLifecycle();
  assert.equal(reloaded.storage.has('tta:v1:syncActivity'),false);
  assert.match(reloaded.app.syncActivityIndicatorHtml(),/hidden/);
  // A legitimately resumed manual job shows this tab, not the retired tab.
  reloaded.app.beginSyncActivity({syncMode:'quick',progress:'Resumed'},false);
  assert.match(reloaded.app.syncActivityIndicatorHtml(),/This tab/);
  assert.doesNotMatch(reloaded.app.syncActivityIndicatorHtml(),/Other tab/);
  reloaded.app.endSyncActivity();
});

test('reload never clears an active sync that belongs to another tab',()=>{
  const session=new Map();
  const first=harness({sessionState:session,navigationType:'navigate'});
  const previousSession=session.get('tta:v1:syncTabSession');
  const peer={tabId:'another-live-tab',tabSessionId:'different-session',mode:'full',background:false,updatedAt:Date.now(),progress:'Reading history'};
  const reloaded=harness({sessionState:session,navigationType:'reload',stored:{syncActivity:peer}});
  reloaded.app.setupSyncActivityLifecycle();
  assert.deepEqual(JSON.parse(reloaded.storage.get('tta:v1:syncActivity')),peer);
  assert.equal(session.get('tta:v1:syncTabSession'),previousSession);
  assert.match(reloaded.app.syncActivityIndicatorHtml(),/Other tab/);
  assert.match(reloaded.app.syncActivityIndicatorHtml(),/Full Resync/);
});

test('a newly opened tab rotates cloned session identity and keeps peer activity',()=>{
  const originalSession=new Map();
  const original=harness({sessionState:originalSession,navigationType:'navigate'});
  original.app.beginSyncActivity({syncMode:'quick'},true);
  const record=JSON.parse(original.storage.get('tta:v1:syncActivity'));
  const duplicate=harness({sessionState:new Map(originalSession),navigationType:'navigate',stored:{syncActivity:record}});
  duplicate.app.setupSyncActivityLifecycle();
  assert.notEqual(duplicate.session.get('tta:v1:syncTabSession'),record.tabSessionId);
  assert.equal(JSON.parse(duplicate.storage.get('tta:v1:syncActivity')).tabId,record.tabId);
  assert.match(duplicate.app.syncActivityIndicatorHtml(),/Other tab/);
});

test('teardown must not remove or broadcast over a newer sync owner',()=>{
  const {app,storage,windowEvents}=harness();
  app.setupSyncActivityLifecycle();
  app.beginSyncActivity({syncMode:'quick'},true);
  const latest={tabId:'new-tab',tabSessionId:'new-session',mode:'full',background:false,updatedAt:Date.now()};
  storage.set('tta:v1:syncActivity',JSON.stringify(latest));
  windowEvents.get('pagehide')[0]();
  assert.deepEqual(JSON.parse(storage.get('tta:v1:syncActivity')),latest);
  assert.match(app.syncActivityIndicatorHtml(),/Other tab/);
});
