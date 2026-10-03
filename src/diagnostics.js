  const DIAGNOSTIC_CONTEXT = new Set(['source','itemId','tradeId','logId','timestamp','from','to','count','qty','status','apiCode','phase']);
  function safeDiagnosticContext(context={}) {
    const result={};
    for(const [key,value] of Object.entries(context)) {
      if(!DIAGNOSTIC_CONTEXT.has(key))continue;
      if(typeof value==='number'&&Number.isFinite(value))result[key]=value;
      else if(key==='source'||key==='phase')result[key]=redactText(String(value)).slice(0,100);
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
    return reportDiagnostic(error?.code||'ACTION_FAILED','error',error instanceof AnalyzerError?error.message:'The action failed. Your cached history is still available.',{...(error?.context||{}),source});
  }
  function dataQualityNotices() {
    const rows=[...(state.notices||[])],add=(code,message,context={})=>rows.push({code,severity:'warning',message,context});
    if(state.demo)return [...rows,{code:'DEMO_DATA',severity:'info',message:'Sample trade data. Connect a key in Settings for your history.',context:{}}];
    const last=Number(state.sync?.lastSync)||0;
    if(!last)add('HISTORY_MISSING','History has not been checked yet. Quick Sync starts today; Full Resync loads older acquisitions.');
    else if(nowSec()-last>300)add('HISTORY_STALE',`History was last checked ${tctDateTimeStr(last)} TCT. Recent sales may be missing.`,{timestamp:last});
    if(!state.sync?.firstSyncComplete)add('HISTORY_PARTIAL','Older acquisitions may be missing. Use Full Resync for historical FIFO coverage.');
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
    const notices=dataQualityNotices(),d=state.sync?.diagnostics||{};
    return `${header('Data Quality','Accuracy, freshness and report details',true)}<div class="tta-content"><div class="tta-sectionhead"><h3>Current data quality</h3><button class="tta-btn secondary" data-act="exportDiagnostics">Export report</button></div>${notices.map(n=>`<details class="tta-diagnostic ${n.severity}"><summary><code>${esc(n.code)}</code> ${esc(n.message)}</summary><p>${esc(n.severity)}${n.lastAt?' / '+esc(tctDateTimeStr(n.lastAt))+' TCT':''}</p><pre>${esc(JSON.stringify(safeDiagnosticContext(n.context),null,2))}</pre></details>`).join('')||'<div class="tta-empty">No current data-quality warnings.</div>'}<section class="tta-fin-section"><h3>Last scan</h3><div class="tta-fin-row"><span>History checked through</span><b>${state.sync.lastSync?esc(tctDateTimeStr(state.sync.lastSync))+' TCT':'Never'}</b></div><div class="tta-fin-row"><span>Log pages / trade details / deferred trades</span><b>${qty(d.pages)} / ${qty(d.tradeDetails)} / ${qty(d.tradeDetailsDeferred)}</b></div></section><button class="tta-btn secondary" data-act="clearDiagnostics">Clear recorded notices</button></div>`;
  }
  function diagnosticReport() {
    const d=state.sync?.diagnostics||{},counts={};
    for(const key of ['rawRows','pages','tradeListPages','tradeHeaders','tradeDetails','tradeDetailsDeferred','transactionRowsUpdated'])counts[key]=Number(d[key])||0;
    return {app:'Torn Cash Flow Analyzer',version:VERSION,generatedAt:nowSec(),lastSync:Number(state.sync.lastSync)||0,historyComplete:!!state.sync.firstSyncComplete,counts,notices:dataQualityNotices().map(n=>({code:n.code,severity:n.severity,message:redactText(n.message),context:safeDiagnosticContext(n.context)}))};
  }
