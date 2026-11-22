import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { makeReview, approvalContext } from '../src/mioAppointedBillingModel.js'
import { buildOutlinePdf, buildVoucherPdf, readVoucherOutline } from '../src/mioAppointedVoucherPdf.js'

const templateBytes = fs.readFileSync(new URL('../public/forms/appointed-fee-voucher.pdf', import.meta.url))
const fontBytes = fs.readFileSync(new URL('../public/fonts/LiberationSans-Regular.ttf', import.meta.url))
const profile = { attorney_name: 'Test Attorney', bar_number: '12345678', ssn_last4: '1234', phone: '281-555-0100', address: '100 Test St, Alvin TX 77511' }
const matter = { id: 'pdf-test', cause_number: 'TEST-123-F' }
const outline = { court: '300th', cause_number: matter.cause_number, party_name: 'Test Parent', represented_role: 'Alleged Father', cps: true, appeal: false, confirmed_at: '2026-11-22T12:00:00Z' }
const invoice = { id: 'pdf-invoice', invoice_type: 'services', invoice_number: 'MIO-TEST-1', total: 300, line_items: [
  { date: '2026-11-14', description: 'Attended status hearing', hours: 1.5, rate: 150, amount: 225 },
  { date: '2026-11-15', description: 'Review report', hours: .5, rate: 150, amount: 75 }
] }
const approved = (inv = invoice, out = outline) => ({ ...makeReview(inv), approved_at: '2026-11-22T12:00:00Z', approval_context: approvalContext(out, profile) })

test('the reusable outline has case/profile fields and no prior billing amounts', async () => {
  const bytes = await buildOutlinePdf({ outline, profile, templateBytes, fontBytes })
  const form = (await PDFDocument.load(bytes)).getForm()
  assert.equal(form.getTextField('Cause Number').getText(), matter.cause_number)
  assert.equal(form.getTextField('Total').getText() || '', '')
  const imported = await readVoucherOutline(bytes, matter)
  assert.equal(imported.profile.bar_number, '12345678'); assert.equal(imported.outline.represented_role, 'Alleged Father')
  await assert.rejects(readVoucherOutline(bytes, { cause_number: 'WRONG' }), /different cause/)
})
test('fills exact named fields, keeps the form editable and emits only the voucher', async () => {
  const bytes = await buildVoucherPdf({ invoice, review: approved(), outline, profile, matter, templateBytes, fontBytes })
  const pdf = await PDFDocument.load(bytes), form = pdf.getForm()
  assert.equal(pdf.getPageCount(), 1, 'An invoice is not appended in this release')
  for (const [name, expected] of Object.entries({ Total: '300.00', 'Amount 2': '225.00', 'Amount 8': '75.00', 'Court Date 2': '11/14/26', '# Days/Hrs 2': '1 / 1.5' })) assert.equal(form.getTextField(name).getText(), expected, name)
  assert.equal(form.getRadioGroup('Appeal').getSelected(), 'No'); assert.ok(form.getCheckBox('Alleged Father').isChecked())
  assert.ok(form.getTextField('Total').acroField.getWidgets()[0].dict.has((await import('pdf-lib')).PDFName.of('AP')))
  fs.mkdirSync('test-results', { recursive: true }); fs.writeFileSync('test-results/appointed-voucher.pdf', bytes)
})
test('a non-CPS appointed matter may leave CPS-only representation fields blank', async () => {
  const other = { ...outline, cps: false, represented_role: '' }
  const bytes = await buildVoucherPdf({ invoice, review: approved(invoice, other), outline: other, profile, matter, templateBytes, fontBytes })
  const form = (await PDFDocument.load(bytes)).getForm()
  assert.ok(!form.getCheckBox('Alleged Father').isChecked())
})
test('long lists of court dates get a legible date detail page', async () => {
  const many = { ...invoice, total: 150, line_items: [1, 3, 5, 7].map(day => ({ date: `2026-11-${String(day).padStart(2, '0')}`, description: 'Attended status hearing', hours: .25, rate: 150, amount: 37.5 })) }
  const bytes = await buildVoucherPdf({ invoice: many, review: approved(many), outline, profile, matter, templateBytes, fontBytes })
  const pdf = await PDFDocument.load(bytes)
  assert.equal(pdf.getPageCount(), 2)
  assert.equal(pdf.getForm().getTextField('Court Date 2').getText(), 'See dates p. 2')
  fs.writeFileSync('test-results/appointed-voucher-dates.pdf', bytes)
})
test('stale and missing approvals are rejected before voucher creation', async () => {
  await assert.rejects(buildVoucherPdf({ invoice, review: makeReview(invoice), outline, profile, matter, templateBytes, fontBytes }), /Approve/)
  await assert.rejects(buildVoucherPdf({ invoice, review: approved(), outline: { ...outline, party_name: 'Changed' }, profile, matter, templateBytes, fontBytes }), /Approve/)
})
