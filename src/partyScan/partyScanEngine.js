// Case Controller Mio — matter-level OneDrive e-file folder party scan engine.
// Pure, deterministic extraction tuned to Texas family-law pleadings. No network, DOM,
// storage, or LLM access: it turns raw document text + filenames into review-ready
// proposals. Every write still requires explicit human approval in the UI, so a
// heuristic mistake can never silently change a matter's People or Litigation Parties.
// Callers must keep raw document text out of logs/errors.

export const PLEADING_KINDS = {
  petition: { label: 'Petition', current: true },
  amended_petition: { label: 'Amended Petition', current: true },
  counterpetition: { label: 'Counterpetition', current: true },
  amended_counterpetition: { label: 'Amended Counterpetition', current: true },
  answer: { label: 'Answer', current: true },
  amended_answer: { label: 'Amended Answer', current: true },
  order: { label: 'Order', current: false },
  service_notice: { label: 'Service / Notice', current: false },
  other: { label: 'Other', current: false }
}

// Canonical vocabulary; keep in sync with the Settings option seeds
// (supabase/migrations/20261122000000_litigation_party_attorney_options.sql).
export const PARTY_ROLES = [
  'Petitioner',
  'Petitioner / Counter-Respondent',
  'Petitioner / Cross-Respondent',
  'Respondent',
  'Respondent / Counter-Petitioner',
  'Respondent / Cross-Petitioner',
  'Children'
]

export const ATTORNEY_TYPES = [
  'Party Attorney',
  'Attorney ad Litem',
  'Amicus Attorney',
  'Guardian ad Litem'
]

const ROLE_WORD = '(?:petitioner|respondent|counter-petitioner|cross-petitioner|counter-respondent|cross-respondent)'

function normalize(value = '') {
  return String(value == null ? '' : value).replace(/\r/g, ' ').replace(/\s+/g, ' ').trim()
}

export function normalizeName(value = '') {
  return normalize(value).replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim()
}

export function nameKey(value = '') {
  return normalizeName(value).toLowerCase().replace(/[^a-z0-9']+/g, ' ').replace(/\s+/g, ' ').trim()
}

function splitLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => normalize(line)).filter(Boolean)
}

function contains(haystack, needle) {
  return haystack.indexOf(needle) !== -1
}
// --- Document type classification -------------------------------------------------

const FILE_KIND_HINTS = [
  { kind: 'amended_counterpetition', re: /amended\b.*counter\s*[- ]?petition|counter\s*[- ]?petition.*amended/i },
  { kind: 'amended_petition', re: /amended\s*[- ]?petition|first\s+amended|second\s+amended|third\s+amended/i },
  { kind: 'counterpetition', re: /counter\s*[- ]?petition/i },
  { kind: 'petition', re: /\bpetition\b|original\s+petition/i },
  { kind: 'amended_answer', re: /amended\s*[- ]?answer/i },
  { kind: 'answer', re: /(?:original\s+)?answer/i },
  { kind: 'order', re: /\border|decree|judgment/i },
  { kind: 'service_notice', re: /\bnotice\b|\bservice\b|return\s+of\s+service|sheriff/i }
]

const TEXT_KIND_HINTS = [
  { kind: 'amended_counterpetition', re: /amended\s+counter\s*[- ]?petition/i },
  { kind: 'amended_petition', re: /amended\s+petition|first\s+amended\s+petition|second\s+amended\s+petition/i },
  { kind: 'counterpetition', re: /counter\s*[- ]?petition/i },
  { kind: 'amended_answer', re: /amended\s+answer|first\s+amended\s+answer/i },
  { kind: 'answer', re: /\b(?:original\s+)?answer\b/i },
  { kind: 'petition', re: /\bpetition\s+for\b|original\s+petition|petition\s+in\s+a\s+suit/i },
  { kind: 'order', re: /\border\s+of\b|temporary\s+orders|final\s+decree/i },
  { kind: 'service_notice', re: /\bnotice\s+of\b|return\s+of\s+service|notice\s+of\s+filing/i }
]

export function classifyPleading({ fileName = '', text = '' } = {}) {
  const file = normalize(fileName)
  const body = normalize(text).slice(0, 4000)
  for (const hint of TEXT_KIND_HINTS) {
    if (hint.re.test(body)) return { kind: hint.kind, label: PLEADING_KINDS[hint.kind].label, method: 'text', confidence: 'high' }
  }
  for (const hint of FILE_KIND_HINTS) {
    if (hint.re.test(file)) return { kind: hint.kind, label: PLEADING_KINDS[hint.kind].label, method: 'filename', confidence: 'medium' }
  }
  return { kind: 'other', label: PLEADING_KINDS.other.label, method: 'fallback', confidence: 'low' }
}

// --- Role / attorney-type normalization ------------------------------------------

export function normalizeRole(raw = '') {
  const value = normalize(raw)
  if (!value) return ''
  const lower = value.toLowerCase()
  if (lower.startsWith('petitioner') && (contains(lower, 'counter-respondent') || contains(lower, 'counterrespondent'))) return 'Petitioner / Counter-Respondent'
  if (lower.startsWith('petitioner') && (contains(lower, 'cross-respondent') || contains(lower, 'crossrespondent'))) return 'Petitioner / Cross-Respondent'
  if (lower.startsWith('respondent') && (contains(lower, 'counter-petitioner') || contains(lower, 'counterpetitioner'))) return 'Respondent / Counter-Petitioner'
  if (lower.startsWith('respondent') && (contains(lower, 'cross-petitioner') || contains(lower, 'crosspetitioner'))) return 'Respondent / Cross-Petitioner'
  if (contains(lower, 'counter-petitioner') || contains(lower, 'counterpetitioner')) return 'Respondent / Counter-Petitioner'
  if (contains(lower, 'cross-petitioner') || contains(lower, 'crosspetitioner')) return 'Respondent / Cross-Petitioner'
  if (lower.startsWith('petitioner')) return 'Petitioner'
  if (lower.startsWith('respondent')) return 'Respondent'
  if (contains(lower, 'child') || contains(lower, 'minor') || contains(lower, 'children')) return 'Children'
  return value
}

export function normalizeAttorneyType(raw = '') {
  const lower = normalize(raw).toLowerCase()
  if (!lower) return ''
  if (contains(lower, 'guardian') && contains(lower, 'ad litem')) return 'Guardian ad Litem'
  if (contains(lower, 'amicus')) return 'Amicus Attorney'
  if (contains(lower, 'ad litem')) return 'Attorney ad Litem'
  if (contains(lower, "party's attorney") || contains(lower, 'party attorney') || contains(lower, 'attorney for')) return 'Party Attorney'
  return ''
}

function roleSource(role = '') {
  const lower = String(role || '').toLowerCase()
  if (lower.startsWith('petitioner')) return 'client'
  if (lower.startsWith('respondent') || lower.startsWith('opposing')) return 'opposing'
  return 'other'
}

function counselRoleTier(role = '') {
  const lower = String(role || '').toLowerCase()
  if (lower.startsWith('petitioner')) return 'petitioner'
  if (lower.startsWith('respondent') || contains(lower, 'counter') || contains(lower, 'cross')) return 'respondent'
  if (lower.startsWith('child') || contains(lower, 'minor')) return 'children'
  return ''
}
// --- Party-name extraction -------------------------------------------------------

function extractMarriageParties(text) {
  const match = String(text || '').match(/marriage\s+of\s+([^\n]+)/i)
  if (!match) return []
  const segment = match[1].replace(/\s+and\s+in\s+the\s+interest\s+of.*$/i, '')
  const parts = segment.split(/\s+and\s+|\s+&\s+/i).map(normalizeName).filter((name) => name && name.length > 1)
  const out = []
  if (parts[0]) out.push({ name: parts[0], role: 'Petitioner', method: 'marriage-caption' })
  if (parts[1]) out.push({ name: parts[1], role: 'Respondent', method: 'marriage-caption' })
  return out
}

function extractChildrenParties(text) {
  const match = String(text || '').match(/in\s+the\s+interest\s+of\s+([^\n]+?),\s*(?:a\s+)?(?:minor\s+)?(?:child|children)/i)
  if (!match) return []
  return match[1].split(/\s+and\s+|\s*,\s*|\s+&\s+/i)
    .map((name) => normalizeName(name))
    .filter((name) => name && name.length > 1)
    .map((name) => ({ name, role: 'Children', method: 'interest-caption' }))
}

function extractVsParties(text) {
  const match = String(text || '').match(/([A-Z][A-Za-z.' -]{2,60}?)\s*,?\s*(?:petitioner|plaintiff)\s*v\.?\s*([A-Z][A-Za-z.' -]{2,60}?)\s*,?\s*(?:respondent|defendant)/i)
  if (!match) return []
  const out = []
  const petitioner = normalizeName(match[1])
  const respondent = normalizeName(match[2])
  if (petitioner && !/^[a-z]/.test(petitioner)) out.push({ name: petitioner, role: 'Petitioner', method: 'vs-caption' })
  if (respondent && !/^[a-z]/.test(respondent)) out.push({ name: respondent, role: 'Respondent', method: 'vs-caption' })
  return out
}

function extractLabeledParties(text) {
  const lines = splitLines(text)
  const out = []
  for (const line of lines) {
    const trailing = line.match(new RegExp('^(.{2,80}?)\\s*,\\s*(' + ROLE_WORD + '(?:\\s*(?:\\/|and|&)\\s*' + ROLE_WORD + ')?)\\s*$', 'i'))
    if (trailing) {
      out.push({ name: normalizeName(trailing[1]), role: normalizeRole(trailing[2]), method: 'labeled-name-role' })
      continue
    }
    const leading = line.match(new RegExp('^(' + ROLE_WORD + ')\\s*:\\s*(.{2,80})$', 'i'))
    if (leading) {
      out.push({ name: normalizeName(leading[2]), role: normalizeRole(leading[1]), method: 'labeled-role-name' })
      continue
    }
    const isForm = line.match(/^(petitioner|respondent)\s+(?:is|,)\s+(.{2,80})$/i)
    if (isForm) out.push({ name: normalizeName(isForm[2]), role: normalizeRole(isForm[1]), method: 'labeled-is' })
  }
  return out
}
// --- Counsel / signature-block extraction ----------------------------------------

function looksLikePersonName(line) {
  const value = normalize(line)
  if (!value || value.length < 3 || value.length > 60) return false
  const words = value.split(/\s+/)
  if (words.length < 2 || words.length > 4) return false
  if (!words.every((word) => /^[A-Z][A-Za-z.'-]*$/.test(word))) return false
  return !/^(The|In|And|Of|For|To|By|On|At|State|District|County|Court|No|Email|Phone|Fax|Tel)$/.test(words[0])
}

function extractCounselBlocks(text) {
  const lines = splitLines(text)
  const blocks = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!/respectfully submitted|respectfully,?\s*$|submitted by/i.test(lines[index])) continue
    const windowLines = lines.slice(index, index + 10)
    const joined = windowLines.join('\n')
    const forMatch = joined.match(/(?:attorney|counsel)\s+for\s+([^\n,]+)/i)
    const roleRaw = forMatch ? normalize(forMatch[1]) : ''
    const barMatch = joined.match(/state\s+bar\s+no\.?\s*[:#]?\s*(\d+)/i)
    const email = (joined.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i) || [])[0] || ''
    const firm = windowLines.find((line) => /pllc|p\.?c\.?|llp|llc|l\.?l\.?p\.?|law office|law firm|&\s*associates/i.test(line)) || ''
    const name = windowLines.find((line) => looksLikePersonName(line) && !/pllc|p\.?c\.?|llp|llc|law office|law firm|state bar|attorney for|counsel for|respectfully|@|no\.?\s*\d/i.test(line)) || ''
    if (!name && !email && !barMatch) continue
    blocks.push({
      roleRaw,
      role: normalizeRole(roleRaw),
      roleTier: counselRoleTier(roleRaw),
      name: normalizeName(name),
      firm: normalizeName(firm),
      email: normalize(email),
      barNumber: barMatch ? barMatch[1] : '',
      raw: joined.slice(0, 400)
    })
  }
  return blocks
}

// --- Combined per-document extraction --------------------------------------------

function dedupeByName(parties) {
  const map = new Map()
  const order = []
  for (const party of parties) {
    const key = nameKey(party.name)
    if (!key) continue
    if (!map.has(key)) {
      map.set(key, party)
      order.push(key)
      continue
    }
    const prior = map.get(key)
    if (party.role && (!prior.role || party.role.length > prior.role.length)) prior.role = party.role
    if (party.method === 'marriage-caption' || party.method === 'interest-caption') prior.method = party.method
  }
  return order.map((key) => map.get(key))
}

export function extractDocumentParties(text = '', { fileName = '' } = {}) {
  const parties = dedupeByName([
    ...extractMarriageParties(text),
    ...extractChildrenParties(text),
    ...extractVsParties(text),
    ...extractLabeledParties(text)
  ])

  const counselBlocks = extractCounselBlocks(text)
  for (const counsel of counselBlocks) {
    if (!counsel.name && !counsel.email) continue
    const target = parties.find((party) => {
      if (!party.role) return false
      if (counsel.roleTier && counselRoleTier(party.role) === counsel.roleTier) return true
      return counsel.roleRaw && nameKey(counsel.roleRaw) === nameKey(party.name)
    }) || parties[0]
    if (!target) continue
    target.attorney = target.attorney || { name: counsel.name, email: counsel.email, firm: counsel.firm, barNumber: counsel.barNumber }
    if (!target.attorneyType && counsel.role) target.attorneyType = normalizeAttorneyType(counsel.role)
    if (!target.attorneyType) target.attorneyType = 'Party Attorney'
  }

  return parties.map((party) => ({
    name: party.name,
    role: party.role || '',
    source: roleSource(party.role),
    attorney: party.attorney || null,
    attorneyType: party.attorneyType || '',
    confidence: party.method === 'marriage-caption' || party.method === 'interest-caption' ? 'high' : (party.method === 'labeled-name-role' || party.method === 'vs-caption' ? 'medium' : 'low'),
    method: party.method,
    evidence: party.name
  }))
}
// --- Filing date + "most recent" selection ---------------------------------------

export function parseDocumentDate({ fileName = '', text = '' } = {}) {
  const head = normalize(text).slice(0, 2500)
  const isoFile = String(fileName).match(/(20\d{2})[-_ .]?(0?[1-9]|1[0-2])[-_ .]?(0?[1-9]|[12]\d|3[01])/)
  if (isoFile) {
    const [, year, month, day] = isoFile
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const usFile = String(fileName).match(/(0?[1-9]|1[0-2])[-_ .](0?[1-9]|[12]\d|3[01])[-_ .](20\d{2})/)
  if (usFile) {
    const [, month, day, year] = usFile
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const phrase = head.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\s*,\s*(20\d{2})\b/i)
  if (phrase) {
    const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' }
    return `${phrase[3]}-${months[phrase[1].toLowerCase()]}-${String(phrase[2]).padStart(2, '0')}`
  }
  return ''
}

const PLEADING_SLOTS = [
  { key: 'petition', kinds: ['petition'] },
  { key: 'amended_petition', kinds: ['amended_petition'] },
  { key: 'counterpetition', kinds: ['counterpetition', 'amended_counterpetition'] },
  { key: 'answer', kinds: ['answer', 'amended_answer'] }
]

function versionRank(doc = {}) {
  const kind = doc.kind || ''
  if (kind === 'amended_petition' || kind === 'amended_counterpetition' || kind === 'amended_answer') return 2
  return 1
}

export function selectLatestPleadings(documents = []) {
  const docs = Array.isArray(documents) ? documents : []
  const result = {}
  for (const slot of PLEADING_SLOTS) {
    const candidates = docs
      .filter((doc) => slot.kinds.includes(doc.kind) && !doc.unreadable && !doc.skipReason)
      .sort((a, b) => {
        const dateA = a.date || ''
        const dateB = b.date || ''
        if (dateA !== dateB) return dateB.localeCompare(dateA)
        return versionRank(b) - versionRank(a) || String(b.name || '').localeCompare(String(a.name || ''), undefined, { numeric: true, sensitivity: 'base' })
      })
    const chosen = candidates[0] || null
    const uncertain = Boolean(chosen && !chosen.date && candidates.length > 1)
    result[slot.key] = chosen ? { doc: chosen, uncertain } : null
  }
  return result
}

// --- Proposal assembly -----------------------------------------------------------

function topVote(votes) {
  if (!votes || !votes.size) return ''
  let best = ''
  let bestCount = -1
  for (const [key, count] of votes.entries()) {
    if (count > bestCount || (count === bestCount && key.length > best.length)) {
      best = key
      bestCount = count
    }
  }
  return best
}

function bestRole(roles) {
  if (!roles || !roles.size) return ''
  const roleSpecificity = (role) => (role.includes('/') ? 3 : role === 'Children' ? 2 : 1)
  let best = ''
  let bestScore = -1
  for (const [role, count] of roles.entries()) {
    const score = roleSpecificity(role) * 1000 + count
    if (score > bestScore) { best = role; bestScore = score }
  }
  return best
}

function matchByName(name, list) {
  const key = nameKey(name)
  if (!key) return null
  return (Array.isArray(list) ? list : []).find((item) => item && nameKey(item.name || item.full_name || item.label) === key) || null
}
export function buildScanProposals({ documents = [], existingParties = [], existingPeople = [], attorneyDirectory = [], filers = [] } = {}) {
  const docs = Array.isArray(documents) ? documents : []
  const readable = docs.filter((doc) => !doc.unreadable && !doc.skipReason && doc.text)
  const skipped = docs.filter((doc) => doc.skipReason)
  const unreadable = docs.filter((doc) => doc.unreadable)

  const merged = new Map()
  for (const doc of readable) {
    const extracted = extractDocumentParties(doc.text || '', { fileName: doc.name || '' })
    for (const party of extracted) {
      const key = nameKey(party.name)
      if (!key) continue
      let entry = merged.get(key)
      if (!entry) {
        entry = {
          name: party.name,
          roles: new Map(),
          source: party.source || 'other',
          attorneyNames: new Map(),
          attorneyTypes: new Map(),
          attorney: null,
          confidenceRank: { high: 3, medium: 2, low: 1 },
          confidence: 'low',
          methods: new Set(),
          evidence: [],
          sourceDocuments: []
        }
        merged.set(key, entry)
      }
      if (party.name.length >= entry.name.length) entry.name = party.name
      if (party.role) entry.roles.set(party.role, (entry.roles.get(party.role) || 0) + 1)
      if (party.source) entry.source = party.source
      if (party.attorney?.name) entry.attorneyNames.set(party.attorney.name, (entry.attorneyNames.get(party.attorney.name) || 0) + 1)
      if (party.attorney && !entry.attorney) entry.attorney = party.attorney
      if (party.attorneyType) entry.attorneyTypes.set(party.attorneyType, (entry.attorneyTypes.get(party.attorneyType) || 0) + 1)
      if (party.method) entry.methods.add(party.method)
      entry.evidence.push({ method: party.method, snippet: party.evidence || party.name })
      if (!entry.sourceDocuments.some((d) => d.name === doc.name)) entry.sourceDocuments.push({ name: doc.name, webUrl: doc.webUrl || '' })
      const rank = entry.confidenceRank[party.confidence] || 1
      if (rank > (entry.confidenceRank[entry.confidence] || 1)) entry.confidence = party.confidence
    }
  }

  const conflicts = []
  const proposals = Array.from(merged.values()).map((entry, index) => {
    const role = bestRole(entry.roles)
    const attorneyName = topVote(entry.attorneyNames) || (entry.attorney?.name || '')
    const attorneyType = topVote(entry.attorneyTypes) || 'Party Attorney'
    const distinctRoles = entry.roles.size
    const distinctAttorneys = entry.attorneyNames.size
    const ambiguous = distinctRoles > 1 || distinctAttorneys > 1 || !role

    const existing = matchByName(entry.name, existingParties)
    const peopleMatch = matchByName(entry.name, existingPeople)
    const filerMatch = matchByName(entry.name, filers)

    let conflict = null
    if (existing) {
      const existingRole = normalizeRole(existing.role || existing.party_type || '')
      const existingAttorney = existing.attorney_name || existing.attorney_email || ''
      if (existingRole && role && existingRole !== role) {
        conflict = { type: 'role', existingRole, proposedRole: role, name: entry.name }
      } else if (existingAttorney && attorneyName && nameKey(existingAttorney) !== nameKey(attorneyName)) {
        conflict = { type: 'attorney', existingAttorney, proposedAttorney: attorneyName, name: entry.name }
      }
      if (conflict) conflicts.push({ ...conflict, existing: true })
    }

    let directoryMatch = null
    if (attorneyName) {
      directoryMatch = (Array.isArray(attorneyDirectory) ? attorneyDirectory : []).find((item) => {
        if (!item) return false
        if (nameKey(item.name) === nameKey(attorneyName)) return true
        return entry.attorney?.email && item.email && nameKey(item.email) === nameKey(entry.attorney.email)
      }) || null
    }

    return {
      id: `proposal-${index + 1}`,
      name: entry.name,
      role,
      source: existing?.source ? existing.source : entry.source,
      sourceAmbiguous: !existing,
      attorney: {
        name: attorneyName || '',
        email: entry.attorney?.email || '',
        firm: entry.attorney?.firm || '',
        barNumber: entry.attorney?.barNumber || ''
      },
      attorneyType,
      directoryId: directoryMatch ? directoryMatch.id : (existing?.attorney_directory_id || ''),
      confidence: entry.confidence,
      ambiguous,
      distinctRoles,
      distinctAttorneys,
      evidence: entry.evidence.slice(0, 6),
      sourceDocuments: entry.sourceDocuments.slice(0, 8),
      existing: existing ? { id: existing.id, name: existing.name, role: normalizeRole(existing.role || existing.party_type || ''), source: existing.source } : null,
      peopleMatch: Boolean(peopleMatch),
      filerMatch: Boolean(filerMatch),
      conflict: conflict || undefined
    }
  })

  const orderRank = (proposal) => {
    const role = String(proposal.role || '').toLowerCase()
    if (role.startsWith('petitioner')) return 0
    if (role.startsWith('respondent') || role.includes('counter') || role.includes('cross')) return 1
    if (role.startsWith('child') || role.includes('minor')) return 2
    return 3
  }
  proposals.sort((a, b) => orderRank(a) - orderRank(b) || a.name.localeCompare(b.name))

  const pleadings = selectLatestPleadings(docs)

  const summary = {
    examined: docs.length,
    readable: readable.length,
    skipped: skipped.length,
    unreadable: unreadable.length,
    proposals: proposals.length,
    conflicts: conflicts.length,
    requireReview: proposals.length + conflicts.length
  }

  return { documents: docs, proposals, pleadings, conflicts, summary }
}
