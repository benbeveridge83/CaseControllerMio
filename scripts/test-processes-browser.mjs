// Tests the actual production bundle against synthetic data only.
import {chromium} from 'playwright-core';
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';
import {chunkRows} from '../tests/cloud-chunk-fixture.js';
const root=path.resolve('dist'),now=new Date().toISOString(),owner='00000000-0000-4000-8000-000000003140',email='process-test@example.invalid';
const user={id:owner,email,aud:'authenticated',role:'authenticated',email_confirmed_at:now,app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:now};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),exp=Math.floor(Date.now()/1000)+3600;
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,email,role:'authenticated',exp,aud:'authenticated'})}.test`,refresh_token:'test-only',expires_at:exp,expires_in:3600,token_type:'bearer',user};
const matters=[{id:'00000000-0000-4000-8000-000000004140',client_id:'client-process',name:'Synthetic process matter',matter_type:'Divorce',matter_status:'Client-Need to Draft',case_status:'Open',is_active:true,created_at:now,opposing_counsel_email:'counsel@example.invalid',clients:{id:'client-process',first_name:'Sample',last_name:'Client',email:'client@example.invalid'}}];
const states=new Map(),records=new Map(),billing=[],errors=[],alerts=[],external=[],writes=[];
let failNextSave=false;
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+path.sep)&&p!==root){res.writeHead(403);return res.end();}const f=fs.existsSync(p)&&fs.statSync(p).isFile()?p:path.join(root,'index.html');res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(f));});
await new Promise(r=>server.listen(4173,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1700,height:1100}}),page=await context.newPage();
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{if(d.type()==='alert')alerts.push(d.message());if(d.type()==='confirm')await d.accept();else await d.dismiss();});
await context.addInitScript(({session})=>localStorage.setItem('sb-vnnkxqpyndidnjbrbywz-auth-token',JSON.stringify(session)),{session});
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 if(url.hostname==='127.0.0.1'&&url.port==='4173'){if(url.pathname.startsWith('/api/'))return reply({connected:false,rows:[],data:[]});return route.continue();}
 if(!url.hostname.endsWith('.supabase.co')){if(req.method()!=='GET')external.push(url.origin+url.pathname);return reply({});}
 if(url.pathname.includes('/auth/v1/'))return reply(url.pathname.endsWith('/user')?user:session);
 const table=url.pathname.split('/').pop(),single=req.headers().accept?.includes('vnd.pgrst.object');
 if(table==='mio_cloud_state_read_chunks_v297')return reply(chunkRows([...states.values()].map(x=>({...x,user_id:owner})),req.postDataJSON()));
 if(table==='mio_cloud_state_write_v277'){const b=req.postDataJSON(),old=states.get(b.p_key);if(!!old!==b.p_expected_exists||old&&old.updated_at!==b.p_expected_at)return reply({code:'PT409',message:'Stale state'},409);const r={key:b.p_key,raw_value:b.p_raw,json_value:null,updated_at:new Date().toISOString()};states.set(b.p_key,r);return reply(r);}
 if(table==='case_mio_user_state'){let rows=[...states.values()];const key=url.searchParams.get('key');if(key?.startsWith('eq.'))rows=rows.filter(r=>r.key===key.slice(3));return reply(single?rows[0]||null:rows);}
 if(table==='mio_process_records'){let all=[...records.values()];for(const k of ['kind','id'])if(url.searchParams.get(k)?.startsWith('eq.'))all=all.filter(r=>r[k]===url.searchParams.get(k).slice(3));return reply(single?all[0]||null:all);}
 if(table==='mio_save_process_v314'){
  const b=req.postDataJSON();if(failNextSave){failNextSave=false;return reply({message:'Synthetic persistence failure'},500);}const key=b.p_kind+':'+b.p_id,old=records.get(key);
  if((old?.revision||0)!==b.p_revision)return reply({code:'PT409',message:'Stale process revision'},409);
  if(b.p_billing){assert.ok(!billing.some(x=>x.id===b.p_billing.id),'Duplicate billing');billing.push(b.p_billing);}
  const row={kind:b.p_kind,id:b.p_id,owner_id:owner,state:b.p_state,revision:(old?.revision||0)+1};records.set(key,row);writes.push(b);return reply({state:row.state,revision:row.revision});
 }
 if(table==='setting_options')return reply(Object.entries({matter_status:['Client-Need to Draft','Served- Need to Finalize','Closed'],case_status:['Open','Closed'],matter_type:['Divorce','SAPCR/Modification','DFPS','Other']}).flatMap(([category,names])=>names.map((name,i)=>({id:category+i,category,name,is_active:true,sort_order:i}))));
 if(table==='clients')return reply(matters.map(m=>m.clients));if(table==='matters')return reply(single?matters[0]:matters);
 if(table==='mio_billing_entries')return reply(billing);
 if(table==='team_members'){const m={id:'synthetic-member',email,first_name:'Test',last_name:'Attorney',is_active:true,page_access:[]};return reply(single?m:[m]);}
 return reply(single?null:[]);
});
const settle=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await page.waitForTimeout(100);}assert.ok(await fn(),'Fixture did not settle');};
const snapshot=()=>[...records.values()].find(r=>r.kind==='run')?.state;
const template=()=>[...records.values()].find(r=>r.kind==='template')?.state;
const rename=async name=>page.getByLabel('Block name',{exact:true}).fill(name);
const node=name=>page.locator('.proc-node').filter({has:page.locator('strong',{hasText:name})});
async function drop(type,x,y){const dt=await page.evaluateHandle(type=>{const d=new DataTransfer();d.setData('application/x-mio-block',type);return d;},type);const r=await page.locator('.proc-canvas').boundingBox();await page.locator('.proc-canvas').dispatchEvent('drop',{dataTransfer:dt,clientX:r.x+x,clientY:r.y+y});await dt.dispose();}
async function complete(reference){await page.getByLabel('Actual completion / response reference').fill(reference);await page.getByRole('button',{name:'Record actual completion',exact:true}).click();await settle(async()=>!(await page.getByRole('button',{name:'Refresh processes',exact:true}).isDisabled()));}
fs.mkdirSync('process-test-results',{recursive:true});
try{
 await page.goto('http://127.0.0.1:4173/#processes',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Processes',exact:true}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'New process',exact:true}).click();await page.getByLabel('Process name').fill('Court dates process');
 await page.locator('[data-block-type="manual"]').click();await rename('Review initial order');
 await page.getByLabel('Bill once when this action actually occurs').check();await page.getByLabel('Billing minutes').fill('6');await page.getByLabel('Billing description').fill('Review proposed order');
 await drop('wait',325,50);await rename('Court dates');await page.getByLabel('Who / what are we waiting on?').fill('the court');await page.getByLabel('After action / waiting').fill('Waiting for the court to send available dates');
 await node('Review initial order').click();await drop('draft_email',325,315);await rename('Email counsel');await page.getByLabel('Email subject',{exact:true}).fill('Order for {matter}');await page.getByLabel('Email draft',{exact:true}).fill('Please review the proposed order.');await page.getByLabel('To (explicit email addresses override role)').fill('counsel@example.invalid');
 await drop('manual',645,200);await rename('Review both responses');
 await page.getByRole('button',{name:'Connect from Court dates',exact:true}).click();await page.getByRole('button',{name:'Connect to Review both responses',exact:true}).click();assert.equal(await page.locator('[data-edge]').count(),4);
 const initial=await node('Court dates').boundingBox(),grip=await node('Court dates').locator('.proc-grip').boundingBox();await page.mouse.move(grip.x+55,grip.y+15);await page.mouse.down();await page.mouse.move(grip.x+95,grip.y+45,{steps:8});await page.mouse.up();const moved=await node('Court dates').boundingBox();assert.ok(moved.x>initial.x+25,'Block dragged horizontally');assert.ok(moved.y>initial.y+15,'Block dragged vertically');
 await page.getByRole('button',{name:'Connect from Review both responses',exact:true}).click();await page.getByRole('button',{name:'Connect to Review initial order',exact:true}).click();assert.match(await page.locator('.proc-builder [role="alert"]').innerText(),/cycle/i);assert.equal(await page.locator('[data-edge]').count(),4);
 await page.getByRole('button',{name:'Save process',exact:true}).click();await settle(()=>template());assert.equal(template().nodes.length,4);assert.equal(template().nodes.find(n=>n.name==='Review both responses').dependsOn.length,2);
 await page.screenshot({path:'process-test-results/designer.png'});
 await page.getByRole('button',{name:'Close designer',exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Edit process',exact:true}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Use for a matter',exact:true}).click();await page.getByLabel('Matter',{exact:true}).selectOption(matters[0].id);await page.getByRole('button',{name:'Start process',exact:true}).click();await page.locator('.proc-step').waitFor();
 const ids=Object.fromEntries(template().nodes.map(n=>[n.name,n.id]));assert.equal(snapshot().steps[ids['Email counsel']].status,'blocked');assert.equal(billing.length,0);
 await complete('Reviewed actual proposed order');await settle(()=>billing.length===1);assert.equal(billing[0].billing_time,0.1);assert.equal(snapshot().steps[ids['Court dates']].status,'waiting');assert.equal(snapshot().steps[ids['Email counsel']].status,'approval');assert.equal(snapshot().steps[ids['Review both responses']].status,'blocked');
 const waiting=await page.locator('.proc-wait-list').innerText();assert.match(waiting,/court to send available dates/);assert.match(waiting,/approv/i);
 await page.locator('.proc-step-strip button').filter({hasText:'Email counsel'}).click();assert.equal(await page.getByLabel('Email draft',{exact:true}).inputValue(),'Please review the proposed order.');await page.getByLabel('Email draft',{exact:true}).fill('Updated draft for review.');await page.getByRole('button',{name:'Save action details',exact:true}).click();await settle(()=>snapshot().steps[ids['Email counsel']].config.body==='Updated draft for review.');
 await page.getByRole('button',{name:'Approve action',exact:true}).click();await settle(()=>snapshot().steps[ids['Email counsel']].status==='ready');await page.getByLabel('Note / waiting message').fill('Waiting for opposing counsel to respond to my email');await page.getByRole('button',{name:'Set waiting message',exact:true}).click();await settle(()=>snapshot().steps[ids['Email counsel']].status==='waiting');
 await page.screenshot({path:'process-test-results/parallel-waiting-and-history.png',fullPage:true});
 await complete('Counsel response reviewed in Outlook');assert.equal(snapshot().steps[ids['Review both responses']].status,'blocked');await page.locator('.proc-step-strip button').filter({hasText:'Court dates'}).click();await complete('Court dates received and reviewed');await settle(()=>snapshot().steps[ids['Review both responses']].status==='ready');
 await page.locator('.proc-step-strip button').filter({hasText:'Review both responses'}).click();failNextSave=true;await complete('Both responses reviewed');assert.equal(snapshot().steps[ids['Review both responses']].status,'ready');assert.match(await page.locator('.proc-page > [role="alert"]').innerText(),/Synthetic persistence failure/);await complete('Both responses reviewed');await settle(()=>snapshot().status==='complete');assert.equal(billing.length,1);
 await page.getByLabel('Show',{exact:true}).selectOption('all');await page.locator('.proc-history-chain time').first().waitFor();assert.ok(await page.locator('.proc-history-item.billed').count()===1);
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Processes',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:/Matter processes/}).click();await page.getByLabel('Show',{exact:true}).selectOption('all');await page.locator('.proc-run').waitFor();assert.equal(snapshot().steps[ids['Email counsel']].config.body,'Updated draft for review.');assert.equal(billing.length,1);
 await page.screenshot({path:'process-test-results/completed-history.png',fullPage:true});
 // A fresh generic notification run proves automatic execution without a provider or billing side effect.
 await page.getByRole('button',{name:'Process library',exact:true}).click();await page.getByRole('button',{name:'New process',exact:true}).click();await page.getByLabel('Process name').fill('Automatic internal notification');await page.locator('[data-block-type="notification"]').click();await page.getByLabel('Run automatically once ready / approved').check();await page.getByLabel('Notification text').fill('Review is complete');await page.getByRole('button',{name:'Save process',exact:true}).click();await settle(()=>[...records.values()].filter(x=>x.kind==='template').length===2);await page.getByRole('button',{name:'Close designer',exact:true}).click();await page.locator('.proc-library article').filter({hasText:'Automatic internal notification'}).getByRole('button',{name:'Use for a matter',exact:true}).click();await page.getByLabel('Matter',{exact:true}).selectOption(matters[0].id);await page.getByRole('button',{name:'Start process',exact:true}).click();await settle(()=>[...records.values()].some(r=>r.kind==='run'&&r.state.name==='Automatic internal notification'&&r.state.status==='complete'));assert.equal(billing.length,1);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS production Processes UI: palette drop, node drag, serial/parallel connectors, cycle rejection, settings, save/reload, matter run, parallel blockers, email editing and approvals, all-join, single billing, failure preservation, immutable history, automatic notification. No live external actions.');
}catch(e){await page.screenshot({path:'process-test-results/failure.png',fullPage:true}).catch(()=>{});const info={error:e.stack,errors,alerts,external,records:[...records.values()],body:await page.locator('body').innerText().catch(()=>'')};fs.writeFileSync('process-test-results/failure.json',JSON.stringify(info,null,2));console.log(JSON.stringify({error:e.message,errors,alerts,body:info.body.slice(-14000)},null,2));throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
