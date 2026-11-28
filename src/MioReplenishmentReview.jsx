import React, {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {calculateTrustReplenishment, invoiceOutstanding, recentTrustHistory} from './mioTrustReplenishmentCalculations.js'
import MioReplenishmentEmailSections from './MioReplenishmentEmailSections.jsx'
import {replenishmentActionCategories} from './mioReplenishmentActions.js'
import {REPLENISHMENT_TABS} from './mioReplenishmentTabs.js'
const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value)||0)
const getNumber = (...values) => { for (const v of values) if(v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) return Number(v); return null }
const dateLabel = value => value ? new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'Date unavailable'
const locked = row => ['sent','sending','blocked','uncertain','error'].includes(row.send_status)
const normalizeFilter = value => String(value??'').trim()
const filterOptions = (rows,field) => [...new Set(rows.map(row=>normalizeFilter(row[field])).filter(Boolean))].sort((a,b)=>a.localeCompare(b))
const defaultFilters = () => ({case_status:'',matter_status:'',case_type:''})

export default function MioReplenishmentReview({review,busy,onClose,onUpdate,onSend,onRecheckLawPay,onPreview,onConnect,connected,onSetEligibility,onFlagWithdrawal,onUpdateLimits}) {
  const closeRef=useRef(null)
  const [selectedId,setSelectedId]=useState(null)
  const [tab,setTab]=useState('overview')
  const [listTab,setListTab]=useState('eligible')
  const [filtersByTab,setFiltersByTab]=useState({eligible:defaultFilters(),excluded:defaultFilters(),above:defaultFilters()})
  const [confirmIds,setConfirmIds]=useState(null)
  useEffect(()=>{if(!review.open)return;const prior=document.activeElement;closeRef.current?.focus();return()=>prior?.focus?.()},[review.open])
  if(!review.open)return null
  const allRows=review.rows||[]
  const tabRows=allRows.filter(row=>(row.review_tab||'eligible')===listTab)
  const filters=filtersByTab[listTab]||defaultFilters()
  const rows=tabRows.filter(row=>Object.entries(filters).every(([field,chosen])=>!chosen||normalizeFilter(row[field])===chosen))
  const ready=rows.filter(row=>row.included&&!locked(row)&&(!row.appointed_status_unknown||row.non_appointed_confirmed===true)&&(Number(row.amount||0)>0||(row.prior_trust_invoices||[]).length>0||(row.unpaid_work_invoices||[]).length>0))
  const confirmRows=confirmIds===null?[]:ready.filter(row=>confirmIds.includes(String(row.id)))
  const failedRows=rows.filter(row=>['error','uncertain'].includes(row.send_status))
  const selectedTotal=ready.reduce((sum,row)=>sum+Number(row.amount||0),0)
  const filterActive=Object.values(filters).some(Boolean)
  const setFilter=(field,value)=>{setConfirmIds(null);setSelectedId(null);setFiltersByTab(old=>({...old,[listTab]:{...(old[listTab]||defaultFilters()),[field]:value}}))}
  const showConfirmation=ids=>setConfirmIds(ids.map(String))
  return createPortal(<div style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(15,23,42,.6)',padding:20,display:'grid',placeItems:'center'}}>
    <section role="dialog" aria-modal="true" aria-labelledby="replenishment-review-title" style={{background:'#fff',borderRadius:12,padding:20,width:'min(1440px,97vw)',maxHeight:'94vh',overflow:'auto'}} onKeyDown={event=>{
      if(event.key==='Escape'&&!busy)onClose()
      if(event.key==='Tab'){const focusable=[...event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    }}>
      <header style={{display:'flex',justifyContent:'space-between',alignItems:'start',gap:12,flexWrap:'wrap'}}>
        <div><h2 id="replenishment-review-title" style={{margin:'0 0 6px'}}>Replenishment Review</h2><p style={{margin:'0 0 6px',color:'#475569',fontSize:13}}>1. Choose a tab and filters. 2. Check the matters to include. 3. Click <strong>Next: Review Selected</strong>.</p></div>
        <div style={{display:'flex',gap:10,alignItems:'center',marginLeft:'auto'}}>
          <button type="button" disabled={busy||review.loading||!ready.length||!!review.sendingDisabledReason} onClick={()=>showConfirmation(ready.map(row=>row.id))}
            style={{background:!ready.length||review.sendingDisabledReason?'#cbd5e1':'#1d4ed8',color:'#fff',border:0,borderRadius:8,padding:'12px 17px',fontWeight:750,fontSize:14,cursor:ready.length&&!review.sendingDisabledReason?'pointer':'not-allowed'}}>Next: Review Selected ({ready.length}) →</button>
          <button ref={closeRef} type="button" disabled={busy} onClick={onClose} style={{padding:'9px 12px'}}>Close</button>
        </div>
      </header>
      <div role="status" aria-live="polite" style={review.sendingDisabledReason?{background:'#fff7ed',border:'1px solid #fdba74',borderRadius:7,padding:12,color:'#9a3412',fontWeight:600}:undefined}>{review.loading?'Loading current invoices...':review.message}</div>
      {(review.sendingDisabledReason||review.recheckStatus)&&<div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',margin:'10px 0'}}>
        <button type="button" disabled={busy||review.recheckStatus==='checking'} onClick={onRecheckLawPay}
          style={{padding:'10px 14px',background:'#1d4ed8',color:'#fff',border:0,borderRadius:7,fontWeight:700}}>
          {review.recheckStatus==='checking'?'Checking LawPay…':'Recheck LawPay (no sending)'}
        </button>
        <span style={{fontSize:12,color:'#475569'}}>This fetches new transactions and recalculates the audit. It does not create invoices, move funds or send emails.</span>
      </div>}
      {review.error&&<p role="alert">{review.error}</p>}
      {!!failedRows.length&&<section role="alert" style={{background:'#fff7ed',border:'1px solid #fdba74',borderRadius:8,padding:'12px 14px',margin:'12px 0'}}>
        <strong style={{color:'#9a3412'}}>{failedRows.length} matter{failedRows.length===1?'':'s'} need attention in this tab</strong>
        <p style={{fontSize:12,margin:'5px 0 8px'}}>These were not confirmed sent. Resolve the specific error and refresh the review before trying again. A delivery marked uncertain must be checked against Sent Items and invoice history first.</p>
        <ul style={{fontSize:12,margin:'4px 0',paddingLeft:18}}>
          {failedRows.map(row=><li key={row.id} style={{marginBottom:4}}><strong>{row.client_name}:</strong> {row.send_error||row.reason||'No detailed error was recorded; reopen review and inspect financial verification.'}</li>)}
        </ul>
      </section>}
      <nav aria-label="Replenishment matter groups" style={{display:'flex',gap:8,marginTop:14,marginBottom:4,flexWrap:'wrap',borderBottom:'1px solid #cbd5e1',paddingBottom:10}}>
        {REPLENISHMENT_TABS.map(item=>{
          const tabFilters=filtersByTab[item.id]||defaultFilters()
          const count=allRows.filter(row=>(row.review_tab||'eligible')===item.id&&Object.entries(tabFilters).every(([field,chosen])=>!chosen||normalizeFilter(row[field])===chosen)).length
          return <button key={item.id} type="button" aria-current={listTab===item.id?'page':undefined}
            onClick={()=>{setListTab(item.id);setSelectedId(null);setTab('overview');setConfirmIds(null)}}
            style={{border:'1px solid #cbd5e1',borderRadius:8,padding:'9px 13px',background:listTab===item.id?'#dbeafe':'white',fontWeight:listTab===item.id?700:500,cursor:'pointer'}}>{item.label} ({count})</button>
        })}
      </nav>
      <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'end',background:'#f8fafc',padding:'12px 14px',border:'1px solid #e2e8f0',borderRadius:9,marginTop:10}}>
        {[
          ['case_status','Case Status'],['matter_status','Matter Status'],['case_type','Case Type']
        ].map(([field,label])=><label key={field} style={{display:'grid',gap:4,minWidth:175,flex:'1 1 175px',fontSize:12,fontWeight:600,color:'#334155'}}>
          {label}
          <select aria-label={label+' filter'} value={filters[field]||''} onChange={e=>setFilter(field,e.target.value)}
            style={{fontSize:13,padding:'8px 9px',border:'1px solid #94a3b8',background:'white',borderRadius:6,color:'#0f172a'}}>
            <option value="">All {label.toLowerCase()}es</option>
            {filterOptions(tabRows,field).map(value=><option key={value} value={value}>{value}</option>)}
          </select>
        </label>)}
        <button type="button" onClick={()=>{setFiltersByTab(old=>({...old,[listTab]:defaultFilters()}));setConfirmIds(null)}} disabled={!filterActive} style={{padding:'9px 12px',border:'1px solid #cbd5e1',borderRadius:7,background:'#fff'}}>Clear filters</button>
        <span style={{fontSize:12,color:'#475569',marginLeft:'auto'}}>{rows.length} of {tabRows.length} matters shown</span>
      </div>
      {listTab==='excluded'&&<p style={{fontSize:12,color:'#475569',margin:'8px 0'}}>These matters are below minimum but not automatically selected. The Reason column explains why. Check an allowed matter for a one-time request up to its target; permanent settings do not change.</p>}
      {listTab==='above'&&<p style={{fontSize:12,color:'#475569',margin:'8px 0'}}>These matters are at or above minimum and are unchecked by default. You may select one for a one-time request toward its target. If trust already meets the target, no additional trust invoice is due.</p>}
      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',padding:'12px 0'}}>
        <span style={{fontWeight:650,fontSize:13}}>Selected in this view: {ready.length}</span>
        <strong>New trust requests selected: {money(selectedTotal)}</strong>
        {!connected&&<button type="button" onClick={onConnect} disabled={busy}>Connect Microsoft</button>}
      </div>

      <div style={{overflowX:'auto',border:'1px solid #cbd5e1',borderRadius:10}}>
        <table style={{width:'100%',minWidth:1120,borderCollapse:'collapse',fontSize:13}}>
          <thead style={{background:'#f1f5f9',color:'#475569'}}><tr>{['Select','Client / Matter','Current Trust','Minimum','Target','Previous Due','New Request',...(listTab==='excluded'?['Why not replenished']:[]),'Action',''].map(h=><th key={h} style={{padding:'11px 8px',textAlign:h==='Client / Matter'||h==='Action'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((row,index)=>{
            const old=(row.prior_trust_invoices||[]).reduce((sum,inv)=>sum+invoiceOutstanding(inv),0)
            const amount=Number(row.amount||0)
            const actions=replenishmentActionCategories(row)
            const status=row.send_status==='sent'?'Sent':row.send_status==='blocked'?'Blocked':row.send_status==='uncertain'?'Verify delivery':row.send_status==='error'?'Needs attention':row.send_status==='sending'?'Sending':null
            return <tr key={row.id} style={{borderTop:'1px solid #e2e8f0',background:row.withdrawal_flagged?'#fff1f2':selectedId===row.id?'#eff6ff':index%2?'#f8fafc':'white'}}>
              <td style={{padding:8,textAlign:'right'}}><input type="checkbox" aria-label={`Include ${row.client_name}`} checked={!!row.included} disabled={busy||locked(row)||(listTab!=='eligible'&&!row.one_off_allowed)} title={!row.one_off_allowed&&listTab!=='eligible'?'Court-appointed or closed matters cannot be manually included':undefined} onChange={e=>onUpdate(row.id,{included:e.target.checked})}/></td>
              <td style={{padding:8}}><strong>{row.client_name}</strong><div style={{color:'#64748b',fontSize:11}}>{row.matter_name}</div></td>
              <td style={{padding:8,textAlign:'right',whiteSpace:'nowrap'}}>{getNumber(row.current_trust,row.trust_balance)===null?'—':money(row.current_trust??row.trust_balance)}</td>
              <td style={{padding:8,textAlign:'right'}}>{money(row.minimum_trust)}</td>
              <td style={{padding:8,textAlign:'right'}}>{money(row.target_trust)}</td>
              <td style={{padding:8,textAlign:'right',fontWeight:600}}>{money(old)}</td>
              <td style={{padding:8,textAlign:'right',fontWeight:700}}>{money(amount)}</td>
              {listTab==='excluded'&&<td style={{padding:8,maxWidth:240,fontSize:12,color:'#92400e'}}>{row.exclusion_reason||row.reason||'Not automatically eligible'}</td>}
              <td style={{padding:8,minWidth:130}}><div style={{display:'flex',flexDirection:'column',gap:3}}>{status&&<strong title={row.send_error||row.reason||'Open Details for review status'} style={{color:status==='Blocked'||status==='Needs attention'||status==='Verify delivery'?'#9f1239':'#334155',fontSize:11}}>{status}</strong>}{['error','uncertain'].includes(row.send_status)&&<span style={{color:'#9a3412',fontSize:11,lineHeight:1.35,maxWidth:240,overflowWrap:'anywhere'}}>{row.send_error||'Review invoice and email history before retrying.'}</span>}{actions.map(label=><span key={label} style={{display:'block',color:label==='New trust invoice'?'#166534':'#334155',fontSize:12,lineHeight:'17px'}}>{label}</span>)}{!actions.length&&!status&&<span style={{color:'#64748b'}}>No invoices</span>}</div></td>
              <td style={{padding:8}}><button type="button" onClick={()=>{setSelectedId(current=>current===row.id?null:row.id);setTab('overview')}} style={{border:'1px solid #94a3b8',borderRadius:7,padding:'7px 11px',background:selectedId===row.id?'#dbeafe':'white',cursor:'pointer'}}>{selectedId===row.id?'Hide':'Details'}</button></td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {selectedId===null&&rows.length>0&&<p style={{color:'#64748b',fontSize:13}}>Click Details for a matter to see its invoice history, edit its email or change trust settings.</p>}
      {rows.filter(row=>row.id===selectedId).map(row=><section key={row.id} aria-label={`Replenishment for ${row.client_name}`} style={{border:'2px solid #94a3b8',borderRadius:10,padding:16,marginTop:14,background:row.withdrawal_flagged?'#fff1f2':'#fff'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',flexWrap:'wrap'}}>
          <div><label><input type="checkbox" aria-label={`Include ${row.client_name}`} checked={!!row.included} disabled={busy||locked(row)||(listTab!=='eligible'&&!row.one_off_allowed)} title={!row.one_off_allowed&&listTab!=='eligible'?'Court-appointed or closed matters cannot be manually included':undefined} onChange={e=>onUpdate(row.id,{included:e.target.checked})}/> <strong>{row.client_name}</strong></label><div>{row.matter_name} {row.matter_number}</div><small>{row.invoice?.invoice_number||'Invoice number assigned on approval'}</small></div>
          <div><strong>{row.send_status==='sent'?'Sent':row.send_status==='uncertain'?'Delivery needs verification':row.send_status==='blocked'?'Skipped':row.send_status==='sending'?'Sending...':row.send_status==='error'?'Needs correction':'Ready for review'}</strong><div>{money(row.amount)}</div></div>
        </div>
        <nav style={{display:'flex',gap:8,marginTop:12,marginBottom:10,paddingBottom:8,borderBottom:'1px solid #cbd5e1'}} aria-label="Matter detail sections">
          {[['overview','Balances & Settings'],['history','Invoice History'],['email','Email & Approval']].map(([key,name])=><button type="button" key={key} onClick={()=>setTab(key)} aria-current={tab===key?'page':undefined} style={{borderRadius:6,border:'1px solid #cbd5e1',background:tab===key?'#dbeafe':'white',fontWeight:tab===key?700:400,padding:'8px 12px'}}>{name}</button>)}
        </nav>
        {(()=>{ 
  const trust=getNumber(row.current_trust,row.trust_balance);
  const min=getNumber(row.minimum_trust,row.minimum_trust_balance);
  const target=getNumber(row.target_trust,row.target_trust_balance);
  const old=row.prior_trust_invoices||[];
  const work=row.unpaid_work_invoices||[];
  const priorTotal=old.reduce((n,i)=>n+invoiceOutstanding(i),0);
  const workTotal=work.reduce((n,i)=>n+invoiceOutstanding(i),0);
  const suggested=trust===null||target===null?null:calculateTrustReplenishment({currentTrust:trust,targetTrust:target,priorTrustInvoices:old});
  const history=recentTrustHistory(old);
  const historyBase=Date.now()-60*86400000;
  return <div style={{marginTop:10}}>
    {tab==='overview'&&<>    <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center',marginBottom:8}}>
      <small>Current trust: <strong>{trust===null?'Unavailable':money(trust)}</strong></small>
      <small>Minimum: <strong>{min===null?'Unavailable':money(min)}</strong></small>
      <small>Target: <strong>{target===null?'Unavailable':money(target)}</strong></small>
      {onSetEligibility&&<label style={{fontSize:12}} title="Persistently exclude this matter from future replenishment runs"><input type="checkbox" checked={row.replenishment_enabled!==false} disabled={busy||locked(row)} onChange={e=>onSetEligibility(row.id,e.target.checked)}/> Enabled</label>}
      {row.appointed_status_unknown&&<label style={{fontSize:12,color:'#92400e'}} title="Temporary confirmation until the shared Appointed matter setting is available"><input type="checkbox" checked={row.non_appointed_confirmed===true} disabled={busy||locked(row)} onChange={e=>onUpdate(row.id,{non_appointed_confirmed:e.target.checked})}/> I confirm this matter is not court-appointed (this run only)</label>}
      {onFlagWithdrawal&&<button type="button" disabled={busy} onClick={()=>onFlagWithdrawal(row.id,!row.withdrawal_flagged)}>{row.withdrawal_flagged?'Remove withdrawal review flag':'Flag for withdrawal review'}</button>}
      {row.withdrawal_flagged&&<small style={{color:'#9f1239',fontWeight:700}}>Withdrawal review flagged</small>}
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8,padding:10,background:'#f8fafc',borderRadius:8}}>
      <div><small>Unpaid work invoices</small><div><strong>{money(workTotal)}</strong></div></div>
      <div><small>Earlier trust invoices due</small><div><strong>{money(priorTotal)}</strong></div></div>
      <div><small>New trust request</small><div><strong>{money(row.amount)}</strong>{suggested!==null&&old.length>0&&<small style={{display:'block'}}>Calculated: {money(suggested)}</small>}</div></div>
      <div><small>All obligations</small><div><strong>{money(workTotal+priorTotal+Number(row.amount||0))}</strong></div></div>
    </div>
    {onUpdateLimits&&<div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:10}}>
      <label style={{fontSize:12}}>Minimum trust <input style={{width:115}} type="number" min="0" step=".01" defaultValue={min??''} disabled={busy||locked(row)} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==min)onUpdateLimits(row.id,{minimum_trust:Number(e.target.value)})}}/></label>
      <label style={{fontSize:12}}>Target trust <input style={{width:115}} type="number" min="0" step=".01" defaultValue={target??''} disabled={busy||locked(row)} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==target)onUpdateLimits(row.id,{target_trust:Number(e.target.value)})}}/></label>
    </div>}
    </>}
    {tab==='history'&&    <details style={{marginTop:10}}>
      <summary>Prior 60 days — {history.length} replenishment invoice{history.length===1?'':'s'}</summary>
      {history.length?<><div aria-label="Trust replenishment invoice timeline, last 60 days" style={{position:'relative',height:23,margin:'16px 8px 8px',borderTop:'2px solid #cbd5e1'}}>{history.map((invoice,i)=>{const date=new Date(invoice.sent_at||invoice.issued_at||invoice.created_at).getTime();const left=Math.max(0,Math.min(100,(date-historyBase)/(60*86400000)*100));return <span key={invoice.id||i} title={`${dateLabel(invoice.sent_at||invoice.issued_at||invoice.created_at)}: ${money(invoice.amount)} invoiced, ${money(invoice.paid_amount)} paid, trust then ${invoice.trust_at_issue==null?'unavailable':money(invoice.trust_at_issue)}`} style={{position:'absolute',left:left+'%',top:-7,width:12,height:12,borderRadius:'50%',background:'#64748b',border:'2px solid white',boxShadow:'0 0 0 1px #64748b'}}/>})}</div><div style={{overflowX:'auto'}}><table style={{width:'100%',fontSize:12,marginTop:8}}><thead><tr><th align="left">Sent</th><th align="right">Trust then</th><th align="right">Original</th><th align="right">Paid</th><th align="right">Still due</th></tr></thead><tbody>{history.map((invoice,i)=><tr key={invoice.id||i}><td>{dateLabel(invoice.sent_at||invoice.issued_at||invoice.created_at)}</td><td align="right">{invoice.trust_at_issue==null?'—':money(invoice.trust_at_issue)}</td><td align="right">{money(invoice.amount)}</td><td align="right">{money(invoice.paid_amount)}</td><td align="right">{money(invoiceOutstanding(invoice))}</td></tr>)}</tbody></table></div></>:<p style={{fontSize:12}}>No invoice history available for the last 60 days. Historical balances require a saved issuance snapshot.</p>}
    </details>}
  </div>
})()}
        {tab==='overview'&&row.send_status==='blocked'&&row.reason&&<p role="status" style={{fontSize:12,color:'#9f1239',marginTop:10}}><strong>Needs attention:</strong> {row.reason}</p>}
        {tab==='email'&&<>
        {Number(row.amount||0)<=0&&(row.prior_trust_invoices||[]).length>0&&<p style={{fontSize:12,color:'#92400e'}}>No additional trust invoice is needed. Approval sends a reminder listing the unpaid invoices; no new invoice is created.</p>}
        <MioReplenishmentEmailSections row={row}/>
        {row.reason&&<p>{row.reason}</p>}
        {row.send_error&&<p role="alert" style={{color:'#b91c1c'}}>{row.send_error}</p>}
        {row.send_status!=='blocked'&&<>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:10,marginTop:10}}>
            <label>Request amount<input aria-label={`Request amount for ${row.client_name}`} type="number" min="0.01" step="0.01" value={row.amount} disabled={busy||locked(row)||!!row.invoice?.payment_request_id} onChange={e=>onUpdate(row.id,{amount:e.target.value})}/></label>
            <label>Recipient<input aria-label={`Recipient for ${row.client_name}`} type="email" value={row.recipient_email} disabled={busy||locked(row)} onChange={e=>onUpdate(row.id,{recipient_email:e.target.value})}/></label>
            <label>From<input value={row.sender_email} readOnly/></label>
          </div>
          <label style={{display:'grid',gap:4,marginTop:10}}>Subject<input aria-label={`Subject for ${row.client_name}`} value={row.subject} disabled={busy||locked(row)} onChange={e=>onUpdate(row.id,{subject:e.target.value})}/></label>
          <label style={{display:'grid',gap:4,marginTop:10}}>Message<textarea aria-label={`Message for ${row.client_name}`} rows={4} value={row.message} disabled={busy||locked(row)} onChange={e=>onUpdate(row.id,{message:e.target.value})}/></label>
          <p style={{fontSize:12}}>The email includes the trust-request PDF and a secure LawPay Trust/IOLTA payment link. [invoice number] and [amount] are filled from the approved request.</p>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" disabled={busy} onClick={()=>onPreview(row)}>Preview PDF</button><button type="button" className="btnPrimary" disabled={busy||!!review.sendingDisabledReason||locked(row)||(row.appointed_status_unknown&&row.non_appointed_confirmed!==true)||(Number(row.amount||0)<=0&&!(row.prior_trust_invoices||[]).length&&!(row.unpaid_work_invoices||[]).length)} onClick={()=>showConfirmation([row.id])}>{Number(row.amount||0)>0?'Next: Review Request':'Next: Review Reminder'}</button></div>
        </>}
        </>}
      </section>)}
      {!rows.length&&!review.loading&&!review.error&&<p>No matters in this category.</p>}
      {confirmIds!==null&&<div role="dialog" aria-modal="true" aria-label="Confirm replenishment requests" style={{position:'fixed',inset:0,zIndex:99100,background:'rgba(15,23,42,.7)',display:'grid',placeItems:'center',padding:20}}>
        <section style={{background:'#fff',width:'min(760px,96vw)',maxHeight:'85vh',overflowY:'auto',padding:24,borderRadius:12,boxShadow:'0 20px 70px #0004'}}>
          <h2 style={{marginTop:0}}>Review before sending</h2>
          <p style={{fontSize:13,color:'#475569'}}>Only the <strong>{REPLENISHMENT_TABS.find(t=>t.id===listTab)?.label}</strong> tab and the current filters are included. This final step will create new trust invoices when needed and send the selected clients their consolidated invoice email.</p>
          <div style={{border:'1px solid #cbd5e1',borderRadius:8,overflowX:'auto'}}>
            <table style={{width:'100%',fontSize:13,borderCollapse:'collapse'}}><thead><tr style={{background:'#f1f5f9'}}><th style={{padding:9,textAlign:'left'}}>Client / matter</th><th style={{padding:9,textAlign:'left'}}>Included actions</th><th style={{padding:9,textAlign:'right'}}>New trust amount</th></tr></thead>
              <tbody>{confirmRows.map(row=><tr key={row.id} style={{borderTop:'1px solid #e2e8f0'}}><td style={{padding:9}}><strong>{row.client_name}</strong><div style={{fontSize:11,color:'#64748b'}}>{row.matter_name}</div></td><td style={{padding:9}}>{replenishmentActionCategories(row).join(', ')||'None'}</td><td style={{padding:9,textAlign:'right'}}>{money(row.amount)}</td></tr>)}</tbody>
            </table>
          </div>
          <p style={{textAlign:'right',fontWeight:700}}>New trust invoices: {money(confirmRows.reduce((sum,row)=>sum+Number(row.amount||0),0))}</p>
          {review.sendingDisabledReason&&<p role="alert" style={{color:'#9a3412'}}>Sending unavailable: {review.sendingDisabledReason}</p>}
          <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:18}}>
            <button type="button" onClick={()=>setConfirmIds(null)} disabled={busy} style={{padding:'11px 16px'}}>Back to review</button>
            <button type="button" disabled={busy||!confirmRows.length||!!review.sendingDisabledReason} onClick={()=>{const ids=confirmRows.map(row=>row.id);setConfirmIds(null);onSend(ids)}}
              style={{padding:'12px 17px',background:confirmRows.length&&!review.sendingDisabledReason?'#1d4ed8':'#cbd5e1',color:'white',border:0,borderRadius:7,fontWeight:700}}>
              Approve &amp; Send {confirmRows.length} Selected
            </button>
          </div>
        </section>
      </div>}
    </section>
  </div>,document.body)
}
