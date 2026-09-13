import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { createWorkspaceService } from '../lib/ads/service.js'
import { handleAdsWorkspace } from '../lib/ads/http.js'

function serviceFixture({ query, experiments = [] } = {}) {
  const calls = []
  const service = createWorkspaceService({
    accountId: '123',
    account: { id: '123', timeZone: 'America/Chicago' },
    actor: { id: 'user-1', email: 'ben@beveridgelawfirm.com' },
    canWrite: true,
    query: async statement => {
      calls.push(statement)
      return query ? query(statement) : []
    },
    db: {
      keywordExperiments: async () => experiments,
    },
  })
  return { service, calls }
}

const keywordRow = {
  campaign: { id: '12', name: 'Custody' },
  adGroup: { id: '34', name: 'Custody lawyers' },
  adGroupCriterion: {
    criterionId: '56',
    resourceName: 'customers/123/adGroupCriteria/34~56',
    status: 'ENABLED',
    keyword: { text: 'custody lawyer', matchType: 'PHRASE' },
  },
  metrics: {
    impressions: '70',
    clicks: '14',
    costMicros: '35000000',
    conversions: 2,
  },
}

test('keywordLabSnapshot returns date-scoped metrics and Google-supplied search-term linkage', async () => {
  const optionalRow = {
    ...keywordRow,
    metrics: {
      searchImpressionShare: 0.42,
      searchRankLostImpressionShare: 0.31,
      searchBudgetLostImpressionShare: null,
      topImpressionPercentage: 0.68,
      absoluteTopImpressionPercentage: 0.24,
    },
  }
  const termRow = {
    campaign: keywordRow.campaign,
    adGroup: keywordRow.adGroup,
    searchTermView: { searchTerm: 'child custody help' },
    segments: {
      searchTermMatchType: 'NEAR_PHRASE',
      keyword: {
        adGroupCriterion: 'customers/123/adGroupCriteria/34~56',
        info: { text: 'custody lawyer', matchType: 'PHRASE' },
      },
      device: 'MOBILE',
    },
    metrics: { impressions: 10, clicks: 3, costMicros: 7500000, conversions: 1 },
  }
  const { service, calls } = serviceFixture({
    query: statement => {
      if (statement.includes('FROM search_term_view')) return [termRow]
      if (statement.includes('FROM ad_group_criterion')) return [keywordRow]
      if (statement.includes('metrics.search_impression_share')) return [optionalRow]
      if (statement.includes('FROM keyword_view')) return [keywordRow]
      return []
    },
  })

  const result = await service.keywordLabSnapshot({
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    campaignId: '12',
    adGroupId: '34',
  })

  assert.deepEqual(result.range, {
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    days: 7,
    timeZone: 'America/Chicago',
  })
  assert.deepEqual(result.keywords[0], {
    campaignId: '12',
    campaignName: 'Custody',
    adGroupId: '34',
    adGroupName: 'Custody lawyers',
    criterionId: '56',
    criterionResourceName: 'customers/123/adGroupCriteria/34~56',
    keyword: 'custody lawyer',
    matchType: 'PHRASE',
    status: 'ENABLED',
    impressions: 70,
    clicks: 14,
    cost: 35,
    conversions: 2,
    ctr: 0.2,
    averageCpc: 2.5,
    conversionRate: 2 / 14,
    costPerConversion: 17.5,
    searchImpressionShare: 0.42,
    searchRankLostImpressionShare: 0.31,
    searchBudgetLostImpressionShare: null,
    topImpressionRate: 0.68,
    absoluteTopImpressionRate: 0.24,
    impressionsPerDay: 10,
    clicksPerDay: 2,
    costPerDay: 5,
    searchTermCount: 1,
  })
  assert.equal(result.searchTerms[0].triggeringKeywordResourceName, 'customers/123/adGroupCriteria/34~56')
  assert.equal(result.searchTerms[0].triggeringCriterionId, '56')
  assert.equal(result.searchTerms[0].triggeringKeyword, 'custody lawyer')
  assert.equal(result.termGroups.groups[0].criterionId, 'customers/123/adGroupCriteria/34~56')
  assert.equal(result.liveActionsEnabled, true)
  const inventoryQuery = calls.find(statement => statement.includes('FROM ad_group_criterion'))
  assert.ok(inventoryQuery)
  assert.doesNotMatch(inventoryQuery, /segments\.date/)
  assert.ok(calls.filter(statement => !statement.includes('FROM ad_group_criterion')).every(statement => statement.includes("segments.date BETWEEN '2026-09-01' AND '2026-09-07'")))
  assert.ok(calls.every(statement => statement.includes('campaign.id = 12') && statement.includes('ad_group.id = 34')))
})

test('keywordLabSnapshot keeps core rows when optional metrics fail and disables live actions when inventory fails', async () => {
  const optionalFailure = serviceFixture({
    query: statement => {
      if (statement.includes('FROM ad_group_criterion')) return [keywordRow]
      if (statement.includes('metrics.search_impression_share')) throw new Error('Optional field unsupported')
      if (statement.includes('FROM keyword_view')) return [keywordRow]
      return []
    },
  })
  const partial = await optionalFailure.service.keywordLabSnapshot({ dateRange: 'LAST_7_DAYS', today: '2026-09-13' })
  assert.equal(partial.keywords.length, 1)
  assert.equal(partial.keywords[0].searchImpressionShare, null)
  assert.equal(partial.liveActionsEnabled, true)
  assert.match(partial.warnings[0].message, /unsupported/)

  const inventoryFailure = serviceFixture({
    query: statement => {
      if (statement.includes('FROM ad_group_criterion')) throw new Error('Inventory unavailable')
      return []
    },
  })
  const unavailable = await inventoryFailure.service.keywordLabSnapshot({ dateRange: 'LAST_7_DAYS', today: '2026-09-13' })
  assert.equal(unavailable.inventoryComplete, false)
  assert.equal(unavailable.liveActionsEnabled, false)
  assert.deepEqual(unavailable.keywords, [])
})

test('keywordLabSnapshot retains active and paused inventory rows with supported zero reporting totals', async () => {
  const paused = {
    ...keywordRow,
    adGroupCriterion: {
      ...keywordRow.adGroupCriterion,
      criterionId: '57',
      resourceName: 'customers/123/adGroupCriteria/34~57',
      status: 'PAUSED',
      keyword: { text: 'custody attorney', matchType: 'EXACT' },
    },
  }
  const { service } = serviceFixture({
    query: statement => {
      if (statement.includes('FROM ad_group_criterion')) return [keywordRow, paused]
      if (statement.includes('metrics.search_impression_share')) return []
      if (statement.includes('FROM keyword_view')) return [keywordRow]
      return []
    },
  })

  const result = await service.keywordLabSnapshot({ startDate: '2026-09-01', endDate: '2026-09-07' })

  assert.equal(result.keywords.length, 2)
  assert.deepEqual(result.keywords[1], {
    campaignId: '12',
    campaignName: 'Custody',
    adGroupId: '34',
    adGroupName: 'Custody lawyers',
    criterionId: '57',
    criterionResourceName: 'customers/123/adGroupCriteria/34~57',
    keyword: 'custody attorney',
    matchType: 'EXACT',
    status: 'PAUSED',
    impressions: 0,
    clicks: 0,
    cost: 0,
    conversions: 0,
    ctr: 0,
    averageCpc: 0,
    conversionRate: 0,
    costPerConversion: 0,
    searchImpressionShare: null,
    searchRankLostImpressionShare: null,
    searchBudgetLostImpressionShare: null,
    topImpressionRate: null,
    absoluteTopImpressionRate: null,
    impressionsPerDay: 0,
    clicksPerDay: 0,
    costPerDay: 0,
    searchTermCount: 0,
  })
})

test('keyword and search-term row caps change completeness and keyword truncation disables live actions', async () => {
  const keywordCap = serviceFixture({
    query: statement => statement.includes('FROM ad_group_criterion') ? Array(10000).fill(keywordRow) : [],
  })
  const keywords = await keywordCap.service.keywordLabSnapshot({ startDate: '2026-09-01', endDate: '2026-09-07' })
  assert.equal(keywords.inventoryComplete, false)
  assert.equal(keywords.coverageComplete, false)
  assert.equal(keywords.liveActionsEnabled, false)
  assert.match(keywords.warnings[0].message, /10,000-row/)

  const termRow = {
    campaign: keywordRow.campaign,
    adGroup: keywordRow.adGroup,
    searchTermView: { searchTerm: 'custody help' },
    segments: { keyword: { adGroupCriterion: 'customers/123/adGroupCriteria/34~56', info: {} } },
    metrics: { impressions: 1, clicks: 0, costMicros: 0, conversions: 0 },
  }
  const termCap = serviceFixture({
    query: statement => {
      if (statement.includes('FROM ad_group_criterion')) return [keywordRow]
      if (statement.includes('FROM search_term_view')) return Array(10000).fill(termRow)
      if (statement.includes('metrics.search_impression_share')) return []
      if (statement.includes('FROM keyword_view')) return [keywordRow]
      return []
    },
  })
  const terms = await termCap.service.keywordLabSnapshot({ startDate: '2026-09-01', endDate: '2026-09-07' })
  assert.equal(terms.inventoryComplete, true)
  assert.equal(terms.coverageComplete, false)
  assert.equal(terms.liveActionsEnabled, true)
  assert.match(terms.warnings.find(warning => warning.section === 'search terms').message, /10,000-row/)
})

test('keywordLabSnapshot validates and caps custom dates using inclusive calendar days', async () => {
  const { service } = serviceFixture()
  await assert.rejects(
    service.keywordLabSnapshot({ startDate: '2026-02-30', endDate: '2026-03-01' }),
    /valid ISO date/,
  )
  const result = await service.keywordLabSnapshot({ startDate: '2024-01-01', endDate: '2026-09-13' })
  assert.deepEqual(result.range, {
    startDate: '2025-09-14',
    endDate: '2026-09-13',
    days: 365,
    timeZone: 'America/Chicago',
  })
})

test('keywordExperiments reports active metrics only from the effective experiment start', async () => {
  const experiments = [
    {
      id: 'experiment-active',
      account_id: '123',
      campaign_id: '12',
      campaign_name: 'Custody',
      ad_group_id: '34',
      ad_group_name: 'Custody lawyers',
      criterion_id: '56',
      criterion_resource_name: 'customers/123/adGroupCriteria/34~56',
      keyword: 'custody lawyer',
      match_type: 'PHRASE',
      source: 'manual',
      hypothesis: 'More relevant custody clicks',
      experiment_started_at: '2026-09-08T05:00:00.000Z',
      approved_by: 'approver-1',
      state: 'active',
    },
    {
      id: 'experiment-proposed',
      account_id: '123',
      campaign_id: '12',
      campaign_name: 'Custody',
      ad_group_id: '34',
      ad_group_name: 'Custody lawyers',
      criterion_id: null,
      criterion_resource_name: null,
      keyword: 'family custody attorney',
      match_type: 'EXACT',
      source: 'planner',
      hypothesis: null,
      experiment_started_at: null,
      approved_by: null,
      state: 'proposed',
    },
  ]
  const daily = [
    { ...keywordRow, segments: { date: '2026-09-07' }, metrics: { impressions: 100, clicks: 50, costMicros: 90000000, conversions: 8 } },
    { ...keywordRow, segments: { date: '2026-09-08' }, metrics: { impressions: 10, clicks: 2, costMicros: 3000000, conversions: 0 } },
    { ...keywordRow, segments: { date: '2026-09-09' }, metrics: { impressions: 20, clicks: 3, costMicros: 5000000, conversions: 1 } },
    { ...keywordRow, segments: { date: '2026-09-10' }, metrics: { impressions: 30, clicks: 5, costMicros: 7000000, conversions: 1 } },
  ]
  const { service, calls } = serviceFixture({
    experiments,
    query: statement => statement.includes('FROM keyword_view') ? daily : [],
  })

  const result = await service.keywordExperiments({ startDate: '2026-09-01', endDate: '2026-09-10', campaignId: '12' })

  assert.equal(result.experiments.length, 2)
  assert.deepEqual(result.experiments[0], {
    id: 'experiment-active',
    campaignId: '12',
    campaignName: 'Custody',
    adGroupId: '34',
    adGroupName: 'Custody lawyers',
    criterionId: '56',
    criterionResourceName: 'customers/123/adGroupCriteria/34~56',
    keyword: 'custody lawyer',
    matchType: 'PHRASE',
    source: 'manual',
    hypothesis: 'More relevant custody clicks',
    experimentStartedAt: '2026-09-08T05:00:00.000Z',
    approvedBy: 'approver-1',
    state: 'active',
    effectiveStartDate: '2026-09-08',
    days: 3,
    impressions: 60,
    clicks: 10,
    cost: 15,
    conversions: 2,
    ctr: 1 / 6,
    averageCpc: 1.5,
    conversionRate: 0.2,
    costPerConversion: 7.5,
    impressionsPerDay: 20,
    clicksPerDay: 10 / 3,
    costPerDay: 5,
  })
  assert.equal(result.experiments[1].criterionId, null)
  assert.equal(result.experiments[1].experimentStartedAt, null)
  assert.equal(result.experiments[1].impressions, null)
  assert.equal(result.experiments[1].impressionsPerDay, null)
  assert.match(calls[0], /segments\.date/)
  assert.match(calls[0], /campaign\.id = 12/)
})

test('keywordExperiments distinguishes a complete zero-row report from pending or failed metrics', async () => {
  const active = {
    id: 'experiment-active', account_id: '123', campaign_id: '12', campaign_name: 'Custody',
    ad_group_id: '34', ad_group_name: 'Custody lawyers', criterion_id: '56',
    criterion_resource_name: 'customers/123/adGroupCriteria/34~56', keyword: 'custody lawyer',
    match_type: 'PHRASE', source: 'manual', hypothesis: null,
    experiment_started_at: '2026-09-01T05:00:00.000Z', approved_by: 'approver-1', state: 'active',
  }
  const pending = {
    ...active, id: 'experiment-pending', criterion_id: null, criterion_resource_name: null,
    experiment_started_at: null, approved_by: null, state: 'proposed',
  }
  const complete = serviceFixture({ experiments: [active, pending], query: () => [] })
  const result = await complete.service.keywordExperiments({ startDate: '2026-09-01', endDate: '2026-09-07' })
  assert.equal(result.experiments[0].impressions, 0)
  assert.equal(result.experiments[0].impressionsPerDay, 0)
  assert.equal(result.experiments[1].impressions, null)

  const failed = serviceFixture({ experiments: [active], query: () => { throw new Error('Report unavailable') } })
  const unavailable = await failed.service.keywordExperiments({ startDate: '2026-09-01', endDate: '2026-09-07' })
  assert.equal(unavailable.inventoryComplete, false)
  assert.equal(unavailable.experiments[0].impressions, null)
})

test('HTTP exposes both Keyword Lab reporting actions and reads experiments from the cloud adapter', async () => {
  const originalFetch = globalThis.fetch
  const previous = {
    customer: process.env.GOOGLE_ADS_CUSTOMER_ID,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY,
  }
  const restCalls = []
  process.env.GOOGLE_ADS_CUSTOMER_ID = '123'
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'test-key'
  globalThis.fetch = async url => {
    restCalls.push(String(url))
    return { ok: true, json: async () => [] }
  }
  const base = {
    writeModeForUser: () => ({ ready: true }),
    googleAccessToken: async () => 'token',
    accountInfo: async () => ({ id: '123', timeZone: 'America/Chicago' }),
    googleAdsSearch: async () => [],
    googleAdsPost: async () => ({ payload: {} }),
  }
  try {
    const snapshot = await handleAdsWorkspace({ method: 'GET', query: { action: 'keyword_lab_snapshot', startDate: '2026-09-01', endDate: '2026-09-07' }, headers: {} }, { id: 'user-1' }, base)
    const experimentsResult = await handleAdsWorkspace({ method: 'GET', query: { action: 'keyword_experiments', startDate: '2026-09-01', endDate: '2026-09-07' }, headers: {} }, { id: 'user-1' }, base)
    assert.equal(snapshot.ok, true)
    assert.deepEqual(experimentsResult.experiments, [])
    assert.ok(restCalls.some(url => url.includes('mio_ads_keyword_experiments?account_id=eq.123')))
  } finally {
    globalThis.fetch = originalFetch
    if (previous.customer === undefined) delete process.env.GOOGLE_ADS_CUSTOMER_ID
    else process.env.GOOGLE_ADS_CUSTOMER_ID = previous.customer
    if (previous.url === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = previous.url
    if (previous.key === undefined) delete process.env.SUPABASE_ANON_KEY
    else process.env.SUPABASE_ANON_KEY = previous.key
  }
})
