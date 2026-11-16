import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DISCLOSURE_CATEGORIES,
  DISCLOSURE_CATALOG_VERSION,
  DISCLOSURE_REQUEST_LANGUAGE,
  DISCLOSURE_REGIMES,
  normalizeDisclosureCatalog,
  normalizeDisclosureCategory
} from '../src/discoveryRelief/catalog.js'

test('the disclosure catalog has exactly 11 top-level categories', () => {
  assert.equal(DISCLOSURE_CATEGORIES.length, 11)
})

test('categories are numbered 1..11 in order', () => {
  assert.deepEqual(DISCLOSURE_CATEGORIES.map((c) => c.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
})

test('every category references its § 301.052(a)(N) provision', () => {
  DISCLOSURE_CATEGORIES.forEach((category) => {
    assert.match(category.statute_ref, new RegExp(`301\\.052\\(a\\)\\(${category.number}\\)`), category.id)
  })
})

test('category 6 (testifying experts) is flagged nested', () => {
  const expert = DISCLOSURE_CATEGORIES.find((c) => c.number === 6)
  assert.ok(expert)
  assert.equal(expert.nested, true)
})

test('the request language reflects § 301.051 and the 30-day deadline', () => {
  assert.match(DISCLOSURE_REQUEST_LANGUAGE, /30th day after the date of service/)
  assert.match(DISCLOSURE_REQUEST_LANGUAGE, /Subchapter B, Chapter 301, Family Code/)
})

test('the catalog version and regimes are defined', () => {
  assert.equal(DISCLOSURE_CATALOG_VERSION, 1)
  assert.ok(DISCLOSURE_REGIMES.length >= 4)
  assert.ok(DISCLOSURE_REGIMES.some((r) => r.id === 'family_current'))
})

test('normalizeDisclosureCatalog fills defaults and preserves order', () => {
  const normalized = normalizeDisclosureCatalog([
    { id: 'x', number: 2, label: 'Two' },
    { id: 'y', number: 1, label: 'One' }
  ])
  assert.equal(normalized.length, 2)
  assert.equal(normalized[0].number, 2)
  assert.equal(normalized[1].number, 1)
  assert.equal(normalized[0].is_active, true)
  assert.equal(normalized[0].text, '')
})

test('normalizeDisclosureCategory infers id from number when missing', () => {
  const category = normalizeDisclosureCategory({ number: 4, label: 'Economic damages' })
  assert.equal(category.id, 'fd-04')
  assert.equal(category.nested, false)
})
