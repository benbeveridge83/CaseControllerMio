// Dry-run report for the legacy Bulk Billing reconciliation (V323).
//
// Synthetic fixtures only. This script reads one JSON fixture, plans the links and prints what it
// would do: it writes nothing, posts nothing, modifies no record and touches no production data.
// Run it with a different path only if that file is itself synthetic.
//
//   node scripts/lawpay-legacy-reconciliation-dry-run.mjs [fixture.json]

import fs from 'node:fs'
import { legacyReconciliationPlan, applyLegacyReconciliation } from '../src/mioLawPayLegacyReconciliation.js'

const fixturePath = process.argv[2] || new URL('../tests/fixtures/lawpay-legacy-reconciliation-synthetic.json', import.meta.url)
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const plan = legacyReconciliationPlan(fixture)
const dryRun = await applyLegacyReconciliation({ plan })

console.log(dryRun.report)
console.log('')
console.log(JSON.stringify(plan.summary))
console.log('Dry run only: no link was written, no ledger row was posted and no record was modified.')
