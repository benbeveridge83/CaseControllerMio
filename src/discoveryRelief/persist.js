// Persistence shape for a matter discovery set: the attorney's selected, edited,
// and deduplicated requests (or responses) for one matter and direction. Saved
// as a single versioned value (cloud store key / payload), so library revisions
// never silently rewrite a saved or served set.

import { DISCOVERY_STATUSES } from './types.js'

export const DISCOVERY_SET_VERSION = 1

export function discoverySetKey(matterId, direction) {
  return `caseMioDiscoveryReliefSetV1:${String(matterId || '')}:${direction === 'responses' ? 'responses' : 'requests'}`
}

export function emptyMatterDiscoverySet({ matterId = '', direction = 'requests', instrument = '' } = {}) {
  return {
    version: DISCOVERY_SET_VERSION,
    id: '',
    matter_id: String(matterId || ''),
    track_ids: [],
    direction: direction === 'responses' ? 'responses' : 'requests',
    instrument: String(instrument || ''),
    template_id: '',
    template_version: '',
    status: 'selected',
    selections: [],
    created_at: '',
    updated_at: ''
  }
}

export function normalizeMatterDiscoverySet(value = {}) {
  const base = emptyMatterDiscoverySet(value)
  const status = String(value?.status || 'selected')
  return {
    ...base,
    ...(value || {}),
    version: DISCOVERY_SET_VERSION,
    track_ids: Array.isArray(value?.track_ids) ? value.track_ids.map(String) : [],
    status: DISCOVERY_STATUSES.includes(status) ? status : 'selected',
    selections: Array.isArray(value?.selections) ? value.selections : []
  }
}

// A selection is a matter-level snapshot of a library item (or an incoming
// request) plus its relief links and the attorney's edits. `origin` is
// 'library' (reusable) or 'matter' (matter-only edit). A selection whose
// `included` is false has been unchecked; one with `duplicate_of` is a muted
// reference, not a request in the output.
export function normalizeSelection(selection, index = 0) {
  return {
    key: String(selection?.key || `sel-${index}`),
    item_id: String(selection?.item_id || ''),
    version: Number(selection?.version || 1),
    type: String(selection?.type || ''),
    text: String(selection?.text || ''),
    included: selection?.included !== false,
    duplicate_of: selection?.duplicate_of ? String(selection.duplicate_of) : '',
    origin: selection?.origin === 'matter' ? 'matter' : 'library',
    number: Number(selection?.number || 0),
    relief_links: Array.isArray(selection?.relief_links) ? selection.relief_links : [],
    roles: selection?.roles && typeof selection.roles === 'object' ? selection.roles : {}
  }
}
