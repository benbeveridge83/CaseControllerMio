import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {replenishmentFingerprint,claimReplenishmentSend,finishReplenishmentClaim} from '../src/mioReplenishmentClaims.js';
test('fingerprint stable for invoice order and changes for financial state',async()=>{
 const input={matterId:'m1',kind:'new',trust:1000,target:5000,amount:2000,
   invoices:[{id:'a',balance:1200},{id:'b',balance:800}]};
 const first=await replenishmentFingerprint(input);
 assert.match(first,/^[a-f0-9]{64}$/);
 assert.equal(first,await replenishmentFingerprint({...input,invoices:input.invoices.slice().reverse()}));
 assert.notEqual(first,await replenishmentFingerprint({...input,trust:999}));
});
test('claim never overwrites an existing send fingerprint',async()=>{
 const table={insert:()=>({select:()=>({single:async()=>({data:null,error:{code:'23505'}})})})};
 const db={from:()=>table};
 await assert.rejects(()=>claimReplenishmentSend(db,{userId:'u',matterId:'m',fingerprint:'a'.repeat(64),kind:'new'}),/already started/);
});
test('claim completion rejects unsupported status',async()=>{
 await assert.rejects(()=>finishReplenishmentClaim({}, {status:'claimed'}),/Invalid claim completion state/);
});
