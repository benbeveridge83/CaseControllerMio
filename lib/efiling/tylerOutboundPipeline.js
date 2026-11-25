// Tyler EFM outbound submission orchestration.
// Does not implement Tyler SOAP, WS-Security, TOGA, or network calls.
// Unlike the mock provider, this service requires an explicit, server-owned
// Stage transport AND a durable correlation recorder. It defaults closed.
//
// An external filing may succeed while our database is unavailable. NEVER
// automatically replay such a submission. The caller must reconcile by the
// same request ID with Tyler before a retry or prompt the operator.
import { createHash } from 'node:crypto'

const targets = new Set(['stage', 'production'])
const modes = new Set(['efile_only','efile_and_serve','eserve_only'])
const text = value => typeof value === 'string' ? value.trim() : ''
function required(value, label, max = 256) {
  const v = text(value)
  if (!v || v.length > max) throw new Error(label + ' is required.')
  return v
}
function validateContacts(items) {
  if (!Array.isArray(items)) throw new Error('Service contacts must be a list.')
  const selected = items.filter(x => x && x.selected !== false)
  for (const c of selected) {
    required(c.name, 'Recipient name')
    const address = required(c.email, 'Recipient email')
    required(c.tylerServiceContactId || c.serviceContactId, 'Tyler service contact ID')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Invalid recipient email.')
  }
  return selected.map(c => ({ id: text(c.id), serviceContactId: text(c.tylerServiceContactId || c.serviceContactId), name: text(c.name), email: text(c.email).toLowerCase() }))
}

export function prepareTylerFilingIntent({draft, ownerId, environment, idempotencyKey}) {
  if (!targets.has(environment)) throw new Error('Valid Tyler environment required.')
  if (!draft || typeof draft !== 'object') throw new Error('Filing draft is required.')
  const filingMode = required(draft.filingMode, 'Filing mode')
  if (!modes.has(filingMode)) throw new Error('Unsupported filing mode.')
  // ECF5 ReviewFiling uses Tyler's selected ServiceContactID, not merely
  // an email address. Never guess a contact ID from Mio's party records.
  const contacts = filingMode === 'efile_only' ? [] : validateContacts(draft.serviceContacts || [])
  if (filingMode !== 'efile_only' && !contacts.length)
    throw new Error('Electronic service requires a selected recipient.')
  const intent = {
    environment,
    ownerId: required(ownerId, 'Owner ID'),
    matterId: required(draft.matterId, 'Matter ID'),
    draftId: text(draft.id),
    idempotencyKey: required(idempotencyKey, 'Idempotency key'),
    courtLocationId: required(draft.courtLocationId, 'Court location ID'),
    causeNumber: required(draft.causeNumber, 'Cause number'),
    filingCode: required(draft.filingCode, 'Filing code'),
    filingMode,
    documentId: required(draft.documentId, 'Document ID'),
    selectedRecipients: contacts,
    paymentAccountId: required(draft.paymentAccountId, 'Payment account ID'),
  }
  // No document bytes, privileged secret, credit-card number or signer key.
  const canonical = JSON.stringify(intent)
  return Object.freeze({...intent, fingerprint: createHash('sha256').update(canonical).digest('hex')})
}

export function validateTylerReviewReceipt(receipt, environment) {
  if (!receipt || typeof receipt !== 'object') throw new Error('Verified Tyler receipt is required.')
  if (!targets.has(environment) || receipt.environment !== environment)
    throw new Error('Tyler receipt environment mismatch.')
  if (receipt.signatureVerified !== true || receipt.sourceVerified !== true)
    throw new Error('Tyler response has not passed cryptographic verification.')
  const envelopeId = required(receipt.envelopeId, 'Tyler envelope ID')
  const filingId = required(receipt.filingId, 'Tyler filing ID')
  if (/^(mock|demo|test)[-_:]/i.test(envelopeId) || /^(mock|demo|test)[-_:]/i.test(filingId))
    throw new Error('Mock identifiers cannot be persisted as Tyler submissions.')
  return Object.freeze({envelopeId, filingId, environment})
}

export function createTylerOutboundCoordinator({transport, registerSubmission, loadExisting, enabled = false}) {
  if (typeof registerSubmission !== 'function' || typeof loadExisting !== 'function')
    throw new Error('Durable submission registration and reconciliation lookup required.')
  return {
    async submit({draft, ownerId, environment, idempotencyKey}) {
      // Client-side feature flags cannot enable this server-side gate.
      if (enabled !== true || !transport || typeof transport.submitVerified !== 'function')
        throw new Error('Tyler outbound submission is disabled pending Stage certification.')
      const intent = prepareTylerFilingIntent({draft, ownerId, environment, idempotencyKey})
      // A persisted per-key outbox lock must be acquired before performing
      // network I/O. Transport is responsible for an atomic lock + no replay.
      if (typeof transport.reserveOnce !== 'function')
        throw new Error('No durable idempotency reservation provider is configured.')
      const prior = await loadExisting(intent)
      if (prior) return {existing:true, ...prior}
      const reservation = await transport.reserveOnce(intent)
      if (!reservation || reservation.fingerprint !== intent.fingerprint || reservation.acquired !== true)
        throw new Error('Submission not sent: duplicate or uncertain reservation.')
      let result
      try {
        result = await transport.submitVerified(intent, reservation)
      } catch (error) {
        // An ambiguous send is never automatically retried. Persist this
        // state even if transport failed before an acknowledgment.
        if (typeof transport.markUncertain === 'function') {
          try { await transport.markUncertain(intent) } catch {
            // The durable reservation remains, blocking a new send.
          }
        }
        throw new Error('Tyler submission result is uncertain; reconcile in Tyler before attempting again.', {cause:error})
      }
      const receipt = validateTylerReviewReceipt(result, environment)
      // Register the original owner/matter alongside verified vendor IDs, never
      // choose an owner based on a later untrusted callback.
      await registerSubmission({...intent, ...receipt})
      return {existing:false, ...receipt}
    },
  }
}
