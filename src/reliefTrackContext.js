import { normalizeApplicability } from './reliefApplicability.js'

// Track names are editable. Only the system final-track role implies a type.
export function litigationOrderType(track = {}) {
  if (track.type === 'discovery') return ''
  if (track.is_default || String(track.id || '').startsWith('lit-track-final-')) return 'final'
  return typeof track.order_type_id === 'string' ? track.order_type_id : ''
}

export function reliefTypeChoices(groups, groupId, selected = '') {
  const group = groups.find(group => group.id === groupId)
  const choices = (group?.options || []).filter(option => !option.archived || option.id === selected)
  if (selected && !choices.some(option => option.id === selected)) return [...choices, { id: selected, name: `Unavailable type (${selected})`, archived: true }]
  return choices
}

export function reliefContextDefaults(extra = {}, track = {}, groups = []) {
  const result = {}
  for (const [groupId, value] of [['proceeding', extra.proceeding_id], ['order_type', litigationOrderType(track)]]) {
    const group = groups.find(group => group.id === groupId && !group.archived)
    if (value && group?.options.some(option => option.id === value)) result[groupId] = [value]
  }
  return result
}

// Reopening preserves even an explicitly unfiltered saved set. Reusing content
// starts a different set: destination matter/track own these two dimensions.
export function initialReliefContext({ saved, sourceContext, defaults = {} } = {}) {
  if (saved && Object.hasOwn(saved, 'filter_context')) return normalizeApplicability(saved.filter_context)
  const context = normalizeApplicability(sourceContext)
  delete context.proceeding
  delete context.order_type
  return { ...context, ...normalizeApplicability(defaults) }
}
