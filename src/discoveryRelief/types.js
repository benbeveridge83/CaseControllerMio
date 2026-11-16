// Discovery-from-requested-relief shared constants.
// These mirror the discovery type ids used elsewhere in Mio (src/discovery/model.js)
// so the composer's instrument types stay in sync without pulling the
// objection-analysis module's data graph (authorities.json) into the pure logic.

export const DISCOVERY_TYPES = [
  { id: 'rfp', label: 'RFP', title: 'Requests for production', rule: 'Rule 196' },
  { id: 'rfd', label: 'RFD', title: 'Requests for disclosure', rule: 'Rules 194 / 194a' },
  { id: 'roggs', label: 'Roggs', title: 'Interrogatories', rule: 'Rule 197' },
  { id: 'rfa', label: 'RFA', title: 'Requests for admission', rule: 'Rule 198' }
]

export const DISCOVERY_TYPE_IDS = DISCOVERY_TYPES.map((type) => type.id)

export const SOURCE_SIDES = [
  { id: 'ours', label: 'Our requests' },
  { id: 'theirs', label: 'Their requests' }
]

export const SOURCE_SIDE_IDS = SOURCE_SIDES.map((side) => side.id)

// relief_type values used by Mio's requested relief. client = ours, opposing = theirs.
export const RELIEF_KIND_LABELS = {
  client_relief: "My Client's Requested Relief",
  opposing_relief: "Opposing Counsel's Requested Relief",
  current_order: 'Current Order Provisions',
  temporary_order: 'Temporary Relief Granted'
}

export const DISCOVERY_STATUSES = [
  'selected', 'drafted', 'client_review', 'attorney_review', 'ready_for_service', 'served'
]

export function discoveryTypeLabel(id) {
  return DISCOVERY_TYPES.find((type) => type.id === id)?.label || id || ''
}

export function isDiscoveryType(id) {
  return DISCOVERY_TYPE_IDS.includes(id)
}

export function isSourceSide(id) {
  return SOURCE_SIDE_IDS.includes(id)
}

export function reliefKindToSourceSide(kind) {
  if (kind === 'opposing_relief') return 'theirs'
  if (kind === 'client_relief') return 'ours'
  return null
}
