from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

s=s.replace('// @version      0.2.32','// @version      0.2.33',1)
s=s.replace("const VERSION = '0.2.32';","const VERSION = '0.2.33';",1)

old="""  function parseCashFlowEntry(entry,parsedItemRows=[]) {
    if(parsedItemRows?.length)return[];
    const logTypeId=Number(entry?.details?.id)||0,title=String(entry?.details?.title||'');
    const payload={...(entry?.params||{}),...(entry?.data||{})},explicit=EXPLICIT_CASH_LOGS.get(logTypeId);
"""
new="""  function parseCashFlowEntry(entry,parsedItemRows=[]) {
    const entryTitle=String(entry?.details?.title||'');
    const crimeContext=/crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime/i.test(entryTitle);
    if(parsedItemRows?.length&&!crimeContext)return[];
    const logTypeId=Number(entry?.details?.id)||0,title=entryTitle;
    const payload={...(entry?.params||{}),...(entry?.data||{})},explicit=EXPLICIT_CASH_LOGS.get(logTypeId);
"""
if old not in s:
    raise SystemExit('parseCashFlowEntry anchor not found')
s=s.replace(old,new,1)

old="""    const field=bestMoneyField(payload,title);if(!field)return[];
    const direction=cashFlowDirection(title,field.path,logTypeId);if(!direction)return[];
    const amount=Math.abs(Number(field.value)||0);if(!(amount>0))return[];
    return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction,amount,category:cashFlowCategory(title,direction),source:'Torn Log',title,logId:logTypeId,field:field.path,transfer:direction.startsWith('transfer')}];
"""
new="""    const field=bestMoneyField(payload,title);if(!field)return[];
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
"""
if old not in s:
    raise SystemExit('crime direction anchor not found')
s=s.replace(old,new,1)

old="""    if(/crime|mug/.test(s))return 'Crime / Mugging';
"""
new="""    if(/crime|mug|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime/.test(s))return 'Crime / Mugging';
"""
if old not in s:
    raise SystemExit('cashFlowCategory crime anchor not found')
s=s.replace(old,new,1)

old="""    return /(money|cash|bank|vault|wage|salary|pay|payment|deposit|withdraw|interest|dividend|casino|bookie|lottery|stock|share|bounty|rent|loan|fee|tax|rehab|travel|property|company|faction|donat|mug|points|award|reward|income|expense|cost|profit|loss)/i.test(String(title||''));
"""
new="""    return /(money|cash|bank|vault|wage|salary|pay|payment|deposit|withdraw|interest|dividend|casino|bookie|lottery|stock|share|bounty|rent|loan|fee|tax|rehab|travel|property|company|faction|donat|mug|crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime|points|award|reward|income|expense|cost|profit|loss)/i.test(String(title||''));
"""
if old not in s:
    raise SystemExit('financialTitleContext anchor not found')
s=s.replace(old,new,1)

old="""    const moneyContext=/(money|cash|bank|vault|wage|salary|pay|payment|deposit|withdraw|interest|dividend|casino|bookie|lottery|stock|share|bounty|rent|loan|fee|tax|rehab|travel|property|company|faction|donat|mug|points|award|income|expense|cost|profit|loss)/i;
"""
new="""    const moneyContext=/(money|cash|bank|vault|wage|salary|pay|payment|deposit|withdraw|interest|dividend|casino|bookie|lottery|stock|share|bounty|rent|loan|fee|tax|rehab|travel|property|company|faction|donat|mug|crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime|points|award|income|expense|cost|profit|loss)/i;
"""
if old not in s:
    raise SystemExit('moneyContext anchor not found')
s=s.replace(old,new,1)

if '// @version      0.2.33' not in s or "const VERSION = '0.2.33';" not in s:
    raise SystemExit('version bump failed')
if "source:crimeContext?'Crime Reward':'Torn Log'" not in s:
    raise SystemExit('crime reward source missing')
if "parsedItemRows?.length&&!crimeContext" not in s:
    raise SystemExit('mixed item/cash crime handling missing')
if any(ord(ch)>=128 for ch in s):
    raise SystemExit('Non-ASCII characters introduced')

p.write_text(s,encoding='ascii')
