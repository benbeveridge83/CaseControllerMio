import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {replenishmentActionCategories} from '../src/mioReplenishmentActions.js';
test('all three invoice categories are displayed together',()=>{
 const row={amount:'1500',prior_trust_invoices:[{remaining_balance:900}],unpaid_work_invoices:[{remaining_balance:450}],withdrawal_flagged:true};
 assert.deepEqual(replenishmentActionCategories(row),['New trust invoice','Old trust invoice','Work invoice']);
});
test('old trust and work invoice remain visible when no new request is needed',()=>{
 const row={amount:'0',prior_trust_invoices:[{remaining_balance:2100}],unpaid_work_invoices:[{remaining_balance:800}]};
 assert.deepEqual(replenishmentActionCategories(row),['Old trust invoice','Work invoice']);
});
test('fully paid categories disappear independently',()=>{
 assert.deepEqual(replenishmentActionCategories({amount:100,prior_trust_invoices:[{remaining_balance:0}],unpaid_work_invoices:[{remaining_balance:1}]}),['New trust invoice','Work invoice']);
});
test('no negative or zero invoice generates an action',()=>{
 assert.deepEqual(replenishmentActionCategories({amount:0,prior_trust_invoices:[],unpaid_work_invoices:[]}),[]);
});
