import test from 'node:test'
import assert from 'node:assert/strict'
import {createMioCloudStore} from '../src/mioCloudStore.js'
test('new edits arriving during cloud recovery remain pending',async()=>{
 const archive=[];let release
 const client={from(table){return {select(){return this},eq(){return this},neq(){return this},order(){return this},range(){return Promise.resolve({data:[]})},insert(rows){archive.push(...rows.map((r,i)=>({...r,id:String(i)})));return this},in(){return this},then(resolve,reject){return new Promise(r=>{release=r}).then(()=>({data:archive,error:null})).then(resolve,reject)}}},rpc:async(name,p)=>({data:{key:p.p_key,raw_value:p.p_raw,updated_at:'ack'},error:null})}
 const nativeStorage={length:0,key:()=>null,getItem:()=>null,setItem:()=>{throw Error('Unexpected browser write')},removeItem:()=>{}}
 const store=createMioCloudStore({client,nativeStorage,delay:60000})
 await store.prepare('account');store.activate();store.stage('caseMioTest','original')
 const task=store.preservePending();await new Promise(r=>setImmediate(r))
 store.storage.setItem('caseMioTest','newer edit');release();await new Promise(r=>setImmediate(r));release()
 assert.equal(await task,false);assert.equal(store.status().pending,1);assert.equal(store.storage.getItem('caseMioTest'),'newer edit')
 assert.equal(await store.flushAll(),true);assert.equal(archive[0].raw_value,'original')
})
