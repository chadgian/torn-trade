from pathlib import Path
import re

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='utf-8')

def once(old,new,label):
    global s
    n=s.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1 match, found {n}')
    s=s.replace(old,new,1)

def sub_once(pattern,repl,label):
    global s
    s2,n=re.subn(pattern,lambda m: repl,s,count=1,flags=re.S)
    if n!=1: raise SystemExit(f'{label}: expected 1 regex match, found {n}')
    s=s2

once('// @version      0.2.19','// @version      0.2.20','metadata version')
once("const VERSION = '0.2.19';","const VERSION = '0.2.20';",'runtime version')

sub_once(r"  function fifoAnalytics\(itemId\) \{.*?\n  \}\n\n  function acquisitionMethod", r'''  function fifoAnalytics(itemId) {
    const id=Number(itemId),idx=ensureTxIndex();
    if(perfCache.fifo.has(id))return perfCache.fifo.get(id);
    const tx=idx.byItem.get(id)||[];
    const sent=(state.playerTransfers||[]).filter(x=>x?.type==='item'&&x?.direction==='out'&&Number(x.itemId)===id&&Number(x.qty)>0).map(x=>({...x,id:`transfer:${x.id}`,side:'transfer-out',total:0,netTotal:0,source:'Player Transfer'}));
    const timeline=[...tx,...sent].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)||String(a.id).localeCompare(String(b.id)));
    const lots=[];let lotHead=0;const events=[];
    const consume=(qtyValue)=>{let remain=Math.max(0,Number(qtyValue)||0),basis=0,matched=0;while(remain>0&&lotHead<lots.length){const lot=lots[lotHead],take=Math.min(remain,lot.qty);basis+=take*lot.unit;matched+=take;remain-=take;lot.qty-=take;if(lot.qty<=1e-9)lotHead++;}return {basis,matched,remain};};
    for(const t of timeline){
      if(t.side==='buy'){
        if(t.qty>0&&t.total>=0)lots.push({qty:t.qty,unit:t.qty?t.total/t.qty:0});
        events.push({...t,realizedProfit:0,matchedQty:0,unmatchedQty:0});
      }else if(t.side==='transfer-out'){
        const c=consume(t.qty);events.push({...t,costBasis:c.basis,realizedProfit:0,matchedQty:c.matched,unmatchedQty:c.remain,transferredQty:c.matched});
      }else if(t.side==='sell'){
        const c=consume(t.qty),net=t.netTotal??t.total,matchedRevenue=t.qty>0?net*(c.matched/t.qty):0;
        events.push({...t,costBasis:c.basis,realizedProfit:matchedRevenue-c.basis,matchedQty:c.matched,unmatchedQty:c.remain});
      }
    }
    let remainingQty=0,remainingCost=0;for(let i=lotHead;i<lots.length;i++){remainingQty+=lots[i].qty;remainingCost+=lots[i].qty*lots[i].unit;}
    const result={events,remainingQty,remainingCost};perfCache.fifo.set(id,result);return result;
  }

  function acquisitionMethod''', 'fifo transfer disposal')

sub_once(r"  function acquisitionLedgerRows\(\) \{.*?\n  \}\n\n  function ledgerRowsForItem", r'''  function acquisitionLedgerRows() {
    const idx=ensureTxIndex();
    if(perfCache.ledgerTxRef===idx.txRef)return perfCache.ledgerRows;
    const ledger=[],ledgerByItem=new Map();
    const itemIds=new Set(idx.itemIds);for(const t of state.playerTransfers||[])if(t?.type==='item'&&t?.direction==='out'&&Number(t.itemId)>0)itemIds.add(Number(t.itemId));
    for(const itemId of itemIds){
      const tx=idx.byItem.get(itemId)||[],sent=(state.playerTransfers||[]).filter(x=>x?.type==='item'&&x?.direction==='out'&&Number(x.itemId)===Number(itemId)&&Number(x.qty)>0).map(x=>({...x,id:`transfer:${x.id}`,side:'transfer-out',source:'Player Transfer'}));
      const timeline=[...tx,...sent].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)||String(a.id).localeCompare(String(b.id))),lots=[];let lotHead=0;
      for(const t of timeline){
        const q=Math.max(0,Number(t?.qty)||0);if(!(q>0))continue;
        if(t.side==='buy'){
          const cost=Math.max(0,Number(t.total)||0),item=catalogItem(itemId);
          const row={id:String(t.id),acquiredAt:Number(t.timestamp)||0,itemId:Number(itemId),itemName:item.name,itemType:item.type||'Item',qty:q,method:acquisitionMethod(t),source:String(t.source||''),title:String(t.title||''),free:!!t.free,costTotal:cost,unitCost:q?cost/q:0,soldQty:0,transferredQty:0,soldProceeds:0,realizedCost:0,realizedProfit:0,unsoldQty:q,status:'unsold',saleCount:0,firstSoldAt:0,lastSoldAt:0,lastTransferredAt:0,saleSources:[],_saleSources:new Set()};
          ledger.push(row);if(!ledgerByItem.has(Number(itemId)))ledgerByItem.set(Number(itemId),[]);ledgerByItem.get(Number(itemId)).push(row);lots.push({remaining:q,unit:row.unitCost,row});
        }else if(t.side==='sell'||t.side==='transfer-out'){
          let remain=q;const isSale=t.side==='sell',net=isSale?Math.max(0,Number(t.netTotal??t.total)||0):0,saleUnit=isSale&&q?net/q:0;
          while(remain>1e-9&&lotHead<lots.length){const lot=lots[lotHead],take=Math.min(remain,lot.remaining);if(!(take>0)){lotHead++;continue;}const row=lot.row,at=Number(t.timestamp)||0;
            if(isSale){row.soldQty+=take;row.soldProceeds+=take*saleUnit;row.realizedCost+=take*lot.unit;row.realizedProfit=row.soldProceeds-row.realizedCost;row.saleCount++;if(!row.firstSoldAt||at<row.firstSoldAt)row.firstSoldAt=at;if(at>row.lastSoldAt)row.lastSoldAt=at;if(t.source)row._saleSources.add(String(t.source));}
            else{row.transferredQty+=take;if(at>row.lastTransferredAt)row.lastTransferredAt=at;}
            remain-=take;lot.remaining-=take;if(lot.remaining<=1e-9)lotHead++;
          }
        }
      }
    }
    for(const row of ledger){row.unsoldQty=Math.max(0,row.qty-row.soldQty-row.transferredQty);row.status=row.unsoldQty<=1e-9?(row.soldQty>1e-9?'sold':'transferred'):(row.soldQty>1e-9||row.transferredQty>1e-9?'partial':'unsold');row.saleSources=[...row._saleSources];delete row._saleSources;}
    ledger.sort((a,b)=>b.acquiredAt-a.acquiredAt||String(b.id).localeCompare(String(a.id)));perfCache.ledgerTxRef=idx.txRef;perfCache.ledgerRows=ledger;perfCache.ledgerByItem=ledgerByItem;return ledger;
  }

  function ledgerRowsForItem''', 'ledger transfer disposal')

sub_once(r"  function analyzerPortfolio\(\) \{.*?\n  \}\n  function periodChipsHtml", r'''  function analyzerPortfolio() {
    const rows=acquisitionLedgerRows();let acquiredCost=0,remainingCost=0,marketValue=0,realizedProfit=0,acquiredQty=0,remainingQty=0,transferredQty=0;const byMethod=new Map();
    for(const r of rows){const item=catalogItem(r.itemId),rem=Math.max(0,Number(r.unsoldQty)||0),mv=rem*Math.max(0,Number(item.marketPrice)||0);acquiredCost+=Number(r.costTotal)||0;remainingCost+=rem*(Number(r.unitCost)||0);marketValue+=mv;realizedProfit+=Number(r.realizedProfit)||0;acquiredQty+=Number(r.qty)||0;remainingQty+=rem;transferredQty+=Math.max(0,Number(r.transferredQty)||0);const m=byMethod.get(r.method)||{method:r.method,qty:0,cost:0,remaining:0,market:0,profit:0,transferred:0};m.qty+=Number(r.qty)||0;m.cost+=Number(r.costTotal)||0;m.remaining+=rem;m.market+=mv;m.profit+=Number(r.realizedProfit)||0;m.transferred+=Math.max(0,Number(r.transferredQty)||0);byMethod.set(r.method,m);}
    return {acquiredCost,remainingCost,marketValue,unrealized:marketValue-remainingCost,realizedProfit,acquiredQty,remainingQty,transferredQty,byMethod:[...byMethod.values()].sort((a,b)=>b.market-a.market||b.cost-a.cost)};
  }
  function periodChipsHtml''', 'portfolio use lot transfers')

once("const saleWhen=row.lastSoldAt?dateTimeStr(row.lastSoldAt):'Not sold yet',saleSources=row.saleSources.length?row.saleSources.join(' · '):'';","const saleWhen=row.lastSoldAt?dateTimeStr(row.lastSoldAt):'Not sold yet',saleSources=row.saleSources.length?row.saleSources.join(' · '):'',transferText=row.transferredQty>0?` · Sent ${qty(row.transferredQty)}${row.lastTransferredAt?` (${dateTimeStr(row.lastTransferredAt)})`:''}`:'';",'ledger transfer text')
once("${row.status==='sold'?'Sold':row.status==='partial'?'Partial':'Unsold'}</span><small>${esc(saleWhen)}${saleSources?` · ${esc(saleSources)}`:''}</small>","${row.status==='sold'?'Sold':row.status==='transferred'?'Transferred':row.status==='partial'?'Partial':'Unsold'}</span><small>${esc(saleWhen)}${saleSources?` · ${esc(saleSources)}`:''}${esc(transferText)}</small>",'ledger transferred status')
once(".tta-statuspill.unsold{background:#251a20;border-color:#5f3e49;color:#ffc1ca}",".tta-statuspill.unsold{background:#251a20;border-color:#5f3e49;color:#ffc1ca}.tta-statuspill.transferred{background:#13283a;border-color:#365a74;color:var(--tta-blue)}",'transferred CSS')
once("if(added){state.playerTransfers=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)).slice(-5000);save('playerTransfers',state.playerTransfers);}return added;","if(added){state.playerTransfers=[...map.values()].sort((a,b)=>(Number(a.timestamp)||0)-(Number(b.timestamp)||0)).slice(-5000);save('playerTransfers',state.playerTransfers);resetAnalyticsCache();}return added;",'transfer cache reset')
once("Direct items sent to other players reduce the portfolio summary without being treated as item-sale profit.","Direct items sent to other players consume the oldest available FIFO lots, reducing inventory/cost basis without creating item-sale profit.",'portfolio note fifo')
p.write_text(s,encoding='utf-8')
