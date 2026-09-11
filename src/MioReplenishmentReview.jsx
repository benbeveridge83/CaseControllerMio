import React, {useEffect, useRef} from 'react'
import {createPortal} from 'react-dom'
const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value)||0)
const locked = row => ['sent','sending','blocked','uncertain'].includes(row.send_status)
export default function MioReplenishmentReview({review,busy,onClose,onUpdate,onSend,onPreview,onConnect,connected}) {
  const closeRef=useRef(null)
  useEffect(()=>{if(!review.open)return;const prior=document.activeElement;closeRef.current?.focus();return()=>prior?.focus?.()},[review.open])
  if(!review.open)return null
  const rows=review.rows||[],ready=rows.filter(row=>row.included&&!locked(row))
  return createPortal(<div style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(15,23,42,.6)',padding:20,display:'grid',placeItems:'center'}}>
    <section role="dialog" aria-modal="true" aria-labelledby="replenishment-review-title" style={{background:'#fff',borderRadius:12,padding:20,width:'min(1180px,95vw)',maxHeight:'92vh',overflow:'auto'}} onKeyDown={event=>{
      if(event.key==='Escape'&&!busy)onClose()
      if(event.key==='Tab'){const focusable=[...event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    }}>
      <header style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><h2 id="replenishment-review-title" style={{margin:0}}>Replenishment Review</h2><p>Review amounts and email contents before approval. New requests are created only when you approve and send. Existing unsent drafts are reused.</p></div><button ref={closeRef} type="button" disabled={busy} onClick={onClose}>Close</button></header>
      <div role="status" aria-live="polite">{review.loading?'Loading current invoices...':review.message}</div>
      {review.error&&<p role="alert">{review.error}</p>}
      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',padding:'12px 0'}}>
        <button type="button" className="btnPrimary" disabled={busy||review.loading||!ready.length} onClick={()=>onSend(null)}>Approve &amp; Send All ({ready.length})</button>
        <strong>Selected total: {money(ready.reduce((sum,row)=>sum+Number(row.amount||0),0))}</strong>
        {!connected&&<button type="button" onClick={onConnect} disabled={busy}>Connect Microsoft</button>}
      </div>
      {rows.map(row=><section key={row.id} aria-label={`Replenishment for ${row.client_name}`} style={{border:'1px solid #cbd5e1',borderRadius:9,padding:14,marginTop:12}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',flexWrap:'wrap'}}>
          <div><label><input type="checkbox" aria-label={`Include ${row.client_name}`} checked={!!row.included} disabled={busy||locked(row)} onChange={e=>onUpdate(row.id,{included:e.target.checked})}/> <strong>{row.client_name}</strong></label><div>{row.matter_name} {row.matter_number}</div><small>{row.invoice?.invoice_number||'Invoice number assigned on approval'}</small></div>
          <div><strong>{row.send_status==='sent'?'Sent':row.send_status==='uncertain'?'Delivery needs verification':row.send_status==='blocked'?'Skipped':row.send_status==='sending'?'Sending...':row.send_status==='error'?'Needs correction':'Ready for review'}</strong><div>{money(row.amount)}</div></div>
        </div>
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
