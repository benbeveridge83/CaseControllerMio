import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/MioGoogleAdsSearchTermStatus.jsx', import.meta.url), 'utf8')

test('status cell rendering is idempotent so the MutationObserver does not react to its own unchanged render', () => {
  assert.match(source, /mioStatusSignature/)
  assert.match(source, /if \(cell\.dataset\.mioStatusSignature === signature\) return/)
  assert.match(source, /cell\.dataset\.mioStatusSignature = signature/)
})
