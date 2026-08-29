from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text()

s=s.replace('// @version      0.2.20','// @version      0.2.21',1)
s=s.replace("const VERSION = '0.2.20';","const VERSION = '0.2.21';",1)

css_old="""      /* v0.2.18 finance suite */"""
css_new="""      #tta-fab.snapping{transition:left .2s cubic-bezier(.22,.8,.32,1),transform .14s ease,border-color .14s ease,box-shadow .14s ease,background .14s ease}\n      /* v0.2.18 finance suite */"""
if css_old not in s: raise SystemExit('CSS anchor missing')
s=s.replace(css_old,css_new,1)

old="""  function applyFabPosition(fab) {
    if(!fab)return;
    if(state.fabPosition && Number.isFinite(state.fabPosition.left) && Number.isFinite(state.fabPosition.top)){
      const p=clampFabPosition(state.fabPosition.left,state.fabPosition.top,fab);
      fab.style.left=`${p.left}px`;fab.style.top=`${p.top}px`;fab.style.right='auto';fab.style.bottom='auto';
      state.fabPosition=p;save('fabPosition',p);
    }
  }
"""
new="""  function snapFabPosition(left,top,fab) {
    const p=clampFabPosition(left,top,fab),pad=8,w=fab.offsetWidth||42;
    const center=p.left+w/2,sideLeft=center<=window.innerWidth/2;
    return {left:sideLeft?pad:Math.max(pad,window.innerWidth-w-pad),top:p.top,side:sideLeft?'left':'right'};
  }
  function applyFabPosition(fab) {
    if(!fab)return;
    if(state.fabPosition && Number.isFinite(state.fabPosition.left) && Number.isFinite(state.fabPosition.top)){
      const p=snapFabPosition(state.fabPosition.left,state.fabPosition.top,fab);
      fab.style.left=`${p.left}px`;fab.style.top=`${p.top}px`;fab.style.right='auto';fab.style.bottom='auto';
      state.fabPosition=p;save('fabPosition',p);
    }
  }
"""
if old not in s: raise SystemExit('applyFabPosition block missing')
s=s.replace(old,new,1)

old_finish="""      if(moved){const r=fab.getBoundingClientRect();state.fabPosition=clampFabPosition(r.left,r.top,fab);save('fabPosition',state.fabPosition);fab.dataset.suppressClick='1';setTimeout(()=>fab.dataset.suppressClick='0',250);}
"""
new_finish="""      if(moved){
        const r=fab.getBoundingClientRect(),p=snapFabPosition(r.left,r.top,fab);
        fab.classList.add('snapping');fab.style.left=`${p.left}px`;fab.style.top=`${p.top}px`;fab.style.right='auto';fab.style.bottom='auto';
        state.fabPosition=p;save('fabPosition',p);fab.dataset.suppressClick='1';
        setTimeout(()=>{fab.classList.remove('snapping');fab.dataset.suppressClick='0';},250);
      }
"""
if old_finish not in s: raise SystemExit('drag finish anchor missing')
s=s.replace(old_finish,new_finish,1)

p.write_text(s)
