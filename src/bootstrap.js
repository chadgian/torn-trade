  try{restoreImportRecovery();}catch(_){reportDiagnostic('IMPORT_RECOVERY','error','Previous history could not be restored. Free browser storage and reload.',{source:'import'});}
  if(load('fullResyncBackup',null)&&!loadSyncJob()?.fullResetDone){try{restoreFullResyncBackup({fullResetDone:true});}catch(_){reportDiagnostic('REBUILD_RECOVERY','error','Previous history could not be restored. Free browser storage and reload.',{source:'storage'});}}
  repairCashFlowAccountingRows();
  if(state.transactions.length&&state.sync.accountingVersion!==VERSION){
    state.transactions=state.transactions.map(row=>row.side==='buy'&&!row.free&&!(Number(row.total)>0)?{...row,costKnown:false}:row);
    save('transactions',state.transactions);
    reportDiagnostic('PARSER_UPDATED','warning','Cached history was parsed by an older version. Full Resync rechecks historical amounts and trade details.',{source:'migration'});
  }
  for(const source of storageIssues)reportDiagnostic('STORAGE_READ','warning','A saved value could not be read; a default was used.',{source});
  window.addEventListener('storage',event=>{if(!event.key?.startsWith(NS)||state.syncing||state.backgroundSyncing)return;for(const key of ['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','financialSnapshots','sync','notices'])state[key]=load(key,state[key]);resetAnalyticsCache();queueAnalyticsRender();});
  const boot=()=>{if(document.body){mount();resumePendingSync();startBackgroundQuickSync();}else setTimeout(boot,250)}; boot();
  setInterval(()=>{if(!document.getElementById('tta-fab')||!document.getElementById('tta-root'))mount();},5000);
