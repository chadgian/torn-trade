from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.22','// @version      0.2.23',1)
s=s.replace("const VERSION = '0.2.22';","const VERSION = '0.2.23';",1)

css_anchor="""      #tta-fab.snapping{transition:left .2s cubic-bezier(.22,.8,.32,1),transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease}"""
css_new="""      @media (hover:hover) and (pointer:fine){.tta-fin-nav.portal{cursor:grab}.tta-fin-nav.portal.dragging{cursor:grabbing;scroll-snap-type:none!important;user-select:none;-webkit-user-select:none}.tta-fin-nav.portal.dragging .tta-toolcard{cursor:grabbing}}
      #tta-fab.snapping{transition:left .2s cubic-bezier(.22,.8,.32,1),transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease}"""
if css_anchor not in s: raise SystemExit('CSS anchor missing')
s=s.replace(css_anchor,css_new,1)

bind_anchor="""  function bind() {
    const root=document.getElementById('tta-root');if(!root||root.dataset.delegated==='1')return;root.dataset.delegated='1';
    root.addEventListener('click',async e=>{
      const dateEl=e.target.closest('[data-date]');
"""
bind_new="""  function bindPortalMouseDrag(root) {
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

  function bind() {
    const root=document.getElementById('tta-root');if(!root||root.dataset.delegated==='1')return;root.dataset.delegated='1';
    bindPortalMouseDrag(root);
    root.addEventListener('click',async e=>{
      const portal=e.target?.closest?.('.tta-fin-nav.portal');
      if(portal?.dataset.suppressClick==='1'){e.preventDefault();e.stopPropagation();return;}
      const dateEl=e.target.closest('[data-date]');
"""
if bind_anchor not in s: raise SystemExit('bind anchor missing')
s=s.replace(bind_anchor,bind_new,1)

p.write_text(s)
