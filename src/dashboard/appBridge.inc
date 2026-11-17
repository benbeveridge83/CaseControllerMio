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

  // Keep the all-matter timeline and finance work out of billing-form keystrokes.
  const mioDeskTimeline=useMemo(()=>{
    if(page!=='dashboard'||!session?.user?.id||!isFirmStaffMember())return []
    return canOpenPage('matter_timelines')?allMatterTimelineData().filter(({matter})=>checklistMatterOpenClosedValue(matter)==='open').flatMap(({matter,points})=>points.map(p=>({id:`${matter.id}:${p.sourceId}:${p.type}`,matterId:String(matter.id),name:matter.name,title:p.label,date:p.date instanceof Date?dateToInputValue(p.date):String(p.date||'').slice(0,10),lane:p.sourceType==='event'?'settings':'deadlines'}))):[]
  },[page,session,currentTeamMember,team,matters,events,documents,settings,courts,tags,documentFieldDefinitions,documentFieldTagRules,calculatedUserFields,discoveryRequests,deletedDiscoveryRowIds,discoveryRequestRows,matterExtraInfoById,matterTimelineOptions,matterTimelineDateAdjustments,matterTimelineLayoutMode,courtTimelineRules,mioDeskToday])
  const mioDeskData=useMemo(()=>{
    if(page!=='dashboard'||!session?.user?.id||!isFirmStaffMember())return null
    return mioDeskBuildData()
  },[page,session,currentTeamMember,team,matters,clients,events,documents,settings,courts,billingEntries,mioInvoices,bulkFinanceByMatterId,lawPayTransactions,lawPayPaymentRequests,lawPayAttribution,mioDeskToday,mioDeskFinanceState,mioWithdrawalSnapshot.rows,mioWithdrawalSnapshot.loading,mioWithdrawalSnapshot.error,matterExtraInfoById,orderRows,settingWorkspaces,settingCenterRecords,checklistCaseStatusFilter,checklistMatterStatusFilter,checklistEventCategoryFilter,checklistOpenClosedFilter,checklistNewEmailOnly,checklistNeedToSetSortMode,checklistNeedToSetOrder,needToSetSetRows,needToSetFinalizedRows,needToSetPausedRows,needToSetFirstSeenDates,needToSetCompanions,needToSetStepData,needToSetAgeColors,checklistStepCompletions,eventChecklistTemplates,eventChecklistCompletions,matterStepCompletions,serviceEmailRows])

  function mioDeskRows(){
    const active=matters.filter(m=>checklistMatterOpenClosedValue(m)==='open'),byId=new Map(active.map(m=>[String(m.id),m])),out=[]
    if(canOpenPage('need_to_set'))for(const {event} of checklistDisplayRows('need_date')){
      if(!event)continue
      const matter=checklistMatterForEvent(event)
      if(!matter||!byId.has(String(matter.id)))continue
      const sourceId=String(event.id||event.checklist_source_id||event.checklist_id)
      const context=checklistWorkspaceContextForEvent(event)
      out.push({key:`settings:${sourceId}`,sourceId,kind:'settings',matterId:String(matter.id),clientName:mioDeskClientName(matter,clients),matterName:matter.name||checklistMatterLabel(event),title:checklistEventCategoryLabel(event),phase:currentNeedToSetStatus(event)?.stepName||'Set',event,context,linkedEmails:[]})
    }
    if(canOpenPage('orders'))for(const order of orderRows.filter(r=>!r.completed&&byId.has(String(r.matter_id)))){
      const matter=byId.get(String(order.matter_id)),context=orderWorkspaceContext(order)
      out.push({key:`orders:${order.id}`,sourceId:String(order.id),kind:'orders',matterId:String(matter.id),clientName:mioDeskClientName(matter,clients),matterName:matter.name,title:order.title||orderTypeLabel(order.order_type),phase:orderHolderLabel(orderCurrentHolder(order)),context,order,linkedEmails:[]})
    }
    if(canOpenPage('matters'))for(const matter of active.filter(m=>/draft.*serve|need.*serv/i.test(String(m.matter_status||'')))){
      const context={type:'matter',matter,matterId:matter.id,title:'Drafted, need to serve',stepName:'Serve',billingStepName:`Dashboard / service / ${matter.id}`}
      out.push({key:`service:${matter.id}`,sourceId:String(matter.id),kind:'service',matterId:String(matter.id),clientName:mioDeskClientName(matter,clients),matterName:matter.name,title:matter.matter_status,phase:'Serve',context,linkedEmails:[]})
    }
    return out
  }
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
    const f=bulkFinanceByMatterId.get(String(matter.id))||clientFinanceNumbers(matter)
    const normalized=f.serviceInvoices.map(i=>({...i,balance:invoiceBalanceAmount(i),amount_paid:invoicePaidAmount(i)}))
    const unsettled=f.currentLedgerRows.filter(r=>r.source!=='LawPay'&&r.direction!=='out'&&/pending|processing|submitted|authorized/i.test(String(r.status||''))).reduce((n,r)=>n+Number(r.amount||0),0)
    const hasRefund=lawPayTransactionsForMatter(matter).some(t=>financeRowAfterSnapshot(t,f.snapshot)&&(/refund|chargeback|reversal/.test(String(t.transaction_type||'').toLowerCase())||Number(t.amount_refunded_cents)>0))
    return {...f,trust:Math.max(0,f.trust-unsettled),financialSnapshotResolved:f.financialSnapshotResolved&&!hasRefund,serviceInvoices:normalized,openingOutstanding:outstandingBreakdownForMatter(matter,f).openingBalance,obligationInvoices:normalized.filter(i=>!f.snapshot||financeRowAfterSnapshot(i,f.snapshot))}
  }
  function mioDeskWithdrawals(){
    if(!canOpenPage('withdrawals'))return []
    const ids=new Set([...withdrawalMatters.map(m=>String(m.id)),...Object.keys(mioWithdrawalSnapshot.rows)])
    return matters.filter(m=>ids.has(String(m.id))&&checklistMatterOpenClosedValue(m)==='open'&&mioWithdrawalSnapshot.rows[String(m.id)]?.state?.status!=='released').map(m=>{const state=mioWithdrawalSnapshot.rows[String(m.id)]?.state,attention=state?.definition?mioDeskBlockWithdrawalAttention(state):mioDeskLegacyWithdrawalAttention(state),kind=attention?.kind||'needs_action';return {id:String(m.id),name:m.name||'Matter',clientName:mioDeskClientName(m,clients),kind,status:({needs:'Needs action',needs_action:'Needs action',needs_approval:'Needs review',waiting:'Waiting',paused:'Paused',complete:'Complete',released:'Released'})[kind]||'Review',next:attention?.next||'Review withdrawal progress'}}).filter(w=>w.kind!=='released').sort((a,b)=>Number(/needs/.test(b.kind))-Number(/needs/.test(a.kind))||a.name.localeCompare(b.name))
  }
  function mioDeskBillSends(matterId){
    return mioDeskRecentBillSends(matterId,mioInvoices).map(bill=>{
      const invoice=mioInvoices.find(i=>String(i.id)===String(bill.invoiceId))
      const total=invoice?.total!==null&&invoice?.total!==undefined&&invoice?.total!==''&&Number.isFinite(Number(invoice.total))?Math.max(0,Number(invoice.total)):null
      return {...bill,total,paid:total===null?null:invoicePaidAmount(invoice),balance:total===null?null:invoiceBalanceAmount(invoice)}
    })
  }
  function mioDeskBuildData(){
    const today=mioDeskToday,rows=mioDeskRows(),eligible=matters.filter(m=>checklistMatterOpenClosedValue(m)==='open')
    const finance={...mioDeskFinanceState},byId=new Map(matters.map(m=>[String(m.id),m])),financeCache=new Map()
    const financeFor=matter=>{const id=String(matter.id);if(!financeCache.has(id))financeCache.set(id,mioDeskFinanceFor(matter));return financeCache.get(id)}
    if(finance.ready&&canOpenPage('billing')){
      const args={entries:billingEntries,matters,userId:currentBillingUserId(),financeFor,pendingFor:pendingLawPayAmountForMatter,to:today}
      finance.day=mioDeskPeriodSummary({...args,from:today});finance.week=mioDeskPeriodSummary({...args,from:mioDeskWeekStart(today)})
    }
    const activity=canOpenPage('documents')?documents.filter(d=>d.matter_id&&byId.has(String(d.matter_id))&&checklistMatterOpenClosedValue(byId.get(String(d.matter_id)))==='open'&&(d.upload_date||d.date)).map(d=>({id:`document:${d.id}`,matterId:String(d.matter_id),name:byId.get(String(d.matter_id))?.name||'Matter',date:String(d.upload_date||d.date).slice(0,10),title:d.name||'Document',lane:'activity'})):[]
    const trust=finance.ready&&canOpenPage('billing')?mioDeskSortedTrust(eligible,financeFor).map(m=>({...m,clientName:mioDeskClientName(byId.get(m.id),clients)})):[]
    const trustDetails=matter=>{const visible=canOpenPage('billing'),f=visible&&finance.ready&&matter?financeFor(matter):null;return {financeVisible:visible,trust:f&&f.financialSnapshotResolved!==false?f.trust:null}}
    return {today,rows:rows.map(row=>({...row,...trustDetails(byId.get(String(row.matterId)))})),eligible,finance,trust,activity,withdrawals:mioDeskWithdrawals().map(w=>({...w,...trustDetails(byId.get(String(w.id))),billSends:canOpenPage('billing')?mioDeskBillSends(w.id):[]}))}
  }
  function renderMioWorkDashboard(){
    if(!mioDeskData)return null
    const {today,rows,eligible,finance,trust,activity,withdrawals}=mioDeskData
    const checks=workflowDailyCheckedMap(today)
    return <MioWorkDashboard key={session.user.id} billingUserId={currentBillingUserId()} rows={rows} onAddNeedToSet={canOpenPage('need_to_set')?openAddUndatedEventWindow:null} billingEntries={billingEntries} finance={finance} trust={trust} withdrawals={withdrawals} withdrawalLoading={mioWithdrawalSnapshot.loading} withdrawalError={mioWithdrawalSnapshot.error||''} onWithdrawal={id=>{setMioWdFocusMatter(String(id));setPage('withdrawals')}} workflow={canOpenPage('workflow')?allWorkflowItemsIndented().map(item=>({...item,checked:Boolean(checks[item.id])})):[]} onWorkflow={(id,date)=>setWorkflowDailyChecks(current=>({...current,[date]:{...(current[date]||{}),[id]:!current[date]?.[id]}}))} onOpen={mioDeskOpenRow} onTime={mioDeskAddTime} onMatter={id=>{const matter=matters.find(m=>String(m.id)===String(id));if(matter)openSettingWorkspace({type:'matter',matter,matterId:matter.id})}} onNavigate={setPage} timeline={[...mioDeskTimeline,...activity]} renderNativePlanning={view=>view==='matter_timelines'&&canOpenPage(view)?renderMatterTimelinesPage(true):view==='checklist'&&canOpenPage(view)?renderChecklistTimelineView(true):<p>This page is unavailable.</p>} />
  }
  function renderMioDeskDetail(){
    if(page!=='dashboard'||!mioDeskDetail)return null
    const row=mioDeskData?.rows.find(r=>r.kind===mioDeskDetail.kind&&r.sourceId===mioDeskDetail.id)
    return <Modal title={row?`${row.clientName} - ${row.matterName} - ${row.title}`:'Task no longer in this queue'} zIndex={850} wide onClose={()=>{setMioDeskDetail(null);mioDeskActiveRowRef.current=null}}><button onClick={()=>{setMioDeskDetail(null);mioDeskActiveRowRef.current=null}}>Close task details</button>{row&&<><button onClick={()=>mioDeskAddTime(row)}>＋ Add time</button>{row.kind==='settings'?renderNeedToSetExpandedStepDetail(row.event):renderOrdersPage(row.order.id)}</>}</Modal>
  }
