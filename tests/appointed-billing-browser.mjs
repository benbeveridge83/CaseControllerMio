// Production Mio bundle; synthetic records and intercepted services only.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { PDFDocument } from 'pdf-lib'
import { chunkRows } from './cloud-chunk-fixture.js'
import { APPOINTED_KEY, LEGACY_KEY, WEEKLY_SETTINGS_KEY, normalizeState } from '../src/mioAppointedBillingModel.js'

fs.mkdirSync('test-results', { recursive: true })
const now = new Date().toISOString(), owner = '00000000-0000-4000-8000-000000003351', email = 'synthetic-appointed@beveridgelawfirm.com'
const user = { id: owner, email, email_confirmed_at: now, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: now }
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url'), exp = Math.floor(Date.now() / 1000) + 3600
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: owner, email, role: 'authenticated', exp, aud: 'authenticated' })}.test`, refresh_token: 'synthetic-test-only', expires_at: exp, expires_in: 3600, token_type: 'bearer', user }
const names = ['Alpha', 'Bravo', 'Charlie', 'Excluded']
const matters = names.map((name, i) => ({ id: `00000000-0000-4000-8000-00000000510${i + 1}`, client_id: `client-${i}`, name: `${name} SAMPLE`, cause_number: `SAMPLE-${i + 1}-F`, court_id: 'court-300',
  matter_type: ['SAPCR/Modification', 'DFPS', 'Other', 'DFPS'][i], matter_status: 'Active Client', case_status: 'Open', is_active: true, created_at: now,
  clients: { id: `client-${i}`, first_name: name, last_name: 'Example', email: `${name.toLowerCase()}@example.invalid` } }))
const profile = { attorney_name: 'Example Attorney', bar_number: '12345678', ssn_last4: '1234', phone: '281-555-0100', address: '100 Sample St, Alvin TX 77511' }
const outline = matter => ({ court: '300th', cause_number: matter.cause_number, party_name: `${matter.clients.first_name} Example`, represented_role: 'Alleged Father', cps: true, appeal: false, confirmed_at: now })
const fixtureState = normalizeState({ profile, outlines: Object.fromEntries(matters.slice(1, 3).map(m => [m.id, outline(m)])) })
const entry = { id: 'entry-alpha', user_id: owner, matter_id: matters[0].id, date: '2026-11-20', description: 'Attended status hearing', entry_type: 'time', billing_time: 1, rate: 150, amount: 150, billable: true, created_at: now }
let billingRows = [{ id: entry.id, user_id: owner, matter_id: entry.matter_id, payload: entry }], invoices = [], events = [], sequence = 10
for (const [i, amount] of [[1, 300], [2, 450]]) invoices.push({ id: `invoice-${names[i].toLowerCase()}`, user_id: owner, invoice_number: `MIO-SAMPLE-${i}`, invoice_type: 'services', matter_id: matters[i].id, client_id: matters[i].client_id,
  client_name: `${names[i]} Example`, matter_name: matters[i].name, issue_date: '2026-11-22', status: 'outstanding', subtotal: amount, total: amount, balance: amount, amount_paid: 0, created_at: now, updated_at: now,
  line_items: [{ date: '2026-11-20', description: 'Attended status hearing', hours: amount / 150, rate: 150, amount }] })
const states = new Map(), put = (key, value) => states.set(key, { key, raw_value: JSON.stringify(value), json_value: value, updated_at: new Date().toISOString() })
put(LEGACY_KEY, fixtureState)
put(WEEKLY_SETTINGS_KEY, { matters: { [matters[0].id]: { appointed: true }, [matters[2].id]: { appointed: true }, [matters[3].id]: { appointed: false } } })
put('caseMioBillingEntries', [entry]); put('caseMioLawFirmProfile', { firm_name: 'Example Law Firm', address: profile.address, phone: profile.phone })
put('caseMioFinanceOpeningBalances', Object.fromEntries(matters.map(m => [m.id, { snapshot_date: '2026-08-09', matter_trust_funds: 0, outstanding_balance: 0, work_in_progress: 0, minimum_balance: 0 }])))
const errors = [], writes = [], aiCalls = []
let failAi = false, failSave = false
const server = http.createServer((req, res) => {
  const root = path.resolve('dist'), requested = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname)
  const file = requested.startsWith(root + path.sep) && fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'index.html')
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream')
  res.end(fs.readFileSync(file))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, executablePath: process.env.MIO_TEST_CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1536, height: 1050 }, acceptDownloads: true }), page = await context.newPage()
page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', dialog => dialog.accept())
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url()), single = req.headers().accept?.includes('vnd.pgrst.object')
  const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) {
    if (url.pathname === '/api/appointed-billing') {
      const body = req.postDataJSON(); aiCalls.push(body); assert.match(req.headers().authorization, /^Bearer /)
      if (failAi) return reply({ ok: false, error: 'Example AI unavailable' }, 503)
      return reply({ ok: true, lines: body.lines.map(line => ({ id: line.id, category: 'status', reason: 'Status hearing attendance.', source: 'ai' })) })
    }
    return url.pathname.startsWith('/api/') ? reply({ ok: true, connected: false, data: [] }) : route.continue()
  }
  if (!url.hostname.endsWith('.supabase.co')) return reply({})
  if (url.pathname.includes('/auth/v1/')) return reply(url.pathname.endsWith('/user') ? user : session)
  const table = url.pathname.split('/').pop()
  if (table === 'mio_cloud_state_read_chunks_v297') return reply(chunkRows([...states.values()].map(row => ({ ...row, user_id: owner })), req.postDataJSON()))
  if (table === 'mio_cloud_state_write_v277') {
    const body = req.postDataJSON(); writes.push({ table, key: body.p_key })
    if (failSave && body.p_key === APPOINTED_KEY) return reply({ code: 'PT500', message: 'Example save unavailable' }, 500)
    const row = { key: body.p_key, raw_value: body.p_raw, json_value: JSON.parse(body.p_raw), updated_at: new Date().toISOString() }; states.set(row.key, row); return reply(row)
  }
  if (table === 'case_mio_user_state') {
    let rows = [...states.values()], key = url.searchParams.get('key')
    if (key?.startsWith('eq.')) rows = rows.filter(row => row.key === key.slice(3))
    return reply(single ? rows[0] || null : rows)
  }
  if (table === 'next_mio_invoice_number') return reply(`MIO-SAMPLE-${++sequence}`)
  if (table === 'team_members') { const member = { id: 'synthetic-member', email, first_name: 'Example', last_name: 'Attorney', is_active: true, page_access: [] }; return reply(single ? member : [member]) }
  if (table === 'setting_options') return reply(Object.entries({ matter_type: ['DFPS', 'SAPCR/Modification', 'Divorce', 'Other'], matter_status: ['Active Client'], case_status: ['Open'] }).flatMap(([category, values]) => values.map((name, i) => ({ id: category + i, category, name, is_active: true, sort_order: i }))))
  if (['mio_invoices', 'mio_billing_entries', 'mio_invoice_events'].includes(table) && req.method() === 'POST') {
    const posted = req.postDataJSON(), rows = Array.isArray(posted) ? posted : [posted]; writes.push({ table, rows })
    if (table === 'mio_invoices') invoices = [...rows, ...invoices.filter(row => !rows.some(insert => insert.id === row.id))]
    if (table === 'mio_billing_entries') billingRows = [...rows, ...billingRows.filter(row => !rows.some(insert => insert.id === row.id))]
    if (table === 'mio_invoice_events') events.push(...rows)
    return reply(single ? rows[0] : rows)
  }
  const tables = { matters, clients: matters.map(m => m.clients), courts: [{ id: 'court-300', name: '300th District Court' }], mio_invoices: invoices, mio_billing_entries: billingRows, mio_invoice_events: events }
  if (tables[table]) {
    if (req.method() !== 'GET') throw new Error(`Unexpected mutation: ${table} ${req.method()}`)
    let rows = tables[table]
    for (const [key, filter] of url.searchParams) {
      if (filter.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === filter.slice(3))
      if (filter.startsWith('in.')) { const ids = filter.slice(4, -1).split(',').map(id => id.replaceAll('"', '')); rows = rows.filter(row => ids.includes(String(row[key]))) }
    }
    return reply(single ? rows[0] || null : rows)
  }
  return reply(single ? null : [])
})
await context.addInitScript(session => { localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token', JSON.stringify(session)) }, session)
const base = `http://127.0.0.1:${server.address().port}`
const open = async () => { await page.getByRole('button', { name: 'Bulk Billing', exact: true }).click({ timeout: 45000 }); await page.getByRole('button', { name: 'Appointed billing', exact: true }).click() }
const modal = page.getByRole('dialog', { name: 'Appointed billing', exact: true }), saved = () => JSON.parse(states.get(APPOINTED_KEY).raw_value)
try {
  await page.goto(`${base}/#billing`, { waitUntil: 'domcontentloaded' }); await open()
  await modal.getByText('Alpha Example', { exact: true }).waitFor()
  assert.equal(await modal.getByText('Excluded Example', { exact: true }).count(), 0)
  await page.screenshot({ path: 'test-results/appointed-step-1.png' })
  await modal.getByRole('button', { name: 'Select all with WIP', exact: true }).click()
  await modal.getByRole('button', { name: 'Review WIP & create invoices', exact: true }).click()
  await page.getByRole('heading', { name: 'Bulk WIP review — all matters' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Approve & pay from trust', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Approve & email client', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Approve all and generate all invoices', exact: true }).click()
  await page.getByRole('heading', { name: 'Bulk WIP review — all matters' }).waitFor({ state: 'hidden' })
  await modal.getByRole('heading', { name: 'Alpha Example', exact: true }).waitFor()
  await modal.getByRole('button', { name: 'Save voucher outline', exact: true }).click()
  await modal.getByText('Saved outline ready', { exact: true }).waitFor()
  assert.equal(await modal.getByLabel('Court', { exact: true }).inputValue(), '300th')
  const created = invoices.find(inv => inv.matter_id === matters[0].id)
  assert.ok(created); assert.equal(created.total, 150); assert.equal(billingRows[0].payload.invoice_id, created.id)
  await modal.getByRole('navigation', { name: 'Appointed billing steps' }).getByRole('button', { name: /Create invoices/ }).click()
  await modal.getByRole('button', { name: 'Select outstanding without vouchers', exact: true }).click()
  await modal.getByRole('button', { name: 'Continue to voucher outlines', exact: true }).click()
  await page.screenshot({ path: 'test-results/appointed-step-2.png' })
  await modal.getByRole('button', { name: 'Continue & fill voucher details', exact: true }).click()
  await modal.getByText('Categories suggested.', { exact: false }).waitFor()
  assert.equal(await modal.locator('.apb-invoice').count(), 3)
  await page.screenshot({ path: 'test-results/appointed-step-3.png' })
  await modal.getByLabel('I reviewed the voucher notes and amounts to be submitted.').check()
  await modal.getByRole('button', { name: 'Approve & create voucher', exact: true }).first().click()
  await modal.getByRole('link', { name: 'Download completed voucher', exact: true }).waitFor()
  await modal.getByRole('button', { name: 'Approve all & create vouchers', exact: true }).click()
  await modal.getByText('3 of 3 approved', { exact: true }).waitFor()
  assert.equal(await modal.getByRole('link', { name: 'Download completed voucher', exact: true }).count(), 3)
  const download = page.waitForEvent('download'); await modal.getByRole('link', { name: 'Download completed voucher', exact: true }).first().click()
  await (await download).saveAs('test-results/appointed-browser-voucher.pdf')
  assert.equal((await PDFDocument.load(fs.readFileSync('test-results/appointed-browser-voucher.pdf'))).getPageCount(), 1, 'No invoice is appended')
  const zip = page.waitForEvent('download'); await modal.getByRole('button', { name: 'Download 3 completed vouchers', exact: true }).click()
  await (await zip).saveAs('test-results/appointed-browser-vouchers.zip')
  // Edits must invalidate approval and hide downloads from the older voucher.
  await modal.getByLabel(`Voucher category 1.1 ${created.invoice_number}`).selectOption('review')
  await modal.getByText('2 of 3 approved', { exact: true }).waitFor()
  assert.equal(await modal.getByRole('link', { name: 'Download completed voucher', exact: true }).count(), 2)
  failSave = true
  await modal.getByRole('button', { name: 'Approve all & create vouchers', exact: true }).click()
  await modal.getByRole('alert').waitFor()
  assert.equal(await modal.getByText('2 of 3 approved', { exact: true }).count(), 1)
  failSave = false
  await modal.getByRole('button', { name: 'Approve all & create vouchers', exact: true }).click()
  await modal.getByText('3 of 3 approved', { exact: true }).waitFor()
  await page.reload({ waitUntil: 'domcontentloaded' }); await open()
  await modal.getByText('3 of 3 approved', { exact: true }).waitFor()
  assert.equal(await modal.getByLabel(`Voucher category 1.1 ${created.invoice_number}`).inputValue(), 'review')
  const next = saved(); next.batch.step = 2; next.reviews['invoice-bravo'].approved_at = ''; next.reviews['invoice-bravo'].lines[0].source = 'rules'; put(APPOINTED_KEY, next); failAi = true
  await page.reload({ waitUntil: 'domcontentloaded' }); await open()
  await modal.getByRole('button', { name: 'Continue & fill voucher details', exact: true }).click()
  await modal.getByRole('alert').filter({ hasText: 'Example AI unavailable' }).waitFor()
  assert.equal(await modal.getByLabel(`Voucher category 1.1 ${created.invoice_number}`).inputValue(), 'review')
  await modal.getByRole('button', { name: 'Approve all & create vouchers', exact: true }).click()
  await modal.getByText('3 of 3 approved', { exact: true }).waitFor()
  await page.setViewportSize({ width: 760, height: 1000 })
  assert.ok(await modal.locator('.apb-body').evaluate(el => el.scrollWidth <= el.clientWidth), 'Working surface must fit narrow screens')
  await page.screenshot({ path: 'test-results/appointed-narrow.png' })
  assert.ok(aiCalls.length); assert.ok(!writes.some(write => /trust|lawpay/.test(write.table)))
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ appointedAcrossCaseTypes: true, explicitExclusion: true, canonicalWipAndLinks: true, savedOutlines: true, legacyImport: true, allMatterReview: true, individualAndBulkApproval: true, invoiceNotAppended: true, changedApprovalHidesOldDownloads: true, failedSaveBlocksApproval: true, aiFailureKeepsManualWork: true, persistsAfterReload: true, narrowOverflow: false, pageErrors: errors }))
} catch (error) { await page.screenshot({ path: 'test-results/appointed-browser-failure.png', fullPage: true }); throw error }
finally { await browser.close(); server.close() }
