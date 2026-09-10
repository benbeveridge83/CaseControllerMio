import {createClient} from 'npm:@supabase/supabase-js@2.108.2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Content-Type':'application/json','Cache-Control':'no-store'};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const read=async(q:any)=>{const {data,error}=await q;if(error)throw error;return data;};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return response({ok:true});if(req.method!=='POST')return response({error:'Use POST'},405);
 try{
  const authorization=req.headers.get('authorization')||'';if(!authorization.startsWith('Bearer '))return response({error:'Sign in'},401);
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:auth,error}=await caller.auth.getUser();if(error||!auth?.user?.id)return response({error:'Invalid session'},401);
  const user=auth.user,email=String(user.email||'').toLowerCase(),allowed=String(Deno.env.get('MIO_PNC_ALLOWED_EMAILS')||'').toLowerCase().split(',').map(x=>x.trim());
  if(!user.email_confirmed_at||(!email.endsWith('@beveridgelawfirm.com')&&!allowed.includes(email)))return response({error:'Firm access required'},403);
  const body=await req.json(),w=await read(caller.from('mio_pnc_workflows').select('matter_id,user_id,state').eq('user_id',user.id).eq('matter_id',body.matter_id).single());
  const secret=Deno.env.get('LAWPAY_SECRET_KEY');if(!secret)return response({error:'LawPay is not configured'},503);
  const accounts=Object.fromEntries(['operating','trust','echeck_operating','echeck_trust','clientcredit_trust'].map(k=>[k,Deno.env.get('LAWPAY_ACCOUNT_'+k.toUpperCase())||'']));
  const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}}),transactions=[];
  async function get(path:string){const r=await fetch('https://api.affinipay.com/v1'+path,{headers:{Authorization:'Basic '+btoa(secret+':'),Accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('LawPay verification failed ('+r.status+').');return r.json();}
  for(const kind of ['consult','retainer']){
   const id=w.state?.[kind+'_request']?.id;if(!id)continue;
   const request=await read(caller.from('lawpay_payment_requests').select('*').eq('id',id).eq('created_by',user.id).eq('matter_id',w.matter_id).single());
   if(request.account_key!==(kind==='consult'?'operating':'trust'))throw Error('Payment account mismatch.');
   const found=new Map<string,any>();let complete=false;
   for(let page=1;page<=5;page++){
    const p=await get('/transactions?page_size=100&page='+page+'&qf='+encodeURIComponent('reference:'+request.reference));
    for(const t of p.results||[])if(t.reference===request.reference)found.set(String(t.id),t);
    if(page*100>=Number(p.total_entries||0)){complete=true;break;}
   }
   if(!complete)throw Error('Too many matching transactions to verify safely.');
   // Previously mapped transactions are fetched individually so a changed reference,
   // refund or reversal cannot leave a stale paid indicator in Mio.
   const previous=await read(caller.from('lawpay_transactions').select('gateway_transaction_id').eq('raw->>mio_payment_request_id',id));
   const ids=new Set<string>((previous||[]).map((t:any)=>String(t.gateway_transaction_id)));if(request.gateway_transaction_id)ids.add(request.gateway_transaction_id);
   for(const txid of ids)if(!found.has(txid))found.set(txid,await get('/transactions/'+encodeURIComponent(txid)));
   for(const t of found.values()){
    const key=Object.keys(accounts).find(k=>accounts[k]&&accounts[k]===t.account_id)||'';
    if(!key||key.includes('trust')!==(kind==='retainer')||t.currency!=='USD')continue;
    const row={gateway_transaction_id:String(t.id),occurred_at:t.created||new Date().toISOString(),modified_at:t.modified||null,transaction_type:String(t.type||''),status:String(t.status||''),account_id:t.account_id,account_key:key,amount_cents:Number(t.amount||0),amount_refunded_cents:Number(t.amount_refunded||0),currency:t.currency,reference:request.reference,payer_name:String(t.method?.name||''),payer_email:String(t.method?.email||''),payment_method_type:String(t.method?.type||''),last_four:String(t.method?.number||'').replace(/\D/g,'').slice(-4),raw:{...t,mio_payment_request_id:id,mio_invoice_number:request.invoice_number,mio_matter_id:w.matter_id,mio_client_id:request.client_id},synced_at:new Date().toISOString()};
    await read(db.from('lawpay_transactions').upsert(row,{onConflict:'gateway_transaction_id'}));transactions.push(row);
   }
  }
  return response({ok:true,transactions,checked_at:new Date().toISOString()});
 }catch(e){return response({error:e instanceof Error?e.message:'Payment verification failed'},400);}
});
