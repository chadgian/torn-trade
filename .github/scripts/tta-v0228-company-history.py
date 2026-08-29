from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='utf-8')

s=s.replace('// @version      0.2.27','// @version      0.2.28',1)
s=s.replace("const VERSION = '0.2.27';","const VERSION = '0.2.28';",1)
s=s.replace('company=profile,employees&torn=items,logtypes','company=profile,employees,snapshot&torn=items,logtypes',1)

state_anchor="""    playerTransfers: load('playerTransfers', []),
    unrecognizedFinancial: load('unrecognizedFinancial', []),"""
state_new="""    playerTransfers: load('playerTransfers', []),
    companyHistory: load('companyHistory', []),
    unrecognizedFinancial: load('unrecognizedFinancial', []),"""
if state_anchor not in s: raise SystemExit('state anchor missing')
s=s.replace(state_anchor,state_new,1)

old_http="""  async function httpGet(url) {
    let text;
    if (typeof window.PDA_httpGet === 'function') {
      const r = await window.PDA_httpGet(url, {});
      if (r.status && r.status >= 400) throw new Error(`HTTP ${r.status}`);
      text = r.responseText;
    } else {
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      text = await r.text();
    }
    const json = JSON.parse(text);
    if (json.error) throw new Error(`Torn API ${json.error.code}: ${json.error.error}`);
    return json;
  }
"""
new_http="""  async function httpGetText(url) {
    let text;
    if (typeof window.PDA_httpGet === 'function') {
      const r = await window.PDA_httpGet(url, {});
      if (r.status && r.status >= 400) throw new Error(`HTTP ${r.status}`);
      text = r.responseText;
    } else {
      const r = await fetch(url, { credentials: 'omit' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      text = await r.text();
    }
    return String(text ?? '');
  }

  async function httpGet(url) {
    const text=await httpGetText(url);
    const json=JSON.parse(text);
    if (json.error) throw new Error(`Torn API ${json.error.code}: ${json.error.error}`);
    return json;
  }
"""
if old_http not in s: raise SystemExit('httpGet anchor missing')
s=s.replace(old_http,new_http,1)

api_anchor="""    return httpGet(u.toString());
  }

  function injectCss() {"""
api_new="""    return httpGet(u.toString());
  }

  async function apiGetText(path, params = {}) {
    const key=activeApiKey();
    if (!key) throw new Error('No Torn API key is configured. Add one in Settings \\u2192 API Key.');
    const u = new URL(API + path);
    u.searchParams.set('key', key);
    u.searchParams.set('comment', 'TornTradeAnalyzer');
    Object.entries(params).forEach(([k,v]) => { if (v !== '' && v != null) u.searchParams.set(k, String(v)); });
    const text=await httpGetText(u.toString());
    const trimmed=text.trim();
    if(trimmed.startsWith('{')){
      try{const json=JSON.parse(trimmed);if(json?.error)throw new Error(`Torn API ${json.error.code}: ${json.error.error}`);}catch(e){if(String(e?.message||'').startsWith('Torn API '))throw e;}
    }
    return text;
  }

  function injectCss() {"""
if api_anchor not in s: raise SystemExit('apiGet anchor missing')
s=s.replace(api_anchor,api_new,1)

company_anchor="""  async function refreshCompanyDailyAdjustment(userId,serverNow=nowSec()) {"""
company_funcs=r'''  function parseCsvRow(line) {
    const out=[];let cur='',quoted=false;
    for(let i=0;i<String(line||'').length;i++){
      const ch=line[i];
      if(ch==='"'){
        if(quoted&&line[i+1]==='"'){cur+='"';i++;}
        else quoted=!quoted;
      }else if(ch===','&&!quoted){out.push(cur);cur='';}
      else cur+=ch;
    }
    out.push(cur);return out;
  }
  function companySnapshotRecord(csv,companyId) {
    const lines=String(csv||'').trim().split(/\r?\n/).filter(Boolean);if(lines.length<2)return null;
    const header=parseCsvRow(lines[0].replace(/^\uFEFF/,'')).map(x=>String(x||'').trim().toLowerCase());
    const idIndex=header.indexOf('id'),incomeIndex=header.indexOf('daily_income'),customersIndex=header.indexOf('daily_customers'),weeklyIncomeIndex=header.indexOf('weekly_income'),weeklyCustomersIndex=header.indexOf('weekly_customers');
    if(idIndex<0||incomeIndex<0)return null;
    for(let i=1;i<lines.length;i++){
      const cols=parseCsvRow(lines[i]);if(Number(cols[idIndex])!==Number(companyId))continue;
      return {grossIncome:Number(cols[incomeIndex])||0,dailyCustomers:customersIndex>=0?Number(cols[customersIndex])||0:0,weeklyIncome:weeklyIncomeIndex>=0?Number(cols[weeklyIncomeIndex])||0:0,weeklyCustomers:weeklyCustomersIndex>=0?Number(cols[weeklyCustomersIndex])||0:0};
    }
    return null;
  }
  async function refreshHistoricalCompanyIncome(userId,serverNow=nowSec()) {
    const me=Number(userId)||0;if(!(me>0))return {added:0,checked:0,errors:0};
    let profileData;
    try{profileData=await apiGet('/company/profile');}catch(e){return {added:0,checked:0,errors:1,error:String(e?.message||e)};}
    const profile=profileData?.profile;
    if(!profile||Number(profile?.director?.id)!==me)return {added:0,checked:0,errors:0};
    const companyId=Number(profile?.id)||0;if(!(companyId>0))return {added:0,checked:0,errors:0};
    const serverTs=Number(serverNow)||nowSec(),today=tctDayStart(serverTs),existing=new Map((state.companyHistory||[]).filter(x=>Number(x?.companyId)===companyId).map(x=>[Number(x.snapshotDay),x]));
    let added=0,checked=0,errors=0,firstError='';
    for(let offset=0;offset<30;offset++){
      if(state.syncCancel)break;
      const snapshotDay=today-(offset*86400);if(existing.has(snapshotDay))continue;
      setSyncProgress(`Company history backfill ${offset+1}/30 - ${tctDateStr(snapshotDay)}...`);
      try{
        const csv=await apiGetText('/company/snapshot',{timestamp:snapshotDay+43200}),rec=companySnapshotRecord(csv,companyId);checked++;
        if(rec){
          existing.set(snapshotDay,{id:`company-history:${companyId}:${snapshotDay}`,companyId,snapshotDay,timestamp:snapshotDay-(6*3600),grossIncome:rec.grossIncome,dailyCustomers:rec.dailyCustomers,weeklyIncome:rec.weeklyIncome,weeklyCustomers:rec.weeklyCustomers,source:'Torn Company Snapshot'});added++;
          state.companyHistory=[...new Map([...(state.companyHistory||[]).filter(x=>Number(x?.companyId)!==companyId).map(x=>[String(x.id),x]),...[...existing.values()].map(x=>[String(x.id),x])]).values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)).slice(-90);save('companyHistory',state.companyHistory);
        }
      }catch(e){
        errors++;if(!firstError)firstError=String(e?.message||e);
        if(/key|permission|access|selection/i.test(firstError))break;
      }
      if(offset<29)await sleep(REQUEST_GAP_MS);
    }
    return {added,checked,errors,error:firstError};
  }

'''
if company_anchor not in s: raise SystemExit('company function anchor missing')
s=s.replace(company_anchor,company_funcs+company_anchor,1)

finalize_old="""        else if(job.phase==='finalize'){await refreshFinancialSnapshot();await refreshCompanyDailyAdjustment(job.userId,Number(job.tctNow)||nowSec());finishResumableSync(job);break;}"""
finalize_new="""        else if(job.phase==='finalize'){await refreshFinancialSnapshot();if(job.syncMode==='full'){const h=await refreshHistoricalCompanyIncome(job.userId,Number(job.tctNow)||nowSec());if(h?.error)job.companyHistoryError=h.error;job.companyHistoryAdded=Number(h?.added)||0;}await refreshCompanyDailyAdjustment(job.userId,Number(job.tctNow)||nowSec());finishResumableSync(job);break;}"""
if finalize_old not in s: raise SystemExit('finalize anchor missing')
s=s.replace(finalize_old,finalize_new,1)

cash_anchor="""  function cashFlowHtml() {"""
history_html=r'''  function companyHistoryHtml(from,to) {
    const exact=(state.cashFlows||[]).filter(x=>x?.category==='Company Profit / Loss'&&Number(x.timestamp)>=from&&Number(x.timestamp)<=to),byTs=new Map();
    for(const h of state.companyHistory||[]){const ts=Number(h?.timestamp)||0;if(ts>=from&&ts<=to)byTs.set(ts,{...h});}
    for(const x of exact){const ts=Number(x.timestamp)||0,prev=byTs.get(ts)||{timestamp:ts,companyId:Number(x.companyId)||0,grossIncome:Number(x.grossIncome)||0,source:'Observed by analyzer'};byTs.set(ts,{...prev,exact:x,grossIncome:Number(prev.grossIncome)||Number(x.grossIncome)||0});}
    const rows=[...byTs.values()].sort((a,b)=>(Number(b.timestamp)||0)-(Number(a.timestamp)||0));if(!rows.length)return '';
    return `<div class="tta-fin-section"><div class="tta-sectionhead"><div><small>Company history</small><h3>Daily company performance</h3><span class="tta-sectionhint">Historical snapshot income is gross only</span></div></div><div class="tta-table-scroll"><table class="tta-flowtable"><thead><tr><th>Company day</th><th style="text-align:right">Gross income</th><th style="text-align:right">Net P/L</th><th>Basis</th></tr></thead><tbody>${rows.map(r=>{const x=r.exact,net=x?(x.direction==='in'?Number(x.amount)||0:-(Number(x.amount)||0)):null;return `<tr><td><span class="tta-flowtitle">${esc(tctDateStr(r.timestamp))}</span><span class="tta-flowmeta">18:00 TCT</span></td><td class="num pos">${money(r.grossIncome||0)}</td><td class="num ${net==null?'':net>=0?'pos':'neg'}">${net==null?'Costs unavailable':money(net)}</td><td><span class="tta-flowmeta">${x?'Observed income, wages and ads':'Torn snapshot - gross only'}</span></td></tr>`;}).join('')}</tbody></table></div><div class="tta-note">Torn provides historical company daily income snapshots, but not historical employee wages or advertising budgets. Gross-only snapshot rows are informational and are excluded from Cash Flow earned/spent totals. Exact Company Profit / Loss is shown only for company days whose costs were observed by this analyzer.</div></div>`;
  }

'''
if cash_anchor not in s: raise SystemExit('cashFlowHtml anchor missing')
s=s.replace(cash_anchor,history_html+cash_anchor,1)

cash_insert="""<div class=\"tta-fin-section\"><h3>Category breakdown</h3>${cashBreakdownHtml(sum,20)}</div><div class=\"tta-listtools\">"""
cash_replace="""<div class=\"tta-fin-section\"><h3>Category breakdown</h3>${cashBreakdownHtml(sum,20)}</div>${companyHistoryHtml(from,to)}<div class=\"tta-listtools\">"""
if cash_insert not in s: raise SystemExit('cash flow history insertion anchor missing')
s=s.replace(cash_insert,cash_replace,1)

s=s.replace('transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,unrecognizedFinancial:state.unrecognizedFinancial','transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,companyHistory:state.companyHistory,unrecognizedFinancial:state.unrecognizedFinancial',1)
s=s.replace("'transactions','cashFlows','playerTransfers','unrecognizedFinancial','financialSnapshots'","'transactions','cashFlows','playerTransfers','companyHistory','unrecognizedFinancial','financialSnapshots'",1)

reset_old="""['tracked','transactions','cashFlows','playerTransfers','unrecognizedFinancial','goals','financialSnapshots','sync','syncJob','syncCache','logTypesUpdatedAt'"""
reset_new="""['tracked','transactions','cashFlows','playerTransfers','companyHistory','unrecognizedFinancial','goals','financialSnapshots','sync','syncJob','syncCache','logTypesUpdatedAt'"""
if reset_old not in s: raise SystemExit('reset key anchor missing')
s=s.replace(reset_old,reset_new,1)
s=s.replace('state.cashFlows=[];state.playerTransfers=[];state.unrecognizedFinancial=[];','state.cashFlows=[];state.playerTransfers=[];state.companyHistory=[];state.unrecognizedFinancial=[];',1)

s=s.replace('Company Profile/Employees, and Torn Items/Logtypes','Company Profile/Employees/Snapshot, and Torn Items/Logtypes',1)
s=s.replace('Company \\u2192 Profile, Employees</strong>','Company \\u2192 Profile, Employees, Snapshot</strong>',1)
s=s.replace('${qty(state.playerTransfers.length)} player item-transfer rows \\u00B7 ${qty(state.unrecognizedFinancial.length)} unrecognized financial diagnostics','${qty(state.playerTransfers.length)} player item-transfer rows \\u00B7 ${qty(state.companyHistory.length)} company history snapshots \\u00B7 ${qty(state.unrecognizedFinancial.length)} unrecognized financial diagnostics',1)

# Keep the distributed userscript ASCII-only so Torn PDA cannot mojibake the UI source.
if any(ord(ch)>=128 for ch in s):
    raise SystemExit('Non-ASCII characters introduced')

p.write_text(s,encoding='ascii')
