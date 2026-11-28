import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupabaseTylerOutcomeRepository, classifyTylerOutcome } from '../lib/efiling/tylerOutcomeRepository.js'
import { TYLER_RECEIPT_KIND } from '../lib/efiling/tylerFilingOutcome.js'

// Minimal chainable fake for the Supabase query builder used by the repository.
function fakeClient(initial = {}) {
  const tables = { ...initial }
  const writes = []
  function build(table, filters = []) {
    const api = {
      select() { return api },
      eq(col, val) { return build(table, [...filters, [col, val]]) },
      order() { return api },
      insert(payload) {
        const inserter = {
          select() { return inserter },
          async single() {
            writes.push({ table, payload })
            return { data: { id: 'uuid-1', ...payload }, error: null }
          },
        }
        return inserter
      },
      then(resolve) {
        const rows = tables[table] || []
        const filtered = rows.filter((r) => filters.every(([c, v]) => r[c] === v))
        resolve({ data: filtered, error: null })
      },
    }
    return api
  }
  return { from: (t) => build(t), writes, tables }
}

const sha = 'a'.repeat(64)

test('records receipts and service results through the Supabase client', async () => {
  const { from, writes } = fakeClient()
  const repo = createSupabaseTylerOutcomeRepository({ from })
  await repo.recordReceipt({ ownerId: 'o1', matterId: 'mA', kind: TYLER_RECEIPT_KIND.clerk_receipt, storagePath: 'mA/receipt.pdf', sha256: sha })
  await repo.recordServiceResult({ ownerId: 'o1', matterId: 'mA', serviceContactId: 'c1', outcome: 'delivered' })
  assert.equal(writes.length, 2)
  assert.equal(writes[0].table, 'mio_efiling_filing_receipts')
  assert.equal(writes[0].payload.matter_id, 'mA')
  assert.equal(writes[1].table, 'mio_efiling_service_results')
  assert.equal(writes[1].payload.outcome, 'delivered')
})

test('a receipt from one matter cannot be read for another matter', async () => {
  const client = fakeClient({
    mio_efiling_filing_receipts: [
      { id: 'r-A', owner_id: 'o1', matter_id: 'mA', kind: 'clerk_receipt', storage_path: 'mA/r.pdf', sha256: sha, received_at: 'now' },
      { id: 'r-B', owner_id: 'o1', matter_id: 'mB', kind: 'fee_receipt', storage_path: 'mB/r.pdf', sha256: sha, received_at: 'now' },
    ],
  })
  const repo = createSupabaseTylerOutcomeRepository(client)
  const forA = await repo.listReceipts('o1', 'mA')
  assert.equal(forA.length, 1)
  assert.equal(forA[0].id, 'r-A')
  const forB = await repo.listReceipts('o1', 'mB')
  assert.equal(forB.length, 1)
  assert.equal(forB[0].id, 'r-B')
})

test('receipt recording rejects unknown kinds and missing digests', async () => {
  const repo = createSupabaseTylerOutcomeRepository(fakeClient())
  await assert.rejects(() => repo.recordReceipt({ ownerId: 'o1', matterId: 'mA', kind: 'bogus', storagePath: 'p', sha256: sha }), /receipt kind/)
  await assert.rejects(() => repo.recordReceipt({ ownerId: 'o1', matterId: 'mA', kind: TYLER_RECEIPT_KIND.fee_receipt, storagePath: 'p', sha256: 'nope' }), /Incomplete filing receipt/)
})

test('classifies an accepted filing with a delivered service result as served', () => {
  const outcome = classifyTylerOutcome({
    submission: { status: 'accepted' },
    receipts: [{ kind: 'clerk_receipt' }],
    serviceResults: [{ outcome: 'delivered' }],
  })
  assert.equal(outcome.state, 'served')
  assert.equal(outcome.receipts.length, 1)
  assert.equal(outcome.serviceResults.length, 1)
  const accepted = classifyTylerOutcome({ submission: { status: 'accepted' } })
  assert.equal(accepted.state, 'accepted')
})
