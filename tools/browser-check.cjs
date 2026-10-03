const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {hostilePageStyles,assertReadable}=require('./contrast-check.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
  const errors=[];fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  try{
  for(const width of [360,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://api.torn.com/**',route=>route.abort());
    await page.goto('file:///'+path.join(root,'.preview/index.html').replaceAll('\\','/'));
    await page.addStyleTag({content:hostilePageStyles});
    await page.locator('#tta-fab').click();
    const settled=()=>page.waitForFunction(()=>document.getElementById('tta-root')?.getAttribute('aria-busy')==='false'&&document.querySelector('.tta-shell'));
    await settled();
    await page.evaluate(()=>{
      window.transitionStarts=0;const root=document.getElementById('tta-root');
      new MutationObserver(()=>{if(root.getAttribute('aria-busy')==='true'&&!document.getElementById('tta-transition')?.hidden)window.transitionStarts++;}).observe(root,{attributes:true,attributeFilter:['aria-busy']});
    });
    const theme=await page.locator('#tta-root').evaluate(el=>({background:getComputedStyle(el).getPropertyValue('--tta-bg').trim(),hostBackground:getComputedStyle(document.documentElement).getPropertyValue('--tta-bg').trim()}));
    assert.equal(theme.background,'#1b2a34','Classic theme palette should be preserved');
    assert.equal(theme.hostBackground,'','Analyzer theme must not leak into the host page');
    for(const action of ['dashboard','trade','ledger','cashflow','networth','insights','settings','help','diagnostics']){
      const selector=action==='dashboard'?'[data-act="dashboard"]':`[data-act="${action}"]`;
      const button=page.locator(selector).first();
      if(action==='diagnostics'){await page.locator('[data-act="settings"]').first().click();await settled();}
      await button.click();
      await settled();
      await assertReadable(page,`${width}px ${action}`);
      await page.screenshot({path:path.join(root,'test-results',`${width}-${action}.png`),fullPage:false});
      if(action==='cashflow')await page.locator('.tta-flowtable').screenshot({path:path.join(root,'test-results',`${width}-cashflow-events.png`)});
      const overflow=await page.locator('.tta-shell').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,`${width}px ${action} overflows`);
      const clippedNavigation=await page.locator('.tta-workspaces button').evaluateAll(buttons=>buttons.some(el=>el.scrollWidth>el.clientWidth+1));assert.equal(clippedNavigation,false,`${width}px navigation labels overlap`);
    }
    assert.ok(await page.evaluate(()=>window.transitionStarts)>=9,'Every workspace transition should paint loading status');
    await page.locator('[data-act="trade"]').first().click();
    await settled();
    assert.equal(await page.locator('.tta-item').first().evaluate(el=>getComputedStyle(el).borderRadius),'14px','Classic item card corners should be preserved');
    const chartDrawn=await page.locator('.tta-profitbar').evaluateAll(bars=>bars.some(bar=>bar.getBoundingClientRect().height>0));assert.equal(chartDrawn,true,'Profit chart is blank');
    await page.locator('[data-tab="sales"]').click();await settled();assert.equal(await page.locator('.tta-flowtable tbody tr').count(),2);
    await assertReadable(page,`${width}px latest sales`);
    assert.equal(await page.locator('.tta-chartcard').count(),0,'Acquisition chart should not crowd latest sales');
    assert.equal(await page.locator('.tta-summary').innerText().then(text=>text.includes('sale date')),true);
    await page.screenshot({path:path.join(root,'test-results',`${width}-sales.png`)});
    await page.locator('#tta-sales-search').fill('Xanax');await page.waitForTimeout(300);await page.locator('#tta-sales-search').press('End');assert.equal(await page.locator('#tta-sales-search').evaluate(el=>document.activeElement===el),true);
    await page.locator('#tta-sales-source').selectOption('Torn Shop');await settled();assert.equal(await page.locator('.tta-flowtable tbody tr').count(),1);
    await page.locator('[data-tab="items"]').click();await settled();await page.locator('[data-act="toggleItem"]').first().press('Enter');await settled();assert.equal(await page.locator('.tta-item.expanded').count(),1);
    await assertReadable(page,`${width}px expanded item`);
    await page.locator('#tta-sort-select').selectOption('name');assert.equal(await page.locator('#tta-sort-select').inputValue(),'name');
    await page.close();
  }
  }finally{await browser.close();}
  assert.deepEqual(errors,[]);console.log('All views, contrast under conflicting host styles, latest-sales filters, keyboard expansion, focus and overflow verified at 360, 390, 768 and 1440px.');
})().catch(error=>{console.error(error);process.exitCode=1;});
