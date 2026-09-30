// Synthetic sign-in and intercepted APIs only; never connects to real ads or client records.
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { marketingRange } from '../lib/marketing-agent.js'
import { chunkRows } from './cloud-chunk-fixture.js'

fs.mkdirSync('test-results', { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.MIO_TEST_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
const id = '00000000-0000-4000-8000-000000000330', email = 'synthetic-agent@beveridgelawfirm.com'
const user = { id, email, email_confirmed_at: new Date().toISOString(), aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: new Date().toISOString() }
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url'), exp = Math.floor(Date.now() / 1000) + 3600
const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp, aud: 'authenticated' })}.test-signature`, refresh_token: 'synthetic-test-token', expires_at: exp, expires_in: 3600, token_type: 'bearer', user }
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }), page = await context.newPage()
const errors = [], requests = []
let failChat = false
const states = new Map([['caseMioSnapshotGraphShowInvoicesV259', { key: 'caseMioSnapshotGraphShowInvoicesV259', raw_value: 'true', updated_at: '2026-09-30T00:00:00Z' }]])
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (['127.0.0.1', 'localhost'].includes(url.hostname)) {
    if (url.pathname === '/api/marketing-audit') {
      const body = request.postDataJSON(); requests.push(body)
      assert.equal(body.scope, 'marketing')
      assert.match(request.headers().authorization, /^Bearer /)
      if (body.action === 'chat' && failChat) return respond({ ok: false, error: 'Synthetic provider unavailable' }, 502)
      const range = marketingRange(body.days)
      const evidence = { checkedAt: new Date().toISOString(), range,
        google: { status: 'available', report: { overview: { cost: 253.10 }, account: { currencyCode: 'USD' }, warnings: [] } },
        leads: { status: 'available', inquiries: 3, unaddressed: 1, groups: { family_law: { inquiries: 2 }, personal_injury: { inquiries: 1 }, unknown: { inquiries: 0 } } },
        pnc: { status: 'available', consultationsScheduled: 1 },
        checks: [{ id: 'google', label: 'Google Ads API', status: 'available', detail: 'Fresh account report read successfully.' }, { id: 'phone', label: 'Phone delivery / PBX', status: 'unverified', detail: 'No PBX call logs or test-call result are available to this agent.' }] }
      return respond(body.action === 'context' ? { ok: true, aiConfigured: true, evidence } : { ok: true, answer: 'Three forms reached Mio. Google attribution remains unverified. [Mio form inbox]', responseId: `answer-${requests.length}`, evidence })
    }
    return url.pathname.startsWith('/api/') ? respond({ ok: true, connected: false, data: [] }) : route.continue()
  }
  if (!url.hostname.endsWith('.supabase.co')) return respond({})
  if (url.pathname.includes('/auth/v1/')) return respond(url.pathname.endsWith('/user') ? user : session)
  const table = url.pathname.split('/').pop()
  if (table === 'mio_cloud_state_read_chunks_v297') {
    const data = request.postDataJSON()
    return respond(chunkRows([...states.values()].map(row => ({ ...row, user_id: id })), data))
  }
  if (table === 'mio_cloud_state_write_v277') {
    const data = request.postDataJSON(), row = { key: data.p_key, raw_value: data.p_raw, updated_at: new Date().toISOString() }
    states.set(row.key, row); return respond(row)
  }
  if (table === 'case_mio_user_state') {
    let data = [...states.values()], key = url.searchParams.get('key')
    if (key?.startsWith('eq.')) data = data.filter(row => row.key === key.slice(3))
    if (key?.startsWith('neq.')) data = data.filter(row => row.key !== key.slice(4))
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000)
    const fields = (url.searchParams.get('select') || '*').split(',')
    return respond(data.slice(offset, offset + limit).map(row => fields.includes('*') ? row : Object.fromEntries(fields.map(field => [field, row[field]]))))
  }
  if (table === 'team_members') {
    const member = { id: 'synthetic-member', email, first_name: 'Agent', last_name: 'Test', is_active: true, page_access: [] }
    return respond(request.headers().accept?.includes('vnd.pgrst.object') ? member : [member])
  }
  return respond(request.headers().accept?.includes('vnd.pgrst.object') ? null : [])
})
await page.addInitScript(session => { if (!localStorage.getItem('sb-vnnkxqpyndidnjbrbywz-auth-token')) localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token', JSON.stringify(session)) }, session)
try {
  await page.goto('http://127.0.0.1:4173/#google_ads', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '✦ Ask Mio', exact: true }).click({ timeout: 45000 })
  await page.getByRole('heading', { name: 'Ask Mio Marketing', exact: true }).waitFor()
  await page.getByRole('button', { name: 'What’s the bottleneck?' }).waitFor()
  await page.getByRole('button', { name: 'Refresh evidence', exact: true }).waitFor()
  assert.equal(await page.locator('.mio-agent-metric').nth(1).locator('strong').innerText(), '3')
  await page.screenshot({ path: 'test-results/marketing-agent-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'What’s the bottleneck?' }).click()
  await page.getByText('Three forms reached Mio. Google attribution remains unverified. [Mio form inbox]', { exact: true }).waitFor()
  const input = page.getByLabel('Your marketing question')
  await input.fill('What should I check first?')
  await input.press('Enter')
  await page.locator('.mio-agent-message-assistant').nth(1).waitFor()
  const chat = requests.filter(request => request.action === 'chat')
  assert.equal(chat.length, 2)
  assert.equal(chat[1].messages.length, 3)
  assert.equal(chat[1].messages[1].role, 'assistant')
  await page.getByLabel('Agent reporting period').selectOption('7')
  await page.getByRole('button', { name: 'Refresh evidence', exact: true }).waitFor()
  assert.equal(requests.at(-1).days, 7)
  failChat = true
  await input.fill('Check my forms')
  await input.press('Enter')
  await page.getByRole('alert').filter({ hasText: 'Synthetic provider unavailable' }).waitFor()
  assert.equal(await input.inputValue(), 'Check my forms')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '✦ Ask Mio', exact: true }).click({ timeout: 45000 })
  assert.equal(await page.locator('.mio-agent-message-assistant').count(), 2)
  await page.setViewportSize({ width: 390, height: 844 })
  const panel = await page.locator('.mio-agent').boundingBox()
  assert.ok(panel.width <= 390 && panel.width >= 340, 'On phones, the agent must use the full screen instead of squeezing beside the sidebar')
  const layout = await page.locator('.mio-agent-layout').evaluate(el => el.scrollWidth <= el.clientWidth)
  await page.screenshot({ path: 'test-results/marketing-agent-mobile.png', fullPage: true })
  assert.ok(layout, 'Agent panel must not overflow on mobile')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ chatRequests: chat.length, followUpHistory: true, periodRefresh: true, errorRecovery: true, reloadHistory: true, mobileOverflow: false, pageErrors: errors }))
} finally { await browser.close() }
