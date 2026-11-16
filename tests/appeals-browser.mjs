import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { APPEAL_ISSUES, APPEAL_SECTIONS } from '../src/appeals/appealsCatalog.js'

// Local fixture only. External network requests are blocked; no client data.
const base = process.env.APPEALS_TEST_URL || 'http://127.0.0.1:4173'
const executablePath = process.env.APPEALS_CHROME_PATH || undefined
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1060 } })
const errors = []
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
await context.routeWebSocket(url => !['127.0.0.1', 'localhost'].includes(url.hostname), socket => socket.close())
fs.mkdirSync('test-results', { recursive: true })

try {
  await page.goto(`${base}/tests/fixtures/appeals/index.html`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'DFPS / CPS Appeals', exact: true }).waitFor()
  assert.equal(await page.locator('.appeals-section-card').count(), APPEAL_SECTIONS.length)
  await page.screenshot({ path: 'test-results/appeals-overview.png', fullPage: true })
  await page.locator('.appeals-version-guide summary').click()
  assert.ok(await page.getByText('H.B. 116, §§2–4').isVisible())
  await page.locator('.appeals-version-guide summary').click()

  const chosen = APPEAL_ISSUES.find(issue => issue.category === 'counsel' && issue.authorities.some(source => source.label.includes('J.D.H.')))
  assert.ok(chosen, 'new out-of-time appeal authority is present')
  await page.getByLabel('Search issues and authorities').fill('J.D.H.')
  await page.locator('.appeals-issue-open').filter({ hasText: chosen.title }).click()
  await page.getByRole('heading', { name: chosen.title, exact: true }).waitFor()
  const otherIssue = APPEAL_ISSUES.find(issue => issue.category === 'findings')
  await page.evaluate(id => { location.hash = `dfps_appeals?issue=${id}` }, otherIssue.id)
  await page.getByRole('heading', { name: otherIssue.title, exact: true }).waitFor({ timeout: 5000 })
  await page.evaluate(() => { location.hash = 'dfps_appeals' })
  await page.getByRole('heading', { name: 'Work through the appeal, one question at a time.', exact: true }).waitFor({ timeout: 5000 })
  await page.getByLabel('Search issues and authorities').fill('J.D.H.')
  await page.locator('.appeals-issue-open').filter({ hasText: chosen.title }).click()
  for (const name of ['Governing rule', 'Develop the issue', 'Defend the judgment', 'Preservation', 'Standard of review', 'Record to check', 'Potential relief', 'Supporting authorities']) assert.ok(await page.getByRole('heading', { name, exact: true }).isVisible(), name)
  assert.ok((await page.locator('.appeals-source a').count()) > 0)
  await page.getByRole('button', { name: 'Appellant', exact: true }).click()
  assert.equal(await page.getByRole('heading', { name: 'Defend the judgment', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Appellee', exact: true }).click()
  assert.equal(await page.getByRole('heading', { name: 'Develop the issue', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Both sides', exact: true }).click()
  await page.getByRole('button', { name: '☆ Save issue', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '★ Saved', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.reload({ waitUntil: 'networkidle' })
  assert.ok(await page.getByRole('heading', { name: chosen.title, exact: true }).isVisible(), 'direct issue link survives reload')
  assert.equal(await page.getByRole('button', { name: '★ Saved', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.screenshot({ path: 'test-results/appeals-issue.png', fullPage: true })

  await page.emulateMedia({ media: 'print' })
  assert.equal(await page.locator('.appeals-tree').isVisible(), false)
  assert.ok(await page.getByRole('heading', { name: chosen.title, exact: true }).isVisible())
  await page.pdf({ path: 'test-results/appeals-issue-print.pdf', format: 'Letter', margin: { top: '18mm', right: '18mm', bottom: '18mm', left: '18mm' } })
  await page.emulateMedia({ media: 'screen' })

  await page.goto(`${base}/tests/fixtures/appeals/index.html?user=another-user#dfps_appeals?issue=${chosen.id}`, { waitUntil: 'networkidle' })
  assert.equal(await page.getByRole('button', { name: '☆ Save issue', exact: true }).getAttribute('aria-pressed'), 'false', 'bookmarks are scoped per account')
  await page.getByRole('button', { name: '← Back to issues', exact: true }).click()
  await page.getByLabel('Search issues and authorities').fill('no-such-appeal-xyz-987654')
  assert.ok(await page.getByRole('heading', { name: 'No issues match these filters.' }).isVisible())

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Browse all sections', exact: true }).click()
  await page.getByLabel('Section', { exact: true }).selectOption('findings')
  const first = APPEAL_ISSUES.find(issue => issue.category === 'findings')
  await page.locator('.appeals-issue-open').filter({ hasText: first.title }).click()
  await page.getByRole('heading', { name: first.title, exact: true }).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile page has no horizontal overflow')
  await page.screenshot({ path: 'test-results/appeals-mobile.png', fullPage: true })
  await page.getByRole('button', { name: '★ Saved (0)', exact: true }).click()
  assert.ok(await page.getByRole('heading', { name: 'Saved issues', exact: true }).isVisible())
  assert.ok(await page.getByRole('heading', { name: 'No issues match these filters.' }).isVisible())
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ status: 'passed', issueCount: APPEAL_ISSUES.length, sectionCount: APPEAL_SECTIONS.length, verified: ['section navigation', 'full-content and authority search', 'version guidance', 'both perspectives', 'account-scoped saved issues', 'reload and direct link', 'same-tab hash navigation', 'print layout', 'empty search', 'mobile layout and saved view'], browserErrors: errors }))
} finally { await browser.close() }
