// V324 preview: payments created directly in LawPay, in the real production bundle, with the
// gateway resolving each one through Mio's own account-mapping module. Four cases, four labels:
// a trust payment, an operating payment (whose provider identifier arrives as a number), an
// identifier Mio has no mapping for, and a charge the provider never gave an account for.
// Synthetic data only: no live provider call, no live record, no financial write.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { accountRegistry, resolveTransactionAccount } from '../src/mioLawPayAccounts.js'

const now = new Date().toISOString(), owner = '00000000-0000-4000-8000-00000000324a', email = 'admin.synthetic@example.invalid'
const user = { id: owner, email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: now, app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: now }
const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64url'), exp = Math.floor(Date.now() / 1000) + 3600
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: owner, email, role: 'authenticated', exp, aud: 'authenticated' })}.test`, refresh_token: 'test-only', expires_at: exp, expires_in: 3600, token_type: 'bearer', user }
const client = { id: 'client-alpha', first_name: 'Alpha', last_name: 'Synthetic', email: 'alpha@example.invalid' }
const matter = { id: '00000000-0000-4000-8000-000000003241', client_id: client.id, name: 'Alpha Matter', matter_type: 'Modification', matter_status: 'Active Client', case_status: 'Open', is_active: true, created_at: now, clients: client }
// The firm's configured deposit accounts. Secrets are strings; LawPay is reported as sending the
// operating identifier as a number, which is exactly the case that used to arrive unresolved.
const mappingRows = [
  { provider_account_id: '91075', account_key: 'echeck_trust', bank_role: 'trust', label: 'eCheck IOLTA trust account', is_active: true },
  { provider_account_id: '91077', account_key: 'echeck_operating', bank_role: 'operating', label: 'eCheck firm operating account', is_active: true },
]
const registry = accountRegistry({ rows: mappingRows, environment: {} })
const direct = (id, accountId, payer) => ({ id: `tx-${id}`, gateway_transaction_id: id, occurred_at: '2026-09-21T15:00:00Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_id: accountId, amount_cents: 100000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: payer, payer_email: `${id}@example.invalid`, payment_method_type: 'eCheck', last_four: '4242', raw: {} })
const transactions = [
  direct('direct-trust', '91075', 'Direct Trust Payer'),
  direct('direct-operating', 91077, 'Direct Operating Payer'),
  direct('direct-unmapped', '70246', 'Direct Unmapped Payer'),
  direct('direct-no-account', '', 'Direct Missing Payer'),
]
// The gateway resolves every transaction against the firm's mapping while reading it.
const asGatewaySees = (transaction) => {
  const resolved = resolveTransactionAccount({ transaction, registry })
  return { ...transaction, resolved_account_key: resolved.account_key, resolved_account_source: resolved.registry_source || resolved.matched_by, resolved_account_label: resolved.label }
}
const errors = []
const server = http.createServer((req, res) => {
  const file = path.resolve(path.resolve('dist'), '.' + new URL(req.url, 'http://localhost').pathname)
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.resolve('dist/index.html')
  res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html')
  res.end(fs.readFileSync(target))
})
await new Promise((resolve) => server.listen(4188, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:4188'
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
await context.addInitScript(({ session }) => { if (location.origin === 'http://127.0.0.1:4188') localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token', JSON.stringify(session)) }, { session })
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
await context.route('**/*', async (route) => {
  const request = route.request(), url = new URL(request.url())
  if (url.hostname === '127.0.0.1') return route.continue()
  if (!url.hostname.endsWith('.supabase.co')) return route.fulfill(json({}))
  if (url.pathname.includes('/auth/v1/')) return route.fulfill(json(url.pathname.endsWith('/user') ? user : session))
  const table = url.pathname.split('/').pop()
  if (table === 'lawpay-gateway') {
    const body = request.postDataJSON()
    if (body.action === 'review') return route.fulfill(json({ ok: true, version: 324, transactions: transactions.map(asGatewaySees), classifications: [], ledger_entries: [], accounts: mappingRows, mapping_table_available: true, refund_resolutions_available: true, refund_resolutions: [] }))
    return route.fulfill(json({ ok: true, page: 1, processed: 0, total_entries: 0, has_more: false, next_page: null, warnings: [] }))
  }
  if (table === 'lawpay-account-diagnostics') return route.fulfill(json({ ok: true, version: 324, redacted: true, mapping_table_available: true, diagnostics: { transactions_reviewed: 4, by_ingest_path: { webhook: 1, poll: 3 }, provider_account_id_types: { string: 3, number: 1, absent: 0 }, identifier_supplied_mapped: 2, identifier_supplied_unmapped: 1, identifier_absent: 1, missing_provider_account_id: 1, distinct_provider_accounts: { '••••1075': 1, '••••1077': 1, '••••0246': 1 }, supplied_mapped_provider_accounts: [{ account_last4: '••••1075', transactions: 1 }, { account_last4: '••••1077', transactions: 1 }], unmapped_provider_accounts: [{ account_last4: '••••0246', transactions: 1 }], configured_accounts: [{ account_key: 'echeck_trust', provider_account_last4: '••••1075', bank_account_id: 'plaid-trust', source: 'registry' }], mapping_problems: [], mapping_duplicates: [], provider_field_names_present: ['account_id'], configured_account_count: 2 } }))
  if (table === 'mio_cloud_state_read_chunks_v297') return route.fulfill(json([]))
  if (table === 'matters') return route.fulfill(json([matter]))
  if (table === 'clients') return route.fulfill(json([client]))
  if (table === 'team_members') return route.fulfill(json([{ id: 'synthetic-member', email, first_name: 'Test', last_name: 'Attorney', is_active: true, page_access: [] }]))
  if (table === 'setting_options') return route.fulfill(json(Object.entries({ matter_status: ['Active Client'], case_status: ['Open'], matter_type: ['Modification'] }).flatMap(([category, names]) => names.map((name, index) => ({ id: category + index, category, name, is_active: true, sort_order: index })))))
  return route.fulfill(json([]))
})
fs.mkdirSync('finance-test-results', { recursive: true })
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(`${origin}/#billing`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).click()
  const link = page.locator('a').filter({ hasText: /^Alpha (Synthetic|Matter)/ }).first()
  await link.waitFor({ timeout: 60000 })
  const opened = context.waitForEvent('page', { timeout: 20000 }).catch(() => null)
  await link.click()
  const dashboard = (await opened) || page
  dashboard.setDefaultTimeout(30000)
  dashboard.on('pageerror', (error) => errors.push(error.message))
  const panel = dashboard.locator('section[aria-label="LawPay payment classification"]')
  await panel.waitFor({ timeout: 60000 })
  const labelOf = async (id) => (await dashboard.getByTestId(`lawpay-account-${id}`).innerText()).trim()
  const trust = await labelOf('direct-trust')
  const operating = await labelOf('direct-operating')
  const unmapped = await labelOf('direct-unmapped')
  const notSupplied = await labelOf('direct-no-account')
  assert.equal(trust, 'LawPay deposit account: Trust · eCheck IOLTA trust account', 'a direct LawPay trust payment is labelled trust automatically')
  assert.equal(operating, 'LawPay deposit account: Operating · eCheck firm operating account', 'a numeric provider identifier resolves to operating')
  assert.match(unmapped, /^Unmapped LawPay account ending ••••0246 · LawPay named this deposit account and Mio has no mapping for it yet\./, 'a supplied identifier with no mapping says exactly that, then says what fixes it')
  assert.match(notSupplied, /^Account not supplied by LawPay — manual verification required · LawPay supplied no deposit account/, 'a missing identifier is a different message with a different remedy')
  assert.notEqual(unmapped, notSupplied, 'the two unresolved conditions are never described as the same problem')
  // The administrator-only, read-only diagnostics control, and the report it prints: masked counts
  // that separate supplied-and-mapped from supplied-but-unmapped from absent, with identifier types,
  // ingest path, masked last fours, configured mapping count and mapping problems — and nothing else.
  await dashboard.getByTestId('lawpay-run-diagnostics').click()
  const report = dashboard.getByTestId('lawpay-diagnostics-report')
  await report.waitFor({ state: 'visible', timeout: 20000 })
  const reportText = await report.innerText()
  assert.match(reportText, /"redacted": true/)
  assert.match(reportText, /"by_ingest_path"/)
  assert.match(reportText, /"identifier_supplied_mapped": 2/)
  assert.match(reportText, /"identifier_supplied_unmapped": 1/)
  assert.match(reportText, /"identifier_absent": 1/)
  assert.match(reportText, /"provider_account_id_types"/)
  assert.match(reportText, /account_last4/)
  assert.match(reportText, /"configured_account_count": 2/)
  assert.match(reportText, /"mapping_problems": \[\]/)
  assert.doesNotMatch(reportText, /payer|email|reference|amount_cents|Direct Payer|91075/, 'the report carries no payer, amount, email, reference, payload content or full identifier')
  await dashboard.screenshot({ path: 'finance-test-results/lawpay-account-resolution-v324.png', fullPage: false })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, version: 324, cases: 4, labels: { trust, operating, unmapped, not_supplied: notSupplied }, by_number: true, financial_writes: 0, provider_calls: 0 }, null, 2))
} catch (error) {
  try { fs.writeFileSync('finance-test-results/v324-preview-failure.txt', await page.locator('body').innerText()) } catch { /* page gone */ }
  console.error({ errors })
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
