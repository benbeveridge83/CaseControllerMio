import test from 'node:test'
import assert from 'node:assert/strict'
import { createMockEfilingProvider, createTylerEfilingProvider, TYLER_EFM_NOT_CONFIGURED_MESSAGE, EFILING_PROVIDER_METHODS } from '../src/efiling/mioEfilingProvider.js'

test('mock provider returns courts for a state and codes for a case type', async () => {
  const provider = createMockEfilingProvider()
  const courts = await provider.getCourts('TX')
  assert.ok(courts.length >= 5)
  assert.ok(courts.every((court) => court.state === 'TX'))
  const codes = await provider.getFilingCodes('', 'Divorce')
  assert.ok(codes.length > 0)
  assert.ok(codes.every((code) => code.caseTypes.includes('Divorce')))
})

test('mock provider calculates deterministic fees', async () => {
  const provider = createMockEfilingProvider()
  const efileOnly = await provider.calculateFees({ filingMode: 'efile_only', filingCode: 'Motion' })
  const serve = await provider.calculateFees({ filingMode: 'efile_and_serve', filingCode: 'Motion' })
  assert.equal(serve.estimatedFees, efileOnly.estimatedFees + 5)
  assert.equal(efileOnly.status, 'calculated')
})

test('mock submit never performs a live filing', async () => {
  const provider = createMockEfilingProvider()
  const result = await provider.submitFiling({})
  assert.ok(result.tylerEnvelopeId)
  assert.equal(result.tylerStatus, 'submitted')
})

test('Tyler stub refuses every provider method until configured', async () => {
  const provider = createTylerEfilingProvider()
  const expected = TYLER_EFM_NOT_CONFIGURED_MESSAGE.split('.')[0]
  for (const method of EFILING_PROVIDER_METHODS) {
    await assert.rejects(provider[method](), new RegExp(expected))
  }
})
