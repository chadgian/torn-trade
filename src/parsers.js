  async function ensureCatalog(force=false) {
    if(state.demo&&!hasApiKey())return;
    const catalogAge=nowSec()-(Number(state.catalogUpdatedAt)||0);
    const cacheCurrent=state.catalog.length&&state.catalogVersion===CATALOG_SCHEMA_VERSION&&catalogAge>=0&&catalogAge<6*3600;if(cacheCurrent&&!force)return;
    if(!hasApiKey()){state.catalog=demoCatalog();return;}
    try{
      if(state.busy?.active)setBusyDetail('Loading the complete Torn item catalog and current market values\u2026');
      const data=await apiGet('/torn/items');
      if(!Array.isArray(data.items)||!data.items.length)throw new AnalyzerError('CATALOG_FORMAT','Torn returned an incomplete item catalog.');
      state.catalog=data.items.filter(x=>x&&Number(x.id)>0&&x.name).map(x=>({id:Number(x.id),name:String(x.name),image:x.image||'',type:x.type||'',marketPrice:Number(x.value?.market_price)||0})).sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
      state.catalogVersion=CATALOG_SCHEMA_VERSION;state.catalogUpdatedAt=nowSec();save('catalog',state.catalog);save('catalogVersion',state.catalogVersion);save('catalogUpdatedAt',state.catalogUpdatedAt);perfCache.catalogRef=null;
      resetAnalyticsCache();resolveDiagnostic('CATALOG_STALE');resolveDiagnostic('CATALOG_FAILED');
    }catch(e){reportDiagnostic('CATALOG_FAILED','warning','Catalog refresh failed. Cached prices remain in use.',{source:'/torn/items'});return false;}
    return true;
  }

  function addTracked(id) {
    const x=state.catalog.find(i=>Number(i.id)===Number(id)); if(!x)return;
    if(!state.tracked.some(i=>Number(i.id)===Number(id))){state.tracked.push(x);save('tracked',state.tracked);}
    state.view='trade';state.search='';state.demo=false;resetAnalyticsCache();render();toast(`${x.name} added. Sync to analyze its history.`);
  }
  function removeTracked(id) {
    const x=state.tracked.find(i=>Number(i.id)===Number(id));
    state.tracked=state.tracked.filter(i=>Number(i.id)!==Number(id));
    state.transactions=state.transactions.filter(t=>Number(t.itemId)!==Number(id));
    save('tracked',state.tracked);save('transactions',state.transactions);state.expanded=null;resetAnalyticsCache();render();toast(`${x?.name||'Item'} removed.`);
  }

  async function ensureLogTypes(force=false) {
    const age=nowSec()-(Number(state.logTypesUpdatedAt)||0);
    if(state.logTypes.length&&!force&&age>=0&&age<24*3600)return state.logTypes;
    const data=await apiGet('/torn/logtypes');
    if(!Array.isArray(data.logtypes)||!data.logtypes.length)throw new AnalyzerError('LOG_TYPES_FORMAT','Torn returned an incomplete log-type catalog.',{source:'/torn/logtypes'});
    state.logTypes=data.logtypes;state.logTypesUpdatedAt=nowSec();save('logTypes',state.logTypes);save('logTypesUpdatedAt',state.logTypesUpdatedAt);return state.logTypes;
  }

  function relevantLogTypes(all) {
    const paidContext=/(item market|bazaar|abroad|foreign|travel|shop|auction|market)/i;
    const paidAction=/\b(buy|bought|purchase|purchased|sell|sold|sale|listed|listing|win|won)\b/i;
    const itemMovement=/(item|plushie|flower|drug|weapon|armor|armour|temporary).*(buy|bought|purchase|purchased|sell|sold|sale|receive|received|gain|gained|find|found|reward|loot|won|win)|(buy|bought|purchase|purchased|sell|sold|sale|receive|received|gain|gained|find|found|reward|loot|won|win).*(item|plushie|flower|drug|weapon|armor|armour|temporary)/i;
    const freeContext=/(crime success|organized crime success|city find|mission reward|seasonal gift|christmas town|easter egg hunt|halloween basket|job special|company special|event reward|competition reward|reward|loot|items? incoming|item.*received|item.*gained|item.*found)/i;
    const moneyContext=/(money|cash|bank|vault|wage|salary|pay|payment|deposit|withdraw|interest|dividend|casino|bookie|lottery|stock|share|bounty|rent|loan|fee|tax|rehab|travel|property|company|faction|donat|mug|crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime|points|award|income|expense|cost|profit|loss)/i;
    const byId=new Map();
    (all||[]).forEach(x=>{
      const id=Number(x?.id),title=String(x?.title||'');
      if(/\btrade\b/i.test(title))return;
      if(id && ((paidContext.test(title) && paidAction.test(title)) || itemMovement.test(title) || /^item use\b/i.test(title) || freeContext.test(title) || moneyContext.test(title) || KNOWN_TRANSACTION_LOGS.has(id))) byId.set(id,{...x,id});
    });
    KNOWN_TRANSACTION_LOGS.forEach((meta,id)=>{if(!byId.has(id))byId.set(id,{id,title:`${meta.source} ${meta.side}`});});
    FORCE_FINANCE_LOG_IDS.forEach(id=>{if(!byId.has(id))byId.set(id,{id,title:EXPLICIT_CASH_LOGS.get(id)?.label||PLAYER_ITEM_LOGS.get(id)?.label||`Financial log ${id}`});});
    return [...byId.values()].sort((a,b)=>a.id-b.id);
  }

  function classify(title) {
    title=String(title||'').toLowerCase();
    if(/\b(sell|sold|sale)\b/.test(title)) return 'sell';
    if(/\b(buy|bought|purchase|win)\b/.test(title)) return 'buy';
    return null;
  }
  function sourceFrom(title) {
    const s=String(title||'').toLowerCase();
    if(s.includes('item receive')||s.includes('item received'))return'Player Transfer'; if(s.includes('item market'))return'Item Market'; if(s.includes('bazaar'))return'Bazaar'; if(s.includes('abroad')||s.includes('travel'))return'Foreign Market'; if(s.includes('auction'))return'Auction House'; if(s.includes('city find'))return'City Find'; if(s.includes('crime'))return'Crime Reward'; if(s.includes('mission'))return'Mission Reward'; if(s.includes('seasonal')||s.includes('christmas')||s.includes('easter')||s.includes('halloween'))return'Seasonal Reward'; if(s.includes('job')||s.includes('company special'))return'Job / Company Reward'; if(s.includes('shop'))return'Torn Shop'; return title||'Other';
  }
  function isFreeAcquisition(title,data) {
    const s=String(title||'').toLowerCase();
    if(/crime success|organized crime success|city find|mission reward|seasonal gift|christmas town|easter egg hunt|halloween basket|job special|company special|event reward|competition reward|items? incoming|item.*received|item.*gained/.test(s)) return true;
    return !!(data?.item_gained||data?.items_gained||data?.item_received||data?.items_received||data?.reward_item||data?.reward_items||data?.loot_item||data?.loot_items);
  }

  function normalizeItems(data) {
    data=data||{};
    const out=[];
    const push=(id,q=1)=>{id=Number(id);q=Number(q);if(Number.isInteger(id)&&id>0&&Number.isFinite(q)&&q>0)out.push({id,qty:q});};
    const itemKeys=new Set(['items','item','item_id','itemid','item_ids','itemids','items_bought','items_sold','item_bought','item_sold','items_gained','item_gained','items_received','item_received','reward_items','reward_item','loot_items','loot_item','found_items','found_item']);
    const visit=(v,defaultQty=1,depth=0)=>{
      if(v==null||depth>8)return;
      if(typeof v==='number' || (typeof v==='string' && /^\d+$/.test(v))){push(v,defaultQty);return;}
      if(Array.isArray(v)){v.forEach(z=>visit(z,defaultQty,depth+1));return;}
      if(typeof v!=='object')return;
      const id=v.id??v.item_id??v.itemId??v.itemID??v.itemid;
      const hasQty=('qty'in v)||('quantity'in v)||('amount'in v)||('count'in v);
      if(id!=null && (hasQty || (depth>0 && Object.keys(v).length<10))){
        const q=v.qty??v.quantity??v.amount??v.count??defaultQty;
        push(id,q); return;
      }
      Object.entries(v).forEach(([k,val])=>{
        const lk=String(k).toLowerCase();
        if(/^\d+$/.test(k)){
          if(typeof val==='number') push(k,val);
          else if(Array.isArray(val)) push(k,val[0]??defaultQty);
          else if(val && typeof val==='object') push(k,val.qty??val.quantity??val.amount??val.count??defaultQty);
        } else if(itemKeys.has(lk)) visit(val,v.quantity??v.qty??v.amount??v.count??defaultQty,depth+1);
        else if(val && typeof val==='object' && depth<3 && /item|reward|loot|gain|receive|find|found|purchase|bought|buy|sale|sold|sell|abroad|foreign|travel|market|shop/.test(lk)) visit(val,defaultQty,depth+1);
      });
    };
    const q=data.quantity??data.qty??data.amount??data.count??1;
    // Prefer one canonical representation; an item and item_id alias describe the same item.
    const canonical=['items','items_bought','items_sold','items_gained','items_received','reward_items','loot_items','found_items','item','item_id','itemid','item_bought','item_sold','item_gained','item_received','reward_item','loot_item','found_item'].find(k=>data[k]!=null);
    if(canonical)visit(data[canonical],q,1);else visit(data,q,0);
    const merged=new Map();out.forEach(x=>merged.set(x.id,(merged.get(x.id)||0)+x.qty));return [...merged].map(([id,qty])=>({id,qty}));
  }

  function cashTotal(data, qtyValue) {
    const totalKeys=['cost_total','total_cost','total','price_total','total_price','money','amount_paid','price_paid','cost_paid','proceeds','revenue','sale_total','total_value'];
    const fields=flattenNumericFields(data);
    for(const k of totalKeys){const row=fields.find(x=>x.path===k||(!/(^|\.)(items?|rewards?|loot)(\.|$)/.test(x.path)&&x.path.endsWith('.'+k)));if(row&&row.value>=0)return row.value;}
    const eachKeys=['cost_each','price_each','unit_price','price','cost','value_each'];
    for(const k of eachKeys){const row=fields.find(x=>x.path===k||(!/(^|\.)(items?|rewards?|loot)(\.|$)/.test(x.path)&&x.path.endsWith('.'+k)));if(row&&row.value>=0)return row.value*Math.max(1,qtyValue||1);}
    return null;
  }
  function fees(data) {
    return ['fee','fees','tax','market_fee','listing_fee'].reduce((s,k)=>s+(Number(data?.[k])||0),0);
  }

  function parseLogEntry(entry) {
    const logTypeId=Number(entry.details?.id)||0;
    const known=KNOWN_TRANSACTION_LOGS.get(logTypeId);
    const title=entry.details?.title||'';
    if(/\btrade\b/i.test(title))return[];
    const payload={...(entry.params||{}),...(entry.data||{})};
    const monetaryContext=!!known||/(item market|bazaar|abroad|foreign market|torn shop|auction)/i.test(title);
    const free=isFreeAcquisition(title,payload)&&!monetaryContext;
    const side=known?.side||classify(title)||(free?'buy':null); if(!side)return[];
    const items=normalizeItems(payload); if(!items.length){if(known)reportDiagnostic('ITEM_PARSE','warning','An item transaction could not be read and is excluded.',{logId:logTypeId,timestamp:Number(entry.timestamp),source:known.source});return[];}
    const totalAll=free?0:cashTotal(payload,items.reduce((s,x)=>s+x.qty,0)); const fee=side==='sell'?fees(payload):0;
    const totalQty=items.reduce((s,x)=>s+x.qty,0)||1;
    const amountKnown=totalAll!==null;
    if(!amountKnown)reportDiagnostic('ITEM_VALUE_MISSING','warning','Item quantity is recorded, but its cash value is unavailable. Affected profit is excluded.',{logId:logTypeId,timestamp:Number(entry.timestamp),source:known?.source||sourceFrom(title)});
    const detectedSource=sourceFrom(title),detectedSide=classify(title);
    if(known&&((detectedSide&&detectedSide!==known.side)||(['Item Market','Bazaar','Torn Shop','Foreign Market'].includes(detectedSource)&&detectedSource!==known.source)))reportDiagnostic('LOG_SOURCE_MISMATCH','warning','Log title disagrees with its known type. The known log type is used.',{logId:logTypeId,timestamp:Number(entry.timestamp),source:known.source});
    if(items.length>1&&!free)reportDiagnostic('ITEM_ALLOCATION','warning','A multi-item log uses quantity-based cash allocation.',{logId:logTypeId,source:known?.source||detectedSource});
    return items.map(it=>{
      const ratio=it.qty/totalQty; const total=totalAll*ratio; const feeShare=fee*ratio;
      return {id:`${entry.id}:${it.id}`,logId:logTypeId,timestamp:Number(entry.timestamp),nanostamp:entry.nanostamp?String(entry.nanostamp):undefined,itemId:it.id,side,qty:it.qty,total,fee:feeShare,netTotal:side==='sell'?Math.max(0,total-feeShare):total,source:known?.source||sourceFrom(title),title,free,costKnown:amountKnown,proceedsKnown:amountKnown,estimated:items.length>1&&!free};
    });
  }

  function isNonCashCompanyAdminLog(title) {
    const text=String(title||'').toLowerCase();
    return /company.*wage.*change|wage.*change.*company|company wage change|employee wage change/.test(text);
  }
  function financialTitleContext(title) {
    return /(money|cash|bank|vault|wage|salary|pay|payment|deposit|withdraw|interest|dividend|casino|bookie|lottery|stock|share|bounty|rent|loan|fee|tax|rehab|travel|property|company|faction|donat|mug|crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime|points|award|reward|income|expense|cost|profit|loss)/i.test(String(title||''));
  }
  function flattenNumericFields(value,path='',out=[],depth=0) {
    if(value==null||depth>7)return out;
    if(typeof value==='number'&&Number.isFinite(value)){out.push({path:path.toLowerCase(),value});return out;}
    if(typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)){out.push({path:path.toLowerCase(),value:Number(value)});return out;}
    if(Array.isArray(value)){value.forEach((v,i)=>flattenNumericFields(v,`${path}.${i}`,out,depth+1));return out;}
    if(typeof value==='object')Object.entries(value).forEach(([k,v])=>flattenNumericFields(v,path?`${path}.${k}`:k,out,depth+1));
    return out;
  }
  function bestMoneyField(payload,title) {
    const rows=flattenNumericFields(payload),financial=financialTitleContext(title),bad=/(^|\.)(id|item_id|itemid|qty|quantity|count|timestamp|time|duration|rate|percent|percentage|balance|maximum|current|points)(\.|$)/i;
    let best=null;
    for(const row of rows){
      if(bad.test(row.path)||!Number.isFinite(row.value)||row.value===0)continue;
      let score=0;
      if(/money|cash/.test(row.path))score+=12;
      if(/received|gained|earned|winnings|payout|salary|wage|interest|dividend|reward|profit/.test(row.path))score+=10;
      if(/spent|paid|payment|cost|price|fee|tax|loss|lost|expense|bounty|loan/.test(row.path))score+=9;
      if(/amount|total|value/.test(row.path)&&financial)score+=4;
      if(score>0&&(!best||score>best.score||(score===best.score&&Math.abs(row.value)>Math.abs(best.value))))best={...row,score};
    }
    return best;
  }
  function cashFlowDirection(title,path='',logTypeId=0) {
    const s=`${title} ${path}`.toLowerCase();
    if(EXPLICIT_CASH_LOGS.has(Number(logTypeId)))return EXPLICIT_CASH_LOGS.get(Number(logTypeId)).direction;
    if(Number(logTypeId)===8155)return 'in';
    if(Number(logTypeId)===8156)return 'out';
    if(/deposit/.test(s)&&/(bank|vault|faction|company|cayman|piggy|property)/.test(s))return 'transfer-out';
    if(/withdraw/.test(s)&&/(bank|vault|faction|company|cayman|piggy|property)/.test(s))return 'transfer-in';
    if(/mugged you|you were mugged|mugged by/.test(s))return 'out';
    if(/you mugged/.test(s))return 'in';
    if(/money_lost|cash_spent|money_sent|cash_sent|sent|spent|cost|fee|tax|expense|loss|lost|paid|payment|purchase|bought|buy|rehab|rent|donat|bounty placed|loan repayment/.test(s))return 'out';
    if(/money_gained|money_received|cash_received|received|gained|earned|income|wage|salary|interest|dividend|winnings|payout|reward|profit|sold|sale|win|won/.test(s))return 'in';
    if(/mug/.test(s))return 'in';
    return null;
  }
  function cashFlowCategory(title,direction) {
    const s=String(title||'').toLowerCase();
    if(/money sent|money received|player transfer|faction payday sent|faction money given/.test(s))return 'Player Transfers';
    if(direction?.startsWith('transfer'))return /faction/.test(s)?'Faction Transfer':/company/.test(s)?'Company Transfer':/property|vault/.test(s)?'Property / Vault Transfer':/piggy/.test(s)?'Piggy Bank Transfer':/cayman|bank/.test(s)?'Bank Transfer':'Internal Transfer';
    if(/casino|bookie|lottery|roulette|poker|blackjack|slots/.test(s))return 'Gambling';
    if(/stock|share|dividend/.test(s))return 'Stocks / Investing';
    if(/property|rent|upkeep/.test(s))return 'Property';
    if(/travel|flight/.test(s))return 'Travel';
    if(/rehab/.test(s))return 'Rehab';
    if(/education|course/.test(s))return 'Education';
    if(/bounty/.test(s))return 'Bounties';
    if(/crime|mug|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime/.test(s))return 'Crime / Mugging';
    if(/wage|salary|job pay|company pay/.test(s))return 'Wages / Job';
    if(/fee|tax/.test(s))return 'Fees / Taxes';
    if(/point/.test(s))return 'Points';
    if(/award|reward|mission/.test(s))return 'Rewards';
    return direction==='in'?'Other Income':'Other Spending';
  }
  function nestedValue(obj,path) {
    let v=obj;for(const part of String(path||'').split('.')){if(!part)continue;if(v==null)return undefined;v=v[part];}return v;
  }
  function extractCounterparty(payload,direction='') {
    payload=payload||{};
    const idKeys=direction==='out'?['recipient','receiver','target','user','player','recipient_id','receiver_id','target_id','user_id','player_id']:['sender','from','user','player','sender_id','user_id','player_id'];
    const nameKeys=direction==='out'?['recipient_name','receiver_name','target_name','user_name','player_name']:['sender_name','from_name','user_name','player_name'];
    let id=0,name='';
    for(const k of idKeys){const v=payload?.[k];if(typeof v==='number'||(typeof v==='string'&&/^\d+$/.test(v))){id=Number(v)||0;break;}if(v&&typeof v==='object'){id=Number(v.id??v.user_id??v.player_id)||0;name=String(v.name??v.username??'');if(id||name)break;}}
    for(const k of nameKeys){if(payload?.[k]){name=String(payload[k]);break;}}
    return {id,name};
  }
  function explicitCashAmount(payload,meta) {
    const direct=Number(nestedValue(payload,meta?.field));if(Number.isFinite(direct)&&direct!==0)return Math.abs(direct);
    const f=bestMoneyField(payload,meta?.label||'');return f?Math.abs(Number(f.value)||0):0;
  }
  function strictCrimeCashField(payload,title='') {
    const rows=flattenNumericFields(payload),t=String(title||'').toLowerCase();
    const incoming=/(^|\.)(money_gained|money_received|money_earned|money_reward|money_rewarded|cash_gained|cash_received|cash_earned|cash_reward|cash_rewarded)$/i;
    const outgoing=/(^|\.)(money_lost|money_spent|money_paid|cash_lost|cash_spent|cash_paid)$/i;
    const legacyMoney=/(^|\.)(money|cash)$/i;
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
    // This migration runs during startup before perfCache is initialized, so only
    // persist the cleaned rows here. Analytics caches are still empty at this point.
    if(removed>0)save('cashFlows',state.cashFlows);
    return removed;
  }
  function parseCashFlowEntry(entry,parsedItemRows=[]) {
    const entryTitle=String(entry?.details?.title||'');
    const crimeContext=/crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime/i.test(entryTitle);
    // A raw Torn event may legitimately project into several analyzer workspaces at once.
    // Only suppress generic cash extraction when a normalized paid item buy/sell already
    // owns that same cash movement; free/reward item rows must not hide separate money.
    const itemRowsOwnCashMovement=(parsedItemRows||[]).some(t=>{
      const side=String(t?.side||''),total=Math.max(0,Number(t?.total)||0);
      return (side==='buy'||side==='sell')&&total>0&&!t?.free;
    });
    if(itemRowsOwnCashMovement&&!crimeContext)return[];
    const logTypeId=Number(entry?.details?.id)||0,title=entryTitle;
    if(isNonCashCompanyAdminLog(title))return[];
    const payload={...(entry?.params||{}),...(entry?.data||{})},explicit=EXPLICIT_CASH_LOGS.get(logTypeId);
    if(explicit){
      const amount=explicitCashAmount(payload,explicit);if(!(amount>0))return[];
      const cp=extractCounterparty(payload,explicit.direction),suffix=cp.name?` ${explicit.direction==='out'?'to':'from'} ${cp.name}`:cp.id?` ${explicit.direction==='out'?'to':'from'} #${cp.id}`:'';
      return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction:explicit.direction,amount,category:explicit.category,source:explicit.category==='Player Transfers'?'Player Transfer':'Torn Log',title:`${title||explicit.label}${suffix}`,logId:logTypeId,field:explicit.field,transfer:false,counterpartyId:cp.id||0,counterpartyName:cp.name||''}];
    }
    if(KNOWN_TRANSACTION_LOGS.has(logTypeId)||/\btrade\b/i.test(title)||!financialTitleContext(title))return[];
    if(/company/i.test(title)&&/\b(deposit|withdraw(?:al)?)\b/i.test(title))return[];
    if(crimeContext){
      const field=strictCrimeCashField(payload,title);if(!field)return[];
      const amount=Math.abs(Number(field.value)||0);if(!(amount>0))return[];
      return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction:field.direction,amount,category:'Crime / Mugging',source:'Crime Reward',title,logId:logTypeId,field:field.path,transfer:false}];
    }
    const field=bestMoneyField(payload,title);if(!field)return[];
    reportDiagnostic('CASH_INFERRED','info','A cash amount or category was inferred from a log payload. Review the event if totals look incorrect.',{logId:logTypeId,source:'User Logs'});
    const direction=cashFlowDirection(title,field.path,logTypeId);if(!direction)return[];
    const amount=Math.abs(Number(field.value)||0);if(!(amount>0))return[];
    return [{id:`cashlog:${entry.id}`,timestamp:Number(entry.timestamp)||0,direction,amount,category:cashFlowCategory(title,direction),source:'Torn Log',title,logId:logTypeId,field:field.path,transfer:direction.startsWith('transfer')}];
  }
  function parsePlayerTransferEntry(entry) {
    const logTypeId=Number(entry?.details?.id)||0,meta=PLAYER_ITEM_LOGS.get(logTypeId);if(!meta)return[];
    const payload={...(entry?.params||{}),...(entry?.data||{})},cp=extractCounterparty(payload,meta.direction),items=normalizeItems(payload);
    return items.filter(x=>Number(x.id)>0&&Number(x.qty)>0).map((x,i)=>({id:`playeritem:${entry.id}:${x.id}:${i}`,timestamp:Number(entry.timestamp)||0,type:'item',direction:meta.direction,itemId:Number(x.id),qty:Number(x.qty),logId:logTypeId,title:entry?.details?.title||meta.label,source:'Player Transfer',counterpartyId:cp.id||0,counterpartyName:cp.name||'',message:String(payload?.message||'')}));
  }
  function checkpointPlayerTransferRows(rows) {
    if(!rows?.length)return 0;const map=new Map((state.playerTransfers||[]).map(x=>[String(x.id),x]));let added=0;
    for(const row of rows){if(!row?.id||JSON.stringify(map.get(String(row.id)))===JSON.stringify(row))continue;map.set(String(row.id),row);added++;}
    if(added){state.playerTransfers=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));if(!save('playerTransfers',state.playerTransfers))throw new AnalyzerError('STORAGE_WRITE','Item transfers could not be saved.');resetAnalyticsCache();}return added;
  }
  function itemUseTitle(title) { return /^item use\b/i.test(String(title||'')); }
  function consumedItemsFromPayload(payload) {
    payload=payload||{};const out=[],seen=new Set();
    const add=(id,q=1)=>{id=Number(id);q=Math.max(1,Number(q)||1);if(!(id>0)||seen.has(id))return;seen.add(id);out.push({id,qty:q});};
    const read=(v,fallbackQty=1)=>{
      if(v==null)return;
      if(typeof v==='number'||(typeof v==='string'&&/^\d+$/.test(v))){add(v,fallbackQty);return;}
      if(typeof v!=='object')return;
      const id=Number(v.id??v.item_id??v.itemid??v.itemID??v.itemId),q=Number(v.qty??v.quantity??v.amount??v.count??fallbackQty)||1;
      if(id>0)add(id,q);
    };
    const fallbackQty=Number(payload.qty??payload.quantity??payload.amount??payload.count)||1;
    read(payload.item,fallbackQty);read(payload.item_used,fallbackQty);read(payload.used_item,fallbackQty);read(payload.consumed_item,fallbackQty);
    for(const k of ['item_id','itemid','itemId','used_item_id','item_used_id','consumed_item_id'])if(payload[k]!=null)add(payload[k],fallbackQty);
    if(!out.length){const normalized=normalizeItems(payload);if(normalized.length)add(normalized[0].id,normalized[0].qty);}
    return out;
  }
  function parseItemConsumptionEntry(entry) {
    const title=String(entry?.details?.title||'');if(!itemUseTitle(title))return[];
    const payload={...(entry?.params||{}),...(entry?.data||{})},items=consumedItemsFromPayload(payload),logTypeId=Number(entry?.details?.id)||0;
    return items.map((x,i)=>({id:`consume:${entry.id}:${x.id}:${i}`,timestamp:Number(entry?.timestamp)||0,itemId:Number(x.id),qty:Number(x.qty)||1,logId:logTypeId,title,source:'Item Use',useType:title.replace(/^item use\s*/i,'').trim()||'Item'}));
  }
  function checkpointItemConsumptionRows(rows) {
    if(!rows?.length)return 0;const map=new Map((state.itemConsumptions||[]).map(x=>[String(x.id),x]));let added=0;
    for(const row of rows){if(!row?.id||JSON.stringify(map.get(String(row.id)))===JSON.stringify(row))continue;map.set(String(row.id),row);added++;}
    if(added){state.itemConsumptions=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));if(!save('itemConsumptions',state.itemConsumptions))throw new AnalyzerError('STORAGE_WRITE','Item use history could not be saved.');resetAnalyticsCache();}return added;
  }
  function unrecognizedRowFor(entry) {
    const logTypeId=Number(entry?.details?.id)||0,title=String(entry?.details?.title||''),category=String(entry?.details?.category||entry?.category||'');
    if(isNonCashCompanyAdminLog(title)||!financialTitleContext(`${title} ${category}`)||EXPLICIT_CASH_LOGS.has(logTypeId)||PLAYER_ITEM_LOGS.has(logTypeId)||KNOWN_TRANSACTION_LOGS.has(logTypeId)||/\btrade\b/i.test(title))return null;
    const payload={...(entry?.params||{}),...(entry?.data||{})},crimeContext=/crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime/i.test(title),field=crimeContext?strictCrimeCashField(payload,title):bestMoneyField(payload,title);if(!field)return null;
    return {id:`unmapped:${entry.id}`,timestamp:Number(entry.timestamp)||0,logId:logTypeId,title:title||`Log ${logTypeId}`,category:category||'Financial',field:field.path,amount:Math.abs(Number(field.value)||0)};
  }
  function checkpointUnrecognizedFinancial(entry,recognized=false) {
    const key=`unmapped:${entry?.id}`;let rows=(state.unrecognizedFinancial||[]).filter(x=>String(x.id)!==key);
    if(!recognized){const row=unrecognizedRowFor(entry);if(row)rows.push(row);}
    rows.sort((a,b)=>(Number(b.timestamp)||0)-(Number(a.timestamp)||0));state.unrecognizedFinancial=rows.slice(0,300);save('unrecognizedFinancial',state.unrecognizedFinancial);
  }

  function checkpointCashFlowRows(rows,replaceIds=[]) {
    if(!rows?.length&&!replaceIds.length)return 0;const map=new Map((state.cashFlows||[]).map(x=>[String(x.id),x]));let added=0;
    const incoming=new Set((rows||[]).map(row=>String(row.id)));
    for(const id of replaceIds)if(!incoming.has(String(id))&&map.delete(String(id)))added++;
    for(const row of rows){if(!row?.id||!(Number(row.amount)>0)||JSON.stringify(map.get(String(row.id)))===JSON.stringify(row))continue;map.set(String(row.id),row);added++;}
    if(added){state.cashFlows=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));if(!save('cashFlows',state.cashFlows))throw new AnalyzerError('STORAGE_WRITE','Cash movements could not be saved.');}
    return added;
  }

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
      if(isNonCashCompanyAdminLog(title)||(/company/i.test(title)&&/\b(deposit|withdraw(?:al)?)\b/i.test(title))){changed=true;continue;}
      let x=row;
      if(id===8155||/\byou mugged\b/i.test(title)){
        if(row.direction!=='in'||row.category!=='Crime / Mugging'||row.transfer){x={...row,direction:'in',category:'Crime / Mugging',transfer:false};changed=true;}
      }else if(id===8156||/\bmugged you\b|\byou were mugged\b|\bmugged by\b/i.test(title)){
        if(row.direction!=='out'||row.category!=='Crime / Mugging'||row.transfer){x={...row,direction:'out',category:'Crime / Mugging',transfer:false};changed=true;}
      }
      next.push(x);
    }
    if(changed){state.cashFlows=next.sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));save('cashFlows',state.cashFlows);}
    return changed;
  }

  function tradeItemGroups(entries,userId,outgoing=true) {
    const map=new Map(),me=Number(userId);
    for(const entry of entries||[]){
      if(String(entry?.type).toLowerCase()!=='item')continue;
      const owner=Number(entry?.user_id),mine=owner===me;
      if((outgoing&&!mine)||(!outgoing&&mine))continue;
      const id=Number(entry?.details?.id),amount=Number(entry?.details?.amount)||0;
      if(!(id>0)||!(amount>0))continue;
      const row=map.get(id)||{itemId:id,qty:0};row.qty+=amount;map.set(id,row);
    }
    return [...map.values()].map(row=>{
      const marketPrice=Math.max(0,Number(catalogItem(row.itemId)?.marketPrice)||0);
      return {...row,marketPrice,baseMarket:marketPrice*row.qty};
    });
  }

  function tradeMoneyFor(entries,userId,owned=true) {
    const me=Number(userId);let total=0;
    for(const entry of entries||[]){
      if(String(entry?.type).toLowerCase()!=='money')continue;
      const mine=Number(entry?.user_id)===me;if((owned&&!mine)||(!owned&&mine))continue;
      total+=Math.max(0,Number(entry?.details?.amount)||0);
    }
    return total;
  }

  function parsePlayerTradeEvent(trade,userId) {
    const tradeId=Number(trade?.id)||0,ts=Number(trade?.completed_at||trade?.timestamp)||0,me=Number(userId),entries=Array.isArray(trade?.items)?trade.items:[];
    if(!(tradeId>0)||!(ts>0)||!(me>0)||!entries.length)return null;
    const outgoing=tradeItemGroups(entries,me,true),incoming=tradeItemGroups(entries,me,false),cashOut=tradeMoneyFor(entries,me,true),cashIn=tradeMoneyFor(entries,me,false);
    if(!outgoing.length&&!incoming.length&&!(cashOut>0)&&!(cashIn>0))return null;
    const user=trade?.user||{},trader=trade?.trader||{},other=Number(user?.id)===me?trader:user;
    return {id:`playertrade:${tradeId}`,tradeId,timestamp:ts,counterpartyId:Number(other?.id)||0,counterpartyName:String(other?.name||''),cashIn,cashOut,incomingItems:incoming.map(x=>({itemId:Number(x.itemId),qty:Number(x.qty)||0})),outgoingItems:outgoing.map(x=>({itemId:Number(x.itemId),qty:Number(x.qty)||0}))};
  }
  function checkpointPlayerTradeEvents(rows) {
    const list=(rows||[]).filter(Boolean);if(!list.length)return 0;const map=new Map((state.playerTrades||[]).map(x=>[String(x.id),x]));let changed=0;
    for(const row of list){if(!row?.id)continue;const key=String(row.id),prev=map.get(key),next={...(prev||{}),...row};if(!prev||JSON.stringify(prev)!==JSON.stringify(next)){map.set(key,next);changed++;}}
    if(changed){state.playerTrades=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));if(!save('playerTrades',state.playerTrades))throw new AnalyzerError('STORAGE_WRITE','Player trades could not be saved.');}return changed;
  }
  function reconstructedPlayerTradeEvents() {
    const groups=new Map();
    for(const t of state.transactions||[]){if(t?.source!=='Player Trade'||!(Number(t.tradeId)>0))continue;const id=Number(t.tradeId);let g=groups.get(id);if(!g){g={id:`playertrade:${id}`,tradeId:id,timestamp:Number(t.timestamp)||0,counterpartyId:Number(t.counterpartyId)||0,counterpartyName:String(t.counterpartyName||''),cashIn:Math.max(0,Number(t.tradeCashIn)||0),cashOut:Math.max(0,Number(t.tradeCashOut)||0),incomingItems:[],outgoingItems:[]};groups.set(id,g);}g.timestamp=Math.max(g.timestamp,Number(t.timestamp)||0);if(t.side==='buy')g.incomingItems.push({itemId:Number(t.itemId)||0,qty:Number(t.qty)||0});else if(t.side==='sell')g.outgoingItems.push({itemId:Number(t.itemId)||0,qty:Number(t.qty)||0});}
    return [...groups.values()];
  }
  function effectivePlayerTradeEvents() {
    const map=new Map();for(const x of reconstructedPlayerTradeEvents())map.set(String(x.id),x);for(const x of state.playerTrades||[])if(x?.id)map.set(String(x.id),x);return [...map.values()].sort((a,b)=>(Number(b.timestamp)||0)-(Number(a.timestamp)||0));
  }
  function playerTradeEventRows(evt) {
    return [...(evt?.outgoingItems||[]).map(x=>({...x,side:'sell'})),...(evt?.incomingItems||[]).map(x=>({...x,side:'buy'}))];
  }

  function allocateTradeGroupTotals(groups,targetTotal) {
    if(!groups?.length)return[];
    const target=Math.max(0,Number(targetTotal)||0);
    const values=groups.map(g=>Math.max(0,Number(g.baseMarket)||0));
    const baseTotal=values.reduce((n,x)=>n+x,0);
    let delta=target-baseTotal;
    if(delta>=0){
      const add=delta/values.length;for(let i=0;i<values.length;i++)values[i]+=add;
    }else{
      let deficit=-delta,active=values.map((_,i)=>i);
      while(deficit>1e-7&&active.length){
        const share=deficit/active.length,removed=[];
        for(const i of active){if(values[i]<=share+1e-7){deficit-=values[i];values[i]=0;removed.push(i);}}
        if(!removed.length){for(const i of active)values[i]-=share;deficit=0;}
        else active=active.filter(i=>!removed.includes(i));
      }
    }
    const correction=target-values.reduce((n,x)=>n+x,0);
    if(values.length)values[values.length-1]=Math.max(0,values[values.length-1]+correction);
    return groups.map((g,i)=>({...g,total:values[i],adjustment:values[i]-(Number(g.baseMarket)||0)}));
  }

  function parsePlayerTrade(trade,userId) {
    const tradeId=Number(trade?.id)||0,ts=Number(trade?.completed_at||trade?.timestamp)||0,me=Number(userId);
    const entries=Array.isArray(trade?.items)?trade.items:[];
    if(!(tradeId>0)||!(ts>0)||!(me>0)||!entries.length)return[];
    const outgoing=tradeItemGroups(entries,me,true),incoming=tradeItemGroups(entries,me,false);
    if(!outgoing.length&&!incoming.length)return[];
    const cashOut=tradeMoneyFor(entries,me,true),cashIn=tradeMoneyFor(entries,me,false),netCash=cashIn-cashOut;
    const mvOut=outgoing.reduce((n,x)=>n+x.baseMarket,0),mvIn=incoming.reduce((n,x)=>n+x.baseMarket,0);
    let saleTarget=0,buyTarget=0;
    if(outgoing.length&&!incoming.length)saleTarget=Math.max(0,netCash);
    else if(incoming.length&&!outgoing.length)buyTarget=Math.max(0,-netCash);
    else if(outgoing.length&&incoming.length){
      buyTarget=mvIn;saleTarget=mvIn+netCash;
      if(saleTarget<0){saleTarget=mvOut;buyTarget=mvOut-netCash;}
    }
    const saleGroups=allocateTradeGroupTotals(outgoing,saleTarget),buyGroups=allocateTradeGroupTotals(incoming,buyTarget);
    const user=trade?.user||{},trader=trade?.trader||{};
    const other=Number(user?.id)===me?trader:user;
    const tradeSurplus=(mvIn+cashIn)-(mvOut+cashOut);
    const unsupported=entries.some(x=>!['item','money'].includes(String(x?.type).toLowerCase()));
    const mixed=!!(outgoing.length&&incoming.length),estimated=mixed||outgoing.length>1||incoming.length>1;
    const missingMarket=mixed&&[...outgoing,...incoming].some(x=>!(x.marketPrice>0));
    if(unsupported)reportDiagnostic('TRADE_ASSET_UNVALUED','warning','A trade includes assets other than items or money. Item profit is unavailable; actual cash is retained.',{tradeId,source:'Player Trade'});
    if(missingMarket)reportDiagnostic('TRADE_MARKET_MISSING','warning','A mixed trade has missing market prices. Item profit is unavailable.',{tradeId,source:'Player Trade'});
    const common={timestamp:ts,fee:0,source:'Player Trade',title:`Player Trade${other?.name?` with ${other.name}`:''}`,tradeId,counterpartyId:Number(other?.id)||0,counterpartyName:String(other?.name||''),tradeCashIn:cashIn,tradeCashOut:cashOut,tradeSurplus,estimated,costKnown:!unsupported&&!missingMarket,proceedsKnown:!unsupported&&!missingMarket,allocationMethod:estimated?'market-value + equal cash delta':null};
    const sold=saleGroups.map(g=>({id:`trade:${tradeId}:1:sell:${g.itemId}`,logId:0,itemId:g.itemId,side:'sell',qty:g.qty,total:g.total,netTotal:g.total,free:false,marketPriceUsed:g.marketPrice,marketSubtotal:g.baseMarket,tradeAdjustment:g.adjustment,...common}));
    const bought=buyGroups.map(g=>({id:`trade:${tradeId}:2:buy:${g.itemId}`,logId:0,itemId:g.itemId,side:'buy',qty:g.qty,total:g.total,netTotal:g.total,free:g.total<=1e-7,marketPriceUsed:g.marketPrice,marketSubtotal:g.baseMarket,tradeAdjustment:g.adjustment,...common}));
    return [...sold,...bought];
  }

  function isLegacyTradeLogTransaction(t) {
    return t?.source!=='Player Trade'&&/\btrade\b/i.test(String(t?.title||''));
  }
