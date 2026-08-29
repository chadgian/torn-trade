from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='utf-8')

def once(old,new,label):
    global s
    n=s.count(old)
    if n!=1:
        raise SystemExit(f'{label}: expected 1 match, found {n}')
    s=s.replace(old,new,1)

once('// @version      0.2.18','// @version      0.2.19','metadata version')
once("const VERSION = '0.2.18';","const VERSION = '0.2.19';",'runtime version')

start=s.index('  function csvCell(v)')
end=s.index('  function importBackup()', start)
new_block="""  function csvCell(v){const s=String(v??'');return /[\",]/.test(s)||s.includes(String.fromCharCode(10))||s.includes(String.fromCharCode(13))?`\"${s.replace(/\"/g,'\"\"')}\"`:s;}\n  function downloadTextFile(name,text,type='text/plain;charset=utf-8'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}\n  function backupPayload(){return {schema:1,app:'Torn Cash Flow Analyzer',version:VERSION,exportedAt:nowSec(),data:{transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,unrecognizedFinancial:state.unrecognizedFinancial,financialSnapshots:state.financialSnapshots,goals:state.goals,tracked:state.tracked,pinnedIds:state.pinnedIds,hiddenIds:state.hiddenIds,sync:state.sync,dateMode:state.dateMode,customFrom:state.customFrom,customTo:state.customTo,granularity:state.granularity}};}\n  function exportBackup(){downloadTextFile(`torn-cash-flow-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backupPayload(),null,2),'application/json;charset=utf-8');}\n  function exportCashCsv(){const rows=allCashFlows(),head=['Timestamp TCT','Direction','Category','Title','Source','Amount','Counterparty ID','Counterparty'];const body=rows.map(x=>[tctDateTimeStr(x.timestamp),x.direction,x.category,x.title,x.source,x.amount,x.counterpartyId||'',x.counterpartyName||'']);downloadTextFile(`torn-cash-flow-${new Date().toISOString().slice(0,10)}.csv`,[head,...body].map(r=>r.map(csvCell).join(',')).join(String.fromCharCode(10)),'text/csv;charset=utf-8');}\n  function exportNetWorthCsv(){const head=['Timestamp TCT','Total','Money','Items','Points','Other assets'];const body=(state.financialSnapshots||[]).filter(x=>x?.networth).map(x=>{const n=x.networth;return [tctDateTimeStr(n.timestamp||x.timestamp),n.total,sumMoneyTree(n.money),sumMoneyTree(n.items),Number(n.points)||0,sumMoneyTree(n.assets)];});downloadTextFile(`torn-net-worth-${new Date().toISOString().slice(0,10)}.csv`,[head,...body].map(r=>r.map(csvCell).join(',')).join(String.fromCharCode(10)),'text/csv;charset=utf-8');}\n"""
s=s[:start]+new_block+s[end:]
p.write_text(s,encoding='utf-8')
