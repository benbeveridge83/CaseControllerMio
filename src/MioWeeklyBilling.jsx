import React, {useEffect, useMemo, useState} from 'react'
import {createWeeklyBillingProposal, weeklyBillingDefaults, reconcileWeeklyBillingReview, possibleCrossMatterFunding, buildAtomicTrustPaymentPlan} from './mioWeeklyBillingModel.js'
import {loadWeeklyBillingReadOnly,prepareWeeklyInvoiceDrafts,validateWeeklyInvoiceSnapshot} from './mioWeeklyBillingData.js'
import {loadReplenishmentSettings,saveReplenishmentSettings} from './mioReplenishmentSettings.js'
const USD = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0)
const small={fontSize:12,color:'#64748b'}
const cell={padding:'8px 6px',textAlign:'left',borderBottom:'1px solid #e2e8f0'}
const button={padding:'7px 11px',border:'1px solid #94a3b8',borderRadius:7,background:'#fff',cursor:'pointer'}
const KEY='mioWeeklyBillingSettingsV1'
const normalized = value => String(value??'').trim().toLowerCase()
const uniqueLabels = values => [...new Set(values.map(value=>String(value??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b))
function SettingsFilter({title,choices,selected,onChange}) {
  const all=selected===null
  return <details style={{border:'1px solid #cbd5e1',borderRadius:8,padding:'5px 8px',background:'#fff',minWidth:160}}>
    <summary style={{cursor:'pointer',fontWeight:700}}>{title}: {all?'All':`${selected.length} selected`}</summary>
    <div style={{display:'flex',gap:6,margin:'8px 0'}}><button type="button" onClick={()=>onChange(null)}>All</button><button type="button" onClick={()=>onChange([])}>None</button></div>
    <div style={{display:'grid',gap:5,maxHeight:220,overflowY:'auto'}}>{choices.map(({value,label})=><label key={value} style={{display:'flex',alignItems:'center',gap:6}}>
      <input type="checkbox" checked={all||selected.includes(value)} onChange={()=>{const current=all?choices.map(choice=>choice.value):selected;onChange(current.includes(value)?current.filter(item=>item!==value):[...current,value])}}/> {label}
    </label>)}</div>
  </details>
}
// Safely stage local preferences until a cloud-backed settings adapter is connected.
// No invoice creation, trust posting, or withdrawal mutations are exposed by this component.
export default function MioWeeklyBilling({matters=[],clients=[],filterOptions={},financeFor=()=>null,supabase=null,userId='',initialStep='wip',onOpenExistingWipReview=null,onPayOwnMatterTrust=null,onMarkWithdrawals=null,onClose=()=>{}}) {
  const [step,setStep]=useState(initialStep)
  const [settings,setSettings]=useState({})
  const [changes,setChanges]=useState({})
  const [approvals,setApprovals]=useState({})
  const [invoicePacket,setInvoicePacket]=useState(null)
  const [packetBusy,setPacketBusy]=useState(false)
  const [ownPaymentExcluded,setOwnPaymentExcluded]=useState([])
  const [withdrawSelected,setWithdrawSelected]=useState([])
  const [withdrawMarked,setWithdrawMarked]=useState([])
  const [withdrawBusy,setWithdrawBusy]=useState(false)
  const [selected,setSelected]=useState(null)
  const [notice,setNotice]=useState('')
  const [cloudReady,setCloudReady]=useState(false)
  const [cloudError,setCloudError]=useState('')
  const [financeSnapshot,setFinanceSnapshot]=useState(null)
  const [financeError,setFinanceError]=useState('')
  const [financeLoading,setFinanceLoading]=useState(true)
  const [atomicBusy,setAtomicBusy]=useState(false)
  const [atomicRunId,setAtomicRunId]=useState('')
  const [atomicNotice,setAtomicNotice]=useState('')
  const [atomicApprovals,setAtomicApprovals]=useState({})
  const [caseStatusFilter,setCaseStatusFilter]=useState(['Open'])
  const [matterStatusFilter,setMatterStatusFilter]=useState(null)
  const [caseTypeFilter,setCaseTypeFilter]=useState(null)
  const [replenishmentSettings,setReplenishmentSettings]=useState({})
  const [replenishmentError,setReplenishmentError]=useState('')
  const [primarySaving,setPrimarySaving]=useState(false)
  const refreshFinancialSnapshot=async()=>{
    if(!supabase||!userId){setFinanceError('Login required to read financial records.');setFinanceLoading(false);return}
    setFinanceLoading(true);setFinanceError('')
    try {const current=await loadWeeklyBillingReadOnly(supabase,userId);setFinanceSnapshot(current)}
    catch(error){setFinanceSnapshot(null);setFinanceError(error?.message||String(error))}
    finally{setFinanceLoading(false)}
  }
  useEffect(()=>{refreshFinancialSnapshot()},[supabase,userId])
  useEffect(()=>{
    if(!supabase||!userId)return
    let cancelled=false
    loadReplenishmentSettings(supabase,userId).then(data=>{if(!cancelled)setReplenishmentSettings(data)})
      .catch(error=>{if(!cancelled)setReplenishmentError(error?.message||String(error))})
    return()=>{cancelled=true}
  },[supabase,userId])
  useEffect(()=>{
    if(!supabase||!userId){setCloudError('Cloud settings unavailable: sign in to persist preferences.');return}
    let cancelled=false
    setCloudReady(false)
    supabase.from('case_mio_user_state').select('json_value,updated_at').eq('user_id',userId).eq('key',KEY).maybeSingle()
      .then(({data,error})=>{
        if(cancelled)return
        if(error){setCloudError(error.message);return}
        setSettings(data?.json_value&&typeof data.json_value==='object'?data.json_value:{})
        setCloudReady(true)
      }).catch(error=>{if(!cancelled)setCloudError(error?.message||String(error))})
    return()=>{cancelled=true}
  },[supabase,userId])
  const minimum=Number(settings.minimumWip??150)
  const clientsById=useMemo(()=>new Map(clients.map(client=>[String(client.id),client])),[clients])
  const rows=useMemo(()=>matters.map(m=>{
    const defaults=weeklyBillingDefaults(m)
    const f=financeFor(m)||{}
    const override=changes[String(m.id)]||settings.matters?.[String(m.id)]||{}
    // Never represent unknown balances as verified, available funds.
    const trust=Number.isFinite(Number(f.availableTrust))?Number(f.availableTrust):0
    const wip=financeSnapshot?.wipByMatter?.[String(m.id)]??0
    const workOB=financeSnapshot?.workOBByMatter?.[String(m.id)]??0
    const clientId=String(m.client_id||m.client?.id||m.clients?.id||'')
    const client=clientsById.get(clientId)||m.client||m.clients||{}
    return {id:String(m.id),name:m.name||'Matter '+m.id,clientId,clientName:`${client.first_name||''} ${client.last_name||''}`.trim()||client.name||m.matter_client_name||m.client_name||'Client not listed',
      caseStatus:String(m.case_status||'').trim(),matterStatus:String(m.matter_status||'').trim(),caseType:String(m.matter_type||m.case_type||'').trim(),isActive:m.is_active!==false,
      withdrawalStatus:financeSnapshot?.withdrawalByMatter?.[String(m.id)]||'',
      appointed:override.appointed??defaults.appointed, included:override.included??defaults.included,
      shareTrust:override.shareTrust??defaults.shareTrust,agreementAuthorized:override.agreementAuthorized===true,
      wip,workOB,availableTrust:trust,displayTrust:Number(f.displayTrust)||0,oldestInvoiceDate:financeSnapshot?.oldestByMatter?.[String(m.id)]||'',unverified:!financeSnapshot}
  }),[matters,clientsById,financeFor,changes,settings,financeSnapshot])
  const caseStatuses=useMemo(()=>uniqueLabels([...(filterOptions.caseStatuses||[]),...rows.map(m=>m.caseStatus),'Open']),[filterOptions.caseStatuses,rows])
  const matterStatuses=useMemo(()=>uniqueLabels([...(filterOptions.matterStatuses||[]),...rows.map(m=>m.matterStatus)]),[filterOptions.matterStatuses,rows])
  const caseTypes=useMemo(()=>uniqueLabels([...(filterOptions.caseTypes||[]),...rows.map(m=>m.caseType)]),[filterOptions.caseTypes,rows])
  const matches=(selected,value)=>selected===null||selected.some(item=>normalized(item)===normalized(value))
  const visibleSettingsRows=rows.filter(m=>matches(caseStatusFilter,!m.isActive&&(!m.caseStatus||normalized(m.caseStatus)==='open')?'Closed':m.caseStatus||'Open')
    &&(matterStatusFilter===null||matterStatusFilter.some(value=>value==='__blank__'?!m.matterStatus:normalized(value)===normalized(m.matterStatus)))
    &&matches(caseTypeFilter,m.caseType))
  const matterClientGroups=useMemo(()=>{
    const groups=new Map()
    for(const matter of matters){const id=String(matter.client_id||matter.client?.id||matter.clients?.id||'');if(id)groups.set(id,[...(groups.get(id)||[]),String(matter.id)])}
    return groups
  },[matters])
  const primaryForClient=clientId=>{
    const ids=matterClientGroups.get(clientId)||[]
    if(ids.length===1)return ids[0]
    const selected=ids.filter(id=>replenishmentSettings[id]?.primary_replenishment_matter===true)
    return selected.length===1?selected[0]:''
  }
  const choosePrimary=async matter=>{
    if(!supabase||!userId||primarySaving||!matter.clientId)return
    setPrimarySaving(true);setReplenishmentError('')
    try{
      const ids=matterClientGroups.get(matter.clientId)||[]
      const next={...replenishmentSettings}
      // Clear other source designations before selecting the new one.
      for(const id of ids.filter(id=>id!==matter.id))next[id]=await saveReplenishmentSettings(supabase,userId,id,{primary_replenishment_matter:false})
      next[matter.id]=await saveReplenishmentSettings(supabase,userId,matter.id,{primary_replenishment_matter:true})
      setReplenishmentSettings(next)
    }catch(error){
      setReplenishmentError('Primary matter could not be saved: '+(error?.message||String(error)))
      try{setReplenishmentSettings(await loadReplenishmentSettings(supabase,userId))}catch{}
    }finally{setPrimarySaving(false)}
  }
  const proposal=useMemo(()=>createWeeklyBillingProposal({matters:rows,minimumWip:minimum,selectedIds:selected,authorizations:{}}),[rows,minimum,selected])
  const setMatter=(id,field,value)=>setChanges(old=>({...old,[id]:{...(old[id]||settings.matters?.[id]||{}),[field]:value}}))
  const save=async()=>{
    if(!cloudReady||!supabase||!userId){setNotice('Settings not saved: cloud is unavailable.');return}
    const next={...settings,matters:{...(settings.matters||{}),...changes}}
    setNotice('Saving...')
    const {error}=await supabase.from('case_mio_user_state').upsert({user_id:userId,key:KEY,json_value:next,raw_value:JSON.stringify(next),origin:'weekly_billing_review',updated_at:new Date().toISOString()},{onConflict:'user_id,key'})
    if(error){setNotice('Settings not saved: '+error.message);return}
    setSettings(next);setChanges({});setNotice('Billing preferences saved to Mio cloud settings.')
  }
  const first=rows.filter(r=>r.included&&r.wip>=minimum).map(r=>r.id)
  const preparePacket=async()=>{
    if(!financeSnapshot)throw new Error('Financial data unavailable')
    if(Object.keys(changes).length)throw new Error('Save or discard eligibility changes before preparing invoices.')
    const packet=prepareWeeklyInvoiceDrafts(financeSnapshot.entries,chosen)
    if(!packet.length){setNotice('No new WIP selected. Existing Work OB can still be reviewed for payment.')}
    setNotice('Rechecking all billing records...')
    const fresh=await loadWeeklyBillingReadOnly(supabase,userId)
    if(!validateWeeklyInvoiceSnapshot(packet,fresh.entries)){
      setFinanceSnapshot(fresh);setInvoicePacket(null)
      setNotice('Records changed since review. Review the updated entries before proceeding.');return
    }
    setFinanceSnapshot(fresh);setInvoicePacket(packet);setStep('payments')
    setNotice('Invoice approval packet prepared from fresh WIP records. No invoice was issued.')
  }
  // A previously checked matter drops out immediately when Billing is disabled.
  // Preserve the deliberate included override for appointed cases; the default
  // remains excluded, but the user's explicit eligibility choice takes priority.
  const chosen=(selected??first).filter(id=>rows.some(m=>m.id===id&&m.included))
  useEffect(()=>{setInvoicePacket(null)},[selected,changes,minimum])
  const review=reconcileWeeklyBillingReview(proposal,Object.entries(approvals).filter(([,value])=>value===false).map(([id])=>id))
  const suggestions=possibleCrossMatterFunding(rows.map(m=>({...m,selectedWip:chosen.includes(m.id)?m.wip:0})))
  const atomicEnabled=settings.enableAtomicWeeklyTrustPosting===true
  const atomicMatters=useMemo(()=>rows.map(m=>({...m,trustVerified:true,unrestrictedFundsVerified:true,verifiedAvailableTrust:Number(m.displayTrust)||0})),[rows])
  const atomicPlan=useMemo(()=>{
    if(!atomicEnabled||!financeSnapshot?.invoices)return {payments:[],totalCents:0}
    try{return buildAtomicTrustPaymentPlan({matters:atomicMatters,invoices:financeSnapshot.invoices,runId:atomicRunId||'preview'})}
    catch{return {payments:[],totalCents:0}}
  },[atomicEnabled,atomicMatters,financeSnapshot,atomicRunId])
  const postAtomicTrustPayments=async()=>{
    if(!supabase||!userId)throw new Error('Sign in to post trust payments.')
    if(!financeSnapshot?.invoices?.length)throw new Error('No verified invoices are loaded.')
    const runId=crypto.randomUUID();setAtomicRunId(runId)
    const plan=buildAtomicTrustPaymentPlan({matters:atomicMatters,invoices:financeSnapshot.invoices,runId})
    const toPost=plan.payments.filter(p=>atomicApprovals[`${p.invoiceId}:${p.sourceMatterId}:${p.amountCents}`]!==false)
    if(!toPost.length)throw new Error('No approved payments to post.')
    const total=toPost.reduce((sum,p)=>sum+p.amountCents,0)/100
    if(!window.confirm(`Post ${toPost.length} trust payment(s) totaling ${USD(total)}?\n\nThis records the trust-to-earned-fee allocation in Mio's ledger. It does not move bank funds; physical transfers are reconciled separately.`))return {cancelled:true}
    setAtomicBusy(true);setAtomicNotice('')
    try{
      const results=[]
      for(const p of toPost){
        const {data,error}=await supabase.rpc('mio_post_weekly_trust_payment_v1',{
          p_idempotency_key:p.idempotencyKey,
          p_source_matter_id:p.sourceMatterId,
          p_destination_matter_id:p.destinationMatterId,
          p_invoice_id:p.invoiceId,
          p_amount_cents:p.amountCents,
          p_expected_invoice_updated_at:p.expectedInvoiceUpdatedAt
        })
        if(error){results.push({status:'failed',message:error.message});continue}
        results.push({status:data?.status||'unknown'})
      }
      const posted=results.filter(r=>r.status==='ledger_posted'||r.status==='already_posted').length
      const failed=results.filter(r=>r.status==='failed').length
      setAtomicNotice(`${posted} posted${failed?', '+failed+' failed':''}.`)
      await refreshFinancialSnapshot()
      return {posted,failed}
    }finally{setAtomicBusy(false)}
  }
  const stageForReview=async()=>{
    if(!supabase||!userId||!cloudReady||!invoicePacket)throw new Error('Verified invoice packet and authenticated cloud settings required')
    if(Object.keys(changes).length)throw new Error('Save the matter-eligibility changes before preparing the final review.')
    setPacketBusy(true)
    try {
      const fresh=await loadWeeklyBillingReadOnly(supabase,userId)
      if(!validateWeeklyInvoiceSnapshot(invoicePacket,fresh.entries)){
        setInvoicePacket(null);setFinanceSnapshot(fresh)
        throw new Error('WIP changed after review. Restart invoice approval.')
      }
      const included=new Set(rows.filter(m=>m.included).map(m=>m.id))
      if(invoicePacket.some(p=>!included.has(p.matterId)))
        throw new Error('A selected matter is excluded. Restart review.')
      const id=crypto.randomUUID(),now=new Date().toISOString()
      const packet={id,createdAt:now,status:'prepared_unposted',minimumWip:minimum,
        invoices:invoicePacket.map(p=>({matterId:p.matterId,entryIds:p.entryIds,totalCents:p.totalCents})),
        rejectedPaymentIds:Object.entries(approvals).filter(([,v])=>v===false).map(([id])=>id),
        proposalSummary:{workCents:Math.round(proposal.totalWip*100),paymentsCents:0,transfersAuthorized:false},
        financialTransfersEnabled:atomicEnabled}
      const {error}=await supabase.from('case_mio_user_state').upsert({
        user_id:userId,key:'mioWeeklyBillingPreparedReviewV1',json_value:packet,
        raw_value:JSON.stringify(packet),origin:'weekly_billing_review',
        updated_at:now},{onConflict:'user_id,key'})
      if(error)throw new Error(error.message)
      setNotice('Approval packet saved in Mio as PREPARED — NOT POSTED. No invoice, payment, or withdrawal was changed.')
      setStep('unpaid')
    }finally{setPacketBusy(false)}
  }
  const eligiblePayments=review.payments
  return <div role="dialog" aria-label="Weekly Billing Review" style={{position:'fixed',inset:18,zIndex:100000,background:'#fff',color:'#13263d',border:'2px solid #94a3b8',borderRadius:12,boxShadow:'0 24px 70px #0005',overflow:'auto',padding:20}}>
    <header style={{display:'flex',gap:15,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}>
      <div><h2 style={{margin:'0 0 3px'}}>Weekly Billing — Review Workspace</h2><div style={small}>{atomicEnabled?'Atomic posting enabled — records an accounting allocation only; does not move bank funds':'Review mode — no invoices or trust payments will be posted'} · Appointed matters excluded by default</div></div>
      <button style={button} onClick={onClose}>Close ×</button>
    </header>
    <nav style={{display:'flex',gap:8,flexWrap:'wrap',margin:'18px 0'}}>
      {['wip','payments','unpaid','settings'].map((s,i)=><button key={s} style={{...button,background:step===s?'#dbeafe':'white',fontWeight:step===s?700:400}} onClick={()=>setStep(s)}>{i+1}. {({wip:'WIP Review',payments:'Payment Preview',unpaid:'Unpaid Balances',settings:'Settings'})[s]}</button>)}
    </nav>
    {financeLoading&&<p role="status">Loading recorded WIP and invoices…</p>}
    {financeError&&<p role="alert" style={{color:'#991b1b'}}>Financial records could not be loaded: {financeError}</p>}
    {financeSnapshot&&<p style={small}>Read-only records loaded: {financeSnapshot.recordCount.entries} billing entries; {financeSnapshot.recordCount.invoices} invoices. Trust remains unverified.</p>}
    {cloudError&&<p role="alert" style={{color:'#991b1b'}}>Settings connection: {cloudError}</p>}
    {notice&&<p role="status" style={{background:'#eff6ff',padding:8}}>{notice}</p>}
    {step==='wip'&&<>
      <h3>Work in progress — largest first</h3>
      <p style={small}>WIP and balances must be verified against live finance data before execution. Unknown values are shown as zero, not as available funds.</p>
      <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Invoice','Matter','WIP','Work OB','Small controls'].map(t=><th key={t} style={cell}>{t}</th>)}</tr></thead><tbody>
        {[...rows].sort((a,b)=>b.wip-a.wip).map(m=><tr key={m.id}>
          <td style={cell}><input type="checkbox" aria-label={'Select WIP '+m.name} checked={m.included&&chosen.includes(m.id)} disabled={!m.included} onChange={e=>setSelected(old=>e.target.checked?[...new Set([...(old??first),m.id])]:(old??first).filter(x=>x!==m.id))}/></td>
          <td style={cell}>{m.name}{m.appointed&&<span style={small}> · Appointed</span>}</td><td style={cell}>{USD(m.wip)}</td><td style={cell}>{USD(m.workOB)}</td>
          <td style={cell}><label style={small}><input type="checkbox" checked={m.included} onChange={e=>setMatter(m.id,'included',e.target.checked)}/> Billing</label> <label style={small}><input type="checkbox" checked={m.shareTrust} onChange={e=>setMatter(m.id,'shareTrust',e.target.checked)}/> Share</label></td>
        </tr>)}
      </tbody></table><p><strong>Selected WIP: {USD(proposal.totalWip)}</strong></p>
      <button style={button} onClick={()=>preparePacket().catch(error=>setNotice('Invoice packet preparation failed: '+(error?.message||error)))} disabled={!financeSnapshot||financeLoading}>Verify WIP & Prepare Invoice Packet →</button> <button style={button} onClick={refreshFinancialSnapshot}>Refresh financial records</button>
    </>}
    {step==='payments'&&<>
      <h3>Invoice approval packet</h3>
      {invoicePacket&&<section style={{background:'#f1f5f9',padding:12,borderRadius:8}}>
        <strong>{invoicePacket.length} proposed invoice(s), unissued</strong>
        {invoicePacket.map(p=><div key={p.matterId} style={{padding:'7px 0',borderBottom:'1px solid #cbd5e1'}}>
          {rows.find(m=>m.id===p.matterId)?.name||p.matterId}: {USD(p.totalCents/100)} — {p.entryIds.length} WIP entries
        </div>)}
        <p style={small}>The packet is a verified review snapshot, not an invoice. Records must be checked again before an authorized invoice posting operation.</p>
      </section>}
      <h3>Proposed trust payments</h3>
      <p style={small}>Cross-matter payments require a signed fee agreement and the source matter's Share Trust setting. {atomicEnabled?'The atomic action below posts ledger allocations (accounting only — no bank movement).':'Enable atomic trust posting in Settings to make posting available.'}</p>
      {suggestions.length>0&&<section style={{border:'1px solid #d97706',background:'#fffbeb',padding:12,borderRadius:8,marginBottom:12}}>
        <strong>Possible cross-matter sharing — NOT authorized or payable yet</strong>
        <p style={small}>These amounts use displayed trust balances only. Funds, agreement authorization, and all outstanding obligations must be verified before any payout.</p>
        {suggestions.map(p=><div key={p.id} style={{marginBottom:8}}><strong>{p.sourceName}</strong> → {p.destinationName} · up to {USD(p.amount)} (unverified)</div>)}
      </section>}
      {eligiblePayments.length===0&&<p>No verified same-matter payments are available with the current trust and invoice data.</p>}
      <section style={{border:'1px solid #cbd5e1',borderRadius:8,padding:12,margin:'12px 0'}}>
        <strong>Same-matter trust payment approvals</strong>
        <p style={small}>Only existing outstanding invoices are eligible. These displayed balances are indications, not authorization. Mio will recalculate and ask you to confirm the actual amount before posting.</p>
        {rows.filter(m=>m.included&&m.workOB>0.005&&m.displayTrust>0.005).map(m=><div key={m.id} style={{padding:7,borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <label><input type="checkbox" checked={!ownPaymentExcluded.includes(m.id)} onChange={e=>setOwnPaymentExcluded(previous=>e.target.checked?previous.filter(id=>id!==m.id):[...new Set([...previous,m.id])])}/> {m.name}</label>
          <span style={small}>Work OB {USD(m.workOB)} · Displayed trust {USD(m.displayTrust)}</span>
        </div>)}
        {onPayOwnMatterTrust&&<button style={button} onClick={()=>{
          const ids=rows.filter(m=>m.included&&m.workOB>0.005&&m.displayTrust>0.005&&!ownPaymentExcluded.includes(m.id)).map(m=>m.id)
          if(ids.length)onPayOwnMatterTrust(ids)
          else setNotice('No approved matters have both existing Work OB and displayed trust.')
        }}>Review & confirm same-matter trust payments in Mio</button>}
        <p style={small}>Cross-matter payments are NOT included in this action. Individual invoice-level payments remain available in Mio's invoice detail workflow.</p>
      </section>
      {atomicEnabled&&<section style={{border:'2px solid #b91c1c',background:'#fef2f2',padding:12,borderRadius:8,margin:'12px 0'}}>
        <strong>Atomic trust posting (enabled)</strong>
        <p style={small}><strong>This records an accounting allocation in Mio's ledger only — it does not move bank funds.</strong> The physical trust-to-operating transfer is reconciled separately. The server re-verifies funds, identity, agreement and invoice state before posting, and a retry cannot double-post. Trust figures shown are advisory.</p>
        {atomicPlan.payments.length===0&&<p style={small}>No eligible invoice payments were found with the current advisory trust and invoice data.</p>}
        {atomicPlan.payments.map(p=>{
          const key=`${p.invoiceId}:${p.sourceMatterId}:${p.amountCents}`
          return <div key={key} style={{padding:7,borderBottom:'1px solid #fecaca',display:'flex',alignItems:'center',gap:10}}>
            <label><input type="checkbox" checked={atomicApprovals[key]!==false} onChange={e=>setAtomicApprovals(x=>({...x,[key]:e.target.checked}))}/> Approve</label>
            <span>{(rows.find(m=>m.id===p.sourceMatterId)?.name)||p.sourceMatterId} → {p.destinationMatterId===p.sourceMatterId?'own invoice':'cross-matter invoice'} · {USD(p.amountCents/100)}</span>
          </div>
        })}
        <p><strong>Total: {USD(atomicPlan.totalCents/100)}</strong></p>
        <button style={button} disabled={atomicBusy||atomicPlan.payments.length===0} onClick={()=>postAtomicTrustPayments().catch(error=>setAtomicNotice(error?.message||String(error)))}>Post approved trust payments (atomic)</button>
        {atomicNotice&&<p style={small}>{atomicNotice}</p>}
      </section>}
      {proposal.payments.map(p=><section key={p.id} style={{padding:10,margin:'9px 0',border:p.crossMatter?'2px solid #d97706':'1px solid #cbd5e1',borderRadius:8}}>
        <div><strong>{p.destinationName} — {USD(p.amount)}</strong>{p.crossMatter&&<strong style={{color:'#a16207'}}> · CROSS-MATTER</strong>}</div>
        <div style={small}>Funds from {p.sourceName} → invoice of {p.destinationName}</div>
        <label><input type="checkbox" checked={approvals[p.id]!==false} onChange={e=>setApprovals(x=>({...x,[p.id]:e.target.checked}))}/> Approve this payment for this run</label>
        <div style={{float:'right'}}>{[p.destinationMatterId,p.sourceMatterId].filter((x,i,a)=>a.indexOf(x)===i).map(id=>{
          const m=rows.find(x=>x.id===id)
          return <span key={id} style={{display:'inline-flex',gap:6,marginLeft:10}}><label style={small}><input type="checkbox" checked={m.included} onChange={e=>setMatter(id,'included',e.target.checked)}/> Billing</label><label style={small}><input type="checkbox" checked={m.shareTrust} onChange={e=>setMatter(id,'shareTrust',e.target.checked)}/> Share ({m.name})</label></span>
        })}</div><div style={{clear:'both'}}/>
      </section>)}
      <p><strong>Preview total: {USD(review.totalPayments)}</strong></p>
      <button style={button} onClick={()=>stageForReview().catch(error=>setNotice('Could not save prepared review: '+(error?.message||error)))} disabled={packetBusy||!invoicePacket}>Save prepared review (no postings)</button>
      {onOpenExistingWipReview&&invoicePacket?.length>0&&<button style={{...button,background:'#dbeafe',fontWeight:700}} disabled={packetBusy} onClick={()=>stageForReview().then(()=>onOpenExistingWipReview(invoicePacket.map(x=>x.matterId))).catch(error=>setNotice('Invoice handoff stopped: '+(error?.message||error)))}>Save review & open Mio invoice approval</button>}
      <button style={button} onClick={()=>setStep('unpaid')}>Review projected unpaid balances →</button>
    </>}
    {step==='unpaid'&&<>
      <h3>Projected unpaid balances — manual review</h3>
      <p style={small}>These projections include selected WIP that has not been invoiced. Withdrawal changes are not enabled in preview mode. No appointment-based withdrawal recommendation is made.</p>
      <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={cell}>Matter</th><th style={cell}>Projected unpaid</th><th style={cell}>Withdrawal status</th></tr></thead><tbody>{review.matters.filter(m=>m.included&&m.unpaid>0).map(m=>{
        const original=rows.find(x=>x.id===m.id)
        const status=original?.withdrawalStatus
        return <tr key={m.id} style={{background:status==='active'?'#fff1f2':'transparent'}}><td style={cell}><label><input type="checkbox" checked={withdrawSelected.includes(m.id)} disabled={m.appointed||status==='active'||status==='released'||status==='complete'||withdrawMarked.includes(m.id)} onChange={e=>setWithdrawSelected(current=>e.target.checked?[...new Set([...current,m.id])]:current.filter(id=>id!==m.id))}/> {m.name}</label></td><td style={cell}>{USD(m.unpaid)}</td><td style={cell}>{withdrawMarked.includes(m.id)?'Marked for withdrawal (administrative)':status==='active'?'Already in withdrawal':status==='released'?'Released — no active withdrawal':status==='complete'?'Completed':m.appointed?'Appointed — exempt':'Requires trust verification before any withdrawal action'}</td></tr>
      })}</tbody></table>
      {onMarkWithdrawals&&<section style={{marginTop:12,padding:12,border:'1px solid #cbd5e1',borderRadius:8}}>
        <p style={small}>Check matters individually, then confirm. Mio will recheck unpaid invoices, trust funds, client identity, sharing eligibility, and current withdrawal status. Matters without verified records will be skipped. This does not terminate representation.</p>
        <button style={button} disabled={withdrawBusy||!withdrawSelected.length} onClick={async()=>{
          setWithdrawBusy(true)
          try {
            const result=await onMarkWithdrawals(withdrawSelected)
            if(result?.updated){
              setWithdrawMarked(old=>[...new Set([...old,...(result.updatedIds||[])])])
              setWithdrawSelected([])
              setNotice(result.updated+' verified matter(s) flagged for withdrawal.'+(result.skipped?.length?' '+result.skipped.length+' skipped.':''))
            } else setNotice(result?.cancelled?'Withdrawal marking canceled.':'No withdrawal flags were changed.')
          }catch(error){setNotice('Withdrawal marking stopped: '+(error?.message||error))}
          finally{setWithdrawBusy(false)}
        }}>Mark selected matters for withdrawal</button>
      </section>}
    </>}
    {step==='settings'&&<>
      <h3>Weekly Billing Settings</h3>
      <label>Minimum WIP ($) <input type="number" min="0" value={settings.minimumWip??150} onChange={e=>setSettings(x=>({...x,minimumWip:e.target.value}))}/></label>
      <p style={small}>Appointed matters default to excluded. The filters below change which rows you see; they do not change saved billing preferences.</p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'start',margin:'14px 0'}}>
        <SettingsFilter title="Case status" choices={caseStatuses.map(value=>({value,label:value}))} selected={caseStatusFilter} onChange={setCaseStatusFilter}/>
        <SettingsFilter title="Matter status" choices={[{value:'__blank__',label:'No Matter Status'},...matterStatuses.map(value=>({value,label:value}))]} selected={matterStatusFilter} onChange={setMatterStatusFilter}/>
        <SettingsFilter title="Case type" choices={caseTypes.map(value=>({value,label:value}))} selected={caseTypeFilter} onChange={setCaseTypeFilter}/>
        <span style={small}>{visibleSettingsRows.length} of {rows.length} matters shown</span>
      </div>
      <div style={{margin:'10px 0',padding:10,border:'1px solid #b91c1c',borderRadius:8,background:'#fef2f2'}}>
        <label><input type="checkbox" checked={settings.enableAtomicWeeklyTrustPosting===true} onChange={e=>setSettings(x=>({...x,enableAtomicWeeklyTrustPosting:e.target.checked}))}/> <strong>Enable atomic trust posting (advanced; leave off)</strong></label>
        <p style={small}>This would let Mio record payments from trust against earned-fee invoices, including approved payments across matters. It does not transfer money between bank accounts. The posting function is currently unavailable, so leave this off. Choosing a primary matter or checking an agreement does not turn it on.</p>
      </div>
      <p style={small}>Primary trust matter controls which of a client's matters receives replenishment requests. Choose one when a client has multiple matters. It does not authorize using that trust to pay another matter's fees; the signed agreement and separate payment approval are still required. Primary selections save immediately; the other checkboxes save with “Save Billing Settings.”</p>
      {replenishmentError&&<p role="alert" style={{color:'#991b1b'}}>Primary matter settings: {replenishmentError}</p>}
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:1020}}><thead><tr>{['Client','Matter','Appointed','Weekly Billing','Share Trust','Primary trust matter','Cross-matter agreement verified'].map(x=><th style={cell} key={x}>{x}</th>)}</tr></thead><tbody>{visibleSettingsRows.map(m=><tr key={m.id}>
        <td style={cell}>{m.clientName}</td><td style={cell}>{m.name}</td>
        <td style={cell}><input aria-label={'Appointed '+m.name} type="checkbox" checked={m.appointed} onChange={e=>{setMatter(m.id,'appointed',e.target.checked);setChanges(prev=>({...prev,[m.id]:{...(prev[m.id]||{}),appointed:e.target.checked,included:!e.target.checked,shareTrust:!e.target.checked}}))}}/></td>
        <td style={cell}><input aria-label={'Billing '+m.name} type="checkbox" checked={m.included} onChange={e=>setMatter(m.id,'included',e.target.checked)}/></td>
        <td style={cell}><input aria-label={'Share trust '+m.name} type="checkbox" checked={m.shareTrust} onChange={e=>setMatter(m.id,'shareTrust',e.target.checked)}/></td>
        <td style={cell}>{(matterClientGroups.get(m.clientId)||[]).length>1?<input type="radio" name={'primary-trust-'+m.clientId} aria-label={'Primary trust matter for '+m.clientName+': '+m.name} checked={primaryForClient(m.clientId)===m.id} disabled={primarySaving||!!replenishmentError} onChange={()=>choosePrimary(m)}/>:<span style={small}>{m.clientId?'Only matter':'Client unknown'}</span>}</td>
        <td style={cell}><input aria-label={'Cross-matter fee agreement verified '+m.name} type="checkbox" checked={m.agreementAuthorized} onChange={e=>setMatter(m.id,'agreementAuthorized',e.target.checked)} title="Check only after reviewing the signed agreement and confirming it permits this matter's trust to pay another matter's earned fees."/></td>
      </tr>)}</tbody></table></div>
      <p><button style={button} onClick={save} disabled={!cloudReady}>Save Billing Settings</button></p>
    </>}
  </div>
}
