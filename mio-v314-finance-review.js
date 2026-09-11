import fs from 'node:fs'
const app=fs.readFileSync(new URL('./src/mioFinanceReviewApp.inc',import.meta.url),'utf8')
function once(code,from,to,label){if(code.split(from).length!==2)throw Error(`V314 ${label}: source anchor not unique`);return code.replace(from,to)}
function editFunction(code,name,edit){const re=new RegExp('  (?:async )?function '+name+'\\('),match=re.exec(code);if(!match)throw Error(`V314 missing ${name}`);const start=match.index,next=/\n  (?:async )?function /.exec(code.slice(start+match[0].length));if(!next)throw Error(`V314 missing end ${name}`);const end=start+match[0].length+next.index;return code.slice(0,start)+edit(code.slice(start,end))+code.slice(end)}
export default function financeReview(){return {name:'mio-v314-finance-review',enforce:'pre',transform(source,id){if(!id.split('?')[0].replaceAll('\\','/').endsWith('/src/App.jsx'))return null
 let code="import MioReplenishmentReview from './MioReplenishmentReview.jsx'\nimport {passesTrustMinimum,compareInvoiceRows,replenishmentCandidate,operatingPaymentMarkers,scanLawPayPages,auditLawPayRecords} from './mioFinanceReview.js'\n"+source
 code=editFunction(code,'replenishSelectedMatters',()=>app.trimEnd()+'\n')
 code=once(code,'        {renderDailyBillingModal()}',`        {renderDailyBillingModal()}
        <MioReplenishmentReview review={replenishmentReview} busy={bulkBillingBusy} onClose={()=>setReplenishmentReview(current=>({...current,open:false}))} onUpdate={updateReplenishmentRow} onSend={sendReplenishmentReview} onPreview={previewReplenishmentPdf} onConnect={connectMicrosoftGraph} connected={!!serviceGraphAuth?.connected} />`,'global review')
 code=editFunction(code,'renderClientDashboardFinances',part=>{
   const labels=['Pending LawPay','Minimum balance','Retainer replenishment target','Replenishment amount']
   const lines=part.split('\n'),cards=lines.filter(line=>labels.some(label=>line.includes(`label: '${label}'`)))
   if(cards.length!==4)throw Error('V314 finance settings cards changed')
   part=lines.filter(line=>!cards.includes(line)).join('\n')
   const pendingStart=part.indexOf('      {!!pendingLawPayPayments.length'),pendingEnd=part.indexOf('\n',pendingStart)
   if(pendingStart<0)throw Error('V314 missing pending notice')
   const pending=part.slice(pendingStart,pendingEnd)
   return part.slice(0,pendingStart)+`      <details key={matter.id} style={{border:'1px solid #cbd5e1',borderRadius:10,padding:12}}><summary style={{cursor:'pointer',fontWeight:800}}>Finances settings</summary><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12,marginTop:12}}>\n${cards.join('\n')}\n</div>\n${pending}\n</details>\n      {renderFinanceSyncStatus()}`+part.slice(pendingEnd)
 })
 code=editFunction(code,'accountingLedgerRows',part=>once(part,'    return [...historicalRows, ...openingRow, ...currentRows]',`    // Operating payments are display rows, never inputs to the trust calculation.
    const markers=operatingPaymentMarkers({matterId:String(matter.id),invoices:finance.invoices,events:mioInvoiceEvents,openingDate})
    const combined=[...currentRows,...markers].sort((a,b)=>String(a.accounting_at).localeCompare(String(b.accounting_at))||String(a.id).localeCompare(String(b.id)))
    let displayedTrust=finance.snapshot?finance.snapshotTrust:0
    const displayed=combined.map(row=>{
      if(row.direction==='operating'){
        const future=outstandingEvents.filter(event=>String(event.at)>row.accounting_at).reduce((sum,event)=>sum+financeNumber(event.delta),0)
        return {...row,running_balance:displayedTrust,ob_balance:Math.max(0,Number((finance.outstanding-future).toFixed(2)))}
      }
      displayedTrust=row.running_balance
      return row
    })
    return [...historicalRows,...openingRow,...displayed]`,'operating ledger'))
 code=editFunction(code,'renderClientFinanceTrustLedger',part=>{
   part=part.replace('Matter accounting \u2014 trust account','Matter accounting - trust and operating payments')
   part=once(part,"'Payer / payee','Funds out','Funds in','Trust balance'","'Payer / payee','Funds out','Funds in','Operating payment','Trust balance'",'operating column')
   const needle="{row.direction === 'in' || row.direction === 'opening' ? money(row.amount) : '\u2014'}</td>"
   part=once(part,needle,needle+`<td style={{padding:9,textAlign:'right',fontWeight:800}}>{row.operating_payment!==undefined?money(row.operating_payment):'\u2014'}</td>`,'operating amount')
   part=part.replaceAll('colSpan="9"','colSpan="10"').replaceAll('colSpan="7"','colSpan="8"')
   return once(part,'      <div style={{ overflowX:', '      {renderFinanceSyncStatus()}\n      <div style={{ overflowX:','ledger sync status')
 })
 code=editFunction(code,'renderBulkInvoiceLedger',part=>{
   const start=part.indexOf('    })).sort((left, right) => {'),end=part.indexOf('\n    const renderFilter',start)
   if(start<0||end<0)throw Error('V314 invoice sort anchors changed')
   part=part.slice(0,start)+`    })).sort((left,right)=>compareInvoiceRows(left,right,bulkInvoiceSort,valueFor))
    const toggleSort=(field,secondary=false)=>setBulkInvoiceSort(current=>secondary&&dateFields.has(field)?{...current,secondary:field,secondaryDirection:current.secondary===field&&current.secondaryDirection==='asc'?'desc':'asc'}:{...current,field,direction:current.field===field&&current.direction==='asc'?'desc':'asc'})`+part.slice(end)
   part=once(part,'onClick={() => toggleSort(column.key)}',"title=\"Click to sort; Shift-click a date header to use it as the secondary sort.\" onClick={event => toggleSort(column.key,event.shiftKey)}",'header sorting')
   const control=`        <div style={{display:'flex',gap:12,alignItems:'end',flexWrap:'wrap',marginTop:12}}>
          <label>Sort by<select aria-label="Invoice primary sort" value={bulkInvoiceSort.field} onChange={e=>setBulkInvoiceSort(current=>({...current,field:e.target.value}))}>{BULK_INVOICE_COLUMNS.filter(c=>c.key!=='actions').map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label>Order<select aria-label="Invoice primary order" value={bulkInvoiceSort.direction} onChange={e=>setBulkInvoiceSort(current=>({...current,direction:e.target.value}))}><option value="asc">Ascending / oldest first</option><option value="desc">Descending / newest first</option></select></label>
          <label>Then by date<select aria-label="Invoice secondary date" value={bulkInvoiceSort.secondary??'created'} onChange={e=>setBulkInvoiceSort(current=>({...current,secondary:e.target.value}))}><option value="">No secondary sort</option>{BULK_INVOICE_COLUMNS.filter(c=>dateFields.has(c.key)).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label>Date order<select aria-label="Invoice secondary order" value={bulkInvoiceSort.secondaryDirection||'asc'} onChange={e=>setBulkInvoiceSort(current=>({...current,secondaryDirection:e.target.value}))}><option value="asc">Oldest to newest</option><option value="desc">Newest to oldest</option></select></label>
          <button type="button" onClick={()=>{setBulkInvoiceFilters({...DEFAULT_BULK_INVOICE_FILTERS,status:'outstanding'});setBulkInvoiceSort({field:'created',direction:'asc',secondary:'',secondaryDirection:'asc'})}}>Outstanding: oldest first</button>
          <button type="button" onClick={()=>{setBulkInvoiceFilters({...DEFAULT_BULK_INVOICE_FILTERS,status:'paid'});setBulkInvoiceSort({field:'created',direction:'asc',secondary:'',secondaryDirection:'asc'})}}>Paid: oldest first</button>
        </div>\n`
   return once(part,"        <div style={{ margin: '12px 0'",control+"        <div style={{ margin: '12px 0'",'sort controls')
 })
 code=editFunction(code,'renderBulkBillingPanel',part=>{
   part=once(part,'      const matter = row.matter','      const matter = row.matter\n      if(!passesTrustMinimum(row.trust,bulkBillingFilters.min_trust))return false','trust filter predicate')
   const field=`          <LabeledField label="Minimum trust amount"><input aria-label="Minimum trust amount" type="number" min="0" step="0.01" value={bulkBillingFilters.min_trust??''} onChange={event=>setBulkBillingFilters(current=>({...current,min_trust:event.target.value}))} placeholder="No minimum" title="Hide matters with less than this trust balance. Blank shows all." /></LabeledField>\n`
   part=once(part,'          <LabeledField label="Mio opening balance through">',field+'          <LabeledField label="Mio opening balance through">','trust filter control')
   return once(part,'      <section className="card" style={{ padding: 0','      {renderFinanceSyncStatus()}\n      <section className="card" style={{ padding: 0','bulk audit')
 })
 // Data reads must not recalculate or overwrite paid amounts from a partial browser cache.
 code=editFunction(code,'loadLawPayWorkspace',part=>{
   part=once(part,"runSupabaseRequestWithAuthRetry(() => supabase.from('lawpay_payment_requests').select('*').order('created_at', { ascending: false }).limit(100), 'LawPay requests load')","loadAllSupabasePages(()=>supabase.from('lawpay_payment_requests').select('*').order('created_at',{ascending:false}).order('id',{ascending:true})).then(data=>({data}))",'all requests')
   part=once(part,"runSupabaseRequestWithAuthRetry(() => supabase.from('lawpay_transactions').select('*').order('occurred_at', { ascending: false }).limit(200), 'LawPay transactions load')","loadAllSupabasePages(()=>supabase.from('lawpay_transactions').select('*').order('occurred_at',{ascending:false}).order('id',{ascending:true})).then(data=>({data}))",'all transactions')
   return once(part,"        if (!requestsResult.error && !transactionsResult.error) await reconcileLawPayInvoicePayments(requestsResult.data || [], transactionsResult.data || [])","        // Only the authenticated gateway posts payments. Browser loading is read-only.",'read only financial loading')
 })
 code=editFunction(code,'refreshLawPayFinancialData',()=>fs.readFileSync(new URL('./src/mioFinanceRefresh.inc',import.meta.url),'utf8').trimEnd()+'\n')
 code=once(code,"const MIO_APP_VERSION = 'Mio V313 (daily trust + PNC workflow)'","const MIO_APP_VERSION = 'Mio V314 (finance review + payment audit)'",'release version')
 return {code,map:null}
}}}
