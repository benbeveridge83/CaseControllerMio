import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {buildReplenishmentReview,buildReplenishmentEmailPreview,validateReplenishmentSend} from '../src/mioTrustReplenishmentWorkflow.js';

const base={id:'m1',name:'Primary',minimum_balance:2500,initial_retainer:5000,current_trust:1000};
test('groups unpaid work and partial trust invoices without double counting',()=>{
 const rows=buildReplenishmentReview({matters:[base],invoices:[
  {id:'t1',matter_id:'m1',invoice_type:'trust_replenishment',total:3000,amount_paid:1000,balance:2000,status:'partial',payment_url:'https://example.com/trust'},
  {id:'w1',matter_id:'m1',invoice_type:'work_ob',total:1200,amount_paid:0,balance:1200,status:'sent',payment_url:'https://example.com/work'}
 ]});
 assert.equal(rows.length,1);
 assert.equal(rows[0].outstanding_trust,2000);
 assert.equal(rows[0].outstanding_work,1200);
 assert.equal(rows[0].new_replenishment,2000);
 assert.equal(rows[0].all_due,5200);
 const email=buildReplenishmentEmailPreview(rows[0],{invoice_number:'new',remaining:2000,payment_url:'https://example.com/new'});
 assert.equal(email.sections.length,3);
 assert.equal(email.sections[0].invoices.length,1);
 assert.equal(email.sections[1].invoices.length,1);
 assert.equal(email.sections[2].invoices.length,1);
});
test('previous request covers target, but review still includes low trust matter',()=>{
 const [row]=buildReplenishmentReview({matters:[base],invoices:[{matter_id:'m1',invoice_type:'trust',total:4000,balance:4000}]});
 assert.equal(row.new_replenishment,0);
 assert.equal(row.needs_payment_reminder,true);
});
test('appointment and secondary matter excluded',()=>{
 const rows=buildReplenishmentReview({matters:[base,{...base,id:'m2',appointed:true},{...base,id:'m3'}],settings:{m3:{primary_replenishment_matter:false}}});
 assert.deepEqual(rows.map(r=>r.id),['m1']);
});
test('sending requires up-to-date verification, routing and idempotency',()=>{
 assert.ok(validateReplenishmentSend({recipient_email:'client@example.com'}).length>=3);
 assert.deepEqual(validateReplenishmentSend({recipient_email:'client@example.com',verified_current_balances:true,trust_payment_routing_verified:true,idempotency_key:'run:m1'}),[]);
});
