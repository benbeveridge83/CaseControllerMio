function replaceOnce(source,needle,replacement,label) {
  if (source.split(needle).length!==2) throw Error('Weekly billing mount anchor changed: '+label)
  return source.replace(needle,replacement)
}
export default function weeklyBillingReviewMount(){
  return {name:'mio-weekly-billing-review-mount',enforce:'pre',transform(source,id){
    if(!id.split('?')[0].replaceAll('\\\\','/').endsWith('/src/App.jsx'))return null
    let code="import MioWeeklyBilling from './MioWeeklyBilling.jsx'\n"+source
    code=replaceOnce(code,'  const [bulkInvoiceLedgerOpen, setBulkInvoiceLedgerOpen] = useState(false)',
      '  const weeklyBillingSettingsPopup=new URLSearchParams(window.location.search).has(\'mioWeeklyBillingSettings\')\n  const [weeklyBillingReviewOpen,setWeeklyBillingReviewOpen]=useState(weeklyBillingSettingsPopup)\n  const [bulkInvoiceLedgerOpen, setBulkInvoiceLedgerOpen] = useState(false)','state')
    code=replaceOnce(code,'        {renderDailyBillingModal()}',
      `        {renderDailyBillingModal()}
        {page==='billing' && !weeklyBillingSettingsPopup && <div style={{position:'fixed',bottom:20,right:20,zIndex:9998,display:'flex',gap:8}}>
          <button type="button" onClick={()=>setWeeklyBillingReviewOpen(true)} style={{background:'#17345b',color:'#fff',padding:'10px 15px',borderRadius:10,border:'1px solid #8ca4be',boxShadow:'0 6px 20px #0003',cursor:'pointer'}}>Weekly Billing Review</button>
          <button type="button" onClick={()=>window.open(window.location.origin+window.location.pathname+'?mioWeeklyBillingSettings=1','mio-weekly-billing-settings','width=1100,height=800,resizable=yes,scrollbars=yes')} style={{background:'#fff',color:'#17345b',padding:'10px 15px',borderRadius:10,border:'1px solid #8ca4be',boxShadow:'0 6px 20px #0003',cursor:'pointer'}}>⚙ Billing Settings ↗</button>
        </div>}
        {(page==='billing'||weeklyBillingSettingsPopup) && weeklyBillingReviewOpen && <MioWeeklyBilling initialStep={weeklyBillingSettingsPopup?'settings':'wip'} onOpenExistingWipReview={weeklyBillingSettingsPopup?null:(ids=>{setWeeklyBillingReviewOpen(false);openBulkWipReview(ids)})} matters={matters} supabase={supabase} userId={session?.user?.id||''} financeFor={matter=>{
          const f=bulkFinanceByMatterId.get(String(matter.id))||clientFinanceNumbers(matter)||{}
          const workInvoices=Array.isArray(f.serviceInvoices)?f.serviceInvoices.filter(invoice=>invoice.invoice_type!=='trust_request'&&invoice.status!=='void'):[]
          const workOB=workInvoices.reduce((sum,invoice)=>sum+Math.max(0,Number(invoice.balance??(Number(invoice.total||0)-Number(invoice.amount_paid||0)))||0),0)
          return {wip:f.wip??f.workInProgress??f.unbilledTotal,workOB,
            // Available trust is intentionally unverified: never submit speculative funds.
            // Trust replenishment invoices must never be mistaken for earned-fee Work OB.
            availableTrust:0,displayTrust:f.trust??0,verified:false}
        }} onClose={()=>weeklyBillingSettingsPopup?window.close():setWeeklyBillingReviewOpen(false)} />}`, 'modal')
    return {code,map:null}
  }}
}
