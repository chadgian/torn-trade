from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

def rep(old,new,label):
    global s
    if old not in s:
        raise SystemExit(f'missing anchor: {label}')
    s=s.replace(old,new,1)

rep('// @version      0.2.41','// @version      0.2.42','version header')
rep("const VERSION = '0.2.41';","const VERSION = '0.2.42';",'version const')

old="""    for(const t of state.itemConsumptions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to)continue;const item=catalogItem(t.itemId),q=Math.max(0,Number(t.qty)||0);if(!(q>0))continue;const market=q*Math.max(0,Number(item.marketPrice)||0),evt=(fifoAnalytics(t.itemId).events||[]).find(e=>String(e.id)===`consume:${t.id}`),basis=Math.max(0,Number(evt?.costBasis)||0);rows.push({timestamp:ts,kind:'item-consumed',icon:'\\u2212',title:`Used ${qty(q)} \\u00D7 ${item.name}`,meta:`${t.title||'Item use'}${market?` \\u00B7 Est. value removed ${money(market)}`:''}${basis?` \\u00B7 FIFO cost basis removed ${money(basis)}`:''}`,value:market||basis,valueClass:'neg',prefix:'-'});}\n"""
new="""    const consumptionGroups=new Map();\n    for(const t of state.itemConsumptions||[]){const ts=Number(t?.timestamp)||0;if(ts<from||ts>to)continue;const itemId=Number(t?.itemId)||0,q=Math.max(0,Number(t?.qty)||0);if(!(itemId>0&&q>0))continue;const item=catalogItem(itemId),market=q*Math.max(0,Number(item.marketPrice)||0),evt=(fifoAnalytics(itemId).events||[]).find(e=>String(e.id)===`consume:${t.id}`),basis=Math.max(0,Number(evt?.costBasis)||0),minute=Math.floor(ts/60),useTitle=String(t?.title||'Item use'),key=`${itemId}|${useTitle}|${minute}`;let g=consumptionGroups.get(key);if(!g){g={timestamp:ts,itemId,itemName:item.name,title:useTitle,qty:0,market:0,basis:0,count:0};consumptionGroups.set(key,g);}g.timestamp=Math.min(g.timestamp,ts);g.qty+=q;g.market+=market;g.basis+=basis;g.count++;}\n    for(const g of consumptionGroups.values()){rows.push({timestamp:g.timestamp,kind:'item-consumed',icon:'\\u2212',title:`Used ${qty(g.qty)} \\u00D7 ${g.itemName}`,meta:`${g.title}${g.count>1?` \\u00B7 ${qty(g.count)} use logs combined`:''}${g.market?` \\u00B7 Est. value removed ${money(g.market)}`:''}${g.basis?` \\u00B7 FIFO cost basis removed ${money(g.basis)}`:''}`,value:g.market||g.basis,valueClass:'neg',prefix:'-'});}\n"""
rep(old,new,'group consumption rows')

p.write_text(s,encoding='ascii')
