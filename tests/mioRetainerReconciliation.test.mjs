import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {auditLawPayRecords} from '../src/mioFinanceReview.js';
const ref='PNC-retainer-case-500000';
const request={id:'req1',reference:ref,invoice_number:ref,account_key:'trust',amount_cents:500000,client_id:'c',matter_id:'m',status:'paid',gateway_transaction_id:'tx1'};
const tx={gateway_transaction_id:'tx1',reference:ref,raw:{mio_invoice_number:ref},status:'COMPLETED',transaction_type:'CHARGE',amount_cents:500000,amount_refunded_cents:0,account_key:'trust'};
test('verified paid retainer does not require a Mio work invoice',()=>{
 const report=auditLawPayRecords([tx],[],[],[request]);
 assert.equal(report.issues.length,0);
 assert.equal(report.matched,1);
});
test('unmapped trust account remains a specific reconciliation issue',()=>{
 const report=auditLawPayRecords([{...tx,account_key:'',raw:{...tx.raw,mio_account_key_source:'provider_account_unmapped'}}],[],[],[{...request,status:'created',gateway_transaction_id:null}]);
 assert.equal(report.issues.length,1);
 assert.equal(report.issues[0].kind,'retainer_account_unverified');
});
test('request status not paid must be reconciled even when trust account is known',()=>{
 const report=auditLawPayRecords([tx],[],[],[{...request,status:'created',gateway_transaction_id:null}]);
 assert.equal(report.issues[0].kind,'retainer_request_unreconciled');
});
test('unmatched retainer payment remains unresolved and cannot be ignored',()=>{
 const report=auditLawPayRecords([tx],[],[],[]);
 assert.equal(report.issues[0].kind,'retainer_unmatched');
});
test('work invoice missing event still produces a reconciliation issue',()=>{
 const ordinary={...tx,reference:'MIO-2026-000003',raw:{mio_invoice_number:'MIO-2026-000003'}};
 const report=auditLawPayRecords([ordinary],[{id:'i',invoice_number:'MIO-2026-000003',amount_paid:0}],[],[]);
 assert.equal(report.issues[0].kind,'unapplied');
});
