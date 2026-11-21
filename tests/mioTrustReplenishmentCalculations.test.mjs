import {strict as assert} from 'node:assert'
import {test} from 'node:test'
import {calculateTrustReplenishment,invoiceOutstanding,recentTrustHistory,shouldReviewTrustMatter,summarizeReplenishmentMatter} from '../src/mioTrustReplenishmentCalculations.js'

test('partially paid prior request is subtracted only by remaining balance',()=>{
 const old={amount:3000,paid_amount:1000,status:'partially_paid'}
 assert.equal(invoiceOutstanding(old),2000)
 assert.equal(calculateTrustReplenishment({currentTrust:1000,targetTrust:5000,priorTrustInvoices:[old]}),2000)
})
test('fully funded pending requests do not create duplicate new invoice',()=>{
 assert.equal(calculateTrustReplenishment({currentTrust:1000,targetTrust:5000,priorTrustInvoices:[{amount:4000,paid_amount:0}]}),0)
})
test('voided invoices do not count toward funding',()=>{
 assert.equal(calculateTrustReplenishment({currentTrust:1000,targetTrust:5000,priorTrustInvoices:[{amount:4000,status:'voided'}]}),4000)
})
test('work invoices stay separate from trust funding',()=>{
 const s=summarizeReplenishmentMatter({current_trust:1000,target_trust:5000,prior_trust_invoices:[{amount:2000}],unpaid_work_invoices:[{amount:1200}]})
 assert.deepEqual(s,{oldTrust:2000,work:1200,newTrust:2000,totalRequested:5200})
})
test('excluded, appointed, secondary and closed matters do not qualify',()=>{
 const base={minimum_trust:2500,current_trust:1000}
 assert.equal(shouldReviewTrustMatter(base),true)
 for(const patch of [{appointed:true},{replenishment_enabled:false},{primary_replenishment_matter:false},{closed:true}])assert.equal(shouldReviewTrustMatter({...base,...patch}),false)
})
test('only recent invoice history is returned',()=>{
 const asOf=new Date('2026-11-21T12:00:00Z')
 const rows=recentTrustHistory([{id:'old',sent_at:'2026-08-01'},{id:'recent',sent_at:'2026-11-01'}],asOf)
 assert.deepEqual(rows.map(r=>r.id),['recent'])
})
