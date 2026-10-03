  // Large analyzer datasets use Torn PDA native storage when available and IndexedDB elsewhere.
  // localStorage remains the last-resort fallback and is kept for small synchronous preferences.
  const DURABLE_STORAGE_KEYS=new Set(['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial','financialSnapshots','catalog','logTypes']);
  const durableCache=new Map();
  const durableStorageState={backend:'localStorage',ready:false,migrated:0,used:0,quota:0,lastError:''};
  let durableBackend=null,durableWriteChain=Promise.resolve(),durableWriteFailure=null;

  function storageIssue(key) {
    try{if(typeof storageIssues!=='undefined'&&!storageIssues.includes(key))storageIssues.push(key);}catch(_){}
  }
  function normalizedStoredValue(k,value,fallback) {
    if(value==null)return fallback;
    try{
      if(fallback!=null&&(Array.isArray(fallback)!==Array.isArray(value)||typeof fallback!==typeof value))throw new Error('Invalid saved type');
      if(Array.isArray(value)&&['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial','financialSnapshots','goals','tracked','catalog','logTypes','notices'].includes(k)){
        const rows=value.filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
        if(rows.length!==value.length)storageIssue(k);
        return rows;
      }
      return value;
    }catch(_){storageIssue(k);return fallback;}
  }
  function parseLocalValue(k,fallback) {
    try{
      const raw=localStorage.getItem(NS+k);if(raw==null)return fallback;
      return normalizedStoredValue(k,JSON.parse(raw),fallback);
    }catch(_){storageIssue(k);return fallback;}
  }
  function load(k,fallback) {
    if(DURABLE_STORAGE_KEYS.has(k)&&durableCache.has(k))return normalizedStoredValue(k,durableCache.get(k),fallback);
    return parseLocalValue(k,fallback);
  }
  function storageDiagnostic(code,severity,message,context={}) {
    try{if(typeof reportDiagnostic==='function')reportDiagnostic(code,severity,message,context);}catch(_){}
  }
  function isQuotaError(error) {
    return error?.name==='QuotaExceededError'||error?.code===22||error?.code==='QuotaExceeded'||error?.code==='GlobalQuotaExceeded';
  }
  function storageError(error,key) {
    const quota=isQuotaError(error),message=quota
      ? 'Analyzer storage is full. Increase the Torn PDA script limit or free browser site storage, then retry.'
      : 'Analyzer data could not be written to durable storage. Cached data remains in memory until the page closes.';
    storageDiagnostic(quota?'STORAGE_QUOTA':'STORAGE_WRITE','error',message,{source:key||'storage'});
    durableStorageState.lastError=String(error?.code||error?.name||error?.message||error||'storage error').slice(0,120);
  }
  function saveLocal(k,v) {
    try{localStorage.setItem(NS+k,JSON.stringify(v));return true;}
    catch(error){storageError(error,k);return false;}
  }
  function save(k,v) {
    if(DURABLE_STORAGE_KEYS.has(k)&&durableStorageState.ready&&durableBackend?.kind!=='localStorage'){
      durableCache.set(k,v);queueDurableWrite(k,v);return true;
    }
    return saveLocal(k,v);
  }

  function openAnalyzerDb() {
    return new Promise((resolve,reject)=>{
      if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB unavailable'));return;}
      let settled=false;
      const request=indexedDB.open('torn-cash-flow-analyzer',1);
      const timer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('IndexedDB open timed out'));}},8000);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('kv'))db.createObjectStore('kv');};
      request.onerror=()=>{if(!settled){settled=true;clearTimeout(timer);reject(request.error||new Error('IndexedDB open failed'));}};
      request.onblocked=()=>{if(!settled){settled=true;clearTimeout(timer);reject(new Error('IndexedDB is blocked by another tab'));}};
      request.onsuccess=()=>{if(!settled){settled=true;clearTimeout(timer);resolve(request.result);}else request.result.close();};
    });
  }
  async function indexedDbBackend() {
    const db=await openAnalyzerDb();
    const transact=(mode,action)=>new Promise((resolve,reject)=>{
      let result,tx;
      try{
        tx=db.transaction('kv',mode);
        const req=action(tx.objectStore('kv'));
        if(req){
          req.onsuccess=()=>{result=req.result;};
          req.onerror=()=>reject(req.error||new Error('IndexedDB request failed'));
        }
        tx.oncomplete=()=>resolve(result);
        tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));
        tx.onerror=()=>{};
      }catch(error){reject(error);}
    });
    return {kind:'indexeddb',
      get:key=>transact('readonly',store=>store.get(key)),
      set:(key,value)=>transact('readwrite',store=>store.put(value,key)),
      delete:key=>transact('readwrite',store=>store.delete(key)),
      usage:async()=>{try{const e=await navigator?.storage?.estimate?.();return {used:Number(e?.usage)||0,quota:Number(e?.quota)||0,scope:'origin'};}catch(_){return {used:0,quota:0,scope:'origin'};}}
    };
  }
  function tornPdaBackend() {
    const api=globalThis.PDA_storage||globalThis.window?.PDA_storage;
    if(!api||typeof api.get!=='function'||typeof api.set!=='function')return null;
    return {kind:'pda',
      get:key=>api.get(key,null),
      set:(key,value)=>api.set(key,value),
      delete:key=>api.delete(key),
      usage:async()=>{const x=await api.usage();return {used:Number(x?.used)||0,quota:Number(x?.quota)||0,scope:'script'};}
    };
  }
  function localBackend() {
    return {kind:'localStorage',
      get:async key=>{const raw=localStorage.getItem(key);return raw==null?null:JSON.parse(raw);},
      set:async(key,value)=>localStorage.setItem(key,JSON.stringify(value)),
      delete:async key=>localStorage.removeItem(key),
      usage:async()=>({used:0,quota:0,scope:'origin'})
    };
  }
  async function chooseDurableBackend() {
    const pda=tornPdaBackend();if(pda)return pda;
    try{return await indexedDbBackend();}catch(_){return localBackend();}
  }
  function applyDurableStateValue(key,value) {
    durableCache.set(key,value);
    if(typeof state!=='undefined'&&Object.prototype.hasOwnProperty.call(state,key))state[key]=normalizedStoredValue(key,value,state[key]);
  }
  async function initializeDurableStorage() {
    if(durableStorageState.ready)return durableStorageState;
    durableBackend=await chooseDurableBackend();
    durableStorageState.backend=durableBackend.kind;
    let migrated=0;
    if(durableBackend.kind!=='localStorage'){
      for(const key of DURABLE_STORAGE_KEYS){
        const storageKey=NS+key;
        let durableValue=null;
        try{durableValue=await durableBackend.get(storageKey);}catch(error){storageError(error,key);continue;}
        const localRaw=(()=>{try{return localStorage.getItem(storageKey);}catch(_){return null;}})();
        if(durableValue==null&&localRaw!=null){
          try{
            const localValue=JSON.parse(localRaw);
            await durableBackend.set(storageKey,localValue);
            const verified=await durableBackend.get(storageKey);
            if(JSON.stringify(verified)!==JSON.stringify(localValue))throw new Error('Migration verification failed');
            durableValue=verified;migrated++;
          }catch(error){storageError(error,key);continue;}
        }
        if(durableValue!=null){
          applyDurableStateValue(key,durableValue);
          if(localRaw!=null){try{localStorage.removeItem(storageKey);}catch(_){}}
        }
      }
    }else{
      for(const key of DURABLE_STORAGE_KEYS){const value=parseLocalValue(key,undefined);if(value!==undefined)applyDurableStateValue(key,value);}
    }
    durableStorageState.migrated=migrated;durableStorageState.ready=true;
    try{const u=await durableBackend.usage();durableStorageState.used=u.used;durableStorageState.quota=u.quota;}catch(_){}
    if(durableBackend.kind==='pda'){
      storageDiagnostic('STORAGE_BACKEND','info',migrated?('Moved '+migrated+' data sets to Torn PDA native storage.'):'Using Torn PDA native per-script storage.',{source:'PDA_storage'});
    }else if(durableBackend.kind==='indexeddb'){
      storageDiagnostic('STORAGE_BACKEND','info',migrated?('Moved '+migrated+' data sets to browser IndexedDB.'):'Using browser IndexedDB for large analyzer history.',{source:'IndexedDB'});
    }else{
      storageDiagnostic('STORAGE_FALLBACK','warning','IndexedDB is unavailable, so large history is using limited browser localStorage.',{source:'localStorage'});
    }
    return durableStorageState;
  }
  function queueDurableWrite(k,v) {
    if(!DURABLE_STORAGE_KEYS.has(k)||!durableStorageState.ready||durableBackend?.kind==='localStorage')return;
    durableWriteChain=durableWriteChain.then(async()=>{
      try{
        await durableBackend.set(NS+k,v);
        durableCache.set(k,v);
        try{localStorage.removeItem(NS+k);}catch(_){}
        durableWriteFailure=null;
      }catch(error){durableWriteFailure=error;storageError(error,k);throw error;}
    }).catch(()=>{});
  }
  async function saveDurable(k,v) {
    if(!DURABLE_STORAGE_KEYS.has(k)) {
      if(!saveLocal(k,v))throw new Error('Local storage write failed');
      return true;
    }
    if(!durableStorageState.ready)await initializeDurableStorage();
    durableCache.set(k,v);
    if(durableBackend.kind==='localStorage'){
      if(!saveLocal(k,v))throw new Error('Local storage write failed');
      return true;
    }
    try{
      await durableBackend.set(NS+k,v);
      try{localStorage.removeItem(NS+k);}catch(_){}
      durableWriteFailure=null;return true;
    }catch(error){durableWriteFailure=error;storageError(error,k);throw error;}
  }
  async function flushDurableStorage() {
    await durableWriteChain;
    if(durableWriteFailure){const error=durableWriteFailure;durableWriteFailure=null;throw error;}
    return true;
  }
  async function removeStoredKey(k) {
    durableCache.delete(k);
    try{localStorage.removeItem(NS+k);}catch(_){}
    if(DURABLE_STORAGE_KEYS.has(k)&&durableStorageState.ready&&durableBackend?.kind!=='localStorage'){
      try{await durableBackend.delete(NS+k);}catch(error){storageError(error,k);throw error;}
    }
  }
  async function clearStoredKeys(keys) {for(const key of keys)await removeStoredKey(key);}
  async function storageStatus() {
    if(!durableStorageState.ready)await initializeDurableStorage();
    let usage={used:0,quota:0,scope:'origin'};try{usage=await durableBackend.usage();}catch(_){}
    durableStorageState.used=Number(usage.used)||0;durableStorageState.quota=Number(usage.quota)||0;
    return {backend:durableBackend.kind,used:durableStorageState.used,quota:durableStorageState.quota,scope:usage.scope||'origin',migrated:durableStorageState.migrated,lastError:durableStorageState.lastError};
  }
