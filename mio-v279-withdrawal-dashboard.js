import fs from 'node:fs'
const adapters=fs.readFileSync(new URL('./src/mioWithdrawalAppAdapters.inc',import.meta.url),'utf8')
export function transformWithdrawalDashboard(source){
 let code=source
 const once=(from,to)=>{if(code.split(from).length!==2)throw new Error('V279 integration anchor changed: '+from.slice(0,100));code=code.replace(from,to)}
 code=`import {WithdrawalDashboard,WithdrawalTemplateSettings,useMioWithdrawals} from './MioWithdrawalDashboard.jsx'\nimport {mioWithdrawalStore} from './mioWithdrawalRuntime.js'\nimport {WITHDRAWAL_STEPS} from './mioWithdrawalWorkflow.js'\n`+code
 once("const MIO_APP_VERSION = 'Mio V278 (draft previews)'","const MIO_APP_VERSION = 'Mio V279 (drafting + withdrawals)'")
 once('  const [bankAccounts, setBankAccounts] = useState([])',"  const mioWithdrawalSnapshot=useMioWithdrawals(session?.user?.id,page==='withdrawals')\n  const [mioWithdrawalIntegrationError,setMioWithdrawalIntegrationError]=useState('')\n  const [bankAccounts, setBankAccounts] = useState([])")
 once('  function renderWithdrawalsPage() {','  function renderWithdrawalsPageLegacy() {')
 once('  const settingsMatterTableRows = sortRows(',adapters+'\n\n  const settingsMatterTableRows = sortRows(')
 once("    setMatterExtraInfoById({ ...matterExtraInfoById, [matterId]: { ...current, withdrawal_status: nextValue } })","    const entering=nextValue==='withdrawing'&&matterWithdrawalStatus(matterId)!=='withdrawing'\n    setMatterExtraInfoById(old=>({...old,[matterId]:{...cloneMatterExtraInfo(old[matterId]||{}),withdrawal_status:nextValue,...(entering&&!old[matterId]?.withdrawal_entered_at?{withdrawal_entered_at:new Date().toISOString()}:{})}}))")
 once('    return <><DraftingPreferences profile={draftingProfile}', '    return <><WithdrawalTemplateSettings profile={draftingProfile} templates={draftingTemplates} onSave={mioSaveDraftingDefaults}/><DraftingPreferences profile={draftingProfile}')
 once('    setDocuments((current) => [...saved, ...current])',`    if(draftingSelection.field_values?.withdrawal_step_id){
      await saveMioStateKeyNow('caseControllerDocuments',JSON.stringify([...saved,...documents]),{throwOnError:true})
      await mioSignalWithdrawal(matter.id,{type:'documents_saved',step_id:draftingSelection.field_values.withdrawal_step_id,document_ids:saved.map(item=>item.id),source_key:'documents:'+saved[0]?.id,source_version:'saved'})
    }
    setDocuments((current) => [...saved, ...current])`)
 once('    const safeJob = mioEfilePersistableJob(job)\n    setEfileAgentJobs',`    const previous=(efileAgentJobs||[]).find(item=>String(item.id)===String(job.id))||((String(efileAgentDraft?.id)===String(job.id))?efileAgentDraft:{})
    const safeJob = mioEfilePersistableJob({...previous,...job})
    if(safeJob.withdrawal_step_id&&safeJob.matter_id&&['submitted','rejected','failed','accepted'].includes(safeJob.status))void mioSignalWithdrawal(safeJob.matter_id,{type:'efile_update',step_id:safeJob.withdrawal_step_id,status:safeJob.status,reference:safeJob.envelope_number||safeJob.page?.envelope_number||safeJob.id,source_key:'efile:'+safeJob.id,source_version:safeJob.status})
    setEfileAgentJobs`)
 // Matter changes inside eFile must not retain another matter's workflow binding.
 once('      matter_id: matterId,\n      cause_number: matter?.cause_number',"      matter_id: matterId,\n      withdrawal_step_id: String(current.matter_id)===String(matterId)?current.withdrawal_step_id:'',\n      cause_number: matter?.cause_number")
 const modalStart='  function renderSettingWorkspaceModal() {\n    if (!showSettingWorkspaceWindow || !settingWorkspaceContext) return null\n    const context = settingWorkspaceContext\n    const matter = matterForWorkspaceContext(context)\n    const workspace = normalizeWorkspace(context)\n'
 once(modalStart,modalStart+`    if(context.type==='withdrawal')return <Modal title={'Withdrawal - '+context.stepName+' - '+(matter?.name||'')} onClose={()=>setShowSettingWorkspaceWindow(false)}><div style={{width:'min(90vw,1100px)',maxHeight:'80vh',overflow:'auto'}}><p>This email is linked to this withdrawal step. Sending is not delivery or step completion. Review recipients, wording, and attachments.</p>{context.stepId==='closeout_email'&&<p><strong>Sending a NEW email attaches the verified signed order. Reply and forward cannot be used for this closeout packet.</strong></p>}{mioWithdrawalIntegrationError&&<p role="alert">{mioWithdrawalIntegrationError}</p>}{workspace.emails.map((email,index)=>renderWorkspaceEmailCard(context,email,index))}<button type="button" onClick={()=>{setShowSettingWorkspaceWindow(false);setPage('withdrawals')}}>Return to withdrawal dashboard</button></div></Modal>
`)
 once('    const list = Array.isArray(messages) ? messages.filter((message) => message?.id) : []\n    if (!list.length) return []',"    const list = Array.isArray(messages) ? messages.filter((message) => message?.id) : []\n    if(context.type==='withdrawal')return list\n    if (!list.length) return []")
 once('      let fallbackMessages = messages.length ? messages : (seed ? [seed] : [])',"      if(context.type==='withdrawal')messages=messages.filter(message=>message.conversation_id===conversationId)\n      let fallbackMessages = messages.length ? messages : (seed ? [seed] : [])")
 const loadCatch="    } catch (error) {\n      console.error('Setting workspace thread load failed:', error)"
 once(loadCatch,`      if(context.type==='withdrawal'){
        patchWorkspaceEmail(context,email.id,{status_note:'Withdrawal conversation loaded; mailbox folders were not changed.'})
        if(latestIncoming?.conversation_id===conversationId)await mioSignalWithdrawal(context.matterId,{type:'email_received',step_id:context.stepId,message_id:latestIncoming.id,received_at:latestIncoming.received_at,source_key:'email:'+context.stepId+':'+conversationId,source_version:latestIncoming.received_at+':'+latestIncoming.from_email})
      }
${loadCatch}
      if(context.type==='withdrawal'){setMioWithdrawalIntegrationError('Could not refresh a linked withdrawal email: '+(error.message||error));patchWorkspaceEmail(context,email.id,{status_note:'Thread refresh failed; withdrawal status may be stale.'});return}`)
 // Auto-attachment scans sent items, but must not create/move mailbox folders for this workflow.
 once('          const mioFolderId = await ensureWorkspaceMioEmailFolderId(email)',"          if(context.type==='withdrawal')throw new Error('Mailbox folder changes are disabled for withdrawal synchronization.')\n          const mioFolderId = await ensureWorkspaceMioEmailFolderId(email)")
 once("      const base = workspaceEmailMailboxBase(email)\n      await graphFetch(`${base}/sendMail`, {",`      const attachments=context.type==='withdrawal'?await mioWithdrawalSendAttachments(context,email):[]
      if(context.type==='withdrawal'&&!window.confirm('Send this reviewed withdrawal email to '+email.to+'? '+(attachments.length?'The verified signed order is attached.':'Confirm that required signature links or documents are included.'))){patchWorkspaceEmail(context,email.id,{status_note:'Send cancelled. Nothing was sent.'});return}
      const base = workspaceEmailMailboxBase(email)
      await graphFetch(\x60\x24{base}/sendMail\x60, {`)
 once("            body: { contentType: 'HTML', content: emailHtmlWithSignature(email.body || '') },\n            toRecipients: outlookRecipientList(email.to),\n            ccRecipients: outlookRecipientList(email.cc)","            body: { contentType: 'HTML', content: context.type==='withdrawal'?mioWithdrawalEmailHtml(email):emailHtmlWithSignature(email.body || '') },\n            toRecipients: outlookRecipientList(email.to),\n            ccRecipients: outlookRecipientList(email.cc),\n            ...(attachments.length?{attachments}:{})")
 once('      const localSentMessage = {',`      if(context.type==='withdrawal')await mioSignalWithdrawal(context.matterId,{type:'email_sent',step_id:context.stepId,email_id:email.id,reference:email.subject+' / '+email.id,source_key:'send:'+email.id,source_version:new Date().toISOString()})
      const localSentMessage = {`)
 once('        has_attachments: false\n      }\n      patchWorkspaceEmail(context, email.id', '        has_attachments: attachments.length>0\n      }\n      patchWorkspaceEmail(context, email.id')
 once('  async function replyWorkspaceOutlookThread(context, email) {',"  async function replyWorkspaceOutlookThread(context, email) {\n    if(context.type==='withdrawal'&&context.stepId==='closeout_email'){alert('Send the closeout as a NEW email to verify the attachment and links.');return}\n    if(context.type==='withdrawal'&&!window.confirm('Send the reviewed reply in this withdrawal conversation?'))return")
 once("      patchWorkspaceEmail(context, email.id, { reply_body: '', status_note: 'Reply sent from Outlook. Refresh the thread to see it here.' })",`      if(context.type==='withdrawal')await mioSignalWithdrawal(context.matterId,{type:'email_sent',step_id:context.stepId,email_id:email.id,reference:'Reply / '+messageId,source_key:'reply:'+email.id,source_version:new Date().toISOString()})
      patchWorkspaceEmail(context, email.id, { reply_body: '', status_note: 'Reply sent from Outlook. Refresh the thread to see it here.' })`)
 once('  async function forwardWorkspaceOutlookThread(context, email) {',"  async function forwardWorkspaceOutlookThread(context, email) {\n    if(context.type==='withdrawal'&&context.stepId==='closeout_email'){alert('Send the closeout as a NEW email to verify the attachment and links.');return}\n    if(context.type==='withdrawal'&&!window.confirm('Forward this reviewed withdrawal email to the selected recipients?'))return")
 return code
}
export default function mioV279WithdrawalDashboard(){return{name:'mio-v279-withdrawal-dashboard',enforce:'pre',transform(source,id){return id.split('?')[0].endsWith('/src/App.jsx')?transformWithdrawalDashboard(source):null}}}
