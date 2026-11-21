import test from 'node:test'
import assert from 'node:assert/strict'
import {createWeeklyBillingProposal,weeklyBillingDefaults,reconcileWeeklyBillingReview,possibleCrossMatterFunding} from '../src/mioWeeklyBillingModel.js'
import {summarizeWeeklyBillingEntries} from '../src/mioWeeklyBillingData.js'
const rows=[
 {id:'a',name:'Client — Funded',clientId:'client1',wip:200,workOB:300,availableTrust:1000,included:true,shareTrust:true},
 {id:'b',name:'Client — Other',clientId:'client1',wip:180,workOB:400,availableTrust:0,included:true,shareTrust:true},
 {id:'c',name:'Appointed',clientId:'client2',appointed:true,wip:2000,workOB:0,availableTrust:0},
 {id:'d',name:'Other client',clientId:'client3',wip:100,workOB:200,availableTrust:0}
]
test('appointed defaults out and private matters default in',()=>{
 assert.equal(weeklyBillingDefaults(rows[2]).included,false)
 assert.equal(weeklyBillingDefaults(rows[0]).included,true)
})
test('minimum WIP carries forward and only eligible work is invoiced in proposal',()=>{
 const p=createWeeklyBillingProposal({matters:rows,minimumWip:150})
 assert.equal(p.totalWip,380)
 assert.equal(p.matters.find(x=>x.id==='d').workOB,200)
 assert.equal(p.matters.find(x=>x.id==='c').selected,false)
})
test('no cross-matter payment without a verified source authorization',()=>{
 const p=createWeeklyBillingProposal({matters:rows,minimumWip:150})
 assert.equal(p.payments.filter(x=>x.crossMatter).length,0)
 assert.deepEqual(p.payments.map(x=>[x.sourceMatterId,x.destinationMatterId,x.amount]),[['a','a',500]])
})
test('pay own matter first, then other matter, allowing partial payments',()=>{
 const p=createWeeklyBillingProposal({matters:rows,minimumWip:150,authorizations:{a:true}})
 assert.deepEqual(p.payments.map(x=>[x.sourceMatterId,x.destinationMatterId,x.amount]),[['a','a',500],['a','b',500]])
 assert.equal(p.matters.find(x=>x.id==='b').unpaid,80)
})
test('source sharing disabled or destination excluded blocks cross-matter',()=>{
 const noShare=createWeeklyBillingProposal({matters:rows.map(x=>x.id==='a'?{...x,shareTrust:false}:x),authorizations:{a:true}})
 assert.equal(noShare.payments.some(x=>x.crossMatter),false)
 const excluded=createWeeklyBillingProposal({matters:rows.map(x=>x.id==='b'?{...x,included:false}:x),authorizations:{a:true}})
 assert.equal(excluded.payments.some(x=>x.destinationMatterId==='b'),false)
})
test('different client can never receive shared trust',()=>{
 const p=createWeeklyBillingProposal({matters:rows,authorizations:{a:true}})
 assert.equal(p.payments.some(x=>x.destinationMatterId==='d'),false)
})

test('deselected one-run payments restore unpaid work balance without altering future sharing',()=>{
 const proposal=createWeeklyBillingProposal({matters:rows,minimumWip:150,authorizations:{a:true}})
 const preview=reconcileWeeklyBillingReview(proposal,['a:b'])
 assert.equal(preview.totalPayments,500)
 assert.equal(preview.matters.find(m=>m.id==='b').unpaid,580)
 assert.equal(preview.matters.find(m=>m.id==='a').remainingTrust,500)
 assert.equal(proposal.matters.find(m=>m.id==='b').shareTrust,true)
})
test('an excluded appointed matter never triggers a payment or a withdrawal candidate',()=>{
 const proposal=createWeeklyBillingProposal({matters:rows})
 const preview=reconcileWeeklyBillingReview(proposal)
 const appointed=preview.matters.find(m=>m.id==='c')
 assert.equal(appointed.included,false)
 assert.equal(preview.payments.some(p=>p.destinationMatterId==='c'),false)
})

test('cross-matter review identifies a possibility, never an approved transfer',()=>{
 const candidates=possibleCrossMatterFunding([
  {id:'a',name:'Funded',clientId:'same',displayTrust:1000,workOB:300,selectedWip:200,included:true,shareTrust:true},
  {id:'b',name:'Other',clientId:'same',displayTrust:0,workOB:600,selectedWip:0,included:true,shareTrust:true},
  {id:'c',name:'Stranger',clientId:'other',displayTrust:0,workOB:1000,included:true,shareTrust:true}
 ])
 assert.deepEqual(candidates.map(x=>[x.sourceMatterId,x.destinationMatterId,x.amount,x.status]),[['a','b',500,'unverified']])
})
test('isolated matter never shares funds as a source or destination',()=>{
 const candidates=possibleCrossMatterFunding([
  {id:'a',name:'Funded',clientId:'same',displayTrust:1000,workOB:0,included:true,shareTrust:false},
  {id:'b',name:'Other',clientId:'same',displayTrust:0,workOB:600,included:true,shareTrust:true}
 ])
 assert.deepEqual(candidates,[])
})

test('WIP comes only from uninvoiced, billable entries and Work OB excludes trust requests',()=>{
 const summary=summarizeWeeklyBillingEntries([
  {matter_id:'a',amount:110,do_not_bill:false,payload:{}},
  {matter_id:'a',amount:40,do_not_bill:false,payload:{invoice_id:'already-invoiced'}},
  {matter_id:'a',amount:70,do_not_bill:true,payload:{}},
  {matter_id:'b',amount:50,do_not_bill:false,payload:{non_billable:true}}
 ],[
  {matter_id:'a',invoice_type:'services',status:'outstanding',balance:80,issue_date:'2026-01-03'},
  {matter_id:'a',invoice_type:'trust_request',status:'outstanding',balance:500,issue_date:'2025-01-01'},
  {matter_id:'a',invoice_type:'services',status:'paid',balance:100,issue_date:'2025-01-02'},
  {matter_id:'a',invoice_type:'services',status:'draft',balance:60,issue_date:'2025-01-03'}
 ])
 assert.equal(summary.wip.get('a'),11000)
 assert.equal(summary.workOB.get('a'),8000)
 assert.equal(summary.oldestInvoice.get('a'),'2026-01-03')
 assert.equal(summary.wip.get('b'),undefined)
})

test('two funding sources do not double-count the same destination obligation',()=>{
 const candidates=possibleCrossMatterFunding([
  {id:'a',name:'Funded A',clientId:'same',displayTrust:500,workOB:0,included:true,shareTrust:true},
  {id:'b',name:'Funded B',clientId:'same',displayTrust:500,workOB:0,included:true,shareTrust:true},
  {id:'c',name:'Owed C',clientId:'same',displayTrust:0,workOB:600,included:true,shareTrust:true}
 ])
 assert.equal(candidates.filter(x=>x.destinationMatterId==='c').reduce((sum,x)=>sum+x.amount,0),600)
})
