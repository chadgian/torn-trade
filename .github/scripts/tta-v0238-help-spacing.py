from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

s=s.replace('// @version      0.2.37','// @version      0.2.38',1)
s=s.replace("const VERSION = '0.2.37';","const VERSION = '0.2.38';",1)

# Wrap every Help card icon + title into an explicit compact header row.
start=s.index('  function helpHtml() {')
end=s.index('\n  function settingsHtml()', start)
block=s[start:end]
pattern=re.compile(r'(<section class="tta-help-card(?: wide)?">)<div class="icon">(.*?)</div><h3>(.*?)</h3><p>')
block_new,n=pattern.subn(r'\1<div class="tta-help-card-head"><div class="icon">\2</div><h3>\3</h3></div><p>',block)
if n < 10:
    raise SystemExit(f'expected Help cards, transformed only {n}')
s=s[:start]+block_new+s[end:]

css_anchor='''      /* v0.2.36 interactive cash-flow trend */\n'''
css=r'''      /* v0.2.38 Help & Guide spacing isolation */
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

'''
if css_anchor not in s:
    raise SystemExit('CSS insertion anchor not found')
s=s.replace(css_anchor,css+css_anchor,1)

for needle in ['// @version      0.2.38',"const VERSION = '0.2.38';",'tta-help-card-head','Help & Guide spacing isolation']:
    if needle not in s: raise SystemExit(f'missing {needle}')
if any(ord(ch)>=128 for ch in s): raise SystemExit('non-ASCII character introduced')
p.write_text(s,encoding='ascii')
