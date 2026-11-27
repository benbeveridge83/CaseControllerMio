// Durable Tyler ECF5 callback replay detection (SERVER ONLY).
//
// Replay is a database-backed, atomic claim over (environment, signed message ID,
// payload SHA-256). The first claim wins; every later delivery of the same signed
// message is recognised as a duplicate rather than a new filing event. Call this
// ONLY after XMLDSIG verification has succeeded and the signer has been confirmed
// against the pinned trusted certificate; never treat a claim as evidence of
// authenticity by itself.
import { createHash } from 'node:crypto'

const ENVIRONMENTS = new Set(['stage', 'production'])

export function computeTylerReplayKey({ environment, messageId, payloadSha256 }) {
  if (!ENVIRONMENTS.has(environment)) throw new Error('A valid Tyler environment is required.')
  if (typeof messageId !== 'string' || !messageId.trim() || messageId.length > 256)
    throw new Error('A valid signed message ID is required.')
  if (typeof payloadSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payloadSha256))
    throw new Error('A valid payload SHA-256 digest is required.')
  return createHash('sha256').update([environment, messageId, payloadSha256].join('\n')).digest('hex')
}

export function createSupabaseTylerReplayGuard(serviceClient) {
  if (!serviceClient?.rpc) throw new Error('Server-side Supabase client required.')
  return {
    async claim({ environment, messageId, payloadSha256, trustedIssuer }) {
      const replayKey = computeTylerReplayKey({ environment, messageId, payloadSha256 })
      const { data, error } = await serviceClient.rpc('mio_claim_efiling_replay_v1', {
        p_environment: environment,
        p_message_id: messageId,
        p_payload_sha256: payloadSha256,
        p_trusted_issuer: typeof trustedIssuer === 'string' && trustedIssuer ? trustedIssuer : null,
      })
      if (error) throw new Error(error.message || 'Tyler replay claim failed.')
      return Object.freeze({
        replayKey,
        claimed: data?.claimed === true,
        duplicate: data?.claimed === false,
        id: data?.id || null,
      })
    },
  }
}
