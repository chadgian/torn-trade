from pathlib import Path
p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')
s=s.replace('// @version      0.2.34','// @version      0.2.35',1)
s=s.replace("const VERSION = '0.2.34';","const VERSION = '0.2.35';",1)
old="""    const removed=before-state.cashFlows.length;
    if(removed>0){save('cashFlows',state.cashFlows);resetAnalyticsCache();}
    return removed;
"""
new="""    const removed=before-state.cashFlows.length;
    // This migration runs during startup before perfCache is initialized, so only
    // persist the cleaned rows here. Analytics caches are still empty at this point.
    if(removed>0)save('cashFlows',state.cashFlows);
    return removed;
"""
if old not in s: raise SystemExit('purge cleanup anchor not found')
s=s.replace(old,new,1)
if '// @version      0.2.35' not in s or "const VERSION = '0.2.35';" not in s: raise SystemExit('version bump failed')
if 'if(removed>0)save' not in s: raise SystemExit('startup fix missing')
if any(ord(ch)>=128 for ch in s): raise SystemExit('non-ASCII character introduced')
p.write_text(s,encoding='ascii')
