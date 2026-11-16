function normalizeSearch(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[.'’‘"]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function searchableText(issue) {
  return normalizeSearch([
    issue.title, issue.summary, issue.category, issue.subcategory, issue.rule,
    issue.preservation, issue.review, issue.remedy,
    ...(issue.appellant || []), ...(issue.appellee || []), ...(issue.record || []),
    ...(issue.cautions || []), ...(issue.tags || []),
    ...(issue.authorities || []).flatMap(source => [source.label, source.citation, source.proposition, source.court]),
  ].join(' '))
}

export function filterAppealIssues(issues, { query = '', category = 'all', savedOnly = false, savedIds = [] } = {}) {
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean)
  const saved = new Set(savedIds)
  return issues.filter(issue => {
    if (category !== 'all' && issue.category !== category) return false
    if (savedOnly && !saved.has(issue.id)) return false
    if (!tokens.length) return true
    const text = searchableText(issue)
    return tokens.every(token => text.includes(token))
  })
}

export function parseSavedIssueIds(raw, validIds) {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const valid = new Set(validIds)
    return [...new Set(parsed.filter(id => typeof id === 'string' && valid.has(id)))]
  } catch { return [] }
}

export function buildIssueText(issue, perspective = 'both') {
  const lines = [issue.title, issue.summary, '', 'GOVERNING RULE', issue.rule]
  if (perspective !== 'appellee') lines.push('', 'APPELLANT: DEVELOP THE ISSUE', ...(issue.appellant || []).map(text => `• ${text}`))
  if (perspective !== 'appellant') lines.push('', 'APPELLEE: DEFEND THE JUDGMENT', ...(issue.appellee || []).map(text => `• ${text}`))
  lines.push('', 'PRESERVATION', issue.preservation, '', 'STANDARD OF REVIEW', issue.review,
    '', 'RECORD TO CHECK', ...(issue.record || []).map(text => `• ${text}`), '', 'POTENTIAL RELIEF', issue.remedy)
  if (issue.cautions?.length) lines.push('', 'QUALIFICATIONS', ...issue.cautions.map(text => `• ${text}`))
  lines.push('', 'AUTHORITIES', ...(issue.authorities || []).map(source => `${source.label}${source.label === source.citation ? '' : ` — ${source.citation}`}\n${source.proposition}\n${source.url}`))
  return lines.join('\n')
}
