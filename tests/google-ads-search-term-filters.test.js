import test from 'node:test'
import assert from 'node:assert/strict'
import { searchTermFilterMatches } from '../src/googleAdsSearchTermStatus.js'

test('intent filter can isolate Needs review rows', () => {
  assert.equal(searchTermFilterMatches({ intent: 'Needs review', statusKind: 'unresolved' }, { intent: 'Needs review', status: 'all' }), true)
  assert.equal(searchTermFilterMatches({ intent: 'High hiring intent', statusKind: 'unresolved' }, { intent: 'Needs review', status: 'all' }), false)
})

test('status filter can isolate unresolved and resolved action types', () => {
  assert.equal(searchTermFilterMatches({ intent: 'Needs review', statusKind: 'unresolved' }, { intent: 'all', status: 'unresolved' }), true)
  assert.equal(searchTermFilterMatches({ intent: 'Needs review', statusKind: 'campaign_negative' }, { intent: 'all', status: 'unresolved' }), false)
  assert.equal(searchTermFilterMatches({ intent: 'High hiring intent', statusKind: 'campaign_negative' }, { intent: 'all', status: 'campaign_negative' }), true)
})

test('all filters leave rows visible', () => {
  assert.equal(searchTermFilterMatches({ intent: 'High hiring intent', statusKind: 'exact_keyword' }, { intent: 'all', status: 'all' }), true)
})
