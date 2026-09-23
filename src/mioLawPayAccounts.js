// LawPay deposit-account mapping and resolution (V323).
//
// Provider account IDs are opaque identifiers. This module never lowercases, pads,
// trims or otherwise rewrites them, because no provider documentation confirming that
// normalization has been verified. The only coercion performed is null-safe string
// conversion, so a JSON number such as 1234567 and the configured string "1234567"
// resolve to the same identifier instead of failing a strict comparison. Whether the
// provider returns a number is not yet established; both shapes are accepted, and the
// shape actually seen is reported by accountDiagnostics() rather than assumed.
//
// The account is never inferred from a payer name, an amount, a matter, or an invoice.
// Only three sources may name it: a provider account ID matched against the firm's
// configured mapping, the Mio payment link that created the charge, or a recorded
// manual verification with evidence.

export const ACCOUNT_KEYS = ['operating', 'trust', 'echeck_operating', 'echeck_trust', 'clientcredit_trust']
export const PROVENANCE = ['reported_by_lawpay', 'payment_request', 'manually_verified', 'unresolved']
const trustKeys = new Set(['trust', 'echeck_trust', 'clientcredit_trust'])
const operatingKeys = new Set(['operating', 'echeck_operating'])

export function accountIdValue(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return text === '' ? '' : text
}
export function sameProviderAccountId(left, right) {
  const a = accountIdValue(left), b = accountIdValue(right)
  return !!a && !!b && a === b
}
export function maskAccountId(value) {
  const text = accountIdValue(value)
  if (!text) return ''
  return text.length <= 4 ? text : `••••${text.slice(-4)}`
}
export function accountFamily(key) {
  const value = accountIdValue(key)
  if (trustKeys.has(value)) return 'trust'
  if (operatingKeys.has(value)) return 'operating'
  return ''
}
export function registryRowRole(row = {}) {
  return ['trust', 'operating', 'other'].includes(String(row.bank_role || '')) ? String(row.bank_role) : accountFamily(row.account_key) || ''
}
// A mapping row is only usable when it names the provider account and the Mio account key.
// Inactive rows stay visible but never resolve.
export function registryRowProblem(row = {}) {
  if (!accountIdValue(row.provider_account_id)) return 'missing provider account ID'
  if (!ACCOUNT_KEYS.includes(accountIdValue(row.account_key))) return 'unknown Mio account key'
  if (row.is_active === false) return 'inactive mapping'
  return ''
}

// `rows` are mio_lawpay_accounts records; `environment` seeds the same keys from the
// gateway's LAWPAY_ACCOUNT_* secrets so an installation keeps working while the mapping is
// being filled in. Registry rows always win over the environment seed, and an explicit mapping
// shadows the environment for that provider account even when it is inactive, so deactivating a
// mapping is never undone silently by the seed.
export function accountRegistry({ rows = [], environment = {} } = {}) {
  const active = [], problems = [], duplicates = []
  const seen = new Map(), mapped = new Set()
  for (const row of rows || []) {
    const id = accountIdValue(row.provider_account_id)
    if (id) mapped.add(id)
    const problem = registryRowProblem(row)
    if (problem) { problems.push({ provider_account_id: maskAccountId(row.provider_account_id), problem }); continue }
    if (seen.has(id)) {
      duplicates.push({ provider_account_id: maskAccountId(id), account_keys: [seen.get(id).account_key, row.account_key].map(accountIdValue).filter(Boolean) })
      continue
    }
    seen.set(id, row)
    active.push(row)
  }
  const byProviderId = new Map(active.map((row) => [accountIdValue(row.provider_account_id), row]))
  const byKey = new Map()
  for (const row of active) if (!byKey.has(accountIdValue(row.account_key))) byKey.set(accountIdValue(row.account_key), row)
  const environmentOnly = ACCOUNT_KEYS
    .filter((key) => accountIdValue(environment?.[key]))
    .map((key) => ({ provider_account_id: accountIdValue(environment[key]), account_key: key, bank_account_id: '', bank_role: accountFamily(key), label: '', last4: maskAccountId(environment[key]).replace(/^•+/, ''), is_active: true, source: 'environment' }))
    .filter((row) => !mapped.has(accountIdValue(row.provider_account_id)))
  return {
    rows: active,
    problems,
    duplicates,
    byProviderId,
    byKey,
    environmentOnly,
    configuredCount: active.length + environmentOnly.length,
    matchProviderId(value) {
      const id = accountIdValue(value)
      if (!id) return null
      const stored = byProviderId.get(id)
      if (stored) return { ...stored, matched_by: 'provider_account_id', source: 'registry' }
      const seeded = environmentOnly.find((row) => sameProviderAccountId(row.provider_account_id, id))
      return seeded ? { ...seeded, matched_by: 'provider_account_id', source: 'environment' } : null
    },
    forKey(value) {
      const key = accountIdValue(value)
      if (!key) return null
      return byKey.get(key) || environmentOnly.find((row) => row.account_key === key) || null
    },
  }
}

// Resolution order, and nothing else: a recorded manual verification, then the provider
// account ID through the firm's mapping, then the Mio payment link that created the charge.
export function resolveTransactionAccount({ transaction = {}, registry = accountRegistry(), manual = null, paymentRequest = null } = {}) {
  const providerAccountId = accountIdValue(transaction.account_id || transaction.raw?.account_id)
  if (manual && ACCOUNT_KEYS.includes(accountIdValue(manual.account_key))) {
    return { provider_account_id: providerAccountId, account_key: accountIdValue(manual.account_key), bank_account_id: accountIdValue(manual.bank_account_id), provenance: 'manually_verified', matched_by: 'manual_verification', label: manual.label || '', manual }
  }
  const matched = registry.matchProviderId(providerAccountId)
  if (matched) {
    return { provider_account_id: providerAccountId, account_key: accountIdValue(matched.account_key), bank_account_id: accountIdValue(matched.bank_account_id), provenance: 'reported_by_lawpay', matched_by: matched.matched_by, label: matched.label || '', registry_source: matched.source || 'registry' }
  }
  const linked = accountIdValue(paymentRequest?.account_key || transaction.raw?.mio_payment_request_account_key)
  if (ACCOUNT_KEYS.includes(linked)) {
    return { provider_account_id: providerAccountId, account_key: linked, bank_account_id: '', provenance: 'payment_request', matched_by: 'payment_request', label: '' }
  }
  return { provider_account_id: providerAccountId, account_key: '', bank_account_id: '', provenance: 'unresolved', matched_by: '', label: '' }
}

// Redacted, administrator-facing diagnostics. No payer, amount, email, reference or full
// account identifier is ever returned: provider account IDs are truncated to their last
// four characters and raw payload fields are reported by name only.
export function accountDiagnostics({ transactions = [], registry = accountRegistry() } = {}) {
  const provenance = {}, accountLast4 = {}, idTypes = { string: 0, number: 0, absent: 0 }, unmapped = new Map(), fieldNames = new Set()
  let missingProviderAccountId = 0
  for (const transaction of transactions || []) {
    const raw = transaction?.raw && typeof transaction.raw === 'object' ? transaction.raw : {}
    const source = accountIdValue(raw.mio_account_key_source) || (accountIdValue(transaction.account_key) ? 'recorded' : 'unresolved')
    provenance[source] = (provenance[source] || 0) + 1
    const rawId = raw.account_id !== undefined ? raw.account_id : transaction?.account_id
    if (rawId === null || rawId === undefined || rawId === '') idTypes.absent += 1
    else if (typeof rawId === 'number') idTypes.number += 1
    else idTypes.string += 1
    const id = accountIdValue(rawId)
    if (!id) missingProviderAccountId += 1
    else {
      const masked = maskAccountId(id)
      accountLast4[masked] = (accountLast4[masked] || 0) + 1
      if (!registry.matchProviderId(id)) unmapped.set(masked, (unmapped.get(masked) || 0) + 1)
    }
    for (const key of Object.keys(raw)) if (/refund|reversal|original|parent|settle|batch|fee|account/i.test(key)) fieldNames.add(key)
  }
  return {
    transactions_reviewed: (transactions || []).length,
    by_provenance: provenance,
    provider_account_id_types: idTypes,
    missing_provider_account_id: missingProviderAccountId,
    distinct_provider_accounts: accountLast4,
    unmapped_provider_accounts: [...unmapped.entries()].map(([last4, count]) => ({ account_last4: last4, transactions: count })),
    configured_accounts: [...registry.rows, ...registry.environmentOnly].map((row) => ({ account_key: accountIdValue(row.account_key), provider_account_last4: maskAccountId(row.provider_account_id), bank_account_id: accountIdValue(row.bank_account_id), source: row.source || 'registry' })),
    mapping_problems: registry.problems,
    mapping_duplicates: registry.duplicates,
    provider_field_names_present: [...fieldNames].sort(),
    configured_account_count: registry.configuredCount,
  }
}

// A stored account key that the mapping now contradicts is a discrepancy to show, never a
// silent rewrite: the older value is preserved until an administrator confirms the change.
export function accountDiscrepancy({ storedKey = '', resolved = {} } = {}) {
  const before = accountIdValue(storedKey), after = accountIdValue(resolved.account_key)
  if (!before || !after || before === after) return null
  return { stored_account_key: before, resolved_account_key: after, resolved_provenance: resolved.provenance || '', reason: 'The stored deposit account no longer matches the configured LawPay account mapping.' }
}

// V324: recognizing the deposit account LawPay already supplied.
//
// A payment created directly in LawPay carries no Mio payment link, so the only things that can
// name its Mio account are the provider's own account identifier and the firm's mapping. This
// separates the two conditions the old screen collapsed into one "Account not reported" message:
//   * the provider supplied an identifier that has no mapping yet -> unmapped
//   * the provider supplied no identifier at all                  -> not supplied
//
// The identifier stays opaque: it is only ever converted null-safely to a string, exactly as
// accountIdValue does. It is never trimmed, lowercased, padded or otherwise rewritten, and it is
// never inferred from a payer name, an amount, a matter or an invoice.

export const PROVIDER_ACCOUNT_STATES = ['trust', 'operating', 'unmapped', 'not_supplied']
export const ACCOUNT_PROVENANCE_LABELS = {
  trust: 'LawPay deposit account: Trust',
  operating: 'LawPay deposit account: Operating',
  manually_verified: (family) => `Manually verified account: ${family}`,
  unmapped: (masked) => `Unmapped LawPay account ending ${masked || '••••'}`,
  not_supplied: 'Account not supplied by LawPay — manual verification required',
}

// The configured card/eCheck secrets are always strings and the provider may send a number.
// Comparing those with === silently fails for 91075 against '91075', which is precisely how a
// supplied account was lost: the transaction stayed unresolved even though LawPay had named the
// account. Comparison here is null-safe string comparison and nothing else.
export function configuredAccountKey({ providerAccountId = '', accounts = {} } = {}) {
  const wanted = accountIdValue(providerAccountId)
  if (!wanted) return ''
  for (const [key, value] of Object.entries(accounts || {})) {
    if (ACCOUNT_KEYS.includes(key) && sameProviderAccountId(value, wanted)) return key
  }
  return ''
}

// The single outcome the screen needs: the account family when it is known, or the precise reason
// it is not. `state` is one of PROVIDER_ACCOUNT_STATES.
export function providerAccountOutcome({ transaction = {}, registry = accountRegistry(), manual = null, paymentRequest = null } = {}) {
  const supplied = accountIdValue(transaction.account_id || transaction.raw?.account_id)
  // The gateway already resolves every transaction against the firm's mapping while reading it, and
  // returns what it found. A resolved key is authoritative; the supplied identifier is only used to
  // distinguish an unmapped account from one the provider never named.
  const gatewayResolved = accountIdValue(transaction.resolved_account_key)
  if (gatewayResolved && ACCOUNT_KEYS.includes(gatewayResolved)) {
    return { state: accountFamily(gatewayResolved) || 'unmapped', account_key: gatewayResolved, provenance: 'reported_by_lawpay', matched_by: 'gateway', provider_account_id: supplied, masked: maskAccountId(supplied), registry_source: accountIdValue(transaction.resolved_account_source), label: accountIdValue(transaction.resolved_account_label) }
  }
  const resolved = resolveTransactionAccount({ transaction, registry, manual, paymentRequest })
  const accountKey = accountIdValue(resolved.account_key)
  if (accountKey) {
    return { state: accountFamily(accountKey) || 'unmapped', account_key: accountKey, provenance: resolved.provenance || '', matched_by: resolved.matched_by || '', provider_account_id: supplied, masked: maskAccountId(supplied), registry_source: resolved.registry_source || '', label: resolved.label || '' }
  }
  return { state: supplied ? 'unmapped' : 'not_supplied', account_key: '', provenance: 'unresolved', matched_by: '', provider_account_id: supplied, masked: maskAccountId(supplied), registry_source: '', label: '' }
}

export function accountProvenanceLabel(outcome = {}) {
  if (outcome.state === 'not_supplied') return ACCOUNT_PROVENANCE_LABELS.not_supplied
  if (outcome.state === 'unmapped') return ACCOUNT_PROVENANCE_LABELS.unmapped(outcome.masked)
  const family = outcome.state === 'operating' ? 'Operating' : 'Trust'
  if (outcome.provenance === 'manually_verified') return ACCOUNT_PROVENANCE_LABELS.manually_verified(family)
  return family === 'Operating' ? ACCOUNT_PROVENANCE_LABELS.operating : ACCOUNT_PROVENANCE_LABELS.trust
}

// The ingest vocabulary and the resolution vocabulary describe the same facts with different words.
// Only the meaning is compared; the stored value itself is preserved in `before` for the audit trail.
export function accountProvenanceEquivalent(stored = '') {
  const value = accountIdValue(stored)
  if (value === 'configured_account' || value === 'provider_account') return 'reported_by_lawpay'
  if (value === 'payment_request') return 'payment_request'
  if (value === 'manually_verified') return 'manually_verified'
  return value
}

// Updating existing unresolved transactions after a mapping is created. The plan may change the
// account classification and its provenance, and nothing else: it posts no money, moves no balance,
// selects no client, matter or PNC, applies nothing to an invoice, issues no refund and creates no
// financial entry. Everything it must not do is stated explicitly on each update, so a caller
// cannot quietly widen it.
export function accountReresolutionPlan({ transactions = [], registry = accountRegistry(), manual = null } = {}) {
  const updates = [], unchanged = [], skipped = []
  for (const transaction of transactions || []) {
    const id = accountIdValue(transaction?.gateway_transaction_id || transaction?.id)
    if (!id) { skipped.push({ reason: 'This record has no immutable provider transaction id.' }); continue }
    const outcome = providerAccountOutcome({ transaction, registry, manual })
    const before = { account_key: accountIdValue(transaction.account_key), provenance: accountIdValue(transaction.raw?.mio_account_key_source) || (accountIdValue(transaction.account_key) ? 'recorded' : 'unresolved') }
    const beforeProvenance = accountProvenanceEquivalent(before.provenance)
    if (!outcome.account_key) {
      skipped.push({ gateway_transaction_id: id, reason: outcome.state === 'not_supplied' ? 'LawPay supplied no deposit account for this transaction.' : 'No mapping exists for this provider account yet.' })
      continue
    }
    if (before.account_key === outcome.account_key && beforeProvenance === outcome.provenance) {
      unchanged.push({ gateway_transaction_id: id, account_key: outcome.account_key })
      continue
    }
    updates.push({
      gateway_transaction_id: id,
      account_key: outcome.account_key,
      provenance: outcome.provenance,
      provider_account_id: outcome.provider_account_id,
      before,
      after: { account_key: outcome.account_key, provenance: outcome.provenance },
      posts_money: false,
      touches_money_fields: [],
      balances_changed: false,
      selects_client_or_matter: false,
      applies_to_invoice: false,
      issues_refund: false,
      creates_financial_entry: false,
    })
  }
  return { updates, unchanged, skipped, money_effects: 0, balances_changed: 0, ledger_rows_created: 0 }
}

// A refund inherits the deposit account of the transaction it reverses only when LawPay supplies a
// verified immutable relationship between the two. A guessed relationship never names an account:
// without the link the refund stays unresolved and a person decides it. Nothing here is inferred
// from a payer, an amount, a matter or an invoice.
export function refundRelationshipVerified({ refund = {}, charge = {} } = {}) {
  const refundId = accountIdValue(refund.gateway_transaction_id || refund.id)
  const chargeId = accountIdValue(charge.gateway_transaction_id || charge.id)
  if (!refundId || !chargeId) return false
  const linked = accountIdValue(refund.raw?.refunded_transaction_id || refund.raw?.original_transaction_id || refund.refunded_transaction_id)
  return !!linked && linked === chargeId
}

export function refundProviderAccount({ refund = {}, charge = null, registry = accountRegistry(), manual = null } = {}) {
  const own = providerAccountOutcome({ transaction: refund, registry, manual })
  if (own.account_key) return { ...own, inherited_from: '', inherited: false }
  if (!charge || !refundRelationshipVerified({ refund, charge })) return { ...own, inherited_from: '', inherited: false }
  const parent = providerAccountOutcome({ transaction: charge, registry, manual })
  if (!parent.account_key) return { ...own, inherited_from: '', inherited: false, relationship_verified: true }
  return { ...parent, inherited_from: accountIdValue(charge.gateway_transaction_id || charge.id), inherited: true, relationship_verified: true }
}
