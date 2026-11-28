import test from 'node:test'
import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { inspectTylerSigningIdentity, inspectTylerTrustedResponseCertificate } from '../lib/efiling/tylerX509Readiness.js'
import { makeSyntheticIdentity } from './helpers/syntheticIdentity.js'

const one = makeSyntheticIdentity({ cn: 'Synthetic Tyler Test Only', days: 3 })
const two = makeSyntheticIdentity({ cn: 'Synthetic Tyler Test Only', days: 3 })
const cert=new X509Certificate(one.certificatePem)
const pin=cert.fingerprint256
const args={...one,approvedCertificateSha256:pin,environment:'stage'}
test('server-held X.509 identity must have matching pinned certificate and private key',()=>{
 const r=inspectTylerSigningIdentity(args)
 assert.equal(r.privateKeyMatches,true)
 assert.equal(r.keyReady,true)
 assert.equal(r.xmlSignatureReady,false)
 assert.equal(r.transportReady,false)
 assert.equal(r.environment,'stage')
 assert.equal(r.algorithm,'RSA-SHA256')
 assert.ok(r.keyBits>=2048)
 assert.equal(Object.hasOwn(r,'privateKeyPem'),false)
 assert.equal(Object.hasOwn(r,'certificatePem'),false)
})
test('rejects unapproved environment pin and mismatched private key',()=>{
 const wrongPin=new X509Certificate(two.certificatePem).fingerprint256
 assert.throws(()=>inspectTylerSigningIdentity({...args,approvedCertificateSha256:wrongPin}),/approved environment-specific pin/)
 assert.throws(()=>inspectTylerSigningIdentity({...args,privateKeyPem:two.privateKeyPem}),/does not match/)
 assert.throws(()=>inspectTylerSigningIdentity({...args,environment:'unknown'}),/explicit Tyler environment/)
})
test('rejects expired signing certificates and invalid key material',()=>{
 const expired=Date.parse(cert.validTo)+1000
 assert.throws(()=>inspectTylerSigningIdentity({...args,now:expired}),/valid date range/)
 assert.throws(()=>inspectTylerSigningIdentity({...args,privateKeyPem:'not a key'}),/private key/)
 assert.throws(()=>inspectTylerSigningIdentity({...args,approvedCertificateSha256:'abc'}),/SHA-256/)
})
test('trusted response certificate readiness never claims signature authenticity',()=>{
 const r=inspectTylerTrustedResponseCertificate({
  certificatePem:one.certificatePem,
  allowedFingerprints256:[pin],
  environment:'stage',
 })
 assert.equal(r.pinnedCertificatePresent,true)
 assert.equal(r.xmlSignatureVerified,false)
 assert.equal(r.trustVerified,false)
 assert.equal(r.replayVerified,false)
 assert.equal(r.transportReady,false)
 assert.throws(()=>inspectTylerTrustedResponseCertificate({
  certificatePem:one.certificatePem,
  allowedFingerprints256:[new X509Certificate(two.certificatePem).fingerprint256],
  environment:'stage',
 }),/not approved/)
 assert.throws(()=>inspectTylerTrustedResponseCertificate({
  certificatePem:one.certificatePem,
  allowedFingerprints256:[],
  environment:'stage',
 }),/allowlist/)
})
