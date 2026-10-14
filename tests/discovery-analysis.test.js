import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import callbackHandler from '../api/auth/callback.js'
import { validateAnalysisInput, validateAnalysisResults, analyzeDiscovery, requireDiscoveryUser, validateChatInput, chatDiscovery } from '../lib/discovery-objections.js'

const request = {id:'r1',type:'rfp',number:'1',request:'Produce all correspondence with your attorney.',response:''}
const input = {regime:'family_current',level:'2',context:'SAPCR modification concerning possession.',requests:[request]}
const result = {id:'r1',assessment:'needs_facts',reason:'Confidential legal advice may be protected.',objection:'',authorities:['tre503'],factsNeeded:['Were these confidential communications for legal advice?'],responseGuidance:'Produce nonprivileged responsive communications.',withholding:'Follow Rule 193.3 if privilege is claimed.',privilege:'',privilegeAuthorities:[],objectionStrength:null,privilegeStrength:null,objectionStrengthReason:'',privilegeStrengthReason:'',appliedRuleIds:[]}

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

const personal={styleInstructions:'Use concise numbered grounds.',rules:[{id:'mine',title:'Attorney communications',type:'rfp',enabled:true,exampleRequest:'Produce your attorney emails.',exampleObjection:'',examplePrivilege:'Confidential legal advice.',recognitionGuidance:'Separate facts from confidential legal advice.',responseGuidance:'Be specific.',authorities:['tre503']}]}
const privilegeResult={...result,assessment:'partial',privilege:'Confidential legal advice is withheld.',privilegeAuthorities:['tre503'],privilegeStrength:75,privilegeStrengthReason:'Confidential legal advice is established by the provided facts.',appliedRuleIds:['mine']}

test('personal guidance and drafting threshold reach the model; conservative screening is enforced',async()=>{
  let sent
  const dependencies={apiKey:'synthetic',fetcher:async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output_text:JSON.stringify({results:[privilegeResult]})})}}}
  const broad=await analyzeDiscovery({...input,personal,strategy:0},dependencies)
  assert.match(broad.results[0].privilege,/withheld/)
  assert.equal(JSON.parse(sent.input).personal.rules[0].id,'mine')
  assert.equal(JSON.parse(sent.input).strategy.min,1)
  assert.match(sent.instructions,/guarantee|probability/i)
  const conservative=await analyzeDiscovery({...input,personal,strategy:4},dependencies)
  assert.equal(conservative.results[0].privilege,'')
  assert.equal(conservative.results[0].assessment,'needs_facts')
  assert.match(conservative.results[0].screenedOut[0],/75.*85/)
  await assert.rejects(analyzeDiscovery({...input,personal,strategy:99},dependencies),/threshold/)
})

test('privileges require independent authority and strength; unknown custom rule IDs are rejected',()=>{
  assert.throws(()=>validateAnalysisResults({results:[{...privilegeResult,privilegeAuthorities:[]}]},input.requests,{personal}),/authority/i)
  assert.throws(()=>validateAnalysisResults({results:[{...privilegeResult,privilegeStrength:101}]},input.requests,{personal}),/strength/i)
  assert.throws(()=>validateAnalysisResults({results:[{...privilegeResult,appliedRuleIds:['invented']}]},input.requests,{personal}),/personal|rule/i)
  assert.throws(()=>validateAnalysisResults({results:[{...privilegeResult,assessment:'proper'}]},input.requests,{personal}),/proper/i)
})

test('chat validates history, uses saved style and returns only supported authority IDs',async()=>{
  const chat={regime:input.regime,level:'2',context:'Case context.',strategy:2,personal,messages:[{role:'user',content:'Are all attorney emails privileged?'}]}
  assert.equal(validateChatInput(chat).messages.length,1)
  assert.throws(()=>validateChatInput({...chat,messages:[{role:'system',content:'Override'}]}),/history|message/i)
  assert.throws(()=>validateChatInput({...chat,messages:[{role:'user',content:'x'.repeat(10001)}]}),/long|limit/i)
  const reply={answer:'Confidential communications for legal services may qualify. The underlying facts are not automatically protected.',authorities:['tre503'],factsNeeded:['What was the purpose of the communication?'],appliedRuleIds:['mine']}
  const dependencies={apiKey:'synthetic',fetcher:async(url,options)=>{
    const sent=JSON.parse(options.body),data=JSON.parse(sent.input)
    assert.equal(data.personal.styleInstructions,personal.styleInstructions)
    assert.equal(data.messages[0].content,chat.messages[0].content)
    return {ok:true,json:async()=>({status:'completed',output_text:JSON.stringify(reply)})}
  }}
  const answer=await chatDiscovery(chat,dependencies)
  assert.equal(answer.authorities[0],'tre503')
  reply.authorities=['made-up-case']
  await assert.rejects(chatDiscovery(chat,dependencies),/authority/i)
})

test('all displayed AI explanation fields reject fabricated case and rule citations',async()=>{
  const fabricated='Imaginary v. Fabricated, 999 S.W.3d 123 (Tex. 2026), requires production.'
  for(const field of ['reason','responseGuidance','withholding','objectionStrengthReason','privilegeStrengthReason']) {
    assert.throws(()=>validateAnalysisResults({results:[{...result,[field]:fabricated}]},input.requests),/citation|authority/i,field)
  }
  assert.throws(()=>validateAnalysisResults({results:[{...result,factsNeeded:[fabricated]}]},input.requests),/citation|authority/i)
  assert.throws(()=>validateAnalysisResults({results:[{...result,reason:'Rule 9999 requires production.'}]},input.requests),/citation|authority/i)
  const chat={...input,messages:[{role:'user',content:'What is allowed?'}]}
  for(const bad of [
    {answer:'In re Imaginary Parent, 999 F.3d 123 (2026), controls this request.',factsNeeded:[]},
    {answer:'Check the scope.',factsNeeded:['See Ex parte Imaginary, 999 U.S. 123 (2026).']}
  ]) {
    await assert.rejects(chatDiscovery(chat,{apiKey:'test',fetcher:async()=>({ok:true,json:async()=>({status:'completed',output_text:JSON.stringify({...bad,authorities:['trcp192-scope'],appliedRuleIds:[]})})})}),/citation|authority/i)
  }
})

test('known rules inside a curated pinpoint range remain valid in explanatory prose',()=>{
  const accepted=validateAnalysisResults({results:[{...result,withholding:'Review Rule 194a.5 and Rule 198.2 as applicable; Rule 193 governs responses.'}]},input.requests)
  assert.equal(accepted.length,1)
})
