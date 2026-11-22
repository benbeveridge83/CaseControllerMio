import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../lib/efiling/tylerCallbackGateway.js'

function invoke(method, body = undefined) {
  const headers = {}
  const res = {
    statusCode: 200,
    body: undefined,
    setHeader(key, value) { headers[key.toLowerCase()] = value; return this },
    status(code) { this.statusCode = code; return this },
    json(value) { this.body = value; return this },
    end() { return this },
  }
  return handler({ method, body }, res).then(() => ({ ...res, headers }))
}

test('health response discloses that Stage callbacks are NOT activated', async () => {
  const res = await invoke('GET')
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.acceptsNotifications, false)
  assert.equal(res.body.stageActivated, false)
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('all incoming callbacks are rejected before any vendor signature protocol is verified', async () => {
  const res = await invoke('POST', '<untrusted><matterId>123</matterId></untrusted>')
  assert.equal(res.statusCode, 503)
  assert.equal(res.body.code, 'TYLER_CALLBACK_NOT_ACTIVATED')
  assert.equal(res.headers['retry-after'], '3600')
  assert.doesNotMatch(JSON.stringify(res.body), /matterId|123|untrusted/)
})

test('unsupported methods are rejected', async () => {
  const res = await invoke('PUT')
  assert.equal(res.statusCode, 405)
  assert.equal(res.headers.allow, 'GET, HEAD, POST')
})

test('HEAD returns only headers', async () => {
  const res = await invoke('HEAD')
  assert.equal(res.statusCode, 200)
  assert.equal(res.body, undefined)
})
