import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {transformWithOxc} from 'vite'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {firmDate,billingMarker} from '../src/dashboard/model.js'

test('dashboard opens the exact task, shows client names without fetching mail, and turns only saved time green',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://mio.test'})
 for(const key of ['window','document','localStorage','Event','DOMParser','HTMLElement'])globalThis[key]=dom.window[key]
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 let mailRequests=0
 const {emailClient}=await import('../src/email/emailClient.js')
 const today=firmDate(),row={key:'settings:e1',sourceId:'e1',kind:'settings',matterId:'m1',matterName:'SAPCR/Modification 12345',clientName:'Adams',title:'Temporary orders',trust:456.78,linkedEmails:[]}
 const message={id:'mail1',accountEmail:'ben@firm.test',subject:'Temporary orders hearing dates',from:'client@test',to:[],receivedDateTime:`${today}T15:00:00Z`,bodyPreview:'Available dates',conversationId:'thread1',isRead:false}
 emailClient.messages=async()=>{mailRequests++;return {messages:[message]}};emailClient.thread=async()=>({messages:[{...message,body:'The court provided available dates.'}]})
 const componentPath=new URL('../src/dashboard/.work-dashboard-test.mjs',import.meta.url)
 const source=await fs.readFile(new URL('../src/dashboard/WorkDashboard.jsx',import.meta.url),'utf8')
 const transformed=await transformWithOxc(source.replace("import './dashboard.css'",''),'WorkDashboard.jsx',{jsx:{runtime:'automatic'}})
 await fs.writeFile(componentPath,transformed.code)
 const root=createRoot(document.getElementById('root'));const calls=[]
 try{
  const {default:Dashboard}=await import(componentPath.href)
  const props={userId:'u1',billingUserId:'u1',matters:[{id:'m1',name:'Adams',clients:{email:'client@test'}}],rows:[row,{...row,key:'orders:o1',kind:'orders',sourceId:'o1',trust:0},{...row,key:'service:m1',kind:'service',sourceId:'m1',trust:null}],billingEntries:[],finance:{ready:true,day:{},week:{}},trust:Array.from({length:16},(_,i)=>({id:String(i),name:`Matter ${i}`,clientName:`Client ${i}`,trust:160-i})),workflow:[{id:'w1',name:'Review orders',checked:false}],timeline:[],onWorkflow:()=>{},onOpen:r=>calls.push(['open',r.key]),onTime:r=>calls.push(['time',r?.key]),onMatter:()=>{},onAddNeedToSet:()=>calls.push(['addNeedToSet']),onNavigate:()=>{},onLegacyMail:()=>{},renderNativePlanning:view=>React.createElement('p',null,view)}
  props.withdrawals=[{id:'withdraw1',name:'Divorce 12345',clientName:'Withdrawal client',kind:'waiting',status:'Waiting',next:'Client signature',trust:2345.67,billSends:[{key:'i1:sent',invoiceNumber:'INV-1',issueDate:'2026-11-01',sentAt:'2026-11-03T01:00:00Z'}]}]
  props.onWithdrawal=id=>calls.push(['withdrawal',id])
  await act(async()=>root.render(React.createElement(Dashboard,props)))
  assert.match(document.querySelector('.desk-withdrawals').textContent,/Waiting/)
  assert.equal(document.querySelector('.desk-finance').firstElementChild.classList.contains('desk-withdrawals'),true)
  await act(async()=>document.querySelector('.desk-withdrawal-scroll button').click());assert.deepEqual(calls.pop(),['withdrawal','withdraw1'])
  assert.match(document.querySelector('.desk-withdrawal-finance').textContent,/Trust: \$2,345.67/)
  assert.match(document.querySelector('.desk-withdrawal-finance').textContent,/INV-1 · bill 11\/1\/26 · sent 11\/2\/26/)
  const add=[...document.querySelectorAll('.desk-queue.settings button')].find(b=>b.textContent.includes('Add need to set'))
  await act(async()=>add.click());assert.deepEqual(calls.pop(),['addNeedToSet'])
  assert.equal(document.querySelectorAll('.desk-trust-scroll button').length,16)
  await act(async()=>document.querySelector('.desk-task-open').click());assert.deepEqual(calls[0],['open','settings:e1'])
  assert.equal(document.querySelector('.desk-task-open strong').textContent,'Adams')
  assert.match(document.querySelector('.desk-task-open').textContent,/12345/)
  assert.match(document.querySelector('.desk-withdrawal-scroll').textContent,/Withdrawal client/)
  assert.match(document.querySelector('.desk-trust-scroll').textContent,/Client 15/)
  assert.equal(document.querySelector('.desk-email-queues'),null)
  assert.equal(mailRequests,0)
  assert.equal(document.querySelector('.desk-queue.settings .desk-matter-trust').textContent,'Trust: $456.78')
  assert.equal(document.querySelector('.desk-queue.orders .desk-matter-trust').textContent,'Trust: $0.00')
  assert.equal(document.querySelector('.desk-queue.service .desk-matter-trust').textContent,'Trust: Review')
  await act(async()=>root.render(React.createElement(Dashboard,{...props,finance:{ready:false}})))
  assert.equal(document.querySelector('.desk-queue.settings .desk-matter-trust').textContent,'Trust: Refreshing…')
  await act(async()=>root.render(React.createElement(Dashboard,{...props,rows:props.rows.map(r=>({...r,financeVisible:false}))})))
  assert.equal(document.querySelector('.desk-task .desk-matter-trust'),null)
  await act(async()=>root.render(React.createElement(Dashboard,props)))
  const opened=[];window.open=(...args)=>{opened.push(args);return null}
  for(const [panel,page] of [['.desk-queue.settings','need_to_set'],['.desk-queue.orders','orders'],['.desk-queue.service','matters'],['.desk-withdrawals','withdrawals'],['.desk-workflow','workflow'],['.desk-trust','billing'],['.desk-billing','billing']]){
   const link=document.querySelector(`${panel} .desk-open-page`)
   assert.equal(link.hash,`#${page}`);assert.equal(link.target,'_blank');assert.match(link.rel,/noopener/)
   await act(async()=>link.click())
   const [url,target,features]=opened.at(-1)
   assert.equal(new URL(url).hash,`#${page}`);assert.equal(target,'_blank');assert.match(features,/popup=yes/);assert.match(features,/noopener/)
  }
  for(const [label,page] of [['Calendar','calendar'],['Matter timelines','matter_timelines'],['Checklist','checklist']]){
   await act(async()=>[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent===label).click())
   const link=document.querySelector('.desk-planning .desk-open-page');assert.equal(link.hash,`#${page}`)
   await act(async()=>link.click());assert.equal(new URL(opened.at(-1)[0]).hash,`#${page}`)
  }
  assert.equal(window.location.hash,'')
  const entry={id:'b1',matter_id:'m1',user_id:'u1',date:today,billing_time:.3,matter_step:billingMarker(row),dashboard_save_state:'pending'}
  await act(async()=>root.render(React.createElement(Dashboard,{...props,billingEntries:[entry]})));assert.equal(document.querySelector('.desk-task').classList.contains('worked'),false)
  await act(async()=>root.render(React.createElement(Dashboard,{...props,billingEntries:[{...entry,dashboard_save_state:'saved'}]})));assert.equal(document.querySelector('.desk-task').classList.contains('worked'),true)
  await act(async()=>document.querySelector('[aria-label="Add time: Adams, Temporary orders"]').click());assert.deepEqual(calls.at(-1),['time','settings:e1'])
  const tab=[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='Matter timelines');await act(async()=>tab.click());assert.match(document.querySelector('.desk-planning-content').textContent,/matter_timelines/)
  const count=document.querySelector('[aria-label="Expand Need to set queue"]');await act(async()=>count.click());assert.ok(document.querySelector('[role=dialog]'))
  await act(async()=>document.querySelector('.mio-desk-modal .desk-task-open').click());assert.equal(document.querySelector('[role=dialog]'),null)
 }finally{await act(async()=>root.unmount());await fs.unlink(componentPath);const {supabase}=await import('../src/supabaseClient.js');await supabase.auth.getSession();await supabase.auth.stopAutoRefresh();supabase.auth.broadcastChannel?.close();dom.window.close()}
})
