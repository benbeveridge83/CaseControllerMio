import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {replenishmentPlan,replenishmentCandidate} from '../src/mioFinanceReview.js';
test('partial prior trust request reduces only additional invoice',()=>{
 const invoices=[{matter_id:'m1',invoice_type:'trust_request',status:'outstanding',total:3000,amount_paid:1000,balance:2000,emailed_at:'2026-10-20'}];
 const plan=replenishmentPlan('m1',invoices,{trust:1000,target:5000});
 assert.equal(plan.outstanding,2000);
 assert.equal(plan.additional,2000);
 assert.equal(plan.blocked,false);
 const candidate=replenishmentCandidate('m1',invoices,2000,{allowAdditional:true,trust:1000,target:5000});
 assert.equal(candidate.amount,2000);
});
test('fully covered prior request results in reminder only',()=>{
 const plan=replenishmentPlan('m1',[{matter_id:'m1',invoice_type:'trust_request',status:'outstanding',balance:4000}],{trust:1000,target:5000});
 assert.equal(plan.additional,0);
 assert.equal(plan.needsReminder,true);
});
test('unsent drafts block new invoice generation',()=>{
 const plan=replenishmentPlan('m1',[{matter_id:'m1',invoice_type:'trust_request',status:'draft',total:4000,balance:4000}],{trust:1000,target:5000});
 assert.equal(plan.blocked,true);
 assert.equal(plan.additional,4000);
});
test('voided invoices are not credited against target',()=>{
 const plan=replenishmentPlan('m1',[{matter_id:'m1',invoice_type:'trust_request',status:'void',balance:4000}],{trust:1000,target:5000});
 assert.equal(plan.outstanding,0);
 assert.equal(plan.additional,4000);
});
