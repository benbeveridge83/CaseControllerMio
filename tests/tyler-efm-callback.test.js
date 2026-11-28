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

test('installing a certificate alone does not activate the POST route', async () => {
  const prevCert = process.env.TYLER_EFM_STAGE_SIGNING_CERT
  const prevAct = process.env.TYLER_EFM_CALLBACK_ACTIVATED
  process.env.TYLER_EFM_STAGE_SIGNING_CERT = '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----'
  delete process.env.TYLER_EFM_CALLBACK_ACTIVATED
  try {
    const res = await invoke('POST', '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"/>')
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'TYLER_CALLBACK_NOT_ACTIVATED')
  } finally {
    if (prevCert === undefined) delete process.env.TYLER_EFM_STAGE_SIGNING_CERT
    else process.env.TYLER_EFM_STAGE_SIGNING_CERT = prevCert
    if (prevAct === undefined) delete process.env.TYLER_EFM_CALLBACK_ACTIVATED
    else process.env.TYLER_EFM_CALLBACK_ACTIVATED = prevAct
  }
})

test('activation alone does not acknowledge until status/recording are Stage-validated', async () => {
  const prevCert = process.env.TYLER_EFM_STAGE_SIGNING_CERT
  const prevAct = process.env.TYLER_EFM_CALLBACK_ACTIVATED
  const prevVal = process.env.TYLER_EFM_CALLBACK_STATUS_VALIDATED
  process.env.TYLER_EFM_STAGE_SIGNING_CERT = '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----'
  process.env.TYLER_EFM_CALLBACK_ACTIVATED = 'true'
  delete process.env.TYLER_EFM_CALLBACK_STATUS_VALIDATED
  try {
    const res = await invoke('POST', '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"/>')
    assert.equal(res.statusCode, 503)
    assert.equal(res.body.code, 'TYLER_CALLBACK_NOT_VALIDATED')
  } finally {
    if (prevCert === undefined) delete process.env.TYLER_EFM_STAGE_SIGNING_CERT
    else process.env.TYLER_EFM_STAGE_SIGNING_CERT = prevCert
    if (prevAct === undefined) delete process.env.TYLER_EFM_CALLBACK_ACTIVATED
    else process.env.TYLER_EFM_CALLBACK_ACTIVATED = prevAct
    if (prevVal === undefined) delete process.env.TYLER_EFM_CALLBACK_STATUS_VALIDATED
    else process.env.TYLER_EFM_CALLBACK_STATUS_VALIDATED = prevVal
  }
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
