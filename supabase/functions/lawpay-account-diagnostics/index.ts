// Read-only LawPay deposit-account diagnostics (V323). This function exists on its own so it
// can be deployed and reviewed without carrying any action that records money: it cannot post,
// correct, match or map anything. Everything it returns is aggregated and redacted.
import {createClient} from 'npm:@supabase/supabase-js@2.112.2'
import {accountRegistry,buildAccountDiagnostics,financeAdminAllowed} from '../_shared/lawpay-accounts-v323.js'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
const env=(name:string,fallback='')=>Deno.env.get(name)||fallback
const accounts=()=>Object.fromEntries(['operating','trust','echeck_operating','echeck_trust','clientcredit_trust'].map(key=>[key,env('LAWPAY_ACCOUNT_'+key.toUpperCase())]))
function service(){const url=env('SUPABASE_URL',env('URL')),key=env('SUPABASE_SERVICE_ROLE_KEY',env('SERVICE_ROLE_KEY'));if(!url||!key)throw new Error('Supabase service environment unavailable.');return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
async function requireUser(req:Request){const authorization=req.headers.get('Authorization')||'';if(!authorization.startsWith('Bearer '))throw new Error('Missing authenticated Mio session.');const client=createClient(env('SUPABASE_URL',env('URL')),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await client.auth.getUser();if(error||!data.user)throw new Error('Your Mio session is not valid. Sign in again.');return data.user}
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return reply({error:'Method not allowed.'},405)
  try {
    const user=await requireUser(req)
    if(!financeAdminAllowed(user?.email,env('MIO_FINANCE_ADMIN_EMAILS')))return reply({ok:false,error:'A firm finance administrator must be signed in to run LawPay diagnostics.'},403)
    const body=await req.json().catch(()=>({})),db=service()
    const limit=Math.min(Math.max(Number(body.limit)||200,1),500)
    const columns='gateway_transaction_id,account_id,account_key,amount_refunded_cents,transaction_type,status,synced_at,raw'
    const txs=await db.from('lawpay_transactions').select(columns).order('occurred_at',{ascending:false}).limit(limit)
    if(txs.error)throw txs.error
    // The path a transaction arrived by is recorded on its events; only counts are returned.
    const events=await db.from('lawpay_events').select('gateway_transaction_id,received_via').order('occurred_at',{ascending:false}).limit(limit)
    const mapping=await db.from('mio_lawpay_accounts').select('provider_account_id,account_key,bank_account_id,bank_role,label,is_active')
    const registry=accountRegistry({rows:mapping.error?[]:(mapping.data||[]),environment:accounts()})
    return reply({ok:true,version:324,redacted:true,mapping_table_available:!mapping.error,
      diagnostics:buildAccountDiagnostics({transactions:txs.data||[],registry,events:events.error?[]:(events.data||[])})})
  } catch(error){console.error('lawpay diagnostics failed',error instanceof Error?error.message:String(error));return reply({ok:false,error:error instanceof Error?error.message:String(error)},500)}
})
