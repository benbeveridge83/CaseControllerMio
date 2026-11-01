// Pure scheduling-email composition for the Paralegal (Phase 2).
// No sending and no side effects. Returns { to, subject, body } or throws.

export const EMAIL_ACTIONS = {
  draft_date_request: 'draft_date_request',
  draft_follow_up: 'draft_follow_up',
  draft_client_update: 'draft_client_update'
}

export function recipientRoleFor(action, task = {}) {
  if (action === EMAIL_ACTIONS.draft_client_update) return 'client'
  if (action === EMAIL_ACTIONS.draft_date_request) return 'court'
  const waiting = String(task.waitingOn || '').toLowerCase()
  if (waiting.includes('client')) return 'client'
  if (waiting.includes('court') || waiting.includes('mediator') || waiting.includes('judge')) return 'court'
  return 'opposingCounsel'
}

export function subjectFor(action, task = {}) {
  const matter = task.matterName || 'this matter'
  if (action === EMAIL_ACTIONS.draft_date_request) return `Hearing dates requested — ${matter}`
  if (action === EMAIL_ACTIONS.draft_client_update) return `Update on scheduling — ${matter}`
  return `Scheduling follow-up — ${matter}`
}

export function bodyFor(action, task = {}, instruction = '') {
  const matter = task.matterName || 'this matter'
  const step = task.step || task.nextAction || 'the next scheduling step'
  const extra = String(instruction || '').trim()
  if (action === EMAIL_ACTIONS.draft_date_request) {
    return [`We are requesting available hearing dates for ${matter}.`, `Current step: ${step}.`, extra].filter(Boolean).join('\n\n')
  }
  if (action === EMAIL_ACTIONS.draft_client_update) {
    return [`Quick update on ${matter}: ${step}.`, extra].filter(Boolean).join('\n\n')
  }
  return [`Following up on ${matter} (${step}).`, extra].filter(Boolean).join('\n\n')
}

export function composeScheduleEmail(task = {}, { action, instruction = '', contacts = {} } = {}) {
  if (!EMAIL_ACTIONS[action]) throw Object.assign(new Error('Unsupported email action.'), { code: 'INVALID_ACTION' })
  const role = recipientRoleFor(action, task)
  const raw = contacts[role]
  const to = Array.isArray(raw) ? raw.filter(Boolean) : (raw ? [raw] : [])
  if (to.length === 0) throw Object.assign(new Error('No recipient is available for this action.'), { code: 'DRAFT_NO_RECIPIENT' })
  return { to, subject: subjectFor(action, task), body: bodyFor(action, task, instruction) }
}
