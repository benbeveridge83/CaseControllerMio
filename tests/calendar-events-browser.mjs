// Notification-of-Service style calendar events must reach every open Mio window.
// All external requests are intercepted. No real account or production write is used.
import {chromium} from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {chunkRows} from './cloud-chunk-fixture.js'
fs.mkdirSync('test-results',{recursive:true})
const browser=await chromium.launch({headless:true})
const id='00000000-0000-4000-8000-000000000321',email='calendar-sync-test@example.invalid'
const user={id,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:new Date().toISOString()}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:id,email,role:'authenticated',exp,aud:'authenticated'})}.test-signature`,refresh_token:'synthetic-test-token',expires_at:exp,expires_in:3600,token_type:'bearer',user}
const localDate=offset=>{const date=new Date();date.setDate(date.getDate()+offset);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
const today=localDate(0),todayDayNumber=new Date().getDate()
const matters=[
 {id:'matter-active',name:'Modification',cause_number:'111293-f',case_status:'Open',matter_status:'Active',client_id:'client-1',clients:{first_name:'Colton',last_name:'Vitany'},courts:{court_name:'300th District Court',county:'Harris'}},
 {id:'matter-blank',name:'Jennifer Tos Modification',cause_number:'111294-f',case_status:'',matter_status:'',client_id:'client-2',clients:{first_name:'Anthony',last_name:'Fitzsimmons'},courts:{court_name:'300th District Court',county:'Harris'}},
 {id:'matter-closed',name:'Closed Matter',cause_number:'111295-f',case_status:'Closed - Final',matter_status:'Closed',client_id:'client-3',clients:{first_name:'Pat',last_name:'Closed'},courts:{court_name:'300th District Court',county:'Harris'}}
]
const matterById=matterId=>matters.find(matter=>matter.id===matterId)||null
const eventRow=({id,title,matterId,date})=>({id,title,event_category:'Hearing',event_subcategory:'Hearing',description:'',start_date:date,end_date:date,start_time:'09:30',end_time:'10:30',is_active:true,matter_id:matterId,assigned_to:null,matters:matterById(matterId),team_members:null})
const fixture={events:[
 eventRow({id:'event-active',title:'Hearing: active matter',matterId:'matter-active',date:today}),
 eventRow({id:'event-blank',title:'Hearing: jennifers tos',matterId:'matter-blank',date:today}),
 eventRow({id:'event-closed',title:'Hearing: closed matter',matterId:'matter-closed',date:today})
],states:new Map([['caseMioSnapshotGraphShowInvoicesV259',{key:'caseMioSnapshotGraphShowInvoicesV259',raw_value:'true',updated_at:'2026-09-05T00:00:00Z'}]])}
const errors=[],writes=[]

const context=await browser.newContext({viewport:{width:1700,height:1100}})
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)))
try{
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  const single=request.headers().accept?.includes('vnd.pgrst.object')
  if(['127.0.0.1','localhost'].includes(url.hostname))return url.pathname.startsWith('/api/')?respond({connected:false,data:[]}):route.continue()
  if(!url.hostname.endsWith('.supabase.co'))return respond({})
  if(url.pathname.includes('/auth/v1/'))return respond(url.pathname.endsWith('/user')?user:session)
  const table=url.pathname.split('/').pop()
  if(table==='mio_cloud_state_read_chunks_v297')return respond(chunkRows([...fixture.states.values()].map(row=>({...row,user_id:id})),request.postDataJSON()))
  if(table==='mio_cloud_state_write_v277'){const p=request.postDataJSON();writes.push(p);const row={key:p.p_key,raw_value:p.p_raw,updated_at:new Date().toISOString()};fixture.states.set(p.p_key,{...row,user_id:id});return respond(row)}
  if(table==='calendar_events'){
   if(request.method()==='POST'){
    const inserted=(request.postDataJSON()||[]).map(row=>({...row,id:`event-created-${fixture.events.length+1}`,matters:matterById(row.matter_id),team_members:null}))
    fixture.events.push(...inserted)
    return respond(single?inserted[0]:inserted,201)
   }
   if(request.method()==='PATCH'){
    const target=String(url.searchParams.get('id')||'').replace(/^eq\./,'')
    const patch=request.postDataJSON()||{}
    fixture.events=fixture.events.map(row=>String(row.id)===target?{...row,...patch,matters:matterById(patch.matter_id??row.matter_id),team_members:null}:row)
    const updated=fixture.events.find(row=>String(row.id)===target)
    return respond(single?updated:[updated])
   }
   return respond(fixture.events)
  }
  if(table==='case_mio_user_state'){
   if(request.method()==='POST')return respond([],201)
   return respond([...fixture.states.values()])
  }
  if(table==='matters')return respond(matters)
  if(table==='clients')return respond(matters.map(matter=>({id:matter.client_id,...matter.clients})))
  if(table==='team_members'){const member={id:'synthetic-member',email,first_name:'Calendar',last_name:'Test',is_active:true,page_access:[]};return respond(single?member:[member])}
  return respond(single?null:[])
 })
 await context.addInitScript(({session})=>{
  if(!['http://127.0.0.1:4173','http://localhost:4173'].includes(location.origin))return
  if(!sessionStorage.getItem('test-initialized')){localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session));sessionStorage.setItem('test-initialized','true')}
  // Record cross-window invalidations without changing their delivery.
  const Bridge=window.BroadcastChannel
  window.__mioChannelMessages=[]
  window.BroadcastChannel=class extends Bridge{
   postMessage(data){try{window.__mioChannelMessages.push({name:this.name,data})}catch{}return super.postMessage(data)}
  }
 },{session})
 const openApp=async hash=>{
  const page=await context.newPage()
  await page.goto(`http://127.0.0.1:4173/${hash?`#${hash}`:''}`,{waitUntil:'domcontentloaded'})
  await page.locator('[data-mio-cloud-phase="ready"][data-mio-cloud-pending="0"]').waitFor({timeout:90000})
  return page
 }
 const workspace=await openApp('calendar')
 const calendar=await openApp('calendar')
 const eventBlock=title=>calendar.getByText(title,{exact:false}).first()
 const waitVisible=title=>eventBlock(title).waitFor({timeout:20000})
 const waitHidden=async title=>{await assert.rejects(eventBlock(title).waitFor({timeout:2500,state:'attached'}),/\w/,'expected '+title+' to stay hidden')}
 const notice=calendar.getByText(/hidden by the Case status \/ Matter status filters/)
 await waitVisible('Hearing: active matter')
 await waitVisible('Hearing: jennifers tos')
 await waitHidden('Hearing: closed matter')
 await notice.waitFor({timeout:5000})
 assert.match(await notice.textContent(),/1 event in this month is hidden/)
 const matterPanel=calendar.locator('details').filter({hasText:'Matter status'})
 await matterPanel.locator('summary').click()
 await matterPanel.getByLabel('Closed',{exact:true}).uncheck()
 await waitVisible('Hearing: active matter')
 await waitVisible('Hearing: jennifers tos')
 await waitHidden('Hearing: closed matter')
 await matterPanel.getByRole('button',{name:'None',exact:true}).click()
 await waitHidden('Hearing: active matter')
 await waitHidden('Hearing: closed matter')
 await waitVisible('Hearing: jennifers tos')
 assert.match(await notice.textContent(),/2 events in this month are hidden/)
 await calendar.getByRole('button',{name:'Show all events',exact:true}).click()
 await waitVisible('Hearing: active matter')
 await waitVisible('Hearing: jennifers tos')
 await waitVisible('Hearing: closed matter')
 await assert.rejects(notice.waitFor({timeout:2500,state:'attached'}),/\w/,'the hidden-event notice disappears once nothing is hidden')
 await calendar.screenshot({path:'test-results/calendar-status-filter-transparency.png'})
 console.log('PASS: the calendar states how many events its status filters hide and can show them all')

 // Another window saving a Notification-of-Service event updates this open calendar
 // without a full page reload.
 await calendar.evaluate(()=>{window.__calendarSyncMarker='kept'})
 fixture.events.push(eventRow({id:'event-cross-tab',title:'Hearing: notification of service',matterId:'matter-blank',date:today}))
 await workspace.evaluate(()=>{const channel=new BroadcastChannel('mio-calendar-events-v321');channel.postMessage({type:'calendar-changed'});channel.close()})
 await waitVisible('Hearing: notification of service')
 assert.equal(await calendar.evaluate(()=>window.__calendarSyncMarker),'kept','the open calendar refreshed in place instead of reloading the window')

 // Creating the event in the app window broadcasts to the other open calendar.
 const clickedDay=await workspace.evaluate(dayNumber=>{
  const cells=[...document.querySelectorAll('td')].filter(cell=>cell.firstElementChild?.textContent?.trim()===String(dayNumber))
  const todayCell=cells.find(cell=>cell.style.border.startsWith('3px')) || cells[0]
  todayCell?.click()
  return todayCell ? String(todayCell.firstElementChild.textContent.trim()) : ''
 },todayDayNumber)
 assert.equal(clickedDay,String(todayDayNumber),'the calendar day cell for today was available to create the event')
 const titleField=workspace.locator('label').filter({hasText:'Event Title *'}).locator('input')
 await titleField.waitFor({timeout:10000})
 await titleField.fill('Hearing: created from notification of service')
 const eventForm=workspace.locator('form').filter({has:workspace.locator('label',{hasText:'Event Title *'})})
 await eventForm.getByRole('button',{name:'Add',exact:true}).click()
 await calendar.getByText('Hearing: created from notification of service',{exact:false}).first().waitFor({timeout:20000})
 const sent=await workspace.evaluate(()=>window.__mioChannelMessages.filter(message=>message.name==='mio-calendar-events-v321'))
 assert.ok(sent.length>=1,'saving an event broadcasts a calendar invalidation to other windows')
 assert.ok(fixture.events.some(event=>event.title==='Hearing: created from notification of service'&&event.start_date===today),'the created event was saved for the clicked day')
 assert.equal(await calendar.evaluate(()=>window.__calendarSyncMarker),'kept','the other window picked up the new event without reloading')
 await calendar.screenshot({path:'test-results/calendar-cross-window-event.png'})
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({test:'notification-of-service events reach every open calendar',statusFilterFix:true,crossWindowRefresh:'in place',createdEventVisible:true,invalidationsSent:sent.length,cloudStateWrites:writes.length,windowReloads:0}))
}finally{await context.close();await browser.close()}
