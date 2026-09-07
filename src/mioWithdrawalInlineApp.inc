  useEffect(()=>{
    if(!mioWdDraftRequest||page!=='drafting')return
    if(String(draftingSelection.matter_id)!==mioWdDraftRequest.matter_id||String(draftingSelection.template_id)!==mioWdDraftRequest.template_id)return
    setMioWdDraftRequest(null)
    void generateDraftForMatter(mioWdDraftRequest.matter_id).catch(error=>setMioWithdrawalIntegrationError('Draft generation failed: '+(error.message||error)))
  },[mioWdDraftRequest,page,draftingSelection])
  async function mioWdEnter(matterId){
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)throw new Error('Matter not found.')
    if(!window.confirm('Confirm withdrawal for '+matterClientName(matter)+' - '+matter.name+'? This changes the withdrawal status and prepares the drafting step. Nothing is filed or sent.'))return
    const at=new Date().toISOString(),extra={...matterExtraInfoById,[matterId]:{...cloneMatterExtraInfo(matterExtraInfoById[matterId]||{}),withdrawal_status:'withdrawing',withdrawal_entered_at:matterExtraInfoById[matterId]?.withdrawal_entered_at||at}}
    await saveMioStateKeyNow('caseControllerMatterExtraInfo',JSON.stringify(extra),{throwOnError:true})
    await mioWithdrawalStore.initialize(session.user.id,String(matterId),extra[matterId].withdrawal_entered_at)
    let current=mioWithdrawalStore.getSnapshot().rows[matterId]?.state
    if(current?.status==='released'){
      await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'workflow_reactivate',confirmed:true,note:'Attorney returned matter to withdrawal status from the withdrawal graph.'})
      current=mioWithdrawalStore.getSnapshot().rows[matterId]?.state
    }
    if(current?.steps.decision.status!=='complete')await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'step_update',step_id:'decision',status:'complete',note:'Attorney confirmed this matter should enter withdrawal.',evidence:{reference:'Attorney approval on the withdrawal candidate panel'},confirmed:true})
    setMatterExtraInfoById(extra);setMioWdFocusMatter(String(matterId))
  }
  async function mioWdRelease(matterId){
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)throw new Error('Matter not found.')
    if(!window.confirm('Release '+matterClientName(matter)+' - '+matter.name+' from withdrawal status? The withdrawal workflow history will be preserved, but the matter will no longer be treated as an active withdrawal.'))return
    const extra={...matterExtraInfoById,[matterId]:{...cloneMatterExtraInfo(matterExtraInfoById[matterId]||{}),withdrawal_status:'',withdrawal_released_at:new Date().toISOString()}}
    await saveMioStateKeyNow('caseControllerMatterExtraInfo',JSON.stringify(extra),{throwOnError:true})
    const state=mioWithdrawalStore.getSnapshot().rows[matterId]?.state
    if(state?.status==='active')await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'workflow_release',confirmed:true,note:'Attorney released matter from withdrawal status from the withdrawal graph.'})
    setMatterExtraInfoById(extra);if(mioWdFocusMatter===String(matterId))setMioWdFocusMatter('')
  }
  async function mioWdPrepareEfile(matterId,step,state,documentId){
    if(state.paused)throw new Error('Resume this withdrawal before preparing a filing.')
    if(step.id==='filing'&&state.steps.drafting.status!=='complete')throw new Error('Review and approve the draft first.')
    const matter=matters.find(m=>String(m.id)===String(matterId))
    const record=documents.find(d=>String(d.id)===String(documentId)&&String(d.matter_id)===String(matterId))
    if(!record||!(/\.pdf$/i.test(record.file_name||record.name||'')||record.file_type==='application/pdf'))throw new Error('Save the reviewed PDF in this matter Documents and select it on the filing step. A Word draft is not a filing PDF.')
    const dataUrl=await loadDocumentFileDataUrl(record),bytes=dataUrlToUint8Array(dataUrl||'')
    if(!bytes?.length||bytes.length>50*1024*1024)throw new Error('The filing PDF could not be loaded, or exceeds 50 MB.')
    if(String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw new Error('The selected file does not contain PDF data. Nothing was staged.')
    const file=new File([bytes],record.file_name||record.name||'Withdrawal.pdf',{type:'application/pdf'}),draft=defaultMioEfileDraft(),filing=draft.filings[0],id=mioEfileAgentId('efile-document')
    efileAgentFileObjectsRef.current[id]=file
    draft.filings=[{...filing,description:step.id==='notice'?'Notice of hearing on motion to withdraw':'Motion to withdraw',documents:[{id,file_name:file.name,size:file.size,type:file.type,role:'lead',local_file_required:true}]}]
    setEfileAgentDraft({...draft,matter_id:matterId,cause_number:matter.cause_number||'',case_style:matter.name||'',court_name:matter.courts?.court_name||'',withdrawal_step_id:step.id})
    setEfileAgentSelectedJobId('');setEfileAgentMessage('Reviewed PDF connected from Withdrawal. Review filing location, filing code, service recipients and fees before staging. Final submission still requires your explicit authorization.');setPage('efile')
  }
  function mioWdFinanceRows(){
    const byMatter=new Map()
    for(const row of mioTrustLedgerFinancialGraphRows()){
      const matter=financialGraphRowMatter(row),id=String(matter?.id||row.mio_matter_id||'');if(!id)continue
      if(!byMatter.has(id))byMatter.set(id,[])
      byMatter.get(id).push(snapshotGraphPointFromRow(row,'matter_trust_funds',matter))
    }
    return matters.map(m=>{
      const id=String(m.id),finance=bulkFinanceByMatterId.get(id)||clientFinanceNumbers(m),notices=[]
      const sent=financeInvoicesForMatter(m).filter(i=>!['void','draft'].includes(i.status)).map(invoice=>{
        const history=(invoice.email_history||[]).filter(e=>e.sent_at)
        const sends=history.length?history:(invoice.emailed_at?[{sent_at:invoice.emailed_at}]:[])
        for(const entry of sends)notices.push({date:entry.sent_at,series_id:id,invoice_id:invoice.id,invoice_number:invoice.invoice_number||'Invoice',label:(invoice.invoice_type==='trust_request'?'Trust request ':'Invoice ')+(invoice.invoice_number||'')+' sent',amount:invoice.total,balance:invoiceBalanceAmount(invoice),recipient:entry.recipient_email||invoice.recipient_email,graph_event_kind:'invoice_sent',graph_event_source:'Recorded invoice email history'})
        return {invoice,last:sends.map(e=>e.sent_at).sort().at(-1)||null,first:sends.map(e=>e.sent_at).sort()[0]||null}
      }).filter(x=>x.last).sort((a,b)=>String(b.last).localeCompare(String(a.last)))
      const workflow=mioWithdrawalSnapshot.rows[id]?.state
      for(const [stepId,step]of Object.entries(workflow?.steps||{}))if(step.last_outbound_at)notices.push({date:step.last_outbound_at,series_id:id,invoice_id:'withdrawal-'+stepId,invoice_number:WITHDRAWAL_STEPS.find(s=>s.id===stepId)?.name||'Withdrawal email',label:'Withdrawal email: '+(WITHDRAWAL_STEPS.find(s=>s.id===stepId)?.name||stepId),graph_event_kind:'withdrawal_email_sent',graph_event_source:'Recorded withdrawal workflow email send'})
      const latest=sent[0],below=Number(finance.trust)<Number(finance.minimumBalance)
      return {matter_id:id,name:m.name||'',client:matterClientName(m),cause_number:m.cause_number||'',case_type:String(m.case_type||m.matter_type||clioFixedCaseTypeForMioMatter(m)||'Unspecified'),matter_status:m.matter_status||m.case_status||'',active:m.is_active!==false&&!/closed|inactive/i.test([m.matter_status,m.case_status].join(' ')),trust:finance.trust,minimum:finance.minimumBalance,below,candidate:below&&!!latest&&invoiceBalanceAmount(latest.invoice)>0&&Date.now()-Date.parse(latest.first)>=7*86400000,withdrawing:matterWithdrawalStatus(m)==='withdrawing'&&workflow?.status!=='released',complete:workflow?.status==='complete',last_invoice_sent:latest?.last,last_withdrawal_sent:notices.filter(n=>n.graph_event_kind==='withdrawal_email_sent').map(n=>n.date).sort().at(-1),points:byMatter.get(id)||[],notices}
    })
  }
  function mioWdRenderGraph(rows){
    const series=rows.map(r=>({matter_id:r.matter_id,display_number:r.client+' - '+r.name,mio_matter_ids:[r.matter_id],matter_names:[{id:r.matter_id,name:r.name}],points:r.points,color:r.withdrawing?'#c62828':'#111111'}))
    if(rows.length===1&&rows[0].points.length){const r=rows[0];series.push({matter_id:'minimum-'+r.matter_id,display_number:'Minimum trust balance',points:[{date:r.points[0].date,balance:r.minimum},{date:new Date().toISOString(),balance:r.minimum}],color:'#7a7a7a'})}
    return renderClioGraph(series,{small:true,step:true,extendToToday:true,invoiceMarkers:rows.flatMap(r=>r.notices)})
  }
