  function loadingHtml() {
    const b=state.busy||{};
    return `<div id="tta-loading" class="tta-loading ${b.active?'show':''}" role="status" aria-live="polite" aria-hidden="${b.active?'false':'true'}"><div class="tta-loadingcard"><div class="tta-loadicon"><span class="tta-spinner xl"></span></div><div id="tta-loading-title" class="tta-loadingtitle">${esc(b.title||'Working\u2026')}</div><div id="tta-loading-detail" class="tta-loadingdetail">${esc(b.detail||'Preparing your data\u2026')}</div><div class="tta-loadingbar"><span></span></div><div class="tta-loadingactions"><button id="tta-loading-minimize" class="tta-btn secondary" data-act="minimizeSync" ${state.syncing?'':'hidden'}>\u2014 Minimize</button><button id="tta-loading-stop" class="tta-btn danger" data-act="cancelSync" ${b.cancellable?'':'hidden'}>Stop sync</button></div><div class="tta-loadinghint">Minimize to keep using Torn while the sync continues. You can reopen progress from the floating button at any time.</div></div></div>`;
  }
  let transitionSequence=0,transitionTitle='';
  function transitionHtml() {
    return `<div id="tta-transition" class="tta-transition" role="status" aria-live="polite" ${transitionTitle?'':'hidden'}><span class="tta-spinner"></span><span>${esc(transitionTitle)}</span></div>`;
  }
  function updateTransitionDom() {
    const el=document.getElementById('tta-transition');
    if(el){el.hidden=!transitionTitle;el.innerHTML=`<span class="tta-spinner"></span><span>${esc(transitionTitle)}</span>`;}
    const root=document.getElementById('tta-root');if(root){
      root.setAttribute('aria-busy',state.busy?.active||transitionTitle?'true':'false');
      if(transitionTitle){const top=root.getBoundingClientRect().top,header=root.querySelector('.tta-header'),nav=root.querySelector('.tta-workspaces');root.style.setProperty('--tta-transition-top',Math.max(0,(header?.getBoundingClientRect().bottom||top)-top,(nav?.getBoundingClientRect().bottom||top)-top)+'px');}
    }
  }
  async function withTransition(title,fn) {
    const token=++transitionSequence;transitionTitle=title;updateTransitionDom();
    await nextPaint();
    try{if(token===transitionSequence&&state.open)await fn();}
    catch(error){diagnosticFromError(error,'transition');render();toast('This view could not be updated. See Data Quality.');}
    finally{if(token===transitionSequence){transitionTitle='';updateTransitionDom();}}
  }
  function navigate(view,options={}) {
    for(const key of ['searchTimer','ledgerSearchTimer','legacySearchTimer'])clearTimeout(perfCache[key]);
    return withTransition('Opening '+({cash:'Cash Flow',trade:'Trade Analysis',networth:'Net Worth',ledger:'Acquisition Ledger',diagnostics:'Data Quality',dashboard:'Dashboard',settings:'Settings',help:'Help',updates:"What's New",insights:'Insights'}[view]||'view'),()=>{
      state.view=view;if(view==='ledger')state.ledgerLimit=200;state.search='';render({preserveScroll:false,...options});
    });
  }
  function cancelTransition(){transitionSequence++;transitionTitle='';updateTransitionDom();}

  function updateBusyDom() {
    const root=document.getElementById('tta-root'),el=document.getElementById('tta-loading'),b=state.busy||{};
    if(root)root.setAttribute('aria-busy',b.active||transitionTitle?'true':'false');if(!el)return;
    el.classList.toggle('show',!!b.active);el.setAttribute('aria-hidden',b.active?'false':'true');
    const title=document.getElementById('tta-loading-title'),detail=document.getElementById('tta-loading-detail'),stop=document.getElementById('tta-loading-stop'),minimize=document.getElementById('tta-loading-minimize');
    if(title)title.textContent=b.title||'Working\u2026';if(detail)detail.textContent=b.detail||'Preparing your data\u2026';if(stop)stop.hidden=!b.cancellable;if(minimize)minimize.hidden=!state.syncing;
  }

  function setBusy(active,title='',detail='',cancellable=false) {
    state.busy={active:!!active,title,detail,cancellable:!!cancellable};updateBusyDom();
  }
  function setBusyDetail(detail) {if(state.backgroundSyncing)return;state.busy={...(state.busy||{}),detail};updateBusyDom();}
  function nextPaint(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
  async function withBusy(title,detail,fn,{cancellable=false}={}) {setBusy(true,title,detail,cancellable);await nextPaint();try{return await fn();}finally{setBusy(false);}}

  function setSyncProgress(msg) {
    const value=String(msg||'');
    if(state.backgroundSyncing){state.backgroundSyncProgress=value;return;}
    state.syncProgress=value;
    const text=document.getElementById('tta-sync-progress-text');if(text)text.textContent=state.syncProgress;
    if(state.syncing)setBusyDetail(state.syncProgress);
  }

  async function openAnalyzer() {
    state.open=true;
    const fab=document.getElementById('tta-fab');if(fab)fab.style.display='none';
    const root=document.getElementById('tta-root');if(!root)return;
    root.classList.add('show');root.setAttribute('aria-hidden','false');
    if(root.querySelector('.tta-shell')&&root.dataset.view===state.view&&!state.renderPending)return;
    root.innerHTML='<div class="tta-openloader"><div><span class="tta-spinner xl"></span><strong>Opening Cash Flow Analyzer</strong><small>Preparing cached financial history and analytics\u2026</small></div></div>';
    await nextPaint();render({preserveScroll:false});
  }

  function render(options={}) {
    const root=document.getElementById('tta-root');if(!root)return;
    const previousView=root.dataset.view||'',previousShell=root.querySelector('.tta-shell');
    const preserveScroll=options.preserveScroll??(previousView===state.view),previousScroll=preserveScroll&&previousShell?previousShell.scrollTop:0;
    const focus=document.activeElement,focusId=root.contains(focus)?focus.id:'',selection=focusId&&'selectionStart'in focus?[focus.selectionStart,focus.selectionEnd]:null;
    updateFabState();
    if(!state.open){root.classList.remove('show');root.setAttribute('aria-hidden','true');return;}
    root.classList.add('show');root.setAttribute('aria-hidden','false');
    const wasDemo=state.demo;state.demo=!hasApiKey()&&![state.transactions,state.cashFlows,state.playerTrades,state.financialSnapshots,state.tracked].some(rows=>rows.length);if(wasDemo!==state.demo)resetAnalyticsCache();
    if(state.demo&&!state.catalog.length)state.catalog=demoCatalog();
    const html=state.view==='diagnostics'?diagnosticsHtml():state.view==='add'?addItemHtml():state.view==='settings'?settingsHtml():state.view==='help'?helpHtml():state.view==='updates'?updatesHtml():state.view==='ledger'?ledgerHtml():state.view==='cash'?cashFlowHtml():state.view==='insights'?insightsHtml():state.view==='networth'?netWorthHtml():state.view==='trade'?tradeHtml():dashboardHtml();
    const content=html.replace(/(<div class="tta-content[^"]*">)/,`$1${state.view==='diagnostics'?'':qualityHtml()}`);
    root.innerHTML=`<div class="tta-shell">${content}</div>${loadingHtml()}${transitionHtml()}<div id="tta-toast" role="status" class="tta-toast ${state.toast?'show':''}">${esc(state.toast||'')}</div>`;
    state.renderPending=false;
    root.dataset.view=state.view;root.setAttribute('aria-busy',state.busy?.active||transitionTitle?'true':'false');bind();
    if(preserveScroll){const shell=root.querySelector('.tta-shell');if(shell)shell.scrollTop=previousScroll;}positionDailyChartsToLatest(root);const activeWorkspace=root.querySelector('.tta-workspaces [aria-current="page"]');if(activeWorkspace)requestAnimationFrame(()=>activeWorkspace.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'}));
    if(focusId&&previousView===state.view){const next=document.getElementById(focusId);if(next){next.focus({preventScroll:true});if(selection&&next.setSelectionRange&&next.type!=='date')next.setSelectionRange(...selection);}}
    if(transitionTitle)updateTransitionDom();
  }

  function queueAnalyticsRender() {
    state.renderPending=true;
    if(!state.open)return;
    const root=document.getElementById('tta-root');
    if(root?.contains(document.activeElement)&&/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))return;
    render({preserveScroll:true});
  }

  let toastTimer=null;
  function toast(msg) {
    state.toast=redactText(msg);const el=document.getElementById('tta-toast');
    if(el){el.textContent=state.toast;el.classList.add('show');}
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>{if(state.toast===msg){state.toast='';const n=document.getElementById('tta-toast');if(n)n.classList.remove('show');}},2400);
  }

  function bindPortalMouseDrag(root) {
    let drag=null;
    root.addEventListener('pointerdown',e=>{
      const portal=e.target?.closest?.('.tta-fin-nav.portal');
      if(!portal||!root.contains(portal)||e.pointerType!=='mouse'||e.button!==0)return;
      portal.dataset.suppressClick='0';
      drag={portal,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,startScrollLeft:portal.scrollLeft,moved:false,captured:false};
    });
    root.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
      if(!drag.moved){
        if(Math.hypot(dx,dy)<7)return;
        if(Math.abs(dx)<=Math.abs(dy)){drag=null;return;}
        drag.moved=true;
        drag.portal.classList.add('dragging');
        try{drag.portal.setPointerCapture(e.pointerId);drag.captured=true;}catch(_){ }
      }
      e.preventDefault();
      drag.portal.scrollLeft=drag.startScrollLeft-dx;
    });
    const finish=e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const portal=drag.portal,moved=drag.moved,captured=drag.captured;
      if(captured){try{portal.releasePointerCapture(e.pointerId);}catch(_){ }}
      portal.classList.remove('dragging');
      if(moved){portal.dataset.suppressClick='1';requestAnimationFrame(()=>setTimeout(()=>{if(portal?.isConnected)portal.dataset.suppressClick='0';},80));}
      drag=null;
    };
    root.addEventListener('pointerup',finish);
    root.addEventListener('pointercancel',finish);
    root.addEventListener('pointerleave',e=>{if(drag&&!drag.moved&&e.pointerId===drag.pointerId)drag=null;});
  }

  function bind() {
    const root=document.getElementById('tta-root');if(!root||root.dataset.delegated==='1')return;root.dataset.delegated='1';
    bindPortalMouseDrag(root);
    root.addEventListener('click',async e=>{
      try {
      const portal=e.target?.closest?.('.tta-fin-nav.portal');
      if(portal&&portal.dataset.suppressClick==='1'){e.preventDefault();e.stopPropagation();return;}
      const dateEl=e.target.closest('[data-date]');
      if(dateEl&&root.contains(dateEl)){state.dateMode=dateEl.dataset.date;save('dateMode',state.dateMode);state.expanded=null;await withTransition('Updating period',()=>render());return;}
      const granEl=e.target.closest('[data-gran]');
      if(granEl&&root.contains(granEl)){state.granularity=granEl.dataset.gran;save('granularity',state.granularity);await withTransition('Updating chart',()=>render());return;}
      const el=e.target.closest('[data-act]');if(!el||!root.contains(el))return;e.stopPropagation();const act=el.dataset.act;
      if(['resetData','importBackup','saveApiKey','clearApiKey'].includes(act)&&(state.syncing||state.backgroundSyncing)){toast('Stop the current sync before changing history or API keys.');return;}
      if(act==='close'){cancelTransition();state.open=false;if(!state.syncing)setBusy(false);render();}
      else if(act==='minimizeSync'){cancelTransition();state.open=false;render();}
      else if(act==='back'){await navigate(state.view==='ledger'?'trade':state.view==='updates'?'settings':'dashboard');}
      else if(['dashboard','diagnostics','settings','help','updates','insights','trade','networth'].includes(act)){await navigate(act);}
      else if(act==='exportDiagnostics'){downloadTextFile('torn-data-quality.json',JSON.stringify(diagnosticReport(),null,2),'application/json');}
      else if(act==='clearDiagnostics'){state.notices=[];save('notices',[]);render();}
      else if(act==='tradeTab'){await withTransition('Updating Trade Analysis',()=>{state.tradeTab=el.dataset.tab;render();});}
      else if(act==='salesMore'){state.salesLimit=(state.salesLimit||100)+100;await withTransition('Loading sales',()=>render());}
      else if(act==='cashMore'){state.cashLimit=(state.cashLimit||200)+200;await withTransition('Loading cash activity',()=>render());}
      else if(act==='cashflow'){await navigate('cash');}
      else if(act==='netWorthToday'){state.netWorthDate=tctInputDate(nowSec());save('netWorthDate',state.netWorthDate);await withTransition('Updating Net Worth',()=>render({preserveScroll:true}));}
      else if(act==='refreshFinancial'){const snap=await withBusy('Refreshing finances','Loading current Torn money and net-worth snapshots\u2026',async()=>refreshFinancialSnapshot());render();toast(snap?'Financial snapshot updated. See Data Quality for any missing fields.':'Snapshot unavailable. See Data Quality.');}
      else if(act==='addGoal'){const type=String(document.getElementById('tta-goal-type')?.value||'networth'),target=Number(document.getElementById('tta-goal-target')?.value)||0,label=String(document.getElementById('tta-goal-label')?.value||'').trim();if(!(target>0)){toast('Enter a goal target greater than zero.');return;}state.goals=[...(state.goals||[]),{id:`g${Date.now().toString(36)}`,type,target,label,createdAt:nowSec()}];save('goals',state.goals);render();toast('Financial goal added.');}
      else if(act==='removeGoal'){state.goals=(state.goals||[]).filter(g=>String(g.id)!==String(el.dataset.id));save('goals',state.goals);render();}
      else if(act==='exportBackup'){exportBackup();toast('JSON backup exported.');}
      else if(act==='importBackup'){importBackup();}
      else if(act==='exportCashCsv'){exportCashCsv();toast('Cash Flow CSV exported.');}
      else if(act==='exportNetWorthCsv'){exportNetWorthCsv();toast('Net Worth CSV exported.');}
      else if(act==='ledger'){await navigate('ledger');}
      else if(act==='ledgerSort'){
        const key=String(el.dataset.key||'acquiredAt');if(state.ledgerSort===key)state.ledgerSortDir=state.ledgerSortDir==='asc'?'desc':'asc';else{state.ledgerSort=key;state.ledgerSortDir=(key==='item'||key==='method'||key==='status')?'asc':'desc';}
        save('ledgerSort',state.ledgerSort);save('ledgerSortDir',state.ledgerSortDir);state.ledgerLimit=200;await withTransition('Sorting ledger',()=>renderLedgerRows());
      }
      else if(act==='clearLedgerSearch'){state.ledgerSearch='';save('ledgerSearch','');state.ledgerLimit=200;const input=document.getElementById('tta-ledger-search');if(input){input.value='';input.focus();}await withTransition('Filtering ledger',()=>renderLedgerRows());}
      else if(act==='ledgerMore'){state.ledgerLimit=(Number(state.ledgerLimit)||200)+200;await withTransition('Loading ledger rows',()=>renderLedgerRows());}
      else if(act==='addItem'){state.view='add';await withBusy('Loading catalog','Preparing the Torn item catalog\u2026',async()=>{await ensureCatalog();render();});setTimeout(()=>document.getElementById('tta-search')?.focus(),30);}
      else if(act==='toggleItem'){state.expanded=Number(state.expanded)===Number(el.dataset.id)?null:Number(el.dataset.id);await withTransition('Loading item history',()=>renderItemList());}
      else if(act==='togglePin'){
        const id=Number(el.dataset.id),pins=new Set((state.pinnedIds||[]).map(Number));if(pins.has(id))pins.delete(id);else pins.add(id);state.pinnedIds=[...pins];save('pinnedIds',state.pinnedIds);await withTransition('Updating items',()=>renderItemList());
      }
      else if(act==='hideItem'){
        const id=Number(el.dataset.id),hidden=new Set((state.hiddenIds||[]).map(Number));hidden.add(id);state.hiddenIds=[...hidden];save('hiddenIds',state.hiddenIds);if(Number(state.expanded)===id)state.expanded=null;renderItemList();toast(`${catalogItem(id).name} hidden. Restore it from Settings.`);
      }
      else if(act==='restoreItem'){
        const id=Number(el.dataset.id);state.hiddenIds=(state.hiddenIds||[]).map(Number).filter(x=>x!==id);save('hiddenIds',state.hiddenIds);render();toast(`${catalogItem(id).name} restored.`);
      }
      else if(act==='restoreAllItems'){
        state.hiddenIds=[];save('hiddenIds',[]);render();toast('All hidden items restored.');
      }
      else if(act==='cycleSort'){const i=Math.max(0,SORT_OPTIONS.findIndex(x=>x.id===state.sortMode));state.sortMode=SORT_OPTIONS[(i+1)%SORT_OPTIONS.length].id;save('sortMode',state.sortMode);await withTransition('Sorting items',()=>renderItemList());}
      else if(act==='clearItemSearch'){state.itemSearch='';save('itemSearch','');const input=document.getElementById('tta-history-search');if(input){input.value='';input.focus();}await withTransition('Filtering items',()=>renderItemList());}
      else if(act==='confirmAdd'){await withTransition('Opening Trade Analysis',()=>addTracked(Number(el.dataset.id)));}
      else if(act==='removeItem'){removeTracked(Number(el.dataset.id));}
      else if(act==='sync'||act==='syncQuick'){await syncAll({mode:'quick'});}
      else if(act==='syncFull'){if(confirm('Full Resync rebuilds all available history. Your previous history can be restored if you stop the rebuild. Continue?'))await syncAll({mode:'full'});}
      else if(act==='cancelSync'){state.syncCancel=true;setSyncProgress('Stopping after the current API request\u2026');}
      else if(act==='createApiKey'){
        state.open=false;window.location.href=ANALYZER_CUSTOM_KEY_URL;return;
      }
      else if(act==='saveApiKey'){
        const input=document.getElementById('tta-api-key');let key=String(input?.value||'').trim();if(input?.dataset.placeholderKey==='1'&&/^\u2022+$/.test(key))key=String(state.apiKey||'').trim();
        if(key.length<16){toast('Enter a valid Torn API key first.');return;}state.apiKey=key;save('apiKey',key);state.demo=false;render();
        try{
          let info=null;await withBusy('Checking API key','Verifying access and refreshing the item catalog\u2026',async()=>{info=await inspectActiveKey();if(state.sync.accountId&&Number(state.sync.accountId)!==info.userId)throw new AnalyzerError('ACCOUNT_MISMATCH','This key belongs to a different account. Export and reset history before switching accounts.');await apiGet('/user/log',{limit:1});await ensureCatalog(true);});
          toast(`API key confirmed (${info?.type||'access level '+(info?.level||'?')}).`);await navigate('dashboard');await syncAll();
        }catch(err){if([1,2,13].includes(err.context?.apiCode)||err.code==='ACCOUNT_MISMATCH'){state.apiKey='';save('apiKey','');}diagnosticFromError(err,'key test');setBusy(false);render();toast(`API key test failed: ${err.message}`);}
      }
      else if(act==='clearApiKey'){state.apiKey='';save('apiKey','');state.demo=!hasApiKey();resetAnalyticsCache();render();toast(injectedApiKey()?'Saved key cleared. Torn PDA key will be used.':'Saved API key cleared.');}
      else if(act==='refreshCatalog'){
        const updated=await withBusy('Refreshing catalog','Downloading the latest Torn item catalog and market values\u2026',async()=>ensureCatalog(true));render();toast(updated?`Catalog refreshed: ${qty(state.catalog.length)} items.`:'Catalog refresh failed. Cached values retained.');
      }
      else if(act==='resetData'&&confirm('Reset all Torn Cash Flow Analyzer financial history, trade history and local snapshots?')){
        await clearFullResyncBackup();
        await clearStoredKeys(['tracked','transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial','goals','financialSnapshots','sync','syncJob','syncCache','fullResyncBackup','catalog','catalogVersion','catalogUpdatedAt','logTypes','logTypesUpdatedAt','pinnedIds','hiddenIds','itemSearch','sortMode','ledgerSearch','ledgerSource','ledgerStatus','ledgerRange','ledgerSort','ledgerSortDir']);state.tracked=[];state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.playerTrades=[];state.itemConsumptions=[];state.unrecognizedFinancial=[];state.goals=[];state.financialSnapshots=[];state.pinnedIds=[];state.hiddenIds=[];state.itemSearch='';state.sortMode='recent';state.ledgerSearch='';state.ledgerSource='all';state.ledgerStatus='all';state.ledgerRange='all';state.ledgerSort='acquiredAt';state.ledgerSortDir='desc';state.ledgerLimit=200;state.sync={lastSync:0,firstSyncComplete:false};state.logTypesUpdatedAt=0;state.expanded=null;syncCacheMem=null;resetAnalyticsCache();announceCrossTabUpdate('reset');render();toast('Analyzer data reset.');
      }
      }catch(error){diagnosticFromError(error);setBusy(false);render();toast('Action failed. See Data Quality for details.');}
    });

    root.addEventListener('pointerover',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))showChartTooltip(bar,false);const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))showCashFlowTooltip(point,false);});
    root.addEventListener('pointerout',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))hideChartTooltip(bar.closest('.tta-chartinteractive'));const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))hideCashFlowTooltip(point.closest('.tta-cash-chart'));});
    root.addEventListener('focusin',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))showChartTooltip(bar,false);const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))showCashFlowTooltip(point,false);});
    root.addEventListener('focusout',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))hideChartTooltip(bar.closest('.tta-chartinteractive'));const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))hideCashFlowTooltip(point.closest('.tta-cash-chart'));});
    root.addEventListener('focusout',()=>{if(state.renderPending)setTimeout(()=>queueAnalyticsRender(),0);});
    root.addEventListener('keydown',e=>{if(e.key==='Escape'){cancelTransition();state.open=false;render();document.getElementById('tta-fab')?.focus();}if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role="button"]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
    root.addEventListener('click',e=>{
      const bar=e.target?.closest?.('.tta-profitbar');
      if(bar&&root.contains(bar)){e.stopPropagation();const wrap=bar.closest('.tta-chartinteractive'),tip=wrap?.querySelector('.tta-charttooltip'),same=bar.classList.contains('active')&&tip?.dataset.pinned==='1';if(same)hideChartTooltip(wrap,true);else showChartTooltip(bar,true);return;}
      const point=e.target?.closest?.('.tta-cashpoint');
      if(point&&root.contains(point)){e.stopPropagation();const wrap=point.closest('.tta-cash-chart'),tip=wrap?.querySelector('.tta-charttooltip'),same=point.classList.contains('active')&&tip?.dataset.pinned==='1';if(same)hideCashFlowTooltip(wrap,true);else showCashFlowTooltip(point,true);return;}
      root.querySelectorAll('.tta-chartinteractive').forEach(w=>{hideChartTooltip(w,true);hideCashFlowTooltip(w,true);});
    });

    root.addEventListener('input',e=>{
      const target=e.target;
      if(target.id==='tta-sort-select'){state.sortMode=target.value;save('sortMode',state.sortMode);void withTransition('Sorting items',()=>renderItemList());return;}
      if(target.id==='tta-sales-search'){state.saleSearch=target.value;clearTimeout(perfCache.searchTimer);perfCache.searchTimer=setTimeout(()=>withTransition('Filtering sales',()=>render({preserveScroll:true})),140);return;}
      if(target.id==='tta-history-search'){
        state.itemSearch=target.value;save('itemSearch',state.itemSearch);clearTimeout(perfCache.searchTimer);perfCache.searchTimer=setTimeout(()=>withTransition('Filtering items',()=>renderItemList()),120);
      }else if(target.id==='tta-cash-search'){
        state.cashSearch=target.value;save('cashSearch',state.cashSearch);clearTimeout(perfCache.searchTimer);perfCache.searchTimer=setTimeout(()=>withTransition('Filtering cash activity',()=>render({preserveScroll:true})),140);
      }else if(target.id==='tta-ledger-search'){
        state.ledgerSearch=target.value;save('ledgerSearch',state.ledgerSearch);state.ledgerLimit=200;clearTimeout(perfCache.ledgerSearchTimer);perfCache.ledgerSearchTimer=setTimeout(()=>withTransition('Filtering ledger',()=>renderLedgerRows()),120);
      }else if(target.id==='tta-search'){
        state.search=target.value;clearTimeout(perfCache.legacySearchTimer);perfCache.legacySearchTimer=setTimeout(()=>withTransition('Filtering catalog',()=>{render();const n=document.getElementById('tta-search');if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length);}}),140);
      }
    });

    root.addEventListener('change',async e=>{
      try{
      const target=e.target;
      if(target.id==='tta-sort-select'){state.sortMode=target.value;save('sortMode',state.sortMode);await withTransition('Sorting items',()=>renderItemList());return;}
      if(target.id==='tta-sales-source'){state.saleSource=target.value;state.salesLimit=100;await withTransition('Filtering sales',()=>render({preserveScroll:true}));return;}
      if(target.id==='tta-networth-date'){const ts=tctDateInputStart(target.value),bounds=netWorthTrackingBounds();if(Number.isFinite(ts)){const day=Math.max(bounds.first,Math.min(bounds.today,tctDayStart(ts)));state.netWorthDate=tctInputDate(day);save('netWorthDate',state.netWorthDate);await withTransition('Updating Net Worth',()=>render({preserveScroll:true}));}return;}
      if(target.id==='tta-cash-category'){state.cashCategory=target.value;save('cashCategory',state.cashCategory);await withTransition('Filtering cash activity',()=>render({preserveScroll:true}));return;}
      if(target.dataset.ledgerFilter){
        const kind=target.dataset.ledgerFilter,val=target.value;if(kind==='source')state.ledgerSource=val;else if(kind==='status')state.ledgerStatus=val;else if(kind==='range')state.ledgerRange=val;
        save(kind==='source'?'ledgerSource':kind==='status'?'ledgerStatus':'ledgerRange',val);state.ledgerLimit=200;await withTransition('Filtering ledger',()=>renderLedgerRows());return;
      }
      if(!target.dataset.custom)return;if(target.dataset.custom==='from')state.customFrom=target.value;else state.customTo=target.value;save('customFrom',state.customFrom);save('customTo',state.customTo);state.expanded=null;
      await withTransition('Updating custom period',()=>render());
      }catch(error){diagnosticFromError(error,'filters');render();toast('Filter update failed. See Data Quality.');}
    });

    root.addEventListener('focusin',e=>{const target=e.target;if(target.id==='tta-api-key'&&target.dataset.placeholderKey==='1'){target.value='';target.dataset.placeholderKey='0';}});
  }
