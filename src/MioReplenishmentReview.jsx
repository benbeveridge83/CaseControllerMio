import React, {useEffect, useRef} from 'react'
import {createPortal} from 'react-dom'
import {calculateTrustReplenishment, invoiceOutstanding, recentTrustHistory} from './mioTrustReplenishmentCalculations.js'
const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value)||0)
const getNumber = (...values) => { for (const v of values) if(v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) return Number(v); return null }
const dateLabel = value => value ? new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'Date unavailable'
const locked = row => ['sent','sending','blocked','uncertain'].includes(row.send_status)
export default function MioReplenishmentReview({review,busy,onClose,onUpdate,onSend,onPreview,onConnect,connected,onSetEligibility,onFlagWithdrawal,onUpdateLimits}) {
  const closeRef=useRef(null)
  useEffect(()=>{if(!review.open)return;const prior=document.activeElement;closeRef.current?.focus();return()=>prior?.focus?.()},[review.open])
  if(!review.open)return null
  const rows=review.rows||[],ready=rows.filter(row=>row.included&&!locked(row))
  return createPortal(<div style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(15,23,42,.6)',padding:20,display:'grid',placeItems:'center'}}>
    <section role="dialog" aria-modal="true" aria-labelledby="replenishment-review-title" style={{background:'#fff',borderRadius:12,padding:20,width:'min(1180px,95vw)',maxHeight:'92vh',overflow:'auto'}} onKeyDown={event=>{
      if(event.key==='Escape'&&!busy)onClose()
      if(event.key==='Tab'){const focusable=[...event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    }}>
      <header style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><h2 id="replenishment-review-title" style={{margin:0}}>Replenishment Review</h2><p>Review low-trust matters, outstanding work invoices, earlier replenishments and new amounts. No request is sent until approval. Existing unsent drafts are reused.</p></div><button ref={closeRef} type="button" disabled={busy} onClick={onClose}>Close</button></header>
      <div role="status" aria-live="polite">{review.loading?'Loading current invoices...':review.message}</div>
      {review.error&&<p role="alert">{review.error}</p>}
      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',padding:'12px 0'}}>
        <button type="button" className="btnPrimary" disabled={busy||review.loading||!ready.length} onClick={()=>onSend(null)}>Approve &amp; Send All ({ready.length})</button>
        <strong>New requests selected: {money(ready.reduce((sum,row)=>sum+Number(row.amount||0),0))}</strong>
        {!connected&&<button type="button" onClick={onConnect} disabled={busy}>Connect Microsoft</button>}
      </div>
      {rows.map(row=><section key={row.id} aria-label={`Replenishment for ${row.client_name}`} style={{border:'1px solid #cbd5e1',borderRadius:9,padding:14,marginTop:12,background:row.withdrawal_flagged?'#fff1f2':'#fff'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',flexWrap:'wrap'}}>
          <div><label><input type="checkbox" aria-label={`Include ${row.client_name}`} checked={!!row.included} disabled={busy||locked(row)} onChange={e=>onUpdate(row.id,{included:e.target.checked})}/> <strong>{row.client_name}</strong></label><div>{row.matter_name} {row.matter_number}</div><small>{row.invoice?.invoice_number||'Invoice number assigned on approval'}</small></div>
          <div><strong>{row.send_status==='sent'?'Sent':row.send_status==='uncertain'?'Delivery needs verification':row.send_status==='blocked'?'Skipped':row.send_status==='sending'?'Sending...':row.send_status==='error'?'Needs correction':'Ready for review'}</strong><div>{money(row.amount)}</div></div>
        </div>
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
  return <div style={{marginTop:10}}>
    <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'center',marginBottom:8}}>
      <small>Current trust: <strong>{trust===null?'Unavailable':money(trust)}</strong></small>
      <small>Minimum: <strong>{min===null?'Unavailable':money(min)}</strong></small>
      <small>Target: <strong>{target===null?'Unavailable':money(target)}</strong></small>
      {onSetEligibility&&<label style={{fontSize:12}} title="Persistently exclude this matter from future replenishment runs"><input type="checkbox" checked={row.replenishment_enabled!==false} disabled={busy||locked(row)} onChange={e=>onSetEligibility(row.id,e.target.checked)}/> Enabled</label>}
      {onFlagWithdrawal&&<button type="button" disabled={busy} onClick={()=>onFlagWithdrawal(row.id,!row.withdrawal_flagged)}>{row.withdrawal_flagged?'Remove withdrawal review flag':'Flag for withdrawal review'}</button>}
      {row.withdrawal_flagged&&<small style={{color:'#9f1239',fontWeight:700}}>Withdrawal review flagged</small>}
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:8,padding:10,background:'#f8fafc',borderRadius:8}}>
      <div><small>Unpaid work invoices</small><div><strong>{work.length?money(workTotal):row.unpaid_work_balance!=null?money(row.unpaid_work_balance):'Not loaded'}</strong></div></div>
      <div><small>Earlier trust invoices due</small><div><strong>{old.length?money(priorTotal):row.prior_replenishment_balance!=null?money(row.prior_replenishment_balance):'Not loaded'}</strong></div></div>
      <div><small>New trust request</small><div><strong>{money(row.amount)}</strong>{suggested!==null&&old.length>0&&<small style={{display:'block'}}>Calculated: {money(suggested)}</small>}</div></div>
      <div><small>All obligations</small><div><strong>{work.length||old.length?money(workTotal+priorTotal+Number(row.amount||0)):'Pending invoice lookup'}</strong></div></div>
    </div>
    {onUpdateLimits&&<div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:10}}>
      <label style={{fontSize:12}}>Minimum trust <input style={{width:115}} type="number" min="0" step=".01" defaultValue={min??''} disabled={busy||locked(row)} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==min)onUpdateLimits(row.id,{minimum_trust:Number(e.target.value)})}}/></label>
      <label style={{fontSize:12}}>Target trust <input style={{width:115}} type="number" min="0" step=".01" defaultValue={target??''} disabled={busy||locked(row)} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==target)onUpdateLimits(row.id,{target_trust:Number(e.target.value)})}}/></label>
    </div>}
    <details style={{marginTop:10}}>
      <summary>Prior 60 days — {history.length} replenishment invoice{history.length===1?'':'s'}</summary>
      {history.length?<div style={{overflowX:'auto'}}><table style={{width:'100%',fontSize:12,marginTop:8}}><thead><tr><th align="left">Sent</th><th align="right">Trust then</th><th align="right">Original</th><th align="right">Paid</th><th align="right">Still due</th></tr></thead><tbody>{history.map((invoice,i)=><tr key={invoice.id||i}><td>{dateLabel(invoice.sent_at||invoice.issued_at||invoice.created_at)}</td><td align="right">{invoice.trust_at_issue==null?'—':money(invoice.trust_at_issue)}</td><td align="right">{money(invoice.amount)}</td><td align="right">{money(invoice.paid_amount)}</td><td align="right">{money(invoiceOutstanding(invoice))}</td></tr>)}</tbody></table></div>:<p style={{fontSize:12}}>No invoice history available for the last 60 days. Historical balances require a saved issuance snapshot.</p>}
    </details>
  </div>
})()}
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
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" disabled={busy} onClick={()=>onPreview(row)}>Preview PDF</button><button type="button" className="btnPrimary" disabled={busy||locked(row)} onClick={()=>onSend(row.id)}>Approve &amp; Send</button></div>
        </>}
      </section>)}
      {!rows.length&&!review.loading&&!review.error&&<p>No selected matter requires replenishment.</p>}
    </section>
  </div>,document.body)
}
