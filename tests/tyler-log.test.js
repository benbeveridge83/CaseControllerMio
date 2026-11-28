import test from 'node:test'
import assert from 'node:assert/strict'
import { newTylerCorrelationId, redactTylerValue, createTylerLogger } from '../lib/efiling/tylerLog.js'

test('correlation ids are unique', () => {
  assert.notEqual(newTylerCorrelationId(), newTylerCorrelationId())
})

test('redaction hides private keys, certificates and JWTs', () => {
  assert.equal(redactTylerValue('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'), '[redacted:private-key]')
  assert.equal(redactTylerValue('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'), '[redacted:certificate]')
  assert.equal(redactTylerValue('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def'), '[redacted:jwt]')
  assert.equal(redactTylerValue('a normal message'), 'a normal message')
  assert.equal(redactTylerValue(undefined), undefined)
})

test('logger emits one JSON line per event with secret keys redacted', () => {
  const lines = []
  const log = { log: (s) => lines.push(s), info: (s) => lines.push(s), error: (s) => lines.push(s) }
  const logger = createTylerLogger({ log, correlationId: 'cid-1' })
  logger.info('submit_dry_run', { matterId: 'm1', documentSha256: 'a'.repeat(64), privateKey: 'secret-value' })
  logger.error('callback_rejected', new Error('bad signature'))
  assert.equal(lines.length, 2)
  const first = JSON.parse(lines[0])
  assert.equal(first.level, 'info')
  assert.equal(first.correlationId, 'cid-1')
  assert.equal(first.event, 'submit_dry_run')
  assert.equal(first.matterId, 'm1')
  assert.equal(first.privateKey, '[redacted]')
  const second = JSON.parse(lines[1])
  assert.equal(second.level, 'error')
  assert.equal(second.message, 'bad signature')
})
