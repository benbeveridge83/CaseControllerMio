// Shared, Deno-safe helpers for the LawPay deposit-account mapping and its diagnostics (V323).
// Plain ESM with no Deno or Node APIs so the same code runs in the gateway and in Node tests.
//
// Provider account IDs are opaque: never lowercased, padded or trimmed. The only coercion is
// null-safe string conversion, so a numeric provider ID matches its configured string while
// "ACCT-1" never matches "acct-1".
export const ACCOUNT_KEYS = ['operating', 'trust', 'echeck_operating', 'echeck_trust', 'clientcredit_trust']
// The firm's own finance administrators. An authenticated session is not enough: the endpoint
// must also recognise the caller, so posting and account mapping stay restricted.
export const DEFAULT_FINANCE_ADMIN = 'ben@beveridgelawfirm.com'

export function financeAdminAllowed(email, allowlist = '', defaultAdmin = DEFAULT_FINANCE_ADMIN) {
  const wanted = String(email || '').trim().toLowerCase()
  if (!wanted) return false
  const allowed = String(allowlist || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  return (allowed.length ? allowed : [String(defaultAdmin).toLowerCase()]).includes(wanted)
}

export function accountIdValue(value) {
  if (value === null || value === undefined) return ''
  return String(value)
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
  if (value.includes('trust')) return 'trust'
  if (value.includes('operating')) return 'operating'
  return ''
}
export function registryRowProblem(row = {}) {
  if (!accountIdValue(row.provider_account_id)) return 'missing provider account ID'
  if (!ACCOUNT_KEYS.includes(accountIdValue(row.account_key))) return 'unknown Mio account key'
  if (row.is_active === false) return 'inactive mapping'
  return ''
}
// Registry rows win over the environment seed, so an installation keeps working while the
// administrator mapping is being filled in. An explicit mapping also shadows the environment
// for that provider account, even when it is inactive, so deactivating a mapping is not undone
// silently by the seed.
export function accountRegistry({ rows = [], environment = {} } = {}) {
  const active = [], problems = [], duplicates = []
  const seen = new Set(), mapped = new Set()
  for (const row of rows || []) {
    const id = accountIdValue(row.provider_account_id)
    if (id) mapped.add(id)
    const problem = registryRowProblem(row)
    if (problem) { problems.push({ provider_account_id: maskAccountId(row.provider_account_id), problem }); continue }
    if (seen.has(id)) { duplicates.push({ provider_account_last4: maskAccountId(id), account_key: accountIdValue(row.account_key) }); continue }
    seen.add(id)
    active.push({ ...row, source: row.source || 'registry' })
  }
  const environmentOnly = ACCOUNT_KEYS
    .filter((key) => accountIdValue(environment?.[key]))
    .map((key) => ({ provider_account_id: accountIdValue(environment[key]), account_key: key, bank_account_id: '', bank_role: accountFamily(key), label: '', is_active: true, source: 'environment' }))
    .filter((row) => !mapped.has(accountIdValue(row.provider_account_id)))
  return {
    rows: active,
    problems,
    duplicates,
    environmentOnly,
    environmentShadowed: mapped.size - active.length,
    configuredCount: active.length + environmentOnly.length,
    matchProviderId(value) {
      const id = accountIdValue(value)
      if (!id) return null
      const stored = active.find((row) => sameProviderAccountId(row.provider_account_id, id))
      if (stored) return stored
      return environmentOnly.find((row) => sameProviderAccountId(row.provider_account_id, id)) || null
    },
  }
}

// Redacted administrator diagnostics. The response never contains a payer, an amount, an email,
// a reference or a full account identifier: provider account IDs are reduced to their last four
// characters and provider payload fields are named but never quoted.
export function buildAccountDiagnostics({ transactions = [], registry = accountRegistry(), events = [] } = {}) {
  const provenance = {}, accountLast4 = {}, idTypes = { string: 0, number: 0, absent: 0 }, unmapped = new Map(), fieldNames = new Set()
  let missingProviderAccountId = 0, withRefundedTotal = 0
  for (const transaction of transactions || []) {
    const raw = transaction?.raw && typeof transaction.raw === 'object' ? transaction.raw : {}
    const source = accountIdValue(raw.mio_account_key_source) || (accountIdValue(transaction.account_key) ? 'recorded' : 'unresolved')
    provenance[source] = (provenance[source] || 0) + 1
    const rawId = raw.account_id !== undefined ? raw.account_id : transaction?.account_id
    if (rawId === null || rawId === undefined || rawId === '') idTypes.absent += 1
    else if (typeof rawId === 'number') idTypes.number += 1
    else idTypes.string += 1
    if (Number(transaction?.amount_refunded_cents || 0) > 0) withRefundedTotal += 1
    const id = accountIdValue(rawId)
    if (!id) missingProviderAccountId += 1
    else {
      const masked = maskAccountId(id)
      accountLast4[masked] = (accountLast4[masked] || 0) + 1
      if (!registry.matchProviderId(id)) unmapped.set(masked, (unmapped.get(masked) || 0) + 1)
    }
    for (const key of Object.keys(raw)) if (/refund|reversal|original|parent|settle|batch|fee|account|merchant/i.test(key)) fieldNames.add(key)
  }
  return {
    transactions_reviewed: (transactions || []).length,
    by_provenance: provenance,
    provider_account_id_types: idTypes,
    missing_provider_account_id: missingProviderAccountId,
    transactions_with_a_refunded_total: withRefundedTotal,
    distinct_provider_accounts: accountLast4,
    unmapped_provider_accounts: [...unmapped.entries()].map(([last4, count]) => ({ account_last4: last4, transactions: count })),
    configured_accounts: [...registry.rows, ...registry.environmentOnly].map((row) => ({ account_key: accountIdValue(row.account_key), provider_account_last4: maskAccountId(row.provider_account_id), bank_account_id: accountIdValue(row.bank_account_id), source: row.source || 'registry' })),
    mapping_problems: registry.problems,
    mapping_duplicates: registry.duplicates,
    provider_field_names_present: [...fieldNames].sort(),
    provider_events_seen: (events || []).length,
    configured_account_count: registry.configuredCount,
  }
}
