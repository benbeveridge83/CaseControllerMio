import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldRefreshGoogleAdsStatusAfterClick } from '../src/googleAdsSearchTermStatus.js'

test('status refresh is triggered by the actual approval click that applies a mutation', () => {
  assert.equal(shouldRefreshGoogleAdsStatusAfterClick('Authorize & apply'), true)
  assert.equal(shouldRefreshGoogleAdsStatusAfterClick('Validating and applying...'), true)
})

test('status refresh still recognizes the initial search-term action buttons', () => {
  assert.equal(shouldRefreshGoogleAdsStatusAfterClick('Campaign negative'), true)
  assert.equal(shouldRefreshGoogleAdsStatusAfterClick('Ad-group negative'), true)
  assert.equal(shouldRefreshGoogleAdsStatusAfterClick('Add exact keyword'), true)
  assert.equal(shouldRefreshGoogleAdsStatusAfterClick('Cancel'), false)
})
