import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupabaseEfilingRepository } from '../src/efiling/mioEfilingRepository.js'

function errorClient(code, message) {
  return {
    from: () => {
      const api = {
        select() { return api },
        eq() { return api },
        order() { return api },
        limit() { return api },
        then(resolve) { resolve({ data: null, error: { code, message } }) },
      }
      return api
    },
  }
}

test('browser repository returns empty for PGRST205 on the two outcome tables', async () => {
  const repo = createSupabaseEfilingRepository(errorClient('PGRST205', 'Could not find the table \'public.mio_efiling_filing_receipts\' in the schema cache'))
  assert.deepEqual(await repo.listReceipts('o1', 'mA'), [])
  assert.deepEqual(await repo.listServiceResults('o1', 'mA'), [])
})

test('browser repository surfaces other database errors', async () => {
  const repo = createSupabaseEfilingRepository(errorClient('42501', 'permission denied for table mio_efiling_filing_receipts'))
  await assert.rejects(() => repo.listReceipts('o1', 'mA'), /permission denied/)
  await assert.rejects(() => repo.listServiceResults('o1', 'mA'), /permission denied/)
})
