// ==UserScript==
// @name         Torn Trade Analyzer
// @namespace    chadgian.torn.trade.analyzer
// @version      0.1.21
// @description  Fast Torn trade analytics with spacious scrollable daily profit charts, top-anchored exact-value tooltips, acquisition-date attribution, FIFO ledger, and incremental sync. Data stays on-device.
// @author       chadgian + ChatGPT
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/chadgian/torn-trade/main/torn-trade-analyzer.user.js
// @downloadURL  https://raw.githubusercontent.com/chadgian/torn-trade/main/torn-trade-analyzer.user.js
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '0.1.21';
  const API_KEY = '_###PDA-APIKEY###_';
  const NS = 'tta:v1:';
  const API = 'https://api.torn.com/v2';
  const REQUEST_GAP_MS = 700; // ~86 requests/minute, keeping headroom under Torn's 100/min user limit.
  const MAX_LOG_IDS_PER_REQUEST = 24;
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

  const state = {
    open: false,
    view: 'dashboard',
    tracked: load('tracked', []),
    transactions: load('transactions', []),
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
    expanded: null,
    search: '',
    syncing: false,
    syncProgress: '',
    syncCancel: false,
    toast: '',
    busy: {active:false,title:'',detail:'',cancellable:false},
    demo: false,
  };

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
    if (!key) throw new Error('No Torn API key is configured. Add one in Settings → API Key.');
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
      #tta-fab{position:fixed;right:14px;bottom:86px;z-index:2147483000;min-height:42px;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;border:1px solid #38566a;border-radius:18px;background:linear-gradient(135deg,#1a352f,#183951);color:#fff;box-shadow:0 12px 35px #0009;padding:11px 14px;font:700 12px/1.1 system-ui;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-align:center}
      #tta-fab.dragging{cursor:grabbing;opacity:.92;transform:scale(1.02)}
      #tta-fab .dot{width:9px;height:9px;flex:0 0 9px;border-radius:50%;background:var(--tta-green);box-shadow:0 0 14px var(--tta-green)}
      #tta-fab.syncing{border-color:#ff9aa8;background:linear-gradient(135deg,#5d2931,#7b333e);color:#ffe9ec;box-shadow:0 12px 35px #0009,0 0 18px #ff859655}
      #tta-fab .tta-fabspinner{width:14px;height:14px;flex:0 0 14px;border:2px solid #ffccd244;border-top-color:#ffb0ba;border-right-color:#ffb0ba;border-radius:50%;animation:tta-spin .78s linear infinite}
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
      .tta-ledgerintro{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:11px}.tta-ledgerintro strong{display:block;color:var(--tta-text);font-size:13px}.tta-ledgerintro small{display:block;margin-top:3px;color:var(--tta-muted);font-size:10px;line-height:1.45}.tta-ledgerfilters{display:grid;grid-template-columns:minmax(180px,1.6fr) repeat(3,minmax(118px,.8fr));gap:8px;margin:10px 0}.tta-ledgerfilters input,.tta-ledgerfilters select{width:100%;min-height:40px;border:1px solid var(--tta-line);border-radius:10px;background:var(--tta-card);color:var(--tta-text)!important;padding:8px 10px;font-size:11px;outline:none}.tta-ledgerfilters input:focus,.tta-ledgerfilters select:focus{border-color:var(--tta-blue);box-shadow:0 0 0 2px #7fc1ff22}.tta-ledgersummary{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:10px 0}.tta-ledgersummary .tta-ministat{margin:0}.tta-ledgerwrap{width:100%;overflow:auto;border:1px solid var(--tta-line);border-radius:13px;background:#0d141c;overscroll-behavior-x:contain}.tta-ledgertable{width:100%;min-width:940px;border-collapse:separate;border-spacing:0;font-size:10px}.tta-ledgertable th{position:sticky;top:0;z-index:2;background:#17212b;border-bottom:1px solid var(--tta-line);text-align:left;padding:0}.tta-ledgertable th button{width:100%;border:0;background:transparent;color:#dce8f2!important;padding:10px 9px;text-align:left;font-size:9px;font-weight:850;letter-spacing:.25px;white-space:nowrap}.tta-ledgertable th button.active{color:var(--tta-green)!important}.tta-ledgertable td{padding:9px;border-bottom:1px solid #273746;color:#d6e1eb;vertical-align:top;font-variant-numeric:tabular-nums}.tta-ledgertable tbody tr:last-child td{border-bottom:0}.tta-ledgertable tbody tr:active td{background:#17222d}.tta-ledgertable .num{text-align:right;white-space:nowrap}.tta-ledgeritem{min-width:135px}.tta-ledgeritem strong{display:block;color:var(--tta-text);font-size:10.5px;line-height:1.3}.tta-ledgeritem small,.tta-ledgermethod small,.tta-ledgerstatus small{display:block;margin-top:2px;color:var(--tta-faint);font-size:8.5px;line-height:1.35}.tta-ledgermethod{min-width:125px}.tta-ledgerstatus{min-width:105px}.tta-statuspill{display:inline-flex;align-items:center;min-height:22px;padding:3px 7px;border:1px solid var(--tta-line);border-radius:999px;background:#151f28;color:var(--tta-muted);font-size:8.5px;font-weight:800;white-space:nowrap}.tta-statuspill.sold{background:#123026;border-color:#2f6853;color:var(--tta-green)}.tta-statuspill.partial{background:#322b13;border-color:#6e6030;color:var(--tta-yellow)}.tta-statuspill.unsold{background:#251a20;border-color:#5f3e49;color:#ffc1ca}.tta-ledgermeta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:8px 1px;color:var(--tta-muted);font-size:9.5px}.tta-ledgermore{display:flex;justify-content:center;margin:12px 0 4px}
      @media(max-width:620px){.tta-ledgerfilters{grid-template-columns:1fr 1fr}.tta-ledgerfilters .tta-ledgersearch{grid-column:1/-1}.tta-ledgersummary{grid-template-columns:1fr 1fr}}
      @media(max-width:390px){.tta-ledgerfilters{grid-template-columns:1fr}.tta-ledgerfilters .tta-ledgersearch{grid-column:auto}.tta-ledgermeta{align-items:flex-start;flex-direction:column}}
      .tta-loading{position:fixed;inset:0;z-index:2147483001;display:none;place-items:center;background:#05080bd9;padding:20px;pointer-events:auto}.tta-loading.show{display:grid}.tta-loadingcard{width:min(420px,94vw);background:#111a23;border:1px solid #3b5266;border-radius:18px;padding:18px;box-shadow:0 22px 70px #000b;text-align:center}.tta-loadicon{width:52px;height:52px;margin:0 auto 12px;border-radius:16px;background:#172632;border:1px solid #345269;display:grid;place-items:center}.tta-spinner.xl{width:24px;height:24px;border-width:3px}.tta-loadingtitle{font-size:15px;font-weight:900;color:var(--tta-text);line-height:1.3}.tta-loadingdetail{min-height:34px;margin-top:7px;color:var(--tta-muted);font-size:11px;line-height:1.5}.tta-loadingbar{height:4px;margin:13px 0 12px;overflow:hidden;border-radius:999px;background:#091018}.tta-loadingbar span{display:block;width:38%;height:100%;border-radius:inherit;background:var(--tta-green);animation:tta-load-slide 1.25s ease-in-out infinite}@keyframes tta-load-slide{0%{transform:translateX(-120%)}50%{transform:translateX(165%)}100%{transform:translateX(310%)}}.tta-loadingactions{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:5px}.tta-loadinghint{margin-top:9px;color:var(--tta-faint);font-size:9px;line-height:1.4}
      .tta-openloader{position:absolute;inset:0;display:grid;place-items:center;background:var(--tta-bg);color:var(--tta-muted);text-align:center;padding:24px}.tta-openloader>div{display:flex;flex-direction:column;align-items:center;gap:11px}.tta-openloader strong{color:var(--tta-text);font-size:14px}.tta-openloader small{font-size:10px;color:var(--tta-faint)}
      .tta-toast{opacity:0;visibility:hidden;pointer-events:none;transition:opacity .16s ease,transform .16s ease,visibility .16s}.tta-toast.show{opacity:1;visibility:visible;transform:translate(-50%,-4px)}
      #tta-root[aria-busy="true"] .tta-shell{overflow:hidden}
      @media(prefers-reduced-motion:reduce){.tta-loadingbar span,.tta-spinner,.tta-fabspinner{animation-duration:2.2s}.tta-item,.tta-btn,.tta-chip,.tta-iconbtn,.tta-back,.tta-pin,.tta-toast{transition:none}}
    `;
    document.head.appendChild(s);
  }

  function clampFabPosition(left,top,fab) {
    const pad=8,w=fab.offsetWidth||132,h=fab.offsetHeight||42;
    return {left:Math.max(pad,Math.min(left,window.innerWidth-w-pad)),top:Math.max(pad,Math.min(top,window.innerHeight-h-pad))};
  }
  function applyFabPosition(fab) {
    if(!fab)return;
    if(state.fabPosition && Number.isFinite(state.fabPosition.left) && Number.isFinite(state.fabPosition.top)){
      const p=clampFabPosition(state.fabPosition.left,state.fabPosition.top,fab);
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
      if(moved){const r=fab.getBoundingClientRect();state.fabPosition=clampFabPosition(r.left,r.top,fab);save('fabPosition',state.fabPosition);fab.dataset.suppressClick='1';setTimeout(()=>fab.dataset.suppressClick='0',250);}
    };
    fab.addEventListener('pointerup',finish);fab.addEventListener('pointercancel',finish);
    fab.addEventListener('click',e=>{if(fab.dataset.suppressClick==='1'){e.preventDefault();e.stopPropagation();return;}openAnalyzer();});
    window.addEventListener('resize',()=>applyFabPosition(fab),{passive:true});
  }
  function updateFabState() {
    const fab=document.getElementById('tta-fab');if(!fab)return;
    const syncing=!!state.syncing;
    fab.classList.toggle('syncing',syncing);
    fab.setAttribute('aria-label',syncing?'Trade Analytics syncing':'Trade Analytics');
    fab.title=syncing?'Trade history sync is running · tap to reopen':'Open Trade Analytics';
    fab.innerHTML=syncing?'<span class="tta-fabspinner" aria-hidden="true"></span><span>Syncing…</span>':'<span class="dot"></span><span>Trade Analytics</span>';
    fab.style.display=state.open?'none':'inline-flex';
    requestAnimationFrame(()=>applyFabPosition(fab));
  }
  function mount() {
    injectCss();
    if (!document.getElementById('tta-fab')) {
      const fab = document.createElement('button'); fab.id = 'tta-fab';
      fab.innerHTML = '<span class="dot"></span><span>Trade Analytics</span>';
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
    else if(state.dateMode==='30d') from=Math.floor((nowMs-30*86400*1000)/1000);
    else if(state.dateMode==='month') from=Math.floor(subtractCalendarMonth(nowDate).getTime()/1000);
    else if(state.dateMode==='custom') {
      if(state.customFrom) from=Math.floor(new Date(state.customFrom+'T00:00:00').getTime()/1000);
      if(state.customTo) to=Math.min(to,Math.floor(new Date(state.customTo+'T23:59:59').getTime()/1000));
    }
    if(!Number.isFinite(from)||from<0)from=0;
    if(!Number.isFinite(to))to=Math.floor(nowMs/1000)+60;
    return {from:Math.floor(from),to:Math.floor(to)};
  }

  function dateRange() {
    const allTx=effectiveTransactions();
    const bounds=selectedPeriodBounds();
    let from=bounds.from,to=bounds.to;
    if(state.dateMode==='all'&&allTx.length){from=Infinity;for(const x of allTx){const ts=Number(x?.timestamp);if(Number.isFinite(ts)&&ts<from)from=ts;}if(!Number.isFinite(from))from=0;}
    return {from,to};
  }

  function fifoAnalytics(itemId) {
    const id=Number(itemId),idx=ensureTxIndex();
    if(perfCache.fifo.has(id))return perfCache.fifo.get(id);
    const tx=idx.byItem.get(id)||[];
    const lots=[];let lotHead=0;const events=[];
    for(const t of tx){
      if(t.side==='buy'){
        if(t.qty>0&&t.total>=0)lots.push({qty:t.qty,unit:t.qty?t.total/t.qty:0});
        events.push({...t,realizedProfit:0,matchedQty:0,unmatchedQty:0});
      }else if(t.side==='sell'){
        let remain=t.qty,basis=0,matched=0;
        while(remain>0&&lotHead<lots.length){
          const lot=lots[lotHead],take=Math.min(remain,lot.qty);
          basis+=take*lot.unit;matched+=take;remain-=take;lot.qty-=take;
          if(lot.qty<=1e-9)lotHead++;
        }
        const net=t.netTotal??t.total;
        const matchedRevenue=t.qty>0?net*(matched/t.qty):0;
        events.push({...t,costBasis:basis,realizedProfit:matchedRevenue-basis,matchedQty:matched,unmatchedQty:remain});
      }
    }
    let remainingQty=0,remainingCost=0;
    for(let i=lotHead;i<lots.length;i++){remainingQty+=lots[i].qty;remainingCost+=lots[i].qty*lots[i].unit;}
    const result={events,remainingQty,remainingCost};perfCache.fifo.set(id,result);return result;
  }

  function acquisitionMethod(t) {
    const source=String(t?.source||''),text=`${source} ${t?.title||''}`.toLowerCase();
    if(source==='Player Trade')return 'Player Trade';
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
    for(const itemId of idx.itemIds){
      const tx=idx.byItem.get(itemId)||[],lots=[];let lotHead=0;
      for(const t of tx){
        const q=Math.max(0,Number(t?.qty)||0);if(!(q>0))continue;
        if(t.side==='buy'){
          const cost=Math.max(0,Number(t.total)||0),item=catalogItem(itemId);
          const row={id:String(t.id),acquiredAt:Number(t.timestamp)||0,itemId:Number(itemId),itemName:item.name,itemType:item.type||'Item',qty:q,method:acquisitionMethod(t),source:String(t.source||''),title:String(t.title||''),free:!!t.free,costTotal:cost,unitCost:q?cost/q:0,soldQty:0,soldProceeds:0,realizedCost:0,realizedProfit:0,unsoldQty:q,status:'unsold',saleCount:0,firstSoldAt:0,lastSoldAt:0,saleSources:[],_saleSources:new Set()};
          ledger.push(row);if(!ledgerByItem.has(Number(itemId)))ledgerByItem.set(Number(itemId),[]);ledgerByItem.get(Number(itemId)).push(row);lots.push({remaining:q,unit:row.unitCost,row});
        }else if(t.side==='sell'){
          let remain=q;const net=Math.max(0,Number(t.netTotal??t.total)||0),saleUnit=q?net/q:0;
          while(remain>1e-9&&lotHead<lots.length){
            const lot=lots[lotHead],take=Math.min(remain,lot.remaining);if(!(take>0)){lotHead++;continue;}
            const row=lot.row;row.soldQty+=take;row.soldProceeds+=take*saleUnit;row.realizedCost+=take*lot.unit;row.realizedProfit=row.soldProceeds-row.realizedCost;row.saleCount++;
            const soldAt=Number(t.timestamp)||0;if(!row.firstSoldAt||soldAt<row.firstSoldAt)row.firstSoldAt=soldAt;if(soldAt>row.lastSoldAt)row.lastSoldAt=soldAt;
            if(t.source)row._saleSources.add(String(t.source));
            remain-=take;lot.remaining-=take;if(lot.remaining<=1e-9)lotHead++;
          }
        }
      }
    }
    for(const row of ledger){
      row.unsoldQty=Math.max(0,row.qty-row.soldQty);row.status=row.soldQty<=1e-9?'unsold':row.unsoldQty<=1e-9?'sold':'partial';row.saleSources=[...row._saleSources];delete row._saleSources;
    }
    ledger.sort((a,b)=>b.acquiredAt-a.acquiredAt||String(b.id).localeCompare(String(a.id)));
    perfCache.ledgerTxRef=idx.txRef;perfCache.ledgerRows=ledger;perfCache.ledgerByItem=ledgerByItem;return ledger;
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
    if(state.ledgerRange==='30d')return {from:Math.floor((now-30*86400e3)/1000),to:Math.floor(now/1000)+60};
    if(state.ledgerRange==='month')return {from:Math.floor(subtractCalendarMonth(new Date(now)).getTime()/1000),to:Math.floor(now/1000)+60};
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

  function ledgerSortArrow(key){return state.ledgerSort===key?(state.ledgerSortDir==='asc'?' ↑':' ↓'):'';}
  function ledgerMethodOptions(){return [...new Set(acquisitionLedgerRows().map(x=>x.method).filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
  function ledgerSummary(rows){return {lots:rows.length,qty:rows.reduce((n,x)=>n+x.qty,0),sold:rows.reduce((n,x)=>n+x.soldQty,0),profit:rows.reduce((n,x)=>n+x.realizedProfit,0)};}

  function ledgerRowHtml(row) {
    const saleWhen=row.lastSoldAt?dateTimeStr(row.lastSoldAt):'Not sold yet',saleSources=row.saleSources.length?row.saleSources.join(' · '):'';
    const costText=row.free&&row.costTotal<=1e-7?'$0 · Free':money(row.costTotal);
    const profitText=row.soldQty>0?money(row.realizedProfit):'—';
    return `<tr><td><strong>${esc(dateTimeStr(row.acquiredAt))}</strong></td><td class="tta-ledgeritem"><strong>${esc(row.itemName)}</strong><small>#${row.itemId} · ${esc(row.itemType)}</small></td><td class="num">${qty(row.qty)}</td><td class="tta-ledgermethod"><strong>${esc(row.method)}</strong><small>${esc(row.source||row.title||'Recorded acquisition')}</small></td><td class="num">${esc(costText)}<br><small>${row.qty?esc(money(row.unitCost))+'/ea':''}</small></td><td class="num">${qty(row.soldQty)} / ${qty(row.qty)}</td><td class="num">${row.soldQty?money(row.soldProceeds):'—'}</td><td class="num ${row.realizedProfit>=0?'pos':'neg'}">${esc(profitText)}</td><td class="tta-ledgerstatus"><span class="tta-statuspill ${row.status}">${row.status==='sold'?'Sold':row.status==='partial'?'Partial':'Unsold'}</span><small>${esc(saleWhen)}${saleSources?` · ${esc(saleSources)}`:''}</small></td></tr>`;
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
    return `${header('Acquisition History','FIFO lot ledger · cached acquisition and sale history',true)}<div class="tta-content">
      <div class="tta-ledgerintro"><div><strong>Acquisition ledger</strong><small>Each row is one recorded acquisition lot. Later sales are matched back to it using the same FIFO method as the dashboard. Realized profit is attributed to this acquisition date, not the later sale date.</small></div></div>
      <div class="tta-ledgerfilters"><div class="tta-searchwrap tta-ledgersearch"><span class="tta-searchglyph">⌕</span><input id="tta-ledger-search" class="tta-history-search" placeholder="Search item, ID, source or sale method…" value="${esc(state.ledgerSearch||'')}" autocomplete="off"><button class="tta-clearsearch" data-act="clearLedgerSearch" aria-label="Clear ledger search" ${state.ledgerSearch?'':'hidden'}>×</button></div><select data-ledger-filter="source"><option value="all">All acquisition types</option>${methods.map(x=>`<option value="${esc(x)}" ${state.ledgerSource===x?'selected':''}>${esc(x)}</option>`).join('')}</select><select data-ledger-filter="status"><option value="all" ${state.ledgerStatus==='all'?'selected':''}>All sale statuses</option><option value="sold" ${state.ledgerStatus==='sold'?'selected':''}>Sold</option><option value="partial" ${state.ledgerStatus==='partial'?'selected':''}>Partial</option><option value="unsold" ${state.ledgerStatus==='unsold'?'selected':''}>Unsold</option></select><select data-ledger-filter="range"><option value="all" ${state.ledgerRange==='all'?'selected':''}>All cached history</option><option value="7d" ${state.ledgerRange==='7d'?'selected':''}>Last 7 days</option><option value="30d" ${state.ledgerRange==='30d'?'selected':''}>Last 30 days</option><option value="month" ${state.ledgerRange==='month'?'selected':''}>Last 1 month</option><option value="dashboard" ${state.ledgerRange==='dashboard'?'selected':''}>Dashboard period</option></select></div>
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
    const keyFn=state.granularity==='week'?weekKey:state.granularity==='month'?monthKey:dayKey;
    for(const row of rows){
      if(row.acquiredAt<from||row.acquiredAt>to||row.soldQty<=0)continue;
      const k=keyFn(row.acquiredAt);m.set(k,(m.get(k)||0)+(Number(row.realizedProfit)||0));
    }
    const result=[...m.entries()].sort((a,b)=>a[0]-b[0]).map(([t,v])=>({t,v}));perfCache.series.set(cacheKey,result);return result;
  }

  function chartBucketLabel(ts) {
    const d=new Date((Number(ts)||0)*1000);
    if(state.granularity==='month')return d.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    if(state.granularity==='week')return `Week of ${dateStr(ts)}`;
    return dateStr(ts);
  }
  function hideChartTooltip(wrap,force=false) {
    if(!wrap)return;const tip=wrap.querySelector('.tta-charttooltip');if(!tip)return;
    if(!force&&tip.dataset.pinned==='1')return;tip.classList.remove('show','pos','neg');tip.dataset.pinned='0';wrap.querySelectorAll('.tta-profitbar.active').forEach(x=>x.classList.remove('active'));
  }
  function showChartTooltip(bar,pinned=false) {
    const wrap=bar?.closest?.('.tta-chartinteractive'),tip=wrap?.querySelector('.tta-charttooltip');if(!wrap||!tip)return;
    wrap.querySelectorAll('.tta-profitbar.active').forEach(x=>x.classList.remove('active'));bar.classList.add('active');
    const value=Number(bar.dataset.profit)||0,ts=Number(bar.dataset.time)||0;
    tip.innerHTML=`<strong>${esc(money(value))}</strong><small>${esc(chartBucketLabel(ts))} · acquisition date</small>`;
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
    const labels=series.map((p,i)=>{if(series.length>10 && i%labelStride!==0 && i!==series.length-1)return''; const d=new Date(p.t*1000);const lab=state.granularity==='month'?d.toLocaleDateString(undefined,{month:'short'}):d.toLocaleDateString(undefined,{month:'short',day:'numeric'});const x=padL+gap*i+gap/2;return `<text class="tta-axis" text-anchor="middle" x="${x}" y="${h-6}">${esc(lab)}</text>`}).join('');
    return `<div class="tta-chartinteractive ${dayMode?'day':''}" ${dayMode?`style="--tta-chart-width:${w}px"`:''}><div class="tta-charttooltip" role="status" aria-live="polite" data-pinned="0"></div><div class="tta-chartviewport"><svg class="tta-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Interactive profit chart; hover or tap a bar for exact profit">${grid}<line class="tta-zero" x1="${padL}" y1="${zero}" x2="${w-padR}" y2="${zero}"/>${bars}${labels}</svg></div></div>`;
  }

  function positionDailyChartsToLatest(scope=document) {
    requestAnimationFrame(()=>scope.querySelectorAll?.('.tta-chartinteractive.day .tta-chartviewport').forEach(v=>{if(v.dataset.positioned==='1')return;v.scrollLeft=Math.max(0,v.scrollWidth-v.clientWidth);v.dataset.positioned='1';}));
  }

  function itemIcon(item) {
    const fallback = '<span class="tta-thumbfallback" style="display:grid">◇</span>';
    if (!item || !item.image) return `<div class="tta-thumbwrap">${fallback}</div>`;
    return `<div class="tta-thumbwrap"><img class="tta-thumb" src="${esc(item.image)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="tta-thumbfallback">◇</span></div>`;
  }

  function header(title, sub, back=false) {
    return `<div class="tta-header">${back?'<button class="tta-back" data-act="back" aria-label="Back" title="Back">‹</button>':''}<div class="tta-brand"><div class="tta-mark" aria-hidden="true">📈</div><div class="tta-brandcopy"><div class="tta-title">${esc(title)}${state.demo?'<span class="tta-demo">DEMO</span>':''}</div><div class="tta-sub">${esc(sub)}</div></div></div>${!back?'<button class="tta-iconbtn" data-act="settings" aria-label="Settings" title="Settings">⚙</button>':''}<button class="tta-iconbtn" data-act="close" aria-label="Close trade analyzer" title="Close">×</button></div>`;
  }

  function pinnedCountFor(items) {
    const pins=new Set((state.pinnedIds||[]).map(Number));let n=0;for(const x of items)if(pins.has(Number(x.id)))n++;return n;
  }

  function itemListMetaText(rows,allItems) {
    return `${qty(rows.length)} in this period · ${qty(allItems.length)} discovered total · ${qty(pinnedCountFor(allItems))} pinned`;
  }

  function itemListHtml(rows,allItems) {
    if(rows.length)return rows.map(r=>itemCard(r.item,r.summary)).join('');
    if(state.itemSearch)return `<div class="tta-empty">No items match “${esc(state.itemSearch)}” in this period.</div>`;
    return `<div class="tta-empty">${allItems.length?'No item activity exists in the selected period. Try a longer period or Sync to backfill it.':'No item history has been discovered yet. Press Sync to scan your Torn logs.'}</div>`;
  }

  function renderItemList() {
    if(state.view!=='dashboard')return;
    const list=document.getElementById('tta-item-list');if(!list)return;
    const shell=document.querySelector('#tta-root .tta-shell'),scroll=shell?.scrollTop||0;
    const rows=historyItemRows(),allItems=effectiveTracked();
    list.innerHTML=itemListHtml(rows,allItems);
    const meta=document.getElementById('tta-list-meta');if(meta)meta.textContent=itemListMetaText(rows,allItems);
    const count=document.getElementById('tta-item-count');if(count)count.textContent=qty(rows.length);
    const sort=document.getElementById('tta-sort-btn');if(sort)sort.textContent=`⇅ ${sortLabel()}`;
    const clear=document.querySelector('[data-act="clearItemSearch"]');if(clear)clear.hidden=!state.itemSearch;
    if(shell)shell.scrollTop=scroll;positionDailyChartsToLatest(list);
  }

  function dashboardHtml() {
    const s=overall(),rows=historyItemRows(),allItems=effectiveTracked(),range=dateRange();
    const requested=selectedPeriodBounds();
    const coverageFrom=Number(state.sync?.coverageFrom);
    const needsBackfill=hasApiKey()&&state.sync?.firstSyncComplete&&requested.from>0&&(!Number.isFinite(coverageFrom)||coverageFrom>requested.from);
    const periodLabel=state.dateMode==='all'?'All available history':`${dateStr(range.from)} – ${dateStr(Math.min(range.to,nowSec()))}`;
    const lastSync=state.sync?.lastSync?`Last sync ${new Date(state.sync.lastSync*1000).toLocaleString()}`:'Not synced yet';
    return `${header('Trade Analyzer', `v${VERSION} · optimized FIFO analytics`)}<div class="tta-content">
      ${!hasApiKey()?`<div class="tta-banner"><strong>Preview mode.</strong> Add your Torn API key in <strong>Settings → API Key</strong> (or use Torn PDA's injected key) to load your real history. The key and analyzed data stay on this device.</div>`:''}
      ${hasApiKey()&&!state.sync?.autoDiscoveryComplete?`<div class="tta-banner"><strong>History discovery:</strong> Run Sync once to discover recognizable acquisitions and sales for your selected period.</div>`:''}
      ${needsBackfill?`<div class="tta-banner"><strong>More history needed:</strong> This period starts ${esc(dateStr(requested.from))}, earlier than the local cache. Press <strong>Sync</strong> to backfill it.</div>`:''}
      <div class="tta-period"><div><small>Date period</small><strong>${esc(periodLabel)}</strong><span class="tta-periodhint">${esc(lastSync)} · ${qty(state.transactions.length)} cached rows</span></div><button class="tta-btn secondary" data-act="sync" ${state.syncing?'disabled':''}>${state.syncing?'<span class="tta-sync"><span class="tta-spinner"></span>Syncing</span>':'↻ Sync history'}</button></div>
      ${state.syncProgress?`<div class="tta-banner tta-status-banner"><span class="tta-status-dot"></span><span id="tta-sync-progress-text">${esc(state.syncProgress)}</span></div>`:''}
      <div class="tta-chips">${[['7d','7 days'],['30d','30 days'],['month','1 month'],['all','All'],['custom','Custom']].map(([k,l])=>`<button class="tta-chip ${state.dateMode===k?'active':''}" data-date="${k}">${l}</button>`).join('')}</div>
      ${state.dateMode==='custom'?`<div class="tta-customdates"><input type="date" data-custom="from" value="${esc(state.customFrom)}"><input type="date" data-custom="to" value="${esc(state.customTo)}"></div>`:''}
      <div class="tta-summary"><div class="tta-stat main"><label>Profit · acquisition date</label><b class="${s.profit>=0?'pos':'neg'}">${money(s.profit)}</b></div><div class="tta-stat"><label>Acquired</label><b>${qty(s.bought)}</b></div><div class="tta-stat"><label>Sold</label><b>${qty(s.sold)}</b></div></div>
      <div class="tta-chartcard"><div class="tta-charthead"><h3>Profit by acquisition date</h3><div class="tta-seg">${['day','week','month'].map(g=>`<button class="${state.granularity===g?'active':''}" data-gran="${g}">${g[0].toUpperCase()+g.slice(1)}</button>`).join('')}</div></div>${chartSvg(profitSeries())}</div>
      <div class="tta-sectionhead"><h3>Items in selected period · <span id="tta-item-count">${qty(rows.length)}</span></h3><button class="tta-btn secondary" data-act="ledger">☷ Acquisition history</button></div>
      <div class="tta-listtools"><div class="tta-searchwrap"><span class="tta-searchglyph">⌕</span><input id="tta-history-search" class="tta-history-search" placeholder="Search item name or ID…" value="${esc(state.itemSearch||'')}" autocomplete="off" aria-label="Search discovered items"><button class="tta-clearsearch" data-act="clearItemSearch" aria-label="Clear search" ${state.itemSearch?'':'hidden'}>×</button></div><button id="tta-sort-btn" class="tta-btn secondary tta-sortbtn" data-act="cycleSort" title="Tap to change sorting">⇅ ${esc(sortLabel())}</button></div>
      <div id="tta-list-meta" class="tta-listmeta">${esc(itemListMetaText(rows,allItems))}</div>
      <div id="tta-item-list" class="tta-liststage">${itemListHtml(rows,allItems)}</div>
    </div>`;
  }

  function itemCard(item,precomputed=null) {
    const s=precomputed||summaryFor(item.id),exp=Number(state.expanded)===Number(item.id);
    const pinned=(state.pinnedIds||[]).map(Number).includes(Number(item.id));
    const marketPrice=Math.max(0,Number(item.marketPrice)||0),marketText=marketPrice?money(marketPrice):'Market unavailable';
    const itemType=String(item.type||'Item');
    const src=s.sources.length?s.sources.slice(0,3).join(' · '):'No acquisitions in selected period';
    let details='';
    if(exp){
      const series=profitSeries(item.id),avgBuy=s.bought?s.buySpend/s.bought:0,avgSell=s.sold?s.sellRevenue/s.sold:0;
      const freeQty=s.events.filter(x=>x.side==='buy'&&x.free).reduce((n,x)=>n+x.qty,0);
      const playerTradeCount=new Set(s.events.filter(x=>x.source==='Player Trade').map(x=>x.tradeId)).size;
      const recordedInventoryValue=marketPrice*Math.max(0,Number(s.remainingQty)||0);
      details=`<div class="tta-minirow"><div class="tta-ministat"><small>Avg cost</small><b>${money(avgBuy,true)}</b></div><div class="tta-ministat"><small>Avg sell</small><b>${money(avgSell,true)}</b></div><div class="tta-ministat"><small>Inventory</small><b>${qty(s.remainingQty)}</b></div></div><div class="tta-minirow"><div class="tta-ministat"><small>Market value</small><b>${marketPrice?money(marketPrice,true):'—'}</b></div><div class="tta-ministat"><small>Recorded inventory value</small><b>${marketPrice?money(recordedInventoryValue,true):'—'}</b></div><div class="tta-ministat"><small>FIFO cost basis</small><b>${money(s.remainingCost,true)}</b></div></div><div class="tta-charthead"><h3>${esc(item.name)} profit</h3><small>#${item.id} · ${esc(itemType)} · ${s.events.length} events</small></div>${chartSvg(series,92)}<div class="tta-note">Market value is Torn's catalog market price per item. Recorded inventory value is your analyzer-recorded remaining quantity × that market value; it is not a live inventory count.${playerTradeCount?` · ${qty(playerTradeCount)} player trade(s) use each item type's market-value subtotal plus an equal share of that trade's cash surplus/deficit.`:''} Sold quantity counts every recognized sale event, including outgoing items from authoritative completed player-trade details. Profit uses FIFO: each sale is matched against your oldest recorded acquisitions, but the realized profit is attributed to the date that matched lot was acquired rather than the sale date. ${s.unmatched?`⚠ ${qty(s.unmatched)} sold item(s) have no earlier recorded acquisition cost, so those units are excluded from realized profit.`:'All sold units in this period have recorded cost basis.'}${freeQty?` · ${qty(freeQty)} free-acquired item(s) use a $0 cost basis.`:''}</div>`;
    }
    return `<div class="tta-item ${exp?'expanded':''}" data-item="${item.id}"><div class="tta-itemtop" data-act="toggleItem" data-id="${item.id}" role="button" tabindex="0" aria-expanded="${exp?'true':'false'}">${itemIcon(item)}<div class="tta-itemcopy"><div class="tta-itemname">${esc(item.name)}</div><div class="tta-source">${esc(src)}</div><div class="tta-itemfacts"><span class="tta-factpill market">Market ${esc(marketText)}</span><span class="tta-factpill">${esc(itemType)}</span><span class="tta-factpill">#${item.id}</span></div></div><div class="tta-profitbox"><div class="tta-cardactions"><button class="tta-pin ${pinned?'active':''}" data-act="togglePin" data-id="${item.id}" aria-pressed="${pinned?'true':'false'}" aria-label="${pinned?'Unpin':'Pin'} ${esc(item.name)}" title="${pinned?'Unpin item':'Pin item to top'}">${pinned?'📌':'☆'}</button><button class="tta-hideitem" data-act="hideItem" data-id="${item.id}" aria-label="Hide ${esc(item.name)}" title="Hide item">🙈</button></div><div class="tta-profit ${s.profit>=0?'pos':'neg'}">${money(s.profit,true)}</div><div class="tta-chevron">${exp?'▲ details':'▼ details'}</div></div></div><div class="tta-metrics"><div class="tta-metric"><small>Acquired</small><b>${qty(s.bought)}</b></div><div class="tta-metric"><small>Sold</small><b>${qty(s.sold)}</b></div><div class="tta-metric"><small>Profit</small><b class="${s.profit>=0?'pos':'neg'}">${money(s.profit,true)}</b></div></div><div class="tta-accordion">${details}</div></div>`;
  }

  function addItemHtml() {
    const q=state.search.trim().toLowerCase();
    const available=(state.catalog||[]).filter(x=>!state.tracked.some(t=>Number(t.id)===Number(x.id)));
    const results=available.filter(x=>!q || x.name.toLowerCase().includes(q) || String(x.id)===q);
    return `${header('Add item','Search the complete Torn item catalog',true)}<div class="tta-content"><div class="tta-search"><input id="tta-search" placeholder="Search item name or ID…" value="${esc(state.search)}" autocomplete="off" aria-label="Search Torn items"></div>${!hasApiKey()?'<div class="tta-banner"><strong>Catalog preview:</strong> sample search results are available below. Add an API key in Settings to load the complete current Torn item catalog.</div>':`<div class="tta-catalogmeta"><strong>${qty(results.length)}</strong>&nbsp;matching · ${qty(state.catalog.length)} total Torn items loaded</div>`}${results.length?results.map(x=>`<div class="tta-result">${itemIcon(x)}<div class="tta-resultcopy"><div class="tta-itemname">${esc(x.name)}</div><small>#${x.id} · ${esc(x.type||'Item')}</small></div><button class="tta-btn" data-act="confirmAdd" data-id="${x.id}">Add</button></div>`).join(''):'<div class="tta-empty">No matching items.</div>'}</div>`;
  }

  function settingsHtml() {
    const when=state.sync.lastSync?new Date(state.sync.lastSync*1000).toLocaleString():'Never';
    const status=keySource();
    const masked=state.apiKey?'••••••••••••••••':'';
    const hiddenIds=[...new Set((state.hiddenIds||[]).map(Number).filter(x=>x>0))];
    const hiddenItems=hiddenIds.map(catalogItem).sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
    const catalogUpdated=Number(state.catalogUpdatedAt)||0;
    const catalogWhen=catalogUpdated?new Date(catalogUpdated*1000).toLocaleString():'Never';
    const hiddenHtml=hiddenItems.length?`<div class="tta-hiddenlist">${hiddenItems.map(x=>`<div class="tta-hiddenrow"><span>${esc(x.name)} <small>#${x.id}</small></span><button class="tta-btn secondary" data-act="restoreItem" data-id="${x.id}">Restore</button></div>`).join('')}</div><div class="tta-settings-actions"><button class="tta-btn secondary" data-act="restoreAllItems">Restore all hidden items</button></div>`:'<div class="tta-banner">No hidden items.</div>';
    return `${header('Settings','Storage, API access & reset',true)}<div class="tta-content tta-settings">
      <div class="tta-keycard"><div class="tta-keyhead"><strong>API Key</strong><span class="tta-keystatus">${esc(status)}</span></div><div class="tta-keyinputrow"><input id="tta-api-key" type="password" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste your Torn API key" value="${esc(masked)}" data-placeholder-key="${state.apiKey?'1':'0'}"><button class="tta-btn" data-act="saveApiKey">Save & test</button></div><div class="tta-keynote">Stored only in this device's local storage and sent only to Torn's official API. It is never uploaded to GitHub or sent to us. Use a custom key with <strong>User → Log</strong>; for free-item history, do not restrict away categories such as Crime success, City finds, Mission rewards, Seasonal gift, and similar reward logs.</div>${state.apiKey?'<div class="tta-settings-actions"><button class="tta-btn danger" data-act="clearApiKey">Clear saved API key</button></div>':''}</div>
      <div class="tta-tos"><strong>Privacy / Torn API use</strong><br>Data storage: only locally on this device.<br>Data sharing: nobody.<br>Purpose: personal statistical analysis of automatically discovered item acquisitions and sales.<br>Key storage: locally only / not shared.<br>Required access: public Torn item/log-type endpoints plus <strong>User → Log</strong>. Torn PDA's injected key remains supported as a fallback.</div><label>Last successful sync</label><div class="tta-banner">${esc(when)}${state.sync.firstSyncComplete?' · Historical backfill completed':''}</div><label>Local data</label><div class="tta-banner">${qty(state.transactions.length)} normalized transaction entries · ${qty(state.catalog.length)} Torn items cached. Raw Torn logs are not retained.<br>Item catalog / market values updated: ${esc(catalogWhen)}.${state.sync.diagnostics?`<br>Last scan: ${qty(state.sync.diagnostics.rawRows||0)} raw logs · ${qty(state.sync.diagnostics.pages||0)} log pages · ${qty(state.sync.diagnostics.logTypes||0)} candidate log types.<br>Player trades: ${qty(state.sync.diagnostics.tradesWithItems||0)} with items · ${qty(state.sync.diagnostics.tradeDetails||0)} missing details fetched · ${qty(state.sync.diagnostics.tradeDetailsSkipped||0)} already verified details skipped · ${qty(state.sync.diagnostics.tradeTransactions||0)} allocated item rows · ${qty(state.sync.diagnostics.tradeSoldQty||0)} items sold via trades.<br>Incremental cache: ${qty(state.sync.diagnostics.existingRowsSkipped||0)} existing transaction rows skipped.${state.sync.diagnostics.periodFrom?`<br>Period scanned: ${esc(dateStr(state.sync.diagnostics.periodFrom))} – ${esc(dateStr(Math.min(state.sync.diagnostics.periodTo||nowSec(),nowSec())))}`:'<br>Period scanned: all available history.'}`:''}</div><label>Hidden items · ${qty(hiddenItems.length)}</label>${hiddenHtml}<div class="tta-settings-actions"><button class="tta-btn secondary" data-act="refreshCatalog">Refresh Torn item catalog</button><button class="tta-btn danger" data-act="resetData">Reset analyzer data</button></div></div>`;
  }

  function loadingHtml() {
    const b=state.busy||{};
    return `<div id="tta-loading" class="tta-loading ${b.active?'show':''}" role="status" aria-live="polite" aria-hidden="${b.active?'false':'true'}"><div class="tta-loadingcard"><div class="tta-loadicon"><span class="tta-spinner xl"></span></div><div id="tta-loading-title" class="tta-loadingtitle">${esc(b.title||'Working…')}</div><div id="tta-loading-detail" class="tta-loadingdetail">${esc(b.detail||'Preparing your data…')}</div><div class="tta-loadingbar"><span></span></div><div class="tta-loadingactions"><button id="tta-loading-minimize" class="tta-btn secondary" data-act="minimizeSync" ${state.syncing?'':'hidden'}>— Minimize</button><button id="tta-loading-stop" class="tta-btn danger" data-act="cancelSync" ${b.cancellable?'':'hidden'}>Stop sync</button></div><div class="tta-loadinghint">Minimize to keep using Torn while the sync continues. You can reopen progress from the floating button at any time.</div></div></div>`;
  }

  function updateBusyDom() {
    const root=document.getElementById('tta-root'),el=document.getElementById('tta-loading'),b=state.busy||{};
    if(root)root.setAttribute('aria-busy',b.active?'true':'false');if(!el)return;
    el.classList.toggle('show',!!b.active);el.setAttribute('aria-hidden',b.active?'false':'true');
    const title=document.getElementById('tta-loading-title'),detail=document.getElementById('tta-loading-detail'),stop=document.getElementById('tta-loading-stop'),minimize=document.getElementById('tta-loading-minimize');
    if(title)title.textContent=b.title||'Working…';if(detail)detail.textContent=b.detail||'Preparing your data…';if(stop)stop.hidden=!b.cancellable;if(minimize)minimize.hidden=!state.syncing;
  }

  function setBusy(active,title='',detail='',cancellable=false) {
    state.busy={active:!!active,title,detail,cancellable:!!cancellable};updateBusyDom();
  }
  function setBusyDetail(detail) {state.busy={...(state.busy||{}),detail};updateBusyDom();}
  function nextPaint(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
  async function withBusy(title,detail,fn,{cancellable=false}={}) {setBusy(true,title,detail,cancellable);await nextPaint();try{return await fn();}finally{setBusy(false);}}

  function setSyncProgress(msg) {
    state.syncProgress=String(msg||'');
    const text=document.getElementById('tta-sync-progress-text');if(text)text.textContent=state.syncProgress;
    if(state.syncing)setBusyDetail(state.syncProgress);
  }

  async function openAnalyzer() {
    state.open=true;
    const fab=document.getElementById('tta-fab');if(fab)fab.style.display='none';
    const root=document.getElementById('tta-root');if(!root)return;
    root.classList.add('show');root.setAttribute('aria-hidden','false');
    if(root.querySelector('.tta-shell')&&root.dataset.view===state.view)return;
    root.innerHTML='<div class="tta-openloader"><div><span class="tta-spinner xl"></span><strong>Opening Trade Analyzer</strong><small>Preparing cached history and analytics…</small></div></div>';
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
    root.innerHTML=`<div class="tta-shell">${state.view==='add'?addItemHtml():state.view==='settings'?settingsHtml():state.view==='ledger'?ledgerHtml():dashboardHtml()}</div>${loadingHtml()}<div id="tta-toast" class="tta-toast ${state.toast?'show':''}">${esc(state.toast||'')}</div>`;
    root.dataset.view=state.view;root.setAttribute('aria-busy',state.busy?.active?'true':'false');bind();
    if(preserveScroll){const shell=root.querySelector('.tta-shell');if(shell)shell.scrollTop=previousScroll;}positionDailyChartsToLatest(root);
  }

  let toastTimer=null;
  function toast(msg) {
    state.toast=String(msg||'');const el=document.getElementById('tta-toast');
    if(el){el.textContent=state.toast;el.classList.add('show');}
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>{if(state.toast===msg){state.toast='';const n=document.getElementById('tta-toast');if(n)n.classList.remove('show');}},2400);
  }

  function bind() {
    const root=document.getElementById('tta-root');if(!root||root.dataset.delegated==='1')return;root.dataset.delegated='1';
    root.addEventListener('click',async e=>{
      const dateEl=e.target.closest('[data-date]');
      if(dateEl&&root.contains(dateEl)){state.dateMode=dateEl.dataset.date;save('dateMode',state.dateMode);state.expanded=null;await withBusy('Updating period','Recalculating cached analytics for the selected dates…',async()=>render());return;}
      const granEl=e.target.closest('[data-gran]');
      if(granEl&&root.contains(granEl)){state.granularity=granEl.dataset.gran;save('granularity',state.granularity);await withBusy('Updating chart','Grouping realized profit by the selected interval…',async()=>render());return;}
      const el=e.target.closest('[data-act]');if(!el||!root.contains(el))return;e.stopPropagation();const act=el.dataset.act;
      if(act==='close'){state.open=false;if(!state.syncing)setBusy(false);render();}
      else if(act==='minimizeSync'){state.open=false;render();}
      else if(act==='back'){state.view='dashboard';state.search='';render();}
      else if(act==='settings'){state.view='settings';render();}
      else if(act==='ledger'){state.view='ledger';state.ledgerLimit=200;render({preserveScroll:false});}
      else if(act==='ledgerSort'){
        const key=String(el.dataset.key||'acquiredAt');if(state.ledgerSort===key)state.ledgerSortDir=state.ledgerSortDir==='asc'?'desc':'asc';else{state.ledgerSort=key;state.ledgerSortDir=(key==='item'||key==='method'||key==='status')?'asc':'desc';}
        save('ledgerSort',state.ledgerSort);save('ledgerSortDir',state.ledgerSortDir);state.ledgerLimit=200;renderLedgerRows();
      }
      else if(act==='clearLedgerSearch'){state.ledgerSearch='';save('ledgerSearch','');state.ledgerLimit=200;const input=document.getElementById('tta-ledger-search');if(input){input.value='';input.focus();}renderLedgerRows();}
      else if(act==='ledgerMore'){state.ledgerLimit=(Number(state.ledgerLimit)||200)+200;renderLedgerRows();}
      else if(act==='addItem'){state.view='add';await withBusy('Loading catalog','Preparing the Torn item catalog…',async()=>{await ensureCatalog();render();});setTimeout(()=>document.getElementById('tta-search')?.focus(),30);}
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
      else if(act==='sync'){syncAll();}
      else if(act==='cancelSync'){state.syncCancel=true;setSyncProgress('Stopping after the current API request…');}
      else if(act==='saveApiKey'){
        const input=document.getElementById('tta-api-key');let key=String(input?.value||'').trim();if(input?.dataset.placeholderKey==='1'&&/^•+$/.test(key))key=String(state.apiKey||'').trim();
        if(key.length<16){toast('Enter a valid Torn API key first.');return;}state.apiKey=key;save('apiKey',key);state.demo=false;render();
        try{
          let info=null;await withBusy('Checking API key','Verifying access and refreshing the item catalog…',async()=>{info=await inspectActiveKey();await apiGet('/user/log',{limit:1});state.catalog=[];state.catalogVersion=0;state.catalogUpdatedAt=0;save('catalog',[]);save('catalogVersion',0);save('catalogUpdatedAt',0);await ensureCatalog(true);});
          toast(`API key confirmed (${info?.type||'access level '+(info?.level||'?')}).`);state.view='dashboard';render();await syncAll();
        }catch(err){if(/Incorrect Key|incorrect format/i.test(String(err.message||err))){state.apiKey='';save('apiKey','');}setBusy(false);render();toast(`API key test failed: ${err.message}`);}
      }
      else if(act==='clearApiKey'){state.apiKey='';save('apiKey','');state.demo=!hasApiKey();resetAnalyticsCache();render();toast(injectedApiKey()?'Saved key cleared. Torn PDA key will be used.':'Saved API key cleared.');}
      else if(act==='refreshCatalog'){
        await withBusy('Refreshing catalog','Downloading the latest Torn item catalog and market values…',async()=>{state.catalog=[];state.catalogVersion=0;state.catalogUpdatedAt=0;save('catalog',[]);save('catalogVersion',0);save('catalogUpdatedAt',0);await ensureCatalog(true);});render();toast(`Item catalog and market values refreshed · ${qty(state.catalog.length)} items.`);
      }
      else if(act==='resetData'&&confirm('Reset all Torn Trade Analyzer discovered item history and local transaction data?')){
        ['tracked','transactions','sync','syncJob','syncCache','logTypesUpdatedAt','pinnedIds','hiddenIds','itemSearch','sortMode','ledgerSearch','ledgerSource','ledgerStatus','ledgerRange','ledgerSort','ledgerSortDir'].forEach(k=>localStorage.removeItem(NS+k));state.tracked=[];state.transactions=[];state.pinnedIds=[];state.hiddenIds=[];state.itemSearch='';state.sortMode='recent';state.ledgerSearch='';state.ledgerSource='all';state.ledgerStatus='all';state.ledgerRange='all';state.ledgerSort='acquiredAt';state.ledgerSortDir='desc';state.ledgerLimit=200;state.sync={lastSync:0,firstSyncComplete:false};state.logTypesUpdatedAt=0;state.expanded=null;syncCacheMem=null;resetAnalyticsCache();render();toast('Analyzer data reset.');
      }
    });

    root.addEventListener('pointerover',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))showChartTooltip(bar,false);});
    root.addEventListener('pointerout',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))hideChartTooltip(bar.closest('.tta-chartinteractive'));});
    root.addEventListener('focusin',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))showChartTooltip(bar,false);});
    root.addEventListener('focusout',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))hideChartTooltip(bar.closest('.tta-chartinteractive'));});
    root.addEventListener('click',e=>{
      const bar=e.target?.closest?.('.tta-profitbar');
      if(bar&&root.contains(bar)){e.stopPropagation();const wrap=bar.closest('.tta-chartinteractive'),tip=wrap?.querySelector('.tta-charttooltip'),same=bar.classList.contains('active')&&tip?.dataset.pinned==='1';if(same)hideChartTooltip(wrap,true);else showChartTooltip(bar,true);return;}
      root.querySelectorAll('.tta-chartinteractive').forEach(w=>hideChartTooltip(w,true));
    });

    root.addEventListener('input',e=>{
      const target=e.target;
      if(target.id==='tta-history-search'){
        state.itemSearch=target.value;save('itemSearch',state.itemSearch);clearTimeout(perfCache.searchTimer);perfCache.searchTimer=setTimeout(()=>renderItemList(),120);
      }else if(target.id==='tta-ledger-search'){
        state.ledgerSearch=target.value;save('ledgerSearch',state.ledgerSearch);state.ledgerLimit=200;clearTimeout(perfCache.ledgerSearchTimer);perfCache.ledgerSearchTimer=setTimeout(()=>renderLedgerRows(),120);
      }else if(target.id==='tta-search'){
        state.search=target.value;clearTimeout(perfCache.legacySearchTimer);perfCache.legacySearchTimer=setTimeout(()=>{render();const n=document.getElementById('tta-search');if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length);}},140);
      }
    });

    root.addEventListener('change',async e=>{
      const target=e.target;
      if(target.dataset.ledgerFilter){
        const kind=target.dataset.ledgerFilter,val=target.value;if(kind==='source')state.ledgerSource=val;else if(kind==='status')state.ledgerStatus=val;else if(kind==='range')state.ledgerRange=val;
        save(kind==='source'?'ledgerSource':kind==='status'?'ledgerStatus':'ledgerRange',val);state.ledgerLimit=200;renderLedgerRows();return;
      }
      if(!target.dataset.custom)return;if(target.dataset.custom==='from')state.customFrom=target.value;else state.customTo=target.value;save('customFrom',state.customFrom);save('customTo',state.customTo);state.expanded=null;
      await withBusy('Updating custom period','Applying the selected dates to cached analytics…',async()=>render());
    });

    root.addEventListener('focusin',e=>{const target=e.target;if(target.id==='tta-api-key'&&target.dataset.placeholderKey==='1'){target.value='';target.dataset.placeholderKey='0';}});
  }

  async function ensureCatalog(force=false) {
    if(state.demo&&!hasApiKey())return;
    const catalogAge=nowSec()-(Number(state.catalogUpdatedAt)||0);
    const cacheCurrent=state.catalog.length&&state.catalogVersion===CATALOG_SCHEMA_VERSION&&catalogAge>=0&&catalogAge<6*3600;if(cacheCurrent&&!force)return;
    if(!hasApiKey()){state.catalog=demoCatalog();return;}
    try{
      if(state.busy?.active)setBusyDetail('Loading the complete Torn item catalog and current market values…');
      const data=await apiGet('/torn/items');
      state.catalog=(data.items||[]).filter(x=>x&&Number(x.id)>0&&x.name).map(x=>({id:Number(x.id),name:String(x.name),image:x.image||'',type:x.type||'',marketPrice:Number(x.value?.market_price)||0})).sort((a,b)=>a.name.localeCompare(b.name)||a.id-b.id);
      state.catalogVersion=CATALOG_SCHEMA_VERSION;state.catalogUpdatedAt=nowSec();save('catalog',state.catalog);save('catalogVersion',state.catalogVersion);save('catalogUpdatedAt',state.catalogUpdatedAt);perfCache.catalogRef=null;
    }catch(e){toast(e.message);}
  }

  function addTracked(id) {
    const x=state.catalog.find(i=>Number(i.id)===Number(id)); if(!x)return;
    if(!state.tracked.some(i=>Number(i.id)===Number(id))){state.tracked.push(x);save('tracked',state.tracked);}
    state.view='dashboard';state.search='';state.demo=false;render();toast(`${x.name} added. Sync to analyze its history.`);
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
    const byId=new Map();
    (all||[]).forEach(x=>{
      const id=Number(x?.id),title=String(x?.title||'');
      if(/\btrade\b/i.test(title))return;
      if(id && ((paidContext.test(title) && paidAction.test(title)) || itemMovement.test(title) || freeContext.test(title) || KNOWN_TRANSACTION_LOGS.has(id))) byId.set(id,{...x,id});
    });
    KNOWN_TRANSACTION_LOGS.forEach((meta,id)=>{if(!byId.has(id))byId.set(id,{id,title:`${meta.source} ${meta.side}`});});
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
    if(s.includes('item market'))return'Item Market'; if(s.includes('bazaar'))return'Bazaar'; if(s.includes('abroad')||s.includes('travel'))return'Foreign Market'; if(s.includes('auction'))return'Auction House'; if(s.includes('city find'))return'City Find'; if(s.includes('crime'))return'Crime Reward'; if(s.includes('mission'))return'Mission Reward'; if(s.includes('seasonal')||s.includes('christmas')||s.includes('easter')||s.includes('halloween'))return'Seasonal Reward'; if(s.includes('job')||s.includes('company special'))return'Job / Company Reward'; if(s.includes('shop'))return'Torn Shop'; return title||'Other';
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
    const itemKeys=new Set(['items','item','items_bought','items_sold','item_bought','item_sold','items_gained','item_gained','items_received','item_received','reward_items','reward_item','loot_items','loot_item','found_items','found_item']);
    const visit=(v,defaultQty=1,depth=0)=>{
      if(v==null||depth>8)return;
      if(typeof v==='number' || (typeof v==='string' && /^\d+$/.test(v))){push(v,defaultQty);return;}
      if(Array.isArray(v)){v.forEach(z=>visit(z,defaultQty,depth+1));return;}
      if(typeof v!=='object')return;
      const id=v.id??v.item_id??v.itemId;
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
        else if(val && typeof val==='object' && depth<2 && /item|reward|loot|gain|receive|find|found/.test(lk)) visit(val,defaultQty,depth+1);
      });
    };
    const q=data.quantity??data.qty??data.amount??data.count??1;
    visit(data,q,0);
    const merged=new Map();out.forEach(x=>merged.set(x.id,(merged.get(x.id)||0)+x.qty));return [...merged].map(([id,qty])=>({id,qty}));
  }

  function cashTotal(data, qtyValue) {
    const totalKeys=['cost_total','total_cost','total','price_total','money','amount_paid','proceeds','revenue','sale_total','total_value'];
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
      setSyncProgress(`${label} · page ${page} · back to ${dateStr(Math.max(period.from,Math.min(cursorTo,nowSec())))} · ${qty(found.size)} item rows`);
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
      pages++;setSyncProgress(`Player trades · list page ${pages} · ${qty(found.size)} completed trades found`);
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
      setSyncProgress(`Player trades · ${i+1}/${listed.headers.length} · checking detailed trade · ${qty(transactions.length)} allocated item rows`);
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
    if(!hasApiKey()){state.demo=true;toast('Add a Torn API key in Settings → API Key to sync real history.');return;}
    const period=selectedPeriodBounds();
    const periodText=period.from>0?`${dateStr(period.from)} – ${dateStr(Math.min(period.to,nowSec()))}`:'all available history';
    state.syncing=true;state.syncCancel=false;updateFabState();setSyncProgress(`Preparing historical scan for ${periodText}…`);setBusy(true,'Syncing trade history',state.syncProgress,true);
    const syncBtn=document.querySelector('#tta-root [data-act="sync"]');if(syncBtn){syncBtn.disabled=true;syncBtn.innerHTML='<span class="tta-sync"><span class="tta-spinner"></span>Syncing</span>';}
    await nextPaint();
    try{
      await ensureCatalog();
      setBusyDetail('Verifying API access and log types…');
      const keyInfo=await inspectActiveKey();const probe=await probeUserLogs();const types=relevantLogTypes(await ensureLogTypes(true));
      if(!types.length)throw new Error('No relevant Torn transaction or free-acquisition log types were detected.');
      setSyncProgress(`Scanning the complete selected period: ${periodText}…`);
      let scan=await fetchFilteredHistory(types.map(x=>x.id),period);
      if(scan.diagnostics.rawRows===0){setSyncProgress('Filtered period scan returned no raw rows. Trying compatibility scan for the same dates…');scan=await fetchUnfilteredHistory(period);}
      setSyncProgress(`Scanning completed player trades for ${periodText}…`);
      const tradeScan=await fetchPlayerTradeHistory(period,keyInfo.userId);
      scan.transactions=[...scan.transactions,...tradeScan.transactions];
      scan.diagnostics.keyType=keyInfo.type;scan.diagnostics.keyLevel=keyInfo.level;scan.diagnostics.keySource=keySource();scan.diagnostics.customLogPermissions=keyInfo.customLogPermissions;scan.diagnostics.probeRows=probe.rows.length;Object.assign(scan.diagnostics,tradeScan.diagnostics);
      const fresh=scan.transactions,outside=state.transactions.filter(t=>!isLegacyTradeLogTransaction(t)&&(Number(t.timestamp)<period.from||Number(t.timestamp)>period.to)),merged=new Map(outside.map(x=>[x.id,x]));fresh.forEach(x=>merged.set(x.id,x));
      state.transactions=[...merged.values()].sort((a,b)=>a.timestamp-b.timestamp);save('transactions',state.transactions);resetAnalyticsCache();
      state.sync.lastSync=nowSec();state.sync.firstSyncComplete=!state.syncCancel;state.sync.autoDiscoveryComplete=!state.syncCancel;
      if(!state.syncCancel){const oldCoverage=Number(state.sync.coverageFrom);state.sync.coverageFrom=Number.isFinite(oldCoverage)?Math.min(oldCoverage,period.from):period.from;state.sync.coverageTo=Math.max(Number(state.sync.coverageTo)||0,Math.min(period.to,nowSec()));}
      state.sync.diagnostics=scan.diagnostics;save('sync',state.sync);
      const mode=scan.diagnostics.mode==='unfiltered-fallback'?'compatibility scan':'filtered scan';
      if(state.syncCancel)setSyncProgress(`Sync stopped · ${qty(scan.diagnostics.rawRows)} raw logs scanned · ${qty(fresh.length)} item rows collected.`);
      else if(!fresh.length)setSyncProgress(`${mode} completed for ${periodText} · ${qty(scan.diagnostics.rawRows)} raw logs scanned · no recognizable item acquisitions or sales found.`);
      else setSyncProgress(`Historical sync complete for ${periodText} · ${qty(fresh.length)} item rows · ${qty(scan.diagnostics.tradesWithItems||0)} player trades · ${qty(scan.diagnostics.rawRows)} raw logs across ${qty(scan.diagnostics.pages)} log pages.`);
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
  const SYNC_JOB_SCHEMA_VERSION = 1;
  const SYNC_CACHE_SCHEMA_VERSION = 1;
  const INCREMENTAL_OVERLAP_SEC = 300;
  let resumeBootStarted=false,resumableTxMap=null,resumableTxJob='',syncCacheMem=null;

  function ensureSyncCache() {
    if(syncCacheMem&&Number(syncCacheMem.schema)===SYNC_CACHE_SCHEMA_VERSION)return syncCacheMem;
    let c=load('syncCache',null);
    if(!c||Number(c.schema)!==SYNC_CACHE_SCHEMA_VERSION)c={schema:SYNC_CACHE_SCHEMA_VERSION,verifiedTrades:{},logCoverageFrom:null,logCoverageTo:0,tradeCoverageFrom:null,tradeCoverageTo:0};
    if(!c.verifiedTrades||typeof c.verifiedTrades!=='object')c.verifiedTrades={};
    let seeded=false;
    for(const t of state.transactions||[]){
      const id=Number(t?.tradeId)||0;
      if(t?.source==='Player Trade'&&id>0&&!c.verifiedTrades[id]){c.verifiedTrades[id]=Number(t.timestamp)||1;seeded=true;}
    }
    syncCacheMem=c;if(seeded)save('syncCache',c);return c;
  }
  function saveSyncCache(){if(syncCacheMem)save('syncCache',syncCacheMem);}
  function incrementalPeriod(period,kind) {
    const c=ensureSyncCache(),fromKey=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',toKey=kind==='trade'?'tradeCoverageTo':'logCoverageTo';
    const rawFrom=c[fromKey],coveredFrom=rawFrom==null?NaN:Number(rawFrom),coveredTo=Number(c[toKey])||0;
    if(Number.isFinite(coveredFrom)&&coveredFrom<=period.from&&coveredTo>0){
      if(period.to<=coveredTo)return null;
      return {from:Math.max(period.from,coveredTo-INCREMENTAL_OVERLAP_SEC),to:period.to,incremental:true};
    }
    return {from:period.from,to:period.to,incremental:false};
  }
  function updateSyncCoverage(job) {
    const c=ensureSyncCache();
    const apply=(kind,p)=>{
      if(!p)return;const fk=kind==='trade'?'tradeCoverageFrom':'logCoverageFrom',tk=kind==='trade'?'tradeCoverageTo':'logCoverageTo';
      const rawOldFrom=c[fk],oldFrom=rawOldFrom==null?NaN:Number(rawOldFrom);if(!p.incremental)c[fk]=Number.isFinite(oldFrom)?Math.min(oldFrom,p.from):p.from;
      c[tk]=Math.max(Number(c[tk])||0,Math.min(p.to,nowSec()));
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
  function syncJobCancelled(job){return !!(state.syncCancel||job?.cancelled);}
  function checkpointSyncJob(job,progress='') {
    if(progress){job.progress=String(progress);setSyncProgress(job.progress);}
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
    return {rawRows:0,parsedRows:0,matchedRows:0,existingRowsSkipped:0,batches,logTypes,pages:0,oldestTimestamp:0,mode,periodFrom:job.period.from,periodTo:job.period.to,tradeHeaders:0,tradeListPages:0,tradeDetails:0,tradeDetailsSkipped:0,tradesWithItems:0,tradeTransactions:0,tradeSoldQty:0,tradeBoughtQty:0,incrementalLogs:!!job.logScanPeriod?.incremental,incrementalTrades:!!job.tradeScanPeriod?.incremental};
  }
  function createResumableSyncJob() {
    stripSyncRunMarkers();
    const period=selectedPeriodBounds(),periodText=period.from>0?`${dateStr(period.from)} – ${dateStr(Math.min(period.to,nowSec()))}`:'all available history';
    const logScanPeriod=incrementalPeriod(period,'log'),tradeScanPeriod=incrementalPeriod(period,'trade');
    const job={schema:SYNC_JOB_SCHEMA_VERSION,id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,active:true,cancelled:false,createdAt:nowSec(),updatedAt:nowSec(),period,periodText,logScanPeriod,tradeScanPeriod,phase:'setup',progress:`Preparing incremental sync for ${periodText}…`,resumedCount:0,logTypeIds:[],logMode:'filtered',logBatchIndex:0,logCursorTo:logScanPeriod?.to||period.to,logPage:0,logPreviousSignature:'',userId:0,diagnostics:null,tradeHeaders:[],tradeListParams:null,tradeListSeen:[],tradeDetailIndex:0,verifiedTradeIds:[],verifiedTradeTimes:{}};
    checkpointSyncJob(job,job.progress);return job;
  }
  async function syncApiGet(path,params={}) {
    let last;
    for(let attempt=0;attempt<3;attempt++){
      try{return await apiGet(path,params);}catch(e){last=e;if(attempt>=2)break;setSyncProgress(`Temporary API error · retry ${attempt+2}/3 · ${e.message}`);await sleep(1200*(attempt+1));}
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
      checkpointSyncJob(job,`${label} · page ${page} · back to ${dateStr(Math.max(scanPeriod.from,Math.min(cursor,nowSec())))}`);
      const params={limit:100,to:cursor};if(scanPeriod.from>0)params.from=scanPeriod.from;if(filtered)params.log=batchIds.join(',');
      const data=await syncApiGet('/user/log',params),rows=Array.isArray(data?.log)?data.log:[];
      job.diagnostics.pages=(Number(job.diagnostics.pages)||0)+1;
      if(!rows.length){advanceResumableLogBatch(job);checkpointSyncJob(job,`${label} · page ${page} complete`);continue;}
      const parsedRows=[];
      job.diagnostics.rawRows=(Number(job.diagnostics.rawRows)||0)+rows.length;
      for(const r of rows){
        const ts=Number(r?.timestamp)||0;if(ts<scanPeriod.from||ts>scanPeriod.to)continue;
        const parsed=parseLogEntry(r);job.diagnostics.parsedRows+=parsed.length;job.diagnostics.matchedRows+=parsed.length;parsedRows.push(...parsed);
      }
      checkpointTransactionRows(job,parsedRows);
      const timestamps=rows.map(r=>Number(r?.timestamp)).filter(Number.isFinite);
      if(!timestamps.length){advanceResumableLogBatch(job);checkpointSyncJob(job,`${label} · page ${page} complete`);continue;}
      const oldest=Math.min(...timestamps),signature=rows.map(rawLogKey).join('|');
      job.diagnostics.oldestTimestamp=job.diagnostics.oldestTimestamp?Math.min(job.diagnostics.oldestTimestamp,oldest):oldest;
      let done=scanPeriod.from>0&&oldest<=scanPeriod.from,nextTo=oldest;
      if(signature===job.logPreviousSignature)nextTo=oldest-1;
      if(!Number.isFinite(nextTo)||(nextTo>=cursor&&signature===job.logPreviousSignature)||(scanPeriod.from>0&&nextTo<scanPeriod.from))done=true;
      if(done)advanceResumableLogBatch(job);else{job.logCursorTo=nextTo;job.logPage=page;job.logPreviousSignature=signature;}
      checkpointSyncJob(job,`${label} · ${qty(job.diagnostics.matchedRows||0)} item rows checkpointed`);
      if(!syncJobCancelled(job))await sleep(REQUEST_GAP_MS);
    }
    return !syncJobCancelled(job);
  }
  function compactTradeHeader(row) {
    const id=Number(row?.id)||0,ts=Number(row?.completed_at||row?.timestamp)||0,n=Number(row?.items);
    return id>0&&ts>0?{id,completed_at:ts,items:Number.isFinite(n)?n:null}:null;
  }
  async function runResumableTradeList(job) {
    const scanPeriod=job.tradeScanPeriod;
    if(!scanPeriod){job.phase='finalize';checkpointSyncJob(job,'Player trades already fully covered · no trade API requests needed.');return true;}
    const found=new Map((job.tradeHeaders||[]).map(x=>[Number(x.id),x]));
    let params=job.tradeListParams||{cat:'finished',limit:100,sort:'DESC',to:scanPeriod.to};if(scanPeriod.from>0&&!('from'in params))params.from=scanPeriod.from;
    const seen=new Set(job.tradeListSeen||[]);
    while(!syncJobCancelled(job)){
      const page=(Number(job.diagnostics.tradeListPages)||0)+1;checkpointSyncJob(job,`Player trades · list page ${page} · ${qty(found.size)} completed trades checkpointed`);
      const data=await syncApiGet('/user/trades',params),rows=Array.isArray(data?.trades)?data.trades:[];job.diagnostics.tradeListPages=page;
      for(const row of rows){const h=compactTradeHeader(row);if(h&&h.completed_at>=scanPeriod.from&&h.completed_at<=scanPeriod.to)found.set(h.id,h);}
      job.tradeHeaders=[...found.values()];job.diagnostics.tradeHeaders=job.tradeHeaders.length;
      const next=nextLogPageParams(data,params);
      if(!next||!rows.length){job.tradeListParams=null;job.phase='trade-details';job.tradeDetailIndex=Number(job.tradeDetailIndex)||0;checkpointSyncJob(job,`Player trades · ${qty(job.tradeHeaders.length)} completed trades listed`);return true;}
      const sig=JSON.stringify(Object.keys(next).sort().map(k=>[k,next[k]]));
      if(seen.has(sig)){job.tradeListParams=null;job.phase='trade-details';checkpointSyncJob(job,`Player trades · repeated page stopped safely · ${qty(job.tradeHeaders.length)} trades listed`);return true;}
      seen.add(sig);job.tradeListSeen=[...seen].slice(-80);job.tradeListParams=next;checkpointSyncJob(job,`Player trades · list page ${page} saved`);await sleep(REQUEST_GAP_MS);
    }
    return false;
  }
  async function runResumableTradeDetails(job) {
    const headers=job.tradeHeaders||[];
    while((Number(job.tradeDetailIndex)||0)<headers.length&&!syncJobCancelled(job)){
      const i=Number(job.tradeDetailIndex)||0,h=headers[i];
      if(isTradeVerified(job,h.id)){
        job.diagnostics.tradeDetailsSkipped=(Number(job.diagnostics.tradeDetailsSkipped)||0)+1;job.tradeDetailIndex=i+1;
        checkpointSyncJob(job,`Player trades · ${i+1}/${headers.length} · already verified, skipped`);continue;
      }
      checkpointSyncJob(job,`Player trades · ${i+1}/${headers.length} · fetching missing detailed trade #${Number(h.id)}`);
      const data=await syncApiGet(`/user/${Number(h.id)}/trade`);job.diagnostics.tradeDetails=(Number(job.diagnostics.tradeDetails)||0)+1;
      const rows=parsePlayerTrade(data?.trade,job.userId);
      const soldRows=rows.filter(x=>x.side==='sell'),boughtRows=rows.filter(x=>x.side==='buy');
      if(rows.length){
        job.diagnostics.tradesWithItems=(Number(job.diagnostics.tradesWithItems)||0)+1;
        job.diagnostics.tradeTransactions=(Number(job.diagnostics.tradeTransactions)||0)+rows.length;
        job.diagnostics.tradeSoldQty=(Number(job.diagnostics.tradeSoldQty)||0)+soldRows.reduce((n,x)=>n+(Number(x.qty)||0),0);
        job.diagnostics.tradeBoughtQty=(Number(job.diagnostics.tradeBoughtQty)||0)+boughtRows.reduce((n,x)=>n+(Number(x.qty)||0),0);
        checkpointTransactionRows(job,rows);
      }
      markTradeVerified(job,h.id,h.completed_at);job.tradeDetailIndex=i+1;checkpointSyncJob(job,`Player trades · ${i+1}/${headers.length} · detail verified and cached`);
      if(job.tradeDetailIndex<headers.length&&!syncJobCancelled(job))await sleep(REQUEST_GAP_MS);
    }
    if(!syncJobCancelled(job)){job.phase='finalize';checkpointSyncJob(job,'Finalizing cached history and FIFO inputs…');return true;}return false;
  }
  async function prepareResumableSync(job) {
    await ensureCatalog();setBusyDetail('Verifying API access and incremental coverage…');
    const keyInfo=await inspectActiveKey();if(!keyInfo.hasUserLog)throw new Error('This API key does not include User → Log access.');
    let types=[];if(job.logScanPeriod)types=relevantLogTypes(await ensureLogTypes(false));
    if(job.logScanPeriod&&!types.length)throw new Error('No relevant Torn transaction or free-acquisition log types were detected.');
    job.userId=keyInfo.userId;job.logTypeIds=types.map(x=>Number(x.id)).filter(x=>x>0);job.logMode='filtered';job.logBatchIndex=0;job.logCursorTo=job.logScanPeriod?.to||job.period.to;job.logPage=0;job.logPreviousSignature='';
    job.diagnostics=newSyncDiagnostics(job,'filtered',job.logTypeIds.length,job.logScanPeriod?Math.ceil(job.logTypeIds.length/MAX_LOG_IDS_PER_REQUEST):0);
    job.diagnostics.keyType=keyInfo.type;job.diagnostics.keyLevel=keyInfo.level;job.diagnostics.keySource=keySource();job.diagnostics.customLogPermissions=keyInfo.customLogPermissions;job.diagnostics.probeRows=0;
    if(job.logScanPeriod){job.phase='logs-filtered';checkpointSyncJob(job,`${job.logScanPeriod.incremental?'Scanning only new/missing logs':'Establishing log baseline'} · ${dateStr(job.logScanPeriod.from)} – ${dateStr(Math.min(job.logScanPeriod.to,nowSec()))}`);}
    else{job.phase='trades-list';checkpointSyncJob(job,'Normal sale logs already fully covered · skipping log scan.');}
  }
  function finishResumableSync(job) {
    const freshCount=finalizeResumableTransactions(job),d=job.diagnostics||{};commitTradeVerifications(job);updateSyncCoverage(job);
    state.sync.lastSync=nowSec();state.sync.firstSyncComplete=true;state.sync.autoDiscoveryComplete=true;
    const oldCoverage=Number(state.sync.coverageFrom);state.sync.coverageFrom=Number.isFinite(oldCoverage)?Math.min(oldCoverage,job.period.from):job.period.from;state.sync.coverageTo=Math.max(Number(state.sync.coverageTo)||0,Math.min(job.period.to,nowSec()));state.sync.diagnostics=d;save('sync',state.sync);
    const mode=d.mode==='unfiltered-fallback'?'compatibility scan':'filtered scan';
    if(!freshCount)setSyncProgress(`Sync up to date for ${job.periodText} · ${qty(d.existingRowsSkipped||0)} existing rows skipped · ${qty(d.tradeDetailsSkipped||0)} verified trade details skipped.`);
    else setSyncProgress(`Incremental sync complete · ${qty(freshCount)} new item rows · ${qty(d.existingRowsSkipped||0)} existing rows skipped · ${qty(d.tradeDetailsSkipped||0)} verified trades skipped · ${qty(d.tradeDetails||0)} missing trade details fetched.`);
    job.active=false;job.phase='done';clearSyncJob();
  }
  async function runResumableSync(job,resumed=false) {
    if(state.syncing)return;
    state.syncing=true;state.syncCancel=false;updateFabState();
    if(resumed){const prior=String(job.progress||job.periodText).replace(/^Resumed after page reload · /,'');job.resumedCount=(Number(job.resumedCount)||0)+1;checkpointSyncJob(job,`Resumed after page reload · ${prior}`);}
    else setSyncProgress(job.progress||`Preparing historical scan for ${job.periodText}…`);
    setBusy(true,resumed?'Resuming trade history sync':'Syncing trade history',state.syncProgress,true);
    const syncBtn=document.querySelector('#tta-root [data-act="sync"]');if(syncBtn){syncBtn.disabled=true;syncBtn.innerHTML='<span class="tta-sync"><span class="tta-spinner"></span>Syncing</span>';}
    if(state.open)await nextPaint();
    try{
      while(!syncJobCancelled(job)&&job.active){
        if(job.phase==='setup')await prepareResumableSync(job);
        else if(job.phase==='logs-filtered'){
          await runResumableLogPhase(job,'filtered');if(syncJobCancelled(job))break;
          if((Number(job.diagnostics?.rawRows)||0)===0&&!job.logScanPeriod?.incremental){job.phase='logs-fallback';job.logMode='unfiltered';job.logBatchIndex=0;job.logCursorTo=job.logScanPeriod?.to||job.period.to;job.logPage=0;job.logPreviousSignature='';job.diagnostics=newSyncDiagnostics(job,'unfiltered-fallback',0,1);checkpointSyncJob(job,'Baseline filtered scan returned no raw rows · starting compatibility scan…');}
          else{job.phase='trades-list';checkpointSyncJob(job,`Checking only missing player trades for ${job.periodText}…`);}
        }
        else if(job.phase==='logs-fallback'){await runResumableLogPhase(job,'unfiltered');if(syncJobCancelled(job))break;job.phase='trades-list';checkpointSyncJob(job,`Checking only missing player trades for ${job.periodText}…`);}
        else if(job.phase==='trades-list')await runResumableTradeList(job);
        else if(job.phase==='trade-details')await runResumableTradeDetails(job);
        else if(job.phase==='finalize'){finishResumableSync(job);break;}
        else{job.phase='setup';checkpointSyncJob(job,'Repairing an unknown sync checkpoint…');}
      }
      if(syncJobCancelled(job)){
        job.cancelled=true;commitTradeVerifications(job);abandonResumableMarkers(job);clearSyncJob();setSyncProgress(`Sync stopped · verified trade details remain cached · partial new rows kept safely.`);
      }
    }catch(e){
      job.lastError=String(e?.message||e);job.lastErrorAt=nowSec();
      try{checkpointSyncJob(job,`Sync paused at saved checkpoint · ${job.lastError} · tap Sync or reload a Torn page to retry.`);}catch(saveError){setSyncProgress(`Sync stopped: ${saveError.message}`);clearSyncJob();abandonResumableMarkers(job);}
    }
    finally{state.syncing=false;updateFabState();setBusy(false);render();}
  }
  async function syncAll(options={}) {
    if(state.syncing)return;
    if(!hasApiKey()){state.demo=true;toast('Add a Torn API key in Settings → API Key to sync real history.');return;}
    let job=options?.job||loadSyncJob();
    if(job?.cancelled){abandonResumableMarkers(job);clearSyncJob();job=null;}
    if(!job)job=createResumableSyncJob();
    return runResumableSync(job,!!options?.resume||Number(job.resumedCount)>0||job.phase!=='setup');
  }
  function resumePendingSync() {
    if(resumeBootStarted||state.syncing)return;
    const job=loadSyncJob();if(!job)return;
    if(job.cancelled){abandonResumableMarkers(job);clearSyncJob();return;}
    resumeBootStarted=true;syncAll({job,resume:true});
  }
  function persistSyncCancellation() {
    const job=loadSyncJob();if(!job)return;job.cancelled=true;job.progress='Stopping after the current API request…';saveSyncJob(job);
  }
  document.addEventListener('click',e=>{const el=e.target?.closest?.('#tta-root [data-act="cancelSync"]');if(el)persistSyncCancellation();},true);

  const boot=()=>{if(document.body){mount();resumePendingSync();}else setTimeout(boot,250)}; boot();
  setInterval(()=>{if(!document.getElementById('tta-fab')||!document.getElementById('tta-root'))mount();},5000);
})();
