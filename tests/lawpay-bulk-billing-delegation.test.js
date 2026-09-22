// The Bulk Billing control must record every decision through the shared LawPay classification
// workflow: one immutable provider transaction has one posting, an operating or unresolved account
// is saved and never posted, and Bulk Billing keeps no trust ledger and no posting state of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import config from '../vite.config.js'

let source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
for (const plugin of config.plugins.flat(Infinity)) {
  const handler = typeof plugin.transform === 'function' ? plugin.transform : plugin.transform?.handler
  if (handler) {
    const result = await handler.call({}, source, '/repo/src/App.jsx')
    source = typeof result === 'string' ? result : result?.code || source
  }
  if (plugin.name === 'mio-v323-lawpay-classification') break
}
function fn(name) {
  const match = new RegExp(' {2}(?:async )?function ' + name + '\\(').exec(source)
  assert.ok(match, `missing ${name}`)
  const start = match.index
  const next = /\n {2}(?:async )?function /.exec(source.slice(start + match[0].length))
  return source.slice(start, next ? start + match[0].length + next.index : undefined)
}

test('bulk billing records through the shared gateway and posts only a verified trust deposit', () => {
  const save = fn('saveLawPayAttribution')
  assert.match(save, /supabase\.functions\.invoke\('lawpay-gateway'/, 'the decision must go through the shared gateway')
  assert.match(save, /action:attributedSharesLedger\?'post':'save'/, 'only a decision that shares the ledger may post')
  assert.match(save, /const attributedSharesLedger=attributedDecisionMatter&&!attributedUnresolvedAccount&&attributedAccountKey\.includes\('trust'\)/, 'an unresolved or non-trust account can never share the ledger')
  assert.match(save, /if\(attributedError\)throw new Error/, 'a gateway that cannot be reached must not be treated as recorded')
  assert.match(save, /if\(attributedResult\?\.error\)throw new Error/, 'a refusal from the gateway must be surfaced, never swallowed')
  assert.match(save, /await loadLawPayClassification\(\)/, 'the shared classification state must be refreshed after every decision')
  assert.doesNotMatch(save, /amount_cents:/, 'the caller never dictates the posted amount')
})

test('an unresolved deposit account is saved for review and can never post', () => {
  const save = fn('saveLawPayAttribution')
  assert.match(save, /const attributedUnresolvedAccount=!result\.ok/, 'the unresolved-account refusal is recognised')
  assert.match(save, /attributedDecisionMatter\?\(attributedUnresolvedAccount\|\|attributedAccountKey\.includes\('trust'\)\?'trust_deposit':'consultation_payment'\):'other'/, 'the recorded category follows the decision and the reported account, never an assumption about trust')
  assert.match(save, /if\(!result\.ok&&!\/Account not reported\/\.test\(String\(result\.error\|\|''\)\)\)\{setLawPayAttributionEditor/, 'only the unresolved-account refusal may continue; every other legacy refusal still stops the decision')
  assert.match(save, /saved for review/, 'the outcome must be stated plainly to the reviewer')
  assert.match(save, /account_source:attributedAccountKey\?'reported_by_lawpay':''/, 'an unresolved account must never claim a reported provenance')
})

test('bulk billing keeps no trust ledger of its own', () => {
  const save = fn('saveLawPayAttribution')
  assert.doesNotMatch(save, /duplicateLawPayAttribution\(latestTrust,transaction\)/, 'the legacy duplicate check and its ledger write are gone')
  assert.doesNotMatch(save, /const nextTrust=\[result\.entry,/, 'the new path never builds a client trust row to prepend')
  assert.equal((save.match(/\('caseMioTrustTransactions'/g) || []).length, 1, 'the only remaining reference is the defensive rollback of a legacy-era entry')
  assert.match(save, /const nextRecords=result\.record\?\[result\.record,/, 'a decision without a legacy record still completes instead of failing')
  assert.match(save, /if\(result\.record&&!verifiedRecords\.some/, 'the legacy verification only runs when there is a legacy record to verify')
})
