  const [replenishmentReview,setReplenishmentReview]=useState({open:false,loading:false,rows:[],message:'',error:''})
  const replenishmentSendingRef=useRef(false)
  const [financeSyncReport,setFinanceSyncReport]=useState({state:'unchecked',message:'LawPay has not been checked in this session.'})
  const [lawPayAttributionEditor,setLawPayAttributionEditor]=useState(null)

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

  useEffect(()=>{
    if(!session?.user?.id||page!=='withdrawals')return
    // Withdrawal rows show the same trust balance Bulk billing shows, so load the same
    // read-only records as soon as this page opens and whenever it regains focus. The
    // LawPay gateway sync stays on Billing and LawPay; this page never posts money, and
    // it must never present a balance calculated from records it did not load.
    const load=()=>{if(document.visibilityState==='visible')refreshMioFinancialGraphData().catch(()=>{})}
    load()
    const timer=window.setInterval(load,120000)
    window.addEventListener('focus',load)
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',load)}
  },[page,session?.user?.id])

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
  function lawPayTransactionById(id) {
    return (lawPayTransactions||[]).find(transaction=>String(transaction?.gateway_transaction_id||transaction?.id||'')===String(id))||null
  }
  function attributionRecordFor(id) {
    return (lawPayAttribution||[]).find(record=>String(record?.gateway_transaction_id||'')===String(id))||null
  }
  function attributionMatterName(record) {
    const matter=(matters||[]).find(item=>String(item.id)===String(record?.matter_id||''))
    return matter?.name||record?.matter_name||''
  }
  // A PNC choice is offered only for matters actually in a PNC stage, and the recorded kind
  // comes from the matter status instead of being inferred from the payment amount.
  function attributionMatterChoices(editor) {
    const query=String(editor?.query||'').trim().toLowerCase(),pncOnly=editor?.decision==='pnc'
    return (matters||[]).map(matter=>({matter,pnc:pncStage(matter)})).filter(item=>!pncOnly||item.pnc)
      .filter(item=>!query||[matterClientName(item.matter),item.matter.name,item.matter.cause_number].filter(Boolean).join(' ').toLowerCase().includes(query))
      .sort((a,b)=>String(matterClientName(a.matter)).localeCompare(String(matterClientName(b.matter))))
  }
  async function latestStoredLawPayAttribution() {
    if(!session?.user?.id)return Array.isArray(lawPayAttribution)?[...lawPayAttribution]:[]
    const {data,error}=await supabase.from('case_mio_user_state').select('raw_value,json_value').eq('user_id',session.user.id).eq('key','caseMioLawPayAttribution').maybeSingle()
    if(error)throw new Error('Mio could not verify the saved attribution decisions. '+(error.message||error))
    if(Array.isArray(data?.json_value))return data.json_value
    if(data?.raw_value){try{const parsed=JSON.parse(data.raw_value);if(Array.isArray(parsed))return parsed}catch{}}
    return Array.isArray(lawPayAttribution)?[...lawPayAttribution]:[]
  }
  function openLawPayAttribution(issue) {
    const transaction=lawPayTransactionById(issue.id)
    setLawPayAttributionEditor({id:String(issue.id),payer:issue.payer||transaction?.payer_name||'',amount:issue.amount,account:String(transaction?.account_key||transaction?.raw?.account_key||'').trim().toLowerCase(),account_label:lawPayAccountLabel(transaction||issue),money_out:transaction?transactionMoneyOut(transaction):false,decision:'matter',matter_id:'',query:'',reason:'',busy:false,error:''})
  }
  async function saveLawPayAttribution() {
    const editor=lawPayAttributionEditor
    if(!editor||editor.busy)return
    const transaction=lawPayTransactionById(editor.id)
    if(!transaction){setLawPayAttributionEditor({...editor,error:'This charge is no longer in the loaded LawPay records. Check LawPay payments again before attributing it.'});return}
    const matter=['matter','pnc'].includes(editor.decision)?(matters||[]).find(item=>String(item.id)===String(editor.matter_id))||null:null
    const pnc=editor.decision==='pnc'&&matter?{id:matter.id,kind:pncStage(matter)||'consult'}:null
    const result=lawPayAttributionEntry({transaction,decision:editor.decision,matter,pnc,reason:editor.reason,actor:session?.user?.email||''})
    if(!result.ok){setLawPayAttributionEditor({...editor,error:result.error});return}
    setLawPayAttributionEditor({...editor,busy:true,error:''})
    let verifiedTrustRows=null
    try {
      if(result.entry) {
        const latestTrust=await latestStoredTrustTransactions()
        if(duplicateLawPayAttribution(latestTrust,transaction))throw new Error('This charge is already in the trust ledger, so Mio did not post it twice. Refresh the matter to see the recorded deposit.')
        const nextTrust=[result.entry,...latestTrust]
        await saveMioStateKeyNow('caseMioTrustTransactions',JSON.stringify(nextTrust),{throwOnError:true})
        const verified=await latestStoredTrustTransactions()
        if(!verified.some(row=>String(row?.id||'')===String(result.entry.id)))throw new Error('The trust-ledger entry could not be verified, so Mio recorded no attribution.')
        verifiedTrustRows=verified
      }
      const latestRecords=await latestStoredLawPayAttribution()
      const nextRecords=[result.record,...latestRecords.filter(record=>String(record?.gateway_transaction_id||'')!==String(result.record.gateway_transaction_id))]
      await saveMioStateKeyNow('caseMioLawPayAttribution',JSON.stringify(nextRecords),{throwOnError:true})
      const verifiedRecords=await latestStoredLawPayAttribution()
      if(!verifiedRecords.some(record=>String(record?.gateway_transaction_id||'')===String(result.record.gateway_transaction_id)))throw new Error('The attribution decision could not be verified.')
      if(verifiedTrustRows)setMioTrustTransactions(verifiedTrustRows)
      setLawPayAttribution(verifiedRecords)
      setLawPayAttributionEditor(null)
      setLawPayMessage(lawPayAttributionSummary(result.record,{matterName:matter?.name||'',pncLabel:matter?.name||''})+'. This charge no longer requires review.')
    } catch(error) {
      // Money never stays moved without a verified decision beside it.
      if(result.entry&&verifiedTrustRows) {
        const withoutEntry=verifiedTrustRows.filter(row=>String(row?.id||'')!==String(result.entry.id))
        try { await saveMioStateKeyNow('caseMioTrustTransactions',JSON.stringify(withoutEntry),{throwOnError:true});setMioTrustTransactions(withoutEntry) }
        catch(rollbackError) { setLawPayAttributionEditor({...editor,busy:false,error:`The attribution was not saved and the trust entry could not be removed. Review this matter's trust ledger before retrying. ${rollbackError?.message||rollbackError}`});return }
      }
      setLawPayAttributionEditor({...editor,busy:false,error:error?.message||String(error)})
    }
  }
  function renderLawPayAttributionEditor(editor) {
    return <div style={{border:'1px solid #94a3b8',borderRadius:8,padding:10,margin:'8px 0',background:'#f8fafc',display:'grid',gap:8,textAlign:'left'}}>
      <p><strong>Attribute {money(editor.amount)} from {editor.payer||'this charge'}</strong></p>
      <p>LawPay recorded the deposit account as <strong>{editor.account_label}</strong>. {editor.money_out?'This is a refund, reversal or chargeback, so trust money would leave the matter.':editor.account_label==='Account not reported'?'Mio could not resolve the deposit account, so it will not post this as a trust deposit until LawPay reports one.':'Mio never guesses a matter from the payer name.'}</p>
      <label>Decision<select aria-label="Attribution decision" value={editor.decision} onChange={event=>setLawPayAttributionEditor({...editor,decision:event.target.value,matter_id:'',error:''})}><option value="matter">Belongs to a matter</option><option value="pnc">PNC consultation / retainer payment</option><option value="neither">Neither - not a matter payment</option></select></label>
      {editor.decision!=='neither'&&<>
        <label>Find matter<input aria-label="Search matters for this payment" value={editor.query||''} onChange={event=>setLawPayAttributionEditor({...editor,query:event.target.value})} placeholder="Matter, client or cause #" /></label>
        <label>Matter<select aria-label="Matter for this payment" value={editor.matter_id} onChange={event=>setLawPayAttributionEditor({...editor,matter_id:event.target.value,error:''})}><option value="">{editor.decision==='pnc'?'Select the PNC matter':'Select the matter'}</option>{attributionMatterChoices(editor).map(item=><option key={item.matter.id} value={item.matter.id}>{matterClientName(item.matter)} - {item.matter.name}{item.pnc?` (PNC ${item.pnc})`:''}</option>)}</select></label>
      </>}
      {editor.decision==='neither'&&<label>Why this belongs to neither<textarea aria-label="Why this payment belongs to neither" value={editor.reason} onChange={event=>setLawPayAttributionEditor({...editor,reason:event.target.value})} /></label>}
      <p>{editor.decision==='neither'?'Nothing is posted to any trust or operating balance. The reason stays on the record.':accountKind(editor.account)==='trust'?(editor.money_out?'A refund takes this amount out of the selected matter trust ledger.':'This posts a trust deposit for the selected matter under the LawPay provider ID, so the same charge can never post twice.'):accountKind(editor.account)==='operating'?'The recorded account is operating, so this is saved for attribution and never changes a trust balance.':'Mio cannot tell trust money from operating money for this charge, so nothing will be posted. Confirm the charge in LawPay and rescan, then attribute it again.'}</p>
      {editor.error&&<p role="alert">{editor.error}</p>}
      <div style={{display:'flex',gap:8}}><button type="button" className="btnPrimary" disabled={editor.busy||(editor.decision!=='neither'&&!editor.matter_id)||(editor.decision==='neither'&&!String(editor.reason||'').trim())} onClick={saveLawPayAttribution}>{editor.busy?'Saving attribution...':'Save attribution'}</button><button type="button" disabled={editor.busy} onClick={()=>setLawPayAttributionEditor(null)}>Cancel</button></div>
    </div>
  }
  function renderFinanceSyncStatus() {
    const audit=auditLawPayRecords(lawPayTransactions.filter(tx=>String(tx.occurred_at||'')>=`${activeMioBillingCutoverDate}T00:00:00`),mioInvoices,mioInvoiceEvents)
    return <details style={{border:'1px solid #cbd5e1',borderRadius:8,padding:10,margin:'10px 0'}}>
      <summary style={{cursor:'pointer',fontWeight:700}}>LawPay reconciliation - {financeSyncReport.state==='checking'?'checking...':financeSyncReport.state==='error'?'check incomplete':`${audit.issues.length} invoice issue(s), ${audit.unlinked.length} unlinked transaction(s)`}</summary>
      <p role="status">{financeSyncReport.message}</p>
      <button type="button" onClick={()=>refreshLawPayFinancialData({silent:false})} disabled={lawPayBusy||financeSyncReport.state==='checking'}>Check all LawPay payments since Mio opening</button>
      <p>{audit.matched} matched completed transaction(s) in the loaded records. Unlinked consultations and refunds require attribution, not automatic posting to a matter. The LawPay deposit account recorded for each charge is shown below.</p>
      {audit.issues.map(issue=><p key={issue.id}><strong>{issue.invoiceNumber||issue.payer||'Unlinked transaction'}: {money(issue.amount)}</strong> - <strong>{issue.account_label||lawPayAccountLabel(issue.account)}</strong> - {issue.reason}</p>)}
      {audit.unlinked.map(issue=>{
        const record=attributionRecordFor(issue.id),editor=String(lawPayAttributionEditor?.id||'')===String(issue.id)?lawPayAttributionEditor:null
        const accountLabel=issue.account_label||lawPayAccountLabel(issue.account)
        return <div key={issue.id} style={{borderTop:'1px solid #e2e8f0',paddingTop:8,marginTop:8,textAlign:'left'}}>
          <p><strong>{issue.payer||'Unlinked transaction'}: {money(issue.amount)}</strong> - <strong>{record?lawPayAttributionSummary(record,{matterName:attributionMatterName(record)}):accountLabel}</strong>{record?'':` - ${issue.reason}`}</p>
          <p>{record?'This charge has an attribution decision and no longer requires review.':`Deposit account recorded by LawPay: ${accountLabel}. Choose the matter, a PNC, or neither before Mio records anything.`}</p>
          {!editor&&<button type="button" aria-label={`Categorize the ${money(issue.amount)} LawPay charge from ${issue.payer||'this payer'}`} onClick={()=>openLawPayAttribution(issue)}>{record?'Review attribution again':'Categorize this payment'}</button>}
          {editor&&renderLawPayAttributionEditor(editor)}
        </div>
      })}
    </details>
  }
