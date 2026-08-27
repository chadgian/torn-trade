from pathlib import Path
p=Path('torn-trade-analyzer.user.js')
s=p.read_text()
old="""    if(!job){
      if(requestedMode==='full')resetHistoryForFullResync();
      job=createResumableSyncJob(requestedMode);
    }
"""
new="""    if(!job)job=createResumableSyncJob(requestedMode);
"""
assert old in s
s=s.replace(old,new,1)
old2="""    const keyInfo=await inspectActiveKey();if(!keyInfo.hasUserLog)throw new Error('This API key does not include User → Log access.');
    let types=[];if(job.logScanPeriod)types=relevantLogTypes(await ensureLogTypes(false));
"""
new2="""    const keyInfo=await inspectActiveKey();if(!keyInfo.hasUserLog)throw new Error('This API key does not include User → Log access.');
    if(job.syncMode==='full'&&!job.fullResetDone){resetHistoryForFullResync();job.fullResetDone=true;checkpointSyncJob(job,'API access confirmed · local discovered history cleared · starting full rebuild…');}
    let types=[];if(job.logScanPeriod)types=relevantLogTypes(await ensureLogTypes(false));
"""
assert old2 in s
s=s.replace(old2,new2,1)
p.write_text(s)
