import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {checkReplenishmentFreshness,assertSafeReplenishmentRow} from '../src/mioReplenishmentSafety.js';
const now=new Date('2026-11-21T19:00:00Z');
test('historic Clio snapshot cannot be used for November replenishment',()=>{
 assert.equal(checkReplenishmentFreshness({balanceAsOf:'2026-08-13',invoiceAsOf:'2026-11-21T18:59:00Z',now}).ok,false);
});
test('current trusted data passes freshness gate',()=>{
 assert.equal(checkReplenishmentFreshness({balanceAsOf:'2026-11-21T18:00:00Z',invoiceAsOf:'2026-11-21T18:59:00Z',now}).ok,true);
});
test('appointed matters cannot be authorized by freshness alone',()=>{
 assert.equal(assertSafeReplenishmentRow({appointed:true,primary_replenishment_matter:true,source_balance_reconciled:true,trust_balance_verified_at:'2026-11-21T18:00:00Z',invoice_ledger_verified_at:'2026-11-21T18:59:00Z'},now).ok,false);
});
test('primary status, reconciliation and ledger refresh all required',()=>{
 const row={appointed:false,primary_replenishment_matter:true,source_balance_reconciled:true,trust_balance_verified_at:'2026-11-21T18:00:00Z',invoice_ledger_verified_at:'2026-11-21T18:59:00Z'};
 assert.equal(assertSafeReplenishmentRow(row,now).ok,true);
 assert.equal(assertSafeReplenishmentRow({...row,primary_replenishment_matter:false},now).ok,false);
 assert.equal(assertSafeReplenishmentRow({...row,source_balance_reconciled:false},now).ok,false);
});
