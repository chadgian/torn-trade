from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

def rep(old,new,label):
    global s
    if old not in s:
        raise SystemExit(f'missing anchor: {label}')
    s=s.replace(old,new,1)

rep('// @version      0.2.43','// @version      0.2.44','version header')
rep("const VERSION = '0.2.43';","const VERSION = '0.2.44';",'version const')
rep("const latest=snapshots[snapshots.length-1]||null,baseline=before||snapshots[0]||null;","const latest=snapshots[snapshots.length-1]||null,baseline=snapshots.length>=2?snapshots[0]:null;",'same-day baseline')
old="""    const baselineText=d.delta==null?(d.latest?`Latest snapshot ${tctDateTimeStr(latestTs)} TCT`:`No stored net-worth snapshot for ${tctDateStr(d.from)}`):`Compared with ${baselineTs<d.from?'the latest pre-day snapshot':'the first snapshot that day'} \\u00B7 ${tctDateTimeStr(baselineTs)} TCT`;"""
new="""    const baselineText=!d.latest?`No stored net-worth snapshot for ${tctDateStr(d.from)}`:d.delta==null?`Only one Torn snapshot this day \\u00B7 ${tctDateTimeStr(latestTs)} TCT \\u00B7 sync again later for a within-day snapshot movement`:`From first snapshot ${tctDateTimeStr(baselineTs)} to latest ${tctDateTimeStr(latestTs)} TCT`;"""
rep(old,new,'snapshot baseline text')
rep('<small>Torn-reported net-worth movement</small>','<small>Torn snapshot movement within selected day</small>','snapshot movement label')
old_disc="""Analyzer-detected movement is the signed sum of valued events shown for this TCT day. Paid item buys include cash paid minus the estimated item value gained; item sales include cash received minus the estimated item value removed. Item values use the analyzer's current Torn catalog price, so historical repricing, unrecognized assets, snapshot timing and Torn's own valuation rules can create a difference from the stored /user/networth snapshot movement. Company P/L is included when recorded."""
new_disc="""Analyzer-detected movement is the signed sum of valued events shown for this TCT day. Paid item buys include cash paid minus the estimated item value gained; item sales include cash received minus the estimated item value removed. Torn snapshot movement is shown only when at least two stored /user/networth snapshots exist inside the selected TCT day, so a previous-day snapshot is never mislabeled as today's movement. Item values use the analyzer's current Torn catalog price, so repricing, unrecognized assets, snapshot timing and Torn's own valuation rules can still create a difference. Company P/L is included when recorded."""
rep(old_disc,new_disc,'snapshot disclaimer')

p.write_text(s,encoding='ascii')
