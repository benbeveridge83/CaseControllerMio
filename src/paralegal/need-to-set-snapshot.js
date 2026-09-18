const MAX_ROWS = 200
const TEXT_LIMIT = 600
const FIELDS = ['id','matterId','matterName','clientName','category','stage','waitingOn','currentStep','latestUpdate','nextAction']

function cleanText(value) {
  if (value == null) return ''
  return String(value).trim().slice(0, TEXT_LIMIT)
}

export function normalizeNeedToSetSnapshot(rows = []) {
  if (!Array.isArray(rows)) throw new Error('Need to Set snapshot must be an array.')
  if (rows.length > MAX_ROWS) throw new Error('Too many Need to Set rows to send to the agent at once.')
  return rows.map((row = {}) => {
    const out = {}
    for (const key of FIELDS) out[key] = cleanText(row[key])
    out.ageDays = Number.isFinite(Number(row.ageDays)) ? Math.max(0, Math.min(9999, Number(row.ageDays))) : 0
    out.hasNewEmail = row.hasNewEmail === true
    return out
  })
}
