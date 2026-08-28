from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

assert '// @version      0.2.11' in s
assert "const VERSION = '0.2.11';" in s
s=s.replace('// @version      0.2.11','// @version      0.2.12',1)
s=s.replace("const VERSION = '0.2.11';","const VERSION = '0.2.12';",1)
s=s.replace('Torn cash-flow, spending, earnings, net-worth and trade analytics with a clean Bento dashboard, TCT daily flow and fast sync modes. Data stays on-device.','Torn cash-flow, spending, earnings, net-worth and trade analytics with a clean Bento dashboard, Torn PDA parser-safe rendering, TCT daily flow and fast sync modes. Data stays on-device.',1)

old="""    const apiBanner=!hasApiKey()?'<div class=\"tta-banner\"><strong>Preview mode.</strong> Add a Torn API key in Settings to build your financial ledger.</div>':'';
    const lastSync=state.sync?.lastSync?`Last sync ${esc(tctDateTimeStr(state.sync.lastSync))} TCT`:'Run Quick Sync to load today’s movements';
    const movementLabel=`${qty(todayRows.length)} movement${todayRows.length===1?'':'s'} recorded today`;
    const moreLabel=todayRows.length>12?`<div class=\"tta-morehint\">Showing the latest 12 of ${qty(todayRows.length)} movements from the current TCT day.</div>`:'';
    const networthLabel=snap?.networth?money(nw):'Sync to load';
    const netClass=sum.net>=0?'pos':'neg';
    const profitClass=portfolio.realizedProfit>=0?'pos':'neg';
    return `${header('Cash Flow Analyzer',`v${VERSION} · clear financial overview`)}<div class=\"tta-content tta-dashboard\">"""
new="""    let apiBanner='';
    if(!hasApiKey())apiBanner='<div class=\"tta-banner\"><strong>Preview mode.</strong> Add a Torn API key in Settings to build your financial ledger.</div>';
    let lastSync='Run Quick Sync to load today&#39;s movements';
    if(state.sync?.lastSync)lastSync='Last sync '+esc(tctDateTimeStr(state.sync.lastSync))+' TCT';
    let movementLabel=qty(todayRows.length)+' movement';
    if(todayRows.length!==1)movementLabel+='s';
    movementLabel+=' recorded today';
    let moreLabel='';
    if(todayRows.length>12)moreLabel='<div class=\"tta-morehint\">Showing the latest 12 of '+qty(todayRows.length)+' movements from the current TCT day.</div>';
    const networthLabel=snap?.networth?money(nw):'Sync to load';
    const netClass=sum.net>=0?'pos':'neg';
    const profitClass=portfolio.realizedProfit>=0?'pos':'neg';
    const dashboardHeader=header('Cash Flow Analyzer','v'+VERSION+' · clear financial overview');
    return `${dashboardHeader}<div class=\"tta-content tta-dashboard\">"""
assert old in s, 'Expected v0.2.11 Bento dashboard fragment not found'
s=s.replace(old,new,1)

# Use HTML entities for the newly introduced dashboard heading punctuation so the
# injected JavaScript source stays simple ASCII around apostrophes.
s=s.replace('<h3>Today’s cash movements</h3>','<h3>Today&#39;s cash movements</h3>',1)

p.write_text(s)

rp=Path('README.md')
r=rp.read_text()
r=re.sub(r'\*\*Current version:\*\* v[^\n]+','**Current version:** v0.2.12',r,count=1)
r+='''\n\n## v0.2.12 — Torn PDA parser compatibility\n\n- Fixes a startup failure reported by Torn PDA as `Uncaught SyntaxError: Unexpected identifier 's'`.\n- Removes the Bento dashboard's nested pluralization template expression and precomputes the movement labels with plain statements.\n- Simplifies newly introduced dashboard strings while preserving the v0.2.11 Bento layout and current-TCT calculations.\n- Keeps the proven v0.2.1 floating-launcher runtime unchanged byte-for-byte.\n- No accounting, sync, FIFO, acquisition-history or net-worth calculation changes.\n'''
rp.write_text(r)
