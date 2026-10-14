import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePersonal, personalGuidance, saveDiscoveryValue, PERSONAL_KEY } from '../src/discovery/personal.js'
import { mergeAiDrafts, invalidateAiDrafts, collectAnnotations } from '../src/discovery/drafts.js'
import { citationText } from '../src/discovery/model.js'

const rule = { id:'my-rule', title:'General bases', type:'roggs', enabled:true, exampleRequest:'State every fact.', exampleObjection:'Do not require marshaling all evidence.', examplePrivilege:'', recognitionGuidance:'Distinguish general bases from all trial evidence.', responseGuidance:'Respond with a concise factual outline.', authorities:['trcp197'] }

test('saved rules filter by enabled status and discovery type while keeping general style', () => {
  const profile = normalizePersonal({styleInstructions:'Use short sentences.', rules:[rule,{...rule,id:'disabled',enabled:false},{...rule,id:'other',type:'rfa'}]})
  const guidance = personalGuidance(profile,['roggs'])
  assert.deepEqual(guidance.rules.map(r=>r.id),['my-rule'])
  assert.equal(guidance.styleInstructions,'Use short sentences.')
  assert.throws(()=>normalizePersonal({rules:[{...rule,authorities:['invented'] }]}),/authority/i)
  assert.throws(()=>normalizePersonal({rules:[rule,rule]}),/duplicate/i)
  assert.throws(()=>normalizePersonal({styleInstructions:'x'.repeat(6001),rules:[]}),/long|limit/i)
})

test('saving personal guidance requires the correct ready account and cloud acknowledgement', async () => {
  const calls=[]
  const store={status:()=>({owner:'ben',phase:'ready'}),saveNow:async(...args)=>{calls.push(args);return true}}
  await saveDiscoveryValue(store,'ben',PERSONAL_KEY,normalizePersonal({rules:[rule]}))
  assert.equal(calls[0][0],PERSONAL_KEY)
  assert.equal(JSON.parse(calls[0][1]).rules[0].id,'my-rule')
  await assert.rejects(saveDiscoveryValue(store,'other',PERSONAL_KEY,{}),/account/i)
  store.saveNow=async()=>false
  await assert.rejects(saveDiscoveryValue(store,'ben',PERSONAL_KEY,{}),/save|acknowledge/i)
})

test('manual objection and privilege survive AI proper assessment and remain independently exportable', () => {
  const drafts={r1:{objection:{text:'My specific objection.',origin:'manual',selected:true,strength:65},privilege:{text:'My privilege assertion.',origin:'manual',selected:true,strength:90}}}
  const after=mergeAiDrafts(drafts,[{id:'r1',assessment:'proper',objection:'',privilege:'',authorities:['trcp192-scope'],privilegeAuthorities:[]}])
  assert.deepEqual(after.r1,drafts.r1)
  assert.deepEqual(invalidateAiDrafts({...after,r2:{objection:{text:'AI text',origin:'ai',selected:true}}}),drafts)
  const out=collectAnnotations([{id:'r1'}],after)
  assert.equal(out.objections[0].text,'My specific objection.')
  assert.equal(out.privileges[0].text,'My privilege assertion.')
  assert.throws(()=>collectAnnotations([{id:'r1'}],{r1:{objection:{text:'[confirm facts]',selected:true}}}),/placeholder/i)
})

test('citations explain the proposition and qualify the 25-interrogatory limit by discovery level', () => {
  const citation=citationText(['trcp190'])
  assert.match(citation,/25/)
  assert.match(citation,/Level 2/)
  assert.match(citation,/discrete subparts|subpart/)
  assert.match(citationText(['tre503']),/confidential|legal services/)
})

test('chat saves do not enter the generic merge for independent record lists',async()=>{
  const {CHAT_KEY}=await import('../src/discovery/personal.js')
  const {repairMioCloudConflict}=await import('../src/mioCloudConflictRepair.js')
  const saved=[]
  const store={status:()=>({owner:'ben',phase:'ready'}),saveNow:async(key,raw)=>{saved.push(raw);return true}}
  await saveDiscoveryValue(store,'ben',CHAT_KEY,[])
  await saveDiscoveryValue(store,'ben',CHAT_KEY,[{id:'local',role:'user',content:'Local question.'}])
  await saveDiscoveryValue(store,'ben',CHAT_KEY,[{id:'remote',role:'user',content:'Remote question.'}])
  assert.equal(repairMioCloudConflict({baselineRaw:saved[0],localRaw:saved[1],remoteRaw:saved[2],deleting:false}),undefined,'Divergent chat turns must remain a strict conflict, not become consecutive user messages')
})

test('pending personal guidance is recoverable but never presented to AI as acknowledged',async()=>{
  const personalModule=await import('../src/discovery/personal.js')
  const confirmed=normalizePersonal({styleInstructions:'Confirmed style.',rules:[]})
  const pending=normalizePersonal({styleInstructions:'Unacknowledged edit.',rules:[rule]})
  const store={status:()=>({owner:'ben',phase:'ready',pendingKeys:[PERSONAL_KEY]}),storage:{getItem:()=>JSON.stringify(pending)},confirmedRecords:()=>[{key:PERSONAL_KEY,raw_value:JSON.stringify(confirmed)}]}
  const state=personalModule.loadPersonalState(store)
  assert.equal(state.profile.styleInstructions,'Confirmed style.')
  assert.equal(state.draft.styleInstructions,'Unacknowledged edit.')
  assert.equal(state.pending,true)
  assert.equal(state.error,'')
  store.confirmedRecords=()=>[]
  assert.equal(personalModule.loadPersonalState(store).profile.styleInstructions,'')
})
