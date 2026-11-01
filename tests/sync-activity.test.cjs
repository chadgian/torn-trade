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
