// Smoke check for the synthetic preview build: it must render, be signed in as the synthetic
// administrator, and answer the classification gateway from memory.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'

const root = path.resolve('dist-preview'), port = 4190
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname)
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html')
  res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html')
  res.end(fs.readFileSync(target))
})
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${port}`
const errors = []
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } })
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(`${origin}/#billing`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).waitFor({ timeout: 60000 })
  assert.equal(await page.evaluate(() => window.__mioSyntheticPreviewInstalled === true), true, 'the synthetic service must be installed')
  assert.equal(await page.evaluate(() => /preview\.admin|signed in/i.test(document.body.innerText)), true, 'the preview signs in as its own administrator')
  const review = await page.evaluate(async () => {
    const response = await fetch('https://synthetic-preview.invalid/functions/v1/lawpay-gateway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'review' }) })
    return response.json()
  })
  assert.equal(review.ok, true)
  assert.equal(review.transactions.length, 5, 'the synthetic transactions must be served')
  const live = await page.evaluate(async () => (await fetch('https://vnnkxqpyndidnjbrbywz.supabase.co/rest/v1/matters')).status)
  assert.equal(live, 403, 'the preview must refuse to talk to a live project')
  await page.getByRole('button', { name: 'Bulk Billing', exact: true }).click()
  const link = page.locator('a').filter({ hasText: /^Alpha (Synthetic|Matter)/ }).first()
  await link.waitFor({ timeout: 60000 })
  const opened = context.waitForEvent('page', { timeout: 20000 }).catch(() => null)
  await link.click()
  const dashboard = (await opened) || page
  await dashboard.getByTestId('lawpay-classification-summary').waitFor({ timeout: 60000 })
  const summary = await dashboard.getByTestId('lawpay-classification-summary').innerText()
  assert.match(summary, /5 payment\(s\) need a decision/)
  assert.match(await dashboard.getByTestId('lawpay-account-provider-d').innerText(), /Account not reported/)
  await dashboard.screenshot({ path: 'finance-test-results/preview-synthetic.png' })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, synthetic_service: true, transactions: review.transactions.length, live_project_refused: live, summary }, null, 2))
} catch (error) {
  try { fs.writeFileSync('finance-test-results/preview-failure.txt', await page.locator('body').innerText()) } catch { /* page gone */ }
  console.error({ errors, text: (await page.locator('body').innerText().catch(() => '')).slice(0, 1200) })
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
