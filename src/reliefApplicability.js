export const defaultReliefFilterGroups = [
  { id: 'proceeding', name: 'Proceeding', options: [{ id: 'original', name: 'Original' }, { id: 'modification', name: 'Modification' }] },
  { id: 'order_type', name: 'Order type', options: [{ id: 'final', name: 'Final orders' }, { id: 'temporary', name: 'Temporary orders' }, { id: 'tro', name: 'TRO' }] }
]

export function normalizeApplicability(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, ids]) => Array.isArray(ids)).map(([id, ids]) => [id, [...new Set(ids.filter(x => typeof x === 'string'))]]))
}

export function normalizeReliefFilterGroups(value) {
  if (!Array.isArray(value)) return structuredClone(defaultReliefFilterGroups)
  const seen = new Set()
  return value.filter(g => g && typeof g.id === 'string' && g.id && !seen.has(g.id) && seen.add(g.id)).map(g => {
    const optionIds = new Set()
    return { id: g.id, name: String(g.name || 'Unnamed group'), archived: g.archived === true,
      options: (Array.isArray(g.options) ? g.options : []).filter(o => o && typeof o.id === 'string' && o.id && !optionIds.has(o.id) && optionIds.add(o.id)).map(o => ({id: o.id, name: String(o.name || 'Unnamed option'), archived: o.archived === true})) }
  })
}

export function effectiveApplicability(row, rows, groups) {
  return effectiveWithIndex(row, new Map(rows.map(r => [String(r.id), r])), groups)
}

function effectiveWithIndex(row, byId, groups) {
  const result = Object.fromEntries(groups.filter(g => !g.archived).map(g => [g.id, g.options.map(o => o.id)]))
  const seen = new Set()
  for (let current = row; current && !seen.has(String(current.id)); current = byId.get(String(current.parent_id))) {
    seen.add(String(current.id))
    const rules = normalizeApplicability(current.applicability)
    for (const id of Object.keys(result)) if (Object.hasOwn(rules, id)) result[id] = result[id].filter(v => rules[id].includes(v))
  }
  return result
}

// Filtering is presentation-only. Never trim snapshots, selected IDs, or text here.
export function visibleReliefIds(rows, groups, context = {}) {
  const filters = normalizeApplicability(context)
  const active = groups.filter(g => !g.archived && Object.hasOwn(filters, g.id))
  if (!active.length) return new Set(rows.map(r => r.id))
  if (active.some(g => filters[g.id].length === 0)) return new Set()
  const byId = new Map(rows.map(r => [String(r.id), r]))
  return new Set(rows.filter(r => {
    const effective = effectiveWithIndex(r, byId, groups)
    return active.every(g => effective[g.id].some(id => filters[g.id].includes(id)))
  }).map(r => r.id))
}
