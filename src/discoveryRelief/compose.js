// Outgoing-discovery composer. Builds a candidate request list from a matter's
// selected relief groups plus the General discovery group, deduplicates exact
// duplicates (one included request with multiple relief links, muted reference
// rows under every other affected relief), and numbers each request within its
// instrument type.

import { libraryById } from './library.js'
import { mappingsForGroup, normalizeReliefMapping } from './mapping.js'
import { exactDuplicateKey } from './dedupe.js'

export function normalizeReliefGroup(group, index = 0) {
  return {
    id: String(group?.id || `group-${index}`),
    kind: group?.kind === 'general' ? 'general' : 'relief',
    label: String(group?.label || ''),
    issue_id: group?.issue_id ? String(group.issue_id) : '',
    issue_ids: Array.isArray(group?.issue_ids) ? group.issue_ids.map(String) : [],
    option_id: group?.option_id ? String(group.option_id) : '',
    source_side: group?.source_side === 'theirs' ? 'theirs' : 'ours',
    roles: {
      requesting: String(group?.roles?.requesting || ''),
      responding: String(group?.roles?.responding || '')
    },
    track_id: String(group?.track_id || '')
  }
}

export function candidateRequestsForGroup(group, mappings, library) {
  if (group.kind === 'general') return []
  return mappingsForGroup(mappings, group).map((mapping) => ({
    item: library[mapping.library_item_id],
    mapping
  })).filter((candidate) => candidate.item)
}

export function composeOutgoingRequests(input = {}) {
  const library = libraryById(input.library || [])
  const mappings = (input.mappings || []).map((mapping, index) => normalizeReliefMapping(mapping, index)).filter((mapping) => mapping.is_active)
  const general = (input.general || []).map((ref) => (typeof ref === 'string' ? { id: ref } : ref))
  const groups = (input.groups || []).map(normalizeReliefGroup)
  const extra = (input.extra || []).map((item, index) => ({
    key: String(item?.key || `extra-${index}`),
    group_id: String(item?.group_id || ''),
    type: String(item?.type || ''),
    text: String(item?.text || ''),
    issue_id: String(item?.issue_id || ''),
    option_id: String(item?.option_id || ''),
    origin: 'matter'
  }))

  const groupsOut = []
  const included = []
  const includedByKey = new Map()
  const references = []

  for (const group of groups) {
    const candidates = group.kind === 'general'
      ? general.map((ref) => ({ item: library[ref.id || ref.library_item_id], mapping: null })).filter((candidate) => candidate.item)
      : candidateRequestsForGroup(group, mappings, library)

    const groupRequests = []
    const groupReferences = []

    for (const { item, mapping } of candidates) {
      const text = String(item.text || '')
      const key = exactDuplicateKey({
        type: item.type,
        text,
        recipient: group.roles.responding,
        timePeriod: input.timePeriod || '',
        scope: mapping?.scope || ''
      })
      const link = { group_id: group.id, issue_id: group.issue_id, option_id: group.option_id }

      const existing = includedByKey.get(key)
      if (existing) {
        existing.relief_links.push(link)
        groupReferences.push({ kind: 'duplicate', key, item_id: item.id, text, reason: '' })
        continue
      }

      const request = {
        key,
        item_id: item.id,
        version: item.version,
        type: item.type,
        text,
        source_side: group.source_side,
        roles: { ...group.roles },
        mapping_id: mapping?.id || '',
        relief_links: [link],
        included: true,
        origin: 'library',
        number: 0
      }
      includedByKey.set(key, request)
      groupRequests.push(request)
      included.push(request)
    }

    // Matter-only requests (no library item) attach to their group the same way.
    for (const extraItem of extra.filter((item) => item.group_id === group.id)) {
      const key = exactDuplicateKey({ type: extraItem.type, text: extraItem.text, recipient: group.roles.responding })
      const link = { group_id: group.id, issue_id: extraItem.issue_id, option_id: extraItem.option_id }
      const existing = includedByKey.get(key)
      if (existing) {
        existing.relief_links.push(link)
        groupReferences.push({ kind: 'duplicate', key, item_id: '', text: extraItem.text, reason: '' })
        continue
      }
      const request = {
        key,
        item_id: '',
        version: 1,
        type: extraItem.type,
        text: extraItem.text,
        source_side: group.source_side,
        roles: { ...group.roles },
        mapping_id: '',
        relief_links: [link],
        included: true,
        origin: 'matter',
        number: 0
      }
      includedByKey.set(key, request)
      groupRequests.push(request)
      included.push(request)
    }

    groupsOut.push({ ...group, requests: groupRequests, references: groupReferences })
  }

  // Overlay persisted selections (attorney toggles/edits) onto the composed requests.
  const selections = new Map((input.selections || []).map((selection) => [String(selection.key), selection]))
  for (const request of included) {
    const selection = selections.get(request.key)
    if (!selection) continue
    if (Object.prototype.hasOwnProperty.call(selection, 'text')) request.text = String(selection.text ?? request.text)
    if (Object.prototype.hasOwnProperty.call(selection, 'included')) request.included = selection.included !== false
  }

  // Number only the included requests within each instrument type.
  const counters = {}
  const includedOut = []
  for (const request of included) {
    if (request.included === false) { request.number = 0; continue }
    counters[request.type] = (counters[request.type] || 0) + 1
    request.number = counters[request.type]
    includedOut.push(request)
  }

  // Backfill duplicate reference text with the retained request number.
  for (const group of groupsOut) {
    for (const ref of group.references) {
      const retained = includedByKey.get(ref.key)
      if (retained && retained.included !== false) ref.reason = `Included once as ${retained.type.toUpperCase()} ${retained.number}`
      else ref.reason = 'Duplicate of an excluded request'
    }
  }

  return { groups: groupsOut, included: includedOut, references, counts: counters }
}

export function includeCountsByType(included = []) {
  const counts = {}
  for (const request of included) counts[request.type] = (counts[request.type] || 0) + 1
  return counts
}
