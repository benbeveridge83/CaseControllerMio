// SYNTHETIC PREVIEW ONLY — present on the preview branch, never on the feature branch or main.
//
// This module answers every Mio request from memory: sign-in, the finance tables and both Edge
// Functions. It is installed by `installSyntheticPreview()`, which does nothing unless
// `import.meta.env.VITE_MIO_SYNTHETIC === '1'` — a value only the preview build defines
// (vite.preview.config.js). A production build of the same source therefore cannot switch it on,
// and the preview bundle's project URL is a host that cannot resolve.
//
// The rules it enforces are the rules the database enforces, so the preview demonstrates the real
// behaviour: an amount is taken from the stored provider transaction, a payment posts once, a
// correction reverses once and posts the replacement once, and a refused correction changes
// nothing. All money here is invented.
import { PUBLIC_SUPABASE_URL } from './mioSupabasePublic.js'

export const syntheticPreviewEnabled = import.meta.env.VITE_MIO_SYNTHETIC === '1'

const now = () => new Date().toISOString()
const owner = '00000000-0000-4000-8000-00000000323b'
const adminEmail = 'preview.admin@example.invalid'
const matterIds = ['00000000-0000-4000-8000-000000004231', '00000000-0000-4000-8000-000000004232']
const matters = [
  { id: matterIds[0], client_id: 'client-alpha', name: 'Alpha Matter (synthetic)', matter_type: 'Modification', matter_status: 'Active Client', case_status: 'Open', is_active: true, created_at: now(), clients: { id: 'client-alpha', first_name: 'Alpha', last_name: 'Synthetic', email: 'alpha@example.invalid' } },
  { id: matterIds[1], client_id: 'client-bravo', name: 'Bravo Matter (synthetic)', matter_type: 'Divorce', matter_status: 'Active Client', case_status: 'Open', is_active: true, created_at: now(), clients: { id: 'client-bravo', first_name: 'Bravo', last_name: 'Synthetic', email: 'bravo@example.invalid' } },
]
const opening = Object.fromEntries(matters.map((matter, index) => [matter.id, { snapshot_date: '2026-08-09', matter_trust_funds: [1550, 1000][index], outstanding_balance: 0, work_in_progress: 0, minimum_balance: 2000 }]))
const invoice = (id, index, type, total, paid, date) => ({ id, invoice_number: 'MIO-2026-' + id.padStart(6, '0'), user_id: owner, matter_id: matters[index].id, client_id: matters[index].client_id, client_name: ['Alpha', 'Bravo'][index] + ' Synthetic', matter_name: matters[index].name, invoice_type: type, status: paid === total ? 'paid' : 'outstanding', total, subtotal: total, amount_paid: paid, balance: total - paid, issue_date: date, due_date: date, created_at: date + 'T12:00:00Z', updated_at: date + 'T12:00:00Z', emailed_at: '', email_history: [], line_items: [{ date, description: 'Synthetic work', amount: total }] })
const invoices = [invoice('501', 0, 'services', 225, 0, '2026-08-21'), invoice('502', 1, 'services', 100, 100, '2026-09-10')]
const trustRows = [{ id: 'trust-alpha', matter_id: matters[0].id, direction: 'out', transaction_type: 'other_disbursement', amount: 100, date: '2026-08-12', created_at: '2026-08-12T12:00:00Z', memo: 'Synthetic trust disbursement', source: 'Mio' }]
// provider-a: a completed charge whose deposit account the provider reported.
// provider-d: a completed charge with no reported deposit account (the case that used to block
//   recording an external payment at all).
// provider-p: a charge the provider has only authorised, which never posts.
const transactions = [
  { id: 'tx-a', gateway_transaction_id: 'provider-a', occurred_at: '2026-09-12T15:13:36Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: 'echeck_trust', account_id: 'acct-7788', amount_cents: 500000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Alpha Synthetic', payer_email: 'alpha@example.invalid', raw: { mio_matter_id: matters[0].id } },
  { id: 'tx-d', gateway_transaction_id: 'provider-d', occurred_at: '2026-09-12T17:13:36Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: '', account_id: 'acct-4471', amount_cents: 112000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Yasmine Said', payer_email: 'yasmine@example.invalid', raw: { mio_account_key_source: 'unresolved' } },
  { id: 'tx-p', gateway_transaction_id: 'provider-p', occurred_at: '2026-09-13T09:00:00Z', transaction_type: 'CHARGE', status: 'AUTHORIZED', account_key: 'echeck_trust', account_id: 'acct-7788', amount_cents: 25000, amount_refunded_cents: 0, currency: 'USD', reference: '', payer_name: 'Pending Payer', payer_email: 'pending@example.invalid', raw: {} },
]
const user = { id: owner, email: adminEmail, aud: 'authenticated', role: 'authenticated', email_confirmed_at: now(), app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: now() }
const b64url = (value) => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const session = () => ({ access_token: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: owner, email: adminEmail, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' })}.synthetic`, refresh_token: 'synthetic', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user })
const store = { classifications: [], ledger: [], mapping: [], seq: 0 }
const states = new Map(Object.entries({ caseMioFinanceOpeningBalances: opening, caseMioTrustTransactions: trustRows, caseMioInvoices: invoices, caseMioBillingCutoverDate: '2026-08-09', caseMioBulkBillingFilters: { case_status: 'all', matter_status: 'all', search: '' } }).map(([key, value]) => [key, { key, raw_value: typeof value === 'string' ? value : JSON.stringify(value), json_value: value, updated_at: now() }]))
// The synthetic service keeps the promises the database makes.
const resolvedFor = (transaction) => {
  const mapped = store.mapping.find((row) => row.provider_account_id === transaction.account_id)
  if (transaction.account_key) return { resolved_account_key: transaction.account_key, resolved_account_source: 'environment', resolved_account_label: transaction.account_key }
  if (mapped) return { resolved_account_key: mapped.account_key, resolved_account_source: 'registry', resolved_account_label: mapped.label || mapped.account_key }
  return { resolved_account_key: '', resolved_account_source: '', resolved_account_label: '' }
}
const identityOf = (record) => `${String(record.provider_account_id || '')}:${String(record.gateway_transaction_id || '')}`
function gateway(body) {
  if (body.action === 'review') return { ok: true, version: 323, mapping_table_available: true, accounts: store.mapping, classifications: store.classifications, ledger_entries: store.ledger, transactions: transactions.map((transaction) => ({ ...transaction, ...resolvedFor(transaction) })) }
  if (body.action === 'map_account') {
    const row = body.mapping
    store.mapping = [...store.mapping.filter((existing) => existing.provider_account_id !== row.provider_account_id), { provider_account_id: row.provider_account_id, account_key: row.account_key, bank_role: row.bank_role, label: row.label, last4: row.last4, is_active: true }]
    return { ok: true, result: { status: 'mapped' } }
  }
  if (!['save', 'post', 'match', 'correct'].includes(body.action)) return { ok: true, page: 1, processed: 0, total_entries: 0, has_more: false, next_page: null, warnings: [] }
  const record = body.classification || {}
  const transaction = transactions.find((row) => row.gateway_transaction_id === record.gateway_transaction_id)
  if (!transaction) return { ok: false, error: 'The gateway only records a stored provider transaction.' }
  const identity = identityOf(record)
  const recorded = store.classifications.find((existing) => existing.identity === identity && existing.posting_status === 'posted')
  if (body.action === 'save') {
    if (recorded) return { ok: false, error: 'This transaction is already recorded in Mio, so nothing else will post.' }
    store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: 'c' + (++store.seq), identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'saved', matched_entry_id: '', created_by: adminEmail, created_at: now(), updated_at: now() }]
    return { ok: true, result: { status: 'saved' } }
  }
  if (body.action === 'match') {
    if (recorded) return { ok: false, error: 'This transaction is already recorded in Mio, so nothing else will post.' }
    if (!String(record.matched_entry_id || '')) return { ok: false, error: 'Select the existing entry this transaction matches.' }
    store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: 'c' + (++store.seq), identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'matched', matched_entry_id: record.matched_entry_id, created_by: adminEmail, created_at: now(), updated_at: now() }]
    return { ok: true, result: { status: 'matched', ledger_entry_id: null } }
  }
  if (body.action === 'correct') {
    const previous = store.classifications.find((existing) => existing.identity === identity && existing.posting_status === 'posted')
    if (!previous) return { ok: false, error: 'Only a recorded transaction can be corrected.' }
    if (!String(body.reason || '').trim()) return { ok: false, error: 'Explain why the recorded classification is being corrected.' }
    const originalEntry = store.ledger.find((entry) => entry.classification_id === previous.id && entry.entry_kind !== 'reversal')
    if (originalEntry && store.ledger.some((entry) => entry.reverses_entry_id === originalEntry.id)) return { ok: false, error: 'This posting has already been corrected.' }
    if (!record.actual_account_key) return { ok: false, error: 'The deposit account is not established yet. Record the actual trust or operating account with supporting evidence, then record the transaction.' }
    if (!record.category) return { ok: false, error: 'Choose what the transaction should be recorded as.' }
    if (originalEntry) store.ledger = [...store.ledger, { id: 'e' + (++store.seq), identity, classification_id: previous.id, entry_kind: 'reversal', direction: originalEntry.direction === 'in' ? 'out' : 'in', account_key: originalEntry.account_key, matter_id: originalEntry.matter_id, amount_cents: originalEntry.amount_cents, currency: originalEntry.currency, occurred_at: originalEntry.occurred_at, provider_account_id: originalEntry.provider_account_id, reverses_entry_id: originalEntry.id, created_by: adminEmail }]
    store.classifications = store.classifications.map((existing) => existing.id === previous.id ? { ...existing, posting_status: 'reversed', updated_at: now() } : existing)
    const replacement = { ...record, id: 'c' + (++store.seq), identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'posted', posted_at: now(), created_at: now(), corrects_classification_id: previous.id, created_by: adminEmail }
    store.classifications = [...store.classifications, replacement]
    store.ledger = [...store.ledger, { id: 'e' + (++store.seq), identity, classification_id: replacement.id, entry_kind: String(record.actual_account_key).includes('trust') ? 'trust_entry' : 'operating_association', direction: record.direction === 'out' ? 'out' : 'in', account_key: record.actual_account_key, matter_id: record.matter_id || '', amount_cents: transaction.amount_cents, currency: 'USD', occurred_at: transaction.occurred_at, provider_account_id: transaction.account_id || '', created_at: now() }]
    return { ok: true, result: { status: 'posted', classification_id: replacement.id, corrected_classification_id: previous.id, reversed_entry_id: originalEntry ? originalEntry.id : null, reason: String(body.reason) } }
  }
  if (recorded) return { ok: false, error: 'This transaction is already recorded in Mio. Change it with a linked correction instead of recording it again.' }
  if (!record.actual_account_key) return { ok: false, error: 'The deposit account is not established yet. Record the actual trust or operating account with supporting evidence, then record the transaction.' }
  const classificationId = 'c' + (++store.seq)
  store.classifications = [...store.classifications.filter((existing) => existing.identity !== identity), { ...record, id: classificationId, identity, amount_cents: transaction.amount_cents, currency: transaction.currency, posting_status: 'posted', posted_at: now(), created_at: now(), updated_at: now(), created_by: adminEmail }]
  const entry = { id: 'e' + (++store.seq), identity, classification_id: classificationId, entry_kind: String(record.actual_account_key).includes('trust') ? 'trust_entry' : 'operating_association', direction: record.direction === 'out' ? 'out' : 'in', account_key: record.actual_account_key, matter_id: record.matter_id || '', amount_cents: transaction.amount_cents, currency: 'USD', occurred_at: transaction.occurred_at, provider_account_id: transaction.account_id || '', created_at: now() }
  store.ledger = [...store.ledger.filter((existing) => existing.identity !== identity), entry]
  return { ok: true, result: { status: 'posted', classification_id: classificationId, ledger_entry_id: entry.id } }
}
const DIAGNOSTICS = { transactions_reviewed: 3, missing_provider_account_id: 1, unmapped_provider_accounts: [{ account_last4: '4471', transactions: 1 }] }
// Every request Mio makes is answered here: sign-in, the finance tables and both Edge Functions.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const tableRows = (table) => ({ matters, clients: matters.map((matter) => matter.clients), mio_invoices: invoices, mio_invoice_events: [], lawpay_transactions: transactions, lawpay_payment_requests: [], mio_billing_entries: [] }[table] || null)
async function handle(url, request) {
  const single = (request.headers.get('accept') || '').includes('vnd.pgrst.object')
  if (url.pathname.includes('/auth/v1/')) {
    if (url.pathname.endsWith('/logout')) return json({})
    if (url.pathname.endsWith('/user')) return json(user)
    return json(session())
  }
  const name = url.pathname.split('/').pop()
  if (name === 'lawpay-gateway') return json(gateway(await request.json().catch(() => ({}))))
  if (name === 'lawpay-account-diagnostics') return json({ ok: true, version: 323, redacted: true, diagnostics: DIAGNOSTICS })
  if (name === 'mio_cloud_state_read_chunks_v297') {
    // The same chunked read the database function provides, so the preview loads its synthetic
    // records exactly the way the application loads the firm's.
    const body = await request.json().catch(() => ({}))
    const keys = Array.isArray(body.p_keys) ? body.p_keys : []
    const offset = Number(body.p_offset || 0), chunk = Number(body.p_chunk_chars || 4000)
    const rows = [...states.values()].filter((row) => keys.length === 0 || keys.includes(row.key)).sort((left, right) => left.key.localeCompare(right.key))
    return json(rows.map((row) => {
      const raw = row.raw_value != null ? String(row.raw_value) : JSON.stringify(row.json_value ?? null)
      const chars = Array.from(raw)
      const fragment = chars.slice(offset, offset + Math.min(chunk, Math.floor(262144 / Math.max(1, keys.length)))).join('')
      const next = offset + Array.from(fragment).length
      return { key: row.key, raw_value: fragment, updated_at: row.updated_at, chunk_offset: offset, next_offset: next, total_chars: chars.length, complete: next === chars.length }
    }))
  }
  if (name === 'mio_cloud_state_write_v277') { const body = await request.json().catch(() => ({})); const record = { key: body.p_key, raw_value: body.p_raw, json_value: null, updated_at: now() }; states.set(body.p_key, record); return json(record) }
  if (name === 'case_mio_user_state') { let rows = [...states.values()]; const key = url.searchParams.get('key'); if (key?.startsWith('eq.')) rows = rows.filter((row) => row.key === key.slice(3)); return json(single ? (rows[0] || null) : rows) }
  if (name === 'team_members') { const member = { id: 'synthetic-member', email: adminEmail, first_name: 'Preview', last_name: 'Administrator', is_active: true, page_access: [] }; return json(single ? member : [member]) }
  if (name === 'setting_options') return json(Object.entries({ matter_status: ['Active Client', 'Closed'], case_status: ['Open', 'Closed'], matter_type: ['Modification', 'Divorce'] }).flatMap(([category, list]) => list.map((value, index) => ({ id: category + index, category, name: value, is_active: true, sort_order: index }))))
  const rows = tableRows(name)
  if (rows) {
    if (request.method !== 'GET') return json({ message: 'The synthetic preview keeps no writes' })
    let filtered = rows
    for (const [key, filter] of url.searchParams) if (filter.startsWith('eq.')) filtered = filtered.filter((row) => String(row[key]) === filter.slice(3))
    return json(single ? (filtered[0] || null) : filtered)
  }
  return json(single ? null : [])
}
export function installSyntheticPreview() {
  if (!syntheticPreviewEnabled || typeof window === 'undefined') return
  if (window.__mioSyntheticPreviewInstalled) return
  window.__mioSyntheticPreviewInstalled = true
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin)
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) return json({ connected: false, rows: [], data: [] })
    if (url.hostname.endsWith('.supabase.co')) return json({ message: 'The synthetic preview refuses to talk to a live project.' }, 403)
    if (url.hostname === new URL(PUBLIC_SUPABASE_URL).hostname) return handle(url, new Request(url.toString(), init))
    return realFetch(input, init)
  }
  try {
    const key = `sb-${new URL(PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify(session()))
  } catch { /* storage unavailable */ }
  console.info('[synthetic preview] Every LawPay and finance figure on this page is invented. No live record is read or written.')
}



