// Server-only, authorized Tyler e-filing document retrieval.
//
// Fetches a matter document from tenant-scoped Supabase storage using the
// service-role client, then verifies it is a PDF within the size limit and,
// when the caller supplies them, that its SHA-256 and byte count match the
// reviewed filing. Never trusts a client-supplied path or digest; the source
// of truth for the expected digest is the server-side reviewed filing record.
import { createHash } from 'node:crypto'

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024

export function validateDocumentPath(path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('A document path is required.')
  if (path.length > 2048) throw new Error('Document path is too long.')
  if (path.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(path)) throw new Error('Document path must be a relative object key.')
  return path
}

export async function retrieveAuthorizedTylerDocument(serviceClient, {
  bucket = 'case-documents',
  path,
  expectedSha256,
  expectedByteLength,
  maxBytes = MAX_DOCUMENT_BYTES,
} = {}) {
  if (!serviceClient?.storage?.from) throw new Error('Server-side Supabase storage client is required.')
  const key = validateDocumentPath(path)
  const { data, error } = await serviceClient.storage.from(bucket).download(key)
  if (error || !data) throw new Error('Document could not be retrieved: ' + (error?.message || 'missing file'))
  const bytes = Buffer.from(await data.arrayBuffer())
  if (bytes.length === 0) throw new Error('Retrieved document is empty.')
  if (bytes.length > maxBytes) throw new Error('Retrieved document exceeds the size limit.')
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Retrieved document is not a PDF.')
  if (expectedByteLength !== undefined && bytes.length !== Number(expectedByteLength))
    throw new Error('Retrieved document byte count does not match the reviewed filing.')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (expectedSha256 !== undefined && sha256 !== expectedSha256)
    throw new Error('Retrieved document SHA-256 does not match the reviewed filing.')
  return Object.freeze({ bytes, sha256, byteLength: bytes.length, bucket, path: key })
}
