from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()
old='https://raw.githubusercontent.com/chadgian/torn-trade/main/torn-trade-analyzer.user.js'
new='https://torn-trade.obliviate.workers.dev/torn-trade-analyzer.user.js'
if s.count(old) < 2:
    raise SystemExit('Expected GitHub update/download URLs not found')
s=s.replace('// @version      0.2.24','// @version      0.2.25',1)
s=s.replace("const VERSION = '0.2.24';","const VERSION = '0.2.25';",1)
s=s.replace(old,new,2)
p.write_text(s)
