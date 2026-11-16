  const [mioDeskDetail,setMioDeskDetail]=useState(null)
  const [mioDeskToday,setMioDeskToday]=useState(()=>firmDate())
  useEffect(()=>{const timer=setInterval(()=>setMioDeskToday(firmDate()),30000);return()=>clearInterval(timer)},[])
  const [mioDeskFinanceState,setMioDeskFinanceState]=useState({ready:false,error:''})
  const mioDeskActiveRowRef=useRef(null)
  const mioDeskBillingOriginRef=useRef(null)
  useEffect(()=>{
    if(page!=='dashboard'||!session?.user?.id||!isFirmStaffMember())return
    let cancelled=false
    setMioDeskFinanceState({ready:false,error:''})
    ;(async()=>{
      await refreshDailyCoverageFinanceState()
      const refreshStarted=Date.now()
      const [lawPayReady,,billingReady]=await Promise.all([loadLawPayWorkspace({force:true}),loadMioInvoicesFromDatabase({force:true}),loadBillingRelationalData(session.user.id,{force:true})])
      if(lawPayReady===false)throw new Error('Recorded LawPay balances could not be refreshed.')
      if(billingReady!==true||Number(mioInvoiceLoadRef.current.lastSuccessAt||0)<refreshStarted)throw new Error('Current billing or invoice balances could not be confirmed. Retry when connected.')
      if(!cancelled)setMioDeskFinanceState({ready:true,error:''})
    })().catch(error=>{if(!cancelled)setMioDeskFinanceState({ready:false,error:error.message})})
    return()=>{cancelled=true}
  },[page,session?.user?.id])

  function mioDeskRows(){
    const active=matters.filter(m=>checklistMatterOpenClosedValue(m)==='open'),byId=new Map(active.map(m=>[String(m.id),m])),out=[]
    if(canOpenPage('need_to_set'))for(const {event} of checklistDisplayRows('need_date')){
      if(!event)continue
      const matter=checklistMatterForEvent(event)
      if(!matter||!byId.has(String(matter.id)))continue
      const sourceId=String(event.id||event.checklist_source_id||event.checklist_id)
      const context=checklistWorkspaceContextForEvent(event)
      out.push({key:`settings:${sourceId}`,sourceId,kind:'settings',matterId:String(matter.id),matterName:matter.name||checklistMatterLabel(event),title:checklistEventCategoryLabel(event),phase:currentNeedToSetStatus(event)?.stepName||'Set',event,context,linkedEmails:mioDeskThreadRecords(context)})
    }
    if(canOpenPage('orders'))for(const order of orderRows.filter(r=>!r.completed&&byId.has(String(r.matter_id)))){
      const matter=byId.get(String(order.matter_id)),context=orderWorkspaceContext(order)
      out.push({key:`orders:${order.id}`,sourceId:String(order.id),kind:'orders',matterId:String(matter.id),matterName:matter.name,title:order.title||orderTypeLabel(order.order_type),phase:orderHolderLabel(orderCurrentHolder(order)),context,order,linkedEmails:mioDeskThreadRecords(context)})
    }
    if(canOpenPage('matters'))for(const matter of active.filter(m=>/draft.*serve|need.*serv/i.test(String(m.matter_status||'')))){
      const context={type:'matter',matter,matterId:matter.id,title:'Drafted, need to serve',stepName:'Serve',billingStepName:`Dashboard / service / ${matter.id}`}
      out.push({key:`service:${matter.id}`,sourceId:String(matter.id),kind:'service',matterId:String(matter.id),matterName:matter.name,title:matter.matter_status,phase:'Serve',context,linkedEmails:mioDeskThreadRecords(context)})
    }
    return out
  }
  function mioDeskThreadRecords(context){return mioDeskLinkedThreads(workspaceEmailsForContext(context)).map(e=>({...e,mailbox_email:e.mailbox_email||serviceGraphAuth?.account?.username||session?.user?.email||'',dashboard_unread:Boolean(e.new_email_notice||workspaceEmailHasUnreadActivity(e))}))}
  function mioDeskOpenRow(row){
    mioDeskActiveRowRef.current=row
    if(row.kind==='service'){openSettingWorkspace(row.context);return}
    if(row.kind==='settings')setChecklistStepsExpandedByRow(current=>({...current,[row.sourceId]:true}))
    if(row.kind==='orders')setOrderExpandedIds(current=>Array.from(new Set([...current,row.order.id])))
    setMioDeskDetail({kind:row.kind,id:row.sourceId})
  }
  function mioDeskAddTime(row){
    mioDeskActiveRowRef.current=row
    openBillingWindow(row?{matter_id:row.matterId,matter_step:row.kind==='orders'?orderBillingMarker(row.order,'other'):mioDeskBillingMarker(row),date:firmDate(),description:`${row.title} - ${row.phase}`}:{date:firmDate()})
  }
  function mioDeskFinanceFor(matter){
    const f=clientFinanceNumbers(matter)
    const normalized=f.serviceInvoices.map(i=>({...i,balance:invoiceBalanceAmount(i),amount_paid:invoicePaidAmount(i)}))
    const unsettled=f.currentLedgerRows.filter(r=>r.source!=='LawPay'&&r.direction!=='out'&&/pending|processing|submitted|authorized/i.test(String(r.status||''))).reduce((n,r)=>n+Number(r.amount||0),0)
    const hasRefund=lawPayTransactionsForMatter(matter).some(t=>financeRowAfterSnapshot(t,f.snapshot)&&(/refund|chargeback|reversal/.test(String(t.transaction_type||'').toLowerCase())||Number(t.amount_refunded_cents)>0))
    return {...f,trust:Math.max(0,f.trust-unsettled),financialSnapshotResolved:f.financialSnapshotResolved&&!hasRefund,serviceInvoices:normalized,openingOutstanding:outstandingBreakdownForMatter(matter,f).openingBalance,obligationInvoices:normalized.filter(i=>!f.snapshot||financeRowAfterSnapshot(i,f.snapshot))}
  }
  function mioDeskWithdrawals(){
    if(!canOpenPage('withdrawals'))return []
    const ids=new Set([...withdrawalMatters.map(m=>String(m.id)),...Object.keys(mioWithdrawalSnapshot.rows)])
    return matters.filter(m=>ids.has(String(m.id))).map(m=>{const state=mioWithdrawalSnapshot.rows[String(m.id)]?.state,attention=state?.definition?workflowBlockAttention(state):mioDeskLegacyWithdrawalAttention(state),kind=attention?.kind||'needs_action';return {id:String(m.id),name:m.name||'Matter',kind,status:({needs:'Needs action',needs_action:'Needs action',needs_approval:'Needs review',waiting:'Waiting',paused:'Paused',complete:'Complete',released:'Released'})[kind]||'Review',next:attention?.next||'Review withdrawal progress'}}).sort((a,b)=>Number(/needs/.test(b.kind))-Number(/needs/.test(a.kind))||a.name.localeCompare(b.name))
  }
  function renderMioWorkDashboard(){
    const today=mioDeskToday,rows=mioDeskRows(),eligible=matters.filter(m=>checklistMatterOpenClosedValue(m)==='open')
    const finance={...mioDeskFinanceState}
    if(finance.ready&&canOpenPage('billing')){
      const args={entries:billingEntries,matters,userId:currentBillingUserId(),financeFor:mioDeskFinanceFor,pendingFor:pendingLawPayAmountForMatter,to:today}
      finance.day=mioDeskPeriodSummary({...args,from:today});finance.week=mioDeskPeriodSummary({...args,from:mioDeskWeekStart(today)})
    }
    const timeline=canOpenPage('matter_timelines')?allMatterTimelineData().flatMap(({matter,points})=>points.map(p=>({id:`${matter.id}:${p.sourceId}:${p.type}`,matterId:String(matter.id),name:matter.name,title:p.label,date:p.date instanceof Date?dateToInputValue(p.date):String(p.date||'').slice(0,10),lane:p.sourceType==='event'?'settings':'deadlines'}))):[]
    const activity=canOpenPage('documents')?documents.filter(d=>d.matter_id&&(d.upload_date||d.date)).map(d=>({id:`document:${d.id}`,matterId:String(d.matter_id),name:matters.find(m=>String(m.id)===String(d.matter_id))?.name||'Matter',date:String(d.upload_date||d.date).slice(0,10),title:d.name||'Document',lane:'activity'})):[]
    const checks=workflowDailyCheckedMap(today)
    return <MioWorkDashboard key={session.user.id} userId={session.user.id} billingUserId={currentBillingUserId()} matters={eligible} mailMatters={matters.map(m=>({...m,extra_info:matterExtraFor(m.id)}))} rows={rows} billingEntries={billingEntries} finance={finance} trust={finance.ready&&canOpenPage('billing')?mioDeskSortedTrust(eligible,mioDeskFinanceFor):[]} withdrawals={mioDeskWithdrawals()} withdrawalLoading={mioWithdrawalSnapshot.loading} withdrawalError={mioWithdrawalSnapshot.error||''} onWithdrawal={id=>{setMioWdFocusMatter(String(id));setPage('withdrawals')}} workflow={canOpenPage('workflow')?allWorkflowItemsIndented().map(item=>({...item,checked:Boolean(checks[item.id])})):[]} onWorkflow={(id,date)=>setWorkflowDailyChecks(current=>({...current,[date]:{...(current[date]||{}),[id]:!current[date]?.[id]}}))} onOpen={mioDeskOpenRow} onTime={mioDeskAddTime} onMatter={id=>{const matter=matters.find(m=>String(m.id)===String(id));if(matter)openSettingWorkspace({type:'matter',matter,matterId:matter.id})}} onNavigate={setPage} timeline={[...timeline,...activity]} renderNativePlanning={view=>view==='matter_timelines'&&canOpenPage(view)?renderMatterTimelinesPage():view==='checklist'&&canOpenPage(view)?renderChecklistTimelineView():<p>This page is unavailable.</p>} onLegacyMail={(row)=>{mioDeskActiveRowRef.current=row;openSettingWorkspace(row.context)}} />
  }
  function renderMioDeskDetail(){
    if(page!=='dashboard'||!mioDeskDetail)return null
    const row=mioDeskRows().find(r=>r.kind===mioDeskDetail.kind&&r.sourceId===mioDeskDetail.id)
    return <Modal title={row?`${row.matterName} - ${row.title}`:'Task no longer in this queue'} zIndex={850} wide onClose={()=>{setMioDeskDetail(null);mioDeskActiveRowRef.current=null}}><button onClick={()=>{setMioDeskDetail(null);mioDeskActiveRowRef.current=null}}>Close task details</button>{row&&<><button onClick={()=>mioDeskAddTime(row)}>＋ Add time</button>{row.kind==='settings'?renderNeedToSetExpandedStepDetail(row.event):renderOrdersPage(row.order.id)}</>}</Modal>
  }
