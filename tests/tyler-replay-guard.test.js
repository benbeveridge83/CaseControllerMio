// Replay key unit tests. computeTylerReplayKey is a pure derived key for logs and
// correlation; the authoritative replay/deduplication is the atomic
// mio_record_efiling_callback_v1 receipt recorder (no separate claim step).
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTylerReplayKey } from '../lib/efiling/tylerReplayGuard.js'

const payload = 'a'.repeat(64)

test('computeTylerReplayKey is deterministic and validates inputs', () => {
  const a = computeTylerReplayKey({ environment: 'stage', messageId: 'msg-1', payloadSha256: payload })
  const b = computeTylerReplayKey({ environment: 'stage', messageId: 'msg-1', payloadSha256: payload })
  assert.equal(a, b)
  assert.match(a, /^[a-f0-9]{64}$/)
  assert.notEqual(a, computeTylerReplayKey({ environment: 'production', messageId: 'msg-1', payloadSha256: payload }))
  assert.notEqual(a, computeTylerReplayKey({ environment: 'stage', messageId: 'msg-2', payloadSha256: payload }))
  assert.throws(() => computeTylerReplayKey({ environment: 'dev', messageId: 'msg-1', payloadSha256: payload }), /environment/)
  assert.throws(() => computeTylerReplayKey({ environment: 'stage', messageId: '', payloadSha256: payload }), /message ID/)
  assert.throws(() => computeTylerReplayKey({ environment: 'stage', messageId: 'msg-1', payloadSha256: 'nothex' }), /SHA-256/)
})
