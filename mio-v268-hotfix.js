// Mio V269 trust reconciliation fix.
// Runs after the V268 source transform and makes the firmwide trust account use
// the exact same per-matter balances as Bulk Billing. It also prevents separate
// Mio matters that share a cause number from being merged into one graph stream.
function replaceRequired(code, search, replacement, label) {
  if (!code.includes(search)) throw new Error(`Mio V269 trust fix could not find ${label}`)
  return code.replace(search, replacement)
}

export default function mioV268Hotfix() {
  return {
    name: 'mio-v269-trust-reconciliation-fix',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/App.jsx')) return null
      let code = source

      code = replaceRequired(
        code,
        "const MIO_APP_VERSION = 'Mio V268'",
        "const MIO_APP_VERSION = 'Mio V269'",
        'V268 version constant'
      )

      code = replaceRequired(
        code,
        `  function mioFinancialGraphMatterKey(matter) {
    if (!matter) return ''
    const numbered = billingMatterNumber(matter) || matter.clio_matter_number || matter.clio_display_number || matter.cause_number || matter.case_number || ''
    if (numbered) return normalizeClioMatterNumber(numbered) || String(numbered)
    return \`mio:\${String(matter.id || matter.name || '')}\`
  }`,
        `  function mioFinancialGraphMatterKey(matter) {
    if (!matter) return ''
    if (matter.id) return \`mio:\${String(matter.id)}\`
    const numbered = billingMatterNumber(matter) || matter.clio_matter_number || matter.clio_display_number || matter.cause_number || matter.case_number || ''
    if (numbered) return normalizeClioMatterNumber(numbered) || String(numbered)
    return \`mio:\${String(matter.name || '')}\`
  }`,
        'financial graph matter key'
      )

      code = replaceRequired(
        code,
        `    ;(Array.isArray(rows) ? rows : []).forEach((row) => {
      const matterKey = financialGraphRowMatterKey(row)
      if (!matterKey) return
      const linkedMatter = financialGraphRowMatter(row)`,
        `    ;(Array.isArray(rows) ? rows : []).forEach((row) => {
      const linkedMatter = financialGraphRowMatter(row)
      const matterKey = String(row?.mio_matter_id || linkedMatter?.id || financialGraphRowMatterKey(row))
      if (!matterKey) return`,
        'firm trust stream key'
      )

      code = replaceRequired(
        code,
        `  function renderCalculatedFirmTrustAccountPanel() {
    const ledgerRows = calculatedFirmTrustAccountRows()
    const currentCalculatedTrust = matters.reduce((sum, matter) => sum + financeNumber(financialsForMatter(matter)?.trust), 0)
    const lastLedgerBalance = ledgerRows.length ? financeNumber(ledgerRows[ledgerRows.length - 1].balance) : currentCalculatedTrust
    return (`,
        `  function renderCalculatedFirmTrustAccountPanel() {
    const ledgerRows = calculatedFirmTrustAccountRows()
    const currentCalculatedTrust = (matters || []).reduce((sum, matter) => {
      const finance = bulkFinanceByMatterId.get(String(matter?.id || '')) || clientFinanceNumbers(matter)
      return sum + financeNumber(finance?.trust)
    }, 0)
    const firmTrustSeries = calculatedFirmTrustSeries(mioTrustLedgerFinancialGraphRows())[0]
    const firmTrustEndingPoint = firmTrustSeries?.points?.[firmTrustSeries.points.length - 1]
    const firmLedgerEndingBalance = firmTrustEndingPoint ? financeNumber(firmTrustEndingPoint.balance) : currentCalculatedTrust
    const trustReconciliationDifference = Number((currentCalculatedTrust - firmLedgerEndingBalance).toFixed(2))
    return (`,
        'calculated trust account totals'
      )

      code = replaceRequired(
        code,
        `<div className="hint">One account made from the same trust ledgers shown on every matter's Accounting tab. This is Mio's calculated book balance, not the bank balance.</div>`,
        `<div className="hint">The current balance is the sum of the exact same per-matter trust balances used by Bulk Billing. The firm ledger ending balance must match it. This is Mio's book balance, not the bank balance.</div>`,
        'calculated trust account description'
      )

      code = replaceRequired(
        code,
        `        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 12, marginBottom: 14 }}>
          <div style={{ padding: 12, border: '1px solid #86efac', borderRadius: 9, background: '#f0fdf4' }}><div className="hint">Current calculated trust balance</div><strong style={{ color: '#166534', fontSize: 24 }}>{money(currentCalculatedTrust)}</strong></div>
          <div style={{ padding: 12, border: '1px solid #bfdbfe', borderRadius: 9, background: '#eff6ff' }}><div className="hint">Latest ledger-calculated balance</div><strong style={{ color: '#1d4ed8', fontSize: 24 }}>{money(lastLedgerBalance)}</strong></div>
          <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 9, background: '#f8fafc' }}><div className="hint">Trust ledger events</div><strong style={{ fontSize: 24 }}>{ledgerRows.length}</strong></div>
        </div>`,
        `        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginTop: 12, marginBottom: 14 }}>
          <div style={{ padding: 12, border: '1px solid #86efac', borderRadius: 9, background: '#f0fdf4' }}><div className="hint">Current calculated trust balance</div><strong style={{ color: '#166534', fontSize: 24 }}>{money(currentCalculatedTrust)}</strong></div>
          <div style={{ padding: 12, border: '1px solid #bfdbfe', borderRadius: 9, background: '#eff6ff' }}><div className="hint">Firm ledger ending balance</div><strong style={{ color: Math.abs(trustReconciliationDifference) <= .005 ? '#166534' : '#b91c1c', fontSize: 24 }}>{money(firmLedgerEndingBalance)}</strong></div>
          <div style={{ padding: 12, border: Math.abs(trustReconciliationDifference) <= .005 ? '1px solid #86efac' : '1px solid #fca5a5', borderRadius: 9, background: Math.abs(trustReconciliationDifference) <= .005 ? '#f0fdf4' : '#fff1f2' }}><div className="hint">Reconciliation difference</div><strong style={{ color: Math.abs(trustReconciliationDifference) <= .005 ? '#166534' : '#b91c1c', fontSize: 24 }}>{money(trustReconciliationDifference)}</strong></div>
          <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 9, background: '#f8fafc' }}><div className="hint">Trust ledger events</div><strong style={{ fontSize: 24 }}>{ledgerRows.length}</strong></div>
        </div>
        {Math.abs(trustReconciliationDifference) > .005 && <div style={{ marginBottom: 12, padding: 10, border: '1px solid #fca5a5', borderRadius: 8, background: '#fff1f2', color: '#991b1b' }}><strong>Trust reconciliation warning:</strong> the firm ledger ending balance does not match the sum of the matter trust balances used by Bulk Billing.</div>}`,
        'calculated trust account summary cards'
      )

      return { code, map: null }
    }
  }
}
