  async function refreshLawPayFinancialData(options={}) {
    if(!session?.user?.id)return {ok:false,error:'Sign in before checking payments.'}
    if(lawPayRefreshInFlightRef.current)return lawPayRefreshInFlightRef.current
    const silent=!!options.silent,now=Date.now()
    if(silent&&now-Number(lawPayLastSilentSyncAtRef.current||0)<120000)return {ok:false,skipped:'cooldown'}
    if(silent&&!claimMioBackgroundLease('lawpay-live-sync',120000))return {ok:false,skipped:'another_tab'}
    lawPayLastSilentSyncAtRef.current=now
    const refresh=(async()=>{
      setLawPayBusy(true);setFinanceSyncReport({state:'checking',message:'Checking every page of LawPay transactions since the Mio opening date...'})
      try {
        const start=new Date(`${activeMioBillingCutoverDate}T00:00:00Z`).toISOString(),end=new Date().toISOString()
        const result=await scanLawPayPages(async body=>{
          const {data,error}=await supabase.functions.invoke('lawpay-gateway',{body})
          if(error)throw error
          return data
        },{action:'sync_transactions',start_date:start,end_date:end,page_size:25},progress=>setFinanceSyncReport({state:'checking',message:`Checking LawPay page ${progress.page}: ${progress.processed} of ${progress.total} transactions processed...`}))
        // Read all pages again after posting; a cached read cannot establish completeness.
        const [invoices,transactions,requests,events]=await Promise.all([
          readFinanceInvoicesForReview(),
          loadAllSupabasePages(()=>supabase.from('lawpay_transactions').select('*').order('occurred_at',{ascending:false}).order('id',{ascending:true})),
          loadAllSupabasePages(()=>supabase.from('lawpay_payment_requests').select('*').order('created_at',{ascending:false}).order('id',{ascending:true})),
          loadAllSupabasePages(()=>supabase.from('mio_invoice_events').select('*').eq('user_id',session.user.id).order('occurred_at',{ascending:false}).order('id',{ascending:true}))
        ])
        setMioInvoices(invoices);setLawPayTransactions(transactions);setLawPayPaymentRequests(requests);setMioInvoiceEvents(events)
        const audit=auditLawPayRecords(transactions.filter(tx=>String(tx.occurred_at||'')>=start),invoices,events,requests)
        const report={processed:result.processed,pages:result.pages,opening_date:activeMioBillingCutoverDate,checked_at:end}
        const message=lawPayReconciliationMessage({processed:report.processed,pages:report.pages,openingDate:report.opening_date,checkedAtLabel:new Date(report.checked_at).toLocaleString()},audit)
        setFinanceSyncReport({state:audit.issues.length?'attention':'checked',message,...report});setLawPayMessage(message)
        return {...result,audit}
      } catch(error) {
        const message=`LawPay check incomplete: ${error?.message||error}. Previously recorded balances are retained; this is not confirmation that every payment is present.`
        setFinanceSyncReport({state:'error',message});setLawPayMessage(message)
        return {ok:false,error:message}
      } finally {setLawPayBusy(false);lawPayRefreshInFlightRef.current=null}
    })()
    lawPayRefreshInFlightRef.current=refresh
    return refresh
  }
