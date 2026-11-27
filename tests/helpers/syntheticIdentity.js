// Ephemeral, synthetic self-signed X.509 identity for crypto regression tests.
// Generates a fresh RSA-2048 key + certificate in memory per call. No openssl,
// no network, no real Tyler certificates, no client data. Clearly non-production.
import { generateKeyPairSync, createSign } from 'node:crypto'

function derLen(n) {
  if (n < 0x80) return Buffer.from([n])
  const bytes = []
  let v = n
  while (v > 0) { bytes.unshift(v & 0xff); v >>>= 8 }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}
const T = (tag, body) => Buffer.concat([Buffer.from([tag]), derLen(body.length), body])
function derInt(bn) {
  let hex = bn.toString(16)
  if (hex.length % 2) hex = '0' + hex
  let b = Buffer.from(hex, 'hex')
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b])
  return T(0x02, b)
}
function derOid(oid) {
  const p = oid.split('.').map(Number)
  const enc = [40 * p[0] + p[1]]
  for (let i = 2; i < p.length; i++) {
    let v = p[i]
    const stack = [v & 0x7f]
    v >>>= 7
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>>= 7 }
    enc.push(...stack)
  }
  return T(0x06, Buffer.from(enc))
}
const algId = (oid) => T(0x30, Buffer.concat([derOid(oid), T(0x05, Buffer.alloc(0))]))
function derUtc(d) {
  const y = String(d.getUTCFullYear()).padStart(4, '0').slice(2)
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return T(0x17, Buffer.from(`${y}${m}${dd}${h}${mi}${s}Z`, 'ascii'))
}
function derName(cn) {
  const atv = T(0x30, Buffer.concat([derOid('2.5.4.3'), T(0x0c, Buffer.from(cn, 'utf8'))]))
  return T(0x30, T(0x31, atv))
}
const OID_SHA256RSA = '1.2.840.113549.1.1.11'
const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`

export function makeSyntheticIdentity({ cn = 'Synthetic Mio Test Signer', days = 2 } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const notBefore = new Date(Date.now() - 86400000)
  const notAfter = new Date(Date.now() + days * 86400000)
  const tbs = T(0x30, Buffer.concat([
    derInt(1n), algId(OID_SHA256RSA), derName(cn),
    T(0x30, Buffer.concat([derUtc(notBefore), derUtc(notAfter)])),
    derName(cn), spki,
  ]))
  const sig = createSign('sha256').update(tbs).sign(privateKey)
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    certificatePem: pem('CERTIFICATE', T(0x30, Buffer.concat([tbs, algId(OID_SHA256RSA), T(0x03, Buffer.concat([Buffer.from([0]), sig]))]))),
  }
}
