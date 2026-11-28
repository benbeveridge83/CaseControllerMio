// Server-only Tyler e-filing submit service (Phase B plumbing).
//
// This is the server-side boundary between a logged-in Mio actor and any Tyler
// transport. It validates a filing intent, requires explicit matter
// authorization, resolves the selected document from a server-side record
// scoped to that matter (obtaining the storage path and expected digest from
// that record — never from the caller), and verifies the bytes server-side.
//
// The `coordinator` and `enabled` inputs are a GATED HOOK: the HTTP submit
// path (tylerSubmitApi.js) does not supply a coordinator, so the submit is
// always a Stage-disabled dry run (no outbox write, no network call) until a
// certified Tyler transport is wired in and the server-owned flag is enabled.
// When supplied, the submit delegates to the outbound coordinator, which drives
// the durable outbox (reserve-once) and the transport.
import { prepareTylerFilingIntent } from './tylerOutboundPipeline.js'

export function createTylerSubmitService({
  authorizeMatter,
  resolveDocument,
  retrieveDocument,
  coordinator = null,
  enabled = false,
} = {}) {
  if (typeof authorizeMatter !== 'function') throw new Error('A matter authorization function is required.')
  if (typeof resolveDocument !== 'function') throw new Error('A document resolution function is required.')
  if (typeof retrieveDocument !== 'function') throw new Error('A document retrieval function is required.')

  return {
    async submit({ draft, ownerId, environment = 'stage', idempotencyKey } = {}) {
      // Never trust a client-supplied ownerId; the caller derives it from the
      // verified session. prepareTylerFilingIntent validates the rest.
      const intent = prepareTylerFilingIntent({ draft, ownerId, environment, idempotencyKey })
      await authorizeMatter({ ownerId: intent.ownerId, matterId: intent.matterId })
      // The storage path and expected digest come from the server-side record
      // scoped to the authorized matter — never from the caller's payload.
      const record = await resolveDocument({ documentId: intent.documentId, matterId: intent.matterId })
      if (!record || typeof record.path !== 'string' || !record.path)
        throw new Error('The document record has no storage path.')
      const document = await retrieveDocument({
        path: record.path,
        expectedSha256: record.sha256,
        expectedByteLength: record.byteLength,
      })

      // Real sending is gated by a server-owned flag AND a certified coordinator.
      // Until both are present the submit is a dry run: the document is verified,
      // but no outbox reservation or network call happens.
      const sendEnabled = enabled === true && coordinator && typeof coordinator.submit === 'function'
      if (!sendEnabled) {
        return Object.freeze({
          dryRun: true,
          sent: false,
          networkCallMade: false,
          transportReady: false,
          tylerStageApproved: false,
          intent: Object.freeze({ ...intent }),
          document: Object.freeze({ sha256: document.sha256, byteLength: document.byteLength }),
        })
      }

      // An enabled send must verify the retrieved bytes against the server
      // record's expected digest, so require it before delegating.
      if (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) {
        throw new Error('The document record requires an expected SHA-256 digest before sending.')
      }

      const receipt = await coordinator.submit({ draft, ownerId, environment, idempotencyKey })
      return Object.freeze({
        dryRun: false,
        sent: true,
        networkCallMade: true,
        transportReady: true,
        tylerStageApproved: false,
        intent: Object.freeze({ ...intent }),
        document: Object.freeze({ sha256: document.sha256, byteLength: document.byteLength }),
        ...receipt,
      })
    },
  }
}
