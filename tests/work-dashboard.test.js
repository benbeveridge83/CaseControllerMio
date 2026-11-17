import test from 'node:test'
import assert from 'node:assert/strict'
import { billingMarker, workedToday, weekStart, taskMessages, messageKey, periodSummary,linkedThreadRecords } from '../src/dashboard/model.js'

const row={key:'settings:e1',kind:'settings',sourceId:'e1',matterId:'m1',title:'Temporary orders',event:{id:'e1'}}
test('worked today belongs to the exact row, current billing user and work date',()=>{
 const entry={id:'b1',matter_id:'m1',user_id:'u1',date:'2026-11-15',billing_time:.3,matter_step:billingMarker(row)}
 assert.equal(workedToday(row,[entry],'2026-11-15','u1'),true)
 assert.equal(workedToday({...row,sourceId:'e2',key:'settings:e2'},[entry],'2026-11-15','u1'),false)
 assert.equal(workedToday(row,[entry],'2026-11-16','u1'),false)
 assert.equal(workedToday(row,[{...entry,user_id:'u2'}],'2026-11-15','u1'),false)
 assert.equal(workedToday(row,[{...entry,deleted_at:'x'}],'2026-11-15','u1'),false)
 assert.equal(workedToday(row,[{...entry,entry_type:'expense'}],'2026-11-15','u1'),false)
 assert.equal(workedToday(row,[{...entry,do_not_bill:true}],'2026-11-15','u1'),true)
 assert.equal(workedToday(row,[{...entry,dashboard_save_state:'failed'}],'2026-11-15','u1'),false)
 assert.equal(workedToday(row,[{...entry,dashboard_save_state:'pending'}],'2026-11-15','u1'),false)
})
test('Monday week start is correct on Sunday and across year boundaries',()=>{
 assert.equal(weekStart('2026-11-15'),'2026-11-09')
 assert.equal(weekStart('2027-01-01'),'2026-12-28')
})
test('mail follows matter and task category, inherits linked conversations, never pools ambiguous counsel',()=>{
 const rows=[row,{...row,key:'orders:o1',kind:'orders',sourceId:'o1'}, {...row,key:'settings:e2',sourceId:'e2',title:'Mediation',event:{id:'e2'}}]
 const messages=[
  {id:'a',accountEmail:'ben@firm.test',conversationId:'t',categories:['settings'],matches:[{matterId:'m1'}],subject:'Temporary orders hearing'},
  {id:'b',accountEmail:'ben@firm.test',conversationId:'t',categories:['general'],matches:[],subject:'Re: dates'},
  {id:'c',accountEmail:'ben@firm.test',categories:['orders'],matches:[{matterId:'m1'}]},
  {id:'d',accountEmail:'ben@firm.test',categories:['settings'],matches:[{matterId:'m1'},{matterId:'m2'}]},
 ]
 assert.deepEqual(taskMessages(row,messages,rows).map(m=>m.id),['a','b'])
 assert.deepEqual(taskMessages(rows[2],messages,rows).map(m=>m.id),[])
 assert.deepEqual(taskMessages(rows[1],messages,rows).map(m=>m.id),['c'])
 assert.notEqual(messageKey({id:'a',accountEmail:'ben'}),messageKey({id:'a',accountEmail:'service'}))
})
test('a week allocates matter trust once and excludes expenses from earned time',()=>{
 const entries=[{id:'a',date:'2026-11-09',matter_id:'m1',user_id:'u1',billing_time:1,rate:300}, {id:'b',date:'2026-11-10',matter_id:'m1',user_id:'u1',billing_time:1,rate:300}, {id:'c',entry_type:'expense',date:'2026-11-10',matter_id:'m1',user_id:'u1',amount:500}]
 const result=periodSummary({from:'2026-11-09',to:'2026-11-15',entries,matters:[{id:'m1',matter_type:'Family'}],userId:'u1',financeFor:()=>({trust:400,wip:600,outstanding:0,uninvoicedEntries:entries,serviceInvoices:[]})})
 assert.equal(result.total,60000)
 assert.equal(result.covered,40000)
 assert.equal(result.hours,2)
})

test('native linked threads use mailbox_email, include replies and ignore empty compose boxes',()=>{
 const linked=[{id:'empty',thread_messages:[]},{id:'linked',mailbox_email:'Ben@Firm.Test',outlook_conversation_id:'native',outlook_message_id:'original'}]
 assert.deepEqual(linkedThreadRecords(linked).map(e=>e.id),['linked'])
 const nativeRow={...row,linkedEmails:linkedThreadRecords(linked)}
 const reply={id:'reply',accountEmail:'ben@firm.test',conversationId:'native',categories:['general'],matches:[]}
 assert.deepEqual(taskMessages(nativeRow,[reply],[nativeRow]).map(m=>m.id),['reply'])
})

test('client labels resolve joined and separately loaded records instead of case numbers',async()=>{
 const {clientNameForMatter}=await import('../src/dashboard/model.js')
 assert.equal(clientNameForMatter({name:'Divorce 123',clients:{first_name:'Jane',last_name:'Adams'}}),'Jane Adams')
 assert.equal(clientNameForMatter({name:'SAPCR 456',client_id:'c1'},[{id:'c1',first_name:'Brent',last_name:'Bay'}]),'Brent Bay')
 assert.equal(clientNameForMatter({clients:[{first_name:'Nayelly',last_name:'Garcia'}]}),'Nayelly Garcia')
 assert.equal(clientNameForMatter({name:'Divorce 123'}),'Client not linked')
})

test('withdrawal bill history uses the latest three actual sends for the same matter',async()=>{
 const {recentBillSends}=await import('../src/dashboard/model.js')
 const invoices=[
  {id:'i1',matter_id:'m1',invoice_number:'INV-1',issue_date:'2026-10-01',emailed_at:'2026-11-03T16:00:00Z',email_history:[{sent_at:'2026-11-01T16:00:00Z'},{sent_at:'2026-11-03T16:00:00Z'}]},
  {id:'i2',matter_id:'m1',invoice_number:'INV-2',issue_date:'2026-11-05',email_history:[{sent_at:'2026-11-06T16:00:00Z'},{sent_at:'2026-11-07T16:00:00Z',status:'failed'},{sent_at:'invalid'}]},
  {id:'draft',matter_id:'m1',issue_date:'2026-11-17',updated_at:'2026-11-17T16:00:00Z'},
  {id:'trust',matter_id:'m1',invoice_type:'trust_request',emailed_at:'2026-11-17T16:00:00Z'},
  {id:'other',matter_id:'m2',emailed_at:'2026-11-17T16:00:00Z'}
 ]
 const sends=recentBillSends('m1',invoices)
 assert.deepEqual(sends.map(s=>s.invoiceNumber),['INV-2','INV-1','INV-1'])
 assert.deepEqual(sends.map(s=>s.sentAt),['2026-11-06T16:00:00Z','2026-11-03T16:00:00Z','2026-11-01T16:00:00Z'])
 assert.equal(sends[0].issueDate,'2026-11-05')
 assert.deepEqual(recentBillSends('m3',invoices),[])
 invoices.push({id:'latest',matter_id:'m1',emailed_at:'2026-11-16T16:00:00Z'})
 assert.equal(recentBillSends('m1',invoices).length,3)
 assert.equal(recentBillSends('m1',invoices)[0].invoiceId,'latest')
})
