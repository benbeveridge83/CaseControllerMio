import test from 'node:test'
import assert from 'node:assert/strict'
import { appointedMatters, makeReview, currentReview, summarize, splitLine, changeSplitHours, guessCategory, approvalContext, canApprove, approvedCurrent } from '../src/mioAppointedBillingModel.js'

export const profile = { attorney_name: 'Test Attorney', bar_number: '12345678', ssn_last4: '1234', phone: '281-555-0100', address: '100 Test St, Alvin, TX 77511' }
export const matter = { id: 'test-matter', cause_number: 'TEST-123-F', appointed: true }
export const outline = { court: '300th', cause_number: matter.cause_number, party_name: 'Test Parent', cps: true, represented_role: 'Alleged Father', appeal: false, confirmed_at: '2026-11-22T12:00:00Z' }
export const invoice = { id: 'test-invoice', matter_id: matter.id, invoice_type: 'services', invoice_number: 'MIO-TEST-1', total: 300, line_items: [
  { date: '2026-11-14', description: 'Attended status hearing', hours: 1.5, rate: 150, amount: 225 },
  { date: '2026-11-15', description: 'Review report for status hearing', hours: .5, rate: 150, amount: 75 }
] }

test('uses the Appointed setting across all case types and respects explicit exclusions', () => {
  const matters = [{ id: 'a', matter_type: 'SAPCR/Modification', appointed: true }, { id: 'b', matter_type: 'DFPS' }, { id: 'c', matter_type: 'DFPS' }, { id: 'd', matter_type: 'Other' }]
  assert.deepEqual(appointedMatters(matters, { matters: { c: { appointed: false }, d: { appointed: true } } }).map(m => m.id), ['a', 'b', 'd'])
})
test('distinguishes hearing attendance from preparation, mixed entries, appeals and expenses', () => {
  for (const [description, category] of [['Attended review hearing', 'review'], ['Prepare for trial', 'out_of_court'], ['Attended initial adversary hearing', 'adversary'], ['Attended motion hearing', 'motion'], ['Attended trial', 'trial'], ['Research appellate brief', 'appeal'], ['Prepared for and attended status hearing', '']]) assert.equal(guessCategory({ description }).category, category, description)
  assert.equal(guessCategory({ entry_type: 'expense', description: 'Sheriff service fee' }).category, 'service')
  assert.equal(guessCategory({ entry_type: 'expense', description: 'Mediation expense' }).category, '')
})
test('preserves exact invoice cents, hours and unique service dates', () => {
  const result = summarize(invoice, makeReview(invoice))
  assert.equal(result.total, 300); assert.equal(result.hours, 2); assert.deepEqual(result.errors, [])
  assert.equal(result.categories.find(c => c.id === 'status').days, 1)
  const altered = { ...invoice, total: 301 }
  assert.match(summarize(altered, makeReview(altered)).errors.join(' '), /total/)
})
test('splitting mixed work preserves original hours and dollars', () => {
  const original = invoice.line_items[0]
  const line = changeSplitHours(splitLine(makeReview(invoice).lines[0]), 0, .7, original)
  assert.equal(line.allocations.reduce((n, a) => n + a.hours, 0), 1.5)
  assert.equal(line.allocations.reduce((n, a) => n + Math.round(a.amount * 100), 0), 22500)
})
test('invoice or outline edits invalidate approval and cause mismatches block it', () => {
  const review = { ...makeReview(invoice), approved_at: 'saved', approval_context: approvalContext(outline, profile) }
  assert.ok(approvedCurrent(invoice, review, outline, profile, matter))
  assert.equal(currentReview({ ...invoice, total: 301 }, review).approved_at, '')
  assert.equal(approvedCurrent(invoice, review, { ...outline, party_name: 'Changed' }, profile, matter), false)
  assert.match(canApprove(invoice, review, { ...outline, cause_number: 'WRONG' }, profile, matter).join(' '), /cause/i)
})
test('form limits are flagged without silently changing the amount', () => {
  const high = { ...invoice, total: 600, line_items: [{ date: '2026-11-14', description: 'Attended status hearing', hours: 4, rate: 150, amount: 600 }] }, review = makeReview(high)
  assert.equal(summarize(high, review).total, 600)
  assert.match(summarize(high, review).warnings.join(' '), /300\/day/)
  assert.match(canApprove(high, review, outline, profile, matter).join(' '), /acknowledge/i)
  assert.deepEqual(canApprove(high, { ...review, acknowledged: true }, outline, profile, matter), [])
})
