import { CATEGORIES, ROLES, normalizeCause, summarize, canApprove, approvedCurrent } from './mioAppointedBillingModel.js'
let libraryPromise
const library = () => libraryPromise ||= import('pdf-lib')
let fontBytesPromise
async function embeddedFont(pdf, bytes) {
  const { default: fontkit } = await import('@pdf-lib/fontkit')
  pdf.registerFontkit(fontkit)
  if (!bytes) {
    fontBytesPromise ||= fetch('/fonts/LiberationSans-Regular.ttf').then(async response => {
      if (!response.ok) throw new Error('The voucher font could not be loaded. Please retry.')
      return new Uint8Array(await response.arrayBuffer())
    }).catch(error => { fontBytesPromise = null; throw error })
    bytes = await fontBytesPromise
  }
  return pdf.embedFont(bytes, { subset: true })
}
const profileFields = { attorney_name: 'Attny Name', bar_number: 'Bar Card Number', ssn_last4: 'Last 4 digits', address: 'Mailing Address' }
const safe = value => String(value ?? '').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').replace(/[^\x20-\x7e]/g, '?').trim()
export function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
}
export const base64ToBytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0))

export async function readVoucherOutline(bytes, matter) {
  const { PDFDocument } = await library(), pdf = await PDFDocument.load(bytes)
  if (pdf.getPageCount() !== 1) throw new Error('Upload a one-page voucher outline.')
  const form = pdf.getForm()
  for (const field of form.getFields()) if (field.constructor.name === 'PDFSignature' && field.acroField.dict.get((await library()).PDFName.of('V'))) throw new Error('This PDF has a digital signature. Use an unsigned outline.')
  const text = name => { try { return form.getTextField(name).getText() || '' } catch { throw new Error(`The outline is missing the expected voucher field: ${name}.`) } }
  for (const c of CATEGORIES) text(c.field)
  const outline = { court: text('Court'), cause_number: text('Cause Number'), party_name: text('Party or Child Name use initials for minors'), cps: true,
    child_count: text('of children represented'), represented_role: '', appeal: false, confirmed_at: '' }
  if (matter?.cause_number && normalizeCause(outline.cause_number) !== normalizeCause(matter.cause_number)) throw new Error('This outline has a different cause number from the selected matter. Check the case before importing.')
  for (const role of ROLES) if (form.getCheckBox(role).isChecked()) outline.represented_role = role
  try { outline.appeal = String(form.getRadioGroup('Appeal').getSelected()).toLowerCase() === 'yes' } catch { /* confirmed on the outline screen */ }
  const profile = Object.fromEntries(Object.entries(profileFields).map(([key, name]) => [key, text(name)]))
  profile.phone = ['Area Code', 'Number', 'Number2'].map(text).join('-')
  return { outline, profile }
}
async function load(templateBytes) {
  const { PDFDocument } = await library()
  if (templateBytes) return PDFDocument.load(templateBytes)
  const response = await fetch('/forms/appointed-fee-voucher.pdf')
  if (!response.ok) throw new Error('The county voucher form could not be loaded. Please retry.')
  return PDFDocument.load(await response.arrayBuffer())
}
function fill(form, font, name, value, maximum = 10) {
  const field = form.getTextField(name), text = safe(value)
  field.setText(text)
  const width = Math.min(...field.acroField.getWidgets().map(w => w.getRectangle().width)) - 5
  const measured = font.widthOfTextAtSize(text, maximum)
  field.updateAppearances(font) // Repairs missing /DA on the supplied attorney-name field.
  field.setFontSize(Math.max(6, Math.min(maximum, measured ? maximum * width / measured : maximum)))
}
function fillOutline(form, font, outline, profile) {
  const phone = String(profile.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  const fields = { Court: outline.court, 'Cause Number': outline.cause_number, 'Party or Child Name use initials for minors': outline.party_name,
    'of children represented': outline.cps !== false && outline.represented_role === 'Child or Children' ? outline.child_count : '',
    'Area Code': phone.slice(0, 3), Number: phone.slice(3, 6), Number2: phone.slice(6) }
  for (const [key, name] of Object.entries(profileFields)) fields[name] = profile[key]
  for (const [name, value] of Object.entries(fields)) fill(form, font, name, value)
  for (const role of ROLES) { const field = form.getCheckBox(role); if (outline.cps !== false && role === outline.represented_role) field.check(); else field.uncheck() }
  const appeal = form.getRadioGroup('Appeal')
  const option = appeal.getOptions().find(option => option.toLowerCase() === (outline.appeal ? 'yes' : 'no'))
  if (!option) throw new Error('The voucher does not contain the expected appeal choices.')
  appeal.select(option)
}
function clearBilling(form, font) {
  for (const c of CATEGORIES) {
    fill(form, font, c.field, '')
    if (c.dayField) fill(form, font, c.dayField, '')
    if (c.date) fill(form, font, c.date, '')
  }
  fill(form, font, 'Total', '')
}
export async function buildOutlinePdf({ outline, profile, templateBytes, fontBytes }) {
  const pdf = await load(templateBytes), font = await embeddedFont(pdf, fontBytes)
  const form = pdf.getForm()
  fillOutline(form, font, outline, profile); clearBilling(form, font); form.updateFieldAppearances(font)
  return pdf.save()
}
export async function buildVoucherPdf({ invoice, review, outline, profile, matter, templateBytes, fontBytes, sign = false }) {
  const errors = canApprove(invoice, review, outline, profile, matter)
  if (errors.length) throw new Error(errors.join(' '))
  if (!approvedCurrent(invoice, review, outline, profile, matter)) throw new Error('Approve the current invoice categories and outline before creating its voucher.')
  const pdf = await load(templateBytes), font = await embeddedFont(pdf, fontBytes)
  const form = pdf.getForm(), summary = summarize(invoice, review)
  fillOutline(form, font, outline, profile); clearBilling(form, font)
  let hasDateDetail = false
  for (const c of summary.categories) {
    fill(form, font, c.field, c.amount.toFixed(2))
    if (c.dayField) fill(form, font, c.dayField, `${c.days} / ${Number(c.hours.toFixed(4))}`, 9)
    if (c.date) {
      const dates = c.dates.map(date => { const [y, m, d] = date.split('-'); return `${Number(m)}/${Number(d)}/${y.slice(2)}` }).join(', ')
      if (dates.length > 18) hasDateDetail = true
      fill(form, font, c.date, dates.length > 18 ? 'See dates p. 2' : dates, 8)
    }
  }
  fill(form, font, 'Total', summary.total.toFixed(2)); form.updateFieldAppearances(font)
  if (sign) pdf.getPage(0).drawText(safe(`/s/ ${profile.attorney_name}`), { x: 396, y: 106, size: 10, font })
  if (hasDateDetail) {
    let page, y
    const addPage = () => {
      page = pdf.addPage([612, 792]); y = 740
      page.drawText('VOUCHER SERVICE DATE DETAIL', { x: 48, y, size: 13, font }); y -= 25
      page.drawText(safe(`${outline.cause_number} | ${outline.party_name} | Invoice ${invoice.invoice_number}`), { x: 48, y, size: 9, font }); y -= 30
    }
    addPage()
    for (const c of summary.categories) {
      if (y < 100) addPage()
      page.drawText(safe(`${c.label}: ${c.days} day(s), ${Number(c.hours.toFixed(4))} hours, $${c.amount.toFixed(2)}`), { x: 48, y, size: 10, font }); y -= 18
      for (let i = 0; i < c.dates.length; i += 7) {
        if (y < 65) addPage()
        page.drawText(c.dates.slice(i, i + 7).join(', '), { x: 60, y, size: 9, font }); y -= 17
      }
      y -= 12
    }
  }
  pdf.setTitle(`Fee Voucher - ${outline.cause_number} - ${invoice.invoice_number}`)
  return pdf.save()
}
