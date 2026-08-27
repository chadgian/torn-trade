from pathlib import Path
import runpy

runpy.run_path('.github/scripts/v027_runtime_isolation.py')
p=Path('torn-trade-analyzer.user.js')
s=p.read_text()
old="""  function suppressLegacyUi(){
    // Old copies used these shared IDs. Removing/hiding them prevents legacy watchdogs,
    // style tags and roots from fighting the current runtime. The data namespace stays shared.
    for(const id of ['tta-fab-host','tta-fab','tta-root','tta-css']){
      const el=document.getElementById(id);if(!el)continue;
      try{if(id==='tta-fab')el.style.setProperty('display','none','important');else el.remove();}catch(_){}
    }
  }
"""
new="""  function suppressLegacyUi(){
    // Keep legacy nodes connected but inert. Removing them can trigger old watchdogs to
    // recreate them continuously, causing a DOM tug-of-war. Hiding/disabling them leaves
    // old copies satisfied while the isolated current runtime owns the visible UI.
    const oldFab=document.getElementById('tta-fab');if(oldFab){oldFab.style.setProperty('display','none','important');oldFab.style.setProperty('visibility','hidden','important');oldFab.style.setProperty('pointer-events','none','important');}
    const oldHost=document.getElementById('tta-fab-host');if(oldHost){oldHost.style.setProperty('display','none','important');oldHost.style.setProperty('visibility','hidden','important');oldHost.style.setProperty('pointer-events','none','important');}
    const oldRoot=document.getElementById('tta-root');if(oldRoot){oldRoot.classList.remove('show');oldRoot.style.setProperty('display','none','important');oldRoot.style.setProperty('visibility','hidden','important');oldRoot.style.setProperty('pointer-events','none','important');}
    const oldCss=document.getElementById('tta-css');if(oldCss){try{oldCss.disabled=true;}catch(_){}oldCss.setAttribute('media','not all');}
  }
"""
assert old in s
s=s.replace(old,new,1)
p.write_text(s)
