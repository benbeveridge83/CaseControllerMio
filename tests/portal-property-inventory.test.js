import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyPropertyInventory,validateInventory} from '../lib/portal/propertyInventory.js'
import {requirePortalSection} from '../lib/portal/settings.js'
test('empty inventory has assets, secured debts and unsecured debts',()=>{const v=emptyPropertyInventory();assert.deepEqual(v.assets,[]);assert.deepEqual(v.securedDebts,[]);assert.deepEqual(v.unsecuredDebts,[])})
test('inventory validation rejects malformed and oversized input',()=>{assert.throws(()=>validateInventory(null));assert.throws(()=>validateInventory({assets:[{id:'x'},{id:'x'}],securedDebts:[],unsecuredDebts:[]}));assert.throws(()=>validateInventory({assets:Array.from({length:401},(_,i)=>({id:String(i)})),securedDebts:[],unsecuredDebts:[]}));assert.throws(()=>validateInventory({assets:[{id:'x',description:'a'.repeat(13000)}],securedDebts:[],unsecuredDebts:[]}))})
test('property inventory section is gated per matter',()=>{assert.throws(()=>requirePortalSection('inventory_get',{property_inventory:false}),e=>e.status===403);assert.doesNotThrow(()=>requirePortalSection('inventory_get',{property_inventory:true}))})
