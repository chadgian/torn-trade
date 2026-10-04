  const DIAGNOSTIC_CONTEXT = new Set(['source','itemId','tradeId','logId','timestamp','from','to','count','qty','status','apiCode','phase','cursor','nextCursor']);
  function safeDiagnosticContext(context={}) {
    const result={};
    for(const [key,value] of Object.entries(context)) {
      if(!DIAGNOSTIC_CONTEXT.has(key))continue;
      if(typeof value==='number'&&Number.isFinite(value))result[key]=value;
      else if(key==='source'||key==='phase')result[key]=redactText(String(value)).slice(0,100);
      else if((key==='cursor'||key==='nextCursor')&&/^\d{1,30}$/.test(String(value)))result[key]=String(value);
    }
    return result;
  }
  function redactText(value) {
    let text=String(value||'').replace(/https?:\/\/[^\s]+/gi,'[URL omitted]').replace(/\b(key|token|authorization)\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]');
    for(const key of [savedApiKey(),injectedApiKey()])if(key)text=text.split(key).join('[redacted]');
    return text.slice(0,300);
  }
  function reportDiagnostic(code,severity,message,context={}) {
    if(!Array.isArray(state.notices))state.notices=[];
    const safe=safeDiagnosticContext(context),id=`${code}:${safe.source||''}:${safe.itemId||safe.tradeId||safe.logId||''}`;
    const previous=state.notices.find(x=>x.id===id);
    const notice={id,code,severity,message:redactText(message),context:safe,firstAt:previous?.firstAt||nowSec(),lastAt:nowSec(),occurrences:(previous?.occurrences||0)+1};
    state.notices=[notice,...state.notices.filter(x=>x.id!==id)].slice(0,80);
    try{localStorage.setItem(NS+'notices',JSON.stringify(state.notices));}catch(_){}
    return notice;
  }
  function resolveDiagnostic(code,source) {
    state.notices=(state.notices||[]).filter(x=>!(x.code===code&&(source==null||x.context?.source===source)));
    try{localStorage.setItem(NS+'notices',JSON.stringify(state.notices));}catch(_){}
  }
  function resolveDiagnosticForTrade(code,tradeId) {
    state.notices=(state.notices||[]).filter(x=>!(x.code===code&&Number(x.context?.tradeId)===Number(tradeId)));
    try{localStorage.setItem(NS+'notices',JSON.stringify(state.notices));}catch(_){}
  }
  function diagnosticFromError(error,source='interface') {
    if(error?.name==='QuotaExceededError'||error?.code===22||error?.code==='QuotaExceeded'||error?.code==='GlobalQuotaExceeded')return reportDiagnostic('STORAGE_QUOTA','error','Storage is full. Increase the Torn PDA script limit or free browser site storage, then retry. The last successful sync has not advanced.',{source:'storage'});
    return reportDiagnostic(typeof error?.code==='string'?error.code:'ACTION_FAILED','error',error instanceof AnalyzerError?error.message:'The action failed. Your cached history is still available.',{source,...(error?.context||{})});
  }

  const DEVELOPER_PROFILE_URL='https://www.torn.com/profiles.php?XID=4325416';
  function diagnosticGuidance(row) {
    const code=String(row?.code||'ACTION_FAILED'),severity=String(row?.severity||'warning'),source=String(row?.context?.source||''),apiCode=Number(row?.context?.apiCode)||0;
    if(code==='API_ACCESS'){
      if(source.includes('/company/'))return {text:'This key does not grant the requested Company selection. If you want company P/L tracking, use Settings → Create key and include Company Profile and Employees, then Save & test. Other analyzer features can continue.',contact:false,developerOnly:false};
      if(source==='/user/networth'||source==='/user/money')return {text:'This key is missing a financial selection. Use Settings → Create key, create the analyzer key, then Save & test it. Your cached history remains safe.',contact:false,developerOnly:false};
      return {text:'Torn rejected this request because the API key does not have enough access. Open Settings → Create key, generate the analyzer-specific key with the requested selections, paste it into Settings, then Save & test before syncing again.',contact:false,developerOnly:false};
    }
    if(code==='NETWORTH_UNAVAILABLE'&&apiCode===16)return {text:'Create a new analyzer key from Settings → Create key so User → Networth is included, then Save & test and refresh the financial snapshot.',contact:false,developerOnly:false};
    if(code==='MONEY_UNAVAILABLE'&&apiCode===16)return {text:'Create a new analyzer key from Settings → Create key so User → Money is included, then Save & test and refresh the financial snapshot.',contact:false,developerOnly:false};
    if(code==='COMPANY_UNAVAILABLE'&&apiCode===16)return {text:'If you use company P/L tracking, recreate the analyzer key with Company → Profile access. If you are not a company director, no action is needed for the rest of the analyzer.',contact:false,developerOnly:false};
    if(code==='COMPANY_WAGES_UNAVAILABLE'&&apiCode===16)return {text:'If you use company P/L tracking, recreate the analyzer key with Company → Employees access. Other analyzer features can continue.',contact:false,developerOnly:false};
    const direct={
      STORAGE_QUOTA:'In Torn PDA, open this script\'s Native storage setting and raise its limit. In another browser, export a JSON backup first, then free site storage if needed. Retry the sync after storage space is available.',
      STORAGE_WRITE:'Do not reset the analyzer. Reload Torn and retry once after checking available storage. If the storage warning remains, export a backup before clearing any browser/site data.',
      HISTORY_MISSING:'Run Quick Sync for current activity. Use Full Resync if you also need older acquisition history.',
      HISTORY_PARTIAL:'Run Full Resync and let it finish so older FIFO acquisitions can be verified.',
      HISTORY_COVERAGE_RECHECK:'Run Full Resync once with the current analyzer version to re-verify older pagination boundaries.',
      HISTORY_STALE:'Run Quick Sync to check recent activity.',
      RANGE_NOT_COVERED:'Run Full Resync if you need data from before the currently verified history range.',
      API_KEY_MISSING:'Open Settings and either save a Torn API key or use Torn PDA\'s injected key, then retry.',
      LOG_SCOPE:'Create or save an API key with unrestricted User Log access and the required analyzer selections, then sync again.',
      RATE_LIMIT:'Wait a few minutes before syncing again. Avoid running the analyzer in several Torn tabs at the same time.',
      CATALOG_STALE:'Open Settings and tap Refresh catalog, then return to the affected view.',
      SNAPSHOT_STALE:'Tap Refresh financial snapshot or run Quick Sync.',
      NETWORTH_UNAVAILABLE:'Retry Refresh financial snapshot later. Torn currently marks the v2 networth endpoint as unstable, so this can be temporary.',
      MONEY_UNAVAILABLE:'Run Quick Sync or Refresh financial snapshot again. If the key was recently changed, test it in Settings.',
      COMPANY_UNAVAILABLE:'Check that the API key includes Company Profile and that the account can access the company data, then sync again.',
      COMPANY_WAGES_UNAVAILABLE:'Check that the API key includes Company Employees and that the account has permission to view employees, then sync again.',
      FIFO_UNMATCHED:'Run Full Resync first. If the units are still unmatched, the acquisition may be older than the history Torn exposes or may come from an event the analyzer cannot identify yet.',
      FIFO_COST_UNKNOWN:'Refresh the item catalog and run Full Resync. The affected profit will remain excluded until a reliable acquisition cost or sale value is available.',
      ITEM_VALUE_MISSING:'Refresh the item catalog. If Torn does not provide a market value for that item, no user-side fix is required; the analyzer will keep the affected value excluded.',
      TRADE_DEFERRED:'Run Quick Sync again later. Torn may expose a completed trade before its full item detail is ready.',
      ACCOUNT_MISMATCH:'The saved history belongs to another Torn account. Export a backup first. Only reset analyzer data if you intentionally want to switch the analyzer to the current API-key account.',
      IMPORT_SYNC_ACTIVE:'Stop the active sync, then retry the import.',
      IMPORT_READ:'Confirm the selected file is the analyzer JSON backup and try importing it again.',
      INVALID_PERIOD:'Choose a start date that is on or before the end date.',
      SYNC_OTHER_TAB:'Let the other Torn tab finish syncing, or keep only one analyzer tab actively syncing.',
      SYNC_LOCK_UNAVAILABLE:'Keep only one Torn tab syncing at a time in this browser.',
      UNCLASSIFIED_FINANCE:'Review Insights for the excluded events. No manual correction is required unless a total looks wrong.',
      CASH_INFERRED:'No action is normally required. The analyzer inferred a safe value/category from the Torn log; review the event only if the total looks incorrect.',
      VALUATION_INFERRED:'No action is normally required. Mixed-trade values are estimates and are labeled as such.',
      FIFO_ORDER_INFERRED:'No action is normally required. Same-second FIFO ties use stable IDs because Torn did not provide a more precise ordering.'
    };
    const retryThenContact=new Set(['PAGE_REPEATED','PAGE_INCOMPLETE','PAGE_BOUNDARY_UNVERIFIED','PAGE_ZERO_UNVERIFIED','SYNC_PAUSED']);
    const developerOnly=new Set(['PAGE_SOURCE_MISMATCH','API_SCHEMA','TRADE_SOURCE_MISMATCH','ACTION_FAILED','REBUILD_RECOVERY','IMPORT_RECOVERY']);
    if(direct[code])return {text:direct[code],contact:severity==='error'&&!['STORAGE_QUOTA','STORAGE_WRITE'].includes(code),developerOnly:false};
    if(retryThenContact.has(code))return {text:'Reload Torn or tap Sync once to resume from the saved checkpoint. Do not reset the analyzer. If the same code returns, export the Data Quality report and contact the developer.',contact:true,developerOnly:false};
    if(developerOnly.has(code))return {text:'There is no recommended device-side data repair for this error. Keep the cached history, export the Data Quality report, and contact the developer with the details below.',contact:true,developerOnly:true};
    if(severity==='error')return {text:'Reload Torn and retry the same action once. If it fails again, keep the cached history, export the Data Quality report, and contact the developer.',contact:true,developerOnly:false};
    return {text:'No immediate action is required. If this warning persists or the displayed totals look wrong, export the Data Quality report and contact the developer.',contact:false,developerOnly:false};
  }
  function diagnosticSupportDetail(row) {
    const context=safeDiagnosticContext(row?.context||{}),parts=[`v${VERSION}`,String(row?.code||'UNKNOWN')];
    for(const key of ['source','phase','tradeId','itemId','logId','apiCode'])if(context[key]!=null&&context[key]!=='')parts.push(`${key}=${context[key]}`);
    return parts.join(' · ');
  }
  function diagnosticGuidanceHtml(row) {
    const g=diagnosticGuidance(row),detail=diagnosticSupportDetail(row);
    const contact=g.contact?`<div class="tta-diagnostic-contact"><a class="tta-btn secondary" href="${DEVELOPER_PROFILE_URL}" target="_blank" rel="noopener noreferrer">Contact developer on Torn</a><small>Include: ${esc(detail)}. Attach the exported Data Quality report if possible.</small></div>`:'';
    return `<div class="tta-diagnostic-guidance"><strong>Suggested action</strong><p>${esc(g.text)}</p>${contact}</div>`;
  }
  function dataQualityNotices() {
    const rows=[...(state.notices||[])],add=(code,message,context={})=>rows.push({code,severity:'warning',message,context});
    if(state.demo)return [...rows,{code:'DEMO_DATA',severity:'info',message:'Sample trade data. Connect a key in Settings for your history.',context:{}}];
    const last=Number(state.sync?.lastSync)||0;
    if(!last)add('HISTORY_MISSING','History has not been checked yet. Quick Sync starts today; Full Resync loads older acquisitions.');
    else if(nowSec()-last>300)add('HISTORY_STALE',`History was last checked ${tctDateTimeStr(last)} TCT. Recent sales may be missing.`,{timestamp:last});
    if(!state.sync?.firstSyncComplete)add('HISTORY_PARTIAL','Older acquisitions may be missing. Use Full Resync for historical FIFO coverage.');
    else if(state.sync.historyPaginationVersion!==HISTORY_PAGINATION_VERSION)add('HISTORY_COVERAGE_RECHECK','Earlier history was checked with older cursor handling. Full Resync verifies that no older batches were excluded.');
    if(state.sync?.diagnostics?.customLogPermissions&&!rows.some(row=>row.code==='LOG_SCOPE'))add('LOG_SCOPE','This key restricts log access. Events outside its permissions may be missing.');
    const requested=dateRange();
    if(state.sync?.coverageFrom!=null&&requested.from<Number(state.sync.coverageFrom))add('RANGE_NOT_COVERED','The selected period begins before the checked history.',{from:requested.from,to:state.sync.coverageFrom});
    let unmatched=0,unknown=0,estimated=0,orderingInferred=0;
    for(const id of ensureTxIndex().itemIds){const fifo=fifoAnalytics(id);if(fifo.orderingInferred)orderingInferred++;for(const event of fifo.events){
      if(event.side==='sell'){unmatched+=Number(event.unmatchedQty)||0;unknown+=Number(event.unknownCostQty)||0;}
    }
    }
    if(orderingInferred)rows.push({code:'FIFO_ORDER_INFERRED',severity:'info',message:`${qty(orderingInferred)} items contain same-second events without precise event ordering. FIFO ties use stable IDs.`,context:{count:orderingInferred}});
    if(requested.from>requested.to)add('INVALID_PERIOD','The selected start date is after the end date. No period totals can be calculated.');
    for(const row of effectiveTransactions())if(row.estimated||row.allocationMethod)estimated++;
    if(unmatched)add('FIFO_UNMATCHED',`${qty(unmatched)} sold units have no earlier recorded acquisition and are excluded from profit.`,{qty:unmatched});
    if(unknown)add('FIFO_COST_UNKNOWN',`${qty(unknown)} sold units have unknown acquisition cost or proceeds and are excluded from profit.`,{qty:unknown});
    if(estimated)add('VALUATION_INFERRED',`${qty(estimated)} item rows use allocated values. Mixed trades are estimates.`,{count:estimated});
    if(state.unrecognizedFinancial.length)add('UNCLASSIFIED_FINANCE',`${qty(state.unrecognizedFinancial.length)} financial events are excluded from totals. Review Insights.`,{count:state.unrecognizedFinancial.length});
    if(state.catalog.length&&nowSec()-Number(state.catalogUpdatedAt||0)>21600)add('CATALOG_STALE','Market values are more than six hours old; valuations may be stale.',{timestamp:state.catalogUpdatedAt||0});
    const snap=latestFinancialSnapshot();
    if(snap&&nowSec()-Number(snap.timestamp)>3600)add('SNAPSHOT_STALE','The financial snapshot is more than an hour old.',{timestamp:snap.timestamp});
    return rows;
  }
  function qualityHtml() {
    const notices=dataQualityNotices(),errors=notices.filter(x=>x.severity==='error').length;
    const label=errors?`${errors} error${errors===1?'':'s'} affecting data`:notices.length?`${notices.length} data-quality note${notices.length===1?'':'s'}`:'History checked';
    return `<div class="tta-quality ${errors?'error':notices.length?'warning':'ok'}" role="status"><span>${esc(label)}</span><button class="tta-btn secondary" data-act="diagnostics">Details</button></div>`;
  }
  function diagnosticsHtml() {
    const notices=dataQualityNotices(),d=state.sync?.diagnostics||{},st=durableStorageState||{};
    const backend=st.backend==='pda'?'Torn PDA native storage':st.backend==='indexeddb'?'Browser IndexedDB':'Browser localStorage fallback';
    const usage=st.quota>0?((st.used/1048576).toFixed(1)+' / '+(st.quota/1048576).toFixed(1)+' MB'):(st.backend==='localStorage'?'Shared browser quota':'Available');
    const storageHtml=`<section class="tta-fin-section"><h3>Storage</h3><div class="tta-fin-row"><span>History backend</span><b>${esc(backend)}</b></div><div class="tta-fin-row"><span>Usage</span><b>${esc(usage)}</b></div>${st.migrated?'<div class="tta-note">'+qty(st.migrated)+' legacy data sets were moved safely from localStorage during this session.</div>':''}</section>`;
    return `${header('Data Quality','Accuracy, freshness and report details',true)}<div class="tta-content"><div class="tta-sectionhead"><h3>Current data quality</h3><button class="tta-btn secondary" data-act="exportDiagnostics">Export report</button></div>${notices.map(n=>`<details class="tta-diagnostic ${n.severity}"><summary><code>${esc(n.code)}</code> ${esc(n.message)}</summary><p>${esc(n.severity)}${n.lastAt?' / '+esc(tctDateTimeStr(n.lastAt))+' TCT':''}</p>${diagnosticGuidanceHtml(n)}<pre>${esc(JSON.stringify(safeDiagnosticContext(n.context),null,2))}</pre></details>`).join('')||'<div class="tta-empty">No current data-quality warnings.</div>'}${storageHtml}<section class="tta-fin-section"><h3>Last scan</h3><div class="tta-fin-row"><span>History checked through</span><b>${state.sync.lastSync?esc(tctDateTimeStr(state.sync.lastSync))+' TCT':'Never'}</b></div><div class="tta-fin-row"><span>Log pages / trade details / deferred trades</span><b>${qty(d.pages)} / ${qty(d.tradeDetails)} / ${qty(d.tradeDetailsDeferred)}</b></div></section><button class="tta-btn secondary" data-act="clearDiagnostics">Clear recorded notices</button></div>`;
  }
  function diagnosticReport() {
    const d=state.sync?.diagnostics||{},counts={};
    for(const key of ['rawRows','pages','tradeListPages','tradeHeaders','tradeDetails','tradeDetailsDeferred','transactionRowsUpdated','boundaryRecoveries'])counts[key]=Number(d[key])||0;
    const job=loadSyncJob(),attemptCounts={};
    for(const key of Object.keys(counts))attemptCounts[key]=Number(job?.diagnostics?.[key])||0;
    const pendingSync=job?{mode:job.syncMode==='full'?'full':'quick',phase:redactText(job.phase),updatedAt:Number(job.updatedAt)||0,paused:!!job.lastError,counts:attemptCounts,context:safeDiagnosticContext({from:Number(job.period?.from)||0,to:Number(job.period?.to)||0,cursor:job.logPageParams?.nanostamp}),lastErrorCode:redactText(job.lastErrorCode||''),lastErrorContext:safeDiagnosticContext(job.lastErrorContext||{}),recoveryAvailable:!!load('fullResyncBackup',null)}:null;
    return {app:'Torn Cash Flow Analyzer',version:VERSION,generatedAt:nowSec(),lastSync:Number(state.sync.lastSync)||0,historyComplete:!!state.sync.firstSyncComplete,counts,pendingSync,notices:dataQualityNotices().map(n=>{const g=diagnosticGuidance(n);return {code:n.code,severity:n.severity,message:redactText(n.message),suggestedAction:redactText(g.text),supportDetail:diagnosticSupportDetail(n),context:safeDiagnosticContext(n.context)};})};
  }
