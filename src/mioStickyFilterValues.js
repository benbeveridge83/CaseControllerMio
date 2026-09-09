export const STICKY_FILTER_PREFIX = 'caseMioStickyFilter:'
export const isClosedCaseStatus = value => /^closed(?:$|[\s-])/i.test(String(value || '').trim())
export function caseFilterValues(value, options) {
  const all = options.map(o => typeof o === 'object' ? o.value ?? o.name : o)
  if (!Array.isArray(value) || value.includes('__open__')) return all.filter(v => !isClosedCaseStatus(v))
  if (value.includes('__all__')) return all
  return value.filter(v => all.includes(v))
}
export function caseFilterMatches(value, status) {
  if (value === '__open__' || value == null || Array.isArray(value) && value.includes('__open__')) return !isClosedCaseStatus(status)
  if (value === 'all' || Array.isArray(value) && value.includes('__all__')) return true
  return Array.isArray(value) ? value.includes(status || '__blank__') || value.includes(status || '') : value === status
}
export function initialFilterValue(name, value) {
  if (['bulkBillingFilters','settingsMatterTableFilters'].includes(name) && (!value?.case_status || value.case_status === 'all')) return {...value,case_status:'__open__'}
  if (name === 'clioGraphCaseStatusFilters' && (!Array.isArray(value) || !value.length)) return ['__open__']
  if (name === 'clioGraphCaseStatusFilter' && (!value || value === 'all')) return '__open__'
  return value
}
// Only view preferences use this merge. Business records retain strict conflict checks.
export function rebaseFilterValue(baseRaw, localRaw, remoteRaw) {
  const parse = raw => raw == null ? undefined : JSON.parse(raw)
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b)
  const object = v => !!v && typeof v === 'object' && !Array.isArray(v)
  const merge = (base,local,remote) => {
    if (equal(base,local)) return remote
    if (object(local) && object(remote)) {
      const out = {...remote}
      for (const k of new Set([...Object.keys(base || {}),...Object.keys(local)])) {
        if (equal(base?.[k],local[k])) continue
        if (!(k in local)) delete out[k]
        else out[k]=merge(base?.[k],local[k],remote[k])
      }
      return out
    }
    return local
  }
  return JSON.stringify(merge(parse(baseRaw),parse(localRaw),parse(remoteRaw)))
}
