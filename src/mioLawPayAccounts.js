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
// being filled in. Registry rows always win over the environment seed.
export function accountRegistry({ rows = [], environment = {} } = {}) {
  const active = [], problems = [], duplicates = []
  const seen = new Map()
  for (const row of rows || []) {
    const problem = registryRowProblem(row)
    if (problem) { problems.push({ provider_account_id: maskAccountId(row.provider_account_id), problem }); continue }
    const id = accountIdValue(row.provider_account_id)
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
    .filter((row) => !byProviderId.has(accountIdValue(row.provider_account_id)))
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
