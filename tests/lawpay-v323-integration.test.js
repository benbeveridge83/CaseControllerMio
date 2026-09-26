// V327 regression guard: the Bulk Billing "LawPay reconciliation" list must stop counting or
// showing a transaction as "unlinked" once it has been recorded through the classification
// review or a legacy trust/attribution decision. This applies the compose-time transforms through
// V323 and inspects the resulting `renderFinanceSyncStatus`.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import config from '../vite.config.js'

let source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
for (const plugin of config.plugins.flat(Infinity)) {
  if (plugin.name === 'vite:react-babel' || plugin.name === 'vite:react-oxc') break
  const handler = typeof plugin.transform === 'function' ? plugin.transform : plugin.transform?.handler
  if (handler) {
    const result = await handler.call({}, source, '/repo/src/App.jsx')
    source = typeof result === 'string' ? result : result?.code || source
  }
  if (plugin.name === 'mio-v323-lawpay-classification') break
}
function fn(name) {
  const match = new RegExp('  (?:async )?function ' + name + '\\(').exec(source)
  assert.ok(match, `missing ${name}`)
  const next = /\n {2}(?:async )?function /.exec(source.slice(match.index + match[0].length))
  return source.slice(match.index, next ? match.index + match[0].length + next.index : undefined)
}

test('the reconciliation drops recorded transactions from the unlinked list and its count', () => {
  const reconciliation = fn('renderFinanceSyncStatus')
  assert.match(source, /recordedProviderIds/, 'the recorded-id helper is imported')
  assert.match(reconciliation, /recordedProviderIds\(\{classifications:lawPayV323Review\.classifications/)
  assert.match(reconciliation, /ledgerEntries:lawPayV323Review\.ledger_entries/)
  assert.match(reconciliation, /trustTransactions:mioTrustTransactions/)
  assert.match(reconciliation, /attributions:lawPayAttribution/)
  assert.match(reconciliation, /legacyRecordedTransactionIds:lawPayV323Review\.legacy_recorded_transaction_ids/)
  assert.match(reconciliation, /legacyAttributedTransactionIds:lawPayV323Review\.legacy_attributed_transaction_ids/)
  assert.match(reconciliation, /audit\.unlinked=audit\.unlinked\.filter\(issue=>!recordedIds\.has\(String\(issue\.id\)\)\)/)
  assert.match(reconciliation, /auditLawPayRecords\([^\n]+mioInvoiceEvents,lawPayPaymentRequests\)/, 'the audit receives payment requests so consultation references are not treated as invoices')
  assert.ok(reconciliation.indexOf('audit.unlinked=audit.unlinked.filter') < reconciliation.indexOf('lawPayReconciliationMessage'), 'the visible scan message must use the filtered unlinked count')
  // The legacy "Categorize this payment" path still exists for genuinely-unrecorded transactions.
  assert.match(reconciliation, /Categorize this payment/)
})
