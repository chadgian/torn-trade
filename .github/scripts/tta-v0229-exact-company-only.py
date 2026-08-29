from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

s=s.replace('// @version      0.2.28','// @version      0.2.29',1)
s=s.replace("const VERSION = '0.2.28';","const VERSION = '0.2.29';",1)
s=s.replace('company=profile,employees,snapshot&torn=items,logtypes','company=profile,employees&torn=items,logtypes',1)

# Remove historical company snapshot state.
s=s.replace("    companyHistory: load('companyHistory', []),\n",'',1)

# Remove CSV/snapshot helpers added in v0.2.28.
start=s.find('  function parseCsvRow(line) {')
end=s.find('  async function refreshCompanyDailyAdjustment', start)
if start < 0 or end < 0:
    raise SystemExit('Historical company helper block not found')
s=s[:start]+s[end:]

# Remove unused text API helper while preserving the normal JSON API path.
api_text_start=s.find('  async function apiGetText(path, params = {}) {')
if api_text_start >= 0:
    api_text_end=s.find('  function injectCss() {', api_text_start)
    if api_text_end < 0: raise SystemExit('apiGetText end anchor missing')
    s=s[:api_text_start]+s[api_text_end:]

old_http="""  async function httpGetText(url) {
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
new_http="""  async function httpGet(url) {
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
if old_http in s:
    s=s.replace(old_http,new_http,1)

# Full Resync should only refresh the exact observed company calculation.
old_finalize="""        else if(job.phase==='finalize'){await refreshFinancialSnapshot();if(job.syncMode==='full'){const h=await refreshHistoricalCompanyIncome(job.userId,Number(job.tctNow)||nowSec());if(h?.error)job.companyHistoryError=h.error;job.companyHistoryAdded=Number(h?.added)||0;}await refreshCompanyDailyAdjustment(job.userId,Number(job.tctNow)||nowSec());finishResumableSync(job);break;}"""
new_finalize="""        else if(job.phase==='finalize'){await refreshFinancialSnapshot();await refreshCompanyDailyAdjustment(job.userId,Number(job.tctNow)||nowSec());finishResumableSync(job);break;}"""
if old_finalize not in s: raise SystemExit('Finalize history anchor missing')
s=s.replace(old_finalize,new_finalize,1)

# Remove historical company performance UI.
hs=s.find('  function companyHistoryHtml(from,to) {')
he=s.find('  function cashFlowHtml() {', hs)
if hs < 0 or he < 0: raise SystemExit('companyHistoryHtml block missing')
s=s[:hs]+s[he:]
s=s.replace('${companyHistoryHtml(from,to)}','',1)

# Remove historical company data from backup/import/reset/settings.
s=s.replace('transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,companyHistory:state.companyHistory,unrecognizedFinancial:state.unrecognizedFinancial','transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,unrecognizedFinancial:state.unrecognizedFinancial',1)
s=s.replace("'transactions','cashFlows','playerTransfers','companyHistory','unrecognizedFinancial','financialSnapshots'","'transactions','cashFlows','playerTransfers','unrecognizedFinancial','financialSnapshots'",1)
s=s.replace("['tracked','transactions','cashFlows','playerTransfers','companyHistory','unrecognizedFinancial'","['tracked','transactions','cashFlows','playerTransfers','unrecognizedFinancial'",1)
s=s.replace('state.cashFlows=[];state.playerTransfers=[];state.companyHistory=[];state.unrecognizedFinancial=[];','state.cashFlows=[];state.playerTransfers=[];state.unrecognizedFinancial=[];',1)
s=s.replace('Company Profile/Employees/Snapshot, and Torn Items/Logtypes','Company Profile/Employees, and Torn Items/Logtypes',1)
s=s.replace('Company \\u2192 Profile, Employees, Snapshot</strong>','Company \\u2192 Profile, Employees</strong>',1)
s=s.replace('${qty(state.playerTransfers.length)} player item-transfer rows \\u00B7 ${qty(state.companyHistory.length)} company history snapshots \\u00B7 ${qty(state.unrecognizedFinancial.length)} unrecognized financial diagnostics','${qty(state.playerTransfers.length)} player item-transfer rows \\u00B7 ${qty(state.unrecognizedFinancial.length)} unrecognized financial diagnostics',1)

# v0.2.29 migration: discard incomplete gross-only history from v0.2.28.
migration_anchor="  if(state.dateMode==='month'){state.dateMode='30d';save('dateMode','30d');}\n"
if migration_anchor not in s: raise SystemExit('migration anchor missing')
s=s.replace(migration_anchor,migration_anchor+"  try{localStorage.removeItem(NS+'companyHistory');}catch(_){}\n",1)

# Preserve the ASCII-safe source introduced in v0.2.27.
if any(ord(ch)>=128 for ch in s):
    raise SystemExit('Non-ASCII characters introduced')
if 'companyHistory' in s:
    raise SystemExit('companyHistory references remain')
if '/company/snapshot' in s or 'employees,snapshot' in s:
    raise SystemExit('company snapshot references remain')

p.write_text(s,encoding='ascii')
