import test from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { createWorkspaceService } from '../lib/ads/service.js'
import { handleAdsWorkspace } from '../lib/ads/http.js'

globalThis.window ??= {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
}
const { classifySearchTerm } = await import('../src/ads/client.js')

const ACTOR = { id: 'user-1', email: 'ben@beveridgelawfirm.com' }
const ACCOUNT = { id: '123', timeZone: 'America/Chicago' }

function serviceFixture({ query = async () => [], db = {} } = {}) {
  return createWorkspaceService({
    accountId: '123',
    account: ACCOUNT,
    actor: ACTOR,
    canWrite: true,
    query,
    post: async () => ({ payload: {} }),
    db: {
      keywordExperiments: async () => [],
      searchTermClassifications: async () => [],
      ...db,
    },
  })
}

function searchTermRow(searchTerm, { device = 'DESKTOP', cost = 10, clicks = 1, criterionId = '56' } = {}) {
  return {
    campaign: { id: '12', name: 'Custody' },
    adGroup: { id: '34', name: 'Custody lawyers' },
    searchTermView: { searchTerm },
    segments: {
      searchTermMatchType: 'NEAR_PHRASE',
      keyword: {
        adGroupCriterion: `customers/123/adGroupCriteria/34~${criterionId}`,
        info: { text: criterionId === '56' ? 'custody lawyer' : 'divorce lawyer', matchType: 'PHRASE' },
      },
      device,
    },
    metrics: { impressions: clicks * 10, clicks, costMicros: cost * 1e6, conversions: 0 },
  }
}

function keywordRow({ criterionId = '56', keyword = 'custody lawyer', matchType = 'PHRASE' } = {}) {
  return {
    campaign: { id: '12', name: 'Custody' },
    adGroup: { id: '34', name: 'Custody lawyers' },
    adGroupCriterion: {
      criterionId,
      resourceName: `customers/123/adGroupCriteria/34~${criterionId}`,
      status: 'ENABLED',
      keyword: { text: keyword, matchType },
    },
    metrics: { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 },
  }
}

test('classification create preserves the exact identity and immutable audit owner', async () => {
  const inserts = []
  const service = serviceFixture({
    db: {
      findSearchTermClassification: async () => null,
      insertSearchTermClassification: async entry => {
        inserts.push(entry)
        return { id: 'class-1', ...entry, created_at: '2026-09-13T12:00:00.000Z', updated_at: '2026-09-13T12:00:00.000Z' }
      },
    },
  })

  const result = await service.classifyTerm({
    campaignId: '12', adGroupId: '34', searchTerm: 'Case Sensitive Query',
    device: 'MOBILE', classification: 'relevant', note: 'Good intent',
  })

  assert.deepEqual(inserts, [{
    account_id: '123', campaign_id: '12', ad_group_id: '34', search_term: 'Case Sensitive Query',
    classification: 'relevant', note: 'Good intent', created_by: 'user-1',
  }])
  assert.deepEqual(result.classification, {
    id: 'class-1', accountId: '123', campaignId: '12', adGroupId: '34', searchTerm: 'Case Sensitive Query',
    classification: 'relevant', note: 'Good intent', createdBy: 'user-1',
    createdAt: '2026-09-13T12:00:00.000Z', updatedAt: '2026-09-13T12:00:00.000Z',
  })
})

test('classification update changes only granted columns and rejects invalid values', async () => {
  const patches = []
  const existing = {
    id: 'class-1', account_id: '123', campaign_id: '12', ad_group_id: '34', search_term: 'Case Sensitive Query',
    classification: 'observe', note: null, created_by: 'original-user', created_at: '2026-09-12T12:00:00.000Z',
  }
  const service = serviceFixture({
    db: {
      findSearchTermClassification: async identity => {
        assert.deepEqual(identity, { accountId: '123', campaignId: '12', adGroupId: '34', searchTerm: 'Case Sensitive Query' })
        return existing
      },
      updateSearchTermClassification: async (id, patch) => {
        patches.push({ id, patch })
        return { ...existing, ...patch, updated_at: '2026-09-13T12:00:00.000Z' }
      },
    },
  })

  const result = await service.classifyTerm({
    accountId: 'spoofed', campaignId: '12', adGroupId: '34', searchTerm: 'Case Sensitive Query',
    device: 'DESKTOP', classification: 'irrelevant', note: '',
  })

  assert.deepEqual(patches, [{ id: 'class-1', patch: { classification: 'irrelevant', note: null } }])
  assert.equal(result.classification.createdBy, 'original-user')
  await assert.rejects(
    service.classifyTerm({ campaignId: '12', adGroupId: '34', searchTerm: 'query', classification: 'blocked' }),
    /relevant, irrelevant, observe, or promoted/,
  )
})

test('snapshot joins case-sensitive classifications across device rows and calculates explicit quality coverage', async () => {
  const terms = [
    searchTermRow('Case Sensitive Query', { device: 'DESKTOP', cost: 20, clicks: 2 }),
    searchTermRow('Case Sensitive Query', { device: 'MOBILE', cost: 10, clicks: 1 }),
    searchTermRow('case sensitive query', { device: 'TABLET', cost: 30, clicks: 3 }),
    searchTermRow('unclassified query', { device: 'DESKTOP', cost: 40, clicks: 4 }),
    searchTermRow('blocked query', { device: 'DESKTOP', cost: 50, clicks: 5, criterionId: '57' }),
  ]
  const keywordRows = [
    keywordRow(),
    keywordRow({ criterionId: '57', keyword: 'divorce lawyer' }),
    keywordRow({ criterionId: '58', keyword: 'Case Sensitive Query', matchType: 'EXACT' }),
  ]
  let classificationArgs
  const statements = []
  const service = serviceFixture({
    db: {
      searchTermClassifications: async args => {
        classificationArgs = args
        return [
          { id: 'c1', account_id: '123', campaign_id: '12', ad_group_id: '34', search_term: 'Case Sensitive Query', classification: 'relevant', note: 'exact case' },
          { id: 'c2', account_id: '123', campaign_id: '12', ad_group_id: '34', search_term: 'case sensitive query', classification: 'observe', note: null },
          { id: 'c3', account_id: '123', campaign_id: '12', ad_group_id: '34', search_term: 'blocked query', classification: 'irrelevant', note: null },
          { id: 'wrong-account', account_id: '999', campaign_id: '12', ad_group_id: '34', search_term: 'unclassified query', classification: 'relevant', note: null },
        ]
      },
    },
    query: async statement => {
      statements.push(statement)
      if (statement.includes('FROM search_term_view')) return terms
      if (statement.includes('ad_group_criterion.negative = TRUE')) return []
      if (statement.includes('campaign_criterion.negative = TRUE')) {
        return [{ campaign: { id: '12', name: 'Custody' }, campaignCriterion: { status: 'ENABLED', keyword: { text: 'blocked query', matchType: 'EXACT' } } }]
      }
      if (statement.includes('FROM campaign_shared_set') || statement.includes('FROM customer_negative_criterion') || statement.includes('FROM shared_criterion')) return []
      if (statement.includes('FROM ad_group_criterion')) return keywordRows
      if (statement.includes('metrics.search_impression_share')) return []
      if (statement.includes('FROM keyword_view')) return []
      return []
    },
  })

  const result = await service.keywordLabSnapshot({ startDate: '2026-09-01', endDate: '2026-09-07', campaignId: '12', adGroupId: '34' })

  assert.deepEqual(classificationArgs, { campaignId: '12', adGroupId: '34' })
  assert.deepEqual(result.searchTerms.map(row => row.classification), ['relevant', 'relevant', 'observe', null, 'irrelevant'])
  assert.equal(result.searchTerms[0].classificationNote, 'exact case')
  assert.equal(result.searchTerms[0].classificationId, 'c1')
  assert.equal(result.searchTerms[1].classificationId, 'c1')
  assert.equal(result.searchTerms[2].classificationId, 'c2')
  assert.equal(result.searchTerms[0].keywordCoverage.keyword, 'Case Sensitive Query')
  assert.equal(result.searchTerms[4].negativeCoverage.keyword, 'blocked query')
  assert.deepEqual(result.quality, {
    relevantClickRate: 3 / 11,
    relevantSpendRate: 30 / 110,
    wasteRate: 50 / 110,
    classifiedSpendCoverage: 110 / 150,
    classifiedClicks: 11,
    classifiedSpend: 110,
    totalSpend: 150,
  })
  assert.deepEqual(
    Object.fromEntries(result.keywords.slice(0, 2).map(row => [row.criterionId, {
      relevantClickRate: row.relevantClickRate,
      relevantSpendRate: row.relevantSpendRate,
      wasteRate: row.wasteRate,
      classifiedSpendCoverage: row.classifiedSpendCoverage,
    }])),
    {
      56: { relevantClickRate: 0.5, relevantSpendRate: 0.5, wasteRate: 0, classifiedSpendCoverage: 0.6 },
      57: { relevantClickRate: 0, relevantSpendRate: 0, wasteRate: 1, classifiedSpendCoverage: 1 },
    },
  )
  assert.equal(result.negativeInventoryComplete, true)
  assert.equal(result.classificationInventoryComplete, true)
  assert.equal(result.coverageComplete, true)
  assert.ok(statements.filter(statement => statement.includes('campaign_criterion.negative = TRUE')).every(statement => statement.includes('campaign.id = 12')))
  assert.ok(statements.filter(statement => statement.includes('ad_group_criterion.negative = TRUE')).every(statement => statement.includes('campaign.id = 12') && statement.includes('ad_group.id = 34')))
})

test('snapshot marks negative and classification inventory failures incomplete and unsafe', async () => {
  const service = serviceFixture({
    db: { searchTermClassifications: async () => { throw new Error('Classifications unavailable') } },
    query: async statement => {
      if (statement.includes('FROM ad_group_criterion') && !statement.includes('negative = TRUE')) return [keywordRow()]
      if (statement.includes('metrics.search_impression_share') || statement.includes('FROM keyword_view') || statement.includes('FROM search_term_view')) return []
      if (statement.includes('campaign_criterion.negative = TRUE')) throw new Error('Negatives unavailable')
      return []
    },
  })

  const result = await service.keywordLabSnapshot({ startDate: '2026-09-01', endDate: '2026-09-07', campaignId: '12' })

  assert.equal(result.inventoryComplete, true)
  assert.equal(result.negativeInventoryComplete, false)
  assert.equal(result.classificationInventoryComplete, false)
  assert.equal(result.coverageComplete, false)
  assert.equal(result.liveActionsEnabled, false)
  assert.ok(result.warnings.some(warning => warning.section === 'negative inventory'))
  assert.ok(result.warnings.some(warning => warning.section === 'classifications'))
})

test('HTTP classification action uses separate insert and grant-safe update paths without Google calls', async () => {
  const originalFetch = globalThis.fetch
  const previous = {
    customer: process.env.GOOGLE_ADS_CUSTOMER_ID,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY,
  }
  process.env.GOOGLE_ADS_CUSTOMER_ID = '123'
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'test-key'
  const calls = []
  let existing = null
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null }
    calls.push(call)
    if (call.method === 'GET') return { ok: true, json: async () => existing ? [existing] : [] }
    if (call.method === 'POST') {
      existing = { id: 'class-1', ...call.body, created_at: '2026-09-13T12:00:00.000Z', updated_at: '2026-09-13T12:00:00.000Z' }
      return { ok: true, json: async () => [existing] }
    }
    existing = { ...existing, ...call.body, updated_at: '2026-09-13T13:00:00.000Z' }
    return { ok: true, json: async () => [existing] }
  }
  let googleCalls = 0
  const base = {
    writeModeForUser: () => ({ ready: false }),
    googleAccessToken: async () => { googleCalls += 1; return 'token' },
    accountInfo: async () => ACCOUNT,
    googleAdsSearch: async () => { googleCalls += 1; return [] },
    googleAdsPost: async () => { googleCalls += 1; return { payload: {} } },
  }
  const request = body => handleAdsWorkspace({ method: 'POST', query: { action: 'keyword_classify_term' }, headers: { authorization: 'Bearer test' }, body }, ACTOR, base)
  try {
    await request({ campaignId: '12', adGroupId: '34', searchTerm: 'Case Sensitive Query', device: 'MOBILE', classification: 'observe', note: 'Watch' })
    await request({ campaignId: '12', adGroupId: '34', searchTerm: 'Case Sensitive Query', device: 'DESKTOP', classification: 'promoted', note: 'Added exact' })

    const insert = calls.find(call => call.method === 'POST')
    const update = calls.find(call => call.method === 'PATCH')
    assert.deepEqual(insert.body, {
      account_id: '123', campaign_id: '12', ad_group_id: '34', search_term: 'Case Sensitive Query',
      classification: 'observe', note: 'Watch', created_by: 'user-1',
    })
    assert.deepEqual(update.body, { classification: 'promoted', note: 'Added exact' })
    assert.match(update.url, /id=eq\.class-1/)
    const reads = calls.filter(call => call.method === 'GET')
    assert.ok(reads.every(call => call.url.includes('search_term=eq.Case%20Sensitive%20Query')))
    assert.ok(reads.every(call => !call.url.includes('device')))
    assert.equal(googleCalls, 0)
    assert.equal(calls.filter(call => call.method === 'POST').length, 1)
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

test('client classification wrapper uses the POST action contract', async () => {
  const calls = []
  const body = { campaignId: '12', adGroupId: '34', searchTerm: 'query', classification: 'observe', note: null }
  const result = await classifySearchTerm(body, async (...args) => {
    calls.push(args)
    return { ok: true }
  })
  assert.deepEqual(calls, [['keyword_classify_term', { method: 'POST', body }]])
  assert.deepEqual(result, { ok: true })
})
