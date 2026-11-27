// Durable replay guard unit tests. Uses a fake service-role Supabase client so
// no database or network is required.
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTylerReplayKey, createSupabaseTylerReplayGuard } from '../lib/efiling/tylerReplayGuard.js'

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

function fakeClient(responses) {
  const calls = []
  const rpc = async (name, args) => {
    calls.push({ name, args })
    const next = responses.shift()
    if (next instanceof Error) throw next
    if (next?.error) return { data: null, error: next.error }
    return { data: next?.data ?? {}, error: null }
  }
  return { rpc, calls }
}

test('claim returns first-wins claimed=true then duplicate=false', async () => {
  const { rpc, calls } = fakeClient([
    { data: { claimed: true, id: '00000000-0000-0000-0000-000000000001' } },
    { data: { claimed: false, id: null } },
  ])
  const guard = createSupabaseTylerReplayGuard({ rpc })
  const first = await guard.claim({ environment: 'stage', messageId: 'msg-1', payloadSha256: payload, trustedIssuer: 'AA:BB' })
  assert.equal(first.claimed, true)
  assert.equal(first.duplicate, false)
  const second = await guard.claim({ environment: 'stage', messageId: 'msg-1', payloadSha256: payload, trustedIssuer: 'AA:BB' })
  assert.equal(second.claimed, false)
  assert.equal(second.duplicate, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].name, 'mio_claim_efiling_replay_v1')
  assert.equal(calls[0].args.p_environment, 'stage')
  assert.equal(calls[0].args.p_message_id, 'msg-1')
  assert.equal(calls[0].args.p_payload_sha256, payload)
  assert.equal(calls[0].args.p_trusted_issuer, 'AA:BB')
})

test('claim propagates RPC errors and requires a server client', async () => {
  const { rpc } = fakeClient([{ error: { message: 'boom' } }])
  const guard = createSupabaseTylerReplayGuard({ rpc })
  await assert.rejects(() => guard.claim({ environment: 'stage', messageId: 'm', payloadSha256: payload }), /boom/)
  assert.throws(() => createSupabaseTylerReplayGuard({}), /Server-side Supabase client/)
  assert.throws(() => createSupabaseTylerReplayGuard(null), /Server-side Supabase client/)
})
