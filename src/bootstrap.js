  let historyRecoveryFinished=false;
  async function initializeStoredHistory() {
    try{restoreImportRecovery();}catch(_){reportDiagnostic('IMPORT_RECOVERY','error','Previous history could not be restored. Free browser storage and reload.',{source:'import'});}
    if(load('fullResyncBackup',null)&&!loadSyncJob()?.fullResetDone)await restoreFullResyncBackup({fullResetDone:true});
    repairCashFlowAccountingRows();
    if(state.transactions.length&&state.sync.accountingVersion!==VERSION){
      state.transactions=state.transactions.map(row=>row.side==='buy'&&!row.free&&!(Number(row.total)>0)?{...row,costKnown:false}:row);
      save('transactions',state.transactions);
      reportDiagnostic('PARSER_UPDATED','warning','Cached history was parsed by an older version. Full Resync rechecks historical amounts and trade details.',{source:'migration'});
    }
    for(const source of storageIssues)reportDiagnostic('STORAGE_READ','warning','A saved value could not be read; a default was used.',{source});
  }
  // Startup recovery and sync must share the same cross-tab write lock.
  historyRecoveryReady=(typeof navigator!=='undefined'&&navigator.locks?.request?
    navigator.locks.request('torn-cash-flow-sync',{ifAvailable:true},async lock=>{
      if(lock)await initializeStoredHistory();else reportDiagnostic('SYNC_OTHER_TAB','info','Another Torn tab is syncing. Startup recovery will not change its history.',{source:'sync'});
    }):initializeStoredHistory())
    .catch(()=>{historyRecoveryFailed=true;reportDiagnostic('REBUILD_RECOVERY','error','Previous history could not be restored. Free browser storage and reload. Sync is blocked to protect the recovery copy.',{source:'storage'});})
    .finally(()=>{historyRecoveryFinished=true;});
  window.addEventListener('storage',event=>{if(!event.key?.startsWith(NS)||state.syncing||state.backgroundSyncing)return;for(const key of ['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','financialSnapshots','sync','notices'])state[key]=load(key,state[key]);resetAnalyticsCache();queueAnalyticsRender();});
  const boot=async()=>{if(document.body){await historyRecoveryReady;mount();if(historyRecoveryFailed)return;try{await resumePendingSync();startBackgroundQuickSync();}catch(error){historyRecoveryFailed=!!load('fullResyncBackup',null);diagnosticFromError(error,'recovery');queueAnalyticsRender();}}else setTimeout(boot,250)}; boot();
  setInterval(()=>{if(historyRecoveryFinished&&(!document.getElementById('tta-fab')||!document.getElementById('tta-root')))mount();},5000);
