import { citationText } from './model.js'

export function mergeAiDrafts(current, results) {
  const next = { ...current }
  for (const result of results) {
    const entry = { ...next[result.id] }
    for (const kind of ['privilege', 'objection']) {
      if (entry[kind]?.origin === 'manual') continue
      const value = result[kind]?.trim()
      if (!value) { delete entry[kind]; continue }
      const authorities = result[kind === 'privilege' ? 'privilegeAuthorities' : 'authorities'] || []
      entry[kind] = { text: `${value}${authorities.length ? ` Authority: ${citationText(authorities)}.` : ''}`, origin: 'ai', selected: false, strength: result[`${kind}Strength`] ?? null, strengthSource: 'ai', strengthReason: result[`${kind}StrengthReason`] || '' }
    }
    if (Object.keys(entry).length) next[result.id] = entry
    else delete next[result.id]
  }
  return next
}
export function invalidateAiDrafts(current) {
  return Object.fromEntries(Object.entries(current).map(([id, entry]) => [id, Object.fromEntries(Object.entries(entry).filter(([, draft]) => draft.origin === 'manual'))]).filter(([, entry]) => Object.keys(entry).length))
}
export function collectAnnotations(requests, drafts) {
  const output = { objections: [], privileges: [] }
  for (const request of requests) for (const kind of ['privilege', 'objection']) {
    const draft = drafts[request.id]?.[kind]
    if (!draft?.selected) continue
    if (!draft.text?.trim() || /\[[^\]]+\]/.test(draft.text)) throw new Error('Complete the bracketed fact placeholders and any empty selected objection or privilege before exporting.')
    output[`${kind}s`].push({ id: request.id, text: draft.text.trim() })
  }
  return output
}
