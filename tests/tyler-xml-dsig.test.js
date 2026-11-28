// Cryptographic SOAP Body + Timestamp XMLDSIG round-trip regression tests.
// Every key/certificate is an ephemeral, self-signed, synthetic identity
// generated in memory; no Tyler endpoints, real certificates or client data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { signTylerSoapEnvelope, verifyTylerSoapEnvelope } from '../lib/efiling/tylerXmlDsig.js'
import { makeSyntheticIdentity } from './helpers/syntheticIdentity.js'

const WSU = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
const WSSE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/'

function unsignedSoap({ bodyId = 'Body-1', timestampId = 'Timestamp-1', docName = 'Synthetic motion', now = Date.now() } = {}) {
  const created = new Date(now - 20000).toISOString()
  const expires = new Date(now + 3 * 60000).toISOString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="${SOAP}" xmlns:wsu="${WSU}" xmlns:wsse="${WSSE}">
<s:Header><wsse:Security>
<wsu:Timestamp wsu:Id="${timestampId}"><wsu:Created>${created}</wsu:Created><wsu:Expires>${expires}</wsu:Expires></wsu:Timestamp>
</wsse:Security></s:Header>
<s:Body wsu:Id="${bodyId}"><x:ReviewFilingResponse xmlns:x="urn:example:only"><x:DocumentName>${docName}</x:DocumentName></x:ReviewFilingResponse></s:Body>
</s:Envelope>`
}

const identity = makeSyntheticIdentity()
const other = makeSyntheticIdentity()

function signOnce() {
  return signTylerSoapEnvelope({
    xml: unsignedSoap(),
    privateKeyPem: identity.privateKeyPem,
    certificatePem: identity.certificatePem,
  })
}

test('signs and verifies Body + Timestamp with RSA-SHA256 and pinned certificate', () => {
  const signed = signOnce()
  assert.equal(signed.signed, true)
  assert.equal(signed.boundSoapBodyId, 'Body-1')
  assert.equal(signed.boundTimestampId, 'Timestamp-1')
  assert.equal(signed.replayChecked, false)
  assert.equal(signed.tylerStageApproved, false)
  const result = verifyTylerSoapEnvelope({ xml: signed.xml, trustedCertificatePem: identity.certificatePem, environment: 'stage' })
  assert.equal(result.cryptographicallyVerified, true)
  assert.equal(result.trustedIssuer, true)
  assert.equal(result.boundSoapBodyId, 'Body-1')
  assert.equal(result.boundTimestampId, 'Timestamp-1')
  assert.equal(result.replayChecked, false)
  assert.equal(result.tylerStageApproved, false)
})

test('rejects an unapproved certificate and a mismatched pin', () => {
  const signed = signOnce()
  assert.throws(() => verifyTylerSoapEnvelope({ xml: signed.xml, trustedCertificatePem: other.certificatePem, environment: 'stage' }), /signature verification failed/)
  assert.throws(() => verifyTylerSoapEnvelope({
    xml: signed.xml, trustedCertificatePem: identity.certificatePem,
    approvedCertificateSha256: new X509Certificate(other.certificatePem).fingerprint256, environment: 'stage',
  }), /approved pin/)
})

test('rejects a tampered Body and a tampered Timestamp', () => {
  const signed = signOnce()
  assert.throws(() => verifyTylerSoapEnvelope({ xml: signed.xml.replace('Synthetic motion', 'Altered motion'), trustedCertificatePem: identity.certificatePem, environment: 'stage' }), /signature verification failed/)
  const tamperedTs = signed.xml.replace('</wsu:Timestamp>', '<x:Injected xmlns:x="urn:evil"/></wsu:Timestamp>')
  assert.throws(() => verifyTylerSoapEnvelope({ xml: tamperedTs, trustedCertificatePem: identity.certificatePem, environment: 'stage' }), /signature verification failed/)
})

test('rejects a stale message outside the timestamp window', () => {
  const signed = signOnce()
  assert.throws(() => verifyTylerSoapEnvelope({ xml: signed.xml, trustedCertificatePem: identity.certificatePem, environment: 'stage', now: Date.now() + 3600000 }), /timestamp|acceptable bounds/)
})

test('rejects unsigned input and DTD/entity payloads', () => {
  assert.throws(() => verifyTylerSoapEnvelope({ xml: unsignedSoap(), trustedCertificatePem: identity.certificatePem, environment: 'stage' }), /Exactly one body|signature/)
  const dtd = unsignedSoap().replace('?>', '?><!DOCTYPE s:Envelope [<!ENTITY x "attack">]>')
  assert.throws(() => verifyTylerSoapEnvelope({ xml: dtd, trustedCertificatePem: identity.certificatePem, environment: 'stage' }), /DTD|DOCTYPE/)
})

test('rejects duplicate wsu:Id (signature wrapping) and missing body id', () => {
  const signed = signOnce()
  const dup = signed.xml.replace('wsu:Id="Body-1"', 'wsu:Id="Timestamp-1"')
  assert.throws(() => verifyTylerSoapEnvelope({ xml: dup, trustedCertificatePem: identity.certificatePem, environment: 'stage' }), /distinct|Duplicate|Body and Timestamp/)
  const missing = signed.xml.replace('wsu:Id="Body-1"', '')
  assert.throws(() => verifyTylerSoapEnvelope({ xml: missing, trustedCertificatePem: identity.certificatePem, environment: 'stage' }), /distinct|Body and Timestamp/)
})

test('signer refuses to sign an already-signed or mis-identified envelope', () => {
  const signed = signOnce()
  assert.throws(() => signTylerSoapEnvelope({ xml: signed.xml, privateKeyPem: identity.privateKeyPem, certificatePem: identity.certificatePem }), /already contains a signature/)
  const noBodyId = unsignedSoap({ bodyId: '' })
  assert.throws(() => signTylerSoapEnvelope({ xml: noBodyId, privateKeyPem: identity.privateKeyPem, certificatePem: identity.certificatePem }), /distinct wsu:Id/)
  assert.throws(() => signTylerSoapEnvelope({ xml: unsignedSoap(), privateKeyPem: 'not-a-key', certificatePem: identity.certificatePem }), /Private key/)
})
