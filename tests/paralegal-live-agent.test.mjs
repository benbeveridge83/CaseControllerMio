import test from 'node:test'
import assert from 'node:assert/strict'

const claudeModule = await import('../lib/paralegal/claude.js').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})
const snapshotModule = await import('../src/paralegal/need-to-set-snapshot.js').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
  throw error
})

test('normalizes only bounded Need to Set fields for Claude', () => {
  assert.equal(typeof snapshotModule.normalizeNeedToSetSnapshot, 'function')
  const rows = snapshotModule.normalizeNeedToSetSnapshot([{
    id: 'task-1', matterId: 'matter-1', matterName: 'Smith v. Jones', clientName: 'Jane Smith',
    category: 'Temporary Orders', stage: 'Request dates', waitingOn: 'Court', currentStep: 'Email coordinator',
    latestUpdate: 'Asked for dates', nextAction: 'Follow up', ageDays: 3, hasNewEmail: true,
    secretNotes: 'must never leave browser', opposingCounselEmail: 'lawyer@example.com'
  }])
  assert.deepEqual(rows, [{
    id: 'task-1', matterId: 'matter-1', matterName: 'Smith v. Jones', clientName: 'Jane Smith',
    category: 'Temporary Orders', stage: 'Request dates', waitingOn: 'Court', currentStep: 'Email coordinator',
    latestUpdate: 'Asked for dates', nextAction: 'Follow up', ageDays: 3, hasNewEmail: true
  }])
  assert.equal('secretNotes' in rows[0], false)
  assert.equal('opposingCounselEmail' in rows[0], false)
})

test('rejects oversized snapshots rather than silently sending unbounded client data', () => {
  assert.equal(typeof snapshotModule.normalizeNeedToSetSnapshot, 'function')
  const rows = Array.from({length: 201}, (_, i) => ({id:`t-${i}`, matterId:`m-${i}`, matterName:`Matter ${i}`}))
  assert.throws(() => snapshotModule.normalizeNeedToSetSnapshot(rows), /too many/i)
})

test('calls Claude Sonnet 5 with a read-only legal-workflow system prompt and current snapshot', async () => {
  assert.equal(typeof claudeModule.askClaudeParalegal, 'function')
  let request
  const fetchImpl = async (url, options) => {
    request = {url, options, body: JSON.parse(options.body)}
    return {ok:true, json:async()=>({content:[{type:'text',text:'Ellis is waiting on the court for dates.'}],usage:{input_tokens:120,output_tokens:18}})}
  }
  const result = await claudeModule.askClaudeParalegal({
    apiKey:'test-key', fetchImpl,
    message:'Where are we on Ellis?',
    history:[{role:'assistant',content:'What would you like to check?'}],
    snapshot:[{id:'task-1',matterId:'matter-1',matterName:'Ellis',stage:'Request dates',waitingOn:'Court',currentStep:'Email coordinator'}]
  })
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(request.options.headers['x-api-key'], 'test-key')
  assert.equal(request.body.model, 'claude-sonnet-5')
  assert.equal(request.body.temperature, undefined)
  assert.match(request.body.system, /read-only/i)
  assert.match(request.body.system, /do not claim/i)
  assert.equal(request.body.messages.at(-1).role, 'user')
  assert.match(request.body.messages.at(-1).content, /Where are we on Ellis/)
  assert.match(request.body.messages.at(-1).content, /Smith|Ellis/)
  assert.equal(result.text, 'Ellis is waiting on the court for dates.')
  assert.deepEqual(result.usage, {inputTokens:120, outputTokens:18})
})

test('does not leak the API key in upstream error messages', async () => {
  assert.equal(typeof claudeModule.askClaudeParalegal, 'function')
  const fetchImpl = async () => ({ok:false,status:401,json:async()=>({error:{message:'invalid x-api-key test-key'}})})
  await assert.rejects(
    claudeModule.askClaudeParalegal({apiKey:'test-key',fetchImpl,message:'hello',snapshot:[]}),
    (error) => error.code === 'CLAUDE_REQUEST_FAILED' && !String(error.message).includes('test-key')
  )
})

test('client sends the current Supabase session token and normalized snapshot to the server', async () => {
  const clientModule = await import('../src/paralegal/paralegal-client.js').catch((error) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
    throw error
  })
  assert.equal(typeof clientModule.askParalegal, 'function')
  let request
  const fetchImpl = async (url, options) => {
    request = {url, options, body:JSON.parse(options.body)}
    return {ok:true,json:async()=>({ok:true,text:'Status answer',usage:{inputTokens:12,outputTokens:4}})}
  }
  const auth = {getSession:async()=>({data:{session:{access_token:'user-token'}},error:null})}
  const result = await clientModule.askParalegal({auth,fetchImpl,message:'status?',history:[],snapshot:[{id:'t1',matterId:'m1',matterName:'Ellis'}]})
  assert.equal(request.url, '/api/paralegal')
  assert.equal(request.options.headers.Authorization, 'Bearer user-token')
  assert.deepEqual(request.body.snapshot[0].matterName, 'Ellis')
  assert.equal(result.text, 'Status answer')
})

test('server route verifies the Mio user before sending any snapshot to Claude', async () => {
  const routeModule = await import('../api/paralegal.js').catch((error) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {}
    throw error
  })
  assert.equal(typeof routeModule.default, 'function')
  const priorFetch = globalThis.fetch
  const priorValues = {
    SUPABASE_URL:process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY:process.env.SUPABASE_ANON_KEY,
    ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY
  }
  const calls=[]
  globalThis.fetch = async (url, options={}) => {
    calls.push({url:String(url),options})
    if (String(url).includes('/auth/v1/user')) return {ok:true,json:async()=>({id:'u1',email:'ben@beveridgelawfirm.com'})}
    if (String(url).includes('api.anthropic.com')) return {ok:true,json:async()=>({model:'claude-sonnet-5',content:[{type:'text',text:'Ready.'}],usage:{input_tokens:10,output_tokens:2}})}
    throw new Error('unexpected url')
  }
  process.env.SUPABASE_URL='https://example.supabase.co'
  process.env.SUPABASE_ANON_KEY='anon-test'
  process.env.ANTHROPIC_API_KEY='anthropic-test'
  const req={method:'POST',headers:{authorization:'Bearer user-token'},body:{message:'Where are we?',history:[],snapshot:[]}}
  const response={statusCode:0,headers:{},body:'',setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=JSON.stringify(v);return this},end(v=''){this.body=String(v);return this}}
  try {
    await routeModule.default(req,response)
    assert.equal(response.statusCode,200)
    assert.equal(JSON.parse(response.body).text,'Ready.')
    assert.equal(calls.length,2)
    assert.match(calls[0].url,/\/auth\/v1\/user/)
    assert.match(calls[1].url,/api\.anthropic\.com/)
  } finally {
    globalThis.fetch=priorFetch
    for (const [key,value] of Object.entries(priorValues)) {
      if (value === undefined) delete process.env[key]
      else process.env[key]=value
    }
  }
})


test('Vercel preview uses its OIDC token to reach Claude through AI Gateway before direct Anthropic billing', async () => {
  const routeModule = await import('../api/paralegal.js')
  const priorFetch = globalThis.fetch
  const priorValues = {
    SUPABASE_URL:process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY:process.env.SUPABASE_ANON_KEY,
    ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY,
    AI_GATEWAY_API_KEY:process.env.AI_GATEWAY_API_KEY
  }
  const calls=[]
  globalThis.fetch = async (url, options={}) => {
    calls.push({url:String(url),options,body:options.body ? JSON.parse(options.body) : null})
    if (String(url).includes('/auth/v1/user')) return {ok:true,json:async()=>({id:'u1',email:'ben@beveridgelawfirm.com'})}
    if (String(url).includes('ai-gateway.vercel.sh')) return {ok:true,json:async()=>({model:'anthropic/claude-sonnet-5',content:[{type:'text',text:'Gateway ready.'}],usage:{input_tokens:9,output_tokens:2}})}
    throw new Error('unexpected url '+url)
  }
  process.env.SUPABASE_URL='https://example.supabase.co'
  process.env.SUPABASE_ANON_KEY='anon-test'
  process.env.ANTHROPIC_API_KEY='anthropic-without-credits'
  delete process.env.AI_GATEWAY_API_KEY
  const req={method:'POST',headers:{authorization:'Bearer user-token','x-vercel-oidc-token':'vercel-oidc-test'},body:{message:'Where are we?',history:[],snapshot:[]}}
  const response={statusCode:0,headers:{},body:'',setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=JSON.stringify(v);return this},end(v=''){this.body=String(v);return this}}
  try {
    await routeModule.default(req,response)
    assert.equal(response.statusCode,200)
    assert.equal(JSON.parse(response.body).text,'Gateway ready.')
    assert.equal(calls.length,2)
    assert.equal(calls[1].url,'https://ai-gateway.vercel.sh/v1/messages')
    assert.equal(calls[1].options.headers.Authorization,'Bearer vercel-oidc-test')
    assert.equal(calls[1].body.model,'anthropic/claude-sonnet-5')
  } finally {
    globalThis.fetch=priorFetch
    for (const [key,value] of Object.entries(priorValues)) {
      if (value === undefined) delete process.env[key]
      else process.env[key]=value
    }
  }
})
