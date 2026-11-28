// Tyler ECF5 filing outcome, fee, service and matter-status model (SERVER ONLY).
//
// This is the non-Tyler surface: canonical status classification, fee
// authorization checks, service-result shape and receipt shape. It performs no
// Tyler fee quote, TOGA, or service-contact lookup — those remain Tyler-
// dependent. Its purpose is to keep the UI/status layer from conflating
// "drafted", "submitted", "accepted", "rejected" and "served".

export const TYLER_FILING_STATE = Object.freeze({
  drafted: 'drafted',
  submitted: 'submitted',
  under_review: 'under_review',
  accepted: 'accepted',
  rejected: 'rejected',
  served: 'served',
  unknown: 'unknown',
})

export const TYLER_RECEIPT_KIND = Object.freeze({
  clerk_receipt: 'clerk_receipt',
  fee_receipt: 'fee_receipt',
  file_stamped_document: 'file_stamped_document',
  rejection_notice: 'rejection_notice',
})

export const TYLER_SERVICE_OUTCOME = Object.freeze(['delivered', 'failed', 'pending'])

const FILING_MODES = new Set(['efile_only', 'efile_and_serve', 'eserve_only'])

/**
 * Classify a recorded submission plus service delivery into one user-facing
 * state. A submission is never reported as "accepted" unless its ledger status
 * is accepted, and only "served" when an accepted filing has a delivered
 * service result.
 */
export function classifyTylerFilingState({ submission, serviceDelivered = false } = {}) {
  if (!submission || typeof submission !== 'object') return TYLER_FILING_STATE.unknown
  const status = String(submission.status || '').toLowerCase()
  if (status === 'rejected') return TYLER_FILING_STATE.rejected
  if (status === 'accepted') return serviceDelivered ? TYLER_FILING_STATE.served : TYLER_FILING_STATE.accepted
  if (status === 'under_review') return TYLER_FILING_STATE.under_review
  if (status === 'submitted') return TYLER_FILING_STATE.submitted
  return TYLER_FILING_STATE.unknown
}

/**
 * A draft intent (no outbound submission) is "drafted", never "submitted",
 * even if the client marks it ready.
 */
export function classifyTylerIntentState({ hasSubmission = false } = {}) {
  return hasSubmission ? TYLER_FILING_STATE.submitted : TYLER_FILING_STATE.drafted
}

/**
 * Validate a fee quote against the reviewed plan. The quote must originate from
 * a verified Tyler Stage quote; the ceiling, account-ownership and waiver checks
 * here are independent, non-Tyler safeguards. Returns a frozen authorization.
 */
export function validateTylerFeeAuthorization({ feeQuote, plan } = {}) {
  if (!feeQuote || typeof feeQuote !== 'object') throw new Error('A fee quote is required.')
  if (!plan || typeof plan !== 'object') throw new Error('A reviewed filing plan is required.')
  if (feeQuote.source !== 'tyler_stage' || feeQuote.verifiedByServer !== true)
    throw new Error('A server-verified Tyler Stage fee quote is required.')
  if (typeof feeQuote.paymentAccountId !== 'string' || feeQuote.paymentAccountId !== plan.paymentAccountId)
    throw new Error('Fee quote payment account does not match the selected account.')
  if (!Number.isSafeInteger(feeQuote.feeAmountCents) || feeQuote.feeAmountCents < 0)
    throw new Error('Fee amount must be a non-negative integer of cents.')
  if (!Number.isSafeInteger(plan.maxFeeAmountCents) || plan.maxFeeAmountCents < 0)
    throw new Error('An authorized maximum fee is required.')
  if (feeQuote.feeAmountCents > plan.maxFeeAmountCents)
    throw new Error('Fee quote exceeds the authorized maximum.')
  if (plan.feeWaiver === true && feeQuote.feeAmountCents !== 0)
    throw new Error('A waived filing cannot carry a fee.')
  if (typeof feeQuote.quoteId !== 'string' || !feeQuote.quoteId || feeQuote.quoteId.length > 256)
    throw new Error('A fee quote identifier is required.')
  return Object.freeze({
    authorized: true,
    feeAmountCents: feeQuote.feeAmountCents,
    quoteId: feeQuote.quoteId,
    paymentAccountId: feeQuote.paymentAccountId,
    // The UI preference to bill the client is never an unapproved debit; it is
    // recorded as an intent only.
    billedToClient: plan.billedToClient !== false,
  })
}

/**
 * Normalize an e-service result. Each recipient must carry a real Tyler
 * service-contact ID and a delivery outcome; E-File Only may not have any.
 */
export function validateTylerServiceResult({ filingMode, recipients = [] } = {}) {
  if (!FILING_MODES.has(filingMode)) throw new Error('Unknown filing mode.')
  const list = Array.isArray(recipients) ? recipients : []
  if (filingMode === 'efile_only' && list.length > 0)
    throw new Error('E-File Only cannot have service recipients.')
  const normalized = list.map((r) => {
    if (!r || typeof r.serviceContactId !== 'string' || !r.serviceContactId)
      throw new Error('Each served recipient requires a Tyler service-contact ID.')
    if (!TYLER_SERVICE_OUTCOME.includes(r.outcome)) throw new Error('Unknown service delivery outcome.')
    return Object.freeze({ serviceContactId: r.serviceContactId, outcome: r.outcome })
  })
  return Object.freeze({ served: normalized.length > 0, recipients: Object.freeze(normalized) })
}

/**
 * Validate a persisted filing receipt (clerk receipt, fee receipt, file-stamped
 * document, or rejection notice) so the UI can attach it to the right matter.
 */
export function validateTylerReceipt({ kind, matterId, storagePath, sha256 } = {}) {
  if (!Object.values(TYLER_RECEIPT_KIND).includes(kind)) throw new Error('Unknown receipt kind.')
  if (typeof matterId !== 'string' || !matterId) throw new Error('A matter ID is required for a receipt.')
  if (typeof storagePath !== 'string' || !storagePath) throw new Error('A storage path is required for a receipt.')
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('A SHA-256 digest is required for a receipt.')
  return Object.freeze({ kind, matterId, storagePath, sha256 })
}
