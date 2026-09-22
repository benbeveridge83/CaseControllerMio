// Legacy Bulk Billing reconciliation (V323): linking the attribution records and trust rows the
// old screen wrote to the canonical classification workflow, without ever posting money again.
//
// The rules are deliberately narrow:
//   * an automatic link needs the immutable LawPay provider transaction id plus consistent
//     amount, direction, matter and deposit-account evidence;
//   * anything else stays unresolved (nothing to link yet) or conflicting (the evidence
//     disagrees), and it waits for a human review instead of being guessed;
//   * a link records the relationship only. It never posts a ledger row, never reverses one and
//     never rewrites the legacy record: the original is preserved and only annotated with the
//     link it received, so the audit trail keeps both sides;
//   * the planner is pure and the dry run is the planner plus its report, so a dry run writes
//     nothing at all;
//   * running the whole thing again reports the same cases as already linked and links nothing
//     new, which is what makes it safe to run twice.

export const RECONCILIATION_OUTCOMES = ['matched', 'already_linked', 'unresolved', 'conflicting']
export const RECONCILIATION_LINK_SOURCE = 'legacy_attribution_reconciliation'

// The immutable provider identity. The legacy screens stored it under three different names.
export function legacyProviderId(record = {}) {
  return String(record.gateway_transaction_id || record.lawpay_transaction_id || record.attribution_key || record.transaction_id || '').trim()
}

function toCents(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(Math.abs(number) * 100) : null
}

function toDollars(cents) {
  return Math.round(Number(cents)) / 100
}

function accountKind(key) {
  const value = String(key || '').trim().toLowerCase()
  if (!value) return ''
  if (value.includes('trust') || value.includes('iolta')) return 'trust'
  if (value.includes('operating')) return 'operating'
  return value
}

// A legacy row says the money went to trust when it is a trust deposit or a trust refund, and to
// operating when the old rule recorded an operating association.
function legacyAccountKind(record = {}) {
  const kind = String(record.entry_kind || record.kind || '').trim().toLowerCase()
  if (kind === 'trust_deposit' || kind === 'trust_refund') return 'trust'
  if (kind === 'operating_association' || kind === 'operating') return 'operating'
  return accountKind(record.account_key || record.account)
}

function legacyDirection(record = {}) {
  const declared = String(record.direction || '').trim().toLowerCase()
  if (declared === 'out' || record.money_out === true) return 'out'
  if (declared === 'in' || record.money_out === false) return 'in'
  const kind = String(record.entry_kind || '').trim().toLowerCase()
  if (kind === 'trust_refund') return 'out'
  return kind ? 'in' : ''
}

function legacyKeyOf(record = {}, source = '') {
  return `${String(source || 'legacy')}:${String(record.id || record.attribution_key || record.lawpay_transaction_id || legacyProviderId(record))}`
}

// One legacy case: what the old screen recorded, what the canonical workflow holds, and whether
// the two are the same payment or a disagreement a human has to settle.
function legacyCase({ source, record, classifications, ledgerEntries, links }) {
  const providerId = legacyProviderId(record)
  const legacy = {
    source,
    key: legacyKeyOf(record, source),
    id: String(record.id || ''),
    entry_kind: String(record.entry_kind || ''),
    decision: String(record.decision || ''),
    amount_cents: legacyAmountCents(record),
    direction: legacyDirection(record),
    matter_id: String(record.matter_id || ''),
    account_key: legacyAccountKind(record),
  }
  const base = { provider_id: providerId, legacy_key: legacy.key, legacy, canonical: null, link: null, evidence: [], conflicts: [] }
  if (!providerId) {
    return { ...base, outcome: 'unresolved', reason: 'The legacy row has no immutable LawPay provider id, so it can never be linked automatically.' }
  }
  const candidates = (classifications || []).filter((candidate) => String(candidate.gateway_transaction_id || candidate.identity || '') === providerId
    || String(candidate.identity || '').endsWith(`:${providerId}`))
  if (!candidates.length) {
    return { ...base, outcome: 'unresolved', reason: 'The canonical workflow holds no classification for this provider transaction yet.' }
  }
  if (candidates.length > 1) {
    return { ...base, outcome: 'conflicting', conflicts: ['multiple_canonical_classifications'], reason: `The canonical workflow holds ${candidates.length} classifications for this provider transaction, so a human must choose.` }
  }
  const classification = candidates[0]
  const entry = (ledgerEntries || []).filter((row) => String(row.classification_id || '') === String(classification.id || '')
    || String(row.identity || '').endsWith(`:${providerId}`))
  const canonical = {
    classification_id: String(classification.id || ''),
    posting_status: String(classification.posting_status || ''),
    amount_cents: classification.amount_cents === undefined ? null : toCents(Number(classification.amount_cents) / 100),
    direction: legacyDirection(classification) || (entry[0] ? legacyDirection(entry[0]) : ''),
    matter_id: String(classification.matter_id || ''),
    account_key: accountKind(classification.actual_account_key),
    ledger_entry_ids: entry.map((row) => String(row.id || '')),
  }
  const linked = (links || []).find((row) => String(row.legacy_key || '') === legacy.key)
  const result = { ...base, canonical, conflicts: [] }
  if (linked || String(classification.reconciled_legacy_key || '') === legacy.key) {
    return { ...result, outcome: 'already_linked', reason: 'This legacy row is already linked to the canonical classification.', link: { legacy_key: legacy.key, classification_id: canonical.classification_id, source: RECONCILIATION_LINK_SOURCE, posts_money: false } }
  }
  const evidence = ['provider id matches']
  if (!canonical.account_key) result.conflicts.push('canonical_account_not_established')
  else if (legacy.account_key && legacy.account_key !== canonical.account_key) result.conflicts.push('account_mismatch')
  else evidence.push(`deposit account is ${canonical.account_key}`)
  if (legacy.amount_cents === null || canonical.amount_cents === null) result.conflicts.push('amount_unknown')
  else if (legacy.amount_cents !== canonical.amount_cents) result.conflicts.push('amount_mismatch')
  else evidence.push(`amount is ${toDollars(canonical.amount_cents)}`)
  if (legacy.direction && canonical.direction && legacy.direction !== canonical.direction) result.conflicts.push('direction_mismatch')
  else evidence.push(`direction is ${canonical.direction || legacy.direction || 'in'}`)
  if (legacy.matter_id && canonical.matter_id && legacy.matter_id !== canonical.matter_id) result.conflicts.push('matter_mismatch')
  else if (legacy.matter_id) evidence.push('matter matches')
  if (result.conflicts.length) {
    return { ...result, outcome: 'conflicting', evidence, reason: `The evidence disagrees (${result.conflicts.join(', ')}), so Mio will not link it automatically.` }
  }
  return {
    ...result,
    outcome: 'matched',
    evidence,
    reason: 'The legacy row and the canonical classification describe the same payment, so the link can be recorded without posting anything.',
    link: {
      legacy_key: legacy.key,
      legacy_source: source,
      gateway_transaction_id: providerId,
      classification_id: canonical.classification_id,
      ledger_entry_ids: canonical.ledger_entry_ids,
      source: RECONCILIATION_LINK_SOURCE,
      posts_money: false,
    },
  }
}

// The dry-run planner. Pure: it reads evidence and proposes links, and it holds no posting path at
// all — a reconciliation link is a relationship, never a money movement.
export function legacyReconciliationPlan({ legacyRecords = [], legacyEntries = [], classifications = [], ledgerEntries = [], links = [] } = {}) {
  const cases = [
    ...(legacyEntries || []).map((record) => legacyCase({ source: 'legacy_trust_entry', record, classifications, ledgerEntries, links })),
    ...(legacyRecords || []).map((record) => legacyCase({ source: 'legacy_attribution_record', record, classifications, ledgerEntries, links })),
  ]
  const byOutcome = (outcome) => cases.filter((item) => item.outcome === outcome)
  return {
    cases,
    matched: byOutcome('matched'),
    already_linked: byOutcome('already_linked'),
    unresolved: byOutcome('unresolved'),
    conflicting: byOutcome('conflicting'),
    posting_actions: [],
    summary: {
      total: cases.length,
      matched: byOutcome('matched').length,
      already_linked: byOutcome('already_linked').length,
      unresolved: byOutcome('unresolved').length,
      conflicting: byOutcome('conflicting').length,
    },
  }
}

export function legacyReconciliationReport(plan = {}) {
  const summary = plan.summary || { total: 0, matched: 0, already_linked: 0, unresolved: 0, conflicting: 0 }
  const lines = [
    'LawPay legacy reconciliation dry run: nothing was written and nothing was posted.',
    `cases ${summary.total} · linkable ${summary.matched} · already linked ${summary.already_linked} · unresolved ${summary.unresolved} · conflicting ${summary.conflicting}`,
  ]
  for (const item of plan.cases || []) {
    const where = `${item.legacy.source} ${item.legacy.id || item.legacy.key} (${item.provider_id || 'no provider id'})`
    if (item.outcome === 'matched') lines.push(`link     ${where} -> classification ${item.canonical.classification_id}: ${item.evidence.join('; ')}`)
    if (item.outcome === 'already_linked') lines.push(`linked   ${where} - already linked, nothing to do`)
    if (item.outcome === 'unresolved') lines.push(`review   ${where} - ${item.reason}`)
    if (item.outcome === 'conflicting') lines.push(`conflict ${where} - ${item.conflicts.join(', ')}: ${item.reason}`)
  }
  return lines.join('\n')
}

// Applying a plan links the matched cases and nothing else. `link` is the caller's writer (the
// gateway's match action or the reconciliation RPC) and it records the relationship only. A dry run
// never calls it, so a dry run cannot change anything even by accident.
export async function applyLegacyReconciliation({ plan = {}, dryRun = true, link = null, at = '' } = {}) {
  if (dryRun) return { ok: true, dry_run: true, linked: [], refused: [], summary: plan.summary || {}, report: legacyReconciliationReport(plan) }
  if (typeof link !== 'function') return { ok: false, dry_run: false, error: 'A reconciliation run needs a link writer; it never posts money itself.', linked: [], refused: [] }
  const linked = []
  const refused = []
  for (const item of plan.matched || []) {
    try {
      const written = await link({ ...item.link, linked_at: at || new Date().toISOString() })
      if (written && written.ok === false) refused.push({ legacy_key: item.legacy_key, reason: written.error || 'The link was refused.' })
      else linked.push(item.legacy_key)
    } catch (error) {
      refused.push({ legacy_key: item.legacy_key, reason: error?.message || String(error) })
    }
  }
  return { ok: refused.length === 0, dry_run: false, linked, refused, summary: plan.summary || {} }
}


function legacyAmountCents(record = {}) {
  if (record.amount_cents !== undefined) return toCents(Number(record.amount_cents) / 100)
  return toCents(record.amount)
}
