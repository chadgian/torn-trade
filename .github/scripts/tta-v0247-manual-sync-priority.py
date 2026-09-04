from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

def rep(old,new,count=1):
    global s
    n=s.count(old)
    if n < count:
        raise SystemExit(f'anchor not found enough times: {old[:120]!r} found={n}')
    s=s.replace(old,new,count)

rep('// @version      0.2.46','// @version      0.2.47')
rep("const VERSION = '0.2.46';","const VERSION = '0.2.47';")

old="""  async function syncAll(options={}) {
    const background=!!options?.background;
    if(background){if(state.syncing||state.backgroundSyncing)return;}
    else{if(state.syncing)return;if(state.backgroundSyncing){toast('Background Quick Sync is already updating the latest data.');return;}}
    if(!hasApiKey()){if(!background){state.demo=true;toast('Add a Torn API key in Settings \\u2192 API Key to sync real history.');}return;}
"""
new="""  let manualSyncTakeover=false;
  async function yieldBackgroundSyncForManual() {
    if(!state.backgroundSyncing)return true;
    toast('Pausing background Quick Sync so your manual sync can start\\u2026');
    state.syncCancel=true;
    const bgJob=loadSyncJob();
    if(bgJob?.background){bgJob.cancelled=true;bgJob.progress='Yielding to manual sync after the current API request\\u2026';saveSyncJob(bgJob);}
    const deadline=Date.now()+30000;
    while(state.backgroundSyncing&&Date.now()<deadline)await sleep(50);
    if(state.backgroundSyncing){toast('Background sync is still finishing its current API request. Tap Sync again in a moment.');return false;}
    state.syncCancel=false;state.backgroundSyncProgress='';
    const leftover=loadSyncJob();if(leftover?.background)discardStaleSyncJob(leftover);
    return true;
  }
  async function syncAll(options={}) {
    const background=!!options?.background;
    if(background){if(state.syncing||state.backgroundSyncing||manualSyncTakeover)return;}
    else{
      if(state.syncing||manualSyncTakeover)return;
      manualSyncTakeover=true;
      try{
        if(state.backgroundSyncing){const yielded=await yieldBackgroundSyncForManual();if(!yielded)return;}
        if(state.syncing)return;
      }finally{manualSyncTakeover=false;}
    }
    if(!hasApiKey()){if(!background){state.demo=true;toast('Add a Torn API key in Settings \\u2192 API Key to sync real history.');}return;}
"""
rep(old,new)

# Keep sync buttons available during background activity; only a foreground manual sync disables them.
if "state.backgroundSyncing?'disabled'" in s:
    raise SystemExit('unexpected background disable rule found')

p.write_text(s,encoding='ascii')
