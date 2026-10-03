  function compareTransactions(a,b) {
    const delta=Number(a.timestamp)-Number(b.timestamp);if(delta)return delta;
    // A trade disposes of owned stock before receiving replacement stock.
    if(a.tradeId&&a.tradeId===b.tradeId&&a.side!==b.side)return a.side==='sell'?-1:1;
    if(/^\d+$/.test(a.nanostamp)&&/^\d+$/.test(b.nanostamp)){const x=BigInt(a.nanostamp),y=BigInt(b.nanostamp);if(x!==y)return x<y?-1:1;}
    return String(a.id).localeCompare(String(b.id));
  }
  function computeFifo(timeline,item) {
    const ledger=[],events=[],lots=[];let head=0;
    const ordered=timeline.slice().sort(compareTransactions);
    const orderingInferred=ordered.some((row,i)=>i>0&&Number(row.timestamp)===Number(ordered[i-1].timestamp)&&!(row.tradeId&&row.tradeId===ordered[i-1].tradeId)&&!( /^\d+$/.test(row.nanostamp)&&/^\d+$/.test(ordered[i-1].nanostamp)));
    for(const t of ordered) {
      const quantity=Number(t.qty);if(!(quantity>0)||!Number.isFinite(quantity))continue;
      if(t.side==='buy') {
        const cost=Number(t.total),known=t.costKnown!==false&&Number.isFinite(cost)&&cost>=0;
        const row={id:String(t.id),acquiredAt:Number(t.timestamp),itemId:Number(item.id),itemName:item.name,itemType:item.type||'Item',qty:quantity,method:acquisitionMethod(t),source:String(t.source||''),title:String(t.title||''),free:!!t.free,costKnown:known,estimated:!!t.estimated,costTotal:known?cost:0,unitCost:known?cost/quantity:0,soldQty:0,transferredQty:0,consumedQty:0,soldProceeds:0,realizedCost:0,realizedProfit:0,unknownCostQty:0,unsoldQty:quantity,status:'unsold',saleCount:0,firstSoldAt:0,lastSoldAt:0,lastSaleSource:'',lastTransferredAt:0,lastConsumedAt:0,saleSources:[]};
        lots.push({remaining:quantity,row});ledger.push(row);
        events.push({...t,realizedProfit:0,matchedQty:0,unmatchedQty:0,unknownCostQty:0});continue;
      }
      if(!['sell','transfer-out','consume-out'].includes(t.side))continue;
      const sale=t.side==='sell',net=Number(t.netTotal??t.total),proceedsKnown=t.proceedsKnown!==false&&Number.isFinite(net)&&net>=0;
      let remaining=quantity,basis=0,matched=0,profit=0,unknown=0;
      while(remaining>1e-9&&head<lots.length) {
        const lot=lots[head],take=Math.min(remaining,lot.remaining),row=lot.row,at=Number(t.timestamp);
        basis+=take*row.unitCost;matched+=take;
        if(sale) {
          const revenue=proceedsKnown?take*net/quantity:0;
          row.soldQty+=take;row.soldProceeds+=revenue;row.saleCount++;
          if(row.costKnown&&proceedsKnown){const cost=take*row.unitCost;row.realizedCost+=cost;row.realizedProfit+=revenue-cost;profit+=revenue-cost;}
          else{row.unknownCostQty+=take;unknown+=take;}
          if(!row.firstSoldAt||at<row.firstSoldAt)row.firstSoldAt=at;
          if(at>=row.lastSoldAt){row.lastSoldAt=at;row.lastSaleSource=String(t.source||'');}
          if(t.source&&!row.saleSources.includes(t.source))row.saleSources.push(t.source);
        } else if(t.side==='consume-out'){row.consumedQty+=take;row.lastConsumedAt=Math.max(row.lastConsumedAt,at);}
        else{row.transferredQty+=take;row.lastTransferredAt=Math.max(row.lastTransferredAt,at);}
        remaining-=take;lot.remaining-=take;if(lot.remaining<=1e-9)head++;
      }
      events.push({...t,costBasis:basis,realizedProfit:profit,matchedQty:matched,unmatchedQty:remaining,unknownCostQty:unknown,transferredQty:t.side==='transfer-out'?matched:0,consumedQty:t.side==='consume-out'?matched:0});
    }
    let remainingQty=0,remainingCost=0;
    for(const lot of lots){const row=lot.row;row.unsoldQty=Math.max(0,lot.remaining);remainingQty+=row.unsoldQty;remainingCost+=row.unsoldQty*row.unitCost;
      row.status=row.unsoldQty<=1e-9?(row.soldQty>=row.qty-1e-9?'sold':row.consumedQty>=row.qty-1e-9?'consumed':row.transferredQty>=row.qty-1e-9?'transferred':'depleted'):(row.soldQty+row.consumedQty+row.transferredQty>0?'partial':'unsold');
    }
    return {ledger,events,remainingQty,remainingCost,orderingInferred};
  }
