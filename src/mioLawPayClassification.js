// LawPay transaction classification rules (V323).
//
// Three decisions are kept separate, because they answer different questions and one may be
// known while another is not:
//   ownership  - whose money this is (a matter, a PNC consultation, or other/unresolved)
//   account    - the actual trust or operating account the money moved through
//   category   - what the transaction was, and which way the money went
//
// A matter association never implies trust. A "consultation" label never proves the money
// reached the operating account. Nothing here guesses an account from a payer, an amount,
// a matter or an invoice, and nothing here moves money: it decides what may be recorded.
//
// Mio does not keep a general ledger. These rules produce single-entry rows with an
// explicit account, direction and category for the existing trust and operating views.

import { ACCOUNT_KEYS, accountFamily } from './mioLawPayAccounts.js'

export const OWNERSHIP = ['matter', 'pnc', 'other_unresolved']
export const OTHER_REASONS = ['consultation taken outside Mio', 'refund to a non-client', 'not a client payment', 'processor correction', 'duplicate of another record']
export const CATEGORIES = [
  { id: 'trust_deposit', label: 'Trust deposit — money in', direction: 'in', account: 'trust', posts: 'trust_ledger' },
  { id: 'consultation_payment', label: 'Consultation payment — money in', direction: 'in', account: 'operating', posts: 'operating' },
  { id: 'earned_fee_payment', label: 'Earned fee / invoice payment — money in', direction: 'in', account: 'operating', posts: 'operating', invoice: 'optional' },
  { id: 'client_refund', label: 'Client refund — money out', direction: 'out', account: 'either', posts: 'account' },
  { id: 'chargeback', label: 'Chargeback or payment reversal — money out', direction: 'out', account: 'either', posts: 'account' },
  { id: 'void', label: 'Void or cancellation — no money moved', direction: 'none', account: 'either', posts: 'none' },
  { id: 'other', label: 'Other — explanation required', direction: 'either', account: 'either', posts: 'account', explanation: 'required' },
]
const CATEGORY_BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]))
const trustCategories = new Set(['trust_deposit'])
const operatingCategories = new Set(['consultation_payment', 'earned_fee_payment'])
export const POSTABLE_CHARGE_STATUSES = ['COMPLETED', 'COMPLETE', 'SETTLED', 'SUCCEEDED', 'SUCCESS', 'PAID', 'CAPTURED']
export const PENDING_STATUSES = ['AUTHORIZED', 'AUTHORISED', 'PENDING', 'PROCESSING', 'SUBMITTED']
const NON_POSTING_STATUS = /void|declin|fail|cancel|return|expire|refunded|chargeback|reversed/
const MONEY_OUT_TYPES = new Set(['REFUND', 'REVERSAL', 'CHARGEBACK', 'CREDIT'])

export function categoryById(id) {
  return CATEGORY_BY_ID.get(String(id || '')) || null
}
export function categoryDirection(id) {
  return categoryById(id)?.direction || ''
}
export function providerType(transaction = {}) {
  return String(transaction.transaction_type || transaction.type || '').trim().toUpperCase()
}
export function providerMoneyOut(transaction = {}) {
  return MONEY_OUT_TYPES.has(providerType(transaction))
}
export function providerRefundChargeId(transaction = {}) {
  const raw = transaction?.raw && typeof transaction.raw === 'object' ? transaction.raw : {}
  return String(transaction.original_transaction_id || raw.mio_original_transaction_id || raw.charge_id || raw.refunded_transaction_id || '').trim()
}
export function amountCents(transaction = {}) {
  const value = Number(transaction.amount_cents ?? Math.round(Number(transaction.amount || 0) * 100))
  return Number.isFinite(value) ? Math.round(Math.abs(value)) : 0
}
// Processor fees are preserved separately when the provider reports one. A missing fee is
// reported as missing; it is never invented, and it is never deducted from a trust credit.
export function amountBreakdown(transaction = {}) {
  const gross = amountCents(transaction)
  const rawFee = transaction.processor_fee_cents ?? transaction.fee_cents ?? transaction.raw?.processor_fee ?? transaction.raw?.fee
  const fee = Number.isFinite(Number(rawFee)) ? Math.round(Math.abs(Number(rawFee))) : null
  return { gross_cents: gross, processor_fee_cents: fee, net_settlement_cents: fee === null ? null : gross - fee, fee_reported: fee !== null }
}
export function suggestions({ transaction = {}, accountKey = '' } = {}) {
  if (NON_POSTING_STATUS.test(String(transaction.status || '').toLowerCase())) return ['void']
  if (providerMoneyOut(transaction)) return ['client_refund', 'chargeback']
  const account = String(accountKey || '')
  if (account.includes('trust')) return ['trust_deposit', 'other']
  if (account.includes('operating')) return ['consultation_payment', 'earned_fee_payment', 'other']
  return ['trust_deposit', 'consultation_payment', 'earned_fee_payment', 'client_refund', 'other']
}

// When ownership and the provider account leave only one honest interpretation, Mio fills it in
// instead of asking the reviewer to repeat the same decision in a second dropdown. A trust-funded
// consultation remains deliberately unresolved: trust money cannot silently become a fee.
export function derivedClassificationCategory({ transaction = {}, ownership = '', accountKey = '' } = {}) {
  const type = providerType(transaction)
  if (type === 'REFUND') return 'client_refund'
  if (['REVERSAL', 'CHARGEBACK', 'CREDIT'].includes(type)) return 'chargeback'
  if (NON_POSTING_STATUS.test(String(transaction.status || '').toLowerCase())) return 'void'
  const family = accountFamily(accountKey)
  if (ownership === 'pnc') return family === 'operating' ? 'consultation_payment' : ''
  if (ownership === 'matter') {
    if (family === 'trust') return 'trust_deposit'
    if (family === 'operating') return 'earned_fee_payment'
  }
  if (ownership === 'other_unresolved') return 'other'
  return ''
}

// The editor starts from immutable linkage that Mio stored when it created the LawPay request.
// The returned shape contains only the decisions that can be established without user input.
export function defaultClassificationDraft({ transaction = {}, matter = null } = {}) {
  const linkage = transaction.review_linkage || {}
  const matterId = String(linkage.matter_id || transaction.raw?.mio_matter_id || matter?.id || '')
  const invoiceId = String(linkage.invoice_id || '')
  const ownership = 'matter'
  const accountKey = String(transaction.resolved_account_key || transaction.account_key || '')
  return {
    ownership,
    matter_id: matterId,
    pnc_workflow_id: '',
    category: derivedClassificationCategory({ transaction, ownership, accountKey }),
    invoice_id: invoiceId,
  }
}

export function matterChoiceLabel(matter = {}) {
  const client = String(matter.client_name || [matter.clients?.first_name, matter.clients?.last_name].filter(Boolean).join(' ') || '').trim()
  return [client, String(matter.name || matter.id || '').trim(), String(matter.cause_number || '').trim()].filter(Boolean).join(' — ')
}
export function postingEligibility({ transaction = {}, category = '' } = {}) {
  const status = String(transaction.status || '').trim().toUpperCase()
  const chosen = categoryById(category)
  if (!chosen) return { eligible: false, state: 'needs_category', reason: 'Choose the transaction type before recording it.' }
  if (chosen.posts === 'none') return { eligible: false, state: 'no_money_moved', reason: 'A void or cancellation moves no money, so nothing posts.' }
  if (NON_POSTING_STATUS.test(status.toLowerCase())) return { eligible: false, state: 'not_postable_status', reason: `LawPay reports this transaction as ${status || 'unsuccessful'}, so it is kept for review without posting.` }
  if (PENDING_STATUSES.includes(status)) return { eligible: false, state: 'pending_separately', reason: `LawPay has not completed this transaction yet (${status}). It is shown separately and posts only after a verified completion, and a later return or reversal is then handled as its own event.` }
  if (!POSTABLE_CHARGE_STATUSES.includes(status)) return { eligible: false, state: 'unverified_status', reason: `\u201c${status || 'blank'}\u201d is not a verified completion status, so nothing posts until LawPay confirms it.` }
  return { eligible: true, state: 'postable', reason: '' }
}

// Manual account verification is an authorised, evidence-backed decision. It is labelled
// "Manually verified" and never "Reported by LawPay", and the imported provider values stay
// untouched beside it.
export function manualAccountVerification({ account_key = '', bank_account_id = '', evidence_reference = '', explanation = '', actor = '', at = '' } = {}) {
  const errors = []
  if (!ACCOUNT_KEYS.includes(String(account_key))) errors.push('Choose the actual trust or operating account.')
  if (!String(evidence_reference).trim()) errors.push('Record the LawPay transaction or report, or the bank-statement reference, that supports this account.')
  if (!String(explanation).trim()) errors.push('Explain how the account was confirmed, so the decision stays reviewable.')
  if (!String(actor).trim()) errors.push('Mio could not tell who confirmed the account.')
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    verification: {
      account_key: String(account_key),
      bank_account_id: String(bank_account_id || ''),
      evidence_reference: String(evidence_reference).trim(),
      explanation: String(explanation).trim(),
      verified_by: String(actor).trim(),
      verified_at: at || new Date().toISOString(),
      label: 'Manually verified',
    },
  }
}

// `mode:'save'` keeps an unresolved account as a saved review item; `mode:'post'` refuses it.
export function validateClassification({ mode = 'save', record = {}, transaction = {}, resolvedAccount = {}, matter = null, invoice = null } = {}) {
  const errors = [], warnings = []
  const ownership = String(record.ownership || '')
  const category = categoryById(record.category)
  if (!OWNERSHIP.includes(ownership)) errors.push('Choose whether this transaction belongs to a matter, to a PNC consultation, or to neither.')
  if (ownership === 'matter' && !matter?.id) errors.push('Select the matter this transaction belongs to.')
  // A consultation may be associated with an existing PNC workflow, but that association is
  // optional. Ownership plus the operating-account evidence is sufficient to record a
  // consultation without making the reviewer type the payer's name back into Mio.
  if (ownership === 'other_unresolved' && !String(record.other_reason || '').trim()) errors.push('Say why this transaction belongs to neither, so the decision stays reviewable later.')
  if (!category) errors.push('Choose the transaction type.')
  if (category?.explanation === 'required' && !String(record.explanation || '').trim()) errors.push('Explain this “Other” transaction type.')
  const accountKey = String(resolvedAccount.account_key || record.account_key || '')
  const family = accountFamily(accountKey)
  const provenance = String(resolvedAccount.provenance || '')
  const accountEstablished = provenance === 'reported_by_lawpay' || provenance === 'payment_request' || provenance === 'manually_verified'
  if (!accountEstablished) {
    const message = 'The deposit account is not established yet. Record the actual trust or operating account with supporting evidence, then record the transaction.'
    if (mode === 'post') errors.push(message)
    else warnings.push(message)
  }
  if (category && family) {
    if (trustCategories.has(category.id) && family !== 'trust') errors.push('A trust deposit cannot be recorded against the operating account.')
    if (operatingCategories.has(category.id) && family !== 'operating') errors.push('An operating payment cannot be recorded against the trust account.')
  }
  if (category?.id === 'earned_fee_payment' && !invoice?.id) warnings.push('No invoice is identified, so this operating payment is recorded without being applied to an invoice.')
  if (invoice?.id && matter?.id && String(invoice.matter_id || '') && String(invoice.matter_id) !== String(matter.id)) errors.push('The selected invoice belongs to a different matter.')
  const direction = providerMoneyOut(transaction) ? 'out' : 'in'
  if (category && category.direction !== 'either' && category.direction !== 'none' && category.direction !== direction) {
    warnings.push(`LawPay reports this as money ${direction}, but the chosen type says money ${category.direction}. Confirm the type before recording it.`)
  }
  return { ok: errors.length === 0, errors, warnings, account_family: family, account_provenance: provenance }
}

// A charge may expose both a refunded total on the charge and separate refund records. The
// refund is counted once: the explicit refund records are the money movements, the aggregate
// on the charge is suppressed, and the overlap is reported for review, never netted twice.
export function refundReconciliation({ charge = {}, refunds = [] } = {}) {
  const gross = amountCents(charge)
  const aggregate = Math.max(0, Math.round(Number(charge.amount_refunded_cents || 0)))
  const separate = (refunds || [])
    .filter((row) => providerMoneyOut(row) && !NON_POSTING_STATUS.test(String(row.status || '').toLowerCase()))
    .reduce((sum, row) => sum + amountCents(row), 0)
  const overlap = aggregate > 0 && separate > 0
  const effective = overlap ? separate : (aggregate || separate)
  return {
    charge_id: String(charge.gateway_transaction_id || charge.id || ''),
    gross_cents: gross,
    amount_refunded_cents: aggregate,
    separate_refund_cents: separate,
    effective_refund_cents: effective,
    remaining_cents: Math.max(0, gross - effective),
    counts_both_signals: overlap,
    requires_review: overlap,
    reason: overlap ? 'LawPay reports a refunded total on the charge and separate refund records. The refund is counted once from the refund records; confirm that nothing is counted twice.' : '',
  }
}

// The ledger plan is derived from the stored provider record only; the browser never sends an
// amount that Mio posts. Gross, processor fee and net settlement stay separate, and a trust
// credit is always the gross amount, never reduced by a processing fee.
export function ledgerPlan({ transaction = {}, resolvedAccount = {}, category = '', matter = null, invoice = null } = {}) {
  const chosen = categoryById(category)
  const breakdown = amountBreakdown(transaction)
  const family = accountFamily(resolvedAccount.account_key)
  const plan = {
    category: chosen?.id || '',
    direction: chosen?.direction || '',
    account_key: String(resolvedAccount.account_key || ''),
    account_provenance: String(resolvedAccount.provenance || ''),
    money_out: chosen?.direction === 'out',
    rows: [],
    trust_delta_cents: 0,
    operating_record: null,
    invoice_application: null,
    breakdown,
    notes: [],
  }
  if (!breakdown.gross_cents) plan.notes.push('LawPay reports no amount for this transaction, so nothing can post.')
  if (!chosen) { plan.notes.push('Choose the transaction type before anything can post.'); return plan }
  if (chosen.posts === 'none') { plan.notes.push('A void or cancellation moves no money, so nothing posts.'); return plan }
  const paymentRequestId = String(transaction.raw?.mio_payment_request_id || transaction.payment_request_id || '')
  const baseRow = { amount_cents: breakdown.gross_cents, currency: String(transaction.currency || 'USD'), matter_id: String(matter?.id || ''), payment_request_id: paymentRequestId, occurred_at: transaction.occurred_at || transaction.created_at || '' }
  if (chosen.id === 'trust_deposit') {
    plan.rows = [{ ...baseRow, direction: 'in', transaction_type: 'lawpay' }]
    plan.trust_delta_cents = breakdown.gross_cents
    plan.notes.push('Client funds held in trust for this matter. This is not earned fee income and it does not pay an invoice.')
  } else if (chosen.id === 'consultation_payment' || chosen.id === 'earned_fee_payment') {
    plan.operating_record = { ...baseRow, entry_kind: 'operating_association', direction: 'in' }
    plan.notes.push('Firm money received into the operating account. The matter trust balance is not affected.')
    if (invoice?.id) plan.invoice_application = { invoice_id: String(invoice.id), invoice_number: String(invoice.invoice_number || ''), amount_cents: breakdown.gross_cents }
    else plan.notes.push('No invoice is identified, so this payment is recorded without being applied to one.')
  } else if (chosen.id === 'client_refund' || chosen.id === 'chargeback') {
    if (family === 'trust') {
      plan.rows = [{ ...baseRow, direction: 'out', transaction_type: 'refund' }]
      plan.trust_delta_cents = -breakdown.gross_cents
      plan.notes.push('Paid out of trust: this reduces this client’s trust balance exactly once. It is not a new payment received, not a fee expense, and not a payment toward an invoice.')
    } else if (family === 'operating') {
      plan.operating_record = { ...baseRow, entry_kind: 'operating_refund', direction: 'out', original_payment_adjustment: true }
      plan.notes.push('Paid out of operating: recorded against operating with the original payment or fee adjustment. The client trust balance is not reduced.')
    } else {
      plan.notes.push('The actual account must be established before a refund or chargeback can be recorded.')
    }
  } else if (chosen.id === 'other') {
    if (family === 'trust') {
      plan.rows = [{ ...baseRow, direction: chosen.direction === 'out' ? 'out' : 'in', transaction_type: 'other' }]
      plan.trust_delta_cents = chosen.direction === 'out' ? -breakdown.gross_cents : breakdown.gross_cents
    } else {
      plan.operating_record = { ...baseRow, entry_kind: 'operating_other', direction: chosen.direction === 'out' ? 'out' : 'in' }
    }
    plan.notes.push('Recorded as an explained “Other” transaction. Confirm the explanation describes the money movement.')
  }
  if (family === 'trust' && breakdown.processor_fee_cents) plan.notes.push('The processing fee is recorded separately; the client’s trust credit is the gross amount and is never reduced by the fee.')
  if (!breakdown.fee_reported) plan.notes.push('LawPay did not report a processing fee for this transaction, so no fee is recorded and gross equals net.')
  return plan
}

export const REVIEW_STATUSES = ['needs_classification', 'classified_awaiting_posting', 'recorded_in_mio', 'matched_to_bank', 'discrepancy_requires_review']
export const REVIEW_STATUS_LABELS = {
  needs_classification: 'Needs classification',
  classified_awaiting_posting: 'Classified, awaiting verification or posting',
  recorded_in_mio: 'Recorded in Mio',
  matched_to_bank: 'Matched to bank settlement or statement',
  discrepancy_requires_review: 'Discrepancy requiring review',
}
// "Recorded in Mio" never means "bank reconciled": matched_to_bank is only ever set by an
// explicit settlement or statement match, which this release does not automate.
export function reviewStatus({ record = null, discrepancy = null } = {}) {
  if (discrepancy) return 'discrepancy_requires_review'
  if (!record || !record.ownership || !record.category) return 'needs_classification'
  if (record.posted_at || record.posting_status === 'posted') return record.bank_matched_at ? 'matched_to_bank' : 'recorded_in_mio'
  return 'classified_awaiting_posting'
}

// What the reviewer is about to do, in words, before anything is written.
export function postingPreview({ plan = {}, status = {}, matter = null } = {}) {
  const lines = []
  const amount = `$${(Number(plan.breakdown?.gross_cents || 0) / 100).toFixed(2)}`
  lines.push(`${plan.money_out ? 'Money out' : 'Money in'} ${amount}${matter?.name ? ` for ${matter.name}` : ''}.`)
  const delta = Number(plan.trust_delta_cents || 0)
  lines.push(delta ? `Trust balance change: ${delta > 0 ? '+' : '−'}$${(Math.abs(delta) / 100).toFixed(2)}.` : 'Trust balance change: none.')
  if (plan.operating_record) lines.push(plan.operating_record.entry_kind === 'operating_refund' ? 'Recorded against the operating account with the original payment adjustment.' : 'Recorded as operating activity; operating money never moves trust.')
  if (plan.invoice_application) lines.push(`Applied to invoice ${plan.invoice_application.invoice_number || plan.invoice_application.invoice_id}.`)
  else if (plan.category === 'earned_fee_payment') lines.push('Not applied to any invoice.')
  if (!status.eligible) lines.push(status.reason || 'This transaction is not eligible to post yet.')
  for (const note of plan.notes || []) lines.push(note)
  return lines
}

// "Match existing entry" links this transaction to a ledger row that already exists — a manual
// trust entry, or a deposit already inside an opening balance — instead of adding another one.
// A match records the link only and never posts money or invents a balancing row.
export function existingEntryMatch({ transaction = {}, entry = {}, actor = '', at = '' } = {}) {
  const providerId = String(transaction.gateway_transaction_id || transaction.id || '').trim()
  const entryId = String(entry.id || '').trim()
  if (!providerId) return { ok: false, error: 'This LawPay transaction has no stable provider ID, so it cannot be matched.' }
  if (!entryId) return { ok: false, error: 'Select the existing ledger entry this transaction matches.' }
  return {
    ok: true,
    entry: null,
    match: {
      gateway_transaction_id: providerId,
      matched_entry_id: entryId,
      matched_entry_source: String(entry.source || ''),
      matched_amount_cents: Number.isFinite(Number(entry.amount)) ? Math.round(Math.abs(Number(entry.amount)) * 100) : null,
      matched_by: String(actor || ''),
      matched_at: at || new Date().toISOString(),
    },
  }
}

// The stable identity of the financial event is the provider transaction ID scoped to the
// provider account, so the same payment can never be counted twice by a rescan, a webhook
// replay, a retry or a second tab. Re-classifying, or newly resolving the deposit account,
// changes the stored classification but never posts the transaction a second time.
export function classificationIdentity({ transaction = {}, providerAccountId = '' } = {}) {
  const id = String(transaction.gateway_transaction_id || transaction.id || '').trim()
  if (!id) return ''
  const account = String(providerAccountId || transaction.account_id || '').trim()
  return account ? `${account}:${id}` : id
}
export function duplicateClassification({ existing = [], identity = '', category = '' } = {}) {
  const posted = (existing || []).find((record) => String(record.identity || '') === String(identity) && String(record.posting_status || '') === 'posted')
  if (!posted) return null
  if (String(posted.category || '') === String(category || '')) {
    return { duplicate: true, posted_at: posted.posted_at || '', reason: 'This transaction is already recorded in Mio, so nothing else will post. Change the classification with a linked correction if it is wrong.' }
  }
  return { duplicate: true, requires_correction: true, reason: 'This transaction is already recorded under a different classification. Use a linked correction instead of recording it again.' }
}
export const REFUND_RESOLUTIONS = ['same_refund', 'separate_refund']

// A refund decision is persisted with who, when, the evidence and the immutable identifiers
// involved. A later decision never overwrites an earlier one: it is a new, linked record.
export function refundResolutionRecord({ refund = {}, charge = {}, resolution = '', evidence_reference = '', actor = '', at = '', previous = null } = {}) {
  const errors = []
  const refundId = String(refund.gateway_transaction_id || refund.id || '')
  const chargeId = String(charge.gateway_transaction_id || charge.id || '')
  if (!refundId) errors.push('This refund has no immutable provider identifier, so it cannot be resolved.')
  if (!REFUND_RESOLUTIONS.includes(String(resolution))) errors.push('Choose whether this refund is already reflected on the charge or is a separate refund.')
  if (String(resolution) === 'same_refund' && !chargeId) errors.push('A refund can only be recorded as already reflected if the charge is named.')
  if (!String(evidence_reference).trim()) errors.push('Record what establishes the relationship: the provider reference, or the report that shows it.')
  if (!String(actor).trim()) errors.push('Mio could not tell who resolved this refund.')
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    record: {
      refund_transaction_id: refundId,
      charge_transaction_id: chargeId,
      resolution: String(resolution),
      amount_cents: amountCents(refund),
      currency: String(refund.currency || 'USD'),
      provider_account_id: String(refund.account_id || ''),
      account_key: String(refund.account_key || charge.account_key || ''),
      evidence_reference: String(evidence_reference).trim(),
      resolved_by: String(actor).trim(),
      resolved_at: at || new Date().toISOString(),
      corrects_resolution_id: previous?.id ? String(previous.id) : '',
      immutable_ids: { refund: refundId, charge: chargeId, provider_account: String(refund.account_id || '') },
    },
  }
}

// The refund review. Nothing is netted across transactions merely because they share a LawPay
// account: a refund row is deduplicated against a charge's reported refunded total only when an
// immutable provider identifier, or a match a person expressly confirmed, says the two describe
// the same refund. While that is unknown the refund is neither counted nor offset — it is excluded
// from the reconciled balance, which is therefore not final, and its possible effect is shown.
function completedProviderTransaction(transaction = {}) {
  return POSTABLE_CHARGE_STATUSES.includes(String(transaction.status || '').trim().toUpperCase())
}

function refundWithInheritedEvidence(transaction = {}, chargeById = new Map()) {
  if (!providerMoneyOut(transaction)) return transaction
  const chargeId = providerRefundChargeId(transaction)
  const charge = chargeId ? chargeById.get(chargeId) || null : null
  if (!charge) return transaction
  const own = transaction.review_linkage || {}, inherited = charge.review_linkage || {}
  const choose = (key) => {
    const value = own[key]
    return value !== undefined && value !== null && value !== '' ? value : inherited[key]
  }
  return {
    ...transaction,
    refund_charge_id: chargeId,
    resolved_account_key: String(transaction.resolved_account_key || transaction.account_key || charge.resolved_account_key || charge.account_key || ''),
    resolved_account_source: String(transaction.resolved_account_source || charge.resolved_account_source || ''),
    review_linkage: {
      payment_request_id: choose('payment_request_id') || '',
      request_found: own.request_found === true || inherited.request_found === true,
      payment_request_status: choose('payment_request_status') || '',
      invoice_number: choose('invoice_number') || '',
      invoice_id: choose('invoice_id') || '',
      invoice_status: choose('invoice_status') || '',
      invoice_event_id: choose('invoice_event_id') || '',
      matter_id: choose('matter_id') || '',
      client_id: choose('client_id') || '',
      reconciled: own.reconciled === true || inherited.reconciled === true,
      conflict: choose('conflict') || '',
      inherited_from_charge_id: chargeId,
    },
  }
}

export function refundReview({ transactions = [], resolutions = {}, reviewCutoverDate = '' } = {}) {
  const charges = [], refundRows = []
  for (const transaction of transactions || []) {
    if (beforeReviewCutover(transaction, reviewCutoverDate)) continue
    if (providerMoneyOut(transaction)) refundRows.push(transaction)
    else charges.push(transaction)
  }
  const idOf = (row) => String(row?.gateway_transaction_id || row?.id || '')
  const chargeById = new Map(charges.map((charge) => [idOf(charge), charge]))
  const effects = []
  let unresolvedTotal = 0, separateTotal = 0
  for (const refund of refundRows) {
    if (!completedProviderTransaction(refund)) continue
    const refundId = idOf(refund)
    const amount = amountCents(refund)
    const linkedId = providerRefundChargeId(refund)
    const confirmed = resolutions[refundId] || null
    const providerLinked = linkedId && refund.original_link_verified !== false ? chargeById.get(linkedId) || null : null
    const confirmedLinked = confirmed && String(confirmed.resolution) === 'same_refund' ? chargeById.get(String(confirmed.charge_transaction_id || '')) || null : null
    const linkedCharge = providerLinked || confirmedLinked
    if (linkedCharge) {
      effects.push({ refund_id: refundId, charge_id: idOf(linkedCharge), amount_cents: amount, effect: 'already_reflected', source: providerLinked ? 'provider_identifier' : 'confirmed_match', resolution: confirmed || null })
    } else if (confirmed && String(confirmed.resolution) === 'separate_refund') {
      effects.push({ refund_id: refundId, charge_id: '', amount_cents: amount, effect: 'additional_refund', source: 'confirmed_separate', resolution: confirmed })
      separateTotal += amount
    } else {
      effects.push({ refund_id: refundId, charge_id: '', amount_cents: amount, effect: 'unresolved', source: 'unresolved', possible_effects: { additional_refund_cents: amount, already_reflected_cents: 0 }, resolution: null })
      unresolvedTotal += amount
    }
  }
  const chargeTotal = charges.reduce((sum, charge) => sum + Math.max(0, amountCents(charge) - Math.max(0, Math.round(Math.abs(Number(charge.amount_refunded_cents || 0))))), 0)
  const resolvedTotal = chargeTotal - separateTotal
  return {
    effects,
    charge_total_cents: chargeTotal,
    separate_refund_total_cents: separateTotal,
    resolved_total_cents: resolvedTotal,
    unresolved_refund_cents: unresolvedTotal,
    unresolved_possible_totals: { minimum_refund_cents: separateTotal, maximum_refund_cents: separateTotal + unresolvedTotal, maximum_total_cents: resolvedTotal, minimum_total_cents: resolvedTotal - unresolvedTotal },
    reconciled: unresolvedTotal === 0,
    status: unresolvedTotal === 0 ? 'resolved' : 'refund_relationship_unresolved',
    label: unresolvedTotal === 0 ? '' : 'Refund relationship unresolved',
    requires_review: unresolvedTotal > 0,
    reason: unresolvedTotal > 0
      ? `Refund relationship unresolved: $${(unresolvedTotal / 100).toFixed(2)} of refunds here are tied to a charge by neither a provider identifier nor a confirmed match, so nothing has been assumed about them. The reconciled total is not final: it is between $${((resolvedTotal - unresolvedTotal) / 100).toFixed(2)} and $${(resolvedTotal / 100).toFixed(2)} until each refund is resolved.`
      : '',
  }
}

// Summary used by the reconciliation arithmetic: the resolved effect, plus the unresolved amount
// and whether the total may be treated as an authoritative reconciled balance.
export function singleCountProviderPayments(transactions = [], { resolutions = {} } = {}) {
  const review = refundReview({ transactions, resolutions })
  return {
    charge_total_cents: review.charge_total_cents,
    separate_refund_total_cents: review.separate_refund_total_cents,
    unverified_refund_cents: review.unresolved_refund_cents,
    total_cents: review.resolved_total_cents,
    refunds: review.effects,
    reconciled: review.reconciled,
    requires_review: review.requires_review,
    reason: review.reason,
    review,
  }
}

// A correction is a new, linked record that reverses the previous posting and states why; the
// original record and its ledger rows are preserved for the audit trail.
export function correctionRecord({ previous = {}, actor = '', at = '', reason = '' } = {}) {
  if (!String(reason).trim()) return { ok: false, error: 'Explain why the recorded classification is being corrected.' }
  if (!previous?.id) return { ok: false, error: 'Select the recorded classification to correct.' }
  if (String(previous.posting_status || '') !== 'posted') return { ok: false, error: 'Only a recorded transaction can be corrected.' }
  return {
    ok: true,
    correction: {
      corrects_classification_id: String(previous.id),
      corrects_identity: String(previous.identity || ''),
      reverses_ledger_entry_id: String(previous.ledger_entry_id || ''),
      reason: String(reason).trim(),
      corrected_by: String(actor || ''),
      corrected_at: at || new Date().toISOString(),
    },
  }
}

// What a correction would do, in numbers and in words, before anything is written. The previous
// posting is preserved and its effect is reversed exactly once; the replacement posts exactly
// once. A replacement that cannot post is refused before the correction is offered, because a
// refused corrected posting must leave the original posting unchanged.
export function correctionPreview({ previous = {}, transaction = {}, resolvedAccount = {}, category = '', matter = null, invoice = null, reason = '' } = {}) {
  const replacement = ledgerPlan({ transaction, resolvedAccount, category, matter, invoice })
  const previousAccount = String(previous.actual_account_key || '')
  const previousFamily = accountFamily(previousAccount)
  const previousDirection = String(previous.direction || (previous.money_out ? 'out' : 'in')) === 'out' ? 'out' : 'in'
  const amount = Math.max(0, Math.round(Math.abs(Number(previous.amount_cents || 0))))
  const reversal = {
    exists: !!(previous.id && previousAccount),
    account_key: previousAccount,
    account_family: previousFamily,
    direction: previousDirection === 'out' ? 'in' : 'out',
    amount_cents: amount,
    currency: String(previous.currency || 'USD'),
    matter_id: String(previous.matter_id || ''),
    // The reversal undoes the trust movement the previous posting made, and nothing else.
    trust_delta_cents: previousFamily === 'trust' ? (previousDirection === 'out' ? amount : -amount) : 0,
  }
  const decision = correctionRecord({ previous, reason })
  const errors = []
  if (!decision.ok) errors.push(decision.error)
  if (!reversal.exists) errors.push('The recorded classification has no posting to reverse.')
  const replacementMovesMoney = !!categoryById(category) && categoryById(category).posts !== 'none'
  if (!replacementMovesMoney) errors.push('Choose what the transaction should be recorded as before confirming the correction.')
  const trustDeltaCents = reversal.trust_delta_cents + Number(replacement.trust_delta_cents || 0)
  const lines = []
  lines.push(`Reversal: ${reversal.direction === 'out' ? 'money out' : 'money in'} ${(amount / 100).toFixed(2)} on the previously recorded account` +
    (reversal.account_family === 'trust' ? `, undoing a trust ${previousDirection === 'out' ? 'debit' : 'credit'}.` : ', which never moved trust.'))
  lines.push(`Trust balance change from the reversal: ${reversal.trust_delta_cents ? `${reversal.trust_delta_cents > 0 ? '+' : '−'}$${(Math.abs(reversal.trust_delta_cents) / 100).toFixed(2)}` : 'none'}.`)
  for (const line of postingPreview({ plan: replacement, status: { eligible: replacementMovesMoney, reason: replacementMovesMoney ? '' : 'Choose what the transaction should be recorded as.' } })) lines.push(line)
  lines.push(`Trust balance change overall: ${trustDeltaCents ? `${trustDeltaCents > 0 ? '+' : '−'}$${(Math.abs(trustDeltaCents) / 100).toFixed(2)}` : 'none'}.`)
  lines.push('The original classification, its ledger entry and its reversal stay in the audit history, linked to this correction.')
  return { ok: errors.length === 0, errors, reversal, replacement, trust_delta_cents: trustDeltaCents, correction: decision.ok ? decision.correction : null, lines }
}

// The matter dashboard shows only that matter's transactions. Everything else stays in the
// firm-wide review queue, which is always labelled as firm-wide so another client's payment
// cannot be mistaken for this matter's transaction. Both views read the same records, so the
// two totals always add up to the firm-wide figure.
export function queueSplit({ records = [], matterId = '' } = {}) {
  const wanted = String(matterId || '')
  const matter = [], firmWide = []
  for (const record of records || []) {
    const belongs = !!wanted && String(record.matter_id || '') === wanted
    if (belongs) matter.push(record)
    else firmWide.push(record)
  }
  const total = (rows) => rows.reduce((sum, row) => sum + Math.round(Number(row.amount_cents ?? Number(row.amount || 0) * 100) || 0), 0)
  return {
    matter,
    firm_wide: firmWide,
    firm_wide_label: 'Firm-wide LawPay review queue',
    totals: {
      matter_cents: total(matter),
      firm_wide_cents: total(firmWide),
      all_cents: total([...matter, ...firmWide]),
    },
  }
}

// The single number the centralized review queue and its persistent notification share: how many
// provider transactions still genuinely require a decision, plus how many refund relationships are
// still unresolved. It writes nothing and reuses exactly the rules the panel uses.
//
// Excluded, so the count never nags about something that needs no action: pending/authorized
// transactions (PENDING_STATUSES), failed/voided/closed ones (NON_POSTING_STATUS or a CLOSED status),
// and any transaction that is already recorded (posted) or already matched (posting_status 'matched',
// which a match to an existing entry stores and which `reviewStatus` alone does not treat as done).
// Counted: a transaction with no decision, a transaction saved for later (classified but not posted),
// and an actionable refund relationship (unresolved in `refundReview`).
function providerTransactionId(transaction = {}) {
  return String(transaction.gateway_transaction_id || transaction.id || '')
}

function beforeReviewCutover(transaction = {}, reviewCutoverDate = '') {
  const cutover = String(reviewCutoverDate || '').slice(0, 10)
  const occurred = String(transaction.occurred_at || transaction.created_at || '').slice(0, 10)
  return !!(cutover && occurred && occurred < cutover)
}

function classificationFinished(record = null) {
  return !!(record && (record.posted_at
    || String(record.posting_status || '') === 'posted'
    || String(record.posting_status || '') === 'matched'))
}

// A single, evidence-based disposition is shared by the queue and the persistent alert. It never
// infers ownership from a payer name or amount. A Mio-created request is recognized only from its
// immutable stored request id and the gateway's hydrated database evidence.
export function lawPayReviewDisposition({
  transaction = {}, classification = null, reviewCutoverDate = '', legacyRecordedTransactionIds = [], legacyAttributedTransactionIds = [],
} = {}) {
  const id = providerTransactionId(transaction)
  const status = String(transaction.status || '').trim().toUpperCase()
  const linkage = transaction.review_linkage || {}
  const paymentRequestId = String(linkage.payment_request_id || transaction.raw?.mio_payment_request_id || '')
  const matterId = String(linkage.matter_id || transaction.raw?.mio_matter_id || '')
  const base = { transaction_id: id, matter_id: matterId, actionable: false, classification_queue: false }
  if (!id) return { ...base, state: 'ineligible', reason: 'The provider transaction has no immutable identifier.' }
  if (beforeReviewCutover(transaction, reviewCutoverDate)) {
    return { ...base, state: 'historical_out_of_scope', reason: `This transaction predates Mio's finance opening date (${String(reviewCutoverDate).slice(0, 10)}).` }
  }
  if (PENDING_STATUSES.includes(status) || status === 'CLOSED' || NON_POSTING_STATUS.test(status.toLowerCase())) {
    return { ...base, state: 'ineligible', reason: `LawPay reports ${status || 'an unverified status'}, so no classification can post.` }
  }
  const legacyRecorded = new Set((legacyRecordedTransactionIds || []).map(String))
  const legacyAttributed = new Set((legacyAttributedTransactionIds || []).map(String))
  if (classificationFinished(classification) || legacyRecorded.has(id)) {
    return { ...base, state: 'already_recorded', reason: 'An exact Mio financial record already accounts for this provider transaction.' }
  }
  if (legacyAttributed.has(id)) {
    return { ...base, state: 'already_decided', reason: 'Mio already has an exact attribution decision for this provider transaction.' }
  }
  if (linkage.reconciled === true && (matterId || linkage.invoice_id)) {
    return { ...base, state: 'linked_and_complete', reason: 'An exact Mio invoice event already records this provider transaction.' }
  }
  if (paymentRequestId) {
    if (linkage.conflict) {
      return { ...base, state: 'linked_incomplete', reason: String(linkage.conflict) }
    }
    const requestFound = linkage.request_found === true
    const invoiceNumber = String(linkage.invoice_number || transaction.raw?.mio_invoice_number || '')
    const invoiceComplete = !invoiceNumber || linkage.reconciled === true
    if (requestFound && matterId && invoiceComplete) {
      return { ...base, state: 'linked_and_complete', reason: 'This payment is already linked to the Mio request and matter that created it.' }
    }
    return {
      ...base,
      state: 'linked_incomplete',
      reason: 'This payment carries a Mio request link, but its stored reconciliation evidence is incomplete. Review the technical linkage; do not classify it again.',
    }
  }
  const accountKey = String(transaction.resolved_account_key || transaction.account_key || '')
  if (!accountKey) {
    return { ...base, state: 'needs_account_mapping', actionable: true, classification_queue: true, reason: 'The provider account must be mapped or manually verified.' }
  }
  return { ...base, state: 'needs_ownership', actionable: true, classification_queue: true, reason: 'Choose whether this direct LawPay payment belongs to a matter or is a consultation.' }
}

// Reconcile completed, provider-linked refunds with Mio's existing client-refund entries. This is
// deliberately read-only: an exact entry is recognized, a difference is surfaced, and no second
// withdrawal is manufactured. Multiple provider refund rows for one matter on one day are grouped
// because LawPay may split a single client refund across the original charges that funded it.
export function refundLedgerReview({ transactions = [], existingEntries = [], reviewCutoverDate = '' } = {}) {
  const normalizedName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const rows = (transactions || []).filter((transaction) => !beforeReviewCutover(transaction, reviewCutoverDate))
  const idOf = (row) => String(row?.gateway_transaction_id || row?.id || '')
  const charges = rows.filter((row) => !providerMoneyOut(row))
  const chargeById = new Map(charges.map((row) => [idOf(row), row]))
  const groupsByKey = new Map()
  for (const refund of rows) {
    if (!providerMoneyOut(refund) || !completedProviderTransaction(refund)) continue
    const chargeId = providerRefundChargeId(refund), charge = chargeId ? chargeById.get(chargeId) || null : null
    if (!charge) continue
    const matterId = String(refund.review_linkage?.matter_id || charge.review_linkage?.matter_id || charge.raw?.mio_matter_id || '')
    const date = String(refund.occurred_at || refund.created_at || '').slice(0, 10)
    if (!matterId || !date) continue
    const key = `${matterId}:${date}`
    const prior = groupsByKey.get(key) || {
      key, matter_id: matterId, date, refund_ids: [], provider_total_cents: 0,
      payer_name: String(refund.payer_name || charge.payer_name || ''),
      account_key: String(refund.resolved_account_key || refund.account_key || charge.resolved_account_key || charge.account_key || ''),
    }
    prior.refund_ids.push(idOf(refund))
    prior.provider_total_cents += amountCents(refund)
    if (!prior.payer_name) prior.payer_name = String(charge.payer_name || '')
    if (!prior.account_key) prior.account_key = String(charge.resolved_account_key || charge.account_key || '')
    groupsByKey.set(key, prior)
  }
  const normalizedEntries = (existingEntries || []).map((entry) => ({
    ...entry,
    id: String(entry.id || ''),
    matter_id: String(entry.matter_id || ''),
    date: String(entry.date || entry.occurred_at || entry.created_at || '').slice(0, 10),
    direction: String(entry.direction || '').toLowerCase(),
    transaction_type: String(entry.transaction_type || '').toLowerCase(),
    lawpay_transaction_id: String(entry.lawpay_transaction_id || ''),
    payer_name: String(entry.payer_payee || entry.payer_name || ''),
    amount_cents: amountCents(entry),
  }))
  const groups = [], issues = [], matched = []
  for (const base of groupsByKey.values()) {
    const refundIds = new Set(base.refund_ids)
    const direct = normalizedEntries.filter((entry) => entry.lawpay_transaction_id && refundIds.has(entry.lawpay_transaction_id))
    const candidates = direct.length ? direct : normalizedEntries.filter((entry) => (
      entry.matter_id === base.matter_id && entry.date === base.date && entry.direction === 'out'
      && ['client_refund', 'refund'].includes(entry.transaction_type)
      && (!normalizedName(base.payer_name) || (normalizedName(entry.payer_name) && normalizedName(entry.payer_name) === normalizedName(base.payer_name)))
    ))
    const mioTotal = candidates.reduce((sum, entry) => sum + entry.amount_cents, 0)
    const difference = base.provider_total_cents - mioTotal
    const state = candidates.length ? (difference === 0 ? 'matched_existing_refund' : 'amount_mismatch') : 'missing_mio_refund'
    const group = {
      ...base,
      state,
      mio_total_cents: mioTotal,
      difference_cents: difference,
      entry_ids: candidates.map((entry) => entry.id),
    }
    groups.push(group)
    if (state === 'matched_existing_refund') matched.push(group)
    else issues.push(group)
  }
  return { groups, issues, matched }
}

export function actionableReviewCount({
  transactions = [], classifications = [], refundResolutions = [], reviewCutoverDate = '', legacyRecordedTransactionIds = [], legacyAttributedTransactionIds = [], existingRefundEntries = [],
} = {}) {
  const byId = new Map()
  for (const record of classifications || []) {
    const id = String(record.gateway_transaction_id || '')
    if (!id) continue
    const prior = byId.get(id)
    // Gateway history is newest-first, but an active posted/matched row is authoritative even if
    // an older saved row is also present. Never let iteration order revive an accounted payment.
    if (!prior || (!classificationFinished(prior) && classificationFinished(record))) byId.set(id, record)
  }
  const chargeById = new Map((transactions || []).filter((row) => !providerMoneyOut(row)).map((row) => [providerTransactionId(row), row]))
  const effectiveTransactions = (transactions || []).map((row) => refundWithInheritedEvidence(row, chargeById))
  const dispositions = {}
  const needsDecision = [], technicalExceptions = [], historical = [], ineligible = [], handled = []
  for (const transaction of effectiveTransactions) {
    const id = providerTransactionId(transaction)
    if (!id) continue
    const disposition = lawPayReviewDisposition({
      transaction,
      classification: byId.get(id) || null,
      reviewCutoverDate,
      legacyRecordedTransactionIds,
      legacyAttributedTransactionIds,
    })
    dispositions[id] = disposition
    if (disposition.actionable) needsDecision.push(transaction)
    else if (disposition.state === 'linked_incomplete') technicalExceptions.push(transaction)
    else if (disposition.state === 'historical_out_of_scope') historical.push(transaction)
    else if (disposition.state === 'ineligible') ineligible.push(transaction)
    else handled.push(transaction)
  }
  const refundTransactions = effectiveTransactions.filter((transaction) => {
    if (beforeReviewCutover(transaction, reviewCutoverDate)) return false
    const status = String(transaction.status || '').trim().toUpperCase()
    return !PENDING_STATUSES.includes(status) && status !== 'CLOSED' && !NON_POSTING_STATUS.test(status.toLowerCase())
  })
  const resolutions = Object.fromEntries((refundResolutions || []).map((row) => [String(row.refund_transaction_id || ''), row]))
  const refunds = refundReview({ transactions: refundTransactions, resolutions, reviewCutoverDate })
  const refundRelationships = refunds.effects.filter((effect) => effect.effect === 'unresolved')
  const refundLedger = refundLedgerReview({ transactions: effectiveTransactions, existingEntries: existingRefundEntries, reviewCutoverDate })
  const transactionDecisionIds = new Set(needsDecision.map(providerTransactionId))
  const additionalRefundRelationships = refundRelationships.filter((effect) => !transactionDecisionIds.has(String(effect.refund_id || '')))
  return {
    // The notification counts review transactions, not clicks. An unclassified refund may need
    // both a classification and a relationship decision, but it remains one provider transaction.
    count: needsDecision.length + additionalRefundRelationships.length + refundLedger.issues.length,
    transactions: needsDecision,
    refund_relationships: refundRelationships,
    refund_ledger_issues: refundLedger.issues,
    refund_ledger_matches: refundLedger.matched,
    refund_review: refunds,
    technical_exceptions: technicalExceptions,
    historical,
    ineligible,
    handled,
    dispositions,
  }
}
