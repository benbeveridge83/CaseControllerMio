import test from 'node:test'
import assert from 'node:assert/strict'
import {createMioCloudSync} from '../src/mioCloudSync.js'
function fixture(options={}){
 const win=new EventTarget(),document=new EventTarget()
 document.hidden=false;document.activeElement=null;document.querySelector=()=>null
 win.document=document;let reloads=0;win.location={reload(){reloads++}}
 const status={owner:'a',phase:'ready',pending:0,pausedPending:0},saved=new Set()
 let changed=true,reads=0
 const store={status:()=>status,async checkRemoteChanges(){reads++;return changed},subscribeSaved(fn){saved.add(fn);return()=>saved.delete(fn)}}
 const sync=createMioCloudSync({store,win,Channel:null,...options})
 return{win,document,status,sync,saved,setChanged:v=>changed=v,get reads(){return reads},get reloads(){return reloads}}
}
test('a clean tab refreshes only when a cloud version changed',async()=>{
 const f=fixture();try{f.setChanged(false);await f.sync.check();assert.equal(f.reloads,0);f.setChanged(true);await f.sync.check();assert.equal(f.reloads,1)}finally{f.sync.close()}
})
test('confirmed saves notify same-account tabs without sharing record values',async()=>{
 const channelName='sync-test-'+crypto.randomUUID(),options={Channel:BroadcastChannel,channelName,debounceMs:1}
 const a=fixture(options),b=fixture(options),other=fixture(options);other.status.owner='b'
 try{
  for(const fn of a.saved)fn({owner:'a',key:'caseMioTest'})
  for(let i=0;i<50&&!b.reloads;i++)await new Promise(r=>setTimeout(r,10))
  assert.equal(b.reloads,1);assert.equal(other.reads,0);assert.equal(a.reloads,0)
 }finally{a.sync.close();b.sync.close();other.sync.close()}
})
test('pending edits, paused account edits, and typed drafts prevent automatic reload',async()=>{
 const f=fixture();try{
  f.status.pending=1;await f.sync.check();assert.equal(f.reloads,0)
  f.status.pending=0;f.status.pausedPending=1;await f.sync.check();assert.equal(f.reloads,0)
  f.status.pausedPending=0;f.win.dispatchEvent(new Event('input'));await f.sync.check();assert.equal(f.reloads,0)
  f.win.dispatchEvent(new Event('hashchange'));await f.sync.check();assert.equal(f.reloads,0,'navigation must not assume that a draft was saved')
 }finally{f.sync.close()}
})
test('editing started during remote check prevents reload',async()=>{
 const f=fixture();try{const checking=f.sync.check();f.win.dispatchEvent(new Event('change'));await checking;assert.equal(f.reloads,0)}finally{f.sync.close()}
})
test('hidden tabs and open dialogs are not reloaded',async()=>{
 const f=fixture();try{f.document.hidden=true;await f.sync.check();assert.equal(f.reloads,0);f.document.hidden=false;f.document.querySelector=()=>({});await f.sync.check();assert.equal(f.reloads,0)}finally{f.sync.close()}
})
