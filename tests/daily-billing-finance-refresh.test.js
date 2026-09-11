import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const transform = fs.readFileSync('mio-v313-pnc-daily-trust.js', 'utf8')
const card = fs.readFileSync('src/MioDailyTrust.jsx', 'utf8')

test('opening Daily Billing refreshes finance records before coverage is trusted', () => {
  assert.match(transform, /refreshDailyCoverageFinanceState/)
  assert.match(transform, /caseMioFinanceOpeningBalances/)
  assert.match(transform, /caseMioTrustTransactions/)
  assert.match(transform, /showDailyBillingWindow[\s\S]*loadLawPayWorkspace\(\{\s*force:\s*true\s*\}\)[\s\S]*loadMioInvoicesFromDatabase\(\{\s*force:\s*true\s*\}\)/)
  assert.match(transform, /dailyCoverageFinanceReady/)
  assert.match(transform, /<MioDailyTrust summary=\{coverage\} date=\{dailyBillingDate\} loading=\{!dailyCoverageFinanceReady/)
  assert.match(card, /Refreshing current trust balances/)
})
