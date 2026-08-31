from pathlib import Path

p=Path('.github/scripts/tta-v0245-networth-audit.py')
text=p.read_text(encoding='utf-8')
start=text.index('# Add component breakdown to daily HTML and stronger reconciliation wording.')
next_anchor=text.index('rep("</div></div><div class=', start)
replacement=r'''# Add component breakdown to daily HTML and stronger reconciliation wording.
needle='    const rows=d.rows.slice(0,20).map(x=>`<div class="tta-nw-change">'
component=''' + "'''" + r'''    const componentHtml=(d.componentChanges||[]).length?`<div class="tta-fin-section"><div class="tta-sectionhead"><div><small>Torn snapshot components</small><h3>What changed between stored snapshots</h3></div><span class="tta-sectionhint">${qty(d.componentChanges.length)} changed</span></div><div class="tta-breakdown">${d.componentChanges.slice(0,12).map(c=>`<div class="tta-fin-row"><span>${esc(netWorthComponentLabel(c.key))}</span><b class="${c.delta>=0?'pos':'neg'}">${c.delta>=0?'+':''}${money(c.delta)}</b></div>`).join('')}</div>${d.componentChanges.length>12?`<div class="tta-morehint">Showing the 12 largest component movements.</div>`:''}</div>`:'';
''' + "'''" + r'''
if needle not in s: raise SystemExit('daily NW rows anchor not found')
s=s.replace(needle,component+needle,1)

'''
text=text[:start]+replacement+text[next_anchor:]
p.write_text(text,encoding='utf-8')
