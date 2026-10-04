  function nextLogPageParams(data,currentParams,key='log') {
    const next=data?._metadata?.links?.next;
    if(!next)return null;
    try {
      const u=new URL(next,API+'/user/log');
      if(u.origin!==new URL(API).origin||u.pathname.replace(/\/$/,'')!==`/v2/user/${key}`)throw new Error('Unexpected pagination source');
      const params={...currentParams};delete params.nanostamp;
      for(const [k,v] of u.searchParams.entries()){
        if(['from','to','offset','limit','sort','cat','log','nanostamp'].includes(k))params[k]=v;
      }
      return params;
    } catch(_) { throw new AnalyzerError('PAGE_SOURCE_MISMATCH','Torn returned an invalid pagination link.',{source:'pagination'}); }
  }

  function pageRows(data,key) {
    if(!Array.isArray(data?.[key]))throw new AnalyzerError('API_SCHEMA','Torn returned an incomplete history response.',{source:key});
    if(data[key].some(row=>row?.id==null||!(Number(key==='log'?row.timestamp:row.completed_at||row.timestamp)>0)))throw new AnalyzerError('API_SCHEMA','A history row is missing its identity or event time. Coverage remains incomplete.',{source:key});
    return data[key];
  }
  function preciseHistoryCursor(value,key='log') {
    if(value==null||String(value)==='')return null;
    if(!/^\d{1,30}$/.test(String(value))||(typeof value==='number'&&!Number.isSafeInteger(value)))throw new AnalyzerError('API_SCHEMA','Torn returned an invalid precise history cursor.',{source:key});
    return BigInt(value)>0n?String(value):null;
  }
  function zeroHistoryPage(data,params,key='log') {
    return key==='log'&&(/^0{1,30}$/.test(String(data?._metadata?.nanostamp))||/^0{1,30}$/.test(String(nextLogPageParams(data,params,key)?.nanostamp)));
  }
  function nextHistoryPage(data,params,rows,seen,key='log') {
    if(!rows.length)return null;
    params={...params};
    const currentCursor=preciseHistoryCursor(params.nanostamp,key);
    if(!currentCursor)delete params.nanostamp;
    let next=nextLogPageParams(data,params,key);
    const zeroCursor=zeroHistoryPage(data,params,key);
    const precise=key==='log'?preciseHistoryCursor(data?._metadata?.nanostamp,key):null;
    if(next){const linkCursor=preciseHistoryCursor(next.nanostamp,key);if(linkCursor)next.nanostamp=linkCursor;else delete next.nanostamp;}
    if(precise){
      // The link can retain an inclusive second; metadata advances within that second.
      next={...params,nanostamp:precise};
    }
    // A zero cursor cannot advance the scan. Keep a real timestamp/link cursor,
    // otherwise independently verify the short terminal page in historyPage.
    if(zeroCursor&&next&&!next.nanostamp&&(!(Number(next.to)>0)||Number(next.to)===Number(params.to))&&String(next.offset||'')===String(params.offset||''))next=null;
    if(next?.nanostamp&&currentCursor&&BigInt(next.nanostamp)>BigInt(currentCursor))throw new AnalyzerError('PAGE_SOURCE_MISMATCH','Torn moved the precise history cursor forward. Coverage remains incomplete.',{source:key,cursor:currentCursor,nextCursor:next.nanostamp});
    if(!next) {
      // A full page without a precise cursor may hide events in its final second.
      const minimum=(currentCursor||zeroCursor)?Math.max(1,Number(params.limit||100)-1):Number(params.limit||100);
      if(rows.length>=minimum)throw new AnalyzerError('PAGE_INCOMPLETE','A dense history page has no continuation cursor that can be used safely. Coverage remains incomplete.',{source:key,count:rows.length});
      return null;
    }
    if(params.log!=null)next.log=params.log;
    if(params.cat!=null)next.cat=params.cat;
    // Links are cursors, not permission to narrow the original scan window.
    next.from=params.from??0;
    const signature=JSON.stringify(Object.entries(next).map(([k,v])=>[k,String(v)]).sort(([a],[b])=>a.localeCompare(b)));
    const current=JSON.stringify(Object.entries(params).map(([k,v])=>[k,String(v)]).sort(([a],[b])=>a.localeCompare(b)));
    if(signature===current||seen.includes(signature))throw new AnalyzerError('PAGE_REPEATED','Torn repeated a history cursor. The boundary could not yet be verified; coverage remains incomplete.',{source:key,from:Number(params.from)||0,to:Number(params.to)||0,count:rows.length,cursor:String(params.nanostamp||''),nextCursor:String(next.nanostamp||'')});
    seen.push(signature);return next;
  }

  async function inspectActiveKey() {
    const raw=await apiGet('/key/info');
    const info=raw?.info||{};
    const access=info?.access||{};
    const logAccess=access?.log||{};
    const userSelections=Array.isArray(info?.selections?.user)?info.selections.user:[];
    return {
      type:String(access?.type||''),
      level:Number(access?.level)||0,
      hasUserLog:userSelections.includes('log') || Number(access?.level)>=4,
      customLogPermissions:!!logAccess?.custom_permissions,
      availableLogGroups:Array.isArray(logAccess?.available)?logAccess.available.length:0,
      userId:Number(info?.user?.id)||0
    };
  }
  let verifiedAccountKey='',verifiedAccountId=0;
  function acceptAccountInfo(info) {
    if(!(info.userId>0))throw new AnalyzerError('ACCOUNT_UNKNOWN','The API key account could not be identified.');
    if(state.sync.accountId&&Number(state.sync.accountId)!==info.userId)throw new AnalyzerError('ACCOUNT_MISMATCH','This key belongs to a different account. Export and reset history before switching accounts.');
    const sync={...state.sync,accountId:info.userId};
    if(!save('sync',sync))throw new AnalyzerError('STORAGE_WRITE','The account identity could not be saved.');
    state.sync=sync;verifiedAccountKey=activeApiKey();verifiedAccountId=info.userId;
  }
  async function requireAccountIdentity() {
    if(verifiedAccountKey===activeApiKey()&&verifiedAccountId===Number(state.sync.accountId))return;
    acceptAccountInfo(await inspectActiveKey());
  }

  const SYNC_JOB_SCHEMA_VERSION = 3;
  // v0.2.0 expands User Log scope from trade/item history to money events.
  // Bump the schema so old trade-only day coverage cannot suppress the first cash-flow backfill.
  const SYNC_CACHE_SCHEMA_VERSION = 6;
  const INCREMENTAL_OVERLAP_SEC = 300;
  // Torn User Logs and finished Player Trades can become visible after a sync has
  // already advanced lastSync. Foreground Quick Sync uses a wider repair window;
  // the one-minute background sync uses a small overlap to stay lightweight.
  const RECENT_LOG_RECHECK_SEC = 72 * 3600;
  const RECENT_TRADE_RECHECK_SEC = 72 * 3600;
  const BACKGROUND_LOG_RECHECK_SEC = 15 * 60;
  const BACKGROUND_TRADE_RECHECK_SEC = 60 * 60;
  const STALE_SYNC_JOB_SEC = 5 * 60;
  let resumeBootStarted=false,resumableTxMap=null,resumableTxJob='',syncCacheMem=null;

  function ensureSyncCache() {
    if(syncCacheMem&&Number(syncCacheMem.schema)===SYNC_CACHE_SCHEMA_VERSION)return syncCacheMem;
    let c=load('syncCache',null);
    if(!c||Number(c.schema)!==SYNC_CACHE_SCHEMA_VERSION)c={schema:SYNC_CACHE_SCHEMA_VERSION,verifiedTrades:{},logCoverageFrom:null,logCoverageTo:0,tradeCoverageFrom:null,tradeCoverageTo:0,logDayCoverage:{},tradeDayCoverage:{}};
    if(!c.verifiedTrades||typeof c.verifiedTrades!=='object')c.verifiedTrades={};
    if(!c.logDayCoverage||typeof c.logDayCoverage!=='object')c.logDayCoverage={};
    if(!c.tradeDayCoverage||typeof c.tradeDayCoverage!=='object')c.tradeDayCoverage={};
    if(!c.pendingTrades||typeof c.pendingTrades!=='object')c.pendingTrades={};
    syncCacheMem=c;return c;
  }
  function saveSyncCache(){if(syncCacheMem&&!save('syncCache',syncCacheMem))throw new AnalyzerError('STORAGE_WRITE','Sync coverage could not be saved.');}
  function updateSyncCoverage(job) {
    const c=ensureSyncCache(),serverNow=Number(job?.tctNow)||nowSec();
    const apply=(kind,p)=>{
      if(!p||!job.completedSources?.[kind])return;const fk=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',tk=kind==='trade'?'tradeCoverageTo':'logCoverageTo';
      const rawOldFrom=c[fk],oldFrom=rawOldFrom==null?NaN:Number(rawOldFrom);c[fk]=Number.isFinite(oldFrom)?Math.min(oldFrom,p.from):p.from;
      c[tk]=Math.max(Number(c[tk])||0,Math.min(p.to,serverNow));
    };
    apply('log',job.logScanPeriod);apply('trade',job.tradeScanPeriod);saveSyncCache();
  }
  function isTradeVerified(job,header) {
    const id=Number(typeof header==='object'?header?.id:header)||0;if(!(id>0))return false;
    if((job.verifiedTradeIds||[]).includes(id))return true;
    const verification=ensureSyncCache().verifiedTrades[id];
    if(!verification||typeof verification!=='object'||!state.playerTrades.some(t=>Number(t.tradeId)===id))return false;
    // Recheck recent trades even when their IDs were previously cached. Torn can
    // expose a completed trade before its item details are fully available.
    const activityAt=Number(typeof header==='object'?(header.modified_at||header.completed_at||header.timestamp):0)||0;
    if(activityAt>=nowSec()-RECENT_TRADE_RECHECK_SEC||activityAt>Number(verification.activityAt))return false;
    return true;
  }
  function markTradeVerified(job,id,ts=0) {
    id=Number(id)||0;if(!(id>0))return;
    const set=new Set((job.verifiedTradeIds||[]).map(Number));set.add(id);job.verifiedTradeIds=[...set];
    if(ts>0)job.verifiedTradeTimes={...(job.verifiedTradeTimes||{}),[id]:Number(ts)||1};
  }
  function commitTradeVerifications(job) {
    const c=ensureSyncCache(),times=job?.verifiedTradeTimes||{};
    for(const id of job?.verifiedTradeIds||[]){const n=Number(id)||0;if(n>0){c.verifiedTrades[n]={activityAt:Number(times[n])||0,checkedAt:nowSec()};delete c.pendingTrades[n];}}
    saveSyncCache();
  }

  function loadSyncJob() {
    const job=load('syncJob',null);
    if(!job||Number(job.schema)!==SYNC_JOB_SCHEMA_VERSION||!job.active||!job.period)return null;
    return job;
  }
  function saveSyncJob(job) {
    try{
      if(job){job.updatedAt=nowSec();localStorage.setItem(NS+'syncJob',JSON.stringify(job));}
      else localStorage.removeItem(NS+'syncJob');
      return true;
    }catch(e){return false;}
  }
  function clearSyncJob(){saveSyncJob(null);}
  function syncJobIsStale(job) {
    if(!job?.period)return false;
    const now=nowSec(),end=Number(job.period.to)||0,updated=Number(job.updatedAt)||0;
    // A long full rebuild keeps its frozen end time; freshness is repaired afterward.
    return (job.syncMode!=='full'&&end>0&&end<now-STALE_SYNC_JOB_SEC)||(updated>0&&updated<now-6*3600);
  }
  async function discardStaleSyncJob(job) {
    if(!job)return;
    if(job.fullResetDone)await restoreFullResyncBackup(job);
    else{commitTradeVerifications(job);abandonResumableMarkers(job);}
    clearSyncJob();
  }
  function syncJobCancelled(job){return !!(state.syncCancel||job?.cancelled);}
  function formatEtaDuration(ms) {
    let sec=Math.max(0,Math.round((Number(ms)||0)/1000));
    if(sec<60)return `${Math.max(1,sec)}s`;
    const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
    if(h>0)return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }
  function etaUnitTiming(job,phase,unit,defaultMs=1150) {
    const now=Date.now();if(!job.etaStats||typeof job.etaStats!=='object')job.etaStats={};let st=job.etaStats[phase]||{lastAt:now,lastUnit:Number(unit)||0,msPerUnit:0,samples:0};
    const u=Number(unit)||0,du=u-(Number(st.lastUnit)||0),dt=now-(Number(st.lastAt)||now);
    if(du>0&&dt>50&&dt<30000){const sample=dt/du+REQUEST_GAP_MS;st.msPerUnit=st.msPerUnit>0?st.msPerUnit*.72+sample*.28:sample;st.samples=(Number(st.samples)||0)+du;}
    st.lastAt=now;st.lastUnit=u;job.etaStats[phase]=st;return st.msPerUnit>0?st.msPerUnit:defaultMs;
  }
  function priorFullSyncDiagnostics() {const d=state.sync?.diagnostics;return d&&d.syncMode==='full'?d:(d||{});}
  function fullResyncProgressMetrics(job) {
    if(!job||job.syncMode!=='full')return null;const phase=String(job.phase||'setup'),d=job.diagnostics||{},prior=priorFullSyncDiagnostics();let pct=1,eta=null,etaNote='estimating time left';
    const pageMs=etaUnitTiming(job,phase,phase==='logs-filtered'||phase==='logs-fallback'?Number(d.pages)||0:phase==='logs-abroad-verify'?Number(d.abroadVerifyPages)||0:phase==='trades-list'?Number(d.tradeListPages)||0:phase==='trade-details'?Number(job.tradeDetailIndex)||0:0,1150);
    const priorTradePages=Math.max(1,Number(prior.tradeListPages)||1),priorTrades=Math.max(0,Number(prior.tradeHeaders)||0),priorAbroadPages=Math.max(1,Number(prior.abroadVerifyPages)||1),detailMs=phase==='trade-details'?pageMs:1150;
    if(phase==='setup'){pct=2;etaNote='preparing scan';}
    else if(phase==='logs-filtered'){
      const totalBatches=Math.max(1,(Array.isArray(job.logBatches)&&job.logBatches.length)||Math.ceil((job.logTypeIds||[]).length/MAX_LOG_IDS_PER_REQUEST)),doneBatches=Math.max(0,Math.min(totalBatches,Number(job.logBatchIndex)||0)),currentPages=Math.max(0,Number(job.logPage)||0),pagesDone=Math.max(0,Number(d.pages)||0),priorPages=Math.max(totalBatches,Number(prior.pages)||0);
      let predictedTotalPages=priorPages;if(doneBatches>0){const completedPages=Math.max(1,pagesDone-currentPages),avg=completedPages/doneBatches;predictedTotalPages=Math.max(pagesDone+1,avg*totalBatches);predictedTotalPages=priorPages>0?predictedTotalPages*.72+priorPages*.28:predictedTotalPages;}else if(!(priorPages>0))predictedTotalPages=Math.max(pagesDone+totalBatches*4,totalBatches*5);
      const remainingPages=Math.max(0,predictedTotalPages-pagesDone),futureMs=priorAbroadPages*1150+priorTradePages*1150+Math.max(priorTrades,10)*1150+4000;eta=remainingPages*pageMs+futureMs;pct=5+55*Math.min(1,pagesDone/Math.max(1,predictedTotalPages));etaNote=doneBatches>0||priorPages>0?`~${formatEtaDuration(eta)} left`:'learning history depth';
    }else if(phase==='logs-fallback'){
      const pages=Math.max(0,Number(d.pages)||0),priorPages=Math.max(1,Number(prior.pages)||10),remaining=Math.max(1,priorPages-pages);pct=60+10*Math.min(.95,pages/Math.max(1,pages+remaining));eta=remaining*pageMs+priorAbroadPages*1150+priorTradePages*1150+Math.max(priorTrades,10)*1150+4000;etaNote=`~${formatEtaDuration(eta)} left`;
    }else if(phase==='logs-abroad-verify'){
      const pages=Math.max(0,Number(d.abroadVerifyPages)||0),pred=Math.max(pages+1,priorAbroadPages),remaining=Math.max(0,pred-pages);pct=70+6*Math.min(.95,pages/Math.max(1,pred));eta=remaining*pageMs+priorTradePages*1150+Math.max(priorTrades,10)*1150+4000;etaNote=`~${formatEtaDuration(eta)} left`;
    }else if(phase==='trades-list'){
      const pages=Math.max(0,Number(d.tradeListPages)||0),pred=Math.max(pages+1,priorTradePages),remainingPages=Math.max(0,pred-pages),known=Math.max((job.tradeHeaders||[]).length,priorTrades);pct=76+8*Math.min(.95,pages/Math.max(1,pred));eta=remainingPages*pageMs+Math.max(known,5)*1150+3500;etaNote=`~${formatEtaDuration(eta)} left`;
    }else if(phase==='trade-details'){
      const total=Math.max(0,(job.tradeHeaders||[]).length),done=Math.max(0,Number(job.tradeDetailIndex)||0),remaining=Math.max(0,total-done);pct=84+13*(total>0?Math.min(1,done/total):1);eta=remaining*detailMs+3500;etaNote=total>0?`~${formatEtaDuration(eta)} left`:'finishing trade scan';
    }else if(phase==='finalize'){pct=99;eta=2500;etaNote='~3s left';}
    pct=Math.max(Number(job.progressPercent)||0,Math.min(99,pct));job.progressPercent=pct;return {percent:pct,etaMs:eta,etaNote};
  }
  function decorateSyncProgress(job,progress) {
    const text=String(progress||''),m=fullResyncProgressMetrics(job);if(!m)return text;const pc=Math.max(0,Math.min(99,Math.round(m.percent))),eta=m.etaNote||(m.etaMs!=null?`~${formatEtaDuration(m.etaMs)} left`:'estimating time left');return `${pc}% \u00B7 ${eta} \u00B7 ${text}`;
  }
  async function checkpointSyncJob(job,progress='') {
    if(progress){job.progressRaw=String(progress);job.progress=decorateSyncProgress(job,job.progressRaw);if(job?.background)state.backgroundSyncProgress=job.progress;else setSyncProgress(job.progress);}
    await flushDurableStorage();
    if(!saveSyncJob(job))throw new AnalyzerError('STORAGE_WRITE','Unable to save the resumable sync checkpoint. Free some browser storage and try again.',{source:'syncJob',phase:job.phase});
  }
  function stripSyncRunMarkers() {
    let changed=false;
    state.transactions=(state.transactions||[]).map(t=>{
      if(!t||!Object.prototype.hasOwnProperty.call(t,'syncRunId'))return t;
      const x={...t};delete x.syncRunId;changed=true;return x;
    });
    if(changed){save('transactions',state.transactions);resetAnalyticsCache();}
    resumableTxMap=null;resumableTxJob='';
  }
  function checkpointTransactionRows(job,rows) {
    if(!rows?.length)return 0;
    if(!resumableTxMap||resumableTxJob!==job.id){
      resumableTxMap=new Map((state.transactions||[]).filter(Boolean).map(x=>[String(x.id),x]));
      resumableTxJob=job.id;
    }
    let added=0,updated=0,changed=false;
    for(const row of rows){
      if(row?.id==null)continue;const key=String(row.id),prev=resumableTxMap.get(key);
      if(prev){
        const clean={...prev};delete clean.syncRunId;
        if(JSON.stringify(clean)===JSON.stringify(row)){if(job.diagnostics)job.diagnostics.existingRowsSkipped=(Number(job.diagnostics.existingRowsSkipped)||0)+1;continue;}
        resumableTxMap.set(key,{...row});updated++;changed=true;continue;
      }
      resumableTxMap.set(key,{...row,syncRunId:job.id});added++;changed=true;
    }
    if(job.diagnostics&&updated)job.diagnostics.transactionRowsUpdated=(Number(job.diagnostics.transactionRowsUpdated)||0)+updated;
    if(!changed)return 0;
    const next=[...resumableTxMap.values()];save('transactions',next);state.transactions=next;resetAnalyticsCache();state.renderPending=true;return added;
  }
  function finalizeResumableTransactions(job) {
    let freshCount=0;const next=[];
    for(const row of state.transactions||[]){
      if(!row||isLegacyTradeLogTransaction(row))continue;
      if(row.syncRunId===job.id)freshCount++;
      if(Object.prototype.hasOwnProperty.call(row,'syncRunId')){const x={...row};delete x.syncRunId;next.push(x);}else next.push(row);
    }
    next.sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)||String(a.id).localeCompare(String(b.id)));
    save('transactions',next);state.transactions=next;resumableTxMap=null;resumableTxJob='';resetAnalyticsCache();return freshCount;
  }
  function replaceTradeTransactions(job,tradeId,rows) {
    const next=state.transactions.filter(row=>Number(row.tradeId)!==Number(tradeId));
    for(const row of rows)next.push({...row,syncRunId:job.id});
    save('transactions',next);
    state.transactions=next;resumableTxMap=null;resumableTxJob='';resetAnalyticsCache();state.renderPending=true;
  }
  function abandonResumableMarkers(job) {
    let changed=false;
    state.transactions=(state.transactions||[]).map(row=>{
      if(row?.syncRunId!==job?.id)return row;
      const x={...row};delete x.syncRunId;changed=true;return x;
    });
    if(changed)save('transactions',state.transactions);
    resumableTxMap=null;resumableTxJob='';resetAnalyticsCache();
  }
  function newSyncDiagnostics(job,mode,logTypes,batches) {
    return {rawRows:0,parsedRows:0,matchedRows:0,cashFlowRows:0,playerTransferRows:0,unrecognizedFinancialRows:0,existingRowsSkipped:0,batches,logTypes,pages:0,logBatchSplits:0,denseBoundaryRecoveries:0,oldestTimestamp:0,latestRawLogTimestamp:0,latestParsedAcquisitionTimestamp:0,mode,syncMode:job.syncMode||'quick',periodFrom:job.period.from,periodTo:job.period.to,tradeHeaders:0,tradeListPages:0,tradeDetails:0,tradeDetailsSkipped:0,playerTradeEvents:0,tradesWithItems:0,tradeTransactions:0,tradeSoldQty:0,tradeBoughtQty:0,foreignBuyRows:0,foreignBuyQty:0,abroadVerifyPages:0,abroadVerifyRawRows:0,abroadVerifyParsedRows:0,abroadVerifyQty:0,abroadVerifyLatestRawTimestamp:0,recentLogRecheckHours:RECENT_LOG_RECHECK_SEC/3600,recentTradeRecheckHours:RECENT_TRADE_RECHECK_SEC/3600,tctNow:Number(job.tctNow)||0,missingLogDays:Number(job.logScanPeriod?.missingDays)||0,missingTradeDays:Number(job.tradeScanPeriod?.missingDays)||0,incrementalLogs:!!job.logScanPeriod?.incremental,incrementalTrades:!!job.tradeScanPeriod?.incremental};
  }
  function initialLogBatches(ids=[]) {
    const list=ids.map(Number).filter(x=>x>0),batches=[];
    for(let i=0;i<list.length;i+=MAX_LOG_IDS_PER_REQUEST)batches.push(list.slice(i,i+MAX_LOG_IDS_PER_REQUEST));
    return batches;
  }
  function ensureFilteredLogBatches(job) {
    if(!Array.isArray(job.logBatches)||!job.logBatches.length)job.logBatches=initialLogBatches(job.logTypeIds||[]);
    return job.logBatches;
  }
  function resetActiveLogBatchState(job) {
    const p=job.logScanPeriod||job.period;job.logCursorTo=p.to;job.logPage=0;job.logPreviousSignature='';job.logPageParams=null;job.logPageSeen=[];job.logLastPageIds=[];
  }
  async function createResumableSyncJob(syncMode='quick',background=false) {
    stripSyncRunMarkers();
    const mode=syncMode==='full'?'full':'quick',now=nowSec(),last=Number(state.sync?.lastSync)||0;
    const initialFrom=mode==='full'?0:(last>0?Math.min(last,now):tctDayStart(now));
    const period={from:initialFrom,to:now},periodText=mode==='full'?'all available history':`${tctDateTimeStr(initialFrom)} \u2013 ${tctDateTimeStr(now)} TCT`;
    const scan={from:period.from,to:period.to,incremental:mode==='quick',recheck:false,missingDays:0};
    const job={schema:SYNC_JOB_SCHEMA_VERSION,background:!!background,id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,syncMode:mode,active:true,cancelled:false,createdAt:now,updatedAt:now,period,periodText,logScanPeriod:{...scan},tradeScanPeriod:{...scan},phase:'setup',progress:mode==='full'?`Preparing full resync from the beginning\u2026`:`Preparing quick sync from ${tctDateTimeStr(initialFrom)} TCT\u2026`,resumedCount:0,logTypeIds:[],logBatches:[],logMode:'filtered',logBatchIndex:0,logCursorTo:period.to,logPage:0,logPreviousSignature:'',userId:0,diagnostics:null,tradeHeaders:[],tradeListParams:null,tradeListSeen:[],tradeDetailIndex:0,verifiedTradeIds:[],verifiedTradeTimes:{},progressPercent:0,progressActiveMs:0,progressClockAt:Date.now(),progressEtaMs:0};
    await checkpointSyncJob(job,job.progress);return job;
  }

  async function resetHistoryForFullResync() {
    const backup={sync:state.sync,syncCache:load('syncCache',null)};
    const historyKeys=['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial'];
    for(const key of historyKeys)backup[key]=state[key];
    try{await saveFullResyncBackup(backup);}catch(error){
      if(error?.name==='QuotaExceededError'||error?.code===22)throw new AnalyzerError('STORAGE_QUOTA','The recovery copy could not fit in browser storage. Existing history was not changed. Export a backup and free browser storage before retrying.',{source:'storage',phase:'backup'});
      throw new AnalyzerError('REBUILD_BACKUP_UNAVAILABLE','The recovery copy could not be saved. Existing history was not changed. Close other analyzer tabs and retry.',{source:'storage',phase:'backup'});
    }
    const nextSync={...(state.sync||{}),lastSync:0,coverageFrom:0,coverageTo:0,firstSyncComplete:false,autoDiscoveryComplete:false};
    try{
      for(const key of historyKeys)await saveDurable(key,[]);
      localStorage.removeItem(NS+'syncCache');localStorage.setItem(NS+'sync',JSON.stringify(nextSync));
    }catch(error){
      try{await restoreFullResyncBackup({fullResetDone:true});}catch(_){reportDiagnostic('REBUILD_RECOVERY','error','History recovery could not finish. Free browser storage and reload.',{source:'storage'});}
      throw new AnalyzerError('STORAGE_WRITE','The rebuild could not start. Previous history was retained or scheduled for recovery.');
    }
    for(const key of historyKeys)state[key]=[];
    state.sync=nextSync;syncCacheMem=null;resumableTxMap=null;resumableTxJob='';resetAnalyticsCache();
  }
  async function restoreFullResyncBackup(job) {
    if(!job?.fullResetDone)return;
    const backup=await readFullResyncBackup();if(!backup)return;
    if(typeof indexedDB!=='undefined'&&load('fullResyncBackup',null)?.storage!=='indexeddb')await saveFullResyncBackup(backup);
    // The durable backup remains intact if restoring any of these keys fails.
    if(load('fullResyncBackup',null)?.storage==='indexeddb')for(const key of ['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial'])await removeStoredKey(key);
    for(const key of ['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial']){await saveDurable(key,backup[key]||[]);state[key]=backup[key]||[];}
    localStorage.setItem(NS+'sync',JSON.stringify(backup.sync));state.sync=backup.sync;
    if(backup.syncCache)localStorage.setItem(NS+'syncCache',JSON.stringify(backup.syncCache));else localStorage.removeItem(NS+'syncCache');
    await clearFullResyncBackup();syncCacheMem=null;resumableTxMap=null;resetAnalyticsCache();resolveDiagnostic('REBUILD_RECOVERY');
  }
  async function syncApiGet(path,params={}) {
    let last;
    for(let attempt=0;attempt<3;attempt++){
      try{const data=await apiGet(path,{...params,timestamp:nowSec()});resolveDiagnostic('API_NETWORK',path);resolveDiagnostic('API_TIMEOUT',path);resolveDiagnostic('RATE_LIMIT',path);resolveDiagnostic('HTTP_ERROR',path);resolveDiagnostic('TORN_ERROR',path);return data;}catch(e){last=e;if(!e.retryable||attempt>=2)break;setSyncProgress(`Temporary API error \u00B7 retry ${attempt+2}/3 \u00B7 ${e.message}`);await sleep(e.code==='RATE_LIMIT'?15000*(attempt+1):1200*(attempt+1));}
    }
    throw last;
  }
  function logBoundaryCursor(data,params,rows) {
    const cursor=String(data?._metadata?.nanostamp||'');
    if(!/^\d{1,30}$/.test(cursor)||cursor!==String(params.nanostamp||'')||BigInt(cursor)<=0n)return null;
    const second=Number(BigInt(cursor)/1000000000n);
    return rows.every(row=>Number(row.timestamp)===second)?cursor:null;
  }
  async function historyPage(path,params,seen,key='log',previousIds=[]) {
    params={...params,from:params.from??0};
    if(!preciseHistoryCursor(params.nanostamp,key))delete params.nanostamp;
    let requests=0;
    for(let attempt=0;attempt<3;attempt++){
      const data=await syncApiGet(path,params),rows=pageRows(data,key),cursors=[...seen];requests++;
      try{
        const next=nextHistoryPage(data,params,rows,cursors,key);
        if(rows.length&&!next&&zeroHistoryPage(data,params,key)){
          // Zero is not a precise timestamp. Query the oldest returned second
          // inclusively without nanostamp; never decrement a whole second.
          const oldest=Math.min(...rows.map(row=>Number(row.timestamp))),probe={...params,to:oldest};delete probe.nanostamp;
          if(rows.some(row=>Number(row.timestamp)<Number(params.from)||Number(row.timestamp)>Number(params.to)))throw new AnalyzerError('PAGE_ZERO_UNVERIFIED','Torn returned logs outside the requested date range after a zero cursor. Coverage remains incomplete.',{source:key,phase:'zero-cursor-probe',from:Number(params.from),to:Number(params.to),count:rows.length});
          const checked=await syncApiGet(path,probe),older=pageRows(checked,key);requests++;
          if(older.some(row=>Number(row.timestamp)>oldest||Number(row.timestamp)<Number(params.from)))throw new AnalyzerError('PAGE_ZERO_UNVERIFIED','Torn did not honor the date-boundary check after a zero cursor. Coverage remains incomplete.',{source:key,phase:'zero-cursor-probe',from:Number(params.from),to:oldest,count:older.length});
          const probeSeen=[],probeNext=nextHistoryPage(checked,probe,older,probeSeen,key),known=new Set([...previousIds.map(String),...rows.map(row=>String(row.id))]);
          const hasNewRows=older.some(row=>!known.has(String(row.id)));
          const verifiedNext=probeNext||(hasNewRows?{...probe,to:Math.min(...older.map(row=>Number(row.timestamp)))}:null);
          reportDiagnostic('PAGE_ZERO_RECOVERED','info',verifiedNext?'An unusable zero history cursor was bypassed with a date-boundary check; older logs are still being loaded.':'A zero history cursor was independently verified at the end of this batch.',{source:key,phase:'zero-cursor-probe',from:Number(params.from),to:oldest,count:older.length});
          const savedRows=Array.from(new Map([...rows,...older].map(row=>[String(row.id),row])).values());
          return {rows:savedRows,next:verifiedNext,seen:[...seen],requests,boundaryRecovered:true};
        }
        if(attempt)reportDiagnostic('PAGE_RETRY','info','A stalled history page recovered after a fresh request. No history was skipped.',{source:key,count:attempt});
        return {rows,next,seen:cursors,requests};
      }catch(error){
        if(!['PAGE_REPEATED','PAGE_INCOMPLETE'].includes(error.code))throw error;
        if(state.syncCancel)return {rows:[],next:null,seen:[...seen],requests};
        if(attempt===2){
          if(key==='log'&&error.code==='PAGE_INCOMPLETE'){
            const filterIds=String(params.log||'').split(',').filter(Boolean);
            // Multi-type filtered pages are split by runResumableLogPhase so each
            // subset can be verified independently. A singleton/unfiltered dense
            // page gets one inclusive date-boundary probe before we give up.
            if(filterIds.length<=1&&rows.length){
              const times=rows.map(row=>Number(row?.timestamp)).filter(Number.isFinite),from=Number(params.from)||0,to=Number(params.to)||0;
              if(times.length!==rows.length||times.some(ts=>ts<from||ts>to))throw new AnalyzerError('PAGE_BOUNDARY_UNVERIFIED','Torn returned logs outside the dense-page verification range. Coverage remains incomplete.',{...error.context,phase:'dense-date-probe'});
              const oldest=Math.min(...times),probe={...params,to:oldest};delete probe.nanostamp;delete probe.offset;
              setSyncProgress('Verifying a dense history boundary');
              const checked=await syncApiGet(path,probe),older=pageRows(checked,key);requests++;
              if(older.some(row=>Number(row.timestamp)>oldest||Number(row.timestamp)<from))throw new AnalyzerError('PAGE_BOUNDARY_UNVERIFIED','Torn did not honor the dense-page date-boundary check. Coverage remains incomplete.',{...error.context,phase:'dense-date-probe',from,to:oldest,count:older.length});
              let probeNext;
              try{probeNext=nextHistoryPage(checked,probe,older,[],key);}catch(probeError){
                if(probeError.code==='PAGE_INCOMPLETE')throw error;
                throw probeError;
              }
              if(!probeNext){
                if(older.length>=Math.max(1,Number(probe.limit||100)-1))throw error;
                const returnedIds=new Set(older.map(row=>String(row.id))),boundaryIds=rows.filter(row=>Number(row.timestamp)===oldest).map(row=>String(row.id));
                if(boundaryIds.some(id=>!returnedIds.has(id)))throw new AnalyzerError('PAGE_BOUNDARY_UNVERIFIED','The terminal dense-page probe did not reproduce the known boundary records. Coverage remains incomplete.',{...error.context,phase:'dense-date-probe',from,to:oldest,count:older.length});
              }
              const savedRows=Array.from(new Map([...rows,...older].map(row=>[String(row.id),row])).values());
              reportDiagnostic('PAGE_BOUNDARY_RECOVERED','info',probeNext?'A dense history page was recovered with an independent date-boundary cursor; older logs are still being loaded.':'A dense history page was independently verified as the end of this log batch.',{source:key,phase:'dense-date-probe',from,to:oldest,count:older.length});
              return {rows:savedRows,next:probeNext,seen:[...seen],requests,boundaryRecovered:true,denseBoundaryRecovered:true};
            }
          }
          if(key==='trades'&&error.code==='PAGE_REPEATED'){
            const limit=Math.max(1,Number(params.limit||100));
            const times=rows.map(row=>Number(row?.completed_at||row?.timestamp)).filter(Number.isFinite);
            // A short repeated trade page can be checked safely with an older
            // second-boundary request. Dense pages remain errors because moving
            // back one second could hide additional trades at the same second.
            if(!rows.length||times.length!==rows.length||rows.length>=Math.max(1,limit-1))throw error;
            const from=Number(params.from)||0,oldest=Math.min(...times),probeTo=oldest-1;
            if(probeTo<from){
              reportDiagnostic('PAGE_BOUNDARY_RECOVERED','info','A repeated short Player Trades page ended at the requested history boundary; the trade list is complete.',{source:key,phase:'trade-boundary-probe',from,to:Number(params.to)||0,count:rows.length});
              return {rows,next:null,seen:[...seen],requests,boundaryRecovered:true};
            }
            const probe={...params,to:probeTo};delete probe.nanostamp;delete probe.offset;
            setSyncProgress('Verifying the repeated Player Trades boundary');
            const checked=await syncApiGet(path,probe),older=pageRows(checked,key);requests++;
            const repeatedIds=new Set(rows.map(row=>String(row.id)));
            if(older.some(row=>{
              const ts=Number(row?.completed_at||row?.timestamp)||0;
              return repeatedIds.has(String(row.id))||ts>probeTo||ts<from;
            })){
              throw new AnalyzerError('PAGE_BOUNDARY_UNVERIFIED','Torn did not honor the Player Trades date-boundary check. No trade history was skipped and coverage remains incomplete.',{...error.context,phase:'trade-boundary-probe'});
            }
            if(!older.length){
              reportDiagnostic('PAGE_BOUNDARY_RECOVERED','info','A repeated short Player Trades page was independently verified as the end of trade history.',{source:key,phase:'trade-boundary-probe',from,to:probeTo,count:rows.length});
              return {rows,next:null,seen:[...seen],requests,boundaryRecovered:true};
            }
            reportDiagnostic('PAGE_BOUNDARY_RECOVERED','info','A repeated short Player Trades page was bypassed with an older date-boundary check; older trades are still being loaded.',{source:key,phase:'trade-boundary-probe',from,to:probeTo,count:older.length});
            return {rows,next:probe,seen:[...seen],requests,boundaryRecovered:true};
          }
          const boundary=key==='log'&&error.code==='PAGE_REPEATED'?logBoundaryCursor(data,params,rows):null;
          if(!boundary)throw error;
          const known=new Set(previousIds.map(String));
          // First checkpoint any new boundary records. Only previously saved IDs
          // can be excluded by the subsequent one-nanosecond verification probe.
          if(rows.some(row=>!known.has(String(row.id))))return {rows,next:{...params},seen:[...seen],requests};
          // A full/99-row page may still hide records at the exact same boundary.
          if(rows.length>=Math.max(1,Number(params.limit||100)-1))throw error;
          const probe={...params,nanostamp:(BigInt(boundary)-1n).toString()};
          setSyncProgress('Verifying the repeated history boundary');
          const checked=await syncApiGet(path,probe),older=pageRows(checked,key);requests++;
          const repeatedIds=new Set(rows.map(row=>String(row.id)));
          if(older.some(row=>repeatedIds.has(String(row.id))||Number(row.timestamp)>Number(rows[0].timestamp)||Number(row.timestamp)<Number(params.from)||Number(row.timestamp)>Number(params.to))){
            throw new AnalyzerError('PAGE_BOUNDARY_UNVERIFIED','Torn did not honor the precise boundary check. No history was skipped and coverage remains incomplete.',{...error.context,phase:'boundary-probe'});
          }
          let next;
          try{next=nextHistoryPage(checked,probe,older,cursors,key);}catch(probeError){
            if(probeError.code!=='PAGE_REPEATED'||!logBoundaryCursor(checked,probe,older))throw probeError;
            next={...probe};
          }
          reportDiagnostic('PAGE_BOUNDARY_RECOVERED','info',older.length?'A repeated inclusive boundary was verified; older logs are still being loaded.':'A repeated inclusive boundary was verified empty; this history batch is complete.',{source:key,count:older.length,cursor:boundary,nextCursor:probe.nanostamp});
          return {rows:older,next,seen:cursors,requests,boundaryRecovered:true};
        }
        setSyncProgress(`Checking a stalled history page \u00B7 retry ${attempt+2}/3`);await sleep(REQUEST_GAP_MS);
      }
    }
  }
  function advanceResumableLogBatch(job) {
    const p=job.logScanPeriod||job.period;job.logBatchIndex=(Number(job.logBatchIndex)||0)+1;job.logCursorTo=p.to;job.logPage=0;job.logPreviousSignature='';job.logPageParams=null;job.logPageSeen=[];job.logLastPageIds=[];
  }
  async function runResumableLogPhase(job,mode) {
    const scanPeriod=job.logScanPeriod||job.period,filtered=mode==='filtered',ids=filtered?(job.logTypeIds||[]):[];
    const batches=filtered?ensureFilteredLogBatches(job):[[]];
    if(job.logMode!==mode){job.logMode=mode;job.logBatchIndex=0;resetActiveLogBatchState(job);}
    while((Number(job.logBatchIndex)||0)<batches.length&&!syncJobCancelled(job)){
      const batchIndex=Number(job.logBatchIndex)||0,batchIds=filtered?(batches[batchIndex]||[]):[],totalBatches=batches.length;
      const cursor=Number(job.logCursorTo)||scanPeriod.to,page=(Number(job.logPage)||0)+1,label=filtered?`Historical scan ${batchIndex+1}/${totalBatches}`:'Compatibility history scan';
      await checkpointSyncJob(job,`${label} \u00B7 page ${page} \u00B7 back to ${dateStr(Math.max(scanPeriod.from,Math.min(cursor,nowSec())))}`);
      const params={...(job.logPageParams||{limit:100,to:cursor}),from:scanPeriod.from};if(filtered)params.log=batchIds.join(',');
      let pageResult;
      try{
        pageResult=await historyPage('/user/log',params,job.logPageSeen||[],'log',job.logLastPageIds||[]);
      }catch(error){
        if(filtered&&error?.code==='PAGE_INCOMPLETE'&&batchIds.length>1){
          const splitAt=Math.ceil(batchIds.length/2),left=batchIds.slice(0,splitAt),right=batchIds.slice(splitAt);
          batches.splice(batchIndex,1,left,right);job.logBatches=batches;
          job.diagnostics.logBatchSplits=(Number(job.diagnostics.logBatchSplits)||0)+1;job.diagnostics.batches=batches.length;
          resetActiveLogBatchState(job);
          reportDiagnostic('PAGE_BATCH_SPLIT','info','A dense User Log page was split into smaller log-type batches so coverage can be verified without skipping same-second events.',{source:'log',phase:'adaptive-batch-split',count:batchIds.length});
          await checkpointSyncJob(job,`Dense log page detected \u00B7 split batch ${batchIndex+1} into ${left.length} + ${right.length} log types \u00B7 restarting this batch safely`);
          continue;
        }
        throw error;
      }
      const {rows,next,seen,requests,boundaryRecovered,denseBoundaryRecovered}=pageResult;
      job.diagnostics.pages=(Number(job.diagnostics.pages)||0)+requests;
      if(boundaryRecovered)job.diagnostics.boundaryRecoveries=(Number(job.diagnostics.boundaryRecoveries)||0)+1;
      if(denseBoundaryRecovered)job.diagnostics.denseBoundaryRecoveries=(Number(job.diagnostics.denseBoundaryRecoveries)||0)+1;
      if(!rows.length){advanceResumableLogBatch(job);await checkpointSyncJob(job,`${label} \u00B7 page ${page} complete`);continue;}
      const parsedRows=[],transferPage=[],consumptionPage=[],cashPage=[],cashLogIds=[];
      job.diagnostics.rawRows=(Number(job.diagnostics.rawRows)||0)+rows.length;
      for(const r of rows){
        const ts=Number(r?.timestamp)||0;if(ts<scanPeriod.from||ts>scanPeriod.to)continue;
        cashLogIds.push(`cashlog:${r.id}`);
        if(ts>Number(job.diagnostics.latestRawLogTimestamp||0))job.diagnostics.latestRawLogTimestamp=ts;
        // Multi-workspace projection: do not consume a raw event after the first match.
        // Item transactions, cash flow, transfers and consumption are independent views.
        const parsed=parseLogEntry(r);job.diagnostics.parsedRows+=parsed.length;job.diagnostics.matchedRows+=parsed.length;for(const t of parsed){if(t.side==='buy'){job.diagnostics.latestParsedAcquisitionTimestamp=Math.max(Number(job.diagnostics.latestParsedAcquisitionTimestamp)||0,Number(t.timestamp)||0);}if(t.side==='buy'&&t.source==='Foreign Market'){job.diagnostics.foreignBuyRows=(Number(job.diagnostics.foreignBuyRows)||0)+1;job.diagnostics.foreignBuyQty=(Number(job.diagnostics.foreignBuyQty)||0)+(Number(t.qty)||0);}}parsedRows.push(...parsed);
        const transferRows=parsePlayerTransferEntry(r);job.diagnostics.playerTransferRows=(Number(job.diagnostics.playerTransferRows)||0)+transferRows.length;transferPage.push(...transferRows);
        const consumptionRows=parseItemConsumptionEntry(r);job.diagnostics.itemConsumptionRows=(Number(job.diagnostics.itemConsumptionRows)||0)+consumptionRows.length;consumptionPage.push(...consumptionRows);
        const cashRows=parseCashFlowEntry(r,parsed);job.diagnostics.cashFlowRows=(Number(job.diagnostics.cashFlowRows)||0)+cashRows.length;cashPage.push(...cashRows);checkpointUnrecognizedFinancial(r,cashRows.length>0||transferRows.length>0||consumptionRows.length>0||parsed.length>0);if(!cashRows.length&&!transferRows.length&&!parsed.length&&unrecognizedRowFor(r))job.diagnostics.unrecognizedFinancialRows=(Number(job.diagnostics.unrecognizedFinancialRows)||0)+1;
      }
      checkpointPlayerTransferRows(transferPage);checkpointItemConsumptionRows(consumptionPage);checkpointCashFlowRows(cashPage,cashLogIds);
      checkpointTransactionRows(job,parsedRows);
      const timestamps=rows.map(r=>Number(r?.timestamp)).filter(Number.isFinite);
      if(!timestamps.length||rows.some(r=>!(Number(r.timestamp)>0)||r.id==null))throw new AnalyzerError('LOG_SCHEMA','History contains invalid timestamps or event IDs.',{source:'User Logs'});
      const oldest=Math.min(...timestamps),signature=rows.map(rawLogKey).join('|');
      job.diagnostics.oldestTimestamp=job.diagnostics.oldestTimestamp?Math.min(job.diagnostics.oldestTimestamp,oldest):oldest;
      if(!next)advanceResumableLogBatch(job);else{job.logPageParams=next;job.logPageSeen=seen;job.logLastPageIds=rows.map(row=>String(row.id));job.logCursorTo=Number(next.to)||oldest;job.logPage=page;job.logPreviousSignature=signature;}
      await checkpointSyncJob(job,`${label} \u00B7 ${qty(job.diagnostics.matchedRows||0)} item rows checkpointed`);
      if(!syncJobCancelled(job))await sleep(REQUEST_GAP_MS);
    }
    if(!syncJobCancelled(job)){job.completedSources={...(job.completedSources||{}),log:true};resolveDiagnostic('PAGE_INCOMPLETE','log');resolveDiagnostic('PAGE_REPEATED','log');resolveDiagnostic('PAGE_BATCH_SPLIT','log');}
    return !syncJobCancelled(job);
  }
  async function runAbroadBuyVerification(job) {
    const serverNow=Number(job.tctNow)||nowSec();
    const verifyFrom=Number(job.logScanPeriod?.from)||0;
    const verifyTo=Math.min(Number(job.period?.to)||serverNow,serverNow);
    if(!(verifyTo>=verifyFrom)){job.phase='trades-list';await checkpointSyncJob(job,'Abroad Buy verification skipped \u00B7 no overlapping selected period.');return true;}
    let cursor=verifyTo,page=0;
    while(!syncJobCancelled(job)){
      page++;await checkpointSyncJob(job,`Abroad Buy verification \u00B7 page ${page} \u00B7 ${tctDateStr(verifyFrom)} \u2013 ${tctDateStr(Math.min(cursor,serverNow))} TCT`);
      const params={...(job.abroadPageParams||{limit:100,log:'4201',to:cursor}),from:verifyFrom};
      const {rows,next,seen,requests,boundaryRecovered}=await historyPage('/user/log',params,job.abroadPageSeen||[],'log',job.abroadLastPageIds||[]);
      job.diagnostics.abroadVerifyPages=(Number(job.diagnostics.abroadVerifyPages)||0)+requests;
      if(boundaryRecovered)job.diagnostics.boundaryRecoveries=(Number(job.diagnostics.boundaryRecoveries)||0)+1;
      job.diagnostics.abroadVerifyRawRows=(Number(job.diagnostics.abroadVerifyRawRows)||0)+rows.length;
      if(!rows.length)break;
      const parsedRows=[];
      for(const r of rows){
        const ts=Number(r?.timestamp)||0;if(ts<verifyFrom||ts>verifyTo)continue;
        job.diagnostics.abroadVerifyLatestRawTimestamp=Math.max(Number(job.diagnostics.abroadVerifyLatestRawTimestamp)||0,ts);
        job.diagnostics.latestRawLogTimestamp=Math.max(Number(job.diagnostics.latestRawLogTimestamp)||0,ts);
        const parsed=parseLogEntry(r).filter(t=>t.side==='buy'&&t.source==='Foreign Market');
        for(const t of parsed){
          job.diagnostics.abroadVerifyParsedRows=(Number(job.diagnostics.abroadVerifyParsedRows)||0)+1;
          job.diagnostics.abroadVerifyQty=(Number(job.diagnostics.abroadVerifyQty)||0)+(Number(t.qty)||0);
          job.diagnostics.latestParsedAcquisitionTimestamp=Math.max(Number(job.diagnostics.latestParsedAcquisitionTimestamp)||0,Number(t.timestamp)||0);
        }
        parsedRows.push(...parsed);
      }
      checkpointTransactionRows(job,parsedRows);
      if(!next)break;
      job.abroadPageParams=next;job.abroadPageSeen=seen;job.abroadLastPageIds=rows.map(row=>String(row.id));cursor=Number(next.to)||cursor;await checkpointSyncJob(job);await sleep(REQUEST_GAP_MS);
    }
    job.phase='trades-list';await checkpointSyncJob(job,`Abroad Buy verification complete \u00B7 ${qty(job.diagnostics.abroadVerifyRawRows||0)} raw 4201 logs \u00B7 ${qty(job.diagnostics.abroadVerifyQty||0)} overseas item(s) parsed.`);return true;
  }

  function compactTradeHeader(row) {
    const id=Number(row?.id)||0,ts=Number(row?.completed_at||row?.timestamp)||0,n=Number(row?.items),modified=Number(row?.modified_at)||0;
    return id>0&&ts>0?{id,completed_at:ts,modified_at:modified>0?modified:null,items:Number.isFinite(n)?n:null}:null;
  }
  async function runResumableTradeList(job) {
    const scanPeriod=job.tradeScanPeriod;
    if(!scanPeriod){job.phase='finalize';await checkpointSyncJob(job,'Player trades already fully covered \u00B7 no trade API requests needed.');return true;}
    const found=new Map([...Object.values(ensureSyncCache().pendingTrades),...(job.tradeHeaders||[])].map(x=>[Number(x.id),x]));
    let params={...(job.tradeListParams||{cat:'finished',limit:100,sort:'DESC',to:scanPeriod.to}),from:scanPeriod.from};
    while(!syncJobCancelled(job)){
      const page=(Number(job.diagnostics.tradeListPages)||0)+1;await checkpointSyncJob(job,`Player trades \u00B7 list page ${page} \u00B7 ${qty(found.size)} completed trades checkpointed`);
      const {rows,next,seen}=await historyPage('/user/trades',params,job.tradeListSeen||[],'trades');job.diagnostics.tradeListPages=page;
      for(const row of rows){const h=compactTradeHeader(row);if(h&&h.completed_at>=scanPeriod.from&&h.completed_at<=scanPeriod.to)found.set(h.id,h);}
      job.tradeHeaders=[...found.values()];job.diagnostics.tradeHeaders=job.tradeHeaders.length;
      if(!next){job.completedSources={...(job.completedSources||{}),trade:true};job.tradeListParams=null;job.phase='trade-details';job.tradeDetailIndex=Number(job.tradeDetailIndex)||0;await checkpointSyncJob(job,`Player trades \u00B7 ${qty(job.tradeHeaders.length)} completed trades listed`);return true;}
      job.tradeListSeen=seen;job.tradeListParams=next;params=next;await checkpointSyncJob(job,`Player trades \u00B7 list page ${page} saved`);await sleep(REQUEST_GAP_MS);
    }
    return false;
  }
  async function runResumableTradeDetails(job) {
    const headers=job.tradeHeaders||[];
    while((Number(job.tradeDetailIndex)||0)<headers.length&&!syncJobCancelled(job)){
      const i=Number(job.tradeDetailIndex)||0,h=headers[i];
      if(isTradeVerified(job,h)){
        job.diagnostics.tradeDetailsSkipped=(Number(job.diagnostics.tradeDetailsSkipped)||0)+1;job.tradeDetailIndex=i+1;
        await checkpointSyncJob(job,`Player trades \u00B7 ${i+1}/${headers.length} \u00B7 already verified, skipped`);continue;
      }
      await checkpointSyncJob(job,`Player trades \u00B7 ${i+1}/${headers.length} \u00B7 fetching missing detailed trade #${Number(h.id)}`);
      const data=await syncApiGet(`/user/${Number(h.id)}/trade`);job.diagnostics.tradeDetails=(Number(job.diagnostics.tradeDetails)||0)+1;
      const trade=data?.trade,detailEntries=Array.isArray(trade?.items)?trade.items:[];
      const participants=[Number(trade?.user?.id),Number(trade?.trader?.id)];
      if(Number(trade?.id)!==Number(h.id)||!participants.includes(Number(job.userId))||detailEntries.some(x=>!participants.includes(Number(x.user_id)))){
        throw new AnalyzerError('TRADE_SOURCE_MISMATCH','Trade details do not match the requested trade or account.',{tradeId:Number(h.id),source:'Player Trade'});
      }
      const tradeEvent=parsePlayerTradeEvent(trade,job.userId),rows=parsePlayerTrade(trade,job.userId);
      const rawItemEntries=detailEntries.filter(x=>String(x?.type||'').toLowerCase()==='item');
      const expectedItemQty=rawItemEntries.reduce((n,x)=>n+Math.max(0,Number(x?.details?.amount)||0),0);
      const parsedItemQty=rows.reduce((n,x)=>n+Math.max(0,Number(x?.qty)||0),0);
      const itemParseComplete=expectedItemQty<=0||Math.abs(parsedItemQty-expectedItemQty)<1e-7;
      const detailReady=detailEntries.length>0||!!tradeEvent||rows.length>0;
      if(!detailReady||!itemParseComplete||(rawItemEntries.length>0&&!rows.length)){
        const cache=ensureSyncCache();cache.pendingTrades[h.id]=h;saveSyncCache();
        reportDiagnostic('TRADE_DEFERRED','warning','Completed trade details are incomplete. This trade will be retried even after it leaves the recent scan window.',{tradeId:Number(h.id),timestamp:Number(h.completed_at),source:'Player Trade'});
        job.diagnostics.tradeDetailsDeferred=(Number(job.diagnostics.tradeDetailsDeferred)||0)+1;job.tradeDetailIndex=i+1;
        const why=!detailReady?'detail payload not ready':'item rows incomplete';
        await checkpointSyncJob(job,`Player trades \u00B7 ${i+1}/${headers.length} \u00B7 ${why}; deferred for the next sync`);
        if(job.tradeDetailIndex<headers.length&&!syncJobCancelled(job))await sleep(REQUEST_GAP_MS);
        continue;
      }
      resolveDiagnosticForTrade('TRADE_DEFERRED',h.id);
      // Complete authoritative details replace the whole trade, including removed item types.
      if(tradeEvent){checkpointPlayerTradeEvents([tradeEvent]);job.diagnostics.playerTradeEvents=(Number(job.diagnostics.playerTradeEvents)||0)+1;}
      replaceTradeTransactions(job,h.id,rows);
      const soldRows=rows.filter(x=>x.side==='sell'),boughtRows=rows.filter(x=>x.side==='buy');
      if(rows.length){
        job.diagnostics.tradesWithItems=(Number(job.diagnostics.tradesWithItems)||0)+1;
        job.diagnostics.tradeTransactions=(Number(job.diagnostics.tradeTransactions)||0)+rows.length;
        job.diagnostics.tradeSoldQty=(Number(job.diagnostics.tradeSoldQty)||0)+soldRows.reduce((n,x)=>n+(Number(x.qty)||0),0);
        job.diagnostics.tradeBoughtQty=(Number(job.diagnostics.tradeBoughtQty)||0)+boughtRows.reduce((n,x)=>n+(Number(x.qty)||0),0);
      }
      markTradeVerified(job,h.id,Math.max(Number(h.modified_at)||0,Number(h.completed_at)||0,Number(h.timestamp)||0));job.tradeDetailIndex=i+1;await checkpointSyncJob(job,`Player trades \u00B7 ${i+1}/${headers.length} \u00B7 detail verified and FIFO rows cached`);
      if(job.tradeDetailIndex<headers.length&&!syncJobCancelled(job))await sleep(REQUEST_GAP_MS);
    }
    if(!syncJobCancelled(job)){job.phase='finalize';await checkpointSyncJob(job,'Finalizing cached history and FIFO inputs\u2026');return true;}return false;
  }
  async function refreshLiveSyncBounds(job) {
    let serverNow=nowSec();
    try{const t=await apiGet('/user/timestamp',{timestamp:nowSec()});if(!(Number(t?.timestamp)>0))throw new Error('Missing timestamp');serverNow=Number(t.timestamp);resolveDiagnostic('CLOCK_INFERRED');}catch(_){reportDiagnostic('CLOCK_INFERRED','warning','Torn time could not be checked. Device UTC time is being used.',{source:'clock'});}
    const mode=job.syncMode==='full'?'full':'quick',last=Number(state.sync?.lastSync)||0,fallback=tctDayStart(serverNow);
    const repairDue=serverNow-Number(state.sync?.lastRepairSync||0)>=3600;
    job.repairWindow=!job.background||repairDue;
    const logWindow=job.repairWindow?RECENT_LOG_RECHECK_SEC:BACKGROUND_LOG_RECHECK_SEC,tradeWindow=job.repairWindow?RECENT_TRADE_RECHECK_SEC:BACKGROUND_TRADE_RECHECK_SEC;
    const logFrom=mode==='full'?0:(last>0?Math.max(0,Math.min(last,serverNow-logWindow)):fallback);
    const tradeFrom=mode==='full'?0:(last>0?Math.max(0,Math.min(last,serverNow-tradeWindow)):fallback);
    const from=Math.min(logFrom,tradeFrom);
    job.tctNow=serverNow;job.tctNowLabel=tctDateTimeStr(serverNow);
    job.period={from,to:serverNow};
    job.periodText=mode==='full'?'all available history':`${tctDateTimeStr(from)} \u2013 ${tctDateTimeStr(serverNow)} TCT`;
    job.logScanPeriod={from:logFrom,to:serverNow,incremental:mode==='quick',recheck:mode==='quick'&&last>0,missingDays:0};
    job.tradeScanPeriod={from:tradeFrom,to:serverNow,incremental:mode==='quick',recheck:mode==='quick'&&last>0,missingDays:0};
    job.logCursorTo=serverNow;job.tradeListParams=null;
  }
  async function prepareResumableSync(job) {
    job.paginationVersion=HISTORY_PAGINATION_VERSION;
    await refreshLiveSyncBounds(job);
    await ensureCatalog();setBusyDetail(job.syncMode==='full'?'Verifying API access for full-history rebuild\u2026':'Verifying API access for quick last-sync update\u2026');
    const keyInfo=await inspectActiveKey();if(!keyInfo.hasUserLog)throw new Error('This API key does not include User \u2192 Log access.');
    acceptAccountInfo(keyInfo);
    if(keyInfo.customLogPermissions)reportDiagnostic('LOG_SCOPE','warning','The API key restricts logs; historical coverage may be incomplete.',{source:'User Logs'});else resolveDiagnostic('LOG_SCOPE');
    if(job.syncMode==='full'&&!job.fullResetDone){await resetHistoryForFullResync();job.fullResetDone=true;await checkpointSyncJob(job,'Recovery copy saved \u00B7 starting full rebuild\u2026');}
    let types=[];if(job.logScanPeriod)types=relevantLogTypes(await ensureLogTypes(false));
    if(job.logScanPeriod&&!types.length)throw new Error('No relevant Torn transaction or free-acquisition log types were detected.');
    job.userId=keyInfo.userId;job.logTypeIds=types.map(x=>Number(x.id)).filter(x=>x>0);job.logBatches=initialLogBatches(job.logTypeIds);job.logMode='filtered';job.logBatchIndex=0;job.logCursorTo=job.logScanPeriod?.to||job.period.to;job.logPage=0;job.logPreviousSignature='';
    job.diagnostics=newSyncDiagnostics(job,'filtered',job.logTypeIds.length,job.logScanPeriod?job.logBatches.length:0);
    job.diagnostics.keyType=keyInfo.type;job.diagnostics.keyLevel=keyInfo.level;job.diagnostics.keySource=keySource();job.diagnostics.customLogPermissions=keyInfo.customLogPermissions;job.diagnostics.probeRows=0;
    job.diagnostics.recentLogRecheckHours=(job.period.to-job.logScanPeriod.from)/3600;job.diagnostics.recentTradeRecheckHours=(job.period.to-job.tradeScanPeriod.from)/3600;
    if(job.logScanPeriod){const scanLabel=job.syncMode==='full'?'Full resync from beginning':'Quick sync from last successful sync';job.phase='logs-filtered';await checkpointSyncJob(job,`${scanLabel} \u00B7 ${job.logScanPeriod.from>0?tctDateTimeStr(job.logScanPeriod.from)+' \u2013 ':''}${tctDateTimeStr(Math.min(job.logScanPeriod.to,job.tctNow||nowSec()))} TCT`);}
    else{job.phase='trades-list';await checkpointSyncJob(job,'Normal sale logs already fully covered \u00B7 skipping log scan.');}
  }
  async function finishResumableSync(job) {
    const complete=!!(job.completedSources?.log&&job.completedSources?.trade);
    if(!complete)throw new AnalyzerError('SYNC_INCOMPLETE','History sources did not finish. The last successful sync has not advanced.');
    const freshCount=finalizeResumableTransactions(job),d=job.diagnostics||{},serverNow=Number(job.tctNow)||nowSec();commitTradeVerifications(job);updateSyncCoverage(job);
    const nextSync={...state.sync,lastSync:serverNow,firstSyncComplete:!!(state.sync.firstSyncComplete||job.syncMode==='full'),autoDiscoveryComplete:true,diagnostics:d};
    if(job.repairWindow)nextSync.lastRepairSync=serverNow;
    if(job.syncMode==='full'){nextSync.accountingVersion=ACCOUNTING_VERSION;nextSync.historyPaginationVersion=HISTORY_PAGINATION_VERSION;}
    const oldCoverage=state.sync.coverageFrom==null?NaN:Number(state.sync.coverageFrom);
    nextSync.coverageFrom=Number.isFinite(oldCoverage)?Math.min(oldCoverage,job.period.from):job.period.from;
    nextSync.coverageTo=Math.max(Number(state.sync.coverageTo)||0,Math.min(job.period.to,serverNow));
    await flushDurableStorage();
    if(!save('sync',nextSync))throw new AnalyzerError('STORAGE_WRITE','The sync result could not be saved.');
    state.sync=nextSync;if(job.syncMode==='full')resolveDiagnostic('PARSER_UPDATED');
    if(job.syncMode==='full'){
      await clearFullResyncBackup();
      for(const code of ['PAGE_REPEATED','PAGE_INCOMPLETE','PAGE_BOUNDARY_UNVERIFIED','PAGE_ZERO_UNVERIFIED','HISTORY_COVERAGE_RECHECK',22])resolveDiagnostic(code);
      for(const source of ['log','pagination'])resolveDiagnostic('PAGE_SOURCE_MISMATCH',source);
      for(const code of ['STORAGE_QUOTA','STORAGE_WRITE','REBUILD_BACKUP_UNAVAILABLE'])for(const source of ['storage','sync','syncJob','transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial','syncCache'])resolveDiagnostic(code,source);
    }
    resolveDiagnostic('SYNC_FAILED');resolveDiagnostic('SYNC_CANCELLED');resolveDiagnostic('SYNC_PAUSED');
    const repaired=Number(d.missingLogDays)||0;
    if(!freshCount)setSyncProgress(`${job.syncMode==='full'?'Full Resync':'Quick Sync'} checked through ${tctDateTimeStr(serverNow)} TCT \u00B7 ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);
    else setSyncProgress(`${job.syncMode==='full'?'Full Resync':'Quick Sync'} checked through ${tctDateTimeStr(serverNow)} TCT \u00B7 ${qty(freshCount)} new item rows \u00B7 ${qty(d.foreignBuyQty||0)} overseas-acquired item(s) seen \u00B7 ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);
    job.active=false;job.phase='done';clearSyncJob();
  }
  async function migrateHistoryPagination(job) {
    if(job.paginationVersion===HISTORY_PAGINATION_VERSION)return false;
    job.paginationVersion=HISTORY_PAGINATION_VERSION;
    if(job.phase==='setup')return false;
    // Rewind legacy cursors inside the existing rebuild; its durable recovery
    // copy and already checkpointed rows stay intact. Upserts deduplicate them.
    job.phase=job.fullResetDone&&job.logTypeIds?.length?'logs-filtered':'setup';
    job.logMode='filtered';job.logBatches=initialLogBatches(job.logTypeIds||[]);job.logBatchIndex=0;job.logCursorTo=job.logScanPeriod?.to||job.period.to;
    job.logPage=0;job.logPageParams=null;job.logPageSeen=[];job.logLastPageIds=[];job.logPreviousSignature='';
    job.abroadPageParams=null;job.abroadPageSeen=[];job.abroadLastPageIds=[];
    job.tradeListParams=null;job.tradeListSeen=[];job.tradeHeaders=[];job.tradeDetailIndex=0;job.completedSources={};
    job.lastError='';job.lastErrorCode='';job.lastErrorContext={};
    job.diagnostics=newSyncDiagnostics(job,'filtered',job.logTypeIds?.length||0,job.logBatches.length);
    reportDiagnostic('CURSOR_CHECKPOINT_UPDATED','info','The saved scan was rewound to verify the original date range with updated cursor handling. Cached rows and the recovery copy were retained.',{source:'sync'});
    await checkpointSyncJob(job,'Rechecking saved history from the original scan boundary');return true;
  }
  async function runResumableSync(job,resumed=false,options={}) {
    const background=!!(options?.background||job?.background);
    if(state.syncing||state.backgroundSyncing)return;
    if(background)state.backgroundSyncing=true;else state.syncing=true;
    state.syncCancel=false;if(!background)updateFabState();
    if(resumed){const prior=String(job.progress||job.periodText).replace(/^Resumed after page reload \u00B7 /,'');job.resumedCount=(Number(job.resumedCount)||0)+1;job.progress=`Resumed after page reload \u00B7 ${prior}`;setSyncProgress(job.progress);}
    else setSyncProgress(job.progress||`Preparing historical scan for ${job.periodText}\u2026`);
    if(!background){
      setBusy(true,resumed?'Resuming financial sync':(job.syncMode==='full'?'Full history resync':'Quick financial sync'),state.syncProgress,true);
      const syncBtn=document.querySelector('#tta-root [data-act="sync"]');if(syncBtn){syncBtn.disabled=true;syncBtn.innerHTML='<span class="tta-sync"><span class="tta-spinner"></span>Syncing</span>';}
      if(state.open)await nextPaint();
    }
    try{
      if(resumed)await checkpointSyncJob(job,job.progress);
      await migrateHistoryPagination(job);
      while(!syncJobCancelled(job)&&job.active){
        if(job.phase==='setup')await prepareResumableSync(job);
        else if(job.phase==='logs-filtered'){
          await runResumableLogPhase(job,'filtered');if(syncJobCancelled(job))break;
          if((Number(job.diagnostics?.rawRows)||0)===0&&!job.logScanPeriod?.incremental){job.phase='logs-fallback';job.logMode='unfiltered';job.logBatchIndex=0;job.logCursorTo=job.logScanPeriod?.to||job.period.to;job.logPage=0;job.logPreviousSignature='';job.diagnostics=newSyncDiagnostics(job,'unfiltered-fallback',0,1);await checkpointSyncJob(job,'Baseline filtered scan returned no raw rows \u00B7 starting compatibility scan\u2026');}
          else{job.phase='logs-abroad-verify';await checkpointSyncJob(job,'Verifying Foreign/Abroad Buy logs independently\u2026');}
        }
        else if(job.phase==='logs-fallback'){await runResumableLogPhase(job,'unfiltered');if(syncJobCancelled(job))break;job.phase='logs-abroad-verify';await checkpointSyncJob(job,'Verifying Foreign/Abroad Buy logs independently\u2026');}
        else if(job.phase==='logs-abroad-verify')await runAbroadBuyVerification(job);
        else if(job.phase==='trades-list')await runResumableTradeList(job);
        else if(job.phase==='trade-details')await runResumableTradeDetails(job);
        else if(job.phase==='finalize'){await refreshFinancialSnapshot();await refreshCompanyDailyAdjustment(job.userId,Number(job.tctNow)||nowSec());await finishResumableSync(job);break;}
        else{job.phase='setup';await checkpointSyncJob(job,'Repairing an unknown sync checkpoint\u2026');}
      }
      if(syncJobCancelled(job)){
        job.cancelled=true;
        if(job.fullResetDone)await restoreFullResyncBackup(job);else{commitTradeVerifications(job);abandonResumableMarkers(job);}
        clearSyncJob();setSyncProgress(job.fullResetDone?'Sync stopped \u00B7 previous history restored.':'Sync stopped \u00B7 partial new rows kept safely.');
        reportDiagnostic('SYNC_CANCELLED','warning','Sync stopped before coverage was verified. Full rebuilds restore the previous history.',{source:'sync',phase:job.phase});
      }
    }catch(e){
      job.lastError=redactText(e?.message||e);job.lastErrorCode=typeof e?.code==='string'?e.code:'ACTION_FAILED';job.lastErrorContext=safeDiagnosticContext(e?.context||{});job.lastErrorAt=nowSec();diagnosticFromError(e,'sync');reportDiagnostic('SYNC_PAUSED','warning','History verification did not finish. Cached results may be incomplete.',{source:'sync',phase:job.phase});
      if(background&&!job.fullResetDone){
        try{commitTradeVerifications(job);abandonResumableMarkers(job);clearSyncJob();}catch(_){}
        state.backgroundSyncProgress=`Background Quick Sync skipped \u00B7 ${job.lastError}`;
      }else{
        try{await checkpointSyncJob(job,`Sync paused at saved checkpoint \u00B7 ${job.lastError} \u00B7 tap Sync or reload a Torn page to retry.`);}catch(saveError){diagnosticFromError(saveError,'checkpoint');setSyncProgress(`Sync stopped: ${saveError.message}`);if(!job.fullResetDone){clearSyncJob();try{abandonResumableMarkers(job);}catch(markerError){diagnosticFromError(markerError,'storage');}}}
      }
    }
    finally{
      if(background){state.backgroundSyncing=false;queueAnalyticsRender();}
      else{state.syncing=false;updateFabState();setBusy(false);render();}
    }
  }
  let manualSyncTakeover=false;
  async function yieldBackgroundSyncForManual() {
    if(!state.backgroundSyncing)return true;
    toast('Pausing background Quick Sync so your manual sync can start\u2026');
    state.syncCancel=true;
    const bgJob=loadSyncJob();
    if(bgJob?.background){bgJob.cancelled=true;bgJob.progress='Yielding to manual sync after the current API request\u2026';saveSyncJob(bgJob);}
    const deadline=Date.now()+30000;
    while(state.backgroundSyncing&&Date.now()<deadline)await sleep(50);
    if(state.backgroundSyncing){toast('Background sync is still finishing its current API request. Tap Sync again in a moment.');return false;}
    state.syncCancel=false;state.backgroundSyncProgress='';
    const leftover=loadSyncJob();if(leftover?.background)await discardStaleSyncJob(leftover);
    return true;
  }
  async function syncAll(options={}) {
    await historyRecoveryReady;
    if(historyRecoveryFailed)throw new AnalyzerError('REBUILD_RECOVERY','Restore the recovery copy before syncing. Free browser storage and reload.',{source:'storage'});
    if(!options.background&&state.backgroundSyncing){if(!await yieldBackgroundSyncForManual())return;}
    if(typeof navigator!=='undefined'&&navigator.locks?.request){
      return navigator.locks.request('torn-cash-flow-sync',{ifAvailable:true},async lock=>{
        if(!lock){reportDiagnostic('SYNC_OTHER_TAB','info','Another Torn tab is syncing. This tab retains its cached results.',{source:'sync'});queueAnalyticsRender();return;}
        resolveDiagnostic('SYNC_OTHER_TAB');return syncWithLocalState(options);
      });
    }
    reportDiagnostic('SYNC_LOCK_UNAVAILABLE','info','This browser cannot coordinate syncs across Torn tabs. Keep only one analyzer tab syncing.',{source:'sync'});
    return syncWithLocalState(options);
  }
  async function syncWithLocalState(options={}) {
    const background=!!options?.background;
    if(background){if(state.syncing||state.backgroundSyncing||manualSyncTakeover)return;}
    else{
      if(state.syncing||manualSyncTakeover)return;
      manualSyncTakeover=true;
      try{
        if(state.backgroundSyncing){const yielded=await yieldBackgroundSyncForManual();if(!yielded)return;}
        if(state.syncing)return;
      }finally{manualSyncTakeover=false;}
    }
    if(!hasApiKey()){if(!background){state.demo=true;toast('Add a Torn API key in Settings \u2192 API Key to sync real history.');}return;}
    const requestedMode=options?.mode==='full'?'full':'quick';
    let job=options?.job||loadSyncJob();
    if(load('fullResyncBackup',null)&&!job?.fullResetDone)await restoreFullResyncBackup({fullResetDone:true});
    if(background&&job&&!options?.job)return;
    if(job?.background&&!background&&!options?.job){await discardStaleSyncJob(job);job=null;}
    if(job?.cancelled){await discardStaleSyncJob(job);job=null;}
    if(job&&!options?.job&&job.syncMode!==requestedMode){await discardStaleSyncJob(job);job=null;}
    if(job&&!options?.job&&syncJobIsStale(job)){await discardStaleSyncJob(job);job=null;}
    if(!job)job=await createResumableSyncJob(requestedMode,background);
    if(background)job.background=true;
    return runResumableSync(job,!!options?.resume||Number(job.resumedCount)>0||job.phase!=='setup',{background});
  }
  async function resumePendingSync() {
    if(resumeBootStarted||state.syncing||state.backgroundSyncing)return;
    const job=loadSyncJob();if(!job)return;
    if(job.background||job.cancelled){await discardStaleSyncJob(job);return;}
    // Do not auto-resume checkpoints whose end time is already stale; the next manual Sync starts fresh.
    if(syncJobIsStale(job)){await discardStaleSyncJob(job);setSyncProgress('Expired old sync checkpoint cleared. Press Sync to verify current TCT and fill missing days.');return;}
    resumeBootStarted=true;await syncAll({job,resume:true,mode:job.syncMode||'quick'});
  }
  function persistSyncCancellation() {
    const job=loadSyncJob();if(!job)return;job.cancelled=true;job.progress='Stopping after the current API request\u2026';saveSyncJob(job);
  }
  document.addEventListener('click',e=>{const el=e.target?.closest?.('#tta-root [data-act="cancelSync"]');if(el)persistSyncCancellation();},true);

  let backgroundQuickSyncTimer=0;
  async function backgroundQuickSyncTick() {
    if(!hasApiKey()||state.syncing||state.backgroundSyncing)return;
    if(loadSyncJob())return;
    try{await syncAll({mode:'quick',background:true});}catch(error){diagnosticFromError(error,'background sync');queueAnalyticsRender();}
  }
  function startBackgroundQuickSync() {
    if(backgroundQuickSyncTimer)return;
    backgroundQuickSyncTimer=setInterval(()=>{void backgroundQuickSyncTick();},BACKGROUND_QUICK_SYNC_MS);
  }

  function rawLogKey(r) {
    return String(r?.id??`${r?.timestamp||0}:${r?.details?.id||0}:${JSON.stringify(r?.data||r?.params||{})}`);
  }
