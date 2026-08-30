from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

s=s.replace('// @version      0.2.33','// @version      0.2.34',1)
s=s.replace("const VERSION = '0.2.33';","const VERSION = '0.2.34';",1)

old="""  function explicitCashAmount(payload,meta) {
    const direct=Number(nestedValue(payload,meta?.field));if(Number.isFinite(direct)&&direct!==0)return Math.abs(direct);
    const f=bestMoneyField(payload,meta?.label||'');return f?Math.abs(Number(f.value)||0):0;
  }
  function parseCashFlowEntry(entry,parsedItemRows=[]) {
    const entryTitle=String(entry?.details?.title||'');
    const crimeContext=/crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime/i.test(entryTitle);
    if(parsedItemRows?.length&&!crimeContext)return[];
    const logTypeId=Number(entry?.details?.id)||0,title=entryTitle;
    const payload={...(entry?.params||{}),...(entry?.data||{})},explicit=EXPLICIT_CASH_LOGS.get(logTypeId);
    if(explicit){
      const amount=explicitCashAmount(payload,explicit);if(!(amount>0))return[];
      const cp=extractCounterparty(payload,explicit.direction),suffix=cp.name?` ${explicit.direction==='out'?'to':'from'} ${cp.name}`:cp.id?` ${explicit.direction==='out'?'to':'from'} #${cp.id}`:'';
      return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction:explicit.direction,amount,category:explicit.category,source:explicit.category==='Player Transfers'?'Player Transfer':'Torn Log',title:`${title||explicit.label}${suffix}`,logId:logTypeId,field:explicit.field,transfer:false,counterpartyId:cp.id||0,counterpartyName:cp.name||''}];
    }
    if(KNOWN_TRANSACTION_LOGS.has(logTypeId)||/\\btrade\\b/i.test(title)||!financialTitleContext(title))return[];
    if(/company/i.test(title)&&/\\b(deposit|withdraw(?:al)?)\\b/i.test(title))return[];
    const field=bestMoneyField(payload,title);if(!field)return[];
    let direction=cashFlowDirection(title,field.path,logTypeId);
    if(crimeContext){
      const success=/\\b(success|successful|succeeded|reward|rewarded)\\b/i.test(title);
      const incomingField=/(money|cash).*(gain|gained|receive|received|earn|earned|reward|payout|profit)|(?:gain|gained|receive|received|earn|earned|reward|payout|profit).*(money|cash)/i.test(field.path);
      const outgoingField=/(spent|paid|cost|fee|fine|lost|loss|expense)/i.test(field.path);
      const failed=/\\b(fail|failed|failure|unsuccessful)\\b/i.test(title);
      if(!outgoingField&&!failed&&(success||incomingField))direction='in';
    }
    if(!direction)return[];
    const amount=Math.abs(Number(field.value)||0);if(!(amount>0))return[];
    return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction,amount,category:cashFlowCategory(title,direction),source:crimeContext?'Crime Reward':'Torn Log',title,logId:logTypeId,field:field.path,transfer:direction.startsWith('transfer')}];
  }
"""
new="""  function explicitCashAmount(payload,meta) {
    const direct=Number(nestedValue(payload,meta?.field));if(Number.isFinite(direct)&&direct!==0)return Math.abs(direct);
    const f=bestMoneyField(payload,meta?.label||'');return f?Math.abs(Number(f.value)||0):0;
  }
  function strictCrimeCashField(payload,title='') {
    const rows=flattenNumericFields(payload),t=String(title||'').toLowerCase();
    const incoming=/(^|\\.)(money_gained|money_received|money_earned|money_reward|money_rewarded|cash_gained|cash_received|cash_earned|cash_reward|cash_rewarded)$/i;
    const outgoing=/(^|\\.)(money_lost|money_spent|money_paid|cash_lost|cash_spent|cash_paid)$/i;
    const legacyMoney=/(^|\\.)(money|cash)$/i;
    let best=null;
    for(const row of rows){
      if(!Number.isFinite(row.value)||row.value===0)continue;
      let direction='';
      if(incoming.test(row.path))direction='in';
      else if(outgoing.test(row.path))direction='out';
      else if(legacyMoney.test(row.path)&&/crime success money gain|crime fail money loss/.test(t))direction=/fail money loss/.test(t)?'out':'in';
      if(!direction)continue;
      const score=/(money_gained|money_received|cash_gained|cash_received)$/.test(row.path)?20:10;
      if(!best||score>best.score||(score===best.score&&Math.abs(row.value)>Math.abs(best.value)))best={...row,direction,score};
    }
    return best;
  }
  function purgeBogusCrimeCashRows() {
    const before=(state.cashFlows||[]).length;
    state.cashFlows=(state.cashFlows||[]).filter(row=>{
      if(String(row?.source||'')!=='Crime Reward')return true;
      const field=String(row?.field||'');
      return /(money|cash)/i.test(field);
    });
    const removed=before-state.cashFlows.length;
    if(removed>0){save('cashFlows',state.cashFlows);resetAnalyticsCache();}
    return removed;
  }
  function parseCashFlowEntry(entry,parsedItemRows=[]) {
    const entryTitle=String(entry?.details?.title||'');
    const crimeContext=/crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime/i.test(entryTitle);
    if(parsedItemRows?.length&&!crimeContext)return[];
    const logTypeId=Number(entry?.details?.id)||0,title=entryTitle;
    const payload={...(entry?.params||{}),...(entry?.data||{})},explicit=EXPLICIT_CASH_LOGS.get(logTypeId);
    if(explicit){
      const amount=explicitCashAmount(payload,explicit);if(!(amount>0))return[];
      const cp=extractCounterparty(payload,explicit.direction),suffix=cp.name?` ${explicit.direction==='out'?'to':'from'} ${cp.name}`:cp.id?` ${explicit.direction==='out'?'to':'from'} #${cp.id}`:'';
      return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction:explicit.direction,amount,category:explicit.category,source:explicit.category==='Player Transfers'?'Player Transfer':'Torn Log',title:`${title||explicit.label}${suffix}`,logId:logTypeId,field:explicit.field,transfer:false,counterpartyId:cp.id||0,counterpartyName:cp.name||''}];
    }
    if(KNOWN_TRANSACTION_LOGS.has(logTypeId)||/\\btrade\\b/i.test(title)||!financialTitleContext(title))return[];
    if(/company/i.test(title)&&/\\b(deposit|withdraw(?:al)?)\\b/i.test(title))return[];
    if(crimeContext){
      const field=strictCrimeCashField(payload,title);if(!field)return[];
      const amount=Math.abs(Number(field.value)||0);if(!(amount>0))return[];
      return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction:field.direction,amount,category:'Crime / Mugging',source:'Crime Reward',title,logId:logTypeId,field:field.path,transfer:false}];
    }
    const field=bestMoneyField(payload,title);if(!field)return[];
    const direction=cashFlowDirection(title,field.path,logTypeId);if(!direction)return[];
    const amount=Math.abs(Number(field.value)||0);if(!(amount>0))return[];
    return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction,amount,category:cashFlowCategory(title,direction),source:'Torn Log',title,logId:logTypeId,field:field.path,transfer:direction.startsWith('transfer')}];
  }
"""
if old not in s:
    raise SystemExit('parseCashFlowEntry anchor not found')
s=s.replace(old,new,1)

old_unmapped="""    const payload={...(entry?.params||{}),...(entry?.data||{})},field=bestMoneyField(payload,title);if(!field)return null;
    return {id:`unmapped:${entry.id}`,timestamp:Number(entry.timestamp)||0,logId:logTypeId,title:title||`Log ${logTypeId}`,category:category||'Financial',field:field.path,amount:Math.abs(Number(field.value)||0)};
"""
new_unmapped="""    const payload={...(entry?.params||{}),...(entry?.data||{})},crimeContext=/crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime/i.test(title),field=crimeContext?strictCrimeCashField(payload,title):bestMoneyField(payload,title);if(!field)return null;
    return {id:`unmapped:${entry.id}`,timestamp:Number(entry.timestamp)||0,logId:logTypeId,title:title||`Log ${logTypeId}`,category:category||'Financial',field:field.path,amount:Math.abs(Number(field.value)||0)};
"""
if old_unmapped not in s:
    raise SystemExit('unrecognizedRowFor anchor not found')
s=s.replace(old_unmapped,new_unmapped,1)

startup="""  try{localStorage.removeItem(NS+('company'+'History'));}catch(_){}
"""
startup_new="""  try{localStorage.removeItem(NS+('company'+'History'));}catch(_){}
  // v0.2.34 removes false Crime Reward rows created when an item quantity such as
  // items_gained.1 = 1 was misread as $1 of crime income.
  purgeBogusCrimeCashRows();
"""
if startup not in s:
    raise SystemExit('startup migration anchor not found')
s=s.replace(startup,startup_new,1)

if '// @version      0.2.34' not in s or "const VERSION = '0.2.34';" not in s:
    raise SystemExit('Version bump failed')
if 'strictCrimeCashField' not in s or 'purgeBogusCrimeCashRows();' not in s:
    raise SystemExit('Crime cash strict fix missing')
if any(ord(ch)>=128 for ch in s):
    raise SystemExit('Non-ASCII characters introduced')

p.write_text(s,encoding='ascii')
