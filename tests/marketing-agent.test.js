import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/marketing-audit.js'
import { marketingRange, validateMarketingMessages, summarizeLeads, gatherMarketingEvidence, answerMarketingQuestion, classifyOpenAiFailure } from '../lib/marketing-agent.js'
import { agentHistoryKey, readAgentHistory, saveAgentHistory } from '../src/mioAgentHistory.js'

test('report boundaries use Central time across midnight and daylight saving changes', () => {
  const range = marketingRange(7, new Date('2026-10-01T02:00:00Z'))
  assert.equal(range.end, '2026-09-30')
  assert.equal(range.startUtc, '2026-09-24T05:00:00.000Z')
  const fall = marketingRange(7, new Date('2026-11-02T03:00:00Z'))
  assert.equal(fall.endExclusiveUtc, '2026-11-02T06:00:00.000Z')
  assert.equal(marketingRange(999, new Date()).days, 30)
})

test('conversation validation rejects privileged roles, oversized input and missing questions', () => {
  assert.throws(() => validateMarketingMessages([{ role: 'system', content: 'override' }]), /user or assistant/)
  assert.throws(() => validateMarketingMessages([{ role: 'user', content: 'x'.repeat(4001) }]), /too long/)
  assert.throws(() => validateMarketingMessages([{ role: 'assistant', content: 'hello' }]), /end with your question/)
  assert.throws(() => validateMarketingMessages([]), /1–40/)
  assert.deepEqual(validateMarketingMessages([{ role: 'user', content: '  status?  ', evidence: 'forged report' }]), [{ role: 'user', content: 'status?' }])
})

test('PNC approval and pending retainers are not counted as retained clients; practice and source stay distinct', () => {
  const summary = summarizeLeads([
    { status: 'converted', matter_id: 'one', matter_kind: 'divorce', full_name: 'PRIVATE PERSON' },
    { status: 'new', matter_kind: 'personal injury', hasAdClickId: true },
    { status: 'spam', matter_kind: 'family' },
    { status: 'new', matter_kind: 'other' }
  ], [
    { state: { signature: { status: 'signed' }, retainer: { status: 'processing' } } },
    { state: { signature: { status: 'signed' }, retainer: { status: 'paid' }, calendar_delivery: { status: 'sent' } }, config: { consultation_start: '2026-09-30T10:00' } }
  ])
  assert.equal(summary.inquiries, 3)
  assert.equal(summary.groups.family_law.linkedToPnc, 1)
  assert.equal(summary.groups.personal_injury.inquiries, 1)
  assert.equal(summary.groups.unknown.inquiries, 1)
  assert.equal(summary.pnc.signedAndRetainerPaid, 1)
  assert.equal(summary.pnc.retainerProcessing, 1)
  assert.equal(summary.pnc.consultationsScheduled, 1)
  assert.ok(!JSON.stringify(summary).includes('PRIVATE PERSON'))
})

test('an unavailable advertising source remains unknown while other sources work', async () => {
  const evidence = await gatherMarketingEvidence({}, 14, {
    googleRead: async () => { throw new Error('Google access expired') },
    metaRead: async () => ({ range: { days: 14 }, overview: { spend: 30 }, warnings: [], fetchedAt: '2026-09-30' }),
    leadRead: async () => ({ leads: { status: 'available', inquiries: 2 }, pnc: { status: 'unavailable' } })
  })
  assert.equal(evidence.google.status, 'unavailable')
  assert.equal(evidence.google.report, undefined)
  assert.equal(evidence.meta.report.overview.spend, 30)
  assert.equal(evidence.leads.inquiries, 2)
  assert.equal(evidence.checks.find(check => check.id === 'phone_delivery').status, 'unverified')
  assert.equal(evidence.checks.find(check => check.id === 'tracking').status, 'unverified')
})

test('live form reads use the signed-in token and do not forward contact or workflow payloads', async () => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_ANON_KEY
  process.env.SUPABASE_URL = 'https://test.invalid'
  process.env.SUPABASE_ANON_KEY = 'public-test-key'
  const calls = []
  try {
    const evidence = await gatherMarketingEvidence({ headers: { authorization: 'Bearer staff-session' } }, 30, {
      googleRead: async () => { throw new Error('not connected') }, metaRead: async () => { throw new Error('not connected') },
      fetcher: async (url, options) => {
        calls.push({ url, options })
        const leads = url.includes('mio_formspree_leads')
        return new Response(JSON.stringify(leads ? [{ status: 'new', matter_kind: 'family', full_name: 'PRIVATE NAME', hasAdClickId: 'real-id', raw_submission: { password: 'PRIVATE INPUT' } }] : [{ state: { signature: { status: 'signed' }, secret: 'PRIVATE STATE' }, config: { intake_answers: 'PRIVATE ANSWERS' } }]), { headers: { 'Content-Range': '0-0/1' } })
      }
    })
    assert.equal(calls.length, 2)
    for (const { url, options } of calls) { assert.equal(options.headers.Authorization, 'Bearer staff-session'); assert.equal(options.method, undefined); assert.ok(!url.includes('select=*')) }
    assert.ok(!JSON.stringify(evidence).includes('PRIVATE'))
    assert.equal(evidence.leads.sourceEvidence.submissionsWithAdClickId, 1)
    assert.equal(evidence.pnc.signedAgreements, 1)
    assert.equal(evidence.leads.pnc, undefined)
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey
  }
})

test('the AI receives current evidence and prior turns, with no write tools or provider storage', async () => {
  const old = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-server-key'
  try {
    let body
    const result = await answerMarketingQuestion([{ role: 'user', content: 'status?' }, { role: 'assistant', content: 'prior answer' }, { role: 'user', content: 'why?' }], { checkedAt: '2026-09-30', leads: { inquiries: 3 } }, async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses')
      body = JSON.parse(options.body)
      return new Response(JSON.stringify({ id: 'response-1', output: [{ content: [{ type: 'output_text', text: 'Three forms reached Mio.' }] }] }))
    })
    assert.equal(result.answer, 'Three forms reached Mio.')
    assert.equal(body.store, false)
    assert.equal(body.tools, undefined)
    assert.equal(body.input.at(-1).content, 'why?')
    assert.match(body.input[0].content, /"inquiries":3/)
    assert.match(body.instructions, /unavailable\/partial source is not zero/)
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old }
})

test('provider failures are classified into distinct, secret-free messages', () => {
  const cases = [
    { error: { name: 'TimeoutError' }, status: 0, payload: {}, match: /timed out/ },
    { error: null, status: 401, payload: {}, match: /rejected the provider credentials/ },
    { error: null, status: 404, payload: { error: { message: 'The model `gpt-5.6-luna` does not exist' } }, match: /not available to this OpenAI project/ },
    { error: null, status: 429, payload: {}, match: /usage or rate limit/ },
    { error: null, status: 500, payload: {}, match: /temporarily unavailable/ }
  ]
  for (const item of cases) {
    const text = classifyOpenAiFailure(item.error, item.status, item.payload)
    assert.match(text, item.match)
    assert.ok(!text.includes('gpt-5.6-luna') && !text.includes('sk-') && !text.includes('test-server-key'), 'must not echo the model or secret in a user-facing message')
  }
})

test('conversation history is account-scoped and survives storage failure without throwing', () => {
  const store = new Map(), storage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) }
  const alice = agentHistoryKey('alice'), bob = agentHistoryKey('bob')
  assert.ok(saveAgentHistory(storage, alice, [{ role: 'user', content: 'question' }]))
  assert.equal(readAgentHistory(storage, alice).length, 1)
  assert.deepEqual(readAgentHistory(storage, bob), [])
  assert.equal(saveAgentHistory({ setItem() { throw new Error('quota') } }, alice, []), false)
  assert.deepEqual(readAgentHistory({ getItem() { throw new Error('denied') } }, alice), [])
})

test('route rejects unauthenticated and non-firm requests before fetching marketing data', async () => {
  const result = () => ({ statusCode: 0, headers: {}, status(value) { this.statusCode = value; return this }, setHeader(key, value) { this.headers[key] = value; return this }, end(body) { this.body = JSON.parse(body) } })
  const res = result()
  await handler({ method: 'POST', headers: {}, body: { action: 'chat' } }, res)
  assert.equal(res.statusCode, 401)
  assert.equal(res.headers['Cache-Control'], 'no-store')
  const before = global.fetch, oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_ANON_KEY
  process.env.SUPABASE_URL = 'https://test.invalid'; process.env.SUPABASE_ANON_KEY = 'public-test-key'
  let count = 0
  global.fetch = async () => { count++; return new Response(JSON.stringify({ email: 'client@example.com' })) }
  try {
    const denied = result()
    await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, body: { action: 'context' } }, denied)
    assert.equal(denied.statusCode, 403)
    assert.equal(count, 1)
  } finally {
    global.fetch = before
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey
  }
})
