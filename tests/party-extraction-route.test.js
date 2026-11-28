// Synthetic data only. No sign-in, production reads, or network writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeParties, parsePartiesJson, sanitizeDocuments } from '../lib/party-extraction.js'

test('parsePartiesJson reads {parties:[...]} and bare arrays, tolerating fences', () => {
  assert.equal(parsePartiesJson('```json\n{"parties":[{"name":"Jane Doe"}]}\n```').length, 1)
  assert.equal(parsePartiesJson('[{"name":"John Doe"}]')[0].name, 'John Doe')
  assert.equal(parsePartiesJson('not json at all').length, 0)
})

test('normalizeParties whitelists roles and attorney types', () => {
  const parties = normalizeParties([
    { name: 'Jane Doe', role: 'Petitioner', attorneyType: 'Party Attorney', attorney: { name: 'Ben Beveridge' }, confidence: 'high' },
    { name: 'Bob', role: 'Witness', attorneyType: 'Random' }
  ])
  assert.equal(parties.length, 2)
  assert.equal(parties[0].role, 'Petitioner')
  assert.equal(parties[0].source, 'client')
  assert.equal(parties[0].attorney.name, 'Ben Beveridge')
  assert.equal(parties[1].role, '')
  assert.equal(parties[1].attorneyType, '')
})

test('sanitizeDocuments caps doc count and filters empty text', () => {
  const docs = Array.from({ length: 15 }, (_, i) => ({ fileName: `f${i}.pdf`, text: `text ${i}` }))
  docs.push({ fileName: 'empty.pdf', text: '   ' })
  const out = sanitizeDocuments(docs)
  assert.equal(out.length, 12)
  assert.equal(out[0].text, 'text 0')
})

test('sanitizeDocuments truncates long text per document', () => {
  const out = sanitizeDocuments([{ fileName: 'long.pdf', text: 'x'.repeat(20000) }])
  assert.equal(out[0].text.length, 9000)
})
