// Provider reads only. No charge, refund, or transfer endpoint exists in this module.
export const clean=value=>String(value||'').trim().toLowerCase()
export function invoiceNumber(tx={}) {
  const fields=tx.data?.custom_fields||tx.custom_fields||{}
  return String(fields.Invoice||fields.invoice||fields.invoice_number||tx.invoice_number||'').trim().toUpperCase()||String(tx.reference||'').match(/MIO-\d{4}-\d+/i)?.[0]?.toUpperCase()||''
}
export function pageMetadata(data,page,size) {
  if(!Array.isArray(data?.results))throw new Error('LawPay did not return a transaction/event results page.')
  if(data.page!==undefined&&Number(data.page)!==page)throw new Error('LawPay returned the wrong page; scan is incomplete.')
  const total=Number(data.total_entries)
  if(!Number.isFinite(total)||total<0)throw new Error('LawPay did not return a valid total_entries count.')
  if(data.results.length===0&&(page-1)*size<total)throw new Error('LawPay returned an empty page before the end of the scan.')
  return {page,total_entries:total,has_more:page*size<total,next_page:page*size<total?page+1:null}
}
function requireResult(result,label) {if(result.error)throw new Error(`${label}: ${result.error.message||result.error}`);return result.data}
function accountKind(key){return clean(key).includes('trust')?'trust':clean(key).includes('operating')?'operating':''}
export async function findRequest(db,tx,prior,accounts) {
  const priorId=prior?.raw?.mio_payment_request_id
  if(priorId){const saved=requireResult(await db.from('lawpay_payment_requests').select('*').eq('id',priorId).maybeSingle(),'Read existing payment link');if(saved)return saved}
  const number=invoiceNumber(tx),reference=String(tx.reference||tx.source_id||'').trim()
  if(!number&&!reference)return null
  const query=db.from('lawpay_payment_requests').select('*')
  const rows=requireResult(await (number?query.eq('invoice_number',number):query.eq('reference',reference)).order('created_at',{ascending:false}).limit(100),'Match payment request')||[]
  const occurred=Date.parse(tx.created),configured=Object.entries(accounts).find(([,id])=>id&&id===tx.account_id)?.[0]||''
  return rows.find(request=>{
    if(Date.parse(request.created_at)>occurred+300000)return false
    if(configured&&request.account_key&&accountKind(configured)!==accountKind(request.account_key))return false
    // An explicit immutable invoice reference is stronger than a payer spelling.
    if(number)return true
    const email=clean(tx.method?.email),name=clean(tx.method?.name)
    return !(email&&clean(request.payer_email)&&email!==clean(request.payer_email))&&!( !email&&name&&clean(request.payer_name)&&name!==clean(request.payer_name))
  })||null
}
export async function storeProviderTransaction(db,tx,{event=null,via='poll',accounts={}}={}) {
  const id=String(tx?.id||'').trim()
  if(!id)throw new Error('LawPay transaction has no stable ID.')
  if(!Number.isSafeInteger(Number(tx.amount))||Number(tx.amount)<0)throw new Error('Invalid LawPay amount in cents.')
  if(!Number.isFinite(Date.parse(tx.created)))throw new Error('LawPay transaction creation date is unavailable.')
  const prior=requireResult(await db.from('lawpay_transactions').select('raw,account_key').eq('gateway_transaction_id',id).maybeSingle(),'Read existing transaction')
  const request=await findRequest(db,tx,prior,accounts)
  const configured=Object.entries(accounts).find(([,accountId])=>accountId&&accountId===tx.account_id)?.[0]||''
  const key=configured||request?.account_key||prior?.account_key||''
  const raw={...tx,mio_payment_request_id:request?.id||'',mio_invoice_number:request?.invoice_number||invoiceNumber(tx),mio_matter_id:request?.matter_id||prior?.raw?.mio_matter_id||'',mio_client_id:request?.client_id||prior?.raw?.mio_client_id||'',mio_account_key_source:configured?'configured_account':request?.account_key?'payment_request':'unresolved'}
  const row={gateway_transaction_id:id,gateway_event_id:event?.id||null,occurred_at:tx.created,modified_at:tx.modified||event?.created||tx.created,transaction_type:String(tx.type||''),status:String(tx.status||''),account_id:String(tx.account_id||''),account_key:key,amount_cents:Number(tx.amount),amount_refunded_cents:Number(tx.amount_refunded||0),currency:String(tx.currency||'USD'),reference:String(tx.reference||tx.source_id||''),payer_name:String(tx.method?.name||''),payer_email:String(tx.method?.email||''),payment_method_type:String(tx.method?.type||''),last_four:String(tx.method?.number||'').replace(/\D/g,'').slice(-4),raw}
  // The RPC serializes provider ID + invoice and commits receipt, payment event,
  // invoice delta, and request total atomically. Repeated pages cannot double-pay.
  const result=requireResult(await db.rpc('mio_store_lawpay_transaction_v314',{p_row:row}),'Post verified LawPay transaction')
  if(event?.id){
    const saved=await db.from('lawpay_events').insert({gateway_event_id:String(event.id),event_type:String(event.type||''),occurred_at:event.created||tx.created,gateway_transaction_id:id,raw:event,received_via:via,processed_at:new Date().toISOString()})
    if(saved.error&&saved.error.code!=='23505')throw new Error(saved.error.message||'Could not save gateway event history.')
  }
  return result
}
export async function syncProviderPage(db,gatewayGet,body,accounts={}) {
  const page=Math.trunc(Number(body.page||1)),size=Math.trunc(Number(body.page_size||25))
  if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(size)||size<1||size>100)throw new Error('Invalid LawPay page or page size.')
  const isEvents=body.action==='sync_events'
  const params=new URLSearchParams({page:String(page),page_size:String(size),order_by:'created'})
  for(const key of ['start_date','end_date'])if(body[key]){const date=new Date(body[key]);if(!Number.isFinite(date.getTime()))throw new Error(`Invalid ${key}`);params.set(key,date.toISOString())}
  const data=await gatewayGet(`/v1/${isEvents?'events':'transactions'}?${params}`)
  const metadata=pageMetadata(data,page,size),warnings=[]
  let processed=0
  for(const item of data.results){
    if(isEvents&&!String(item.type||'').startsWith('transaction.')){processed++;continue}
    const result=await storeProviderTransaction(db,isEvents?item.data:item,{event:isEvents?item:null,via:'poll',accounts})
    if(result?.status==='review')warnings.push(result)
    processed++
  }
  return {ok:true,...metadata,processed,warnings}
}
