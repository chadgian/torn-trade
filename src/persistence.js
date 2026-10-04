  const BACKUP_KEYS=['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial','financialSnapshots','goals','tracked','pinnedIds','hiddenIds','sync','dateMode','customFrom','customTo','granularity','netWorthDate','netWorthTrackingStartedAt'];
  const IMPORT_CLEAR_KEYS=['syncJob','syncCache','fullResyncBackup'];
  let historyRecoveryReady=Promise.resolve();
  let historyRecoveryFailed=false;
  function rebuildBackupStore(operation,value) {
    return new Promise((resolve,reject)=>{
      if(typeof indexedDB==='undefined'){reject(new AnalyzerError('REBUILD_BACKUP_UNAVAILABLE','This browser cannot store a rebuild recovery copy.',{source:'storage'}));return;}
      let db,settled=false,result;
      const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(db)db.close();if(error)reject(error);else resolve(result);};
      const timer=setTimeout(()=>finish(new AnalyzerError('REBUILD_BACKUP_UNAVAILABLE','Recovery storage did not respond. Close other analyzer tabs and retry.',{source:'storage'})),10000);
      const request=indexedDB.open('torn-analyzer-recovery',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('backups');
      request.onerror=()=>finish(request.error);
      request.onblocked=()=>finish(new AnalyzerError('REBUILD_BACKUP_UNAVAILABLE','Recovery storage is blocked by another tab. Close other analyzer tabs and retry.',{source:'storage'}));
      request.onsuccess=()=>{
        db=request.result;if(settled){db.close();return;}
        try{
          const tx=db.transaction('backups',operation==='get'?'readonly':'readwrite'),store=tx.objectStore('backups');
          const task=operation==='put'?store.put(value,NS):operation==='delete'?store.delete(NS):store.get(NS);
          task.onsuccess=()=>{result=task.result;};
          tx.oncomplete=()=>finish();tx.onabort=()=>finish(tx.error||new Error('Recovery transaction aborted'));tx.onerror=()=>{};
        }catch(error){finish(error);}
      };
    });
  }
  async function saveFullResyncBackup(backup) {
    // Keep the large recovery copy outside localStorage's small per-origin quota.
    if(typeof indexedDB!=='undefined'){
      await rebuildBackupStore('put',backup);
      localStorage.setItem(NS+'fullResyncBackup',JSON.stringify({storage:'indexeddb',schema:1}));
    }else localStorage.setItem(NS+'fullResyncBackup',JSON.stringify(backup));
  }
  async function readFullResyncBackup() {
    const marker=load('fullResyncBackup',null);
    if(marker?.storage!=='indexeddb')return marker;
    const backup=await rebuildBackupStore('get');
    if(!backup?.sync)throw new AnalyzerError('REBUILD_RECOVERY','The rebuild recovery copy is missing. Do not reset or import history; export the remaining data and report this error.',{source:'storage'});
    return backup;
  }
  async function clearFullResyncBackup() {
    const marker=load('fullResyncBackup',null);
    localStorage.removeItem(NS+'fullResyncBackup');
    if(marker?.storage==='indexeddb'){
      try{await rebuildBackupStore('delete');resolveDiagnostic('REBUILD_CLEANUP');}
      catch(_){reportDiagnostic('REBUILD_CLEANUP','info','Sync finished, but the old recovery copy could not be removed. It will be replaced by the next rebuild.',{source:'storage'});}
    }
  }
  function validateBackup(payload) {
    const data=payload?.data;
    if(payload?.schema!==1||payload?.app!=='Torn Cash Flow Analyzer'||!data)throw new AnalyzerError('IMPORT_FORMAT','This is not a supported analyzer backup.');
    for(const key of ['transactions','cashFlows','financialSnapshots'])if(!Array.isArray(data[key]))throw new AnalyzerError('IMPORT_FORMAT','The backup is missing required history.');
    for(const key of BACKUP_KEYS){
      if(data[key]===undefined)continue;
      const sample=state[key];
      if(Array.isArray(sample)&&!Array.isArray(data[key])||!Array.isArray(sample)&&typeof data[key]!==typeof sample||data[key]===null)throw new AnalyzerError('IMPORT_FORMAT','A backup field has an invalid type.',{source:key});
    }
    for(const row of data.transactions)if(!row||row.id==null||!['buy','sell'].includes(row.side)||!(Number(row.itemId)>0)||!(Number(row.qty)>0)||!Number.isFinite(Number(row.qty))||!(Number(row.timestamp)>0))throw new AnalyzerError('IMPORT_ROW','A transaction is missing its identity, quantity or event time.');
    for(const row of data.cashFlows)if(!row||row.id==null||!['in','out','transfer-in','transfer-out'].includes(row.direction)||!(Number(row.amount)>0)||!(Number(row.timestamp)>0))throw new AnalyzerError('IMPORT_ROW','A cash movement has invalid fields.');
    if(data.sync?.accountId&&state.sync.accountId&&Number(data.sync.accountId)!==Number(state.sync.accountId))throw new AnalyzerError('ACCOUNT_MISMATCH','The backup belongs to another account. Export and reset history before switching accounts.');
    return data;
  }
  async function restoreImportRecovery() {
    const recovery=load('importRecovery',null);if(!recovery)return false;
    try{
      for(const key of [...BACKUP_KEYS,...IMPORT_CLEAR_KEYS])if(Object.prototype.hasOwnProperty.call(recovery,key)){
        const raw=recovery[key];
        if(raw===null)await removeStoredKey(key);
        else{
          const value=typeof raw==='string'?JSON.parse(raw):raw;
          if(DURABLE_STORAGE_KEYS.has(key))await saveDurable(key,value);else if(!save(key,value))throw new Error('Recovery write failed');
          if(BACKUP_KEYS.includes(key)&&Object.prototype.hasOwnProperty.call(state,key))state[key]=value;
        }
      }
      localStorage.removeItem(NS+'importRecovery');resetAnalyticsCache();return true;
    }catch(error){
      reportDiagnostic('IMPORT_RECOVERY','error','Previous import recovery could not finish. Existing durable history was left intact where possible.',{source:'import'});
      throw error;
    }
  }
  async function applyBackup(payload) {
    const data=validateBackup(payload),previous={};
    for(const key of BACKUP_KEYS)previous[key]=Object.prototype.hasOwnProperty.call(state,key)?state[key]:load(key,null);
    for(const key of IMPORT_CLEAR_KEYS)previous[key]=load(key,null);
    try{
      for(const key of BACKUP_KEYS)if(data[key]!==undefined){
        if(DURABLE_STORAGE_KEYS.has(key))await saveDurable(key,data[key]);
        else if(!save(key,data[key]))throw new Error('Backup write failed');
        if(Object.prototype.hasOwnProperty.call(state,key))state[key]=data[key];
      }
      for(const key of IMPORT_CLEAR_KEYS)await removeStoredKey(key);
      resetAnalyticsCache();await flushDurableStorage();announceCrossTabUpdate('backup-import');return true;
    }catch(error){
      try{
        for(const key of BACKUP_KEYS)if(previous[key]!==undefined&&previous[key]!==null){
          if(DURABLE_STORAGE_KEYS.has(key))await saveDurable(key,previous[key]);else save(key,previous[key]);
          if(Object.prototype.hasOwnProperty.call(state,key))state[key]=previous[key];
        }
        for(const key of IMPORT_CLEAR_KEYS)if(previous[key]!=null)save(key,previous[key]);
        resetAnalyticsCache();
      }catch(_){reportDiagnostic('IMPORT_RECOVERY','error','Import rollback could not finish. Reload and restore your exported backup before syncing.',{source:'import'});}
      throw new AnalyzerError('IMPORT_STORAGE','The backup could not be saved. Previous history was restored where possible.',{source:'import'});
    }
  }
