// LawPay account diagnostics: administrator-only and read-only.
//
// `lawpay-account-diagnostics` contains no action that records, corrects, matches or maps anything,
// and it refuses anyone who is not a firm finance administrator. It is invoked only when the
// administrator presses the button — there is no automatic or background call, so an Edge Function
// that is absent or misconfigured can never surface a red background error.
import { useRef } from 'react'
import { supabase } from './supabaseClient.js'

export default function MioLawPayDiagnostics() {
  const statusRef = useRef(null)
  const reportRef = useRef(null)
  async function run() {
    const status = statusRef.current
    const report = reportRef.current
    if (!status || !report) return
    status.textContent = 'Reading LawPay account diagnostics…'
    report.hidden = true
    try {
      const { data, error } = await supabase.functions.invoke('lawpay-account-diagnostics', { body: { limit: 200 } })
      if (error) throw new Error(error.message || 'The LawPay diagnostics function could not be reached.')
      if (data?.error) throw new Error(data.error)
      if (!data?.diagnostics) throw new Error('The diagnostics function answered without a report. The deployed revision may predate it.')
      report.textContent = JSON.stringify({ version: data.version, redacted: data.redacted, mapping_table_available: data.mapping_table_available, diagnostics: data.diagnostics }, null, 2)
      report.hidden = false
      status.textContent = 'Report ready. Select the text above, or press Copy report.'
    } catch (failure) {
      status.textContent = failure?.message || String(failure)
    }
  }
  function copy() {
    const status = statusRef.current
    const report = reportRef.current
    if (!report?.textContent) { if (status) status.textContent = 'Run the diagnostics first.'; return }
    Promise.resolve(navigator.clipboard?.writeText(report.textContent)).then(() => { if (status) status.textContent = 'Report copied.' }).catch(() => { if (status) status.textContent = 'Select the report text and copy it manually.' })
  }
  return (
    <section aria-label="LawPay account diagnostics" style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: 12, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" data-testid="lawpay-run-diagnostics" onClick={run}>{'Run LawPay account diagnostics'}</button>
        <button type="button" data-testid="lawpay-copy-diagnostics" onClick={copy}>{'Copy report'}</button>
        <span style={{ color: '#475569' }} ref={statusRef} data-testid="lawpay-diagnostics-status">{'Read-only. Masked counts only: no full identifiers, payers, amounts, emails, references or payloads.'}</span>
      </div>
      <pre ref={reportRef} data-testid="lawpay-diagnostics-report" hidden style={{ whiteSpace: 'pre-wrap', background: '#0f172a', color: '#e2e8f0', borderRadius: 8, padding: 10, maxHeight: 340, overflow: 'auto', margin: 0 }}>{''}</pre>
    </section>
  )
}
