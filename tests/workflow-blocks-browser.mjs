// Synthetic fixtures only. No real mail, filings, accounts or case data.
import {chromium} from 'playwright-core'
import JSZip from 'jszip'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {newWithdrawal} from '../src/mioWithdrawalWorkspaceState.js'
import {chunkRows} from './cloud-chunk-fixture.js'
const require=createRequire(import.meta.url),browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']})
fs.mkdirSync('test-results',{recursive:true})
const owner='00000000-0000-4000-8000-000000000279',email='workflow-test@example.invalid',now=new Date().toISOString()
const ago=days=>new Date(Date.now()-days*86400000).toISOString(),future=days=>new Date(Date.now()+days*86400000).toISOString()
const user={id:owner,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:now}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.test`,refresh_token:'test-only',expires_at:exp,expires_in:3600,token_type:'bearer',user}
const ids=['00000000-0000-4000-8000-000000000281','00000000-0000-4000-8000-000000000282','00000000-0000-4000-8000-000000000283']
const matters=ids.map((id,i)=>({id,name:['Alpha matter','Beta matter','Gamma matter'][i],case_type:i===0?'Divorce':'Modification',matter_type:i===0?'Divorce':'SAPCR/Modification',matter_status:'Served- Need to Finalize',is_active:true,case_status:'Open',cause_number:`TEST-${i+1}`,created_at:ago(90),clients:{first_name:['Alpha','Beta','Gamma'][i],last_name:'Client',email:`client${i}@example.invalid`},courts:{court_name:'Synthetic court',county:'Synthetic'}}))
const a=newWithdrawal(ids[0],ago(15),ago(7)),b=newWithdrawal(ids[1],ago(30),ago(3)),c=newWithdrawal(ids[2],ago(4),ago(2))
b.steps.decision={...b.steps.decision,status:'waiting',attention_since:null,waiting_on:'Client response',due_at:future(5),last_outbound_at:ago(3)}
a.steps.decision={...a.steps.decision,status:'complete',evidence:{reference:'synthetic decision'},note:'Reviewed'};a.steps.drafting={...a.steps.drafting,status:'needs_action',attention_since:ago(7)}
const workflows=new Map([a,b,c].map(state=>[state.matter_id,{owner_id:owner,matter_id:state.matter_id,state,revision:1}]))
const xml='<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{case_caption_text}}</w:t></w:r></w:p><w:p><w:r><w:t>{{attorney_signature_block}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
const zip=new JSZip();zip.file('word/document.xml',xml);zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
const encoded='data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,'+await zip.generateAsync({type:'base64'})
const profile={withdrawal_templates:{motion:'template-test'},active_signature_block_id:'sig-test',default_case_style_id:'sapcr-test',case_styles:[{id:'divorce-test',name:'Test Divorce',kind:'divorce',requires_children:false,line_1:'IN THE MATTER OF THE MARRIAGE OF',line_2:'{{client_name}}',is_active:true},{id:'sapcr-test',name:'Test SAPCR',kind:'sapcr',line_1:'IN THE INTEREST OF',line_2:'{{client_name}}',is_active:true}],signature_blocks:[{id:'sig-test',name:'Test signature',attorney_name:'Test Attorney',firm_name:'Synthetic Firm',signature_text:'/s/ {{attorney_name}}\n{{firm_name}}',is_active:true}]}
const template={id:'template-test',name:'Synthetic Word template',status:'approved',engine:'docx_assembly',is_active:true,fields:[],bindings:[],files:[{id:'word-a',name:'Motion.docx',file_data:encoded,include_by_default:true},{id:'word-b',name:'Order.docx',file_data:encoded,include_by_default:true}]}
const docs=[{id:'order-a',matter_id:ids[0],file_name:'Alpha-reviewed-order.pdf',file_type:'application/pdf',file_path:'synthetic/alpha-order.pdf'},{id:'pdf-a',matter_id:ids[0],file_name:'Alpha-reviewed-motion.pdf',file_type:'application/pdf',file_path:'synthetic/alpha-reviewed.pdf'},{id:'pdf-b',matter_id:ids[1],file_name:'Beta-private-motion.pdf',file_type:'application/pdf'}]
const states=new Map(Object.entries({caseControllerDocuments:docs,caseMioBillingEntries:[{id:'prior-a',matter_id:ids[0],matter_step:'Withdrawal - Prepare and approve motion / order',date:now.slice(0,10),description:'Earlier withdrawal review',billing_time:.2,amount:60},{id:'prior-b',matter_id:ids[1],matter_step:'Withdrawal - Draft',description:'Other client private time',billing_time:.9,amount:270}],caseMioDraftingProfile:profile,caseMioDraftingTemplates:[template],caseMioDraftingSessionV278:{matter_id:ids[0],template_id:template.id,selected_file_names:['word-a','word-b'],field_values:{}}}).map(([key,value])=>[key,{key,raw_value:JSON.stringify(value),json_value:value,updated_at:ago(1)}]))
const context=await browser.newContext({viewport:{width:1600,height:1100}}),page=await context.newPage(),errors=[],events=[]
page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000)
page.on('pageerror',error=>errors.push(error.message))
page.on('dialog',async dialog=>{if(dialog.type()==='beforeunload'||dialog.type()==='confirm')await dialog.accept();else await dialog.dismiss()})
await context.addInitScript({path:require.resolve('jszip/dist/jszip.min.js')})
await context.addInitScript(({session})=>{localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session));window.__appDiskWrites=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(this===localStorage&&/^(caseMio|caseController)/.test(key)&&!/^caseMio(BackgroundLeaseV258:|SupabaseSessionV1$)/.test(key))window.__appDiskWrites.push(key);return original.call(this,key,value)}},{session})
await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 if(['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='4173'){if(url.pathname.startsWith('/api/'))return respond({connected:false,data:[]});return route.continue()}
 if(!url.hostname.endsWith('.supabase.co')){if(req.method()!=='GET')throw new Error('Unexpected external write: '+url.hostname+url.pathname);return respond({})}
 if(url.pathname.includes('/storage/v1/object/')&&req.method()==='GET')return route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from('%PDF-1.4\n% Synthetic test only')})
 if(url.pathname.includes('/auth/v1/'))return respond(url.pathname.endsWith('/user')?user:session)
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object')
 if(table==='mio_cloud_state_read_chunks_v297')return respond(chunkRows([...states.values()].map(row=>({...row,user_id:owner})),req.postDataJSON()))
 if(table==='mio_cloud_state_write_v277'){const p=req.postDataJSON(),old=states.get(p.p_key);if(old?.raw_value!==p.p_raw&&(!!old!==p.p_expected_exists||old&&old.updated_at!==p.p_expected_at))return respond({code:'40001',message:'Stale write'},409);const row={key:p.p_key,raw_value:p.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(p.p_key,row);return respond(row)}
 if(table==='case_mio_user_state'){let data=[...states.values()];const key=url.searchParams.get('key');if(key?.startsWith('eq.'))data=data.filter(r=>r.key===key.slice(3));return respond(single?data[0]||null:data)}
 if(table==='setting_options')return respond(Object.entries({matter_status:['PNC- Need to Consult','Consult- Need to Client','Client-Need to Draft','Drafted- Need to Serve','Served- Need to Finalize','Finalized- Need Order','Order- Need to Close','Closed'],case_status:['Closed','Open','Open- Withdrawing'],matter_type:['DFPS','SAPCR/Modification','Divorce','Other']}).flatMap(([category,names])=>names.map((name,i)=>({id:category+'-'+i,category,name,is_active:true,sort_order:i}))));
 if(table==='documents')return respond(single?null:docs)
 if(table==='billing_entries'&&req.method()==='POST')return respond(single?req.postDataJSON():[req.postDataJSON()])
 if(table==='matters'){const id=url.searchParams.get('id')?.slice(3),record=matters.find(m=>m.id===id)||matters[0];if(req.method()==='PATCH')Object.assign(record,req.postDataJSON());return respond(single?record:matters)}
 if(table==='mio_withdrawal_workflows'){let rows=[...workflows.values()];const id=url.searchParams.get('matter_id');if(id?.startsWith('eq.'))rows=rows.filter(r=>r.matter_id===id.slice(3));return respond(single?rows[0]||null:rows)}
 if(['mio_save_withdrawal_v1','mio_save_workflow_blocks_v1'].includes(table)){const p=req.postDataJSON(),old=workflows.get(p.p_matter_id);if((old?.revision||0)!==p.p_expected_revision)return respond({code:'40001',message:'Stale workflow'},409);const row={owner_id:owner,matter_id:p.p_matter_id,revision:(old?.revision||0)+1,state:p.p_state};workflows.set(p.p_matter_id,row);events.push({event_id:p.p_event_id,event:p.p_event,revision:row.revision,recorded_at:new Date().toISOString()});return respond(row)}
 if(table==='mio_withdrawal_events')return respond(events)
 if(table==='team_members'){const m={id:'test-member',email,first_name:'Synthetic',last_name:'Attorney',is_active:true,page_access:[]};return respond(single?m:[m])}
 return respond(single?null:[])
})
const settle=async fn=>{for(let i=0;i<100;i++){if(fn())return;await page.waitForTimeout(100)}assert.ok(fn(),'State did not settle')}
try{
 await page.goto('http://127.0.0.1:4173/#withdrawals',{waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000})
 assert.match(await page.locator('body').innerText(),/Mio V305/)
 for(const text of ['Matter status (All of 8)','Case status (All of 3)','Case type (All of 4)'])assert.equal(await page.getByText(text,{exact:true}).count(),1)
 await page.getByText('Case type (All of 4)',{exact:true}).click()
 const filter=page.locator('.mio-block-filter').filter({hasText:'Case type'})
 await filter.getByRole('button',{name:'Clear all',exact:true}).click()
 await filter.getByLabel('Divorce',{exact:true}).check()
 await page.getByLabel('Graph type',{exact:true}).selectOption('trust_minus_wip_minus_outstanding_minus_minimum')
 await page.getByLabel('Period',{exact:true}).selectOption('180')
 await page.getByLabel('Specific matter',{exact:true}).selectOption(ids[0])
 await page.getByRole('button',{name:'Hide graph',exact:true}).click()
 await settle(()=>{const s=states.get('caseMioWithdrawalViewV305');return s&&JSON.parse(s.raw_value).days==='180'&&!JSON.parse(s.raw_value).open})
 await page.reload({waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000})
 assert.equal(await page.getByLabel('Graph type',{exact:true}).inputValue(),'trust_minus_wip_minus_outstanding_minus_minimum')
 assert.equal(await page.getByLabel('Period',{exact:true}).inputValue(),'180')
 assert.equal(await page.getByLabel('Specific matter',{exact:true}).inputValue(),ids[0])
 assert.equal(await page.getByRole('button',{name:'Show graph',exact:true}).count(),1)
 assert.match(await page.locator('.mio-block-filter').filter({hasText:'Case type'}).innerText(),/1 of 4/)
 console.log('PASS exact settings options and cloud-persisted multi-filters, metric, period and graph visibility after hard reload')
 await page.locator('.mio-blocks > header').getByRole('button',{name:'Settings',exact:true}).click()
 const settings=page.locator('.mio-block-workflow-settings')
 assert.doesNotMatch(await settings.innerText(),/Fallback case style|Shared page setup defaults|Caption and signature library/)
 const download=page.waitForEvent('download');await settings.getByRole('button',{name:'Download flow sheet',exact:true}).click();assert.match((await download).suggestedFilename(),/Flow-Sheet/)
 await settings.getByRole('button',{name:'Edit rows, steps and document slots'}).click()
 const builder=settings.locator('.mio-block-builder')
 await builder.getByRole('button',{name:'+ Add row',exact:true}).click()
 await builder.getByLabel('Row name 5',{exact:true}).fill('Extra review row')
 await builder.getByRole('button',{name:'+ Add step to Extra review row',exact:true}).click()
 await builder.getByLabel('Step name',{exact:true}).fill('Custom follow-up')
 await builder.getByLabel('Step action',{exact:true}).selectOption('draft_email')
 await builder.getByRole('button',{name:'Save workflow definition',exact:true}).click()
 await settle(()=>JSON.parse(states.get('caseMioWithdrawalDefinitionV305')?.raw_value||'{}').rows?.length===5)
 await builder.getByRole('button',{name:'Close editor',exact:true}).click()
 await settings.getByRole('button',{name:'Close settings',exact:true}).click()
 const alpha=()=>page.locator('tr.mio-block-summary').filter({hasText:'Alpha matter'}),detail=()=>page.locator('.mio-block-expanded')
 await alpha().getByRole('button',{name:'Review',exact:true}).click()
 await settle(()=>!!workflows.get(ids[0]).state.definition)
 assert.equal(await alpha().evaluate(el=>el.nextElementSibling?.className),'mio-block-expanded')
 assert.equal(workflows.get(ids[0]).state.steps.decision.status,'complete')
 assert.equal(await detail().locator('.mio-block-lane').count(),5)
 console.log('PASS settings-only layout, dynamic flow-sheet download, reusable template editor and preserved prior progress')
 await detail().getByRole('button',{name:'Add note',exact:true}).click()
 await page.getByLabel('Step note',{exact:true}).fill('Synthetic inline note')
 await page.getByRole('button',{name:'Save note',exact:true}).click()
 await page.locator('dialog[open]').waitFor({state:'hidden'})
 assert.equal(workflows.get(ids[0]).state.workspace_notes[0].note,'Synthetic inline note')
 await detail().getByRole('button',{name:'Pause',exact:true}).click()
 await detail().getByRole('button',{name:'Resume',exact:true}).waitFor()
 assert.equal(await detail().getByRole('button',{name:'Draft document',exact:true}).isDisabled(),true)
 await detail().getByRole('button',{name:'Resume',exact:true}).click()
 await detail().getByRole('button',{name:'Pause',exact:true}).waitFor()
 assert.match(await detail().locator('.mio-block-billing-box').innerText(),/Earlier withdrawal review/)
 assert.doesNotMatch(await detail().locator('.mio-block-billing-box').innerText(),/Other client private time/)
 await detail().getByRole('button',{name:/Add time/}).click()
 await page.getByRole('heading',{name:'Add Billing Entry',exact:true}).waitFor()
 await page.getByPlaceholder('Examples: .1, 6m, 66 min, 1h 6 min, 1.1').fill('.3')
 await page.getByRole('button',{name:'Save Time Entry',exact:true}).click()
 await settle(()=>JSON.parse(states.get('caseMioBillingEntries').raw_value).length===3)
 await detail().getByRole('button',{name:'Draft document',exact:true}).click()
 await page.getByRole('button',{name:'Return to withdrawal row',exact:true}).waitFor({timeout:60000})
 await page.getByRole('heading',{name:'Generated editable Word documents',exact:true}).waitFor({timeout:60000})
 assert.equal(workflows.get(ids[0]).state.steps.drafting.status,'needs_action')
 await page.getByRole('button',{name:'Return to withdrawal row',exact:true}).click()
 await detail().waitFor()
 console.log('PASS actual connected DOCX template generation; no implicit completion')
 async function attach(slotName,docId){await detail().getByRole('button',{name:new RegExp('^'+slotName)}).click();const modal=page.locator('dialog[open]');assert.doesNotMatch(await modal.getByLabel('Saved matter document',{exact:true}).innerText(),/Beta-private/);await modal.getByLabel('Saved matter document',{exact:true}).selectOption(docId);await modal.getByRole('button',{name:'Attach reviewed document to this slot',exact:true}).click();await modal.waitFor({state:'hidden'})}
 await attach('Draft motion to withdraw','pdf-a')
 await attach('Draft withdrawal order','order-a')
 await detail().getByRole('button',{name:'Approve & complete step',exact:true}).click()
 await page.getByText('Completion saved to Supabase.',{exact:true}).waitFor()
 assert.equal(workflows.get(ids[0]).state.steps.drafting.status,'complete')
 await page.locator('dialog[open]').getByRole('button',{name:'Prepare e-filing',exact:true}).click()
 await page.getByText('Workflow input PDFs connected.',{exact:false}).waitFor({timeout:15000})
 assert.match(await page.locator('body').innerText(),/Alpha-reviewed-motion.pdf/)
 assert.equal(events.some(e=>e.event.type==='efile_update'),false)
 // Different query forces a full reload instead of racing the app's hash sync after setPage('efile').
 await page.goto('http://127.0.0.1:4173/?workflow-return=1#withdrawals',{waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000})
 if(!(await detail().count()))await alpha().getByRole('button',{name:'Review',exact:true}).click()
 console.log('PASS notes, pause/resume, billing, shared slots, step approval and real PDF handoff without submitting')
 await detail().getByRole('button',{name:'Already completed',exact:true}).click()
 await page.getByText('Completion saved to Supabase.',{exact:true}).waitFor()
 assert.equal(workflows.get(ids[0]).state.steps.filing.status,'complete')
 assert.equal(workflows.get(ids[0]).state.document_slots.motion_filed.versions.length,0)
 await page.locator('dialog[open]').getByRole('button',{name:'Go to next step',exact:true}).click()
 await detail().getByRole('button',{name:/Choose people \/ message/}).click()
 const recipients=page.locator('dialog[open]')
 assert.doesNotMatch(await recipients.innerText(),/client1@example.invalid|client2@example.invalid/)
 await recipients.getByLabel(/client0@example.invalid/).first().check()
 await recipients.getByRole('button',{name:'Save recipients and message',exact:true}).click()
 await recipients.waitFor({state:'hidden'})
 assert.equal(workflows.get(ids[0]).state.steps.service.recipient_ids.length,1)
 console.log('PASS historical completion bypass does not invent output; recipients restricted to matter')
 await detail().getByRole('button',{name:'Edit this process',exact:true}).click()
 const instance=page.locator('dialog[open] .mio-block-builder')
 await instance.locator('.mio-block-tools').filter({has:page.getByRole('button',{name:'Verify initial service / delivery',exact:true})}).getByRole('button',{name:'Delete step',exact:true}).click()
 await instance.getByRole('button',{name:'Save workflow definition',exact:true}).click()
 await page.locator('dialog[open]').waitFor({state:'hidden'})
 assert.equal(workflows.get(ids[0]).state.definition.steps.some(s=>s.id==='service'),false)
 assert.ok(workflows.get(ids[0]).state.steps.service)
 assert.equal(workflows.get(ids[0]).state.definition.steps.find(s=>s.id==='client_signature').depends_on.includes('filing'),true)
 assert.equal(JSON.parse(states.get('caseMioWithdrawalDefinitionV305').raw_value).steps.some(s=>s.id==='service'),true)
 await page.reload({waitUntil:'domcontentloaded'})
 await page.getByRole('heading',{name:'Withdrawal dashboard',exact:true}).waitFor({timeout:60000})
 await alpha().getByRole('button',{name:'Review',exact:true}).click()
 assert.equal(workflows.get(ids[0]).state.definition.steps.some(s=>s.id==='service'),false)
 assert.equal(await detail().getByRole('button',{name:/File-stamped motion/}).count(),1)
 await page.screenshot({path:'test-results/workflow-blocks.png',fullPage:true})
 assert.deepEqual(errors,[])
 assert.deepEqual(await page.evaluate(()=>window.__appDiskWrites),[])
 console.log('PASS editable instance, rewired dependencies, retained history and slot persistence; no local case-data storage')
}catch(error){await page.screenshot({path:'test-results/failure.png',fullPage:true});fs.writeFileSync('test-results/failure.txt',String(error)+'\n'+errors.join('\n')+'\n'+await page.locator('body').innerText());throw error}finally{await browser.close()}
