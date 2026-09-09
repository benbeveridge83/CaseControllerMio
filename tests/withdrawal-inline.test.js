import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {newWithdrawal,applyWithdrawalEvent,workflowAttention,sortWithdrawalRows,withdrawalTimeEntries,canCompleteWithdrawal,completionLabels} from '../src/mioWithdrawalWorkspaceState.js'
const at='2026-09-07T12:00:00.000Z',make=()=>newWithdrawal('matter-a',null,at)
const decision={type:'step_update',step_id:'decision',status:'complete',confirmed:true,note:'Reviewed',evidence:{reference:'Attorney decision'}}
test('withdrawal pause is independent from progress, survives signals and excludes needs-me',()=>{
 const initial=applyWithdrawalEvent(make(),decision,at),paused=applyWithdrawalEvent(initial,{type:'workspace_pause',paused:true},at)
 assert.deepEqual(paused.steps,initial.steps);assert.equal(paused.status,'active');assert.equal(workflowAttention(paused).kind,'paused')
 assert.throws(()=>applyWithdrawalEvent(paused,{type:'step_update',step_id:'drafting'}),/Resume/)
 const signal=applyWithdrawalEvent(paused,{type:'email_received',step_id:'decision',message_id:'reply',received_at:at},at)
 assert.equal(signal.paused,true);assert.equal(workflowAttention(signal).needsMe,false)
 const resumed=applyWithdrawalEvent(signal,{type:'workspace_pause',paused:false},at);assert.equal(workflowAttention(resumed).needsMe,true)
})
test('step notes are append-only metadata and never complete a step',()=>{
 const initial=make(),next=applyWithdrawalEvent(initial,{type:'step_note',step_id:'decision',note:' Review balance '},at)
 assert.deepEqual(next.steps,initial.steps);assert.equal(next.workspace_notes[0].note,'Review balance');assert.equal(initial.workspace_notes,undefined)
 assert.throws(()=>applyWithdrawalEvent(initial,{type:'step_note',step_id:'unknown',note:'x'}),/Unknown/)
 assert.throws(()=>applyWithdrawalEvent(initial,{type:'step_note',step_id:'decision',note:' '}),/Enter/)
})
test('template and document connections persist without claiming approval or filing',()=>{
 let s=applyWithdrawalEvent(make(),decision,at)
 s=applyWithdrawalEvent(s,{type:'template_link',step_id:'drafting',template_id:'motion-template'},at)
 s=applyWithdrawalEvent(s,{type:'document_link',step_id:'drafting',document_ids:['doc-a','doc-a','doc-b']},at)
 assert.equal(s.steps.drafting.template_id,'motion-template');assert.deepEqual(s.steps.drafting.document_ids,['doc-a','doc-b']);assert.equal(s.steps.filing.status,'not_started')
 s=applyWithdrawalEvent(s,{...decision,step_id:'drafting'},at);assert.equal(s.steps.filing.status,'needs_action')
 s=applyWithdrawalEvent(s,{type:'document_link',step_id:'filing',document_ids:['pdf-a']},at)
 assert.equal(s.steps.filing.status,'needs_action');assert.throws(()=>applyWithdrawalEvent(s,{type:'document_link',step_id:'drafting',document_ids:[]}),/unfinished/)
 s=applyWithdrawalEvent(s,{type:'efile_update',step_id:'filing',status:'submitted',reference:'envelope-test'},at)
 assert.equal(s.steps.filing.status,'waiting');assert.equal(s.steps.service.status,'not_started');assert.equal(canCompleteWithdrawal(s),false)
})
test('saved draft IDs are retained and require explicit approval',()=>{
 const s=applyWithdrawalEvent(applyWithdrawalEvent(make(),decision,at),{type:'documents_saved',step_id:'drafting',document_ids:['generated-a']},at)
 assert.equal(s.steps.drafting.status,'needs_approval');assert.deepEqual(s.steps.drafting.document_ids,['generated-a']);assert.equal(s.steps.filing.status,'not_started')
 assert.throws(()=>applyWithdrawalEvent(s,{...decision,step_id:'drafting',confirmed:false}),/confirmation/)
})
test('completion gates remain enforced and closed workflows immutable',()=>{
 assert.throws(()=>applyWithdrawalEvent(make(),{...decision,step_id:'close_workflow',historical_confirmed:true}),/requirements/)
 for(const event of [{type:'workspace_pause',paused:false},{type:'step_note',step_id:'decision',note:'x'}])assert.throws(()=>applyWithdrawalEvent({...make(),status:'complete'},event),/closed/)
 assert.match(completionLabels.filing,/acceptance verified/)
})
test('billing entries are matter-specific and paused rows sort last',()=>{
 const entries=[{id:'a',matter_id:'matter-a',matter_step:'Withdrawal - Draft',billing_time:.2},{id:'b',matter_id:'matter-b',matter_step:'Withdrawal - Draft'},{id:'c',matter_id:'matter-a',matter_step:'Other'}]
 assert.deepEqual(withdrawalTimeEntries(entries,'matter-a').map(e=>e.id),['a'])
 const paused=applyWithdrawalEvent(make(),{type:'workspace_pause',paused:true},at)
 assert.equal(sortWithdrawalRows([{matter_id:'paused',state:paused},{matter_id:'active',state:make()}],'attention')[0].matter_id,'active')
})
test('all configured transforms compose with inline detail, document handoff and billing callbacks',async()=>{
 const config=fs.readFileSync(new URL('../vite.config.js',import.meta.url),'utf8'),order=config.split('plugins: [')[1].split('react()')[0]
 const imports=[...config.matchAll(/import (\w+) from '\.\/(mio-[^']+)'/g)].filter(([,n])=>order.includes(n+'()')).sort((a,b)=>order.indexOf(a[1]+'()')-order.indexOf(b[1]+'()'))
 const plugins=await Promise.all(imports.map(async([,,f])=>(await import('../'+f)).default()))
 for(const f of ['App.jsx','MioWithdrawalDashboard.jsx','mioWithdrawalRepository.js']){
  let source=fs.readFileSync(new URL('../src/'+f,import.meta.url),'utf8');for(const p of plugins){const r=await p.transform?.(source,'/repo/src/'+f);source=typeof r==='string'?r:r?.code||source}
  if(f==='App.jsx'){assert.match(source,/Mio V30[4-9]/);assert.match(source,/mioWdPrepareEfile/);assert.match(source,/Return to withdrawal row/);assert.match(source,/matter_step:\"Withdrawal - \"/)}
  if(f==='MioWithdrawalDashboard.jsx'){assert.match(source,/mio-wd-expanded/);assert.match(source,/All withdrawal time entries/);assert.doesNotMatch(source,/Record update \/ evidence/);assert.doesNotMatch(source,/scrollIntoView/)}
  if(f==='mioWithdrawalRepository.js')assert.match(source,/mioWithdrawalBlocksState/)
 }
})
