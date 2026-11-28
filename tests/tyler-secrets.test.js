import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTylerSecrets, createTylerCertificateAllowlist } from '../lib/efiling/tylerSecrets.js'

test('loadTylerSecrets returns booleans and never exposes secret values', () => {
  const r = loadTylerSecrets({
    TYLER_EFM_STAGE_SIGNING_CERT: 'secret-cert',
    SUPABASE_SERVICE_ROLE_KEY: 'secret-key',
    SUPABASE_URL: 'https://db.supabase.co',
  })
  assert.equal(r.signingCertificateConfigured, true)
  assert.equal(r.supabaseServiceRoleConfigured, true)
  assert.equal(Object.hasOwn(r, 'signingCertificate'), false)
  assert.equal(Object.hasOwn(r, 'serviceRoleKey'), false)
  const empty = loadTylerSecrets({})
  assert.equal(empty.signingCertificateConfigured, false)
  assert.equal(empty.supabaseServiceRoleConfigured, false)
})

test('certificate allowlist supports key rotation and rejects malformed fingerprints', () => {
  const old = 'a'.repeat(64)
  const next = 'b'.repeat(64)
  const allow = createTylerCertificateAllowlist([old, next])
  assert.equal(allow.size, 2)
  assert.equal(allow.has(old), true)
  assert.equal(allow.has(next), true)
  assert.equal(allow.has('c'.repeat(64)), false)
  assert.throws(() => createTylerCertificateAllowlist(['not-a-fingerprint']), /fingerprint/)
})
