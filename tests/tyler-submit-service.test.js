import test from 'node:test'
import assert from 'node:assert/strict'
import { createTylerSubmitService } from '../lib/efiling/tylerSubmitService.js'

const draft = { id: 'd-1', matterId: 'matter-1', documentId: 'doc-1', courtLocationId: 'court-1', causeNumber: '123-F', filingCode: 'Motion', filingMode: 'efile_only', paymentAccountId: 'a-1', serviceContacts: [] }
const args = { draft, ownerId: 'owner-1', environment: 'stage', idempotencyKey: 'request-1' }

test('dry run resolves the document server-side and never trusts a caller path/digest', async () => {
  let authorized = null
  let retrieved = null
  const service = createTylerSubmitService({
    authorizeMatter: async (x) => { authorized = x },
    resolveDocument: async ({ documentId, matterId }) => ({ path: 'matter-1/doc.pdf', sha256: 'a'.repeat(64), byteLength: 1234 }),
    retrieveDocument: async (ref) => { retrieved = ref; return { sha256: ref.expectedSha256, byteLength: ref.expectedByteLength } },
  })
  const result = await service.submit(args)
  assert.equal(result.dryRun, true)
  assert.equal(result.sent, false)
  assert.equal(result.networkCallMade, false)
  assert.equal(result.transportReady, false)
  assert.equal(result.intent.matterId, 'matter-1')
  assert.equal(result.intent.ownerId, 'owner-1')
  assert.equal(authorized.matterId, 'matter-1')
  // The path/digest used for retrieval come from resolveDocument, not the request.
  assert.equal(retrieved.path, 'matter-1/doc.pdf')
  assert.equal(retrieved.expectedSha256, 'a'.repeat(64))
  assert.equal(retrieved.expectedByteLength, 1234)
  assert.equal(result.document.sha256, 'a'.repeat(64))
})

test('a document from one matter cannot be retrieved for another matter', async () => {
  const records = {
    'matter-A': { 'doc-A': { path: 'matter-A/doc.pdf', sha256: 'a'.repeat(64), byteLength: 100 } },
    'matter-B': { 'doc-B': { path: 'matter-B/doc.pdf', sha256: 'b'.repeat(64), byteLength: 200 } },
  }
  const service = createTylerSubmitService({
    authorizeMatter: async () => {},
    resolveDocument: async ({ documentId, matterId }) => {
      const record = records[matterId]?.[documentId]
      if (!record) throw new Error('Document not found for this matter.')
      return record
    },
    retrieveDocument: async (ref) => ({ sha256: ref.expectedSha256, byteLength: ref.expectedByteLength }),
  })
  // The document that belongs to matter-A resolves fine for matter-A.
  await assert.doesNotReject(() => service.submit({ ...args, draft: { ...draft, matterId: 'matter-A', documentId: 'doc-A' } }))
  // The same request with matter-A but doc-B (which belongs to matter-B) is denied.
  await assert.rejects(() => service.submit({ ...args, draft: { ...draft, matterId: 'matter-A', documentId: 'doc-B' } }), /not found for this matter/)
})

test('rejects an unauthorized matter before any document resolution', async () => {
  let resolved = 0
  const service = createTylerSubmitService({
    authorizeMatter: async () => { throw new Error('Not authorized for this matter.') },
    resolveDocument: async () => { resolved++; return {} },
    retrieveDocument: async () => ({ sha256: 'a'.repeat(64), byteLength: 1 }),
  })
  await assert.rejects(() => service.submit(args), /Not authorized/)
  assert.equal(resolved, 0)
})

test('rejects an invalid intent (client-supplied ownerId cannot bypass validation)', async () => {
  const service = createTylerSubmitService({
    authorizeMatter: async () => {},
    resolveDocument: async () => ({ path: 'p.pdf', sha256: 'a'.repeat(64), byteLength: 1 }),
    retrieveDocument: async () => ({ sha256: 'a'.repeat(64), byteLength: 1 }),
  })
  await assert.rejects(() => service.submit({ ...args, draft: { ...draft, filingCode: '' } }), /Filing code/)
  await assert.rejects(() => service.submit({ ...args, ownerId: '' }), /Owner ID/)
})

test('requires all three dependencies', () => {
  assert.throws(() => createTylerSubmitService({}), /authorization/)
  assert.throws(() => createTylerSubmitService({ authorizeMatter: async () => {} }), /resolution/)
  assert.throws(() => createTylerSubmitService({ authorizeMatter: async () => {}, resolveDocument: async () => ({}) }), /retrieval/)
})

test('delegates to the durable-outbox coordinator only when a server flag enables sending', async () => {
  let sent = 0
  const coordinator = { submit: async () => { sent++; return { envelopeId: 'e1', filingIds: ['f1'] } } }
  const deps = {
    authorizeMatter: async () => {},
    resolveDocument: async () => ({ path: 'p.pdf', sha256: 'a'.repeat(64), byteLength: 1 }),
    retrieveDocument: async (ref) => ({ sha256: ref.expectedSha256, byteLength: ref.expectedByteLength }),
  }
  // Default (no server flag): dry run, the coordinator (outbox + transport) is never invoked.
  const dry = createTylerSubmitService(deps)
  const r1 = await dry.submit(args)
  assert.equal(r1.dryRun, true)
  assert.equal(r1.sent, false)
  assert.equal(sent, 0)
  // Server-enabled + a certified coordinator: the submit delegates to it.
  const live = createTylerSubmitService({ ...deps, coordinator, enabled: true })
  const r2 = await live.submit(args)
  assert.equal(r2.dryRun, false)
  assert.equal(r2.sent, true)
  assert.equal(r2.networkCallMade, true)
  assert.equal(r2.envelopeId, 'e1')
  assert.deepEqual(r2.filingIds, ['f1'])
  assert.equal(sent, 1)
})
