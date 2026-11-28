import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { retrieveAuthorizedTylerDocument, validateDocumentPath } from '../lib/efiling/tylerDocumentRetrieval.js'

const pdfBytes = Buffer.from('%PDF-1.4\n% Synthetic Tyler test document\n1234')

function storageClient(bytes = pdfBytes, error = null) {
  return { storage: { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error }) }) } }
}

test('retrieves a PDF and computes its SHA-256 and byte count', async () => {
  const result = await retrieveAuthorizedTylerDocument(storageClient(), { path: 'matter-1/motion.pdf' })
  assert.equal(result.byteLength, pdfBytes.length)
  assert.equal(result.sha256, createHash('sha256').update(pdfBytes).digest('hex'))
  assert.equal(result.path, 'matter-1/motion.pdf')
})

test('verifies an expected digest and byte count when supplied', async () => {
  const sha256 = createHash('sha256').update(pdfBytes).digest('hex')
  await assert.doesNotReject(() => retrieveAuthorizedTylerDocument(storageClient(), { path: 'm/m.pdf', expectedSha256: sha256, expectedByteLength: pdfBytes.length }))
  await assert.rejects(() => retrieveAuthorizedTylerDocument(storageClient(), { path: 'm/m.pdf', expectedSha256: 'f'.repeat(64) }), /SHA-256/)
  await assert.rejects(() => retrieveAuthorizedTylerDocument(storageClient(), { path: 'm/m.pdf', expectedByteLength: 999 }), /byte count/)
})

test('rejects non-PDF, empty and oversized documents', async () => {
  await assert.rejects(() => retrieveAuthorizedTylerDocument(storageClient(Buffer.from('not a pdf')), { path: 'm/m.pdf' }), /not a PDF/)
  await assert.rejects(() => retrieveAuthorizedTylerDocument(storageClient(Buffer.alloc(0)), { path: 'm/m.pdf' }), /empty/)
  const big = Buffer.concat([pdfBytes, Buffer.alloc(16 * 1024 * 1024)])
  await assert.rejects(() => retrieveAuthorizedTylerDocument(storageClient(big), { path: 'm/m.pdf' }), /size limit/)
})

test('rejects directory traversal and requires a server storage client', async () => {
  assert.throws(() => validateDocumentPath('../secret.pdf'), /relative object key/)
  assert.throws(() => validateDocumentPath('/abs.pdf'), /relative object key/)
  assert.throws(() => validateDocumentPath(''), /path is required/)
  await assert.rejects(() => retrieveAuthorizedTylerDocument({}, { path: 'm/m.pdf' }), /storage client/)
  await assert.rejects(() => retrieveAuthorizedTylerDocument({ storage: {} }, { path: 'm/m.pdf' }), /storage client/)
})

test('surfaces storage download failures', async () => {
  const client = { storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'bucket not found' } }) }) } }
  await assert.rejects(() => retrieveAuthorizedTylerDocument(client, { path: 'm/m.pdf' }), /could not be retrieved/)
})
