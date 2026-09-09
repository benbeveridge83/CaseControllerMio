import assert from 'node:assert/strict'
import fs from 'node:fs'
import plugin, { serviceV309Helpers } from '../mio-v309-service-eservice-batch.js'

const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const transformed = plugin().transform(source, '/src/App.jsx').code
assert.equal(plugin().transform(source, '/src/Other.jsx'), null)
assert.equal(plugin().transform(transformed, '/src/App.jsx').code, transformed)
assert.throws(() => plugin().transform("const MIO_APP_VERSION = 'Mio V308'", '/src/App.jsx'), /anchor|section/)
assert.ok(transformed.includes('files_saved_or_confirmed'))
assert.ok(transformed.includes('const nextDocuments = [documentRecord, ...serviceV309DocumentsRef.current]'))
const section = (start, end) => transformed.slice(transformed.indexOf(start), transformed.indexOf(end, transformed.indexOf(start)))
const save = section('  async function saveDownloadedServicePdf(', '  async function openServiceRowPdf(')
const bill = section('  async function processSingleFilingServiceEmail(', '  async function sendSingleServiceEmailAndMove(')
assert.ok(!bill.includes('ensureNotificationHearingSafetyBeforeMove'))
assert.equal((bill.match(/maybeCreateServiceEmailBillingEntry\(/g) || []).length, 1)
assert.ok(bill.indexOf('await saveDownloadedServicePdf') < bill.indexOf('maybeCreateServiceEmailBillingEntry'))

const pdf = (name) => new File(['%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF'], name, { type: 'application/pdf' })
function setup({ files = [pdf('Motion.pdf'), pdf('Order.pdf')], pending = false, failAt = '', cancel = false, html = false } = {}) {
  const calls = { saved: [], records: [], bills: [], moved: [], notes: [], picker: [] }
  const row = { id: 'email-one', suggested_matter_id: 'matter-one', subject: 'Notification of Service', billing_minutes: 6, attachments: [] }
  const context = {
    documents: [], serviceEmailRows: [row],
    useRef: (value) => ({ current: value }), useEffect: (fn) => fn(),
    normalizeServicePdfBlob: async (value) => value,
    verifiedServicePdfFileName: (name) => /\.pdf$/i.test(name || '') && !/ViewServiceDocuments|Filer_Information/i.test(name) ? name : '',
    window: { showOpenFilePicker: async (options) => { calls.picker.push(options); if (cancel) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }); return files.map((file) => ({ getFile: async () => file })) } },
    URL: { createObjectURL: (value) => 'blob:test-' + value.name },
    setServiceEmailRows: (update) => { context.serviceEmailRows = update(context.serviceEmailRows) },
    setSelectedPdfPreviewName: () => {}, setSelectedPdfPreviewUrl: () => {},
    setServiceEmailScanNote: (note) => calls.notes.push(note),
    resolveServiceEmailMatterId: (item) => item.suggested_matter_id,
    serviceEmailPathIsKnown: () => true, serviceEmailSavePath: () => 'OneDrive/Existing/eFile',
    createMioEfileFolderError: (message) => new Error(message),
    primaryServicePdfAttachment: (item) => item.attachments?.[0] || null,
    primaryServiceFilingLink: () => html ? { url: 'https://example.invalid/list' } : null,
    downloadServiceFilingLink: async () => ({ id: 'html', name: 'Motion.pdf', content_type: 'text/html', blob: new Blob(['<html>Document list</html>']) }),
    resolveServiceActualPdfFileName: (item, attachment) => ({ name: attachment?.name || '', source: 'selected_file' }),
    missingActualServiceFileNameMessage: () => 'Original filename missing',
    uploadServicePdfToOneDriveFolder: async (item, name) => { if (name === failAt) throw new Error('Simulated save failure'); calls.saved.push(name); return { ok: true, verified: true, fileName: name, savedPath: 'eFile/' + name } },
    createServiceEmailDocumentRecord: async (item, name) => { calls.records.push(name) },
    serviceEmailDocumentTagIds: () => [], serviceEmailDocumentTagLabel: () => 'Filing',
    serviceHearingNeedsAttention: () => pending,
    serviceEmailRowCategory: () => 'notification_service',
    setServiceGraphBusy: () => {},
    maybeCreateServiceEmailBillingEntry: (item) => { if (!calls.bills.some((entry) => entry.id === item.id)) calls.bills.push({ id: item.id, minutes: item.billing_minutes }); return { id: item.id } },
    serviceGraphConfig: { mode: 'live' }, serviceGraphAuth: { connected: true },
    moveLiveRowToRead: async (item) => calls.moved.push(item.id),
    recordServiceEmailAction: () => {}, setSavedFilingReviewRows: () => {},
    isMioEfileFolderError: () => false, isGraphItemNotFound: () => false, alert: () => {}
  }
  const runtime = new Function('context', `with (context) { ${serviceV309Helpers}\n${save}\n${bill}\nreturn { pickLocalServicePdfAttachment, saveDownloadedServicePdf, processSingleFilingServiceEmail, serviceV309BatchesRef, serviceV309PdfBytes }; }`)(context)
  return { calls, row, context, runtime }
}

{
  const { calls, row, runtime } = setup()
  assert.equal(await runtime.processSingleFilingServiceEmail(row), true)
  assert.deepEqual(calls.saved, ['Motion.pdf', 'Order.pdf'])
  assert.deepEqual(calls.records, calls.saved)
  assert.deepEqual(calls.bills, [{ id: row.id, minutes: 6 }])
  assert.deepEqual(calls.moved, [row.id])
  assert.equal(calls.picker[0].multiple, true)
  console.log('PASS: two original filenames, two document records, one six-minute entry, one email move')
}
{
  const { calls, row, runtime } = setup({ failAt: 'Order.pdf' })
  assert.equal(await runtime.processSingleFilingServiceEmail(row), false)
  assert.deepEqual(calls.saved, ['Motion.pdf'])
  assert.equal(calls.bills.length, 0)
  assert.equal(calls.moved.length, 0)
  assert.equal(runtime.serviceV309BatchesRef.current.get(row.id).length, 2)
  console.log('PASS: partial save failure stops billing/move and retains complete retry queue')
}
{
  const { calls, row, context, runtime } = setup({ pending: true })
  assert.equal(await runtime.processSingleFilingServiceEmail(row), false)
  assert.equal(calls.saved.length, 2)
  assert.equal(calls.bills.length, 1)
  assert.equal(calls.moved.length, 0)
  assert.equal(context.serviceEmailRows[0].calendar_review_pending, true)
  await runtime.processSingleFilingServiceEmail(row)
  assert.equal(calls.bills.length, 1)
  console.log('PASS: calendar review does not block save/bill; pending alert stays visible and retry is not double-billed')
}
{
  const { calls, row, runtime } = setup({ cancel: true })
  assert.equal(await runtime.processSingleFilingServiceEmail(row), false)
  assert.equal(calls.saved.length + calls.bills.length + calls.moved.length, 0)
  console.log('PASS: picker cancellation has no save/billing/mail side effects')
}
{
  const { calls, row, runtime } = setup({ html: true })
  assert.equal(await runtime.processSingleFilingServiceEmail(row), true)
  assert.deepEqual(calls.saved, ['Motion.pdf', 'Order.pdf'])
  assert.equal(calls.picker.length, 1)
  console.log('PASS: Tyler HTML document list falls back to actual PDF selection')
}
for (const files of [[pdf('Same.pdf'), pdf('Same.pdf')], [pdf('Motion.pdf'), new File(['<html>not a PDF</html>'], 'Fake.pdf')]]) {
  const { calls, row, runtime } = setup({ files })
  assert.equal(await runtime.processSingleFilingServiceEmail(row), false)
  assert.equal(calls.saved.length + calls.bills.length + calls.moved.length, 0)
}
console.log('PASS: duplicate names and invalid PDF bytes reject the whole selection before writing')
{
  const { row, context, runtime } = setup()
  const second = { ...row, id: 'email-two', attachments: [] }
  context.serviceEmailRows.push(second)
  await runtime.pickLocalServicePdfAttachment(row)
  await runtime.pickLocalServicePdfAttachment(second)
  assert.equal(runtime.serviceV309BatchesRef.current.size, 2)
  assert.notEqual(runtime.serviceV309BatchesRef.current.get(row.id)[0].id, runtime.serviceV309BatchesRef.current.get(second.id)[0].id)
  console.log('PASS: PDF selections remain isolated by email')
}
console.log('V309 regression checks passed. All billing, storage, and email operations were mocked.')
