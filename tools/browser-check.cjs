const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {hostilePageStyles,assertReadable}=require('./contrast-check.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
async function assertTablesFit(page,label,{stress=false}={}){
  if(stress)await page.locator('#tta-root tbody td:not([colspan])').evaluateAll(cells=>cells.forEach(cell=>{cell.textContent='VeryLongUnbrokenTransactionSourceOrItemName'.repeat(6)+' $9,999,999,999,999,999.99';}));
  const problems=await page.locator('#tta-root table').evaluateAll(tables=>tables.flatMap(table=>{
    const issues=[],wrap=table.parentElement,box=wrap.getBoundingClientRect(),rect=table.getBoundingClientRect();
    if(wrap.scrollWidth>wrap.clientWidth+1||rect.right>box.right+1||rect.left<box.left-1)issues.push('Table exceeds its wrapper');
    for(const cell of table.querySelectorAll('tbody td')){
      const b=cell.getBoundingClientRect();if(b.left<box.left-1||b.right>box.right+1||cell.scrollWidth>cell.clientWidth+1)issues.push('Cell overflows or clips data');
      if(!cell.hasAttribute('colspan')&&(!cell.dataset.label||cell.getAttribute('role')!=='cell'))issues.push('Cell is missing its responsive label/semantics');
    }
    if(table.getAttribute('role')!=='table'||!table.getAttribute('aria-label'))issues.push('Table semantics missing');
    return issues;
  }));assert.deepEqual(problems,[],label);
}
async function assertCompactTableLayout(page,selector,label){
  const row=page.locator(`${selector} tbody tr`).first();
  if(!await row.count())return;
  const shape=await row.evaluate(el=>({
    row:getComputedStyle(el).display,
    visible:Array.from(el.children).filter(cell=>getComputedStyle(cell).display!=='none').map(cell=>getComputedStyle(cell).display)
  }));
  assert.equal(shape.row,'table-row',`${label} rows must stay table rows, not cards/grids`);
  assert.ok(shape.visible.length>0,`${label} must keep visible table cells`);
  assert.equal(shape.visible.every(display=>display==='table-cell'),true,`${label} visible cells must stay table cells`);
}

(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
  const errors=[];fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  try{
  for(const width of [320,360,390,768,1024,1440]){
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
      if(action==='diagnostics')assert.equal(await page.getByText('PARSER_UPDATED',{exact:true}).count(),0,'UI-only releases must retain verified accounting history');
      await assertReadable(page,`${width}px ${action}`);
      await assertTablesFit(page,`${width}px ${action}`);
      if(action==='ledger'){
        assert.equal(await page.locator('[data-act="ledgerSort"]').count(),9);
        await page.locator('[data-act="ledgerSort"][data-key="qty"]').press('Enter');await settled();
        assert.equal(await page.locator('[data-act="ledgerSort"][data-key="qty"]').evaluate(el=>el.classList.contains('active')),true);
        await assertTablesFit(page,`${width}px sorted ledger`);
        await assertCompactTableLayout(page,'.tta-ledgertable',`${width}px acquisition ledger`);
      }
      await page.screenshot({path:path.join(root,'test-results',`${width}-${action}.png`),fullPage:false});
      if(action==='cashflow'){await assertCompactTableLayout(page,'.tta-cashflow-table',`${width}px cash flow`);await page.locator('.tta-flowtable').screenshot({path:path.join(root,'test-results',`${width}-cashflow-events.png`)});}
      const overflow=await page.locator('.tta-shell').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,`${width}px ${action} overflows`);
      const clippedNavigation=await page.locator('.tta-workspaces button').evaluateAll(buttons=>buttons.some(el=>el.scrollWidth>el.clientWidth+1));assert.equal(clippedNavigation,false,`${width}px navigation labels overlap`);
      await assertTablesFit(page,`${width}px ${action} long values`,{stress:true});
      if(action==='ledger'){
        await page.locator('#tta-ledger-search').fill('no-fixture-item-matches');await page.waitForTimeout(300);await settled();
        assert.equal(await page.locator('#tta-ledger-body td[colspan="9"]').count(),1);await assertTablesFit(page,`${width}px empty ledger`);
        await page.locator('#tta-ledger-search').fill('');await page.waitForTimeout(300);await settled();
      }
    }
    assert.ok(await page.evaluate(()=>window.transitionStarts)>=9,'Every workspace transition should paint loading status');
    await page.locator('[data-act="trade"]').first().click();
    await settled();
    assert.equal(await page.locator('.tta-item').first().evaluate(el=>getComputedStyle(el).borderRadius),'14px','Classic item card corners should be preserved');
    const chartDrawn=await page.locator('.tta-profitbar').evaluateAll(bars=>bars.some(bar=>bar.getBoundingClientRect().height>0));assert.equal(chartDrawn,true,'Profit chart is blank');
    await page.locator('[data-tab="sales"]').click();await settled();assert.equal(await page.locator('.tta-flowtable tbody tr').count(),2);
    await assertReadable(page,`${width}px latest sales`);
    await assertTablesFit(page,`${width}px latest sales`);
    await assertCompactTableLayout(page,'.tta-sales-table',`${width}px latest sales`);
    assert.equal(await page.locator('.tta-chartcard').count(),0,'Acquisition chart should not crowd latest sales');
    assert.equal(await page.locator('.tta-summary').innerText().then(text=>text.includes('sale date')),true);
    await page.screenshot({path:path.join(root,'test-results',`${width}-sales.png`)});
    await assertTablesFit(page,`${width}px latest sales long values`,{stress:true});
    await page.locator('#tta-sales-search').fill('Xanax');await page.waitForTimeout(300);await page.locator('#tta-sales-search').press('End');assert.equal(await page.locator('#tta-sales-search').evaluate(el=>document.activeElement===el),true);
    await page.locator('#tta-sales-source').selectOption('Torn Shop');await settled();assert.equal(await page.locator('.tta-flowtable tbody tr').count(),1);
    await page.locator('[data-tab="items"]').click();await settled();await page.locator('[data-act="toggleItem"]').first().press('Enter');await settled();assert.equal(await page.locator('.tta-item.expanded').count(),1);
    await assertReadable(page,`${width}px expanded item`);
    await page.locator('#tta-sort-select').selectOption('name');assert.equal(await page.locator('#tta-sort-select').inputValue(),'name');
    await page.close();
  }
  }finally{await browser.close();}
  assert.deepEqual(errors,[]);console.log('All views, contrast, compact responsive table semantics (including extreme text/amounts and empty states), ledger sorting, sales filters, keyboard expansion and focus verified at 320, 360, 390, 768, 1024 and 1440px.');
})().catch(error=>{console.error(error);process.exitCode=1;});
