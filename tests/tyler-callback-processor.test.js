// End-to-end callback composition test: signature verification -> NFRC parse ->
// atomic record -> acknowledgment, using a synthetic signed SOAP callback.
import test from 'node:test'
import assert from 'node:assert/strict'
import { signTylerSoapEnvelope } from '../lib/efiling/tylerXmlDsig.js'
import { processTylerCallback } from '../lib/efiling/tylerCallbackProcessor.js'
import { makeSyntheticIdentity } from './helpers/syntheticIdentity.js'

const WSU = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
const WSSE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/'
const id = (v, k) => `<n:DocumentIdentification><n:IdentificationID>${v}</n:IdentificationID><n:IdentificationCategoryDescriptionText>${k}</n:IdentificationCategoryDescriptionText></n:DocumentIdentification>`

const identity = makeSyntheticIdentity()

function signedNfrcCallback() {
  const now = Date.now()
  const created = new Date(now - 20000).toISOString()
  const expires = new Date(now + 3 * 60000).toISOString()
  const unsigned = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="${SOAP}" xmlns:wsu="${WSU}" xmlns:wsse="${WSSE}">
<s:Header><wsse:Security>
<wsu:Timestamp wsu:Id="Timestamp-1"><wsu:Created>${created}</wsu:Created><wsu:Expires>${expires}</wsu:Expires></wsu:Timestamp>
</wsse:Security></s:Header>
<s:Body wsu:Id="Body-1"><w:NotifyFilingReviewCompleteRequest xmlns:w="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/wrappers" xmlns:r="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/reviewfilingcallback" xmlns:e="https://docs.oasis-open.org/legalxml-courtfiling/ns/v5.0/ecf" xmlns:n="http://release.niem.gov/niem/niem-core/4.0/" xmlns:t="urn:tyler:ecf:v5.0:extensions:common"><r:NotifyFilingReviewCompleteMessage>${id('M-1', 'messageID')}${id('E-1', 'envelopeID')}<e:FilingStatus/><e:LeadDocumentReview><e:ReviewedDocument>${id('F-1', 'filingID')}</e:ReviewedDocument></e:LeadDocumentReview></r:NotifyFilingReviewCompleteMessage></w:NotifyFilingReviewCompleteRequest></s:Body>
</s:Envelope>`
  return signTylerSoapEnvelope({ xml: unsigned, privateKeyPem: identity.privateKeyPem, certificatePem: identity.certificatePem }).xml
}

test('verifies a signed callback, records once, and returns an acknowledgment', async () => {
  let recorded = null
  const result = await processTylerCallback({
    rawXml: signedNfrcCallback(),
    environment: 'stage',
    trustedCertificatePem: identity.certificatePem,
    resolveStatus: async () => 'unknown',
    recordReceipt: async (meta) => { recorded = meta; return { submission_id: 'sub-1', duplicate: false } },
    now: Date.now(),
  })
  assert.equal(recorded.messageId, 'M-1')
  assert.equal(recorded.envelopeId, 'E-1')
  assert.equal(recorded.filingId, 'F-1')
  assert.match(result.acknowledgment, /NotifyFilingReviewCompleteResponse/)
})

test('rejects a tampered callback before any record write', async () => {
  let writes = 0
  await assert.rejects(() => processTylerCallback({
    rawXml: signedNfrcCallback().replace('F-1', 'F-9'),
    environment: 'stage',
    trustedCertificatePem: identity.certificatePem,
    resolveStatus: async () => 'unknown',
    recordReceipt: async () => { writes++ },
    now: Date.now(),
  }), /signature verification failed/)
  assert.equal(writes, 0)
})

test('rejects a callback from an unapproved signer', async () => {
  const other = makeSyntheticIdentity()
  await assert.rejects(() => processTylerCallback({
    rawXml: signedNfrcCallback(),
    environment: 'stage',
    trustedCertificatePem: other.certificatePem,
    resolveStatus: async () => 'unknown',
    recordReceipt: async () => {},
    now: Date.now(),
  }), /signature verification failed/)
})
