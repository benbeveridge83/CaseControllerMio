import test from 'node:test'
import assert from 'node:assert/strict'
import { applyGoogleAdsRemovedConversionGuards } from '../mio-v315-google-ads-removed-conversions.js'

const source = `
function buildGoogleAdsAudit(report = {}) {
  const conversions = Array.isArray(report?.conversionActions) ? report.conversionActions : []
}
function buildGoogleAdsOptimizationSuggestions(report = {}) {
  const conversions = Array.isArray(report?.conversionActions) ? report.conversionActions : []
}
function diagnoseGoogleAdsBottleneck(report = {}) {
  const inactivePrimary = (report?.conversionActions || []).filter((row) => row.primaryForGoal && String(row.status || '').toUpperCase() !== 'ENABLED')
}
const controls = <div>{authorizeButton(row.primaryForGoal ? 'Make secondary' : 'Make primary', { type: 'conversion_primary' })}{String(row.status).toUpperCase() !== 'REMOVED' && authorizeButton('Hide', { type: 'conversion_status' })}</div>
`

test('removed conversion actions are excluded from Google Ads recommendations and diagnostics', () => {
  const transformed = applyGoogleAdsRemovedConversionGuards(source)
  assert.equal(
    transformed.match(/const conversions = Array\.isArray\(report\?\.conversionActions\) \? report\.conversionActions\.filter\(\(row\) => String\(row\?\.status \|\| ''\)\.toUpperCase\(\) !== 'REMOVED'\) : \[\]/g)?.length,
    2
  )
  assert.match(transformed, /row\.primaryForGoal && String\(row\.status \|\| ''\)\.toUpperCase\(\) !== 'REMOVED' && String\(row\.status \|\| ''\)\.toUpperCase\(\) !== 'ENABLED'/)
})

test('removed conversion actions stay visible but do not receive mutation controls', () => {
  const transformed = applyGoogleAdsRemovedConversionGuards(source)
  assert.match(transformed, /String\(row\.status\)\.toUpperCase\(\) !== 'REMOVED' && authorizeButton\(row\.primaryForGoal \? 'Make secondary' : 'Make primary'/)
  assert.match(transformed, /String\(row\.status\)\.toUpperCase\(\) !== 'REMOVED' && authorizeButton\('Hide'/)
})

test('the Google Ads removed-conversion guard is idempotent', () => {
  const once = applyGoogleAdsRemovedConversionGuards(source)
  const twice = applyGoogleAdsRemovedConversionGuards(once)
  assert.equal(twice, once)
})
