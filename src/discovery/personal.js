import { SOURCE_BY_ID, DISCOVERY_TYPES } from './model.js'

export const PERSONAL_KEY = 'caseMioDiscoveryPersonalV1'
export const CHAT_KEY = 'caseMioDiscoveryChatV1'
const text = (value, max, label) => {
  if (value == null) return ''
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} is too long (limit ${max} characters).`)
  return value.trim()
}
export function normalizePersonal(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Personal guidance is not a valid profile.')
  if (value.rules != null && (!Array.isArray(value.rules) || value.rules.length > 40)) throw new Error('Save at most 40 personal rules.')
  const ids = new Set()
  const rules = (value.rules || []).map(r => {
    if (!r || typeof r !== 'object') throw new Error('A personal rule is invalid.')
    const id = text(r.id, 120, 'Rule identity')
    if (!id || ids.has(id)) throw new Error('Personal rules need unique identities; duplicate rule found.')
    ids.add(id)
    if (!['all', ...DISCOVERY_TYPES.map(t => t.id)].includes(r.type)) throw new Error('Choose a discovery type for each rule.')
    if (!Array.isArray(r.authorities || []) || (r.authorities || []).length > 12 || (r.authorities || []).some(id => !Object.hasOwn(SOURCE_BY_ID, id))) throw new Error('A personal rule has an unsupported authority.')
    const rule = { id, type: r.type, enabled: r.enabled !== false, authorities: [...new Set(r.authorities || [])] }
    for (const key of ['title', 'exampleRequest', 'exampleObjection', 'examplePrivilege', 'recognitionGuidance', 'responseGuidance']) rule[key] = text(r[key], key === 'title' ? 160 : 5000, key)
    if (!rule.title) throw new Error('Give each personal rule a title.')
    return rule
  })
  const profile = { version: 1, styleInstructions: text(value.styleInstructions, 6000, 'General style instructions'), rules }
  if (JSON.stringify(profile).length > 80000) throw new Error('Personal guidance exceeds the 80,000-character limit. Shorten the examples.')
  return profile
}
export function personalGuidance(profile, types = DISCOVERY_TYPES.map(t => t.id)) {
  const normalized = normalizePersonal(profile)
  return { ...normalized, rules: normalized.rules.filter(r => r.enabled && (r.type === 'all' || types.includes(r.type))) }
}
export async function saveDiscoveryValue(store, owner, key, value) {
  const current = store.status()
  if (!owner || current.owner !== owner || current.phase !== 'ready') throw new Error('Your account is not ready to save. Sign in again or finish loading Mio.')
  // A conversation is an ordered unit, not a mergeable list of independent rows.
  const stored = key === CHAT_KEY ? {version:1,messages:value} : value
  const acknowledged = await store.saveNow(key, JSON.stringify(stored), { throwOnError: true })
  if (store.status().owner !== owner) throw new Error('The account changed during saving. Check this account before continuing.')
  if (!acknowledged) throw new Error('Mio did not acknowledge this save. Your edits remain here; retry saving.')
  return value
}
export function readDiscoveryValue(storage, key, fallback) {
  const raw = storage.getItem(key)
  if (raw == null || raw === '') return fallback
  try { return JSON.parse(raw) } catch { throw new Error('Saved discovery settings could not be read. Reload Mio before editing them.') }
}
export function loadPersonalState(store) {
  try {
    const row = store.confirmedRecords().find(r => r.key === PERSONAL_KEY)
    const profile = normalizePersonal(row ? JSON.parse(row.raw_value) : {})
    const pending = store.status().pendingKeys?.includes(PERSONAL_KEY) || false
    const draft = pending ? normalizePersonal(readDiscoveryValue(store.storage,PERSONAL_KEY,{})) : profile
    return {profile,draft,pending,error:''}
  } catch (error) { return {profile:normalizePersonal({}),draft:normalizePersonal({}),pending:false,error:`Saved discovery guidance could not be read. Reload Mio before editing. ${error.message}`} }
}
