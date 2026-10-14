  const DIAGNOSTIC_CONTEXT = new Set(['source','itemId','tradeId','logId','timestamp','from','to','count','qty','status','apiCode','phase','cursor','nextCursor']);
  function safeDiagnosticContext(context={}) {
    const result={};
    for(const [key,value] of Object.entries(context)) {
      if(!DIAGNOSTIC_CONTEXT.has(key))continue;
      if(typeof value==='number'&&Number.isFinite(value))result[key]=value;
      else if(key==='source'||key==='phase'||key==='status')result[key]=redactText(String(value)).slice(0,100);
      else if((key==='cursor'||key==='nextCursor')&&/^\d{1,30}$/.test(String(value)))result[key]=String(value);
    }
    return result;
  }
  function redactText(value) {
    let text=String(value||'').replace(/https?:\/\/[^\s]+/gi,'[URL omitted]').replace(/\b(key|token|authorization)\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]');
    for(const key of [savedApiKey(),injectedApiKey()])if(key)text=text.split(key).join('[redacted]');
    return text.slice(0,300);
  }
  function clearRecordedDiagnostics() {
    state.notices=[];
    try{localStorage.setItem(NS+'notices','[]');}catch(_){}
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

  const DEVELOPER_TORN_ID=4325416;
  const DEVELOPER_PROFILE_URL='https://www.torn.com/profiles.php?XID='+DEVELOPER_TORN_ID;
  const SUPPORT_MAIL_KEY=NS+'pendingSupportTornMail';
  function diagnosticEnvironment() {
    const nav=globalThis.navigator||{},gm=globalThis.GM_info||null;
    const pda=!!(globalThis.PDA_storage||globalThis.window?.PDA_storage||typeof globalThis.window?.PDA_httpGet==='function');
    const manager=String(gm?.scriptHandler||gm?.script?.handler||'').trim();
    const managerVersion=String(gm?.version||'').trim();
    const runtime=pda?'Torn PDA':manager?manager:'Browser userscript environment';
    const platform=String(nav.userAgentData?.platform||nav.platform||'').trim();
    const mobile=typeof nav.userAgentData?.mobile==='boolean'?nav.userAgentData.mobile:/Android|iPhone|iPad|Mobile/i.test(String(nav.userAgent||''));
    return {
      runtime,
      scriptManager:manager?manager+(managerVersion?' '+managerVersion:''):(pda?'Torn PDA':'Not exposed'),
      platform:platform||'Not exposed',
      mobile:!!mobile,
      userAgent:redactText(nav.userAgent||'Not exposed'),
      language:String(nav.language||'Not exposed').slice(0,40),
      viewport:(globalThis.innerWidth&&globalThis.innerHeight)?globalThis.innerWidth+'x'+globalThis.innerHeight:'Not exposed',
      screen:(globalThis.screen?.width&&globalThis.screen?.height)?globalThis.screen.width+'x'+globalThis.screen.height:'Not exposed',
      devicePixelRatio:Number(globalThis.devicePixelRatio)||1,
      storageBackend:String(durableStorageState?.backend||'unknown'),
      page:String(globalThis.location?.pathname||'Not exposed').slice(0,120)
    };
  }
  function diagnosticTime(ts) {
    ts=Number(ts)||0;return ts?tctDateTimeStr(ts)+' TCT':'Never';
  }
  function diagnosticHeader(row) {
    return (String(row?.code||'UNKNOWN')+' - '+String(row?.message||'TCFA diagnostic')).slice(0,120);
  }
  function diagnosticTroubleshootingText(row) {
    const g=diagnosticGuidance(row),context=safeDiagnosticContext(row?.context||{}),env=diagnosticEnvironment(),d=state.sync?.diagnostics||{},job=loadSyncJob(),st=durableStorageState||{};
    const lines=[
      'Torn Cash Flow Analyzer - Troubleshooting Details',
      '',
      String(row?.severity||'warning').toUpperCase(),
      'Header: '+diagnosticHeader(row),
      'Code: '+String(row?.code||'UNKNOWN'),
      'Message: '+redactText(row?.message||''),
      'First detected: '+diagnosticTime(row?.firstAt),
      'Last detected: '+diagnosticTime(row?.lastAt),
      'Occurrences: '+Math.max(1,Number(row?.occurrences)||1),
      '',
      'Suggested action:',
      redactText(g.text),
      '',
      'TCFA:',
      'Version: '+VERSION,
      'Accounting version: '+ACCOUNTING_VERSION,
      'History complete: '+(state.sync?.firstSyncComplete?'Yes':'No'),
      'Last successful sync: '+diagnosticTime(state.sync?.lastSync),
      'Last successful Manual Quick Sync: '+diagnosticTime(state.sync?.lastManualQuickSync),
      'Last successful Full Resync: '+diagnosticTime(state.sync?.lastFullResync),
      '',
      'Environment:',
      'Runtime: '+env.runtime,
      'Script manager: '+env.scriptManager,
      'Platform: '+env.platform,
      'Mobile: '+(env.mobile?'Yes':'No'),
      'User agent: '+env.userAgent,
      'Language: '+env.language,
      'Viewport: '+env.viewport,
      'Screen: '+env.screen,
      'Device pixel ratio: '+env.devicePixelRatio,
      'Storage backend: '+env.storageBackend,
      'Torn page: '+env.page,
      'Storage usage: '+(st.quota>0?((Number(st.used)||0)/1048576).toFixed(1)+' / '+((Number(st.quota)||0)/1048576).toFixed(1)+' MB':'Not reported'),
      '',
      'Latest completed sync counters:',
      'Raw log rows: '+(Number(d.rawRows)||0),
      'Log pages: '+(Number(d.pages)||0),
      'Trade list pages: '+(Number(d.tradeListPages)||0),
      'Trade details: '+(Number(d.tradeDetails)||0),
      'Deferred trade details: '+(Number(d.tradeDetailsDeferred)||0),
      'Boundary recoveries: '+(Number(d.boundaryRecoveries)||0),
      'Log batch splits: '+(Number(d.logBatchSplits)||0),
      'Dense boundary recoveries: '+(Number(d.denseBoundaryRecoveries)||0)
    ];
    if(job){
      lines.push(
        '',
        'Current / interrupted sync:',
        'Mode: '+(job.syncMode==='full'?'Full Resync':'Quick Sync')+(job.background?' (background)':''),
        'Phase: '+redactText(job.phase||'unknown'),
        'Started: '+diagnosticTime(job.createdAt),
        'Last checkpoint: '+diagnosticTime(job.updatedAt),
        'Paused / failed: '+(job.lastError?'Yes':'No'),
        'Last error code: '+redactText(job.lastErrorCode||'None'),
        'Current raw log rows: '+(Number(job.diagnostics?.rawRows)||0),
        'Current log pages: '+(Number(job.diagnostics?.pages)||0),
        'Current trade list pages: '+(Number(job.diagnostics?.tradeListPages)||0),
        'Current trade details: '+(Number(job.diagnostics?.tradeDetails)||0),
        'Current deferred trade details: '+(Number(job.diagnostics?.tradeDetailsDeferred)||0)
      );
      const jobContext=safeDiagnosticContext(job.lastErrorContext||{});
      if(Object.keys(jobContext).length)lines.push('Last error context: '+JSON.stringify(jobContext));
    }
    lines.push('', 'Diagnostic context:', Object.keys(context).length?JSON.stringify(context,null,2):'No additional context.', '', 'Privacy:', 'API keys, authorization tokens, precise location, and unrelated financial history are not included.', '', 'This draft was generated by TCFA. The player must review it and press Send manually.');
    return lines.join('\n').slice(0,7000);
  }

  function diagnosticHtmlRow(label,value) {
    return '<tr><td style="padding:6px 8px;color:#9fb2bd;font-size:12px;vertical-align:top;width:42%;border-bottom:1px solid #ffffff12;">'+esc(label)+'</td><td style="padding:6px 8px;color:#f5f9fb;font-size:12px;vertical-align:top;border-bottom:1px solid #ffffff12;word-break:break-word;">'+esc(value)+'</td></tr>';
  }
  function diagnosticHtmlSection(title,rows) {
    return '<tr><td style="padding:14px 0 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.4px;color:#91cdf7;text-transform:uppercase;margin-bottom:6px;">'+esc(title)+'</div><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;background:#ffffff06;border:1px solid #ffffff14;border-radius:8px;">'+rows+'</table></td></tr>';
  }
  function diagnosticTroubleshootingHtml(row) {
    const g=diagnosticGuidance(row),context=safeDiagnosticContext(row?.context||{}),env=diagnosticEnvironment(),d=state.sync?.diagnostics||{},job=loadSyncJob(),st=durableStorageState||{};
    const severity=String(row?.severity||'warning').toLowerCase(),accent=severity==='error'?'#ff9da3':severity==='warning'?'#f0cc78':'#91cdf7';
    const storageUsage=st.quota>0?((Number(st.used)||0)/1048576).toFixed(1)+' / '+((Number(st.quota)||0)/1048576).toFixed(1)+' MB':'Not reported';
    const contextText=Object.keys(context).length?JSON.stringify(context,null,2):'No additional context.';
    const tcfaRows=[
      ['Version',VERSION],
      ['Accounting version',ACCOUNTING_VERSION],
      ['History complete',state.sync?.firstSyncComplete?'Yes':'No'],
      ['Last successful sync',diagnosticTime(state.sync?.lastSync)],
      ['Last successful Manual Quick Sync',diagnosticTime(state.sync?.lastManualQuickSync)],
      ['Last successful Full Resync',diagnosticTime(state.sync?.lastFullResync)]
    ].map(x=>diagnosticHtmlRow(x[0],x[1])).join('');
    const envRows=[
      ['Runtime',env.runtime],
      ['Script manager',env.scriptManager],
      ['Platform',env.platform],
      ['Mobile',env.mobile?'Yes':'No'],
      ['User agent',env.userAgent],
      ['Language',env.language],
      ['Viewport',env.viewport],
      ['Screen',env.screen],
      ['Device pixel ratio',String(env.devicePixelRatio)],
      ['Storage backend',env.storageBackend],
      ['Storage usage',storageUsage],
      ['Torn page',env.page]
    ].map(x=>diagnosticHtmlRow(x[0],x[1])).join('');
    const syncRows=[
      ['Raw log rows',String(Number(d.rawRows)||0)],
      ['Log pages',String(Number(d.pages)||0)],
      ['Trade list pages',String(Number(d.tradeListPages)||0)],
      ['Trade details',String(Number(d.tradeDetails)||0)],
      ['Deferred trade details',String(Number(d.tradeDetailsDeferred)||0)],
      ['Boundary recoveries',String(Number(d.boundaryRecoveries)||0)],
      ['Log batch splits',String(Number(d.logBatchSplits)||0)],
      ['Dense boundary recoveries',String(Number(d.denseBoundaryRecoveries)||0)]
    ].map(x=>diagnosticHtmlRow(x[0],x[1])).join('');
    let activeSync='';
    if(job){
      const jobContext=safeDiagnosticContext(job.lastErrorContext||{});
      const rows=[
        ['Mode',(job.syncMode==='full'?'Full Resync':'Quick Sync')+(job.background?' (background)':'')],
        ['Phase',redactText(job.phase||'unknown')],
        ['Started',diagnosticTime(job.createdAt)],
        ['Last checkpoint',diagnosticTime(job.updatedAt)],
        ['Paused / failed',job.lastError?'Yes':'No'],
        ['Last error code',redactText(job.lastErrorCode||'None')],
        ['Current raw log rows',String(Number(job.diagnostics?.rawRows)||0)],
        ['Current log pages',String(Number(job.diagnostics?.pages)||0)],
        ['Current trade list pages',String(Number(job.diagnostics?.tradeListPages)||0)],
        ['Current trade details',String(Number(job.diagnostics?.tradeDetails)||0)],
        ['Current deferred trade details',String(Number(job.diagnostics?.tradeDetailsDeferred)||0)]
      ];
      if(Object.keys(jobContext).length)rows.push(['Last error context',JSON.stringify(jobContext)]);
      activeSync=diagnosticHtmlSection('Current / interrupted sync',rows.map(x=>diagnosticHtmlRow(x[0],x[1])).join(''));
    }
    return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:760px;margin:0 auto;border-collapse:separate;background:#162832;border:1px solid #ffffff20;border-radius:12px;font-family:Arial,Helvetica,sans-serif;color:#f5f9fb;">'
      +'<tr><td style="padding:20px 22px;background:#203844;border-bottom:1px solid #ffffff18;">'
      +'<div style="font-size:11px;font-weight:700;letter-spacing:1px;color:'+accent+';text-transform:uppercase;margin-bottom:6px;">TCFA '+esc(severity.toUpperCase())+'</div>'
      +'<div style="font-size:20px;font-weight:800;line-height:1.3;color:#f5f9fb;">'+esc(String(row?.code||'UNKNOWN'))+'</div>'
      +'<div style="font-size:13px;line-height:1.55;color:#c8d8e0;margin-top:5px;">'+esc(redactText(row?.message||''))+'</div>'
      +'</td></tr>'
      +'<tr><td style="padding:18px 22px;">'
      +'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">'
      +diagnosticHtmlSection('Detection',[
        ['Subject',diagnosticHeader(row)],
        ['First detected',diagnosticTime(row?.firstAt)],
        ['Last detected',diagnosticTime(row?.lastAt)],
        ['Occurrences',String(Math.max(1,Number(row?.occurrences)||1))]
      ].map(x=>diagnosticHtmlRow(x[0],x[1])).join(''))
      +'<tr><td style="padding:14px 0 0;"><div style="padding:12px 14px;border-left:3px solid '+accent+';background:#ffffff08;border-radius:8px;"><div style="font-size:12px;font-weight:700;color:#f5f9fb;margin-bottom:5px;">Suggested action</div><div style="font-size:12px;line-height:1.6;color:#c8d8e0;">'+esc(redactText(g.text))+'</div></div></td></tr>'
      +diagnosticHtmlSection('TCFA and sync history',tcfaRows)
      +diagnosticHtmlSection('Environment',envRows)
      +diagnosticHtmlSection('Latest completed sync counters',syncRows)
      +activeSync
      +'<tr><td style="padding:14px 0 0;"><div style="font-size:12px;font-weight:700;letter-spacing:.4px;color:#91cdf7;text-transform:uppercase;margin-bottom:6px;">Diagnostic context</div><pre style="margin:0;padding:10px 12px;background:#0f1d25;border:1px solid #ffffff14;border-radius:8px;color:#d8e4ea;font-family:Consolas,Monaco,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">'+esc(contextText)+'</pre></td></tr>'
      +'<tr><td style="padding:14px 0 0;"><div style="padding:10px 12px;background:#79dfb30c;border:1px solid #79dfb326;border-radius:8px;color:#bcd0d9;font-size:11px;line-height:1.55;"><strong style="color:#79dfb3;">Privacy:</strong> API keys, authorization tokens, precise location, and unrelated financial history are not included.</div></td></tr>'
      +'<tr><td style="padding:14px 0 2px;text-align:center;color:#9fb2bd;font-size:10px;line-height:1.5;">Generated by Torn Cash Flow Analyzer v'+esc(VERSION)+'. The player reviewed this draft and manually chose whether to send it.</td></tr>'
      +'</table></td></tr></table>';
  }
  async function copyPlainText(text) {
    try{if(navigator?.clipboard?.writeText){await navigator.clipboard.writeText(text);return true;}}catch(_){}
    try{
      const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();const ok=document.execCommand('copy');area.remove();return !!ok;
    }catch(_){return false;}
  }
  async function copyDiagnosticTroubleshooting(index) {
    const row=dataQualityNotices()[Number(index)];if(!row)return false;
    return copyPlainText(diagnosticTroubleshootingText(row));
  }
  function openDiagnosticTornMail(index) {
    const row=dataQualityNotices()[Number(index)];if(!row)return false;
    const subject=diagnosticHeader(row),bodyText=diagnosticTroubleshootingText(row),bodyHtml=diagnosticTroubleshootingHtml(row),payload={createdAt:nowSec(),subject,bodyText,bodyHtml};
    try{localStorage.setItem(SUPPORT_MAIL_KEY,JSON.stringify(payload));}catch(_){}
    const url='https://www.torn.com/messages.php#/p=compose&XID='+DEVELOPER_TORN_ID+'&subject='+encodeURIComponent(subject);
    const opened=window.open(url,'_blank');if(!opened)window.location.href=url;
    return true;
  }
  function setSupportFieldValue(el,value) {
    if(!el)return false;
    try{
      const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,descriptor=Object.getOwnPropertyDescriptor(proto,'value');
      if(descriptor?.set)descriptor.set.call(el,value);else el.value=value;
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;
    }catch(_){try{el.value=value;return true;}catch(__){return false;}}
  }
  function setSupportEditableHtml(el,html) {
    if(!el)return false;
    try{el.innerHTML=String(html||'');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;}catch(_){return false;}
  }
  function setSupportBodyValue(root,html,fallbackText) {
    const iframe=document.querySelector('#mailcompose_ifr, iframe[id*="mailcompose"], iframe[title*="Rich Text" i]');
    try{const body=iframe?.contentDocument?.body;if(body)return setSupportEditableHtml(body,html);}catch(_){}
    const scope=root||document,textarea=scope.querySelector?.('textarea[name="message"],textarea[name="body"],textarea');
    if(textarea)return setSupportFieldValue(textarea,String(fallbackText||''));
    const editable=scope.querySelector?.('[contenteditable="true"]');
    if(editable)return setSupportEditableHtml(editable,html);
    return false;
  }
  async function prefillPendingSupportTornMail() {
    const href=String(location.href||'');
    if(!/messages\.php/i.test(String(location.pathname||''))||!href.includes('XID='+DEVELOPER_TORN_ID))return false;
    let payload=null;try{payload=JSON.parse(localStorage.getItem(SUPPORT_MAIL_KEY)||'null');}catch(_){}
    if(!payload||nowSec()-Number(payload.createdAt||0)>600){try{localStorage.removeItem(SUPPORT_MAIL_KEY);}catch(_){}return false;}
    for(let attempt=0;attempt<60;attempt++){
      const subject=document.querySelector('input[name="subject"],input.subject,input[placeholder*="subject" i]');
      if(!subject){await sleep(250);continue;}
      const scope=subject.closest('form')||document;
      const subjectDone=setSupportFieldValue(subject,String(payload.subject||''));
      const bodyDone=setSupportBodyValue(scope,String(payload.bodyHtml||''),String(payload.bodyText||payload.body||''));
      if(subjectDone&&bodyDone){try{localStorage.removeItem(SUPPORT_MAIL_KEY);}catch(_){}return true;}
      await sleep(250);
    }
    return false;
  }
  function diagnosticGuidance(row) {
    const code=String(row?.code||'ACTION_FAILED'),severity=String(row?.severity||'warning');
    const direct={
      STORAGE_QUOTA:'In Torn PDA, open this script\'s Native storage setting and raise its limit. In another browser, export a JSON backup first, then free site storage if needed. Retry the sync after storage space is available.',
      STORAGE_WRITE:'Do not reset the analyzer. Reload Torn and retry once after checking available storage. If the storage warning remains, export a backup before clearing any browser/site data.',
      HISTORY_MISSING:'Run Quick Sync for current activity. Use Full Resync if you also need older acquisition history.',
      HISTORY_PARTIAL:'Run Full Resync and let it finish so older FIFO acquisitions can be verified.',
      HISTORY_COVERAGE_RECHECK:'Run Full Resync once with the current analyzer version to re-verify older pagination boundaries.',
      PARSER_UPDATED:'Run Full Resync once so older financial events are reparsed with the current accounting rules, including exact bounty placement costs and fee breakdowns.',
      BOUNTY_COST_RECHECK:'Run Full Resync to replace legacy bounty-placement amounts with Torn\'s exact recorded cost, including listing and anonymous fees.',
      HISTORY_STALE:'Run Quick Sync to check recent activity.',
      RANGE_NOT_COVERED:'Run Full Resync if you need data from before the currently verified history range.',
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
      SYNC_OTHER_TAB:'Another Torn tab owns the TCFA sync lock. You can keep browsing the locally stored history in this tab; it will refresh when the active sync finishes. Start another sync only after the first tab releases the lock.',
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
    return parts.join(' \u00B7 ');
  }
  function diagnosticGuidanceHtml(row,index) {
    const g=diagnosticGuidance(row),detail=diagnosticSupportDetail(row),severity=String(row?.severity||'warning');
    const support=(severity==='error'||severity==='warning')?`<div class="tta-diagnostic-contact"><button class="tta-btn secondary" data-act="diagnosticTornMail" data-diagnostic-index="${Number(index)}">Open Torn Mail draft</button><button class="tta-btn secondary" data-act="copyDiagnostic" data-diagnostic-index="${Number(index)}">Copy troubleshooting details</button><a class="tta-btn secondary" href="${DEVELOPER_PROFILE_URL}" target="_blank" rel="noopener noreferrer">Developer profile</a><small>TCFA only opens and fills the Torn compose screen. Review the draft and press Send yourself. Support reference: ${esc(detail)}.</small></div>`:'';
    return `<div class="tta-diagnostic-guidance"><strong>Suggested action</strong><p>${esc(g.text)}</p>${support}</div>`;
  }
  function dataQualityNotices() {
    const rows=[...(state.notices||[])],add=(code,message,context={})=>rows.push({code,severity:'warning',message,context});
    if(state.demo)return [...rows,{code:'DEMO_DATA',severity:'info',message:'Sample trade data. Connect a key in Settings for your history.',context:{}}];
    const last=Number(state.sync?.lastSync)||0;
    if(!last)add('HISTORY_MISSING','History has not been checked yet. Quick Sync starts today; Full Resync loads older acquisitions.');
    else if(nowSec()-last>300)add('HISTORY_STALE',`History was last checked ${tctDateTimeStr(last)} TCT. Recent sales may be missing.`,{timestamp:last});
    if(!state.sync?.firstSyncComplete)add('HISTORY_PARTIAL','Older acquisitions may be missing. Use Full Resync for historical FIFO coverage.');
    else if(state.sync.historyPaginationVersion!==HISTORY_PAGINATION_VERSION)add('HISTORY_COVERAGE_RECHECK','Earlier history was checked with older cursor handling. Full Resync verifies that no older batches were excluded.');
    if((state.transactions.length||state.cashFlows.length)&&state.sync?.accountingVersion!==ACCOUNTING_VERSION&&!rows.some(row=>row.code==='PARSER_UPDATED'))add('PARSER_UPDATED','Accounting rules were updated. Full Resync reparses historical cash events, including exact bounty placement costs and fees.',{source:'migration'});
    const legacyBountyCosts=(state.cashFlows||[]).filter(row=>Number(row?.logId)===6700&&row?.bountyCostVerified!==true&&String(row?.field||'')!=='cost').length;
    if(legacyBountyCosts)add('BOUNTY_COST_RECHECK',`${qty(legacyBountyCosts)} bounty placement${legacyBountyCosts===1?'':'s'} may still show the listed reward instead of Torn's total placement cost.`,{count:legacyBountyCosts,source:'migration'});
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
    return `${header('Data Quality','Accuracy, freshness and report details',true)}<div class="tta-content"><div class="tta-sectionhead"><h3>Current data quality</h3><button class="tta-btn secondary" data-act="exportDiagnostics">Export report</button></div><div class="tta-note"><strong>Fresh diagnostic cycle:</strong> Starting a manual Quick Sync or Full Resync clears previously recorded notices before the new check begins. If an issue still exists, TCFA records it again; if it has been fixed, the old notice stays gone. Background syncs do not clear notices.</div>${notices.map((n,index)=>`<details class="tta-diagnostic ${n.severity}"><summary><code>${esc(n.code)}</code> ${esc(n.message)}</summary><p>${esc(n.severity)}${n.lastAt?' / '+esc(tctDateTimeStr(n.lastAt))+' TCT':''}</p>${diagnosticGuidanceHtml(n,index)}<pre>${esc(JSON.stringify(safeDiagnosticContext(n.context),null,2))}</pre></details>`).join('')||'<div class="tta-empty">No current data-quality warnings.</div>'}${storageHtml}<section class="tta-fin-section"><h3>Last scan</h3><div class="tta-fin-row"><span>Latest successful sync</span><b>${state.sync.lastSync?esc(tctDateTimeStr(state.sync.lastSync))+' TCT':'Never'}</b></div><div class="tta-fin-row"><span>Last Manual Quick Sync</span><b>${state.sync.lastManualQuickSync?esc(tctDateTimeStr(state.sync.lastManualQuickSync))+' TCT':'Never'}</b></div><div class="tta-fin-row"><span>Last Full Resync</span><b>${state.sync.lastFullResync?esc(tctDateTimeStr(state.sync.lastFullResync))+' TCT':'Never'}</b></div><div class="tta-fin-row"><span>Log pages / trade details / deferred trades</span><b>${qty(d.pages)} / ${qty(d.tradeDetails)} / ${qty(d.tradeDetailsDeferred)}</b></div></section><button class="tta-btn secondary" data-act="clearDiagnostics">Clear recorded notices</button></div>`;
  }
  function diagnosticReport() {
    const d=state.sync?.diagnostics||{},counts={};
    for(const key of ['rawRows','pages','tradeListPages','tradeHeaders','tradeDetails','tradeDetailsDeferred','transactionRowsUpdated','boundaryRecoveries','logBatchSplits','denseBoundaryRecoveries'])counts[key]=Number(d[key])||0;
    const job=loadSyncJob(),attemptCounts={};
    for(const key of Object.keys(counts))attemptCounts[key]=Number(job?.diagnostics?.[key])||0;
    const pendingSync=job?{mode:job.syncMode==='full'?'full':'quick',phase:redactText(job.phase),updatedAt:Number(job.updatedAt)||0,paused:!!job.lastError,counts:attemptCounts,context:safeDiagnosticContext({from:Number(job.period?.from)||0,to:Number(job.period?.to)||0,cursor:job.logPageParams?.nanostamp}),lastErrorCode:redactText(job.lastErrorCode||''),lastErrorContext:safeDiagnosticContext(job.lastErrorContext||{}),recoveryAvailable:!!load('fullResyncBackup',null)}:null;
    return {app:'Torn Cash Flow Analyzer',version:VERSION,accountingVersion:ACCOUNTING_VERSION,generatedAt:nowSec(),lastSync:Number(state.sync.lastSync)||0,lastManualQuickSync:Number(state.sync.lastManualQuickSync)||0,lastFullResync:Number(state.sync.lastFullResync)||0,historyComplete:!!state.sync.firstSyncComplete,environment:diagnosticEnvironment(),counts,pendingSync,notices:dataQualityNotices().map(n=>{const g=diagnosticGuidance(n);return {code:n.code,severity:n.severity,message:redactText(n.message),firstAt:Number(n.firstAt)||0,lastAt:Number(n.lastAt)||0,occurrences:Number(n.occurrences)||1,suggestedAction:redactText(g.text),supportDetail:diagnosticSupportDetail(n),context:safeDiagnosticContext(n.context)};})};
  }
