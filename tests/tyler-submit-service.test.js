import test from 'node:test'
import assert from 'node:assert/strict'
import { createTylerSubmitService } from '../lib/efiling/tylerSubmitService.js'

const draft = { id: 'd-1', matterId: 'matter-1', documentId: 'doc-1', courtLocationId: 'court-1', causeNumber: '123-F', filingCode: 'Motion', filingMode: 'efile_only', paymentAccountId: 'a-1', serviceContacts: [] }
const args = { draft, ownerId: 'owner-1', environment: 'stage', idempotencyKey: 'request-1', documentReference: { path: 'matter-1/doc.pdf' } }

test('dry run validates intent, authorizes the matter and verifies the document without any send', async () => {
  let authorized = null
  const service = createTylerSubmitService({
    authorizeMatter: async (x) => { authorized = x },
    retrieveDocument: async () => ({ sha256: 'a'.repeat(64), byteLength: 1234 }),
  })
  const result = await service.submit(args)
  assert.equal(result.dryRun, true)
  assert.equal(result.sent, false)
  assert.equal(result.networkCallMade, false)
  assert.equal(result.transportReady, false)
  assert.equal(result.intent.matterId, 'matter-1')
  assert.equal(result.intent.ownerId, 'owner-1')
  assert.equal(authorized.matterId, 'matter-1')
  assert.equal(authorized.ownerId, 'owner-1')
  assert.equal(result.document.sha256, 'a'.repeat(64))
})

test('rejects an unauthorized matter before any document read', async () => {
  let read = 0
  const service = createTylerSubmitService({
    authorizeMatter: async () => { throw new Error('Not authorized for this matter.') },
    retrieveDocument: async () => { read++; return { sha256: 'a'.repeat(64), byteLength: 1 } },
  })
  await assert.rejects(() => service.submit(args), /Not authorized/)
  assert.equal(read, 0)
})

test('rejects an invalid intent (client-supplied ownerId cannot bypass validation)', async () => {
  const service = createTylerSubmitService({
    authorizeMatter: async () => {},
    retrieveDocument: async () => ({ sha256: 'a'.repeat(64), byteLength: 1 }),
  })
  await assert.rejects(() => service.submit({ ...args, draft: { ...draft, filingCode: '' } }), /Filing code/)
  await assert.rejects(() => service.submit({ ...args, ownerId: '' }), /Owner ID/)
})

test('requires both dependencies', () => {
  assert.throws(() => createTylerSubmitService({}), /authorization/)
  assert.throws(() => createTylerSubmitService({ authorizeMatter: async () => {} }), /retrieval/)
})
