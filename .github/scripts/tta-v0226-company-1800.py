from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.25','// @version      0.2.26',1)
s=s.replace("const VERSION = '0.2.25';","const VERSION = '0.2.26';",1)

old="""    const day=tctDayStart(Number(serverNow)||nowSec()),companyId=Number(profile?.id)||0;
    if(!(companyId>0))return null;
    const id=`company-adjustment:${companyId}:${day}`;
    if(!Number.isFinite(adjustment)||Math.abs(adjustment)<1){upsertCashFlowRow({id,amount:0});return null;}
    const direction=adjustment>0?'in':'out';
    const row={id,timestamp:Number(serverNow)||nowSec(),direction,amount:Math.abs(adjustment),category:'Company Profit / Loss',source:'Company Daily Adjustment',title:`${String(profile?.name||'Company')} daily ${adjustment>0?'profit':'loss'}`,transfer:false,companyId,grossIncome,wages,advertisementBudget,netAdjustment:adjustment};
    upsertCashFlowRow(row);return row;
"""

new="""    const serverTs=Number(serverNow)||nowSec();
    // Torn company daily figures are treated as an 18:00 TCT cycle. Before 18:00,
    // keep updating the previous cycle instead of creating a new midnight-dated row.
    const cycleDay=tctDayStart(serverTs-(18*3600)),calculatedAt=cycleDay+(18*3600),companyId=Number(profile?.id)||0;
    if(!(companyId>0))return null;
    const id=`company-adjustment:${companyId}:${cycleDay}`;
    // Remove legacy rows that older builds may have created after 00:00 but before
    // the next 18:00 TCT company calculation.
    const prefix=`company-adjustment:${companyId}:`;
    const beforeCompanyCleanup=(state.cashFlows||[]).length;
    state.cashFlows=(state.cashFlows||[]).filter(x=>{
      const xid=String(x?.id||'');
      if(!xid.startsWith(prefix))return true;
      const storedCycle=Number(xid.slice(prefix.length));
      return !Number.isFinite(storedCycle)||storedCycle<=cycleDay;
    });
    if(state.cashFlows.length!==beforeCompanyCleanup)save('cashFlows',state.cashFlows);
    if(!Number.isFinite(adjustment)||Math.abs(adjustment)<1){upsertCashFlowRow({id,amount:0});return null;}
    const direction=adjustment>0?'in':'out';
    const row={id,timestamp:calculatedAt,direction,amount:Math.abs(adjustment),category:'Company Profit / Loss',source:'Company Daily Adjustment',title:`${String(profile?.name||'Company')} daily ${adjustment>0?'profit':'loss'}`,transfer:false,companyId,grossIncome,wages,advertisementBudget,netAdjustment:adjustment};
    upsertCashFlowRow(row);return row;
"""

if old not in s:
    raise SystemExit('Company adjustment anchor not found')
s=s.replace(old,new,1)
p.write_text(s)
