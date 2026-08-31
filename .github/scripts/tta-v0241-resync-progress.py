from pathlib import Path

p=Path('torn-trade-analyzer.user.js')
s=p.read_text(encoding='ascii')

def rep(old,new,label):
    global s
    if old not in s:
        raise SystemExit(f'missing anchor: {label}')
    s=s.replace(old,new,1)

rep('// @version      0.2.40','// @version      0.2.41','version header')
rep("const VERSION = '0.2.40';","const VERSION = '0.2.41';",'version const')
anchor="""  function syncJobCancelled(job){return !!(state.syncCancel||job?.cancelled);}\n  function checkpointSyncJob(job,progress='') {\n    if(progress){job.progress=String(progress);if(job?.background)state.backgroundSyncProgress=job.progress;else setSyncProgress(job.progress);}\n    if(!saveSyncJob(job))throw new Error('Unable to save the resumable sync checkpoint. Free some browser storage and try again.');\n  }\n"""
insert=r'''  function syncJobCancelled(job){return !!(state.syncCancel||job?.cancelled);}
  function formatEtaDuration(ms) {
    let sec=Math.max(0,Math.round((Number(ms)||0)/1000));
    if(sec<60)return `${Math.max(1,sec)}s`;
    const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
    if(h>0)return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }
  function fullResyncProgressMetrics(job) {
    if(!job||job.syncMode!=='full')return null;
    const phase=String(job.phase||'setup'),d=job.diagnostics||{};let pct=1;
    if(phase==='setup')pct=2;
    else if(phase==='logs-filtered'){
      const total=Math.max(1,Math.ceil((job.logTypeIds||[]).length/MAX_LOG_IDS_PER_REQUEST));
      const batch=Math.max(0,Math.min(total,Number(job.logBatchIndex)||0)),page=Math.max(0,Number(job.logPage)||0);
      const within=batch>=total?0:(page>0?Math.min(.88,page/(page+8)):0);pct=5+55*Math.min(1,(batch+within)/total);
    }else if(phase==='logs-fallback'){
      const page=Math.max(0,Number(job.logPage)||0);pct=60+10*(page>0?Math.min(.9,page/(page+8)):0);
    }else if(phase==='logs-abroad-verify'){
      const page=Math.max(0,Number(d.abroadVerifyPages)||0);pct=70+6*(page>0?Math.min(.9,page/(page+5)):0);
    }else if(phase==='trades-list'){
      const page=Math.max(0,Number(d.tradeListPages)||0);pct=76+8*(page>0?Math.min(.9,page/(page+4)):0);
    }else if(phase==='trade-details'){
      const total=Math.max(0,(job.tradeHeaders||[]).length),done=Math.max(0,Number(job.tradeDetailIndex)||0);pct=84+13*(total>0?Math.min(1,done/total):1);
    }else if(phase==='finalize')pct=99;
    pct=Math.max(Number(job.progressPercent)||0,Math.min(99,pct));job.progressPercent=pct;
    const now=Date.now(),last=Number(job.progressClockAt)||now,delta=Math.max(0,now-last);
    if(delta<=30000)job.progressActiveMs=(Number(job.progressActiveMs)||0)+delta;
    job.progressClockAt=now;
    const active=Math.max(0,Number(job.progressActiveMs)||0);let eta=null;
    if(pct>=3&&active>=2500&&pct<99){const raw=active*((100-pct)/pct),prev=Number(job.progressEtaMs)||0;eta=prev>0?(prev*.65+raw*.35):raw;job.progressEtaMs=eta;}
    return {percent:pct,etaMs:eta};
  }
  function decorateSyncProgress(job,progress) {
    const text=String(progress||''),m=fullResyncProgressMetrics(job);if(!m)return text;
    const pc=Math.max(0,Math.min(99,Math.round(m.percent))),eta=m.etaMs!=null?`~${formatEtaDuration(m.etaMs)} left`:'estimating time left';
    return `${pc}% \u00B7 ${eta} \u00B7 ${text}`;
  }
  function checkpointSyncJob(job,progress='') {
    if(progress){job.progressRaw=String(progress);job.progress=decorateSyncProgress(job,job.progressRaw);if(job?.background)state.backgroundSyncProgress=job.progress;else setSyncProgress(job.progress);}
    if(!saveSyncJob(job))throw new Error('Unable to save the resumable sync checkpoint. Free some browser storage and try again.');
  }
'''
rep(anchor,insert,'progress estimator')
old="""tradeDetailIndex:0,verifiedTradeIds:[],verifiedTradeTimes:{}};\n    checkpointSyncJob(job,job.progress);return job;"""
new="""tradeDetailIndex:0,verifiedTradeIds:[],verifiedTradeTimes:{},progressPercent:0,progressActiveMs:0,progressClockAt:Date.now(),progressEtaMs:0};\n    checkpointSyncJob(job,job.progress);return job;"""
rep(old,new,'job progress fields')
p.write_text(s,encoding='ascii')
