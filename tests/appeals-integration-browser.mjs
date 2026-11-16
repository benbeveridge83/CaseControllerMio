import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// Tests the built application, with synthetic auth and all external traffic
// intercepted. This never logs in to or writes to the real Supabase project.
const base = process.env.APPEALS_INTEGRATION_URL || 'http://127.0.0.1:4174'
const browser = await chromium.launch({ headless: true, executablePath: process.env.APPEALS_CHROME_PATH || undefined, args: ['--no-sandbox'] })
fs.mkdirSync('test-results', { recursive: true })

async function openAs(email, pageAccess = []) {
  const context = await browser.newContext({ viewport: { width: 1536, height: 1100 } })
  const page = await context.newPage()
  const errors = []
  const id = email.startsWith('staff') ? '00000000-0000-4000-8000-000000002901' : '00000000-0000-4000-8000-000000002902'
  const exp = Math.floor(Date.now() / 1000) + 3600
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const user = { id, email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: new Date().toISOString() }
  const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp, aud: 'authenticated' })}.synthetic`, refresh_token: 'synthetic-test-only', expires_at: exp, expires_in: 3600, token_type: 'bearer', user }
  const states = new Map()
  page.on('pageerror', error => errors.push(error.message))
  await context.routeWebSocket(url => !['127.0.0.1', 'localhost'].includes(url.hostname), socket => socket.close())
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return url.pathname.startsWith('/api/') ? respond({ connected: false, data: [] }) : route.continue()
    if (!url.hostname.endsWith('.supabase.co')) return respond({})
    if (url.pathname.includes('/auth/v1/')) return respond(url.pathname.endsWith('/user') ? user : session)
    const table = url.pathname.split('/').pop()
    if (table === 'team_members') {
      const member = { id: 'appeals-synthetic-member', email, first_name: 'Appeals', last_name: 'Test', is_active: true, page_access: pageAccess }
      return respond(request.headers().accept?.includes('vnd.pgrst.object') ? member : [member])
    }
    if (table === 'mio_cloud_state_read_chunks_v297') return respond([])
    if (table === 'mio_cloud_state_write_v277') {
      const data = request.postDataJSON()
      const row = { key: data.p_key, raw_value: data.p_raw, updated_at: new Date().toISOString() }
      if (data.p_delete) states.delete(data.p_key); else states.set(data.p_key, row)
      return respond(row)
    }
    if (table === 'case_mio_user_state') return respond(request.method() === 'GET' ? [...states.values()] : [])
    return respond(request.headers().accept?.includes('vnd.pgrst.object') ? null : [])
  })
  await context.addInitScript(({ session }) => { localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token', JSON.stringify(session)) }, { session })
  await page.goto(`${base}/#dfps_appeals`, { waitUntil: 'domcontentloaded' })
  return { context, page, errors }
}

try {
  const staff = await openAs('staff-appeals-test@beveridgelawfirm.com')
  await staff.page.getByRole('heading', { name: 'DFPS / CPS Appeals', exact: true }).waitFor({ timeout: 60000 })
  assert.ok(await staff.page.locator('aside a[href="#dfps_appeals"]').isVisible(), 'staff sees the left-hand tab')
  assert.equal(await staff.page.locator('.appeals-section-card').count(), 16)
  await staff.page.screenshot({ path: 'test-results/appeals-in-mio.png', fullPage: true })
  await staff.page.screenshot({ path: 'test-results/dfps-cps-appeals-preview.png' })
  await staff.page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await staff.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'actual Mio shell fits a phone')
  await staff.page.getByLabel('Section', { exact: true }).selectOption('findings')
  await staff.page.locator('.appeals-issue-open').first().click()
  await staff.page.getByRole('heading', { name: 'Governing rule', exact: true }).waitFor()
  const sidebarBox = await staff.page.locator('aside').boundingBox()
  const mainBox = await staff.page.locator('main').boundingBox()
  assert.ok(mainBox.y >= sidebarBox.y + sidebarBox.height - 1, 'mobile sidebar is above main content')
  assert.ok(mainBox.width >= 380, 'mobile resource receives the phone width')
  assert.ok(await staff.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'actual Mio detail fits a phone')
  await staff.page.screenshot({ path: 'test-results/appeals-in-mio-mobile.png', fullPage: true })
  await staff.page.emulateMedia({ media: 'print' })
  assert.equal(await staff.page.locator('aside').isVisible(), false, 'actual app sidebar is hidden in print')
  assert.ok(await staff.page.getByRole('heading', { name: 'Governing rule', exact: true }).isVisible())
  await staff.page.emulateMedia({ media: 'screen' })
  await staff.page.locator('aside a[href="#dfps_appeals"]').click()
  await staff.page.getByRole('heading', { name: 'Work through the appeal, one question at a time.', exact: true }).waitFor({ timeout: 5000 })
  // A visible link must also receive a real tap beneath the fixed Mio controls.
  await staff.page.locator('aside a[href="#team"]').click({ timeout: 5000 })
  await staff.page.locator('.mio-appeals').waitFor({ state: 'detached', timeout: 5000 })
  assert.equal(await staff.page.evaluate(() => location.hash), '#team', 'mobile navigation leaves the appeals resource')
  assert.equal(await staff.page.evaluate(() => document.body.classList.contains('mio-appeals-active')), false, 'appeals styling is removed after leaving the route')
  assert.deepEqual(staff.errors, [])
  await staff.context.close()

  const outside = await openAs('outside-appeals-test@example.invalid', ['dfps_appeals'])
  await outside.page.getByText('Logged in as: outside-appeals-test@example.invalid', { exact: true }).waitFor({ timeout: 60000 })
  assert.equal(await outside.page.locator('aside a[href="#dfps_appeals"]').count(), 0)
  assert.equal(await outside.page.locator('.mio-appeals').count(), 0, 'direct hash does not expose staff resource to an outside account')
  assert.deepEqual(outside.errors, [])
  await outside.context.close()
  console.log(JSON.stringify({ status: 'passed', verified: ['built app lazy route', 'staff sidebar tab', 'actual mobile shell', 'mobile first-link navigation', 'route styling cleanup', 'staff-only direct URL guard'], realExternalWrites: 0 }))
} finally { await browser.close() }
