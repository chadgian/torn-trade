  let historyRecoveryFinished=false,crossTabChannel=null,crossTabRefreshTimer=0,crossTabRefreshPromise=null,lastCrossTabRefreshAt=0;

  function applyFullResyncPreview(backup) {
    if(!backup?.sync)return false;
    for(const key of ['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial']){
      if(Array.isArray(backup[key]))state[key]=backup[key];
    }
    state.sync=backup.sync;
    resetAnalyticsCache();
    return true;
  }
  async function runStartupRecovery() {
    try{await restoreImportRecovery();}catch(_){reportDiagnostic('IMPORT_RECOVERY','error','Previous history could not be restored. Free browser storage and reload.',{source:'import'});}
    if(load('fullResyncBackup',null)&&!loadSyncJob()?.fullResetDone)await restoreFullResyncBackup({fullResetDone:true});
    purgeBogusCrimeCashRows();
    repairCashFlowAccountingRows();
    if(state.transactions.length&&state.sync.accountingVersion!==ACCOUNTING_VERSION){
      state.transactions=state.transactions.map(row=>row.side==='buy'&&!row.free&&!(Number(row.total)>0)?{...row,costKnown:false}:row);
      save('transactions',state.transactions);
      reportDiagnostic('PARSER_UPDATED','warning','Cached history was parsed by an older version. Full Resync rechecks historical amounts and trade details.',{source:'migration'});
    }
    await flushDurableStorage();
    for(const source of storageIssues)reportDiagnostic('STORAGE_READ','warning','A saved value could not be read; a default was used.',{source});
  }
  async function previewHistoryWhileOtherTabWrites() {
    const job=loadSyncJob();
    if(!job?.fullResetDone||!load('fullResyncBackup',null))return false;
    try{
      const backup=await readFullResyncBackup();
      if(applyFullResyncPreview(backup)){
        reportDiagnostic('SYNC_OTHER_TAB','info','Another Torn tab is rebuilding TCFA history. This tab is showing the last safe history until that rebuild finishes.',{source:'sync'});
        return true;
      }
    }catch(_){}
    return false;
  }
  async function refreshCrossTabHistory(reason='cross-tab') {
    if(state.syncing||state.backgroundSyncing)return false;
    if(crossTabRefreshPromise)return crossTabRefreshPromise;
    crossTabRefreshPromise=(async()=>{
      const preview=await previewHistoryWhileOtherTabWrites();
      if(!preview)await reloadDurableStorage();
      const localKeys=['tracked','goals','pinnedIds','hiddenIds','notices','catalogUpdatedAt','logTypesUpdatedAt','dateMode','customFrom','customTo','granularity','netWorthDate','netWorthTrackingStartedAt','apiKey'];
      for(const key of localKeys)if(Object.prototype.hasOwnProperty.call(state,key))state[key]=load(key,state[key]);
      if(!preview)state.sync=load('sync',state.sync);
      resetAnalyticsCache();lastCrossTabRefreshAt=Date.now();
      if(!loadSyncJob())resolveDiagnostic('SYNC_OTHER_TAB');
      queueAnalyticsRender();
      return true;
    })().catch(error=>{reportDiagnostic('STORAGE_READ','warning','Stored history could not be refreshed in this tab. Reload the Torn page to retry.',{source:'cross-tab'});return false;})
      .finally(()=>{crossTabRefreshPromise=null;});
    return crossTabRefreshPromise;
  }
  function scheduleCrossTabRefresh(reason='cross-tab',delay=80) {
    clearTimeout(crossTabRefreshTimer);
    crossTabRefreshTimer=setTimeout(()=>{void refreshCrossTabHistory(reason);},delay);
  }
  function setupCrossTabRefresh() {
    try{
      if(typeof BroadcastChannel!=='undefined'){
        crossTabChannel=new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
        crossTabChannel.addEventListener('message',event=>{if(event?.data?.type==='history-updated')scheduleCrossTabRefresh(event.data.reason||'broadcast');});
      }
    }catch(_){crossTabChannel=null;}
    const passiveKeys=new Set(['goals','tracked','pinnedIds','hiddenIds','apiKey','catalogUpdatedAt','logTypesUpdatedAt']);
    window.addEventListener('storage',event=>{
      if(event.key===crossTabSignalKey()){scheduleCrossTabRefresh('storage-signal');return;}
      if(!event.key?.startsWith(NS))return;
      const key=event.key.slice(NS.length);
      if(passiveKeys.has(key))scheduleCrossTabRefresh('storage');
    });
    const refreshOnFocus=()=>{if(Date.now()-lastCrossTabRefreshAt>1500)scheduleCrossTabRefresh('focus',40);};
    window.addEventListener('focus',refreshOnFocus);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshOnFocus();});
  }

  // Every tab may read durable history. Only recovery/mutation work is protected
  // by the exclusive sync lock, so a second tab stays useful while another syncs.
  historyRecoveryReady=initializeDurableStorage()
    .then(async()=>{
      if(typeof navigator!=='undefined'&&navigator.locks?.request){
        await navigator.locks.request('torn-cash-flow-sync',{ifAvailable:true},async lock=>{
          if(lock)await runStartupRecovery();
          else{
            await previewHistoryWhileOtherTabWrites();
            reportDiagnostic('SYNC_OTHER_TAB','info','Another Torn tab is syncing. You can keep viewing the locally stored TCFA history here.',{source:'sync'});
          }
        });
      }else await runStartupRecovery();
    })
    .catch(()=>{historyRecoveryFailed=true;reportDiagnostic('REBUILD_RECOVERY','error','Previous history could not be loaded safely. Free browser storage and reload. Sync is blocked to protect the recovery copy.',{source:'storage'});})
    .finally(()=>{historyRecoveryFinished=true;});

  setupCrossTabRefresh();
  const boot=async()=>{if(document.body){await historyRecoveryReady;mount();if(historyRecoveryFailed)return;try{await resumePendingSync();startBackgroundQuickSync();}catch(error){historyRecoveryFailed=!!load('fullResyncBackup',null);diagnosticFromError(error,'recovery');queueAnalyticsRender();}}else setTimeout(boot,250)}; boot();
  setInterval(()=>{if(historyRecoveryFinished&&(!document.getElementById('tta-fab')||!document.getElementById('tta-root')))mount();},5000);
