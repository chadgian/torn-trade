  const BACKUP_KEYS=['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial','financialSnapshots','goals','tracked','pinnedIds','hiddenIds','sync','dateMode','customFrom','customTo','granularity','netWorthDate','netWorthTrackingStartedAt'];
  const IMPORT_CLEAR_KEYS=['syncJob','syncCache','fullResyncBackup'];
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
  function restoreImportRecovery() {
    const recovery=load('importRecovery',null);if(!recovery)return false;
    for(const key of [...BACKUP_KEYS,...IMPORT_CLEAR_KEYS])if(Object.prototype.hasOwnProperty.call(recovery,key)){
      if(recovery[key]===null)localStorage.removeItem(NS+key);else localStorage.setItem(NS+key,recovery[key]);
      if(BACKUP_KEYS.includes(key))state[key]=load(key,state[key]);
    }
    localStorage.removeItem(NS+'importRecovery');resetAnalyticsCache();return true;
  }
  function applyBackup(payload) {
    const data=validateBackup(payload),previous={};
    for(const key of [...BACKUP_KEYS,...IMPORT_CLEAR_KEYS])previous[key]=localStorage.getItem(NS+key);
    // Save a write-ahead recovery journal before changing any history key.
    localStorage.setItem(NS+'importRecovery',JSON.stringify(previous));
    try{
      for(const key of BACKUP_KEYS)if(data[key]!==undefined)localStorage.setItem(NS+key,JSON.stringify(data[key]));
      for(const key of IMPORT_CLEAR_KEYS)localStorage.removeItem(NS+key);
      localStorage.removeItem(NS+'importRecovery');
    }catch(error){try{restoreImportRecovery();}catch(_){reportDiagnostic('IMPORT_RECOVERY','error','Import recovery could not finish. Free browser storage and reload to restore the previous history.',{source:'import'});}throw new AnalyzerError('IMPORT_STORAGE','The backup could not be saved. Previous history was retained or scheduled for recovery.');}
  }
