// Reusable discovery library items: individual interrogatories, production
// requests, admissions, disclosure requests, or response patterns. A library
// item supplies content; the drafting template supplies layout. Keep library
// revisions separate from matter drafts so later library edits never silently
// change prior work.

import { isDiscoveryType } from './types.js'

const AUTHORS = new Set(['attorney', 'ai', 'client', 'system'])

export function normalizeLibraryItem(item, index = 0) {
  const text = String(item?.text || '').trim()
  if (!text) throw new Error('A discovery library item needs request text.')
  const type = String(item?.type || '')
  if (!isDiscoveryType(type)) throw new Error('Choose a discovery type for the library item.')
  const author = String(item?.author || 'attorney')
  return {
    id: String(item?.id || `lib-${type}-${index}-${Date.now()}`),
    version: Number(item?.version || 1),
    type,
    text,
    placeholders: Array.isArray(item?.placeholders)
      ? item.placeholders.map((p) => String(p?.key ? p.key : p).trim()).filter(Boolean)
      : [],
    tags: Array.isArray(item?.tags) ? item.tags.map(String) : [],
    default_inclusion: item?.default_inclusion !== false,
    conditions: item?.conditions && typeof item.conditions === 'object' && !Array.isArray(item.conditions) ? item.conditions : {},
    author: AUTHORS.has(author) ? author : 'attorney',
    source: String(item?.source || 'library'),
    created_at: String(item?.created_at || ''),
    updated_at: String(item?.updated_at || '')
  }
}

export function libraryItemVersionKey(item) {
  return `${item.type}:${item.id}:v${item.version}`
}

export function nextLibraryVersion(item) {
  return (Number(item?.version) || 1) + 1
}

export function libraryById(items = []) {
  const map = {}
  for (const item of (Array.isArray(items) ? items : [])) {
    const normalized = normalizeLibraryItem(item)
    map[normalized.id] = normalized
  }
  return map
}
