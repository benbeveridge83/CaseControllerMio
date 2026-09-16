import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import {normalizeSubmission,submissionIdentity} from './model.js'
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json'}})
async function sha(v:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')}
Deno.serve(async req=>{
 if(req.method!=='POST')return json({ok:false,error:'POST required'},405)
 const token=new URL(req.url).searchParams.get('token')||req.headers.get('x-mio-formspree-token')||''
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
 const {data:c,error:ce}=await db.from('mio_formspree_config').select('*').eq('id',true).single()
 if(ce||!c)return json({ok:false,error:'Not configured'},503)
 if(!token||await sha(token)!==c.webhook_token_hash)return json({ok:false,error:'Unauthorized'},401)
 let p:any;try{p=await req.json();if(!p||typeof p!=='object'||Array.isArray(p))throw Error()}catch{return json({ok:false,error:'Invalid JSON'},400)}
 const n=normalizeSubmission(p),form=n.form_id||c.form_id||'unknown',isSpam=n.is_spam
 const at=n.submitted_at&&!Number.isNaN(Date.parse(n.submitted_at))?n.submitted_at:new Date().toISOString()
 const {full_name,email,phone,county,family_type,matter_kind,message}=n
 const row={form_id:form,submission_key:await sha(submissionIdentity(p,form)),submitted_at:at,source:'formspree',full_name,email,phone,county,family_type,matter_kind,message,raw_submission:p,status:isSpam?'spam':'new',last_seen_at:new Date().toISOString()}
 const {data:legacy,error:legacyError}=await db.from('mio_formspree_leads').select('id,status').eq('form_id',form).eq('raw_submission',JSON.stringify(p)).limit(1).maybeSingle()
 if(legacyError)return json({ok:false,error:legacyError.message},500)
 if(legacy)return json({ok:true,accepted:!isSpam,spam:isSpam,lead:legacy})
 // Ingest only. Client and matter creation requires staff review and approval.
 const {data,error}=await db.from('mio_formspree_leads').upsert(row,{onConflict:'submission_key',ignoreDuplicates:true}).select('id,status').maybeSingle()
 await db.from('mio_formspree_config').update({last_webhook_at:new Date().toISOString(),last_error:error?.message||null,form_id:c.form_id||form}).eq('id',true)
 if(error)return json({ok:false,error:error.message},500)
 return json({ok:true,accepted:!isSpam,spam:isSpam,lead:data||null})
})
