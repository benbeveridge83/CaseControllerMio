// Extend the existing billing flow without duplicating its invoice or WIP logic.
export function transformAppointedBilling(source) {
  let code = "import MioAppointedBilling from './MioAppointedBilling.jsx'\n" + source
  const once = (needle, replacement, label) => {
    if (code.split(needle).length !== 2) throw new Error(`Appointed billing anchor changed: ${label}`)
    code = code.replace(needle, replacement)
  }
  once('  const [bulkInvoiceLedgerOpen, setBulkInvoiceLedgerOpen] = useState(false)', `  const [appointedBillingOpen, setAppointedBillingOpen] = useState(false)
  const [appointedCreatedInvoices, setAppointedCreatedInvoices] = useState([])
  const [bulkInvoiceLedgerOpen, setBulkInvoiceLedgerOpen] = useState(false)`, 'workspace state')
  once('  function openBulkWipReview(matterIds) {', `  async function openAppointedBilling() {
    if (!session?.user?.id) return alert('Sign in to review appointed billing.')
    setBulkBillingBusy(true)
    try {
      const [entries, invoices] = await Promise.all([
        loadAllSupabasePages(() => supabase.from('mio_billing_entries').select('*').eq('user_id', session.user.id).order('entry_date', { ascending: false })),
        loadAllSupabasePages(() => supabase.from('mio_invoices').select('*').eq('user_id', session.user.id).order('issue_date', { ascending: false }))
      ])
      setBillingEntries(current => mergeBillingEntriesForState((entries || []).map(billingEntryFromRelationalRow), current, readBrowserBillingEntriesFallback()))
      setMioInvoices(current => mergeMioInvoiceState((invoices || []).map(invoiceFromDatabaseRow), current))
      setAppointedCreatedInvoices([])
      setAppointedBillingOpen(true)
    } catch (error) { alert('Appointed billing could not load current invoices and WIP. ' + (error?.message || error)) }
    finally { setBulkBillingBusy(false) }
  }

  function openBulkWipReview(matterIds, { workflow = '' } = {}) {`, 'existing WIP entry')
  once('    setBulkWipReview({ open: true, matter_ids: ids, drafts, approved_ids: [], invoice_by_matter: {} })',
    '    setBulkWipReview({ open: true, workflow, matter_ids: ids, drafts, approved_ids: [], invoice_by_matter: {} })', 'WIP context')
  once('  async function completeBulkWipReview(matterId, action) {', `  async function completeBulkWipReview(matterId, action) {
    if (bulkWipReview.workflow === 'appointed' && action !== 'create') return`, 'creation-only appointed actions')
  const individual = "      setBulkBillingResult(`${invoice.invoice_number} ${action === 'pay' ? 'was paid from trust' : action === 'email' ? 'was emailed to the client' : 'was created'}.`)"
  once(individual, `      if (bulkWipReview.workflow === 'appointed') setAppointedCreatedInvoices(current => [...current.filter(row => String(row.id) !== String(invoice.id)), invoice])
${individual}`, 'individual invoice handoff')
  const batch = '      const savedByMatter = Object.fromEntries(saved.map((invoice) => [String(invoice.matter_id), invoice]))'
  once(batch, `      if (review.workflow === 'appointed') setAppointedCreatedInvoices(current => [...current.filter(row => !saved.some(invoice => String(invoice.id) === String(row.id))), ...saved])
${batch}`, 'verified batch handoff')
  const start = code.indexOf('  function renderBulkBillingPanel() {')
  const end = code.indexOf('\n  function ', start + 10)
  if (start < 0 || end < 0) throw new Error('Appointed billing: Bulk Billing renderer not found')
  let panel = code.slice(start, end)
  const replacePanel = (needle, replacement, label) => {
    if (panel.split(needle).length !== 2) throw new Error(`Appointed billing panel anchor changed: ${label}`)
    panel = panel.replace(needle, replacement)
  }
  replacePanel('<button type="button" onClick={openBulkInvoiceLedger}>All invoices</button>', `<button type="button" className="btnPrimary" onClick={openAppointedBilling} disabled={bulkBillingBusy}>Appointed billing</button>
            <button type="button" onClick={openBulkInvoiceLedger}>All invoices</button>`, 'launch button')
  const payButtons = '<button type="button" className="btnPrimary" onClick={() => completeBulkWipReview(id, \'pay\')} disabled={bulkBillingBusy || total <= 0.005}>Approve & pay from trust</button><button type="button" className="btnPrimary" onClick={() => completeBulkWipReview(id, \'email\')} disabled={bulkBillingBusy || total <= 0.005}>Approve & email client</button>'
  replacePanel(payButtons, "{bulkWipReview.workflow !== 'appointed' && <>" + payButtons + '</>}', 'appointed WIP controls')
  replacePanel('      {renderBulkInvoiceLedger()}', `      {renderBulkInvoiceLedger()}
      {appointedBillingOpen && <MioAppointedBilling matters={matters} invoices={mioInvoices || []} firmProfile={lawFirmProfile}
        clientName={matterClientName} courtName={matter => { const name = courts.find(court => String(court.id) === String(matter.court_id))?.name || ''; return name.match(/\\b\\d+(?:st|nd|rd|th)\\b/i)?.[0] || name }}
        financeFor={matter => bulkFinanceByMatterId.get(String(matter.id)) || clientFinanceNumbers(matter)}
        onCreateWip={ids => openBulkWipReview(ids, { workflow: 'appointed' })} createdInvoices={appointedCreatedInvoices}
        supabase={supabase} session={session} onClose={() => setAppointedBillingOpen(false)} />}`, 'workspace mount')
  code = code.slice(0, start) + panel + code.slice(end)
  return code
}
export default function appointedBillingMount() {
  return { name: 'mio-appointed-billing', enforce: 'pre', transform(source, id) {
    if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/App.jsx')) return null
    return { code: transformAppointedBilling(source), map: null }
  } }
}
