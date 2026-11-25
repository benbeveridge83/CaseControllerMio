import fs from 'node:fs'
function replaceOnce(source,needle,replacement,label) {
  if (source.split(needle).length!==2) throw Error('Weekly billing mount anchor changed: '+label)
  return source.replace(needle,replacement)
}
export default function weeklyBillingReviewMount(){
  return {name:'mio-weekly-billing-review-mount',enforce:'pre',transform(source,id){
    if(!id.split('?')[0].replaceAll('\\\\','/').endsWith('/src/App.jsx'))return null
    let code="import MioWeeklyBilling from './MioWeeklyBilling.jsx'\n"+source
    code=replaceOnce(code,'  const [bulkInvoiceLedgerOpen, setBulkInvoiceLedgerOpen] = useState(false)',
      '  const weeklyBillingSettingsPopup=new URLSearchParams(window.location.search).has(\'mioWeeklyBillingSettings\')\n  const [weeklyBillingReviewOpen,setWeeklyBillingReviewOpen]=useState(weeklyBillingSettingsPopup)\n  const [weeklyBillingInitialStep,setWeeklyBillingInitialStep]=useState(weeklyBillingSettingsPopup?\'settings\':\'wip\')\n  const [weeklyBillingInvoiceHandoff,setWeeklyBillingInvoiceHandoff]=useState(false)\n  const [bulkInvoiceLedgerOpen, setBulkInvoiceLedgerOpen] = useState(false)','state')
    code=replaceOnce(code,'      if (!failures.length) window.setTimeout(closeBulkWipReview, 600)',
      `      if (!failures.length) window.setTimeout(()=>{
        closeBulkWipReview()
        if (weeklyBillingInvoiceHandoff) {
          setWeeklyBillingInvoiceHandoff(false)
          setWeeklyBillingInitialStep('payments')
          setWeeklyBillingReviewOpen(true)
        }
      }, 600)`, 'continue after invoice creation')
    const withdrawalHelper=fs.readFileSync(new URL('./src/mioWeeklyWithdrawal.inc',import.meta.url),'utf8')
    code=replaceOnce(code,'  function renderDailyBillingModal() {',withdrawalHelper+'\n  function renderDailyBillingModal() {','withdrawal helper')
    code=replaceOnce(code,'  async function paySelectedOutstandingFromTrust(matterIds) {',`  async function paySelectedOutstandingFromTrust(matterIds) {
    // The old bulk writer could save trust before a conflicted invoice update.
    setWeeklyBillingInitialStep('payments')
    setWeeklyBillingReviewOpen(true)
    setBulkBillingResult('Use Weekly Billing Payment Preview for atomic same-matter trust payments.')
    return`, 'disable split bulk trust writer')
    code=replaceOnce(code,'          <button type="button" style={tabButtonStyle(\'historical_migration\')} onClick={() => setBillingTab(\'historical_migration\')}>',
      `          <button type="button" onClick={async()=>{
            if(!session?.user?.id)return alert('Sign in to review current billing records.')
            try{
              const [entryRows,invoiceRows]=await Promise.all([
                loadAllSupabasePages(()=>supabase.from('mio_billing_entries').select('*').eq('user_id',session.user.id).order('entry_date',{ascending:false})),
                loadAllSupabasePages(()=>supabase.from('mio_invoices').select('*').eq('user_id',session.user.id).order('issue_date',{ascending:false}))
              ])
              const currentEntries=(entryRows||[]).map(billingEntryFromRelationalRow)
              const currentInvoices=(invoiceRows||[]).map(invoiceFromDatabaseRow)
              setBillingEntries(existing=>mergeBillingEntriesForState(currentEntries,existing,readBrowserBillingEntriesFallback()))
              setMioInvoices(existing=>mergeMioInvoiceState(currentInvoices,existing))
              setWeeklyBillingInitialStep('wip')
              setWeeklyBillingReviewOpen(true)
            }catch(error){alert('Could not refresh billing data. Weekly Billing stayed closed: '+(error?.message||error))}
          }} style={tabButtonStyle('weekly_billing_review')}>Weekly Billing Review</button>
          <button type="button" onClick={()=>replenishSelectedMatters(matters.filter(m=>m.is_active!==false).map(m=>m.id))}
            style={tabButtonStyle('trust_replenishment_review')} title="Standalone low-trust review, independent of weekly billing">Trust Replenishment Review</button>
          <button type="button" onClick={()=>window.open(window.location.origin+window.location.pathname+'?mioWeeklyBillingSettings=1','mio-weekly-billing-settings','width=1100,height=800,resizable=yes,scrollbars=yes')} style={tabButtonStyle('weekly_billing_settings')}>Billing Settings ↗</button>
          <button type="button" style={tabButtonStyle('historical_migration')} onClick={() => setBillingTab('historical_migration')}>`, 'billing navigation')
    code=replaceOnce(code,'        {renderDailyBillingModal()}',
      `        {renderDailyBillingModal()}
        {(page==='billing'||weeklyBillingSettingsPopup) && weeklyBillingReviewOpen && <MioWeeklyBilling initialStep={weeklyBillingInitialStep} onOpenExistingWipReview={weeklyBillingSettingsPopup?null:(ids=>{setWeeklyBillingInvoiceHandoff(true);setBillingTab('bulk_billing');openBulkWipReview(ids);setWeeklyBillingReviewOpen(false)})} onPayOwnMatterTrust={weeklyBillingSettingsPopup?null:(async()=>{const {data,error}=await supabase.from('case_mio_user_state').select('json_value').eq('user_id',session.user.id).eq('key','caseMioTrustTransactions').maybeSingle();if(error)throw error;if(Array.isArray(data?.json_value))setMioTrustTransactions(data.json_value);await loadMioInvoicesFromDatabase({force:true})})} onMarkWithdrawals={weeklyBillingSettingsPopup?null:weeklyBillingMarkForWithdrawal} onOpenReplenishmentReview={weeklyBillingSettingsPopup?null:(async()=>{await replenishSelectedMatters(matters.map(m=>m.id),{afterWeekly:true});setWeeklyBillingReviewOpen(false)})} matters={matters} clients={clients} withdrawalStatusFor={matterWithdrawalStatus} filterOptions={{caseStatuses:options('case_status').map(option=>option.name),matterStatuses:options('matter_status').map(option=>option.name),caseTypes:options('matter_type').map(option=>option.name)}} supabase={supabase} userId={session?.user?.id||''} financeFor={matter=>{
          const f=bulkFinanceByMatterId.get(String(matter.id))||clientFinanceNumbers(matter)||{}
          return {wip:f.wip,workOB:f.outstanding,
            // Available trust is intentionally unverified: never submit speculative funds.
            // Trust replenishment invoices must never be mistaken for earned-fee Work OB.
            availableTrust:0,displayTrust:Math.max(0,Number(f.trust)||0),displayResolved:!!f.financialSnapshotResolved,verified:false}
        }} onClose={()=>weeklyBillingSettingsPopup?window.close():setWeeklyBillingReviewOpen(false)} />}`, 'modal')
    return {code,map:null}
  }}
}
