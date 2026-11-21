import test from 'node:test'
import assert from 'node:assert/strict'
import {createWeeklyBillingProposal,weeklyBillingDefaults,reconcileWeeklyBillingReview} from '../src/mioWeeklyBillingModel.js'
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
