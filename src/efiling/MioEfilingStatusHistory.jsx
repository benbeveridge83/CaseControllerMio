import { useCallback, useEffect, useState } from 'react'
import { classifyTylerFilingState } from '../../lib/efiling/tylerFilingOutcome.js'

// Only authenticated, previously recorded Tyler filings are displayed here.
// No mock submissions and no client writes to the Tyler ledger. Filing state is
// classified (never conflating submitted/accepted/served) and stored receipts
// (clerk receipt, fee receipt, file-stamped documents) and e-service results
// are shown read-only for the matter.
export default function MioEfilingStatusHistory({ repository, ownerId, matterId }) {
  const [rows, setRows] = useState([])
  const [audit, setAudit] = useState([])
  const [receipts, setReceipts] = useState([])
  const [serviceResults, setServiceResults] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const configured = repository?.mode === 'supabase' && Boolean(ownerId && matterId)

  const fetchAll = () => Promise.all([
    repository.listSubmissions(ownerId, matterId),
    repository.listSubmissionAudit(ownerId, matterId),
    repository.listReceipts(ownerId, matterId),
    repository.listServiceResults(ownerId, matterId),
  ])

  const load = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError('')
    try {
      const [filings, history, receiptRows, serviceRows] = await fetchAll()
      setRows(filings)
      setAudit(history)
      setReceipts(receiptRows)
      setServiceResults(serviceRows)
    } catch (cause) {
      setError(cause?.message || 'Unable to load filing history.')
    } finally {
      setLoading(false)
    }
  }, [configured, repository, ownerId, matterId])

  useEffect(() => {
    if (!configured) return
    let active = true
    async function refresh() {
      try {
        const [filings, history, receiptRows, serviceRows] = await fetchAll()
        if (active) {
          setRows(filings)
          setAudit(history)
          setReceipts(receiptRows)
          setServiceResults(serviceRows)
          setError('')
        }
      } catch (cause) {
        if (active) setError(cause?.message || 'Unable to load filing history.')
      }
    }
    setRows([])
    setAudit([])
    setReceipts([])
    setServiceResults([])
    void refresh()
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 60_000)
    return () => { active = false; clearInterval(interval) }
  }, [configured, repository, ownerId, matterId])

  const stateFor = (row) => classifyTylerFilingState({
    submission: row,
    serviceDelivered: serviceResults.some((r) => r.submission_id === row.id && r.outcome === 'delivered'),
  })

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
        <td><strong>{stateFor(row)}</strong>{row.status_details && <div>{row.status_details}</div>}</td>
        <td>{row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</td>
      </tr>)}</tbody>
    </table></div>}
    {receipts.length > 0 && <details><summary>Filing documents ({receipts.length})</summary><ul>
      {receipts.map(r => <li key={r.id}>{r.kind.replace(/_/g, ' ')}: {r.file_name || r.storage_path}</li>)}
    </ul></details>}
    {serviceResults.length > 0 && <details><summary>E-service results ({serviceResults.length})</summary><ul>
      {serviceResults.map(r => <li key={r.id}>{r.service_contact_id}: {r.outcome}</li>)}
    </ul></details>}
    {audit.length > 0 && <details><summary>Filing audit history ({audit.length})</summary><ul>
      {audit.map(item => <li key={item.id}>
        {item.recorded_at ? new Date(item.recorded_at).toLocaleString() : ''} — {item.event_type}: {item.from_status || 'new'} → {item.to_status}
      </li>)}
    </ul></details>}
  </section>
}
