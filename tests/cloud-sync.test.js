import test from 'node:test'
import assert from 'node:assert/strict'
import {createMioCloudSync} from '../src/mioCloudSync.js'
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function fixture(options={}){
 const win=new EventTarget(),document=new EventTarget()
 document.hidden=false;document.activeElement=null;document.querySelector=()=>null
 win.document=document;let reloads=0;win.location={reload(){reloads++}}
 const status={owner:'a',phase:'ready',pending:0,pausedPending:0,changedKeys:undefined,reloadRequired:false},saved=new Set()
 let changed=true,reads=0
 const store={status:()=>status,async checkRemoteChanges(){reads++;return changed},subscribeSaved(fn){saved.add(fn);return()=>saved.delete(fn)}}
 // Unit tests exercise the decision, not the production pacing defaults.
 const sync=createMioCloudSync({store,win,Channel:null,quietAfterReadyMs:0,minAutoReloadGapMs:0,...options})
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
test('another window changing a display preference never reloads this window',async()=>{
 const f=fixture();try{
  f.status.changedKeys=['caseMioStickyFilter:serviceInboxFilter','caseMioChecklistStepsExpandedByRow','matterColumnWidths']
  await f.sync.check();assert.equal(f.reloads,0,'filters, expanded rows, and widths rebase without a page reload')
  f.status.changedKeys=['caseMioStickyFilter:serviceInboxFilter','caseMioBillingEntries']
  await f.sync.check();assert.equal(f.reloads,1,'a case record changed, so the window refreshes')
 }finally{f.sync.close()}
})
test('a resolved cloud version always needs a reload even for a preference key',async()=>{
 const f=fixture();try{
  f.status.changedKeys=['caseMioStickyFilter:serviceInboxFilter'];f.status.reloadRequired=true
  await f.sync.check();assert.equal(f.reloads,1)
 }finally{f.sync.close()}
})
test('a tab that just became ready waits out the quiet window before refreshing',async()=>{
 const f=fixture({quietAfterReadyMs:30});try{
  await f.sync.check();assert.equal(f.reloads,0,'opening a window must not refresh it immediately')
  await wait(300)
  assert.equal(f.reloads,1,'the newer records are applied once the window is settled')
 }finally{f.sync.close()}
})
test('the first check after becoming ready is never deferred by its own timestamp',async()=>{
 const f=fixture();try{
  // A slow millisecond boundary made the old implementation treat its own
  // readiness timestamp as a future change and postpone the reload forever.
  const realNow=Date.now
  let ticks=0
  Date.now=()=>realNow.call(Date)+ticks++
  f.setChanged(true)
  await f.sync.check()
  Date.now=realNow
  assert.equal(f.reloads,1)
 }finally{f.sync.close()}
})

test('the per-tab reload guard stops a refresh chain and still applies the change later',async()=>{
 const disk=new Map(),f=fixture({minAutoReloadGapMs:30});try{
  f.win.sessionStorage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)}
  disk.set('mioAutoReloadAtV321',String(Date.now()))
  await f.sync.check();assert.equal(f.reloads,0,'repeated automatic reloads every few seconds are refused')
  await wait(300)
  assert.equal(f.reloads,1,'the change is still applied after the guard window')
 }finally{f.sync.close()}
})
