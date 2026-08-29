from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.21','// @version      0.2.22',1)
s=s.replace("const VERSION = '0.2.21';","const VERSION = '0.2.22';",1)

anchor="""  const API = 'https://api.torn.com/v2';
  const REQUEST_GAP_MS = 700; // ~86 requests/minute, keeping headroom under Torn's 100/min user limit.
"""
replacement="""  const API = 'https://api.torn.com/v2';
  const ANALYZER_CUSTOM_KEY_URL = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=CashFlowAnalyzer&user=log,trade,trades,money,networth&company=profile,employees&torn=items,logtypes';
  const REQUEST_GAP_MS = 700; // ~86 requests/minute, keeping headroom under Torn's 100/min user limit.
"""
if anchor not in s: raise SystemExit('API constant anchor missing')
s=s.replace(anchor,replacement,1)

old_css="""      #tta-fab.snapping{transition:left .2s cubic-bezier(.22,.8,.32,1),transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease}
      /* v0.2.18 finance suite */
"""
new_css="""      #tta-fab.snapping{transition:left .2s cubic-bezier(.22,.8,.32,1),transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease}
      /* v0.2.22 API key setup */
      .tta-keyinputrow{grid-template-columns:minmax(0,1fr) auto auto}.tta-keycreate{white-space:nowrap}
      @media(max-width:520px){.tta-keyinputrow{grid-template-columns:1fr 1fr}.tta-keyinputrow input{grid-column:1/-1}.tta-keyinputrow .tta-btn{width:100%}}
      @media(max-width:380px){.tta-keyinputrow{grid-template-columns:1fr}.tta-keyinputrow input{grid-column:auto}}
      /* v0.2.18 finance suite */
"""
if old_css not in s: raise SystemExit('CSS insertion anchor missing')
s=s.replace(old_css,new_css,1)

old_key="""      <div class=\"tta-keycard\"><div class=\"tta-keyhead\"><strong>API Key</strong><span class=\"tta-keystatus\">${esc(status)}</span></div><div class=\"tta-keyinputrow\"><input id=\"tta-api-key\" type=\"password\" inputmode=\"text\" autocomplete=\"off\" autocapitalize=\"off\" spellcheck=\"false\" placeholder=\"Paste your Torn API key\" value=\"${esc(masked)}\" data-placeholder-key=\"${state.apiKey?'1':'0'}\"><button class=\"tta-btn\" data-act=\"saveApiKey\">Save & test</button></div><div class=\"tta-keynote\">Stored only in this device's local storage and sent only to Torn's official API. It is never uploaded to GitHub or sent to us. Use a custom key with <strong>User → Log</strong>; for free-item history, do not restrict away categories such as Crime success, City finds, Mission rewards, Seasonal gift, and similar reward logs.</div>${state.apiKey?'<div class=\"tta-settings-actions\"><button class=\"tta-btn danger\" data-act=\"clearApiKey\">Clear saved API key</button></div>':''}</div>
"""
new_key="""      <div class=\"tta-keycard\"><div class=\"tta-keyhead\"><strong>API Key</strong><span class=\"tta-keystatus\">${esc(status)}</span></div><div class=\"tta-keyinputrow\"><input id=\"tta-api-key\" type=\"password\" inputmode=\"text\" autocomplete=\"off\" autocapitalize=\"off\" spellcheck=\"false\" placeholder=\"Paste your Torn API key\" value=\"${esc(masked)}\" data-placeholder-key=\"${state.apiKey?'1':'0'}\"><button class=\"tta-btn secondary tta-keycreate\" data-act=\"createApiKey\" title=\"Create a Torn custom API key for this analyzer\">＋ Create key</button><button class=\"tta-btn\" data-act=\"saveApiKey\">Save & test</button></div><div class=\"tta-keynote\"><strong>Create key</strong> opens Torn's official API settings and generates a custom key named <strong>CashFlowAnalyzer</strong> with only the selections used by this analyzer: User Log/Trade/Trades/Money/Networth, Company Profile/Employees, and Torn Items/Logtypes. Copy the generated key, return here, paste it above, then tap <strong>Save & test</strong>. Your key is stored only on this device and is sent only to Torn's official API; it is never uploaded to GitHub or sent to us. User Log remains unrestricted by log category so financial activity, player transfers and free-item/reward history can be discovered.</div>${state.apiKey?'<div class=\"tta-settings-actions\"><button class=\"tta-btn danger\" data-act=\"clearApiKey\">Clear saved API key</button></div>':''}</div>
"""
if old_key not in s: raise SystemExit('API key UI anchor missing')
s=s.replace(old_key,new_key,1)

old_tos="""Required access: public Torn item/log-type endpoints plus <strong>User → Log</strong>. Torn PDA's injected key remains supported as a fallback."""
new_tos="""Required custom-key selections: <strong>User → Log, Trade, Trades, Money, Networth</strong>; <strong>Company → Profile, Employees</strong>; <strong>Torn → Items, Logtypes</strong>. Torn PDA's injected key remains supported as a fallback."""
if old_tos not in s: raise SystemExit('TOS access text anchor missing')
s=s.replace(old_tos,new_tos,1)

old_help="""Open <b>Settings</b>, add a Torn API key with <b>User → Log</b> access, then run <b>Quick Sync</b>. The analyzer discovers recognizable cash movements, item acquisitions, sales and completed player trades. Torn PDA's injected API key is also supported."""
new_help="""Open <b>Settings</b> and tap <b>Create key</b> to have Torn generate a custom API key with the analyzer's required selections. Copy the generated key back into Settings, tap <b>Save & test</b>, then run <b>Quick Sync</b>. Torn PDA's injected API key is also supported."""
if old_help not in s: raise SystemExit('Help getting-started anchor missing')
s=s.replace(old_help,new_help,1)

handler_anchor="""      else if(act==='saveApiKey'){
"""
handler_new="""      else if(act==='createApiKey'){
        state.open=false;window.location.href=ANALYZER_CUSTOM_KEY_URL;return;
      }
      else if(act==='saveApiKey'){
"""
if handler_anchor not in s: raise SystemExit('saveApiKey handler anchor missing')
s=s.replace(handler_anchor,handler_new,1)

p.write_text(s)
