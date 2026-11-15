// Folder selection for the email dashboard.
//
// Ben chooses, per mailbox, which folders (inbox plus subfolders) feed the
// dashboard. Checkboxes support all, none, one, or any combination. Selected
// folders control which messages are included.

export function selectedFolderIdsFor(settings = {}, accountEmail) {
  const key = String(accountEmail || '').trim().toLowerCase()
  const list = Array.isArray(settings[key]) ? settings[key] : []
  return new Set(list.filter(Boolean).map(String))
}

export function isFolderSelected(settings = {}, accountEmail, folderId) {
  return selectedFolderIdsFor(settings, accountEmail).has(String(folderId))
}

export function settingsAccounts(settings = {}) {
  return Object.keys(settings || {}).filter((key) => selectedFolderIdsFor(settings, key).size > 0)
}

export function applyFolderFilter(messages = [], settings = {}) {
  const allowed = new Set()
  for (const account of settingsAccounts(settings)) {
    for (const folderId of selectedFolderIdsFor(settings, account)) allowed.add(`${account}::${folderId}`)
  }
  if (allowed.size === 0) return []
  return messages.filter((message) => {
    const account = String(message.accountEmail || message.mailbox || '').trim().toLowerCase()
    const folder = String(message.folderId || message.parentFolderId || message.folder || '').trim()
    return allowed.has(`${account}::${folder}`)
  })
}

// Normalize a raw settings object (from the database or the client) into the
// { accountEmail: [folderId, ...] } shape the rest of the module consumes.
export function normalizeFolderSettings(rows = []) {
  const settings = {}
  for (const row of rows || []) {
    const account = String(row.account_email || row.accountEmail || '').trim().toLowerCase()
    const folderId = String(row.folder_id || row.folderId || '')
    if (!account || !folderId) continue
    if (row.enabled === false || row.enabled === 0) continue
    if (!settings[account]) settings[account] = []
    if (!settings[account].includes(folderId)) settings[account].push(folderId)
  }
  return settings
}
