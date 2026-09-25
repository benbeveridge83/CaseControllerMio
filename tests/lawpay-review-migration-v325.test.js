// V325 changes one validation rule only: choosing a PNC workflow is optional for a consultation.
// The database must continue to enforce every financial guard in the V323 posting function.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync(new URL('../supabase/migrations/20260925150000_lawpay_review_queue_v325.sql', import.meta.url), 'utf8')
const body = sql.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n')

test('PNC association is optional while matter ownership still requires a matter', () => {
  assert.match(body, /create or replace function public\.mio_post_lawpay_classification_v323/)
  assert.doesNotMatch(body, /v_ownership = 'pnc' and v_pnc = ''/)
  assert.match(body, /v_ownership = 'matter' and v_matter = ''/)
  assert.match(body, /v_ownership = 'other_unresolved' and v_other = ''/)
})

test('all existing posting safety boundaries remain in the replacement function', () => {
  assert.match(body, /pg_advisory_xact_lock/)
  assert.match(body, /posting_status in \('posted','matched'\)/)
  assert.match(body, /upper\(coalesce\(tx\.status,''\)\) not in \('COMPLETED'/)
  assert.match(body, /A trust deposit cannot be recorded against the operating account/)
  assert.match(body, /An operating payment cannot be recorded against the trust account/)
  assert.match(body, /public\.mio_lawpay_write_posting_v323/)
})

test('the changed RPC remains service-role only with a pinned search path', () => {
  assert.match(body, /security definer set search_path = public, pg_temp/)
  assert.match(body, /revoke all on function public\.mio_post_lawpay_classification_v323\(jsonb,text\) from public, anon, authenticated;/)
  assert.match(body, /grant execute on function public\.mio_post_lawpay_classification_v323\(jsonb,text\) to service_role;/)
})
