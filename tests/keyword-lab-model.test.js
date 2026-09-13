import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyColumnFilter,
  classifyQuality,
  effectiveDays,
  groupTermsByKeyword,
  normalizeDateRange,
  planMatchReplacement,
  recommendKeyword,
  sortRows,
  withPerDayMetrics,
} from '../lib/ads/keyword-lab.js'

test('normalizes presets and caps custom reporting ranges at 365 inclusive days', () => {
  assert.deepEqual(normalizeDateRange('LAST_7_DAYS', '2026-09-13'), {
    startDate: '2026-09-07',
    endDate: '2026-09-13',
  })
  assert.deepEqual(normalizeDateRange({ startDate: '2024-01-01', endDate: '2026-09-13' }), {
    startDate: '2025-09-14',
    endDate: '2026-09-13',
  })
  assert.throws(
    () => normalizeDateRange({ startDate: '2026-02-30', endDate: '2026-03-01' }),
    /valid ISO date/,
  )
  assert.throws(
    () => normalizeDateRange({ startDate: '2026-03-02', endDate: '2026-03-01' }),
    /on or before/,
  )
})

test('counts inclusive calendar days and starts experiment metrics on the later start date', () => {
  const range = { startDate: '2026-09-01', endDate: '2026-09-10' }
  assert.equal(effectiveDays(range), 10)
  assert.equal(effectiveDays(range, '2026-09-08'), 3)
  assert.equal(effectiveDays(range, '2026-09-20'), 0)
})

test('adds per-day metrics without turning unavailable Google metrics into zero', () => {
  assert.deepEqual(
    withPerDayMetrics({ impressions: 20, clicks: 5, cost: 12.5 }, 5),
    {
      impressions: 20,
      clicks: 5,
      cost: 12.5,
      impressionsPerDay: 4,
      clicksPerDay: 1,
      costPerDay: 2.5,
    },
  )
  assert.deepEqual(withPerDayMetrics({ impressions: null, clicks: 0 }, 0), {
    impressions: null,
    clicks: 0,
    impressionsPerDay: null,
    clicksPerDay: null,
    costPerDay: null,
  })
})

test('filters numeric columns with comparison, range, nonzero, and unavailable operators', () => {
  const rows = [{ metric: null }, { metric: 0 }, { metric: 3 }, { metric: 8 }, { metric: 12 }]
  assert.deepEqual(applyColumnFilter(rows, { column: 'metric', type: 'numeric', operator: '>', value: 3 }), rows.slice(3))
  assert.deepEqual(applyColumnFilter(rows, { column: 'metric', type: 'numeric', operator: 'between', value: 3, max: 8 }), rows.slice(2, 4))
  assert.deepEqual(applyColumnFilter(rows, { column: 'metric', type: 'numeric', operator: 'nonzero' }), [rows[2], rows[3], rows[4]])
  assert.deepEqual(applyColumnFilter(rows, { column: 'metric', type: 'numeric', operator: 'blank' }), [rows[0]])
})

test('combines text, categorical, and date column filters with AND', () => {
  const rows = [
    { keyword: 'Custody lawyer', status: 'ENABLED', started: '2026-09-01' },
    { keyword: 'Divorce attorney', status: 'PAUSED', started: '2026-09-08' },
    { keyword: 'Custody attorney', status: 'REMOVED', started: '2026-09-10' },
  ]
  const filters = [
    { column: 'keyword', type: 'text', operator: 'contains', value: 'attorney' },
    { column: 'status', type: 'categorical', values: ['PAUSED', 'ENABLED'] },
    { column: 'started', type: 'date', operator: 'between', value: '2026-09-02', max: '2026-09-09' },
  ]
  assert.deepEqual(applyColumnFilter(rows, filters), [rows[1]])
  assert.deepEqual(applyColumnFilter(rows, { column: 'keyword', type: 'text', operator: 'does_not_contain', value: 'custody' }), [rows[1]])
})

test('sorts a copied array stably and leaves unavailable values last in either direction', () => {
  const rows = [
    { id: 'a', cost: 2 },
    { id: 'b', cost: null },
    { id: 'c', cost: 2 },
    { id: 'd', cost: 7 },
  ]
  assert.deepEqual(sortRows(rows, { column: 'cost', direction: 'asc' }).map(row => row.id), ['a', 'c', 'd', 'b'])
  assert.deepEqual(sortRows(rows, { column: 'cost', direction: 'desc' }).map(row => row.id), ['d', 'a', 'c', 'b'])
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'c', 'd'])
})

test('calculates quality and waste only over explicitly classified outcomes and reports coverage', () => {
  const quality = classifyQuality([
    { clicks: 4, cost: 40, classification: 'relevant' },
    { clicks: 1, cost: 10, promoted: true },
    { clicks: 5, cost: 30, classification: 'irrelevant' },
    { clicks: 2, cost: 20, classification: 'observe' },
  ])
  assert.deepEqual(quality, {
    relevantClickRate: 5 / 12,
    relevantSpendRate: 0.5,
    wasteRate: 0.3,
    classifiedSpendCoverage: 1,
    classifiedClicks: 12,
    classifiedSpend: 100,
    totalSpend: 100,
  })
})

test('returns transparent recommendation labels with reasons from caller-owned thresholds', () => {
  const thresholds = { minimumImpressions: 100, highImpressionsPerDay: 10, lowCtr: 0.02, highWasteRate: 0.3, pauseWasteRate: 0.6, minimumPauseSpend: 100, scaleCtr: 0.05 }
  assert.deepEqual(recommendKeyword({ impressions: 20 }, thresholds), {
    label: 'Insufficient data',
    reasons: ['20 impressions is below the 100-impression minimum'],
  })
  assert.deepEqual(recommendKeyword({ impressions: 500, impressionsPerDay: 20, ctr: 0.01, wasteRate: 0.1 }, thresholds), {
    label: 'Keep but tighten',
    reasons: ['20 impressions/day is high', '1% CTR is below 2%'],
  })
  assert.equal(recommendKeyword({ impressions: 500, impressionsPerDay: 5, ctr: 0.06, conversions: 2, wasteRate: 0.1 }, thresholds).label, 'Keep / scale')
  assert.equal(recommendKeyword({ impressions: 500, impressionsPerDay: 5, ctr: 0.03, wasteRate: 0.4 }, thresholds).label, 'Add negative protection')
  assert.deepEqual(recommendKeyword({ impressions: 500, cost: 150, impressionsPerDay: 5, ctr: 0.01, conversions: undefined, wasteRate: 0.7 }, thresholds), {
    label: 'Pause candidate',
    reasons: ['70% waste rate is at or above 60%', '$150 spend meets the $100 review threshold'],
  })
  assert.deepEqual(recommendKeyword({ impressions: null, impressionsPerDay: 20, ctr: undefined }, thresholds), {
    label: 'Insufficient data',
    reasons: ['Impression data is unavailable'],
  })
  assert.deepEqual(recommendKeyword({ impressions: 500, impressionsPerDay: 20, ctr: null }, thresholds), {
    label: 'Test longer',
    reasons: ['CTR is unavailable'],
  })
  assert.equal(recommendKeyword({ impressions: 500, impressionsPerDay: 5, ctr: 0.06, conversions: null, wasteRate: undefined }, thresholds).label, 'Keep / scale')
})

test('groups search terms only by Google-supplied triggering criterion identity', () => {
  const rows = [
    { searchTerm: 'custody help', triggeringKeyword: 'custody lawyer', triggeringKeywordMatchType: 'PHRASE', triggeringCriterionId: '111' },
    { searchTerm: 'child custody', triggeringKeyword: 'custody lawyer', triggeringKeywordMatchType: 'PHRASE', triggeringCriterionId: '111' },
    { searchTerm: 'custody lawyer near me', triggeringKeyword: 'custody lawyer', triggeringKeywordMatchType: 'PHRASE' },
    { searchTerm: 'another unmatched row', triggeringKeyword: 'custody lawyer', triggeringKeywordMatchType: 'PHRASE' },
  ]
  const result = groupTermsByKeyword(rows)
  assert.deepEqual(result.groups, [{
    criterionId: '111',
    keyword: 'custody lawyer',
    matchType: 'PHRASE',
    terms: rows.slice(0, 2),
  }])
  assert.deepEqual(result.unlinked, rows.slice(2))
  assert.equal(result.unlinked[0].triggeringCriterionId, undefined)
})

test('plans create and read-back verification before pausing the old match criterion', () => {
  const plan = planMatchReplacement({
    criterionId: '111',
    campaignId: '12',
    adGroupId: '34',
    keyword: 'custody lawyer',
    matchType: 'BROAD',
  }, 'PHRASE')
  assert.deepEqual(plan.steps.map(step => step.operation), ['validate', 'create', 'read_back', 'pause'])
  assert.equal(plan.steps[3].after, 'verify_replacement')
  assert.equal(plan.autoRetry, false)
  assert.equal(plan.onCreateVerificationFailure, 'leave_original_unchanged')
  assert.equal(plan.onPauseUncertain, 'mark_unverified')
  assert.throws(() => planMatchReplacement({ criterionId: '111', keyword: 'test', matchType: 'EXACT' }, 'EXACT'), /different match type/)
})
