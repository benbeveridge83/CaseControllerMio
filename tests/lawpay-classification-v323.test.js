// V323: LawPay deposit-account mapping, manual verification, classification, refunds and
// duplicate protection. Synthetic records only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { accountRegistry, resolveTransactionAccount, accountDiagnostics, maskAccountId, sameProviderAccountId, accountDiscrepancy } from '../src/mioLawPayAccounts.js'
import { amountBreakdown, classificationIdentity, correctionPreview, correctionRecord, duplicateClassification, existingEntryMatch, ledgerPlan, manualAccountVerification, postingEligibility, postingPreview, queueSplit, refundReconciliation, reviewStatus, singleCountProviderPayments, validateClassification } from '../src/mioLawPayClassification.js'

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

test('a refund is counted once from a provider identifier, and an equal amount is never proof', () => {
  const charge = { gateway_transaction_id: 'charge-1', transaction_type: 'CHARGE', status: 'COMPLETED', amount_cents: 500000, amount_refunded_cents: 112000, account_key: 'trust' }
  const unlinked = { gateway_transaction_id: 'refund-1', transaction_type: 'REFUND', status: 'COMPLETED', amount_cents: 112000, account_key: 'trust' }
  // The same amount in the same account is not evidence: the charge is counted net of its own
  // reported total, the unlinked row is not subtracted a second time, and the ambiguity is flagged.
  const ambiguous = singleCountProviderPayments([charge, unlinked])
  assert.equal(ambiguous.charge_total_cents, 388000, 'the charge is counted net of its own reported refunded total')
  assert.equal(ambiguous.separate_refund_total_cents, 0, 'an equal amount must not be subtracted again')
  assert.equal(ambiguous.total_cents, 388000)
  assert.equal(ambiguous.requires_review, true, 'an unlinked refund is flagged, never resolved silently')
  assert.match(ambiguous.reason, /no provider identifier links to it/)
  assert.equal(ambiguous.unverified_refund_cents, 112000)
  assert.equal(ambiguous.refunds[0].counts_as, 'unlinked_refund_row')
  assert.deepEqual(ambiguous.suppressed_refunds, [])
  // A provider link is proof: the refund rows are the money movements and the aggregate on the
  // charge is the duplicate description of the same money.
  const verified = singleCountProviderPayments([charge, { ...unlinked, original_transaction_id: 'charge-1' }])
  assert.equal(verified.total_cents, 388000)
  assert.equal(verified.requires_review, false)
  assert.equal(verified.refunds[0].counts_as, 'verified_refund_row')
  assert.equal(verified.refunds[0].linked_charge, 'charge-1')
  // A link the firm has disputed is not proof either.
  const disputed = singleCountProviderPayments([charge, { ...unlinked, original_transaction_id: 'charge-1', original_link_verified: false }])
  assert.equal(disputed.requires_review, true)
  assert.equal(disputed.refunds[0].counts_as, 'unlinked_refund_row')
  assert.equal(disputed.total_cents, 388000)
})

test('two unrelated same-account refunds of the same amount are each counted once, not merged', () => {
  const charge = { gateway_transaction_id: 'charge-1', transaction_type: 'CHARGE', status: 'COMPLETED', amount_cents: 500000, amount_refunded_cents: 112000, account_key: 'trust' }
  const first = { gateway_transaction_id: 'refund-1', transaction_type: 'REFUND', status: 'COMPLETED', amount_cents: 112000, account_key: 'trust' }
  const second = { gateway_transaction_id: 'refund-2', transaction_type: 'REFUND', status: 'COMPLETED', amount_cents: 112000, account_key: 'trust' }
  const counted = singleCountProviderPayments([charge, first, second])
  assert.equal(counted.charge_total_cents, 388000)
  assert.equal(counted.separate_refund_total_cents, 112000, 'only the refund beyond the charge reported total is subtracted')
  assert.equal(counted.total_cents, 276000, 'each refund is counted once: 5000 less 1120 reported, less the 1120 that cannot be the same money')
  assert.equal(counted.unverified_refund_cents, 224000, 'both unlinked refunds stay visible for review')
  assert.equal(counted.requires_review, true)
  assert.equal(counted.refunds.length, 2)
  // A refund lawfully made in another account is still subtracted, and is still flagged.
  const chargeWithoutTotal = { ...charge, amount_refunded_cents: 0 }
  const otherAccount = singleCountProviderPayments([chargeWithoutTotal, { ...first, account_key: 'operating' }])
  assert.equal(otherAccount.total_cents, 388000)
  assert.equal(otherAccount.requires_review, true)
  // A refund the provider voided moves nothing at all.
  const voided = singleCountProviderPayments([charge, { ...first, status: 'VOID' }])
  assert.equal(voided.total_cents, 388000)
  assert.equal(voided.requires_review, false)
  assert.equal(singleCountProviderPayments([]).total_cents, 0)
})

test('a correction preview states the reversal and the replacement once each, and refuses to offer an impossible correction', () => {
  const transaction = { gateway_transaction_id: 'charge-1', transaction_type: 'CHARGE', status: 'COMPLETED', amount_cents: 500000, currency: 'USD' }
  const trustPosting = { id: 'classification-1', posting_status: 'posted', gateway_transaction_id: 'charge-1', matter_id: 'matter-1', actual_account_key: 'trust', direction: 'in', amount_cents: 500000, currency: 'USD', owner: 'ben@firm' }
  const toOperating = correctionPreview({ previous: trustPosting, transaction, resolvedAccount: { account_key: 'operating', provenance: 'reported_by_lawpay' }, category: 'consultation_payment', matter: { id: 'matter-1', name: 'Matter One' }, reason: 'The money reached the operating account, not IOLTA.' })
  assert.equal(toOperating.ok, true, toOperating.errors.join(' '))
  assert.equal(toOperating.reversal.direction, 'out', 'the reversal of a trust credit is a trust debit')
  assert.equal(toOperating.reversal.trust_delta_cents, -500000)
  assert.equal(toOperating.replacement.trust_delta_cents, 0)
  assert.equal(toOperating.trust_delta_cents, -500000, 'correcting trust to operating takes the trust credit back exactly once')
  assert.equal(toOperating.correction.corrects_classification_id, 'classification-1')
  assert.match(toOperating.lines.join(' '), /undoing a trust credit/)
  assert.match(toOperating.lines.join(' '), /Trust balance change overall: −\$5000\.00/)
  const fromOperating = correctionPreview({ previous: { ...trustPosting, actual_account_key: 'operating', direction: 'in' }, transaction, resolvedAccount: { account_key: 'trust', provenance: 'manually_verified' }, category: 'trust_deposit', matter: { id: 'matter-1', name: 'Matter One' }, reason: 'The deposit went to IOLTA after all.' })
  assert.equal(fromOperating.ok, true, fromOperating.errors.join(' '))
  assert.equal(fromOperating.reversal.trust_delta_cents, 0, 'an operating posting never moved trust, so its reversal does not either')
  assert.equal(fromOperating.replacement.trust_delta_cents, 500000)
  assert.equal(fromOperating.trust_delta_cents, 500000, 'correcting operating to trust adds the trust credit exactly once')
  const noReason = correctionPreview({ previous: trustPosting, transaction, resolvedAccount: { account_key: 'operating', provenance: 'reported_by_lawpay' }, category: 'consultation_payment', reason: '' })
  assert.equal(noReason.ok, false)
  assert.match(noReason.errors.join(' '), /Explain why/)
  assert.equal(noReason.correction, null)
  const notPosted = correctionPreview({ previous: { ...trustPosting, posting_status: 'saved' }, transaction, resolvedAccount: { account_key: 'operating', provenance: 'reported_by_lawpay' }, category: 'consultation_payment', reason: 'wrong account' })
  assert.equal(notPosted.ok, false)
  assert.match(notPosted.errors.join(' '), /Only a recorded transaction can be corrected/)
  const voided = correctionPreview({ previous: trustPosting, transaction, resolvedAccount: { account_key: 'trust', provenance: 'reported_by_lawpay' }, category: 'void', reason: 'voided' })
  assert.equal(voided.ok, false, 'a correction cannot record a transaction that moves no money')
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
