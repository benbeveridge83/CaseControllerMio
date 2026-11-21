import React from 'react';
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
const safeLink=url=>{try{const u=new URL(url);return u.protocol==='https:'?u.href:null}catch{return null}};
const sections=[
  ['Invoices for prior work performed','unpaid_work_invoices'],
  ['Previously issued trust replenishment invoices','prior_trust_invoices'],
  ['New trust replenishment invoice','new_invoice']
];
export default function MioReplenishmentEmailSections({row}) {
  if(!row)return null;
  return <details style={{marginTop:10,padding:10,border:'1px solid #e2e8f0',borderRadius:8}}>
    <summary style={{cursor:'pointer',fontWeight:600}}>Client email — three-section invoice preview</summary>
    <p style={{fontSize:12}}>Payment links are shown only when a verified HTTPS invoice link exists. New invoices remain proposals until separately created and verified.</p>
    {sections.map(([title,key])=>{
      const list=key==='new_invoice'?(row.new_invoice?[row.new_invoice]:[]):row[key]||[];
      return <section key={key} style={{margin:'10px 0',borderTop:'1px solid #e2e8f0',paddingTop:8}}>
        <strong style={{fontSize:13}}>{title}</strong>
        {list.length?list.map((i,index)=>{
          const url=safeLink(i.payment_url);
          return <div key={i.id||index} style={{display:'flex',flexWrap:'wrap',gap:8,justifyContent:'space-between',fontSize:12,marginTop:7}}>
            <span>{i.invoice_number||'Invoice'} · {money(i.remaining??i.remaining_balance??i.balance??i.amount)} due</span>
            {url?<a href={url} target="_blank" rel="noopener noreferrer">Pay invoice</a>:<span style={{color:'#92400e'}}>Payment link pending verification</span>}
          </div>
        }):<div style={{fontSize:12,color:'#64748b',marginTop:4}}>{key==='new_invoice'&&Number(row.amount||0)>0?'Proposed: '+money(row.amount)+' (invoice not issued)':'None'}</div>}
      </section>
    })}
    <p style={{fontSize:12}}>Work invoices must use operating payment routing. Trust replenishment invoices must use trust payment routing. This preview does not send email.</p>
  </details>;
}
