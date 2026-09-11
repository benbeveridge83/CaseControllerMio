import {createClient} from 'npm:@supabase/supabase-js@2.112.2'
import {syncProviderPage} from '../_shared/lawpay-v314.js'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
const env=(name:string,fallback='')=>Deno.env.get(name)||fallback
const accounts=()=>Object.fromEntries(['operating','trust','echeck_operating','echeck_trust','clientcredit_trust'].map(key=>[key,env('LAWPAY_ACCOUNT_'+key.toUpperCase())]))
function service(){const url=env('SUPABASE_URL',env('URL')),key=env('SUPABASE_SERVICE_ROLE_KEY',env('SERVICE_ROLE_KEY'));if(!url||!key)throw new Error('Supabase service environment unavailable.');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function requireUser(req:Request){const authorization=req.headers.get('Authorization')||'';if(!authorization.startsWith('Bearer '))throw new Error('Missing authenticated Mio session.');const client=createClient(env('SUPABASE_URL',env('URL')),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await client.auth.getUser();if(error||!data.user)throw new Error('Your Mio session is not valid. Sign in again.');return data.user}
async function gatewayGet(path:string){const secret=env('LAWPAY_SECRET_KEY');if(!secret)throw new Error('LAWPAY_SECRET_KEY is not configured.');const response=await fetch('https://api.affinipay.com'+path,{headers:{Authorization:`Basic ${btoa(secret+':')}`,Accept:'application/json'},signal:AbortSignal.timeout(25000)});const raw=await response.text();let data:any;try{data=JSON.parse(raw)}catch{throw new Error(`LawPay returned an invalid response (HTTP ${response.status}).`)}if(!response.ok)throw new Error(data?.message||data?.error?.message||`LawPay returned HTTP ${response.status}.`);return data}
function paymentUrl(body:any){
  const url=new URL(String(body.payment_page_url||''));if(url.protocol!=='https:'||!['secure.affinipay.com','secure.lawpay.com','app.lawpay.com'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))throw new Error('A secure LawPay hosted payment-page URL is required.')
  const amountCents=Math.round(Number(body.amount_cents));if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error('A positive payment amount is required.')
  const invoice=String(body.invoice_number||'').trim(),base=String(body.reference||body.matter_name||'').trim(),reference=invoice&&!base.toLowerCase().includes(invoice.toLowerCase())?`${base||'Payment'} | ${invoice}`:base
  // Preserve the established create_link contract. Mio normalizes hosted URL units.
  const values:Record<string,string>={amount:String(amountCents),reference,name:String(body.payer_name||body.client_name||'').trim(),email:String(body.payer_email||'').trim(),phone:String(body.payer_phone||'').trim(),Invoice:invoice}
  for(const [key,value] of Object.entries(values))if(value)url.searchParams.set(key,value)
  const locked=[];if(body.lock_amount!==false)locked.push('amount');if(body.lock_reference!==false&&reference)locked.push('reference');if(invoice)locked.push('Invoice');if(locked.length)url.searchParams.set('readOnlyFields',locked.join(','))
  return {url:url.toString(),amountCents,reference}
}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply({error:'Method not allowed.'},405)
  try {
    const user=await requireUser(req),body=await req.json().catch(()=>({})),action=String(body.action||'health'),db=service()
    if(action==='health'){const map=accounts(),events=await gatewayGet('/v1/events?page=1&page_size=1'),configured=Object.entries(map).filter(([,id])=>id);return reply({ok:true,version:314,account_count:configured.length,accounts:configured.map(([key,id])=>({key,id_last4:String(id).slice(-4)})),latest_event_at:events.results?.[0]?.created||null})}
    if(action==='create_link'){
      const key=String(body.account_key||''),map=accounts();if(!map[key])throw new Error('The selected LawPay account is not configured in Supabase secrets.')
      const built=paymentUrl(body),payload={created_by:user.id,matter_id:body.matter_id?String(body.matter_id):null,matter_name:String(body.matter_name||''),client_id:body.client_id?String(body.client_id):null,client_name:String(body.client_name||''),payer_name:String(body.payer_name||''),payer_email:String(body.payer_email||''),payer_phone:String(body.payer_phone||''),account_key:key,amount_cents:built.amountCents,invoice_number:String(body.invoice_number||''),reference:built.reference,payment_url:built.url,status:'created',raw:{source:'mio',account_id_last4:map[key].slice(-4)}}
      const {data,error}=await db.from('lawpay_payment_requests').insert(payload).select('*').single();if(error)throw error
      if(payload.invoice_number){const {error:saveError}=await db.from('mio_invoices').update({payment_request_id:String(data.id),payment_url:built.url,updated_at:new Date().toISOString()}).eq('invoice_number',payload.invoice_number);if(saveError)throw saveError}
      return reply({ok:true,url:built.url,request_id:data.id,request:data})
    }
    if(action==='sync_events'||action==='sync_transactions'){
      const options={...body,action,end_date:body.end_date||new Date().toISOString()}
      // New clients explicitly request pages. Old sync_events callers are drained
      // here, and receive an error rather than a false success on a truncated scan.
      if(body.page!==undefined)return reply(await syncProviderPage(db,gatewayGet,options,accounts()))
      let page=1,processed=0;const started=Date.now(),warnings=[]
      for(;;){const result=await syncProviderPage(db,gatewayGet,{...options,page},accounts());processed+=result.processed;warnings.push(...result.warnings);if(!result.has_more)return reply({...result,processed,warnings});if(Date.now()-started>45000)throw new Error(`LawPay scan is incomplete after ${processed} records. Refresh with the updated Mio payment review.`);page=result.next_page}
    }
    return reply({error:'Unknown LawPay action.'},400)
  } catch(error){console.error('lawpay-gateway request failed',error instanceof Error?error.message:String(error));return reply({ok:false,error:error instanceof Error?error.message:String(error)},500)}
})
