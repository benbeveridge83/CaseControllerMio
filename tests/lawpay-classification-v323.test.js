// V323: LawPay deposit-account mapping, manual verification, classification, refunds and
// duplicate protection. Synthetic records only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { accountRegistry, resolveTransactionAccount, accountDiagnostics, maskAccountId, sameProviderAccountId, accountDiscrepancy } from '../src/mioLawPayAccounts.js'
import { amountBreakdown, classificationIdentity, correctionPreview, correctionRecord, refundResolutionRecord, refundReview, duplicateClassification, existingEntryMatch, ledgerPlan, manualAccountVerification, postingEligibility, postingPreview, queueSplit, refundReconciliation, reviewStatus, singleCountProviderPayments, validateClassification } from '../src/mioLawPayClassification.js'

const trustAccount = { provider_account_id: 'acct-91075', account_key: 'trust', bank_account_id: 'plaid-trust', bank_role: 'trust', label: 'Trust / IOLTA ••••1075', is_active: true }
const operatingAccount = { provider_account_id: 'acct-91077', account_key: 'operating', bank_account_id: 'plaid-operating', bank_role: 'operating', label: 'Operating ••••1077', is_active: true }
const registry = accountRegistry({ rows: [trustAccount, operatingAccount] })
const matter = { id: 'matter-rooney', name: 'Rooney Matter', client_id: 'client-rooney' }
const charge = (over = {}) => ({ gateway_transaction_id: 'lawpay-charge-1', transaction_type: 'CHARGE', status: 'COMPLETED', amount_cents: 500000, amount_refunded_cents: 0, currency: 'USD', account_id: 'acct-91075', occurred_at: '2026-09-10T15:00:00Z', ...over })

test('provider account IDs stay opaque: a numeric ID matches its configured string, but case and padding are never forced to match', () => {
  assert.equal(sameProviderAccountId(91075, '91075'), true)
  assert.equal(sameProviderAccountId('ACCT-1', 'acct-1'), false)
  assert.equal(sameProviderAccountId(' acct-1', 'acct-1'), false)
  assert.equal(sameProviderAccountId('', ''), false)
  assert.equal(maskAccountId('acct-91075'), '••••1075')
  assert.equal(maskAccountId(''), '')
})

test('a mapping row must name the provider account and a real Mio account key, and duplicates never resolve twice', () => {
  const messy = accountRegistry({ rows: [trustAccount, { ...trustAccount, provider_account_id: '' }, { provider_account_id: 'x', account_key: 'nonsense' }, { provider_account_id: 'dup', account_key: 'operating' }, { provider_account_id: 'dup', account_key: 'trust' }] })
  assert.equal(messy.configuredCount, 2)
  assert.equal(messy.problems.length, 2)
  assert.equal(messy.duplicates.length, 1)
  assert.equal(messy.matchProviderId('dup').account_key, 'operating', 'the first valid mapping wins')
})

test('an external consultation receipt records to operating and never to trust', () => {
  const transaction = charge({ account_id: 'acct-91077', amount_cents: 12500 })
  const resolved = resolveTransactionAccount({ transaction, registry })
  assert.equal(resolved.provenance, 'reported_by_lawpay')
  assert.equal(resolved.account_key, 'operating')
  const plan = ledgerPlan({ transaction, resolvedAccount: resolved, category: 'consultation_payment', matter })
  assert.equal(plan.rows.length, 0)
  assert.equal(plan.trust_delta_cents, 0)
  assert.equal(plan.operating_record.entry_kind, 'operating_association')
  const blocked = validateClassification({ mode: 'post', record: { ownership: 'pnc', category: 'trust_deposit' }, transaction, resolvedAccount: resolved, pnc: { id: 'pnc-1' } })
  assert.equal(blocked.ok, false)
  assert.match(blocked.errors.join(' '), /trust deposit cannot be recorded against the operating account/)
})

test('an external trust deposit credits the selected matter exactly once', () => {
  const transaction = charge()
  const resolved = resolveTransactionAccount({ transaction, registry })
  const plan = ledgerPlan({ transaction, resolvedAccount: resolved, category: 'trust_deposit', matter })
  assert.equal(plan.trust_delta_cents, 500000)
  assert.equal(plan.rows[0].transaction_type, 'lawpay')
  assert.equal(plan.rows[0].direction, 'in')
  const identity = classificationIdentity({ transaction, providerAccountId: resolved.provider_account_id })
  const existing = [{ id: 'c1', identity, posting_status: 'posted', category: 'trust_deposit' }]
  assert.equal(duplicateClassification({ existing, identity, category: 'trust_deposit' }).duplicate, true)
})

test('a Rooney-style refund paid from trust reduces that client’s trust once and touches no invoice or fee', () => {
  const refund = charge({ gateway_transaction_id: 'lawpay-refund-9', transaction_type: 'REFUND', amount_cents: 112000 })
  const resolved = resolveTransactionAccount({ transaction: refund, registry })
  const plan = ledgerPlan({ transaction: refund, resolvedAccount: resolved, category: 'client_refund', matter })
  assert.equal(plan.money_out, true)
  assert.equal(plan.trust_delta_cents, -112000)
  assert.equal(plan.rows[0].transaction_type, 'refund')
  assert.equal(plan.invoice_application, null)
  const preview = postingPreview({ plan, status: { eligible: true }, matter })
  assert.match(preview[0], /Money out \$1120\.00 for Rooney Matter/)
  assert.match(preview[1], /−\$1120\.00/)
  assert.match(plan.notes.join(' '), /exactly once/)
})

test('a refund funded from operating never reduces trust', () => {
  const refund = charge({ account_id: 'acct-91077', transaction_type: 'REFUND', amount_cents: 112000 })
  const resolved = resolveTransactionAccount({ transaction: refund, registry })
  const plan = ledgerPlan({ transaction: refund, resolvedAccount: resolved, category: 'client_refund', matter })
  assert.equal(plan.trust_delta_cents, 0)
  assert.equal(plan.rows.length, 0)
  assert.equal(plan.operating_record.entry_kind, 'operating_refund')
  assert.equal(plan.operating_record.original_payment_adjustment, true)
  assert.match(postingPreview({ plan, status: { eligible: true }, matter }).join(' '), /operating money never moves trust|operating account with the original payment adjustment/)
})

test('a missing deposit account is saved for review and can be verified manually with evidence', () => {
  const transaction = charge({ account_id: 'acct-unknown-9', raw: { account_id: 'acct-unknown-9', mio_account_key_source: 'unresolved' } })
  const resolved = resolveTransactionAccount({ transaction, registry })
  assert.equal(resolved.provenance, 'unresolved')
  const saved = validateClassification({ mode: 'save', record: { ownership: 'matter', category: 'trust_deposit' }, transaction, resolvedAccount: resolved, matter })
  assert.equal(saved.ok, true)
  assert.match(saved.warnings.join(' '), /not established yet/)
  const refused = validateClassification({ mode: 'post', record: { ownership: 'matter', category: 'trust_deposit' }, transaction, resolvedAccount: resolved, matter })
  assert.equal(refused.ok, false)
  const unresolvedPlan = ledgerPlan({ transaction, resolvedAccount: resolved, category: 'client_refund', matter })
  assert.equal(unresolvedPlan.rows.length, 0)
  assert.match(unresolvedPlan.notes.join(' '), /must be established/)
  assert.equal(manualAccountVerification({ account_key: 'trust', evidence_reference: '', explanation: 'seen it', actor: 'ben@firm' }).ok, false)
  assert.equal(manualAccountVerification({ account_key: 'trust', evidence_reference: 'LawPay report 2026-09-12', explanation: '', actor: 'ben@firm' }).ok, false)
  assert.equal(manualAccountVerification({ account_key: 'trust', evidence_reference: 'LawPay report 2026-09-12', explanation: 'refund line 4 on the IOLTA statement', actor: '' }).ok, false)
  const verified = manualAccountVerification({ account_key: 'trust', bank_account_id: 'plaid-trust', evidence_reference: 'LawPay report 2026-09-12', explanation: 'refund line 4 on the IOLTA statement', actor: 'ben@firm', at: '2026-09-12T10:00:00Z' })
  assert.equal(verified.ok, true)
  assert.equal(verified.verification.label, 'Manually verified')
  const withManual = resolveTransactionAccount({ transaction, registry, manual: verified.verification })
  assert.equal(withManual.provenance, 'manually_verified')
  assert.equal(withManual.account_key, 'trust')
  const accepted = validateClassification({ mode: 'post', record: { ownership: 'matter', category: 'trust_deposit' }, transaction, resolvedAccount: withManual, matter })
  assert.equal(accepted.ok, true)
})

test('a mapping that contradicts the stored account is surfaced as a discrepancy, never applied silently', () => {
  const discrepancy = accountDiscrepancy({ storedKey: 'operating', resolved: { account_key: 'trust', provenance: 'reported_by_lawpay' } })
  assert.equal(discrepancy.stored_account_key, 'operating')
  assert.equal(discrepancy.resolved_account_key, 'trust')
  assert.match(discrepancy.reason, /no longer matches/)
  assert.equal(accountDiscrepancy({ storedKey: 'trust', resolved: { account_key: 'trust' } }), null)
  assert.equal(accountDiscrepancy({ storedKey: '', resolved: { account_key: 'trust' } }), null)
  assert.equal(reviewStatus({ record: { ownership: 'matter', category: 'trust_deposit' }, discrepancy }), 'discrepancy_requires_review')
})

test('diagnostics stay redacted: masked accounts, counts and provider field names only', () => {
  const diagnostics = accountDiagnostics({ registry, transactions: [charge(), charge({ gateway_transaction_id: 'c2', account_id: 91077, raw: { account_id: 91077 } }), charge({ gateway_transaction_id: 'c3', account_id: '', raw: { account_id: '', amount_refunded: 0, processor_fee: 1450 } })] })
  assert.equal(diagnostics.transactions_reviewed, 3)
  assert.equal(diagnostics.provider_account_id_types.number, 1)
  assert.equal(diagnostics.missing_provider_account_id, 1)
  assert.equal(diagnostics.configured_account_count, 2)
  assert.ok(diagnostics.unmapped_provider_accounts.some((row) => row.account_last4.endsWith('1077')))
  assert.equal(JSON.stringify(diagnostics).includes('acct-91075'), false)
  assert.ok(diagnostics.provider_field_names_present.includes('amount_refunded'))
  assert.ok(diagnostics.provider_field_names_present.includes('processor_fee'))
})

test('partial refunds, double signals, voids, failed payments, pending charges and chargebacks stay distinct', () => {
  const partial = refundReconciliation({ charge: charge({ amount_cents: 500000, amount_refunded_cents: 150000 }) })
  assert.equal(partial.effective_refund_cents, 150000)
  assert.equal(partial.remaining_cents, 350000)
  assert.equal(partial.counts_both_signals, false)
  assert.equal(partial.requires_review, false)
  const overlap = refundReconciliation({ charge: charge({ amount_cents: 500000, amount_refunded_cents: 150000 }), refunds: [charge({ gateway_transaction_id: 'r1', transaction_type: 'REFUND', status: 'COMPLETED', amount_cents: 150000 })] })
  assert.equal(overlap.effective_refund_cents, 150000, 'the refund is counted once, never twice')
  assert.equal(overlap.counts_both_signals, true)
  assert.equal(overlap.requires_review, true)
  assert.match(overlap.reason, /counted once from the refund records/)
  assert.equal(postingEligibility({ transaction: charge({ status: 'PENDING' }), category: 'trust_deposit' }).state, 'pending_separately')
  assert.equal(postingEligibility({ transaction: charge({ status: 'FAILED' }), category: 'trust_deposit' }).state, 'not_postable_status')
  assert.equal(postingEligibility({ transaction: charge({ status: 'VOID' }), category: 'trust_deposit' }).state, 'not_postable_status')
  assert.equal(postingEligibility({ transaction: charge(), category: 'void' }).state, 'no_money_moved')
  assert.equal(postingEligibility({ transaction: charge(), category: 'trust_deposit' }).eligible, true)
  const chargeback = ledgerPlan({ transaction: charge({ transaction_type: 'CHARGEBACK' }), resolvedAccount: { account_key: 'trust', provenance: 'reported_by_lawpay' }, category: 'chargeback', matter })
  assert.equal(chargeback.money_out, true)
  assert.equal(chargeback.trust_delta_cents, -500000)
})

test('a refund whose original payment predates the import window is matched to the existing entry and posts nothing', () => {
  const refund = charge({ gateway_transaction_id: 'lawpay-refund-7', transaction_type: 'REFUND', amount_cents: 112000, raw: {} })
  const matched = existingEntryMatch({ transaction: refund, entry: { id: 'opening-trust-row-4', source: 'Opening balance 2026-08-09', amount: 1120 }, actor: 'ben@firm', at: '2026-09-12T10:00:00Z' })
  assert.equal(matched.ok, true)
  assert.equal(matched.entry, null, 'matching never posts another ledger row')
  assert.equal(matched.match.matched_entry_id, 'opening-trust-row-4')
  assert.equal(matched.match.matched_amount_cents, 112000)
  assert.equal(existingEntryMatch({ transaction: refund, entry: {}, actor: 'ben@firm' }).ok, false)
  assert.equal(existingEntryMatch({ transaction: { transaction_type: 'REFUND' }, entry: { id: 'x' }, actor: 'ben@firm' }).ok, false)
})

test('rescans, webhook replays, retries and concurrent tabs share one identity, and a re-classification needs a linked correction', () => {
  const transaction = charge()
  const identity = classificationIdentity({ transaction, providerAccountId: 'acct-91075' })
  assert.equal(identity, 'acct-91075:lawpay-charge-1')
  assert.equal(classificationIdentity({ transaction: { ...transaction, status: 'COMPLETED', amount_refunded_cents: 25000 }, providerAccountId: 'acct-91075' }), identity)
  assert.equal(classificationIdentity({ transaction: { transaction_type: 'CHARGE' } }), '', 'no stable provider ID means no posting identity')
  const existing = [{ id: 'c1', identity, posting_status: 'posted', category: 'trust_deposit', posted_at: '2026-09-11T00:00:00Z' }]
  assert.match(duplicateClassification({ existing, identity, category: 'trust_deposit' }).reason, /already recorded in Mio/)
  const changed = duplicateClassification({ existing, identity, category: 'earned_fee_payment' })
  assert.equal(changed.requires_correction, true)
  assert.equal(duplicateClassification({ existing: [{ ...existing[0], posting_status: 'awaiting_posting' }], identity, category: 'trust_deposit' }), null, 'an unposted classification does not block posting')
  const correction = correctionRecord({ previous: existing[0], actor: 'ben@firm', reason: 'Payment was earned fees, not a trust deposit' })
  assert.equal(correction.ok, true)
  assert.equal(correction.correction.corrects_classification_id, 'c1')
  assert.equal(correctionRecord({ previous: existing[0], actor: 'ben@firm', reason: '' }).ok, false)
  assert.equal(correctionRecord({ previous: { ...existing[0], posting_status: 'awaiting_posting' }, actor: 'ben@firm', reason: 'x' }).ok, false)
})

test('the matter dashboard and the firm-wide queue split the same records consistently', () => {
  const records = [{ matter_id: 'matter-rooney', amount_cents: 500000 }, { matter_id: 'matter-south', amount_cents: 12500 }, { matter_id: '', amount_cents: 1000 }]
  const split = queueSplit({ records, matterId: 'matter-rooney' })
  assert.equal(split.matter.length, 1)
  assert.equal(split.firm_wide.length, 2)
  assert.equal(split.firm_wide_label, 'Firm-wide LawPay review queue')
  assert.equal(split.totals.matter_cents, 500000)
  assert.equal(split.totals.firm_wide_cents, 13500)
  assert.equal(split.totals.matter_cents + split.totals.firm_wide_cents, split.totals.all_cents)
})

test('an unresolved refund is never offset against an account-level refunded total', () => {
  // Charge A reports $100 refunded. Refund B is a separate, unrelated $100 refund in the same
  // account, with no immutable link. The true effect may be $200, so nothing is assumed: the row
  // is excluded from the reconciled balance, which is reported as not final, and its possible
  // effect is shown as a range instead of choosing one answer.
  const charge = { gateway_transaction_id: 'charge-A', transaction_type: 'CHARGE', status: 'COMPLETED', amount_cents: 500000, amount_refunded_cents: 10000, account_key: 'echeck_trust' }
  const unrelated = { gateway_transaction_id: 'refund-B', transaction_type: 'REFUND', status: 'COMPLETED', amount_cents: 10000, account_key: 'echeck_trust' }
  const review = refundReview({ transactions: [charge, unrelated] })
  assert.equal(review.unresolved_refund_cents, 10000, 'the unrelated refund stays unresolved')
  assert.equal(review.reconciled, false)
  assert.equal(review.status, 'refund_relationship_unresolved')
  assert.equal(review.label, 'Refund relationship unresolved')
  assert.equal(review.separate_refund_total_cents, 0, 'nothing is offset against the charge reported total')
  assert.equal(review.resolved_total_cents, 490000, 'the charge is counted net of its own reported total only')
  assert.deepEqual(review.unresolved_possible_totals, { minimum_refund_cents: 0, maximum_refund_cents: 10000, maximum_total_cents: 490000, minimum_total_cents: 480000 })
  assert.match(review.reason, /not final: it is between \$4800\.00 and \$4900\.00/)
  assert.equal(review.effects[0].effect, 'unresolved')
  // Confirming it as a separate refund produces the full $200 refund effect.
  const separate = refundReview({ transactions: [charge, unrelated], resolutions: { 'refund-B': { resolution: 'separate_refund', resolved_by: 'ben@firm', evidence_reference: 'LawPay refund report line 9' } } })
  assert.equal(separate.separate_refund_total_cents, 10000)
  assert.equal(separate.resolved_total_cents, 480000, 'the reported $100 and the separate $100 are both counted')
  assert.equal(separate.unresolved_refund_cents, 0)
  assert.equal(separate.reconciled, true)
  assert.equal(separate.effects[0].effect, 'additional_refund')
  // Confirming it as the same refund produces one $100 effect.
  const same = refundReview({ transactions: [charge, unrelated], resolutions: { 'refund-B': { resolution: 'same_refund', charge_transaction_id: 'charge-A', resolved_by: 'ben@firm', evidence_reference: 'Same provider reference on both rows' } } })
  assert.equal(same.separate_refund_total_cents, 0)
  assert.equal(same.resolved_total_cents, 490000, 'the refund is counted once, through the charge reported total')
  assert.equal(same.reconciled, true)
  assert.equal(same.effects[0].effect, 'already_reflected')
  assert.equal(same.effects[0].source, 'confirmed_match')
})

test('two equal unlinked refunds are resolved independently, by identity rather than by amount', () => {
  const charge = { gateway_transaction_id: 'charge-A', transaction_type: 'CHARGE', status: 'COMPLETED', amount_cents: 500000, amount_refunded_cents: 10000, account_key: 'echeck_trust' }
  const first = { gateway_transaction_id: 'refund-1', transaction_type: 'REFUND', status: 'COMPLETED', amount_cents: 10000, account_key: 'echeck_trust' }
  const second = { gateway_transaction_id: 'refund-2', transaction_type: 'REFUND', status: 'COMPLETED', amount_cents: 10000, account_key: 'echeck_trust' }
  const unresolved = refundReview({ transactions: [charge, first, second] })
  assert.equal(unresolved.unresolved_refund_cents, 20000)
  assert.equal(unresolved.reconciled, false)
  const mixed = refundReview({ transactions: [charge, first, second], resolutions: { 'refund-1': { resolution: 'same_refund', charge_transaction_id: 'charge-A' }, 'refund-2': { resolution: 'separate_refund' } } })
  assert.equal(mixed.reconciled, true)
  assert.equal(mixed.resolved_total_cents, 480000, 'one refund is already in the charge total, the other is added')
  assert.equal(mixed.effects[0].effect, 'already_reflected')
  assert.equal(mixed.effects[1].effect, 'additional_refund')
  const bothSeparate = refundReview({ transactions: [charge, first, second], resolutions: { 'refund-1': { resolution: 'separate_refund' }, 'refund-2': { resolution: 'separate_refund' } } })
  assert.equal(bothSeparate.resolved_total_cents, 470000)
  // A provider identifier outranks a stored decision, and a link the firm disputed is not a link.
  const providerLinked = refundReview({ transactions: [charge, { ...first, original_transaction_id: 'charge-A' }] })
  assert.equal(providerLinked.reconciled, true, 'the provider identifier resolves it without review')
  assert.equal(providerLinked.effects[0].source, 'provider_identifier')
  const disputed = refundReview({ transactions: [charge, { ...first, original_transaction_id: 'charge-A', original_link_verified: false }] })
  assert.equal(disputed.reconciled, false, 'a disputed link leaves the refund unresolved')
  assert.equal(disputed.unresolved_refund_cents, 10000)
  const voided = refundReview({ transactions: [charge, { ...first, status: 'VOID' }] })
  assert.equal(voided.reconciled, true)
  assert.equal(voided.resolved_total_cents, 490000)
})

test('a refund resolution records who, when, the evidence and the immutable ids, and a correction links rather than overwrites', () => {
  const charge = { gateway_transaction_id: 'charge-A' }
  const refund = { gateway_transaction_id: 'refund-B', amount_cents: 10000, currency: 'USD', account_key: 'echeck_trust', account_id: 'acct-7788' }
  const missingEvidence = refundResolutionRecord({ refund, charge, resolution: 'separate_refund', actor: 'ben@firm', evidence_reference: '' })
  assert.equal(missingEvidence.ok, false)
  assert.match(missingEvidence.errors.join(' '), /Record what establishes the relationship/)
  const missingActor = refundResolutionRecord({ refund, charge, resolution: 'separate_refund', actor: '', evidence_reference: 'statement line 9' })
  assert.equal(missingActor.ok, false)
  assert.match(missingActor.errors.join(' '), /could not tell who resolved/)
  const noIdentifier = refundResolutionRecord({ refund: {}, charge, resolution: 'separate_refund', actor: 'ben@firm', evidence_reference: 'statement line 9' })
  assert.equal(noIdentifier.ok, false)
  assert.match(noIdentifier.errors.join(' '), /no immutable provider identifier/)
  const unnamedCharge = refundResolutionRecord({ refund, charge: {}, resolution: 'same_refund', actor: 'ben@firm', evidence_reference: 'same provider reference' })
  assert.equal(unnamedCharge.ok, false)
  assert.match(unnamedCharge.errors.join(' '), /the charge is named/)
  const first = refundResolutionRecord({ refund, charge, resolution: 'same_refund', actor: 'ben@firm', evidence_reference: 'same provider reference', at: '2026-09-22T10:00:00Z' })
  assert.equal(first.ok, true, first.errors?.join(' '))
  assert.deepEqual(first.record.immutable_ids, { refund: 'refund-B', charge: 'charge-A', provider_account: 'acct-7788' })
  assert.equal(first.record.corrects_resolution_id, '', 'the first decision corrects nothing')
  assert.equal(first.record.resolved_at, '2026-09-22T10:00:00Z')
  const corrected = refundResolutionRecord({ refund, charge, resolution: 'separate_refund', actor: 'jo@firm', evidence_reference: 'provider report shows two separate refunds', previous: { id: 'resolution-1' } })
  assert.equal(corrected.record.corrects_resolution_id, 'resolution-1', 'a later decision links to the earlier one instead of replacing it')
  assert.equal(corrected.record.resolved_by, 'jo@firm')
})

test('a correction preview states the reversal and the replacement, and the summary exposes the unresolved refunds', () => {
  const transaction = { gateway_transaction_id: 'charge-1', transaction_type: 'CHARGE', status: 'COMPLETED', amount_cents: 500000, currency: 'USD' }
  const trustPosting = { id: 'classification-1', posting_status: 'posted', gateway_transaction_id: 'charge-1', matter_id: 'matter-1', actual_account_key: 'trust', direction: 'in', amount_cents: 500000, currency: 'USD' }
  const toOperating = correctionPreview({ previous: trustPosting, transaction, resolvedAccount: { account_key: 'operating', provenance: 'reported_by_lawpay' }, category: 'consultation_payment', matter: { id: 'matter-1', name: 'Matter One' }, reason: 'The money reached the operating account.' })
  assert.equal(toOperating.ok, true, toOperating.errors?.join(' '))
  assert.equal(toOperating.reversal.trust_delta_cents, -500000)
  assert.equal(toOperating.trust_delta_cents, -500000)
  assert.match(toOperating.lines.join(' '), /undoing a trust credit/)
  const fromOperating = correctionPreview({ previous: { ...trustPosting, actual_account_key: 'operating' }, transaction, resolvedAccount: { account_key: 'trust', provenance: 'manually_verified' }, category: 'trust_deposit', reason: 'The deposit is on the IOLTA statement.' })
  assert.equal(fromOperating.reversal.trust_delta_cents, 0)
  assert.equal(fromOperating.trust_delta_cents, 500000)
  const noReason = correctionPreview({ previous: trustPosting, transaction, resolvedAccount: { account_key: 'operating', provenance: 'reported_by_lawpay' }, category: 'consultation_payment', reason: '' })
  assert.equal(noReason.ok, false)
  // The summary the reconciliation arithmetic uses carries the resolved figure and the warning.
  const charge = { gateway_transaction_id: 'charge-A', transaction_type: 'CHARGE', status: 'COMPLETED', amount_cents: 500000, amount_refunded_cents: 10000, account_key: 'echeck_trust' }
  const summary = singleCountProviderPayments([charge, { gateway_transaction_id: 'refund-B', transaction_type: 'REFUND', status: 'COMPLETED', amount_cents: 10000, account_key: 'echeck_trust' }])
  assert.equal(summary.reconciled, false)
  assert.equal(summary.unverified_refund_cents, 10000)
  assert.equal(summary.total_cents, 490000)
  assert.match(summary.reason, /not final/)
})

test('review statuses keep recorded in Mio separate from bank reconciled', () => {
  assert.equal(reviewStatus({ record: null }), 'needs_classification')
  assert.equal(reviewStatus({ record: { ownership: 'matter', category: 'trust_deposit' } }), 'classified_awaiting_posting')
  assert.equal(reviewStatus({ record: { ownership: 'matter', category: 'trust_deposit', posting_status: 'posted' } }), 'recorded_in_mio')
  assert.equal(reviewStatus({ record: { ownership: 'matter', category: 'trust_deposit', posting_status: 'posted', bank_matched_at: '2026-09-20T00:00:00Z' } }), 'matched_to_bank')
})

test('gross, processor fee and net stay separate and a trust credit is never reduced by the fee', () => {
  const transaction = charge({ amount_cents: 500000, processor_fee_cents: 1450 })
  const breakdown = amountBreakdown(transaction)
  assert.equal(breakdown.gross_cents, 500000)
  assert.equal(breakdown.processor_fee_cents, 1450)
  assert.equal(breakdown.net_settlement_cents, 498550)
  const plan = ledgerPlan({ transaction, resolvedAccount: { account_key: 'trust', provenance: 'reported_by_lawpay' }, category: 'trust_deposit', matter })
  assert.equal(plan.trust_delta_cents, 500000)
  assert.match(plan.notes.join(' '), /never reduced by the fee/)
  const withoutFee = amountBreakdown(charge())
  assert.equal(withoutFee.processor_fee_cents, null)
  assert.equal(withoutFee.net_settlement_cents, null)
  assert.match(ledgerPlan({ transaction: charge(), resolvedAccount: { account_key: 'operating', provenance: 'reported_by_lawpay' }, category: 'earned_fee_payment', matter }).notes.join(' '), /no fee is recorded/)
})

test('classification validation keeps the three decisions separate and refuses cross-account combinations', () => {
  const transaction = charge()
  const resolvedAccount = { account_key: 'trust', provenance: 'reported_by_lawpay' }
  assert.match(validateClassification({ record: {}, transaction, resolvedAccount }).errors.join(' '), /belongs to a matter, to a PNC consultation, or to neither/)
  assert.match(validateClassification({ record: { ownership: 'matter', category: 'trust_deposit' }, transaction, resolvedAccount }).errors.join(' '), /Select the matter/)
  assert.match(validateClassification({ record: { ownership: 'other_unresolved', category: 'other', explanation: 'x' }, transaction, resolvedAccount }).errors.join(' '), /belongs to neither/)
  assert.match(validateClassification({ record: { ownership: 'matter', category: 'other', explanation: '', other_reason: 'x' }, transaction, resolvedAccount, matter }).errors.join(' '), /Explain this “Other” transaction type/)
  const wrongInvoice = validateClassification({ record: { ownership: 'matter', category: 'earned_fee_payment' }, transaction: charge({ account_id: 'acct-91077' }), resolvedAccount: { account_key: 'operating', provenance: 'reported_by_lawpay' }, matter, invoice: { id: 'inv-1', matter_id: 'another-matter' } })
  assert.equal(wrongInvoice.ok, false)
  assert.match(wrongInvoice.errors.join(' '), /different matter/)
})
