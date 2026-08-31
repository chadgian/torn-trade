// ==UserScript==
// @name         Torn Cash Flow Analyzer
// @namespace    obliviate.torn.trade.analyzer
// @version      0.2.45
// @description  Torn cash-flow, spending, earnings, company profit, net-worth and trade analytics with a clean Bento dashboard, TCT daily flow and fast sync modes. Data stays on-device.
// @author       obliviate + ChatGPT
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        none
// @updateURL    https://torn-trade.obliviate.workers.dev/torn-trade-analyzer.user.js
// @downloadURL  https://torn-trade.obliviate.workers.dev/torn-trade-analyzer.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.2.45';
  const API_KEY = '_###PDA-APIKEY###_';
  const NS = 'tta:v1:';
  const API = 'https://api.torn.com/v2';
  const ANALYZER_CUSTOM_KEY_URL = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=CashFlowAnalyzer&user=log,trade,trades,money,networth&company=profile,employees&torn=items,logtypes';
  const REQUEST_GAP_MS = 700; // ~86 requests/minute, keeping headroom under Torn's 100/min user limit.
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

  function load(k, fallback) {
    try {
      const v = localStorage.getItem(NS + k);
      return v == null ? fallback : JSON.parse(v);
    } catch (_) { return fallback; }
  }
  function save(k, v) {
    try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (_) {}
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
  function dateStr(ts) { return new Date(ts * 1000).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}); }
  function dateTimeStr(ts) { return new Date((Number(ts)||0) * 1000).toLocaleString(undefined, {year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
  function dayKey(ts) {
    const d = new Date(ts * 1000); d.setHours(0,0,0,0); return Math.floor(d.getTime()/1000);
  }
  function weekKey(ts) {
    const d = new Date(ts * 1000); d.setHours(0,0,0,0);
    const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return Math.floor(d.getTime()/1000);
  }
  function monthKey(ts) { const d = new Date(ts * 1000); return Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime()/1000); }

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

  async function httpGet(url) {
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

  async function apiGet(path, params = {}) {
    const key=activeApiKey();
    if (!key) throw new Error('No Torn API key is configured. Add one in Settings \u2192 API Key.');
    const u = new URL(API + path);
    u.searchParams.set('key', key);
    u.searchParams.set('comment', 'TornTradeAnalyzer');
    Object.entries(params).forEach(([k,v]) => { if (v !== '' && v != null) u.searchParams.set(k, String(v)); });
    return httpGet(u.toString());
  }

  function injectCss() {
    if (document.getElementById('tta-css')) return;
    const s = document.createElement('style');
    s.id = 'tta-css';
    s.textContent = `
      :root{--tta-bg:#0b0f14;--tta-panel:#111821;--tta-card:#151e28;--tta-soft:#1f2c39;--tta-line:#34475a;--tta-text:#f7fbff;--tta-muted:#b9c8d6;--tta-faint:#91a5b7;--tta-green:#63efb1;--tta-red:#ff7d8a;--tta-blue:#7fc1ff;--tta-yellow:#ffda73}
      #tta-root,#tta-root *,#tta-fab,#tta-fab *{box-sizing:border-box}
      #tta-root button,#tta-fab{font-family:inherit;-webkit-appearance:none;appearance:none;margin:0;line-height:1.15;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
      #tta-fab{position:fixed;right:14px;bottom:86px;z-index:2147483000;width:52px;height:52px;min-width:52px;min-height:52px;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;border:1px solid #91cdf75c;border-radius:17px;background:linear-gradient(145deg,#355665e8,#27434fe8 58%,#233b47ed);color:#fff;box-shadow:0 14px 32px #07151e66,0 0 0 1px #79dfb314,inset 0 1px #ffffff2a,inset 0 -10px 20px #0d1b2430;padding:0;font:700 18px/1 system-ui;display:inline-flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease}
      #tta-fab:before{content:"";position:absolute;left:7px;right:7px;top:5px;height:1px;border-radius:999px;background:linear-gradient(90deg,transparent,#ffffff70,transparent);pointer-events:none}
      #tta-fab:after{content:"";position:absolute;width:26px;height:26px;right:-8px;bottom:-9px;border-radius:50%;background:#79dfb31d;filter:blur(4px);pointer-events:none}
      #tta-fab .tta-fabicon{position:relative;z-index:1;display:grid;place-items:center;width:31px;height:31px;pointer-events:none}#tta-fab .tta-fabicon svg{display:block;width:31px;height:31px;overflow:visible;filter:drop-shadow(0 5px 10px #07151e78)}#tta-fab .tta-fab-panel{fill:#ffffff0b;stroke:#ffffff2f;stroke-width:1}#tta-fab .tta-fab-grid{fill:none;stroke:#ffffff16;stroke-width:.8}#tta-fab .tta-fab-line{fill:none;stroke:url(#ttaFabPulse);stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}#tta-fab .tta-fab-dot{fill:#79dfb3;filter:drop-shadow(0 0 3px #79dfb3aa)}#tta-fab .tta-fab-mark{fill:#91cdf7}
      #tta-fab:hover{border-color:#91cdf790;box-shadow:0 16px 36px #07151e72,0 0 0 1px #79dfb325,0 0 22px #91cdf71e,inset 0 1px #ffffff35}
      #tta-fab:active{transform:scale(.96)}
      #tta-fab.dragging{cursor:grabbing;opacity:.94;transform:scale(1.035);border-color:#79dfb39a;box-shadow:0 18px 40px #07151e78,0 0 24px #79dfb325,inset 0 1px #ffffff38}
      #tta-fab.syncing{border-color:#79dfb387;background:linear-gradient(145deg,#31594f,#294a51 56%,#274353);box-shadow:0 14px 34px #07151e70,0 0 24px #79dfb326,inset 0 1px #ffffff30}
      #tta-fab .tta-fabspinner{position:relative;z-index:1;width:22px;height:22px;flex:0 0 22px;border:2px solid #91cdf736;border-top-color:#79dfb3;border-right-color:#91cdf7;border-radius:50%;box-shadow:0 0 12px #79dfb31c;animation:tta-spin .78s linear infinite}
      #tta-root{position:fixed;inset:0;z-index:2147482999;background:#06090dcc;backdrop-filter:blur(5px);display:none;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--tta-text);font-size:14px;line-height:1.4}
      #tta-root.show{display:block}.tta-shell{position:absolute;inset:0;background:var(--tta-bg);overflow:auto;overscroll-behavior:contain;padding-bottom:max(38px,env(safe-area-inset-bottom))}.tta-header{position:sticky;top:0;z-index:4;display:flex;align-items:center;gap:9px;min-height:62px;padding:10px 12px;background:#0b0f14f2;border-bottom:1px solid var(--tta-line);backdrop-filter:blur(8px)}
      .tta-brand{display:flex;align-items:center;gap:9px;min-width:0;flex:1}.tta-mark{width:38px;height:38px;flex:0 0 38px;border-radius:11px;background:linear-gradient(145deg,#183d32,#17394f);display:grid;place-items:center;font-size:19px;line-height:1}.tta-brandcopy{min-width:0}.tta-title{color:var(--tta-text);font-size:15px;font-weight:850;letter-spacing:.15px;line-height:1.2}.tta-sub{font-size:11px;color:var(--tta-muted);margin-top:2px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .tta-iconbtn,.tta-back{display:grid;place-items:center;flex:0 0 40px;width:40px;height:40px;min-width:40px;min-height:40px;padding:0!important;border:1px solid var(--tta-line);background:var(--tta-card);color:var(--tta-text)!important;border-radius:11px;text-align:center;font-size:19px;font-weight:700;line-height:1}.tta-iconbtn:active,.tta-back:active{transform:scale(.96);background:var(--tta-soft)}.tta-back{font-size:26px}
      .tta-content{width:100%;padding:14px;max-width:760px;margin:0 auto}.tta-period{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:11px}.tta-period>div{min-width:0}.tta-period strong{display:block;color:var(--tta-text);font-size:14px;line-height:1.25}.tta-period small{color:var(--tta-muted);font-size:10px}
      .tta-chips{display:flex;gap:7px;overflow:auto;padding:1px 1px 4px;scrollbar-width:none}.tta-chips::-webkit-scrollbar{display:none}.tta-chip{display:inline-flex;align-items:center;justify-content:center;min-height:34px;white-space:nowrap;border:1px solid var(--tta-line);background:var(--tta-card);color:var(--tta-muted)!important;border-radius:999px;padding:7px 11px;font-size:11px;font-weight:750}.tta-chip.active{color:#052016!important;background:var(--tta-green);border-color:var(--tta-green)}
      .tta-summary{display:grid;grid-template-columns:1.45fr 1fr 1fr;gap:8px;margin:12px 0}.tta-stat{background:linear-gradient(180deg,var(--tta-card),#111821);border:1px solid var(--tta-line);border-radius:14px;padding:11px;min-width:0;text-align:center}.tta-stat label{display:block;font-size:9px;color:var(--tta-muted);text-transform:uppercase;letter-spacing:.75px;line-height:1.3}.tta-stat b{display:block;margin-top:5px;color:var(--tta-text);font-size:15px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tta-stat.main b{font-size:20px}.pos{color:var(--tta-green)!important}.neg{color:var(--tta-red)!important}
      .tta-chartcard{background:linear-gradient(180deg,#151f2a,#10171f);border:1px solid var(--tta-line);border-radius:16px;padding:13px 11px 11px;margin-bottom:14px;overflow:hidden}.tta-charthead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.tta-charthead h3{margin:0;color:var(--tta-text);font-size:13px;line-height:1.3}.tta-charthead small{color:var(--tta-muted)!important;font-size:10px}.tta-seg{display:flex;align-items:center;justify-content:center;background:#090e14;border:1px solid var(--tta-line);border-radius:10px;padding:2px}.tta-seg button{display:inline-flex;align-items:center;justify-content:center;min-height:30px;border:0;background:transparent;color:var(--tta-muted)!important;font-size:10px;font-weight:800;padding:6px 8px;border-radius:7px}.tta-seg button.active{background:var(--tta-soft);color:var(--tta-text)!important}.tta-chartinteractive{position:relative;touch-action:manipulation;padding-top:54px}.tta-chartviewport{width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:thin;scrollbar-color:#466078 #0b1219}.tta-chartviewport::-webkit-scrollbar{height:7px}.tta-chartviewport::-webkit-scrollbar-track{background:#0b1219;border-radius:999px}.tta-chartviewport::-webkit-scrollbar-thumb{background:#466078;border-radius:999px}.tta-svg{width:100%;height:160px;display:block;overflow:visible}.tta-chartinteractive.day .tta-svg{width:var(--tta-chart-width);max-width:none}.tta-axis{fill:#d6e1eb!important;color:#d6e1eb!important;font-size:10px;font-weight:650;paint-order:stroke;stroke:#10171f;stroke-width:1.5px;stroke-linejoin:round}.tta-zero{stroke:#7c91a4;stroke-width:1.25}.tta-bar-pos{fill:var(--tta-green)}.tta-bar-neg{fill:var(--tta-red)}.tta-profitbar{cursor:pointer;outline:none;transition:opacity .12s ease,filter .12s ease}.tta-profitbar:hover,.tta-profitbar:focus,.tta-profitbar.active{opacity:.78;filter:brightness(1.18)}.tta-charttooltip{position:absolute;top:4px;z-index:5;display:none;pointer-events:none;min-width:116px;max-width:190px;padding:8px 10px;border:1px solid #4a6073;border-radius:10px;background:#091119f2;color:var(--tta-text);box-shadow:0 8px 24px #0009;text-align:center;transform:translateX(-50%);font-variant-numeric:tabular-nums}.tta-charttooltip.show{display:block}.tta-charttooltip strong{display:block;font-size:13px;font-weight:900;line-height:1.2}.tta-charttooltip small{display:block;margin-top:3px;color:var(--tta-muted);font-size:9px;line-height:1.3}.tta-charttooltip.pos strong{color:var(--tta-green)}.tta-charttooltip.neg strong{color:var(--tta-red)}.tta-grid{stroke:#344657;stroke-width:1}.tta-empty{min-height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:var(--tta-muted);font-size:12px;line-height:1.5;padding:18px}
      .tta-sectionhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 1px 10px}.tta-sectionhead h3{color:var(--tta-text);font-size:14px;margin:0;line-height:1.3}.tta-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;border:1px solid transparent;border-radius:10px;padding:8px 12px;font-size:11px;font-weight:850;text-align:center;background:var(--tta-green);color:#052016!important;white-space:nowrap}.tta-btn:active{transform:scale(.98)}.tta-btn.secondary{background:var(--tta-card);border-color:var(--tta-line);color:var(--tta-text)!important}.tta-btn.danger{background:#35181e;color:#ffc3c9!important;border-color:#71313d}.tta-btn:disabled{opacity:.55;transform:none}
      .tta-item{background:var(--tta-card);border:1px solid var(--tta-line);border-radius:15px;margin-bottom:10px;overflow:hidden}.tta-itemtop{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:11px;align-items:center;min-height:70px;padding:10px 11px;cursor:pointer}.tta-thumbwrap{position:relative;width:48px;height:48px;display:grid;place-items:center;align-self:center;justify-self:center;background:#0b1219;border:1px solid #2e4152;border-radius:12px;overflow:hidden}.tta-thumb{display:block;width:40px;height:40px;max-width:40px;max-height:40px;object-fit:contain;object-position:center;padding:0;margin:0;background:transparent;border:0}.tta-thumbfallback{display:none;position:absolute;inset:0;place-items:center;color:var(--tta-faint);font-size:20px}.tta-itemcopy{min-width:0;align-self:center}.tta-itemname{color:var(--tta-text);font-weight:850;font-size:13px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tta-source{font-size:10px;color:var(--tta-muted);margin-top:4px;line-height:1.35;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.tta-itemfacts{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.tta-factpill{display:inline-flex;align-items:center;min-height:21px;padding:3px 6px;border:1px solid #314556;border-radius:999px;background:#0d151d;color:var(--tta-faint);font-size:8.5px;font-weight:750;line-height:1;white-space:nowrap}.tta-factpill.market{border-color:#315c4d;background:#11261f;color:var(--tta-green);font-size:9px}.tta-profitbox{min-width:72px;text-align:right;align-self:center}.tta-profit{font-size:13px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1.25}.tta-chevron{font-size:10px;color:var(--tta-muted);margin-top:4px;line-height:1.2}.tta-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--tta-line);border-top:1px solid var(--tta-line)}.tta-metric{background:#111922;padding:9px 7px;text-align:center;min-width:0}.tta-metric small{display:block;color:var(--tta-muted);font-size:9px;text-transform:uppercase;letter-spacing:.55px;line-height:1.3}.tta-metric b{display:block;margin-top:3px;color:var(--tta-text);font-size:12px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}.tta-accordion{display:none;padding:12px;border-top:1px solid var(--tta-line);background:#0f161e}.tta-item.expanded .tta-accordion{display:block}.tta-minirow{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:11px}.tta-ministat{background:#151f2a;border:1px solid var(--tta-line);border-radius:10px;padding:9px 6px;text-align:center;min-width:0}.tta-ministat small{display:block;font-size:9px;color:var(--tta-muted);line-height:1.25}.tta-ministat b{display:block;margin-top:3px;color:var(--tta-text);font-size:11px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}.tta-note{font-size:10px;color:var(--tta-muted);margin-top:9px;line-height:1.5}.tta-linkrow{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:11px}
      .tta-listtools{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;margin:8px 0 4px}.tta-history-search{width:100%;min-height:42px;border-radius:11px;border:1px solid var(--tta-line);background:var(--tta-card);color:var(--tta-text)!important;padding:10px 12px;font-size:12px;outline:none}.tta-history-search::placeholder{color:var(--tta-faint)}.tta-history-search:focus{border-color:var(--tta-blue);box-shadow:0 0 0 2px #7fc1ff22}.tta-sortbtn{min-width:118px}.tta-pin{display:grid;place-items:center;width:31px;height:31px;min-width:31px;min-height:31px;margin:0 0 4px auto;padding:0;border:1px solid var(--tta-line);border-radius:9px;background:#0d151d;color:var(--tta-muted)!important;font-size:15px;line-height:1}.tta-pin.active{background:#2a2513;border-color:#71632e;color:var(--tta-yellow)!important}.tta-cardactions{display:flex;justify-content:flex-end;gap:5px;margin-bottom:4px}.tta-cardactions .tta-pin{margin:0}.tta-hideitem{display:grid;place-items:center;width:31px;height:31px;min-width:31px;min-height:31px;padding:0;border:1px solid var(--tta-line);border-radius:9px;background:#15151b;color:var(--tta-muted)!important;font-size:14px;line-height:1}.tta-hideitem:active{background:#2b1e23;border-color:#76505b}.tta-hiddenlist{display:grid;gap:7px;margin-top:7px}.tta-hiddenrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;background:var(--tta-card);border:1px solid var(--tta-line);border-radius:10px;padding:8px 9px}.tta-hiddenrow span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tta-text);font-size:11px}.tta-hiddenrow .tta-btn{min-height:32px;padding:6px 9px}.tta-listmeta{font-size:10px;color:var(--tta-muted);text-align:center;margin:0 0 10px}
      @media(max-width:460px){.tta-listtools{grid-template-columns:1fr}.tta-sortbtn{width:100%}}
      .tta-search{position:sticky;top:62px;z-index:3;background:var(--tta-bg);padding:4px 0 11px}.tta-search input{width:100%;min-height:44px;border-radius:12px;border:1px solid var(--tta-line);background:var(--tta-card);color:var(--tta-text)!important;font-size:13px;padding:11px 13px;outline:none}.tta-search input::placeholder{color:#91a5b7;opacity:1}.tta-search input:focus{border-color:var(--tta-blue);box-shadow:0 0 0 2px #7fc1ff22}.tta-result{display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:11px;background:var(--tta-card);border:1px solid var(--tta-line);border-radius:13px;padding:9px 10px;margin-bottom:8px;min-height:68px}.tta-resultcopy{min-width:0}.tta-result small{display:block;margin-top:3px;color:var(--tta-muted);font-size:10px;line-height:1.3}.tta-catalogmeta{display:flex;align-items:center;justify-content:center;text-align:center;color:var(--tta-muted);font-size:10px;margin:3px 0 10px}
      .tta-banner{background:#152330;border:1px solid #36556d;border-radius:13px;padding:11px 12px;margin-bottom:11px;font-size:10px;line-height:1.5;color:#d0dce7}.tta-banner strong{color:#fff}.tta-sync{display:inline-flex;align-items:center;justify-content:center;gap:8px}.tta-spinner{width:13px;height:13px;border:2px solid #ffffff44;border-top-color:#fff;border-radius:50%;animation:tta-spin .8s linear infinite}@keyframes tta-spin{to{transform:rotate(360deg)}}
      .tta-keycard{background:#111a23;border:1px solid var(--tta-line);border-radius:14px;padding:12px;margin:12px 0}.tta-keyhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}.tta-keyhead strong{font-size:13px;color:var(--tta-text)}.tta-keystatus{font-size:9px;font-weight:800;color:var(--tta-green);background:#18352b;border:1px solid #2c5b49;border-radius:999px;padding:4px 7px}.tta-keyinputrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center}.tta-keyinputrow input{width:100%;min-height:42px;background:var(--tta-card);border:1px solid var(--tta-line);color:var(--tta-text)!important;border-radius:10px;padding:10px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.5px}.tta-keynote{font-size:10px;line-height:1.5;color:var(--tta-muted);margin-top:8px}
      .tta-settings label{display:block;font-size:10px;color:var(--tta-muted);margin:14px 0 5px}.tta-settings-actions{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:12px}.tta-tos{font-size:10px;line-height:1.6;color:#d0dce7;background:#101820;border:1px solid var(--tta-line);border-radius:12px;padding:11px}.tta-tos strong{color:#fff}.tta-toast{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483002;background:#22313e;color:#fff;border:1px solid #536a7e;border-radius:999px;padding:9px 13px;font-size:11px;box-shadow:0 10px 30px #0008;max-width:88vw;text-align:center;line-height:1.35}
      .tta-demo{color:var(--tta-yellow);font-size:9px;font-weight:850;margin-left:6px}.tta-customdates{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:9px 0}.tta-customdates input{width:100%;min-height:40px;background:var(--tta-card);border:1px solid var(--tta-line);color:var(--tta-text)!important;border-radius:9px;padding:8px;font-size:11px;color-scheme:dark}
      @media(max-width:460px){.tta-content{padding:12px}.tta-summary{grid-template-columns:1fr 1fr}.tta-stat.main{grid-column:1/-1}.tta-sectionhead{align-items:stretch}.tta-sectionhead h3{display:flex;align-items:center;min-height:38px}.tta-itemtop{grid-template-columns:46px minmax(0,1fr) auto}.tta-thumbwrap{width:46px;height:46px}.tta-thumb{width:38px;height:38px}.tta-charthead{align-items:flex-start}.tta-seg{flex:0 0 auto}}
      @media(max-width:360px){.tta-header{padding-left:9px;padding-right:9px;gap:7px}.tta-mark{width:34px;height:34px;flex-basis:34px}.tta-iconbtn,.tta-back{width:38px;height:38px;min-width:38px;min-height:38px;flex-basis:38px}.tta-title{font-size:14px}.tta-sub{font-size:10px}.tta-content{padding:10px}.tta-itemtop{grid-template-columns:42px minmax(0,1fr);gap:9px}.tta-thumbwrap{width:42px;height:42px;grid-row:1/2}.tta-thumb{width:35px;height:35px}.tta-profitbox{grid-column:2;display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;text-align:left}.tta-profit,.tta-chevron{text-align:left;margin:0}.tta-minirow{grid-template-columns:1fr 1fr}.tta-ministat:last-child{grid-column:1/-1}.tta-sectionhead{flex-direction:column}.tta-sectionhead .tta-btn{width:100%}.tta-period{align-items:flex-start}.tta-period .tta-btn{flex:0 0 auto}.tta-charthead{flex-direction:column}.tta-seg{width:100%}.tta-seg button{flex:1}.tta-result{grid-template-columns:42px minmax(0,1fr)}.tta-result .tta-btn{grid-column:1/-1;width:100%}.tta-customdates{grid-template-columns:1fr}.tta-keyinputrow{grid-template-columns:1fr}.tta-keyinputrow .tta-btn{width:100%}}
      .tta-item{content-visibility:auto;contain-intrinsic-size:118px;transition:border-color .14s ease,transform .14s ease}.tta-item.expanded{content-visibility:visible}.tta-itemtop:active{background:#1a2530}.tta-btn,.tta-chip,.tta-iconbtn,.tta-back,.tta-pin{transition:transform .12s ease,background .12s ease,border-color .12s ease,opacity .12s ease}
      .tta-periodhint{display:block;margin-top:3px;color:var(--tta-faint);font-size:9px;line-height:1.35}.tta-status-banner{display:flex;align-items:flex-start;gap:8px}.tta-status-dot{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:var(--tta-blue);margin-top:4px;box-shadow:0 0 10px #7fc1ff66}
      .tta-searchwrap{position:relative;min-width:0}.tta-searchglyph{position:absolute;left:11px;top:50%;transform:translateY(-50%);z-index:1;color:var(--tta-faint);font-size:15px;pointer-events:none}.tta-searchwrap .tta-history-search{padding-left:34px;padding-right:39px}.tta-clearsearch{position:absolute;right:5px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:31px;height:31px;min-width:31px;min-height:31px;border:0;border-radius:8px;background:transparent;color:var(--tta-muted)!important;font-size:18px;padding:0}.tta-clearsearch[hidden]{display:none}.tta-sortbtn{min-width:126px}
      .tta-liststage{min-height:80px}.tta-listmeta strong{color:var(--tta-text)}
      .tta-ledgerintro{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:11px}.tta-ledgerintro strong{display:block;color:var(--tta-text);font-size:13px}.tta-ledgerintro small{display:block;margin-top:3px;color:var(--tta-muted);font-size:10px;line-height:1.45}.tta-ledgerfilters{display:grid;grid-template-columns:minmax(180px,1.6fr) repeat(3,minmax(118px,.8fr));gap:8px;margin:10px 0}.tta-ledgerfilters input,.tta-ledgerfilters select{width:100%;min-height:40px;border:1px solid var(--tta-line);border-radius:10px;background:var(--tta-card);color:var(--tta-text)!important;padding:8px 10px;font-size:11px;outline:none}.tta-ledgerfilters input:focus,.tta-ledgerfilters select:focus{border-color:var(--tta-blue);box-shadow:0 0 0 2px #7fc1ff22}.tta-ledgersummary{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:10px 0}.tta-ledgersummary .tta-ministat{margin:0}.tta-ledgerwrap{width:100%;overflow:auto;border:1px solid var(--tta-line);border-radius:13px;background:#0d141c;overscroll-behavior-x:contain}.tta-ledgertable{width:100%;min-width:940px;border-collapse:separate;border-spacing:0;font-size:10px}.tta-ledgertable th{position:sticky;top:0;z-index:2;background:#17212b;border-bottom:1px solid var(--tta-line);text-align:left;padding:0}.tta-ledgertable th button{width:100%;border:0;background:transparent;color:#dce8f2!important;padding:10px 9px;text-align:left;font-size:9px;font-weight:850;letter-spacing:.25px;white-space:nowrap}.tta-ledgertable th button.active{color:var(--tta-green)!important}.tta-ledgertable td{padding:9px;border-bottom:1px solid #273746;color:#d6e1eb;vertical-align:top;font-variant-numeric:tabular-nums}.tta-ledgertable tbody tr:last-child td{border-bottom:0}.tta-ledgertable tbody tr:active td{background:#17222d}.tta-ledgertable .num{text-align:right;white-space:nowrap}.tta-ledgeritem{min-width:135px}.tta-ledgeritem strong{display:block;color:var(--tta-text);font-size:10.5px;line-height:1.3}.tta-ledgeritem small,.tta-ledgermethod small,.tta-ledgerstatus small{display:block;margin-top:2px;color:var(--tta-faint);font-size:8.5px;line-height:1.35}.tta-ledgermethod{min-width:125px}.tta-ledgerstatus{min-width:105px}.tta-statuspill{display:inline-flex;align-items:center;min-height:22px;padding:3px 7px;border:1px solid var(--tta-line);border-radius:999px;background:#151f28;color:var(--tta-muted);font-size:8.5px;font-weight:800;white-space:nowrap}.tta-statuspill.sold{background:#123026;border-color:#2f6853;color:var(--tta-green)}.tta-statuspill.partial{background:#322b13;border-color:#6e6030;color:var(--tta-yellow)}.tta-statuspill.unsold{background:#251a20;border-color:#5f3e49;color:#ffc1ca}.tta-statuspill.transferred{background:#13283a;border-color:#365a74;color:var(--tta-blue)}.tta-statuspill.consumed{background:#302317;border-color:#6d5434;color:var(--tta-yellow)}.tta-statuspill.depleted{background:#2a202a;border-color:#604765;color:#d9b9ff}.tta-ledgermeta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 1px;color:var(--tta-muted);font-size:9.5px}.tta-ledgermore{display:flex;justify-content:center;margin:12px 0 4px}
      @media(max-width:620px){.tta-ledgerfilters{grid-template-columns:1fr 1fr}.tta-ledgerfilters .tta-ledgersearch{grid-column:1/-1}.tta-ledgersummary{grid-template-columns:1fr 1fr}}
      @media(max-width:390px){.tta-ledgerfilters{grid-template-columns:1fr}.tta-ledgerfilters .tta-ledgersearch{grid-column:auto}.tta-ledgermeta{align-items:flex-start;flex-direction:column}}
      .tta-fin-nav{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.tta-fin-nav .tta-btn{min-height:44px;padding:8px 7px}.tta-fin-nav .tta-btn strong{display:block;font-size:10px}.tta-fin-nav .tta-btn small{display:block;font-size:8px;margin-top:2px;opacity:.72}
      .tta-cashhero{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 13px}.tta-syncactions{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.tta-syncactions .tta-btn{min-height:36px;padding:7px 10px}.tta-cashcard{background:linear-gradient(180deg,#151f2a,#10171f);border:1px solid var(--tta-line);border-radius:14px;padding:11px;text-align:center;min-width:0}.tta-cashcard small{display:block;color:var(--tta-muted);font-size:9px;text-transform:uppercase;letter-spacing:.55px}.tta-cashcard b{display:block;margin-top:5px;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tta-cashcard.main{grid-column:auto}.tta-transfer{color:var(--tta-blue)!important}
      .tta-fin-section{background:#111922;border:1px solid var(--tta-line);border-radius:14px;padding:12px;margin:11px 0}.tta-fin-section h3{margin:0 0 9px;font-size:13px}.tta-fin-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.tta-fin-row{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #263746;font-size:10px}.tta-fin-row:last-child{border-bottom:0}.tta-fin-row span{color:var(--tta-muted)}.tta-fin-row b{text-align:right;color:var(--tta-text)}
      .tta-flowtable{width:100%;border-collapse:collapse;font-size:10px}.tta-flowtable th{text-align:left;color:var(--tta-muted);font-size:9px;padding:8px 6px;border-bottom:1px solid var(--tta-line)}.tta-flowtable td{padding:9px 6px;border-bottom:1px solid #263746;vertical-align:top}.tta-flowtable td.num{text-align:right;white-space:nowrap}.tta-flowtitle{font-weight:800;color:var(--tta-text)}.tta-flowmeta{display:block;color:var(--tta-faint);font-size:8.5px;margin-top:2px}.tta-flowbadge{display:inline-flex;padding:3px 6px;border-radius:999px;border:1px solid var(--tta-line);font-size:8px;font-weight:800}.tta-flowbadge.in{color:var(--tta-green);border-color:#315c4d;background:#11261f}.tta-flowbadge.out{color:var(--tta-red);border-color:#69404a;background:#27181d}.tta-flowbadge.transfer{color:var(--tta-blue);border-color:#36556d;background:#132331}
      .tta-breakdown{display:grid;gap:5px}.tta-breakrow{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:7px 8px;border:1px solid #293c4c;border-radius:9px;background:#0e161e;font-size:9.5px}.tta-breakrow span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tta-breakrow b{font-variant-numeric:tabular-nums}.tta-networth-total{font-size:26px!important}.tta-snapshot-note{font-size:9px;color:var(--tta-faint);line-height:1.45;margin-top:7px}
      @media(max-width:420px){.tta-fin-nav{grid-template-columns:1fr}.tta-cashhero{grid-template-columns:1fr 1fr}.tta-cashcard.main{grid-column:1/-1}.tta-fin-grid{grid-template-columns:1fr}.tta-breakrow{grid-template-columns:minmax(0,1fr) auto}.tta-breakrow .secondary-value{display:none}}
      .tta-loading{position:fixed;inset:0;z-index:2147483001;display:none;place-items:center;background:#05080bd9;padding:20px;pointer-events:auto}.tta-loading.show{display:grid}.tta-loadingcard{width:min(420px,94vw);background:#111a23;border:1px solid #3b5266;border-radius:18px;padding:18px;box-shadow:0 22px 70px #000b;text-align:center}.tta-loadicon{width:52px;height:52px;margin:0 auto 12px;border-radius:16px;background:#172632;border:1px solid #345269;display:grid;place-items:center}.tta-spinner.xl{width:24px;height:24px;border-width:3px}.tta-loadingtitle{font-size:15px;font-weight:900;color:var(--tta-text);line-height:1.3}.tta-loadingdetail{min-height:34px;margin-top:7px;color:var(--tta-muted);font-size:11px;line-height:1.5}.tta-loadingbar{height:4px;margin:13px 0 12px;overflow:hidden;border-radius:999px;background:#091018}.tta-loadingbar span{display:block;width:38%;height:100%;border-radius:inherit;background:var(--tta-green);animation:tta-load-slide 1.25s ease-in-out infinite}@keyframes tta-load-slide{0%{transform:translateX(-120%)}50%{transform:translateX(165%)}100%{transform:translateX(310%)}}.tta-loadingactions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:5px}.tta-loadinghint{margin-top:9px;color:var(--tta-faint);font-size:9px;line-height:1.4}
      .tta-openloader{position:absolute;inset:0;display:grid;place-items:center;background:var(--tta-bg);color:var(--tta-muted);text-align:center;padding:24px}.tta-openloader>div{display:flex;flex-direction:column;align-items:center;gap:11px}.tta-openloader strong{color:var(--tta-text);font-size:14px}.tta-openloader small{font-size:10px;color:var(--tta-faint)}
      .tta-toast{opacity:0;visibility:hidden;pointer-events:none;transition:opacity .16s ease,transform .16s ease,visibility .16s}.tta-toast.show{opacity:1;visibility:visible;transform:translate(-50%,-4px)}
      #tta-root[aria-busy="true"] .tta-shell{overflow:hidden}
      @media(prefers-reduced-motion:reduce){.tta-loadingbar span,.tta-spinner,.tta-fabspinner{animation-duration:2.2s}.tta-item,.tta-btn,.tta-chip,.tta-iconbtn,.tta-back,.tta-pin,.tta-toast{transition:none}}

      /* v0.2.11 clean Bento UI \u2014 layered over the proven v0.2.1 runtime */
      :root{--tta-bg:#1b2a34;--tta-panel:#233641;--tta-card:#2a3e4a;--tta-soft:#344b58;--tta-line:#ffffff22;--tta-text:#f7fafc;--tta-muted:#cfdae2;--tta-faint:#aebfca;--tta-green:#79dfb3;--tta-red:#ff9da3;--tta-blue:#91cdf7;--tta-yellow:#f0cc78;--tta-shadow:0 12px 30px #08141c35}
      #tta-root{background:#0e1921b8;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
      .tta-shell{overflow-y:auto!important;overflow-x:hidden!important;background:radial-gradient(circle at 12% 0%,#3d657650 0,transparent 34%),radial-gradient(circle at 92% 18%,#376a5a3d 0,transparent 30%),linear-gradient(180deg,#1e303b,#172630)}
      .tta-content{width:min(100%,760px)!important;max-width:760px!important;min-width:0!important;overflow-x:hidden!important;padding:14px 12px 34px}
      .tta-content>*{min-width:0;max-width:100%}
      .tta-header{background:#21333edc;border-bottom-color:#ffffff20;backdrop-filter:blur(15px);-webkit-backdrop-filter:blur(15px)}
      .tta-title{font-size:16px}.tta-sub{color:#d1dce4}.tta-mark{background:linear-gradient(145deg,#3c685a,#386176)}
      .tta-btn{border-radius:12px;background:linear-gradient(135deg,#7fe2b8,#93cff7);color:#10242d!important;box-shadow:0 7px 18px #0917202f}.tta-btn.secondary,.tta-iconbtn,.tta-back,.tta-chip,.tta-history-search{background:#ffffff0e;border-color:#ffffff22;color:var(--tta-text)!important}
      .tta-chip.active{background:linear-gradient(135deg,#7fe2b8,#91dcc4);color:#123128!important;border-color:transparent}
      .tta-period{padding:11px 12px;background:#ffffff09;border:1px solid #ffffff18;border-radius:16px}.tta-periodhint{display:block;margin-top:3px;color:var(--tta-faint);font-size:9px}
      .tta-dashboard-top{align-items:flex-start}.tta-syncactions{max-width:100%}.tta-syncactions .tta-btn{min-height:34px;padding:7px 9px;font-size:10px}
      .tta-bento-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:10px 0}.tta-bento{min-width:0;padding:13px;border:1px solid #ffffff20;border-radius:18px;background:linear-gradient(145deg,#ffffff13,#ffffff08);box-shadow:var(--tta-shadow),inset 0 1px #ffffff16;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
      .tta-bento small{display:block;color:var(--tta-muted);font-size:9px;text-transform:uppercase;letter-spacing:.5px;font-weight:750}.tta-bento b{display:block;margin-top:5px;color:var(--tta-text);font-size:15px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}.tta-bento p{margin:7px 0 0;color:var(--tta-faint);font-size:9px;line-height:1.45}
      .tta-bento-hero{grid-column:1/-1;padding:17px;background:linear-gradient(135deg,#ffffff19,#6ac19f10 58%,#73bce819)}.tta-consolidated{font-size:30px!important;line-height:1.05;margin-top:7px!important}.tta-equation{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:7px;font-size:10px;font-weight:800;color:var(--tta-muted)}.tta-transfer-card{grid-column:1/-1}.tta-transfer{color:var(--tta-blue)!important}
      .tta-flowlegend{display:flex;gap:7px;overflow-x:auto;padding:1px 1px 8px;scrollbar-width:none}.tta-flowlegend::-webkit-scrollbar{display:none}.tta-flowlegend span{flex:0 0 auto;padding:5px 8px;border-radius:999px;background:#ffffff09;border:1px solid #ffffff16;font-size:9px;font-weight:750}.tta-flowlegend .in{color:var(--tta-green)}.tta-flowlegend .out{color:var(--tta-red)}.tta-flowlegend .transfer{color:var(--tta-blue)}
      .tta-sectionintro{display:flex;align-items:flex-end;justify-content:space-between;gap:9px;margin:15px 2px 8px}.tta-sectionintro small,.tta-sectionhead small{display:block;color:var(--tta-faint);font-size:8px;text-transform:uppercase;letter-spacing:.6px}.tta-sectionintro h3,.tta-sectionhead h3{margin:1px 0 0;color:var(--tta-text);font-size:14px}.tta-sectionintro>span,.tta-sectionhint,.tta-morehint{color:var(--tta-faint);font-size:8.5px}
      .tta-fin-nav{display:flex!important;gap:9px!important;grid-template-columns:none!important;width:100%;max-width:100%;overflow-x:auto!important;overflow-y:hidden!important;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;padding:1px 1px 8px;scrollbar-width:none}.tta-fin-nav::-webkit-scrollbar{display:none}.tta-fin-nav .tta-toolcard{flex:0 0 clamp(180px,62vw,220px);min-height:72px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;scroll-snap-align:start;text-align:left;background:linear-gradient(145deg,#ffffff14,#ffffff08)!important;border:1px solid #ffffff20!important}.tta-toolcard strong{font-size:11px;color:var(--tta-text)}.tta-toolcard small{margin-top:4px;color:var(--tta-faint);font-size:8.5px;white-space:normal;line-height:1.35}
      .tta-feature-portal{position:relative;margin:14px 0 18px;padding:13px;border:1px solid #91cdf74d;border-radius:21px;background:linear-gradient(145deg,#91cdf719,#79dfb30e 48%,#ffffff09);box-shadow:0 16px 34px #07151e45,inset 0 1px #ffffff20;overflow:hidden}.tta-feature-portal:before{content:"";position:absolute;inset:0 auto auto 0;width:56%;height:2px;background:linear-gradient(90deg,var(--tta-blue),var(--tta-green),transparent)}.tta-portal-head{position:relative;display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin:0 2px 11px}.tta-portal-head small{display:block;color:var(--tta-blue);font-size:8px;font-weight:900;letter-spacing:1px}.tta-portal-head h3{margin:2px 0 0;color:var(--tta-text);font-size:15px}.tta-portal-head>span{color:var(--tta-muted);font-size:9px;font-weight:750}.tta-feature-portal .tta-fin-nav{padding:1px 1px 3px}.tta-feature-portal .tta-toolcard{position:relative;flex:0 0 clamp(205px,70vw,245px);min-height:104px;padding:13px 14px;display:grid!important;grid-template-columns:42px minmax(0,1fr);gap:11px;align-items:center;text-align:left;border:1px solid #ffffff2b!important;border-radius:17px;background:linear-gradient(145deg,#ffffff1c,#ffffff0a)!important;color:var(--tta-text)!important;box-shadow:0 10px 24px #07151e3d,inset 0 1px #ffffff18;overflow:hidden}.tta-feature-portal .tta-toolcard:after{content:"\u203A";position:absolute;right:12px;top:9px;color:#ffffff65;font-size:24px;font-weight:300}.tta-feature-portal .tta-toolcard:active{transform:scale(.985);border-color:#91cdf780!important;background:linear-gradient(145deg,#ffffff24,#91cdf712)!important}.tta-tool-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:linear-gradient(145deg,#79dfb325,#91cdf726);border:1px solid #ffffff28;font-size:21px;color:var(--tta-text)}.tta-toolcopy{min-width:0;display:block}.tta-toolcopy strong{display:block;font-size:13px!important;color:var(--tta-text)}.tta-toolcopy small{display:block;margin-top:4px!important;padding-right:12px;color:var(--tta-muted)!important;font-size:9px!important;line-height:1.4}.tta-toolcopy em{display:block;margin-top:8px;color:var(--tta-blue);font-size:8.5px;font-style:normal;font-weight:900;text-transform:uppercase;letter-spacing:.45px}.tta-help-intro{padding:14px;margin-bottom:11px;border:1px solid #91cdf73b;border-radius:18px;background:linear-gradient(145deg,#91cdf715,#79dfb30b)}.tta-help-intro h2{margin:0 0 5px;font-size:17px}.tta-help-intro p{margin:0;color:var(--tta-muted);font-size:10px;line-height:1.55}.tta-help-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.tta-help-card{padding:12px;border:1px solid #ffffff1d;border-radius:16px;background:linear-gradient(145deg,#ffffff11,#ffffff07);box-shadow:var(--tta-shadow),inset 0 1px #ffffff0e}.tta-help-card.wide{grid-column:1/-1}.tta-help-card .icon{display:grid;place-items:center;width:34px;height:34px;margin-bottom:8px;border-radius:11px;background:#ffffff0d;border:1px solid #ffffff1c;font-size:17px}.tta-help-card h3{margin:0 0 5px;font-size:12px;color:var(--tta-text)}.tta-help-card p{margin:0;color:var(--tta-muted);font-size:9px;line-height:1.55}.tta-help-card b{color:var(--tta-text)}.tta-nw-daily{margin-top:11px}.tta-nw-delta{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 12px;margin:8px 0 10px;border:1px solid #ffffff1c;border-radius:14px;background:#ffffff09}.tta-nw-delta small{display:block;color:var(--tta-muted);font-size:9px}.tta-nw-delta b{display:block;margin-top:3px;font-size:19px;font-variant-numeric:tabular-nums}.tta-nw-delta span{max-width:210px;text-align:right;color:var(--tta-faint);font-size:8.5px;line-height:1.35}.tta-nw-change-list{display:grid;gap:7px}.tta-nw-change{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px 10px;border:1px solid #ffffff18;border-radius:13px;background:#ffffff08}.tta-nw-change-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:#ffffff0c;border:1px solid #ffffff18;font-size:16px}.tta-nw-change-copy{min-width:0}.tta-nw-change-copy strong{display:block;color:var(--tta-text);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tta-nw-change-copy small{display:block;margin-top:2px;color:var(--tta-faint);font-size:8.3px;line-height:1.35;white-space:normal}.tta-nw-change-value{text-align:right;font-size:10px;font-weight:900;white-space:nowrap}.tta-nw-disclaimer{margin-top:8px;color:var(--tta-faint);font-size:8.5px;line-height:1.45}
      .tta-position-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:11px}.tta-position-grid .tta-bento{padding:11px}.tta-position-grid .tta-bento b{font-size:13px}
      .tta-glass-section,.tta-fin-section,.tta-chartcard,.tta-item,.tta-keycard,.tta-tos,.tta-banner,.tta-ledgerwrap{background:linear-gradient(145deg,#ffffff10,#ffffff07)!important;border:1px solid #ffffff1d!important;box-shadow:var(--tta-shadow),inset 0 1px #ffffff10;border-radius:18px!important;backdrop-filter:blur(11px);-webkit-backdrop-filter:blur(11px)}.tta-glass-section{padding:12px;margin:11px 0}.tta-fin-section{padding:12px}
      .tta-stat,.tta-cashcard,.tta-ministat{background:#ffffff0b!important;border-color:#ffffff1a!important}.tta-stat label,.tta-cashcard small,.tta-ministat small,.tta-source,.tta-snapshot-note,.tta-listmeta{color:var(--tta-muted)!important}.tta-stat b,.tta-cashcard b,.tta-ministat b{color:var(--tta-text)}
      .tta-note{color:#c7d5de;background:#ffffff08;border:1px solid #ffffff15;border-radius:12px;padding:9px 10px}.tta-history-search{color:var(--tta-text)!important}.tta-history-search::placeholder{color:#a8bac6}.tta-flowtable th{color:#b8c8d3;border-bottom-color:#ffffff1a}.tta-flowtable td{color:#eef4f7;border-bottom-color:#ffffff13}.tta-flowmeta{color:#a8bac6}.tta-flowbadge.in{background:#79dfb318}.tta-flowbadge.out{background:#ff9da318}.tta-flowbadge.transfer{background:#91cdf718}
      .tta-table-scroll,.tta-ledgerwrap{width:100%;max-width:100%;overflow-x:auto!important;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}.tta-flowtable{min-width:560px}.tta-chartviewport{max-width:100%}.tta-axis{fill:#e0e8ed!important;color:#e0e8ed!important}.tta-grid{stroke:#ffffff18}.tta-zero{stroke:#aebfca}.tta-empty{color:#c8d4dc}
      @media(max-width:520px){.tta-content{padding-left:10px;padding-right:10px}.tta-period{align-items:stretch;flex-direction:column}.tta-syncactions{width:100%;display:grid;grid-template-columns:1fr 1fr}.tta-syncactions .tta-btn{width:100%}.tta-position-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tta-position-grid .tta-bento:last-child{grid-column:1/-1}.tta-listtools{grid-template-columns:1fr}.tta-consolidated{font-size:27px!important}.tta-help-grid{grid-template-columns:1fr}.tta-help-card.wide{grid-column:auto}.tta-portal-head{align-items:flex-start;flex-direction:column}.tta-nw-delta{grid-template-columns:1fr}.tta-nw-delta span{text-align:left;max-width:none}.tta-nw-change{grid-template-columns:32px minmax(0,1fr)}.tta-nw-change-value{grid-column:2;text-align:left}}
      /* v0.2.17 compact UI consistency sweep */
      #tta-fab{width:42px;height:42px;min-width:42px;min-height:42px;border-radius:14px;box-shadow:0 10px 24px #07151e5c,0 0 0 1px #79dfb312,inset 0 1px #ffffff27,inset 0 -8px 16px #0d1b2428}
      #tta-fab:before{left:6px;right:6px;top:4px}#tta-fab:after{width:21px;height:21px;right:-7px;bottom:-7px}
      #tta-fab .tta-fabicon,#tta-fab .tta-fabicon svg{width:25px;height:25px}#tta-fab .tta-fabspinner{width:18px;height:18px;flex-basis:18px}
      #tta-fab:hover{box-shadow:0 12px 27px #07151e68,0 0 0 1px #79dfb320,0 0 16px #91cdf719,inset 0 1px #ffffff32}
      #tta-fab.dragging{box-shadow:0 13px 30px #07151e70,0 0 18px #79dfb320,inset 0 1px #ffffff34}
      #tta-fab.syncing{box-shadow:0 11px 27px #07151e68,0 0 18px #79dfb320,inset 0 1px #ffffff2b}

      .tta-header{min-height:56px;padding:8px 10px;gap:7px}.tta-brand{gap:7px}.tta-mark{width:34px;height:34px;flex-basis:34px;border-radius:10px;font-size:17px}.tta-title{font-size:15px}.tta-sub{font-size:10px;margin-top:1px}.tta-iconbtn,.tta-back{width:36px;height:36px;min-width:36px;min-height:36px;flex-basis:36px;border-radius:10px;font-size:17px}.tta-back{font-size:23px}
      .tta-content{padding:11px 10px 28px!important}.tta-search{top:56px;padding-bottom:8px}.tta-search input{min-height:40px;padding:9px 11px;font-size:12px}
      .tta-period{gap:8px;padding:9px 10px;margin-bottom:9px;border-radius:14px}.tta-period strong{font-size:13px}.tta-periodhint{line-height:1.35}.tta-syncactions{gap:5px}.tta-syncactions .tta-btn{min-height:32px;padding:6px 8px;font-size:9.5px}
      .tta-chips{gap:6px;padding-bottom:3px}.tta-chip{min-height:31px;padding:6px 9px;font-size:10px}
      .tta-summary{gap:6px;margin:9px 0}.tta-stat{padding:9px;border-radius:12px}.tta-stat label{font-size:8px;letter-spacing:.55px}.tta-stat b{font-size:clamp(12px,3.7vw,15px);margin-top:4px}.tta-stat.main b{font-size:clamp(17px,5vw,20px)}
      .tta-chartcard{padding:11px 9px 9px;margin-bottom:11px;border-radius:15px!important}.tta-charthead{gap:7px;margin-bottom:7px}.tta-charthead h3{font-size:12px}.tta-charthead small{font-size:9px}.tta-chartinteractive{padding-top:45px}.tta-svg{height:150px}.tta-charttooltip{max-width:170px;padding:7px 8px}
      .tta-empty{min-height:92px;gap:7px;padding:14px;font-size:11px}.tta-sectionhead{flex-wrap:wrap;align-items:flex-start;gap:7px;margin:7px 1px 8px}.tta-sectionhead>div{min-width:0;flex:1 1 175px}.tta-sectionhead h3{font-size:13px}.tta-sectionhint{max-width:46%;text-align:right;line-height:1.35;white-space:normal}.tta-btn{min-height:35px;padding:7px 10px;font-size:10.5px;border-radius:11px}

      .tta-item{margin-bottom:8px;border-radius:14px!important}.tta-itemtop{grid-template-columns:42px minmax(0,1fr) auto;gap:8px;min-height:62px;padding:8px 9px}.tta-thumbwrap{width:42px;height:42px;border-radius:10px}.tta-thumb{width:35px;height:35px;max-width:35px;max-height:35px}.tta-itemname{font-size:12px}.tta-source{font-size:9px;margin-top:3px;line-height:1.3}.tta-itemfacts{gap:4px;margin-top:5px}.tta-factpill{min-height:19px;padding:3px 5px;font-size:8px}.tta-factpill.market{font-size:8.5px}.tta-profitbox{min-width:64px;max-width:90px}.tta-profit{font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tta-chevron{font-size:9px;margin-top:3px}.tta-cardactions{gap:4px;margin-bottom:3px}.tta-pin,.tta-hideitem{width:28px;height:28px;min-width:28px;min-height:28px;border-radius:8px}.tta-pin{font-size:13px}.tta-hideitem{font-size:12px}.tta-metric{padding:7px 5px}.tta-metric small{font-size:8px}.tta-metric b{font-size:11px}.tta-accordion{padding:10px}.tta-minirow{gap:5px;margin-bottom:8px}.tta-ministat{padding:7px 5px}.tta-ministat small{font-size:8px}.tta-ministat b{font-size:10.5px}
      .tta-listtools{gap:6px;margin:6px 0 3px}.tta-history-search{min-height:39px;padding:8px 10px;font-size:11px}.tta-sortbtn{min-width:104px}.tta-listmeta{font-size:9px;margin-bottom:8px}.tta-result{grid-template-columns:42px minmax(0,1fr) auto;gap:8px;padding:8px 9px;min-height:60px;margin-bottom:7px}.tta-result small{font-size:9px}

      .tta-banner{padding:9px 10px;margin-bottom:9px;border-radius:12px!important;line-height:1.45}.tta-keycard{padding:10px;margin:10px 0}.tta-keyhead{margin-bottom:7px}.tta-keyinputrow{gap:6px}.tta-keyinputrow input{min-height:39px;padding:8px 9px}.tta-keynote{margin-top:7px;line-height:1.45}.tta-settings label{margin:11px 0 4px}.tta-settings-actions{gap:6px;margin-top:9px}.tta-tos{padding:9px 10px;line-height:1.5}.tta-hiddenlist{gap:6px}.tta-hiddenrow{padding:7px 8px}.tta-hiddenrow .tta-btn{min-height:30px;padding:5px 8px}

      .tta-ledgerintro{gap:7px;margin-bottom:8px;flex-wrap:wrap}.tta-ledgerintro>div{min-width:0;flex:1 1 190px}.tta-ledgerfilters{gap:6px;margin:8px 0}.tta-ledgerfilters input,.tta-ledgerfilters select{min-height:38px;padding:7px 9px;font-size:10px}.tta-ledgersummary{gap:5px;margin:8px 0}.tta-ledgertable{min-width:860px}.tta-ledgertable th button{padding:8px 7px;font-size:8.5px}.tta-ledgertable td{padding:7px;font-size:9.5px}.tta-ledgeritem{min-width:122px}.tta-ledgermethod{min-width:112px}.tta-ledgerstatus{min-width:96px}.tta-ledgermeta{gap:7px;margin:6px 1px;font-size:9px}.tta-ledgermore{margin-top:9px}

      .tta-bento-grid{gap:8px;margin:8px 0}.tta-bento{padding:11px;border-radius:15px}.tta-bento b{font-size:clamp(12px,3.8vw,15px);margin-top:4px}.tta-bento p{margin-top:5px;line-height:1.4}.tta-bento-hero{padding:14px}.tta-consolidated{font-size:26px!important;margin-top:5px!important}.tta-equation{margin-top:6px;gap:6px}.tta-sectionintro{margin:12px 2px 6px}.tta-sectionintro h3,.tta-sectionhead h3{font-size:13px}
      .tta-feature-portal{margin:11px 0 14px;padding:10px;border-radius:17px}.tta-portal-head{gap:7px;margin:0 1px 8px}.tta-portal-head h3{font-size:14px}.tta-feature-portal .tta-fin-nav{gap:7px!important}.tta-feature-portal .tta-toolcard{flex-basis:clamp(184px,66vw,226px);min-height:88px;padding:10px 11px;grid-template-columns:36px minmax(0,1fr);gap:9px;border-radius:14px}.tta-feature-portal .tta-toolcard:after{right:9px;top:6px;font-size:20px}.tta-tool-icon{width:36px;height:36px;border-radius:11px;font-size:18px}.tta-toolcopy strong{font-size:12px!important}.tta-toolcopy small{font-size:8.5px!important;line-height:1.35;padding-right:9px}.tta-toolcopy em{margin-top:5px;font-size:8px}.tta-position-grid{gap:7px;margin-bottom:9px}.tta-position-grid .tta-bento{padding:9px}.tta-position-grid .tta-bento b{font-size:clamp(11px,3.5vw,13px)}
      .tta-glass-section{padding:10px;margin:9px 0}.tta-fin-section{padding:10px;margin:9px 0}.tta-fin-section h3{font-size:12px;margin-bottom:7px}.tta-cashhero{gap:6px;margin:8px 0 10px}.tta-cashcard{padding:9px}.tta-cashcard small{font-size:8px}.tta-cashcard b{font-size:clamp(12px,3.8vw,15px);margin-top:4px}.tta-fin-grid{gap:5px}.tta-fin-row{gap:7px;padding:6px 0;font-size:9.5px;align-items:flex-start}.tta-fin-row span{min-width:0;overflow-wrap:anywhere}.tta-fin-row b{flex:0 0 auto;max-width:55%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tta-breakdown{gap:4px}.tta-breakrow{gap:6px;padding:6px 7px;font-size:9px}.tta-networth-total{font-size:clamp(20px,7vw,25px)!important}.tta-snapshot-note{margin-top:5px;line-height:1.4}
      .tta-flowtable{min-width:520px;font-size:9.5px}.tta-flowtable th{padding:7px 6px;font-size:8.5px}.tta-flowtable td{padding:7px 6px}.tta-flowtitle{display:block;line-height:1.3}.tta-flowmeta{font-size:8px;line-height:1.35}.tta-flowbadge{font-size:7.5px;padding:3px 5px}

      .tta-help-intro{padding:11px;margin-bottom:9px;border-radius:15px}.tta-help-intro h2{font-size:15px;margin-bottom:4px}.tta-help-intro p{font-size:9.5px;line-height:1.45}.tta-help-grid{gap:7px}.tta-help-card{padding:10px;border-radius:14px}.tta-help-card .icon{width:30px;height:30px;margin-bottom:6px;border-radius:9px;font-size:15px}.tta-help-card h3{font-size:11.5px;margin-bottom:4px}.tta-help-card p{font-size:8.7px;line-height:1.45}
      .tta-nw-daily{margin-top:9px}.tta-nw-delta{gap:8px;padding:9px 10px;margin:6px 0 8px}.tta-nw-delta b{font-size:clamp(16px,5vw,19px)}.tta-nw-delta span{max-width:190px}.tta-nw-change-list{gap:5px}.tta-nw-change{grid-template-columns:30px minmax(0,1fr) auto;gap:7px;padding:7px 8px;border-radius:11px}.tta-nw-change-icon{width:30px;height:30px;border-radius:9px;font-size:14px}.tta-nw-change-copy strong{font-size:10px;white-space:normal;line-height:1.3}.tta-nw-change-copy small{font-size:8px;line-height:1.3}.tta-nw-change-value{font-size:clamp(8.5px,2.6vw,9.5px);max-width:120px;overflow:hidden;text-overflow:ellipsis}.tta-nw-disclaimer{margin-top:6px;line-height:1.4}
      /* v0.2.39 selectable Net Worth day */
      .tta-nw-daypicker{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(180px,1.4fr) auto;gap:8px;align-items:end;margin:8px 0}.tta-nw-daypicker label{display:grid;gap:4px;min-width:0}.tta-nw-daypicker label span{color:var(--tta-muted);font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.45px}.tta-nw-daypicker input{width:100%;min-height:36px;border:1px solid var(--tta-line);border-radius:10px;background:var(--tta-card);color:var(--tta-text);padding:7px 9px;font:inherit;font-size:10px;color-scheme:dark;outline:none}.tta-nw-daypicker input:focus{border-color:var(--tta-blue);box-shadow:0 0 0 2px #7fc1ff22}.tta-nw-dayrange{align-self:center;color:var(--tta-faint);font-size:8.5px;line-height:1.4}.tta-nw-dayrange b{color:var(--tta-muted)}.tta-nw-daypicker .tta-btn{min-height:36px}.tta-nw-daypicker .tta-btn:disabled{opacity:.45;cursor:default}.tta-nw-daily-metrics{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:7px;margin-bottom:8px}.tta-nw-daily-metrics .tta-nw-delta{margin:0;height:100%}.tta-nw-company-delta{display:flex;flex-direction:column;justify-content:center;padding:9px 10px;border:1px solid #ffffff1c;border-radius:14px;background:#ffffff09;min-width:0}.tta-nw-company-delta small{color:var(--tta-muted);font-size:8.5px}.tta-nw-company-delta b{display:block;margin-top:3px;font-size:clamp(14px,4.5vw,18px);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.tta-nw-company-delta span{display:block;margin-top:4px;color:var(--tta-faint);font-size:8px;line-height:1.35}
      @media(max-width:620px){.tta-nw-daypicker{grid-template-columns:minmax(0,1fr) auto}.tta-nw-dayrange{grid-column:1/-1;grid-row:2}.tta-nw-daily-metrics{grid-template-columns:1fr}}
      @media(max-width:380px){.tta-nw-daypicker{grid-template-columns:1fr}.tta-nw-daypicker .tta-btn{width:100%}.tta-nw-dayrange{grid-column:auto;grid-row:auto}}

      .tta-loading{padding:14px}.tta-loadingcard{padding:14px;border-radius:16px}.tta-loadicon{width:44px;height:44px;margin-bottom:9px;border-radius:13px}.tta-loadingdetail{min-height:28px;margin-top:5px;font-size:10px}.tta-loadingbar{margin:10px 0}.tta-loadinghint{margin-top:7px}.tta-toast{max-width:min(90vw,420px);white-space:normal;overflow-wrap:anywhere;padding:8px 11px;font-size:10px}

      @media(max-width:520px){
        .tta-header{padding-left:8px;padding-right:8px;gap:5px}.tta-brand{gap:5px}.tta-mark{width:30px;height:30px;flex-basis:30px;font-size:15px}.tta-title{font-size:14px}.tta-sub{font-size:9px}.tta-iconbtn,.tta-back{width:34px;height:34px;min-width:34px;min-height:34px;flex-basis:34px}.tta-content{padding-left:8px!important;padding-right:8px!important}.tta-period{padding:8px 9px}.tta-bento-grid{gap:7px}.tta-bento{padding:10px}.tta-bento-hero{padding:12px}.tta-consolidated{font-size:24px!important}.tta-feature-portal{padding:9px}.tta-feature-portal .tta-toolcard{flex-basis:min(76vw,215px)}.tta-sectionhint{max-width:none;text-align:left}.tta-keyinputrow{grid-template-columns:1fr}.tta-keyinputrow .tta-btn{width:100%}.tta-nw-change{grid-template-columns:28px minmax(0,1fr)}.tta-nw-change-icon{width:28px;height:28px}.tta-nw-change-value{grid-column:2;max-width:none;text-align:left}.tta-fin-row b{max-width:52%}.tta-flowtable{min-width:500px}
      }
      @media(max-width:380px){
        .tta-header{gap:4px}.tta-mark{display:none}.tta-iconbtn,.tta-back{width:32px;height:32px;min-width:32px;min-height:32px;flex-basis:32px}.tta-sub{max-width:145px}.tta-summary{grid-template-columns:1.35fr .9fr .9fr}.tta-stat{padding:8px 5px}.tta-itemtop{grid-template-columns:40px minmax(0,1fr) auto;gap:6px;padding:7px}.tta-thumbwrap{width:40px;height:40px}.tta-profitbox{min-width:58px;max-width:76px}.tta-cardactions{gap:3px}.tta-pin,.tta-hideitem{width:26px;height:26px;min-width:26px;min-height:26px}.tta-factpill:not(.market){display:none}.tta-feature-portal .tta-toolcard{flex-basis:78vw}.tta-flowtable{min-width:480px}
      }
      @media (hover:hover) and (pointer:fine){.tta-fin-nav.portal{cursor:grab}.tta-fin-nav.portal.dragging{cursor:grabbing;scroll-snap-type:none!important;user-select:none;-webkit-user-select:none}.tta-fin-nav.portal.dragging .tta-toolcard{cursor:grabbing}}
      @media (min-width:700px) and (orientation:landscape){
        .tta-content{width:min(calc(100% - 28px),960px)!important;max-width:960px!important;padding:14px 16px 34px!important}
        .tta-feature-portal .tta-fin-nav{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;overflow:visible!important;scroll-snap-type:none!important;gap:9px!important}
        .tta-feature-portal .tta-toolcard{flex:none!important;width:100%!important;min-width:0!important;max-width:none!important;min-height:96px}
        .tta-help-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      }
      @media (min-width:900px) and (orientation:landscape){
        .tta-content{width:min(calc(100% - 40px),1180px)!important;max-width:1180px!important;padding:16px 20px 38px!important}
        .tta-dashboard .tta-bento-grid{grid-template-columns:minmax(0,1.65fr) repeat(2,minmax(0,1fr));align-items:stretch}
        .tta-dashboard .tta-bento-hero{grid-column:auto;display:flex;flex-direction:column;justify-content:center}
        .tta-feature-portal{padding:13px 14px}
        .tta-feature-portal .tta-fin-nav{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        .tta-feature-portal .tta-toolcard{min-height:112px;padding:12px 13px;grid-template-columns:40px minmax(0,1fr)}
        .tta-feature-portal .tta-toolcopy small{padding-right:5px}
        .tta-position-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
        .tta-cashhero{grid-template-columns:repeat(3,minmax(0,1fr))}
        .tta-help-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
        .tta-help-card.wide{grid-column:span 3}
        .tta-ledgertable{min-width:100%}
      }
      @media (min-width:1200px) and (orientation:landscape){
        .tta-content{max-width:1280px!important}
        .tta-feature-portal .tta-toolcard{min-height:118px}
        .tta-flowtable{min-width:100%}
      }
      #tta-fab.snapping{transition:left .2s cubic-bezier(.22,.8,.32,1),transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease}
      /* v0.2.22 API key setup */
      .tta-keyinputrow{grid-template-columns:minmax(0,1fr) auto auto}.tta-keycreate{white-space:nowrap}
      @media(max-width:520px){.tta-keyinputrow{grid-template-columns:1fr 1fr}.tta-keyinputrow input{grid-column:1/-1}.tta-keyinputrow .tta-btn{width:100%}}
      @media(max-width:380px){.tta-keyinputrow{grid-template-columns:1fr}.tta-keyinputrow input{grid-column:auto}}
      /* v0.2.18 finance suite */
      .tta-insight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tta-insight-grid>.tta-fin-section{margin:0}.tta-analytics-bars{display:grid;gap:8px;margin-top:10px}.tta-analytics-row{display:grid;gap:4px}.tta-analytics-label{display:flex;justify-content:space-between;gap:8px;font-size:9px}.tta-analytics-label span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tta-muted)}.tta-analytics-label b{white-space:nowrap}.tta-analytics-track,.tta-goal-track{height:6px;border-radius:999px;background:#071018;overflow:hidden;border:1px solid #ffffff14}.tta-analytics-track span,.tta-goal-track span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--tta-green),var(--tta-blue))}.tta-analytics-row small,.tta-allocation-row small{color:var(--tta-faint);font-size:8px}.tta-unmapped-list{display:grid;gap:6px}.tta-unmapped{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 9px;border:1px solid #ffffff18;border-radius:11px;background:#ffffff07}.tta-unmapped strong{display:block;font-size:10px}.tta-unmapped small{display:block;margin-top:2px;color:var(--tta-faint);font-size:8px;line-height:1.35}.tta-unmapped b{font-size:10px;white-space:nowrap}.tta-goal-form{display:grid;grid-template-columns:1.2fr 1fr 1fr auto;gap:6px;margin-bottom:9px}.tta-goal-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.tta-goal{padding:9px;border:1px solid #ffffff1b;border-radius:13px;background:#ffffff08}.tta-goal-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.tta-goal-head strong{display:block;font-size:10.5px}.tta-goal-head small{display:block;color:var(--tta-faint);font-size:8px}.tta-goal-remove{width:27px!important;height:27px!important;min-width:27px!important;min-height:27px!important;flex-basis:27px!important}.tta-goal-values{display:flex;gap:5px;align-items:baseline;margin:8px 0 6px}.tta-goal-values b{font-size:14px}.tta-goal-values span{font-size:8.5px;color:var(--tta-muted)}.tta-goal>small{display:block;margin-top:5px;color:var(--tta-faint);font-size:8px}.tta-nw-chart{width:100%;overflow:hidden}.tta-nw-chart svg{width:100%;height:150px;display:block}.tta-nw-line{fill:none;stroke:var(--tta-blue);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.tta-nw-point{fill:var(--tta-green);stroke:#0b151d;stroke-width:1}.tta-nw-chart-meta{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin-top:3px;color:var(--tta-faint);font-size:8px}.tta-nw-chart-meta span:last-child{text-align:right}.tta-nw-chart-meta b{text-align:center;font-size:10px}.tta-allocation{display:grid;gap:8px}.tta-allocation-row{display:grid;grid-template-columns:minmax(0,1fr) 1.2fr auto;gap:8px;align-items:center}.tta-allocation-row>div:first-child{display:flex;justify-content:space-between;gap:6px;font-size:9px}.tta-allocation-row>div:first-child span{color:var(--tta-muted)}.tta-allocation-row b{white-space:nowrap}.tta-backup-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
      @media(max-width:640px){.tta-insight-grid{grid-template-columns:1fr}.tta-goal-form{grid-template-columns:1fr 1fr}.tta-goal-form #tta-goal-label{grid-column:1/-1}.tta-goal-form .tta-btn{grid-column:1/-1}.tta-goal-list{grid-template-columns:1fr}}
      @media(max-width:420px){.tta-allocation-row{grid-template-columns:1fr auto}.tta-allocation-row .tta-analytics-track{grid-column:1/-1}.tta-goal-form{grid-template-columns:1fr}.tta-goal-form #tta-goal-label,.tta-goal-form .tta-btn{grid-column:auto}.tta-backup-actions{grid-template-columns:1fr}}




      /* v0.2.32 cross-device text and spacing safety */
      #tta-root{-webkit-text-size-adjust:100%;text-size-adjust:100%}
      #tta-root .tta-content,#tta-root .tta-dashboard,#tta-root .tta-feature-portal,#tta-root .tta-fin-section,#tta-root .tta-glass-section,#tta-root .tta-bento,#tta-root .tta-toolcard{min-width:0}
      #tta-root .tta-sectionintro,#tta-root .tta-sectionhead,#tta-root .tta-portal-head{min-width:0;align-items:flex-start}
      #tta-root .tta-sectionintro>div,#tta-root .tta-sectionhead>div,#tta-root .tta-portal-head>div{min-width:0;display:grid;grid-template-columns:minmax(0,1fr);align-content:start;row-gap:4px}
      #tta-root .tta-sectionintro small,#tta-root .tta-sectionhead small,#tta-root .tta-portal-head small{position:static;display:block;margin:0;padding:0;line-height:1.35;min-height:1.35em;white-space:normal;overflow-wrap:anywhere}
      #tta-root .tta-sectionintro h3,#tta-root .tta-sectionhead h3,#tta-root .tta-portal-head h3{position:static;display:block;margin:0;padding:0;line-height:1.2;min-height:1.2em;white-space:normal;overflow-wrap:anywhere;word-break:normal}
      #tta-root .tta-sectionintro{margin-top:16px;margin-bottom:10px;gap:10px}
      #tta-root .tta-sectionintro>span,#tta-root .tta-sectionhint,#tta-root .tta-morehint{line-height:1.4;white-space:normal;overflow-wrap:anywhere}
      #tta-root .tta-portal-head{gap:9px;margin-bottom:12px}
      #tta-root .tta-portal-head>span{line-height:1.4;white-space:normal;flex:0 1 auto}
      #tta-root .tta-feature-portal .tta-toolcard{height:auto;align-content:center}
      #tta-root .tta-toolcopy{min-width:0;overflow:visible}
      #tta-root .tta-toolcopy strong,#tta-root .tta-toolcopy small,#tta-root .tta-toolcopy em{white-space:normal;overflow-wrap:anywhere;word-break:normal;line-height:1.35}
      #tta-root .tta-toolcopy strong{line-height:1.25}
      #tta-root .tta-toolcopy em{line-height:1.3}
      #tta-root .tta-bento small,#tta-root .tta-bento b,#tta-root .tta-bento p,#tta-root .tta-cashcard small,#tta-root .tta-cashcard b{line-height:1.35}
      #tta-root .tta-fin-row span,#tta-root .tta-fin-row b{line-height:1.4}
      #tta-root .tta-flowtitle{line-height:1.35;white-space:normal;overflow-wrap:anywhere}
      #tta-root .tta-flowmeta{line-height:1.4;white-space:normal;overflow-wrap:anywhere}
      #tta-root .tta-nw-change-copy strong,#tta-root .tta-nw-change-copy small{white-space:normal;overflow-wrap:anywhere}
      #tta-root .tta-btn,#tta-root .tta-chip,#tta-root .tta-iconbtn,#tta-root .tta-back{flex-shrink:0}
      @media(max-width:520px){
        #tta-root .tta-portal-head{flex-direction:column;align-items:stretch;gap:9px}
        #tta-root .tta-portal-head>span{width:100%;margin-top:1px}
        #tta-root .tta-sectionintro{align-items:flex-start}
        #tta-root .tta-sectionintro h3,#tta-root .tta-portal-head h3{font-size:clamp(14px,5vw,18px)}
        #tta-root .tta-sectionintro small,#tta-root .tta-portal-head small{font-size:8px}
        #tta-root .tta-feature-portal .tta-toolcard{min-height:0;padding-top:12px;padding-bottom:12px}
        #tta-root .tta-toolcopy em{margin-top:6px}
      }
      @media(max-width:430px){
        #tta-root .tta-sectionintro{display:grid;grid-template-columns:minmax(0,1fr);align-items:start}
        #tta-root .tta-sectionintro>span,#tta-root .tta-sectionintro>.tta-btn,#tta-root .tta-sectionintro>.tta-sectionhint{justify-self:start;max-width:100%}
        #tta-root .tta-sectionintro>.tta-btn{width:auto;min-width:0;white-space:normal}
        #tta-root .tta-sectionhead{flex-wrap:wrap}
        #tta-root .tta-sectionhead>div{flex:1 1 180px}
        #tta-root .tta-sectionhead>.tta-btn{max-width:100%;white-space:normal}
      }
      @media(max-width:360px){
        #tta-root .tta-sectionintro h3,#tta-root .tta-portal-head h3{font-size:14px}
        #tta-root .tta-sectionintro{margin-top:14px;margin-bottom:9px}
        #tta-root .tta-feature-portal{padding-left:9px;padding-right:9px}
      }


      /* v0.2.38 Help & Guide spacing isolation */
      .tta-help-intro{display:block!important;height:auto!important;min-height:0!important;align-items:initial!important;justify-content:initial!important;padding:11px 12px!important;margin:0 0 8px!important}
      .tta-help-intro h2{display:block!important;position:static!important;margin:0!important;padding:0!important;min-height:0!important;line-height:1.18!important}
      .tta-help-intro p{display:block!important;position:static!important;margin:6px 0 0!important;padding:0!important;min-height:0!important;line-height:1.45!important}
      .tta-help-grid{align-items:start!important;grid-auto-rows:auto!important;gap:8px!important}
      .tta-help-card{display:block!important;position:relative!important;height:auto!important;min-height:0!important;align-self:start!important;align-items:initial!important;justify-content:initial!important;padding:11px 12px!important;margin:0!important;overflow:visible!important}
      .tta-help-card-head{display:flex!important;position:static!important;align-items:center!important;justify-content:flex-start!important;gap:9px!important;width:100%!important;min-width:0!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important}
      .tta-help-card-head .icon{display:grid!important;position:static!important;place-items:center!important;flex:0 0 30px!important;width:30px!important;height:30px!important;min-width:30px!important;min-height:30px!important;margin:0!important;padding:0!important}
      .tta-help-card-head h3{display:block!important;position:static!important;flex:1 1 auto!important;min-width:0!important;min-height:0!important;margin:0!important;padding:0!important;font-size:11.5px!important;line-height:1.25!important;white-space:normal!important;overflow-wrap:anywhere!important}
      .tta-help-card>p{display:block!important;position:static!important;width:100%!important;height:auto!important;min-height:0!important;margin:8px 0 0!important;padding:0!important;font-size:8.7px!important;line-height:1.48!important;white-space:normal!important;overflow-wrap:anywhere!important}
      @media(max-width:520px){.tta-help-intro{padding:10px 11px!important}.tta-help-card{padding:10px 11px!important}.tta-help-card-head{gap:8px!important}.tta-help-card>p{margin-top:7px!important}}
      @media(max-width:360px){.tta-help-card-head{align-items:flex-start!important}.tta-help-card-head .icon{flex-basis:28px!important;width:28px!important;height:28px!important;min-width:28px!important;min-height:28px!important}.tta-help-card-head h3{font-size:11px!important}.tta-help-card>p{font-size:8.5px!important}}

      /* v0.2.36 interactive cash-flow trend */
      .tta-cashflow-chartcard{margin-top:10px}
      .tta-cashflow-chartcard .tta-charthead>div:first-child{min-width:0;display:grid;gap:3px}.tta-cashflow-chartcard .tta-charthead small{color:var(--tta-faint);font-size:8px;line-height:1.35;white-space:normal}
      .tta-cashlegend{display:flex;flex-wrap:wrap;gap:7px 12px;margin:7px 0 3px;color:var(--tta-muted);font-size:8px;font-weight:700}.tta-cashlegend span{display:inline-flex;align-items:center;gap:5px}.tta-cashlegend span:before{content:"";width:14px;height:2px;border-radius:99px;background:currentColor}.tta-cashlegend .in{color:var(--tta-green)}.tta-cashlegend .out{color:var(--tta-red)}.tta-cashlegend .net{color:var(--tta-blue)}
      .tta-cash-chartframe{display:flex;align-items:stretch;min-width:0;width:100%;overflow:hidden}.tta-cash-axis-wrap{position:relative;z-index:4;flex:0 0 56px;width:56px;height:214px;background:linear-gradient(90deg,var(--tta-card) 0%,var(--tta-card) 88%,#151e28e8 100%);border-right:1px solid #34475a88;box-shadow:8px 0 14px #06090d24}.tta-cash-axis-svg{display:block;width:56px;height:214px;overflow:visible}.tta-cash-axis-label{font-weight:700;fill:var(--tta-muted)}.tta-axis-tick{stroke:var(--tta-line);stroke-width:1}.tta-cash-chartframe>.tta-chartviewport{flex:1 1 auto;min-width:0;margin:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
      .tta-cash-svg{display:block;height:214px;width:100%}.tta-cashline{fill:none;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}.tta-cashline.in{stroke:var(--tta-green)}.tta-cashline.out{stroke:var(--tta-red)}.tta-cashline.net{stroke:var(--tta-blue);stroke-width:2.5}
      .tta-cashpoint{fill:transparent;stroke:none;cursor:pointer;outline:none}.tta-cashpoint:hover,.tta-cashpoint:focus,.tta-cashpoint.active{fill:#ffffff0b}.tta-cashpoint:focus{stroke:var(--tta-blue);stroke-width:1;stroke-dasharray:3 3}
      .tta-charttooltip.tta-cashtooltip{display:grid;gap:2px;min-width:156px;text-align:left}.tta-charttooltip.tta-cashtooltip strong{margin-bottom:2px}.tta-charttooltip.tta-cashtooltip span{font-size:8px;line-height:1.35;white-space:nowrap}
      @media(max-width:520px){.tta-cashflow-chartcard .tta-charthead{align-items:flex-start;gap:8px}.tta-cashflow-chartcard .tta-charthead>div:first-child{width:100%}.tta-cashflow-chartcard .tta-seg{flex-shrink:0}.tta-cash-svg,.tta-cash-axis-wrap,.tta-cash-axis-svg{height:205px}.tta-cash-axis-wrap{flex-basis:52px;width:52px}.tta-cash-axis-svg{width:52px}}

    `;
    document.head.appendChild(s);
  }

  function clampFabPosition(left,top,fab) {
    const pad=8,w=fab.offsetWidth||132,h=fab.offsetHeight||42;
    return {left:Math.max(pad,Math.min(left,window.innerWidth-w-pad)),top:Math.max(pad,Math.min(top,window.innerHeight-h-pad))};
  }
  function snapFabPosition(left,top,fab) {
    const p=clampFabPosition(left,top,fab),pad=8,w=fab.offsetWidth||42;
    const center=p.left+w/2,sideLeft=center<=window.innerWidth/2;
    return {left:sideLeft?pad:Math.max(pad,window.innerWidth-w-pad),top:p.top,side:sideLeft?'left':'right'};
  }
  function applyFabPosition(fab) {
    if(!fab)return;
    if(state.fabPosition && Number.isFinite(state.fabPosition.left) && Number.isFinite(state.fabPosition.top)){
      const p=snapFabPosition(state.fabPosition.left,state.fabPosition.top,fab);
      fab.style.left=`${p.left}px`;fab.style.top=`${p.top}px`;fab.style.right='auto';fab.style.bottom='auto';
      state.fabPosition=p;save('fabPosition',p);
    }
  }
  function bindFabDrag(fab) {
    if(!fab || fab.dataset.dragBound==='1')return;
    fab.dataset.dragBound='1';
    let startX=0,startY=0,startLeft=0,startTop=0,moved=false,pointerId=null;
    fab.addEventListener('pointerdown',e=>{
      if(e.button!=null && e.button!==0)return;
      pointerId=e.pointerId;moved=false;startX=e.clientX;startY=e.clientY;
      const r=fab.getBoundingClientRect();startLeft=r.left;startTop=r.top;
      try{fab.setPointerCapture(pointerId);}catch(_){ }
    });
    fab.addEventListener('pointermove',e=>{
      if(pointerId==null||e.pointerId!==pointerId)return;
      const dx=e.clientX-startX,dy=e.clientY-startY;if(!moved&&Math.hypot(dx,dy)<5)return;
      moved=true;fab.classList.add('dragging');e.preventDefault();
      const p=clampFabPosition(startLeft+dx,startTop+dy,fab);
      fab.style.left=`${p.left}px`;fab.style.top=`${p.top}px`;fab.style.right='auto';fab.style.bottom='auto';
    });
    const finish=e=>{
      if(pointerId==null||e.pointerId!==pointerId)return;
      try{fab.releasePointerCapture(pointerId);}catch(_){ }
      pointerId=null;fab.classList.remove('dragging');
      if(moved){
        const r=fab.getBoundingClientRect(),p=snapFabPosition(r.left,r.top,fab);
        fab.classList.add('snapping');fab.style.left=`${p.left}px`;fab.style.top=`${p.top}px`;fab.style.right='auto';fab.style.bottom='auto';
        state.fabPosition=p;save('fabPosition',p);fab.dataset.suppressClick='1';
        setTimeout(()=>{fab.classList.remove('snapping');fab.dataset.suppressClick='0';},250);
      }
    };
    fab.addEventListener('pointerup',finish);fab.addEventListener('pointercancel',finish);
    fab.addEventListener('click',e=>{if(fab.dataset.suppressClick==='1'){e.preventDefault();e.stopPropagation();return;}openAnalyzer();});
    window.addEventListener('resize',()=>applyFabPosition(fab),{passive:true});
  }
  function fabIconSvg() {
    return `<span class="tta-fabicon" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><defs><linearGradient id="ttaFabPulse" x1="7" y1="23" x2="25" y2="8" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#79dfb3"/><stop offset="1" stop-color="#91cdf7"/></linearGradient></defs><rect class="tta-fab-panel" x="4.5" y="5" width="23" height="21" rx="6"/><path class="tta-fab-grid" d="M9 10.5h14M9 15.5h14M9 20.5h14M12 9v13M18 9v13M24 9v13"/><path class="tta-fab-line" d="M8 21l4.1-4.2 3.5 2.2 4.2-6.4 4.2 2.4"/><circle class="tta-fab-dot" cx="24" cy="15" r="1.8"/><path class="tta-fab-mark" d="M7.5 8.3h4.2v1.3H7.5z"/></svg></span>`;
  }

  function updateFabState() {
    const fab=document.getElementById('tta-fab');if(!fab)return;
    const syncing=!!state.syncing;
    fab.classList.toggle('syncing',syncing);
    fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Cash Flow Analyzer');
    fab.title=syncing?'Financial history sync is running \u00B7 tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?'<span class="tta-fabspinner" aria-hidden="true"></span>':fabIconSvg();
    fab.style.display=state.open?'none':'inline-flex';
    requestAnimationFrame(()=>applyFabPosition(fab));
  }
  function mount() {
    injectCss();
    if (!document.getElementById('tta-fab')) {
      const fab = document.createElement('button'); fab.id = 'tta-fab';
      fab.innerHTML = fabIconSvg();
      document.body.appendChild(fab);bindFabDrag(fab);requestAnimationFrame(()=>applyFabPosition(fab));
    } else { const fab=document.getElementById('tta-fab');bindFabDrag(fab);applyFabPosition(fab); }
    if (!document.getElementById('tta-root')) {
      const root = document.createElement('div'); root.id = 'tta-root'; document.body.appendChild(root);
    }
    updateFabState();
    render();
  }

  let demoTxCache=null;
  const perfCache={
    txRef:null,byItem:new Map(),lastById:new Map(),itemIds:[],fifo:new Map(),summaries:new Map(),series:new Map(),overall:new Map(),
    catalogRef:null,catalogMap:new Map(),trackedTxRef:null,trackedCatalogRef:null,tracked:[],ledgerTxRef:null,ledgerRows:[],ledgerByItem:new Map(),searchTimer:null,legacySearchTimer:null,ledgerSearchTimer:null
  };

  function resetAnalyticsCache() {
    perfCache.txRef=null;perfCache.byItem=new Map();perfCache.lastById=new Map();perfCache.itemIds=[];
    perfCache.fifo.clear();perfCache.summaries.clear();perfCache.series.clear();perfCache.overall.clear();
    perfCache.trackedTxRef=null;perfCache.trackedCatalogRef=null;perfCache.tracked=[];
    perfCache.ledgerTxRef=null;perfCache.ledgerRows=[];perfCache.ledgerByItem=new Map();
  }

  function effectiveTransactions() {
    if (state.transactions.length || !state.demo) return state.transactions;
    if(!demoTxCache)demoTxCache=demoTransactions();
    return demoTxCache;
  }

  function ensureTxIndex() {
    const tx=effectiveTransactions();
    if(perfCache.txRef===tx)return perfCache;
    const byItem=new Map(),lastById=new Map();
    for(const t of tx){
      const id=Number(t?.itemId);if(!(id>0))continue;
      if(!byItem.has(id))byItem.set(id,[]);
      byItem.get(id).push(t);
      const ts=Number(t?.timestamp)||0;if(ts>(lastById.get(id)||0))lastById.set(id,ts);
    }
    for(const rows of byItem.values())rows.sort((a,b)=>a.timestamp-b.timestamp||String(a.id).localeCompare(String(b.id)));
    perfCache.txRef=tx;perfCache.byItem=byItem;perfCache.lastById=lastById;perfCache.itemIds=[...byItem.keys()];
    perfCache.fifo.clear();perfCache.summaries.clear();perfCache.series.clear();perfCache.overall.clear();
    perfCache.trackedTxRef=null;perfCache.trackedCatalogRef=null;perfCache.tracked=[];
    return perfCache;
  }

  function getCatalogMap() {
    if(perfCache.catalogRef===state.catalog)return perfCache.catalogMap;
    perfCache.catalogRef=state.catalog;
    perfCache.catalogMap=new Map((state.catalog||[]).map(x=>[Number(x.id),x]));
    perfCache.trackedCatalogRef=null;
    return perfCache.catalogMap;
  }

  function catalogItem(id) {
    id=Number(id);
    const found=getCatalogMap().get(id);
    return found || {id,name:`Item #${id}`,type:'Item',image:`https://www.torn.com/images/items/${id}/large.png`,marketPrice:0};
  }

  function effectiveTracked() {
    const idx=ensureTxIndex();
    if(!idx.itemIds.length&&state.demo)return demoTracked();
    if(perfCache.trackedTxRef===idx.txRef&&perfCache.trackedCatalogRef===state.catalog)return perfCache.tracked;
    perfCache.tracked=idx.itemIds.map(catalogItem).sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
    perfCache.trackedTxRef=idx.txRef;perfCache.trackedCatalogRef=state.catalog;
    return perfCache.tracked;
  }

  function periodCacheKey() {
    const r=dateRange();
    return `${state.dateMode}|${state.customFrom}|${state.customTo}|${Math.floor(r.from/60)}|${Math.floor(r.to/60)}`;
  }

  const SORT_OPTIONS=[
    {id:'recent',label:'Recent'},
    {id:'profit',label:'Profit'},
    {id:'acquired',label:'Acquired'},
    {id:'sold',label:'Sold'},
    {id:'name',label:'Name'}
  ];
  function sortLabel(){return SORT_OPTIONS.find(x=>x.id===state.sortMode)?.label||'Recent';}
  function historyItemRows() {
    const q=String(state.itemSearch||'').trim().toLowerCase();
    const pinned=new Set((state.pinnedIds||[]).map(Number));
    const hidden=new Set((state.hiddenIds||[]).map(Number));
    const idx=ensureTxIndex();
    const rows=effectiveTracked()
      .filter(item=>!hidden.has(Number(item.id)) && (!q || item.name.toLowerCase().includes(q) || String(item.id).includes(q)))
      .map(item=>({item,summary:summaryFor(item.id),lastActivity:idx.lastById.get(Number(item.id))||0,pinned:pinned.has(Number(item.id))}))
      .filter(row=>row.summary.events.length>0);
    rows.sort((a,b)=>{
      if(a.pinned!==b.pinned)return a.pinned?-1:1;
      let d=0;
      if(state.sortMode==='profit')d=b.summary.profit-a.summary.profit;
      else if(state.sortMode==='acquired')d=b.summary.bought-a.summary.bought;
      else if(state.sortMode==='sold')d=b.summary.sold-a.summary.sold;
      else if(state.sortMode==='name')d=a.item.name.localeCompare(b.item.name);
      else d=b.lastActivity-a.lastActivity;
      return d || a.item.name.localeCompare(b.item.name) || a.item.id-b.item.id;
    });
    return rows;
  }

  function subtractCalendarMonth(date) {
    const d=new Date(date);
    const day=d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth()-1);
    const maxDay=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
    d.setDate(Math.min(day,maxDay));
    return d;
  }

  function selectedPeriodBounds(nowDate=new Date()) {
    const nowMs=nowDate.getTime();
    let from=0,to=Math.floor(nowMs/1000)+60;
    if(state.dateMode==='7d') from=Math.floor((nowMs-7*86400*1000)/1000);
    else if(state.dateMode==='14d') from=Math.floor((nowMs-14*86400*1000)/1000);
    else if(state.dateMode==='30d') from=Math.floor((nowMs-30*86400*1000)/1000);
    else if(state.dateMode==='custom') {
      if(state.customFrom) from=Math.floor(new Date(state.customFrom+'T00:00:00').getTime()/1000);
      if(state.customTo) to=Math.min(to,Math.floor(new Date(state.customTo+'T23:59:59').getTime()/1000));
    }
    if(!Number.isFinite(from)||from<0)from=0;
    if(!Number.isFinite(to))to=Math.floor(nowMs/1000)+60;
    return {from:Math.floor(from),to:Math.floor(to)};
  }

  // Torn City Time (TCT) follows Torn's server timestamp. Use UTC calendar boundaries
  // for sync planning so device timezone never decides which Torn day was checked.
  function tctDayStart(ts) { return Math.floor((Number(ts)||0)/86400)*86400; }
  function tctWeekStart(ts) { const d=new Date((Number(ts)||0)*1000),wd=(d.getUTCDay()+6)%7;d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-wd);return Math.floor(d.getTime()/1000); }
  function tctMonthStart(ts) { const d=new Date((Number(ts)||0)*1000);return Math.floor(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)/1000); }
  function nextTctMonthStart(ts) { const d=new Date((Number(ts)||0)*1000);return Math.floor(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000); }
  function tctDateStr(ts) { return new Date((Number(ts)||0)*1000).toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}); }
  function tctDateTimeStr(ts) { return new Date((Number(ts)||0)*1000).toLocaleString(undefined,{timeZone:'UTC',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}); }
  function subtractCalendarMonthTct(serverNow) {
    const d=new Date((Number(serverNow)||0)*1000),day=d.getUTCDate();
    d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);
    const maxDay=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
    d.setUTCDate(Math.min(day,maxDay));return Math.floor(d.getTime()/1000);
  }
  function selectedPeriodBoundsTct(serverNow=nowSec()) {
    serverNow=Math.floor(Number(serverNow)||nowSec());
    let from=0,to=serverNow;
    if(state.dateMode==='7d')from=serverNow-7*86400;
    else if(state.dateMode==='14d')from=serverNow-14*86400;
    else if(state.dateMode==='30d')from=serverNow-30*86400;
    else if(state.dateMode==='custom'){
      if(state.customFrom){const x=Date.parse(state.customFrom+'T00:00:00Z')/1000;if(Number.isFinite(x))from=Math.floor(x);}
      if(state.customTo){const x=Date.parse(state.customTo+'T23:59:59Z')/1000;if(Number.isFinite(x))to=Math.min(to,Math.floor(x));}
    }
    if(!Number.isFinite(from)||from<0)from=0;if(!Number.isFinite(to)||to>serverNow)to=serverNow;
    return {from:Math.floor(from),to:Math.floor(to)};
  }

  function dateRange() {
    const allTx=effectiveTransactions();
    const bounds=selectedPeriodBounds();
    let from=bounds.from,to=bounds.to;
    if(state.dateMode==='all'){from=Infinity;for(const x of allTx){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}for(const x of state.cashFlows||[]){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}if(!Number.isFinite(from))from=0;}
    return {from,to};
  }

  function fifoAnalytics(itemId) {
    const id=Number(itemId),idx=ensureTxIndex();
    if(perfCache.fifo.has(id))return perfCache.fifo.get(id);
    const tx=idx.byItem.get(id)||[];
    const sent=(state.playerTransfers||[]).filter(x=>x?.type==='item'&&x?.direction==='out'&&Number(x.itemId)===id&&Number(x.qty)>0).map(x=>({...x,id:`transfer:${x.id}`,side:'transfer-out',total:0,netTotal:0,source:'Player Transfer'}));
    const consumed=(state.itemConsumptions||[]).filter(x=>Number(x.itemId)===id&&Number(x.qty)>0).map(x=>({...x,id:`consume:${x.id}`,side:'consume-out',total:0,netTotal:0,source:'Item Use'}));
    const timeline=[...tx,...sent,...consumed].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)||String(a.id).localeCompare(String(b.id)));
    const lots=[];let lotHead=0;const events=[];
    const consume=(qtyValue)=>{let remain=Math.max(0,Number(qtyValue)||0),basis=0,matched=0;while(remain>0&&lotHead<lots.length){const lot=lots[lotHead],take=Math.min(remain,lot.qty);basis+=take*lot.unit;matched+=take;remain-=take;lot.qty-=take;if(lot.qty<=1e-9)lotHead++;}return {basis,matched,remain};};
    for(const t of timeline){
      if(t.side==='buy'){
        if(t.qty>0&&t.total>=0)lots.push({qty:t.qty,unit:t.qty?t.total/t.qty:0});
        events.push({...t,realizedProfit:0,matchedQty:0,unmatchedQty:0});
      }else if(t.side==='transfer-out'||t.side==='consume-out'){
        const c=consume(t.qty);events.push({...t,costBasis:c.basis,realizedProfit:0,matchedQty:c.matched,unmatchedQty:c.remain,transferredQty:t.side==='transfer-out'?c.matched:0,consumedQty:t.side==='consume-out'?c.matched:0});
      }else if(t.side==='sell'){
        const c=consume(t.qty),net=t.netTotal??t.total,matchedRevenue=t.qty>0?net*(c.matched/t.qty):0;
        events.push({...t,costBasis:c.basis,realizedProfit:matchedRevenue-c.basis,matchedQty:c.matched,unmatchedQty:c.remain});
      }
    }
    let remainingQty=0,remainingCost=0;for(let i=lotHead;i<lots.length;i++){remainingQty+=lots[i].qty;remainingCost+=lots[i].qty*lots[i].unit;}
    const result={events,remainingQty,remainingCost};perfCache.fifo.set(id,result);return result;
  }

  function acquisitionMethod(t) {
    const source=String(t?.source||''),text=`${source} ${t?.title||''}`.toLowerCase();
    if(source==='Player Trade')return 'Player Trade';
    if(/item receive|item received|player transfer/i.test(`${source} ${t?.title||''}`))return 'Player Transfer / Gift';
    if(/crime/.test(text))return 'Crime';
    if(/seasonal gift|christmas|easter|halloween|\bgift\b/.test(text))return 'Gift / Event';
    if(/mission reward|job \/ company reward|job special|company special|event reward|competition reward/.test(text))return 'Reward';
    if(/city find|item.*found|found item/.test(text))return 'City Find';
    if(source==='Foreign Market'||/foreign market|abroad|travel/.test(text))return 'Bought overseas';
    if(source==='Item Market'||/item market/.test(text))return 'Item Market';
    if(source==='Bazaar'||/bazaar/.test(text))return 'Bazaar';
    if(source==='Torn Shop'||/torn shop|item shop/.test(text))return 'Torn Shop';
    if(t?.free)return 'Free / Reward';
    return source||'Other';
  }

  function acquisitionLedgerRows() {
    const idx=ensureTxIndex();
    if(perfCache.ledgerTxRef===idx.txRef)return perfCache.ledgerRows;
    const ledger=[],ledgerByItem=new Map();
    const itemIds=new Set(idx.itemIds);for(const t of state.playerTransfers||[])if(t?.type==='item'&&t?.direction==='out'&&Number(t.itemId)>0)itemIds.add(Number(t.itemId));for(const t of state.itemConsumptions||[])if(Number(t?.itemId)>0)itemIds.add(Number(t.itemId));
    for(const itemId of itemIds){
      const tx=idx.byItem.get(itemId)||[],sent=(state.playerTransfers||[]).filter(x=>x?.type==='item'&&x?.direction==='out'&&Number(x.itemId)===Number(itemId)&&Number(x.qty)>0).map(x=>({...x,id:`transfer:${x.id}`,side:'transfer-out',source:'Player Transfer'})),consumed=(state.itemConsumptions||[]).filter(x=>Number(x.itemId)===Number(itemId)&&Number(x.qty)>0).map(x=>({...x,id:`consume:${x.id}`,side:'consume-out',source:'Item Use'}));
      const timeline=[...tx,...sent,...consumed].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)||String(a.id).localeCompare(String(b.id))),lots=[];let lotHead=0;
      for(const t of timeline){
        const q=Math.max(0,Number(t?.qty)||0);if(!(q>0))continue;
        if(t.side==='buy'){
          const cost=Math.max(0,Number(t.total)||0),item=catalogItem(itemId);
          const row={id:String(t.id),acquiredAt:Number(t.timestamp)||0,itemId:Number(itemId),itemName:item.name,itemType:item.type||'Item',qty:q,method:acquisitionMethod(t),source:String(t.source||''),title:String(t.title||''),free:!!t.free,costTotal:cost,unitCost:q?cost/q:0,soldQty:0,transferredQty:0,consumedQty:0,soldProceeds:0,realizedCost:0,realizedProfit:0,unsoldQty:q,status:'unsold',saleCount:0,firstSoldAt:0,lastSoldAt:0,lastTransferredAt:0,lastConsumedAt:0,saleSources:[],_saleSources:new Set()};
          ledger.push(row);if(!ledgerByItem.has(Number(itemId)))ledgerByItem.set(Number(itemId),[]);ledgerByItem.get(Number(itemId)).push(row);lots.push({remaining:q,unit:row.unitCost,row});
        }else if(t.side==='sell'||t.side==='transfer-out'||t.side==='consume-out'){
          let remain=q;const isSale=t.side==='sell',isConsume=t.side==='consume-out',net=isSale?Math.max(0,Number(t.netTotal??t.total)||0):0,saleUnit=isSale&&q?net/q:0;
          while(remain>1e-9&&lotHead<lots.length){const lot=lots[lotHead],take=Math.min(remain,lot.remaining);if(!(take>0)){lotHead++;continue;}const row=lot.row,at=Number(t.timestamp)||0;
            if(isSale){row.soldQty+=take;row.soldProceeds+=take*saleUnit;row.realizedCost+=take*lot.unit;row.realizedProfit=row.soldProceeds-row.realizedCost;row.saleCount++;if(!row.firstSoldAt||at<row.firstSoldAt)row.firstSoldAt=at;if(at>row.lastSoldAt)row.lastSoldAt=at;if(t.source)row._saleSources.add(String(t.source));}
            else if(isConsume){row.consumedQty+=take;if(at>row.lastConsumedAt)row.lastConsumedAt=at;}else{row.transferredQty+=take;if(at>row.lastTransferredAt)row.lastTransferredAt=at;}
            remain-=take;lot.remaining-=take;if(lot.remaining<=1e-9)lotHead++;
          }
        }
      }
    }
    for(const row of ledger){row.unsoldQty=Math.max(0,row.qty-row.soldQty-row.transferredQty-row.consumedQty);row.status=row.unsoldQty<=1e-9?(row.soldQty>=row.qty-1e-9?'sold':row.consumedQty>=row.qty-1e-9?'consumed':row.transferredQty>=row.qty-1e-9?'transferred':'depleted'):(row.soldQty>1e-9||row.transferredQty>1e-9||row.consumedQty>1e-9?'partial':'unsold');row.saleSources=[...row._saleSources];delete row._saleSources;}
    ledger.sort((a,b)=>b.acquiredAt-a.acquiredAt||String(b.id).localeCompare(String(a.id)));perfCache.ledgerTxRef=idx.txRef;perfCache.ledgerRows=ledger;perfCache.ledgerByItem=ledgerByItem;return ledger;
  }

  function ledgerRowsForItem(itemId) {
    acquisitionLedgerRows();return perfCache.ledgerByItem.get(Number(itemId))||[];
  }
  function acquisitionAttributedProfit(itemId,from,to) {
    let profit=0;for(const row of ledgerRowsForItem(itemId)){if(row.acquiredAt>=from&&row.acquiredAt<=to)profit+=Number(row.realizedProfit)||0;}return profit;
  }

  function ledgerRangeBounds() {
    const now=Date.now();
    if(state.ledgerRange==='7d')return {from:Math.floor((now-7*86400e3)/1000),to:Math.floor(now/1000)+60};
    if(state.ledgerRange==='14d')return {from:Math.floor((now-14*86400e3)/1000),to:Math.floor(now/1000)+60};
    if(state.ledgerRange==='30d')return {from:Math.floor((now-30*86400e3)/1000),to:Math.floor(now/1000)+60};
    if(state.ledgerRange==='dashboard')return dateRange();
    return {from:0,to:Number.MAX_SAFE_INTEGER};
  }

  function filteredLedgerRows() {
    const q=String(state.ledgerSearch||'').trim().toLowerCase(),source=String(state.ledgerSource||'all'),status=String(state.ledgerStatus||'all'),range=ledgerRangeBounds();
    const rows=acquisitionLedgerRows().filter(row=>{
      if(row.acquiredAt<range.from||row.acquiredAt>range.to)return false;
      if(source!=='all'&&row.method!==source)return false;
      if(status!=='all'&&row.status!==status)return false;
      if(q){const hay=`${row.itemName} ${row.itemId} ${row.method} ${row.source} ${row.title} ${(row.saleSources||[]).join(' ')}`.toLowerCase();if(!hay.includes(q))return false;}
      return true;
    });
    const key=String(state.ledgerSort||'acquiredAt'),dir=state.ledgerSortDir==='asc'?1:-1;
    rows.sort((a,b)=>{
      let av,bv;
      if(key==='item'){av=a.itemName.toLowerCase();bv=b.itemName.toLowerCase();}
      else if(key==='method'){av=a.method.toLowerCase();bv=b.method.toLowerCase();}
      else if(key==='status'){av=a.status;bv=b.status;}
      else{av=Number(a[key])||0;bv=Number(b[key])||0;}
      let d=typeof av==='string'?av.localeCompare(bv):av-bv;return d*dir||(b.acquiredAt-a.acquiredAt)||a.itemName.localeCompare(b.itemName);
    });
    return rows;
  }

  function ledgerSortArrow(key){return state.ledgerSort===key?(state.ledgerSortDir==='asc'?' \u2191':' \u2193'):'';}
  function ledgerMethodOptions(){return [...new Set(acquisitionLedgerRows().map(x=>x.method).filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
  function ledgerSummary(rows){return {lots:rows.length,qty:rows.reduce((n,x)=>n+x.qty,0),sold:rows.reduce((n,x)=>n+x.soldQty,0),profit:rows.reduce((n,x)=>n+x.realizedProfit,0)};}

  function ledgerRowHtml(row) {
    const saleWhen=row.lastSoldAt?dateTimeStr(row.lastSoldAt):'Not sold yet',saleSources=row.saleSources.length?row.saleSources.join(' \u00B7 '):'',transferText=row.transferredQty>0?` \u00B7 Sent ${qty(row.transferredQty)}${row.lastTransferredAt?` (${dateTimeStr(row.lastTransferredAt)})`:''}`:'',consumeText=row.consumedQty>0?` \u00B7 Used ${qty(row.consumedQty)}${row.lastConsumedAt?` (${dateTimeStr(row.lastConsumedAt)})`:''}`:'';
    const costText=row.free&&row.costTotal<=1e-7?'$0 \u00B7 Free':money(row.costTotal);
    const profitText=row.soldQty>0?money(row.realizedProfit):'\u2014';
    return `<tr><td><strong>${esc(dateTimeStr(row.acquiredAt))}</strong></td><td class="tta-ledgeritem"><strong>${esc(row.itemName)}</strong><small>#${row.itemId} \u00B7 ${esc(row.itemType)}</small></td><td class="num">${qty(row.qty)}</td><td class="tta-ledgermethod"><strong>${esc(row.method)}</strong><small>${esc(row.source||row.title||'Recorded acquisition')}</small></td><td class="num">${esc(costText)}<br><small>${row.qty?esc(money(row.unitCost))+'/ea':''}</small></td><td class="num">${qty(row.soldQty)} / ${qty(row.qty)}</td><td class="num">${row.soldQty?money(row.soldProceeds):'\u2014'}</td><td class="num ${row.realizedProfit>=0?'pos':'neg'}">${esc(profitText)}</td><td class="tta-ledgerstatus"><span class="tta-statuspill ${row.status}">${row.status==='sold'?'Sold':row.status==='transferred'?'Transferred':row.status==='consumed'?'Consumed':row.status==='depleted'?'Depleted':row.status==='partial'?'Partial':'Unsold'}</span><small>${esc(saleWhen)}${saleSources?` \u00B7 ${esc(saleSources)}`:''}${esc(transferText)}${esc(consumeText)}</small></td></tr>`;
  }

  function ledgerTableBodyHtml(rows) {
    const shown=rows.slice(0,Math.max(1,Number(state.ledgerLimit)||200));
    return shown.length?shown.map(ledgerRowHtml).join(''):'<tr><td colspan="9"><div class="tta-empty">No acquisition lots match the current filters.</div></td></tr>';
  }

  function renderLedgerRows() {
    if(state.view!=='ledger')return;
    const rows=filteredLedgerRows(),sum=ledgerSummary(rows),limit=Math.max(1,Number(state.ledgerLimit)||200),shown=Math.min(limit,rows.length);
    const body=document.getElementById('tta-ledger-body');if(body)body.innerHTML=ledgerTableBodyHtml(rows);
    const meta=document.getElementById('tta-ledger-meta');if(meta)meta.textContent=`Showing ${qty(shown)} of ${qty(rows.length)} acquisition lots`;
    const more=document.getElementById('tta-ledger-more');if(more)more.hidden=shown>=rows.length;
    const lots=document.getElementById('tta-ledger-lots');if(lots)lots.textContent=qty(sum.lots);
    const acquired=document.getElementById('tta-ledger-qty');if(acquired)acquired.textContent=qty(sum.qty);
    const sold=document.getElementById('tta-ledger-sold');if(sold)sold.textContent=qty(sum.sold);
    const profit=document.getElementById('tta-ledger-profit');if(profit){profit.textContent=money(sum.profit,true);profit.className=sum.profit>=0?'pos':'neg';}
    document.querySelectorAll('#tta-root [data-act="ledgerSort"]').forEach(btn=>{const key=btn.dataset.key;btn.classList.toggle('active',state.ledgerSort===key);btn.textContent=`${btn.dataset.label}${ledgerSortArrow(key)}`;});
    const clear=document.querySelector('#tta-root [data-act="clearLedgerSearch"]');if(clear)clear.hidden=!state.ledgerSearch;
  }

  function ledgerHtml() {
    const rows=filteredLedgerRows(),sum=ledgerSummary(rows),methods=ledgerMethodOptions(),limit=Math.max(1,Number(state.ledgerLimit)||200),shown=Math.min(limit,rows.length);
    const sortTh=(key,label)=>`<th><button data-act="ledgerSort" data-key="${key}" data-label="${esc(label)}" class="${state.ledgerSort===key?'active':''}">${esc(label)}${ledgerSortArrow(key)}</button></th>`;
    return `${header('Acquisition History','FIFO lot ledger \u00B7 cached acquisition and sale history',true)}<div class="tta-content">
      <div class="tta-ledgerintro"><div><strong>Acquisition ledger</strong><small>Each row is one recorded acquisition lot. Later sales are matched back to it using the same FIFO method as the dashboard. Realized profit is attributed to this acquisition date, not the later sale date.</small></div></div>
      <div class="tta-ledgerfilters"><div class="tta-searchwrap tta-ledgersearch"><span class="tta-searchglyph">\u2315</span><input id="tta-ledger-search" class="tta-history-search" placeholder="Search item, ID, source or sale method\u2026" value="${esc(state.ledgerSearch||'')}" autocomplete="off"><button class="tta-clearsearch" data-act="clearLedgerSearch" aria-label="Clear ledger search" ${state.ledgerSearch?'':'hidden'}>\u00D7</button></div><select data-ledger-filter="source"><option value="all">All acquisition types</option>${methods.map(x=>`<option value="${esc(x)}" ${state.ledgerSource===x?'selected':''}>${esc(x)}</option>`).join('')}</select><select data-ledger-filter="status"><option value="all" ${state.ledgerStatus==='all'?'selected':''}>All sale statuses</option><option value="sold" ${state.ledgerStatus==='sold'?'selected':''}>Sold</option><option value="partial" ${state.ledgerStatus==='partial'?'selected':''}>Partial</option><option value="unsold" ${state.ledgerStatus==='unsold'?'selected':''}>Unsold</option><option value="consumed" ${state.ledgerStatus==='consumed'?'selected':''}>Consumed</option><option value="depleted" ${state.ledgerStatus==='depleted'?'selected':''}>Depleted</option></select><select data-ledger-filter="range"><option value="all" ${state.ledgerRange==='all'?'selected':''}>All cached history</option><option value="7d" ${state.ledgerRange==='7d'?'selected':''}>Last 7 days</option><option value="14d" ${state.ledgerRange==='14d'?'selected':''}>Last 14 days</option><option value="30d" ${state.ledgerRange==='30d'?'selected':''}>Last 30 days</option><option value="dashboard" ${state.ledgerRange==='dashboard'?'selected':''}>Dashboard period</option></select></div>
      <div class="tta-ledgersummary"><div class="tta-ministat"><small>Acquisition lots</small><b id="tta-ledger-lots">${qty(sum.lots)}</b></div><div class="tta-ministat"><small>Items acquired</small><b id="tta-ledger-qty">${qty(sum.qty)}</b></div><div class="tta-ministat"><small>FIFO units sold</small><b id="tta-ledger-sold">${qty(sum.sold)}</b></div><div class="tta-ministat"><small>Realized profit</small><b id="tta-ledger-profit" class="${sum.profit>=0?'pos':'neg'}">${money(sum.profit,true)}</b></div></div>
      <div class="tta-ledgermeta"><span id="tta-ledger-meta">Showing ${qty(shown)} of ${qty(rows.length)} acquisition lots</span><span>Tap a column heading to sort</span></div>
      <div class="tta-ledgerwrap"><table class="tta-ledgertable"><thead><tr>${sortTh('acquiredAt','Date / time')}${sortTh('item','Item')}${sortTh('qty','Qty')}${sortTh('method','Acquired via')}${sortTh('costTotal','Bought for')}${sortTh('soldQty','Sold qty')}${sortTh('soldProceeds','Sold for')}${sortTh('realizedProfit','Profit')}${sortTh('status','Status')}</tr></thead><tbody id="tta-ledger-body">${ledgerTableBodyHtml(rows)}</tbody></table></div>
      <div class="tta-ledgermore"><button id="tta-ledger-more" class="tta-btn secondary" data-act="ledgerMore" ${shown>=rows.length?'hidden':''}>Load 200 more</button></div>
      <div class="tta-note">For free acquisitions such as crimes, gifts, finds and rewards, cost basis is $0. Player Trade acquisition/sale values use the analyzer's market-value allocation plus the equal cash surplus/deficit rule. A partially sold lot shows only realized proceeds/profit for the FIFO-matched quantity. Dashboard profit periods and charts use the acquisition date of each matched lot.</div>
    </div>`;
  }

  function summaryFor(itemId) {
    const id=Number(itemId),key=`${periodCacheKey()}|${id}`;
    if(perfCache.summaries.has(key))return perfCache.summaries.get(key);
    const {from,to}=dateRange(),a=fifoAnalytics(id),events=[];let bought=0,sold=0,buySpend=0,sellRevenue=0,profit=0,unmatched=0;const sources=new Set();
    for(const x of a.events){
      if(x.timestamp<from||x.timestamp>to)continue;
      events.push(x);
      if(x.side==='buy'){bought+=x.qty;buySpend+=x.total;if(x.source)sources.add(x.source);}
      else if(x.side==='sell'){sold+=x.qty;sellRevenue+=(x.netTotal??x.total);unmatched+=(x.unmatchedQty||0);}
    }
    profit=acquisitionAttributedProfit(id,from,to);
    const result={bought,sold,buySpend,sellRevenue,profit,sources:[...sources],unmatched,events,remainingQty:a.remainingQty,remainingCost:a.remainingCost};
    perfCache.summaries.set(key,result);return result;
  }

  function overall() {
    const key=periodCacheKey();if(perfCache.overall.has(key))return perfCache.overall.get(key);
    let profit=0,bought=0,sold=0,unmatched=0;
    for(const id of ensureTxIndex().itemIds){const x=summaryFor(id);profit+=x.profit;bought+=x.bought;sold+=x.sold;unmatched+=x.unmatched;}
    const result={profit,bought,sold,unmatched};perfCache.overall.set(key,result);return result;
  }

  function profitSeries(itemId=null) {
    const cacheKey=`${periodCacheKey()}|${state.granularity}|${itemId==null?'all':Number(itemId)}`;
    if(perfCache.series.has(cacheKey))return perfCache.series.get(cacheKey);
    const {from,to}=dateRange(),m=new Map(),rows=itemId==null?acquisitionLedgerRows():ledgerRowsForItem(Number(itemId));
    const keyFn=state.granularity==='week'?tctWeekStart:state.granularity==='month'?tctMonthStart:tctDayStart;
    for(const row of rows){
      if(row.acquiredAt<from||row.acquiredAt>to||row.soldQty<=0)continue;
      const k=keyFn(row.acquiredAt);m.set(k,(m.get(k)||0)+(Number(row.realizedProfit)||0));
    }
    const boundary=Math.min(to,Number(state.sync?.lastSync)||nowSec(),nowSec());
    if(boundary>=from){
      let start;
      if(state.dateMode==='all'){
        const existing=[...m.keys()].sort((a,b)=>a-b);
        start=existing.length?existing[0]:keyFn(boundary);
      }else start=keyFn(from);
      const end=keyFn(boundary);
      if(state.granularity==='month'){
        for(let k=start;k<=end;k=nextTctMonthStart(k))if(!m.has(k))m.set(k,0);
      }else{
        const step=state.granularity==='week'?7*86400:86400;
        for(let k=start;k<=end;k+=step)if(!m.has(k))m.set(k,0);
      }
    }
    const result=[...m.entries()].sort((a,b)=>a[0]-b[0]).map(([t,v])=>({t,v}));perfCache.series.set(cacheKey,result);return result;
  }

  function chartBucketLabel(ts) {
    const d=new Date((Number(ts)||0)*1000);
    if(state.granularity==='month')return d.toLocaleDateString(undefined,{timeZone:'UTC',month:'long',year:'numeric'});
    if(state.granularity==='week')return `Week of ${tctDateStr(ts)}`;
    return tctDateStr(ts);
  }
  function hideChartTooltip(wrap,force=false) {
    if(!wrap)return;const tip=wrap.querySelector('.tta-charttooltip');if(!tip)return;
    if(!force&&tip.dataset.pinned==='1')return;tip.classList.remove('show','pos','neg');tip.dataset.pinned='0';wrap.querySelectorAll('.tta-profitbar.active').forEach(x=>x.classList.remove('active'));
  }
  function showChartTooltip(bar,pinned=false) {
    const wrap=bar?.closest?.('.tta-chartinteractive'),tip=wrap?.querySelector('.tta-charttooltip');if(!wrap||!tip)return;
    wrap.querySelectorAll('.tta-profitbar.active').forEach(x=>x.classList.remove('active'));bar.classList.add('active');
    const value=Number(bar.dataset.profit)||0,ts=Number(bar.dataset.time)||0;
    tip.innerHTML=`<strong>${esc(money(value))}</strong><small>${esc(chartBucketLabel(ts))} \u00B7 acquisition date</small>`;
    tip.classList.remove('pos','neg');tip.classList.add(value>=0?'pos':'neg','show');tip.dataset.pinned=pinned?'1':'0';
    const wr=wrap.getBoundingClientRect(),br=bar.getBoundingClientRect();
    requestAnimationFrame(()=>{const tw=tip.offsetWidth||120;let left=br.left-wr.left+br.width/2;left=Math.max(tw/2+4,Math.min(wr.width-tw/2-4,left));tip.style.left=`${left}px`;tip.style.top='4px';});
  }

  function chartSvg(series, h=160) {
    if (!series.length) return '<div class="tta-empty">No realized sales profit in this period yet.</div>';
    const dayMode=state.granularity==='day',padL=52,padR=8,padT=10,padB=25;
    const w=dayMode?Math.max(360,padL+padR+series.length*30):360,innerW=w-padL-padR,innerH=h-padT-padB;
    let min=Math.min(0,...series.map(x=>x.v)),max=Math.max(0,...series.map(x=>x.v)); if(max===min){max+=1;min-=1}
    const y=v=>padT+(max-v)/(max-min)*innerH; const zero=y(0); const gap=innerW/series.length; const bw=Math.max(dayMode?12:5,Math.min(dayMode?20:22,gap*.62));
    const grid=[0,.25,.5,.75,1].map(p=>{const yy=padT+p*innerH;const val=max-p*(max-min);return `<line class="tta-grid" x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}"/><text class="tta-axis" x="3" y="${yy+3}">${esc(money(val,true))}</text>`}).join('');
    const bars=series.map((p,i)=>{const cx=padL+gap*i+gap/2;const yy=y(p.v);const top=Math.min(yy,zero);const bh=Math.max(2,Math.abs(zero-yy));const label=`${chartBucketLabel(p.t)}: ${money(p.v)}`;return `<rect class="tta-profitbar ${p.v>=0?'tta-bar-pos':'tta-bar-neg'}" data-profit="${Number(p.v)||0}" data-time="${Number(p.t)||0}" tabindex="0" role="button" aria-label="${esc(label)}" x="${cx-bw/2}" y="${top}" width="${bw}" height="${bh}" rx="2"><title>${esc(label)}</title></rect>`}).join('');
    const labelStride=dayMode?Math.max(1,Math.ceil(series.length/12)):Math.max(1,Math.ceil(series.length/6));
    const labels=series.map((p,i)=>{if(series.length>10 && i%labelStride!==0 && i!==series.length-1)return''; const d=new Date(p.t*1000);const lab=state.granularity==='month'?d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short'}):d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'});const x=padL+gap*i+gap/2;return `<text class="tta-axis" text-anchor="middle" x="${x}" y="${h-6}">${esc(lab)}</text>`}).join('');
    return `<div class="tta-chartinteractive ${dayMode?'day':''}" ${dayMode?`style="--tta-chart-width:${w}px"`:''}><div class="tta-charttooltip" role="status" aria-live="polite" data-pinned="0"></div><div class="tta-chartviewport"><svg class="tta-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Interactive profit chart; hover or tap a bar for exact profit">${grid}<line class="tta-zero" x1="${padL}" y1="${zero}" x2="${w-padR}" y2="${zero}"/>${bars}${labels}</svg></div></div>`;
  }

  function positionDailyChartsToLatest(scope=document) {
    requestAnimationFrame(()=>scope.querySelectorAll?.('.tta-chartinteractive.day .tta-chartviewport').forEach(v=>{if(v.dataset.positioned==='1')return;v.scrollLeft=Math.max(0,v.scrollWidth-v.clientWidth);v.dataset.positioned='1';}));
  }

  function itemIcon(item) {
    const fallback = '<span class="tta-thumbfallback" style="display:grid">\u25C7</span>';
    if (!item || !item.image) return `<div class="tta-thumbwrap">${fallback}</div>`;
    return `<div class="tta-thumbwrap"><img class="tta-thumb" src="${esc(item.image)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="tta-thumbfallback">\u25C7</span></div>`;
  }

  function header(title, sub, back=false) {
    return `<div class="tta-header">${back?'<button class="tta-back" data-act="back" aria-label="Back" title="Back">\u2039</button>':''}<div class="tta-brand"><div class="tta-mark" aria-hidden="true">\uD83D\uDCC8</div><div class="tta-brandcopy"><div class="tta-title">${esc(title)}${state.demo?'<span class="tta-demo">DEMO</span>':''}</div><div class="tta-sub">${esc(sub)}</div></div></div>${!back?'<button class="tta-iconbtn" data-act="help" aria-label="Help and guide" title="Help">?</button><button class="tta-iconbtn" data-act="settings" aria-label="Settings" title="Settings">\u2699</button>':''}<button class="tta-iconbtn" data-act="close" aria-label="Close cash flow analyzer" title="Close">\u00D7</button></div>`;
  }

  function pinnedCountFor(items) {
    const pins=new Set((state.pinnedIds||[]).map(Number));let n=0;for(const x of items)if(pins.has(Number(x.id)))n++;return n;
  }

  function itemListMetaText(rows,allItems) {
    return `${qty(rows.length)} in this period \u00B7 ${qty(allItems.length)} discovered total \u00B7 ${qty(pinnedCountFor(allItems))} pinned`;
  }

  function itemListHtml(rows,allItems) {
    if(rows.length)return rows.map(r=>itemCard(r.item,r.summary)).join('');
    if(state.itemSearch)return `<div class="tta-empty">No items match \u201C${esc(state.itemSearch)}\u201D in this period.</div>`;
    return `<div class="tta-empty">${allItems.length?'No item activity exists in the selected period. Try a longer period or Sync to backfill it.':'No item history has been discovered yet. Press Sync to scan your Torn logs.'}</div>`;
  }

  function renderItemList() {
    if(state.view!=='trade')return;
    const list=document.getElementById('tta-item-list');if(!list)return;
    const shell=document.querySelector('#tta-root .tta-shell'),scroll=shell?.scrollTop||0;
    const rows=historyItemRows(),allItems=effectiveTracked();
    list.innerHTML=itemListHtml(rows,allItems);
    const meta=document.getElementById('tta-list-meta');if(meta)meta.textContent=itemListMetaText(rows,allItems);
    const count=document.getElementById('tta-item-count');if(count)count.textContent=qty(rows.length);
    const sort=document.getElementById('tta-sort-btn');if(sort)sort.textContent=`\u21C5 ${sortLabel()}`;
    const clear=document.querySelector('[data-act="clearItemSearch"]');if(clear)clear.hidden=!state.itemSearch;
    if(shell)shell.scrollTop=scroll;positionDailyChartsToLatest(list);
  }

  function tradeHtml() {
    const s=overall(),rows=historyItemRows(),allItems=effectiveTracked(),range=dateRange();
    const requested=selectedPeriodBounds();
    const coverageFrom=Number(state.sync?.coverageFrom);
    const needsBackfill=hasApiKey()&&state.sync?.firstSyncComplete&&requested.from>0&&(!Number.isFinite(coverageFrom)||coverageFrom>requested.from);
    const periodLabel=state.dateMode==='all'?'All available history':`${dateStr(range.from)} \u2013 ${dateStr(Math.min(range.to,nowSec()))}`;
    const lastSync=state.sync?.lastSync?`Last sync ${new Date(state.sync.lastSync*1000).toLocaleString()}`:'Not synced yet';
    return `${header('Trade Analysis', `v${VERSION} \u00B7 FIFO item analytics`,true)}<div class="tta-content">
      ${!hasApiKey()?`<div class="tta-banner"><strong>Preview mode.</strong> Add your Torn API key in <strong>Settings \u2192 API Key</strong> (or use Torn PDA's injected key) to load your real history. The key and analyzed data stay on this device.</div>`:''}
      ${hasApiKey()&&!state.sync?.autoDiscoveryComplete?`<div class="tta-banner"><strong>History discovery:</strong> Run Sync once to discover recognizable acquisitions and sales for your selected period.</div>`:''}
      ${needsBackfill?`<div class="tta-banner"><strong>More history needed:</strong> This period starts ${esc(dateStr(requested.from))}, earlier than the local cache. Press <strong>Sync</strong> to backfill it.</div>`:''}
      <div class="tta-period"><div><small>Date period</small><strong>${esc(periodLabel)}</strong><span class="tta-periodhint">${esc(lastSync)} \u00B7 ${qty(state.transactions.length)} cached rows</span></div><div class="tta-syncactions"><button class="tta-btn" data-act="syncQuick" ${state.syncing?'disabled':''}>${state.syncing?'Syncing\u2026':'\u26A1 Quick Sync'}</button><button class="tta-btn secondary" data-act="syncFull" ${state.syncing?'disabled':''}>\u27F3 Full Resync</button></div></div>
      ${state.syncProgress?`<div class="tta-banner tta-status-banner"><span class="tta-status-dot"></span><span id="tta-sync-progress-text">${esc(state.syncProgress)}</span></div>`:''}
      <div class="tta-chips">${[['7d','7 days'],['14d','14 days'],['30d','30 days'],['all','All'],['custom','Custom']].map(([k,l])=>`<button class="tta-chip ${state.dateMode===k?'active':''}" data-date="${k}">${l}</button>`).join('')}</div>
      ${state.dateMode==='custom'?`<div class="tta-customdates"><input type="date" data-custom="from" value="${esc(state.customFrom)}"><input type="date" data-custom="to" value="${esc(state.customTo)}"></div>`:''}
      <div class="tta-summary"><div class="tta-stat main"><label>Profit \u00B7 acquisition date</label><b class="${s.profit>=0?'pos':'neg'}">${money(s.profit)}</b></div><div class="tta-stat"><label>Acquired</label><b>${qty(s.bought)}</b></div><div class="tta-stat"><label>Sold</label><b>${qty(s.sold)}</b></div></div>
      <div class="tta-chartcard"><div class="tta-charthead"><h3>Profit by acquisition date</h3><div class="tta-seg">${['day','week','month'].map(g=>`<button class="${state.granularity===g?'active':''}" data-gran="${g}">${g[0].toUpperCase()+g.slice(1)}</button>`).join('')}</div></div>${chartSvg(profitSeries())}</div>
      <div class="tta-sectionhead"><h3>Items in selected period \u00B7 <span id="tta-item-count">${qty(rows.length)}</span></h3><button class="tta-btn secondary" data-act="ledger">\u2637 Acquisition history</button></div>
      <div class="tta-listtools"><div class="tta-searchwrap"><span class="tta-searchglyph">\u2315</span><input id="tta-history-search" class="tta-history-search" placeholder="Search item name or ID\u2026" value="${esc(state.itemSearch||'')}" autocomplete="off" aria-label="Search discovered items"><button class="tta-clearsearch" data-act="clearItemSearch" aria-label="Clear search" ${state.itemSearch?'':'hidden'}>\u00D7</button></div><button id="tta-sort-btn" class="tta-btn secondary tta-sortbtn" data-act="cycleSort" title="Tap to change sorting">\u21C5 ${esc(sortLabel())}</button></div>
      <div id="tta-list-meta" class="tta-listmeta">${esc(itemListMetaText(rows,allItems))}</div>
      <div id="tta-item-list" class="tta-liststage">${itemListHtml(rows,allItems)}</div>
    </div>`;
  }

  function transactionItemDetail(t) {
    const id=Number(t?.itemId)||0,q=Math.max(0,Number(t?.qty)||0);if(!(id>0)||!(q>0))return '';
    return `${qty(q)} x ${catalogItem(id).name}`;
  }
  function compactTransactionItems(rows,side) {
    const labels=[...new Set((rows||[]).filter(t=>t?.side===side).map(transactionItemDetail).filter(Boolean))];
    if(!labels.length)return '';
    const shown=labels.slice(0,3);return `${shown.join(', ')}${labels.length>3?` +${labels.length-3} more`:''}`;
  }
  function playerTradeItemDetail(rows) {
    const gave=compactTransactionItems(rows,'sell'),received=compactTransactionItems(rows,'buy'),parts=[];
    if(gave)parts.push(`Gave ${gave}`);if(received)parts.push(`Received ${received}`);return parts.join(' \u00B7 ');
  }
  function flowDetailText(x) {
    const explicit=String(x?.detail||'').trim();if(explicit)return explicit;
    const id=Number(x?.itemId)||0,q=Math.max(0,Number(x?.qty)||0);return id>0&&q>0?`${qty(q)} x ${catalogItem(id).name}`:'';
  }
  function flowActivityLabel(x) {
    const base=String(x?.title||x?.category||'Financial activity'),detail=flowDetailText(x);return detail?`${base} \u00B7 ${detail}`:base;
  }
  function transactionCashFlows() {
    const out=[],transactions=state.transactions||[];
    for(const evt of effectivePlayerTradeEvents()){
      const tradeId=Number(evt.tradeId)||0,ts=Number(evt.timestamp)||0;if(!(tradeId>0&&ts>0))continue;
      const cashIn=Math.max(0,Number(evt.cashIn)||0),cashOut=Math.max(0,Number(evt.cashOut)||0),detail=playerTradeItemDetail(playerTradeEventRows(evt)),title=evt.counterpartyName?`Player Trade with ${evt.counterpartyName}`:`Player Trade #${tradeId}`;
      if(cashIn>0)out.push({id:`tradecash:${tradeId}:in`,timestamp:ts,direction:'in',amount:cashIn,category:'Player Trades',source:'Player Trade',title,detail,transfer:false,tradeId,counterpartyId:Number(evt.counterpartyId)||0,counterpartyName:String(evt.counterpartyName||'')});
      if(cashOut>0)out.push({id:`tradecash:${tradeId}:out`,timestamp:ts,direction:'out',amount:cashOut,category:'Player Trades',source:'Player Trade',title,detail,transfer:false,tradeId,counterpartyId:Number(evt.counterpartyId)||0,counterpartyName:String(evt.counterpartyName||'')});
    }
    for(const t of transactions){
      const ts=Number(t?.timestamp)||0;if(!(ts>0)||t.source==='Player Trade')continue;
      const total=Math.max(0,Number(t.total)||0),fee=Math.max(0,Number(t.fee)||0),itemId=Number(t.itemId)||0,itemName=itemId>0?catalogItem(itemId).name:'',itemQty=Math.max(0,Number(t.qty)||0),detail=transactionItemDetail(t);
      const common={transfer:false,itemId,itemName,qty:itemQty,detail};
      if(t.side==='buy'&&total>0)out.push({id:`txcash:${t.id}:buy`,timestamp:ts,direction:'out',amount:total,category:t.source==='Foreign Market'?'Travel Trading':'Item Purchases',source:t.source||'Item purchase',title:t.title||`${t.source||'Item'} purchase`,...common});
      if(t.side==='sell'&&total>0)out.push({id:`txcash:${t.id}:sell`,timestamp:ts,direction:'in',amount:total,category:'Item Sales',source:t.source||'Item sale',title:t.title||`${t.source||'Item'} sale`,...common});
      if(t.side==='sell'&&fee>0)out.push({id:`txcash:${t.id}:fee`,timestamp:ts,direction:'out',amount:fee,category:'Fees / Taxes',source:t.source||'Sale fee',title:`${t.title||'Item sale'} fee`,...common});
    }
    return out;
  }
  function allCashFlows() {
    const map=new Map();for(const x of state.cashFlows||[])if(x?.id)map.set(String(x.id),x);for(const x of transactionCashFlows())map.set(String(x.id),x);
    return [...map.values()].sort((a,b)=>(Number(b.timestamp)||0)-(Number(a.timestamp)||0));
  }
  function cashFlowBoundsToday() {const now=nowSec();return {from:tctDayStart(now),to:now};}
  function cashFlowSummary(from,to) {
    let earned=0,spent=0,transferIn=0,transferOut=0,count=0;const categories=new Map();
    for(const x of allCashFlows()){const ts=Number(x.timestamp)||0;if(ts<from||ts>to)continue;count++;const amount=Math.max(0,Number(x.amount)||0);let row=categories.get(x.category)||{category:x.category,earned:0,spent:0,transfers:0};
      if(x.direction==='in'){earned+=amount;row.earned+=amount;}else if(x.direction==='out'){spent+=amount;row.spent+=amount;}else if(x.direction==='transfer-in'){transferIn+=amount;row.transfers+=amount;}else if(x.direction==='transfer-out'){transferOut+=amount;row.transfers+=amount;}categories.set(x.category,row);}
    return {earned,spent,net:earned-spent,transferIn,transferOut,count,categories:[...categories.values()].sort((a,b)=>(b.earned+b.spent+b.transfers)-(a.earned+a.spent+a.transfers))};
  }
  function latestFinancialSnapshot(){return (state.financialSnapshots||[]).slice().sort((a,b)=>(Number(b.timestamp)||0)-(Number(a.timestamp)||0))[0]||null;}
  async function refreshFinancialSnapshot() {
    if(!hasApiKey())return null;const snap={timestamp:nowSec(),networth:null,money:null};
    try{const n=await apiGet('/user/networth');if(n?.networth){snap.networth=n.networth;snap.timestamp=Number(n.networth.timestamp)||snap.timestamp;}}catch(_){}
    try{const m=await apiGet('/user/money');if(m?.money)snap.money=m.money;}catch(_){}
    if(!snap.networth&&!snap.money)return null;
    const list=(state.financialSnapshots||[]).filter(x=>Math.abs((Number(x.timestamp)||0)-snap.timestamp)>300);list.push(snap);state.financialSnapshots=list.sort((a,b)=>a.timestamp-b.timestamp).slice(-180);save('financialSnapshots',state.financialSnapshots);return snap;
  }
  async function refreshCompanyDailyAdjustment(userId,serverNow=nowSec()) {
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
    const serverTs=Number(serverNow)||nowSec();
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
  }
  function sumNumeric(obj){return Object.values(obj||{}).reduce((n,v)=>n+(typeof v==='number'&&Number.isFinite(v)?v:0),0);}
  function analyzerPortfolio() {
    const rows=acquisitionLedgerRows();let acquiredCost=0,remainingCost=0,marketValue=0,realizedProfit=0,acquiredQty=0,remainingQty=0,transferredQty=0;const byMethod=new Map();
    for(const r of rows){const item=catalogItem(r.itemId),rem=Math.max(0,Number(r.unsoldQty)||0),mv=rem*Math.max(0,Number(item.marketPrice)||0);acquiredCost+=Number(r.costTotal)||0;remainingCost+=rem*(Number(r.unitCost)||0);marketValue+=mv;realizedProfit+=Number(r.realizedProfit)||0;acquiredQty+=Number(r.qty)||0;remainingQty+=rem;transferredQty+=Math.max(0,Number(r.transferredQty)||0);const m=byMethod.get(r.method)||{method:r.method,qty:0,cost:0,remaining:0,market:0,profit:0,transferred:0};m.qty+=Number(r.qty)||0;m.cost+=Number(r.costTotal)||0;m.remaining+=rem;m.market+=mv;m.profit+=Number(r.realizedProfit)||0;m.transferred+=Math.max(0,Number(r.transferredQty)||0);byMethod.set(r.method,m);}
    return {acquiredCost,remainingCost,marketValue,unrealized:marketValue-remainingCost,realizedProfit,acquiredQty,remainingQty,transferredQty,byMethod:[...byMethod.values()].sort((a,b)=>b.market-a.market||b.cost-a.cost)};
  }
  function periodChipsHtml(){return `<div class="tta-chips">${[['7d','7 days'],['14d','14 days'],['30d','30 days'],['all','All'],['custom','Custom']].map(([k,l])=>`<button class="tta-chip ${state.dateMode===k?'active':''}" data-date="${k}">${l}</button>`).join('')}</div>${state.dateMode==='custom'?`<div class="tta-customdates"><input type="date" data-custom="from" value="${esc(state.customFrom)}"><input type="date" data-custom="to" value="${esc(state.customTo)}"></div>`:''}`;}
  function financialNavHtml(){return `<section class="tta-feature-portal"><div class="tta-portal-head"><div><small>FEATURE PORTAL</small><h3>Open a financial workspace</h3></div><span>Choose a tool \u2192</span></div><div class="tta-fin-nav portal" aria-label="Financial tools"><button class="tta-toolcard" data-act="cashflow"><span class="tta-tool-icon">\u2195</span><span class="tta-toolcopy"><strong>Cash Flow</strong><small>Review recognized income, spending, categories and transaction details.</small><em>Open Cash Flow \u2192</em></span></button><button class="tta-toolcard" data-act="insights"><span class="tta-tool-icon">\u25EB</span><span class="tta-toolcopy"><strong>Insights & Goals</strong><small>Analyze spending, income sources, coverage gaps and financial targets.</small><em>Open Insights \u2192</em></span></button><button class="tta-toolcard" data-act="trade"><span class="tta-tool-icon">\u25A6</span><span class="tta-toolcopy"><strong>Trade Analysis</strong><small>Explore FIFO profit, acquisitions, sales and item history.</small><em>Open Trade Analysis \u2192</em></span></button><button class="tta-toolcard" data-act="networth"><span class="tta-tool-icon">\u25C7</span><span class="tta-toolcopy"><strong>Net Worth</strong><small>Inspect Torn wealth snapshots, daily changes and your recorded portfolio.</small><em>Open Net Worth \u2192</em></span></button></div></section>`;}
  function flowLegendHtml(){return `<div class="tta-flowlegend"><span class="in">+ Money in</span><span class="out">\u2212 Money out</span><span class="transfer">\u2194 Transfer</span></div>`;}
  function cashBreakdownHtml(summary,limit=8){const rows=summary.categories.slice(0,limit);return rows.length?`<div class="tta-breakdown">${rows.map(r=>`<div class="tta-breakrow"><span>${esc(r.category)}</span><b class="pos">${r.earned?money(r.earned,true):'\u2014'}</b><b class="neg secondary-value">${r.spent?money(r.spent,true):'\u2014'}</b></div>`).join('')}</div>`:'<div class="tta-empty">No recognized cash movements in this period yet.</div>';}
  function cashFlowRowsHtml(rows,limit=200){return rows.slice(0,limit).map(x=>{const detail=flowDetailText(x);return `<tr><td><span class="tta-flowtitle">${esc(x.title||x.category)}</span>${detail?`<span class="tta-flowmeta">${esc(detail)}</span>`:''}<span class="tta-flowmeta">${esc(tctDateTimeStr(x.timestamp))} TCT \u00B7 ${esc(x.source||x.category)}</span></td><td><span class="tta-flowbadge ${x.direction.startsWith('transfer')?'transfer':x.direction}">${x.direction.startsWith('transfer')?'Transfer':x.direction==='in'?'Incoming':'Outgoing'}</span></td><td>${esc(x.category)}</td><td class="num ${x.direction==='in'?'pos':x.direction==='out'?'neg':'tta-transfer'}">${x.direction==='in'?'+':x.direction==='out'?'-':'\u2194 '}${money(x.amount)}</td></tr>`;}).join('')||'<tr><td colspan="4"><div class="tta-empty">No recognized cash flows match this period.</div></td></tr>';}
  function dashboardHtml() {
    const today=cashFlowBoundsToday();
    const sum=cashFlowSummary(today.from,today.to);
    const snap=latestFinancialSnapshot();
    const portfolio=analyzerPortfolio();
    const nw=Number(snap?.networth?.total)||0;
    const todayRows=allCashFlows().filter(x=>x.timestamp>=today.from&&x.timestamp<=today.to);
    const recent=todayRows.slice(0,12);
    let apiBanner='';
    if(!hasApiKey())apiBanner='<div class="tta-banner"><strong>Preview mode.</strong> Add a Torn API key in Settings to build your financial ledger.</div>';
    let lastSync='Run Quick Sync to load today&#39;s movements';
    if(state.sync?.lastSync)lastSync='Last sync '+esc(tctDateTimeStr(state.sync.lastSync))+' TCT';
    let movementLabel=qty(todayRows.length)+' movement';
    if(todayRows.length!==1)movementLabel+='s';
    movementLabel+=' recorded today';
    let moreLabel='';
    if(todayRows.length>12)moreLabel='<div class="tta-morehint">Showing the latest 12 of '+qty(todayRows.length)+' movements from the current TCT day.</div>';
    const networthLabel=snap?.networth?money(nw):'Sync to load';
    const netClass=sum.net>=0?'pos':'neg';
    const profitClass=portfolio.realizedProfit>=0?'pos':'neg';
    const dashboardHeader=header('Cash Flow Analyzer','v'+VERSION+' \u00B7 clear financial overview');
    return `${dashboardHeader}<div class="tta-content tta-dashboard">${apiBanner}<div class="tta-period tta-dashboard-top"><div><small>Today \u00B7 Torn City Time</small><strong>${esc(tctDateStr(today.from))}</strong><span class="tta-periodhint">${lastSync}</span></div><div class="tta-syncactions"><button class="tta-btn" data-act="syncQuick" ${state.syncing?'disabled':''}>${state.syncing?'Syncing\u2026':'\u26A1 Quick Sync'}</button><button class="tta-btn secondary" data-act="syncFull" ${state.syncing?'disabled':''}>\u27F3 Full Resync</button></div></div><div class="tta-bento-grid"><section class="tta-bento tta-bento-hero"><small>Consolidated cash flow today</small><b class="tta-consolidated ${netClass}">${money(sum.net)}</b><div class="tta-equation"><span class="pos">+ ${money(sum.earned)}</span><span>\u2212</span><span class="neg">${money(sum.spent)}</span></div><p>Money in minus money out for the current TCT day.</p></section><section class="tta-bento"><small>Money in today</small><b class="pos">+ ${money(sum.earned)}</b></section><section class="tta-bento"><small>Money out today</small><b class="neg">\u2212 ${money(sum.spent)}</b></section></div>${financialNavHtml()}<div class="tta-sectionintro"><div><small>Snapshot</small><h3>Financial position</h3></div></div><div class="tta-position-grid"><section class="tta-bento"><small>Torn net worth</small><b>${networthLabel}</b></section><section class="tta-bento"><small>Recorded inventory value</small><b>${money(portfolio.marketValue)}</b></section><section class="tta-bento"><small>Realized trade profit</small><b class="${profitClass}">${money(portfolio.realizedProfit)}</b></section></div><section class="tta-glass-section"><div class="tta-sectionhead"><div><small>Current TCT day</small><h3>Today&#39;s cash movements</h3><span class="tta-sectionhint">${movementLabel}</span></div><button class="tta-btn secondary" data-act="cashflow">Open ledger</button></div><div class="tta-table-scroll"><table class="tta-flowtable"><tbody>${cashFlowRowsHtml(recent,12)}</tbody></table></div>${moreLabel}</section></div>`;
  }
  function cashFlowDateRange() {
    const serverNow=Math.min(Number(state.sync?.lastSync)||nowSec(),nowSec()),bounds=selectedPeriodBoundsTct(serverNow);let from=bounds.from,to=bounds.to;
    if(state.dateMode==='all'){from=Infinity;for(const x of allCashFlows()){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}if(!Number.isFinite(from))from=0;}
    return {from,to};
  }
  function cashFlowSeries() {
    const {from,to}=cashFlowDateRange(),keyFn=state.granularity==='week'?tctWeekStart:state.granularity==='month'?tctMonthStart:tctDayStart,m=new Map();
    for(const x of allCashFlows()){
      const ts=Number(x?.timestamp)||0;if(ts<from||ts>to)continue;
      if(x.direction!=='in'&&x.direction!=='out')continue;
      const k=keyFn(ts),row=m.get(k)||{t:k,moneyIn:0,moneyOut:0,net:0};
      const amount=Math.max(0,Number(x.amount)||0);if(x.direction==='in')row.moneyIn+=amount;else row.moneyOut+=amount;row.net=row.moneyIn-row.moneyOut;m.set(k,row);
    }
    if(!m.size)return[];
    let start=state.dateMode==='all'?Math.min(...m.keys()):keyFn(from),end=keyFn(to);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return[...m.values()].sort((a,b)=>a.t-b.t);
    if(state.granularity==='month'){
      for(let k=start;k<=end;k=nextTctMonthStart(k))if(!m.has(k))m.set(k,{t:k,moneyIn:0,moneyOut:0,net:0});
    }else{
      const step=state.granularity==='week'?7*86400:86400;for(let k=start;k<=end;k+=step)if(!m.has(k))m.set(k,{t:k,moneyIn:0,moneyOut:0,net:0});
    }
    return [...m.values()].sort((a,b)=>a.t-b.t);
  }
  function cashFlowBucketLabel(ts) {
    const d=new Date((Number(ts)||0)*1000);
    if(state.granularity==='month')return d.toLocaleDateString(undefined,{timeZone:'UTC',month:'long',year:'numeric'});
    if(state.granularity==='week')return `Week of ${tctDateStr(ts)}`;
    return tctDateStr(ts);
  }
  function showCashFlowTooltip(point,pinned=false) {
    const wrap=point?.closest?.('.tta-cash-chart'),tip=wrap?.querySelector('.tta-charttooltip');if(!wrap||!tip)return;
    wrap.querySelectorAll('.tta-cashpoint.active').forEach(x=>x.classList.remove('active'));point.classList.add('active');
    const incoming=Number(point.dataset.moneyIn)||0,outgoing=Number(point.dataset.moneyOut)||0,net=Number(point.dataset.net)||0,label=String(point.dataset.label||'Cash flow');
    tip.innerHTML=`<strong>${esc(label)}</strong><span class="pos">Money in: ${esc(money(incoming))}</span><span class="neg">Money out: ${esc(money(outgoing))}</span><span class="${net>=0?'pos':'neg'}">Net: ${esc(money(net))}</span>`;
    tip.classList.add('show','tta-cashtooltip');tip.dataset.pinned=pinned?'1':'0';
    const wr=wrap.getBoundingClientRect(),pr=point.getBoundingClientRect();
    requestAnimationFrame(()=>{const tw=tip.offsetWidth||170;let left=pr.left-wr.left+pr.width/2;left=Math.max(tw/2+4,Math.min(wr.width-tw/2-4,left));tip.style.left=`${left}px`;tip.style.top='4px';});
  }
  function hideCashFlowTooltip(wrap,force=false) {
    if(!wrap)return;const tip=wrap.querySelector('.tta-charttooltip');if(!tip)return;if(!force&&tip.dataset.pinned==='1')return;
    tip.classList.remove('show','tta-cashtooltip');tip.dataset.pinned='0';wrap.querySelectorAll('.tta-cashpoint.active').forEach(x=>x.classList.remove('active'));
  }
  function cashFlowChartSvg(series) {
    if(!series.length)return '<div class="tta-empty">No incoming or outgoing cash flow is recorded in this period yet.</div>';
    const h=214,axisW=56,padL=8,padR=10,padT=18,padB=28,gap=Math.max(24,Math.min(42,620/Math.max(1,series.length))),w=Math.max(334,Math.ceil(padL+padR+series.length*gap)),innerH=h-padT-padB;
    const peak=Math.max(1,...series.flatMap(x=>[Math.abs(Number(x.moneyIn)||0),Math.abs(Number(x.moneyOut)||0),Math.abs(Number(x.net)||0)])),max=peak*1.08,min=-max,y=v=>padT+(max-v)/(max-min)*innerH,zero=y(0);
    const x=i=>padL+gap*i+gap/2,pathFor=key=>series.map((r,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(key==='moneyOut'?-(Number(r[key])||0):(Number(r[key])||0)).toFixed(2)}`).join(' ');
    const ticks=[-1,-.5,0,.5,1];
    const grid=ticks.map(f=>{const yy=y(max*f);return `<line class="tta-grid" x1="0" y1="${yy}" x2="${w-padR}" y2="${yy}"/>`}).join('');
    const axis=ticks.map(f=>{const yy=y(max*f),v=max*f;return `<g><line class="tta-axis-tick" x1="${axisW-6}" y1="${yy}" x2="${axisW}" y2="${yy}"/><text class="tta-axis tta-cash-axis-label" text-anchor="end" x="${axisW-9}" y="${yy+3}">${esc(money(v,true))}</text></g>`}).join('');
    const labelStride=Math.max(1,Math.ceil(series.length/10)),labels=series.map((r,i)=>{if(series.length>10&&i%labelStride!==0&&i!==series.length-1)return'';const d=new Date(r.t*1000),lab=state.granularity==='month'?d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short'}):d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'});return `<text class="tta-axis" text-anchor="middle" x="${x(i)}" y="${h-7}">${esc(lab)}</text>`}).join('');
    const hits=series.map((r,i)=>{const left=padL+gap*i,label=cashFlowBucketLabel(r.t),aria=`${label}: money in ${money(r.moneyIn)}, money out ${money(r.moneyOut)}, net ${money(r.net)}`;return `<rect class="tta-cashpoint" x="${left}" y="${padT}" width="${gap}" height="${innerH}" tabindex="0" role="button" aria-label="${esc(aria)}" data-label="${esc(label)}" data-money-in="${Number(r.moneyIn)||0}" data-money-out="${Number(r.moneyOut)||0}" data-net="${Number(r.net)||0}"></rect>`}).join('');
    return `<div class="tta-chartinteractive tta-cash-chart ${state.granularity==='day'?'day':''}"><div class="tta-charttooltip" role="status" aria-live="polite" data-pinned="0"></div><div class="tta-cash-chartframe"><div class="tta-cash-axis-wrap" aria-hidden="true"><svg class="tta-cash-axis-svg" viewBox="0 0 ${axisW} ${h}" preserveAspectRatio="none">${axis}</svg></div><div class="tta-chartviewport"><svg class="tta-svg tta-cash-svg" viewBox="0 0 ${w} ${h}" style="min-width:${w}px" role="img" aria-label="Cash flow trend with a fixed money scale, money in above zero, money out below zero and net cash flow"><line class="tta-zero" x1="0" y1="${zero}" x2="${w-padR}" y2="${zero}"/>${grid}<path class="tta-cashline in" d="${pathFor('moneyIn')}"></path><path class="tta-cashline out" d="${pathFor('moneyOut')}"></path><path class="tta-cashline net" d="${pathFor('net')}"></path>${hits}${labels}</svg></div></div></div>`;
  }
  function cashFlowChartHtml() {
    const series=cashFlowSeries();
    return `<div class="tta-chartcard tta-cashflow-chartcard"><div class="tta-charthead"><div><h3>Cash flow over time</h3><small>Money out is plotted below zero \u00B7 tap or hover a period for exact values</small></div><div class="tta-seg">${['day','week','month'].map(g=>`<button class="${state.granularity===g?'active':''}" data-gran="${g}">${g[0].toUpperCase()+g.slice(1)}</button>`).join('')}</div></div><div class="tta-cashlegend"><span class="in">Money in</span><span class="out">Money out</span><span class="net">Net cash flow</span></div>${cashFlowChartSvg(series)}</div>`;
  }

  function cashFlowHtml() {
    const {from,to}=cashFlowDateRange(),sum=cashFlowSummary(from,to),q=String(state.cashSearch||'').trim().toLowerCase(),cat=String(state.cashCategory||'all');let rows=allCashFlows().filter(x=>x.timestamp>=from&&x.timestamp<=to);if(cat!=='all')rows=rows.filter(x=>x.category===cat);if(q)rows=rows.filter(x=>`${x.title} ${flowDetailText(x)} ${x.itemName||''} ${x.itemId||''} ${x.category} ${x.source} ${x.counterpartyName||''} ${x.counterpartyId||''}`.toLowerCase().includes(q));const cats=[...new Set(allCashFlows().map(x=>x.category))].sort();
    return `${header('Cash Flow','Every recognized incoming/outgoing money movement',true)}<div class="tta-content">${periodChipsHtml()}<div class="tta-cashhero"><div class="tta-cashcard"><small>Earned</small><b class="pos">${money(sum.earned)}</b></div><div class="tta-cashcard"><small>Spent</small><b class="neg">${money(sum.spent)}</b></div><div class="tta-cashcard main"><small>Net cash flow</small><b class="${sum.net>=0?'pos':'neg'}">${money(sum.net)}</b></div></div>${cashFlowChartHtml()}<div class="tta-fin-section"><h3>Category breakdown</h3>${cashBreakdownHtml(sum,20)}</div><div class="tta-listtools"><input id="tta-cash-search" class="tta-history-search" placeholder="Search cash flow\u2026" value="${esc(state.cashSearch||'')}"><select id="tta-cash-category" class="tta-history-search"><option value="all">All categories</option>${cats.map(c=>`<option value="${esc(c)}" ${cat===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div><div class="tta-ledgerwrap"><table class="tta-flowtable"><thead><tr><th>Event</th><th>Flow</th><th>Category</th><th style="text-align:right">Amount</th></tr></thead><tbody>${cashFlowRowsHtml(rows)}</tbody></table></div><div class="tta-note">Internal transfers remain visible but are excluded from earned/spent totals. Direct player-to-player money sent/received is counted as outgoing/incoming cash. Item gifts/transfers are tracked in Net Worth instead of Cash Flow. Item buys/sales come from the normalized trade ledger; Player Trade cash uses the actual cash exchanged, not the analyzer's allocated item valuation.</div></div>`;
  }
  function labeledKey(k){return String(k).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
  function moneyBreakdownHtml(obj){return Object.entries(obj||{}).map(([k,v])=>{if(typeof v==='object'&&v){const amount=Number(v.amount??v.money??0)||0;return `<div class="tta-fin-row"><span>${esc(labeledKey(k))}</span><b>${money(amount)}</b></div>`;}return typeof v==='number'?`<div class="tta-fin-row"><span>${esc(labeledKey(k))}</span><b>${money(v)}</b></div>`:'';}).join('');}

  function analysisRange() {return cashFlowDateRange();}
  function analyticsRows(direction) {const {from,to}=analysisRange();return allCashFlows().filter(x=>{const ts=Number(x.timestamp)||0;return ts>=from&&ts<=to&&!x.transfer&&!String(x.direction||'').startsWith('transfer')&&x.direction===direction;});}
  function analyticsSummary(direction) {
    const rows=analyticsRows(direction),total=rows.reduce((n,x)=>n+Math.max(0,Number(x.amount)||0),0),{from,to}=analysisRange(),days=Math.max(1,Math.ceil(Math.max(1,to-from)/86400)),cats=new Map();
    for(const x of rows)cats.set(x.category,(cats.get(x.category)||0)+Math.max(0,Number(x.amount)||0));
    const categories=[...cats.entries()].map(([category,amount])=>({category,amount,pct:total?amount/total*100:0})).sort((a,b)=>b.amount-a.amount),largest=rows.slice().sort((a,b)=>(Number(b.amount)||0)-(Number(a.amount)||0))[0]||null;
    let previous=null;if(state.dateMode!=='all'&&from>0&&to>from){const span=to-from,prev=cashFlowSummary(Math.max(0,from-span),Math.max(0,from-1));previous=direction==='in'?prev.earned:prev.spent;}
    return {rows,total,days,avg:total/days,categories,largest,previous,changePct:previous>0?(total-previous)/previous*100:null};
  }
  function categoryAnalyticsHtml(summary,kind) {if(!summary.categories.length)return '<div class="tta-empty">No recognized activity in this period.</div>';return `<div class="tta-analytics-bars">${summary.categories.slice(0,8).map(r=>`<div class="tta-analytics-row"><div class="tta-analytics-label"><span>${esc(r.category)}</span><b>${money(r.amount,true)}</b></div><div class="tta-analytics-track"><span style="width:${Math.max(2,Math.min(100,r.pct)).toFixed(1)}%"></span></div><small>${r.pct.toFixed(1)}% of ${kind}</small></div>`).join('')}</div>`;}
  function currentGoalValue(goal) {const snap=latestFinancialSnapshot();if(goal.type==='networth')return Number(snap?.networth?.total)||0;if(goal.type==='cash')return sumMoneyTree(snap?.money)||0;if(goal.type==='dailyIncome'){const d=cashFlowBoundsToday();return cashFlowSummary(d.from,d.to).earned;}return 0;}
  function goalTypeLabel(type){return type==='networth'?'Net worth':type==='cash'?'Accessible cash':'Daily income';}
  function goalsHtml() {const cards=(state.goals||[]).map(g=>{const current=currentGoalValue(g),target=Math.max(1,Number(g.target)||1),pct=Math.max(0,Math.min(100,current/target*100));return `<div class="tta-goal"><div class="tta-goal-head"><div><strong>${esc(g.label||goalTypeLabel(g.type))}</strong><small>${esc(goalTypeLabel(g.type))} target</small></div><button class="tta-iconbtn tta-goal-remove" data-act="removeGoal" data-id="${esc(g.id)}" title="Remove goal">\u00D7</button></div><div class="tta-goal-values"><b>${money(current)}</b><span>of ${money(target)}</span></div><div class="tta-goal-track"><span style="width:${pct.toFixed(1)}%"></span></div><small>${pct.toFixed(1)}% complete</small></div>`;}).join('');return `<div class="tta-goal-form"><input id="tta-goal-label" class="tta-history-search" placeholder="Goal name (optional)"><select id="tta-goal-type" class="tta-history-search"><option value="networth">Net worth target</option><option value="cash">Accessible cash target</option><option value="dailyIncome">Daily income target</option></select><input id="tta-goal-target" class="tta-history-search" type="number" min="1" inputmode="numeric" placeholder="Target amount"><button class="tta-btn" data-act="addGoal">Add goal</button></div><div class="tta-goal-list">${cards||'<div class="tta-empty">No goals yet. Add a target to track progress from your latest synced data.</div>'}</div>`;}
  function insightsHtml() {const spend=analyticsSummary('out'),income=analyticsSummary('in'),u=(state.unrecognizedFinancial||[]).slice(0,20),range=analysisRange(),rangeLabel=state.dateMode==='all'?'All cached history':`${tctDateStr(range.from)} \u2013 ${tctDateStr(range.to)}`;const largestSpend=spend.largest?`${flowActivityLabel(spend.largest)} \u00B7 ${money(spend.largest.amount)}`:'\u2014',largestIncome=income.largest?`${flowActivityLabel(income.largest)} \u00B7 ${money(income.largest.amount)}`:'\u2014';return `${header('Insights & Goals','Spending, income, coverage and targets',true)}<div class="tta-content">${periodChipsHtml()}<div class="tta-period"><div><small>Analytics period</small><strong>${esc(rangeLabel)}</strong></div></div><div class="tta-insight-grid"><section class="tta-fin-section"><div class="tta-sectionhead"><div><small>Expenses</small><h3>Spending analytics</h3></div></div><div class="tta-fin-grid"><div class="tta-stat"><label>Total spent</label><b class="neg">${money(spend.total)}</b></div><div class="tta-stat"><label>Average / day</label><b>${money(spend.avg)}</b></div><div class="tta-stat"><label>Largest expense</label><b title="${esc(largestSpend)}">${spend.largest?money(spend.largest.amount,true):'\u2014'}</b></div><div class="tta-stat"><label>vs previous period</label><b class="${spend.changePct==null?'':spend.changePct<=0?'pos':'neg'}">${spend.changePct==null?'\u2014':`${spend.changePct>=0?'+':''}${spend.changePct.toFixed(1)}%`}</b></div></div>${categoryAnalyticsHtml(spend,'spending')}<div class="tta-snapshot-note">Largest: ${esc(largestSpend)}</div></section><section class="tta-fin-section"><div class="tta-sectionhead"><div><small>Income</small><h3>Income analytics</h3></div></div><div class="tta-fin-grid"><div class="tta-stat"><label>Total income</label><b class="pos">${money(income.total)}</b></div><div class="tta-stat"><label>Average / day</label><b>${money(income.avg)}</b></div><div class="tta-stat"><label>Largest income</label><b title="${esc(largestIncome)}">${income.largest?money(income.largest.amount,true):'\u2014'}</b></div><div class="tta-stat"><label>vs previous period</label><b class="${income.changePct==null?'':income.changePct>=0?'pos':'neg'}">${income.changePct==null?'\u2014':`${income.changePct>=0?'+':''}${income.changePct.toFixed(1)}%`}</b></div></div>${categoryAnalyticsHtml(income,'income')}<div class="tta-snapshot-note">Largest: ${esc(largestIncome)}</div></section></div><section class="tta-fin-section"><div class="tta-sectionhead"><div><small>Coverage diagnostics</small><h3>Unrecognized financial events</h3></div><span class="tta-sectionhint">${qty(state.unrecognizedFinancial.length)} cached</span></div>${u.length?`<div class="tta-unmapped-list">${u.map(x=>`<div class="tta-unmapped"><div><strong>${esc(x.title)}</strong><small>${esc(tctDateTimeStr(x.timestamp))} TCT \u00B7 log ${x.logId} \u00B7 ${esc(x.field||'money field')}</small></div><b>${money(x.amount||0)}</b></div>`).join('')}</div>`:'<div class="tta-empty">No currently unrecognized money-bearing logs are cached.</div>'}<div class="tta-note">These events are excluded from totals until the analyzer can classify them safely. Only normalized diagnostic details are stored; raw Torn logs are not retained.</div></section><section class="tta-fin-section"><div class="tta-sectionhead"><div><small>Targets</small><h3>Financial goals</h3></div></div>${goalsHtml()}</section></div>`;}
  function sumMoneyTree(v){if(typeof v==='number'&&Number.isFinite(v))return v;if(Array.isArray(v))return v.reduce((n,x)=>n+sumMoneyTree(x),0);if(v&&typeof v==='object')return Object.values(v).reduce((n,x)=>n+sumMoneyTree(x),0);return 0;}
  function netWorthHistoryPoints(){const {from,to}=selectedPeriodBoundsTct(nowSec()),byDay=new Map();for(const s of state.financialSnapshots||[]){const ts=Number(s?.networth?.timestamp||s?.timestamp)||0,total=Number(s?.networth?.total);if(!(ts>0)||!Number.isFinite(total)||(state.dateMode!=='all'&&(ts<from||ts>to)))continue;const day=tctDayStart(ts),prev=byDay.get(day);if(!prev||ts>prev.ts)byDay.set(day,{ts,total});}return [...byDay.values()].sort((a,b)=>a.ts-b.ts);}
  function netWorthTimelineHtml(){const pts=netWorthHistoryPoints();if(pts.length<2)return '<div class="tta-empty">At least two daily net-worth snapshots are needed for the timeline.</div>';const w=360,h=150,padL=53,padR=8,padT=12,padB=24,min=Math.min(...pts.map(x=>x.total)),max=Math.max(...pts.map(x=>x.total)),span=Math.max(1,max-min),x=i=>padL+(w-padL-padR)*(pts.length===1?0:i/(pts.length-1)),y=v=>padT+(h-padT-padB)*(1-(v-min)/span),line=pts.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join(' ');return `<div class="tta-nw-chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Net worth history"><line class="tta-grid" x1="${padL}" y1="${padT}" x2="${padL}" y2="${h-padB}"/><line class="tta-grid" x1="${padL}" y1="${h-padB}" x2="${w-padR}" y2="${h-padB}"/><text class="tta-axis" x="2" y="${padT+4}">${esc(money(max,true))}</text><text class="tta-axis" x="2" y="${h-padB+4}">${esc(money(min,true))}</text><path class="tta-nw-line" d="${line}"/>${pts.map((p,i)=>`<circle class="tta-nw-point" cx="${x(i)}" cy="${y(p.total)}" r="2.4"><title>${esc(tctDateStr(p.ts))}: ${esc(money(p.total))}</title></circle>`).join('')}</svg><div class="tta-nw-chart-meta"><span>${esc(tctDateStr(pts[0].ts))}</span><b class="${pts[pts.length-1].total>=pts[0].total?'pos':'neg'}">${money(pts[pts.length-1].total-pts[0].total)}</b><span>${esc(tctDateStr(pts[pts.length-1].ts))}</span></div></div>`;}
  function assetAllocationHtml(nw){if(!nw)return '<div class="tta-empty">No Torn net-worth snapshot loaded.</div>';const groups=[['Money',sumMoneyTree(nw.money)],['Items',sumMoneyTree(nw.items)],['Points',Number(nw.points)||0],['Other assets',sumMoneyTree(nw.assets)]].filter(x=>x[1]>0),total=groups.reduce((n,x)=>n+x[1],0);return groups.length?`<div class="tta-allocation">${groups.map(([label,value])=>{const pct=total?value/total*100:0;return `<div class="tta-allocation-row"><div><span>${esc(label)}</span><b>${money(value,true)}</b></div><div class="tta-analytics-track"><span style="width:${Math.max(2,pct).toFixed(1)}%"></span></div><small>${pct.toFixed(1)}%</small></div>`;}).join('')}</div>`:'<div class="tta-empty">No positive asset categories are present in the latest snapshot.</div>';}
  function csvCell(v){const s=String(v??'');return /[",]/.test(s)||s.includes(String.fromCharCode(10))||s.includes(String.fromCharCode(13))?`"${s.replace(/"/g,'""')}"`:s;}
  function downloadTextFile(name,text,type='text/plain;charset=utf-8'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function backupPayload(){return {schema:1,app:'Torn Cash Flow Analyzer',version:VERSION,exportedAt:nowSec(),data:{transactions:state.transactions,cashFlows:state.cashFlows,playerTransfers:state.playerTransfers,playerTrades:state.playerTrades,itemConsumptions:state.itemConsumptions,unrecognizedFinancial:state.unrecognizedFinancial,financialSnapshots:state.financialSnapshots,goals:state.goals,tracked:state.tracked,pinnedIds:state.pinnedIds,hiddenIds:state.hiddenIds,sync:state.sync,dateMode:state.dateMode,customFrom:state.customFrom,customTo:state.customTo,granularity:state.granularity}};}
  function exportBackup(){downloadTextFile(`torn-cash-flow-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backupPayload(),null,2),'application/json;charset=utf-8');}
  function exportCashCsv(){const rows=allCashFlows(),head=['Timestamp TCT','Direction','Category','Title','Details','Source','Amount','Item ID','Quantity','Counterparty ID','Counterparty'];const body=rows.map(x=>[tctDateTimeStr(x.timestamp),x.direction,x.category,x.title,flowDetailText(x),x.source,x.amount,x.itemId||'',x.qty||'',x.counterpartyId||'',x.counterpartyName||'']);downloadTextFile(`torn-cash-flow-${new Date().toISOString().slice(0,10)}.csv`,[head,...body].map(r=>r.map(csvCell).join(',')).join(String.fromCharCode(10)),'text/csv;charset=utf-8');}
  function exportNetWorthCsv(){const head=['Timestamp TCT','Total','Money','Items','Points','Other assets'];const body=(state.financialSnapshots||[]).filter(x=>x?.networth).map(x=>{const n=x.networth;return [tctDateTimeStr(n.timestamp||x.timestamp),n.total,sumMoneyTree(n.money),sumMoneyTree(n.items),Number(n.points)||0,sumMoneyTree(n.assets)];});downloadTextFile(`torn-net-worth-${new Date().toISOString().slice(0,10)}.csv`,[head,...body].map(r=>r.map(csvCell).join(',')).join(String.fromCharCode(10)),'text/csv;charset=utf-8');}
  function importBackup(){const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.style.display='none';document.body.appendChild(input);input.addEventListener('change',()=>{const file=input.files?.[0];if(!file){input.remove();return;}const r=new FileReader();r.onload=()=>{try{const parsed=JSON.parse(String(r.result||'')),d=parsed?.data;if(!d||!Array.isArray(d.transactions)||!Array.isArray(d.cashFlows)||!Array.isArray(d.financialSnapshots))throw new Error('Invalid analyzer backup');const keys=['transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial','financialSnapshots','goals','tracked','pinnedIds','hiddenIds','sync','dateMode','customFrom','customTo','granularity'];for(const k of keys)if(d[k]!==undefined)localStorage.setItem(NS+k,JSON.stringify(d[k]));toast('Backup imported. Reloading analyzer\u2026');setTimeout(()=>location.reload(),450);}catch(e){toast(`Import failed: ${e.message}`);}finally{input.remove();}};r.readAsText(file);});input.click();}

  function tctInputDate(ts) { return new Date(tctDayStart(ts)*1000).toISOString().slice(0,10); }
  function tctDateInputStart(value) {
    const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return NaN;
    const ts=Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/1000);
    return Number.isFinite(ts)?ts:NaN;
  }
  function netWorthTrackingBounds() {
    const today=tctDayStart(nowSec()),stored=Number(state.netWorthTrackingStartedAt)||0;
    const snapshotStart=(state.financialSnapshots||[]).map(x=>Number(x?.networth?.timestamp||x?.timestamp)||0).filter(x=>x>0).sort((a,b)=>a-b)[0]||0;
    let first=tctDayStart(stored||snapshotStart||today);if(snapshotStart>0)first=Math.min(first,tctDayStart(snapshotStart));
    first=Math.min(today,Math.max(0,first));return {first,today};
  }
  function selectedNetWorthDay() {
    const bounds=netWorthTrackingBounds();let day=tctDateInputStart(state.netWorthDate);
    if(!Number.isFinite(day))day=bounds.today;day=Math.max(bounds.first,Math.min(bounds.today,tctDayStart(day)));
    const normalized=tctInputDate(day);if(state.netWorthDate!==normalized){state.netWorthDate=normalized;save('netWorthDate',normalized);}
    return {...bounds,dayStart:day,date:normalized};
  }

  function cashFlowNetWorthImpactKnown(x) {
    const text=`${x?.category||''} ${x?.title||''} ${x?.source||''}`.toLowerCase();
    if(/points market|point market/.test(text))return false;
    if(/stock|share/.test(text)&&!/(dividend|interest|payout)/.test(text))return false;
    if(/property/.test(text)&&/(buy|bought|purchase|sell|sold|sale)/.test(text))return false;
    if(/auction/.test(text)&&/(buy|bought|won|purchase|sell|sold|sale)/.test(text))return false;
    return true;
  }
  function flattenNetWorthLeaves(value,path='',out=new Map(),depth=0) {
    if(value==null||depth>8)return out;
    if(typeof value==='number'&&Number.isFinite(value)){if(!/(^|\.)(total|timestamp|parsetime|parse_time)$/i.test(path))out.set(path,value);return out;}
    if(Array.isArray(value)){value.forEach((v,i)=>flattenNetWorthLeaves(v,path?`${path}.${i}`:String(i),out,depth+1));return out;}
    if(typeof value==='object')for(const [k,v] of Object.entries(value)){const next=path?`${path}.${k}`:k;flattenNetWorthLeaves(v,next,out,depth+1);}return out;
  }
  function netWorthComponentChanges(first,last) {
    if(!first||!last)return[];const a=flattenNetWorthLeaves(first),b=flattenNetWorthLeaves(last),keys=new Set([...a.keys(),...b.keys()]),rows=[];
    for(const key of keys){const before=Number(a.get(key))||0,after=Number(b.get(key))||0,delta=after-before;if(Math.abs(delta)>=1)rows.push({key,before,after,delta});}
    return rows.sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta)||x.key.localeCompare(y.key));
  }
  function netWorthComponentLabel(path) {return String(path||'Other').split('.').filter(Boolean).map(x=>labeledKey(x)).join(' / ');}
  function dailyNetWorthActivity(dayStart=null) {
    const now=nowSec(),bounds=netWorthTrackingBounds(),selected=dayStart==null?selectedNetWorthDay().dayStart:tctDayStart(Number(dayStart)||bounds.today),from=Math.max(bounds.first,Math.min(bounds.today,selected)),to=from===bounds.today?now:from+86399;
    const snapshots=(state.financialSnapshots||[]).filter(x=>{const ts=Number(x?.networth?.timestamp||x?.timestamp)||0;return ts>=from&&ts<=to&&x?.networth;}).slice().sort((a,b)=>(Number(a?.networth?.timestamp||a?.timestamp)||0)-(Number(b?.networth?.timestamp||b?.timestamp)||0));
    const before=(state.financialSnapshots||[]).filter(x=>x?.networth&&(Number(x?.networth?.timestamp||x?.timestamp)||0)<from).slice().sort((a,b)=>(Number(b?.networth?.timestamp||b?.timestamp)||0)-(Number(a?.networth?.timestamp||a?.timestamp)||0))[0]||null;
    const latest=snapshots[snapshots.length-1]||null,baseline=snapshots.length>=2?snapshots[0]:null;
    const latestTotal=Number(latest?.networth?.total),baselineTotal=Number(baseline?.networth?.total);const delta=Number.isFinite(latestTotal)&&Number.isFinite(baselineTotal)&&latest!==baseline?latestTotal-baselineTotal:null,rows=[];let companyNet=0,companySeen=false;
    for(const t of state.transactions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to||Number(t?.logId)===4103||t?.source==='Player Trade')continue;const item=catalogItem(t.itemId),q=Math.max(0,Number(t.qty)||0);if(!(q>0))continue;if(t.side==='buy'){const cost=Math.max(0,Number(t.total)||0),market=q*Math.max(0,Number(item.marketPrice)||0),free=!!t.free,marketKnown=market>0,impact=free?(marketKnown?market:0):(marketKnown?market-cost:0),impactKnown=free?marketKnown:marketKnown,costLabel=t.source==='Player Trade'?'Allocated trade cash':'Cash paid',impactMeta=impactKnown?` \u00B7 Est. net-worth impact ${impact>=0?'+':''}${money(impact)}`:' \u00B7 Net-worth impact unavailable (no item market value)';rows.push({timestamp:ts,kind:'item-in',icon:'\uFF0B',title:`${free?'Acquired':'Bought'} ${qty(q)} \u00D7 ${item.name}`,meta:`${t.source||'Item acquisition'} \u00B7 ${free?'Free / $0 cost':`${costLabel} -${money(cost)}`}${marketKnown?` \u00B7 Item value +${money(market)}`:''}${impactMeta}`,value:impactKnown?Math.abs(impact):0,valueClass:impactKnown?(impact>=0?'pos':'neg'):'',prefix:impactKnown?(impact>=0?'+':'-'):'',impact:impactKnown?impact:null,impactKnown});}else if(t.side==='sell'){const proceeds=Math.max(0,Number(t.netTotal??t.total)||0),market=q*Math.max(0,Number(item.marketPrice)||0),marketKnown=market>0,impact=marketKnown?proceeds-market:0,evt=(fifoAnalytics(t.itemId).events||[]).find(e=>String(e.id)===String(t.id)),profit=Number(evt?.realizedProfit),profitKnown=Number.isFinite(profit),impactMeta=marketKnown?` \u00B7 Est. net-worth impact ${impact>=0?'+':''}${money(impact)}`:' \u00B7 Net-worth impact unavailable (no item market value)';rows.push({timestamp:ts,kind:'item-sale',icon:'\u2197',title:`Sold ${qty(q)} \u00D7 ${item.name}`,meta:`${t.source||'Item sale'} \u00B7 Cash received +${money(proceeds)}${marketKnown?` \u00B7 Item value removed -${money(market)}`:''}${impactMeta}${profitKnown?` \u00B7 FIFO trade ${profit>=0?'profit':'loss'} ${money(Math.abs(profit))}`:' \u00B7 FIFO profit/loss unavailable'}`,value:marketKnown?Math.abs(impact):0,valueClass:marketKnown?(impact>=0?'pos':'neg'):'',prefix:marketKnown?(impact>=0?'+':'-'):'',impact:marketKnown?impact:null,impactKnown:marketKnown});}}
    for(const evt of effectivePlayerTradeEvents()){
      const ts=Number(evt?.timestamp)||0;if(ts<from||ts>to)continue;const incoming=evt.incomingItems||[],outgoing=evt.outgoingItems||[],cashIn=Math.max(0,Number(evt.cashIn)||0),cashOut=Math.max(0,Number(evt.cashOut)||0);
      let itemInValue=0,itemOutValue=0,missingValue=false;for(const x of incoming){const q=Math.max(0,Number(x.qty)||0),v=q*Math.max(0,Number(catalogItem(x.itemId).marketPrice)||0);if(q>0&&!(v>0))missingValue=true;itemInValue+=v;}for(const x of outgoing){const q=Math.max(0,Number(x.qty)||0),v=q*Math.max(0,Number(catalogItem(x.itemId).marketPrice)||0);if(q>0&&!(v>0))missingValue=true;itemOutValue+=v;}
      const impactKnown=!missingValue,impact=cashIn-cashOut+itemInValue-itemOutValue,detail=playerTradeItemDetail(playerTradeEventRows(evt)),who=evt.counterpartyName||((Number(evt.counterpartyId)||0)>0?`#${evt.counterpartyId}`:`#${evt.tradeId}`),metaParts=[];
      if(cashIn>0)metaParts.push(`Cash received +${money(cashIn)}`);if(cashOut>0)metaParts.push(`Cash given -${money(cashOut)}`);if(itemInValue>0)metaParts.push(`Items received +${money(itemInValue)}`);if(itemOutValue>0)metaParts.push(`Items given -${money(itemOutValue)}`);if(detail)metaParts.push(detail);metaParts.push(impactKnown?`Est. net-worth impact ${impact>=0?'+':''}${money(impact)}`:'Net-worth impact unavailable because at least one traded item has no market value');
      rows.push({timestamp:ts,kind:'player-trade',icon:'\u21C4',title:`Player Trade with ${who}`,meta:metaParts.join(' \u00B7 '),value:impactKnown?Math.abs(impact):0,valueClass:impactKnown?(impact>=0?'pos':'neg'):'',prefix:impactKnown?(impact>=0?'+':'-'):'',impact:impactKnown?impact:null,impactKnown});
    }
    for(const t of state.playerTransfers||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to||t?.type!=='item')continue;const item=catalogItem(t.itemId),q=Math.max(0,Number(t.qty)||0),market=q*Math.max(0,Number(item.marketPrice)||0),incoming=t.direction==='in',who=t.counterpartyName||((Number(t.counterpartyId)||0)>0?`#${t.counterpartyId}`:'another player'),impactKnown=market>0,impact=impactKnown?(incoming?market:-market):0;rows.push({timestamp:ts,kind:incoming?'player-item-in':'player-item-out',icon:incoming?'\u21E3':'\u21E1',title:`${incoming?'Received':'Sent'} ${qty(q)} \u00D7 ${item.name}`,meta:`Player transfer ${incoming?'from':'to'} ${who}${t.message?` \u00B7 ${t.message}`:''}${market?` \u00B7 Est. value ${money(market)}`:' \u00B7 Net-worth impact unavailable (no item market value)'}`,value:impactKnown?market:0,valueClass:impactKnown?(incoming?'pos':'neg'):'',prefix:impactKnown?(incoming?'+':'-'):'',impact:impactKnown?impact:null,impactKnown});}
    const consumptionGroups=new Map();
    for(const t of state.itemConsumptions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to)continue;const itemId=Number(t?.itemId)||0,q=Math.max(0,Number(t?.qty)||0);if(!(itemId>0&&q>0))continue;const item=catalogItem(itemId),market=q*Math.max(0,Number(item.marketPrice)||0),evt=(fifoAnalytics(itemId).events||[]).find(e=>String(e.id)===`consume:${t.id}`),basis=Math.max(0,Number(evt?.costBasis)||0),minute=Math.floor(ts/60),useTitle=String(t?.title||'Item use'),key=`${itemId}|${useTitle}|${minute}`;let g=consumptionGroups.get(key);if(!g){g={timestamp:ts,itemId,itemName:item.name,title:useTitle,qty:0,market:0,basis:0,count:0};consumptionGroups.set(key,g);}g.timestamp=Math.min(g.timestamp,ts);g.qty+=q;g.market+=market;g.basis+=basis;g.count++;}
    for(const g of consumptionGroups.values()){const impactValue=g.market||g.basis,impact=impactValue>0?-impactValue:0,impactKnown=impactValue>0;rows.push({timestamp:g.timestamp,kind:'item-consumed',icon:'\u2212',title:`Used ${qty(g.qty)} \u00D7 ${g.itemName}`,meta:`${g.title}${g.count>1?` \u00B7 ${qty(g.count)} use logs combined`:''}${g.market?` \u00B7 Est. value removed ${money(g.market)}`:''}${g.basis?` \u00B7 FIFO cost basis removed ${money(g.basis)}`:''}${!g.market&&g.basis?' \u00B7 Using FIFO cost basis as value fallback':''}`,value:impactKnown?impactValue:0,valueClass:impactKnown?'neg':'',prefix:impactKnown?'-':'',impact:impactKnown?impact:null,impactKnown});}
    for(const x of state.cashFlows||[]){const ts=Number(x?.timestamp)||0;if(ts<from||ts>to||x?.transfer||String(x?.direction||'').startsWith('transfer')||isNonCashCompanyAdminLog(x?.title))continue;const amount=Math.max(0,Number(x?.amount)||0);if(!(amount>0))continue;const incoming=x.direction==='in',impact=incoming?amount:-amount,isCompany=x.category==='Company Profit / Loss'||x.source==='Company Daily Adjustment',impactKnown=isCompany||cashFlowNetWorthImpactKnown(x);if(isCompany){companySeen=true;companyNet+=impact;}const companyMeta=isCompany?`Company daily adjustment \u00B7 Gross ${money(x.grossIncome)} \u00B7 Wages ${money(x.wages)} \u00B7 Advertising ${money(x.advertisementBudget)}`:`${x.category||'Cash'} \u00B7 ${x.source||'Torn Log'}${impactKnown?'':' \u00B7 Cash side shown; counterpart asset value is not safely known'}`;rows.push({timestamp:ts,kind:isCompany?'company-pl':(incoming?'money-in':'money-out'),icon:isCompany?'\u25A3':(incoming?'\u2191':'\u2193'),title:x.title||x.category||(incoming?'Money received':'Money spent'),meta:companyMeta,value:impactKnown?amount:0,valueClass:impactKnown?(incoming?'pos':'neg'):'',prefix:impactKnown?(incoming?'+':'-'):'',impact:impactKnown?impact:null,impactKnown});}
    const valuedRows=rows.filter(x=>x.impactKnown!==false&&Number.isFinite(Number(x.impact))),detectedNet=valuedRows.reduce((n,x)=>n+Number(x.impact),0),unvaluedEvents=rows.length-valuedRows.length;const componentChanges=baseline&&latest?netWorthComponentChanges(baseline.networth,latest.networth):[];rows.sort((a,b)=>b.timestamp-a.timestamp||String(a.title).localeCompare(String(b.title)));return {from,to,snapshots,before,latest,baseline,delta,rows,companyNet:companySeen?companyNet:null,detectedNet,valuedEvents:valuedRows.length,unvaluedEvents,componentChanges};
  }
  function dailyNetWorthChangesHtml() {
    const selection=selectedNetWorthDay(),d=dailyNetWorthActivity(selection.dayStart),baselineTs=Number(d.baseline?.networth?.timestamp||d.baseline?.timestamp)||0,latestTs=Number(d.latest?.networth?.timestamp||d.latest?.timestamp)||0,isToday=d.from===selection.today;
    const deltaText=d.delta==null?'Waiting for comparable snapshots':`${d.delta>=0?'+':''}${money(d.delta)}`;
    const deltaClass=d.delta==null?'':d.delta>=0?'pos':'neg';
    const baselineText=!d.latest?`No stored net-worth snapshot for ${tctDateStr(d.from)}`:d.delta==null?`Only one Torn snapshot this day \u00B7 ${tctDateTimeStr(latestTs)} TCT \u00B7 sync again later for a within-day snapshot movement`:`From first snapshot ${tctDateTimeStr(baselineTs)} to latest ${tctDateTimeStr(latestTs)} TCT`;
    const companyText=d.companyNet==null?'No recorded company P/L':`${d.companyNet>=0?'+':''}${money(d.companyNet)}`;
    const companyClass=d.companyNet==null?'':d.companyNet>=0?'pos':'neg';
    const detectedText=`${d.detectedNet>=0?'+':''}${money(d.detectedNet)}`,detectedClass=d.detectedNet>=0?'pos':'neg',gap=d.delta==null?null:d.delta-d.detectedNet,gapText=gap==null?'Waiting for comparable Torn snapshots':`${gap>=0?'+':''}${money(gap)} difference vs Torn snapshot`;
    const componentHtml=(d.componentChanges||[]).length?`<div class="tta-fin-section"><div class="tta-sectionhead"><div><small>Torn snapshot components</small><h3>What changed between stored snapshots</h3></div><span class="tta-sectionhint">${qty(d.componentChanges.length)} changed</span></div><div class="tta-breakdown">${d.componentChanges.slice(0,12).map(c=>`<div class="tta-fin-row"><span>${esc(netWorthComponentLabel(c.key))}</span><b class="${c.delta>=0?'pos':'neg'}">${c.delta>=0?'+':''}${money(c.delta)}</b></div>`).join('')}</div>${d.componentChanges.length>12?`<div class="tta-morehint">Showing the 12 largest component movements.</div>`:''}</div>`:'';
    const rows=d.rows.slice(0,20).map(x=>`<div class="tta-nw-change"><div class="tta-nw-change-icon">${esc(x.icon)}</div><div class="tta-nw-change-copy"><strong>${esc(x.title)}</strong><small>${esc(tctDateTimeStr(x.timestamp))} TCT \u00B7 ${esc(x.meta)}</small></div><div class="tta-nw-change-value ${x.valueClass||''}">${x.impactKnown===false?'\u2014':`${x.prefix||''}${money(x.value||0)}`}</div></div>`).join('');
    return `<section class="tta-fin-section tta-nw-daily"><div class="tta-sectionhead"><div><small>${isToday?'Current':'Selected'} TCT day</small><h3>${esc(tctDateStr(d.from))} net-worth changes</h3></div><span class="tta-sectionhint">${qty(d.rows.length)} detected event${d.rows.length===1?'':'s'}</span></div><div class="tta-nw-daypicker"><label><span>View TCT date</span><input id="tta-networth-date" type="date" min="${tctInputDate(selection.first)}" max="${tctInputDate(selection.today)}" value="${esc(selection.date)}"></label><div class="tta-nw-dayrange">Available from <b>${esc(tctDateStr(selection.first))}</b>, when local Net Worth tracking began.</div><button class="tta-btn secondary" data-act="netWorthToday" ${isToday?'disabled':''}>Today</button></div><div class="tta-nw-daily-metrics"><div class="tta-nw-delta"><div><small>Analyzer-detected movement</small><b class="${detectedClass}">${esc(detectedText)}</b></div><span>${qty(d.valuedEvents)} valued event${d.valuedEvents===1?'':'s'}${d.unvaluedEvents?` \u00B7 ${qty(d.unvaluedEvents)} without market value`:''} \u00B7 ${esc(gapText)}</span></div><div class="tta-nw-company-delta"><small>Torn snapshot movement within selected day</small><b class="${deltaClass}">${esc(deltaText)}</b><span>${esc(baselineText)}</span></div><div class="tta-nw-company-delta"><small>Recorded company profit / loss</small><b class="${companyClass}">${esc(companyText)}</b><span>${d.companyNet==null?'No company adjustment was recorded for this TCT day.':'Included in analyzer-detected movement at the recorded 18:00 TCT company cycle.'}</span></div></div>${componentHtml}<div class="tta-nw-change-list">${rows||`<div class="tta-empty">No item acquisitions, player transfers, sales, cash events or company P/L have been detected for ${esc(tctDateStr(d.from))}.</div>`}</div>${d.rows.length>20?`<div class="tta-morehint">Showing the latest 20 of ${qty(d.rows.length)} detected events for this TCT day.</div>`:''}<div class="tta-nw-disclaimer">Analyzer-detected movement is the signed sum of valued events shown for this TCT day. Paid item buys include cash paid minus the estimated item value gained; item sales include cash received minus the estimated item value removed. Torn snapshot movement is shown only when at least two stored /user/networth snapshots exist inside the selected TCT day, so a previous-day snapshot is never mislabeled as today's movement. Item values use the analyzer's current Torn catalog price, so repricing, unrecognized assets, snapshot timing and Torn's own valuation rules can still create a difference. Company P/L is included when recorded. Player Trades use actual trade cash plus current catalog values of items received/given. Administrative company wage-setting logs are excluded because they do not move the director's personal wealth. Snapshot component changes provide the authoritative fallback for Torn net-worth categories that cannot be safely attributed to a specific log.</div></section>`;
  }
  function netWorthHtml() {
    const snap=latestFinancialSnapshot(),nw=snap?.networth,portfolio=analyzerPortfolio(),all=cashFlowSummary(0,Number.MAX_SAFE_INTEGER);const itemTotal=nw?sumNumeric(nw.items):0,assetTotal=nw?sumNumeric(nw.assets):0;
    return `${header('Net Worth','Torn snapshot + analyzer acquisition portfolio',true)}<div class="tta-content">${periodChipsHtml()}<div class="tta-fin-section"><div class="tta-stat main"><label>Torn-reported total net worth</label><b class="tta-networth-total">${nw?money(nw.total):'No snapshot yet'}</b></div><div class="tta-snapshot-note">${nw?`Snapshot: ${esc(tctDateTimeStr(nw.timestamp||snap.timestamp))} TCT. Torn currently marks API v2 networth as unstable, so this page keeps the snapshot visually separate from analyzer-calculated history.`:'Run Sync to request /user/networth and /user/money.'}</div></div>${dailyNetWorthChangesHtml()}<div class="tta-fin-section"><div class="tta-sectionhead"><div><small>History</small><h3>Net-worth timeline</h3></div><span class="tta-sectionhint">Daily latest snapshots</span></div>${netWorthTimelineHtml()}</div><div class="tta-fin-section"><div class="tta-sectionhead"><div><small>Latest snapshot</small><h3>Asset allocation</h3></div></div>${assetAllocationHtml(nw)}</div><div class="tta-cashhero"><div class="tta-cashcard"><small>Torn item holdings</small><b>${nw?money(itemTotal):'\u2014'}</b></div><div class="tta-cashcard"><small>Torn assets</small><b>${nw?money(assetTotal):'\u2014'}</b></div><div class="tta-cashcard main"><small>Points value</small><b>${nw?money(nw.points):'\u2014'}</b></div></div><div class="tta-fin-section"><h3>Current wealth locations \u00B7 stable /user/money</h3>${snap?.money?moneyBreakdownHtml(snap.money):'<div class="tta-empty">No current wealth snapshot loaded.</div>'}<div class="tta-snapshot-note">This section uses Torn's stable current-wealth endpoint and is kept separate from income/spending history.</div></div><div class="tta-fin-section"><h3>Net-worth money locations / liabilities</h3>${nw?moneyBreakdownHtml(nw.money):'<div class="tta-empty">No Torn net-worth snapshot loaded.</div>'}</div><div class="tta-fin-section"><h3>Items by current Torn location</h3>${nw?moneyBreakdownHtml(nw.items):''}</div><div class="tta-fin-section"><h3>Other assets</h3>${nw?moneyBreakdownHtml(nw.assets):''}</div><div class="tta-fin-section"><h3>Analyzer item portfolio</h3><div class="tta-fin-grid"><div class="tta-stat"><label>Historical acquisition cost</label><b>${money(portfolio.acquiredCost)}</b></div><div class="tta-stat"><label>Recorded remaining cost basis</label><b>${money(portfolio.remainingCost)}</b></div><div class="tta-stat"><label>Recorded remaining market value</label><b>${money(portfolio.marketValue)}</b></div><div class="tta-stat"><label>Unrealized gain / loss</label><b class="${portfolio.unrealized>=0?'pos':'neg'}">${money(portfolio.unrealized)}</b></div><div class="tta-stat"><label>Realized FIFO profit</label><b class="${portfolio.realizedProfit>=0?'pos':'neg'}">${money(portfolio.realizedProfit)}</b></div><div class="tta-stat"><label>All recognized cash-flow net</label><b class="${all.net>=0?'pos':'neg'}">${money(all.net)}</b></div></div></div><div class="tta-fin-section"><h3>Items acquired by method</h3><div class="tta-breakdown">${portfolio.byMethod.map(r=>`<div class="tta-breakrow"><span>${esc(r.method)} \u00B7 ${qty(r.qty)} acquired \u00B7 ${qty(r.remaining)} remaining</span><b>${money(r.market,true)}</b><b class="${r.profit>=0?'pos':'neg'} secondary-value">${money(r.profit,true)}</b></div>`).join('')||'<div class="tta-empty">No acquisition history yet.</div>'}</div><div class="tta-snapshot-note">Market values here use the analyzer's current Torn item catalog price \u00D7 analyzer-recorded remaining quantity. Direct items sent to other players and items used/consumed consume the oldest available FIFO lots, reducing inventory/cost basis without creating item-sale profit. They are an accounting view, not a replacement for Torn's official net-worth total.</div></div><div class="tta-settings-actions"><button class="tta-btn secondary" data-act="refreshFinancial">Refresh financial snapshot</button><button class="tta-btn secondary" data-act="trade">Open Trade Analysis</button></div></div>`;
  }

  function itemCard(item,precomputed=null) {
    const s=precomputed||summaryFor(item.id),exp=Number(state.expanded)===Number(item.id);
    const pinned=(state.pinnedIds||[]).map(Number).includes(Number(item.id));
    const marketPrice=Math.max(0,Number(item.marketPrice)||0),marketText=marketPrice?money(marketPrice):'Market unavailable';
    const itemType=String(item.type||'Item');
    const src=s.sources.length?s.sources.slice(0,3).join(' \u00B7 '):'No acquisitions in selected period';
    let details='';
    if(exp){
      const series=profitSeries(item.id),avgBuy=s.bought?s.buySpend/s.bought:0,avgSell=s.sold?s.sellRevenue/s.sold:0;
      const freeQty=s.events.filter(x=>x.side==='buy'&&x.free).reduce((n,x)=>n+x.qty,0);
      const playerTradeCount=new Set(s.events.filter(x=>x.source==='Player Trade').map(x=>x.tradeId)).size;
      const recordedInventoryValue=marketPrice*Math.max(0,Number(s.remainingQty)||0);
      details=`<div class="tta-minirow"><div class="tta-ministat"><small>Avg cost</small><b>${money(avgBuy,true)}</b></div><div class="tta-ministat"><small>Avg sell</small><b>${money(avgSell,true)}</b></div><div class="tta-ministat"><small>Inventory</small><b>${qty(s.remainingQty)}</b></div></div><div class="tta-minirow"><div class="tta-ministat"><small>Market value</small><b>${marketPrice?money(marketPrice,true):'\u2014'}</b></div><div class="tta-ministat"><small>Recorded inventory value</small><b>${marketPrice?money(recordedInventoryValue,true):'\u2014'}</b></div><div class="tta-ministat"><small>FIFO cost basis</small><b>${money(s.remainingCost,true)}</b></div></div><div class="tta-charthead"><h3>${esc(item.name)} profit</h3><small>#${item.id} \u00B7 ${esc(itemType)} \u00B7 ${s.events.length} events</small></div>${chartSvg(series,92)}<div class="tta-note">Market value is Torn's catalog market price per item. Recorded inventory value is your analyzer-recorded remaining quantity \u00D7 that market value; it is not a live inventory count.${playerTradeCount?` \u00B7 ${qty(playerTradeCount)} player trade(s) use each item type's market-value subtotal plus an equal share of that trade's cash surplus/deficit.`:''} Sold quantity counts every recognized sale event, including outgoing items from authoritative completed player-trade details. Profit uses FIFO: each sale is matched against your oldest recorded acquisitions, but the realized profit is attributed to the date that matched lot was acquired rather than the sale date. ${s.unmatched?`\u26A0 ${qty(s.unmatched)} sold item(s) have no earlier recorded acquisition cost, so those units are excluded from realized profit.`:'All sold units in this period have recorded cost basis.'}${freeQty?` \u00B7 ${qty(freeQty)} free-acquired item(s) use a $0 cost basis.`:''}</div>`;
    }
    return `<div class="tta-item ${exp?'expanded':''}" data-item="${item.id}"><div class="tta-itemtop" data-act="toggleItem" data-id="${item.id}" role="button" tabindex="0" aria-expanded="${exp?'true':'false'}">${itemIcon(item)}<div class="tta-itemcopy"><div class="tta-itemname">${esc(item.name)}</div><div class="tta-source">${esc(src)}</div><div class="tta-itemfacts"><span class="tta-factpill market">Market ${esc(marketText)}</span><span class="tta-factpill">${esc(itemType)}</span><span class="tta-factpill">#${item.id}</span></div></div><div class="tta-profitbox"><div class="tta-cardactions"><button class="tta-pin ${pinned?'active':''}" data-act="togglePin" data-id="${item.id}" aria-pressed="${pinned?'true':'false'}" aria-label="${pinned?'Unpin':'Pin'} ${esc(item.name)}" title="${pinned?'Unpin item':'Pin item to top'}">${pinned?'\uD83D\uDCCC':'\u2606'}</button><button class="tta-hideitem" data-act="hideItem" data-id="${item.id}" aria-label="Hide ${esc(item.name)}" title="Hide item">\uD83D\uDE48</button></div><div class="tta-profit ${s.profit>=0?'pos':'neg'}">${money(s.profit,true)}</div><div class="tta-chevron">${exp?'\u25B2 details':'\u25BC details'}</div></div></div><div class="tta-metrics"><div class="tta-metric"><small>Acquired</small><b>${qty(s.bought)}</b></div><div class="tta-metric"><small>Sold</small><b>${qty(s.sold)}</b></div><div class="tta-metric"><small>Profit</small><b class="${s.profit>=0?'pos':'neg'}">${money(s.profit,true)}</b></div></div><div class="tta-accordion">${details}</div></div>`;
  }

  function addItemHtml() {
    const q=state.search.trim().toLowerCase();
    const available=(state.catalog||[]).filter(x=>!state.tracked.some(t=>Number(t.id)===Number(x.id)));
    const results=available.filter(x=>!q || x.name.toLowerCase().includes(q) || String(x.id)===q);
    return `${header('Add item','Search the complete Torn item catalog',true)}<div class="tta-content"><div class="tta-search"><input id="tta-search" placeholder="Search item name or ID\u2026" value="${esc(state.search)}" autocomplete="off" aria-label="Search Torn items"></div>${!hasApiKey()?'<div class="tta-banner"><strong>Catalog preview:</strong> sample search results are available below. Add an API key in Settings to load the complete current Torn item catalog.</div>':`<div class="tta-catalogmeta"><strong>${qty(results.length)}</strong>&nbsp;matching \u00B7 ${qty(state.catalog.length)} total Torn items loaded</div>`}${results.length?results.map(x=>`<div class="tta-result">${itemIcon(x)}<div class="tta-resultcopy"><div class="tta-itemname">${esc(x.name)}</div><small>#${x.id} \u00B7 ${esc(x.type||'Item')}</small></div><button class="tta-btn" data-act="confirmAdd" data-id="${x.id}">Add</button></div>`).join(''):'<div class="tta-empty">No matching items.</div>'}</div>`;
  }


  function helpHtml() {
    return `${header('Help & Guide','How to use the Cash Flow Analyzer',true)}<div class="tta-content"><section class="tta-help-intro"><h2>Cash Flow Analyzer Guide</h2><p>Use this page as a quick reference for navigation, syncing and understanding each financial workspace. Your analyzed data stays in this device's local storage.</p></section><div class="tta-help-grid"><section class="tta-help-card wide"><div class="tta-help-card-head"><div class="icon">\uD83D\uDE80</div><h3>Getting started</h3></div><p>Open <b>Settings</b> and tap <b>Create key</b> to have Torn generate a custom API key with the analyzer's required selections. Copy the generated key back into Settings, tap <b>Save & test</b>, then run <b>Quick Sync</b>. Torn PDA's injected API key is also supported.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u2301</div><h3>Background Quick Sync</h3></div><p>While the script is active, it checks for new data about every minute. It runs silently and does not interrupt scrolling, inputs or the page you are using.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u26A1</div><h3>Quick Sync vs Full Resync</h3></div><p><b>Quick Sync</b> checks from the last successful sync forward. <b>Full Resync</b> rebuilds discovered local history from the beginning and should mainly be used for repairs or major backfills.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u2195</div><h3>Cash Flow</h3></div><p>Shows recognized money coming in and going out, grouped into useful categories. Item-related rows also show the item name and quantity when available. Search and filter the ledger to inspect individual events. Internal transfers are excluded from earned/spent totals.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u25A6</div><h3>Trade Analysis</h3></div><p>Uses FIFO accounting to match sales against your oldest recorded acquisitions. Tap an item for details, use the period selector for date ranges, and open Acquisition History for lot-level records.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u25C7</div><h3>Net Worth</h3></div><p>Combines Torn's official net-worth/current-money snapshots with analyzer-recorded item activity. Player money/item transfers and completed Player Trades are shown as daily changes, used/consumed items reduce recorded inventory and appear as Net Worth changes, sold items include realized FIFO profit/loss, and the page includes a selectable daily-change view, recorded Company P/L activity, a timeline and asset allocation.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u25EB</div><h3>Insights & Goals</h3></div><p>Breaks income and spending into categories, compares periods, surfaces unrecognized money-bearing logs, and tracks net-worth, cash or daily-income goals.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\u2637</div><h3>Acquisition History</h3></div><p>Shows individual acquisition lots, source/method, quantity, cost, sold status and realized FIFO results. Search, filter and sort to audit where your inventory came from.</p></section><section class="tta-help-card"><div class="tta-help-card-head"><div class="icon">\uD83D\uDCC5</div><h3>Periods, charts and filters</h3></div><p>Use 7, 14, 30 days, All or Custom periods. Day/week/month chart grouping changes visualization only; it does not alter the underlying cached history.</p></section><section class="tta-help-card wide"><div class="tta-help-card-head"><div class="icon">\uD83D\uDD12</div><h3>Data, backup & privacy</h3></div><p>Normalized analyzer data and financial snapshots are stored locally on the device. Raw Torn logs are not retained. Settings can export/import a local JSON backup plus Cash Flow and Net Worth CSV files. Your API key is excluded from backups and sent only to Torn's official API.</p></section><section class="tta-help-card wide"><div class="tta-help-card-head"><div class="icon">\uD83D\uDCA1</div><h3>Useful tip</h3></div><p>If a date range looks incomplete, run Quick Sync first. Use Full Resync only if historical data still appears missing. Net-worth daily change is snapshot-based, so more snapshots during the day give a clearer before-and-after comparison.</p></section></div></div>`;
  }

  function settingsHtml() {
    const when=state.sync.lastSync?new Date(state.sync.lastSync*1000).toLocaleString():'Never';
    const status=keySource();
    const masked=state.apiKey?'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022':'';
    const hiddenIds=[...new Set((state.hiddenIds||[]).map(Number).filter(x=>x>0))];
    const hiddenItems=hiddenIds.map(catalogItem).sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
    const catalogUpdated=Number(state.catalogUpdatedAt)||0;
    const catalogWhen=catalogUpdated?new Date(catalogUpdated*1000).toLocaleString():'Never';
    const hiddenHtml=hiddenItems.length?`<div class="tta-hiddenlist">${hiddenItems.map(x=>`<div class="tta-hiddenrow"><span>${esc(x.name)} <small>#${x.id}</small></span><button class="tta-btn secondary" data-act="restoreItem" data-id="${x.id}">Restore</button></div>`).join('')}</div><div class="tta-settings-actions"><button class="tta-btn secondary" data-act="restoreAllItems">Restore all hidden items</button></div>`:'<div class="tta-banner">No hidden items.</div>';
    return `${header('Settings','Storage, API access & reset',true)}<div class="tta-content tta-settings">
      <div class="tta-keycard"><div class="tta-keyhead"><strong>API Key</strong><span class="tta-keystatus">${esc(status)}</span></div><div class="tta-keyinputrow"><input id="tta-api-key" type="password" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste your Torn API key" value="${esc(masked)}" data-placeholder-key="${state.apiKey?'1':'0'}"><button class="tta-btn secondary tta-keycreate" data-act="createApiKey" title="Create a Torn custom API key for this analyzer">\uFF0B Create key</button><button class="tta-btn" data-act="saveApiKey">Save & test</button></div><div class="tta-keynote"><strong>Create key</strong> opens Torn's official API settings and generates a custom key named <strong>CashFlowAnalyzer</strong> with only the selections used by this analyzer: User Log/Trade/Trades/Money/Networth, Company Profile/Employees, and Torn Items/Logtypes. Copy the generated key, return here, paste it above, then tap <strong>Save & test</strong>. Your key is stored only on this device and is sent only to Torn's official API; it is never uploaded to GitHub or sent to us. User Log remains unrestricted by log category so financial activity, player transfers and free-item/reward history can be discovered.</div>${state.apiKey?'<div class="tta-settings-actions"><button class="tta-btn danger" data-act="clearApiKey">Clear saved API key</button></div>':''}</div>
      <div class="tta-tos"><strong>Privacy / Torn API use</strong><br>Data storage: only locally on this device.<br>Data sharing: nobody.<br>Purpose: personal cash-flow, spending, earnings, net-worth and trade analysis from recognized Torn financial/item activity.<br>Key storage: locally only / not shared.<br>Required custom-key selections: <strong>User \u2192 Log, Trade, Trades, Money, Networth</strong>; <strong>Company \u2192 Profile, Employees</strong>; <strong>Torn \u2192 Items, Logtypes</strong>. Torn PDA's injected key remains supported as a fallback.</div><label>Last successful sync</label><div class="tta-banner">${esc(when)}${state.sync.firstSyncComplete?' \u00B7 Historical backfill completed':''}</div><label>Local data</label><div class="tta-banner">${qty(state.transactions.length)} normalized item transactions \u00B7 ${qty(state.cashFlows.length)} direct cash-flow logs \u00B7 ${qty(state.playerTransfers.length)} player item-transfer rows \u00B7 ${qty(state.playerTrades.length)} canonical player-trade rows \u00B7 ${qty(state.unrecognizedFinancial.length)} unrecognized financial diagnostics \u00B7 ${qty(state.financialSnapshots.length)} financial snapshots \u00B7 ${qty(state.catalog.length)} Torn items cached. Raw Torn logs are not retained.<br>Item catalog / market values updated: ${esc(catalogWhen)}.${state.sync.diagnostics?`<br>Last scan: ${qty(state.sync.diagnostics.rawRows||0)} raw logs \u00B7 ${qty(state.sync.diagnostics.pages||0)} log pages \u00B7 ${qty(state.sync.diagnostics.logTypes||0)} candidate log types \u00B7 ${qty(state.sync.diagnostics.cashFlowRows||0)} direct cash-flow rows recognized \u00B7 ${qty(state.sync.diagnostics.playerTransferRows||0)} player item-transfer rows \u00B7 ${qty(state.sync.diagnostics.unrecognizedFinancialRows||0)} unrecognized money-bearing logs.<br>Player trades: ${qty(state.sync.diagnostics.tradesWithItems||0)} with items \u00B7 ${qty(state.sync.diagnostics.tradeDetails||0)} missing details fetched \u00B7 ${qty(state.sync.diagnostics.tradeDetailsSkipped||0)} already verified details skipped \u00B7 ${qty(state.sync.diagnostics.tradeTransactions||0)} allocated item rows \u00B7 ${qty(state.sync.diagnostics.tradeSoldQty||0)} items sold via trades.<br>Foreign Market acquisitions in mixed scan: ${qty(state.sync.diagnostics.foreignBuyRows||0)} row(s) \u00B7 ${qty(state.sync.diagnostics.foreignBuyQty||0)} item(s).<br>Dedicated Abroad Buy (4201) verification: ${qty(state.sync.diagnostics.abroadVerifyRawRows||0)} raw log(s) \u00B7 ${qty(state.sync.diagnostics.abroadVerifyParsedRows||0)} parsed row(s) \u00B7 ${qty(state.sync.diagnostics.abroadVerifyQty||0)} item(s).${state.sync.diagnostics.abroadVerifyLatestRawTimestamp?`<br>Latest raw Abroad Buy log: ${esc(tctDateTimeStr(state.sync.diagnostics.abroadVerifyLatestRawTimestamp))} TCT.`:''}${state.sync.diagnostics.latestParsedAcquisitionTimestamp?`<br>Latest parsed acquisition: ${esc(tctDateTimeStr(state.sync.diagnostics.latestParsedAcquisitionTimestamp))} TCT.`:''}<br>Freshness safety window: recheck recent ${qty(state.sync.diagnostics.recentLogRecheckHours||72)}h of User Logs and ${qty(state.sync.diagnostics.recentTradeRecheckHours||6)}h of Player Trades on live-period syncs.<br>Incremental cache: ${qty(state.sync.diagnostics.existingRowsSkipped||0)} existing transaction rows skipped.${state.sync.diagnostics.periodFrom?`<br>Period scanned: ${esc(dateStr(state.sync.diagnostics.periodFrom))} \u2013 ${esc(dateStr(Math.min(state.sync.diagnostics.periodTo||nowSec(),nowSec())))}`:'<br>Period scanned: all available history.'}`:''}</div><label>Backup & export</label><div class="tta-fin-section"><div class="tta-settings-actions tta-backup-actions"><button class="tta-btn secondary" data-act="exportBackup">Export JSON backup</button><button class="tta-btn secondary" data-act="importBackup">Import backup</button><button class="tta-btn secondary" data-act="exportCashCsv">Export Cash Flow CSV</button><button class="tta-btn secondary" data-act="exportNetWorthCsv">Export Net Worth CSV</button></div><div class="tta-snapshot-note">Backups include analyzer history, snapshots, transfer records, preferences and goals. Your API key is intentionally excluded.</div></div><label>Hidden items \u00B7 ${qty(hiddenItems.length)}</label>${hiddenHtml}<div class="tta-settings-actions"><button class="tta-btn secondary" data-act="refreshCatalog">Refresh Torn item catalog</button><button class="tta-btn danger" data-act="resetData">Reset analyzer data</button></div></div>`;
  }

  function loadingHtml() {
    const b=state.busy||{};
    return `<div id="tta-loading" class="tta-loading ${b.active?'show':''}" role="status" aria-live="polite" aria-hidden="${b.active?'false':'true'}"><div class="tta-loadingcard"><div class="tta-loadicon"><span class="tta-spinner xl"></span></div><div id="tta-loading-title" class="tta-loadingtitle">${esc(b.title||'Working\u2026')}</div><div id="tta-loading-detail" class="tta-loadingdetail">${esc(b.detail||'Preparing your data\u2026')}</div><div class="tta-loadingbar"><span></span></div><div class="tta-loadingactions"><button id="tta-loading-minimize" class="tta-btn secondary" data-act="minimizeSync" ${state.syncing?'':'hidden'}>\u2014 Minimize</button><button id="tta-loading-stop" class="tta-btn danger" data-act="cancelSync" ${b.cancellable?'':'hidden'}>Stop sync</button></div><div class="tta-loadinghint">Minimize to keep using Torn while the sync continues. You can reopen progress from the floating button at any time.</div></div></div>`;
  }

  function updateBusyDom() {
    const root=document.getElementById('tta-root'),el=document.getElementById('tta-loading'),b=state.busy||{};
    if(root)root.setAttribute('aria-busy',b.active?'true':'false');if(!el)return;
    el.classList.toggle('show',!!b.active);el.setAttribute('aria-hidden',b.active?'false':'true');
    const title=document.getElementById('tta-loading-title'),detail=document.getElementById('tta-loading-detail'),stop=document.getElementById('tta-loading-stop'),minimize=document.getElementById('tta-loading-minimize');
    if(title)title.textContent=b.title||'Working\u2026';if(detail)detail.textContent=b.detail||'Preparing your data\u2026';if(stop)stop.hidden=!b.cancellable;if(minimize)minimize.hidden=!state.syncing;
  }

  function setBusy(active,title='',detail='',cancellable=false) {
    state.busy={active:!!active,title,detail,cancellable:!!cancellable};updateBusyDom();
  }
  function setBusyDetail(detail) {if(state.backgroundSyncing)return;state.busy={...(state.busy||{}),detail};updateBusyDom();}
  function nextPaint(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
  async function withBusy(title,detail,fn,{cancellable=false}={}) {setBusy(true,title,detail,cancellable);await nextPaint();try{return await fn();}finally{setBusy(false);}}

  function setSyncProgress(msg) {
    const value=String(msg||'');
    if(state.backgroundSyncing){state.backgroundSyncProgress=value;return;}
    state.syncProgress=value;
    const text=document.getElementById('tta-sync-progress-text');if(text)text.textContent=state.syncProgress;
    if(state.syncing)setBusyDetail(state.syncProgress);
  }

  async function openAnalyzer() {
    state.open=true;
    const fab=document.getElementById('tta-fab');if(fab)fab.style.display='none';
    const root=document.getElementById('tta-root');if(!root)return;
    root.classList.add('show');root.setAttribute('aria-hidden','false');
    if(root.querySelector('.tta-shell')&&root.dataset.view===state.view)return;
    root.innerHTML='<div class="tta-openloader"><div><span class="tta-spinner xl"></span><strong>Opening Cash Flow Analyzer</strong><small>Preparing cached financial history and analytics\u2026</small></div></div>';
    await nextPaint();render({preserveScroll:false});
  }

  function render(options={}) {
    const root=document.getElementById('tta-root');if(!root)return;
    const previousView=root.dataset.view||'',previousShell=root.querySelector('.tta-shell');
    const preserveScroll=options.preserveScroll??(previousView===state.view),previousScroll=preserveScroll&&previousShell?previousShell.scrollTop:0;
    updateFabState();
    if(!state.open){root.classList.remove('show');root.setAttribute('aria-hidden','true');return;}
    root.classList.add('show');root.setAttribute('aria-hidden','false');
    const wasDemo=state.demo;state.demo=!hasApiKey()&&!state.transactions.length;if(wasDemo!==state.demo)resetAnalyticsCache();
    if(state.demo&&!state.catalog.length)state.catalog=demoCatalog();
    root.innerHTML=`<div class="tta-shell">${state.view==='add'?addItemHtml():state.view==='settings'?settingsHtml():state.view==='help'?helpHtml():state.view==='ledger'?ledgerHtml():state.view==='cash'?cashFlowHtml():state.view==='insights'?insightsHtml():state.view==='networth'?netWorthHtml():state.view==='trade'?tradeHtml():dashboardHtml()}</div>${loadingHtml()}<div id="tta-toast" class="tta-toast ${state.toast?'show':''}">${esc(state.toast||'')}</div>`;
    root.dataset.view=state.view;root.setAttribute('aria-busy',state.busy?.active?'true':'false');bind();
    if(preserveScroll){const shell=root.querySelector('.tta-shell');if(shell)shell.scrollTop=previousScroll;}positionDailyChartsToLatest(root);
  }

  let toastTimer=null;
  function toast(msg) {
    state.toast=String(msg||'');const el=document.getElementById('tta-toast');
    if(el){el.textContent=state.toast;el.classList.add('show');}
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>{if(state.toast===msg){state.toast='';const n=document.getElementById('tta-toast');if(n)n.classList.remove('show');}},2400);
  }

  function bindPortalMouseDrag(root) {
    let drag=null;
    root.addEventListener('pointerdown',e=>{
      const portal=e.target?.closest?.('.tta-fin-nav.portal');
      if(!portal||!root.contains(portal)||e.pointerType!=='mouse'||e.button!==0)return;
      portal.dataset.suppressClick='0';
      drag={portal,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,startScrollLeft:portal.scrollLeft,moved:false,captured:false};
    });
    root.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
      if(!drag.moved){
        if(Math.hypot(dx,dy)<7)return;
        if(Math.abs(dx)<=Math.abs(dy)){drag=null;return;}
        drag.moved=true;
        drag.portal.classList.add('dragging');
        try{drag.portal.setPointerCapture(e.pointerId);drag.captured=true;}catch(_){ }
      }
      e.preventDefault();
      drag.portal.scrollLeft=drag.startScrollLeft-dx;
    });
    const finish=e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const portal=drag.portal,moved=drag.moved,captured=drag.captured;
      if(captured){try{portal.releasePointerCapture(e.pointerId);}catch(_){ }}
      portal.classList.remove('dragging');
      if(moved){portal.dataset.suppressClick='1';requestAnimationFrame(()=>setTimeout(()=>{if(portal?.isConnected)portal.dataset.suppressClick='0';},80));}
      drag=null;
    };
    root.addEventListener('pointerup',finish);
    root.addEventListener('pointercancel',finish);
    root.addEventListener('pointerleave',e=>{if(drag&&!drag.moved&&e.pointerId===drag.pointerId)drag=null;});
  }

  function bind() {
    const root=document.getElementById('tta-root');if(!root||root.dataset.delegated==='1')return;root.dataset.delegated='1';
    bindPortalMouseDrag(root);
    root.addEventListener('click',async e=>{
      const portal=e.target?.closest?.('.tta-fin-nav.portal');
      if(portal&&portal.dataset.suppressClick==='1'){e.preventDefault();e.stopPropagation();return;}
      const dateEl=e.target.closest('[data-date]');
      if(dateEl&&root.contains(dateEl)){state.dateMode=dateEl.dataset.date;save('dateMode',state.dateMode);state.expanded=null;await withBusy('Updating period','Recalculating cached analytics for the selected dates\u2026',async()=>render());return;}
      const granEl=e.target.closest('[data-gran]');
      if(granEl&&root.contains(granEl)){state.granularity=granEl.dataset.gran;save('granularity',state.granularity);const detail=state.view==='cash'?'Grouping cash flow by the selected interval\u2026':'Grouping realized profit by the selected interval\u2026';await withBusy('Updating chart',detail,async()=>render());return;}
      const el=e.target.closest('[data-act]');if(!el||!root.contains(el))return;e.stopPropagation();const act=el.dataset.act;
      if(act==='close'){state.open=false;if(!state.syncing)setBusy(false);render();}
      else if(act==='minimizeSync'){state.open=false;render();}
      else if(act==='back'){state.view=state.view==='ledger'?'trade':'dashboard';state.search='';render();}
      else if(act==='settings'){state.view='settings';render();}
      else if(act==='help'){state.view='help';render({preserveScroll:false});}
      else if(act==='cashflow'){state.view='cash';render({preserveScroll:false});}
      else if(act==='insights'){state.view='insights';render({preserveScroll:false});}
      else if(act==='trade'){state.view='trade';render({preserveScroll:false});}
      else if(act==='networth'){state.view='networth';render({preserveScroll:false});}
      else if(act==='netWorthToday'){state.netWorthDate=tctInputDate(nowSec());save('netWorthDate',state.netWorthDate);render({preserveScroll:true});}
      else if(act==='refreshFinancial'){await withBusy('Refreshing finances','Loading current Torn money and net-worth snapshots\u2026',async()=>refreshFinancialSnapshot());render();toast('Financial snapshot refreshed.');}
      else if(act==='addGoal'){const type=String(document.getElementById('tta-goal-type')?.value||'networth'),target=Number(document.getElementById('tta-goal-target')?.value)||0,label=String(document.getElementById('tta-goal-label')?.value||'').trim();if(!(target>0)){toast('Enter a goal target greater than zero.');return;}state.goals=[...(state.goals||[]),{id:`g${Date.now().toString(36)}`,type,target,label,createdAt:nowSec()}];save('goals',state.goals);render();toast('Financial goal added.');}
      else if(act==='removeGoal'){state.goals=(state.goals||[]).filter(g=>String(g.id)!==String(el.dataset.id));save('goals',state.goals);render();}
      else if(act==='exportBackup'){exportBackup();toast('JSON backup exported.');}
      else if(act==='importBackup'){importBackup();}
      else if(act==='exportCashCsv'){exportCashCsv();toast('Cash Flow CSV exported.');}
      else if(act==='exportNetWorthCsv'){exportNetWorthCsv();toast('Net Worth CSV exported.');}
      else if(act==='ledger'){state.view='ledger';state.ledgerLimit=200;render({preserveScroll:false});}
      else if(act==='ledgerSort'){
        const key=String(el.dataset.key||'acquiredAt');if(state.ledgerSort===key)state.ledgerSortDir=state.ledgerSortDir==='asc'?'desc':'asc';else{state.ledgerSort=key;state.ledgerSortDir=(key==='item'||key==='method'||key==='status')?'asc':'desc';}
        save('ledgerSort',state.ledgerSort);save('ledgerSortDir',state.ledgerSortDir);state.ledgerLimit=200;renderLedgerRows();
      }
      else if(act==='clearLedgerSearch'){state.ledgerSearch='';save('ledgerSearch','');state.ledgerLimit=200;const input=document.getElementById('tta-ledger-search');if(input){input.value='';input.focus();}renderLedgerRows();}
      else if(act==='ledgerMore'){state.ledgerLimit=(Number(state.ledgerLimit)||200)+200;renderLedgerRows();}
      else if(act==='addItem'){state.view='add';await withBusy('Loading catalog','Preparing the Torn item catalog\u2026',async()=>{await ensureCatalog();render();});setTimeout(()=>document.getElementById('tta-search')?.focus(),30);}
      else if(act==='toggleItem'){state.expanded=Number(state.expanded)===Number(el.dataset.id)?null:Number(el.dataset.id);renderItemList();}
      else if(act==='togglePin'){
        const id=Number(el.dataset.id),pins=new Set((state.pinnedIds||[]).map(Number));if(pins.has(id))pins.delete(id);else pins.add(id);state.pinnedIds=[...pins];save('pinnedIds',state.pinnedIds);renderItemList();
      }
      else if(act==='hideItem'){
        const id=Number(el.dataset.id),hidden=new Set((state.hiddenIds||[]).map(Number));hidden.add(id);state.hiddenIds=[...hidden];save('hiddenIds',state.hiddenIds);if(Number(state.expanded)===id)state.expanded=null;renderItemList();toast(`${catalogItem(id).name} hidden. Restore it from Settings.`);
      }
      else if(act==='restoreItem'){
        const id=Number(el.dataset.id);state.hiddenIds=(state.hiddenIds||[]).map(Number).filter(x=>x!==id);save('hiddenIds',state.hiddenIds);render();toast(`${catalogItem(id).name} restored.`);
      }
      else if(act==='restoreAllItems'){
        state.hiddenIds=[];save('hiddenIds',[]);render();toast('All hidden items restored.');
      }
      else if(act==='cycleSort'){const i=Math.max(0,SORT_OPTIONS.findIndex(x=>x.id===state.sortMode));state.sortMode=SORT_OPTIONS[(i+1)%SORT_OPTIONS.length].id;save('sortMode',state.sortMode);renderItemList();}
      else if(act==='clearItemSearch'){state.itemSearch='';save('itemSearch','');const input=document.getElementById('tta-history-search');if(input){input.value='';input.focus();}renderItemList();}
      else if(act==='confirmAdd'){addTracked(Number(el.dataset.id));}
      else if(act==='removeItem'){removeTracked(Number(el.dataset.id));}
      else if(act==='sync'||act==='syncQuick'){syncAll({mode:'quick'});}
      else if(act==='syncFull'){if(confirm('Full Resync will rebuild the locally discovered cash-flow and trade history from the beginning. This can take a long time. Continue?'))syncAll({mode:'full'});}
      else if(act==='cancelSync'){state.syncCancel=true;setSyncProgress('Stopping after the current API request\u2026');}
      else if(act==='createApiKey'){
        state.open=false;window.location.href=ANALYZER_CUSTOM_KEY_URL;return;
      }
      else if(act==='saveApiKey'){
        const input=document.getElementById('tta-api-key');let key=String(input?.value||'').trim();if(input?.dataset.placeholderKey==='1'&&/^\u2022+$/.test(key))key=String(state.apiKey||'').trim();
        if(key.length<16){toast('Enter a valid Torn API key first.');return;}state.apiKey=key;save('apiKey',key);state.demo=false;render();
        try{
          let info=null;await withBusy('Checking API key','Verifying access and refreshing the item catalog\u2026',async()=>{info=await inspectActiveKey();await apiGet('/user/log',{limit:1});state.catalog=[];state.catalogVersion=0;state.catalogUpdatedAt=0;save('catalog',[]);save('catalogVersion',0);save('catalogUpdatedAt',0);await ensureCatalog(true);});
          toast(`API key confirmed (${info?.type||'access level '+(info?.level||'?')}).`);state.view='dashboard';render();await syncAll();
        }catch(err){if(/Incorrect Key|incorrect format/i.test(String(err.message||err))){state.apiKey='';save('apiKey','');}setBusy(false);render();toast(`API key test failed: ${err.message}`);}
      }
      else if(act==='clearApiKey'){state.apiKey='';save('apiKey','');state.demo=!hasApiKey();resetAnalyticsCache();render();toast(injectedApiKey()?'Saved key cleared. Torn PDA key will be used.':'Saved API key cleared.');}
      else if(act==='refreshCatalog'){
        await withBusy('Refreshing catalog','Downloading the latest Torn item catalog and market values\u2026',async()=>{state.catalog=[];state.catalogVersion=0;state.catalogUpdatedAt=0;save('catalog',[]);save('catalogVersion',0);save('catalogUpdatedAt',0);await ensureCatalog(true);});render();toast(`Item catalog and market values refreshed \u00B7 ${qty(state.catalog.length)} items.`);
      }
      else if(act==='resetData'&&confirm('Reset all Torn Cash Flow Analyzer financial history, trade history and local snapshots?')){
        ['tracked','transactions','cashFlows','playerTransfers','playerTrades','itemConsumptions','unrecognizedFinancial','goals','financialSnapshots','sync','syncJob','syncCache','logTypesUpdatedAt','pinnedIds','hiddenIds','itemSearch','sortMode','ledgerSearch','ledgerSource','ledgerStatus','ledgerRange','ledgerSort','ledgerSortDir'].forEach(k=>localStorage.removeItem(NS+k));state.tracked=[];state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.playerTrades=[];state.itemConsumptions=[];state.unrecognizedFinancial=[];state.goals=[];state.financialSnapshots=[];state.pinnedIds=[];state.hiddenIds=[];state.itemSearch='';state.sortMode='recent';state.ledgerSearch='';state.ledgerSource='all';state.ledgerStatus='all';state.ledgerRange='all';state.ledgerSort='acquiredAt';state.ledgerSortDir='desc';state.ledgerLimit=200;state.sync={lastSync:0,firstSyncComplete:false};state.logTypesUpdatedAt=0;state.expanded=null;syncCacheMem=null;resetAnalyticsCache();render();toast('Analyzer data reset.');
      }
    });

    root.addEventListener('pointerover',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))showChartTooltip(bar,false);const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))showCashFlowTooltip(point,false);});
    root.addEventListener('pointerout',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))hideChartTooltip(bar.closest('.tta-chartinteractive'));const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))hideCashFlowTooltip(point.closest('.tta-cash-chart'));});
    root.addEventListener('focusin',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))showChartTooltip(bar,false);const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))showCashFlowTooltip(point,false);});
    root.addEventListener('focusout',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))hideChartTooltip(bar.closest('.tta-chartinteractive'));const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))hideCashFlowTooltip(point.closest('.tta-cash-chart'));});
    root.addEventListener('click',e=>{
      const bar=e.target?.closest?.('.tta-profitbar');
      if(bar&&root.contains(bar)){e.stopPropagation();const wrap=bar.closest('.tta-chartinteractive'),tip=wrap?.querySelector('.tta-charttooltip'),same=bar.classList.contains('active')&&tip?.dataset.pinned==='1';if(same)hideChartTooltip(wrap,true);else showChartTooltip(bar,true);return;}
      const point=e.target?.closest?.('.tta-cashpoint');
      if(point&&root.contains(point)){e.stopPropagation();const wrap=point.closest('.tta-cash-chart'),tip=wrap?.querySelector('.tta-charttooltip'),same=point.classList.contains('active')&&tip?.dataset.pinned==='1';if(same)hideCashFlowTooltip(wrap,true);else showCashFlowTooltip(point,true);return;}
      root.querySelectorAll('.tta-chartinteractive').forEach(w=>{hideChartTooltip(w,true);hideCashFlowTooltip(w,true);});
    });

    root.addEventListener('input',e=>{
      const target=e.target;
      if(target.id==='tta-history-search'){
        state.itemSearch=target.value;save('itemSearch',state.itemSearch);clearTimeout(perfCache.searchTimer);perfCache.searchTimer=setTimeout(()=>renderItemList(),120);
      }else if(target.id==='tta-cash-search'){
        state.cashSearch=target.value;save('cashSearch',state.cashSearch);clearTimeout(perfCache.searchTimer);perfCache.searchTimer=setTimeout(()=>render({preserveScroll:true}),140);
      }else if(target.id==='tta-ledger-search'){
        state.ledgerSearch=target.value;save('ledgerSearch',state.ledgerSearch);state.ledgerLimit=200;clearTimeout(perfCache.ledgerSearchTimer);perfCache.ledgerSearchTimer=setTimeout(()=>renderLedgerRows(),120);
      }else if(target.id==='tta-search'){
        state.search=target.value;clearTimeout(perfCache.legacySearchTimer);perfCache.legacySearchTimer=setTimeout(()=>{render();const n=document.getElementById('tta-search');if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length);}},140);
      }
    });

    root.addEventListener('change',async e=>{
      const target=e.target;
      if(target.id==='tta-networth-date'){const ts=tctDateInputStart(target.value),bounds=netWorthTrackingBounds();if(Number.isFinite(ts)){const day=Math.max(bounds.first,Math.min(bounds.today,tctDayStart(ts)));state.netWorthDate=tctInputDate(day);save('netWorthDate',state.netWorthDate);render({preserveScroll:true});}return;}
      if(target.id==='tta-cash-category'){state.cashCategory=target.value;save('cashCategory',state.cashCategory);render({preserveScroll:true});return;}
      if(target.dataset.ledgerFilter){
        const kind=target.dataset.ledgerFilter,val=target.value;if(kind==='source')state.ledgerSource=val;else if(kind==='status')state.ledgerStatus=val;else if(kind==='range')state.ledgerRange=val;
        save(kind==='source'?'ledgerSource':kind==='status'?'ledgerStatus':'ledgerRange',val);state.ledgerLimit=200;renderLedgerRows();return;
      }
      if(!target.dataset.custom)return;if(target.dataset.custom==='from')state.customFrom=target.value;else state.customTo=target.value;save('customFrom',state.customFrom);save('customTo',state.customTo);state.expanded=null;
      await withBusy('Updating custom period','Applying the selected dates to cached analytics\u2026',async()=>render());
    });

    root.addEventListener('focusin',e=>{const target=e.target;if(target.id==='tta-api-key'&&target.dataset.placeholderKey==='1'){target.value='';target.dataset.placeholderKey='0';}});
  }

  async function ensureCatalog(force=false) {
    if(state.demo&&!hasApiKey())return;
    const catalogAge=nowSec()-(Number(state.catalogUpdatedAt)||0);
    const cacheCurrent=state.catalog.length&&state.catalogVersion===CATALOG_SCHEMA_VERSION&&catalogAge>=0&&catalogAge<6*3600;if(cacheCurrent&&!force)return;
    if(!hasApiKey()){state.catalog=demoCatalog();return;}
    try{
      if(state.busy?.active)setBusyDetail('Loading the complete Torn item catalog and current market values\u2026');
      const data=await apiGet('/torn/items');
      state.catalog=(data.items||[]).filter(x=>x&&Number(x.id)>0&&x.name).map(x=>({id:Number(x.id),name:String(x.name),image:x.image||'',type:x.type||'',marketPrice:Number(x.value?.market_price)||0})).sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
      state.catalogVersion=CATALOG_SCHEMA_VERSION;state.catalogUpdatedAt=nowSec();save('catalog',state.catalog);save('catalogVersion',state.catalogVersion);save('catalogUpdatedAt',state.catalogUpdatedAt);perfCache.catalogRef=null;
    }catch(e){toast(e.message);}
  }

  function addTracked(id) {
    const x=state.catalog.find(i=>Number(i.id)===Number(id)); if(!x)return;
    if(!state.tracked.some(i=>Number(i.id)===Number(id))){state.tracked.push(x);save('tracked',state.tracked);}
    state.view='trade';state.search='';state.demo=false;render();toast(`${x.name} added. Sync to analyze its history.`);
  }
  function removeTracked(id) {
    const x=state.tracked.find(i=>Number(i.id)===Number(id));
    state.tracked=state.tracked.filter(i=>Number(i.id)!==Number(id));
    state.transactions=state.transactions.filter(t=>Number(t.itemId)!==Number(id));
    save('tracked',state.tracked);save('transactions',state.transactions);state.expanded=null;render();toast(`${x?.name||'Item'} removed.`);
  }

  async function ensureLogTypes(force=false) {
    const age=nowSec()-(Number(state.logTypesUpdatedAt)||0);
    if(state.logTypes.length&&!force&&age>=0&&age<24*3600)return state.logTypes;
    const data=await apiGet('/torn/logtypes');
    state.logTypes=data.logtypes||[];state.logTypesUpdatedAt=nowSec();save('logTypes',state.logTypes);save('logTypesUpdatedAt',state.logTypesUpdatedAt);return state.logTypes;
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
    const push=(id,q=1)=>{id=Number(id);q=Number(q)||1;if(id>0&&q>0)out.push({id,qty:q});};
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
    visit(data,q,0);
    const merged=new Map();out.forEach(x=>merged.set(x.id,(merged.get(x.id)||0)+x.qty));return [...merged].map(([id,qty])=>({id,qty}));
  }

  function cashTotal(data, qtyValue) {
    const totalKeys=['cost_total','total_cost','total','price_total','total_price','money','amount_paid','price_paid','cost_paid','proceeds','revenue','sale_total','total_value'];
    for(const k of totalKeys){const v=Number(data?.[k]);if(Number.isFinite(v)&&v>0)return v;}
    const eachKeys=['cost_each','price_each','unit_price','price','cost','value_each'];
    for(const k of eachKeys){const v=Number(data?.[k]);if(Number.isFinite(v)&&v>0)return v*Math.max(1,qtyValue||1);}
    return 0;
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
    const items=normalizeItems(payload); if(!items.length)return[];
    const totalAll=free?0:cashTotal(payload,items.reduce((s,x)=>s+x.qty,0)); const fee=side==='sell'?fees(payload):0;
    const totalQty=items.reduce((s,x)=>s+x.qty,0)||1;
    return items.map(it=>{
      const ratio=it.qty/totalQty; const total=totalAll*ratio; const feeShare=fee*ratio;
      return {id:`${entry.id}:${it.id}`,logId:logTypeId,timestamp:entry.timestamp,itemId:it.id,side,qty:it.qty,total,fee:feeShare,netTotal:side==='sell'?Math.max(0,total-feeShare):total,source:known?.source||sourceFrom(title),title,free};
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
    if(parsedItemRows?.length&&!crimeContext)return[];
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
    for(const row of rows){if(!row?.id||map.has(String(row.id)))continue;map.set(String(row.id),row);added++;}
    if(added){state.playerTransfers=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)).slice(-5000);save('playerTransfers',state.playerTransfers);resetAnalyticsCache();}return added;
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
    for(const row of rows){if(!row?.id||map.has(String(row.id)))continue;map.set(String(row.id),row);added++;}
    if(added){state.itemConsumptions=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)).slice(-10000);save('itemConsumptions',state.itemConsumptions);resetAnalyticsCache();}return added;
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

  function checkpointCashFlowRows(rows) {
    if(!rows?.length)return 0;const map=new Map((state.cashFlows||[]).map(x=>[String(x.id),x]));let added=0;
    for(const row of rows){if(!row?.id||!(Number(row.amount)>0)||map.has(String(row.id)))continue;map.set(String(row.id),row);added++;}
    if(added){state.cashFlows=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0));save('cashFlows',state.cashFlows);}
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
      if(entry?.type!=='Item')continue;
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
      if(entry?.type!=='Money')continue;
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
    if(changed){state.playerTrades=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)).slice(-5000);save('playerTrades',state.playerTrades);}return changed;
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
    const common={timestamp:ts,fee:0,source:'Player Trade',title:`Player Trade${other?.name?` with ${other.name}`:''}`,tradeId,counterpartyId:Number(other?.id)||0,counterpartyName:String(other?.name||''),tradeCashIn:cashIn,tradeCashOut:cashOut,tradeSurplus,allocationMethod:'market-value + equal cash delta'};
    const sold=saleGroups.map(g=>({id:`trade:${tradeId}:1:sell:${g.itemId}`,logId:0,itemId:g.itemId,side:'sell',qty:g.qty,total:g.total,netTotal:g.total,free:false,marketPriceUsed:g.marketPrice,marketSubtotal:g.baseMarket,tradeAdjustment:g.adjustment,...common}));
    const bought=buyGroups.map(g=>({id:`trade:${tradeId}:2:buy:${g.itemId}`,logId:0,itemId:g.itemId,side:'buy',qty:g.qty,total:g.total,netTotal:g.total,free:g.total<=1e-7,marketPriceUsed:g.marketPrice,marketSubtotal:g.baseMarket,tradeAdjustment:g.adjustment,...common}));
    return [...sold,...bought];
  }

  function isLegacyTradeLogTransaction(t) {
    return t?.source!=='Player Trade'&&/\btrade\b/i.test(String(t?.title||''));
  }

  function nextLogPageParams(data,currentParams) {
    const next=data?._metadata?.links?.next;
    if(!next)return null;
    try {
      const u=new URL(next,API+'/user/log');
      const params={...currentParams};
      for(const [k,v] of u.searchParams.entries()){
        if(k==='key'||k==='comment')continue;
        params[k]=v;
      }
      return params;
    } catch(_) { return null; }
  }

  async function inspectActiveKey() {
    const raw=await apiGet('/key/info');
    const info=raw?.info||{};
    const access=info?.access||{};
    const logAccess=access?.log||{};
    const userSelections=Array.isArray(info?.selections?.user)?info.selections.user:[];
    return {
      type:String(access?.type||''),
      level:Number(access?.level)||0,
      hasUserLog:userSelections.includes('log') || Number(access?.level)>=4,
      customLogPermissions:!!logAccess?.custom_permissions,
      availableLogGroups:Array.isArray(logAccess?.available)?logAccess.available.length:0,
      userId:Number(info?.user?.id)||0
    };
  }

  async function probeUserLogs() {
    const data=await apiGet('/user/log',{limit:100});
    return {data,rows:Array.isArray(data?.log)?data.log:[]};
  }

  function rawLogKey(r) {
    return String(r?.id??`${r?.timestamp||0}:${r?.details?.id||0}:${JSON.stringify(r?.data||r?.params||{})}`);
  }

  async function scanLogWindow(baseParams,period,label,found,diagnostics) {
    let cursorTo=period.to;
    let page=0;
    let previousSignature='';
    const seenRaw=new Set();
    while(!state.syncCancel){
      const params={...baseParams,limit:100,to:cursorTo};
      if(period.from>0)params.from=period.from;
      page++;diagnostics.pages++;
      setSyncProgress(`${label} \u00B7 page ${page} \u00B7 back to ${dateStr(Math.max(period.from,Math.min(cursorTo,nowSec())))} \u00B7 ${qty(found.size)} item rows`);
      const data=await apiGet('/user/log',params);
      const rows=Array.isArray(data?.log)?data.log:[];
      if(!rows.length)break;
      const signature=rows.map(rawLogKey).join('|');
      const unseen=rows.filter(r=>{const k=rawLogKey(r);if(seenRaw.has(k))return false;seenRaw.add(k);return true;});
      diagnostics.rawRows+=unseen.length;
      unseen.forEach(r=>{
        const ts=Number(r?.timestamp)||0;
        if(ts<period.from||ts>period.to)return;
        const parsed=parseLogEntry(r);
        diagnostics.parsedRows+=parsed.length;
        parsed.forEach(t=>{found.set(t.id,t);diagnostics.matchedRows++;});
      });
      const timestamps=rows.map(r=>Number(r?.timestamp)).filter(Number.isFinite);
      if(!timestamps.length)break;
      const oldest=Math.min(...timestamps);
      diagnostics.oldestTimestamp=diagnostics.oldestTimestamp?Math.min(diagnostics.oldestTimestamp,oldest):oldest;
      if(period.from>0&&oldest<=period.from)break;
      let nextTo=oldest;
      if(signature===previousSignature)nextTo=oldest-1;
      if(!Number.isFinite(nextTo)||(nextTo>=cursorTo&&signature===previousSignature))break;
      if(period.from>0&&nextTo<period.from)break;
      previousSignature=signature;
      cursorTo=nextTo;
      await sleep(REQUEST_GAP_MS);
    }
  }

  async function fetchCompletedTradeHeaders(period) {
    let params={cat:'finished',limit:100,sort:'DESC',to:period.to};if(period.from>0)params.from=period.from;
    const found=new Map(),seenPages=new Set();let pages=0;
    while(!state.syncCancel){
      pages++;setSyncProgress(`Player trades \u00B7 list page ${pages} \u00B7 ${qty(found.size)} completed trades found`);
      const data=await apiGet('/user/trades',params),rows=Array.isArray(data?.trades)?data.trades:[];
      for(const row of rows){const ts=Number(row?.completed_at||row?.timestamp)||0,id=Number(row?.id)||0;if(id>0&&ts>=period.from&&ts<=period.to)found.set(id,row);}
      const next=nextLogPageParams(data,params);if(!next||!rows.length)break;
      const sig=JSON.stringify(Object.keys(next).sort().map(k=>[k,next[k]]));if(seenPages.has(sig))break;seenPages.add(sig);params=next;
      await sleep(REQUEST_GAP_MS);
    }
    return {headers:[...found.values()],pages};
  }

  async function fetchPlayerTradeHistory(period,userId) {
    const listed=await fetchCompletedTradeHeaders(period),transactions=[];
    let details=0,tradesWithItems=0;
    for(let i=0;i<listed.headers.length&&!state.syncCancel;i++){
      const h=listed.headers[i];
      setSyncProgress(`Player trades \u00B7 ${i+1}/${listed.headers.length} \u00B7 checking detailed trade \u00B7 ${qty(transactions.length)} allocated item rows`);
      const data=await apiGet(`/user/${Number(h.id)}/trade`);details++;
      const rows=parsePlayerTrade(data?.trade,userId);if(rows.length){tradesWithItems++;transactions.push(...rows);}
      if(i<listed.headers.length-1&&!state.syncCancel)await sleep(REQUEST_GAP_MS);
    }
    return {transactions,diagnostics:{tradeHeaders:listed.headers.length,tradeListPages:listed.pages,tradeDetails:details,tradesWithItems,tradeTransactions:transactions.length}};
  }

  async function fetchFilteredHistory(logIds,period) {
    const found=new Map();
    const diagnostics={rawRows:0,parsedRows:0,matchedRows:0,batches:Math.ceil(logIds.length/MAX_LOG_IDS_PER_REQUEST),logTypes:logIds.length,pages:0,oldestTimestamp:0,mode:'filtered',periodFrom:period.from,periodTo:period.to};
    for(let b=0;b<logIds.length;b+=MAX_LOG_IDS_PER_REQUEST){
      if(state.syncCancel)break;
      const ids=logIds.slice(b,b+MAX_LOG_IDS_PER_REQUEST);
      await scanLogWindow({log:ids.join(',')},period,`Historical scan ${Math.floor(b/MAX_LOG_IDS_PER_REQUEST)+1}/${diagnostics.batches}`,found,diagnostics);
      if(!state.syncCancel)await sleep(REQUEST_GAP_MS);
    }
    return {transactions:[...found.values()],diagnostics};
  }

  async function fetchUnfilteredHistory(period) {
    const found=new Map();
    const diagnostics={rawRows:0,parsedRows:0,matchedRows:0,batches:1,logTypes:0,pages:0,oldestTimestamp:0,mode:'unfiltered-fallback',periodFrom:period.from,periodTo:period.to};
    await scanLogWindow({},period,'Compatibility history scan',found,diagnostics);
    return {transactions:[...found.values()],diagnostics};
  }

  async function syncAll() {
    if(state.syncing)return;
    if(!hasApiKey()){state.demo=true;toast('Add a Torn API key in Settings \u2192 API Key to sync real history.');return;}
    const period=selectedPeriodBounds();
    const periodText=period.from>0?`${dateStr(period.from)} \u2013 ${dateStr(Math.min(period.to,nowSec()))}`:'all available history';
    state.syncing=true;state.syncCancel=false;updateFabState();setSyncProgress(`Preparing historical scan for ${periodText}\u2026`);setBusy(true,'Syncing trade history',state.syncProgress,true);
    document.querySelectorAll('#tta-root [data-act="syncQuick"],#tta-root [data-act="syncFull"],#tta-root [data-act="sync"]').forEach(syncBtn=>{syncBtn.disabled=true;});
    await nextPaint();
    try{
      await ensureCatalog();
      setBusyDetail('Verifying API access and log types\u2026');
      const keyInfo=await inspectActiveKey();const probe=await probeUserLogs();const types=relevantLogTypes(await ensureLogTypes(true));
      if(!types.length)throw new Error('No relevant Torn transaction or free-acquisition log types were detected.');
      setSyncProgress(`Scanning the complete selected period: ${periodText}\u2026`);
      let scan=await fetchFilteredHistory(types.map(x=>x.id),period);
      if(scan.diagnostics.rawRows===0){setSyncProgress('Filtered period scan returned no raw rows. Trying compatibility scan for the same dates\u2026');scan=await fetchUnfilteredHistory(period);}
      setSyncProgress(`Scanning completed player trades for ${periodText}\u2026`);
      const tradeScan=await fetchPlayerTradeHistory(period,keyInfo.userId);
      scan.transactions=[...scan.transactions,...tradeScan.transactions];
      scan.diagnostics.keyType=keyInfo.type;scan.diagnostics.keyLevel=keyInfo.level;scan.diagnostics.keySource=keySource();scan.diagnostics.customLogPermissions=keyInfo.customLogPermissions;scan.diagnostics.probeRows=probe.rows.length;Object.assign(scan.diagnostics,tradeScan.diagnostics);
      const fresh=scan.transactions,outside=state.transactions.filter(t=>!isLegacyTradeLogTransaction(t)&&(Number(t.timestamp)<period.from||Number(t.timestamp)>period.to)),merged=new Map(outside.map(x=>[x.id,x]));fresh.forEach(x=>merged.set(x.id,x));
      state.transactions=[...merged.values()].sort((a,b)=>a.timestamp-b.timestamp);save('transactions',state.transactions);resetAnalyticsCache();
      state.sync.lastSync=nowSec();state.sync.firstSyncComplete=!state.syncCancel;state.sync.autoDiscoveryComplete=!state.syncCancel;
      if(!state.syncCancel){const oldCoverage=Number(state.sync.coverageFrom);state.sync.coverageFrom=Number.isFinite(oldCoverage)?Math.min(oldCoverage,period.from):period.from;state.sync.coverageTo=Math.max(Number(state.sync.coverageTo)||0,Math.min(period.to,nowSec()));}
      state.sync.diagnostics=scan.diagnostics;save('sync',state.sync);
      const mode=scan.diagnostics.mode==='unfiltered-fallback'?'compatibility scan':'filtered scan';
      if(state.syncCancel)setSyncProgress(`Sync stopped \u00B7 ${qty(scan.diagnostics.rawRows)} raw logs scanned \u00B7 ${qty(fresh.length)} item rows collected.`);
      else if(!fresh.length)setSyncProgress(`${mode} completed for ${periodText} \u00B7 ${qty(scan.diagnostics.rawRows)} raw logs scanned \u00B7 no recognizable item acquisitions or sales found.`);
      else setSyncProgress(`Historical sync complete for ${periodText} \u00B7 ${qty(fresh.length)} item rows \u00B7 ${qty(scan.diagnostics.tradesWithItems||0)} player trades \u00B7 ${qty(scan.diagnostics.rawRows)} raw logs across ${qty(scan.diagnostics.pages)} log pages.`);
    }catch(e){setSyncProgress(`Sync error: ${e.message}`);}
    finally{state.syncing=false;updateFabState();setBusy(false);render();}
  }

  function demoCatalog(){return[
    {id:206,name:'Xanax',type:'Drug',image:'https://www.torn.com/images/items/206/large.png'},
    {id:258,name:'Jaguar Plushie',type:'Plushie',image:'https://www.torn.com/images/items/258/large.png'},
    {id:266,name:'Monkey Plushie',type:'Plushie',image:'https://www.torn.com/images/items/266/large.png'},
    {id:274,name:'Panda Plushie',type:'Plushie',image:'https://www.torn.com/images/items/274/large.png'},
    {id:260,name:'Wolverine Plushie',type:'Plushie',image:'https://www.torn.com/images/items/260/large.png'}
  ];}
  function demoTracked(){return demoCatalog().slice(0,3);}
  function demoTransactions(){
    const base=nowSec()-28*86400, a=[]; let id=1; const add=(d,item,side,q,total,source)=>a.push({id:`demo${id++}`,timestamp:base+d*86400+36000,itemId:item,side,qty:q,total,netTotal:total,fee:0,source,title:source});
    add(0,206,'buy',30,22800000,'Foreign Market'); add(4,206,'buy',20,15600000,'Item Market'); add(6,206,'sell',18,15300000,'Item Market'); add(10,206,'sell',12,10320000,'Bazaar'); add(17,206,'sell',10,8700000,'Item Market'); add(25,206,'sell',5,4350000,'Item Market');
    add(1,258,'buy',300,3300000,'Foreign Market'); add(8,258,'sell',120,1920000,'Item Market'); add(14,258,'sell',100,1650000,'Bazaar'); add(23,258,'sell',55,935000,'Item Market');
    add(2,266,'buy',220,1980000,'Foreign Market'); add(9,266,'sell',80,1120000,'Item Market'); add(16,266,'sell',90,1305000,'Item Market'); add(26,266,'sell',40,600000,'Bazaar');
    return a;
  }

  // Resumable + incremental sync engine. These later declarations intentionally override
  // the original syncAll() path above while retaining it as a fallback reference.
  const SYNC_JOB_SCHEMA_VERSION = 2;
  // v0.2.0 expands User Log scope from trade/item history to money events.
  // Bump the schema so old trade-only day coverage cannot suppress the first cash-flow backfill.
  const SYNC_CACHE_SCHEMA_VERSION = 3;
  const INCREMENTAL_OVERLAP_SEC = 300;
  // Torn User Logs can appear after an earlier sync has already advanced coverage.
  // Always recheck a recent safety window; deterministic transaction IDs make this duplicate-safe.
  const RECENT_LOG_RECHECK_SEC = 72 * 3600;
  const RECENT_TRADE_RECHECK_SEC = 6 * 3600;
  const STALE_SYNC_JOB_SEC = 5 * 60;
  let resumeBootStarted=false,resumableTxMap=null,resumableTxJob='',syncCacheMem=null;

  function ensureSyncCache() {
    if(syncCacheMem&&Number(syncCacheMem.schema)===SYNC_CACHE_SCHEMA_VERSION)return syncCacheMem;
    let c=load('syncCache',null);
    if(!c||Number(c.schema)!==SYNC_CACHE_SCHEMA_VERSION)c={schema:SYNC_CACHE_SCHEMA_VERSION,verifiedTrades:{},logCoverageFrom:null,logCoverageTo:0,tradeCoverageFrom:null,tradeCoverageTo:0,logDayCoverage:{},tradeDayCoverage:{}};
    if(!c.verifiedTrades||typeof c.verifiedTrades!=='object')c.verifiedTrades={};
    if(!c.logDayCoverage||typeof c.logDayCoverage!=='object')c.logDayCoverage={};
    if(!c.tradeDayCoverage||typeof c.tradeDayCoverage!=='object')c.tradeDayCoverage={};
    let seeded=false;
    for(const t of state.transactions||[]){
      const id=Number(t?.tradeId)||0;
      if(t?.source==='Player Trade'&&id>0&&!c.verifiedTrades[id]){c.verifiedTrades[id]=Number(t.timestamp)||1;seeded=true;}
    }
    for(const t of state.playerTrades||[]){const id=Number(t?.tradeId)||0;if(id>0&&!c.verifiedTrades[id]){c.verifiedTrades[id]=Number(t.timestamp)||1;seeded=true;}}
    syncCacheMem=c;if(seeded)save('syncCache',c);return c;
  }
  function saveSyncCache(){if(syncCacheMem)save('syncCache',syncCacheMem);}
  function dayCoverageMap(c,kind) {
    const key=kind==='trade'?'tradeDayCoverage':'logDayCoverage';
    if(!c[key]||typeof c[key]!=='object')c[key]={};return c[key];
  }
  function dayCoverageContains(range,from,to) {
    return Array.isArray(range)&&Number(range[0])<=from+1&&Number(range[1])>=to-1;
  }
  function recordTctDayCoverage(c,kind,period,serverNow) {
    if(!period)return;
    let from=Number(period.from),to=Math.min(Number(period.to)||serverNow,serverNow);
    if(!(from>=0)||!(to>=from))return;
    // A from=0 all-history scan cannot be expanded from 1970. Once an actual historical
    // floor is known, normal selected-period scans populate per-day coverage from there.
    if(from===0){const fk=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',known=Number(c[fk]);if(!(known>0))return;from=known;}
    const map=dayCoverageMap(c,kind);
    for(let day=tctDayStart(from),last=tctDayStart(to);day<=last;day+=86400){
      const segFrom=Math.max(from,day),segTo=Math.min(to,day+86399),key=String(day),old=map[key];
      const oldFrom=Array.isArray(old)?Number(old[0]):NaN,oldTo=Array.isArray(old)?Number(old[1]):NaN;
      map[key]=[Number.isFinite(oldFrom)?Math.min(oldFrom,segFrom):segFrom,Number.isFinite(oldTo)?Math.max(oldTo,segTo):segTo];
    }
  }
  function incrementalPeriod(period,kind,serverNow=nowSec()) {
    const c=ensureSyncCache(),fromKey=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',toKey=kind==='trade'?'tradeCoverageTo':'logCoverageTo';
    const rawFrom=c[fromKey],coveredFrom=rawFrom==null?NaN:Number(rawFrom),coveredTo=Number(c[toKey])||0;
    const overlap=kind==='trade'?RECENT_TRADE_RECHECK_SEC:RECENT_LOG_RECHECK_SEC;
    serverNow=Math.floor(Number(serverNow)||nowSec());
    const effectiveTo=Math.min(Number(period.to)||serverNow,serverNow),liveEdge=effectiveTo>=serverNow-120;

    // Keep the all-history path efficient. Finite selected periods below use exact TCT-day coverage.
    if(!(Number(period.from)>0)){
      if(Number.isFinite(coveredFrom)&&coveredTo>0){
        if(effectiveTo<=coveredTo){if(!liveEdge)return null;return {from:Math.max(0,serverNow-overlap),to:effectiveTo,incremental:true,recheck:true,missingDays:0};}
        return {from:Math.max(0,coveredTo-overlap),to:effectiveTo,incremental:true,recheck:liveEdge,missingDays:0};
      }
      return {from:0,to:effectiveTo,incremental:false,recheck:false,missingDays:0};
    }

    const from=Math.min(Number(period.from),effectiveTo),map=dayCoverageMap(c,kind);
    let missingFrom=null,missingDays=0;
    for(let day=tctDayStart(from),last=tctDayStart(effectiveTo);day<=last;day+=86400){
      const reqFrom=Math.max(from,day),reqTo=Math.min(effectiveTo,day+86399),range=map[String(day)];
      if(!dayCoverageContains(range,reqFrom,reqTo)){missingDays++;if(missingFrom==null)missingFrom=reqFrom;}
    }
    const candidates=[];
    if(missingFrom!=null)candidates.push(missingFrom);
    if(coveredTo>0&&coveredTo<effectiveTo)candidates.push(Math.max(from,coveredTo-overlap));
    if(liveEdge)candidates.push(Math.max(from,serverNow-overlap));
    if(!candidates.length)return null;
    return {from:Math.max(from,Math.min(...candidates)),to:effectiveTo,incremental:Number.isFinite(coveredFrom)||coveredTo>0,recheck:liveEdge,missingDays};
  }
  function updateSyncCoverage(job) {
    const c=ensureSyncCache(),serverNow=Number(job?.tctNow)||nowSec();
    const apply=(kind,p)=>{
      if(!p)return;const fk=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',tk=kind==='trade'?'tradeCoverageTo':'logCoverageTo';
      const rawOldFrom=c[fk],oldFrom=rawOldFrom==null?NaN:Number(rawOldFrom);if(!p.incremental)c[fk]=Number.isFinite(oldFrom)?Math.min(oldFrom,p.from):p.from;
      c[tk]=Math.max(Number(c[tk])||0,Math.min(p.to,serverNow));recordTctDayCoverage(c,kind,p,serverNow);
    };
    apply('log',job.logScanPeriod);apply('trade',job.tradeScanPeriod);saveSyncCache();
  }
  function isTradeVerified(job,id) {
    id=Number(id)||0;if(!(id>0))return false;
    if((job.verifiedTradeIds||[]).includes(id))return true;
    return !!ensureSyncCache().verifiedTrades[id];
  }
  function markTradeVerified(job,id,ts=0) {
    id=Number(id)||0;if(!(id>0))return;
    const set=new Set((job.verifiedTradeIds||[]).map(Number));set.add(id);job.verifiedTradeIds=[...set];
    if(ts>0)job.verifiedTradeTimes={...(job.verifiedTradeTimes||{}),[id]:Number(ts)||1};
  }
  function commitTradeVerifications(job) {
    const c=ensureSyncCache(),times=job?.verifiedTradeTimes||{};
    for(const id of job?.verifiedTradeIds||[]){const n=Number(id)||0;if(n>0)c.verifiedTrades[n]=Number(times[n])||c.verifiedTrades[n]||1;}
    saveSyncCache();
  }

  function loadSyncJob() {
    const job=load('syncJob',null);
    if(!job||Number(job.schema)!==SYNC_JOB_SCHEMA_VERSION||!job.active||!job.period)return null;
    return job;
  }
  function saveSyncJob(job) {
    try{
      if(job){job.updatedAt=nowSec();localStorage.setItem(NS+'syncJob',JSON.stringify(job));}
      else localStorage.removeItem(NS+'syncJob');
      return true;
    }catch(e){return false;}
  }
  function clearSyncJob(){saveSyncJob(null);}
  function syncJobIsStale(job) {
    if(!job?.period)return false;
    const now=nowSec(),end=Number(job.period.to)||0,updated=Number(job.updatedAt)||0;
    return (end>0&&end<now-STALE_SYNC_JOB_SEC)||(updated>0&&updated<now-6*3600);
  }
  function syncJobMatchesCurrentSelection(job) {
    if(!job?.period)return false;
    const wanted=selectedPeriodBoundsTct(nowSec()),fromDiff=Math.abs((Number(job.period.from)||0)-wanted.from);
    return fromDiff<=STALE_SYNC_JOB_SEC&&!syncJobIsStale(job);
  }
  function discardStaleSyncJob(job) {
    if(!job)return;
    commitTradeVerifications(job);
    abandonResumableMarkers(job);
    clearSyncJob();
  }
  function syncJobCancelled(job){return !!(state.syncCancel||job?.cancelled);}
  function formatEtaDuration(ms) {
    let sec=Math.max(0,Math.round((Number(ms)||0)/1000));
    if(sec<60)return `${Math.max(1,sec)}s`;
    const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
    if(h>0)return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }
  function etaUnitTiming(job,phase,unit,defaultMs=1150) {
    const now=Date.now();if(!job.etaStats||typeof job.etaStats!=='object')job.etaStats={};let st=job.etaStats[phase]||{lastAt:now,lastUnit:Number(unit)||0,msPerUnit:0,samples:0};
    const u=Number(unit)||0,du=u-(Number(st.lastUnit)||0),dt=now-(Number(st.lastAt)||now);
    if(du>0&&dt>50&&dt<30000){const sample=dt/du+REQUEST_GAP_MS;st.msPerUnit=st.msPerUnit>0?st.msPerUnit*.72+sample*.28:sample;st.samples=(Number(st.samples)||0)+du;}
    st.lastAt=now;st.lastUnit=u;job.etaStats[phase]=st;return st.msPerUnit>0?st.msPerUnit:defaultMs;
  }
  function priorFullSyncDiagnostics() {const d=state.sync?.diagnostics;return d&&d.syncMode==='full'?d:(d||{});}
  function fullResyncProgressMetrics(job) {
    if(!job||job.syncMode!=='full')return null;const phase=String(job.phase||'setup'),d=job.diagnostics||{},prior=priorFullSyncDiagnostics();let pct=1,eta=null,etaNote='estimating time left';
    const pageMs=etaUnitTiming(job,phase,phase==='logs-filtered'||phase==='logs-fallback'?Number(d.pages)||0:phase==='logs-abroad-verify'?Number(d.abroadVerifyPages)||0:phase==='trades-list'?Number(d.tradeListPages)||0:phase==='trade-details'?Number(job.tradeDetailIndex)||0:0,1150);
    const priorTradePages=Math.max(1,Number(prior.tradeListPages)||1),priorTrades=Math.max(0,Number(prior.tradeHeaders)||0),priorAbroadPages=Math.max(1,Number(prior.abroadVerifyPages)||1),detailMs=phase==='trade-details'?pageMs:1150;
    if(phase==='setup'){pct=2;etaNote='preparing scan';}
    else if(phase==='logs-filtered'){
      const totalBatches=Math.max(1,Math.ceil((job.logTypeIds||[]).length/MAX_LOG_IDS_PER_REQUEST)),doneBatches=Math.max(0,Math.min(totalBatches,Number(job.logBatchIndex)||0)),currentPages=Math.max(0,Number(job.logPage)||0),pagesDone=Math.max(0,Number(d.pages)||0),priorPages=Math.max(totalBatches,Number(prior.pages)||0);
      let predictedTotalPages=priorPages;if(doneBatches>0){const completedPages=Math.max(1,pagesDone-currentPages),avg=completedPages/doneBatches;predictedTotalPages=Math.max(pagesDone+1,avg*totalBatches);predictedTotalPages=priorPages>0?predictedTotalPages*.72+priorPages*.28:predictedTotalPages;}else if(!(priorPages>0))predictedTotalPages=Math.max(pagesDone+totalBatches*4,totalBatches*5);
      const remainingPages=Math.max(0,predictedTotalPages-pagesDone),futureMs=priorAbroadPages*1150+priorTradePages*1150+Math.max(priorTrades,10)*1150+4000;eta=remainingPages*pageMs+futureMs;pct=5+55*Math.min(1,pagesDone/Math.max(1,predictedTotalPages));etaNote=doneBatches>0||priorPages>0?`~${formatEtaDuration(eta)} left`:'learning history depth';
    }else if(phase==='logs-fallback'){
      const pages=Math.max(0,Number(d.pages)||0),priorPages=Math.max(1,Number(prior.pages)||10),remaining=Math.max(1,priorPages-pages);pct=60+10*Math.min(.95,pages/Math.max(1,pages+remaining));eta=remaining*pageMs+priorAbroadPages*1150+priorTradePages*1150+Math.max(priorTrades,10)*1150+4000;etaNote=`~${formatEtaDuration(eta)} left`;
    }else if(phase==='logs-abroad-verify'){
      const pages=Math.max(0,Number(d.abroadVerifyPages)||0),pred=Math.max(pages+1,priorAbroadPages),remaining=Math.max(0,pred-pages);pct=70+6*Math.min(.95,pages/Math.max(1,pred));eta=remaining*pageMs+priorTradePages*1150+Math.max(priorTrades,10)*1150+4000;etaNote=`~${formatEtaDuration(eta)} left`;
    }else if(phase==='trades-list'){
      const pages=Math.max(0,Number(d.tradeListPages)||0),pred=Math.max(pages+1,priorTradePages),remainingPages=Math.max(0,pred-pages),known=Math.max((job.tradeHeaders||[]).length,priorTrades);pct=76+8*Math.min(.95,pages/Math.max(1,pred));eta=remainingPages*pageMs+Math.max(known,5)*1150+3500;etaNote=`~${formatEtaDuration(eta)} left`;
    }else if(phase==='trade-details'){
      const total=Math.max(0,(job.tradeHeaders||[]).length),done=Math.max(0,Number(job.tradeDetailIndex)||0),remaining=Math.max(0,total-done);pct=84+13*(total>0?Math.min(1,done/total):1);eta=remaining*detailMs+3500;etaNote=total>0?`~${formatEtaDuration(eta)} left`:'finishing trade scan';
    }else if(phase==='finalize'){pct=99;eta=2500;etaNote='~3s left';}
    pct=Math.max(Number(job.progressPercent)||0,Math.min(99,pct));job.progressPercent=pct;return {percent:pct,etaMs:eta,etaNote};
  }
  function decorateSyncProgress(job,progress) {
    const text=String(progress||''),m=fullResyncProgressMetrics(job);if(!m)return text;const pc=Math.max(0,Math.min(99,Math.round(m.percent))),eta=m.etaNote||(m.etaMs!=null?`~${formatEtaDuration(m.etaMs)} left`:'estimating time left');return `${pc}% \u00B7 ${eta} \u00B7 ${text}`;
  }
  function checkpointSyncJob(job,progress='') {
    if(progress){job.progressRaw=String(progress);job.progress=decorateSyncProgress(job,job.progressRaw);if(job?.background)state.backgroundSyncProgress=job.progress;else setSyncProgress(job.progress);}
    if(!saveSyncJob(job))throw new Error('Unable to save the resumable sync checkpoint. Free some browser storage and try again.');
  }
  function stripSyncRunMarkers() {
    let changed=false;
    state.transactions=(state.transactions||[]).map(t=>{
      if(!t||!Object.prototype.hasOwnProperty.call(t,'syncRunId'))return t;
      const x={...t};delete x.syncRunId;changed=true;return x;
    });
    if(changed){localStorage.setItem(NS+'transactions',JSON.stringify(state.transactions));resetAnalyticsCache();}
    resumableTxMap=null;resumableTxJob='';
  }
  function checkpointTransactionRows(job,rows) {
    if(!rows?.length)return 0;
    if(!resumableTxMap||resumableTxJob!==job.id){
      resumableTxMap=new Map((state.transactions||[]).filter(Boolean).map(x=>[String(x.id),x]));
      resumableTxJob=job.id;
    }
    let added=0;
    for(const row of rows){
      if(row?.id==null)continue;const key=String(row.id);
      if(resumableTxMap.has(key)){if(job.diagnostics)job.diagnostics.existingRowsSkipped=(Number(job.diagnostics.existingRowsSkipped)||0)+1;continue;}
      resumableTxMap.set(key,{...row,syncRunId:job.id});added++;
    }
    if(!added)return 0;
    const next=[...resumableTxMap.values()];localStorage.setItem(NS+'transactions',JSON.stringify(next));state.transactions=next;return added;
  }
  function finalizeResumableTransactions(job) {
    let freshCount=0;const next=[];
    for(const row of state.transactions||[]){
      if(!row||isLegacyTradeLogTransaction(row))continue;
      if(row.syncRunId===job.id)freshCount++;
      if(Object.prototype.hasOwnProperty.call(row,'syncRunId')){const x={...row};delete x.syncRunId;next.push(x);}else next.push(row);
    }
    next.sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)||String(a.id).localeCompare(String(b.id)));
    localStorage.setItem(NS+'transactions',JSON.stringify(next));state.transactions=next;resumableTxMap=null;resumableTxJob='';resetAnalyticsCache();return freshCount;
  }
  function abandonResumableMarkers(job) {
    let changed=false;
    state.transactions=(state.transactions||[]).map(row=>{
      if(row?.syncRunId!==job?.id)return row;
      const x={...row};delete x.syncRunId;changed=true;return x;
    });
    if(changed)localStorage.setItem(NS+'transactions',JSON.stringify(state.transactions));
    resumableTxMap=null;resumableTxJob='';resetAnalyticsCache();
  }
  function newSyncDiagnostics(job,mode,logTypes,batches) {
    return {rawRows:0,parsedRows:0,matchedRows:0,cashFlowRows:0,playerTransferRows:0,unrecognizedFinancialRows:0,existingRowsSkipped:0,batches,logTypes,pages:0,oldestTimestamp:0,latestRawLogTimestamp:0,latestParsedAcquisitionTimestamp:0,mode,syncMode:job.syncMode||'quick',periodFrom:job.period.from,periodTo:job.period.to,tradeHeaders:0,tradeListPages:0,tradeDetails:0,tradeDetailsSkipped:0,playerTradeEvents:0,tradesWithItems:0,tradeTransactions:0,tradeSoldQty:0,tradeBoughtQty:0,foreignBuyRows:0,foreignBuyQty:0,abroadVerifyPages:0,abroadVerifyRawRows:0,abroadVerifyParsedRows:0,abroadVerifyQty:0,abroadVerifyLatestRawTimestamp:0,recentLogRecheckHours:RECENT_LOG_RECHECK_SEC/3600,recentTradeRecheckHours:RECENT_TRADE_RECHECK_SEC/3600,tctNow:Number(job.tctNow)||0,missingLogDays:Number(job.logScanPeriod?.missingDays)||0,missingTradeDays:Number(job.tradeScanPeriod?.missingDays)||0,incrementalLogs:!!job.logScanPeriod?.incremental,incrementalTrades:!!job.tradeScanPeriod?.incremental};
  }
  function createResumableSyncJob(syncMode='quick',background=false) {
    stripSyncRunMarkers();
    const mode=syncMode==='full'?'full':'quick',now=nowSec(),last=Number(state.sync?.lastSync)||0;
    const initialFrom=mode==='full'?0:(last>0?Math.min(last,now):tctDayStart(now));
    const period={from:initialFrom,to:now},periodText=mode==='full'?'all available history':`${tctDateTimeStr(initialFrom)} \u2013 ${tctDateTimeStr(now)} TCT`;
    const scan={from:period.from,to:period.to,incremental:mode==='quick',recheck:false,missingDays:0};
    const job={schema:SYNC_JOB_SCHEMA_VERSION,background:!!background,id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,syncMode:mode,active:true,cancelled:false,createdAt:now,updatedAt:now,period,periodText,logScanPeriod:{...scan},tradeScanPeriod:{...scan},phase:'setup',progress:mode==='full'?`Preparing full resync from the beginning\u2026`:`Preparing quick sync from ${tctDateTimeStr(initialFrom)} TCT\u2026`,resumedCount:0,logTypeIds:[],logMode:'filtered',logBatchIndex:0,logCursorTo:period.to,logPage:0,logPreviousSignature:'',userId:0,diagnostics:null,tradeHeaders:[],tradeListParams:null,tradeListSeen:[],tradeDetailIndex:0,verifiedTradeIds:[],verifiedTradeTimes:{},progressPercent:0,progressActiveMs:0,progressClockAt:Date.now(),progressEtaMs:0};
    checkpointSyncJob(job,job.progress);return job;
  }

  function resetHistoryForFullResync() {
    stripSyncRunMarkers();
    state.transactions=[];state.cashFlows=[];state.playerTransfers=[];state.playerTrades=[];state.itemConsumptions=[];state.unrecognizedFinancial=[];
    save('transactions',[]);save('cashFlows',[]);save('playerTransfers',[]);save('playerTrades',[]);save('itemConsumptions',[]);save('unrecognizedFinancial',[]);
    localStorage.removeItem(NS+'syncCache');syncCacheMem=null;
    state.sync={...(state.sync||{}),lastSync:0,coverageFrom:0,coverageTo:0,firstSyncComplete:false,autoDiscoveryComplete:false};save('sync',state.sync);
    resumableTxMap=null;resumableTxJob='';resetAnalyticsCache();
  }
  async function syncApiGet(path,params={}) {
    let last;
    for(let attempt=0;attempt<3;attempt++){
      try{return await apiGet(path,params);}catch(e){last=e;if(attempt>=2)break;setSyncProgress(`Temporary API error \u00B7 retry ${attempt+2}/3 \u00B7 ${e.message}`);await sleep(1200*(attempt+1));}
    }
    throw last;
  }
  function advanceResumableLogBatch(job) {
    const p=job.logScanPeriod||job.period;job.logBatchIndex=(Number(job.logBatchIndex)||0)+1;job.logCursorTo=p.to;job.logPage=0;job.logPreviousSignature='';
  }
  async function runResumableLogPhase(job,mode) {
    const scanPeriod=job.logScanPeriod||job.period,filtered=mode==='filtered',ids=filtered?(job.logTypeIds||[]):[],totalBatches=filtered?Math.ceil(ids.length/MAX_LOG_IDS_PER_REQUEST):1;
    if(job.logMode!==mode){job.logMode=mode;job.logBatchIndex=0;job.logCursorTo=scanPeriod.to;job.logPage=0;job.logPreviousSignature='';}
    while((Number(job.logBatchIndex)||0)<totalBatches&&!syncJobCancelled(job)){
      const batchIndex=Number(job.logBatchIndex)||0,batchIds=filtered?ids.slice(batchIndex*MAX_LOG_IDS_PER_REQUEST,(batchIndex+1)*MAX_LOG_IDS_PER_REQUEST):[];
      const cursor=Number(job.logCursorTo)||scanPeriod.to,page=(Number(job.logPage)||0)+1,label=filtered?`Historical scan ${batchIndex+1}/${totalBatches}`:'Compatibility history scan';
      checkpointSyncJob(job,`${label} \u00B7 page ${page} \u00B7 back to ${dateStr(Math.max(scanPeriod.from,Math.min(cursor,nowSec())))}`);
      const params={limit:100,to:cursor};if(scanPeriod.from>0)params.from=scanPeriod.from;if(filtered)params.log=batchIds.join(',');
      const data=await syncApiGet('/user/log',params),rows=Array.isArray(data?.log)?data.log:[];
      job.diagnostics.pages=(Number(job.diagnostics.pages)||0)+1;
      if(!rows.length){advanceResumableLogBatch(job);checkpointSyncJob(job,`${label} \u00B7 page ${page} complete`);continue;}
      const parsedRows=[];
      job.diagnostics.rawRows=(Number(job.diagnostics.rawRows)||0)+rows.length;
      for(const r of rows){
        const ts=Number(r?.timestamp)||0;if(ts<scanPeriod.from||ts>scanPeriod.to)continue;
        if(ts>Number(job.diagnostics.latestRawLogTimestamp||0))job.diagnostics.latestRawLogTimestamp=ts;
        const parsed=parseLogEntry(r);job.diagnostics.parsedRows+=parsed.length;job.diagnostics.matchedRows+=parsed.length;for(const t of parsed){if(t.side==='buy'){job.diagnostics.latestParsedAcquisitionTimestamp=Math.max(Number(job.diagnostics.latestParsedAcquisitionTimestamp)||0,Number(t.timestamp)||0);}if(t.side==='buy'&&t.source==='Foreign Market'){job.diagnostics.foreignBuyRows=(Number(job.diagnostics.foreignBuyRows)||0)+1;job.diagnostics.foreignBuyQty=(Number(job.diagnostics.foreignBuyQty)||0)+(Number(t.qty)||0);}}parsedRows.push(...parsed);
        const transferRows=parsePlayerTransferEntry(r);job.diagnostics.playerTransferRows=(Number(job.diagnostics.playerTransferRows)||0)+transferRows.length;checkpointPlayerTransferRows(transferRows);
        const consumptionRows=parseItemConsumptionEntry(r);job.diagnostics.itemConsumptionRows=(Number(job.diagnostics.itemConsumptionRows)||0)+consumptionRows.length;checkpointItemConsumptionRows(consumptionRows);
        const cashRows=parseCashFlowEntry(r,parsed);job.diagnostics.cashFlowRows=(Number(job.diagnostics.cashFlowRows)||0)+cashRows.length;checkpointCashFlowRows(cashRows);checkpointUnrecognizedFinancial(r,cashRows.length>0||transferRows.length>0||consumptionRows.length>0||parsed.length>0);if(!cashRows.length&&!transferRows.length&&!parsed.length&&unrecognizedRowFor(r))job.diagnostics.unrecognizedFinancialRows=(Number(job.diagnostics.unrecognizedFinancialRows)||0)+1;
      }
      checkpointTransactionRows(job,parsedRows);
      const timestamps=rows.map(r=>Number(r?.timestamp)).filter(Number.isFinite);
      if(!timestamps.length){advanceResumableLogBatch(job);checkpointSyncJob(job,`${label} \u00B7 page ${page} complete`);continue;}
      const oldest=Math.min(...timestamps),signature=rows.map(rawLogKey).join('|');
      job.diagnostics.oldestTimestamp=job.diagnostics.oldestTimestamp?Math.min(job.diagnostics.oldestTimestamp,oldest):oldest;
      let done=scanPeriod.from>0&&oldest<=scanPeriod.from,nextTo=oldest;
      if(signature===job.logPreviousSignature)nextTo=oldest-1;
      if(!Number.isFinite(nextTo)||(nextTo>=cursor&&signature===job.logPreviousSignature)||(scanPeriod.from>0&&nextTo<scanPeriod.from))done=true;
      if(done)advanceResumableLogBatch(job);else{job.logCursorTo=nextTo;job.logPage=page;job.logPreviousSignature=signature;}
      checkpointSyncJob(job,`${label} \u00B7 ${qty(job.diagnostics.matchedRows||0)} item rows checkpointed`);
      if(!syncJobCancelled(job))await sleep(REQUEST_GAP_MS);
    }
    return !syncJobCancelled(job);
  }
  async function runAbroadBuyVerification(job) {
    const serverNow=Number(job.tctNow)||nowSec();
    const verifyFrom=job.syncMode==='full'?0:(Number(job.period?.from)>0?Number(job.period.from):tctDayStart(serverNow));
    const verifyTo=Math.min(Number(job.period?.to)||serverNow,serverNow);
    if(!(verifyTo>=verifyFrom)){job.phase='trades-list';checkpointSyncJob(job,'Abroad Buy verification skipped \u00B7 no overlapping selected period.');return true;}
    let cursor=verifyTo,page=0,previousSignature='';
    while(!syncJobCancelled(job)){
      page++;checkpointSyncJob(job,`Abroad Buy verification \u00B7 page ${page} \u00B7 ${tctDateStr(verifyFrom)} \u2013 ${tctDateStr(Math.min(cursor,serverNow))} TCT`);
      const data=await syncApiGet('/user/log',{limit:100,log:'4201',from:verifyFrom,to:cursor}),rows=Array.isArray(data?.log)?data.log:[];
      job.diagnostics.abroadVerifyPages=(Number(job.diagnostics.abroadVerifyPages)||0)+1;
      job.diagnostics.abroadVerifyRawRows=(Number(job.diagnostics.abroadVerifyRawRows)||0)+rows.length;
      if(!rows.length)break;
      const parsedRows=[];
      for(const r of rows){
        const ts=Number(r?.timestamp)||0;if(ts<verifyFrom||ts>verifyTo)continue;
        job.diagnostics.abroadVerifyLatestRawTimestamp=Math.max(Number(job.diagnostics.abroadVerifyLatestRawTimestamp)||0,ts);
        job.diagnostics.latestRawLogTimestamp=Math.max(Number(job.diagnostics.latestRawLogTimestamp)||0,ts);
        const parsed=parseLogEntry(r).filter(t=>t.side==='buy'&&t.source==='Foreign Market');
        for(const t of parsed){
          job.diagnostics.abroadVerifyParsedRows=(Number(job.diagnostics.abroadVerifyParsedRows)||0)+1;
          job.diagnostics.abroadVerifyQty=(Number(job.diagnostics.abroadVerifyQty)||0)+(Number(t.qty)||0);
          job.diagnostics.latestParsedAcquisitionTimestamp=Math.max(Number(job.diagnostics.latestParsedAcquisitionTimestamp)||0,Number(t.timestamp)||0);
        }
        parsedRows.push(...parsed);
      }
      checkpointTransactionRows(job,parsedRows);
      const timestamps=rows.map(r=>Number(r?.timestamp)).filter(Number.isFinite);if(!timestamps.length)break;
      const oldest=Math.min(...timestamps),signature=rows.map(rawLogKey).join('|');
      if(oldest<=verifyFrom)break;
      let nextTo=oldest;if(signature===previousSignature)nextTo=oldest-1;
      if(!Number.isFinite(nextTo)||nextTo>=cursor)break;
      previousSignature=signature;cursor=nextTo;await sleep(REQUEST_GAP_MS);
    }
    job.phase='trades-list';checkpointSyncJob(job,`Abroad Buy verification complete \u00B7 ${qty(job.diagnostics.abroadVerifyRawRows||0)} raw 4201 logs \u00B7 ${qty(job.diagnostics.abroadVerifyQty||0)} overseas item(s) parsed.`);return true;
  }

  function compactTradeHeader(row) {
    const id=Number(row?.id)||0,ts=Number(row?.completed_at||row?.timestamp)||0,n=Number(row?.items);
    return id>0&&ts>0?{id,completed_at:ts,items:Number.isFinite(n)?n:null}:null;
  }
  async function runResumableTradeList(job) {
    const scanPeriod=job.tradeScanPeriod;
    if(!scanPeriod){job.phase='finalize';checkpointSyncJob(job,'Player trades already fully covered \u00B7 no trade API requests needed.');return true;}
    const found=new Map((job.tradeHeaders||[]).map(x=>[Number(x.id),x]));
    let params=job.tradeListParams||{cat:'finished',limit:100,sort:'DESC',to:scanPeriod.to};if(scanPeriod.from>0&&!('from'in params))params.from=scanPeriod.from;
    const seen=new Set(job.tradeListSeen||[]);
    while(!syncJobCancelled(job)){
      const page=(Number(job.diagnostics.tradeListPages)||0)+1;checkpointSyncJob(job,`Player trades \u00B7 list page ${page} \u00B7 ${qty(found.size)} completed trades checkpointed`);
      const data=await syncApiGet('/user/trades',params),rows=Array.isArray(data?.trades)?data.trades:[];job.diagnostics.tradeListPages=page;
      for(const row of rows){const h=compactTradeHeader(row);if(h&&h.completed_at>=scanPeriod.from&&h.completed_at<=scanPeriod.to)found.set(h.id,h);}
      job.tradeHeaders=[...found.values()];job.diagnostics.tradeHeaders=job.tradeHeaders.length;
      const next=nextLogPageParams(data,params);
      if(!next||!rows.length){job.tradeListParams=null;job.phase='trade-details';job.tradeDetailIndex=Number(job.tradeDetailIndex)||0;checkpointSyncJob(job,`Player trades \u00B7 ${qty(job.tradeHeaders.length)} completed trades listed`);return true;}
      const sig=JSON.stringify(Object.keys(next).sort().map(k=>[k,next[k]]));
      if(seen.has(sig)){job.tradeListParams=null;job.phase='trade-details';checkpointSyncJob(job,`Player trades \u00B7 repeated page stopped safely \u00B7 ${qty(job.tradeHeaders.length)} trades listed`);return true;}
      seen.add(sig);job.tradeListSeen=[...seen].slice(-80);job.tradeListParams=next;checkpointSyncJob(job,`Player trades \u00B7 list page ${page} saved`);await sleep(REQUEST_GAP_MS);
    }
    return false;
  }
  async function runResumableTradeDetails(job) {
    const headers=job.tradeHeaders||[];
    while((Number(job.tradeDetailIndex)||0)<headers.length&&!syncJobCancelled(job)){
      const i=Number(job.tradeDetailIndex)||0,h=headers[i];
      if(isTradeVerified(job,h.id)){
        job.diagnostics.tradeDetailsSkipped=(Number(job.diagnostics.tradeDetailsSkipped)||0)+1;job.tradeDetailIndex=i+1;
        checkpointSyncJob(job,`Player trades \u00B7 ${i+1}/${headers.length} \u00B7 already verified, skipped`);continue;
      }
      checkpointSyncJob(job,`Player trades \u00B7 ${i+1}/${headers.length} \u00B7 fetching missing detailed trade #${Number(h.id)}`);
      const data=await syncApiGet(`/user/${Number(h.id)}/trade`);job.diagnostics.tradeDetails=(Number(job.diagnostics.tradeDetails)||0)+1;
      const tradeEvent=parsePlayerTradeEvent(data?.trade,job.userId);if(tradeEvent){checkpointPlayerTradeEvents([tradeEvent]);job.diagnostics.playerTradeEvents=(Number(job.diagnostics.playerTradeEvents)||0)+1;}
      const rows=parsePlayerTrade(data?.trade,job.userId);
      const soldRows=rows.filter(x=>x.side==='sell'),boughtRows=rows.filter(x=>x.side==='buy');
      if(rows.length){
        job.diagnostics.tradesWithItems=(Number(job.diagnostics.tradesWithItems)||0)+1;
        job.diagnostics.tradeTransactions=(Number(job.diagnostics.tradeTransactions)||0)+rows.length;
        job.diagnostics.tradeSoldQty=(Number(job.diagnostics.tradeSoldQty)||0)+soldRows.reduce((n,x)=>n+(Number(x.qty)||0),0);
        job.diagnostics.tradeBoughtQty=(Number(job.diagnostics.tradeBoughtQty)||0)+boughtRows.reduce((n,x)=>n+(Number(x.qty)||0),0);
        checkpointTransactionRows(job,rows);
      }
      markTradeVerified(job,h.id,h.completed_at);job.tradeDetailIndex=i+1;checkpointSyncJob(job,`Player trades \u00B7 ${i+1}/${headers.length} \u00B7 detail verified and cached`);
      if(job.tradeDetailIndex<headers.length&&!syncJobCancelled(job))await sleep(REQUEST_GAP_MS);
    }
    if(!syncJobCancelled(job)){job.phase='finalize';checkpointSyncJob(job,'Finalizing cached history and FIFO inputs\u2026');return true;}return false;
  }
  async function refreshLiveSyncBounds(job) {
    let serverNow=nowSec();
    try{const t=await apiGet('/user/timestamp');serverNow=Number(t?.timestamp)||serverNow;}catch(_){}
    const mode=job.syncMode==='full'?'full':'quick',last=Number(state.sync?.lastSync)||0;
    const from=mode==='full'?0:(last>0?Math.min(last,serverNow):tctDayStart(serverNow));
    job.tctNow=serverNow;job.tctNowLabel=tctDateTimeStr(serverNow);
    job.period={from,to:serverNow};
    job.periodText=mode==='full'?'all available history':`${tctDateTimeStr(from)} \u2013 ${tctDateTimeStr(serverNow)} TCT`;
    const scan={from,to:serverNow,incremental:mode==='quick',recheck:false,missingDays:0};
    job.logScanPeriod={...scan};job.tradeScanPeriod={...scan};
    job.logCursorTo=serverNow;job.tradeListParams=null;
  }
  async function prepareResumableSync(job) {
    await refreshLiveSyncBounds(job);
    await ensureCatalog();setBusyDetail(job.syncMode==='full'?'Verifying API access for full-history rebuild\u2026':'Verifying API access for quick last-sync update\u2026');
    const keyInfo=await inspectActiveKey();if(!keyInfo.hasUserLog)throw new Error('This API key does not include User \u2192 Log access.');
    if(job.syncMode==='full'&&!job.fullResetDone){resetHistoryForFullResync();job.fullResetDone=true;checkpointSyncJob(job,'API access confirmed \u00B7 local discovered history cleared \u00B7 starting full rebuild\u2026');}
    let types=[];if(job.logScanPeriod)types=relevantLogTypes(await ensureLogTypes(false));
    if(job.logScanPeriod&&!types.length)throw new Error('No relevant Torn transaction or free-acquisition log types were detected.');
    job.userId=keyInfo.userId;job.logTypeIds=types.map(x=>Number(x.id)).filter(x=>x>0);job.logMode='filtered';job.logBatchIndex=0;job.logCursorTo=job.logScanPeriod?.to||job.period.to;job.logPage=0;job.logPreviousSignature='';
    job.diagnostics=newSyncDiagnostics(job,'filtered',job.logTypeIds.length,job.logScanPeriod?Math.ceil(job.logTypeIds.length/MAX_LOG_IDS_PER_REQUEST):0);
    job.diagnostics.keyType=keyInfo.type;job.diagnostics.keyLevel=keyInfo.level;job.diagnostics.keySource=keySource();job.diagnostics.customLogPermissions=keyInfo.customLogPermissions;job.diagnostics.probeRows=0;
    if(job.logScanPeriod){const scanLabel=job.syncMode==='full'?'Full resync from beginning':'Quick sync from last successful sync';job.phase='logs-filtered';checkpointSyncJob(job,`${scanLabel} \u00B7 ${job.logScanPeriod.from>0?tctDateTimeStr(job.logScanPeriod.from)+' \u2013 ':''}${tctDateTimeStr(Math.min(job.logScanPeriod.to,job.tctNow||nowSec()))} TCT`);}
    else{job.phase='trades-list';checkpointSyncJob(job,'Normal sale logs already fully covered \u00B7 skipping log scan.');}
  }
  function finishResumableSync(job) {
    const freshCount=finalizeResumableTransactions(job),d=job.diagnostics||{},serverNow=Number(job.tctNow)||nowSec();commitTradeVerifications(job);updateSyncCoverage(job);
    state.sync.lastSync=serverNow;state.sync.firstSyncComplete=true;state.sync.autoDiscoveryComplete=true;
    const oldCoverage=Number(state.sync.coverageFrom);state.sync.coverageFrom=Number.isFinite(oldCoverage)?Math.min(oldCoverage,job.period.from):job.period.from;state.sync.coverageTo=Math.max(Number(state.sync.coverageTo)||0,Math.min(job.period.to,serverNow));state.sync.diagnostics=d;save('sync',state.sync);
    const repaired=Number(d.missingLogDays)||0;
    if(!freshCount)setSyncProgress(`${job.syncMode==='full'?'Full Resync':'Quick Sync'} checked through ${tctDateTimeStr(serverNow)} TCT \u00B7 ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);
    else setSyncProgress(`${job.syncMode==='full'?'Full Resync':'Quick Sync'} checked through ${tctDateTimeStr(serverNow)} TCT \u00B7 ${qty(freshCount)} new item rows \u00B7 ${qty(d.foreignBuyQty||0)} overseas-acquired item(s) seen \u00B7 ${qty(d.existingRowsSkipped||0)} existing rows skipped.`);
    job.active=false;job.phase='done';clearSyncJob();
  }
  async function runResumableSync(job,resumed=false,options={}) {
    const background=!!(options?.background||job?.background);
    if(state.syncing||state.backgroundSyncing)return;
    if(background)state.backgroundSyncing=true;else state.syncing=true;
    state.syncCancel=false;if(!background)updateFabState();
    if(resumed){const prior=String(job.progress||job.periodText).replace(/^Resumed after page reload \u00B7 /,'');job.resumedCount=(Number(job.resumedCount)||0)+1;checkpointSyncJob(job,`Resumed after page reload \u00B7 ${prior}`);}
    else setSyncProgress(job.progress||`Preparing historical scan for ${job.periodText}\u2026`);
    if(!background){
      setBusy(true,resumed?'Resuming financial sync':(job.syncMode==='full'?'Full history resync':'Quick financial sync'),state.syncProgress,true);
      const syncBtn=document.querySelector('#tta-root [data-act="sync"]');if(syncBtn){syncBtn.disabled=true;syncBtn.innerHTML='<span class="tta-sync"><span class="tta-spinner"></span>Syncing</span>';}
      if(state.open)await nextPaint();
    }
    try{
      while(!syncJobCancelled(job)&&job.active){
        if(job.phase==='setup')await prepareResumableSync(job);
        else if(job.phase==='logs-filtered'){
          await runResumableLogPhase(job,'filtered');if(syncJobCancelled(job))break;
          if((Number(job.diagnostics?.rawRows)||0)===0&&!job.logScanPeriod?.incremental){job.phase='logs-fallback';job.logMode='unfiltered';job.logBatchIndex=0;job.logCursorTo=job.logScanPeriod?.to||job.period.to;job.logPage=0;job.logPreviousSignature='';job.diagnostics=newSyncDiagnostics(job,'unfiltered-fallback',0,1);checkpointSyncJob(job,'Baseline filtered scan returned no raw rows \u00B7 starting compatibility scan\u2026');}
          else{job.phase='logs-abroad-verify';checkpointSyncJob(job,'Verifying Foreign/Abroad Buy logs independently\u2026');}
        }
        else if(job.phase==='logs-fallback'){await runResumableLogPhase(job,'unfiltered');if(syncJobCancelled(job))break;job.phase='logs-abroad-verify';checkpointSyncJob(job,'Verifying Foreign/Abroad Buy logs independently\u2026');}
        else if(job.phase==='logs-abroad-verify')await runAbroadBuyVerification(job);
        else if(job.phase==='trades-list')await runResumableTradeList(job);
        else if(job.phase==='trade-details')await runResumableTradeDetails(job);
        else if(job.phase==='finalize'){await refreshFinancialSnapshot();await refreshCompanyDailyAdjustment(job.userId,Number(job.tctNow)||nowSec());finishResumableSync(job);break;}
        else{job.phase='setup';checkpointSyncJob(job,'Repairing an unknown sync checkpoint\u2026');}
      }
      if(syncJobCancelled(job)){
        job.cancelled=true;commitTradeVerifications(job);abandonResumableMarkers(job);clearSyncJob();setSyncProgress(`Sync stopped \u00B7 verified trade details remain cached \u00B7 partial new rows kept safely.`);
      }
    }catch(e){
      job.lastError=String(e?.message||e);job.lastErrorAt=nowSec();
      if(background){
        try{commitTradeVerifications(job);abandonResumableMarkers(job);clearSyncJob();}catch(_){}
        state.backgroundSyncProgress=`Background Quick Sync skipped \u00B7 ${job.lastError}`;
      }else{
        try{checkpointSyncJob(job,`Sync paused at saved checkpoint \u00B7 ${job.lastError} \u00B7 tap Sync or reload a Torn page to retry.`);}catch(saveError){setSyncProgress(`Sync stopped: ${saveError.message}`);clearSyncJob();abandonResumableMarkers(job);}
      }
    }
    finally{
      if(background){state.backgroundSyncing=false;}
      else{state.syncing=false;updateFabState();setBusy(false);render();}
    }
  }
  async function syncAll(options={}) {
    const background=!!options?.background;
    if(background){if(state.syncing||state.backgroundSyncing)return;}
    else{if(state.syncing)return;if(state.backgroundSyncing){toast('Background Quick Sync is already updating the latest data.');return;}}
    if(!hasApiKey()){if(!background){state.demo=true;toast('Add a Torn API key in Settings \u2192 API Key to sync real history.');}return;}
    const requestedMode=options?.mode==='full'?'full':'quick';
    let job=options?.job||loadSyncJob();
    if(background&&job&&!options?.job)return;
    if(job?.background&&!background&&!options?.job){discardStaleSyncJob(job);job=null;}
    if(job?.cancelled){abandonResumableMarkers(job);clearSyncJob();job=null;}
    if(job&&!options?.job&&job.syncMode!==requestedMode){discardStaleSyncJob(job);job=null;}
    if(job&&!options?.job&&syncJobIsStale(job)){discardStaleSyncJob(job);job=null;}
    if(!job)job=createResumableSyncJob(requestedMode,background);
    if(background)job.background=true;
    return runResumableSync(job,!!options?.resume||Number(job.resumedCount)>0||job.phase!=='setup',{background});
  }
  function resumePendingSync() {
    if(resumeBootStarted||state.syncing||state.backgroundSyncing)return;
    const job=loadSyncJob();if(!job)return;
    if(job.background){discardStaleSyncJob(job);return;}
    if(job.cancelled){abandonResumableMarkers(job);clearSyncJob();return;}
    // Do not auto-resume checkpoints whose end time is already stale; the next manual Sync starts fresh.
    if(syncJobIsStale(job)){discardStaleSyncJob(job);setSyncProgress('Expired old sync checkpoint cleared. Press Sync to verify current TCT and fill missing days.');return;}
    resumeBootStarted=true;syncAll({job,resume:true,mode:job.syncMode||'quick'});
  }
  function persistSyncCancellation() {
    const job=loadSyncJob();if(!job)return;job.cancelled=true;job.progress='Stopping after the current API request\u2026';saveSyncJob(job);
  }
  document.addEventListener('click',e=>{const el=e.target?.closest?.('#tta-root [data-act="cancelSync"]');if(el)persistSyncCancellation();},true);

  let backgroundQuickSyncTimer=0;
  async function backgroundQuickSyncTick() {
    if(!hasApiKey()||state.syncing||state.backgroundSyncing)return;
    if(loadSyncJob())return;
    try{await syncAll({mode:'quick',background:true});}catch(_){}
  }
  function startBackgroundQuickSync() {
    if(backgroundQuickSyncTimer)return;
    backgroundQuickSyncTimer=setInterval(()=>{void backgroundQuickSyncTick();},BACKGROUND_QUICK_SYNC_MS);
  }

  repairCashFlowAccountingRows();
  const boot=()=>{if(document.body){mount();resumePendingSync();startBackgroundQuickSync();}else setTimeout(boot,250)}; boot();
  setInterval(()=>{if(!document.getElementById('tta-fab')||!document.getElementById('tta-root'))mount();},5000);
})();
