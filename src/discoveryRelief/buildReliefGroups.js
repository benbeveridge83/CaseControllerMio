// Pure helpers that turn Mio's authenticated requested-relief + litigation-track
// state into composer relief groups. Call from App.jsx with data already loaded
// by the signed-in session; no database access happens here.

export function reliefOptionById(options = [], optionId) {
  return (Array.isArray(options) ? options : []).find((option) => String(option.id) === String(optionId)) || null
}

export function reliefOptionAncestorIds(optionId, options = []) {
  const byId = new Map((Array.isArray(options) ? options : []).map((option) => [String(option.id), option]))
  const ids = []
  let current = byId.get(String(optionId))
  let guard = 0
  while (current?.parent_id && guard < 40) {
    ids.push(String(current.parent_id))
    current = byId.get(String(current.parent_id))
    guard += 1
  }
  return ids
}

export function reliefOptionIssueIds(optionId, options = []) {
  return reliefOptionAncestorIds(optionId, options).filter((id) => {
    const row = reliefOptionById(options, id)
    return row && row.is_relief_option !== true
  })
}

export function reliefOptionIssueId(optionId, options = []) {
  const ids = reliefOptionIssueIds(optionId, options)
  return ids[0] || ''
}

export function reliefOptionPath(optionId, options = []) {
  const byId = new Map((Array.isArray(options) ? options : []).map((option) => [String(option.id), option]))
  const names = []
  let current = byId.get(String(optionId))
  let guard = 0
  while (current && guard < 40) {
    names.unshift(String(current.name || current.id))
    current = current.parent_id ? byId.get(String(current.parent_id)) : null
    guard += 1
  }
  return names.join(' > ')
}

export function reliefKindLabel(kind) {
  if (kind === 'opposing_relief') return "Opposing Counsel's Requested Relief"
  if (kind === 'current_order') return 'Current Order Provisions'
  if (kind === 'temporary_order') return 'Temporary Relief Granted'
  return "My Client's Requested Relief"
}

export function reliefKindForDirection(direction) {
  return direction === 'theirs' ? 'opposing_relief' : 'client_relief'
}

export function partyRoleLabel(parties = [], source) {
  const party = (Array.isArray(parties) ? parties : []).find((item) => item.source === source)
  return party ? (party.name || party.label || source) : source
}

// Build one composer group per selected relief option (so option-level discovery
// mappings apply), plus an explicit group for a relief with no options selected
// yet so it stays visible and can be mapped.
export function buildReliefGroups({ reliefs = [], options = [], matterId = '', direction = 'ours', parties = [] }) {
  const kind = reliefKindForDirection(direction)
  const requestingSource = direction === 'ours' ? 'client' : 'opposing'
  const respondingSource = direction === 'ours' ? 'opposing' : 'client'
  const groups = []

  for (const relief of (Array.isArray(reliefs) ? reliefs : [])) {
    if (String(relief.matter_id || '') !== String(matterId || '')) continue
    if (String(relief.relief_type || 'client_relief') !== kind) continue

    const baseLabel = relief.name || reliefKindLabel(kind)
    const roles = {
      requesting: partyRoleLabel(parties, requestingSource),
      responding: partyRoleLabel(parties, respondingSource)
    }
    const trackId = String(relief.litigation_track_id || '')
    const selected = Array.isArray(relief.selected_option_ids) ? relief.selected_option_ids.map(String) : []

    if (!selected.length) {
      groups.push({
        id: `relief-${relief.id}-unmapped`,
        kind: 'relief',
        label: baseLabel,
        issue_id: '',
        issue_ids: [],
        option_id: '',
        source_side: direction,
        roles,
        track_id: trackId
      })
      continue
    }

    for (const optionId of selected) {
      const option = reliefOptionById(options, optionId)
      if (!option) continue
      const issueIds = reliefOptionIssueIds(optionId, options)
      groups.push({
        id: `relief-${relief.id}-${optionId}`,
        kind: 'relief',
        label: `${baseLabel} — ${reliefOptionPath(optionId, options)}`,
        issue_id: issueIds[0] || '',
        issue_ids: issueIds,
        option_id: optionId,
        source_side: direction,
        roles,
        track_id: trackId
      })
    }
  }

  return groups
}
