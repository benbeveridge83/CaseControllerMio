import {createClient} from '@supabase/supabase-js'
import {PUBLIC_SUPABASE_URL} from '../../src/mioSupabasePublic.js'
import {signatureEvidence} from '../../src/mioPncModel.js'
import {PORTAL_ORIGIN,PORTAL_SENDER,clean,emailKey,fail,tokenHash,newToken,hashPassword,verifyPassword,validateInvitation,requirePortalGrant,invoiceForPortal,portalPaymentUrl,safeProviderUrl,isOwnPortalTestMatter,requireStaffClientAction} from './security.js'
import {sendPortalEmail,portalMailFailure,portalMailAuthorization,portalMailStatus} from './mail.js'
import {invoicePdf} from './documents.js'
import {discoveryAction} from './discovery.js'
import {portalSettings,requirePortalSection,savePortalSettings} from './settings.js'
const COOKIE='__Host-mio_portal',stamp=()=>new Date().toISOString()
const data=async q=>{const r=await q;if(r.error)throw r.error;return r.data}
function database(){const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)fail('Client portal server configuration is missing.',503);return createClient(process.env.SUPABASE_URL||PUBLIC_SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}})}
function cookieToken(req){const c=String(req.headers?.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'=')),v=c?.slice(COOKIE.length+1)||'';return /^[a-f0-9]{64}$/.test(v)?v:''}
async function sessionAccount(db,req,optional=false){
 const token=cookieToken(req);if(!token){if(optional)return null;fail('Sign in to your client portal.',401)}
 const s=await data(db.from('mio_portal_sessions').select('*').eq('token_hash',tokenHash(token)).gt('expires_at',stamp()).maybeSingle())
 if(!s){if(optional)return null;fail('Your session expired. Sign in again.',401)}
 const a=await data(db.from('mio_portal_accounts').select('*').eq('email',s.email).single())
 if(a.password_version!==s.password_version){if(optional)return null;fail('Sign in again.',401)}return a
}
async function setSession(db,res,email,passwordVersion){if(!Number.isInteger(passwordVersion))fail('Sign in again.',401);const token=newToken();await data(db.from('mio_portal_sessions').insert({token_hash:tokenHash(token),email,password_version:passwordVersion,expires_at:new Date(Date.now()+12*3600000).toISOString()}));res.setHeader('Set-Cookie',COOKIE+'='+token+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200')}
async function staffUser(db,req){const token=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'');if(!token)fail('Sign in to Mio as firm staff.',401);const {data:r,error}=await db.auth.getUser(token),u=r?.user;if(error||!u?.email_confirmed_at||!emailKey(u.email).endsWith('@beveridgelawfirm.com'))fail('A verified firm staff account is required.',403);const staff=await data(db.from('mio_pnc_staff').select('user_id').eq('user_id',u.id).maybeSingle());if(!staff)fail('This staff account is not enrolled for client workflows.',403);return u}
async function matterById(db,id){if(!/^[a-f0-9-]{36}$/i.test(clean(id)))fail('Select a matter.');const m=await data(db.from('matters').select('id,name,client_id,case_type,notes,clients(id,first_name,last_name,email)').eq('id',id).single());if(!m)fail('Matter not found.',404);return m}
async function clientMatter(db,a,id){const m=await matterById(db,id),g=await data(db.from('mio_portal_grants').select('*').eq('matter_id',id).eq('email',a.email).maybeSingle());requirePortalGrant(g,a,m);return m}
async function rate(db,req,email,kind,max=10){const ip=clean(req.headers?.['x-vercel-proxied-for']||req.socket?.remoteAddress||'unknown');for(const key of [kind+':ip:'+ip,kind+':email:'+email])if(!await data(db.rpc('mio_portal_rate_limit',{p_key:tokenHash(key),p_max:max})))fail('Too many attempts. Try again in 15 minutes.',429)}
async function event(db,v){await data(db.from('mio_portal_events').insert(v))}
async function tokenRow(db,token,purpose){if(!/^[a-f0-9]{64}$/.test(clean(token)))fail('Invalid or expired link.',403);const t=await data(db.from('mio_portal_tokens').select('*').eq('token_hash',tokenHash(token)).eq('purpose',purpose).maybeSingle());validateInvitation(t,t?.email);return t}
async function snapshot(db,m,email,{staff=false}={}){
 const settings=await portalSettings(db)
 const [w,forms,invoices]=await Promise.all([
 data(db.from('mio_pnc_workflows').select('state').eq('matter_id',m.id).maybeSingle()),
 data(db.from('mio_client_intake_requests').select('id,title,status,expires_at,submitted_at,template_snapshot').eq('matter_id',m.id).ilike('recipient_email',email.replace(/[\\%_]/g,'\\$&')).in('status',['pending','submitted','approved']).order('created_at',{ascending:false})),
 data(db.rpc('mio_portal_invoices',{p_matter:m.id}))])
 return {matter:{id:m.id,name:m.name,client_name:[m.clients?.first_name,m.clients?.last_name].filter(Boolean).join(' ')},agreement:{status:w?.state?.signature?.status||'not_sent',available:!!w?.state?.signature?.id},portal_settings:settings,forms:!staff&&!settings.intake?[]:forms||[],invoices:(!staff&&!settings.payments?[]:invoices||[]).map(i=>{const safe=invoiceForPortal(i);return safe?{...safe,pending:!!i.pending}:null}).filter(Boolean)}
}
async function boldsign(path){if(!process.env.boldsignapi)fail('The signing service is not configured.',503);const r=await fetch('https://api.boldsign.com/v1/document/'+path,{headers:{'X-API-KEY':process.env.boldsignapi},signal:AbortSignal.timeout(25000)});if(!r.ok)fail('Could not contact the signing service. Please try again.',502);return r}
async function agreementAction(db,m,email,action){
 const w=await data(db.from('mio_pnc_workflows').select('state').eq('matter_id',m.id).maybeSingle()),sig=w?.state?.signature;if(!sig?.id)fail('The firm has not prepared a fee agreement yet.',409)
 const p=await (await boldsign('properties?documentId='+encodeURIComponent(sig.id))).json(),signer=(p.signerDetails||p.signers||[]).find(s=>emailKey(s.signerEmail||s.emailAddress||s.email)===emailKey(email))
 if(!signer)fail('This agreement is not addressed to your portal email. Contact the firm.',403)
 const status=signatureEvidence(p,sig).status;await data(db.rpc('mio_portal_signature_status',{p_matter:m.id,p_document:sig.id,p_status:status}))
 if(action==='agreement_status')return {status}
 if(action==='agreement_download'){if(status!=='signed')fail('The fee agreement is not signed yet.',409);const path='signed/'+m.id+'/'+clean(sig.id).replace(/[^a-z0-9_-]/gi,'_')+'.pdf';if(sig.signed_pdf_path!==path){const pdf=Buffer.from(await (await boldsign('download?documentId='+encodeURIComponent(sig.id))).arrayBuffer());const {error}=await db.storage.from('fee-agreement-templates').upload(path,pdf,{contentType:'application/pdf',upsert:true});if(error)throw error}const {data:link,error}=await db.storage.from('fee-agreement-templates').createSignedUrl(path,300);if(error||!link?.signedUrl)fail('Could not prepare the signed agreement download.',502);return {url:link.signedUrl}}
 if(status!=='awaiting_signature')fail('This agreement is '+status+'. Contact the firm if it needs replacement.',409)
 const link=await (await boldsign('getEmbeddedSignLink?documentId='+encodeURIComponent(sig.id)+'&signerEmail='+encodeURIComponent(email))).json()
 return {url:safeProviderUrl(link.signLink||link.signingLink||link.url,'boldsign')}
}
export function createPortalHandler({db:providedDb,sendEmail=sendPortalEmail}={}){
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff')
  try{
   if(req.method!=='POST')fail('Method not allowed.',405)
   const origin=clean(req.headers?.origin),host=clean(req.headers?.host)
   const trusted=origin===PORTAL_ORIGIN||([process.env.VERCEL_URL,process.env.VERCEL_BRANCH_URL].filter(Boolean).some(h=>origin==='https://'+h)&&new URL(origin).host===host)||(process.env.NODE_ENV!=='production'&&/^http:\/\/localhost:\d+$/.test(origin)&&new URL(origin).host===host)
   if(!trusted||!String(req.headers?.['content-type']||'').startsWith('application/json'))fail('Open the portal on the firm website and try again.',403)
   const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body||{});if(raw.length>300000)fail('Request is too large.',413)
   const b=typeof req.body==='string'?JSON.parse(raw):req.body||{},action=clean(b.action),db=providedDb||database()
   if(action.startsWith('staff_')||['invite','revoke'].includes(action)){
    const u=await staffUser(db,req)
    if(action==='staff_list'){const [grants,summaries]=await Promise.all([data(db.from('mio_portal_grants').select('matter_id,email,invited_at,accepted_at,revoked_at,delivery_status,delivery_error,invite_expires_at').order('invited_at',{ascending:false})),data(db.rpc('mio_portal_staff_summaries'))]);return res.status(200).json({grants,summaries})}
    if(action==='staff_mail_status'){const t=await data(db.from('mio_portal_mail_tokens').select('scopes,sender_login,expires_at,refresh_token,access_token').eq('user_id',u.id).maybeSingle());return res.status(200).json(portalMailStatus(t))}
    if(action==='staff_mail_connect')return res.status(200).json({url:portalMailAuthorization(u)})
    if(action==='staff_portal_settings')return res.status(200).json({settings:await portalSettings(db)})
    if(action==='staff_portal_settings_save'){const settings=await savePortalSettings(db,b.settings,b.version,u);await event(db,{event_type:'portal_settings_changed',actor_id:u.id,details:{intake:settings.intake,discovery:settings.discovery,payments:settings.payments,version:settings.version}});return res.status(200).json({settings})}
    const m=await matterById(db,b.matter_id),email=emailKey(m.clients?.email)
    if(action==='staff_client_discovery_action'){
     const clientAction=clean(b.client_action)
     if(b.edit_on_behalf!==true||!['discovery_save','discovery_upload_begin','discovery_upload_complete','discovery_upload_cancel','discovery_rename_file'].includes(clientAction))fail('Enable discovery editing before changing client responses.',403)
     requirePortalSection(clientAction,await portalSettings(db))
     const result=await discoveryAction(db,m,{...b,action:clientAction})
     await event(db,{matter_id:m.id,email,event_type:'staff_discovery_client_changed',actor_id:u.id,details:{action:clientAction,set_id:b.set_id,request_id:b.request_id,file_id:b.file_id||result.file_id||null}})
     return res.status(200).json(result)
    }
    if(action.startsWith('staff_discovery_'))return res.status(200).json(await discoveryAction(db,m,b,{staff:true,user:u}))
    if(action==='staff_overview')return res.status(200).json(await snapshot(db,m,email,{staff:true}))
    if(action==='staff_client_view'){
     const state=await snapshot(db,m,email)
     await event(db,{matter_id:m.id,email,event_type:'staff_client_view_opened',actor_id:u.id})
     return res.status(200).json({...state,viewer:{email,can_submit_intake:isOwnPortalTestMatter(m,u)}})
    }
    if(action==='staff_client_action'){
     const clientAction=clean(b.client_action);requireStaffClientAction(clientAction,m,u);requirePortalSection(clientAction,await portalSettings(db))
     if(clientAction.startsWith('discovery_'))return res.status(200).json(await discoveryAction(db,m,{...b,action:clientAction}))
     if(clientAction==='intake_submit'){
      await data(db.rpc('mio_portal_submit_intake',{p_request:b.request_id,p_matter:m.id,p_email:email,p_answers:b.answers||{}}))
      await event(db,{matter_id:m.id,email,event_type:'staff_test_intake_submitted',actor_id:u.id,details:{request_id:b.request_id}})
      return res.status(200).json({ok:true})
     }
     if(clientAction==='invoice_pdf'){
      const original=await data(db.from('mio_invoices').select('*').eq('id',b.invoice_id).eq('matter_id',m.id).single()),invoice=invoiceForPortal(original)
      if(!invoice)fail('Invoice unavailable.',404)
      const bytes=await invoicePdf(invoice,m)
      return res.status(200).json({file_base64:bytes.toString('base64'),filename:clean(invoice.invoice_number).replace(/[^a-z0-9_-]/gi,'_')+'.pdf',content_type:'application/pdf'})
     }
     return res.status(200).json(await agreementAction(db,m,email,clientAction))
    }
    if(action==='staff_send_intake'){
     const form=await data(db.from('mio_client_intake_requests').select('id,title,recipient_email,status,expires_at').eq('id',b.request_id).eq('matter_id',m.id).maybeSingle())
     if(!form||emailKey(form.recipient_email)!==email)fail('This intake form is not assigned to this client.',404)
     if(form.status!=='pending'||!(Date.parse(form.expires_at)>Date.now()))fail('This intake form is completed or expired.',409)
     const grant=await data(db.from('mio_portal_grants').select('*').eq('matter_id',m.id).eq('email',email).maybeSingle())
     if(!grant||grant.revoked_at||grant.client_id!==m.client_id||(!grant.accepted_at&&!(Date.parse(grant.invite_expires_at)>Date.now())))fail('Send a current portal invitation before emailing intake.',409)
     await rate(db,req,email,'intake_email')
     try{await sendEmail({staffId:u.id,email,link:PORTAL_ORIGIN+'/?client-portal=1',intakeTitle:form.title,graphToken:clean(b.graph_token)})}catch(error){const problem=portalMailFailure(error);await event(db,{matter_id:m.id,email,event_type:'intake_email_failed',actor_id:u.id,details:{request_id:form.id,code:problem.code}});throw problem}
     await event(db,{matter_id:m.id,email,event_type:'intake_email_sent',actor_id:u.id,details:{request_id:form.id,sender:PORTAL_SENDER}})
     return res.status(200).json({ok:true,sender:PORTAL_SENDER,recipient:email})
    }
    if(action==='staff_history'){const events=await data(db.from('mio_portal_events').select('event_type,email,details,created_at').eq('matter_id',m.id).order('created_at',{ascending:false}).limit(30));return res.status(200).json({events})}
    if(action==='revoke'){await data(db.rpc('mio_portal_revoke',{p_matter:m.id,p_staff:u.id}));return res.status(200).json({ok:true})}
    if(action==='invite'){
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.endsWith('@beveridgelawfirm.com'))fail('Enter a valid client email on the matter before inviting this client.')
     await rate(db,req,email,'invite')
     const token=newToken(),issued=await data(db.rpc('mio_portal_issue_invitation',{p_matter:m.id,p_staff:u.id,p_hash:tokenHash(token)}))
     const delivery=status=>data(db.rpc('mio_portal_invitation_delivery',{p_matter:m.id,p_email:issued.email,p_issuance:issued.issuance_id,p_status:status,p_staff:u.id}))
     try{await sendEmail({staffId:u.id,email:issued.email,link:PORTAL_ORIGIN+'/?client-portal=1#invite/'+token,graphToken:clean(b.graph_token)})}catch(error){await delivery('failed');const problem=portalMailFailure(error);await event(db,{matter_id:m.id,email,event_type:'portal_mail_error',actor_id:u.id,details:{code:problem.code,sender:PORTAL_SENDER}});throw problem}
     await delivery('accepted_by_microsoft');return res.status(200).json({ok:true,sender:PORTAL_SENDER,recipient:issued.email})
    }fail('Unsupported staff action.')
   }
   if(action==='invite_info'){await rate(db,req,tokenHash(clean(b.token)),'invite_info',50);const t=await tokenRow(db,b.token,'invite'),a=await data(db.from('mio_portal_accounts').select('password_hash').eq('email',t.email).single());return res.status(200).json({email:t.email,existing_account:!!a.password_hash})}
   if(action==='activate'){await rate(db,req,tokenHash(clean(b.token)),'activate',30);const t=await tokenRow(db,b.token,'invite'),a=await sessionAccount(db,req,true),pw=b.password?await hashPassword(b.password):null;const redeemed=await data(db.rpc('mio_portal_redeem',{p_hash:t.token_hash,p_password_hash:pw,p_session_email:a?.email||null}));await setSession(db,res,redeemed.email,redeemed.password_version);return res.status(200).json({ok:true})}
   if(action==='login'){const email=emailKey(b.email);await rate(db,req,email,'login');const a=await data(db.from('mio_portal_accounts').select('*').eq('email',email).maybeSingle());const valid=await verifyPassword(b.password,a?.password_hash||'scrypt$00000000000000000000000000000000$'+'0'.repeat(128));if(!valid||!a)fail('Email or password is incorrect.',401);await setSession(db,res,email,a.password_version);return res.status(200).json({ok:true})}
   if(action==='reset_request'){
    const email=emailKey(b.email);await rate(db,req,email,'reset',3);const g=await data(db.from('mio_portal_grants').select('invited_by').eq('email',email).is('revoked_at',null).order('invited_at',{ascending:false}).limit(1).maybeSingle())
    if(g){const token=newToken();await data(db.from('mio_portal_tokens').insert({token_hash:tokenHash(token),email,purpose:'reset',expires_at:new Date(Date.now()+3600000).toISOString()}));try{await sendEmail({staffId:g.invited_by,email,link:PORTAL_ORIGIN+'/?client-portal=1#reset/'+token,reset:true})}catch{await event(db,{email,event_type:'password_reset_email_failed'})}}
    return res.status(200).json({ok:true,message:'If this email has a portal account, a reset link will be sent. Contact the firm if it does not arrive.'})
   }
   if(action==='reset_finish'){await rate(db,req,tokenHash(clean(b.token)),'reset_finish',15);const t=await tokenRow(db,b.token,'reset'),redeemed=await data(db.rpc('mio_portal_redeem',{p_hash:t.token_hash,p_password_hash:await hashPassword(b.password)}));await setSession(db,res,redeemed.email,redeemed.password_version);return res.status(200).json({ok:true})}
   const a=await sessionAccount(db,req)
   if(action==='logout'){await data(db.from('mio_portal_sessions').delete().eq('token_hash',tokenHash(cookieToken(req))));res.setHeader('Set-Cookie',COOKIE+'=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return res.status(200).json({ok:true})}
   if(action==='session'){const grants=await data(db.from('mio_portal_grants').select('*,matters(id,name,client_id,clients(email))').eq('email',a.email).is('revoked_at',null).not('accepted_at','is',null)),matters=[];for(const g of grants||[]){try{requirePortalGrant(g,a,g.matters);matters.push({id:g.matters.id,name:g.matters.name})}catch{}}return res.status(200).json({email:a.email,matters})}
   const m=await clientMatter(db,a,b.matter_id)
   requirePortalSection(action,await portalSettings(db))
   if(action.startsWith('discovery_'))return res.status(200).json(await discoveryAction(db,m,b))
   if(action==='overview')return res.status(200).json(await snapshot(db,m,a.email))
   if(['agreement_sign','agreement_download','agreement_status'].includes(action))return res.status(200).json(await agreementAction(db,m,a.email,action))
   if(action==='intake_submit'){await data(db.rpc('mio_portal_submit_intake',{p_request:b.request_id,p_matter:m.id,p_email:a.email,p_answers:b.answers||{}}));return res.status(200).json({ok:true})}
   if(['invoice_pdf','invoice_pay'].includes(action)){
    const original=await data(db.from('mio_invoices').select('*').eq('id',b.invoice_id).eq('matter_id',m.id).single()),invoice=invoiceForPortal(original);if(!invoice)fail('Invoice unavailable.',404)
    if(action==='invoice_pdf'){const bytes=await invoicePdf(invoice,m);return res.status(200).json({file_base64:bytes.toString('base64'),filename:clean(invoice.invoice_number).replace(/[^a-z0-9_-]/gi,'_')+'.pdf',content_type:'application/pdf'})}
    if(invoice.balance<=0)fail('This invoice is already paid.',409)
    if((await data(db.rpc('mio_portal_pending_payments',{p_invoice:original.id}))).length)fail('A payment for this invoice is processing. Wait for confirmation before paying again.',409)
    const account=invoice.invoice_type==='trust_request'?'trust':'operating',settings=await data(db.from('lawpay_settings').select('trust_page_url,operating_page_url').eq('id',1).single()),url=portalPaymentUrl(settings?.[account+'_page_url'],original,{email:a.email,name:[m.clients.first_name,m.clients.last_name].filter(Boolean).join(' ')})
    const request=await data(db.rpc('mio_portal_payment_request',{p_invoice:original.id,p_key:'portal:'+original.id+':'+Math.round(invoice.balance*100),p_url:url,p_email:a.email}))
    return res.status(200).json({url:request.payment_url})
   }fail('Unsupported portal action.')
  }catch(e){const status=e.status||e.statusCode||(e.code==='P0001'?409:500);return res.status(status).json({error:status>=500&&status!==502&&status!==503?'The portal could not complete this request. Contact the firm.':e.message||'Request failed.'})}
 }
}
export default createPortalHandler()
