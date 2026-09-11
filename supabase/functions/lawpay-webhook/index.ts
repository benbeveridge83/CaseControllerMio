import {createClient} from 'npm:@supabase/supabase-js@2.112.2'
import {storeProviderTransaction} from '../_shared/lawpay-v314.js'
const env=(key:string,fallback='')=>Deno.env.get(key)||fallback
const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type, x-lawpay-token','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='POST')return reply({error:'Method not allowed.'},405)
  const expected=env('LAWPAY_WEBHOOK_TOKEN'),provided=new URL(req.url).searchParams.get('token')||req.headers.get('x-lawpay-token')||''
  if(!expected||provided!==expected)return reply({error:'Unauthorized webhook.'},401)
  try {
    const payload=await req.json(),event=payload.event||payload
    if(!event?.id||!event?.data?.id)throw new Error('A provider event and transaction ID are required.')
    if(!String(event.type||'').startsWith('transaction.'))return reply({ok:true,ignored:true})
    const url=env('SUPABASE_URL',env('URL')),key=env('SUPABASE_SERVICE_ROLE_KEY',env('SERVICE_ROLE_KEY'));if(!url||!key)throw new Error('Supabase service environment unavailable.')
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const accounts=Object.fromEntries(['operating','trust','echeck_operating','echeck_trust','clientcredit_trust'].map(name=>[name,env('LAWPAY_ACCOUNT_'+name.toUpperCase())]))
    const result=await storeProviderTransaction(db,event.data,{event,via:'webhook',accounts})
    return reply({ok:true,result})
  } catch(error){console.error('lawpay-webhook failed',error instanceof Error?error.message:String(error));return reply({error:error instanceof Error?error.message:String(error)},500)}
})
