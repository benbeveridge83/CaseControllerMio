import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDiscoveryDocxBodyXml, buildDiscoveryDocxXml, discoveryDocxFileName } from '../src/discoveryRelief/generate.js'

test('the docx body numbers requests by instrument and escapes text', () => {
  const composed = {
    included: [
      { type: 'roggs', number: 1, text: 'Describe your schedule & availability.' },
      { type: 'roggs', number: 2, text: 'Identify each person with knowledge.' },
      { type: 'rfp', number: 1, text: 'Produce all pay stubs.' }
    ]
  }
  const xml = buildDiscoveryDocxBodyXml(composed)
  assert.match(xml, /Describe your schedule &amp; availability\./)
  assert.match(xml, /RFP/)
  assert.match(xml, /Produce all pay stubs\./)
})

test('the docx body omits empty instrument types and has a fallback', () => {
  assert.match(buildDiscoveryDocxBodyXml({ included: [] }), /No discovery requests selected\./)
  const oneType = buildDiscoveryDocxBodyXml({ included: [{ type: 'rfa', number: 1, text: 'Admit X.' }] })
  assert.match(oneType, /RFA/)
  assert.doesNotMatch(oneType, /ROGGS/)
})

test('discoveryDocxFileName sanitizes the matter name', () => {
  assert.equal(discoveryDocxFileName({ cause_number: '21-FM-123' }), 'Discovery Requests - 21-FM-123.docx')
  assert.equal(discoveryDocxFileName({ name: 'Smith v. Smith' }), 'Discovery Requests - Smith v. Smith.docx')
})

test('buildDiscoveryDocxXml wraps the body in a Word document', () => {
  const xml = buildDiscoveryDocxXml({ included: [{ type: 'rfp', number: 1, text: 'Produce X.' }] })
  assert.match(xml, /<w:document/)
  assert.match(xml, /Produce X\./)
})
