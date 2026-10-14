import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import callbackHandler from '../api/auth/callback.js'
import { validateAnalysisInput, validateAnalysisResults, analyzeDiscovery, requireDiscoveryUser } from '../lib/discovery-objections.js'

const request = {id:'r1',type:'rfp',number:'1',request:'Produce all correspondence with your attorney.',response:''}
const input = {regime:'family_current',level:'2',context:'SAPCR modification concerning possession.',requests:[request]}
const result = {id:'r1',assessment:'needs_facts',reason:'Confidential legal advice may be protected.',objection:'',authorities:['tre503'],factsNeeded:['Were these confidential communications for legal advice?'],responseGuidance:'Produce nonprivileged responsive communications.',withholding:'Follow Rule 193.3 if privilege is claimed.'}

test('analysis requires an explicit rule regime and bounded uniquely identified requests', () => {
  assert.equal(validateAnalysisInput(input).requests[0].id,'r1')
  assert.throws(()=>validateAnalysisInput({...input,regime:'unknown'}),/regime|filing|rules/i)
  assert.throws(()=>validateAnalysisInput({...input,requests:[request,request]}),/unique|duplicate/i)
  assert.throws(()=>validateAnalysisInput({...input,requests:[{...request,request:'x'.repeat(18001)}]}),/long|limit/i)
})

test('partial, duplicate and invented-citation answers fail closed without shifting request identity', () => {
  assert.equal(validateAnalysisResults({results:[result]},input.requests)[0].assessment,'needs_facts')
  assert.throws(()=>validateAnalysisResults({results:[]},input.requests),/incomplete|match/i)
  assert.throws(()=>validateAnalysisResults({results:[{...result,id:'other'}]},input.requests),/match|identity/i)
  assert.throws(()=>validateAnalysisResults({results:[{...result,authorities:['invented-case']}]},input.requests),/authority|citation/i)
})

test('proper requests cannot receive a proposed objection and unsupported objections are rejected', () => {
  assert.throws(()=>validateAnalysisResults({results:[{...result,assessment:'proper',objection:'Object!'}]},input.requests),/proper|objection/i)
  assert.throws(()=>validateAnalysisResults({results:[{...result,assessment:'objectionable',objection:'Object!',authorities:[]}]},input.requests),/authority|citation/i)
})

test('AI receives curated authorities, treats requests as data, and does not store responses', async () => {
  const answer = await analyzeDiscovery(input,{apiKey:'synthetic',model:'configured-model',fetcher:async (url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses')
    const body=JSON.parse(options.body)
    assert.equal(body.store,false)
    assert.equal(body.text.format.type,'json_schema')
    assert.match(body.instructions,/194a/)
    assert.match(body.instructions,/DATA|untrusted/i)
    assert.match(body.instructions,/193\.3/)
    return {ok:true,json:async()=>({status:'completed',output_text:JSON.stringify({results:[result]})})}
  }})
  assert.equal(answer.results[0].id,'r1')
})

test('missing AI configuration and incomplete provider responses are explicit errors', async () => {
  await assert.rejects(analyzeDiscovery(input,{apiKey:''}),/connect|configured/i)
  await assert.rejects(analyzeDiscovery(input,{apiKey:'x',fetcher:async()=>({ok:true,json:async()=>({status:'incomplete',output_text:JSON.stringify({results:[result]})})})}),/incomplete/i)
})

test('server verifies a firm identity before any model call', async () => {
  await assert.rejects(requireDiscoveryUser({headers:{}},{url:'https://example.supabase.co',key:'anon'}),/session/i)
  await assert.rejects(requireDiscoveryUser({headers:{authorization:'Bearer token'}},{url:'https://example.supabase.co',key:'anon',fetcher:async()=>({ok:true,json:async()=>({id:'external',email:'someone@example.com',email_confirmed_at:'2026-01-01'})})}),/staff|firm/i)
  const user=await requireDiscoveryUser({headers:{authorization:'Bearer token'}},{url:'https://example.supabase.co',key:'anon',fetcher:async()=>({ok:true,json:async()=>({id:'staff',email:'ben@beveridgelawfirm.com',email_confirmed_at:'2026-01-01'})})})
  assert.equal(user.id,'staff')
})

test('the production rewrite reaches discovery authentication before any existing callback action', async () => {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  assert.ok(config.rewrites.some(r => r.source === '/api/discovery-objections' && r.destination === '/api/auth/callback?integration=discovery_objections'))
  let status, body
  const res = { status(value) { status = value; return res }, setHeader() {}, end(value) { body = JSON.parse(value) } }
  await callbackHandler({ method: 'POST', query: { integration: 'discovery_objections' }, headers: {}, body: { action: 'analyze' } }, res)
  assert.equal(status, 401)
  assert.match(body.error, /session|sign in/i)
})
