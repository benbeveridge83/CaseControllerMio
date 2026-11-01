import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupabaseReviews } from '../lib/paralegal/reviews.js'
import { createDeltaTracker, classifyNotification, isDuplicateNotification } from '../lib/paralegal/microsoft/sync.js'
import { composeScheduleEmail, recipientRoleFor } from '../lib/paralegal/emailCompose.js'

test('reviews adapter round-trips and scopes by owner', async () => {
  let stored = null
  const db = {
    from: (table) => {
      assert.equal(table, 'mio_paralegal_reviews')
      return {
        upsert: async (row) => { stored = row; return { error: null } },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored, error: null }) }) })
      }
    }
  }
  const reviews = createSupabaseReviews({ url: 'u', serviceKey: 'k', supabase: db })
  const record = { id: 'r1', ownerId: 'u1', taskId: 't1', action: 'draft_follow_up', email: { to: ['x@y.com'], subject: 's', body: 'b' }, task: { id: 't1', matterId: 'm1', revision: 'rev', matterName: 'M' }, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }
  await reviews.save('u1', record)
  const loaded = await reviews.load('u1', 'r1')
  assert.equal(loaded.id, 'r1')
  assert.equal(loaded.email.subject, 's')
  assert.equal(await reviews.load('someone-else', 'r1'), null)
})

test('delta tracker dedupes messages and advances the cursor', () => {
  const tracker = createDeltaTracker()
  const first = tracker.applyDeltaPage({ value: [{ id: 'a' }, { id: 'b' }], '@odata.nextLink': 'next1' })
  assert.deepEqual(first.added.map((m) => m.id), ['a', 'b'])
  assert.equal(tracker.cursor(), 'next1')
  const second = tracker.applyDeltaPage({ value: [{ id: 'a' }, { id: 'c' }], '@odata.deltaLink': 'delta1' })
  assert.deepEqual(second.added.map((m) => m.id), ['c'])
  assert.equal(tracker.cursor(), 'delta1')
})

test('notification classification extracts id and change type', () => {
  const n = classifyNotification({ changeType: 'created', resource: 'me/messages/1', resourceData: { id: '1' }, subscriptionId: 'sub1' })
  assert.equal(n.changeType, 'created')
  assert.equal(n.id, '1')
  assert.equal(n.subscriptionId, 'sub1')
})

test('duplicate notifications are rejected once', () => {
  const seen = new Set()
  const n = { changeType: 'created', resourceData: { id: 'x' } }
  assert.equal(isDuplicateNotification(n, seen), false)
  assert.equal(isDuplicateNotification(n, seen), true)
})

test('composeScheduleEmail picks the court recipient for date requests', () => {
  const task = { matterName: 'Ellis', waitingOn: 'Court / Mediator', step: 'Request dates' }
  const draft = composeScheduleEmail(task, { action: 'draft_date_request', contacts: { court: ['clerk@court.gov'], client: ['c@x.com'], opposingCounsel: ['oc@x.com'] } })
  assert.deepEqual(draft.to, ['clerk@court.gov'])
  assert.match(draft.subject, /Ellis/)
})

test('composeScheduleEmail throws when no recipient is available', () => {
  assert.throws(
    () => composeScheduleEmail({ matterName: 'Ellis' }, { action: 'draft_follow_up', contacts: {} }),
    /No recipient/
  )
})

test('recipientRoleFor falls back to opposing counsel for a waiting-on client-counsel gap', () => {
  assert.equal(recipientRoleFor('draft_follow_up', { waitingOn: 'Opposing counsel' }), 'opposingCounsel')
})
