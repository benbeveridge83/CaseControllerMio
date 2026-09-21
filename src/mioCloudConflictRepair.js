// Version conflicts are only repaired when the repair cannot lose another tab's work.
// Two tabs writing the same record used to raise an "unsaved item" panel even when the
// cloud already held the intended value, or when each tab had only added its own rows.
// Everything else keeps the strict stop-and-ask behavior. See docs/cloud-save-conflicts-v320.md.
const ABSENT = '\u0000mio-absent'
const canonical = value => JSON.stringify(value ?? null)
const recordId = item => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
  for (const field of ['id', 'uuid', 'key']) {
    const value = item[field]
    if (typeof value === 'string' && value) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}
const parseRecordList = raw => {
  if (typeof raw !== 'string') return null
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value : null
  } catch { return null }
}
// Records without a unique identity cannot be matched up, so they keep strict checks.
const indexRecords = list => {
  const index = new Map()
  for (const item of list) {
    const id = recordId(item)
    if (!id || index.has(id)) return null
    index.set(id, item)
  }
  return index
}
// Three-way merge of an array of identified records. Returns the merged JSON text when
// every difference belongs to exactly one side, and null when both sides changed the
// same record (including an edit racing a deletion) or the shapes are not identifiable.
export function mergeMioRecordLists(baselineRaw, localRaw, remoteRaw) {
  const local = parseRecordList(localRaw), remote = parseRecordList(remoteRaw)
  if (!local || !remote) return null
  const baseIndex = indexRecords(parseRecordList(baselineRaw) || []), localIndex = indexRecords(local), remoteIndex = indexRecords(remote)
  if (!baseIndex || !localIndex || !remoteIndex) return null
  const shared = [...localIndex.keys()].filter(id => remoteIndex.has(id))
  // Row order is a user decision as well: a reorder on either side is never discarded silently.
  if (shared.join(ABSENT) !== [...remoteIndex.keys()].filter(id => localIndex.has(id)).join(ABSENT)) return null
  const decided = new Map()
  for (const id of new Set([...baseIndex.keys(), ...remoteIndex.keys(), ...localIndex.keys()])) {
    const base = baseIndex.has(id) ? canonical(baseIndex.get(id)) : ABSENT
    const mine = localIndex.has(id) ? canonical(localIndex.get(id)) : ABSENT
    const theirs = remoteIndex.has(id) ? canonical(remoteIndex.get(id)) : ABSENT
    if (mine === theirs) { if (mine !== ABSENT) decided.set(id, localIndex.get(id)); continue }
    if (mine === base) { if (theirs !== ABSENT) decided.set(id, remoteIndex.get(id)); continue }
    if (theirs === base) { if (mine !== ABSENT) decided.set(id, localIndex.get(id)); continue }
    return null
  }
  return JSON.stringify([...decided.values()])
}
// null      the cloud already holds the intended result; nothing is written and no
//           panel is shown.
// string    a lossless merged value to write instead of asking the user.
// undefined a real conflict: the pending edit and the existing notice are kept.
export function repairMioCloudConflict({ baselineRaw, localRaw, deleting, remoteRaw }) {
  if (deleting) return remoteRaw == null ? null : undefined
  if (typeof localRaw !== 'string' || remoteRaw == null) return undefined
  if (remoteRaw === localRaw) return null
  const merged = mergeMioRecordLists(baselineRaw, localRaw, remoteRaw)
  return merged == null ? undefined : merged
}
