export const PNC_STATUS='PNC- Need to Consult'
export const CONSULT_STATUS='Consult- Need to Client'
export const CLIENT_STATUS='Client-Need to Draft'
export const pncStage=m=>m?.matter_status===PNC_STATUS?'consult':m?.matter_status===CONSULT_STATUS?'engage':null
export const emailOK=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim())
const q=(key,label,group='Case information',type='textarea',required=false)=>({id:key,key,label,group,type,required})
const common=[q('full_name','Your full legal name','Contact','text',true),q('email','Your email address','Contact','email',true),q('phone','Your phone number','Contact','tel'),q('other_party','Name of the other party and any known attorney','Conflict check','text',true),q('deadlines','Any upcoming court dates or deadlines'),q('goals','What help are you seeking?')]
export const DEFAULT_INTAKES=[
 {id:'pnc-dfps',name:'DFPS',description:'Tell us about the DFPS case. Do not include Social Security numbers or account passwords.',case_type_patterns:['dfps'],is_active:true,questions:[...common,q('children','Children: names and ages','Children'),q('agency','Caseworker, agency contact and court'),q('placement','Current placement and any safety concerns'),q('orders','Existing orders, service plan and important dates')]},
 {id:'pnc-sapcr',name:'SAPCR / Modification',description:'Tell us about the children, existing orders and requested changes.',case_type_patterns:['sapcr','modification'],is_active:true,questions:[...common,q('children','Children: names, dates of birth and current residence','Children','children'),q('orders','Current custody, possession and support orders'),q('changes','What has changed since the last order?'),q('requested','What changes are you asking the court to make?')]},
 {id:'pnc-divorce-kids',name:'Divorce with children',description:'Tell us about your marriage, children and financial issues.',case_type_patterns:['divorce with'],is_active:true,questions:[...common,q('marriage','Marriage date and separation date'),q('children','Children: names, dates of birth and current residence','Children','children'),q('parenting','Current parenting arrangement and requested arrangement'),q('property','Major property, debts and income'),q('orders','Any existing court orders or pending cases')]},
 {id:'pnc-divorce-no-kids',name:'Divorce without children',description:'Tell us about your marriage, property and financial issues.',case_type_patterns:['divorce without'],is_active:true,questions:[...common,q('marriage','Marriage date and separation date'),q('property','Major property and debts'),q('income','Employment and income information'),q('agreements','Any marital agreements or property disputes')]}
]
export const PNC_DEFAULTS={consult_fee:'',retainer:5000,duration:60,time_zone:'America/Chicago',signature_template_id:'',signer_role:'Client',consult_subject:'Consultation with Beveridge Law Firm',consult_body:'Hello {{client_name}},\n\nPlease pay the consultation fee of {{consult_fee}} using the secure link below.\n{{payment_link}}\n\n{{intake_section}}\n{{consultation_section}}\n\nThank you,\nBeveridge Law Firm, PLLC',consultation_body:'Your consultation is scheduled for {{consultation_date}}.\n{{location}}',intake_body:'Please complete your secure intake form before the consultation:\n{{intake_link}}',engage_subject:'Fee agreement and retainer - Beveridge Law Firm',engage_body:'Hello {{client_name}},\n\nPlease review and sign your fee agreement using Dropbox Sign:\n{{signature_link}}\n\nPlease pay the retainer of {{retainer}} into the trust account:\n{{payment_link}}\n\nThank you,\nBeveridge Law Firm, PLLC'}
export function templateText(text,values){return String(text||'').replace(/\{\{([a-z_]+)\}\}/g,(_,key)=>String(values[key]??''))}
export const accountFamily=k=>['trust','echeck_trust','clientcredit_trust'].includes(k)?'trust':['operating','echeck_operating'].includes(k)?'operating':'unknown'
export function paymentEvidence(transactions,request){
  const result={status:'not_paid',paid_cents:0,processing_cents:0,required_cents:Number(request?.amount_cents||0),ids:[]}
  if(!request)return result
  const seen=new Set();let reversed=false
  for(const t of transactions||[]){const key=String(t.gateway_transaction_id||t.id||'');if(!key||seen.has(key))continue
    const raw=t.raw||{},invoice=String(raw.invoice_number||raw.data?.invoice_number||raw.mio_invoice_number||'')
    const reqId=String(raw.mio_payment_request_id||raw.mio_request_id||raw.request_id||raw.data?.mio_request_id||'')
    const exact=reqId===String(request.id)||String(t.gateway_transaction_id)===String(request.gateway_transaction_id||'')||(invoice&&invoice===request.invoice_number)||(t.reference&&t.reference===request.reference)
    if(!exact||accountFamily(t.account_key)==='unknown'||accountFamily(t.account_key)!==accountFamily(request.account_key)||String(t.currency||'USD')!=='USD')continue
    seen.add(key)
    const type=String(t.transaction_type||'').toLowerCase(),status=String(t.status||'').toLowerCase()
    if(/refund|chargeback|reversal|credit/.test(type)){reversed=true;continue}
    if(/void/.test(type)||/declin|fail|void|cancel|return|chargedback|refunded/.test(status))continue
    const amount=Math.max(0,Number(t.amount_cents||0)-Number(t.amount_refunded_cents||0))
    if(['completed','complete','paid','settled','captured','succeeded','success'].includes(status))result.paid_cents+=amount
    else if(['pending','processing','submitted','authorized','authorised'].includes(status))result.processing_cents+=amount
    else continue
    result.ids.push(key)
  }
  if(reversed){result.status='needs_review';return result}
  if(result.required_cents>0&&result.paid_cents>=result.required_cents)result.status='paid'
  else if(result.required_cents>0&&result.paid_cents+result.processing_cents>=result.required_cents)result.status='processing'
  else if(result.paid_cents+result.processing_cents>0)result.status='partial'
  return result
}
export function signatureEvidence(r){return {id:r?.signature_request_id||'',status:r?.is_declined?'declined':r?.has_error?'error':r?.test_mode?'test':r?.is_complete?'signed':r?'awaiting_signature':'not_sent',url:r?.signing_url||''}}
export const readyToClient=s=>s?.signature?.status==='signed'&&['paid','processing'].includes(s?.retainer?.status)
// Convert a wall-clock consultation time without trusting the browser's time zone.
export function zonedDateTime(local,zone='America/Chicago'){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(local)))throw Error('Enter a consultation date and time.')
 const target=local.replace('T',' '),base=Date.parse(local+'Z'),format=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
 const matches=[];for(let min=-14*60;min<=14*60;min+=15){const d=new Date(base+min*60000);if(format.format(d)===target)matches.push(d)}
 if(matches.length!==1)throw Error(matches.length?'This time is ambiguous during the daylight-saving change. Choose a different time.':'This time does not exist in the selected time zone.')
 return matches[0]
}
