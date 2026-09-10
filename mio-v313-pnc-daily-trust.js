function once(code,from,to,label){if(code.split(from).length!==2)throw Error('V313 anchor changed: '+label);return code.replace(from,()=>to)}
export default function pncDailyTrust(){return {name:'mio-v313-pnc-daily-trust',enforce:'pre',transform(source,id){if(!id.split('?')[0].replaceAll('\\','/').endsWith('/src/App.jsx'))return null
 let code="import MioDailyTrust from './MioDailyTrust.jsx'\nimport {dailyTrustSummary,firmDate} from './mioDailyTrust.js'\nimport {useMioPnc,MioPncRow,MioPncModal,MioPncSettings} from './MioPnc.jsx'\nimport {pncStage} from './mioPncModel.js'\n"+source
 const hook=`  const mioPnc = useMioPnc({session,enabled:page==='matters'||page==='settings',matters,clients,refreshMatters:fetchMatters,refreshClients:fetchClients,graphFetch,supabase,onFinanceRefresh:()=>loadLawPayWorkspace({force:true}),onCalendarSaved:row=>setEvents(old=>[...old.filter(e=>e.id!==row.id),row]),intakeTemplates:draftingIntakeTemplates})
  function mioDailyCoverage() { return dailyTrustSummary({date:dailyBillingDate,entries:billingEntries,matters,pendingFor:pendingLawPayAmountForMatter,financeFor: matter => {
    const f=clientFinanceNumbers(matter)
    const normalized=f.serviceInvoices.map(i=>({...i,balance:invoiceBalanceAmount(i),amount_paid:invoicePaidAmount(i)}))
    const unsettledManual=f.currentLedgerRows.filter(r=>r.source!=='LawPay'&&r.direction!=='out'&&/pending|processing|submitted|authorized/i.test(String(r.status||''))).reduce((v,r)=>v+Number(r.amount||0),0)
    const hasRefund=lawPayTransactionsForMatter(matter).some(t=>financeRowAfterSnapshot(t,f.snapshot)&&(/refund|chargeback|reversal/.test(String(t.transaction_type||'').toLowerCase())||Number(t.amount_refunded_cents)>0))
    return {...f,trust:Math.max(0,f.trust-unsettledManual),financialSnapshotResolved:f.financialSnapshotResolved&&!hasRefund,serviceInvoices:normalized,openingOutstanding:outstandingBreakdownForMatter(matter,f).openingBalance,obligationInvoices:normalized.filter(i=>!f.snapshot||financeRowAfterSnapshot(i,f.snapshot))}
  }}) }

`
 code=once(code,'  function renderDailyBillingModal() {',hook+'  function renderDailyBillingModal() {','hook and coverage')
 code=once(code,"const [dailyBillingDate, setDailyBillingDate] = useState(() => new Date().toISOString().slice(0, 10))","const [dailyBillingDate, setDailyBillingDate] = useState(() => firmDate())",'firm date')
 code=once(code,'function openDailyBillingWindow(dateValue = new Date().toISOString().slice(0, 10))','function openDailyBillingWindow(dateValue = firmDate())','open date')
 const start=code.indexOf('  function renderDailyBillingModal() {'),end=code.indexOf('\n  function ',start+10);let part=code.slice(start,end)
 part=once(part,'    const totals = billingTotals(entries)','    const coverage = mioDailyCoverage()\n    const totals = {...billingTotals(entries),amount:coverage.total/100}','total same definition')
 part=part.replace('new Date(current || new Date().toISOString().slice(0, 10))',"new Date((current || firmDate())+'T12:00:00Z')").replace('d.setDate(d.getDate() + amount)','d.setUTCDate(d.getUTCDate() + amount)').replace('setDailyDateAndForm(new Date().toISOString().slice(0, 10))','setDailyDateAndForm(firmDate())')
 part=once(part,'        <section style={{ border:', '        <MioDailyTrust summary={coverage} date={dailyBillingDate} />\n        <section style={{ border:','coverage card')
 code=code.slice(0,start)+part+code.slice(end)
 code=once(code,'        {renderDailyBillingModal()}','        {renderDailyBillingModal()}\n        <MioPncModal control={mioPnc} caseTypes={options(\'matter_type\')} />','global modal')
 code=once(code,'            <h1>Matters</h1>',`            <h1>Matters</h1>
            <button onClick={mioPnc.openNew} style={{marginRight:10,marginBottom:20}}>Add PNC</button>
            {mioPnc.error && <div role="alert" className="mio-pnc-error">PNC: {mioPnc.error} <button onClick={mioPnc.load}>Retry PNC load</button></div>}`,'add PNC')
 code=once(code,`                          <tr>
                            <MatterPageCells matter={matter} />
                          </tr>
                          {renderMatterStepsRow(matter)}`,`                          {pncStage(matter) ? <MioPncRow matter={matter} workflow={mioPnc.rows[matter.id]} control={mioPnc} colSpan={shownMatterColumns().length+2} /> : <><tr><MatterPageCells matter={matter} /></tr>{renderMatterStepsRow(matter)}</>}`,'special rows')
 code=once(code,"              <button onClick={() => setSettingsTab('drafting')}","              <button onClick={() => setSettingsTab('pnc')} style={{marginRight:10,fontWeight:settingsTab==='pnc'?'bold':'normal'}}>PNC workflow</button>\n              <button onClick={() => setSettingsTab('drafting')}",'settings tab')
 code=once(code,"            {settingsTab === 'drafting' && renderDraftingSettings()}","            {settingsTab === 'pnc' && <MioPncSettings control={mioPnc} />}\n            {settingsTab === 'drafting' && renderDraftingSettings()}",'settings panel')
 code=once(code,'Mio V312 (native matters + saved filters)','Mio V313 (daily trust + PNC workflow)','release')
 return {code,map:null}
}}}
