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
export function validateClassification({ mode = 'save', record = {}, transaction = {}, resolvedAccount = {}, matter = null, pnc = null, invoice = null } = {}) {
  const errors = [], warnings = []
  const ownership = String(record.ownership || '')
  const category = categoryById(record.category)
  if (!OWNERSHIP.includes(ownership)) errors.push('Choose whether this transaction belongs to a matter, to a PNC consultation, or to neither.')
  if (ownership === 'matter' && !matter?.id) errors.push('Select the matter this transaction belongs to.')
  if (ownership === 'pnc' && !pnc?.id) errors.push('Select the PNC this transaction belongs to.')
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
// A refund can be described twice: as a refunded total on the charge, and as its own refund row.
// It must be counted once — but only an immutable provider identifier may decide that a refund row
// is the same money as a charge's refunded total. An identical amount in the same account is not
// proof: two unrelated refunds can share an amount, so a row is never suppressed on that basis.
//
// The rule that keeps this honest in both directions:
//   * a charge linked by the provider's own identifier uses its refund rows, and its aggregate is
//     treated as the duplicate description;
//   * any other charge uses its own reported refunded total, which is an immutable field of that
//     transaction;
//   * unlinked refund rows are never assumed to belong to a charge, so they are not subtracted
//     again on top of an aggregate: only the amount by which they *exceed* the refunded totals
//     already recorded in the same account is subtracted, because that excess cannot be the same
//     money;
//   * every unlinked refund is reported for review instead of being resolved silently.
export function singleCountProviderPayments(transactions = [], { accountKeyOf = (row) => String(row?.account_key || '') } = {}) {
  const charges = [], moneyOut = []
  for (const transaction of transactions || []) {
    if (providerMoneyOut(transaction)) moneyOut.push(transaction)
    else charges.push(transaction)
  }
  const idOf = (row) => String(row?.gateway_transaction_id || row?.id || '')
  const chargeById = new Map(charges.map((charge) => [idOf(charge), charge]))
  const aggregateOf = (charge) => Math.max(0, Math.round(Math.abs(Number(charge.amount_refunded_cents || 0))))
  const verified = new Map(), rows = [], unverified = [], unlinkedByAccount = new Map()
  for (const refund of moneyOut) {
    if (NON_POSTING_STATUS.test(String(refund.status || '').toLowerCase())) continue
    const amount = amountCents(refund)
    const linkedId = String(refund.original_transaction_id || refund.raw?.mio_original_transaction_id || '')
    const charge = linkedId && refund.original_link_verified !== false ? chargeById.get(linkedId) : null
    const entry = { gateway_transaction_id: idOf(refund), amount_cents: amount, original_transaction_id: linkedId }
    if (charge) {
      const key = idOf(charge)
      verified.set(key, (verified.get(key) || 0) + amount)
      rows.push({ ...entry, counts_as: 'verified_refund_row', linked_charge: key })
    } else {
      unverified.push({ ...entry, counts_as: 'unlinked_refund_row' })
      const account = String(accountKeyOf(refund) || '')
      unlinkedByAccount.set(account, (unlinkedByAccount.get(account) || 0) + amount)
    }
  }
  for (const entry of unverified) rows.push(entry)
  const aggregateByAccount = new Map()
  let chargeTotal = 0
  for (const charge of charges) {
    const key = idOf(charge), gross = amountCents(charge), aggregate = aggregateOf(charge)
    const represented = verified.has(key) ? verified.get(key) : aggregate
    chargeTotal += Math.max(0, gross - represented)
    if (!verified.has(key)) {
      const account = String(accountKeyOf(charge) || '')
      aggregateByAccount.set(account, (aggregateByAccount.get(account) || 0) + aggregate)
    }
  }
  let excessRefundTotal = 0
  for (const [account, unlinked] of unlinkedByAccount) {
    excessRefundTotal += Math.max(0, unlinked - (aggregateByAccount.get(account) || 0))
  }
  return {
    charge_total_cents: chargeTotal,
    separate_refund_total_cents: excessRefundTotal,
    unverified_refund_cents: unverified.reduce((sum, entry) => sum + entry.amount_cents, 0),
    total_cents: chargeTotal - excessRefundTotal,
    refunds: rows,
    suppressed_refunds: [],
    requires_review: unverified.length > 0,
    reason: unverified.length
      ? 'A charge reports a refunded total and separate refund records exist that no provider identifier links to it. Nothing is assumed: each charge is counted once net of its own reported total, an unlinked refund is only subtracted beyond that, and the relationship is kept for review.'
      : '',
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
