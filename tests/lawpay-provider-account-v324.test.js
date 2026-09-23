// V324: a payment created directly in LawPay is recognized from the provider's own account
// identifier, an identifier that is supplied but unmapped is never confused with one that is
// missing, one mapping resolves every transaction carrying that identifier, and resolving an
// account never moves money. Synthetic identifiers only.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCOUNT_PROVENANCE_LABELS, accountProvenanceLabel, accountRegistry, accountReresolutionPlan,
  configuredAccountKey, maskAccountId, providerAccountOutcome, refundProviderAccount, refundRelationshipVerified,
} from '../src/mioLawPayAccounts.js'
import { postingEligibility } from '../src/mioLawPayClassification.js'

// The firm's configured card/eCheck deposit accounts. Secrets are strings, exactly as they arrive
// from the environment; the provider may describe the same account with a number.
const environment = { trust: '91075', operating: '91077', echeck_trust: '91076', echeck_operating: '91078', clientcredit_trust: '91079' }
const mapped = accountRegistry({ rows: [], environment })
const unmappedRegistry = accountRegistry({ rows: [], environment: {} })

// A charge created directly in LawPay: no Mio payment link, and on some of these a matter and a
// client are present on purpose, to prove that neither ever names the deposit account.
const directCharge = (over = {}) => ({ gateway_transaction_id: 'direct-charge-1', transaction_type: 'CHARGE', status: 'COMPLETED', amount_cents: 100000, amount_refunded_cents: 0, currency: 'USD', occurred_at: '2026-09-20T15:00:00Z', raw: {}, ...over })

test('a direct-LawPay trust payment is recognized as trust without a Mio payment link', () => {
  const outcome = providerAccountOutcome({ transaction: directCharge({ account_id: '91075', raw: { mio_matter_id: 'matter-alpha' } }), registry: mapped })
  assert.equal(outcome.state, 'trust')
  assert.equal(outcome.account_key, 'trust')
  assert.equal(outcome.provenance, 'reported_by_lawpay')
  assert.equal(accountProvenanceLabel(outcome), ACCOUNT_PROVENANCE_LABELS.trust)
})

test('a direct-LawPay operating payment is recognized as operating', () => {
  const outcome = providerAccountOutcome({ transaction: directCharge({ account_id: '91077' }), registry: mapped })
  assert.equal(outcome.state, 'operating')
  assert.equal(accountProvenanceLabel(outcome), ACCOUNT_PROVENANCE_LABELS.operating)
})

test('card and eCheck variants keep their own identifier and land in the right family', () => {
  const cases = [['91075', 'trust'], ['91076', 'trust'], ['91079', 'trust'], ['91077', 'operating'], ['91078', 'operating']]
  for (const [accountId, family] of cases) {
    const outcome = providerAccountOutcome({ transaction: directCharge({ account_id: accountId }), registry: mapped })
    assert.equal(outcome.state, family, `provider account ${maskAccountId(accountId)} must resolve to ${family}`)
    assert.equal(outcome.provider_account_id, accountId)
  }
})

test('a numeric provider identifier matches the configured string and is never rewritten', () => {
  assert.equal(configuredAccountKey({ providerAccountId: 91075, accounts: environment }), 'trust')
  assert.equal(configuredAccountKey({ providerAccountId: '91075', accounts: environment }), 'trust')
  const numeric = providerAccountOutcome({ transaction: directCharge({ account_id: 91075 }), registry: mapped })
  assert.equal(numeric.state, 'trust')
  assert.equal(numeric.provider_account_id, '91075', 'a numeric identifier is converted to a string and otherwise left untouched')
  // Nothing is trimmed, padded or lowercased, so an identifier that differs by whitespace or case is
  // a different account and must never silently resolve.
  assert.equal(providerAccountOutcome({ transaction: directCharge({ account_id: ' 91075' }), registry: mapped }).state, 'unmapped')
  const caseSensitive = accountRegistry({ rows: [{ provider_account_id: 'acct-1', account_key: 'trust', is_active: true }] })
  assert.equal(providerAccountOutcome({ transaction: directCharge({ account_id: 'ACCT-1' }), registry: caseSensitive }).state, 'unmapped')
})

test('a supplied identifier with no mapping is unmapped, not missing', () => {
  const outcome = providerAccountOutcome({ transaction: directCharge({ account_id: '55123', raw: { mio_matter_id: 'matter-alpha' } }), registry: unmappedRegistry })
  assert.equal(outcome.state, 'unmapped')
  assert.equal(accountProvenanceLabel(outcome), 'Unmapped LawPay account ending ••••5123')
  assert.equal(outcome.account_key, '', 'an unmapped account is not an established account')
})

test('a missing identifier says so, and is a different condition from an unmapped one', () => {
  const outcome = providerAccountOutcome({ transaction: directCharge({ account_id: '', raw: { mio_matter_id: 'matter-alpha', mio_client_id: 'client-alpha' } }), registry: unmappedRegistry })
  assert.equal(outcome.state, 'not_supplied')
  assert.equal(accountProvenanceLabel(outcome), ACCOUNT_PROVENANCE_LABELS.not_supplied)
  assert.notEqual(accountProvenanceLabel(outcome), accountProvenanceLabel({ state: 'unmapped', masked: '••••5123' }), 'the two conditions must never be described as the same problem')
  // A matter, a client or an invoice never names the deposit account.
  const withMatter = providerAccountOutcome({ transaction: directCharge({ account_id: '', raw: { mio_matter_id: 'matter-alpha' } }), registry: mapped })
  assert.equal(withMatter.state, 'not_supplied')
})

test('one mapping resolves several older unresolved transactions and moves nothing', () => {
  const older = [
    directCharge({ gateway_transaction_id: 'older-1', account_id: 91075, account_key: '', raw: { mio_account_key_source: 'unresolved', mio_matter_id: 'matter-alpha' } }),
    directCharge({ gateway_transaction_id: 'older-2', account_id: '91075', account_key: '', raw: { mio_account_key_source: 'unresolved' } }),
    directCharge({ gateway_transaction_id: 'older-3', account_id: '91075', account_key: 'operating', raw: { mio_account_key_source: 'unresolved' } }),
    directCharge({ gateway_transaction_id: 'older-4', account_id: '55123', account_key: '', raw: { mio_account_key_source: 'provider_account_unmapped' } }),
    directCharge({ gateway_transaction_id: 'older-5', account_id: '', account_key: '', raw: { mio_account_key_source: 'not_supplied' } }),
    directCharge({ gateway_transaction_id: 'older-6', account_id: '91075', account_key: 'trust', raw: { mio_account_key_source: 'configured_account' } }),
  ]
  const plan = accountReresolutionPlan({ transactions: older, registry: mapped })
  assert.deepEqual(plan.updates.map((update) => update.gateway_transaction_id), ['older-1', 'older-2', 'older-3'], 'every transaction carrying the mapped identifier is re-resolved')
  assert.deepEqual(plan.unchanged.map((update) => update.gateway_transaction_id), ['older-6'], 'a row that is already correct is left alone')
  assert.deepEqual(plan.skipped.map((update) => update.gateway_transaction_id), ['older-4', 'older-5'], 'still-unmapped and not-supplied rows are reported, never guessed')
  assert.equal(plan.money_effects, 0)
  assert.equal(plan.balances_changed, 0)
  assert.equal(plan.ledger_rows_created, 0)
  const storedKeys = { 'older-1': '', 'older-2': '', 'older-3': 'operating' }
  for (const update of plan.updates) {
    assert.equal(update.posts_money, false)
    assert.equal(update.balances_changed, false)
    assert.equal(update.selects_client_or_matter, false)
    assert.equal(update.applies_to_invoice, false)
    assert.equal(update.issues_refund, false)
    assert.equal(update.creates_financial_entry, false)
    assert.deepEqual(update.touches_money_fields, [])
    assert.deepEqual(Object.keys(update.after).sort(), ['account_key', 'provenance'], 'only the account classification and its provenance change')
    assert.equal(update.before.account_key, storedKeys[update.gateway_transaction_id], 'the value that was there before is preserved for the audit trail')
  }
  assert.equal(plan.updates[2].before.account_key, 'operating', 'a stored account the mapping contradicts is corrected and the older value is kept in before')
  assert.equal(Object.prototype.hasOwnProperty.call(plan.updates[0], 'matter_id'), false, 'a matter association is never part of the decision')
})

test('a refund inherits the account only with a verified immutable relationship', () => {
  const charge = directCharge({ gateway_transaction_id: 'charge-9', account_id: '91075' })
  const linked = directCharge({ gateway_transaction_id: 'refund-9', transaction_type: 'REFUND', amount_cents: 112000, account_id: '', raw: { refunded_transaction_id: 'charge-9' } })
  const guessed = directCharge({ gateway_transaction_id: 'refund-10', transaction_type: 'REFUND', amount_cents: 15000, account_id: '', raw: { original_transaction_id: '' } })
  assert.equal(refundRelationshipVerified({ refund: linked, charge }), true)
  assert.equal(refundRelationshipVerified({ refund: guessed, charge }), false)
  const inherited = refundProviderAccount({ refund: linked, charge, registry: mapped })
  assert.equal(inherited.inherited, true)
  assert.equal(inherited.inherited_from, 'charge-9')
  assert.equal(inherited.account_key, 'trust')
  const alone = refundProviderAccount({ refund: guessed, charge, registry: mapped })
  assert.equal(alone.inherited, false)
  assert.equal(alone.state, 'not_supplied', 'an unverified relationship leaves the refund unresolved')
  assert.equal(alone.account_key, '')
})

test('resolution is a function of stored data plus mapping, so it survives a refresh', () => {
  const stored = { gateway_transaction_id: 'direct-charge-1', account_id: '91075', account_key: '', raw: { mio_account_key_source: 'provider_account_unmapped' } }
  const before = providerAccountOutcome({ transaction: stored, registry: mapped })
  const afterRefresh = providerAccountOutcome({ transaction: JSON.parse(JSON.stringify(stored)), registry: mapped })
  assert.deepEqual(afterRefresh, before, 'a reload resolves the same stored row to the same account')
  assert.equal(afterRefresh.state, 'trust')
  const stillUnmapped = providerAccountOutcome({ transaction: { ...stored, account_id: '55123' }, registry: mapped })
  assert.equal(stillUnmapped.state, 'unmapped', 'without a mapping the row stays unmapped after a reload, and says so')
  // What the gateway returns after it has resolved the row against the firm's mapping: a page that
  // only ever sees the gateway's answer must still name the account.
  const fromGateway = providerAccountOutcome({ transaction: { gateway_transaction_id: 'direct-charge-1', account_id: 91075, resolved_account_key: 'trust', resolved_account_source: 'environment', resolved_account_label: 'Trust / IOLTA ••••1075' } })
  assert.equal(fromGateway.state, 'trust')
  assert.equal(accountProvenanceLabel(fromGateway), ACCOUNT_PROVENANCE_LABELS.trust)
  const gatewayUnmapped = providerAccountOutcome({ transaction: { gateway_transaction_id: 'direct-charge-2', account_id: '55123', resolved_account_key: '', resolved_account_source: '' } })
  assert.equal(gatewayUnmapped.state, 'unmapped')
  assert.equal(accountProvenanceLabel(gatewayUnmapped), 'Unmapped LawPay account ending ••••5123')
})

test('a failed, closed or unfinished record can never post, whatever account it carries', () => {
  const charge = (status) => ({ gateway_transaction_id: 'direct-charge-1', transaction_type: 'CHARGE', status, amount_cents: 100000, amount_refunded_cents: 0, currency: 'USD', occurred_at: '2026-09-20T15:00:00Z', account_id: '91075', raw: {} })
  const eligible = postingEligibility({ transaction: charge('COMPLETED'), category: 'trust_deposit' })
  assert.equal(eligible.eligible, true, `a completed charge with an established account should be postable: ${eligible.reason || ''}`)
  for (const status of ['FAILED', 'closed', 'VOID', 'DECLINED', 'PENDING', 'AUTHORIZED']) {
    const refused = postingEligibility({ transaction: charge(status), category: 'trust_deposit' })
    assert.equal(refused.eligible, false, `a ${status} record must never be postable`)
    assert.ok(String(refused.reason || '').length > 0, `a refusal must say why for ${status}`)
  }
})
