  const VERSION = '0.4.1';
  // UI-only releases must not invalidate previously verified accounting history.
  const ACCOUNTING_VERSION = '0.3.3';
  const HISTORY_PAGINATION_VERSION = 3;
  const API_KEY = '_###PDA-APIKEY###_';
  const NS = 'tta:v1:';
  const API = 'https://api.torn.com/v2';
  const ANALYZER_CUSTOM_KEY_URL = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=CashFlowAnalyzer&user=log,trade,trades,money,networth&company=profile,employees&torn=items,logtypes';
  const REQUEST_GAP_MS = 1100;
  const BACKGROUND_QUICK_SYNC_MS = 60 * 1000;
  const MAX_LOG_IDS_PER_REQUEST = 10;
  const CATALOG_SCHEMA_VERSION = 2;
  const KNOWN_TRANSACTION_LOGS = new Map([
    [1103, {side:'buy', source:'Item Market'}],
    [1104, {side:'sell', source:'Item Market'}],
    [1112, {side:'buy', source:'Item Market'}],
    [1113, {side:'sell', source:'Item Market'}],
    [1220, {side:'buy', source:'Bazaar'}],
    [1221, {side:'sell', source:'Bazaar'}],
    [1225, {side:'buy', source:'Bazaar'}],
    [1226, {side:'sell', source:'Bazaar'}],
    [4200, {side:'buy', source:'Torn Shop'}],
    [4201, {side:'buy', source:'Foreign Market'}],
    [4210, {side:'sell', source:'Torn Shop'}],
  ]);

  const EXPLICIT_CASH_LOGS = new Map([
    [4800,{direction:'out',field:'money',category:'Player Transfers',label:'Money sent'}],
    [4810,{direction:'in',field:'money',category:'Player Transfers',label:'Money received'}],
    [5010,{direction:'out',field:'cost_total',category:'Points',label:'Points market bought'}],
    [5011,{direction:'in',field:'cost_total',category:'Points',label:'Points market sold'}],
    [6220,{direction:'in',field:'pay',category:'Wages / Job',label:'Job pay'}],
    [6221,{direction:'in',field:'pay',category:'Wages / Job',label:'Company employee pay'}],
    [6404,{direction:'in',field:'money_gained',category:'Wages / Job',label:'Job special'}],
    [6509,{direction:'in',field:'money_gained',category:'Wages / Job',label:'Company special'}],
    [6795,{direction:'in',field:'balance_change',category:'Faction Income',label:'Faction payout'}],
    [6810,{direction:'out',field:'money_given',category:'Player Transfers',label:'Faction payday sent'}],
    [6811,{direction:'in',field:'money_given',category:'Faction Income',label:'Faction payday received'}],
    [6735,{direction:'out',field:'money_given',category:'Player Transfers',label:'Faction money given'}],
    [5531,{direction:'in',field:'money',category:'Stocks / Investing',label:'Stock dividend'}],
  ]);
  const PLAYER_ITEM_LOGS = new Map([
    [4102,{direction:'out',label:'Item sent'}],
    [4103,{direction:'in',label:'Item received'}],
  ]);
  const FORCE_FINANCE_LOG_IDS = new Set([...EXPLICIT_CASH_LOGS.keys(),...PLAYER_ITEM_LOGS.keys()]);

  const storageIssues = [];
  const state = {
    open: false,
    view: 'dashboard',
    tracked: load('tracked', []),
    transactions: load('transactions', []),
    cashFlows: load('cashFlows', []),
    playerTransfers: load('playerTransfers', []),
    playerTrades: load('playerTrades', []),
    itemConsumptions: load('itemConsumptions', []),
    unrecognizedFinancial: load('unrecognizedFinancial', []),
    goals: load('goals', []),
    financialSnapshots: load('financialSnapshots', []),
    cashSearch: load('cashSearch', ''),
    cashCategory: load('cashCategory', 'all'),
    catalog: load('catalog', []),
    catalogVersion: load('catalogVersion', 0),
    catalogUpdatedAt: load('catalogUpdatedAt', 0),
    logTypes: load('logTypes', []),
    logTypesUpdatedAt: load('logTypesUpdatedAt', 0),
    apiKey: load('apiKey', ''),
    fabPosition: load('fabPosition', null),
    pinnedIds: load('pinnedIds', []),
    hiddenIds: load('hiddenIds', []),
    itemSearch: load('itemSearch', ''),
    sortMode: load('sortMode', 'recent'),
    ledgerSearch: load('ledgerSearch', ''),
    ledgerSource: load('ledgerSource', 'all'),
    ledgerStatus: load('ledgerStatus', 'all'),
    ledgerRange: load('ledgerRange', 'all'),
    ledgerSort: load('ledgerSort', 'acquiredAt'),
    ledgerSortDir: load('ledgerSortDir', 'desc'),
    ledgerLimit: 200,
    sync: load('sync', { lastSync: 0, firstSyncComplete: false }),
    dateMode: load('dateMode', '30d'),
    customFrom: load('customFrom', ''),
    customTo: load('customTo', ''),
    granularity: load('granularity', 'day'),
    netWorthDate: load('netWorthDate', ''),
    netWorthTrackingStartedAt: load('netWorthTrackingStartedAt', 0),
    expanded: null,
    search: '',
    syncing: false,
    backgroundSyncing: false,
    backgroundSyncProgress: '',
    syncProgress: '',
    syncCancel: false,
    toast: '',
    busy: {active:false,title:'',detail:'',cancellable:false},
    demo: false,
    notices: load('notices', []),
    tradeTab: 'items',
    renderPending: false,
  };

  // v0.1.27 removes the old calendar-month preset. Migrate saved users to 30 days.
  if(state.dateMode==='month'){state.dateMode='30d';save('dateMode','30d');}
  try{localStorage.removeItem(NS+('company'+'History'));}catch(_){}
  // v0.2.34 removes false Crime Reward rows created when an item quantity such as
  // items_gained.1 = 1 was misread as $1 of crime income.
  purgeBogusCrimeCashRows();
  // v0.2.39 records the first locally observed Net Worth tracking day. Existing
  // installs migrate to their earliest stored financial snapshot; Full Resync
  // history from before analyzer use must not expand the selectable Net Worth days.
  if(!(Number(state.netWorthTrackingStartedAt)>0)){
    const firstStored=(state.financialSnapshots||[]).map(x=>Number(x?.networth?.timestamp||x?.timestamp)||0).filter(x=>x>0).sort((a,b)=>a-b)[0]||nowSec();
    state.netWorthTrackingStartedAt=firstStored;save('netWorthTrackingStartedAt',firstStored);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function nowSec() { return Math.floor(Date.now() / 1000); }
  function money(n, short = false) {
    n = Number(n) || 0;
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (short) {
      if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}b`;
      if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}m`;
      if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e4 ? 1 : 2)}k`;
    }
    return `${sign}$${Math.round(a).toLocaleString()}`;
  }
  function qty(n) { return (Number(n) || 0).toLocaleString(); }
  function dateStr(ts) { return tctDateStr(ts); }
  function dateTimeStr(ts) { return tctDateTimeStr(ts) + ' TCT'; }
  function injectedApiKey() {
    return API_KEY && !API_KEY.includes('###PDA-APIKEY###') && API_KEY.length >= 16 ? API_KEY.trim() : '';
  }
  function savedApiKey() {
    const k=String(state.apiKey||'').trim();
    return k.length>=16?k:'';
  }
  function activeApiKey() { return savedApiKey() || injectedApiKey(); }
  function hasInjectedKey() { return !!injectedApiKey(); }
  function hasApiKey() { return !!activeApiKey(); }
  function keySource() { return savedApiKey()?'Saved API key':injectedApiKey()?'Torn PDA API key':'No API key'; }

  class AnalyzerError extends Error {
    constructor(code, message, context={}, retryable=false) {
      super(message); this.code=code; this.context=context; this.retryable=retryable;
    }
  }
  async function httpGet(url) {
    const controller=new AbortController(); let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AnalyzerError('API_TIMEOUT','Torn did not respond in time.',{},true));},20000);});
    try {
      const request=async()=>{
        const pda=typeof window.PDA_httpGet==='function';
        const r=pda?await window.PDA_httpGet(url,{}):await fetch(url,{credentials:'omit',signal:controller.signal});
        const status=Number(r.status)||200;
        if(status>=400)throw new AnalyzerError(status===429?'RATE_LIMIT':'HTTP_ERROR',`Torn returned HTTP ${status}.`,{status},status===429||status>=500);
        const raw=pda?r.responseText:await r.text(); let json;
        try{json=JSON.parse(raw);}catch(_){throw new AnalyzerError('API_FORMAT','Torn returned an unreadable response.');}
        if(json?.error){const code=Number(json.error.code)||0;throw new AnalyzerError(code===5?'RATE_LIMIT':'TORN_ERROR',`Torn API error ${code}.`,{apiCode:code},[0,5,17].includes(code));}
        if(!json||typeof json!=='object')throw new AnalyzerError('API_FORMAT','Torn returned an unexpected response.');
        return json;
      };
      return await Promise.race([request(),timeout]);
    }catch(error){if(error instanceof AnalyzerError)throw error;throw new AnalyzerError('API_NETWORK','Unable to reach Torn.',{},true);}
    finally{clearTimeout(timer);}
  }

  let requestQueue=Promise.resolve(),lastRequestAt=0;

  async function apiGet(path, params = {}) {
    const key=activeApiKey();
    if (!key) throw new Error('No Torn API key is configured. Add one in Settings \u2192 API Key.');
    const u = new URL(API + path);
    u.searchParams.set('key', key);
    u.searchParams.set('comment', 'CashFlowAnalyzr');
    Object.entries(params).forEach(([k,v]) => { if (v !== '' && v != null) u.searchParams.set(k, String(v)); });
    const request=requestQueue.then(async()=>{
      const delay=REQUEST_GAP_MS-(Date.now()-lastRequestAt);if(delay>0)await sleep(delay);
      lastRequestAt=Date.now();
      try{return await httpGet(u.toString());}
      catch(error){error.context={...(error.context||{}),source:path};reportDiagnostic(error.code||'API_ERROR','error',error.message,error.context);throw error;}
    });
    requestQueue=request.catch(()=>{});return request;
  }
