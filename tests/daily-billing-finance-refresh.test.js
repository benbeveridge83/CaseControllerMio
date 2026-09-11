import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const transform = fs.readFileSync('mio-v313-pnc-daily-trust.js', 'utf8')

test('opening Daily Billing refreshes finance records before coverage is trusted', () => {
  assert.match(transform, /showDailyBillingWindow[\s\S]*loadMioCloudStateFromSupabase\(session\.user\.id\)[\s\S]*loadLawPayWorkspace\(\{\s*force:\s*true\s*\}\)[\s\S]*loadMioInvoicesFromDatabase\(\{\s*force:\s*true\s*\}\)/)
  assert.match(transform, /dailyCoverageFinanceReady/)
})
