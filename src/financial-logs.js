  // Monetary log titles are discovered from /torn/logtypes at runtime. Torn's
  // public OpenAPI documents dynamic data/params, not a universal amount schema.
  // Never assign undocumented numerical log IDs or equate points with dollars.
  function financialDomain(title) {
    const t=String(title||'').toLowerCase();
    if(/\bgym\b/.test(t)&&/\b(member(?:ship)?|unloc(?:k|ked)|join(?:ed)?|purchas(?:e|ed)|bought|paid)\b/.test(t))return 'Gym Memberships';
    if(/\b(?:education|course)\b/.test(t)&&/\b(?:start(?:ed)?|enrol(?:l|led|ment)?|register(?:ed)?|paid|purchas(?:e|ed)|fee)\b/.test(t))return 'Education';
    if(/\b(?:racing|race|car|garage)\b/.test(t)&&/\b(?:upgrade|purchas(?:e|ed)|buy|bought|entry fee|registration fee|paid)\b/.test(t))return 'Racing';
    if(/\b(?:casino|roulette|blackjack|poker|slots?|bookie|lottery|high.low|wheel of|keno|craps)\b/.test(t))return 'Gambling';
    if(/\b(?:stock|shares?|dividend)\b/.test(t))return 'Stocks / Investing';
    if(/\b(?:property|estate|rental|landlord|rent|upkeep)\b/.test(t))return 'Property';
    if(/\b(?:bank|investment)\b/.test(t)&&/\b(?:interest|deposit|withdraw|invest|matur|renew|collect|received|paid|cash)\b/.test(t))return 'Banking';
    if(/\bhunt(?:ing|ed)?\b/.test(t))return 'Hunting';
    if(/\b(?:cashier.?s? check|cashier.?s? cheque|cheque|cashier check)\b/.test(t))return 'Checks';
    if(/\bbail\b/.test(t))return 'Bail';
    if(/\bloan\b/.test(t))return 'Loans';
    if(/\bauction\b/.test(t))return 'Auction';
    if(/\b(?:fortune teller|fortune-teller|church|service fee|subscription|consultation fee)\b/.test(t))return 'Services';
    return '';
  }

  function financialCashField(payload,keys) {
    for(const path of keys){
      const value=nestedValue(payload,path);
      if(value==null||typeof value==='boolean'||typeof value==='object')continue;
      if(typeof value==='string'&&!/^-?\d+(?:\.\d+)?$/.test(value))continue;
      const n=Number(value);
      if(Number.isFinite(n)&&Math.abs(n)>0)return {path,value:Math.abs(n)};
    }
    return null;
  }
  const CASH_OUT_KEYS=['money_spent','cash_spent','money_paid','cash_paid','money_lost','cash_lost','amount_paid','cost_total','total_cost','cost_paid','price_paid','cost','fee'];
  const CASH_IN_KEYS=['money_received','cash_received','money_gained','cash_gained','money_earned','cash_earned','money_won','cash_won','proceeds','sale_total','total_proceeds','payout','refund','interest'];

  // A matched domain owns the event, including when no reliable amount can be read:
  // this prevents older fuzzy generic rules from reversing a property sale or
  // counting a race-point upgrade as a dollar expense.
  function parseDomainCashFlowEntry(entry) {
    const title=String(entry?.details?.title||''),domain=financialDomain(title);
    if(!domain)return null;
    const s=title.toLowerCase(),payload={...(entry?.params||{}),...(entry?.data||{})};
    const logId=Number(entry?.details?.id)||0,base='cashlog:'+String(entry?.id||'');
    const timestamp=Number(entry?.timestamp)||0,rows=[];
    const out=keys=>financialCashField(payload,keys),incoming=keys=>financialCashField(payload,keys);
    const add=(direction,field,category=domain,kind='cash')=>{
      if(!field||!(field.value>0))return;
      rows.push({id:base+':'+kind,timestamp,direction,amount:field.value,category,source:'Torn Log',
        title,detail:(field.path.includes(' - ')?'Calculated from ':'Verified ')+field.path+' field',logId,field:field.path,
        transfer:direction.startsWith('transfer')});
    };
    if(domain==='Gym Memberships'){
      if(/\b(?:membership|unlock|join|purchase|bought|paid)\b/.test(s))add('out',out([...CASH_OUT_KEYS,'price','amount'])); 
    }else if(domain==='Education'){
      if(!/\b(?:finish|complete|graduate|cancel)\b/.test(s))add('out',out([...CASH_OUT_KEYS,'price','amount']));
    }else if(domain==='Racing'){
      // Racing points and car stat upgrades are not dollar flows without a cash field.
      add('out',out(['money_spent','cash_spent','money_paid','cash_paid','amount_paid','price_paid','cash_cost']));
    }else if(domain==='Gambling'){
      const netOut=out(['money_lost','cash_lost','money_spent','cash_spent']);
      const netIn=incoming(['money_gained','cash_gained','money_won','cash_won']);
      if(netOut||netIn){add('out',netOut);add('in',netIn);}
      else{
        const stake=out(['bet','wager','stake','bet_amount','wager_amount']);
        const gross=incoming(['payout','gross_payout','total_payout']);
        if(stake&&gross){add('out',stake,domain,'stake');add('in',gross,domain,'payout');}
        else if(stake&&/\b(?:bet placed|wager placed|lost|loss)\b/.test(s))add('out',stake);
        // "winnings" may mean net profit rather than a gross payout; review.
      }
    }else if(domain==='Stocks / Investing'){
      if(/\b(?:dividend|benefit)\b/.test(s))add('in',incoming([...CASH_IN_KEYS,'amount']),domain);
      else if(/\b(?:sold|sell|sale)\b/.test(s))add('transfer-in',incoming(['money_received','cash_received','proceeds','sale_total','total_proceeds','amount_received','total_sale','sale_price']),domain);
      else if(/\b(?:bought|buy|purchase|purchased)\b/.test(s))add('transfer-out',out([...CASH_OUT_KEYS,'amount_paid','total_price']),domain);
    }else if(domain==='Property'){
      if(/\b(?:sale|sold|sell)\b/.test(s)){
        // A property-sale "cost" can be the listing fee or property valuation.
        // Only explicitly incoming proceeds qualify as cash in.
        add('transfer-in',incoming(['money_received','cash_received','proceeds','sale_total','total_proceeds','sale_price','amount_received']),domain);
      }else if(/\b(?:purchase|purchased|bought|buy)\b/.test(s)){
        add('transfer-out',out([...CASH_OUT_KEYS,'amount_paid','purchase_price']),domain);
      }else if(/\b(?:upkeep|repair|staff fee|maintenance)\b/.test(s)){
        add('out',out([...CASH_OUT_KEYS,'amount']),domain);
      }else if(/\b(?:received|collected|earned|landlord|rental income|rent income)\b/.test(s)){
        add('in',incoming(['rent','rent_received','money_received','cash_received','amount_received','payment_received']),domain);
      }else if(/\b(?:paid|payment|charged|renting|rented)\b/.test(s)){
        add('out',out(['rent','rent_paid',...CASH_OUT_KEYS,'amount_paid']),domain);
      }
    }else if(domain==='Banking'){
      if(/\b(?:interest|matur|completed|expired)\b/.test(s)){
        add('in',incoming(['interest','interest_earned','interest_paid','money_interest']),domain,'interest');
        // Principal is money returned, not earnings. Require a separate principal field.
        add('transfer-in',incoming(['principal_returned','principal_received','principal']),domain,'principal');
      }else if(/\b(?:withdraw|collect)\b/.test(s)){
        add('transfer-in',incoming(['money_received','cash_received','withdrawn','withdrawal','amount']),domain);
      }else if(/\b(?:deposit|invest)\b/.test(s)){
        add('transfer-out',out(['money_spent','cash_spent','deposit','invested','amount_paid','amount']),domain);
      }
    }else if(domain==='Hunting'){
      add('out',out(['money_spent','cash_spent','money_paid','cash_paid','cost','fee']),domain,'cost');
      add('in',incoming(['money_gained','cash_gained','money_received','cash_received','money_earned','cash_earned']),domain,'reward');
    }else if(domain==='Checks'){
      if(/\b(?:cash(?:ed|ing)|redeem(?:ed)?|receive(?:d)?)\b/.test(s))add('transfer-in',incoming(['money_received','cash_received','value','amount']),domain);
      else if(/\b(?:issued|bought|purchase|created|sent|paid)\b/.test(s))add('transfer-out',out(['money_spent','cash_spent','cost','value','amount_paid','amount']),domain);
    }else if(domain==='Bail'){
      if(/\b(?:paid|payment|posted|posting)\b/.test(s))add('out',out([...CASH_OUT_KEYS,'bail','amount']),domain);
    }else if(domain==='Loans'){
      if(/\b(?:repay(?:ment|ments|ing|ed)?|paid back|payment)\b/.test(s)){
        const interest=out(['interest_paid','interest']);
        const principal=out(['principal_paid','principal_repaid','principal']);
        const total=out(['total_paid','repayment','money_spent','amount_paid','amount']);
        if(interest)add('out',interest,domain,'interest');
        if(principal)add('transfer-out',principal,domain,'principal');
        else if(total&&interest&&total.value>=interest.value)
          add('transfer-out',{path:total.path+' - '+interest.path,value:total.value-interest.value},domain,'principal');
        else if(total&&!interest)add('transfer-out',total,domain,'principal');
      }else if(/\b(?:borrowed|received|taken|issued)\b/.test(s)){
        add('transfer-in',incoming(['money_received','cash_received','principal','amount_received','amount']),domain);
      }
    }else if(domain==='Auction'){
      if(/\b(?:listing fee|auction fee|tax|commission)\b/.test(s))add('out',out(['fee','fees','listing_fee','commission','tax','money_spent','cash_spent','cost']),domain);
      // Auction item buy/sell is already owned by the item/FIFO parser.
    }else if(domain==='Services'){
      if(/\b(?:paid|purchased|purchase|donat|fee|subscription)\b/.test(s))add('out',out([...CASH_OUT_KEYS,'price','amount']),domain);
    }
    if(rows.length===1)rows[0].id=base;
    return rows;
  }

  function financialAuditCandidate(entry) {
    const title=String(entry?.details?.title||''),domain=financialDomain(title);
    if(!domain)return false;
    if(domain==='Gym Memberships'||domain==='Education'||domain==='Racing'||domain==='Stocks / Investing'||domain==='Loans'||domain==='Bail')return true;
    const p={...(entry?.params||{}),...(entry?.data||{})};
    return !!financialCashField(p,[...CASH_OUT_KEYS,...CASH_IN_KEYS,'rent','bet','stake','wager','amount','value','principal','winnings'])||
      /\b(?:purchase|paid|fee|sale|sold|rent|interest|winnings|deposit|withdraw|payment|income)\b/i.test(title);
  }
