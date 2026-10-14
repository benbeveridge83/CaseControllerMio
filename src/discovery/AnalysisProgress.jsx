import { useEffect, useState } from 'react'
import { DISCOVERY_TYPES } from './model.js'

const labels={idle:'Ready · not running',running:'Running',retrying:'Running · waiting to retry',stopped:'Stopped · not running',paused:'Paused · not running',attention:'Finished · some requests need retry',completed:'Complete · not running'}
export default function AnalysisProgress({job,total,completed,disabled,onAnalyze,onStop}) {
  const [now,setNow]=useState(Date.now)
  const active=job.phase==='running'||job.phase==='retrying'
  useEffect(()=>{
    if(!active)return
    const timer=setInterval(()=>setNow(Date.now()),1000)
    return ()=>clearInterval(timer)
  },[active])
  const remaining=total-completed,failed=Object.keys(job.failures||{}).length
  const current=job.current&&`${DISCOVERY_TYPES.find(t=>t.id===job.current.type)?.label||job.current.type} ${job.current.number}`
  const phase=job.phase||'idle'
  const elapsed=Math.max(0,Math.floor((now-(job.attemptStartedAt||now))/1000))
  const wait=Math.max(0,Math.ceil(((job.retryAt||now)-now)/1000))
  return <section className={`disco-analysis-progress ${active?'is-running':''}`} aria-label="Analysis progress">
    <div className="disco-analysis-progress-main"><div role="status"><strong className="disco-run-status"><span className="disco-run-dot" aria-hidden="true"/>{labels[phase]}</strong><div className="disco-analysis-counts"><b>{completed} of {total} analyzed</b><span>{remaining} remaining</span>{failed>0&&<span className="disco-retry-count">{failed} need retry or review</span>}</div></div>
      <div className="disco-analysis-actions">{active?<button type="button" onClick={onStop}>Stop analysis</button>:<button type="button" className="disco-primary" disabled={disabled||!remaining} onClick={onAnalyze}>{!remaining?'All requests analyzed':completed?`Analyze ${remaining} remaining`:`Analyze ${total} request${total===1?'':'s'}`}</button>}</div>
    </div>
    <progress aria-label="Requests analyzed" value={completed} max={total}/>
    {active&&<p className="disco-current-request">{current?`${current} · attempt ${job.attempt} of 2`:'Starting analysis…'}{phase==='retrying'?` · retrying in ${wait}s`:` · waiting for AI (${elapsed}s)`}</p>}
    {job.message&&<p className="disco-run-message">{job.message}</p>}
    {phase==='attention'&&<p className="disco-run-message">All requests were attempted. Unresolved requests remain marked for retry or manual review; no assessment was assigned to them.</p>}
    {phase==='idle'&&<p>Analysis runs one request at a time. Keep this page open; completed results appear as each request finishes.</p>}
    {phase==='completed'&&<p>Every request has an analysis. Review the suggested language, strength and authority before use.</p>}
  </section>
}
