import { weeklyBillingDefaults } from './mioWeeklyBillingModel.js'

export const APPOINTED_KEY = 'caseMioAppointedBillingV1'
export const LEGACY_KEY = 'caseMioDfpsBillingV1'
export const WEEKLY_SETTINGS_KEY = 'mioWeeklyBillingSettingsV1'
export const ROLES = ['Custodial Parent', 'NonCustodial Parent', 'Unknown Father', 'Alleged Father', 'Child or Children']
// Exact fields from the supplied county form, shared by both original HTMLs.
export const CATEGORIES = [
  { id: 'adversary', label: 'Initial Adversary Hearing', dayField: '# Days/Hrs', date: 'Court Date 1', field: 'Amount', daily: 750 },
  { id: 'status', label: 'Status Hearings', dayField: '# Days/Hrs 2', date: 'Court Date 2', field: 'Amount 2', daily: 300 },
  { id: 'subsequent', label: 'Subsequent Hearings', dayField: '# Days/Hrs 3', date: 'Court Date 3', field: 'Amount 3', daily: 300 },
  { id: 'review', label: 'Review Hearings', dayField: '# Days/Hrs 4', date: 'Court Date 4', field: 'Amount 4', daily: 300 },
  { id: 'motion', label: 'Motions Hearings', dayField: '# Days/Hrs5', date: 'Court Date 5', field: 'Amount 5', daily: 300 },
  { id: 'trial', label: 'Trial', dayField: '# Days/Hrs 6', date: 'Court Date 6', field: 'Amount 6', daily: 750 },
  { id: 'appeal', label: 'Appeals', field: 'Amount 7', maximum: 5000 },
  { id: 'out_of_court', label: 'Out-of-Court Hours Costs', dayField: '# Days/Hrs 7', field: 'Amount 8', daily: 300 },
  { id: 'copies', label: 'Copies', field: 'Amount 10', expense: true },
  { id: 'service', label: 'Service Fees', field: 'Amount 11', expense: true },
  { id: 'travel', label: 'Travel', field: 'Amount 12', expense: true }
]
export const num = value => Number.isFinite(Number(value)) ? Number(value) : 0
export const cents = value => Math.round(num(value) * 100)
export const normalizeCause = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const isExpense = line => line.entry_type === 'expense' || line.source_kind === 'expense' || line.is_expense === true
export const serviceInvoice = invoice => !['trust_request', 'void', 'voided', 'cancelled', 'deleted'].includes(invoice.invoice_type) && !['void', 'voided', 'cancelled', 'deleted'].includes(invoice.status)

export function appointedMatters(matters, settings = {}) {
  return matters.filter(matter => (settings.matters?.[String(matter.id)]?.appointed ?? weeklyBillingDefaults(matter).appointed) === true)
}
export function normalizeState(value = {}) {
  return { version: 1, profile: {}, outlines: {}, reviews: {}, ...value,
    batch: { matter_ids: [], invoice_ids: [], ...(value.batch || {}), step: Math.min(3, Math.max(1, Number(value.batch?.step) || 1)) } }
}
export function fingerprint(invoice) {
  return JSON.stringify({ id: invoice.id, total: invoice.total, type: invoice.invoice_type,
    lines: (invoice.line_items || []).map(l => [l.billing_entry_id, l.date, l.description, l.hours, l.rate, l.amount, l.entry_type, l.expense_category, l.source_kind]) })
}
export const approvalContext = (outline, profile) => JSON.stringify([outline, profile])

export function guessCategory(line = {}) {
  const text = `${line.description || ''} ${line.expense_category || ''}`.toLowerCase()
  if (isExpense(line)) {
    if (/cop(?:y|ies)|postage/.test(text)) return { category: 'copies', reason: 'Copy expense; check the electronic-copy policy.' }
    if (/service|process server|constable|sheriff/.test(text)) return { category: 'service', reason: 'Service expense; check the form requirements.' }
    if (/travel|mileage/.test(text)) return { category: 'travel', reason: 'Travel requires prior court approval.' }
    return { category: '', reason: 'This expense has no matching voucher row. Review its treatment.' }
  }
  if (/travel|drive|driving/.test(text)) return { category: '', reason: 'Review travel and any prior court approval.' }
  if (/\bappeal\w*|appellat\w*|\bbrief\b/.test(text)) return { category: 'appeal', reason: 'Appellate work.' }
  const preparation = /\b(prep\w*|draft\w*|research\w*|review\w*|email\w*|call\w*|confer\w*|read\w*)\b/.test(text.replace(/review hearings?/g, 'hearing'))
  const attendance = /\b(appear\w*|attend\w*|court appearance|in court|trial day)\b/.test(text)
  if (preparation && attendance) return { category: '', reason: 'Combined preparation and attendance. Split the activity or choose its category.' }
  if (preparation) return { category: 'out_of_court', reason: 'Preparation, drafting, communication or document review.' }
  if (/adversary|14.day hearing/.test(text)) return { category: 'adversary', reason: 'Initial adversary hearing.' }
  if (/status hearing/.test(text)) return { category: 'status', reason: 'Status hearing.' }
  if (/review hearing|permanency.*(?:hearing|court)/.test(text)) return { category: 'review', reason: 'Review or permanency hearing.' }
  if (/motion.*hearing|hearing.*motion/.test(text)) return { category: 'motion', reason: 'Motion hearing.' }
  if (/\btrial\b|jury/.test(text)) return { category: 'trial', reason: 'Trial attendance.' }
  if (attendance || /\bhearing\b/.test(text)) return { category: 'subsequent', reason: 'Hearing attendance; confirm the hearing type.' }
  if (line.source_kind === 'snapshot_wip') return { category: '', reason: 'Opening WIP has no itemized activity. Add details to the invoice.' }
  return { category: 'out_of_court', reason: 'Suggested out-of-court work; review the description.' }
}
export function makeReview(invoice) {
  return { fingerprint: fingerprint(invoice), approved_at: '', acknowledged: false,
    lines: (invoice.line_items || []).map((line, i) => ({ id: String(i), source: 'rules', reason: guessCategory(line).reason,
      allocations: [{ category: guessCategory(line).category, hours: line.hours === '' || line.hours == null ? '' : num(line.hours), amount: num(line.amount) }] })) }
}
export const currentReview = (invoice, saved) => saved?.fingerprint === fingerprint(invoice) ? saved : makeReview(invoice)
export function splitLine(line) {
  if (line.allocations.length !== 1 || num(line.allocations[0].hours) <= 0) return line
  const original = line.allocations[0], firstHours = Math.floor(num(original.hours) * 50) / 100
  const firstCents = Math.round(cents(original.amount) * firstHours / num(original.hours))
  return { ...line, source: 'manual', allocations: [{ ...original, hours: firstHours, amount: firstCents / 100 },
    { ...original, hours: Math.round((num(original.hours) - firstHours) * 10000) / 10000, amount: (cents(original.amount) - firstCents) / 100 }] }
}
export function changeSplitHours(line, index, value, original) {
  const hours = Math.max(0, Math.min(num(original.hours), num(value)))
  const amount = num(original.hours) ? Math.round(cents(original.amount) * hours / num(original.hours)) : 0
  return { ...line, source: 'manual', allocations: line.allocations.map((a, i) => ({ ...a,
    hours: i === index ? hours : Math.round((num(original.hours) - hours) * 10000) / 10000,
    amount: (i === index ? amount : cents(original.amount) - amount) / 100 })) }
}
export function summarize(invoice, review) {
  const categories = new Map(CATEGORIES.map(c => [c.id, { ...c, hours: 0, amountCents: 0, dates: new Set(), byDate: new Map() }]))
  const errors = [], warnings = []
  if (!invoice.line_items?.length) errors.push('This invoice has no itemized billing activities.')
  if (review.fingerprint !== fingerprint(invoice)) errors.push('The invoice changed. Review its current activities again.')
  for (const [i, line] of (invoice.line_items || []).entries()) {
    const allocations = review.lines?.find(r => r.id === String(i))?.allocations || []
    if (!allocations.length) errors.push(`Entry ${i + 1} has no category.`)
    if (allocations.reduce((sum, a) => sum + cents(a.amount), 0) !== cents(line.amount)) errors.push(`Entry ${i + 1}: split amounts must match its invoice amount.`)
    if (Math.abs(allocations.reduce((sum, a) => sum + num(a.hours), 0) - num(line.hours)) > .0001) errors.push(`Entry ${i + 1}: split hours must match its invoice hours.`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(line.date || '') || !Number.isFinite(Date.parse(`${line.date}T12:00:00Z`))) errors.push(`Entry ${i + 1} needs a service date on the invoice.`)
    if (!isExpense(line) && cents(line.amount) > 0 && num(line.hours) <= 0) errors.push(`Entry ${i + 1} needs itemized service hours on the invoice.`)
    for (const allocation of allocations) {
      const c = categories.get(allocation.category)
      if (!c) { errors.push(`Entry ${i + 1} needs a voucher category.`); continue }
      if (!Number.isFinite(Number(allocation.amount)) || num(allocation.amount) < 0 || num(allocation.hours) < 0) errors.push(`Entry ${i + 1} has invalid hours or amount.`)
      c.hours += num(allocation.hours); c.amountCents += cents(allocation.amount)
      if (cents(allocation.amount) || num(allocation.hours)) c.dates.add(line.date)
      c.byDate.set(line.date, (c.byDate.get(line.date) || 0) + cents(allocation.amount))
      if (c.expense) warnings.push(`${c.label}: check the conditions printed on the form and any required court approval.`)
      if (!c.expense && c.id !== 'appeal' && num(allocation.hours) > 0 && Math.abs(cents(allocation.amount) - cents(num(allocation.hours) * 150)) > 1) warnings.push(`Entry ${i + 1}: the invoice rate differs from the $150/hour printed on the supplied voucher.`)
    }
  }
  const used = [...categories.values()].filter(c => c.amountCents || c.hours).map(c => ({ ...c, days: c.dates.size, dates: [...c.dates].sort(), amount: c.amountCents / 100 }))
  const total = used.reduce((sum, c) => sum + c.amountCents, 0) / 100
  if (cents(total) !== cents(invoice.total)) errors.push('The voucher total does not match the saved invoice total.')
  for (const c of used) {
    if (c.maximum && c.amount > c.maximum) warnings.push(`${c.label} exceeds the $${c.maximum} maximum printed on the form.`)
    for (const [day, amount] of c.byDate) if (c.daily && amount > cents(c.daily)) warnings.push(`${c.label} on ${day} exceeds the $${c.daily}/day maximum printed on the form.`)
  }
  return { categories: used, total, hours: used.reduce((sum, c) => sum + c.hours, 0), errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}
export function profileErrors(profile = {}) {
  const errors = []
  for (const [key, label] of [['attorney_name', 'Attorney name'], ['address', 'Mailing address']]) if (!String(profile[key] || '').trim()) errors.push(`${label} is required.`)
  if (!/^\d{8}$/.test(profile.bar_number || '')) errors.push('Enter an eight-digit bar number.')
  if (!/^\d{4}$/.test(profile.ssn_last4 || '')) errors.push('Enter the last four SSN digits.')
  if (String(profile.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').length !== 10) errors.push('Enter a ten-digit phone number.')
  return errors
}
export function outlineErrors(outline = {}, matter = {}) {
  const errors = []
  if (!outline.confirmed_at) errors.push('Confirm the voucher outline.')
  for (const [key, label] of [['court', 'Court'], ['cause_number', 'Cause number'], ['party_name', 'Party name or child initials']]) if (!String(outline[key] || '').trim()) errors.push(`${label} is required.`)
  if (matter.cause_number && normalizeCause(outline.cause_number) !== normalizeCause(matter.cause_number)) errors.push('The outline cause number differs from the matter. Check the case before billing.')
  if (outline.cps !== false && !ROLES.includes(outline.represented_role)) errors.push('Select the person represented for this CPS appointment.')
  if (outline.cps !== false && outline.represented_role === 'Child or Children' && (!Number.isInteger(Number(outline.child_count)) || Number(outline.child_count) < 1)) errors.push('Enter the number of children represented.')
  return errors
}
export function canApprove(invoice, review, outline, profile, matter) {
  const result = summarize(invoice, review)
  return [...profileErrors(profile), ...outlineErrors(outline, matter), ...result.errors,
    ...(result.warnings.length && !review.acknowledged ? ['Review and acknowledge the voucher notes.'] : [])]
}
export function approvedCurrent(invoice, review, outline, profile, matter) {
  return !!review.approved_at && review.approval_context === approvalContext(outline, profile) && !canApprove(invoice, review, outline, profile, matter).length
}
