// Matter and contact matching for the email dashboard.
//
// Matches the addresses on a message (from / to / cc) against the matters Ben
// already has in Mio, using client emails and opposing-party/counsel emails.
// Pure and dependency-free so it can run in the browser and in unit tests.

export function normalizeEmail(value) {
  return String(value == null ? '' : value).trim().toLowerCase()
}

export function emailAddressOf(value) {
  // Accept a plain address string or a Graph-style { emailAddress: { address } }.
  if (value && typeof value === 'object') {
    const nested = value.emailAddress || value
    return normalizeEmail(nested?.address || nested?.email || '')
  }
  return normalizeEmail(value)
}

export function addressesOfRecipients(recipients = []) {
  return (Array.isArray(recipients) ? recipients : []).map(emailAddressOf).filter(Boolean)
}

export function messageAddresses(message = {}) {
  const from = message.from?.emailAddress?.address || message.from?.address || message.from
  const to = addressesOfRecipients(message.toRecipients || message.to)
  const cc = addressesOfRecipients(message.ccRecipients || message.cc)
  return {
    from: normalizeEmail(from),
    to,
    cc,
    all: [...new Set([normalizeEmail(from), ...to, ...cc].filter(Boolean))],
  }
}

export function matterContactEmails(matter = {}) {
  const emails = []
  const client = matter.clients
  if (client?.email) {
    emails.push({
      email: normalizeEmail(client.email),
      kind: 'client',
      name: [client.first_name, client.last_name].filter(Boolean).join(' ') || client.email,
    })
  }
  const extra = matter.extra_info || matter.extraInfo || matter.matter_extra_info || {}
  for (const party of extra.opposing_parties || []) {
    if (party?.email) emails.push({ email: normalizeEmail(party.email), kind: 'opposing_party', name: party.name || party.email })
    if (party?.counsel?.email) emails.push({ email: normalizeEmail(party.counsel.email), kind: 'opposing_counsel', name: party.counsel.name || party.counsel.email })
  }
  return emails
}

export function matterDisplayName(matter = {}) {
  return (
    matter.name ||
    matter.matter_name ||
    matter.case_name ||
    (matter.clients ? `${matter.clients.first_name || ''} ${matter.clients.last_name || ''}`.trim() : '') ||
    'Matter'
  )
}

export function buildMatterIndex(matters = []) {
  const index = new Map() // email -> [{ matter, kind, name }]
  for (const matter of matters) {
    for (const contact of matterContactEmails(matter)) {
      if (!contact.email) continue
      if (!index.has(contact.email)) index.set(contact.email, [])
      index.get(contact.email).push({ matter, kind: contact.kind, name: contact.name })
    }
  }
  return index
}

export function matchMessageToMatters(message = {}, matters = [], index = null) {
  const { all } = messageAddresses(message)
  const idx = index || buildMatterIndex(matters)
  const matches = new Map() // matterId -> accumulated match
  for (const address of all) {
    const hits = idx.get(address)
    if (!hits) continue
    for (const hit of hits) {
      const id = String(hit.matter?.id ?? hit.matter?.matter_id ?? '')
      if (!matches.has(id)) matches.set(id, { matter: hit.matter, kinds: new Set(), names: new Set(), matchedEmail: address })
      matches.get(id).kinds.add(hit.kind)
      if (hit.name) matches.get(id).names.add(hit.name)
    }
  }
  return [...matches.values()].map((m) => ({
    matterId: String(m.matter?.id ?? m.matter?.matter_id ?? ''),
    matterName: matterDisplayName(m.matter),
    matchedEmail: m.matchedEmail,
    clientName: [...m.names].join(', '),
    isClient: m.kinds.has('client'),
    isOpposing: m.kinds.has('opposing_counsel') || m.kinds.has('opposing_party'),
  }))
}
