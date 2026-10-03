const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const modules=['state','diagnostics','persistence','launcher','fifo','accounting','views','settings','controller','parsers','fixtures','sync'];
const exposed=['state','parseLogEntry','normalizeItems','parseCashFlowEntry','parsePlayerTrade','parsePlayerTradeEvent','computeFifo','fifoAnalytics','acquisitionLedgerRows','summaryFor','overall','resetAnalyticsCache','dateRange','selectedPeriodBoundsTct','latestSalesRows','nextHistoryPage','nextLogPageParams','isTradeVerified','ensureSyncCache','checkpointTransactionRows','createResumableSyncJob','runResumableSync','runResumableLogPhase','runResumableTradeDetails','runResumableTradeList','finishResumableSync','syncAll','reportDiagnostic','dataQualityNotices','diagnosticReport','backupPayload','resetHistoryForFullResync','restoreFullResyncBackup','httpGet','apiGet','AnalyzerError','cashFlowSummary','transactionCashFlows','dailyNetWorthActivity','catalogItem','save','load'];
function harness({stored={},responses={},fetch:customFetch}={}) {
  const storage=new Map(Object.entries(stored).map(([k,v])=>['tta:v1:'+k,JSON.stringify(v)]));
  const calls=[];
  const context=vm.createContext({console,URL,AbortController,Date,Intl,Map,Set,BigInt,JSON,Math,Promise,Error,window:{},document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setTimeout:(fn,ms)=>setTimeout(fn,ms>=20000?ms:0),clearTimeout,setInterval:()=>0,requestAnimationFrame:fn=>fn(),fetch:async url=>{const parsed=new URL(url);calls.push(parsed);if(customFetch)return customFetch(parsed);const key=parsed.pathname.replace('/v2',''),result=responses[key];const value=typeof result==='function'?await result(parsed):result;if(value===undefined)throw new Error('No fixture: '+key);return {status:200,ok:true,text:async()=>JSON.stringify(value)};}});
  const source=modules.map(name=>fs.readFileSync(path.join(root,'src',name+'.js'),'utf8')).join('\n');
  const app=vm.runInContext(`(()=>{${source}\nreturn {${exposed.join(',')},syncJobIsStale,diagnosticFromError,historyPage,discardStaleSyncJob,validateBackup,applyBackup,restoreImportRecovery,pageRows,checkpointCashFlowRows,checkpointPlayerTransferRows,checkpointItemConsumptionRows,effectiveTracked,ensureCatalog,csvCell,refreshFinancialSnapshot,profitSeries};})()`,context);
  return {app,storage,calls,context};
}
const item={id:206,name:'Xanax',type:'Drug',marketPrice:150};
const log=(id,type,title,timestamp,data)=>({id,details:{id:type,title},timestamp,data,params:{}});
const trade=(id,timestamp,items)=>({id,completed_at:timestamp,user:{id:1,name:'Me'},trader:{id:2,name:'Other'},items});
const entry=(owner,type,id,amount)=>({user_id:owner,type,details:type.toLowerCase()==='item'?{id,amount}:{amount}});
module.exports={harness,item,log,trade,entry};
