import React, {useMemo, useState} from 'react'
import {createWeeklyBillingProposal, weeklyBillingDefaults} from './mioWeeklyBillingModel.js'
const USD = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0)
const small={fontSize:12,color:'#64748b'}
const cell={padding:'8px 6px',textAlign:'left',borderBottom:'1px solid #e2e8f0'}
const button={padding:'7px 11px',border:'1px solid #94a3b8',borderRadius:7,background:'#fff',cursor:'pointer'}
const KEY='mio_weekly_billing_v1'
// Safely stage local preferences until a cloud-backed settings adapter is connected.
// No invoice creation, trust posting, or withdrawal mutations are exposed by this component.
export default function MioWeeklyBilling({matters=[],financeFor=()=>null,onClose=()=>{}}) {
  const [step,setStep]=useState('wip')
  const [settings,setSettings]=useState(()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return {}}})
  const [changes,setChanges]=useState({})
  const [approvals,setApprovals]=useState({})
  const [selected,setSelected]=useState(null)
  const [notice,setNotice]=useState('')
  const minimum=Number(settings.minimumWip??150)
  const rows=useMemo(()=>matters.map(m=>{
    const defaults=weeklyBillingDefaults(m)
    const f=financeFor(m)||{}
    const override=changes[String(m.id)]||settings.matters?.[String(m.id)]||{}
    // Never represent unknown balances as verified, available funds.
    const trust=Number.isFinite(Number(f.availableTrust))?Number(f.availableTrust):0
    const wip=Number.isFinite(Number(f.wip))?Number(f.wip):0
    const workOB=Number.isFinite(Number(f.workOB))?Number(f.workOB):0
    return {id:String(m.id),name:m.name||'Matter '+m.id, clientId:String(m.client_id||m.client?.id||''),
      appointed:override.appointed??defaults.appointed, included:override.included??defaults.included,
      shareTrust:override.shareTrust??defaults.shareTrust,
      wip,workOB,availableTrust:trust,oldestInvoiceDate:f.oldestInvoiceDate||'',unverified:!f.verified}
  }),[matters,financeFor,changes,settings])
  const eligibility=useMemo(()=>rows.filter(m=>m.included),[rows])
  const proposal=useMemo(()=>createWeeklyBillingProposal({matters:rows,minimumWip:minimum,selectedIds:selected,authorizations:{}}),[rows,minimum,selected])
  const setMatter=(id,field,value)=>setChanges(old=>({...old,[id]:{...(old[id]||settings.matters?.[id]||{}),[field]:value}}))
  const save=()=>{
    const next={...settings,matters:{...(settings.matters||{}),...changes}}
    localStorage.setItem(KEY,JSON.stringify(next));setSettings(next);setChanges({});setNotice('Saved in this browser only. Cloud synchronization is not yet connected.')
  }
  const first=rows.filter(r=>r.included&&r.wip>=minimum).map(r=>r.id)
  const chosen=selected??first
  const eligiblePayments=proposal.payments.filter(p=>approvals[p.id]!==false)
  return <div role="dialog" aria-label="Weekly Billing Review" style={{position:'fixed',inset:18,zIndex:100000,background:'#fff',color:'#13263d',border:'2px solid #94a3b8',borderRadius:12,boxShadow:'0 24px 70px #0005',overflow:'auto',padding:20}}>
    <header style={{display:'flex',gap:15,justifyContent:'space-between',alignItems:'center',flexWrap:'wrap'}}>
      <div><h2 style={{margin:'0 0 3px'}}>Weekly Billing — Review Workspace</h2><div style={small}>Safe preview mode · No invoices or trust payments will be posted</div></div>
      <button style={button} onClick={onClose}>Close ×</button>
    </header>
    <nav style={{display:'flex',gap:8,flexWrap:'wrap',margin:'18px 0'}}>
      {['wip','payments','unpaid','settings'].map((s,i)=><button key={s} style={{...button,background:step===s?'#dbeafe':'white',fontWeight:step===s?700:400}} onClick={()=>setStep(s)}>{i+1}. {({wip:'WIP Review',payments:'Payment Preview',unpaid:'Unpaid Balances',settings:'Settings'})[s]}</button>)}
    </nav>
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
      <button style={button} onClick={()=>setStep('payments')}>Continue to payment preview →</button>
    </>}
    {step==='payments'&&<>
      <h3>Proposed trust payments</h3>
      <p style={small}>Cross-matter payments are intentionally blocked until a verified authorization and available-balance adapter is connected. Nothing can be executed from this preview.</p>
      {eligiblePayments.length===0&&<p>No verified payment proposals are available.</p>}
      {proposal.payments.map(p=><section key={p.id} style={{padding:10,margin:'9px 0',border:p.crossMatter?'2px solid #d97706':'1px solid #cbd5e1',borderRadius:8}}>
        <div><strong>{p.destinationName} — {USD(p.amount)}</strong>{p.crossMatter&&<strong style={{color:'#a16207'}}> · CROSS-MATTER</strong>}</div>
        <div style={small}>Funds from {p.sourceName} → invoice of {p.destinationName}</div>
        <label><input type="checkbox" checked={approvals[p.id]!==false} onChange={e=>setApprovals(x=>({...x,[p.id]:e.target.checked}))}/> Approve this payment for this run</label>
        <div style={{float:'right'}}>{[p.destinationMatterId,p.sourceMatterId].filter((x,i,a)=>a.indexOf(x)===i).map(id=>{
          const m=rows.find(x=>x.id===id)
          return <span key={id} style={{display:'inline-flex',gap:6,marginLeft:10}}><label style={small}><input type="checkbox" checked={m.included} onChange={e=>setMatter(id,'included',e.target.checked)}/> Billing</label><label style={small}><input type="checkbox" checked={m.shareTrust} onChange={e=>setMatter(id,'shareTrust',e.target.checked)}/> Share ({m.name})</label></span>
        })}</div><div style={{clear:'both'}}/>
      </section>)}
      <p><strong>Preview total: {USD(eligiblePayments.reduce((n,p)=>n+p.amount,0))}</strong></p>
      <button style={button} onClick={()=>setStep('unpaid')}>Review unpaid balances →</button>
    </>}
    {step==='unpaid'&&<>
      <h3>Unpaid Work OB — manual review</h3>
      <p style={small}>Withdrawal changes are not enabled in preview mode. No appointment-based withdrawal recommendation is made.</p>
      <table style={{width:'100%',borderCollapse:'collapse'}}><tbody>{proposal.matters.filter(m=>m.included&&m.unpaid>0).map(m=><tr key={m.id}><td style={cell}>{m.name}</td><td style={cell}>{USD(m.unpaid)}</td><td style={cell}>{m.appointed?'Appointed — excluded from withdrawal automation':'Review before withdrawal status'}</td></tr>)}</tbody></table>
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
      <p><button style={button} onClick={save}>Save browser-only draft settings</button></p>
    </>}
  </div>
}
