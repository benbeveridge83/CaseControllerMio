// Duplicate handling for outgoing discovery requests. An exact duplicate is
// included once; muted reference rows remain under every affected relief.
// Similar wording is surfaced for attorney review, never auto-merged.
// Never deduplicate across different recipients or instrument types.

export function normalizeWording(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function exactDuplicateKey({ type = '', text = '', recipient = '', timePeriod = '', scope = '' } = {}) {
  return [
    String(type || '').trim(),
    normalizeWording(recipient),
    normalizeWording(timePeriod),
    normalizeWording(scope),
    normalizeWording(text)
  ].join('\u0001')
}

export function wordingTokens(text) {
  return new Set(normalizeWording(text).split(/[^a-z0-9]+/).filter(Boolean))
}

export function tokenOverlap(a, b) {
  const ta = wordingTokens(a)
  const tb = wordingTokens(b)
  if (!ta.size && !tb.size) return 1
  if (!ta.size || !tb.size) return 0
  let intersection = 0
  for (const token of ta) if (tb.has(token)) intersection += 1
  return intersection / Math.min(ta.size, tb.size)
}

const SIMILAR_THRESHOLD = 0.85

export function classifyDuplicate(a, b) {
  const aType = String(a?.type || '').trim()
  const bType = String(b?.type || '').trim()
  // Never deduplicate across different instrument types or recipients.
  if (aType !== bType) return 'distinct'
  if (normalizeWording(a?.recipient) !== normalizeWording(b?.recipient)) return 'distinct'
  // Exact: identical wording, recipient, type, time period, and scope.
  if (exactDuplicateKey(a) === exactDuplicateKey(b)) return 'exact'
  // Similar wording is a "possible duplicate" for review, never auto-merged.
  if (tokenOverlap(a?.text, b?.text) >= SIMILAR_THRESHOLD) return 'similar'
  return 'distinct'
}
