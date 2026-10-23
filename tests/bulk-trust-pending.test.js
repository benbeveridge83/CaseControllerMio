import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import * as financeModel from '../src/mioFinanceReview.js'

const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
function appFunction(name) {
  const match = new RegExp('  (?:async )?function ' + name + '\\(').exec(source)
  assert.ok(match, `Missing app function ${name}`)
  const next = /\n  (?:async )?function /.exec(source.slice(match.index + match[0].length))
  return source.slice(match.index, next ? match.index + match[0].length + next.index : undefined)
}
const now = Date.parse('2026-10-23T18:00:00Z')
class Clock extends Date { static now() { return now } }
function pendingContext(transactions) {
  const ctx = { ...financeModel, Date: Clock, lawPayTransactions: transactions, financeNumber: Number,
    lawPayTransactionsForMatter: matter => transactions.filter(t => t.raw.mio_matter_id === matter.id),
    lawPayRequestForTransaction: () => null,
    lawPayTransactionInvoiceNumber: t => t.raw.mio_invoice_number,
    lawPayTransactionMatterId: t => t.raw.mio_matter_id }
  vm.createContext(ctx)
  for (const name of ['pendingLawPayPaymentsForMatter', 'pendingLawPayPaymentsForInvoice', 'pendingLawPayAmountForMatter']) vm.runInContext(appFunction(name), ctx)
  return ctx
}
function payment(id, status, raw = {}) {
  return { id, status, transaction_type: 'CHARGE', amount_cents: 500000,
    raw: { mio_matter_id: 'new-matter', mio_invoice_number: 'MIO-2026-TEST', ...raw } }
}
const expired = payment('checkout', 'PENDING', { method: { type: 'loan' }, action: { type: 'affirm', checkout_expiry: Date.parse('2026-10-12T15:34:19Z') } })

test('expired Affirm checkout does not remain pending beside a completed card payment', () => {
  const rows = [expired, payment('card', 'COMPLETED')]
  const original = JSON.stringify(rows)
  const ctx = pendingContext(rows)
  assert.equal(ctx.pendingLawPayAmountForMatter({ id: 'new-matter' }), 0)
  assert.equal(ctx.pendingLawPayPaymentsForInvoice({ invoice_number: 'MIO-2026-TEST', matter_id: 'new-matter' }).length, 0)
  assert.equal(JSON.stringify(rows), original, 'Filtering must not rewrite provider statuses or receipts')
})
test('genuine pending payments stay visible even when the same invoice also has a completed payment', () => {
  const rows = [payment('pending-card', 'PENDING'), payment('authorized', 'AUTHORIZED', expired.raw),
    payment('processing', 'PROCESSING', expired.raw), payment('card', 'COMPLETED')]
  const ctx = pendingContext(rows)
  assert.equal(ctx.pendingLawPayAmountForMatter({ id: 'new-matter' }), 15000)
})
test('unexpired, unknown-expiry, and authorized checkouts are not silently discarded', () => {
  const rows = [payment('future', 'PENDING', { method: { type: 'loan' }, action: { type: 'affirm', checkout_expiry: now + 60000 } }),
    payment('unknown', 'PENDING', { method: { type: 'loan' }, action: { type: 'affirm', checkout_expiry: 'invalid' } }),
    payment('authorized-timestamp', 'PENDING', { ...expired.raw, authorization_timestamp: '2026-10-12T15:10:00Z' })]
  const ctx = pendingContext(rows)
  assert.equal(ctx.pendingLawPayAmountForMatter({ id: 'new-matter' }), 15000)
})

function bulkContext(confirm = true) {
  const confirmed = [], saved = [], alerts = []
  const amounts = { a: [5000, 2555.83], b: [5000, 1006], c: [1350, 975], empty: [0, 400] }
  const ctx = { Date, crypto, financeNumber: Number, money: n => '$' + n.toFixed(2),
    matters: Object.keys(amounts).map(id => ({ id, client_id: id })),
    latestTrustSnapshotForMatter: () => null,
    clientFinanceNumbers: m => ({ trust: amounts[m.id][0], outstanding: amounts[m.id][1], snapshotOutstanding: 0, currentLedgerRows: [],
      serviceInvoices: [{ id: 'invoice-' + m.id, status: 'outstanding', total: amounts[m.id][1], balance: amounts[m.id][1], amount_paid: 0, issue_date: '2026-10-23' }] }),
    activeSnapshotOutstandingPayments: () => [], invoiceBalanceAmount: i => i.balance, invoicePaidAmount: i => i.amount_paid,
    lawFirmProfile: {}, alert: msg => alerts.push(msg), window: { confirm: msg => { confirmed.push(msg); return confirm } },
    setBulkBillingBusy() {}, setBulkBillingResult() {},
    persistOutstandingTrustPaymentPlans: async plans => { saved.push(...plans); return { paid: plans.reduce((s,p) => s + p.paid, 0) } } }
  vm.createContext(ctx)
  for (const name of ['planMatterOutstandingFromTrust', 'paySelectedOutstandingFromTrust']) vm.runInContext(appFunction(name), ctx)
  return { ctx, confirmed, saved, alerts }
}
test('bulk trust payment includes selected funded matters without imported opening records', async () => {
  const { ctx, confirmed, saved, alerts } = bulkContext()
  await ctx.paySelectedOutstandingFromTrust(['a', 'b', 'c', 'empty', 'missing', 'a'])
  assert.equal(alerts.length, 0)
  assert.match(confirmed[0], /4536\.83/)
  assert.equal(saved.length, 3, 'Selected IDs must not produce duplicate payment plans')
  assert.deepEqual(Array.from(saved, p => [p.matter.id, p.paid]), [['a', 2555.83], ['b', 1006], ['c', 975]])
  assert.equal(saved.flatMap(p => p.transactions).length, 3)
})
test('canceling the bulk confirmation writes no payments', async () => {
  const { ctx, saved, confirmed } = bulkContext(false)
  await ctx.paySelectedOutstandingFromTrust(['a'])
  assert.equal(confirmed.length, 1)
  assert.equal(saved.length, 0)
})
test('an unfunded selection still cannot create a trust payment', async () => {
  const { ctx, saved, confirmed, alerts } = bulkContext()
  await ctx.paySelectedOutstandingFromTrust(['empty'])
  assert.equal(saved.length, 0)
  assert.equal(confirmed.length, 0)
  assert.equal(alerts.length, 1)
})
