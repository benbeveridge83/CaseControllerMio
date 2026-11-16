// Relief -> discovery-library mapping. A mapping associates a library item
// with an issue or a specific relief option, a source side, and party roles.
// Keep associations at the option level when needed: the same issue can
// require different content for "other parent pays" vs. "my client pays".

export function normalizeReliefMapping(mapping, index = 0) {
  const sourceSide = mapping?.source_side === 'theirs' ? 'theirs'
    : mapping?.source_side === 'either' ? 'either'
    : 'ours'
  return {
    id: String(mapping?.id || `map-${index}-${Date.now()}`),
    issue_id: mapping?.issue_id ? String(mapping.issue_id) : '',
    option_id: mapping?.option_id ? String(mapping.option_id) : '',
    source_side: sourceSide,
    requesting_role: String(mapping?.requesting_role || ''),
    responding_role: String(mapping?.responding_role || ''),
    discovery_type: String(mapping?.discovery_type || ''),
    library_item_id: String(mapping?.library_item_id || ''),
    library_item_version: Number(mapping?.library_item_version || 1),
    default_inclusion: mapping?.default_inclusion !== false,
    is_active: mapping?.is_active !== false
  }
}

export function isGeneralMapping(mapping) {
  return !mapping.issue_id && !mapping.option_id
}

export function mappingSideMatches(mapping, sourceSide = '') {
  if (mapping.source_side === 'either') return true
  if (!sourceSide) return true
  return mapping.source_side === sourceSide
}

export function mappingMatches(mapping, { issueId = '', issueIds = [], optionId = '', sourceSide = '' } = {}) {
  if (!mapping || mapping.is_active === false) return false
  if (!mappingSideMatches(mapping, sourceSide)) return false
  if (mapping.option_id) {
    return Boolean(optionId) && String(mapping.option_id) === String(optionId)
  }
  if (mapping.issue_id) {
    if (issueId && String(mapping.issue_id) === String(issueId)) return true
    return (issueIds || []).some((id) => String(mapping.issue_id) === String(id))
  }
  return false
}

// A mapping matches a relief group when the group's option or any ancestor issue
// is mapped on the same side. Groups that have no option fall back to the issue.
export function mappingsForGroup(mappings, group) {
  return mappings.filter((mapping) =>
    mappingMatches(mapping, { issueId: group?.issue_id, issueIds: group?.issue_ids || [], optionId: group?.option_id, sourceSide: group?.source_side }))
}
