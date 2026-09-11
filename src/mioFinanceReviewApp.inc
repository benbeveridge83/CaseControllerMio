  const [replenishmentReview,setReplenishmentReview]=useState({open:false,loading:false,rows:[],message:'',error:''})
  const replenishmentSendingRef=useRef(false)
  const [financeSyncReport,setFinanceSyncReport]=useState({state:'unchecked',message:'LawPay has not been checked in this session.'})

  useEffect(()=>{
    if(!session?.user?.id)return
    const visible=page==='billing'||page==='lawpay'||(page==='tasks'&&['finances','accounting'].includes(clientDashboardTab))
    if(!visible)return
    const check=()=>{if(document.visibilityState==='visible')refreshLawPayFinancialData({silent:true}).catch(()=>{})}
    check()
    const timer=window.setInterval(check,120000)
    window.addEventListener('focus',check)
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',check)}
  },[page,billingTab,clientDashboardTab,session?.user?.id])

  function updateReplenishmentRow(id,patch) {
    setReplenishmentReview(current=>({...current,rows:current.rows.map(row=>row.id===id?{...row,...patch,...(!patch.send_status?{send_status:'ready',send_error:''}:{})}:row)}))
  }
  async function readFinanceInvoicesForReview() {
    const rows=await loadAllSupabasePages(()=>supabase.from('mio_invoices').select('*').order('created_at',{ascending:false}).order('id',{ascending:true}))
    return rows.map(invoiceFromDatabaseRow)
  }
  async function replenishSelectedMatters(matterIds) {
    if(replenishmentSendingRef.current)return
    const ids=[...new Set((matterIds||[]).map(String))]
    if(!ids.length)return alert('Check at least one matter first.')
    setReplenishmentReview({open:true,loading:true,rows:[],message:'',error:''})
    setBulkBillingBusy(true)
    try {
      const invoices=await readFinanceInvoicesForReview()
      const rows=ids.map(id=>{
        const matter=matters.find(m=>String(m.id)===id)
        if(!matter)return null
        const candidate=replenishmentCandidate(id,invoices,matterReplenishmentAmount(matter))
        const invoice=candidate.invoice||null
        const template=renderBillingTemplate(invoices.some(i=>String(i.matter_id)===id&&i.invoice_type==='trust_request')?'replenishment':'initial_trust',{
          client_name:matterClientName(matter)||'Client',matter_name:matter.name||'',invoice_number:'[invoice number]',amount:'[amount]',
          trust_balance:money(clientFinanceNumbers(matter,invoices).trust),minimum_balance:money(clientFinanceNumbers(matter,invoices).minimumBalance),retainer_target:money(matterRetainerTarget(matter)),due_date:'10 days after issue',payment_link:'[secure LawPay link below]'
        })
        return {id,matter_id:id,client_name:matterClientName(matter)||'Client',matter_name:matter.name||'',matter_number:billingMatterNumber(matter),invoice,
          prepared_id:invoice?.id||crypto.randomUUID(),amount:String(candidate.amount??invoice?.balance??0),included:!candidate.blocked,
          recipient_email:invoice?.recipient_email||matterClientEmail(matter)||clientEmailForMatter(matter)||'',sender_email:DEFAULT_BILLING_SENDER_EMAIL,
          subject:template.subject||'Trust request [invoice number]',message:template.body||'Please replenish your trust account by [amount].',
          reason:candidate.reason||'',send_status:candidate.blocked?'blocked':'ready',send_error:''}
      }).filter(Boolean)
      setReplenishmentReview({open:true,loading:false,rows,message:'No emails have been sent. Approve individual requests or all selected requests below.',error:''})
    } catch(error){setReplenishmentReview(current=>({...current,loading:false,error:`Could not prepare review: ${error?.message||error}`}))}
    finally {setBulkBillingBusy(false)}
  }
  async function previewReplenishmentPdf(row) {
    const matter=matters.find(m=>String(m.id)===row.matter_id)
    const amount=Number(row.amount),date=firmDate()
    if(!Number.isFinite(amount)||amount<=0)return alert('Enter a positive request amount.')
    await openInvoicePdf({...row.invoice,id:row.prepared_id,invoice_number:row.invoice?.invoice_number||'PREVIEW - NOT ISSUED',invoice_type:'trust_request',matter_id:row.matter_id,client_name:row.client_name,matter_name:row.matter_name,issue_date:date,total:amount,subtotal:amount,balance:amount,amount_paid:0,line_items:[{date,description:'Trust / IOLTA retainer replenishment',amount}]},'open')
  }
  async function sendReplenishmentReview(rowId=null) {
    if(replenishmentSendingRef.current)return
    const rows=replenishmentReview.rows.filter(row=>(rowId?row.id===rowId:row.included)&&!['sent','blocked','uncertain','sending'].includes(row.send_status))
    if(!rows.length)return
    replenishmentSendingRef.current=true;setBulkBillingBusy(true)
    let sentCount=0,failedCount=0
    try {
      for(const row of rows) {
        let sendStarted=false
        try {
          const amount=Number(row.amount)
          if(!Number.isFinite(amount)||amount<=0||Math.round(amount*100)<=0)throw new Error('Enter a positive amount.')
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.recipient_email.trim()))throw new Error('Enter a valid recipient email.')
          if(!row.subject.trim()||!row.message.trim())throw new Error('Complete the subject and message.')
          const matter=matters.find(m=>String(m.id)===row.matter_id)
          if(!matter)throw new Error('Matter no longer exists.')
          const fresh=await readFinanceInvoicesForReview()
          const candidate=replenishmentCandidate(row.matter_id,fresh,amount)
          if(candidate.blocked)throw new Error(candidate.reason)
          const current=candidate.invoice
          if(current&&String(current.id)!==String(row.prepared_id))throw new Error('Another trust request was created. Reopen review to use it instead of creating a duplicate.')
          if(current&&row.invoice?.updated_at&&current.updated_at!==row.invoice.updated_at)throw new Error('This draft changed in another window. Reopen review before sending.')
          if(current?.payment_request_id&&Math.round(Number(current.total)*100)!==Math.round(amount*100))throw new Error('A payment link already exists for a different amount. Review the saved invoice first.')
          updateReplenishmentRow(row.id,{send_status:'sending',send_error:''})
          const now=new Date(),date=firmDate(),due=new Date(`${date}T12:00:00Z`);due.setUTCDate(due.getUTCDate()+10)
          const invoiceNumber=current?.invoice_number||row.invoice?.invoice_number||await reserveMioInvoiceNumber()
          const approved=await persistMioInvoiceRecord({...current,id:row.prepared_id,invoice_number:invoiceNumber,invoice_type:'trust_request',matter_id:row.matter_id,client_id:matter.client_id||'',client_name:row.client_name,matter_name:row.matter_name,matter_number:row.matter_number,
            issue_date:current?.issue_date||date,due_date:current?.due_date||due.toISOString().slice(0,10),status:'outstanding',subtotal:amount,total:amount,amount_paid:0,balance:amount,
            line_items:[{date,description:'Trust / IOLTA retainer replenishment',amount}],recipient_email:row.recipient_email.trim(),sender_email:DEFAULT_BILLING_SENDER_EMAIL,
            created_at:current?.created_at||now.toISOString(),updated_at:now.toISOString()},current?'invoice_approved':'invoice_created',{source:'replenishment_review',approved_before_send:true})
          updateReplenishmentRow(row.id,{invoice:approved,send_status:'sending'})
          const replaceTokens=text=>text.replaceAll('[invoice number]',invoiceNumber).replaceAll('[amount]',money(amount))
          sendStarted=true
          const sent=await sendInvoiceDocumentEmail(matter,approved,{recipient_email:row.recipient_email.trim(),sender_email:DEFAULT_BILLING_SENDER_EMAIL,subject:replaceTokens(row.subject),message:replaceTokens(row.message)})
          sentCount++;updateReplenishmentRow(row.id,{invoice:sent,send_status:'sent',included:false,send_error:''})
        } catch(error) {
          failedCount++
          updateReplenishmentRow(row.id,{send_status:sendStarted?'uncertain':'error',send_error:`${error?.message||error}${sendStarted?' Sending did not finish cleanly. Check Sent Items and the invoice email history before retrying; Mio will not automatically send it again.':''}`})
        }
      }
      const message=`${sentCount} request(s) sent. ${failedCount?`${failedCount} need attention.`:'No other requests were sent.'}`
      setReplenishmentReview(current=>({...current,message}));setBulkBillingResult(message)
      await Promise.all([loadMioInvoicesFromDatabase({force:true}),loadMioInvoiceEventsFromDatabase({force:true})])
    } finally {replenishmentSendingRef.current=false;setBulkBillingBusy(false)}
  }
  function renderFinanceSyncStatus() {
    const audit=auditLawPayRecords(lawPayTransactions.filter(tx=>String(tx.occurred_at||'')>=`${activeMioBillingCutoverDate}T00:00:00`),mioInvoices,mioInvoiceEvents)
    return <details style={{border:'1px solid #cbd5e1',borderRadius:8,padding:10,margin:'10px 0'}}>
      <summary style={{cursor:'pointer',fontWeight:700}}>LawPay reconciliation - {financeSyncReport.state==='checking'?'checking...':financeSyncReport.state==='error'?'check incomplete':`${audit.issues.length} invoice issue(s), ${audit.unlinked.length} unlinked transaction(s)`}</summary>
      <p role="status">{financeSyncReport.message}</p>
      <button type="button" onClick={()=>refreshLawPayFinancialData({silent:false})} disabled={lawPayBusy||financeSyncReport.state==='checking'}>Check all LawPay payments since Mio opening</button>
      <p>{audit.matched} matched completed transaction(s) in the loaded records. Unlinked consultations and refunds require attribution, not automatic posting to a matter.</p>
      {[...audit.issues,...audit.unlinked].map(issue=><p key={issue.id}><strong>{issue.invoiceNumber||issue.payer||'Unlinked transaction'}: {money(issue.amount)}</strong> - {issue.reason}</p>)}
    </details>
  }
