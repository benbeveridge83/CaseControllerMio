import fs from 'node:fs'
const bridge=fs.readFileSync(new URL('./src/mioWithdrawalBlocksApp.inc',import.meta.url),'utf8')
function once(code,from,to,label){const i=code.indexOf(from);if(i<0||code.indexOf(from,i+from.length)>=0)throw new Error('V305 integration anchor changed: '+label);return code.replace(from,to)}
export default function mioV305WorkflowBlocks(){return{name:'mio-v305-workflow-blocks',enforce:'pre',transform(source,id){
 const path=id.split('?')[0].replaceAll('\\','/');let code=source
 if(path.endsWith('/src/MioWithdrawalBlocks.jsx')||path.endsWith('/src/MioWorkflowBuilder.jsx')){
  code=code.replace(/<label>([^<{"\n]+)<(select|input|textarea)\b/g,(_match,label,control)=>'<label>'+label+'<'+control+' aria-label="'+label.trim()+'"')
  code=code.replace('<label>{slot.name}<select','<label>{slot.name}<select aria-label={slot.name}')
  if(path.endsWith('/src/MioWithdrawalBlocks.jsx'))code=once(code,"if(key!==selectedKey.current){selectedKey.current=key;setSelectedId(attention?.step_id||'')}","if(key!==selectedKey.current){const changedMatter=selectedKey.current.split(':')[0]!==expanded;selectedKey.current=key;if(changedMatter||attention?.step_id)setSelectedId(attention?.step_id||'')}",'preserve selected step on pause')
  return {code,map:null}
 }
 if(path.endsWith('/src/mioWithdrawalRepository.js')){
  code=once(code,"from './mioWithdrawalWorkspaceState.js'","from './mioWithdrawalBlocksState.js'",'block reducer')
  code=once(code,"client.rpc('mio_save_withdrawal_v1',","client.rpc(state.definition||['workflow_release','workflow_reactivate'].includes(event.type)?'mio_save_workflow_blocks_v1':'mio_save_withdrawal_v1',",'block save RPC')
  code=once(code,'p_event:event}','p_event:{...event,...(state.definition||["workflow_release","workflow_reactivate"].includes(event.type)?{workspace_version:1}:{})}}','audit version')
  return{code,map:null}
 }
 if(!path.endsWith('/src/App.jsx'))return null
 code="import WithdrawalBlocksDashboard from './MioWithdrawalBlocks.jsx'\nimport {resolveWorkflowSlot,workflowBlockReason} from './mioWorkflowBlocks.js'\n"+code
 code=once(code,"Mio V304.2 (simple withdrawal next actions)","Mio V305 (editable withdrawal workflows)",'version')
 code=once(code,'  function renderMioEfileAgentPage() {','  function renderMioEfileAgentPageV305Inner() {','filing workspace inner')
 code=once(code,'  function renderWithdrawalsPage() {',"  function renderMioEfileAgentPage() {return <>{efileAgentDraft?.withdrawal_step_id&&<div className=\"mio-wd-return\"><strong>Linked withdrawal filing</strong><span>Review service contacts and filing details before submission. Return to connect the actual file-stamped result when it arrives.</span><button type=\"button\" onClick={()=>{setMioWdFocusMatter(String(efileAgentDraft.matter_id));setPage('withdrawals')}}>Return to withdrawal row</button></div>}{renderMioEfileAgentPageV305Inner()}</>}\n  function renderWithdrawalsPage() {",'filing return to workflow')
 code=once(code,'  function mioWdFinanceRows(){','  function mioWdFinanceRows(metric = "matter_trust_funds"){','metric parameter')
 code=once(code,'for(const row of mioTrustLedgerFinancialGraphRows()){','for(const row of mioFinancialGraphRows(metric)){','recorded metric history')
 code=once(code,"byMatter.get(id).push(snapshotGraphPointFromRow(row,'matter_trust_funds',matter))","const needed=metric==='matter_trust_funds'?['matter_trust_funds']:['matter_trust_funds',...(metric.includes('minimum')?['minimum_balance']:[]),...(metric.includes('wip')?['work_in_progress']:[]),...(metric.includes('outstanding')?['outstanding_balance']:[])];if(needed.every(key=>row[key]!=null&&row[key]!==''&&Number.isFinite(Number(row[key]))))byMatter.get(id).push(snapshotGraphPointFromRow(row,metric,matter))",'historical data completeness')
 code=once(code,"case_type:String(m.case_type||m.matter_type||clioFixedCaseTypeForMioMatter(m)||'Unspecified'),matter_status:m.matter_status||m.case_status||''","case_type:String(m.matter_type||clioFixedCaseTypeForMioMatter(m)||''),matter_status:m.matter_status||'',case_status:m.case_status||''",'canonical filters')
 code=once(code,'trust:finance.trust,minimum:finance.minimumBalance,below','trust:finance.trust,wip:finance.wip,outstanding:finance.outstanding,minimum:finance.minimumBalance,below','metric summary')
 code=once(code,'  function mioWdRenderGraph(rows){','  function mioWdRenderGraph(rows,metric = "matter_trust_funds"){','graph metric')
 code=once(code,'if(rows.length===1&&rows[0].points.length)','if(metric==="matter_trust_funds"&&rows.length===1&&rows[0].points.length)','minimum line scope')
 code=once(code,"withdrawal_status:'',withdrawal_released_at:","withdrawal_status:'not_withdrawing',withdrawal_released_at:",'explicit release')
 code=once(code,'  async function mioWithdrawalSendAttachments(context,email) {','  async function mioWithdrawalSendAttachmentsLegacy(context,email) {','legacy attachments')
 code=once(code,"const attachments=context.type==='withdrawal'?await mioWithdrawalSendAttachments(context,email):[]","const attachments=context.type==='withdrawal'?await mioWdBlockAttachments(context,email):[]",'input document attachments')
 code=once(code,"(attachments.length?'The verified signed order is attached.':'Confirm that required signature links or documents are included.')","(attachments.length?'Reviewed input document(s) attached: '+attachments.map(a=>a.name).join(', '):'Confirm that required signature links or documents are included.')",'accurate attachment confirmation')
 code=once(code,"document_ids:saved.map(item=>item.id),source_key:'documents:'","document_ids:saved.map(item=>item.id),documents:saved.map(item=>({id:item.id,name:item.file_name,source_file_name:item.document_field_values?.drafting_audit?.template_file})),source_key:'documents:'",'draft output maps')
 code=once(code,"const matter=matters.find(item=>String(item.id)===String(matterId)),step=WITHDRAWAL_STEPS.find(item=>item.id===stepId)","const matter=matters.find(item=>String(item.id)===String(matterId)),step=mioWithdrawalStore.getSnapshot().rows[String(matterId)]?.state?.definition?.steps.find(item=>item.id===stepId)||WITHDRAWAL_STEPS.find(item=>item.id===stepId)",'custom email contexts')
 code=once(code,'  function renderWithdrawalsPage() {',bridge+'\n  function renderWithdrawalsPage() {','action adapters')
 code=once(code,'return <WithdrawalDashboard rows={rows}','return <WithdrawalBlocksDashboard rows={rows}','live dashboard')
 code=once(code,'settings={renderMioDraftingDefaults()} legacy={null}','onSaveDrafting={mioSaveDraftingDefaults} optionLists={{matter_status:options("matter_status"),case_status:options("case_status"),case_type:options("matter_type")}} onAction={mioWdBlockAction} getPeople={mioWdBlockPeople}','withdrawal-only settings')
 code=once(code,'financeRows={mioWdFinanceRows()}','getFinanceRows={mioWdFinanceRows}','selected metric data')
 return{code,map:null}
}}}
