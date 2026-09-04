// Mio V268 build-time source transform.
// App.jsx is intentionally kept as the single application source file; this plugin
// applies the small V268 trust-account additions without duplicating that 6MB file.
function replaceRequired(code, search, replacement, label) {
  if (!code.includes(search)) throw new Error(`Mio V268 transform could not find ${label}`)
  return code.replace(search, replacement)
}

function insertBeforeRequired(code, marker, insertion, label) {
  if (!code.includes(marker)) throw new Error(`Mio V268 transform could not find ${label}`)
  return code.replace(marker, `${insertion}\n\n${marker}`)
}

export default function mioV268Transform() {
  return {
    name: 'mio-v268-calculated-trust-account',
    enforce: 'pre',
    transform(source, id) {
      if (!id.includes('/src/App.jsx')) return null
      let code = source

      code = replaceRequired(code, "const MIO_APP_VERSION = 'Mio V267'", "const MIO_APP_VERSION = 'Mio V268'", 'V267 version constant')

      code = replaceRequired(
        code,
        "matter_trust_funds: 'Matter trust funds',",
        "matter_trust_funds: 'Matter trust funds',\n      firm_trust_total: 'Calculated trust account — firm total',",
        'snapshot graph metric labels'
      )

      code = replaceRequired(
        code,
        '<option value="matter_trust_funds">Matter trust funds</option>',
        '<option value="firm_trust_total">Calculated trust account — firm total</option>\n              <option value="matter_trust_funds">Matter trust funds</option>',
        'snapshot Y-axis trust option'
      )

      const firmHelpers = `  function calculatedFirmTrustSeries(rows = []) {
    const streams = new Map()
    ;(Array.isArray(rows) ? rows : []).forEach((row) => {
      const matterKey = financialGraphRowMatterKey(row)
      if (!matterKey) return
      const linkedMatter = financialGraphRowMatter(row)
      const point = snapshotGraphPointFromRow(row, 'matter_trust_funds', linkedMatter)
      if (!point?.date || !Number.isFinite(financialGraphTimestampMs(point.date))) return
      if (!streams.has(matterKey)) streams.set(matterKey, { matterKey, linkedMatter, points: [] })
      streams.get(matterKey).points.push(point)
    })
    const streamList = Array.from(streams.values()).map((stream) => ({
      ...stream,
      points: stream.points.slice().sort((a, b) => financialGraphTimestampMs(a.date) - financialGraphTimestampMs(b.date))
    })).filter((stream) => stream.points.length)
    const timestamps = Array.from(new Set(streamList.flatMap((stream) => stream.points.map((point) => financialGraphTimestampMs(point.date))).filter(Number.isFinite))).sort((a, b) => a - b)
    const points = timestamps.map((timestamp) => {
      let total = 0
      const graphEvents = []
      streamList.forEach((stream) => {
        let currentPoint = null
        stream.points.forEach((point) => {
          if (financialGraphTimestampMs(point.date) <= timestamp) currentPoint = point
        })
        if (currentPoint) total += financeNumber(currentPoint.balance)
        stream.points.filter((point) => financialGraphTimestampMs(point.date) === timestamp).forEach((point) => {
          if (!point.graph_event_label || ['baseline', 'range_end', 'current_balance'].includes(String(point.graph_event_kind || ''))) return
          graphEvents.push({
            label: point.graph_event_label,
            source: point.graph_event_source,
            direction: point.graph_event_direction,
            amount: financeNumber(point.graph_event_amount),
            reference: point.graph_event_reference,
            kind: point.graph_event_kind,
            matter_id: point.graph_event_matter_id,
            matter_name: point.graph_event_matter_name,
            date: point.date
          })
        })
      })
      const singleEvent = graphEvents.length === 1 ? graphEvents[0] : null
      return {
        date: new Date(timestamp).toISOString(),
        balance: Number(total.toFixed(2)),
        graph_events: graphEvents,
        graph_event_label: singleEvent?.label || (graphEvents.length > 1 ? String(graphEvents.length) + ' trust ledger changes' : ''),
        graph_event_source: singleEvent?.source || '',
        graph_event_direction: singleEvent?.direction || '',
        graph_event_amount: singleEvent?.amount || 0,
        graph_event_reference: singleEvent?.reference || '',
        graph_event_kind: singleEvent?.kind || (graphEvents.length > 1 ? 'multiple_events' : '')
      }
    })
    return [{
      matter_id: 'firm-calculated-trust',
      display_number: 'Calculated trust account — firm total',
      mio_matter_ids: streamList.map((stream) => String(stream.linkedMatter?.id || '')).filter(Boolean),
      matter_names: streamList.map((stream) => stream.linkedMatter ? formatMatterOption(stream.linkedMatter) : '').filter(Boolean),
      points
    }]
  }

  function calculatedFirmTrustAccountRows() {
    const rawRows = mioTrustLedgerFinancialGraphRows()
    const series = calculatedFirmTrustSeries(rawRows)[0]
    if (!series) return []
    const rows = []
    ;(series.points || []).forEach((point) => {
      ;(point.graph_events || []).forEach((event, eventIndex) => rows.push({
        id: 'firm-trust-' + point.date + '-' + eventIndex + '-' + (event.matter_id || ''),
        date: event.date || point.date,
        matter_id: event.matter_id || '',
        matter_name: event.matter_name || '',
        source: event.source || '',
        label: event.label || '',
        direction: event.direction || '',
        amount: financeNumber(event.amount),
        reference: event.reference || '',
        balance: financeNumber(point.balance)
      }))
    })
    return rows.sort((a, b) => financialGraphTimestampMs(a.date) - financialGraphTimestampMs(b.date) || String(a.id).localeCompare(String(b.id)))
  }

  function renderCalculatedFirmTrustAccountPanel() {
    const ledgerRows = calculatedFirmTrustAccountRows()
    const currentCalculatedTrust = matters.reduce((sum, matter) => sum + financeNumber(financialsForMatter(matter)?.trust), 0)
    const lastLedgerBalance = ledgerRows.length ? financeNumber(ledgerRows[ledgerRows.length - 1].balance) : currentCalculatedTrust
    return (
      <div style={{ border: '1px solid #d7e0ea', borderRadius: 12, padding: 16, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Calculated trust account — firmwide</h2>
            <div className="hint">One account made from the same trust ledgers shown on every matter's Accounting tab. This is Mio's calculated book balance, not the bank balance.</div>
          </div>
          <button type="button" onClick={() => { syncLawPayTransactions(); loadMioInvoicesFromDatabase(); loadMioInvoiceEventsFromDatabase() }} disabled={lawPayBusy}>{lawPayBusy ? 'Refreshing…' : 'Refresh accounting'}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 12, marginBottom: 14 }}>
          <div style={{ padding: 12, border: '1px solid #86efac', borderRadius: 9, background: '#f0fdf4' }}><div className="hint">Current calculated trust balance</div><strong style={{ color: '#166534', fontSize: 24 }}>{money(currentCalculatedTrust)}</strong></div>
          <div style={{ padding: 12, border: '1px solid #bfdbfe', borderRadius: 9, background: '#eff6ff' }}><div className="hint">Latest ledger-calculated balance</div><strong style={{ color: '#1d4ed8', fontSize: 24 }}>{money(lastLedgerBalance)}</strong></div>
          <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 9, background: '#f8fafc' }}><div className="hint">Trust ledger events</div><strong style={{ fontSize: 24 }}>{ledgerRows.length}</strong></div>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: '62vh', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 9 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}><tr>
              {['Date','Matter','Source','Transaction / details','Invoice / reference','Funds out','Funds in','Calculated trust balance'].map((label) => <th key={label} style={{ textAlign: label.startsWith('Funds') || label.includes('balance') ? 'right' : 'left', padding: '8px 9px', borderBottom: '1px solid #cbd5e1', whiteSpace: 'nowrap' }}>{label}</th>)}
            </tr></thead>
            <tbody>{ledgerRows.map((row) => {
              const fundsOut = row.direction === 'out' ? row.amount : 0
              const fundsIn = row.direction === 'in' ? row.amount : 0
              return <tr key={row.id}>
                <td style={{ padding: '7px 9px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>{new Date(row.date).toLocaleDateString()}</td>
                <td style={{ padding: '7px 9px', borderBottom: '1px solid #f1f5f9' }}>{row.matter_name || row.matter_id || 'Matter'}</td>
                <td style={{ padding: '7px 9px', borderBottom: '1px solid #f1f5f9' }}>{row.source || 'Mio accounting'}</td>
                <td style={{ padding: '7px 9px', borderBottom: '1px solid #f1f5f9' }}>{row.label}</td>
                <td style={{ padding: '7px 9px', borderBottom: '1px solid #f1f5f9' }}>{row.reference || '—'}</td>
                <td style={{ padding: '7px 9px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: fundsOut ? '#b91c1c' : undefined, fontWeight: fundsOut ? 700 : 400 }}>{fundsOut ? money(fundsOut) : '—'}</td>
                <td style={{ padding: '7px 9px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: fundsIn ? '#166534' : undefined, fontWeight: fundsIn ? 700 : 400 }}>{fundsIn ? money(fundsIn) : '—'}</td>
                <td style={{ padding: '7px 9px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700 }}>{money(row.balance)}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </div>
    )
  }`

      code = insertBeforeRequired(code, '  function renderClioSnapshotGraphPanel() {', firmHelpers, 'snapshot graph panel function')

      code = replaceRequired(
        code,
        "    const graphRows = filteredSnapshotRowsForGraph(snapshotGraphMetric)\n    const options = snapshotGraphMatterOptions(snapshotGraphMetric, graphRows)\n    const selectedSet = new Set(snapshotGraphSelectedMatterNumbers.map(String))\n    const series = snapshotGraphSeries(graphRows, options)",
        "    const firmTrustMode = snapshotGraphMetric === 'firm_trust_total'\n    const graphRows = filteredSnapshotRowsForGraph(firmTrustMode ? 'matter_trust_funds' : snapshotGraphMetric)\n    const options = snapshotGraphMatterOptions(firmTrustMode ? 'matter_trust_funds' : snapshotGraphMetric, graphRows)\n    const selectedSet = new Set(snapshotGraphSelectedMatterNumbers.map(String))\n    const series = firmTrustMode ? calculatedFirmTrustSeries(graphRows) : snapshotGraphSeries(graphRows, options)",
        'snapshot graph panel row/series setup'
      )

      code = replaceRequired(
        code,
        "{graphRows.length} {snapshotGraphMetric === 'matter_trust_funds' ? 'accounting-ledger step point' : 'graph point'} row(s) loaded through",
        "{graphRows.length} {['matter_trust_funds','firm_trust_total'].includes(snapshotGraphMetric) ? 'accounting-ledger step point' : 'graph point'} row(s) loaded through",
        'snapshot graph step-row label'
      )

      code = replaceRequired(
        code,
        "{renderClioGraph(series, { invoiceMarkers, extendToToday: graphExtendsToToday, step: snapshotGraphMetric === 'matter_trust_funds', onSeriesHide:",
        "{renderClioGraph(series, { invoiceMarkers: firmTrustMode ? [] : invoiceMarkers, extendToToday: graphExtendsToToday, step: ['matter_trust_funds','firm_trust_total'].includes(snapshotGraphMetric), onSeriesHide:",
        'snapshot graph renderer step mode'
      )

      code = replaceRequired(
        code,
        "          <button type=\"button\" style={tabButtonStyle('snapshot_graphs')} onClick={() => setBillingTab('snapshot_graphs')}>\n            Mio Snapshot Graphs\n          </button>",
        "          <button type=\"button\" style={tabButtonStyle('snapshot_graphs')} onClick={() => setBillingTab('snapshot_graphs')}>\n            Mio Snapshot Graphs\n          </button>\n          <button type=\"button\" style={tabButtonStyle('calculated_trust')} onClick={() => setBillingTab('calculated_trust')}>\n            Calculated Trust Account\n          </button>",
        'billing snapshot graph tab button'
      )

      code = replaceRequired(
        code,
        "        ) : billingTab === 'snapshot_graphs' ? (\n          renderClioSnapshotGraphPanel()\n        ) : billingTab === 'client_bar_graph' ? (",
        "        ) : billingTab === 'snapshot_graphs' ? (\n          renderClioSnapshotGraphPanel()\n        ) : billingTab === 'calculated_trust' ? (\n          renderCalculatedFirmTrustAccountPanel()\n        ) : billingTab === 'client_bar_graph' ? (",
        'billing tab content switch'
      )

      code = code.replace(
        "billing: ['Firm Billing', 'Clio Billing Integration', 'Client Billing Fields', 'Financial Snapshots', 'Mio Snapshot Graphs', 'Client Bar Graph', 'Client Invoicing', 'Bulk Billing', 'Clio Historical Import']",
        "billing: ['Firm Billing', 'Clio Billing Integration', 'Client Billing Fields', 'Financial Snapshots', 'Mio Snapshot Graphs', 'Calculated Trust Account', 'Client Bar Graph', 'Client Invoicing', 'Bulk Billing', 'Clio Historical Import']"
      )

      return { code, map: null }
    }
  }
}
