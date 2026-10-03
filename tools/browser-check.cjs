const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
  const errors=[];fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  for(const width of [360,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://api.torn.com/**',route=>route.abort());
    await page.goto('file:///'+path.join(root,'.preview/index.html').replaceAll('\\','/'));
    await page.locator('#tta-fab').click();
    for(const action of ['dashboard','trade','ledger','cashflow','networth','insights','settings','help','diagnostics']){
      const selector=action==='dashboard'?'[data-act="dashboard"]':`[data-act="${action}"]`;
      const button=page.locator(selector).first();
      if(action==='diagnostics')await page.locator('[data-act="settings"]').first().click();
      await button.click();
      await page.screenshot({path:path.join(root,'test-results',`${width}-${action}.png`),fullPage:false});
      const overflow=await page.locator('.tta-shell').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,`${width}px ${action} overflows`);
      const clippedNavigation=await page.locator('.tta-workspaces button').evaluateAll(buttons=>buttons.some(el=>el.scrollWidth>el.clientWidth+1));assert.equal(clippedNavigation,false,`${width}px navigation labels overlap`);
    }
    await page.locator('[data-act="trade"]').first().click();await page.locator('[data-tab="sales"]').click();assert.equal(await page.locator('.tta-flowtable tbody tr').count(),2);
    const chartDrawn=await page.locator('.tta-profitbar').evaluateAll(bars=>bars.some(bar=>bar.getBoundingClientRect().height>0));assert.equal(chartDrawn,true,'Profit chart is blank');
    await page.screenshot({path:path.join(root,'test-results',`${width}-sales.png`)});
    await page.locator('#tta-sales-search').fill('Xanax');await page.waitForTimeout(300);await page.locator('#tta-sales-search').press('End');assert.equal(await page.locator('#tta-sales-search').evaluate(el=>document.activeElement===el),true);
    await page.locator('#tta-sales-source').selectOption('Torn Shop');assert.equal(await page.locator('.tta-flowtable tbody tr').count(),1);
    await page.locator('[data-tab="items"]').click();await page.locator('[data-act="toggleItem"]').first().press('Enter');assert.equal(await page.locator('.tta-item.expanded').count(),1);
    await page.locator('#tta-sort-select').selectOption('name');assert.equal(await page.locator('#tta-sort-select').inputValue(),'name');
    await page.close();
  }
  await browser.close();assert.deepEqual(errors,[]);console.log('All views, latest-sales filters, keyboard expansion, focus and overflow verified at 360, 390, 768 and 1440px.');
})().catch(error=>{console.error(error);process.exitCode=1;});
