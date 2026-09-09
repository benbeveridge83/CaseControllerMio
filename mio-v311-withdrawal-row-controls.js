// Guard the real, post-V307/post-V310 source. A partial feature is not a release.
function once(code, from, to, label) {
  const i=code.indexOf(from)
  if(i<0||code.indexOf(from,i+from.length)>=0)throw new Error('V311 integration anchor changed: '+label)
  return code.replace(from,()=>to)
}
const completionEvent = `
 if(e.type==='workflow_complete'){
  if(!current?.definition)return null
  if(current.status==='complete')return current
  if(current.status!=='active'||current.paused)throw new Error('Resume an active withdrawal before closing the row.')
  if(!e.confirmed||!String(e.note||'').trim())throw new Error('Confirm closure of the entire withdrawal row.')
  // Administrative row closure is not evidence that any court or delivery step happened.
  return {...current,status:'complete',paused:false,paused_at:null,completed_at:at,completion_mode:'manual_row',completion_note:String(e.note)}
 }
`
const releaseAdapter = `  async function mioWdRelease(matterId){
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)throw new Error('Matter not found.')
    if(!window.confirm('Release '+matterClientName(matter)+' - '+matter.name+' from withdrawal? The workflow and all step history will be retained. Nothing is sent, filed or cancelled with the court.'))return false
    const entry=await mioWithdrawalStore.initialize(session.user.id,String(matterId),matterExtraInfoById[matterId]?.withdrawal_entered_at||null)
    if(entry.state.status==='active')await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'workflow_release',confirmed:true,note:'Attorney released matter from withdrawal on the withdrawal page.'})
    // The per-matter workflow is authoritative. Do not rewrite the entire shared
    // matter-extra map: unrelated edits in other tabs must not block this action.
    if(mioWdFocusMatter===String(matterId))setMioWdFocusMatter('')
    return true
  }
`
const statusAdapter = `  async function mioWdChangeMatterStatus(matterId,nextStatus){
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)throw new Error('Matter not found.')
    const value=String(nextStatus||'').trim()
    if(!options('matter_status').some(o=>o.name===value))throw new Error('Choose a matter status from Settings.')
    if(matter.matter_status===value)return matter
    let query=supabase.from('matters').update({matter_status:value}).eq('id',matterId)
    query=matter.matter_status==null?query.is('matter_status',null):query.eq('matter_status',matter.matter_status)
    const {data,error}=await query.select('id,matter_status').single()
    if(error||data?.matter_status!==value)throw new Error(error?.message||'The matter changed in another window. Refresh before retrying.')
    setMatters(current=>current.map(m=>String(m.id)===String(matterId)?{...m,matter_status:value}:m))
    return data
  }
`
export default function mioV311WithdrawalRowControls(){return{
 name:'mio-v311-withdrawal-row-controls',enforce:'pre',transform(source,id){
  const path=id.split('?')[0].replaceAll('\\','/');let code=source
  if(path.endsWith('/src/mioWorkflowBlocks.js')){
   const anchor='export function applyWorkflowBlockEvent(current,e,at=stamp()){'
   return {code:once(code,anchor,anchor+completionEvent,'row closure event'),map:null}
  }
  if(path.endsWith('/src/mioWithdrawalRepository.js')){
   return {code:once(code,"client.rpc(state.definition||", "client.rpc(event.type==='workflow_complete'?'mio_close_withdrawal_row_v311':state.definition||",'row closure RPC'),map:null}
  }
  if(path.endsWith('/src/App.jsx')){
   const begin=code.indexOf('  async function mioWdRelease(matterId){'),end=code.indexOf('  async function mioWdPrepareEfile',begin)
   if(begin<0||end<0)throw new Error('V311 release adapter missing')
   code=code.slice(0,begin)+releaseAdapter+code.slice(end)
   code=once(code,'    const saved = matterExtraFor(matterId).withdrawal_status',`    const workflowStatus=mioWithdrawalSnapshot.rows[String(matterId)]?.state?.status
    if(['released','complete'].includes(workflowStatus))return 'not_withdrawing'
    const saved = matterExtraFor(matterId).withdrawal_status`,'authoritative saved workflow status')
   code=once(code,'  async function mioWdBlockAction(matterId,step,state){',statusAdapter+'  async function mioWdBlockAction(matterId,step,state){','status adapter')
   code=once(code,'onAction={mioWdBlockAction}', 'onAction={mioWdBlockAction} onMatterStatus={mioWdChangeMatterStatus}','status callback')
   code=once(code,'Mio V310 (Mailform snail mail + workflow block)','Mio V311 (withdrawal rows + matter status)','verified release label')
   return{code,map:null}
  }
  if(!path.endsWith('/src/MioWithdrawalBlocks.jsx'))return null
  code=once(code,'onAction,getPeople,','onAction,onMatterStatus,getPeople,','post-V307 props')
  code=once(code,'const tableFinance=[...graphFinance].sort(','const tableFinance=[...matchingFinance].sort(','all matching table rows')
  code=once(code,"Review {graphFinance.length} matters shown on graph{matchingFinance.length>graphFinance.length?' of '+matchingFinance.length+' matching filters':''} / change withdrawal status","Review all {matchingFinance.length} matching matters / change status",'full table count')
  code=once(code," const close=()=>{if(!busy)setEditor(null)}",` const close=()=>{if(!busy)setEditor(null)}
 const openMatterStatus=row=>{setError('');setEditor({type:'matter_status',title:'Change matter status',matter:String(row.matter_id),matterName:[row.client,row.name].filter(Boolean).join(' - '),value:row.matter_status||'',current:row.matter_status||''})}`,'status editor')
  code=once(code,"<th aria-sort={sortAria('withdrawal')}>","<th>Matter status</th><th aria-sort={sortAria('withdrawal')}>",'candidate status header')
  code=once(code,'<td>{day(r.last_invoice_sent)}</td><td><button','<td>{day(r.last_invoice_sent)}</td><td><span>{r.matter_status||\'Not set\'}</span> <button type="button" disabled={busy} onClick={()=>openMatterStatus(r)}>Change status</button></td><td><button','candidate status control')
  code=once(code,'<th>In withdrawal</th><th>Open</th>','<th>In withdrawal</th><th>Matter status</th><th>Open</th>','workflow status header')
  code=once(code,'<td>{ageLabel(row.state?.started_at,now)}</td><td><button','<td>{ageLabel(row.state?.started_at,now)}</td><td><span>{row.matter_status||\'Not set\'}</span> <button type="button" disabled={busy} onClick={e=>{e.stopPropagation();openMatterStatus(row)}}>Change status</button></td><td><button','workflow status control')
  code=code.replaceAll('colSpan={6}','colSpan={7}')
  code=once(code,`<button type="button" disabled={!rowEditable(row)} onClick={()=>run(async()=>{const final=row.state.definition.steps.find(s=>s.action==='finish');if(!final)throw new Error('Add a Complete workflow action to this process first.');setSelectedId(final.id);await complete(row,final)})}>Mark complete</button>`,
   `<button type="button" disabled={!rowEditable(row)} onClick={e=>{e.stopPropagation();run(async()=>{if(!window.confirm('Mark this entire withdrawal row complete? This closes the tracking process and retains every step as history. It does NOT confirm that unfinished work was done, change the matter status, or send, file, sign or cancel anything with the court.'))return;await mutate(row.matter_id,{type:'workflow_complete',confirmed:true,note:'Attorney closed the withdrawal tracking row. Prior step history retained; no external action inferred.'});setMessage('Withdrawal row completed and saved to Supabase. Step history retained.');setExpanded('')})}}>Mark complete</button>`,'whole-row completion')
  code=once(code,'onClick={()=>run(()=>onRelease(row.matter_id))}>Release from withdrawal',`onClick={e=>{e.stopPropagation();run(async()=>{if(await onRelease(row.matter_id)){setMessage('Released from withdrawal and saved to Supabase.');setExpanded('')}})}}>Release from withdrawal`,'release feedback')
  code=once(code,"{editor.type==='builder'&&editorState&&",`{editor.type==='matter_status'&&<><p><strong>{editor.matterName}</strong></p><label>Matter status<select aria-label="Matter status" value={editor.value} onChange={e=>setEditor({...editor,value:e.target.value})}><option value="">Select matter status</option>{(optionLists.matter_status||[]).map(o=><option key={o.id||o.name} value={o.name}>{o.name}</option>)}</select></label><button type="button" className="mio-block-primary" disabled={busy||!editor.value||editor.value===editor.current} onClick={()=>run(async()=>{await onMatterStatus(editor.matter,editor.value);setMessage('Matter status saved: '+editor.value);setEditor(null)})}>Save matter status</button></>}
 {editor.type==='builder'&&editorState&&`,'status dialog')
  code=once(code,'<span>{row.state.status===\'complete\'?\'Process complete\'', '<span>{row.state.status===\'complete\'? (row.state.completion_mode===\'manual_row\'?\'Closed by attorney - step history retained\':\'Process complete\')','manual closure label')
  code=once(code,'return <main className="mio-blocks">',`return <main className="mio-blocks">{!editor&&(error||message)&&<div role={error?'alert':'status'} className={error?'mio-block-error':'mio-block-success'} style={{position:'fixed',bottom:130,right:20,zIndex:90,maxWidth:520,padding:12,background:'white',border:'1px solid',borderRadius:6}}>{error||message}<button type="button" onClick={()=>{setError('');setMessage('')}}>Dismiss</button></div>}`,'visible action result')
  return{code,map:null}
 }
}}
