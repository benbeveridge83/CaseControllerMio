import React, {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {calculateTrustReplenishment, invoiceOutstanding, recentTrustHistory} from './mioTrustReplenishmentCalculations.js'
import MioReplenishmentEmailSections from './MioReplenishmentEmailSections.jsx'
import {replenishmentActionCategories} from './mioReplenishmentActions.js'
const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value)||0)
const getNumber = (...values) => { for (const v of values) if(v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) return Number(v); return null }
const dateLabel = value => value ? new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : 'Date unavailable'
const locked = row => ['sent','sending','blocked','uncertain'].includes(row.send_status)
export default function MioReplenishmentReview({review,busy,onClose,onUpdate,onSend,onPreview,onConnect,connected,onSetEligibility,onFlagWithdrawal,onUpdateLimits}) {
  const closeRef=useRef(null)
  const [selectedId,setSelectedId]=useState(null)
  const [tab,setTab]=useState('overview')
  useEffect(()=>{if(!review.open)return;const prior=document.activeElement;closeRef.current?.focus();return()=>prior?.focus?.()},[review.open])
  if(!review.open)return null
  const rows=review.rows||[],ready=rows.filter(row=>row.included&&!locked(row)&&(!row.appointed_status_unknown||row.non_appointed_confirmed===true)&&(Number(row.amount||0)>0||(row.prior_trust_invoices||[]).length>0||(row.unpaid_work_invoices||[]).length>0))
  return createPortal(<div style={{position:'fixed',inset:0,zIndex:99000,background:'rgba(15,23,42,.6)',padding:20,display:'grid',placeItems:'center'}}>
    <section role="dialog" aria-modal="true" aria-labelledby="replenishment-review-title" style={{background:'#fff',borderRadius:12,padding:20,width:'min(1440px,97vw)',maxHeight:'94vh',overflow:'auto'}} onKeyDown={event=>{
      if(event.key==='Escape'&&!busy)onClose()
      if(event.key==='Tab'){const focusable=[...event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    }}>
      <header style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><h2 id="replenishment-review-title" style={{margin:0}}>Replenishment Review</h2><p>Review all low-trust matters below. Open Details only when you want to inspect an individual matter. Nothing sends until approved.</p></div><button ref={closeRef} type="button" disabled={busy} onClick={onClose}>Close</button></header>
      <div role="status" aria-live="polite">{review.loading?'Loading current invoices...':review.message}</div>
      {review.error&&<p role="alert">{review.error}</p>}
      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',padding:'12px 0'}}>
        <button type="button" className="btnPrimary" disabled={busy||review.loading||!ready.length} onClick={()=>onSend(null)}>Approve &amp; Send Selected ({ready.length})</button>
        <strong>New requests selected: {money(ready.reduce((sum,row)=>sum+Number(row.amount||0),0))}</strong>
        {!connected&&<button type="button" onClick={onConnect} disabled={busy}>Connect Microsoft</button>}
      </div>

      <div style={{overflowX:'auto',border:'1px solid #cbd5e1',borderRadius:10}}>
        <table style={{width:'100%',minWidth:1120,borderCollapse:'collapse',fontSize:13}}>
          <thead style={{background:'#f1f5f9',color:'#475569'}}><tr>{['Select','Client / Matter','Current Trust','Minimum','Target','Previous Due','New Request','Action',''].map(h=><th key={h} style={{padding:'11px 8px',textAlign:h==='Client / Matter'||h==='Action'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((row,index)=>{
            const old=(row.prior_trust_invoices||[]).reduce((sum,inv)=>sum+invoiceOutstanding(inv),0)
            const amount=Number(row.amount||0)
            const actions=replenishmentActionCategories(row)
            const status=row.send_status==='sent'?'Sent':row.send_status==='blocked'?'Blocked':row.send_status==='uncertain'?'Verify delivery':row.send_status==='error'?'Needs attention':row.send_status==='sending'?'Sending':null
            return <tr key={row.id} style={{borderTop:'1px solid #e2e8f0',background:row.withdrawal_flagged?'#fff1f2':selectedId===row.id?'#eff6ff':index%2?'#f8fafc':'white'}}>
              <td style={{padding:8,textAlign:'right'}}><input type="checkbox" aria-label={`Include ${row.client_name}`} checked={!!row.included} disabled={busy||locked(row)} onChange={e=>onUpdate(row.id,{included:e.target.checked})}/></td>
              <td style={{padding:8}}><strong>{row.client_name}</strong><div style={{color:'#64748b',fontSize:11}}>{row.matter_name}</div></td>
              <td style={{padding:8,textAlign:'right',whiteSpace:'nowrap'}}>{getNumber(row.current_trust,row.trust_balance)===null?'—':money(row.current_trust??row.trust_balance)}</td>
              <td style={{padding:8,textAlign:'right'}}>{money(row.minimum_trust)}</td>
              <td style={{padding:8,textAlign:'right'}}>{money(row.target_trust)}</td>
              <td style={{padding:8,textAlign:'right',fontWeight:600}}>{money(old)}</td>
              <td style={{padding:8,textAlign:'right',fontWeight:700}}>{money(amount)}</td>
              <td style={{padding:8,minWidth:130}}><div style={{display:'flex',flexDirection:'column',gap:3}}>{status&&<strong style={{color:status==='Blocked'||status==='Needs attention'||status==='Verify delivery'?'#9f1239':'#334155',fontSize:11}}>{status}</strong>}{actions.map(label=><span key={label} style={{display:'block',color:label==='New trust invoice'?'#166534':'#334155',fontSize:12,lineHeight:'17px'}}>{label}</span>)}{!actions.length&&!status&&<span style={{color:'#64748b'}}>No invoices</span>}</div></td>
              <td style={{padding:8}}><button type="button" onClick={()=>{setSelectedId(current=>current===row.id?null:row.id);setTab('overview')}} style={{border:'1px solid #94a3b8',borderRadius:7,padding:'7px 11px',background:selectedId===row.id?'#dbeafe':'white',cursor:'pointer'}}>{selectedId===row.id?'Hide':'Details'}</button></td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {selectedId===null&&rows.length>0&&<p style={{color:'#64748b',fontSize:13}}>Click Details for a matter to see its invoice history, edit its email or change trust settings.</p>}
      {rows.filter(row=>row.id===selectedId).map(row=><section key={row.id} aria-label={`Replenishment for ${row.client_name}`} style={{border:'2px solid #94a3b8',borderRadius:10,padding:16,marginTop:14,background:row.withdrawal_flagged?'#fff1f2':'#fff'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'start',flexWrap:'wrap'}}>
          <div><label><input type="checkbox" aria-label={`Include ${row.client_name}`} checked={!!row.included} disabled={busy||locked(row)} onChange={e=>onUpdate(row.id,{included:e.target.checked})}/> <strong>{row.client_name}</strong></label><div>{row.matter_name} {row.matter_number}</div><small>{row.invoice?.invoice_number||'Invoice number assigned on approval'}</small></div>
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
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" disabled={busy} onClick={()=>onPreview(row)}>Preview PDF</button><button type="button" className="btnPrimary" disabled={busy||locked(row)||(row.appointed_status_unknown&&row.non_appointed_confirmed!==true)||(Number(row.amount||0)<=0&&!(row.prior_trust_invoices||[]).length&&!(row.unpaid_work_invoices||[]).length)} onClick={()=>onSend(row.id)}>{Number(row.amount||0)>0?'Approve & Send':'Send Reminder'}</button></div>
        </>}
        </>}
      </section>)}
      {!rows.length&&!review.loading&&!review.error&&<p>No selected matter requires replenishment.</p>}
    </section>
  </div>,document.body)
}
