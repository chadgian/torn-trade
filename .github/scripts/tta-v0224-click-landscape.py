from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.23','// @version      0.2.24',1)
s=s.replace("const VERSION = '0.2.23';","const VERSION = '0.2.24';",1)

old_drag="""  function bindPortalMouseDrag(root) {
    let drag=null;
    root.addEventListener('pointerdown',e=>{
      const portal=e.target?.closest?.('.tta-fin-nav.portal');
      if(!portal||!root.contains(portal)||e.pointerType!=='mouse'||e.button!==0)return;
      portal.dataset.suppressClick='0';
      drag={portal,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,startScrollLeft:portal.scrollLeft,moved:false};
      try{portal.setPointerCapture(e.pointerId);}catch(_){ }
    });
    root.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
      if(!drag.moved){
        if(Math.hypot(dx,dy)<5)return;
        if(Math.abs(dx)<=Math.abs(dy)){try{drag.portal.releasePointerCapture(e.pointerId);}catch(_){ }drag=null;return;}
        drag.moved=true;drag.portal.classList.add('dragging');
      }
      e.preventDefault();
      drag.portal.scrollLeft=drag.startScrollLeft-dx;
    });
    const finish=e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const portal=drag.portal,moved=drag.moved;
      try{portal.releasePointerCapture(e.pointerId);}catch(_){ }
      portal.classList.remove('dragging');
      if(moved){portal.dataset.suppressClick='1';setTimeout(()=>{if(portal?.isConnected)portal.dataset.suppressClick='0';},180);}
      drag=null;
    };
    root.addEventListener('pointerup',finish);
    root.addEventListener('pointercancel',finish);
  }
"""
new_drag="""  function bindPortalMouseDrag(root) {
    let drag=null;
    root.addEventListener('pointerdown',e=>{
      const portal=e.target?.closest?.('.tta-fin-nav.portal');
      if(!portal||!root.contains(portal)||e.pointerType!=='mouse'||e.button!==0)return;
      portal.dataset.suppressClick='0';
      drag={portal,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,startScrollLeft:portal.scrollLeft,moved:false,captured:false};
    });
    root.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
      if(!drag.moved){
        if(Math.hypot(dx,dy)<7)return;
        if(Math.abs(dx)<=Math.abs(dy)){drag=null;return;}
        drag.moved=true;
        drag.portal.classList.add('dragging');
        try{drag.portal.setPointerCapture(e.pointerId);drag.captured=true;}catch(_){ }
      }
      e.preventDefault();
      drag.portal.scrollLeft=drag.startScrollLeft-dx;
    });
    const finish=e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      const portal=drag.portal,moved=drag.moved,captured=drag.captured;
      if(captured){try{portal.releasePointerCapture(e.pointerId);}catch(_){ }}
      portal.classList.remove('dragging');
      if(moved){portal.dataset.suppressClick='1';requestAnimationFrame(()=>setTimeout(()=>{if(portal?.isConnected)portal.dataset.suppressClick='0';},80));}
      drag=null;
    };
    root.addEventListener('pointerup',finish);
    root.addEventListener('pointercancel',finish);
    root.addEventListener('pointerleave',e=>{if(drag&&!drag.moved&&e.pointerId===drag.pointerId)drag=null;});
  }
"""
if old_drag not in s: raise SystemExit('drag function anchor missing')
s=s.replace(old_drag,new_drag,1)

css_anchor="""      @media (hover:hover) and (pointer:fine){.tta-fin-nav.portal{cursor:grab}.tta-fin-nav.portal.dragging{cursor:grabbing;scroll-snap-type:none!important;user-select:none;-webkit-user-select:none}.tta-fin-nav.portal.dragging .tta-toolcard{cursor:grabbing}}
      #tta-fab.snapping{transition:left .2s cubic-bezier(.22,.8,.32,1),transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease}"""
css_new="""      @media (hover:hover) and (pointer:fine){.tta-fin-nav.portal{cursor:grab}.tta-fin-nav.portal.dragging{cursor:grabbing;scroll-snap-type:none!important;user-select:none;-webkit-user-select:none}.tta-fin-nav.portal.dragging .tta-toolcard{cursor:grabbing}}
      @media (min-width:700px) and (orientation:landscape){
        .tta-content{width:min(calc(100% - 28px),960px)!important;max-width:960px!important;padding:14px 16px 34px!important}
        .tta-feature-portal .tta-fin-nav{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;overflow:visible!important;scroll-snap-type:none!important;gap:9px!important}
        .tta-feature-portal .tta-toolcard{flex:none!important;width:100%!important;min-width:0!important;max-width:none!important;min-height:96px}
        .tta-help-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      }
      @media (min-width:900px) and (orientation:landscape){
        .tta-content{width:min(calc(100% - 40px),1180px)!important;max-width:1180px!important;padding:16px 20px 38px!important}
        .tta-dashboard .tta-bento-grid{grid-template-columns:minmax(0,1.65fr) repeat(2,minmax(0,1fr));align-items:stretch}
        .tta-dashboard .tta-bento-hero{grid-column:auto;display:flex;flex-direction:column;justify-content:center}
        .tta-feature-portal{padding:13px 14px}
        .tta-feature-portal .tta-fin-nav{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        .tta-feature-portal .tta-toolcard{min-height:112px;padding:12px 13px;grid-template-columns:40px minmax(0,1fr)}
        .tta-feature-portal .tta-toolcopy small{padding-right:5px}
        .tta-position-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
        .tta-cashhero{grid-template-columns:repeat(3,minmax(0,1fr))}
        .tta-help-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
        .tta-help-card.wide{grid-column:span 3}
        .tta-ledgertable{min-width:100%}
      }
      @media (min-width:1200px) and (orientation:landscape){
        .tta-content{max-width:1280px!important}
        .tta-feature-portal .tta-toolcard{min-height:118px}
        .tta-flowtable{min-width:100%}
      }
      #tta-fab.snapping{transition:left .2s cubic-bezier(.22,.8,.32,1),transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease}"""
if css_anchor not in s: raise SystemExit('css anchor missing')
s=s.replace(css_anchor,css_new,1)

p.write_text(s)
