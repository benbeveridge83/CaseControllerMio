import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {trustLedgerMatchesCloud,assertCurrentTrustLedger} from '../src/mioReplenishmentPostLedger.js';
const base=[{id:'a',matter_id:'m1',direction:'in',amount:5000,invoice_id:''},{id:'b',matter_id:'m1',direction:'out',amount:200,invoice_id:'w1'}];
test('server and UI trust ledger match independent of order',()=>{
 assert.equal(trustLedgerMatchesCloud(base,[...base].reverse()),true);
});
test('atomic posting makes previously loaded trust ledger stale',()=>{
 const posted={id:'c',matter_id:'m1',direction:'out',amount:150,invoice_id:'w2',idempotency_key:'weekly-billing:k'};
 assert.equal(trustLedgerMatchesCloud(base,[posted,...base]),false);
});
test('an edited financial entry invalidates freshness',()=>{
 assert.equal(trustLedgerMatchesCloud(base,[{...base[0],amount:4900},base[1]]),false);
 assert.equal(trustLedgerMatchesCloud(null,base),false);
});
test('latest persisted ledger can pass, stale one stops send',async()=>{
 const persisted={from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{json_value:base},error:null})})})})})};
 assert.equal((await assertCurrentTrustLedger(persisted,'u',base)).verified,true);
 await assert.rejects(()=>assertCurrentTrustLedger(persisted,'u',base.slice(0,1)),/Trust transactions changed/);
});
