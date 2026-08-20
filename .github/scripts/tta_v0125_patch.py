from pathlib import Path

p = Path('torn-trade-analyzer.user.js')
s = p.read_text()

s = s.replace('// @version      0.1.24', '// @version      0.1.25', 1)
s = s.replace('// @description  Fast Torn trade analytics with TCT day-gap recovery, current-server sync bounds, interactive profit charts, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.', '// @description  Fast Torn trade analytics with continuous TCT timelines, TCT day-gap recovery, current-server sync bounds, FIFO ledger, Player Trades, and incremental sync. Data stays on-device.', 1)
s = s.replace("const VERSION = '0.1.24';", "const VERSION = '0.1.25';", 1)

anchor = "  function tctDayStart(ts) { return Math.floor((Number(ts)||0)/86400)*86400; }\n"
insert = "  function tctDayStart(ts) { return Math.floor((Number(ts)||0)/86400)*86400; }\n  function tctWeekStart(ts) { const d=new Date((Number(ts)||0)*1000),wd=(d.getUTCDay()+6)%7;d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-wd);return Math.floor(d.getTime()/1000); }\n  function tctMonthStart(ts) { const d=new Date((Number(ts)||0)*1000);return Math.floor(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)/1000); }\n  function nextTctMonthStart(ts) { const d=new Date((Number(ts)||0)*1000);return Math.floor(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000); }\n"
if anchor not in s:
    raise SystemExit('TCT helper anchor not found')
s = s.replace(anchor, insert, 1)

old = """  function profitSeries(itemId=null) {
    const cacheKey=`${periodCacheKey()}|${state.granularity}|${itemId==null?'all':Number(itemId)}`;
    if(perfCache.series.has(cacheKey))return perfCache.series.get(cacheKey);
    const {from,to}=dateRange(),m=new Map(),rows=itemId==null?acquisitionLedgerRows():ledgerRowsForItem(Number(itemId));
    const keyFn=state.granularity==='week'?weekKey:state.granularity==='month'?monthKey:dayKey;
    for(const row of rows){
      if(row.acquiredAt<from||row.acquiredAt>to||row.soldQty<=0)continue;
      const k=keyFn(row.acquiredAt);m.set(k,(m.get(k)||0)+(Number(row.realizedProfit)||0));
    }
    const boundary=Math.min(to,nowSec());
    // Keep a live/current bucket visible even when today's acquisition-attributed profit is $0.
    // This prevents a current sync from looking stale merely because the latest realized-profit lot is older.
    if(m.size&&boundary>=from){const k=keyFn(boundary);if(!m.has(k))m.set(k,0);}
    const result=[...m.entries()].sort((a,b)=>a[0]-b[0]).map(([t,v])=>({t,v}));perfCache.series.set(cacheKey,result);return result;
  }

  function chartBucketLabel(ts) {
    const d=new Date((Number(ts)||0)*1000);
    if(state.granularity==='month')return d.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    if(state.granularity==='week')return `Week of ${dateStr(ts)}`;
    return dateStr(ts);
  }
"""
new = """  function profitSeries(itemId=null) {
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
"""
if old not in s:
    raise SystemExit('profitSeries block not found')
s = s.replace(old, new, 1)

old_label = "const d=new Date(p.t*1000);const lab=state.granularity==='month'?d.toLocaleDateString(undefined,{month:'short'}):d.toLocaleDateString(undefined,{month:'short',day:'numeric'});"
new_label = "const d=new Date(p.t*1000);const lab=state.granularity==='month'?d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short'}):d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'});"
if old_label not in s:
    raise SystemExit('chart label block not found')
s = s.replace(old_label, new_label, 1)

p.write_text(s)

r = Path('README.md')
rs = r.read_text()
rs = rs.replace('**Current version:** v0.1.24', '**Current version:** v0.1.25', 1)
needle = '- Interactive Day / Week / Month profit charts with exact-value hover/tap tooltips.\n'
replacement = needle + '- Profit charts use Torn City Time (TCT/UTC) calendar buckets and keep every date/week/month in sequence, including zero-profit buckets, so checked days never visually disappear.\n'
if needle not in rs:
    raise SystemExit('README feature anchor not found')
rs = rs.replace(needle, replacement, 1)
rs += "\n\n## v0.1.25 continuous TCT timeline\n\n- Day/Week/Month profit charts now use TCT (UTC) boundaries instead of the device timezone.\n- Every bucket between the selected period start and the latest successfully synced TCT time is generated, even when profit is $0.\n- This prevents dates from disappearing simply because there was no realized acquisition-attributed profit on that day.\n- Sync coverage remains separate from activity: a checked-empty TCT day is still a checked day.\n"
r.write_text(rs)
