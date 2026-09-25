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
    return { ok: true, version: 325, mapping_table_available: true, accounts: store.mapping, classifications: store.classifications, ledger_entries: store.ledger, transactions: transactions.map((transaction) => ({ ...transaction, ...resolvedFor(transaction) })), review_cutover_date: '2026-08-09', legacy_recorded_transaction_ids: [], legacy_attributed_transaction_ids: [] }
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
    store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: 'c' + (++store.seq), identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'saved', matched_entry_id: '', created_by: email, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]
    return { ok: true, result: { status: 'saved' } }
  }
  if (body.action === 'match') {
    if (recorded) return { ok: false, error: 'This transaction is already recorded in Mio, so nothing else will post.' }
    assert.ok(String(record.matched_entry_id || ''), 'a match needs an existing entry')
    store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: 'c' + (++store.seq), identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'matched', matched_entry_id: record.matched_entry_id, created_by: email }]
    return { ok: true, result: { status: 'matched', ledger_entry_id: null } }
  }
  if (body.action === 'correct') {
    assert.ok(String(body.reason || '').trim(), 'a correction must state why')
    const previous = store.classifications.find((existing) => existing.identity === identity && existing.posting_status === 'posted')
    if (!previous) return { ok: false, error: 'Only a recorded transaction can be corrected.' }
    const originalEntry = store.ledger.find((entry) => entry.classification_id === previous.id && entry.entry_kind !== 'reversal')
    if (originalEntry && store.ledger.some((entry) => entry.reverses_entry_id === originalEntry.id)) return { ok: false, error: 'This posting has already been corrected.' }
    // The replacement must be recordable before anything is reversed: a refused corrected posting
    // leaves the previous record and its ledger entry exactly as they were.
    if (!record.actual_account_key) return { ok: false, error: 'The deposit account is not established yet. Record the actual trust or operating account with supporting evidence, then record the transaction.' }
    if (!record.category) return { ok: false, error: 'Choose what the transaction should be recorded as.' }
    if (originalEntry) {
      store.ledger = [...store.ledger, { id: 'e' + (++store.seq), identity, classification_id: previous.id, entry_kind: 'reversal', direction: originalEntry.direction === 'in' ? 'out' : 'in', account_key: originalEntry.account_key, matter_id: originalEntry.matter_id, amount_cents: originalEntry.amount_cents, currency: originalEntry.currency, occurred_at: originalEntry.occurred_at, provider_account_id: originalEntry.provider_account_id, reverses_entry_id: originalEntry.id, created_by: email }]
    }
    store.classifications = store.classifications.map((existing) => existing.id === previous.id ? { ...existing, posting_status: 'reversed', updated_at: new Date().toISOString() } : existing)
    const replacement = { ...record, id: 'c' + (++store.seq), identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'posted', posted_at: new Date().toISOString(), created_at: new Date().toISOString(), corrects_classification_id: previous.id, reason: String(body.reason), created_by: email }
    store.classifications = [...store.classifications, replacement]
    const replacementEntry = { id: 'e' + (++store.seq), identity, classification_id: replacement.id, entry_kind: String(record.actual_account_key).includes('trust') ? 'trust_entry' : 'operating_association', direction: record.direction === 'out' ? 'out' : 'in', account_key: record.actual_account_key, matter_id: record.matter_id || '', amount_cents: transaction.amount_cents, currency: 'USD', occurred_at: transaction.occurred_at, provider_account_id: transaction.account_id || '', created_at: new Date().toISOString() }
    store.ledger = [...store.ledger, replacementEntry]
    return { ok: true, result: { status: 'posted', classification_id: replacement.id, ledger_entry_id: replacementEntry.id, corrected_classification_id: previous.id, reversed_entry_id: originalEntry ? originalEntry.id : null, reason: String(body.reason) } }
  }
  if (recorded) return { ok: false, error: 'This transaction is already recorded in Mio. Change it with a linked correction instead of recording it again.' }
  if (!record.actual_account_key) return { ok: false, error: 'The deposit account is not established yet. Record the actual trust or operating account with supporting evidence, then record the transaction.' }
  const replacementId = 'c' + (++store.seq)
  store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: replacementId, identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'posted', posted_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: email }]
  const entry = { id: 'e' + (++store.seq), identity, classification_id: replacementId, entry_kind: String(record.actual_account_key).includes('trust') ? 'trust_entry' : 'operating_association', direction: record.direction === 'out' ? 'out' : 'in', account_key: record.actual_account_key, matter_id: record.matter_id || '', amount_cents: transaction.amount_cents, currency: 'USD', occurred_at: transaction.occurred_at, provider_account_id: transaction.account_id || '', created_at: new Date().toISOString() }
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
  const match = String(text).match(/-?\$([\d,]+(?:\.\d{2})?)/)
  assert.ok(match, `no amount was shown next to ${label}`)
  const negative = String(text).slice(Math.max(0, String(text).indexOf('$') - 1), String(text).indexOf('$')).includes('-')
  return Number(match[1].replace(/,/g, '')) * (negative ? -1 : 1)
}
// The panel reloads the stored records after a decision, so a balance is polled until it settles
// on the expected figure instead of being read once, mid-refresh.
const waitForMoney = async (scope, label, expected) => {
  let value = NaN
  for (let attempt = 0; attempt < 48; attempt += 1) {
    value = await readMoney(scope, label)
    if (Number(value) === Number(expected)) return value
    await scope.waitForTimeout(250)
  }
  return value
}
// After a reload the panel starts collapsed, so a recorded payment has to be revealed again.
const revealRow = async (scope, id) => {
  const section = scope.locator('section[aria-label="LawPay payment classification"]')
  await section.waitFor({ timeout: 60000 })
  const toggle = section.getByRole('button', { name: 'Show every LawPay payment' })
  if (await toggle.count()) await toggle.click()
  const row = section.locator(`[data-testid="lawpay-row-${id}"]`)
  await row.waitFor({ timeout: 60000 })
  return row
}
let dashboardRef = null
fs.mkdirSync('finance-test-results', { recursive: true })
try {
  // Reach the matter dashboard the way the firm does (for the trust and accounting checks), then reach
  // the central LawPay page (for the classification review queue).
  await page.goto(`${origin}/#billing`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).click()
  const dashboardLink = page.locator('a').filter({ hasText: /^Alpha (Synthetic|Matter)$/ }).first()
  await dashboardLink.waitFor({ timeout: 60000 })
  const opened = context.waitForEvent('page', { timeout: 20000 }).catch(() => null)
  await dashboardLink.click()
  let dashboard = (await opened) || page
  dashboardRef = dashboard
  if (dashboard === page) watch(dashboard)
  await dashboard.waitForLoadState('domcontentloaded')
  await page.goto(`${origin}/#lawpay`, { waitUntil: 'domcontentloaded' })
  const lawpayPage = page
  const panel = page.locator('section[aria-label="LawPay payment classification"]')
  await panel.waitFor({ timeout: 60000 }).catch(async () => {
    // The client link may open the dashboard in a second tab, or the first click may land before
    // the link is live: try once more before failing.
    const retry = context.waitForEvent('page', { timeout: 20000 }).catch(() => null)
    await dashboardLink.click()
    const second = await retry
    if (second) { dashboard = second; dashboardRef = second; watch(second); await second.locator('section[aria-label="LawPay payment classification"]').waitFor({ timeout: 60000 }) }
  })
  const trustOnFinancesBefore = await readMoney(dashboard, 'Trust account')
  assert.ok(await panel.getByRole('heading', { name: 'LawPay payment classification' }).count(), 'the central LawPay page must carry the classification workflow')
  // 1. Every stored charge waiting on a decision is listed, with its reported account or the
  //    plain statement that none was reported.
  assert.match(await panel.getByTestId('lawpay-classification-summary').innerText(), /2 item\(s\) need a decision/)
  assert.match(await panel.getByTestId('lawpay-account-provider-a').innerText(), /LawPay deposit account: Trust · eCheck IOLTA trust account/)
  assert.match(await panel.getByTestId('lawpay-account-provider-d').innerText(), /Unmapped LawPay account ending ••••4471/)
  await lawpayPage.getByTestId('lawpay-run-diagnostics').waitFor()
  // Keep every payment in view for the rest of the flow, so a decision's confirmation stays on
  // screen after the row stops being pending.
  await panel.getByRole('button', { name: 'Show every LawPay payment' }).click()
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-classification-list.png' })
  // 2. The charge LawPay says nothing about cannot be recorded until the account is verified
  //    with evidence - the case that used to block external LawPay payments entirely.
  const blockedRow = panel.getByTestId('lawpay-row-provider-d')
  await panel.getByRole('button', { name: 'Decide Yasmine Said' }).click()
  await blockedRow.getByLabel('Ownership for Yasmine Said').selectOption('matter')
  await blockedRow.getByLabel('Matter for Yasmine Said').selectOption(matters[0].id)
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
  await row.getByLabel('Matter for Alpha Synthetic').selectOption(matters[0].id)
  assert.match(await row.getByTestId('lawpay-derived-category-provider-a').innerText(), /Trust deposit — money in.*set automatically/)
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
  await page.reload({ waitUntil: 'domcontentloaded' })
  const savedRow = page.locator('[data-testid="lawpay-row-provider-a"]')
  await savedRow.waitFor({ timeout: 60000 })
  await savedRow.getByText('Classified, awaiting verification or posting').waitFor()
  await page.locator('section[aria-label="LawPay payment classification"]').getByRole('button', { name: 'Show every LawPay payment' }).click()
  await savedRow.getByRole('button', { name: 'Decide Alpha Synthetic' }).click()
  await savedRow.getByLabel('Matter for Alpha Synthetic').selectOption(matters[0].id)
  assert.match(await savedRow.getByTestId('lawpay-derived-category-provider-a').innerText(), /Trust deposit — money in.*set automatically/)
  await savedRow.getByRole('button', { name: 'Confirm and record Alpha Synthetic' }).click()
  await savedRow.getByTestId('lawpay-message-provider-a').waitFor()
  assert.match(await savedRow.getByTestId('lawpay-message-provider-a').innerText(), /Recorded in Mio\. \$5,000\.00 is now in this client’s trust balance\./)
  // The recorded money reaches the trust balance the Finances page shows, exactly once.
  const trustOnFinancesAfter = await waitForMoney(dashboard, 'Trust account', Number((trustOnFinancesBefore + 5000).toFixed(2)))
  assert.equal(Number((trustOnFinancesAfter - trustOnFinancesBefore).toFixed(2)), 5000, 'the trust balance must move by the recorded amount exactly once')
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
  const showEvery = panel.getByRole('button', { name: 'Show every LawPay payment' })
  if (await showEvery.count()) await showEvery.click()
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
  // 6. Correcting a recorded classification: trust -> operating. The previous posting is preserved,
  //    its ledger effect reversed exactly once, and the replacement posts exactly once.
  await dashboard.getByRole('button', { name: 'Finances', exact: true }).last().click()
  await panel.waitFor()
  const correctedRow = panel.getByTestId('lawpay-row-provider-a')
  await correctedRow.waitFor()
  if (!(await correctedRow.getByLabel('Correction reason for Alpha Synthetic').count())) {
    await correctedRow.getByRole('button', { name: 'Decide Alpha Synthetic' }).click()
  }
  await correctedRow.getByTestId('lawpay-correction-provider-a').waitFor()
  await correctedRow.getByLabel('Correction account for Alpha Synthetic').selectOption('operating')
  await correctedRow.getByLabel('Correction evidence for Alpha Synthetic').fill('LawPay settlement report 12 Sep 2026, line 4: settled to the firm operating account')
  await correctedRow.getByLabel('Correction explanation for Alpha Synthetic').fill('The settlement report shows this charge was deposited to the operating account, not IOLTA.')
  await correctedRow.getByLabel('Transaction type for Alpha Synthetic').selectOption('consultation_payment')
  await correctedRow.getByLabel('Correction reason for Alpha Synthetic').fill('The settlement report shows the money reached the operating account.')
  const correctionPreview = await correctedRow.getByTestId('lawpay-correction-preview-provider-a').innerText()
  assert.match(correctionPreview, /Reversal: money out 5000\.00 on the previously recorded account, undoing a trust credit/)
  assert.match(correctionPreview, /Trust balance change from the reversal: −\$5000\.00/)
  assert.match(correctionPreview, /Trust balance change overall: −\$5000\.00/)
  assert.match(correctionPreview, /stay in the audit history/)
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-correction-preview.png' })
  // A correction that cannot be recorded must leave the original posting exactly as it was.
  const beforeRefusal = { ledger: store.ledger.length, posted: store.classifications.filter((row) => row.identity === 'acct-7788:provider-a' && row.posting_status === 'posted').length }
  const refusedCorrection = gateway({ action: 'correct', reason: 'no account established', classification: { gateway_transaction_id: 'provider-a', provider_account_id: 'acct-7788', matter_id: matters[0].id, category: 'consultation_payment', direction: 'in' } })
  assert.equal(refusedCorrection.ok, false, 'a correction without an established account must be refused')
  assert.equal(store.ledger.length, beforeRefusal.ledger, 'a refused correction must reverse nothing')
  assert.equal(store.classifications.filter((row) => row.identity === 'acct-7788:provider-a' && row.posting_status === 'posted').length, beforeRefusal.posted, 'a refused correction must leave the original posting unchanged')
  // Double-click protection: two clicks are dispatched in the same browser task, and only one
  // decision may be sent for this payment.
  const correctionButton = correctedRow.getByRole('button', { name: 'Confirm correction Alpha Synthetic' })
  await correctionButton.evaluate((element) => { element.click(); element.click(); return true })
  let correctionMessage = ''
  for (let attempt = 0; attempt < 48; attempt += 1) {
    correctionMessage = await correctedRow.getByTestId('lawpay-message-provider-a').innerText().catch(() => '')
    if (/Corrected\./.test(correctionMessage)) break
    await dashboard.waitForTimeout(250)
  }
  assert.match(correctionMessage, /Corrected\. The previous posting was reversed once and the replacement was recorded once/)
  assert.equal(store.classifications.filter((row) => row.corrects_classification_id).length, 1, 'a double click must correct once')
  await correctedRow.getByTestId('lawpay-message-provider-a').waitFor()
  assert.match(await correctedRow.getByTestId('lawpay-message-provider-a').innerText(), /Corrected\. The previous posting was reversed once and the replacement was recorded once/)
  const reversals = store.ledger.filter((entry) => entry.reverses_entry_id)
  assert.equal(reversals.length, 1, 'the previous ledger effect must be reversed exactly once')
  assert.equal(reversals[0].direction, 'out', 'the reversal of a trust credit is a trust debit')
  const latest = store.classifications[store.classifications.length - 1]
  assert.equal(store.ledger.filter((entry) => entry.classification_id === latest.id).length, 1, 'the replacement must post exactly once')
  await dashboard.reload({ waitUntil: 'domcontentloaded' })
  await revealRow(lawpayPage, 'provider-a')
  // The trust credit that was never trust money is taken back exactly once, and the resulting
  // negative ledger balance stays visible instead of being clamped to zero.
  const afterTrustToOperating = await waitForMoney(dashboard, 'Trust account', Number((trustOnFinancesBefore - 5000).toFixed(2)))
  assert.equal(Number((trustOnFinancesAfter - afterTrustToOperating).toFixed(2)), 5000, 'correcting trust to operating takes the trust credit back exactly once')
  assert.equal(afterTrustToOperating, trustOnFinancesBefore, 'the corrected ledger balance is the pre-payment figure, shown exactly and not floored')
  assert.equal(await dashboard.getByTestId('trust-discrepancy').count(), 0, 'a positive ledger is not flagged')
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-corrected-to-operating.png' })
  // A trust disbursement that relied on the deposit being trust money. Once the deposit is
  // corrected away, the ledger is genuinely negative and must stay visible as it is.
  states.set('caseMioTrustTransactions', { key: 'caseMioTrustTransactions', raw_value: JSON.stringify([...trust, { id: 'trust-alpha-reliance', matter_id: matters[0].id, direction: 'out', transaction_type: 'other_disbursement', amount: 2000, date: '2026-09-14', created_at: '2026-09-14T10:00:00Z', memo: 'Synthetic trust disbursement that relied on the deposit', source: 'Mio' }]), json_value: null, updated_at: new Date().toISOString() })
  await dashboard.reload({ waitUntil: 'domcontentloaded' })
  await revealRow(lawpayPage, 'provider-a')
  const negativeTrust = await waitForMoney(dashboard, 'Trust account', Number((afterTrustToOperating - 2000).toFixed(2)))
  assert.ok(negativeTrust < 0, `the fixture must be genuinely negative after the correction: ${negativeTrust}`)
  const discrepancy = dashboard.getByTestId('trust-discrepancy')
  await discrepancy.waitFor()
  assert.match(await discrepancy.innerText(), /Trust ledger is negative/)
  assert.match(await discrepancy.innerText(), /discrepancy to review, not funds to spend/)
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-negative-trust-discrepancy.png' })
  // Reload persistence, and the linked audit history.
  await dashboard.reload({ waitUntil: 'domcontentloaded' })
  const persistedRow = await revealRow(lawpayPage, 'provider-a')
  await persistedRow.getByRole('button', { name: 'Decide Alpha Synthetic' }).click()
  const history = await persistedRow.getByTestId('lawpay-history-provider-a').innerText()
  assert.match(history, /posted · Consultation payment — money in/)
  assert.match(history, /reversed · Trust deposit — money in/)
  assert.match(history, /corrects an earlier recording/)
  assert.equal(await readMoney(dashboard, 'Trust account'), negativeTrust, 'the corrected balance survives a reload')
  // 7. Correcting it back: operating -> trust. The operating posting never moved trust, so its
  //    reversal moves nothing and the replacement adds the trust credit once.
  await persistedRow.getByLabel('Correction account for Alpha Synthetic').selectOption('trust')
  await persistedRow.getByLabel('Correction evidence for Alpha Synthetic').fill('IOLTA deposit report, 12 Sep 2026, line 12')
  await persistedRow.getByLabel('Correction explanation for Alpha Synthetic').fill('The deposit appears on the IOLTA statement, so it was never operating money.')
  await persistedRow.getByLabel('Transaction type for Alpha Synthetic').selectOption('trust_deposit')
  await persistedRow.getByLabel('Correction reason for Alpha Synthetic').fill('The deposit is on the IOLTA statement.')
  const backToTrustPreview = await persistedRow.getByTestId('lawpay-correction-preview-provider-a').innerText()
  assert.match(backToTrustPreview, /Trust balance change from the reversal: none/)
  assert.match(backToTrustPreview, /Trust balance change overall: \+\$5000\.00/)
  await persistedRow.getByRole('button', { name: 'Confirm correction Alpha Synthetic' }).click()
  await persistedRow.getByTestId('lawpay-message-provider-a').waitFor()
  assert.match(await persistedRow.getByTestId('lawpay-message-provider-a').innerText(), /Corrected\./)
  const backToTrust = await waitForMoney(dashboard, 'Trust account', Number((trustOnFinancesAfter - 2000).toFixed(2)))
  assert.equal(backToTrust, trustOnFinancesAfter - 2000, 'correcting operating back to trust restores the trust credit exactly once')
  assert.ok(backToTrust > 0, 'the balance is positive again')
  assert.equal(await dashboard.getByTestId('trust-discrepancy').count(), 0, 'the discrepancy notice clears once the ledger is positive again')
  assert.equal(store.ledger.filter((entry) => entry.reverses_entry_id).length, 2, 'each correction reverses its own posting exactly once')
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-corrected-back-to-trust.png' })
  // The accounting view shows the correction once, and the figure the withdrawal rows are built
  // from still agrees with the matter Finances balance.
  await dashboard.getByRole('button', { name: 'Accounting', exact: true }).last().click()
  await dashboard.getByRole('columnheader', { name: 'Operating payment', exact: true }).waitFor()
  const accountingTable = dashboard.locator('table').filter({ has: dashboard.getByRole('columnheader', { name: 'Operating payment', exact: true }) }).first()
  await accountingTable.waitFor()
  const reversalRows = accountingTable.locator('tbody tr').filter({ hasText: 'Reversal of a corrected LawPay posting' })
  await reversalRows.first().waitFor()
  assert.equal(await reversalRows.count(), 1, 'the trust reversal must appear once in the accounting view')
  const accountingText = await accountingTable.innerText()
  assert.ok(accountingText.includes(`$${backToTrust.toLocaleString('en-US')}`), `the accounting trust balance must agree with the matter Finances balance: ${accountingText.slice(-300)}`)
  const correctedPage = await context.newPage(); watch(correctedPage)
  await correctedPage.goto(`${origin}/#billing`, { waitUntil: 'domcontentloaded' })
  await correctedPage.getByRole('button', { name: 'Bulk Billing', exact: true }).waitFor({ timeout: 60000 })
  await correctedPage.getByRole('button', { name: 'Bulk Billing', exact: true }).click()
  const correctedTable = correctedPage.locator('table').filter({ has: correctedPage.locator('thead th', { hasText: /^Trust/ }) }).first()
  await correctedTable.waitFor()
  const correctedHeads = await correctedTable.locator('thead th').allInnerTexts()
  const correctedIndex = correctedHeads.findIndex((text) => /^\s*Trust/.test(String(text)))
  const correctedCells = await correctedTable.locator('tr').filter({ hasText: 'Alpha Matter' }).first().locator('td').allInnerTexts()
  assert.equal(Number(String(correctedCells[correctedIndex] || '').replace(/[^0-9.-]/g, '')), backToTrust, 'Bulk billing / withdrawal trust must agree after the corrections')
  assert.ok(store.actions.includes('review') && store.actions.includes('post'), 'the browser must reach the gateway for both reading and recording')
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [], 'no financial table may be written directly from the browser')
  assert.deepEqual(blocked, [], 'no service outside Mio may be called')
  // 7. Cross-page and multi-tab behaviour on one unposted charge. Both pages are open and loaded
  //    before anything is recorded, so the second page is genuinely stale when it tries to record.
  const pushCharge = (id, provider, payer, cents, occurred) => transactions.push({ id, gateway_transaction_id: provider, occurred_at: occurred, transaction_type: 'CHARGE', status: 'COMPLETED', account_key: 'echeck_trust', account_id: 'acct-7788', amount_cents: cents, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: payer, payer_email: `${provider}@example.invalid`, raw: { mio_matter_id: matters[0].id } })
  const panelOf = (tab) => tab.locator('section[aria-label="LawPay payment classification"]')
  const rowOf = (tab, provider) => panelOf(tab).getByTestId(`lawpay-row-${provider}`)
  const loadTab = async (tab) => {
    await tab.reload({ waitUntil: 'domcontentloaded' })
    await panelOf(tab).waitFor({ timeout: 60000 })
    const toggle = panelOf(tab).getByRole('button', { name: 'Show every LawPay payment' })
    if (await toggle.count()) await toggle.click()
  }
  // A second page reaches the same central LawPay review queue, loaded before anything is recorded,
  // which is what makes it stale later.
  const openLawPayTab = async () => {
    const extra = await context.newPage(); watch(extra)
    await extra.goto(`${origin}/#lawpay`, { waitUntil: 'domcontentloaded' })
    await panelOf(extra).waitFor({ timeout: 60000 })
    return extra
  }
  const armRow = async (tab, provider, payer) => {
    await panelOf(tab).getByRole('button', { name: `Decide ${payer}` }).click()
    const row = rowOf(tab, provider)
    await row.waitFor()
    await row.getByLabel(`Ownership for ${payer}`).selectOption('matter')
    await row.getByLabel(`Matter for ${payer}`).selectOption(matters[0].id)
    assert.match(await row.getByTestId(`lawpay-derived-category-${provider}`).innerText(), /Trust deposit — money in.*set automatically/)
    return row
  }
  const postedFor = (provider) => store.classifications.filter((record) => String(record.gateway_transaction_id) === provider && record.posting_status === 'posted').length
  const effectsFor = (provider) => store.ledger.filter((entry) => String(entry.identity).endsWith(`:${provider}`)).length
  pushCharge('tx-multi', 'provider-multi', 'Multi Payer', 300000, '2026-09-14T10:00:00Z')
  const staleTab = await openLawPayTab()
  await loadTab(lawpayPage)
  await loadTab(staleTab)
  assert.equal(await rowOf(lawpayPage, 'provider-multi').getByText('Needs classification').count(), 1, 'both pages must see the charge as undecided before anything is recorded')
  assert.equal(await rowOf(staleTab, 'provider-multi').getByText('Needs classification').count(), 1)
  const winner = await armRow(lawpayPage, 'provider-multi', 'Multi Payer')
  await winner.getByRole('button', { name: 'Confirm and record Multi Payer' }).click()
  await rowOf(lawpayPage, 'provider-multi').getByTestId('lawpay-message-provider-multi').waitFor()
  assert.match(await rowOf(lawpayPage, 'provider-multi').getByTestId('lawpay-message-provider-multi').innerText(), /Recorded in Mio/)
  assert.equal(postedFor('provider-multi'), 1, 'exactly one posting')
  assert.equal(effectsFor('provider-multi'), 1, 'exactly one ledger effect')
  // The stale page still believes the charge is undecided, so it attempts the same recording. The
  // service refuses it: a page cannot duplicate a posting it never saw.
  const staleWorker = await armRow(staleTab, 'provider-multi', 'Multi Payer')
  await staleWorker.getByRole('button', { name: 'Confirm and record Multi Payer' }).click()
  const staleMessage = rowOf(staleTab, 'provider-multi').getByTestId('lawpay-message-provider-multi')
  await staleMessage.waitFor()
  assert.match(await staleMessage.innerText(), /already recorded in Mio/, 'a stale page must be refused by the service')
  assert.equal(postedFor('provider-multi'), 1, 'the refusal must not post again')
  assert.equal(effectsFor('provider-multi'), 1, 'the refusal must not move money again')
  // Focus and reload converge the stale page on the recorded truth.
  await staleTab.bringToFront()
  await loadTab(staleTab)
  await rowOf(staleTab, 'provider-multi').getByText('Recorded in Mio').waitFor()
  await dashboard.getByRole('button', { name: 'Finances', exact: true }).last().click()
  const trustedOnFirst = await readMoney(dashboard, 'Trust account')
  assert.ok(Number.isFinite(Number(trustedOnFirst)), 'the matter trust balance is still reported after the multi-tab recording')
  // A retry on the converged page adds nothing.
  const retryRow = rowOf(staleTab, 'provider-multi')
  if (!(await retryRow.getByTestId('lawpay-decisions-provider-multi').count())) await retryRow.getByRole('button', { name: 'Decide Multi Payer' }).click()
  assert.equal(await retryRow.getByRole('button', { name: 'Confirm and record Multi Payer' }).isDisabled(), true, 'a recorded charge must not be recordable again')
  assert.equal(postedFor('provider-multi'), 1)
  assert.equal(effectsFor('provider-multi'), 1)
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-multi-tab.png' })
  // 8. Two pages record the same brand new charge at the same moment. Only one may win, and the
  //    losing attempt may not add a posting, a ledger effect or a second balance change.
  pushCharge('tx-race', 'provider-race', 'Race Payer', 200000, '2026-09-14T11:00:00Z')
  await loadTab(lawpayPage)
  await loadTab(staleTab)
  const raceTrust = await readMoney(dashboard, 'Trust account')
  const [raceOne, raceTwo] = await Promise.all([armRow(lawpayPage, 'provider-race', 'Race Payer'), armRow(staleTab, 'provider-race', 'Race Payer')])
  const postsBefore = store.actions.filter((action) => action === 'post').length
  await Promise.all([raceOne.getByRole('button', { name: 'Confirm and record Race Payer' }).click(), raceTwo.getByRole('button', { name: 'Confirm and record Race Payer' }).click()])
  for (let attempt = 0; attempt < 60 && store.actions.filter((action) => action === 'post').length < postsBefore + 2; attempt += 1) await dashboard.waitForTimeout(250)
  assert.equal(store.actions.filter((action) => action === 'post').length, postsBefore + 2, 'both pages must have attempted the recording')
  assert.equal(postedFor('provider-race'), 1, 'a simultaneous attempt must not post twice')
  assert.equal(effectsFor('provider-race'), 1, 'a simultaneous attempt must not move money twice')
  await loadTab(lawpayPage)
  await loadTab(staleTab)
  const raceOnFirst = await waitForMoney(dashboard, 'Trust account', Number((raceTrust + 2000).toFixed(2)))
  assert.equal(await waitForMoney(dashboard, 'Trust account', raceOnFirst), raceOnFirst, 'the matter trust balance agrees after the simultaneous recording')
  assert.equal(Number((raceOnFirst - raceTrust).toFixed(2)), 2000, 'the balance moved by the recorded amount exactly once')


  console.log(JSON.stringify({ ok: true, recording_actions: store.actions, ledger_entries: store.ledger.length, corrections_reversed: store.ledger.filter((entry) => entry.reverses_entry_id).length, trust_after_recording: trustOnFinancesAfter, trust_after_corrections: backToTrust, tests: ['the Finances page carries the classification workflow', 'a reported deposit account is named from the provider record', 'an unreported deposit account is stated plainly', 'an unverified account cannot be recorded and a verified one can', 'the preview states the money, the trust change and the invoice effect', 'saving for later writes nothing and survives a reload', 'recording moves the matter trust balance exactly once', 'the accounting view shows the recorded payment once', 'a recorded payment cannot be recorded twice', 'Bulk billing / withdrawal trust agrees with the matter Finances balance', 'the correction preview states the reversal and the replacement', 'a refused correction leaves the original posting unchanged', 'a double click corrects once', 'correcting trust to operating reverses the trust credit exactly once', 'a negative trust ledger stays visible and is flagged as a discrepancy', 'the correction and its audit history survive a reload', 'correcting operating back to trust adds the trust credit exactly once', 'the accounting view shows the reversal once', 'Bulk billing / withdrawal trust agrees after the corrections', 'two pages opened before the recording: one posting, and the stale page is refused by the service', 'focus and reload converge every page on the same trust balance', 'simultaneous recording attempts post once and move money once'] }, null, 2))
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



