// Server-only Tyler e-filing submit service (Phase B plumbing).
//
// This is the server-side boundary between a logged-in Mio actor and any Tyler
// transport. It validates a filing intent, requires explicit matter
// authorization, and verifies the selected document server-side. There is NO
// network sender here and NO durable outbox write: this is a Stage-disabled
// dry run that proves the plumbing without a live send.
//
// When a real Tyler transport is certified, the caller composes this service
// with the existing outbound coordinator (createTylerOutboundCoordinator) and
// durable outbox (createSupabaseTylerOutbox); until then `sent` stays false and
// `transportReady` stays false.
import { prepareTylerFilingIntent } from './tylerOutboundPipeline.js'

export function createTylerSubmitService({ authorizeMatter, retrieveDocument } = {}) {
  if (typeof authorizeMatter !== 'function') throw new Error('A matter authorization function is required.')
  if (typeof retrieveDocument !== 'function') throw new Error('A document retrieval function is required.')

  return {
    async submit({ draft, ownerId, environment = 'stage', idempotencyKey, documentReference } = {}) {
      // Never trust a client-supplied ownerId; the caller derives it from the
      // verified session. prepareTylerFilingIntent validates the rest.
      const intent = prepareTylerFilingIntent({ draft, ownerId, environment, idempotencyKey })
      await authorizeMatter({ ownerId: intent.ownerId, matterId: intent.matterId })
      const document = await retrieveDocument(documentReference)
      return Object.freeze({
        dryRun: true,
        sent: false,
        networkCallMade: false,
        transportReady: false,
        tylerStageApproved: false,
        intent: Object.freeze({ ...intent }),
        document: Object.freeze({ sha256: document.sha256, byteLength: document.byteLength }),
      })
    },
  }
}
