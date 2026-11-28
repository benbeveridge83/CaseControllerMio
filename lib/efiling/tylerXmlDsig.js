// Tyler ECF5 / WS-Security XMLDSIG signer and verifier (SERVER ONLY).
//
// This is the Node/Vercel counterpart of scripts/tyler_xmlsig_prototype.py and
// reproduces its cryptographic contract in the same runtime that will eventually
// send/receive SOAP:
//   * signs exactly the SOAP 1.1 Body and the WS-Security Timestamp, each by a
//     unique wsu:Id;
//   * RSA-SHA256 signature, SHA-256 digest, exclusive canonicalization
//     (xml-exc-c14n) — no SHA-1, no external references;
//   * the X.509 signing certificate is embedded in KeyInfo; verification is
//     anchored to a separately-provisioned, pinned certificate, never to a
//     certificate recovered from the untrusted incoming SOAP.
//
// SECURITY: this module uses node:crypto and must never be imported into a
// browser bundle. It is an offline cryptographic primitive. It does not call
// Tyler, does not perform durable replay detection, and does not claim Tyler
// Stage/OCA approval. Keep the fail-closed transport gate in place until those
// are verified.
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { X509Certificate, timingSafeEqual } from 'node:crypto'
import { SignedXml } from 'xml-crypto'
import { inspectTylerXmlDsigReferenceBindings } from './tylerXmlDsigReferencePolicy.js'

const NS = Object.freeze({
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
})

export const TYLER_DSIG = Object.freeze({
  signatureMethod: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  digestMethod: 'http://www.w3.org/2001/04/xmlenc#sha256',
  canonicalization: 'http://www.w3.org/2001/10/xml-exc-c14n#',
})

const MAX_SOAP_BYTES = 8 * 1024 * 1024

function assertSoapPayload(xml) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('SOAP XML is required.')
  if (Buffer.byteLength(xml, 'utf8') > MAX_SOAP_BYTES) throw new Error('SOAP payload exceeds size limit.')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD and entity declarations are forbidden.')
}

function parse(xml) {
  const doc = new DOMParser({
    onError(level, message) {
      if (level !== 'warning') throw new Error('Malformed SOAP XML: ' + message)
    },
  }).parseFromString(xml, 'application/xml')
  const root = doc?.documentElement
  if (!root || root.localName === 'parsererror') throw new Error('Invalid SOAP XML.')
  if (root.namespaceURI !== NS.soap || root.localName !== 'Envelope')
    throw new Error('SOAP 1.1 envelope required.')
  if (doc.doctype) throw new Error('Document type declaration forbidden.')
  return doc
}

function one(doc, ns, localName, label) {
  const all = Array.from(doc.getElementsByTagNameNS(ns, localName))
  if (all.length !== 1) throw new Error('Expected exactly one ' + label + '.')
  return all[0]
}

function wsuId(el) {
  return el?.getAttributeNS(NS.wsu, 'Id') || ''
}

function signingTargets(xml) {
  assertSoapPayload(xml)
  const doc = parse(xml)
  const body = one(doc, NS.soap, 'Body', 'SOAP Body')
  one(doc, NS.soap, 'Header', 'SOAP Header')
  const timestamp = one(doc, NS.wsu, 'Timestamp', 'WS-Security Timestamp')
  const signatures = Array.from(doc.getElementsByTagNameNS(NS.ds, 'Signature'))
  if (signatures.length !== 0) throw new Error('SOAP request already contains a signature.')
  const bodyId = wsuId(body)
  const timestampId = wsuId(timestamp)
  if (!bodyId || !timestampId || bodyId === timestampId)
    throw new Error('SOAP Body and Timestamp must carry distinct wsu:Id values.')
  return { bodyId, timestampId }
}

// Locate an element by its wsu:Id using a namespace-agnostic predicate, so the
// reference XPath does not depend on a configured prefix resolver.
function idXpath(id) {
  return `//*[@*[local-name(.)='Id' and namespace-uri(.)='${NS.wsu}']='${id}']`
}

function requirePem(value, marker, label) {
  if (typeof value !== 'string' || !value.includes(marker))
    throw new Error(label + ' PEM is required.')
  return value
}

/**
 * Signs the SOAP Body and WS-Security Timestamp of an unsigned SOAP 1.1
 * envelope. Only ever call this server-side with a server-held private key.
 */
export function signTylerSoapEnvelope({ xml, privateKeyPem, certificatePem } = {}) {
  const { bodyId, timestampId } = signingTargets(xml)
  const key = requirePem(privateKeyPem, 'PRIVATE KEY', 'Private key')
  const cert = requirePem(certificatePem, 'BEGIN CERTIFICATE', 'Signing certificate')

  const signer = new SignedXml({
    idMode: 'wssecurity',
    privateKey: key,
    publicCert: cert,
    signatureAlgorithm: TYLER_DSIG.signatureMethod,
    canonicalizationAlgorithm: TYLER_DSIG.canonicalization,
  })
  signer.addReference({
    xpath: idXpath(bodyId),
    transforms: [TYLER_DSIG.canonicalization],
    digestAlgorithm: TYLER_DSIG.digestMethod,
  })
  signer.addReference({
    xpath: idXpath(timestampId),
    transforms: [TYLER_DSIG.canonicalization],
    digestAlgorithm: TYLER_DSIG.digestMethod,
  })
  signer.computeSignature(xml, {
    prefix: 'ds',
    location: { reference: `//*[local-name(.)='Security']`, action: 'append' },
  })
  const signedXml = signer.getSignedXml()
  // The signature must round-trip through our own verifier before it is returned.
  const probe = verifyTylerSoapEnvelope({ xml: signedXml, trustedCertificatePem: certificatePem })
  if (!probe.cryptographicallyVerified) throw new Error('Signing self-check failed.')
  return Object.freeze({
    xml: signedXml,
    signed: true,
    boundSoapBodyId: bodyId,
    boundTimestampId: timestampId,
    signatureMethod: TYLER_DSIG.signatureMethod,
    digestMethod: TYLER_DSIG.digestMethod,
    canonicalization: TYLER_DSIG.canonicalization,
    replayChecked: false,
    tylerStageApproved: false,
  })
}

function normalizedFingerprint(value) {
  if (typeof value !== 'string') throw new Error('An approved certificate SHA-256 pin is required.')
  const hex = value.replaceAll(':', '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('Invalid X.509 SHA-256 pin.')
  return Buffer.from(hex, 'hex')
}

function checkTrustedCertificate(trustedCertificatePem, { approvedCertificateSha256, environment, now = Date.now() } = {}) {
  if (!['stage', 'production'].includes(environment))
    throw new Error('An explicit Tyler environment is required for verification.')
  if (typeof trustedCertificatePem !== 'string' || !trustedCertificatePem.includes('BEGIN CERTIFICATE'))
    throw new Error('A trusted Tyler signing certificate PEM is required.')
  const cert = new X509Certificate(trustedCertificatePem)
  const notBefore = Date.parse(cert.validFrom)
  const notAfter = Date.parse(cert.validTo)
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter))
    throw new Error('Trusted certificate validity cannot be read.')
  if (now < notBefore || now >= notAfter)
    throw new Error('Trusted signing certificate is expired or not yet valid.')
  if (cert.publicKey?.asymmetricKeyType !== 'rsa' ||
    (cert.publicKey?.asymmetricKeyDetails?.modulusLength || 0) < 2048)
    throw new Error('Unsupported or weak trusted signing certificate.')
  const fingerprint = cert.fingerprint256
  if (approvedCertificateSha256) {
    const expected = normalizedFingerprint(approvedCertificateSha256)
    const actual = Buffer.from(fingerprint.replaceAll(':', '').toLowerCase(), 'hex')
    if (!timingSafeEqual(actual, expected))
      throw new Error('Signing certificate does not match the approved pin.')
  }
  return { fingerprint, certificatePem: trustedCertificatePem }
}

function signatureElementXml(xml) {
  const doc = parse(xml)
  const signature = one(doc, NS.ds, 'Signature', 'XMLDSIG Signature')
  return new XMLSerializer().serializeToString(signature)
}

/**
 * Cryptographically verifies a signed SOAP 1.1 envelope against a pinned
 * trusted certificate. Throws on any security failure; returns a structured,
 * conservative result on success. `replayChecked` is always false here — durable
 * replay detection is a separate, required step performed by the callback gate.
 */
export function verifyTylerSoapEnvelope({
  xml,
  trustedCertificatePem,
  approvedCertificateSha256,
  environment = 'stage',
  now = Date.now(),
} = {}) {
  assertSoapPayload(xml)
  // Structural WS-Security / reference-bindings policy first (wrapping, SHA-1,
  // duplicate IDs, external references, stale timestamps, missing references).
  const policy = inspectTylerXmlDsigReferenceBindings(xml, { now })
  const trust = checkTrustedCertificate(trustedCertificatePem, { approvedCertificateSha256, environment, now })

  const verifier = new SignedXml({ idMode: 'wssecurity', publicCert: trust.certificatePem })
  verifier.loadSignature(signatureElementXml(xml))

  let valid
  try {
    valid = verifier.checkSignature(xml) === true
  } catch (error) {
    throw new Error('Tyler SOAP signature verification failed: ' + (error?.message || 'invalid signature'), { cause: error })
  }
  if (valid !== true) throw new Error('Tyler SOAP signature verification failed: reference digest mismatch.')

  const signedReferences = verifier.getSignedReferences()
  if (!Array.isArray(signedReferences) || signedReferences.length !== 2)
    throw new Error('Exactly two cryptographically bound references are required.')

  return Object.freeze({
    cryptographicallyVerified: true,
    // Aliases matching the notification processor's security contract.
    signatureVerified: true,
    trustedIssuer: true,
    timestampVerified: true,
    trustedCertificateFingerprint256: trust.fingerprint,
    environment,
    boundSoapBodyId: policy.boundSoapBodyId,
    boundTimestampId: policy.boundTimestampId,
    structuralChecksPassed: policy.structuralChecksPassed,
    // Replay is deliberately NOT resolved here: durable replay/deduplication is
    // performed atomically with status recording by the receipt recorder.
    replayChecked: false,
    tylerStageApproved: false,
  })
}
