import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTylerNfrcMetadata, TYLER_NFRC_SOAP_ACTION } from '../lib/efiling/tylerNfrcContract.js'

const namespaces = `xmlns:w="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/wrappers"
xmlns:r="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/reviewfilingcallback"
xmlns:n="http://release.niem.gov/niem/niem-core/4.0/"
xmlns:e="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf"
xmlns:t="urn:tyler:ecf:v5.0:extensions:common"`
const id = (value, category) => `<n:DocumentIdentification>
  <n:IdentificationID>${value}</n:IdentificationID>
  <n:IdentificationCategoryDescriptionText>${category}</n:IdentificationCategoryDescriptionText>
</n:DocumentIdentification>`
const operation = `<w:NotifyFilingReviewCompleteRequest ${namespaces}>
<r:NotifyFilingReviewCompleteMessage>
${id('M-100','messageID')}
${id('E-200','envelopeID')}
<e:FilingCompletionDate><n:DateTime>2026-11-22T10:00:00Z</n:DateTime></e:FilingCompletionDate>
<e:FilingStatus><t:FilingStatusAugmentation>
<t:ReviewCommentsText>Test review</t:ReviewCommentsText>
</t:FilingStatusAugmentation></e:FilingStatus>
<e:LeadDocumentReview><e:ReviewedDocument>
${id('F-300','filingID')}
</e:ReviewedDocument></e:LeadDocumentReview>
</r:NotifyFilingReviewCompleteMessage>
</w:NotifyFilingReviewCompleteRequest>`

test('Tyler ECF5 SOAP action matches the provided WSDL', () => {
  assert.match(TYLER_NFRC_SOAP_ACTION, /NotifyFilingReviewComplete$/)
})

test('reads the documented envelope, message, and filing IDs without inventing filing status', () => {
  const actual = parseTylerNfrcMetadata(operation)
  assert.equal(actual.messageId, 'M-100')
  assert.equal(actual.envelopeId, 'E-200')
  assert.equal(actual.filingId, 'F-300')
  assert.equal(actual.completionDate, '2026-11-22T10:00:00Z')
  assert.equal(actual.normalizedStatus, null)
  assert.equal(actual.requiresSignatureVerification, true)
})

test('accepts a SOAP 1.1 envelope around the ECF5 operation', () => {
  const soap = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
    <s:Body>${operation}</s:Body>
    </s:Envelope>`
  assert.equal(parseTylerNfrcMetadata(soap).filingId, 'F-300')
})

test('rejects unrecognized operations, missing IDs, and DTDs', () => {
  assert.throws(() => parseTylerNfrcMetadata(operation.replaceAll('NotifyFilingReviewCompleteRequest','NotifyEventRequest')), /Unexpected/)
  assert.throws(() => parseTylerNfrcMetadata(operation.replace('envelopeID','otherID')), /envelopeID/)
  assert.throws(() => parseTylerNfrcMetadata('<!DOCTYPE foo><foo/>'), /DTD/)
})

test('does not accept similarly named elements in a foreign XML namespace', () => {
  assert.throws(() => parseTylerNfrcMetadata('<x:NotifyFilingReviewCompleteRequest xmlns:x="urn:attacker"/>'), /Unexpected/)
})
