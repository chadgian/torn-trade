from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.12','// @version      0.2.13',1)
s=s.replace("const VERSION = '0.2.12';","const VERSION = '0.2.13';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with a clean Bento dashboard, Torn PDA parser-safe rendering, TCT daily flow and fast sync modes. Data stays on-device.','Torn cash-flow, spending, earnings, company profit, net-worth and trade analytics with a clean Bento dashboard, TCT daily flow and fast sync modes. Data stays on-device.',1)

old="""  function cashFlowDirection(title,path='') {
    const s=`${title} ${path}`.toLowerCase();
    if(/deposit/.test(s)&&/(bank|vault|faction|company|cayman|piggy|property)/.test(s))return 'transfer-out';
    if(/withdraw/.test(s)&&/(bank|vault|faction|company|cayman|piggy|property)/.test(s))return 'transfer-in';
    if(/money_lost|cash_spent|spent|cost|fee|tax|expense|loss|lost|paid|payment|purchase|bought|buy|rehab|rent|donat|bounty placed|loan repayment/.test(s))return 'out';
    if(/money_gained|money_received|cash_received|received|gained|earned|income|wage|salary|interest|dividend|winnings|payout|reward|profit|sold|sale|win|won/.test(s))return 'in';
    if(/mugged/.test(s))return 'out';
    if(/mug/.test(s))return 'in';
    return null;
  }"""
new="""  function cashFlowDirection(title,path='',logTypeId=0) {
    const s=`${title} ${path}`.toLowerCase();
    if(Number(logTypeId)===8155)return 'in';
    if(Number(logTypeId)===8156)return 'out';
    if(/deposit/.test(s)&&/(bank|vault|faction|company|cayman|piggy|property)/.test(s))return 'transfer-out';
    if(/withdraw/.test(s)&&/(bank|vault|faction|company|cayman|piggy|property)/.test(s))return 'transfer-in';
    if(/\bmugged you\b|\byou were mugged\b|\bmugged by\b/.test(s))return 'out';
    if(/\byou mugged\b/.test(s))return 'in';
    if(/money_lost|cash_spent|spent|cost|fee|tax|expense|loss|lost|paid|payment|purchase|bought|buy|rehab|rent|donat|bounty placed|loan repayment/.test(s))return 'out';
    if(/money_gained|money_received|cash_received|received|gained|earned|income|wage|salary|interest|dividend|winnings|payout|reward|profit|sold|sale|win|won/.test(s))return 'in';
    if(/mug/.test(s))return 'in';
    return null;
  }"""
assert old in s, 'cashFlowDirection block not found'
s=s.replace(old,new,1)

old="""  function parseCashFlowEntry(entry,parsedItemRows=[]) {
    if(parsedItemRows?.length)return[];
    const logTypeId=Number(entry?.details?.id)||0,title=String(entry?.details?.title||'');
    if(KNOWN_TRANSACTION_LOGS.has(logTypeId)||/\\btrade\\b/i.test(title)||!financialTitleContext(title))return[];
    const payload={...(entry?.params||{}),...(entry?.data||{})},field=bestMoneyField(payload,title);if(!field)return[];
    const direction=cashFlowDirection(title,field.path);if(!direction)return[];
    const amount=Math.abs(Number(field.value)||0);if(!(amount>0))return[];
    return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction,amount,category:cashFlowCategory(title,direction),source:'Torn Log',title,logId:logTypeId,field:field.path,transfer:direction.startsWith('transfer')}];
  }"""
new="""  function parseCashFlowEntry(entry,parsedItemRows=[]) {
    if(parsedItemRows?.length)return[];
    const logTypeId=Number(entry?.details?.id)||0,title=String(entry?.details?.title||'');
    if(KNOWN_TRANSACTION_LOGS.has(logTypeId)||/\\btrade\\b/i.test(title)||!financialTitleContext(title))return[];
    if(/company/i.test(title)&&/\\b(deposit|withdraw(?:al)?)\\b/i.test(title))return[];
    const payload={...(entry?.params||{}),...(entry?.data||{})},field=bestMoneyField(payload,title);if(!field)return[];
    const direction=cashFlowDirection(title,field.path,logTypeId);if(!direction)return[];
    const amount=Math.abs(Number(field.value)||0);if(!(amount>0))return[];
    return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction,amount,category:cashFlowCategory(title,direction),source:'Torn Log',title,logId:logTypeId,field:field.path,transfer:direction.startsWith('transfer')}];
  }"""
assert old in s, 'parseCashFlowEntry block not found'
s=s.replace(old,new,1)

marker="""  function checkpointCashFlowRows(rows) {
    if(!rows?.length)return 0;const map=new Map((state.cashFlows||[]).map(x=>[String(x.id),x]));let added=0;
    for(const row of rows){if(!row?.id||!(Number(row.amount)>0)||map.has(String(row.id)))continue;map.set(String(row.id),row);added++;}
    if(added){state.cashFlows=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));save('cashFlows',state.cashFlows);}
    return added;
  }
"""
assert marker in s, 'checkpointCashFlowRows marker not found'
insert=marker+"""
  function upsertCashFlowRow(row) {
    if(!row?.id)return false;
    const map=new Map((state.cashFlows||[]).map(x=>[String(x.id),x])),key=String(row.id);
    if(!(Number(row.amount)>0)){
      if(!map.delete(key))return false;
    }else map.set(key,row);
    state.cashFlows=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));save('cashFlows',state.cashFlows);return true;
  }
  function repairCashFlowAccountingRows() {
    let changed=false;const next=[];
    for(const row of state.cashFlows||[]){
      if(!row)continue;const id=Number(row.logId)||0,title=String(row.title||'');
      if(/company/i.test(title)&&/\\b(deposit|withdraw(?:al)?)\\b/i.test(title)){changed=true;continue;}
      let x=row;
      if(id===8155||/\\byou mugged\\b/i.test(title)){
        if(row.direction!=='in'||row.category!=='Crime / Mugging'||row.transfer){x={...row,direction:'in',category:'Crime / Mugging',transfer:false};changed=true;}
      }else if(id===8156||/\\bmugged you\\b|\\byou were mugged\\b|\\bmugged by\\b/i.test(title)){
        if(row.direction!=='out'||row.category!=='Crime / Mugging'||row.transfer){x={...row,direction:'out',category:'Crime / Mugging',transfer:false};changed=true;}
      }
      next.push(x);
    }
    if(changed){state.cashFlows=next.sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));save('cashFlows',state.cashFlows);}
    return changed;
  }
"""
s=s.replace(marker,insert,1)

marker2="  function sumNumeric(obj){return Object.values(obj||{}).reduce((n,v)=>n+(typeof v==='number'&&Number.isFinite(v)?v:0),0);}"
assert marker2 in s, 'sumNumeric marker not found'
company_fn="""  async function refreshCompanyDailyAdjustment(userId,serverNow=nowSec()) {
    const me=Number(userId)||0;if(!(me>0))return null;
    let profileData;
    try{profileData=await apiGet('/company/profile');}catch(_){return null;}
    const profile=profileData?.profile;
    if(!profile||Number(profile?.director?.id)!==me)return null;
    let employeesData;
    try{employeesData=await apiGet('/company/employees');}catch(_){return null;}
    const employees=Array.isArray(employeesData?.employees)?employeesData.employees:[];
    const grossIncome=Number(profile?.income?.daily)||0;
    const wages=employees.reduce((n,e)=>n+Math.max(0,Number(e?.wage)||0),0);
    const advertisementBudget=Math.max(0,Number(profile?.advertisement_budget)||0);
    const adjustment=grossIncome-wages-advertisementBudget;
    const day=tctDayStart(Number(serverNow)||nowSec()),companyId=Number(profile?.id)||0;
    if(!(companyId>0))return null;
    const id=`company-adjustment:${companyId}:${day}`;
    if(!Number.isFinite(adjustment)||Math.abs(adjustment)<1){upsertCashFlowRow({id,amount:0});return null;}
    const direction=adjustment>0?'in':'out';
    const row={id,timestamp:Number(serverNow)||nowSec(),direction,amount:Math.abs(adjustment),category:'Company Profit / Loss',source:'Company Daily Adjustment',title:`${String(profile?.name||'Company')} daily ${adjustment>0?'profit':'loss'}`,transfer:false,companyId,grossIncome,wages,advertisementBudget,netAdjustment:adjustment};
    upsertCashFlowRow(row);return row;
  }
"""
s=s.replace(marker2,company_fn+marker2,1)

old_final="        else if(job.phase==='finalize'){await refreshFinancialSnapshot();finishResumableSync(job);break;}"
new_final="        else if(job.phase==='finalize'){await refreshFinancialSnapshot();await refreshCompanyDailyAdjustment(job.userId,Number(job.tctNow)||nowSec());finishResumableSync(job);break;}"
assert old_final in s, 'resumable finalize block not found'
s=s.replace(old_final,new_final,1)

boot="  const boot=()=>{if(document.body){mount();resumePendingSync();}else setTimeout(boot,250)}; boot();"
assert boot in s, 'boot marker not found'
s=s.replace(boot,"  repairCashFlowAccountingRows();\n"+boot,1)

p.write_text(s)

r=Path('README.md')
text=r.read_text()
text=re.sub(r'\*\*Current version:\*\* v[0-9.]+','**Current version:** v0.2.13',text,count=1)
text += """

## v0.2.13 — Mugging direction and director company profit

- Corrects mugging accounting: Torn log 8155 (Attack Mug) is money in for the mugger; 8156 (Attack Mug Receive) is money out for the victim.
- Repairs already cached mugging cash-flow rows automatically after updating.
- Company deposits and withdrawals are excluded from cash-flow rows.
- If the API-key owner is the company director, each sync adds/updates one current-TCT-day Company Profit / Loss row calculated as daily company income minus employee wages minus advertisement budget.
- The daily company row is updated rather than duplicated when syncing again on the same TCT day.
"""
r.write_text(text)
