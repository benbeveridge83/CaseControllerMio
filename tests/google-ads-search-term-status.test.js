import test from 'node:test'
import assert from 'node:assert/strict'
import {
  negativeKeywordMatchesSearch,
  deriveSearchTermStatus,
  isResolvedSearchTermStatus
} from '../src/googleAdsSearchTermStatus.js'

const row = {
  searchTerm: 'shane kersh attorney',
  campaignId: '23231502238',
  campaignName: 'Divorce',
  adGroupId: '111',
  adGroupName: 'Divorce - Brazoria'
}

test('negative match semantics cover exact, phrase, and broad without close variants', () => {
  assert.equal(negativeKeywordMatchesSearch('shane kersh attorney', { keyword: 'shane kersh attorney', matchType: 'EXACT' }), true)
  assert.equal(negativeKeywordMatchesSearch('best shane kersh attorney reviews', { keyword: 'shane kersh attorney', matchType: 'EXACT' }), false)
  assert.equal(negativeKeywordMatchesSearch('best shane kersh attorney reviews', { keyword: 'shane kersh', matchType: 'PHRASE' }), true)
  assert.equal(negativeKeywordMatchesSearch('shane attorney kersh', { keyword: 'shane kersh', matchType: 'PHRASE' }), false)
  assert.equal(negativeKeywordMatchesSearch('attorney shane kersh', { keyword: 'shane attorney', matchType: 'BROAD' }), true)
  assert.equal(negativeKeywordMatchesSearch('attorney shane', { keyword: 'shane kersh', matchType: 'BROAD' }), false)
})

test('campaign negative resolves a search term and explains the covering negative', () => {
  const status = deriveSearchTermStatus(row, {
    negativeKeywords: [
      { scope: 'campaign', campaignId: '23231502238', keyword: 'shane kersh', matchType: 'PHRASE' }
    ],
    keywords: []
  })
  assert.equal(status.resolved, true)
  assert.equal(status.kind, 'campaign_negative')
  assert.match(status.label, /Campaign negative/i)
  assert.match(status.detail, /shane kersh/i)
})

test('ad-group negative applies only to the matching ad group', () => {
  const report = {
    negativeKeywords: [
      { scope: 'ad_group', campaignId: '23231502238', adGroupId: '222', keyword: 'shane kersh', matchType: 'PHRASE' }
    ],
    keywords: []
  }
  assert.equal(deriveSearchTermStatus(row, report).resolved, false)
  assert.equal(deriveSearchTermStatus({ ...row, adGroupId: '222' }, report).kind, 'ad_group_negative')
})

test('exact positive keyword resolves the row when no negative already blocks it', () => {
  const status = deriveSearchTermStatus({ ...row, searchTerm: 'custody lawyer' }, {
    negativeKeywords: [],
    keywords: [
      { campaignId: '23231502238', adGroupId: '111', keyword: 'custody lawyer', matchType: 'EXACT', status: 'ENABLED', negative: false }
    ]
  })
  assert.equal(status.resolved, true)
  assert.equal(status.kind, 'exact_keyword')
  assert.match(status.label, /Exact keyword added/i)
})

test('a covering negative takes precedence over an exact keyword and unresolved rows remain actionable', () => {
  const blocked = deriveSearchTermStatus(row, {
    negativeKeywords: [
      { scope: 'campaign', campaignId: '23231502238', keyword: 'shane kersh', matchType: 'PHRASE' }
    ],
    keywords: [
      { campaignId: '23231502238', adGroupId: '111', keyword: 'shane kersh attorney', matchType: 'EXACT', status: 'ENABLED', negative: false }
    ]
  })
  assert.equal(blocked.kind, 'campaign_negative')
  assert.equal(isResolvedSearchTermStatus(blocked), true)

  const unresolved = deriveSearchTermStatus(row, { negativeKeywords: [], keywords: [] })
  assert.equal(unresolved.resolved, false)
  assert.equal(unresolved.kind, 'unresolved')
  assert.equal(isResolvedSearchTermStatus(unresolved), false)
})
