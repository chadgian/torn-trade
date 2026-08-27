from pathlib import Path
p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.0','// @version      0.2.1',1)
s=s.replace("const VERSION = '0.2.0';","const VERSION = '0.2.1';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with FIFO profit tracking. Data stays on-device.','Torn cash-flow, spending, earnings, net-worth and trade analytics with fast last-sync updates and optional full-history resync. Data stays on-device.',1)

old="""  function createResumableSyncJob() {
    stripSyncRunMarkers();
    const period=selectedPeriodBoundsTct(nowSec()),periodText=period.from>0?`${tctDateStr(period.from)} – ${tctDateStr(Math.min(period.to,nowSec()))} TCT`:'all available history';
    const logScanPeriod=incrementalPeriod(period,'log'),tradeScanPeriod=incrementalPeriod(period,'trade');
    const job={schema:SYNC_JOB_SCHEMA_VERSION,id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,active:true,cancelled:false,createdAt:nowSec(),updatedAt:nowSec(),period,periodText,logScanPeriod,tradeScanPeriod,phase:'setup',progress:`Preparing incremental sync for ${periodText}…`,resumedCount:0,logTypeIds:[],logMode:'filtered',logBatchIndex:0,logCursorTo:logScanPeriod?.to||period.to,logPage:0,logPreviousSignature:'',userId:0,diagnostics:null,tradeHeaders:[],tradeListParams:null,tradeListSeen:[],tradeDetailIndex:0,verifiedTradeIds:[],verifiedTradeTimes:{}};
    checkpointSyncJob(job,job.progress);return job;
  }
"""
new="""  function createResumableSyncJob(syncMode='quick') {
    stripSyncRunMarkers();
    const mode=syncMode==='full'?'full':'quick',now=nowSec(),last=Number(state.sync?.lastSync)||0;
    const initialFrom=mode==='full'?0:(last>0?Math.min(last,now):tctDayStart(now));
    const period={from:initialFrom,to:now},periodText=mode==='full'?'all available history':`${tctDateTimeStr(initialFrom)} – ${tctDateTimeStr(now)} TCT`;
    const scan={from:period.from,to:period.to,incremental:mode==='quick',recheck:false,missingDays:0};
    const job={schema:SYNC_JOB_SCHEMA_VERSION,id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,syncMode:mode,active:true,cancelled:false,createdAt:now,updatedAt:now,period,periodText,logScanPeriod:{...scan},tradeScanPeriod:{...scan},phase:'setup',progress:mode==='full'?`Preparing full resync from the beginning…`:`Preparing quick sync from ${tctDateTimeStr(initialFrom)} TCT…`,resumedCount:0,logTypeIds:[],logMode:'filtered',logBatchIndex:0,logCursorTo:period.to,logPage:0,logPreviousSignature:'',userId:0,diagnostics:null,tradeHeaders:[],tradeListParams:null,tradeListSeen:[],tradeDetailIndex:0,verifiedTradeIds:[],verifiedTradeTimes:{}};
    checkpointSyncJob(job,job.progress);return job;
  }

  function resetHistoryForFullResync() {
    stripSyncRunMarkers();
    state.transactions=[];state.cashFlows=[];
    save('transactions',[]);save('cashFlows',[]);
    localStorage.removeItem(NS+'syncCache');syncCacheMem=null;
    state.sync={...(state.sync||{}),lastSync:0,coverageFrom:0,coverageTo:0,firstSyncComplete:false,autoDiscoveryComplete:false};save('sync',state.sync);
    resumableTxMap=null;resumableTxJob='';resetAnalyticsCache();
  }
"""
assert old in s
s=s.replace(old,new,1)

old="""  async function refreshLiveSyncBounds(job) {
    let serverNow=nowSec();
    try{const t=await apiGet('/user/timestamp');serverNow=Number(t?.timestamp)||serverNow;}catch(_){}
    const wanted=selectedPeriodBoundsTct(serverNow);
    job.tctNow=serverNow;job.tctNowLabel=tctDateTimeStr(serverNow);
    job.period={from:wanted.from,to:wanted.to};
    job.periodText=wanted.from>0?`${tctDateStr(wanted.from)} – ${tctDateStr(Math.min(wanted.to,serverNow))} TCT`:'all available history';
    job.logScanPeriod=incrementalPeriod(job.period,'log',serverNow);
    job.tradeScanPeriod=incrementalPeriod(job.period,'trade',serverNow);
    job.logCursorTo=job.logScanPeriod?.to||job.period.to;
    job.tradeListParams=null;
  }
"""
new="""  async function refreshLiveSyncBounds(job) {
    let serverNow=nowSec();
    try{const t=await apiGet('/user/timestamp');serverNow=Number(t?.timestamp)||serverNow;}catch(_){}
    const mode=job.syncMode==='full'?'full':'quick',last=Number(state.sync?.lastSync)||0;
    const from=mode==='full'?0:(last>0?Math.min(last,serverNow):tctDayStart(serverNow));
    job.tctNow=serverNow;job.tctNowLabel=tctDateTimeStr(serverNow);
    job.period={from,to:serverNow};
    job.periodText=mode==='full'?'all available history':`${tctDateTimeStr(from)} – ${tctDateTimeStr(serverNow)} TCT`;
    const scan={from,to:serverNow,incremental:mode==='quick',recheck:false,missingDays:0};
    job.logScanPeriod={...scan};job.tradeScanPeriod={...scan};
    job.logCursorTo=serverNow;job.tradeListParams=null;
  }
"""
assert old in s
s=s.replace(old,new,1)

s=s.replace("setBusyDetail('Verifying API access and incremental coverage…');","setBusyDetail(job.syncMode==='full'?'Verifying API access for full-history rebuild…':'Verifying API access for quick last-sync update…');",1)

old="""    if(job.logScanPeriod){const missing=Number(job.logScanPeriod.missingDays)||0,scanLabel=missing?`Filling ${missing} missing TCT day${missing===1?'':'s'}`:(job.logScanPeriod.incremental?(job.logScanPeriod.recheck?'Refreshing current/recent TCT data':'Scanning new TCT data'):'Establishing TCT baseline');job.phase='logs-filtered';checkpointSyncJob(job,`${scanLabel} · ${tctDateStr(job.logScanPeriod.from)} – ${tctDateStr(Math.min(job.logScanPeriod.to,job.tctNow||nowSec()))} TCT`);}
"""
new="""    if(job.logScanPeriod){const scanLabel=job.syncMode==='full'?'Full resync from beginning':'Quick sync from last successful sync';job.phase='logs-filtered';checkpointSyncJob(job,`${scanLabel} · ${job.logScanPeriod.from>0?tctDateTimeStr(job.logScanPeriod.from)+' – ':''}${tctDateTimeStr(Math.min(job.logScanPeriod.to,job.tctNow||nowSec()))} TCT`);}
"""
assert old in s
s=s.replace(old,new,1)

s=s.replace("const verifyFrom=Number(job.period?.from)>0?Number(job.period.from):Math.max(0,serverNow-30*86400);","const verifyFrom=job.syncMode==='full'?0:(Number(job.period?.from)>0?Number(job.period.from):tctDayStart(serverNow));",1)

old="""  async function syncAll(options={}) {
    if(state.syncing)return;
    if(!hasApiKey()){state.demo=true;toast('Add a Torn API key in Settings → API Key to sync real history.');return;}
    let job=options?.job||loadSyncJob();
    if(job?.cancelled){abandonResumableMarkers(job);clearSyncJob();job=null;}
    // Manual Sync must never stay trapped on an old saved window. Keep recent checkpoints resumable,
    // but retire stale/mismatched ones while preserving already-downloaded rows and verified trades.
    if(job&&!options?.job&&!syncJobMatchesCurrentSelection(job)){discardStaleSyncJob(job);job=null;setSyncProgress('Old sync checkpoint retired · rebuilding TCT day coverage through current Torn server time…');}
    if(!job)job=createResumableSyncJob();
    return runResumableSync(job,!!options?.resume||Number(job.resumedCount)>0||job.phase!=='setup');
  }
"""
new="""  async function syncAll(options={}) {
    if(state.syncing)return;
    if(!hasApiKey()){state.demo=true;toast('Add a Torn API key in Settings → API Key to sync real history.');return;}
    const requestedMode=options?.mode==='full'?'full':'quick';
    let job=options?.job||loadSyncJob();
    if(job?.cancelled){abandonResumableMarkers(job);clearSyncJob();job=null;}
    if(job&&!options?.job&&job.syncMode!==requestedMode){discardStaleSyncJob(job);job=null;}
    if(job&&!options?.job&&syncJobIsStale(job)){discardStaleSyncJob(job);job=null;}
    if(!job){
      if(requestedMode==='full')resetHistoryForFullResync();
      job=createResumableSyncJob(requestedMode);
    }
    return runResumableSync(job,!!options?.resume||Number(job.resumedCount)>0||job.phase!=='setup');
  }
"""
assert old in s
s=s.replace(old,new,1)

s=s.replace("resumeBootStarted=true;syncAll({job,resume:true});","resumeBootStarted=true;syncAll({job,resume:true,mode:job.syncMode||'quick'});",1)

s=s.replace("const syncBtn=document.querySelector('#tta-root [data-act=\"sync\"]');if(syncBtn){syncBtn.disabled=true;syncBtn.innerHTML='<span class=\"tta-sync\"><span class=\"tta-spinner\"></span>Syncing</span>';}","document.querySelectorAll('#tta-root [data-act=\"syncQuick\"],#tta-root [data-act=\"syncFull\"],#tta-root [data-act=\"sync\"]').forEach(syncBtn=>{syncBtn.disabled=true;});",1)

s=s.replace("else if(act==='sync'){syncAll();}","else if(act==='sync'||act==='syncQuick'){syncAll({mode:'quick'});}\n      else if(act==='syncFull'){if(confirm('Full Resync will rebuild the locally discovered cash-flow and trade history from the beginning. This can take a long time. Continue?'))syncAll({mode:'full'});}",1)

oldbtn="""<button class=\"tta-btn secondary\" data-act=\"sync\" ${state.syncing?'disabled':''}>${state.syncing?'Syncing…':'↻ Sync'}</button>"""
newbtn="""<div class=\"tta-syncactions\"><button class=\"tta-btn\" data-act=\"syncQuick\" ${state.syncing?'disabled':''}>${state.syncing?'Syncing…':'⚡ Quick Sync'}</button><button class=\"tta-btn secondary\" data-act=\"syncFull\" ${state.syncing?'disabled':''}>⟳ Full Resync</button></div>"""
count=s.count(oldbtn)
assert count>=2, count
s=s.replace(oldbtn,newbtn)

needle=".tta-cashhero{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 13px}"
assert needle in s
s=s.replace(needle,needle+".tta-syncactions{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.tta-syncactions .tta-btn{min-height:36px;padding:7px 10px}",1)

s=s.replace("setBusy(true,resumed?'Resuming trade history sync':'Syncing trade history',state.syncProgress,true);","setBusy(true,resumed?'Resuming financial sync':(job.syncMode==='full'?'Full history resync':'Quick financial sync'),state.syncProgress,true);",1)
s=s.replace("if(!freshCount)setSyncProgress(`Sync checked through ${tctDateTimeStr(serverNow)} TCT · ${repaired?`${qty(repaired)} missing TCT day(s) filled · `:''}current/recent logs refreshed · ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);","if(!freshCount)setSyncProgress(`${job.syncMode==='full'?'Full Resync':'Quick Sync'} checked through ${tctDateTimeStr(serverNow)} TCT · ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);",1)
s=s.replace("else setSyncProgress(`Sync checked through ${tctDateTimeStr(serverNow)} TCT · ${repaired?`${qty(repaired)} missing TCT day(s) filled · `:''}${qty(freshCount)} new item rows · ${qty(d.foreignBuyQty||0)} overseas-acquired item(s) seen · ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);","else setSyncProgress(`${job.syncMode==='full'?'Full Resync':'Quick Sync'} checked through ${tctDateTimeStr(serverNow)} TCT · ${qty(freshCount)} new item rows · ${qty(d.foreignBuyQty||0)} overseas-acquired item(s) seen · ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);",1)

s=s.replace("mode,periodFrom:job.period.from","mode,syncMode:job.syncMode||'quick',periodFrom:job.period.from",1)

p.write_text(s)

r=Path('README.md')
rd=r.read_text()
rd=rd.replace('**Current version:** v0.2.0','**Current version:** v0.2.1',1)
rd += '''\n\n## v0.2.1 — Quick Sync and Full Resync\n\nSyncing is now split into two explicit modes:\n\n- **Quick Sync** is the normal everyday action. It ignores the selected analytics period and scans only from the last successful Torn City Time sync through the current TCT. If no successful sync exists yet, it starts at the beginning of the current TCT day.\n- **Full Resync** clears locally discovered transaction/cash-flow history and sync coverage, then rebuilds from the beginning of available history. It preserves analyzer settings such as API configuration, pins, hidden items and display preferences.\n- Saved sync jobs remember which mode they belong to, so a Quick Sync cannot accidentally resume an old Full Resync and vice versa.\n'''
r.write_text(rd)
