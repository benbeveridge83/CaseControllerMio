// V323 shared gateway helpers: administrator authorization, the deposit-account registry built
// from the firm's own records plus the environment seed, and redacted diagnostics.
import test from 'node:test'
import assert from 'node:assert/strict'
import { accountRegistry, buildAccountDiagnostics, financeAdminAllowed, maskAccountId, sameProviderAccountId } from '../supabase/functions/_shared/lawpay-accounts-v323.js'

const environment = { operating: 'acct-91077', trust: 'acct-91075' }

test('only a recognised finance administrator may run diagnostics', () => {
  assert.equal(financeAdminAllowed('ben@beveridgelawfirm.com'), true)
  assert.equal(financeAdminAllowed('BEN@BeveridgeLawFirm.com'), true, 'the address is compared case-insensitively')
  assert.equal(financeAdminAllowed('someone@else.example'), false)
  assert.equal(financeAdminAllowed(''), false)
  assert.equal(financeAdminAllowed(undefined), false)
  assert.equal(financeAdminAllowed('staff@firm.example', 'ben@beveridgelawfirm.com, staff@firm.example'), true)
  assert.equal(financeAdminAllowed('ben@beveridgelawfirm.com', 'staff@firm.example'), false, 'an explicit allowlist replaces the default')
  assert.equal(financeAdminAllowed(' caller@firm.example ', 'caller@firm.example'), true, 'surrounding spaces are ignored')
})

test('the registry resolves provider IDs exactly, and mapping rows win over the environment', () => {
  assert.equal(sameProviderAccountId(91075, '91075'), true)
  assert.equal(sameProviderAccountId('ACCT-1', 'acct-1'), false)
  assert.equal(sameProviderAccountId(' acct-1', 'acct-1'), false)
  assert.equal(maskAccountId('acct-91075'), '••••1075')
  const registry = accountRegistry({
    rows: [
      { provider_account_id: 'acct-91075', account_key: 'echeck_trust', bank_account_id: 'plaid-trust', is_active: true },
      { provider_account_id: 'acct-91077', account_key: 'operating', is_active: false },
      { provider_account_id: '', account_key: 'trust' },
      { provider_account_id: 'acct-91075', account_key: 'operating' },
    ],
    environment,
  })
  assert.equal(registry.matchProviderId('acct-91075').account_key, 'echeck_trust', 'the administrator mapping wins over the environment seed')
  assert.equal(registry.matchProviderId('acct-91077'), null, 'an inactive mapping never resolves')
  assert.equal(registry.matchProviderId(''), null)
  assert.equal(registry.problems.length, 2, 'a missing provider account ID and an inactive mapping are both problems')
  assert.equal(registry.duplicates.length, 1)
  assert.equal(registry.configuredCount, 1, 'an unmapped account falls back to the environment only when it is not already mapped')
  const fallback = accountRegistry({ rows: [], environment })
  assert.equal(fallback.matchProviderId('acct-91075').account_key, 'trust')
  assert.equal(fallback.matchProviderId('acct-91075').source, 'environment')
})

test('diagnostics stay redacted and describe why an account could not be resolved', () => {
  const registry = accountRegistry({ rows: [{ provider_account_id: 'acct-91075', account_key: 'trust', bank_account_id: 'plaid-trust', is_active: true }], environment })
  const diagnostics = buildAccountDiagnostics({
    registry,
    transactions: [
      { gateway_transaction_id: 'charge-1', account_id: 'acct-91075', account_key: 'trust', amount_refunded_cents: 0, raw: { account_id: 'acct-91075', mio_account_key_source: 'configured_account', amount_refunded: 0 } },
      { gateway_transaction_id: 'charge-2', account_id: 91075, account_key: '', amount_refunded_cents: 2500, raw: { account_id: 91075, mio_account_key_source: 'unresolved', refunded_transaction_id: 'charge-1' } },
      { gateway_transaction_id: 'charge-3', account_id: '', account_key: '', amount_refunded_cents: 0, raw: { account_id: '' } },
    ],
  })
  assert.equal(diagnostics.transactions_reviewed, 3)
  assert.equal(diagnostics.provider_account_id_types.number, 1)
  assert.equal(diagnostics.provider_account_id_types.absent, 1)
  assert.equal(diagnostics.missing_provider_account_id, 1)
  assert.equal(diagnostics.transactions_with_a_refunded_total, 1)
  assert.equal(diagnostics.configured_account_count, 2)
  assert.equal(diagnostics.by_provenance.configured_account, 1)
  assert.equal(diagnostics.by_provenance.unresolved, 2, 'both the unmapped and the missing provider account row are unresolved')
  assert.ok(diagnostics.provider_field_names_present.includes('refunded_transaction_id'))
  const serialised = JSON.stringify(diagnostics)
  assert.equal(serialised.includes('acct-91075'), false, 'a full provider account ID is never returned')
  assert.equal(serialised.includes('payer'), false)
  assert.equal(serialised.includes('amount_cents'), false)
  const masked = diagnostics.distinct_provider_accounts
  assert.equal(masked['••••1075'], 2, 'the same account reported as a number and as a string is one masked entry')
})
