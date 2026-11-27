// Tyler ECF5 signing identity readiness (SERVER ONLY).
// Confirms an X.509 signing certificate, its matching private key, expiry,
// approved SHA-256 pin and key strength without exposing key material.
// This is NOT XMLDSIG signing, callback signature verification, or Tyler
// authorization. An authenticated Stage handshake remains mandatory.
import {
  X509Certificate, createPrivateKey,
  randomBytes, sign, verify, timingSafeEqual,
} from 'node:crypto'

function normalizedFingerprint(value) {
  if (typeof value !== 'string') throw Error('An approved certificate SHA-256 pin is required.')
  const hex = value.replaceAll(':','').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hex)) throw Error('Invalid X.509 SHA-256 pin.')
  return Buffer.from(hex,'hex')
}

function validUtcTime(value) {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) throw Error('Certificate validity cannot be read.')
  return ms
}

export function inspectTylerSigningIdentity({
  certificatePem, privateKeyPem, approvedCertificateSha256,
  environment, now = Date.now(), minRsaBits = 2048,
} = {}) {
  if (!['stage','production'].includes(environment))
    throw Error('Signing identity requires an explicit Tyler environment.')
  if (typeof certificatePem !== 'string' || !certificatePem.includes('BEGIN CERTIFICATE'))
    throw Error('An X.509 PEM certificate is required.')
  if (typeof privateKeyPem !== 'string' || !privateKeyPem.includes('PRIVATE KEY'))
    throw Error('A server-held PEM signing private key is required.')
  if (!Number.isFinite(now)) throw Error('A valid clock is required.')
  const expected = normalizedFingerprint(approvedCertificateSha256)
  const certificate = new X509Certificate(certificatePem)
  const actual = Buffer.from(certificate.fingerprint256.replaceAll(':','').toLowerCase(),'hex')
  if (!timingSafeEqual(actual,expected))
    throw Error('Signing certificate does not match the approved environment-specific pin.')
  const notBefore = validUtcTime(certificate.validFrom)
  const notAfter = validUtcTime(certificate.validTo)
  if (now < notBefore || now >= notAfter)
    throw Error('Signing certificate is outside its valid date range.')
  const key = createPrivateKey(privateKeyPem)
  const certPublicKey = certificate.publicKey
  if (key.asymmetricKeyType !== 'rsa' || certPublicKey.asymmetricKeyType !== 'rsa')
    throw Error('Only RSA certificate identities supported by this readiness check.')
  const keyBits = key.asymmetricKeyDetails?.modulusLength || 0
  const certificateBits = certPublicKey.asymmetricKeyDetails?.modulusLength || 0
  if (keyBits < minRsaBits || certificateBits < minRsaBits)
    throw Error('RSA signing key below required minimum strength.')
  // Prove private key corresponds to the pinned certificate, without exporting
  // the key or persisting a signature. This is NOT an ECF5 XML signature.
  const challenge = randomBytes(32)
  const challengeSignature = sign('sha256',challenge,key)
  if (!verify('sha256',challenge,certPublicKey,challengeSignature))
    throw Error('Private key does not match the pinned X.509 signing certificate.')
  // Certificate pin is the only returned identifying material: no private
  // key, challenge or certificate text is ever returned.
  return Object.freeze({
    environment,
    certificateFingerprint256:certificate.fingerprint256,
    algorithm:'RSA-SHA256',
    keyBits,
    notBefore:new Date(notBefore).toISOString(),
    notAfter:new Date(notAfter).toISOString(),
    privateKeyMatches:true,
    keyReady:true,
    xmlSignatureReady:false,
    trustedTylerCallbackVerifierReady:false,
    stageHandshakeVerified:false,
    transportReady:false,
  })
}

export function inspectTylerTrustedResponseCertificate({
  certificatePem, allowedFingerprints256, environment,
  now = Date.now(),
}={}) {
  if (!['stage','production'].includes(environment))
    throw Error('Tyler response trust policy needs an explicit environment.')
  if (!Array.isArray(allowedFingerprints256) || allowedFingerprints256.length === 0)
    throw Error('A pinned Tyler response certificate allowlist is required.')
  if (typeof certificatePem !== 'string') throw Error('X.509 PEM certificate required.')
  const cert = new X509Certificate(certificatePem)
  const actual = Buffer.from(cert.fingerprint256.replaceAll(':','').toLowerCase(),'hex')
  const pinned = allowedFingerprints256.some(value=>
    timingSafeEqual(actual,normalizedFingerprint(value)))
  if (!pinned) throw Error('Tyler response signer certificate is not approved.')
  const start=validUtcTime(cert.validFrom),end=validUtcTime(cert.validTo)
  if(now < start || now >= end) throw Error('Tyler response certificate expired or not yet valid.')
  if(cert.publicKey.asymmetricKeyType!=='rsa' ||
     (cert.publicKey.asymmetricKeyDetails?.modulusLength||0)<2048)
    throw Error('Unsupported or weak Tyler response signer.')
  // Pinning alone NEVER verifies an XML signature or establishes callback authenticity.
  return Object.freeze({
    certificateFingerprint256:cert.fingerprint256,
    environment,
    pinnedCertificatePresent:true,
    xmlSignatureVerified:false,
    trustVerified:false,
    replayVerified:false,
    transportReady:false,
  })
}
