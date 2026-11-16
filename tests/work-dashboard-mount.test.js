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
