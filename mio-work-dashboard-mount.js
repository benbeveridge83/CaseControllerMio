import fs from 'node:fs'
const bridge=fs.readFileSync(new URL('./src/dashboard/appBridge.inc',import.meta.url),'utf8')
function once(code,anchor,replacement,label){if(code.split(anchor).length!==2)throw new Error(`Work dashboard mount anchor changed: ${label}`);return code.replace(anchor,()=>replacement)}
export function applyWorkDashboardMount(source){
 if(source.includes('function mioDeskRows()'))throw new Error('Work dashboard already mounted')
 let code="import {workflowBlockAttention as mioDeskBlockWithdrawalAttention} from './mioWorkflowBlocks.js'\nimport {workflowAttention as mioDeskLegacyWithdrawalAttention} from './mioWithdrawalWorkflow.js'\nimport MioWorkDashboard from './dashboard/WorkDashboard.jsx'\nimport {periodSummary as mioDeskPeriodSummary,weekStart as mioDeskWeekStart,sortedTrust as mioDeskSortedTrust,billingMarker as mioDeskBillingMarker,clientNameForMatter as mioDeskClientName} from './dashboard/model.js'\n"+source
 code=code.replace("useMioWithdrawals(session?.user?.id,page==='withdrawals')","useMioWithdrawals(session?.user?.id,page==='withdrawals'||page==='dashboard')")
 code=once(code,'const appPages = [',"const appPages = [\n  { value: 'dashboard', label: 'Dashboard' },",'registration')
 const nav="        {canOpenPage('documents') && ("
 code=once(code,nav,`        {canOpenPage('dashboard') && isFirmStaffMember() && <a href="#dashboard" onClick={e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();setPage('dashboard')}} style={{display:'block',marginBottom:10,fontWeight:page==='dashboard'?900:600}}>▦ Dashboard</a>}\n${nav}`,'navigation')
 code=once(code,'  function renderDailyBillingModal() {',bridge+'\n  function renderDailyBillingModal() {','bridge')
 code=once(code,'        {renderDailyBillingModal()}',"        {page==='dashboard' && canOpenPage('dashboard') && isFirmStaffMember() && renderMioWorkDashboard()}\n        {renderMioDeskDetail()}\n        {renderDailyBillingModal()}",'page')
 code=once(code,'  function renderOrdersPage() {','  function renderOrdersPage(focusedOrderId = null) {','focused orders signature')
 code=once(code,'    const visibleRows = orderRows\n','    const filteredOrderRows = orderRows\n','focused orders source')
 code=once(code,'    const openRows = orderRows.filter((row) => !row.completed)',"    const visibleRows = focusedOrderId ? orderRows.filter(row=>String(row.id)===String(focusedOrderId)) : filteredOrderRows\n    const openRows = orderRows.filter((row) => !row.completed)",'focused order selection')
 code=once(code,'  function openBillingWindow(context = {}) {',`  function openBillingWindow(context = {}) {\n    mioDeskBillingOriginRef.current = page==='dashboard' && mioDeskActiveRowRef.current && String(mioDeskActiveRowRef.current.matterId)===String(context.matter_id) ? {...mioDeskActiveRowRef.current} : null\n    if(page==='dashboard'&&!context.date)context={...context,date:firmDate()}`,'billing origin')
 const formStart=code.indexOf('  function openBillingWindow('),formEnd=code.indexOf('\n  function ',formStart+10)
 let billingPart=code.slice(formStart,formEnd).replace('    setBillingForm({',"    setBillingForm({\n      dashboard_task_key: mioDeskBillingOriginRef.current?.key || '',\n      dashboard_task_matter_id: mioDeskBillingOriginRef.current?.matterId || '',")
 code=code.slice(0,formStart)+billingPart+code.slice(formEnd)
 code=once(code,"      task_id: billingForm.task_id || '',",`      task_id: billingForm.task_id || '',\n      ...(billingForm.dashboard_task_key && String(billingForm.dashboard_task_matter_id)===String(billingForm.matter_id) ? {dashboard_task_key:billingForm.dashboard_task_key,dashboard_save_state:'pending'} : {}),`,'saved row identity')
 const save="    saveBillingEntryToRelational(entry, String(billingForm.private_note || '').trim())"
 code=once(code,save,`    const mioDeskSave=saveBillingEntryToRelational(entry, String(billingForm.private_note || '').trim())\n    if(entry.dashboard_task_key)mioDeskSave.then(ok=>{setBillingEntries(current=>current.map(row=>row.id===entry.id?{...row,dashboard_save_state:ok?'saved':'failed'}:row));if(!ok)alert('Time was recorded locally, but cloud save failed. This row will not turn green until its save is confirmed.')}).catch(()=>{setBillingEntries(current=>current.map(row=>row.id===entry.id?{...row,dashboard_save_state:'failed'}:row));alert('Time could not be confirmed in the cloud. Check your connection before reloading.')})`,'confirmed green state')
 const start=code.indexOf('  async function saveBillingEntryToRelational('),end=code.indexOf('\n  async function ',start+10)
 let part=code.slice(start,end).replace('if (!row) return','if (!row) return false').replace("    if (error) console.warn('Billing entry Supabase save failed:', error)","    if (error) console.warn('Billing entry Supabase save failed:', error)\n    return !error")
 code=code.slice(0,start)+part+code.slice(end)
 const payload='payload: { ...entry, relational_live_at: new Date().toISOString() }'
 code=once(code,payload,"payload: { ...entry, ...(entry.dashboard_task_key ? {dashboard_save_state:'saved'} : {}), relational_live_at: new Date().toISOString() }",'durable confirmed state')
 return code
}
export default function workDashboardMount(){return {name:'mio-work-dashboard',enforce:'pre',transform(source,id){if(!id.split('?')[0].replaceAll('\\','/').endsWith('/src/App.jsx'))return null;return {code:applyWorkDashboardMount(source),map:null}}}}
