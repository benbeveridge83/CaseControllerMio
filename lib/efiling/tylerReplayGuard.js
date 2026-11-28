// Tyler ECF5 callback replay key (SERVER ONLY).
//
// The authoritative replay/deduplication boundary is the atomic receipt recorder
// (mio_record_efiling_callback_v1), which enforces unique (environment, message_id)
// and payload-SHA-256 conflict detection inside the SAME transaction that updates
// filing status. A crash between verification and recording therefore can never
// lose a valid event: a retried delivery is recorded as an idempotent duplicate,
// and a tampered one fails verification or the payload conflict check.
//
// computeTylerReplayKey derives the (environment, messageId, payloadSha256) key as
// a stable SHA-256 for logs and correlation. It is NOT a separate claim step, so it
// cannot create a crash window between "replay claimed" and "status recorded".
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
