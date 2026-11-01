import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAuthorizationUrl, exchangeCodeForToken, refreshAccessToken, normalizeTokenResponse } from '../lib/paralegal/microsoft/oauth.js'
import { graphRequest, sendMail } from '../lib/paralegal/microsoft/graph.js'
import { signOAuthState, verifyOAuthState } from '../lib/paralegal/microsoft/state.js'
import { createMicrosoftTokenStore } from '../lib/paralegal/microsoft/tokenStore.js'

function mockFetch(handler) {
  return async (url, init = {}) => {
    const result = handler(url, init)
    const text = result.json !== undefined ? JSON.stringify(result.json) : (result.text ?? '')
    return {
      ok: result.ok !== false,
      status: result.status || 200,
      json: async () => result.json ?? {},
      text: async () => text
    }
  }
}

test('buildAuthorizationUrl includes client_id, redirect_uri, scopes, and state', () => {
  const url = new URL(buildAuthorizationUrl({ clientId: 'cid', redirectUri: 'https://x/cb', scopes: ['Mail.ReadWrite'], state: 'abc' }))
  assert.equal(url.hostname, 'login.microsoftonline.com')
  assert.equal(url.searchParams.get('client_id'), 'cid')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://x/cb')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('scope'), 'Mail.ReadWrite')
  assert.equal(url.searchParams.get('state'), 'abc')
})

test('exchangeCodeForToken posts the authorization code and returns tokens', async () => {
  const fetchImpl = mockFetch((url, init) => {
    assert.match(url, /oauth2\/v2\.0\/token/)
    assert.equal(init.method, 'POST')
    const body = new URLSearchParams(init.body)
    assert.equal(body.get('grant_type'), 'authorization_code')
    assert.equal(body.get('code'), 'c')
    return { ok: true, status: 200, json: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } }
  })
  const data = await exchangeCodeForToken({ clientId: 'cid', clientSecret: 'cs', redirectUri: 'https://x/cb', code: 'c', fetchImpl })
  assert.equal(data.access_token, 'at')
})

test('exchangeCodeForToken surfaces an upstream error description', async () => {
  const fetchImpl = mockFetch(() => ({ ok: false, status: 400, json: { error: 'invalid_grant', error_description: 'bad code' } }))
  await assert.rejects(
    exchangeCodeForToken({ clientId: 'c', clientSecret: 's', redirectUri: 'r', code: 'x', fetchImpl }),
    /bad code/
  )
})

test('refreshAccessToken uses the refresh_token grant', async () => {
  const fetchImpl = mockFetch((url, init) => {
    const body = new URLSearchParams(init.body)
    assert.equal(body.get('grant_type'), 'refresh_token')
    return { ok: true, status: 200, json: { access_token: 'new_at', expires_in: 3600 } }
  })
  const data = await refreshAccessToken({ clientId: 'c', clientSecret: 's', refreshToken: 'rt', fetchImpl })
  assert.equal(data.access_token, 'new_at')
})

test('normalizeTokenResponse computes expiresAt and scopes', () => {
  const token = normalizeTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'Mail.ReadWrite Mail.Send' }, { accountEmail: 'ben@beveridgelawfirm.com' })
  assert.equal(token.accessToken, 'at')
  assert.equal(token.accountEmail, 'ben@beveridgelawfirm.com')
  assert.ok(token.expiresAt)
  assert.deepEqual(token.scopes, ['Mail.ReadWrite', 'Mail.Send'])
})

test('graphRequest sends a bearer token and returns parsed JSON', async () => {
  const fetchImpl = mockFetch((url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer tok')
    return { ok: true, status: 200, json: { value: [] } }
  })
  const { status, data } = await graphRequest({ accessToken: 'tok', path: '/me/messages', fetchImpl })
  assert.equal(status, 200)
  assert.deepEqual(data, { value: [] })
})

test('graphRequest surfaces the upstream error message', async () => {
  const fetchImpl = mockFetch(() => ({ ok: false, status: 401, json: { error: { message: 'Unauthorized' } } }))
  await assert.rejects(graphRequest({ accessToken: 'x', path: '/me', fetchImpl }), /Unauthorized/)
})

test('sendMail posts to /me/sendMail with saveToSentItems', async () => {
  let captured
  const fetchImpl = mockFetch((url, init) => {
    assert.match(url, /\/me\/sendMail$/)
    captured = JSON.parse(init.body)
    return { ok: true, status: 202, json: {} }
  })
  const { status } = await sendMail({ accessToken: 't', message: { subject: 's', body: { contentType: 'Text', content: 'hi' } }, fetchImpl })
  assert.equal(status, 202)
  assert.equal(captured.saveToSentItems, true)
  assert.equal(captured.message.subject, 's')
})

test('OAuth state round-trips and rejects tampering', () => {
  const secret = 's3cret'
  const value = signOAuthState({ userId: 'u1' }, secret)
  assert.deepEqual(verifyOAuthState(value, secret), { userId: 'u1' })
  assert.equal(verifyOAuthState(value + 'x', secret), null)
  assert.equal(verifyOAuthState(value, 'wrong'), null)
})

test('token store requires service role configuration', () => {
  assert.throws(() => createMicrosoftTokenStore({ url: '', serviceKey: '', env: {} }), /service role/)
})

test('token store save/load/remove round-trips', async () => {
  let stored = null
  const db = {
    from: (table) => {
      assert.equal(table, 'mio_microsoft_tokens')
      return {
        upsert: async (row) => { stored = row; return { error: null } },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored, error: null }) }) }),
        delete: () => ({ eq: async () => { stored = null; return { error: null } } })
      }
    }
  }
  const store = createMicrosoftTokenStore({ url: 'u', serviceKey: 'k', supabase: db })
  await store.save('user1', { accessToken: 'at', refreshToken: 'rt', scopes: ['Mail.ReadWrite'], accountEmail: 'x@y.com' })
  const loaded = await store.load('user1')
  assert.equal(loaded.accessToken, 'at')
  assert.equal(loaded.accountEmail, 'x@y.com')
  assert.deepEqual(loaded.scopes, ['Mail.ReadWrite'])
  await store.remove('user1')
  assert.equal(await store.load('user1'), null)
})

