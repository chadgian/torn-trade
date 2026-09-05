from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

def rep(old,new,count=1):
    global s
    n=s.count(old)
    if n < count:
        raise SystemExit(f'anchor not found enough times: {old[:120]!r} count={n}')
    s=s.replace(old,new,count)

rep('// @version      0.2.47','// @version      0.2.48')
rep("const VERSION = '0.2.47';","const VERSION = '0.2.48';")

old="""  function parseCashFlowEntry(entry,parsedItemRows=[]) {
    const entryTitle=String(entry?.details?.title||'');
    const crimeContext=/crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime/i.test(entryTitle);
    if(parsedItemRows?.length&&!crimeContext)return[];
    const logTypeId=Number(entry?.details?.id)||0,title=entryTitle;
"""
new="""  function parseCashFlowEntry(entry,parsedItemRows=[]) {
    const entryTitle=String(entry?.details?.title||'');
    const crimeContext=/crime|burglary|shoplift|theft|robbery|pickpocket|fraud|hustl|bootleg|disposal|cybercrime/i.test(entryTitle);
    // A raw Torn event may legitimately project into several analyzer workspaces at once.
    // Only suppress generic cash extraction when a normalized paid item buy/sell already
    // owns that same cash movement; free/reward item rows must not hide separate money.
    const itemRowsOwnCashMovement=(parsedItemRows||[]).some(t=>{
      const side=String(t?.side||''),total=Math.max(0,Number(t?.total)||0);
      return (side==='buy'||side==='sell')&&total>0&&!t?.free;
    });
    if(itemRowsOwnCashMovement&&!crimeContext)return[];
    const logTypeId=Number(entry?.details?.id)||0,title=entryTitle;
"""
rep(old,new)

# Add an architectural note beside the active multi-projection sync path.
old2="""        const parsed=parseLogEntry(r);job.diagnostics.parsedRows+=parsed.length;job.diagnostics.matchedRows+=parsed.length;for(const t of parsed){if(t.side==='buy'){job.diagnostics.latestParsedAcquisitionTimestamp=Math.max(Number(job.diagnostics.latestParsedAcquisitionTimestamp)||0,Number(t.timestamp)||0);}if(t.side==='buy'&&t.source==='Foreign Market'){job.diagnostics.foreignBuyRows=(Number(job.diagnostics.foreignBuyRows)||0)+1;job.diagnostics.foreignBuyQty=(Number(job.diagnostics.foreignBuyQty)||0)+(Number(t.qty)||0);}}parsedRows.push(...parsed);
        const transferRows=parsePlayerTransferEntry(r);job.diagnostics.playerTransferRows=(Number(job.diagnostics.playerTransferRows)||0)+transferRows.length;checkpointPlayerTransferRows(transferRows);
"""
new2="""        // Multi-workspace projection: do not consume a raw event after the first match.
        // Item transactions, cash flow, transfers and consumption are independent views.
        const parsed=parseLogEntry(r);job.diagnostics.parsedRows+=parsed.length;job.diagnostics.matchedRows+=parsed.length;for(const t of parsed){if(t.side==='buy'){job.diagnostics.latestParsedAcquisitionTimestamp=Math.max(Number(job.diagnostics.latestParsedAcquisitionTimestamp)||0,Number(t.timestamp)||0);}if(t.side==='buy'&&t.source==='Foreign Market'){job.diagnostics.foreignBuyRows=(Number(job.diagnostics.foreignBuyRows)||0)+1;job.diagnostics.foreignBuyQty=(Number(job.diagnostics.foreignBuyQty)||0)+(Number(t.qty)||0);}}parsedRows.push(...parsed);
        const transferRows=parsePlayerTransferEntry(r);job.diagnostics.playerTransferRows=(Number(job.diagnostics.playerTransferRows)||0)+transferRows.length;checkpointPlayerTransferRows(transferRows);
"""
rep(old2,new2)

p.write_text(s,encoding='ascii')
print('patched v0.2.48')
