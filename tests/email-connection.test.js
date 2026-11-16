import test from 'node:test'
import assert from 'node:assert/strict'
import { usableEmailToken } from '../lib/email/connection.js'

const account = 'ben@beveridgelawfirm.com'
test('an unconnected mailbox requires no refresh or storage write', async () => {
  assert.equal(await usableEmailToken({ load: async () => null }, 'u', account), null)
})
test('valid access tokens are reused', async () => {
  const token = { accessToken: 'valid', expiresAt: new Date(Date.now() + 3600000).toISOString() }
  assert.equal(await usableEmailToken({ load: async () => token }, 'u', account), token)
})
test('expired tokens are renewed and rotated credentials persisted for the same user', async () => {
  const old = { accessToken: 'old', refreshToken: 'refresh', scopes: ['Mail.Read'], expiresAt: '2020-01-01', displayName: 'Ben' }
  let saved
  const result = await usableEmailToken({ load: async () => old, save: async (...args) => { saved = args } }, 'u', account, {
    env: { MICROSOFT_CLIENT_ID: 'client', MICROSOFT_CLIENT_SECRET: 'secret' },
    refresh: async (args) => {
      assert.equal(args.refreshToken, 'refresh')
      return { access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }
    },
  })
  assert.equal(result.accessToken, 'new')
  assert.equal(result.refreshToken, 'rotated')
  assert.deepEqual(result.scopes, ['Mail.Read'])
  assert.equal(result.displayName, 'Ben')
  assert.deepEqual(saved, ['u', account, result])
})
test('refresh responses without a replacement refresh token preserve the existing token', async () => {
  const result = await usableEmailToken({ load: async () => ({ refreshToken: 'keep' }), save: async () => {} }, 'u', account, { refresh: async () => ({ access_token: 'new', expires_in: 3600 }) })
  assert.equal(result.refreshToken, 'keep')
})
test('revoked Outlook authorization produces an actionable reconnect message without provider details', async () => {
  await assert.rejects(() => usableEmailToken({ load: async () => ({ refreshToken: 'revoked' }) }, 'u', account, { refresh: async () => { throw new Error('sensitive provider response') } }), (err) => err.statusCode === 409 && /Reconnect/.test(err.message) && !/sensitive/.test(err.message))
})
