import {createClient} from '@supabase/supabase-js'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {paymentEvidence,signatureEvidence,readyToClient,PNC_STATUS,CONSULT_STATUS,CLIENT_STATUS,emailOK} from '../src/mioPncModel.js'
const clean=v=>String(v||'').trim(),stamp=()=>new Date().toISOString()
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})}
const unwrap=async q=>{const {data,error}=await q;if(error)throw error;return data}
function config(){const e=process.env;return {url:e.SUPABASE_URL||e.VITE_SUPABASE_URL||e.NEXT_PUBLIC_SUPABASE_URL,key:e.SUPABASE_PUBLISHABLE_KEY||e.SUPABASE_ANON_KEY||e.VITE_SUPABASE_ANON_KEY||e.NEXT_PUBLIC_SUPABASE_ANON_KEY}}
function database(authorization=''){const {url,key}=config();if(!url||!key)fail('Server Supabase configuration is missing.',503);return createClient(url,key,{global:{headers:authorization?{Authorization:authorization}:{}},auth:{persistSession:false,autoRefreshToken:false}})}
async function identity(req){const authorization=clean(req.headers?.authorization);if(!/^Bearer\s+\S+/i.test(authorization))fail('Sign in to Mio.',401);const db=database(authorization),{data,error}=await db.auth.getUser(authorization.replace(/^Bearer\s+/i,''));if(error||!data?.user?.id)fail('Your Mio session could not be verified.',401);if(!data.user.email_confirmed_at)fail('Use a verified firm account.',403);const email=clean(data.user.email).toLowerCase(),allowed=clean(process.env.MIO_PNC_ALLOWED_EMAILS).toLowerCase().split(',').map(x=>x.trim());if(!email.endsWith('@beveridgelawfirm.com')&&!allowed.includes(email))fail('This account is not authorized for firm PNC workflows.',403);return {db,user:data.user}}
function readBody(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{fail('Invalid JSON request.')}}
async function signCall(path,body){const key=clean(process.env.DROPBOX_SIGN_API_KEY);if(!key)fail('Dropbox Sign is not configured: add DROPBOX_SIGN_API_KEY to Vercel.',503);const r=await fetch('https://api.hellosign.com/v3'+path,{method:body?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64'),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});const p=await r.json().catch(()=>({}));if(!r.ok)fail(p.error?.error_msg||'Dropbox Sign request failed.',502);return p}
const payloadColumns='matter_id,user_id,client_id,creation_key,config,state,revision,created_at,updated_at'
async function owned(db,user,matterId){if(!/^[a-f0-9-]{36}$/i.test(clean(matterId)))fail('Select a PNC matter.');const w=await unwrap(db.from('mio_pnc_workflows').select(payloadColumns).eq('user_id',user.id).eq('matter_id',matterId).single());const m=await unwrap(db.from('matters').select('*,clients(*)').eq('id',matterId).single());if(!m||m.client_id!==w.client_id)fail('PNC client association changed. Review the matter.',409);return {w,m}}
async function patch(db,w,change){const v=await unwrap(db.from('mio_pnc_workflows').update({...change,revision:w.revision+1,updated_at:stamp()}).eq('matter_id',w.matter_id).eq('user_id',w.user_id).eq('revision',w.revision).select(payloadColumns).maybeSingle());if(!v)fail('This PNC changed in another window. Reload before retrying.',409);return v}
function amount(value){const n=Math.round(Number(value)*100);if(!Number.isSafeInteger(n)||n<100||n>100000000)fail('Enter an amount between $1 and $1,000,000.');return n}
async function payment(db,user,m,purpose,dollars,canCreate=true){
 const account=purpose==='consult'?'operating':'trust',n=amount(dollars),invoice='PNC-'+purpose+'-'+m.id+'-'+n
 const existing=await unwrap(db.from('lawpay_payment_requests').select('*').eq('created_by',user.id).eq('invoice_number',invoice).eq('account_key',account).order('created_at',{ascending:false}).limit(1).maybeSingle());if(existing)return normalizeLink(existing)
 if(!canCreate)fail('A previous payment-link preparation is still pending. Reopen and retry after checking LawPay requests.',409)
 const settings=await unwrap(db.from('lawpay_settings').select('operating_page_url,trust_page_url').eq('id',1).single()),page=settings[account+'_page_url'];if(!page)fail('Save the LawPay '+account+' payment page in Settings first.',409)
 const {data,error}=await db.functions.invoke('lawpay-gateway',{body:{action:'create_link',account_key:account,payment_page_url:page,amount_cents:n,reference:invoice,invoice_number:invoice,payer_name:[m.clients?.first_name,m.clients?.last_name].filter(Boolean).join(' '),payer_email:m.clients?.email,payer_phone:m.clients?.phone||'',matter_id:m.id,matter_name:m.name,client_id:m.client_id,client_name:[m.clients?.first_name,m.clients?.last_name].filter(Boolean).join(' '),lock_amount:true,lock_reference:true}})
 if(error||!data?.url)fail(data?.error||error?.message||'LawPay did not create a payment link.',502)
 const request=await unwrap(db.from('lawpay_payment_requests').select('*').eq('created_by',user.id).eq('invoice_number',invoice).eq('account_key',account).order('created_at',{ascending:false}).limit(1).single());if(Number(request.amount_cents)!==n)fail('LawPay request amount did not match. Do not send this request.',409)
 return normalizeLink(request)
}
function normalizeLink(r){const u=new URL(r.payment_url);u.searchParams.set('amount',(Number(r.amount_cents)/100).toFixed(2));u.searchParams.set('lockAmount','true');u.searchParams.set('lock_amount','true');return {...r,payment_url:u.toString()}}
async function requestFor(db,w,key){const id=w.state?.[key]?.id;if(!id)return null;return unwrap(db.from('lawpay_payment_requests').select('*').eq('id',id).eq('created_by',w.user_id).eq('matter_id',String(w.matter_id)).maybeSingle())}
async function verify(db,w,{signature=true,transactions=null}={}){
 const state={...w.state},warnings=[]
 for(const kind of ['consult','retainer']){const r=await requestFor(db,w,kind+'_request');if(!r)continue
  // Exact immutable reference/request mapping, not payer-name or matter-only matching.
  const tx=transactions||await unwrap(db.from('lawpay_transactions').select('*').in('account_key',r.account_key==='trust'?['trust','echeck_trust','clientcredit_trust']:['operating','echeck_operating']).or('reference.eq.'+r.reference+',gateway_transaction_id.eq.'+(r.gateway_transaction_id||'__none__')+',raw->>mio_payment_request_id.eq.'+r.id).limit(1000))
  state[kind]=paymentEvidence(tx,r)
 }
 if(state.intake?.id){const i=await unwrap(db.from('mio_client_intake_requests').select('id,status,submitted_at,expires_at').eq('user_id',w.user_id).eq('id',state.intake.id).maybeSingle());if(i)state.intake={...state.intake,...i}}
 if(signature&&state.signature?.id){try{const p=await signCall('/signature_request/'+encodeURIComponent(state.signature.id));const r=p.signature_request;if(String(r.metadata?.mio_pnc_matter_id)!==String(w.matter_id)||String(r.metadata?.mio_pnc_user_id)!==String(w.user_id))fail('Signature request belongs to a different matter.',409);state.signature=signatureEvidence(r)}catch(e){state.signature={...state.signature,status:'unverified'};warnings.push(e.message)}}
 state.checked_at=stamp();state.warnings=warnings
 return {state,warnings}
}
async function syncPayments(db,w){const {data,error}=await db.functions.invoke('pnc-payment-status',{body:{matter_id:w.matter_id}});if(error||!data?.ok)fail('LawPay verification failed. '+(data?.error||error?.message||''),502);return data.transactions||[]}
function agreementFields(definition,w,m){
 const values={client_name:[m.clients.first_name,m.clients.last_name].filter(Boolean).join(' '),client_email:m.clients.email,client_phone:m.clients.phone||'',first_name:m.clients.first_name,last_name:m.clients.last_name,retainer:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(w.config.retainer)),case_type:m.matter_type,matter_name:m.name,date:new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago'}).format(new Date())};
 let overrides={};try{overrides=JSON.parse(w.config.signature_fields||'{}')}catch{fail('Fee-agreement fields must be a JSON object.');}
 const fields=[...new Map((definition.documents||[]).flatMap(d=>d.custom_fields||[]).map(f=>[f.name,f])).values()];
 return fields.map(f=>{const key=String(f.name).toLowerCase().replace(/[^a-z0-9]+/g,'_');const value=Object.hasOwn(overrides,f.name)?overrides[f.name]:values[key];if(value==null)fail('Add a value for the fee-agreement merge field "'+f.name+'" before sending.');return {name:f.name,value:String(value)};});
}
export default async function pncHandler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');const json=(n,v)=>res.status(n).json(v)
 try{
  if(!['GET','POST'].includes(req.method))return json(405,{error:'Method not allowed.'})
  const b=readBody(req),action=clean(b.action||req.query?.action||'list')
  if(req.query?.integration==='client_intake'&&['load','submit'].includes(action)){
   if(req.method!=='POST')fail('Use POST.',405)
   const db=database(),data=await unwrap(db.rpc('mio_intake_access_v313',{p_token:clean(b.token),p_answers:action==='submit'?b.answers:null}));return json(200,data)
  }
  const {db,user}=await identity(req)
  if(req.method!=='POST'&&!['list','templates'].includes(action))fail('Use POST for changes.',405)
  if(req.query?.integration==='client_intake')return await intakeAdmin(db,user,b,action,req,res)
  if(action==='list'){const rows=await unwrap(db.from('mio_pnc_workflows').select(payloadColumns).eq('user_id',user.id).order('created_at',{ascending:false}));return json(200,{rows})}
  if(action==='create'){
   const data=await unwrap(db.rpc('mio_create_pnc_v313',{p_key:b.key,p_first:clean(b.first_name),p_last:clean(b.last_name),p_email:clean(b.email),p_phone:clean(b.phone),p_case_type:clean(b.case_type),p_existing_client:b.existing_client_id||null}));return json(200,data)
  }
  if(req.method!=='POST'&&!['list','templates'].includes(action))fail('Use POST for changes.',405)
  if(action==='templates'){const p=await signCall('/template/list?page_size=100');return json(200,{templates:(p.templates||[]).map(t=>({id:t.template_id,title:t.title,signer_roles:t.signer_roles||[],cc_roles:t.cc_roles||[]}))})}
  if(action==='initialize'){const m=await unwrap(db.from('matters').select('id,client_id,matter_status').eq('id',b.matter_id).single());if(!m.client_id||![PNC_STATUS,CONSULT_STATUS].includes(m.matter_status))fail('This is not a linked PNC matter.');const w=await unwrap(db.from('mio_pnc_workflows').insert({matter_id:m.id,client_id:m.client_id,user_id:user.id,creation_key:randomUUID()}).select(payloadColumns).single());return json(200,{workflow:w})}
  const {w:initial,m}=await owned(db,user,b.matter_id||req.query?.matter_id);let w=initial
  if(action==='save'){
   if(Number(b.revision)!==w.revision)fail('This row changed. Reopen before editing.',409)
   if(w.state.signature_sending)fail('Signature send outcome needs reconciliation before editing.',409)
   const keys=['consult_fee','retainer','include_intake','intake_template','include_date','consultation_start','duration','time_zone','location','consult_subject','consult_body','consultation_body','intake_body','engage_subject','engage_body','signature_template_id','signer_role','signature_fields']
   const c={...w.config};for(const k of keys)if(Object.hasOwn(b.config||{},k))c[k]=b.config[k]
   if(c.consult_fee!=null&&c.consult_fee!=='')amount(c.consult_fee);if(c.retainer!=null)amount(c.retainer)
   if(w.state.consult_request&&Number(c.consult_fee)!==Number(w.config.consult_fee))fail('Consultation link already created. Its amount is locked to avoid mismatched payments.',409)
   if(w.state.retainer_request&&Number(c.retainer)!==Number(w.config.retainer))fail('Retainer link already created. Its amount is locked.',409)
   for(const key of ['include_date','consultation_start','duration','time_zone','location'])if(w.state.calendar_delivery&&JSON.stringify(c[key])!==JSON.stringify(w.config[key]))fail('The calendar invitation already exists. Change it in your calendar rather than creating a duplicate.',409)
   if(w.state.intake&&JSON.stringify(c.intake_template)!==JSON.stringify(w.config.intake_template))fail('An intake link already exists. Its form snapshot is fixed.',409)
   w=await patch(db,w,{config:c});return json(200,{workflow:w})
  }
  if(action==='prepare_consult'){
   if(m.matter_status!==PNC_STATUS)fail('This matter is not awaiting consultation.',409)
   if(!emailOK(m.clients?.email))fail('The client needs a valid email.')
   amount(w.config.consult_fee);if(w.config.include_intake&&!w.config.intake_template?.questions?.length)fail('Choose an intake form before creating links.');
   const canCreate=!w.state.consult_preparing;w=await patch(db,w,{state:{...w.state,consult_preparing:true}})
   const r=await payment(db,user,m,'consult',w.config.consult_fee,canCreate);let state={...w.state,consult_preparing:false,consult_request:{id:r.id,url:r.payment_url,amount_cents:r.amount_cents,account_key:r.account_key}}
   w=await patch(db,w,{state})
   if(w.config.include_intake&&!state.intake?.id){const t=w.config.intake_template;if(!t?.questions?.length)fail('Choose an intake form first.')
    const token=randomBytes(32).toString('hex'),id=randomUUID(),row={id,user_id:user.id,matter_id:m.id,matter_name:m.name,client_name:[m.clients.first_name,m.clients.last_name].filter(Boolean).join(' '),recipient_email:m.clients.email,title:t.name,template_snapshot:t,token_hash:createHash('sha256').update(token).digest('hex'),expires_at:new Date(Date.now()+14*86400000).toISOString()}
    await unwrap(db.from('mio_client_intake_requests').insert(row))
    const origin=new URL('https://'+req.headers.host).origin;state={...w.state,intake:{id,status:'pending',expires_at:row.expires_at,url:origin+'/#client-intake/'+token}};w=await patch(db,w,{state})
   }
   return json(200,{workflow:w})
  }
  if(action==='prepare_engagement'){
   if(m.matter_status!==CONSULT_STATUS)fail('Mark the consultation as moving forward first.',409)
   amount(w.config.retainer);
   const canCreate=!w.state.retainer_preparing;w=await patch(db,w,{state:{...w.state,retainer_preparing:true}})
   const r=await payment(db,user,m,'retainer',w.config.retainer,canCreate);w=await patch(db,w,{state:{...w.state,retainer_preparing:false,retainer_request:{id:r.id,url:r.payment_url,amount_cents:r.amount_cents,account_key:r.account_key}}})
   return json(200,{workflow:w})
  }
  if(action==='send_signature'){
   if(m.matter_status!==CONSULT_STATUS||!w.state.retainer_request)fail('Prepare the retainer request first.',409)
   if(w.state.signature?.id)return json(200,{workflow:w})
   if(w.state.signature_sending)fail('A signature request may already have been sent. Check Dropbox Sign and link its request ID before retrying.',409)
   const template=clean(w.config.signature_template_id),role=clean(w.config.signer_role);if(!template||!role)fail('Choose a Dropbox Sign fee-agreement template and client signer role in PNC Settings.')
   const definition=(await signCall('/template/'+encodeURIComponent(template))).template
   if(!definition?.signer_roles?.some(r=>r.name===role))fail('The selected signer role does not exist on this Dropbox Sign template.')
   if(definition.signer_roles.length!==1||(definition.cc_roles||[]).length)fail('This template requires additional signer/CC roles. Use a client-only fee-agreement template for this workflow.')
   const custom_fields=agreementFields(definition,w,m)
   if(b.confirmed!==true)fail('Confirm the fee-agreement send first.')
   w=await patch(db,w,{state:{...w.state,signature_sending:stamp()}})
   const p=await signCall('/signature_request/send_with_template',{template_ids:[template],title:'Fee agreement - '+m.name,subject:'Fee agreement - Beveridge Law Firm',message:'Please review and sign your fee agreement. Retainer payment link: '+w.state.retainer_request.url,signers:[{role,name:[m.clients.first_name,m.clients.last_name].join(' ').trim(),email_address:m.clients.email}],metadata:{mio_pnc_matter_id:m.id,mio_pnc_user_id:user.id},custom_fields,test_mode:false})
   w=await patch(db,w,{state:{...w.state,signature_sending:null,signature:signatureEvidence(p.signature_request)}});return json(200,{workflow:w})
  }
  if(action==='link_signature'){
   const r=(await signCall('/signature_request/'+encodeURIComponent(clean(b.signature_request_id)))).signature_request
   if(String(r.metadata?.mio_pnc_matter_id)!==String(m.id)||String(r.metadata?.mio_pnc_user_id)!==String(user.id))fail('That signature request is not linked to this PNC.',409)
   w=await patch(db,w,{state:{...w.state,signature_sending:null,signature:signatureEvidence(r)}});return json(200,{workflow:w})
  }
  if(action==='refresh'){
   const transactions=b.sync?await syncPayments(db,w):null
   const {state}=await verify(db,w,{transactions});w=await patch(db,w,{state});return json(200,{workflow:w})
  }
  if(action==='reset_preparation'){if(!['consult','retainer'].includes(b.kind)||b.confirmed!==true)fail('Confirm payment-link recovery.');w=await patch(db,w,{state:{...w.state,[b.kind+'_preparing']:false}});return json(200,{workflow:w})}
  if(action==='intake_answers'){if(!w.state.intake?.id)return json(200,{answers:{}});const r=await unwrap(db.from('mio_client_intake_requests').select('id,mio_client_intake_submissions(answers)').eq('user_id',user.id).eq('id',w.state.intake.id).single());return json(200,{answers:r.mio_client_intake_submissions?.[0]?.answers||{}})}
  if(action==='claim_delivery'){
   if(!['consult','engage','calendar'].includes(b.kind))fail('Invalid delivery kind.')
   const key=b.kind+'_delivery',old=w.state[key];if(old?.status==='sent')return json(200,{workflow:w})
   if(old?.status==='sending'){if(b.kind==='calendar')return json(200,{workflow:w});fail('The prior email outcome is uncertain. Check Sent Items before retrying.',409)}
   w=await patch(db,w,{state:{...w.state,[key]:{status:'sending',at:stamp(),reference:randomUUID()}}});return json(200,{workflow:w})
  }
  if(action==='reset_delivery'){
   if(!['consult','engage'].includes(b.kind)||b.confirmed!==true)fail('Confirm that no email was sent.')
   w=await patch(db,w,{state:{...w.state,[b.kind+'_delivery']:{...w.state[b.kind+'_delivery'],status:'retry_approved',reviewed_at:stamp()}}});return json(200,{workflow:w})
  }
  if(action==='record_delivery'){
   if(!['consult','engage','calendar'].includes(b.kind))fail('Invalid delivery kind.')
   const state={...w.state,[b.kind+'_delivery']:{...w.state[b.kind+'_delivery'],status:clean(b.status),at:stamp(),reference:clean(b.reference),...(b.kind==='calendar'?{local_id:b.local_id||w.state.calendar_delivery?.local_id,local_saved:b.local_saved===true}: {})}}
   w=await patch(db,w,{state});return json(200,{workflow:w})
  }
  if(action==='advance'){
   const next=m.matter_status===PNC_STATUS?CONSULT_STATUS:m.matter_status===CONSULT_STATUS?CLIENT_STATUS:null;if(!next)fail('This matter is not in a PNC stage.',409)
   if(b.confirmed!==true)fail('Confirm the status change.')
   if(next===CLIENT_STATUS){const transactions=await syncPayments(db,w);const {state}=await verify(db,w,{transactions});w=await patch(db,w,{state});if(!readyToClient(state))fail('A verified signed agreement and the full retainer paid or processing are both required.',409)}
   const updated=await unwrap(db.from('matters').update({matter_status:next,matter_status_changed_at:stamp()}).eq('id',m.id).eq('matter_status',m.matter_status).select('id,matter_status').single())
   return json(200,{workflow:w,matter:updated})
  }
  fail('Unsupported PNC action.')
 }catch(e){return json(e.status||500,{error:e.message||'PNC request failed.'})}
}
async function intakeAdmin(db,user,b,action,req,res){
 if(action==='list'){const matter=clean(b.matter_id||req.query.matter_id);const requests=await unwrap(db.from('mio_client_intake_requests').select('*,mio_client_intake_submissions(*)').eq('user_id',user.id).eq('matter_id',matter).order('created_at',{ascending:false}));return res.status(200).json({requests:requests.map(({token_hash,mio_client_intake_submissions,...r})=>({...r,submission:mio_client_intake_submissions?.[0]||null}))})}
 if(action==='create'){
  const m=await unwrap(db.from('matters').select('id').eq('id',b.matter_id).single());if(!m)fail('Matter not found.');if(!b.template_snapshot?.questions?.length)fail('An intake template is required.')
  const token=randomBytes(32).toString('hex'),row={user_id:user.id,matter_id:m.id,matter_name:clean(b.matter_name),client_name:clean(b.client_name),recipient_email:clean(b.recipient_email),title:clean(b.title),template_snapshot:b.template_snapshot,token_hash:createHash('sha256').update(token).digest('hex'),expires_at:new Date(Date.now()+Math.min(90,Math.max(1,Number(b.expires_days)||14))*86400000).toISOString()}
  const {token_hash,...request}=await unwrap(db.from('mio_client_intake_requests').insert(row).select('*').single());const origin=new URL('https://'+req.headers.host).origin;return res.status(200).json({request,link:origin+'/#client-intake/'+token})
 }
 if(action==='review'){const row=await unwrap(db.from('mio_client_intake_requests').update({reviewed_at:stamp(),reviewed_by:user.id,applied_keys:b.applied_keys||[]}).eq('id',b.request_id).eq('user_id',user.id).select('id').single());return res.status(200).json({request:row})}
 fail('Unsupported intake action.')
}
