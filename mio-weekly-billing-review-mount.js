function replaceOnce(source,needle,replacement,label) {
  if (source.split(needle).length!==2) throw Error('Weekly billing mount anchor changed: '+label)
  return source.replace(needle,replacement)
}
export default function weeklyBillingReviewMount(){
  return {name:'mio-weekly-billing-review-mount',enforce:'pre',transform(source,id){
    if(!id.split('?')[0].replaceAll('\\\\','/').endsWith('/src/App.jsx'))return null
    let code="import MioWeeklyBilling from './MioWeeklyBilling.jsx'\n"+source
    code=replaceOnce(code,'  const [bulkInvoiceLedgerOpen, setBulkInvoiceLedgerOpen] = useState(false)',
      '  const [weeklyBillingReviewOpen,setWeeklyBillingReviewOpen]=useState(false)\n  const [bulkInvoiceLedgerOpen, setBulkInvoiceLedgerOpen] = useState(false)','state')
    code=replaceOnce(code,'        {renderDailyBillingModal()}',
      `        {renderDailyBillingModal()}
        {page==='billing' && <button type="button" onClick={()=>setWeeklyBillingReviewOpen(true)} style={{position:'fixed',bottom:20,right:20,zIndex:9998,background:'#17345b',color:'#fff',padding:'10px 15px',borderRadius:10,border:'1px solid #8ca4be',boxShadow:'0 6px 20px #0003',cursor:'pointer'}}>Weekly Billing Review</button>}
        {page==='billing' && weeklyBillingReviewOpen && <MioWeeklyBilling matters={matters} financeFor={matter=>{
          const f=bulkFinanceByMatterId.get(String(matter.id))||clientFinanceNumbers(matter)||{}
          return {wip:f.wip??f.workInProgress??f.unbilledTotal,workOB:f.outstanding,
            // Available trust is intentionally unverified: never submit speculative funds.
            availableTrust:0,verified:false}
        }} onClose={()=>setWeeklyBillingReviewOpen(false)} />}`, 'modal')
    return {code,map:null}
  }}
}
