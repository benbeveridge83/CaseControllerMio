import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyDuplicate, exactDuplicateKey, normalizeWording, tokenOverlap } from '../src/discoveryRelief/dedupe.js'

test('normalizeWording collapses whitespace and lowercases', () => {
  assert.equal(normalizeWording('  Produce  ALL\n\tDocuments.  '), 'produce all documents.')
})

test('exactDuplicateKey includes type, recipient, time period, scope, and wording', () => {
  const a = { type: 'rfp', text: 'Produce tax returns', recipient: 'Opposing Party', timePeriod: '2025', scope: 'income' }
  const b = { type: 'rfp', text: '  Produce   tax returns ', recipient: 'opposing party', timePeriod: '2025', scope: 'income' }
  assert.equal(exactDuplicateKey(a), exactDuplicateKey(b))
})

test('exactDuplicateKey differs by instrument type', () => {
  const rfp = { type: 'rfp', text: 'Identify all bank accounts' }
  const roggs = { type: 'roggs', text: 'Identify all bank accounts' }
  assert.notEqual(exactDuplicateKey(rfp), exactDuplicateKey(roggs))
})

test('classifyDuplicate marks identical wording as exact', () => {
  const result = classifyDuplicate(
    { type: 'rfp', text: 'Produce all pay stubs for the last twelve months.' },
    { type: 'rfp', text: 'Produce all pay stubs for the last twelve months.' }
  )
  assert.equal(result, 'exact')
})

test('classifyDuplicate marks high-overlap wording as similar', () => {
  const result = classifyDuplicate(
    { type: 'rfp', text: 'Produce all pay stubs for the last twelve months.' },
    { type: 'rfp', text: 'Produce all pay stubs for the past twelve months.' }
  )
  assert.equal(result, 'similar')
})

test('classifyDuplicate never merges across instrument types', () => {
  const result = classifyDuplicate(
    { type: 'rfp', text: 'Identify all bank accounts.' },
    { type: 'roggs', text: 'Identify all bank accounts.' }
  )
  assert.equal(result, 'distinct')
})

test('classifyDuplicate never merges across recipients', () => {
  const result = classifyDuplicate(
    { type: 'rfp', text: 'Produce tax returns.', recipient: 'Mother' },
    { type: 'rfp', text: 'Produce tax returns.', recipient: 'Father' }
  )
  assert.equal(result, 'distinct')
})

test('tokenOverlap is symmetric and bounded', () => {
  assert.equal(tokenOverlap('a b c', 'a b c'), 1)
  assert.equal(tokenOverlap('a b c', 'a b c'), tokenOverlap('a b c', 'a b c'))
  assert.ok(tokenOverlap('a b', 'x y') === 0)
})
