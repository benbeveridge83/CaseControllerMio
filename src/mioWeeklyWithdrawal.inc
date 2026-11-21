  async function weeklyBillingMarkForWithdrawal(ids=[]) {
    if(!session?.user?.id)throw new Error('Sign in to review withdrawal flags.')
    const requested=[...new Set(ids.map(String))].filter(Boolean)
    if(!requested.length)throw new Error('Select at least one matter.')
    // Refresh financial records; if this cannot be completed, do not change statuses.
    const lawpayReady=await refreshLawPayFinancialData({silent:true})
    if(lawpayReady===false)throw new Error('LawPay financial information could not be refreshed.')
    const [settingsResult,invoiceResult,workflowResult,cloudResult]=await Promise.all([
      supabase.from('case_mio_user_state').select('json_value,raw_value').eq('user_id',session.user.id).eq('key','mioWeeklyBillingSettingsV1').maybeSingle(),
      supabase.from('mio_invoices').select('*').eq('user_id',session.user.id),
      supabase.from('mio_withdrawal_workflows').select('matter_id,state').eq('owner_id',session.user.id).in('matter_id',requested),
      supabase.from('case_mio_user_state').select('json_value,raw_value').eq('user_id',session.user.id).eq('key','caseControllerMatterExtraInfo').maybeSingle()
    ])
    const failure=[settingsResult.error,invoiceResult.error,workflowResult.error,cloudResult.error].find(Boolean)
    if(failure)throw new Error('Cannot verify billing/withdrawal state: '+(failure.message||failure))
    const settings=settingsResult.data?.json_value||JSON.parse(settingsResult.data?.raw_value||'{}')
    const currentExtra=cloudResult.data?.json_value||JSON.parse(cloudResult.data?.raw_value||'{}')
    if(!currentExtra||typeof currentExtra!=='object'||Array.isArray(currentExtra))throw new Error('Matter withdrawal state could not be verified.')
    const recentInvoices=(invoiceResult.data||[]).map(invoiceFromDatabaseRow)
    const workflowById=new Map((workflowResult.data||[]).map(w=>[String(w.matter_id),String(w.state?.status||'')]))
    const eligible=[],skipped=[]
    for(const id of requested){
      const matter=matters.find(m=>String(m.id)===id)
      if(!matter){skipped.push(id+': missing matter');continue}
      const override=settings?.matters?.[id]||{}
      const appointed=override.appointed??Boolean(matter.appointed||matter.is_appointed||matter.court_appointed)
      const included=override.included??!appointed
      if(!included||appointed){
        skipped.push((matter.name||id)+': weekly billing excluded/appointed');continue
      }
      if(matter.is_active===false||/closed|dismissed/i.test(String(matter.case_status||''))){skipped.push((matter.name||id)+': closed');continue}
      const workflowStatus=workflowById.get(id)
      if(['active','released','complete','completed'].includes(workflowStatus)||currentExtra[id]?.withdrawal_status==='withdrawing'){
        skipped.push((matter.name||id)+': already handled by withdrawal workflow');continue
      }
      if(!matter.client_id){skipped.push((matter.name||id)+': client identity unverified');continue}
      const finance=clientFinanceNumbers(matter,recentInvoices)
      const pending=pendingLawPayAmountForMatter(matter)
      if(!finance.financialSnapshotResolved||financeNumber(pending)>0.005){skipped.push((matter.name||id)+': unresolved financial records');continue}
      if(financeNumber(finance.outstanding)<=0.005||financeNumber(finance.trust)>0.005){
        skipped.push((matter.name||id)+': no unpaid Work OB or trust remains');continue
      }
      const fundable=matters.some(source=>{
        if(source.id===matter.id||String(source.client_id||'')!==String(matter.client_id)||source.is_active===false)return false
        const setting=settings?.matters?.[String(source.id)]||{}
        const share=setting.shareTrust!==false
        const sourceAppointed=setting.appointed??Boolean(source.appointed||source.is_appointed||source.court_appointed)
        const included=setting.included??!sourceAppointed
        return share&&included&&financeNumber(clientFinanceNumbers(source,recentInvoices).trust)>0.005
      })
      if(fundable){skipped.push((matter.name||id)+': another included matter has trust');continue}
      eligible.push(matter)
    }
    if(!eligible.length)throw new Error('No eligible matters remain after re-verification. '+skipped.join(' | '))
    if(!window.confirm('Mark '+eligible.length+' verified matter(s) for withdrawal? This is an administrative review flag only; representation does not end.\n\n'+eligible.map(m=>m.name||m.id).join('\n')+'\n\n'+(skipped.length?skipped.length+' other matter(s) were excluded.':''))){
      return {updated:0,cancelled:true,skipped}
    }
    const changedAt=new Date().toISOString(),next={...currentExtra}
    for(const matter of eligible){
      const id=String(matter.id)
      next[id]={...cloneMatterExtraInfo(next[id]||{}),withdrawal_status:'withdrawing',weekly_billing_marked_at:changedAt}
    }
    await saveMioStateKeyNow('caseControllerMatterExtraInfo',JSON.stringify(next),{throwOnError:true})
    const {data:verification,error:verifyError}=await supabase.from('case_mio_user_state').select('json_value,raw_value').eq('user_id',session.user.id).eq('key','caseControllerMatterExtraInfo').single()
    if(verifyError)throw new Error('Could not verify saved withdrawal marks: '+verifyError.message)
    const saved=verification.json_value||JSON.parse(verification.raw_value||'{}')
    if(eligible.some(m=>saved?.[String(m.id)]?.withdrawal_status!=='withdrawing'))throw new Error('Not all withdrawal marks persisted. Refresh before retrying.')
    setMatterExtraInfoById(next)
    return {updated:eligible.length,updatedIds:eligible.map(m=>String(m.id)),skipped}
  }
