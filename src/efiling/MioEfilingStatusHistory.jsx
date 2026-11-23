import { useCallback, useEffect, useState } from 'react'

// Read-only status view. Never makes filing-status claims based on the mock
// provider; only persisted Tyler outbound IDs and authenticated receipts appear.
export default function MioEfilingStatusHistory({repository, ownerId, matterId}) {
  const [rows,setRows]=useState([])
  const [audit,setAudit]=useState([])
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)
  const load=useCallback(async()=>{
    if(repository?.mode !== 'supabase' || !ownerId || !matterId) return
    setLoading(true);setError('')
    try {
      const [filings,history]=await Promise.all([
        repository.listSubmissions(ownerId,matterId),
        repository.listSubmissionAudit(ownerId,matterId),
      ])
      setRows(filings)
      setAudit(history)
    }catch(e){setError(e?.message||'Filing status unavailable.')}finally{setLoading(false)}
  },[repository,ownerId,matterId])
  useEffect(()=>{void load()},[load])
  if(repository?.mode !== 'supabase' || !ownerId || !matterId)return null
  return <section className="mio-efiling-status-history" aria-label="Tyler filing history">
    <h3>Tyler filing history (read only)</h3>
    <p className="mio-efiling-muted">Only verified Tyler filings registered to this matter appear here. Mock submissions are excluded.</p>
    <button type="button" onClick={()=>void load()} disabled={loading}>{loading?'Refreshing…':'Refresh filing history'}</button>
    {error&&<div className="mio-efiling-error" role="alert">{error}</div>}
    {!error&&!rows.length&&<p className="mio-efiling-muted">No authenticated Tyler filing submissions are recorded for this matter.</p>}
    {rows.length>0&&<div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}>
      <thead><tr><th>Environment</th><th>Envelope</th><th>Filing</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.id}>
        <td>{row.environment}</td><td>{row.envelope_id}</td><td>{row.filing_id}</td>
        <td><strong>{row.status}</strong>{row.status_details&&<div>{row.status_details}</div>}</td>
        <td>{row.updated_at?new Date(row.updated_at).toLocaleString():''}</td>
      </tr>)}</tbody>
    </table></div>}
    {audit.length>0&&<details><summary>Filing audit history ({audit.length})</summary>
      <ul>{audit.map(item=><li key={item.id}>
        {item.recorded_at?new Date(item.recorded_at).toLocaleString():''} — {item.event_type}: {item.from_status||'new'} → {item.to_status}
      </li>)}</ul>
    </details>}
  </section>
}
