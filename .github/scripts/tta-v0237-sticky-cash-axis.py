from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

s=s.replace('// @version      0.2.36','// @version      0.2.37',1)
s=s.replace("const VERSION = '0.2.36';","const VERSION = '0.2.37';",1)

old=r'''  function cashFlowChartSvg(series) {
    if(!series.length)return '<div class="tta-empty">No incoming or outgoing cash flow is recorded in this period yet.</div>';
    const h=214,padL=54,padR=10,padT=18,padB=28,gap=Math.max(24,Math.min(42,620/Math.max(1,series.length))),w=Math.max(390,Math.ceil(padL+padR+series.length*gap)),innerH=h-padT-padB;
    const peak=Math.max(1,...series.flatMap(x=>[Math.abs(Number(x.moneyIn)||0),Math.abs(Number(x.moneyOut)||0),Math.abs(Number(x.net)||0)])),max=peak*1.08,min=-max,y=v=>padT+(max-v)/(max-min)*innerH,zero=y(0);
    const x=i=>padL+gap*i+gap/2,pathFor=key=>series.map((r,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(key==='moneyOut'?-(Number(r[key])||0):(Number(r[key])||0)).toFixed(2)}`).join(' ');
    const grid=[-1,-.5,0,.5,1].map(f=>{const yy=y(max*f),v=max*f;return `<line class="tta-grid" x1="${padL}" y1="${yy}" x2="${w-padR}" y2="${yy}"/><text class="tta-axis" x="3" y="${yy+3}">${esc(money(v,true))}</text>`}).join('');
    const labelStride=Math.max(1,Math.ceil(series.length/10)),labels=series.map((r,i)=>{if(series.length>10&&i%labelStride!==0&&i!==series.length-1)return'';const d=new Date(r.t*1000),lab=state.granularity==='month'?d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short'}):d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'});return `<text class="tta-axis" text-anchor="middle" x="${x(i)}" y="${h-7}">${esc(lab)}</text>`}).join('');
    const hits=series.map((r,i)=>{const left=padL+gap*i,label=cashFlowBucketLabel(r.t),aria=`${label}: money in ${money(r.moneyIn)}, money out ${money(r.moneyOut)}, net ${money(r.net)}`;return `<rect class="tta-cashpoint" x="${left}" y="${padT}" width="${gap}" height="${innerH}" tabindex="0" role="button" aria-label="${esc(aria)}" data-label="${esc(label)}" data-money-in="${Number(r.moneyIn)||0}" data-money-out="${Number(r.moneyOut)||0}" data-net="${Number(r.net)||0}"></rect>`}).join('');
    return `<div class="tta-chartinteractive tta-cash-chart ${state.granularity==='day'?'day':''}"><div class="tta-charttooltip" role="status" aria-live="polite" data-pinned="0"></div><div class="tta-chartviewport"><svg class="tta-svg tta-cash-svg" viewBox="0 0 ${w} ${h}" style="min-width:${w}px" role="img" aria-label="Cash flow trend with money in above zero, money out below zero and net cash flow"><line class="tta-zero" x1="${padL}" y1="${zero}" x2="${w-padR}" y2="${zero}"/>${grid}<path class="tta-cashline in" d="${pathFor('moneyIn')}"></path><path class="tta-cashline out" d="${pathFor('moneyOut')}"></path><path class="tta-cashline net" d="${pathFor('net')}"></path>${hits}${labels}</svg></div></div>`;
  }
'''
new=r'''  function cashFlowChartSvg(series) {
    if(!series.length)return '<div class="tta-empty">No incoming or outgoing cash flow is recorded in this period yet.</div>';
    const h=214,axisW=56,padL=8,padR=10,padT=18,padB=28,gap=Math.max(24,Math.min(42,620/Math.max(1,series.length))),w=Math.max(334,Math.ceil(padL+padR+series.length*gap)),innerH=h-padT-padB;
    const peak=Math.max(1,...series.flatMap(x=>[Math.abs(Number(x.moneyIn)||0),Math.abs(Number(x.moneyOut)||0),Math.abs(Number(x.net)||0)])),max=peak*1.08,min=-max,y=v=>padT+(max-v)/(max-min)*innerH,zero=y(0);
    const x=i=>padL+gap*i+gap/2,pathFor=key=>series.map((r,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(key==='moneyOut'?-(Number(r[key])||0):(Number(r[key])||0)).toFixed(2)}`).join(' ');
    const ticks=[-1,-.5,0,.5,1];
    const grid=ticks.map(f=>{const yy=y(max*f);return `<line class="tta-grid" x1="0" y1="${yy}" x2="${w-padR}" y2="${yy}"/>`}).join('');
    const axis=ticks.map(f=>{const yy=y(max*f),v=max*f;return `<g><line class="tta-axis-tick" x1="${axisW-6}" y1="${yy}" x2="${axisW}" y2="${yy}"/><text class="tta-axis tta-cash-axis-label" text-anchor="end" x="${axisW-9}" y="${yy+3}">${esc(money(v,true))}</text></g>`}).join('');
    const labelStride=Math.max(1,Math.ceil(series.length/10)),labels=series.map((r,i)=>{if(series.length>10&&i%labelStride!==0&&i!==series.length-1)return'';const d=new Date(r.t*1000),lab=state.granularity==='month'?d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short'}):d.toLocaleDateString(undefined,{timeZone:'UTC',month:'short',day:'numeric'});return `<text class="tta-axis" text-anchor="middle" x="${x(i)}" y="${h-7}">${esc(lab)}</text>`}).join('');
    const hits=series.map((r,i)=>{const left=padL+gap*i,label=cashFlowBucketLabel(r.t),aria=`${label}: money in ${money(r.moneyIn)}, money out ${money(r.moneyOut)}, net ${money(r.net)}`;return `<rect class="tta-cashpoint" x="${left}" y="${padT}" width="${gap}" height="${innerH}" tabindex="0" role="button" aria-label="${esc(aria)}" data-label="${esc(label)}" data-money-in="${Number(r.moneyIn)||0}" data-money-out="${Number(r.moneyOut)||0}" data-net="${Number(r.net)||0}"></rect>`}).join('');
    return `<div class="tta-chartinteractive tta-cash-chart ${state.granularity==='day'?'day':''}"><div class="tta-charttooltip" role="status" aria-live="polite" data-pinned="0"></div><div class="tta-cash-chartframe"><div class="tta-cash-axis-wrap" aria-hidden="true"><svg class="tta-cash-axis-svg" viewBox="0 0 ${axisW} ${h}" preserveAspectRatio="none">${axis}</svg></div><div class="tta-chartviewport"><svg class="tta-svg tta-cash-svg" viewBox="0 0 ${w} ${h}" style="min-width:${w}px" role="img" aria-label="Cash flow trend with a fixed money scale, money in above zero, money out below zero and net cash flow"><line class="tta-zero" x1="0" y1="${zero}" x2="${w-padR}" y2="${zero}"/>${grid}<path class="tta-cashline in" d="${pathFor('moneyIn')}"></path><path class="tta-cashline out" d="${pathFor('moneyOut')}"></path><path class="tta-cashline net" d="${pathFor('net')}"></path>${hits}${labels}</svg></div></div></div>`;
  }
'''
if old not in s:
    raise SystemExit('cashFlowChartSvg anchor not found')
s=s.replace(old,new,1)

css_anchor=r'''      .tta-cash-svg{display:block;height:214px;width:100%}.tta-cashline{fill:none;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}.tta-cashline.in{stroke:var(--tta-green)}.tta-cashline.out{stroke:var(--tta-red)}.tta-cashline.net{stroke:var(--tta-blue);stroke-width:2.5}
'''
css_new=r'''      .tta-cash-chartframe{display:flex;align-items:stretch;min-width:0;width:100%;overflow:hidden}.tta-cash-axis-wrap{position:relative;z-index:4;flex:0 0 56px;width:56px;height:214px;background:linear-gradient(90deg,var(--tta-card) 0%,var(--tta-card) 88%,#151e28e8 100%);border-right:1px solid #34475a88;box-shadow:8px 0 14px #06090d24}.tta-cash-axis-svg{display:block;width:56px;height:214px;overflow:visible}.tta-cash-axis-label{font-weight:700;fill:var(--tta-muted)}.tta-axis-tick{stroke:var(--tta-line);stroke-width:1}.tta-cash-chartframe>.tta-chartviewport{flex:1 1 auto;min-width:0;margin:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
      .tta-cash-svg{display:block;height:214px;width:100%}.tta-cashline{fill:none;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}.tta-cashline.in{stroke:var(--tta-green)}.tta-cashline.out{stroke:var(--tta-red)}.tta-cashline.net{stroke:var(--tta-blue);stroke-width:2.5}
'''
if css_anchor not in s:
    raise SystemExit('cash chart CSS anchor not found')
s=s.replace(css_anchor,css_new,1)

mobile=r'''      @media(max-width:520px){.tta-cashflow-chartcard .tta-charthead{align-items:flex-start;gap:8px}.tta-cashflow-chartcard .tta-charthead>div:first-child{width:100%}.tta-cashflow-chartcard .tta-seg{flex-shrink:0}.tta-cash-svg{height:205px}}
'''
mobile_new=r'''      @media(max-width:520px){.tta-cashflow-chartcard .tta-charthead{align-items:flex-start;gap:8px}.tta-cashflow-chartcard .tta-charthead>div:first-child{width:100%}.tta-cashflow-chartcard .tta-seg{flex-shrink:0}.tta-cash-svg,.tta-cash-axis-wrap,.tta-cash-axis-svg{height:205px}.tta-cash-axis-wrap{flex-basis:52px;width:52px}.tta-cash-axis-svg{width:52px}}
'''
if mobile not in s:
    raise SystemExit('mobile cash chart CSS anchor not found')
s=s.replace(mobile,mobile_new,1)

if '// @version      0.2.37' not in s or "const VERSION = '0.2.37';" not in s:
    raise SystemExit('version bump failed')
for needle in ['tta-cash-chartframe','tta-cash-axis-wrap','tta-cash-axis-svg','fixed money scale']:
    if needle not in s: raise SystemExit(f'missing {needle}')
if any(ord(ch)>=128 for ch in s):
    raise SystemExit('non-ASCII character introduced')

p.write_text(s,encoding='ascii')
