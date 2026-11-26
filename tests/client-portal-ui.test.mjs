import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {transformWithOxc} from 'vite'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {mountClientPortal} from '../mio-client-portal-mount.js'
const dir=new URL('../src/portal/',import.meta.url)
async function setup(){for(const name of ['ClientPortal','StaffPortal','StaffClientView','DiscoveryPortal','StaffDiscovery']){let s=await fs.readFile(new URL(name+'.jsx',dir),'utf8');s=s.replaceAll("'./ClientPortal.jsx'","'./ClientPortal.test-render.mjs'").replaceAll("'./DiscoveryPortal.jsx'","'./DiscoveryPortal.test-render.mjs'").replaceAll("'./StaffDiscovery.jsx'","'./StaffDiscovery.test-render.mjs'");const r=await transformWithOxc(s,name+'.jsx',{jsx:{runtime:'automatic'}});await fs.writeFile(new URL(name+'.test-render.mjs',dir),r.code)}const dom=new JSDOM('<div id="root"></div>',{url:'https://case-controller-mio.vercel.app/?client-portal=1'});for(const k of ['window','document','HTMLElement','Event'])globalThis[k]=dom.window[k];globalThis.IS_REACT_ACT_ENVIRONMENT=true;return createRoot(document.getElementById('root'))}
test('staff invitation uses selected matter and offers the client-view window',async()=>{const root=await setup(),{default:C}=await import(new URL('StaffPortal.test-render.mjs',dir)),calls=[],snapshot={matter:{id:'m',name:'Matter'},agreement:{status:'not_sent'},forms:[],invoices:[]},api=async(a,b)=>{calls.push([a,b]);return a==='staff_overview'?snapshot:{grants:[],events:[]}};await act(async()=>root.render(React.createElement(C,{matterId:'m',matters:[{id:'m',name:'Test',clients:{email:'client@example.com'}}],api,templates:[{id:'t',name:'Family Intake'}]})));const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);assert.match(document.body.textContent,/office@beveridgelawfirm.com/);assert.match(document.body.textContent,/Assign intake form/);await act(async()=>button('Invite client').click());assert(calls.some(([a,b])=>a==='invite'&&b.matter_id==='m'));assert(button('Interact as Client'));assert.equal(button('Preview client view'),undefined);await act(async()=>root.unmount())})
test('payments show partial balance, PDF and pay actions disabled in preview',async()=>{const root=await setup(),{PortalContent:C}=await import(new URL('ClientPortal.test-render.mjs',dir));await act(async()=>root.render(React.createElement(C,{snapshot:{matter:{id:'m'},agreement:{status:'not_sent'},forms:[],invoices:[{id:'i',invoice_number:'INV-1',total:100,amount_paid:35,balance:65}]},preview:true})));await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Payments')).click());assert.match(document.body.textContent,/65\.00/);assert.match(document.body.textContent,/View \/ Download PDF/);assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Pay $65.00').disabled,true);await act(async()=>root.unmount())})
test('both staff entry points mount and source anchor drift fails the build',async()=>{const app=await fs.readFile(new URL('../src/App.jsx',import.meta.url),'utf8'),out=mountClientPortal(app);assert.match(out,/value:'client_portal',label:'Client Portal'/);assert.match(out,/clientDashboardTab === 'client_portal'/);assert.match(out,/page === 'client_portal'/);assert.throws(()=>mountClientPortal('invalid'))})
test.after(async()=>{for(const n of ['ClientPortal','StaffPortal','StaffClientView','DiscoveryPortal','StaffDiscovery'])await fs.unlink(new URL(n+'.test-render.mjs',dir)).catch(()=>{})})

test('signing out the wrong account keeps the invitation registration flow',async()=>{const root=await setup(),{default:C}=await import(new URL('ClientPortal.test-render.mjs',dir)),original=globalThis.fetch;window.location.hash='#invite/'+'a'.repeat(64);globalThis.fetch=async(url,options)=>{const {action}=JSON.parse(options.body);return new Response(JSON.stringify(action==='invite_info'?{email:'invited@example.com',existing_account:true}:action==='session'?{email:'wrong@example.com',matters:[]}:{ok:true}),{status:200,headers:{'Content-Type':'application/json'}})};try{await act(async()=>root.render(React.createElement(C)));const signout=[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign out');await act(async()=>signout.click());assert.match(document.body.textContent,/Sign in to accept invitation/);assert.equal(document.querySelector('input[type=email]').value,'invited@example.com')}finally{globalThis.fetch=original;await act(async()=>root.unmount())}})
test('a delayed earlier matter response cannot overwrite a newer staff selection',async()=>{const root=await setup(),{default:C}=await import(new URL('StaffPortal.test-render.mjs',dir));let finishOld;const s=id=>({matter:{id,name:id},agreement:{status:'not_sent'},forms:[],invoices:[{id,invoice_number:id==='a'?'PRIVATE-OLD':'CURRENT-NEW',balance:20}]});const api=async(action,b)=>{if(action==='staff_overview')return b.matter_id==='a'?new Promise(resolve=>{finishOld=resolve}):s('b');return {grants:[],summaries:[],events:[]}},matters=[{id:'a',name:'First',clients:{email:'a@example.com'}},{id:'b',name:'Second',clients:{email:'b@example.com'}}];await act(async()=>root.render(React.createElement(C,{matterId:'a',matters,api})));await act(async()=>root.render(React.createElement(C,{matterId:'b',matters,api})));await act(async()=>finishOld(s('a')));assert.match(document.body.textContent,/CURRENT-NEW/);assert.doesNotMatch(document.body.textContent,/PRIVATE-OLD/);await act(async()=>root.unmount())})

test('assigned intake uses template field types and submits only the selected request',async()=>{const root=await setup(),{PortalContent:C}=await import(new URL('ClientPortal.test-render.mjs',dir)),calls=[];const questions=[{key:'email',label:'Contact email',type:'email',required:true},{key:'date',label:'Birth date',type:'date'},{key:'children',label:'Children',type:'children'}];await act(async()=>root.render(React.createElement(C,{snapshot:{matter:{id:'m'},agreement:{},invoices:[],forms:[{id:'form',title:'Family intake',status:'pending',expires_at:'2999-01-01',template_snapshot:{questions}}]},api:async(a,b)=>{calls.push([a,b]);return {ok:true}}})));await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Fill out intake form').click());assert.equal(document.querySelector('input[type=email]').required,true);assert(document.querySelector('input[type=date]'));assert.match(document.querySelector('textarea').placeholder,/One child per line/);await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(calls[0][0],'intake_submit');assert.equal(calls[0][1].request_id,'form');assert.equal(calls[0][1].matter_id,'m');await act(async()=>root.unmount())})
test('staff can send intake email for an existing assignment',async()=>{const root=await setup(),{default:C}=await import(new URL('StaffPortal.test-render.mjs',dir)),calls=[],api=async(a,b)=>{calls.push([a,b]);return a==='staff_overview'?{matter:{id:'m'},agreement:{},invoices:[],forms:[{id:'f',title:'Family intake',status:'pending',expires_at:'2999-01-01'}]}:a==='staff_list'?{grants:[{matter_id:'m',email:'client@example.com',accepted_at:'now'}]}:{events:[]}};await act(async()=>root.render(React.createElement(C,{matterId:'m',matters:[{id:'m',clients:{email:'client@example.com'}}],api})));await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Send intake email').click());assert(calls.some(([a,b])=>a==='staff_send_intake'&&b.matter_id==='m'&&b.request_id==='f'));await act(async()=>root.unmount())})

test('portal integration mounts the staff app with only the main app React imports',async()=>{
 const root=await setup();
 const source=`import React from 'react'
 const appPages = []
 const serviceGraphConfig={},serviceGraphAuth={},page='billing',matters=[],draftingIntakeTemplates=[]
 const effectiveMatterId='',respondingDiscoverySets=[];
 const clientDashboardTab='matter_information',isFirmStaffMember=()=>true,canOpenPage=()=>true
 const setClientDashboardTab=()=>{},selectedTemplateMatter=()=>null
 const renderBillingPage=()=>React.createElement('p',null,'Staff app mounted')
 const renderClientDashboardMatterInformation=()=>null
 export default function Host(){
  function renderClientDashboardFeeAgreement(matter) { return null }
  return <>
    <h2 style={{ margin: 0 }}>Responding to Discovery</h2>
        {page === 'billing' && canOpenPage('billing') && renderBillingPage()}
                  <button
                    type="button"
                    onClick={() => setClientDashboardTab('fee_agreement')}>Fee agreement</button>
                {clientDashboardTab === 'matter_information' && renderClientDashboardMatterInformation(selectedTemplateMatter())}
  </>
 }
 `;
 const mounted=mountClientPortal(source).replace("import StaffPortal from './portal/StaffPortal.jsx'",'const StaffPortal=()=>null').replace("import StaffDiscovery from './portal/StaffDiscovery.jsx'",'const StaffDiscovery=()=>null').replace("import './portal/portal.css'",'');
 const output=await transformWithOxc(mounted,'PortalHost.jsx',{jsx:{runtime:'automatic'}});
 const file=new URL('PortalHost.test-render.mjs',dir);
 try{await fs.writeFile(file,output.code);const {default:Host}=await import(file.href+'?startup='+Date.now());await act(async()=>root.render(React.createElement(Host)));assert.match(document.body.textContent,/Staff app mounted/)}finally{await act(async()=>root.unmount());await fs.unlink(file).catch(()=>{})}
})

test('Interact as Client opens a matter-scoped window without placing credentials in its URL',async()=>{const root=await setup(),{default:C}=await import(new URL('StaffPortal.test-render.mjs',dir)),opened=[],old=window.open;window.open=(...args)=>opened.push(args);const api=async a=>a==='staff_overview'?{matter:{id:'m'},agreement:{},forms:[],invoices:[]}:{grants:[],events:[]};try{await act(async()=>root.render(React.createElement(C,{matterId:'m',matters:[{id:'m',name:'Matter',clients:{email:'c@example.com'}}],api})));await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Interact as Client').click());assert.deepEqual(opened,[['/?client-portal=1&staff-matter=m','_blank','noopener,noreferrer']])}finally{window.open=old;await act(async()=>root.unmount())}})
test('staff client view lets the attorney inspect forms without submitting client answers',async()=>{const root=await setup(),{default:C}=await import(new URL('StaffClientView.test-render.mjs',dir)),calls=[],state={matter:{id:'m',name:'Matter',client_name:'Current Client'},viewer:{email:'client@example.com',can_submit_intake:false},agreement:{},invoices:[],forms:[{id:'f',title:'Assigned intake',status:'pending',expires_at:'2999-01-01',template_snapshot:{questions:[{key:'name',label:'Name',type:'text'}]}}]},api=async(a,b)=>{calls.push([a,b]);return state};await act(async()=>root.render(React.createElement(C,{matterId:'m',api})));assert.match(document.body.textContent,/client@example.com/);await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Fill out intake form').click());assert(document.querySelector('form input'));assert([...document.querySelectorAll('button')].find(b=>b.textContent==='Submit intake form').disabled);await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(calls.filter(([a])=>a==='staff_client_action').length,0);await act(async()=>root.unmount())})
test('the dedicated test client view submits its intake using the staff-authorized test endpoint',async()=>{const root=await setup(),{default:C}=await import(new URL('StaffClientView.test-render.mjs',dir)),calls=[],state={matter:{id:'m',name:'Test - Ben Test Matter',client_name:'Ben'},viewer:{email:'ben@example.com',can_submit_intake:true},agreement:{},invoices:[],forms:[{id:'f',title:'Test form',status:'pending',expires_at:'2999-01-01',template_snapshot:{questions:[]}}]},api=async(a,b)=>{calls.push([a,b]);return a==='staff_client_view'?state:{ok:true}};await act(async()=>root.render(React.createElement(C,{matterId:'m',api})));await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Fill out intake form').click());assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Submit intake form').disabled,false);await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));assert(calls.some(([a,b])=>a==='staff_client_action'&&b.client_action==='intake_submit'&&b.matter_id==='m'&&b.request_id==='f'));assert.match(document.body.textContent,/test intake was submitted/);await act(async()=>root.unmount())})

test('production requests preserve optional guidance and autosave the selected response without a submit button',async()=>{
 const root=await setup(),{default:C}=await import(new URL('DiscoveryPortal.test-render.mjs',dir)),calls=[]
 const set={id:'s',title:'Production',discovery_type:'production',client_instructions:'Existing attorney instructions',requests:[{id:'r',request_number:'1',request_text:'Produce tax returns',client_must_respond:false,attorney_comments:'Specific instruction'}],answers:[],files:[]}
 const api=async(a,b)=>{calls.push([a,b]);return a==='discovery_list'?{sets:[set]}:{answer:{...b.answer,request_id:'r',version:1}}}
 await act(async()=>root.render(React.createElement(C,{matterId:'m',api})))
 await act(async()=>document.querySelector('.discovery-request-heading').click())
 assert.match(document.body.textContent,/No response required, but you may add information below/)
 assert.match(document.body.textContent,/Existing attorney instructions/)
 assert.match(document.body.textContent,/Specific instruction/)
 assert.equal(document.querySelector('input[type=file]').multiple,true)
 const select=document.querySelector('select');await act(async()=>{select.value=select.options[1].value;select.dispatchEvent(new window.Event('change',{bubbles:true}))})
 assert.equal(calls.filter(([a])=>a==='discovery_save').length,0)
 await act(async()=>{await new Promise(r=>setTimeout(r,800))})
 assert.equal(calls.filter(([a])=>a==='discovery_save').length,1)
 assert.equal(calls.find(([a])=>a==='discovery_save')[1].version,0)
 assert.match(document.body.textContent,/Saved online · Your attorney can see/)
 assert(![...document.querySelectorAll('button')].some(b=>/^Submit/.test(b.textContent)))
 await act(async()=>root.unmount())
})
test('a production upload is registered only after storage succeeds and remains visible after reopening the request',async()=>{
 const root=await setup(),{default:C}=await import(new URL('DiscoveryPortal.test-render.mjs',dir)),calls=[],oldFetch=globalThis.fetch
 const set={id:'s',title:'Production',discovery_type:'production',requests:[{id:'r',request_number:'1',request_text:'Statements',client_must_respond:true}],answers:[],files:[]}
 const api=async(a,b)=>{calls.push([a,b]);if(a==='discovery_list')return {sets:[set]};if(a==='discovery_upload_begin')return {file_id:'f',url:'https://storage.example/signed',content_type:'text/plain'};if(a==='discovery_upload_complete')return {file:{id:'f',request_id:'r',filename:'sample.txt',size_bytes:6,status:'ready'}};throw Error('Unexpected action')}
 globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://storage.example/signed');assert.equal(opts.method,'PUT');assert(opts.body instanceof FormData);return new Response('{}',{status:200})}
 try{
  await act(async()=>root.render(React.createElement(C,{matterId:'m',api})))
  const input=document.querySelector('input[type=file]');Object.defineProperty(input,'files',{value:[new File(['sample'],'sample.txt',{type:'text/plain'})]})
  await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})))
  assert.deepEqual(calls.filter(([a])=>a!=='discovery_list').map(([a])=>a),['discovery_upload_begin','discovery_upload_complete'])
  assert.match(document.body.textContent,/sample.txt/)
  const heading=()=>document.querySelector('.discovery-request-heading')
  await act(async()=>heading().click());await act(async()=>heading().click())
  assert.match(document.body.textContent,/sample.txt/)
 }finally{globalThis.fetch=oldFetch;await act(async()=>root.unmount())}
})

test('client discovery separates required requests and labels every collapsed optional request across all eleven items',async()=>{
 const root=await setup(),{default:C}=await import(new URL('DiscoveryPortal.test-render.mjs',dir))
 const requests=[11,10,1,9,2,8,3,7,4,6,5].map(n=>({id:'r'+n,request_number:String(n),request_text:'Disclosure request '+n,client_must_respond:n===5}))
 const api=async()=>({sets:[{id:'s',title:'Disclosures',discovery_type:'disclosures',requests,answers:[],files:[]}]})
 await act(async()=>root.render(React.createElement(C,{matterId:'m',api})))
 const required=document.querySelector('.required-column'),optional=document.querySelector('.optional-column')
 assert.deepEqual([...required.querySelectorAll('article')].map(a=>a.dataset.requestNumber),['5'])
 assert.deepEqual([...optional.querySelectorAll('article')].map(a=>a.dataset.requestNumber),['1','2','3','4','6','7','8','9','10','11'])
 assert.equal(optional.querySelectorAll('.discovery-requirement.is-optional').length,10)
 assert([...optional.querySelectorAll('.discovery-requirement')].every(b=>b.textContent==='No answer required'))
 assert.equal(required.querySelector('.discovery-requirement').textContent,'Answer required')
 assert.equal(required.querySelector('.discovery-request-heading').getAttribute('aria-expanded'),'true')
 assert.match(document.body.textContent,/Showing all 11 requests/)
 assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Next'),undefined)
 await act(async()=>required.querySelector('.discovery-request-heading').click())
 assert.equal(required.querySelector('.discovery-request-heading').getAttribute('aria-expanded'),'false')
 assert.equal(required.querySelector('.discovery-requirement').textContent,'Answer required')
 await act(async()=>root.unmount())
})
test('no-answer-required requests retain an editable answer field for the actual client',async()=>{
 const root=await setup(),{default:C}=await import(new URL('DiscoveryPortal.test-render.mjs',dir))
 const api=async()=>({sets:[{id:'s',title:'Disclosures',discovery_type:'disclosures',requests:[{id:'r11',request_number:'11',request_text:'Additional parties',client_must_respond:false}],answers:[],files:[]}]})
 await act(async()=>root.render(React.createElement(C,{matterId:'m',api})))
 assert.equal(document.querySelector('textarea'),null)
 await act(async()=>document.querySelector('.optional-column .discovery-request-heading').click())
 assert.equal(document.querySelector('textarea').disabled,false)
 assert.match(document.body.textContent,/No response required, but you may add information below/)
 await act(async()=>root.unmount())
})
test('requirements follow the attorney flag after refresh without depending on explanatory comments',async()=>{
 const root=await setup(),{default:C}=await import(new URL('DiscoveryPortal.test-render.mjs',dir));let current=5
 const api=async()=>({sets:[{id:'s',title:'Disclosures',discovery_type:'disclosures',requests:[5,6].map(n=>({id:'r'+n,request_number:String(n),request_text:'Request '+n,client_must_respond:current===n,attorney_comments:''})),answers:[],files:[]}]})
 await act(async()=>root.render(React.createElement(C,{matterId:'m',api})))
 assert.equal(document.querySelector('.required-column article').dataset.requestNumber,'5')
 current=6;await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh requests').click())
 assert.equal(document.querySelector('.required-column article').dataset.requestNumber,'6')
 assert.equal(document.querySelector('.optional-column article').dataset.requestNumber,'5')
 await act(async()=>root.unmount())
})

test('an offline client draft is recovered after reopening and saves after reconnect without changing requests',async()=>{
 const root=await setup(),{default:C}=await import(new URL('DiscoveryPortal.test-render.mjs',dir)),{draftPrefix}=await import('../src/portal/discoveryAutosave.js');let connected=false,writes=0
 const owner='client@example.test',scope={owner,matterId:'m',setId:'s',requestId:'r'}
 window.localStorage.setItem(draftPrefix(scope)+'previous-tab',JSON.stringify({schema:1,baseVersion:0,answer:{client_answer:'Recovered client words',client_comments:'Original comment'},updatedAt:Date.now()}))
 const api=async(a,b)=>{if(a==='discovery_list')return {sets:[{id:'s',title:'Disclosures',discovery_type:'disclosures',requests:[{id:'r',request_number:'1',request_text:'Describe the facts',client_must_respond:true}],answers:[],files:[]}]};if(!connected)throw Error('Network offline');writes++;return {answer:{...b.answer,version:1,request_id:'r'}}}
 try{
  await act(async()=>root.render(React.createElement(C,{matterId:'m',draftOwner:owner,api})))
  await act(async()=>{await new Promise(r=>setTimeout(r,20))})
  assert.equal(document.querySelector('textarea').value,'Recovered client words')
  assert.match(document.body.textContent,/Recovered your unsaved answer/)
  assert.match(document.body.textContent,/Some work is not saved online/)
  assert(window.localStorage.length>0)
  connected=true;await act(async()=>window.dispatchEvent(new window.Event('online')))
  assert.match(document.body.textContent,/Saved online/);assert.equal(writes,1)
  assert(![...Array(window.localStorage.length)].map((_,i)=>window.localStorage.key(i)).some(k=>k.startsWith(draftPrefix(scope))))
 }finally{await act(async()=>root.unmount())}
})
test('an expired session shows sign-in guidance while retaining the recovered draft',async()=>{
 const root=await setup(),{default:C}=await import(new URL('DiscoveryPortal.test-render.mjs',dir)),{draftPrefix}=await import('../src/portal/discoveryAutosave.js'),owner='client@example.test'
 const key=draftPrefix({owner,matterId:'m',setId:'s',requestId:'r'})+'prior'
 window.localStorage.setItem(key,JSON.stringify({schema:1,baseVersion:0,answer:{client_answer:'Do not lose this'},updatedAt:Date.now()}))
 const api=async a=>{if(a==='discovery_list')return {sets:[{id:'s',title:'Set',discovery_type:'disclosures',requests:[{id:'r',request_number:'1',request_text:'Question',client_must_respond:true}],answers:[],files:[]}]};throw Object.assign(Error('Your session expired. Sign in again.'),{status:401})}
 try{await act(async()=>root.render(React.createElement(C,{matterId:'m',draftOwner:owner,api})));await act(async()=>{await new Promise(r=>setTimeout(r,20))});assert.equal(document.querySelector('textarea').value,'Do not lose this');assert.match(document.body.textContent,/Please sign in again/);assert(document.querySelector('a[href*="client-portal"]'));assert(window.localStorage.getItem(key))}finally{await act(async()=>root.unmount())}
})
test('an uploaded file whose confirmation was lost can be finished after reopening without uploading it twice',async()=>{
 const root=await setup(),{default:C}=await import(new URL('DiscoveryPortal.test-render.mjs',dir)),calls=[]
 const api=async(a,b)=>{calls.push([a,b]);if(a==='discovery_list')return {sets:[{id:'s',title:'Production',discovery_type:'production',requests:[{id:'r',request_number:'1',request_text:'Produce records',client_must_respond:true}],answers:[],files:[{id:'f',request_id:'r',filename:'Records.pdf',size_bytes:100,status:'uploading'}]}]};if(a==='discovery_upload_complete')return {file:{id:'f',request_id:'r',filename:'Records.pdf',size_bytes:100,status:'ready'}};throw Error('Unexpected action')}
 try{await act(async()=>root.render(React.createElement(C,{matterId:'m',api})));assert.match(document.body.textContent,/not been confirmed/);await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Finish upload').click());assert(!calls.some(([a])=>a==='discovery_upload_begin'));assert(calls.some(([a])=>a==='discovery_upload_complete'));assert.match(document.body.textContent,/Uploaded for this request/);assert.doesNotMatch(document.querySelector('.discovery-save-bar').textContent,/not saved online/)}finally{await act(async()=>root.unmount())}
})
