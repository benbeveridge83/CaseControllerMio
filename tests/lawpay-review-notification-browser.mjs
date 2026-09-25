import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { chunkRows } from './cloud-chunk-fixture.js'

const now = new Date().toISOString(), owner = '00000000-0000-4000-8000-000000004241', email = 'admin.synthetic@example.invalid'
const user = { id: owner, email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: now, app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: now }
const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64url'), exp = Math.floor(Date.now() / 1000) + 3600
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: owner, email, role: 'authenticated', exp, aud: 'authenticated' })}.test`, refresh_token: 'test-only', expires_at: exp, expires_in: 3600, token_type: 'bearer', user }
const matters = [
  { id: '00000000-0000-4000-8000-000000004241', client_id: 'client-alpha', name: 'Alpha Matter', cause_number: 'DF-26-100', matter_type: 'Modification', matter_status: 'Active Client', case_status: 'Open', is_active: true, created_at: now, clients: { id: 'client-alpha', first_name: 'Alpha', last_name: 'Synthetic', email: 'alpha@example.invalid' } },
  { id: '00000000-0000-4000-8000-000000004242', client_id: 'client-yasmine', name: 'Consultation', cause_number: '', matter_type: 'Consultation', matter_status: 'PNC- Need to Consult', case_status: 'Open', is_active: true, created_at: now, clients: { id: 'client-yasmine', first_name: 'Yasmine', last_name: 'Said', email: 'yasmine@example.invalid' } },
]
const opening = Object.fromEntries(matters.map((m) => [m.id, { snapshot_date: '2026-08-09', matter_trust_funds: 1000, outstanding_balance: 0, work_in_progress: 0, minimum_balance: 2000 }]))
const transactions = [
  { id: 'tx-a', gateway_transaction_id: 'provider-a', occurred_at: '2026-09-12T15:13:36Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: 'echeck_trust', account_id: 'acct-7788', amount_cents: 500000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Alpha Synthetic', payer_email: 'alpha@example.invalid', raw: { mio_matter_id: matters[0].id } },
  { id: 'tx-p', gateway_transaction_id: 'provider-p', occurred_at: '2026-09-13T09:00:00Z', transaction_type: 'CHARGE', status: 'AUTHORIZED', account_key: 'echeck_trust', account_id: 'acct-7788', amount_cents: 25000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Pending Payer', payer_email: 'pending@example.invalid', raw: {} },
  { id: 'tx-d', gateway_transaction_id: 'provider-d', occurred_at: '2026-09-12T17:13:36Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: 'operating', account_id: 'acct-operating', amount_cents: 12500, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Yasmine Said', payer_email: 'yasmine@example.invalid', raw: { mio_account_key_source: 'configured_account' } },
  { id: 'tx-kevin', gateway_transaction_id: 'provider-kevin', occurred_at: '2026-09-21T12:00:00Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: 'trust', account_id: 'acct-trust', amount_cents: 140000, amount_refunded_cents: 140000, currency: 'USD', reference: 'MIO-2026-1400', payer_name: 'Kevin Dobbins', payer_email: 'kevin@example.invalid', raw: { mio_payment_request_id: 'request-kevin', mio_invoice_number: 'MIO-2026-1400', mio_matter_id: matters[0].id, mio_client_id: matters[0].client_id }, review_linkage: { payment_request_id: 'request-kevin', request_found: true, invoice_number: 'MIO-2026-1400', invoice_id: 'invoice-kevin', invoice_event_id: 'event-kevin', matter_id: matters[0].id, client_id: matters[0].client_id, reconciled: true, conflict: '' } },
  { id: 'tx-kevin-second', gateway_transaction_id: 'provider-kevin-second', occurred_at: '2026-09-22T12:00:00Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: 'trust', account_id: 'acct-trust', amount_cents: 210000, amount_refunded_cents: 8000, currency: 'USD', reference: 'MIO-2026-2100', payer_name: 'Kevin Dobbins', payer_email: 'kevin@example.invalid', raw: { mio_payment_request_id: 'request-kevin-second', mio_invoice_number: 'MIO-2026-2100', mio_matter_id: matters[0].id, mio_client_id: matters[0].client_id }, review_linkage: { payment_request_id: 'request-kevin-second', request_found: true, invoice_number: 'MIO-2026-2100', invoice_id: 'invoice-kevin-second', invoice_event_id: 'event-kevin-second', matter_id: matters[0].id, client_id: matters[0].client_id, reconciled: true, conflict: '' } },
  { id: 'tx-kevin-refund-a', gateway_transaction_id: 'provider-kevin-refund-a', occurred_at: '2026-09-25T16:46:00Z', transaction_type: 'REFUND', status: 'COMPLETED', account_key: 'trust', account_id: 'acct-trust', amount_cents: 140000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Kevin Dobbins', payer_email: 'kevin@example.invalid', raw: { charge_id: 'provider-kevin' } },
  { id: 'tx-kevin-refund-b', gateway_transaction_id: 'provider-kevin-refund-b', occurred_at: '2026-09-25T16:47:00Z', transaction_type: 'REFUND', status: 'COMPLETED', account_key: 'trust', account_id: 'acct-trust', amount_cents: 8000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Kevin Dobbins', payer_email: 'kevin@example.invalid', raw: { charge_id: 'provider-kevin-second' } },
  { id: 'tx-linked-incomplete', gateway_transaction_id: 'provider-linked-incomplete', occurred_at: '2026-09-20T12:00:00Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: 'operating', account_id: 'acct-operating', amount_cents: 20000, amount_refunded_cents: 0, currency: 'USD', reference: 'MIO-2026-TECH', payer_name: 'Linked Technical', payer_email: 'linked@example.invalid', raw: { mio_payment_request_id: 'request-technical', mio_invoice_number: 'MIO-2026-TECH', mio_matter_id: matters[0].id }, review_linkage: { payment_request_id: 'request-technical', request_found: true, invoice_number: 'MIO-2026-TECH', invoice_id: 'invoice-technical', matter_id: matters[0].id, reconciled: false, conflict: '' } },
  { id: 'tx-historical', gateway_transaction_id: 'provider-historical', occurred_at: '2026-08-08T12:00:00Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: 'trust', account_id: 'acct-trust', amount_cents: 9900, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Historical Payer', payer_email: 'historical@example.invalid', raw: {} },
]
const store = { classifications: [], ledger: [], actions: [], seq: 0 }
const legacyRefundEntries = [{ id: 'manual-refund-kevin', matter_id: matters[0].id, date: '2026-09-25', direction: 'out', transaction_type: 'client_refund', amount: 1479.73, payer_payee: 'Kevin Dobbins', source: 'Mio manual trust entry', lawpay_transaction_id: '' }]
const identityOf = (record) => `${String(record.provider_account_id || '')}:${String(record.gateway_transaction_id || '')}`
function resolvedFor(transaction) { if (transaction.account_key) return { resolved_account_key: transaction.account_key, resolved_account_source: 'environment', resolved_account_label: transaction.account_key }; return { resolved_account_key: '', resolved_account_source: '', resolved_account_label: '' } }
function gateway(body) {
  store.actions.push(body.action)
  if (!['review', 'save', 'post'].includes(body.action)) return { ok: true, page: 1, processed: 0, total_entries: 0, has_more: false, next_page: null, warnings: [] }
  if (body.action === 'review') return { ok: true, version: 326, mapping_table_available: true, accounts: [], classifications: store.classifications, ledger_entries: store.ledger, transactions: transactions.map((transaction) => ({ ...transaction, ...resolvedFor(transaction) })), review_cutover_date: '2026-08-09', legacy_recorded_transaction_ids: [], legacy_attributed_transaction_ids: [], legacy_refund_entries: legacyRefundEntries }
  const record = body.classification || {}
  const transaction = transactions.find((tx) => tx.gateway_transaction_id === record.gateway_transaction_id)
  if (!transaction) return { ok: false, error: 'unknown transaction' }
  const identity = identityOf(record)
  if (body.action === 'save') { store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: 'c' + (++store.seq), identity, posting_status: 'saved', created_at: new Date().toISOString() }]; return { ok: true, result: { status: 'saved' } } }
  if (!record.actual_account_key) return { ok: false, error: 'The deposit account is not established yet.' }
  store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: 'c' + (++store.seq), identity, posting_status: 'posted', posted_at: new Date().toISOString() }]
  store.ledger = [...store.ledger, { id: 'e' + (++store.seq), identity, classification_id: 'c' + store.seq, entry_kind: String(record.actual_account_key).includes('trust') ? 'trust_entry' : 'operating_association', direction: 'in', account_key: record.actual_account_key, matter_id: record.matter_id || '', amount_cents: transaction.amount_cents, currency: 'USD', occurred_at: transaction.occurred_at, created_at: new Date().toISOString() }]
  return { ok: true, result: { status: 'posted' } }
}
const states = new Map(Object.entries({ caseMioFinanceOpeningBalances: opening, caseMioTrustTransactions: legacyRefundEntries, caseMioInvoices: [], caseMioBillingCutoverDate: '2026-08-09' }).map(([key, v]) => [key, { key, raw_value: typeof v === 'string' ? v : JSON.stringify(v), json_value: v, updated_at: now }]))
const errors = [], blocked = [], writes = []
const root = path.resolve('dist'), port = 4183
const server = http.createServer((req, res) => { const p = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname); if (!p.startsWith(root + path.sep) && p !== root) { res.writeHead(403); return res.end() } const f = fs.existsSync(p) && fs.statSync(p).isFile() ? p : path.join(root, 'index.html'); res.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(f)) })
await new Promise((r) => server.listen(port, '127.0.0.1', r))
const origin = `http://127.0.0.1:${port}`
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
const watch = (target) => { target.setDefaultTimeout(20000); target.on('pageerror', (e) => errors.push(e.stack || e.message)); target.on('dialog', (d) => d.dismiss()) }
let page = await context.newPage(); watch(page)
await context.addInitScript(({ session }) => { if (location.origin === 'http://127.0.0.1:4183') localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token', JSON.stringify(session)) }, { session })
await context.route('**/*', async (route) => {
  const req = route.request(), url = new URL(req.url()), reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  if (url.hostname === '127.0.0.1' && url.port === String(port)) { if (url.pathname.startsWith('/api/')) return reply({ connected: false, rows: [], data: [] }); return route.continue() }
  if (!url.hostname.endsWith('.supabase.co')) { blocked.push(req.method() + ' ' + url.origin + url.pathname); return reply({}) }
  if (url.pathname.includes('/auth/v1/')) return reply(url.pathname.endsWith('/user') ? user : session)
  const table = url.pathname.split('/').pop(), single = req.headers().accept?.includes('vnd.pgrst.object')
  if (table === 'lawpay-gateway') return reply(gateway(req.postDataJSON()))
  if (table === 'lawpay-account-diagnostics') return reply({ ok: true, version: 324, redacted: true, mapping_table_available: true, diagnostics: { transactions_reviewed: transactions.length, missing_provider_account_id: 1, unmapped_provider_accounts: [{ account_last4: '4471', transactions: 1 }] } })
  if (table === 'mio_cloud_state_read_chunks_v297') return reply(chunkRows([...states.values()].map((x) => ({ ...x, user_id: owner })), req.postDataJSON()))
  if (table === 'case_mio_user_state') { let rows = [...states.values()]; const key = url.searchParams.get('key'); if (key?.startsWith('eq.')) rows = rows.filter((r) => r.key === key.slice(3)); return reply(single ? rows[0] || null : rows) }
  if (table === 'team_members') { const m = { id: 'synthetic-member', email, first_name: 'Test', last_name: 'Attorney', is_active: true, page_access: [] }; return reply(single ? m : [m]) }
  if (table === 'setting_options') return reply(Object.entries({ matter_status: ['Active Client', 'PNC- Need to Consult', 'Closed'], case_status: ['Open', 'Closed'], matter_type: ['Modification', 'Consultation', 'Divorce'] }).flatMap(([category, names]) => names.map((name, i) => ({ id: category + i, category, name, is_active: true, sort_order: i }))))
  const tables = { matters, clients: matters.map((m) => m.clients), mio_invoices: [], mio_invoice_events: [], lawpay_transactions: transactions, lawpay_payment_requests: [], mio_billing_entries: [] }
  if (tables[table]) { if (req.method() !== 'GET') { writes.push({ table, method: req.method() }); return reply({ error: 'No direct financial writes are allowed in this browser fixture' }, 403) } let rows = tables[table]; for (const [key, filter] of url.searchParams) if (filter.startsWith('eq.')) rows = rows.filter((r) => String(r[key]) === filter.slice(3)); return reply(single ? rows[0] || null : rows) }
  return reply(single ? null : [])
})
try {
  fs.mkdirSync('finance-test-results', { recursive: true })
  // The review queue, the classification panel and the manual diagnostics all live on the central page.
  await page.goto(`${origin}/#lawpay`, { waitUntil: 'domcontentloaded' })
  const queue = page.locator('section[aria-label="LawPay review queue"]')
  await queue.waitFor({ timeout: 60000 })
  const panel = queue.locator('section[aria-label="LawPay payment classification"]')
  await panel.waitFor({ timeout: 60000 })
  await page.getByTestId('lawpay-run-diagnostics').waitFor()

  // Matter -> Finances must no longer carry the classification panel.
  await page.getByRole('link', { name: 'Billing', exact: true }).click()
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).click()
  const dashboardLink = page.locator('a').filter({ hasText: /^Alpha (Synthetic|Matter)$/ }).first()
  await dashboardLink.waitFor({ timeout: 60000 })
  const opened = context.waitForEvent('page', { timeout: 20000 }).catch(() => null)
  await dashboardLink.click()
  const matter = (await opened) || page
  if (matter === page) watch(matter)
  await matter.waitForLoadState('domcontentloaded')
  const finances = matter.getByRole('button', { name: 'Finances', exact: true }).last()
  await finances.waitFor({ timeout: 60000 })
  await finances.click()
  await matter.getByRole('heading', { name: 'Client finances' }).waitFor({ timeout: 60000 })
  assert.equal(await matter.locator('section[aria-label="LawPay payment classification"]').count(), 0, 'no classification panel may appear on Matter -> Finances')
  const matterFinancesBody = await matter.locator('body').innerText()
  assert.equal(matterFinancesBody.includes('LawPay reconciliation'), false, 'no LawPay reconciliation list on Matter -> Finances')
  assert.equal(matterFinancesBody.includes('Categorize this payment'), false, 'no legacy attribution picker on Matter -> Finances')
  assert.equal(await matter.locator('details summary').filter({ hasText: 'LawPay reconciliation' }).count(), 0, 'no unlinked LawPay transaction rows on Matter -> Finances')

  // One consolidated notification on the main tab: provider-a + provider-d need a decision and
  // Kevin's completed provider refunds differ from Mio's one existing refund entry by 27 cents.
  // Pending, historical and fully linked rows are excluded, so the count is 3.
  const notification = page.locator('[data-testid="lawpay-review-notification"]')
  await notification.waitFor({ timeout: 30000 })
  assert.match(await notification.innerText(), /3 LawPay transactions need review/)
  assert.equal(await notification.count(), 1, 'one consolidated notification, never one per transaction')
  await notification.getByRole('button').click()
  await queue.waitFor({ timeout: 30000 })
  assert.ok(page.url().includes('#lawpay'), 'clicking the notification opens the central review queue')
  await panel.getByRole('button', { name: 'Show every LawPay payment' }).click()

  // A Mio-created invoice payment is handled by its immutable request/invoice/matter linkage. It
  // never asks the reviewer to choose Kevin's matter or records the same money a second time.
  const kevin = panel.getByTestId('lawpay-row-provider-kevin')
  assert.match(await kevin.innerText(), /Handled automatically from its Mio payment link/)
  assert.equal(await kevin.getByRole('button', { name: 'Decide Kevin Dobbins' }).count(), 0)
  assert.match(await panel.locator('details[aria-label="Mio-linked payments needing reconciliation"]').textContent(), /Linked Technical.*technical linkage/i)

  // LawPay split Kevin's one refund across two original charges. Mio already has the one manual
  // client-refund entry, so the queue must never offer to record another withdrawal. It groups the
  // provider rows and surfaces only the 27-cent reconciliation difference.
  const refundReview = panel.getByTestId('refund-ledger-review')
  assert.match(await refundReview.innerText(), /Kevin Dobbins/)
  assert.match(await refundReview.innerText(), /LawPay: \$1,480\.00/)
  assert.match(await refundReview.innerText(), /Mio: \$1,479\.73/)
  assert.match(await refundReview.innerText(), /Difference: \$0\.27/)
  assert.match(await refundReview.innerText(), /Do not record another refund/)
  assert.equal(await panel.getByText('Refund relationship unresolved', { exact: true }).count(), 0, 'provider charge ids resolve both refund relationships automatically')

  // A direct operating-account consultation asks only whether it is a consultation and offers an
  // optional existing PNC. The payer's name is never retyped and the transaction type is derived.
  const yasmine = panel.getByTestId('lawpay-row-provider-d')
  await yasmine.getByRole('button', { name: 'Decide Yasmine Said' }).click()
  await yasmine.getByLabel('Ownership for Yasmine Said').selectOption('pnc')
  const pncPicker = yasmine.getByLabel('PNC for Yasmine Said')
  assert.equal(await pncPicker.evaluate((element) => element.tagName), 'SELECT')
  assert.equal(await pncPicker.inputValue(), '', 'selecting an existing PNC is optional')
  assert.match((await pncPicker.locator('option').allInnerTexts()).join(' | '), /Yasmine Said — Consultation/)
  assert.match(await yasmine.getByTestId('lawpay-derived-category-provider-d').innerText(), /Consultation payment — money in.*set automatically/)
  assert.equal(await yasmine.getByLabel('Transaction type for Yasmine Said').count(), 0)

  // Save for later keeps the transaction in the count.
  const providerA = panel.getByTestId('lawpay-row-provider-a')
  await providerA.getByRole('button', { name: 'Decide Alpha Synthetic' }).click()
  await providerA.getByLabel('Ownership for Alpha Synthetic').selectOption('matter')
  await providerA.getByLabel('Matter for Alpha Synthetic').selectOption(matters[0].id)
  assert.match(await providerA.getByTestId('lawpay-derived-category-provider-a').innerText(), /Trust deposit — money in.*set automatically/)
  await providerA.getByRole('button', { name: 'Save for later Alpha Synthetic' }).click()
  await providerA.getByTestId('lawpay-message-provider-a').waitFor()
  assert.match(await providerA.getByTestId('lawpay-message-provider-a').innerText(), /Saved for later/)
  await notification.waitFor({ timeout: 30000 })
  assert.match(await notification.innerText(), /3 LawPay transactions need review/, 'saved for later stays counted')

  // Recording it updates the count down to two: Yasmine plus the one 27-cent refund discrepancy.
  await providerA.getByRole('button', { name: 'Decide Alpha Synthetic' }).click()
  await providerA.getByLabel('Matter for Alpha Synthetic').selectOption(matters[0].id)
  await providerA.getByRole('button', { name: 'Confirm and record Alpha Synthetic' }).click()
  await providerA.getByTestId('lawpay-message-provider-a').waitFor()
  assert.match(await providerA.getByTestId('lawpay-message-provider-a').innerText(), /Recorded in Mio/)
  for (let attempt = 0; attempt < 60; attempt += 1) { if (/2 LawPay transactions need review/.test(await notification.innerText())) break; await page.waitForTimeout(250) }
  assert.match(await notification.innerText(), /2 LawPay transactions need review/, 'the count updates after a decision')

  console.log(JSON.stringify({ ok: true, actions: store.actions, notification_text: await notification.innerText(), tests: ['no classification panel on Matter -> Finances', 'the central LawPay review queue carries the panel and diagnostics', 'the consolidated notification shows the correct count once', 'clicking the notification opens the queue', 'saved for later stays counted', 'the count updates after a decision'] }, null, 2))
} catch (error) {
  try { fs.writeFileSync('finance-test-results/failure-notification.txt', await page.locator('body').innerText()) } catch { /* page gone */ }
  await page.screenshot({ path: 'finance-test-results/failure-notification.png' }).catch(() => {})
  console.error({ errors, writes, blocked, actions: store.actions })
  throw error
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
}


