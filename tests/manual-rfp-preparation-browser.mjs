// Real application flow with synthetic records and intercepted network/storage.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { preview } from 'vite'
import JSZip from 'jszip'
import { chunkRows } from './cloud-chunk-fixture.js'

const server = await preview({ preview: { host: '127.0.0.1', port: 4175, strictPort: true } })
console.log('Preview server started')
const browser = await chromium.launch({ headless: true, executablePath: process.env.MIO_TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'] })
const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } }), page = await context.newPage()
page.setDefaultTimeout(15000)
console.log('Browser started')
const id = '00000000-0000-4000-8000-000000000345', email = 'synthetic-rfp@example.invalid', matterId = 'synthetic-rfp'
const user = { id, email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: new Date().toISOString() }
const b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url'), exp = Math.floor(Date.now() / 1000) + 3600
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp, aud: 'authenticated' })}.test`, refresh_token: 'synthetic', expires_at: exp, expires_in: 3600, token_type: 'bearer', user }
const matter = { id: matterId, name: 'RFP Test Matter', matter_type: 'SAPCR/Modification', matter_status: 'Client', clients: { first_name: 'Test', last_name: 'Client', email: 'client@example.invalid' } }
const docs = [
  { id: 'scan', matter_id: matterId, name: 'Tax statement', file_name: '2023 wages.png', file_type: 'image/png', file_path: 'scan.png' },
  { id: 'video', matter_id: matterId, name: 'Exchange video', file_name: 'Exchange & pickup.mp4', file_type: 'video/mp4', file_size: 1234, file_path: 'video.mp4' },
]
const job = { id: 'rfp-job', matter_id: matterId, discovery_type: 'Request for Production', title: 'Original RFP', requests: [{ id: 'r1', request_number: 1, request_text: 'Produce tax records.', assigned_document_ids: ['scan'] }], document_pools: [{ id: 'pool', name: 'Tonight', document_ids: ['scan', 'video'] }], active_pool_id: 'pool' }
const states = new Map([['caseControllerDocuments', docs], ['caseMioRespondingDiscoverySets', [job]]].map(([key, value]) => [key, { key, raw_value: JSON.stringify(value), updated_at: '2026-10-19T20:00:00Z' }]))
const files = new Map([['scan.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB5kAAAAASUVORK5CYII=', 'base64')]])
const errors = []
let failDocumentSave = false
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', dialog => dialog.accept())
await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url())
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (['localhost', '127.0.0.1'].includes(url.hostname)) return url.pathname.startsWith('/api/') ? json({ ok: true, data: [] }) : route.continue()
  if (/pdf-lib.*min\.js/.test(url.pathname)) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules'}/pdf-lib/dist/pdf-lib.min.js`) })
  if (!url.hostname.endsWith('.supabase.co')) return json({})
  if (url.pathname.includes('/auth/v1/')) return json(url.pathname.endsWith('/user') ? user : session)
  if (url.pathname.includes('/storage/v1/object/')) {
    const filePath = decodeURIComponent(url.pathname.split('case-documents/')[1] || '')
    if (req.method() === 'POST') {
      let buffer = req.postDataBuffer()
      if ((req.headers()['content-type'] || '').includes('multipart/form-data')) {
        const form = await new Response(buffer, { headers: { 'content-type': req.headers()['content-type'] } }).formData()
        const file = [...form.values()].find(value => typeof value.arrayBuffer === 'function')
        assert.ok(file, 'Storage upload contains a file')
        buffer = Buffer.from(await file.arrayBuffer())
      }
      files.set(filePath, buffer)
      return json({ Key: `case-documents/${filePath}` })
    }
    return route.fulfill({ status: files.has(filePath) ? 200 : 404, contentType: /\.png$/i.test(filePath) ? 'image/png' : 'application/pdf', body: files.get(filePath) || '' })
  }
  const table = url.pathname.split('/').pop()
  if (table === 'mio_cloud_state_read_chunks_v297') return json(chunkRows([...states.values()].map(row => ({ ...row, user_id: id })), req.postDataJSON()))
  if (table === 'mio_cloud_state_write_v277') {
    const data = req.postDataJSON(), row = { key: data.p_key, raw_value: data.p_raw, updated_at: new Date().toISOString() }
    if (row.key === 'caseControllerDocuments' && failDocumentSave) return json({ message: 'Synthetic document-save failure' }, 500)
    states.set(row.key, row); return json(row)
  }
  if (table === 'case_mio_user_state') {
    let data = [...states.values()], key = url.searchParams.get('key')
    if (key?.startsWith('eq.')) data = data.filter(row => row.key === key.slice(3))
    const fields = (url.searchParams.get('select') || '*').split(',')
    return json(data.map(row => fields.includes('*') ? row : Object.fromEntries(fields.map(field => [field, row[field]]))))
  }
  if (table === 'matters') return json([matter])
  if (table === 'clients') return json([])
  if (table === 'team_members') {
    const member = { id: 'member', email, first_name: 'RFP', last_name: 'Test', is_active: true, page_access: [] }
    return json(req.headers().accept?.includes('vnd.pgrst.object') ? member : [member])
  }
  return json(req.headers().accept?.includes('vnd.pgrst.object') ? null : [])
})
await page.addInitScript(session => localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token', JSON.stringify(session)), session)
const savedDocs = () => JSON.parse(states.get('caseControllerDocuments').raw_value)
fs.mkdirSync('test-results', { recursive: true })
try {
  await page.goto(`http://127.0.0.1:4175/#matter_dashboard:${matterId}?tab=manual_rfp_responses`, { waitUntil: 'domcontentloaded' })
  console.log('Opened Manual RFP Responses')
  await page.getByRole('button', { name: 'Select all shown', exact: true }).waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: 'Select all shown', exact: true }).click()
  await page.getByRole('button', { name: 'Convert selected to PDFs (2)', exact: true }).click()
  await page.getByRole('button', { name: '2023 wages.pdf', exact: true }).waitFor({ timeout: 20000 })
  console.log('Converted image')
  assert.equal(savedDocs().find(doc => doc.id === 'scan').name, 'Tax statement')
  assert.equal(savedDocs().find(doc => doc.id === 'scan').pdf_conversion_source.file_path, 'scan.png')
  assert.deepEqual(JSON.parse(states.get('caseMioRespondingDiscoverySets').raw_value)[0].requests[0].assigned_document_ids, ['scan'])
  await page.getByRole('button', { name: 'Select none', exact: true }).first().click()
  console.log('Cleared selection')
  await page.locator('tr').filter({ has: page.getByRole('button', { name: 'Exchange & pickup.mp4', exact: true }) }).getByRole('checkbox').check()
  console.log('Selected video')
  await page.getByRole('button', { name: 'Create cover sheets (1)', exact: true }).click()
  console.log('Opened cover editor')
  await page.getByLabel('Heading', { exact: true }).fill('VIDEO OF EXCHANGE')
  await page.getByLabel('Description / production instructions').fill('Recording of the exchange.\nNative file supplied separately.')
  await page.getByLabel('Heading size (pt)').fill('32')
  assert.equal(await page.getByLabel('Cover sheet page preview').getByText('VIDEO OF EXCHANGE', { exact: true }).count(), 1)
  await page.screenshot({ path: 'test-results/manual-rfp-cover-editor.png', fullPage: true })
  await page.getByRole('button', { name: 'Create 1 Word cover sheet', exact: true }).click()
  await page.getByRole('dialog', { name: 'Create cover sheets' }).waitFor({ state: 'hidden', timeout: 20000 })
  const cover = savedDocs().find(doc => doc.cover_sheet_for === 'video')
  assert.ok(cover)
  const zip = await JSZip.loadAsync(files.get(cover.file_path))
  assert.match(await zip.file('word/document.xml').async('string'), /VIDEO OF EXCHANGE/)
  fs.writeFileSync('test-results/manual-rfp-cover.docx', files.get(cover.file_path))
  assert.ok(JSON.parse(states.get('caseMioRespondingDiscoverySets').raw_value)[0].document_pools[0].document_ids.includes(cover.id))
  failDocumentSave = true
  await page.getByRole('button', { name: 'Convert selected to PDFs (1)', exact: true }).click()
  await page.locator('.rfp-preparation-toolbar [role=status]').filter({ hasText: 'Synthetic document-save failure' }).waitFor({ timeout: 20000 })
  assert.match(savedDocs().find(doc => doc.id === cover.id).file_name, /\.docx$/)
  failDocumentSave = false
  await page.getByRole('button', { name: 'Convert selected to PDFs (1)', exact: true }).click()
  await page.getByRole('button', { name: 'Exchange & pickup - Cover Sheet.pdf', exact: true }).waitFor({ timeout: 20000 })
  const convertedCover = savedDocs().find(doc => doc.id === cover.id)
  assert.match(convertedCover.file_name, /\.pdf$/)
  assert.equal(convertedCover.rfp_cover_sheet.settings.headingSize, 32)
  assert.match(files.get(convertedCover.file_path).subarray(0, 5).toString(), /%PDF-/)
  fs.writeFileSync('test-results/manual-rfp-cover.pdf', files.get(convertedCover.file_path))
  assert.equal(savedDocs().find(doc => doc.id === 'video').file_name, 'Exchange & pickup.mp4')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Exchange & pickup - Cover Sheet.pdf', exact: true }).waitFor({ timeout: 45000 })
  assert.deepEqual(errors, [])
  console.log('PASS: bulk conversion, preservation, request assignment, cover editor, Word output, active pool, failed-save rollback, PDF layout conversion, reload')
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(-4000))
  throw error
} finally { await browser.close(); await server.httpServer.close() }
