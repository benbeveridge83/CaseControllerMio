import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {applyWorkDashboardMount} from '../mio-work-dashboard-mount.js'
const source=fs.readFileSync('src/App.jsx','utf8')
const code=applyWorkDashboardMount(source)
const nativeFunction=name=>{const start=code.indexOf(`  function ${name}(`);assert.ok(start>=0,name);const end=code.indexOf('\n  function ',start+10);return code.slice(start,end)}
test('dashboard billing identity follows the form and cannot leak into daily or generic entries',()=>{
 const context={page:'dashboard',mioDeskActiveRowRef:{current:{key:'settings:e1',matterId:'m1'}},mioDeskBillingOriginRef:{current:null},currentBillingUserId:()=> 'u1',billingMatterStatus:()=> 'Open',rateForBilling:()=>300,setShowBillingWindow:()=>{},setDailyBillingDate:()=>{},setShowDailyBillingWindow:()=>{},firmDate:()=> '2026-11-15'}
 context.setBillingForm=value=>{context.form=typeof value==='function'?value(context.form):value}
 vm.runInNewContext(nativeFunction('openBillingWindow')+'\n'+nativeFunction('openDailyBillingWindow')+'\nthis.open=openBillingWindow;this.daily=openDailyBillingWindow',context)
 context.open({matter_id:'m1'})
 assert.equal(context.form.dashboard_task_key,'settings:e1')
 context.daily('2026-11-15');assert.equal(context.form.dashboard_task_key,undefined)
 context.mioDeskActiveRowRef.current=null;context.open({matter_id:'m1'});assert.ok(!context.form.dashboard_task_key)
})
test('dashboard mount remains staff only and native order selection is by exact id',()=>{
 assert.ok(code.includes("canOpenPage('dashboard') && isFirmStaffMember()"))
 assert.ok(code.includes('String(row.id)===String(focusedOrderId)'))
 assert.throws(()=>applyWorkDashboardMount(code),/already mounted/)
})

test('dashboard evaluates saved withdrawal workflows with its actual imported bindings',async()=>{
 const bindings={}
 for(const match of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.\/mio(?:WorkflowBlocks|WithdrawalWorkflow)\.js)['"]/g)){
  const module=await import(new URL('../src/'+match[2].slice(2),import.meta.url))
  for(const specifier of match[1].split(',')){const [name,alias]=specifier.trim().split(/\s+as\s+/);bindings[alias||name]=module[name]}
 }
 const state={status:'active',definition:{steps:[{id:'drafting',name:'Prepare withdrawal motion',input_slots:[]}]},steps:{drafting:{status:'needs_action',attention_since:'2026-11-16T10:00:00Z'}}}
 const context={...bindings,canOpenPage:()=>true,withdrawalMatters:[{id:'m1'}],mioWithdrawalSnapshot:{rows:{m1:{state}}},matters:[{id:'m1',name:'Saved withdrawal matter'}]}
 vm.runInNewContext(nativeFunction('mioDeskWithdrawals')+'\nthis.getWithdrawals=mioDeskWithdrawals',context)
 let result=context.getWithdrawals()
 assert.equal(result[0].status,'Needs action')
 assert.equal(result[0].next,'Prepare withdrawal motion')
 state.steps.drafting={status:'waiting',waiting_on:'Client signature'}
 result=context.getWithdrawals();assert.equal(result[0].status,'Waiting');assert.equal(result[0].next,'Client signature')
 state.status='complete';assert.equal(context.getWithdrawals()[0].status,'Complete')
 state.status='active';state.paused=true;assert.equal(context.getWithdrawals()[0].status,'Paused')
})
