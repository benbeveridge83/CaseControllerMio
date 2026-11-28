// Server-only Tyler e-filing submit service (Phase B plumbing).
//
// This is the server-side boundary between a logged-in Mio actor and any Tyler
// transport. It validates a filing intent, requires explicit matter
// authorization, resolves the selected document from a server-side record
// scoped to that matter (obtaining the storage path and expected digest from
// that record — never from the caller), and verifies the bytes server-side.
//
// When a certified Tyler transport is present (coordinator + enabled), the
// submit delegates to the outbound coordinator, which drives the durable
// outbox (reserve-once) and the transport. Until then — the default — it is a
// Stage-disabled dry run with no outbox write and no network call.
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
      if (enabled !== true || !coordinator || typeof coordinator.submit !== 'function') {
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
