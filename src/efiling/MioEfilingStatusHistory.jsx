import { useCallback, useEffect, useState } from 'react'

// Only authenticated, previously recorded Tyler filings are displayed here.
// No mock submissions and no client writes to the Tyler ledger.
export default function MioEfilingStatusHistory({ repository, ownerId, matterId }) {
  const [rows, setRows] = useState([])
  const [audit, setAudit] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const configured = repository?.mode === 'supabase' && Boolean(ownerId && matterId)
  const load = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError('')
    try {
      const [filings, history] = await Promise.all([
        repository.listSubmissions(ownerId, matterId),
        repository.listSubmissionAudit(ownerId, matterId),
      ])
      setRows(filings)
      setAudit(history)
    } catch (cause) {
      setError(cause?.message || 'Unable to load filing history.')
    } finally {
      setLoading(false)
    }
  }, [configured, repository, ownerId, matterId])

  useEffect(() => {
    if (!configured) return
    let active = true
    // Fetch both tables together; ignore stale responses after matter change.
    async function refresh() {
      try {
        const [filings, history] = await Promise.all([
          repository.listSubmissions(ownerId, matterId),
          repository.listSubmissionAudit(ownerId, matterId),
        ])
        if (active) {
          setRows(filings)
          setAudit(history)
          setError('')
        }
      } catch (cause) {
        if (active) setError(cause?.message || 'Unable to load filing history.')
      }
    }
    setRows([])
    setAudit([])
    void refresh()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 60_000)
    return () => { active = false; clearInterval(interval) }
  }, [configured, repository, ownerId, matterId])

  if (!configured) return null
  return <section className="mio-efiling-status-history" aria-label="Tyler filing history">
    <h3>Tyler filing history (read only)</h3>
    <p className="mio-efiling-muted">Shows authenticated Tyler submissions recorded for this matter, not mock filings. Refreshes every minute while this tab is visible.</p>
    <button type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh filing history'}</button>
    {error && <div className="mio-efiling-error" role="alert">Filing status could not be loaded: {error}</div>}
    {!error && !rows.length && <p className="mio-efiling-muted">No Tyler submissions have been recorded for this matter.</p>}
    {rows.length > 0 && <div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}>
      <thead><tr><th>Environment</th><th>Envelope</th><th>Filing</th><th>Status</th><th>Last update</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td>{row.environment}</td><td>{row.envelope_id}</td><td>{row.filing_id}</td>
        <td><strong>{row.status}</strong>{row.status_details && <div>{row.status_details}</div>}</td>
        <td>{row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</td>
      </tr>)}</tbody>
    </table></div>}
    {audit.length > 0 && <details><summary>Filing audit history ({audit.length})</summary><ul>
      {audit.map(item => <li key={item.id}>
        {item.recorded_at ? new Date(item.recorded_at).toLocaleString() : ''} — {item.event_type}: {item.from_status || 'new'} → {item.to_status}
      </li>)}
    </ul></details>}
  </section>
}
