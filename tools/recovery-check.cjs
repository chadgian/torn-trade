const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'torn-trade-analyzer.user.js'),'utf8').replace(/\n\}\)\(\);\s*$/,'\nwindow.__ttaTest={state,resetHistoryForFullResync,restoreFullResyncBackup,readFullResyncBackup,clearFullResyncBackup,withTransition,navigate,setBusy,render,saveDurable,flushDurableStorage,announceCrossTabUpdate};\n})();');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
  try{
    const context=await browser.newContext({viewport:{width:390,height:900}}),errors=[];
    await context.route('http://localhost:8123/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body></body></html>'}));
    await context.route('https://api.torn.com/**',route=>route.abort());
    let page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://localhost:8123/');await page.addScriptTag({content:script});await page.locator('#tta-fab').waitFor();
    // A history that fits once in localStorage, but not twice, reproduces error 22.
    const before=await page.evaluate(async()=>{
      const a=window.__ttaTest,row={id:'safe',itemId:206,side:'buy',qty:5,total:100,timestamp:100,note:'x'.repeat(3*1024*1024)};
      a.state.transactions=[row];a.state.sync={lastSync:200,firstSyncComplete:true};
      localStorage.setItem('tta:v1:transactions',JSON.stringify(a.state.transactions));localStorage.setItem('tta:v1:sync',JSON.stringify(a.state.sync));
      let duplicated=false;try{localStorage.setItem('test-duplicate',JSON.stringify(a.state.transactions));duplicated=true;}catch(error){if(error.name!=='QuotaExceededError')throw error;}
      localStorage.removeItem('test-duplicate');await a.resetHistoryForFullResync();
      const backup=await a.readFullResyncBackup();return {duplicated,count:a.state.transactions.length,backupId:backup.transactions[0].id,marker:localStorage.getItem('tta:v1:fullResyncBackup')};
    });
    assert.equal(before.duplicated,false);assert.equal(before.count,0);assert.equal(before.backupId,'safe');assert.ok(before.marker.length<100);
    await page.close();page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://localhost:8123/');await page.addScriptTag({content:script});
    await page.waitForFunction(()=>window.__ttaTest.state.sync.lastSync===200);
    assert.equal(await page.evaluate(()=>window.__ttaTest.state.transactions[0].note.length),3*1024*1024);
    assert.equal(await page.evaluate(()=>localStorage.getItem('tta:v1:fullResyncBackup')),null);
    const restored=await page.evaluate(async()=>{
      const a=window.__ttaTest;await a.resetHistoryForFullResync();
      a.state.transactions=[{id:'partial'}];localStorage.setItem('tta:v1:transactions',JSON.stringify(a.state.transactions));
      await a.restoreFullResyncBackup({fullResetDone:true});return {id:a.state.transactions[0].id,lastSync:a.state.sync.lastSync};
    });
    assert.deepEqual(restored,{id:'safe',lastSync:200});
    const failedRecovery=await page.evaluate(async()=>{
      const a=window.__ttaTest;await a.resetHistoryForFullResync();const write=Storage.prototype.setItem;let failed=false;
      Storage.prototype.setItem=function(key,value){if(key==='tta:v1:transactions'&&!failed){failed=true;throw new DOMException('Fixture','QuotaExceededError');}return write.call(this,key,value);};
      let rejected=false;try{await a.restoreFullResyncBackup({fullResetDone:true});}catch(_){rejected=true;}finally{Storage.prototype.setItem=write;}
      const durable=await a.readFullResyncBackup();await a.restoreFullResyncBackup({fullResetDone:true});return {rejected,id:durable.transactions[0].id};
    });
    assert.deepEqual(failedRecovery,{rejected:true,id:'safe'});
    await page.evaluate(async()=>{
      await window.__ttaTest.resetHistoryForFullResync();
      window.lockTask=navigator.locks.request('torn-cash-flow-sync',()=>new Promise(resolve=>{window.releaseLock=resolve;}));
    });
    await page.waitForFunction(()=>!!window.releaseLock);
    const other=await context.newPage();other.on('pageerror',error=>errors.push(error.message));
    await other.goto('http://localhost:8123/');await other.addScriptTag({content:script});await other.locator('#tta-fab').waitFor();
    assert.equal(await other.evaluate(()=>window.__ttaTest.state.transactions[0]?.id),'safe','A second tab should show the last safe history while another tab owns a Full Resync lock');
    assert.equal(await other.evaluate(()=>window.__ttaTest.state.notices.some(n=>n.code==='SYNC_OTHER_TAB')),true);
    assert.notEqual(await other.evaluate(()=>localStorage.getItem('tta:v1:fullResyncBackup')),null);
    await page.evaluate(async()=>{window.releaseLock();await window.lockTask;await window.__ttaTest.restoreFullResyncBackup({fullResetDone:true});const a=window.__ttaTest;const row={id:'cross-tab-updated',itemId:206,side:'buy',qty:1,total:10,timestamp:300};a.state.transactions=[row];await a.saveDurable('transactions',[row]);await a.flushDurableStorage();a.announceCrossTabUpdate('fixture-sync');});
    await other.waitForFunction(()=>window.__ttaTest.state.transactions[0]?.id==='cross-tab-updated');
    await other.close();
    await page.locator('#tta-fab').click();await page.locator('.tta-shell').waitFor();
    await page.evaluate(()=>{window.transitionTask=window.__ttaTest.withTransition('Loading Trade Analysis',()=>new Promise(resolve=>{window.releaseTransition=resolve;}));});
    await page.waitForFunction(()=>!!window.releaseTransition);
    assert.equal(await page.locator('#tta-transition').isVisible(),true);
    assert.equal(await page.locator('#tta-root').getAttribute('aria-busy'),'true');
    const spinner=await page.locator('#tta-transition .tta-spinner').evaluate(el=>({width:el.getBoundingClientRect().width,animation:getComputedStyle(el).animationName}));assert.ok(spinner.width>0);assert.notEqual(spinner.animation,'none');
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results','390-transition.png')});
    await page.evaluate(async()=>{window.releaseTransition();await window.transitionTask;});assert.equal(await page.locator('#tta-transition').isVisible(),false);
    await page.evaluate(async()=>{const a=window.__ttaTest;await Promise.all([a.navigate('cash'),a.navigate('settings')]);});
    assert.equal(await page.locator('#tta-root').getAttribute('data-view'),'settings');
    await page.evaluate(()=>{window.navigationTask=window.__ttaTest.navigate('trade');document.querySelector('[data-act="close"]').click();});
    await page.evaluate(()=>window.navigationTask);assert.equal(await page.locator('#tta-root').getAttribute('aria-hidden'),'true');
    assert.equal(await page.evaluate(()=>window.__ttaTest.state.view),'settings');
    await page.locator('#tta-fab').click();
    await page.evaluate(async()=>{const a=window.__ttaTest;a.setBusy(true,'Syncing','Fixture',true);await a.navigate('diagnostics');});
    assert.equal(await page.locator('#tta-loading').isVisible(),true);assert.equal(await page.locator('#tta-root').getAttribute('aria-busy'),'true');
    await page.evaluate(()=>window.__ttaTest.setBusy(false));assert.equal(await page.locator('#tta-root').getAttribute('aria-busy'),'false');
    assert.deepEqual(errors,[]);console.log('Real-browser quota recovery, reload, cancellation, recovery-write failure, cross-tab readable history/live refresh, locking, spinner visibility, rapid navigation, close and independent sync loading verified.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
