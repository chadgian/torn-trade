  function clampFabPosition(left,top,fab) {
    const pad=8,w=fab.offsetWidth||132,h=fab.offsetHeight||42;
    return {left:Math.max(pad,Math.min(left,window.innerWidth-w-pad)),top:Math.max(pad,Math.min(top,window.innerHeight-h-pad))};
  }
  function snapFabPosition(left,top,fab) {
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
  function bindFabDrag(fab) {
    if(!fab || fab.dataset.dragBound==='1')return;
    fab.dataset.dragBound='1';
    let startX=0,startY=0,startLeft=0,startTop=0,moved=false,pointerId=null;
    fab.addEventListener('pointerdown',e=>{
      if(e.button!=null && e.button!==0)return;
      pointerId=e.pointerId;moved=false;startX=e.clientX;startY=e.clientY;
      const r=fab.getBoundingClientRect();startLeft=r.left;startTop=r.top;
      try{fab.setPointerCapture(pointerId);}catch(_){ }
    });
    fab.addEventListener('pointermove',e=>{
      if(pointerId==null||e.pointerId!==pointerId)return;
      const dx=e.clientX-startX,dy=e.clientY-startY;if(!moved&&Math.hypot(dx,dy)<5)return;
      moved=true;fab.classList.add('dragging');e.preventDefault();
      const p=clampFabPosition(startLeft+dx,startTop+dy,fab);
      fab.style.left=`${p.left}px`;fab.style.top=`${p.top}px`;fab.style.right='auto';fab.style.bottom='auto';
    });
    const finish=e=>{
      if(pointerId==null||e.pointerId!==pointerId)return;
      try{fab.releasePointerCapture(pointerId);}catch(_){ }
      pointerId=null;fab.classList.remove('dragging');
      if(moved){
        const r=fab.getBoundingClientRect(),p=snapFabPosition(r.left,r.top,fab);
        fab.classList.add('snapping');fab.style.left=`${p.left}px`;fab.style.top=`${p.top}px`;fab.style.right='auto';fab.style.bottom='auto';
        state.fabPosition=p;save('fabPosition',p);fab.dataset.suppressClick='1';
        setTimeout(()=>{fab.classList.remove('snapping');fab.dataset.suppressClick='0';},250);
      }
    };
    fab.addEventListener('pointerup',finish);fab.addEventListener('pointercancel',finish);
    fab.addEventListener('click',e=>{if(fab.dataset.suppressClick==='1'){e.preventDefault();e.stopPropagation();return;}openAnalyzer();});
    window.addEventListener('resize',()=>applyFabPosition(fab),{passive:true});
  }
  function fabIconSvg() {
    return `<span class="tta-fabicon" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><defs><linearGradient id="ttaFabPulse" x1="7" y1="23" x2="25" y2="8" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#79dfb3"/><stop offset="1" stop-color="#91cdf7"/></linearGradient></defs><rect class="tta-fab-panel" x="4.5" y="5" width="23" height="21" rx="6"/><path class="tta-fab-grid" d="M9 10.5h14M9 15.5h14M9 20.5h14M12 9v13M18 9v13M24 9v13"/><path class="tta-fab-line" d="M8 21l4.1-4.2 3.5 2.2 4.2-6.4 4.2 2.4"/><circle class="tta-fab-dot" cx="24" cy="15" r="1.8"/><path class="tta-fab-mark" d="M7.5 8.3h4.2v1.3H7.5z"/></svg></span>`;
  }

  function updateFabState() {
    const fab=document.getElementById('tta-fab');if(!fab)return;
    const syncing=!!state.syncing;
    fab.classList.toggle('syncing',syncing);
    fab.setAttribute('aria-label',syncing?'Cash Flow Analyzer syncing':'Cash Flow Analyzer');
    fab.title=syncing?'Financial history sync is running \u00B7 tap to reopen':'Open Cash Flow Analyzer';
    fab.innerHTML=syncing?'<span class="tta-fabspinner" aria-hidden="true"></span>':fabIconSvg();
    fab.style.display=state.open?'none':'inline-flex';
    requestAnimationFrame(()=>applyFabPosition(fab));
  }
  function mount() {
    injectCss();
    if (!document.getElementById('tta-fab')) {
      const fab = document.createElement('button'); fab.id = 'tta-fab';
      fab.innerHTML = fabIconSvg();
      document.body.appendChild(fab);bindFabDrag(fab);requestAnimationFrame(()=>applyFabPosition(fab));
    } else { const fab=document.getElementById('tta-fab');bindFabDrag(fab);applyFabPosition(fab); }
    if (!document.getElementById('tta-root')) {
      const root = document.createElement('div'); root.id = 'tta-root'; document.body.appendChild(root);
      root.setAttribute('role','dialog');root.setAttribute('aria-label','Torn Cash Flow Analyzer');
    }
    updateFabState();
    render();
  }
