// Real production bundle, synthetic data, no live financial or provider calls.
//
// Flow under test: Matter Dashboard -> Finances -> LawPay payment classification
//   select ownership -> verify the actual deposit account -> choose the transaction category
//   -> read the preview -> save for later, record, or match an existing entry
// and then: the recorded money survives a reload, reaches the trust balance the matter
// dashboard shows, and the same balance appears in Bulk billing / the withdrawal source and is
// counted exactly once in the accounting view.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { chunkRows } from './cloud-chunk-fixture.js'

const now = new Date().toISOString(), owner = '00000000-0000-4000-8000-00000000323a', email = 'admin.synthetic@example.invalid'
const user = { id: owner, email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: now, app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: now }
const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64url'), exp = Math.floor(Date.now() / 1000) + 3600
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: owner, email, role: 'authenticated', exp, aud: 'authenticated' })}.test`, refresh_token: 'test-only', expires_at: exp, expires_in: 3600, token_type: 'bearer', user }
const matters = [
  { id: '00000000-0000-4000-8000-000000004231', client_id: 'client-alpha', name: 'Alpha Matter', matter_type: 'Modification', matter_status: 'Active Client', case_status: 'Open', is_active: true, created_at: now, clients: { id: 'client-alpha', first_name: 'Alpha', last_name: 'Synthetic', email: 'alpha@example.invalid' } },
  { id: '00000000-0000-4000-8000-000000004232', client_id: 'client-bravo', name: 'Bravo Matter', matter_type: 'Divorce', matter_status: 'Active Client', case_status: 'Open', is_active: true, created_at: now, clients: { id: 'client-bravo', first_name: 'Bravo', last_name: 'Synthetic', email: 'bravo@example.invalid' } },
]
const opening = Object.fromEntries(matters.map((m, i) => [m.id, { snapshot_date: '2026-08-09', matter_trust_funds: [1550, 1000][i], outstanding_balance: 0, work_in_progress: 0, minimum_balance: 2000 }]))
const invoice = (id, mi, type, total, paid, date) => ({ id, invoice_number: 'MIO-2026-' + id.padStart(6, '0'), user_id: owner, matter_id: matters[mi].id, client_id: matters[mi].client_id, client_name: ['Alpha', 'Bravo'][mi] + ' Synthetic', matter_name: matters[mi].name, invoice_type: type, status: paid === total ? 'paid' : 'outstanding', total, subtotal: total, amount_paid: paid, balance: total - paid, issue_date: date, due_date: date, created_at: date + 'T12:00:00Z', updated_at: date + 'T12:00:00Z', emailed_at: '', email_history: [], line_items: [{ date, description: 'Synthetic work', amount: total }] })
const invoices = [invoice('501', 0, 'services', 225, 0, '2026-08-21'), invoice('502', 1, 'services', 100, 100, '2026-09-10')]
const trust = [{ id: 'trust-alpha', matter_id: matters[0].id, direction: 'out', transaction_type: 'other_disbursement', amount: 100, date: '2026-08-12', created_at: '2026-08-12T12:00:00Z', memo: 'Synthetic trust disbursement', source: 'Mio' }]
// provider-a: a completed trust charge whose deposit account LawPay reported.
// provider-d: a completed charge with no reported deposit account - the case that used to
//   block recording an external payment at all.
// provider-p: a charge LawPay has only authorised, which must never post.
const transactions = [
  { id: 'tx-a', gateway_transaction_id: 'provider-a', occurred_at: '2026-09-12T15:13:36Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: 'echeck_trust', account_id: 'acct-7788', amount_cents: 500000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Alpha Synthetic', payer_email: 'alpha@example.invalid', raw: { mio_matter_id: matters[0].id } },
  { id: 'tx-d', gateway_transaction_id: 'provider-d', occurred_at: '2026-09-12T17:13:36Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: '', account_id: 'acct-4471', amount_cents: 112000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Yasmine Said', payer_email: 'yasmine@example.invalid', raw: { mio_account_key_source: 'unresolved' } },
  { id: 'tx-p', gateway_transaction_id: 'provider-p', occurred_at: '2026-09-13T09:00:00Z', transaction_type: 'CHARGE', status: 'AUTHORIZED', account_key: 'echeck_trust', account_id: 'acct-7788', amount_cents: 25000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Pending Payer', payer_email: 'pending@example.invalid', raw: {} },
]
const states = new Map(Object.entries({ caseMioFinanceOpeningBalances: opening, caseMioTrustTransactions: trust, caseMioInvoices: invoices, caseMioBillingCutoverDate: '2026-08-09', caseMioBulkBillingFilters: { case_status: 'all', matter_status: 'all', search: '' } }).map(([key, v]) => [key, { key, raw_value: typeof v === 'string' ? v : JSON.stringify(v), json_value: v, updated_at: now }]))
// The synthetic service keeps the same promises the database makes: the amount is taken from
// the stored provider transaction, never from the browser; a second recording of the same
// provider transaction is refused; a match links an existing entry without posting; and an
// account that is not established cannot be recorded until it is verified with evidence.
const store = { classifications: [], ledger: [], mapping: [], actions: [], seq: 0 }
const identityOf = (record) => `${String(record.provider_account_id || '')}:${String(record.gateway_transaction_id || '')}`
function resolvedFor(transaction) {
  const mapped = store.mapping.find((row) => row.provider_account_id === transaction.account_id)
  if (transaction.account_key) return { resolved_account_key: transaction.account_key, resolved_account_source: 'environment', resolved_account_label: transaction.account_key }
  if (mapped) return { resolved_account_key: mapped.account_key, resolved_account_source: 'registry', resolved_account_label: mapped.label || mapped.account_key }
  return { resolved_account_key: '', resolved_account_source: '', resolved_account_label: '' }
}
function gateway(body) {
  store.actions.push(body.action)
  if (!['review', 'map_account', 'save', 'post', 'match', 'correct'].includes(body.action)) return { ok: true, page: 1, processed: 0, total_entries: 0, has_more: false, next_page: null, warnings: [] }
  if (body.action === 'review') {
    return { ok: true, version: 323, mapping_table_available: true, accounts: store.mapping, classifications: store.classifications, ledger_entries: store.ledger, transactions: transactions.map((transaction) => ({ ...transaction, ...resolvedFor(transaction) })) }
  }
  if (body.action === 'map_account') {
    const row = body.mapping
    assert.ok(String(row.provider_account_id || ''), 'a provider account must be named before it can be mapped')
    store.mapping = [...store.mapping.filter((existing) => existing.provider_account_id !== row.provider_account_id), { provider_account_id: row.provider_account_id, account_key: row.account_key, bank_role: row.bank_role, label: row.label, last4: row.last4, is_active: true }]
    return { ok: true, result: { status: 'mapped' } }
  }
  const record = body.classification || {}
  const transaction = transactions.find((row) => row.gateway_transaction_id === record.gateway_transaction_id)
  assert.ok(transaction, 'the gateway only ever records a stored provider transaction')
  const identity = identityOf(record)
  const recorded = store.classifications.find((existing) => existing.identity === identity && existing.posting_status === 'posted')
  if (body.action === 'save') {
    if (recorded) return { ok: false, error: 'This transaction is already recorded in Mio, so nothing else will post.' }
    store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: 'c' + (++store.seq), identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'saved', matched_entry_id: '', created_by: email }]
    return { ok: true, result: { status: 'saved' } }
  }
  if (body.action === 'match') {
    if (recorded) return { ok: false, error: 'This transaction is already recorded in Mio, so nothing else will post.' }
    assert.ok(String(record.matched_entry_id || ''), 'a match needs an existing entry')
    store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: 'c' + (++store.seq), identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'matched', matched_entry_id: record.matched_entry_id, created_by: email }]
    return { ok: true, result: { status: 'matched', ledger_entry_id: null } }
  }
  if (body.action === 'correct') {
    store.classifications = [...store.classifications, { ...record, id: 'c' + (++store.seq), identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'posted', corrects_classification_id: 'previous', created_by: email }]
    return { ok: true, result: { status: 'corrected', ledger_entry_id: null } }
  }
  if (recorded) return { ok: false, error: 'This transaction is already recorded in Mio. Change it with a linked correction instead of recording it again.' }
  if (!record.actual_account_key) return { ok: false, error: 'The deposit account is not established yet. Record the actual trust or operating account with supporting evidence, then record the transaction.' }
  store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: 'c' + (++store.seq), identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'posted', posted_at: new Date().toISOString(), created_by: email }]
  const entry = { id: 'e' + (++store.seq), identity, classification_id: 'c' + store.seq, entry_kind: String(record.actual_account_key).includes('trust') ? 'trust_entry' : 'operating_association', direction: record.direction === 'out' ? 'out' : 'in', account_key: record.actual_account_key, matter_id: record.matter_id || '', amount_cents: transaction.amount_cents, currency: 'USD', occurred_at: transaction.occurred_at, provider_account_id: transaction.account_id || '', created_at: new Date().toISOString() }
  store.ledger = [...store.ledger.filter((existing) => existing.identity !== identity), entry]
  return { ok: true, result: { status: 'posted', ledger_entry_id: entry.id } }
}
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
  if (table === 'lawpay-account-diagnostics') return reply({ ok: true, version: 323, redacted: true, diagnostics: { transactions_reviewed: transactions.length, missing_provider_account_id: 1, unmapped_provider_accounts: [{ account_last4: '4471', transactions: 1 }] } })
  if (table === 'mio_cloud_state_read_chunks_v297') return reply(chunkRows([...states.values()].map((x) => ({ ...x, user_id: owner })), req.postDataJSON()))
  if (table === 'mio_cloud_state_write_v277') { const b = req.postDataJSON(), old = states.get(b.p_key); if (!!old !== b.p_expected_exists || old && old.updated_at !== b.p_expected_at) return reply({ code: 'PT409', message: 'Stale state' }, 409); const r = { key: b.p_key, raw_value: b.p_raw, json_value: null, updated_at: new Date().toISOString() }; states.set(b.p_key, r); return reply(r) }
  if (table === 'case_mio_user_state') { let rows = [...states.values()]; const key = url.searchParams.get('key'); if (key?.startsWith('eq.')) rows = rows.filter((r) => r.key === key.slice(3)); return reply(single ? rows[0] || null : rows) }
  if (table === 'team_members') { const m = { id: 'synthetic-member', email, first_name: 'Test', last_name: 'Attorney', is_active: true, page_access: [] }; return reply(single ? m : [m]) }
  if (table === 'setting_options') return reply(Object.entries({ matter_status: ['Active Client', 'Closed'], case_status: ['Open', 'Closed'], matter_type: ['Modification', 'Divorce'] }).flatMap(([category, names]) => names.map((name, i) => ({ id: category + i, category, name, is_active: true, sort_order: i }))))
  const tables = { matters, clients: matters.map((m) => m.clients), mio_invoices: invoices, mio_invoice_events: [], lawpay_transactions: transactions, lawpay_payment_requests: [], mio_billing_entries: [] }
  if (tables[table]) { if (req.method() !== 'GET') { writes.push({ table, method: req.method() }); return reply({ error: 'No direct financial writes are allowed in this browser fixture' }, 403) } let rows = tables[table]; for (const [key, filter] of url.searchParams) if (filter.startsWith('eq.')) rows = rows.filter((r) => String(r[key]) === filter.slice(3)); return reply(single ? rows[0] || null : rows) }
  return reply(single ? null : [])
})
const moneyReads = []
// Read a labelled money figure from the page. The first match is used unless its own container
// has no amount, in which case a later, tighter match wins: the classification panel also names
// accounts, and the assertion must not accidentally read the panel instead of the summary card.
const readMoney = async (scope, label) => {
  const matches = scope.getByText(label, { exact: true })
  await matches.first().waitFor()
  const count = await matches.count(), candidates = []
  for (let index = 0; index < count; index += 1) {
    const text = await matches.nth(index).evaluate((el) => {
      let n = el, best = ''
      for (let i = 0; i < 12 && n; i += 1) {
        const t = n.innerText || ''
        if (/\$[\d,]+(?:\.\d{2})?/.test(t) && (!best || t.length < best.length)) best = t
        n = n.parentElement
      }
      return best
    })
    if (text) candidates.push(text)
  }
  assert.ok(candidates.length, `no amount was shown next to ${label}`)
  // The tightest container wins, so a labelled summary card is read instead of a wrapper that
  // happens to contain the whole page.
  const text = candidates.sort((left, right) => left.length - right.length)[0]
  moneyReads.push(`${label} -> ${String(text).replace(/\s+/g, ' ').slice(0, 160)}`)
  const match = String(text).match(/\$([\d,]+(?:\.\d{2})?)/)
  assert.ok(match, `no amount was shown next to ${label}`)
  return Number(match[1].replace(/,/g, ''))
}
let dashboardRef = null
fs.mkdirSync('finance-test-results', { recursive: true })
try {
  // Reach the matter dashboard the way the firm does: through the billing page's client link.
  await page.goto(`${origin}/#billing`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).click()
  const dashboardLink = page.locator('a').filter({ hasText: /^Alpha (Synthetic|Matter)$/ }).first()
  await dashboardLink.waitFor({ timeout: 60000 })
  const opened = context.waitForEvent('page', { timeout: 10000 }).catch(() => null)
  await dashboardLink.click()
  const dashboard = (await opened) || page
  dashboardRef = dashboard
  if (dashboard === page) watch(dashboard)
  await dashboard.waitForLoadState('domcontentloaded')
  const panel = dashboard.locator('section[aria-label="LawPay payment classification"]')
  await panel.waitFor({ timeout: 60000 })
  const trustOnFinancesBefore = await readMoney(dashboard, 'Trust account')
  assert.ok(await panel.getByRole('heading', { name: 'LawPay payment classification' }).count(), 'the Finances page must carry the classification workflow')
  // 1. Every stored charge waiting on a decision is listed, with its reported account or the
  //    plain statement that none was reported.
  assert.match(await panel.getByTestId('lawpay-classification-summary').innerText(), /3 payment\(s\) need a decision/)
  assert.match(await panel.getByTestId('lawpay-account-provider-a').innerText(), /Reported by LawPay · eCheck IOLTA trust account/)
  assert.match(await panel.getByTestId('lawpay-account-provider-d').innerText(), /Account not reported/)
  assert.match(await panel.getByTestId('lawpay-diagnostics-summary').innerText(), /1 with no reported deposit account/)
  // Keep every payment in view for the rest of the flow, so a decision's confirmation stays on
  // screen after the row stops being pending.
  await panel.getByRole('button', { name: 'Show every LawPay payment' }).click()
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-classification-list.png' })
  // 2. The charge LawPay says nothing about cannot be recorded until the account is verified
  //    with evidence - the case that used to block external LawPay payments entirely.
  const blockedRow = panel.getByTestId('lawpay-row-provider-d')
  await panel.getByRole('button', { name: 'Decide Yasmine Said' }).click()
  await blockedRow.getByLabel('Ownership for Yasmine Said').selectOption('matter')
  await blockedRow.getByLabel('Matter for Yasmine Said').selectOption({ label: 'Alpha Matter' })
  await blockedRow.getByLabel('Transaction type for Yasmine Said').selectOption('trust_deposit')
  assert.match(await blockedRow.getByTestId('lawpay-preview-provider-d').innerText(), /The deposit account is not established yet/)
  assert.equal(await blockedRow.getByRole('button', { name: 'Confirm and record Yasmine Said' }).isDisabled(), true, 'an unverified account must not be recordable')
  await blockedRow.getByLabel('Actual account for Yasmine Said').selectOption('trust')
  await blockedRow.getByLabel('Account evidence for Yasmine Said').fill('LawPay transaction provider-d, 12 Sep 2026, trust deposit report line 4')
  await blockedRow.getByLabel('Account explanation for Yasmine Said').fill('The LawPay trust deposit report names the IOLTA account for this transaction.')
  assert.match(await blockedRow.getByTestId('lawpay-account-provider-d').innerText(), /Manually verified/)
  assert.equal(await blockedRow.getByRole('button', { name: 'Confirm and record Yasmine Said' }).isDisabled(), false, 'a verified account can be recorded')
  await blockedRow.getByRole('button', { name: 'Save for later Yasmine Said' }).click()
  await blockedRow.getByTestId('lawpay-message-provider-d').waitFor()
  assert.match(await blockedRow.getByTestId('lawpay-message-provider-d').innerText(), /Saved for later/)
  assert.ok(store.actions.includes('save'), 'the decision must reach the gateway')
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-account-verification.png' })
  // 3. The reported-account trust charge: ownership, category, preview, save, reload, record.
  const row = panel.getByTestId('lawpay-row-provider-a')
  await panel.getByRole('button', { name: 'Decide Alpha Synthetic' }).click()
  await row.getByLabel('Ownership for Alpha Synthetic').selectOption('matter')
  await row.getByLabel('Matter for Alpha Synthetic').selectOption({ label: 'Alpha Matter' })
  await row.getByLabel('Transaction type for Alpha Synthetic').selectOption('trust_deposit')
  const preview = await row.getByTestId('lawpay-preview-provider-a').innerText()
  assert.match(preview, /Money in \$5,?000\.00 for Alpha Matter/)
  assert.match(preview, /Trust balance change: \+\$5,?000\.00/)
  assert.match(preview, /Client funds held in trust/)
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-classification-preview.png' })
  await row.getByRole('button', { name: 'Save for later Alpha Synthetic' }).click()
  await row.getByTestId('lawpay-message-provider-a').waitFor()
  assert.match(await row.getByTestId('lawpay-message-provider-a').innerText(), /Saved for later\. Nothing posted\./)
  assert.equal(await readMoney(dashboard, 'Trust account'), trustOnFinancesBefore, 'saving for later must not move money')
  // Server persistence: reload the page and the decision comes back from the service.
  await dashboard.reload({ waitUntil: 'domcontentloaded' })
  const savedRow = dashboard.locator('[data-testid="lawpay-row-provider-a"]')
  await savedRow.waitFor({ timeout: 60000 })
  await savedRow.getByText('Classified, awaiting verification or posting').waitFor()
  await dashboard.locator('section[aria-label="LawPay payment classification"]').getByRole('button', { name: 'Show every LawPay payment' }).click()
  await savedRow.getByRole('button', { name: 'Decide Alpha Synthetic' }).click()
  await savedRow.getByLabel('Transaction type for Alpha Synthetic').selectOption('trust_deposit')
  await savedRow.getByRole('button', { name: 'Confirm and record Alpha Synthetic' }).click()
  await savedRow.getByTestId('lawpay-message-provider-a').waitFor()
  assert.match(await savedRow.getByTestId('lawpay-message-provider-a').innerText(), /Recorded in Mio\. \$5,000\.00 is now in this client’s trust balance\./)
  // The recorded money reaches the trust balance the Finances page shows, exactly once.
  await dashboard.getByTestId('lawpay-message-provider-a').waitFor()
  const trustOnFinancesAfter = await readMoney(dashboard, 'Trust account')
  assert.equal(Number((trustOnFinancesAfter - trustOnFinancesBefore).toFixed(2)), 5000, 'the trust balance must move by the recorded amount exactly once')
  await dashboard.waitForTimeout(500)
  assert.equal(await readMoney(dashboard, 'Trust account'), trustOnFinancesAfter, 'the trust balance must settle')
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-recorded-trust.png' })
  // The accounting view is a display ledger: the recorded deposit appears once and is not
  // added as a second payment.
  await dashboard.getByRole('button', { name: 'Accounting', exact: true }).last().click()
  await dashboard.getByRole('columnheader', { name: 'Operating payment', exact: true }).waitFor()
  const recorded = dashboard.locator('tr').filter({ hasText: 'recorded from the classification review' })
  await recorded.first().waitFor()
  assert.equal(await recorded.count(), 1, 'the recorded payment must appear once in the accounting view')
  const accountingRow = await recorded.first().innerText()
  assert.match(accountingRow, /\$5,000\b/)
  assert.ok(accountingRow.includes(`$${trustOnFinancesAfter.toLocaleString('en-US')}`), `the accounting trust running balance must equal the Finances trust balance: ${accountingRow}`)
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-accounting-once.png' })
  // 4. Recording it again is refused rather than duplicated.
  await dashboard.getByRole('button', { name: 'Finances', exact: true }).last().click()
  await panel.waitFor()
  await panel.getByRole('button', { name: 'Show every LawPay payment' }).click()
  const recordedRow = panel.getByTestId('lawpay-row-provider-a')
  await recordedRow.waitFor()
  assert.match(await recordedRow.innerText(), /Recorded in Mio/)
  await recordedRow.getByRole('button', { name: 'Decide Alpha Synthetic' }).click()
  await recordedRow.getByLabel('Transaction type for Alpha Synthetic').selectOption('trust_deposit')
  assert.equal(await recordedRow.getByRole('button', { name: 'Confirm and record Alpha Synthetic' }).isDisabled(), true, 'a recorded payment must not be recordable twice')
  assert.match(await recordedRow.getByTestId('lawpay-preview-provider-a').innerText(), /already recorded in Mio/)
  // 5. The same balance on the page the withdrawal rows are built from.
  page = await context.newPage(); watch(page)
  await page.goto(`${origin}/#billing`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).click()
  const billingTable = page.locator('table').filter({ has: page.locator('thead th', { hasText: /^Trust/ }) }).first()
  await billingTable.waitFor()
  const alphaRow = billingTable.locator('tr').filter({ hasText: 'Alpha Matter' }).first()
  await alphaRow.waitFor()
  const heads = await billingTable.locator('thead th').allInnerTexts()
  const trustIndex = heads.findIndex((text) => /^\s*Trust/.test(String(text)))
  assert.ok(trustIndex >= 0, `Bulk billing must show a Trust column: ${JSON.stringify(heads)}`)
  const billingCells = await alphaRow.locator('td').allInnerTexts()
  const billingTrust = Number(String(billingCells[trustIndex] || '').replace(/[^0-9.-]/g, ''))
  assert.equal(billingTrust, trustOnFinancesAfter, 'Bulk billing / withdrawal trust must agree with the matter Finances trust balance')
  assert.ok(store.actions.includes('review') && store.actions.includes('post'), 'the browser must reach the gateway for both reading and recording')
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [], 'no financial table may be written directly from the browser')
  assert.deepEqual(blocked, [], 'no service outside Mio may be called')
  console.log(JSON.stringify({ ok: true, recording_actions: store.actions, classifications: store.classifications.length, ledger_entries: store.ledger.length, trust_moved: Number((trustOnFinancesAfter - trustOnFinancesBefore).toFixed(2)), tests: ['the Finances page carries the classification workflow', 'a reported deposit account is named from the provider record', 'an unreported deposit account is stated plainly', 'an unverified account cannot be recorded and a verified one can', 'the preview states the money, the trust change and the invoice effect', 'saving for later writes nothing and survives a reload', 'recording moves the matter trust balance exactly once', 'the accounting view shows the recorded payment once', 'a recorded payment cannot be recorded twice', 'Bulk billing / withdrawal trust agrees with the matter Finances balance'] }, null, 2))
} catch (error) {
  try { fs.writeFileSync('finance-test-results/failure.txt', await page.locator('body').innerText()) } catch { /* page already gone */ }
  if (dashboardRef && dashboardRef !== page) { try { fs.writeFileSync('finance-test-results/failure-matter.txt', await dashboardRef.locator('body').innerText()) } catch { /* page already gone */ } }
  await page.screenshot({ path: 'finance-test-results/failure.png' }).catch(() => {})
  console.error({ moneyReads, errors, writes, blocked, actions: store.actions, ledger: store.ledger })
  throw error
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
}



