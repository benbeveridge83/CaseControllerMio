import React,{useState} from 'react'
export function KeywordHistoryEntry({entry,api,onRefresh}) {
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),phase=entry.before_snapshot?.phase||entry.result?.phase
 return <details className="aw-history-entry"><summary>{new Date(entry.created_at).toLocaleString()} — Keyword Lab {phase||'approval'} — {entry.status}</summary><p>Approver: {entry.actor_email}</p>{(entry.result?.items||entry.result?.results?.map(r=>r.item)||entry.after_snapshot?.items||[]).map((r,i)=><p key={r.id||i}>{r.kind} · {r.keyword} · {r.campaignName||r.campaignId} / {r.adGroupName||r.adGroupId} · {r.matchType}</p>)}{entry.result?.results?.map(r=><p key={r.id}>{r.item?.keyword}: {r.state} — {r.message}</p>)}{error&&<p role="alert">{error}</p>}{phase==='apply'&&<button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api('keyword_verify',{method:'POST',body:{eventId:entry.id}});await onRefresh()}catch(e){setError(e.message)}finally{setBusy(false)}}}>Recheck Keyword Lab outcome (read-only)</button>}</details>
}
export default function KeywordHistory({api}) {
 const [entries,setEntries]=useState([]),[error,setError]=useState('')
 async function load(){try{setEntries((await api('workspace_history')).entries?.filter(e=>e.kind==='keyword_lab')||[]);setError('')}catch(e){setError(e.message)}}
 return <details onToggle={e=>{if(e.target===e.currentTarget&&e.currentTarget.open)load()}}><summary>Keyword Lab change history</summary><button onClick={load}>Refresh Keyword Lab history</button>{error&&<p role="alert">{error}</p>}{entries.map(entry=><KeywordHistoryEntry key={entry.id} {...{entry,api}} onRefresh={load}/>)}</details>
}
