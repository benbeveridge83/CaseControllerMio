import React, {useEffect, useMemo, useState} from 'react'
import {createWeeklyBillingProposal, weeklyBillingDefaults, reconcileWeeklyBillingReview, possibleCrossMatterFunding} from './mioWeeklyBillingModel.js'
import {loadWeeklyBillingReadOnly} from './mioWeeklyBillingData.js'
const USD = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0)
const small={fontSize:12,color:'#64748b'}
const cell={padding:'8px 6px',textAlign:'left',borderBottom:'1px solid #e2e8f0'}
const button={padding:'7px 11px',border:'1px solid #94a3b8',borderRadius:7,background:'#fff',cursor:'pointer'}
const KEY='mioWeeklyBillingSettingsV1'
// Safely stage local preferences until a cloud-backed settings adapter is connected.
// No invoice creation, trust posting, or withdrawal mutations are exposed by this component.
export default function MioWeeklyBilling({matters=[],financeFor=()=>null,supabase=null,userId='',initialStep='wip',onClose=()=>{}}) {
  const [step,setStep]=useState(initialStep)
  const [settings,setSettings]=useState({})
  const [changes,setChanges]=useState({})
  const [approvals,setApprovals]=useState({})
  const [selected,setSelected]=useState(null)
  const [notice,setNotice]=useState('')
  const [cloudReady,setCloudReady]=useState(false)
  const [cloudError,setCloudError]=useState('')
  const [financeSnapshot,setFinanceSnapshot]=useState(null)
  const [financeError,setFinanceError]=useState('')
  const [financeLoading,setFinanceLoading]=useState(true)
  const refreshFinancialSnapshot=async()=>{
    if(!supabase||!userId){setFinanceError('Login required to read financial records.');setFinanceLoading(false);return}
    setFinanceLoading(true);setFinanceError('')
    try {const current=await loadWeeklyBillingReadOnly(supabase,userId);setFinanceSnapshot(current)}
    catch(error){setFinanceSnapshot(null);setFinanceError(error?.message||String(error))}
    finally{setFinanceLoading(false)}
  }
  useEffect(()=>{refreshFinancialSnapshot()},[supabase,userId])
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
  const rows=useMemo(()=>matters.map(m=>{
    const defaults=weeklyBillingDefaults(m)
    const f=financeFor(m)||{}
    const override=changes[String(m.id)]||settings.matters?.[String(m.id)]||{}
    // Never represent unknown balances as verified, available funds.
    const trust=Number.isFinite(Number(f.availableTrust))?Number(f.availableTrust):0
    const wip=financeSnapshot?.wipByMatter?.[String(m.id)]??0
    const workOB=financeSnapshot?.workOBByMatter?.[String(m.id)]??0
    return {id:String(m.id),name:m.name||'Matter '+m.id, clientId:String(m.client_id||m.client?.id||''),withdrawalStatus:financeSnapshot?.withdrawalByMatter?.[String(m.id)]||'',
      appointed:override.appointed??defaults.appointed, included:override.included??defaults.included,
      shareTrust:override.shareTrust??defaults.shareTrust,
      wip,workOB,availableTrust:trust,displayTrust:Number(f.displayTrust)||0,oldestInvoiceDate:financeSnapshot?.oldestByMatter?.[String(m.id)]||'',unverified:!financeSnapshot}
  }),[matters,financeFor,changes,settings,financeSnapshot])
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
  const chosen=selected??first
  const review=reconcileWeeklyBillingReview(proposal,Object.entries(approvals).filter(([,value])=>value===false).map(([id])=>id))
  const suggestions=possibleCrossMatterFunding(rows.map(m=>({...m,selectedWip:chosen.includes(m.id)?m.wip:0})))
  const eligiblePayments=review.payments
  return <div role="dialog" aria-label="Weekly Billing Review" style={{position:'fixed',inset:18,zIndex:100000,background:'#fff',color:'#13263d',border:'2px solid #94a3b8',borderRadius:12,boxShadow:'0 24px 70px #0005',overflow:'auto',padding:20}}>
    <header style={{display:'flex',gap:15,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}>
      <div><h2 style={{margin:'0 0 3px'}}>Weekly Billing — Review Workspace</h2><div style={small}>Safe preview mode · No invoices or trust payments will be posted · Appointed matters excluded by default</div></div>
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
      <button style={button} onClick={()=>setStep('payments')} disabled={!financeSnapshot||financeLoading}>Continue to payment preview →</button> <button style={button} onClick={refreshFinancialSnapshot}>Refresh financial records</button>
    </>}
    {step==='payments'&&<>
      <h3>Proposed trust payments</h3>
      <p style={small}>Cross-matter payments are intentionally blocked until a verified authorization and available-balance adapter is connected. Nothing can be executed from this preview.</p>
      {suggestions.length>0&&<section style={{border:'1px solid #d97706',background:'#fffbeb',padding:12,borderRadius:8,marginBottom:12}}>
        <strong>Possible cross-matter sharing — NOT authorized or payable yet</strong>
        <p style={small}>These amounts use displayed trust balances only. Funds, agreement authorization, and all outstanding obligations must be verified before any payout.</p>
        {suggestions.map(p=><div key={p.id} style={{marginBottom:8}}><strong>{p.sourceName}</strong> → {p.destinationName} · up to {USD(p.amount)} (unverified)</div>)}
      </section>}
      {eligiblePayments.length===0&&<p>No verified payments available. Trust balances are deliberately unavailable until the live trust-availability integration is tested.</p>}
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
      <button style={button} onClick={()=>setStep('unpaid')}>Review unpaid balances →</button>
    </>}
    {step==='unpaid'&&<>
      <h3>Projected unpaid balances — manual review</h3>
      <p style={small}>These projections include selected WIP that has not been invoiced. Withdrawal changes are not enabled in preview mode. No appointment-based withdrawal recommendation is made.</p>
      <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={cell}>Matter</th><th style={cell}>Projected unpaid</th><th style={cell}>Withdrawal status</th></tr></thead><tbody>{review.matters.filter(m=>m.included&&m.unpaid>0).map(m=>{
        const original=rows.find(x=>x.id===m.id)
        const status=original?.withdrawalStatus
        return <tr key={m.id} style={{background:status==='active'?'#fff1f2':'transparent'}}><td style={cell}>{m.name}</td><td style={cell}>{USD(m.unpaid)}</td><td style={cell}>{status==='active'?'Already in withdrawal':status==='released'?'Released — no active withdrawal':status==='complete'?'Completed':m.appointed?'Appointed — exempt':'Requires trust verification before any withdrawal action'}</td></tr>
      })}</tbody></table>
    </>}
    {step==='settings'&&<>
      <h3>Weekly Billing Settings</h3>
      <label>Minimum WIP ($) <input type="number" min="0" value={settings.minimumWip??150} onChange={e=>setSettings(x=>({...x,minimumWip:e.target.value}))}/></label>
      <p style={small}>Appointed cases default to excluded. The checkbox columns are synchronized within this workspace.</p>
      <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr>{['Matter','Appointed','Weekly Billing','Share Trust'].map(x=><th style={cell} key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(m=><tr key={m.id}><td style={cell}>{m.name}</td>
        <td style={cell}><input aria-label={'Appointed '+m.name} type="checkbox" checked={m.appointed} onChange={e=>{setMatter(m.id,'appointed',e.target.checked);setChanges(prev=>({...prev,[m.id]:{...(prev[m.id]||{}),appointed:e.target.checked,included:!e.target.checked,shareTrust:!e.target.checked}}))}}/></td>
        <td style={cell}><input aria-label={'Billing '+m.name} type="checkbox" checked={m.included} onChange={e=>setMatter(m.id,'included',e.target.checked)}/></td>
        <td style={cell}><input aria-label={'Share trust '+m.name} type="checkbox" checked={m.shareTrust} onChange={e=>setMatter(m.id,'shareTrust',e.target.checked)}/></td>
      </tr>)}</tbody></table>
      <p><button style={button} onClick={save} disabled={!cloudReady}>Save Billing Settings</button></p>
    </>}
  </div>
}
