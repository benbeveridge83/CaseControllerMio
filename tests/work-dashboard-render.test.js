import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {transformWithOxc} from 'vite'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {firmDate,billingMarker} from '../src/dashboard/model.js'

test('dashboard opens the exact task, shows unread mail, reviews its conversation, and turns only saved time green',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://mio.test'})
 for(const key of ['window','document','localStorage','Event','DOMParser','HTMLElement'])globalThis[key]=dom.window[key]
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const {emailClient}=await import('../src/email/emailClient.js')
 const today=firmDate(),row={key:'settings:e1',sourceId:'e1',kind:'settings',matterId:'m1',matterName:'Adams',title:'Temporary orders',linkedEmails:[]}
 const message={id:'mail1',accountEmail:'ben@firm.test',subject:'Temporary orders hearing dates',from:'client@test',to:[],receivedDateTime:`${today}T15:00:00Z`,bodyPreview:'Available dates',conversationId:'thread1',isRead:false}
 emailClient.messages=async()=>({messages:[message]});emailClient.thread=async()=>({messages:[{...message,body:'The court provided available dates.'}]})
 const componentPath=new URL('../src/dashboard/.work-dashboard-test.mjs',import.meta.url)
 const source=await fs.readFile(new URL('../src/dashboard/WorkDashboard.jsx',import.meta.url),'utf8')
 const transformed=await transformWithOxc(source.replace("import './dashboard.css'",''),'WorkDashboard.jsx',{jsx:{runtime:'automatic'}})
 await fs.writeFile(componentPath,transformed.code)
 const root=createRoot(document.getElementById('root'));const calls=[]
 try{
  const {default:Dashboard}=await import(componentPath.href)
  const props={userId:'u1',billingUserId:'u1',matters:[{id:'m1',name:'Adams',clients:{email:'client@test'}}],rows:[row],billingEntries:[],finance:{ready:true,day:{},week:{}},trust:Array.from({length:16},(_,i)=>({id:String(i),name:`Matter ${i}`,trust:160-i})),workflow:[{id:'w1',name:'Review orders',checked:false}],timeline:[],onWorkflow:()=>{},onOpen:r=>calls.push(['open',r.key]),onTime:r=>calls.push(['time',r?.key]),onMatter:()=>{},onNavigate:()=>{},onLegacyMail:()=>{},renderNativePlanning:view=>React.createElement('p',null,view)}
  props.withdrawals=[{id:'withdraw1',name:'Withdrawal example',kind:'waiting',status:'Waiting',next:'Client signature'}]
  props.onWithdrawal=id=>calls.push(['withdrawal',id])
  await act(async()=>root.render(React.createElement(Dashboard,props)))
  assert.match(document.querySelector('.desk-withdrawals').textContent,/Waiting/)
  assert.equal(document.querySelector('.desk-finance').firstElementChild.classList.contains('desk-withdrawals'),true)
  await act(async()=>document.querySelector('.desk-withdrawal-scroll button').click());assert.deepEqual(calls.pop(),['withdrawal','withdraw1'])
  assert.equal(document.querySelectorAll('.desk-trust-scroll button').length,16)
  await act(async()=>document.querySelector('.desk-task-open').click());assert.deepEqual(calls[0],['open','settings:e1'])
  const icon=document.querySelector('.desk-envelope');assert.match(icon.getAttribute('aria-label'),/1 unread/)
  await act(async()=>icon.click());assert.ok(document.querySelector('[role=dialog]'))
  await act(async()=>document.querySelector('.desk-mail-message').click());assert.match(document.querySelector('.desk-mail-body').textContent,/court provided/)
  assert.equal(document.querySelector('.desk-envelope').classList.contains('unread'),false)
  await act(async()=>document.querySelector('.mio-desk-modal>header button').click())
  const entry={id:'b1',matter_id:'m1',user_id:'u1',date:today,billing_time:.3,matter_step:billingMarker(row),dashboard_save_state:'pending'}
  await act(async()=>root.render(React.createElement(Dashboard,{...props,billingEntries:[entry]})));assert.equal(document.querySelector('.desk-task').classList.contains('worked'),false)
  await act(async()=>root.render(React.createElement(Dashboard,{...props,billingEntries:[{...entry,dashboard_save_state:'saved'}]})));assert.equal(document.querySelector('.desk-task').classList.contains('worked'),true)
  await act(async()=>document.querySelector('[aria-label="Add time: Adams, Temporary orders"]').click());assert.deepEqual(calls.at(-1),['time','settings:e1'])
  const tab=[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='Matter timelines');await act(async()=>tab.click());assert.match(document.querySelector('.desk-planning-content').textContent,/matter_timelines/)
  const count=document.querySelector('.desk-queue.settings header button');await act(async()=>count.click());assert.ok(document.querySelector('[role=dialog]'))
  await act(async()=>document.querySelector('.mio-desk-modal .desk-task-open').click());assert.equal(document.querySelector('[role=dialog]'),null)
 }finally{await act(async()=>root.unmount());await fs.unlink(componentPath);const {supabase}=await import('../src/supabaseClient.js');await supabase.auth.getSession();await supabase.auth.stopAutoRefresh();supabase.auth.broadcastChannel?.close();dom.window.close()}
})
