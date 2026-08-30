from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

s=s.replace('// @version      0.2.35','// @version      0.2.36',1)
s=s.replace("const VERSION = '0.2.35';","const VERSION = '0.2.36';",1)

anchor="""  function cashFlowHtml() {
"""
insert=r'''  function cashFlowSeries() {
    const {from,to}=cashFlowDateRange(),keyFn=state.granularity==='week'?tctWeekStart:state.granularity==='month'?tctMonthStart:tctDayStart,m=new Map();
    for(const x of allCashFlows()){
      const ts=Number(x?.timestamp)||0;if(ts<from||ts>to)continue;
      if(x.direction!=='in'&&x.direction!=='out')continue;
      const k=keyFn(ts),row=m.get(k)||{t:k,moneyIn:0,moneyOut:0,net:0};
      const amount=Math.max(0,Number(x.amount)||0);if(x.direction==='in')row.moneyIn+=amount;else row.moneyOut+=amount;row.net=row.moneyIn-row.moneyOut;m.set(k,row);
    }
    if(!m.size)return[];
    let start=state.dateMode==='all'?Math.min(...m.keys()):keyFn(from),end=keyFn(to);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return[...m.values()].sort((a,b)=>a.t-b.t);
    if(state.granularity==='month'){
      for(let k=start;k<=end;k=nextTctMonthStart(k))if(!m.has(k))m.set(k,{t:k,moneyIn:0,moneyOut:0,net:0});
    }else{
      const step=state.granularity==='week'?7*86400:86400;for(let k=start;k<=end;k+=step)if(!m.has(k))m.set(k,{t:k,moneyIn:0,moneyOut:0,net:0});
    }
    return [...m.values()].sort((a,b)=>a.t-b.t);
  }
  function cashFlowBucketLabel(ts) {
    const d=new Date((Number(ts)||0)*1000);
    if(state.granularity==='month')return d.toLocaleDateString(undefined,{timeZone:'UTC',month:'long',year:'numeric'});
    if(state.granularity==='week')return `Week of ${tctDateStr(ts)}`;
    return tctDateStr(ts);
  }
  function showCashFlowTooltip(point,pinned=false) {
    const wrap=point?.closest?.('.tta-cash-chart'),tip=wrap?.querySelector('.tta-charttooltip');if(!wrap||!tip)return;
    wrap.querySelectorAll('.tta-cashpoint.active').forEach(x=>x.classList.remove('active'));point.classList.add('active');
    const incoming=Number(point.dataset.moneyIn)||0,outgoing=Number(point.dataset.moneyOut)||0,net=Number(point.dataset.net)||0,label=String(point.dataset.label||'Cash flow');
    tip.innerHTML=`<strong>${esc(label)}</strong><span class="pos">Money in: ${esc(money(incoming))}</span><span class="neg">Money out: ${esc(money(outgoing))}</span><span class="${net>=0?'pos':'neg'}">Net: ${esc(money(net))}</span>`;
    tip.classList.add('show','tta-cashtooltip');tip.dataset.pinned=pinned?'1':'0';
    const wr=wrap.getBoundingClientRect(),pr=point.getBoundingClientRect();
    requestAnimationFrame(()=>{const tw=tip.offsetWidth||170;let left=pr.left-wr.left+pr.width/2;left=Math.max(tw/2+4,Math.min(wr.width-tw/2-4,left));tip.style.left=`${left}px`;tip.style.top='4px';});
  }
  function hideCashFlowTooltip(wrap,force=false) {
    if(!wrap)return;const tip=wrap.querySelector('.tta-charttooltip');if(!tip)return;if(!force&&tip.dataset.pinned==='1')return;
    tip.classList.remove('show','tta-cashtooltip');tip.dataset.pinned='0';wrap.querySelectorAll('.tta-cashpoint.active').forEach(x=>x.classList.remove('active'));
  }
  function cashFlowChartSvg(series) {
    if(!series.length)return '<div class="tta-empty">No incoming or outgoing cash flow is recorded in this period yet.</div>';
    const h=214,padL=54,padR=10,padT=18,padB=28,gap=Math.max(24,Math.min(42,620/Math.max(1,series.length))),w=Math.max(390,Math.ceil(padL+padR+series.length*gap)),innerH=h-padT-padB;
    const peak=Math.max(1,...series.flatMap(x=>[Math.abs(Number(x.moneyIn)||0),Math.abs(Number(x.moneyOut)||0),Math.abs(Number(x.net)||0)])),max=peak*1.08,min=-max,y=v=>padT+(max-v)/(max-min)*innerH,zero=y(0);
    const x=i=>padL+gap*i+gap/2,pathFor=key=>series.map((r,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(key==='moneyOut'?-(Number(r[key])||0):(Number(r[key])||0)).toFixed(2)}`).join(' ');
    const grid=[-1,-.5,0,.5,1].map(f=>{const yy=y(max*f),v=max*f;return `<line class="tta-grid" x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}"/><text class="tta-axis" x="3" y="${yy+3}">${esc(money(v,true))}</text>`}).join('');
    const labelStride=Math.max(1,Math.ceil(series.length/10)),labels=series.map((r,i)=>{if(series.length>10&&i%labelStride!==0&&i!==series.length-1)return'';const d=new Date(r.t*1000),lab=state.granularity==='month'?d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short'}):d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'});return `<text class="tta-axis" text-anchor="middle" x="${x(i)}" y="${h-7}">${esc(lab)}</text>`}).join('');
    const hits=series.map((r,i)=>{const left=padL+gap*i,label=cashFlowBucketLabel(r.t),aria=`${label}: money in ${money(r.moneyIn)}, money out ${money(r.moneyOut)}, net ${money(r.net)}`;return `<rect class="tta-cashpoint" x="${left}" y="${padT}" width="${gap}" height="${innerH}" tabindex="0" role="button" aria-label="${esc(aria)}" data-label="${esc(label)}" data-money-in="${Number(r.moneyIn)||0}" data-money-out="${Number(r.moneyOut)||0}" data-net="${Number(r.net)||0}"></rect>`}).join('');
    return `<div class="tta-chartinteractive tta-cash-chart ${state.granularity==='day'?'day':''}"><div class="tta-charttooltip" role="status" aria-live="polite" data-pinned="0"></div><div class="tta-chartviewport"><svg class="tta-svg tta-cash-svg" viewBox="0 0 ${w} ${h}" style="min-width:${w}px" role="img" aria-label="Cash flow trend with money in above zero, money out below zero and net cash flow"><line class="tta-zero" x1="${padL}" y1="${zero}" x2="${w-padR}" y2="${zero}"/>${grid}<path class="tta-cashline in" d="${pathFor('moneyIn')}"></path><path class="tta-cashline out" d="${pathFor('moneyOut')}"></path><path class="tta-cashline net" d="${pathFor('net')}"></path>${hits}${labels}</svg></div></div>`;
  }
  function cashFlowChartHtml() {
    const series=cashFlowSeries();
    return `<div class="tta-chartcard tta-cashflow-chartcard"><div class="tta-charthead"><div><h3>Cash flow over time</h3><small>Money out is plotted below zero \u00B7 tap or hover a period for exact values</small></div><div class="tta-seg">${['day','week','month'].map(g=>`<button class="${state.granularity===g?'active':''}" data-gran="${g}">${g[0].toUpperCase()+g.slice(1)}</button>`).join('')}</div></div><div class="tta-cashlegend"><span class="in">Money in</span><span class="out">Money out</span><span class="net">Net cash flow</span></div>${cashFlowChartSvg(series)}</div>`;
  }

'''
if anchor not in s: raise SystemExit('cashFlowHtml anchor not found')
s=s.replace(anchor,insert+anchor,1)

old="""<div class=\"tta-fin-section\"><h3>Category breakdown</h3>${cashBreakdownHtml(sum,20)}</div>"""
new="""${cashFlowChartHtml()}<div class=\"tta-fin-section\"><h3>Category breakdown</h3>${cashBreakdownHtml(sum,20)}</div>"""
if old not in s: raise SystemExit('cash flow chart insertion anchor not found')
s=s.replace(old,new,1)

old_gran="""if(granEl&&root.contains(granEl)){state.granularity=granEl.dataset.gran;save('granularity',state.granularity);await withBusy('Updating chart','Grouping realized profit by the selected interval\\u2026',async()=>render());return;}"""
new_gran="""if(granEl&&root.contains(granEl)){state.granularity=granEl.dataset.gran;save('granularity',state.granularity);const detail=state.view==='cash'?'Grouping cash flow by the selected interval\\u2026':'Grouping realized profit by the selected interval\\u2026';await withBusy('Updating chart',detail,async()=>render());return;}"""
if old_gran not in s: raise SystemExit('granularity handler anchor not found')
s=s.replace(old_gran,new_gran,1)

old_events="""    root.addEventListener('pointerover',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))showChartTooltip(bar,false);});
    root.addEventListener('pointerout',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))hideChartTooltip(bar.closest('.tta-chartinteractive'));});
    root.addEventListener('focusin',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))showChartTooltip(bar,false);});
    root.addEventListener('focusout',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))hideChartTooltip(bar.closest('.tta-chartinteractive'));});
    root.addEventListener('click',e=>{
      const bar=e.target?.closest?.('.tta-profitbar');
      if(bar&&root.contains(bar)){e.stopPropagation();const wrap=bar.closest('.tta-chartinteractive'),tip=wrap?.querySelector('.tta-charttooltip'),same=bar.classList.contains('active')&&tip?.dataset.pinned==='1';if(same)hideChartTooltip(wrap,true);else showChartTooltip(bar,true);return;}
      root.querySelectorAll('.tta-chartinteractive').forEach(w=>hideChartTooltip(w,true));
    });
"""
new_events="""    root.addEventListener('pointerover',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))showChartTooltip(bar,false);const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))showCashFlowTooltip(point,false);});
    root.addEventListener('pointerout',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))hideChartTooltip(bar.closest('.tta-chartinteractive'));const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))hideCashFlowTooltip(point.closest('.tta-cash-chart'));});
    root.addEventListener('focusin',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))showChartTooltip(bar,false);const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))showCashFlowTooltip(point,false);});
    root.addEventListener('focusout',e=>{const bar=e.target?.closest?.('.tta-profitbar');if(bar&&root.contains(bar))hideChartTooltip(bar.closest('.tta-chartinteractive'));const point=e.target?.closest?.('.tta-cashpoint');if(point&&root.contains(point))hideCashFlowTooltip(point.closest('.tta-cash-chart'));});
    root.addEventListener('click',e=>{
      const bar=e.target?.closest?.('.tta-profitbar');
      if(bar&&root.contains(bar)){e.stopPropagation();const wrap=bar.closest('.tta-chartinteractive'),tip=wrap?.querySelector('.tta-charttooltip'),same=bar.classList.contains('active')&&tip?.dataset.pinned==='1';if(same)hideChartTooltip(wrap,true);else showChartTooltip(bar,true);return;}
      const point=e.target?.closest?.('.tta-cashpoint');
      if(point&&root.contains(point)){e.stopPropagation();const wrap=point.closest('.tta-cash-chart'),tip=wrap?.querySelector('.tta-charttooltip'),same=point.classList.contains('active')&&tip?.dataset.pinned==='1';if(same)hideCashFlowTooltip(wrap,true);else showCashFlowTooltip(point,true);return;}
      root.querySelectorAll('.tta-chartinteractive').forEach(w=>{hideChartTooltip(w,true);hideCashFlowTooltip(w,true);});
    });
"""
if old_events not in s: raise SystemExit('chart event binding anchor not found')
s=s.replace(old_events,new_events,1)

css_anchor="""    `;
    document.head.appendChild(s);
"""
css=r'''
      /* v0.2.36 interactive cash-flow trend */
      .tta-cashflow-chartcard{margin-top:10px}
      .tta-cashflow-chartcard .tta-charthead>div:first-child{min-width:0;display:grid;gap:3px}.tta-cashflow-chartcard .tta-charthead small{color:var(--tta-faint);font-size:8px;line-height:1.35;white-space:normal}
      .tta-cashlegend{display:flex;flex-wrap:wrap;gap:7px 12px;margin:7px 0 3px;color:var(--tta-muted);font-size:8px;font-weight:700}.tta-cashlegend span{display:inline-flex;align-items:center;gap:5px}.tta-cashlegend span:before{content:"";width:14px;height:2px;border-radius:99px;background:currentColor}.tta-cashlegend .in{color:var(--tta-green)}.tta-cashlegend .out{color:var(--tta-red)}.tta-cashlegend .net{color:var(--tta-blue)}
      .tta-cash-svg{display:block;height:214px;width:100%}.tta-cashline{fill:none;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}.tta-cashline.in{stroke:var(--tta-green)}.tta-cashline.out{stroke:var(--tta-red)}.tta-cashline.net{stroke:var(--tta-blue);stroke-width:2.5}
      .tta-cashpoint{fill:transparent;stroke:none;cursor:pointer;outline:none}.tta-cashpoint:hover,.tta-cashpoint:focus,.tta-cashpoint.active{fill:#ffffff0b}.tta-cashpoint:focus{stroke:var(--tta-blue);stroke-width:1;stroke-dasharray:3 3}
      .tta-charttooltip.tta-cashtooltip{display:grid;gap:2px;min-width:156px;text-align:left}.tta-charttooltip.tta-cashtooltip strong{margin-bottom:2px}.tta-charttooltip.tta-cashtooltip span{font-size:8px;line-height:1.35;white-space:nowrap}
      @media(max-width:520px){.tta-cashflow-chartcard .tta-charthead{align-items:flex-start;gap:8px}.tta-cashflow-chartcard .tta-charthead>div:first-child{width:100%}.tta-cashflow-chartcard .tta-seg{flex-shrink:0}.tta-cash-svg{height:205px}}
'''
if css_anchor not in s: raise SystemExit('CSS anchor not found')
s=s.replace(css_anchor,css+'\n'+css_anchor,1)

if '// @version      0.2.36' not in s or "const VERSION = '0.2.36';" not in s: raise SystemExit('version bump failed')
for required in ['function cashFlowSeries()','function cashFlowChartSvg(series)','function showCashFlowTooltip','Cash flow over time','tta-cashpoint','Money out is plotted below zero']:
    if required not in s: raise SystemExit('missing '+required)
if any(ord(ch)>=128 for ch in s): raise SystemExit('non-ASCII character introduced')
p.write_text(s,encoding='ascii')
