const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'torn-trade-analyzer.user.js'),'utf8').replace(/\n\}\)\(\);\s*$/,'\nwindow.__ttaTest={state,diagnosticReport};\n})();');
const now=Math.floor(Date.now()/1000),requests=[],errors=[];
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
  try{
    const context=await browser.newContext({viewport:{width:390,height:900}});
    await context.route('http://localhost:8123/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body></body></html>'}));
    await context.route('https://api.torn.com/**',route=>{
      const url=new URL(route.request().url()),endpoint=url.pathname.replace('/v2','');requests.push(url);
      const fixtures={
        '/user/timestamp':{timestamp:now},
        '/key/info':{info:{access:{level:4},user:{id:1},selections:{user:['log']}}},
        '/torn/items':{items:[{id:206,name:'Xanax',type:'Drug',value:{market_price:150}}]},
        '/torn/logtypes':{logtypes:[{id:4210,title:'Item shop sell'}]},
        '/user/trades':{trades:[],_metadata:{links:{next:null}}},
        '/user/networth':{networth:{total:5000,timestamp:now}},
        '/user/money':{money:{wallet:100}},
        '/company/profile':{profile:null}
      };
      let result=fixtures[endpoint];
      if(endpoint==='/user/log'){
        const count=url.searchParams.get('log')?.split(',').includes('4210')?(Number(url.searchParams.get('to'))>now-30?4:1):0;
        const log=Array.from({length:count},(_,i)=>({id:'sale-'+i,timestamp:now-30,details:{id:4210,title:'Item shop sell'},data:{item:206,quantity:1,cost_total:20},params:{}}));
        result={log,_metadata:{nanostamp:0,links:{next:`https://api.torn.com/v2/user/log?from=${url.searchParams.get('from')}&to=${url.searchParams.get('to')}&nanostamp=0`}}};
      }
      assert.ok(result,'Unexpected API endpoint: '+endpoint);
      return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.goto('http://localhost:8123/');await page.addScriptTag({content:script});await page.locator('#tta-fab').click();
    await page.evaluate(()=>{window.__ttaTest.state.apiKey='fixture0123456789';window.__ttaTest.state.demo=false;});
    await page.locator('[data-act="syncFull"]').first().click();
    await page.waitForFunction(expected=>window.__ttaTest.state.sync.lastSync===expected&&!window.__ttaTest.state.syncing,now,{timeout:90000});
    const result=await page.evaluate(()=>({report:window.__ttaTest.diagnosticReport(),count:window.__ttaTest.state.transactions.length,busy:document.getElementById('tta-root').getAttribute('aria-busy'),recovery:localStorage.getItem('tta:v1:fullResyncBackup')}));
    assert.equal(result.count,4);assert.equal(result.report.historyComplete,true);assert.equal(result.report.pendingSync,null);assert.equal(result.recovery,null);assert.equal(result.busy,'false');
    assert.equal(result.report.notices.some(n=>n.severity==='error'),false);assert.ok(result.report.counts.boundaryRecoveries>0);
    assert.equal(requests.filter(u=>u.pathname==='/v2/user/log').every(u=>u.searchParams.get('nanostamp')!=='0'),true);
    assert.deepEqual(errors,[]);
    console.log('Generated userscript Full Resync button completes the four-row zero-cursor fixture, retains all sales, clears loading/recovery, and never sends nanostamp=0.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
