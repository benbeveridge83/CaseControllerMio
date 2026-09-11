// Exercise the actual full configured pipeline. Do not substitute handcrafted anchors.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const config=fs.readFileSync('vite.config.js','utf8'),order=config.split('plugins: [')[1].split('react()')[0]
const specs=[...config.matchAll(/import (\w+) from '\.\/(mio-[^']+)'/g)].filter(([,name])=>order.includes(name+'()')).sort((a,b)=>order.indexOf(a[1]+'()')-order.indexOf(b[1]+'()'))
const plugins=await Promise.all(specs.map(async([,,file])=>(await import('../'+file)).default()))
export async function transformed(file){let code=fs.readFileSync(file,'utf8');for(const p of plugins){const out=await p.transform?.(code,'/repo/'+file);code=typeof out==='string'?out:out?.code??code}return code}
const app=await transformed('src/App.jsx'),ui=await transformed('src/MioWithdrawalBlocks.jsx'),repo=await transformed('src/mioWithdrawalRepository.js')
const has=(code,text,label)=>assert.ok(code.includes(text),label)
assert.match(app,/Mio V31[1234] \(.*\)/,'Actual app release label')
has(app,"if(step.action==='mailform')",'Mailform action survives Dropbox Sign transform')
has(app,'onMatterStatus={mioWdChangeMatterStatus}','Status callback is passed')
has(ui,'onAction,onMatterStatus,getPeople,','Status callback is declared alongside post-V307 document-source props')
has(ui,'getMatterDocumentSources,onSaveDraftFolder','Document sources retained')
has(ui,'const tableFinance=[...matchingFinance].sort(','Table uses all matching matters')
has(ui,'Review all {matchingFinance.length} matching matters','Count describes full table')
has(ui,'const graphFinance=matchingFinance.slice(0,12)','Graph cap is separate from table')
has(ui,'Save matter status','Status dialog shipped')
has(repo,"event.type==='workflow_complete'?'mio_close_withdrawal_row_v311'",'Row close uses supported server RPC')
has(app,"if(['released','complete'].includes(workflowStatus))return 'not_withdrawing'",'Terminal workflow overrides stale extras')
const release=app.slice(app.indexOf('  async function mioWdRelease(matterId){'),app.indexOf('  async function mioWdPrepareEfile'))
assert.ok(!release.includes('saveMioStateKeyNow'),'Release must not rewrite shared extras')
has(release,'await mioWithdrawalStore.apply','Release awaits durable per-matter save')
console.log('PASS actual configured transforms: Mailform, document sources, all rows, status controls, release and completion adapters')
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mio-withdrawal-test-'))
try{
 fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}')
 for(const file of ['mioStickyFilterValues.js','mioWorkflowBlocks.js','mioWithdrawalBlocksState.js','mioWithdrawalWorkspaceState.js','mioWithdrawalWorkflow.js','mioWithdrawalRepository.js'])fs.writeFileSync(path.join(dir,file),await transformed('src/'+file))
 const {newWithdrawal,applyWithdrawalEvent}=await import(pathToFileURL(path.join(dir,'mioWithdrawalBlocksState.js')))
 const {configureWorkflow,defaultWithdrawalDefinition}=await import(pathToFileURL(path.join(dir,'mioWorkflowBlocks.js')))
 const {createWithdrawalRepository}=await import(pathToFileURL(path.join(dir,'mioWithdrawalRepository.js')))
 const at='2026-09-09T12:00:00.000Z',initial=configureWorkflow(newWithdrawal('test-matter',at,at),defaultWithdrawalDefinition(),at)
 const e={type:'workflow_complete',confirmed:true,note:'Attorney closed tracking only.'}
 assert.throws(()=>applyWithdrawalEvent(initial,{...e,confirmed:false},at),/Confirm/)
 assert.throws(()=>applyWithdrawalEvent({...initial,paused:true},e,at),/Resume/)
 const complete=applyWithdrawalEvent(initial,e,at)
 assert.equal(complete.status,'complete');assert.equal(complete.completion_mode,'manual_row')
 assert.deepEqual(complete.steps,initial.steps);assert.deepEqual(complete.document_slots,initial.document_slots)
 assert.equal(applyWithdrawalEvent(complete,e,at),complete)
 const released=applyWithdrawalEvent(initial,{type:'workflow_release',confirmed:true},at)
 assert.equal(released.status,'released');assert.deepEqual(released.steps,initial.steps)
 assert.throws(()=>applyWithdrawalEvent(initial,{type:'step_update',step_id:'close_workflow',status:'complete',historical_confirmed:true,confirmed:true,evidence:{reference:'Test'}},at),/judge-signed/)
 let record={owner_id:'owner',matter_id:'test-matter',revision:1,state:initial},fail=false
 const client={from(){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:record}),order(){return q},range:async()=>({data:[record]})};return q},async rpc(name,p){assert.equal(name,'mio_close_withdrawal_row_v311');assert.equal(p.p_event.workspace_version,1);if(fail)return{error:{message:'Mock save failed'}};record={...record,revision:record.revision+1,state:p.p_state};return{data:record}}}
 const store=createWithdrawalRepository(client);store.account('owner');await store.load('owner')
 fail=true;await assert.rejects(()=>store.apply('owner','test-matter',e),error=>error.message==='Mock save failed');assert.equal(store.getSnapshot().rows['test-matter'].state.status,'active')
 fail=false;await store.apply('owner','test-matter',e);assert.equal(store.getSnapshot().rows['test-matter'].state.status,'complete')
 const fresh=createWithdrawalRepository(client);fresh.account('owner');await fresh.load('owner');assert.equal(fresh.getSnapshot().rows['test-matter'].state.status,'complete')
 console.log('PASS full transformed reducer/repository: explicit confirmation, no invented evidence, durable acknowledgement, rejected saves, reload')
}finally{fs.rmSync(dir,{recursive:true,force:true})}
