function replaceIfPresent(code, from, to) {
  return code.includes(from) ? code.replace(from, to) : code
}

export default function mioV311WithdrawalRowControls() {
  return {
    name: 'mio-v311-withdrawal-row-controls',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      let code = source

      if (path.endsWith('/src/mioWorkflowBlocks.js')) {
        code = replaceIfPresent(
          code,
          "export function applyWorkflowBlockEvent(current,e,at=stamp()){\n if(e.type==='workflow_configure')",
          "export function applyWorkflowBlockEvent(current,e,at=stamp()){\n if(e.type==='workflow_complete'){\n  if(!current?.definition)return null\n  if(current.status==='complete')return current\n  if(current.status!=='active')throw new Error('Only an active withdrawal can be completed.')\n  if(!e.confirmed)throw new Error('Confirm completion of the withdrawal row.')\n  const s=copy(current),note=String(e.note||'Attorney marked the withdrawal workflow complete from the row control.')\n  for(const d of s.definition.steps){const t=s.steps[d.id];if(done(t))continue;if(d.action==='finish')patchStep(s,d.id,{status:'complete',note,evidence:{reference:note}},at);else patchStep(s,d.id,{status:'cancelled',note:'Closed when the attorney marked the entire withdrawal row complete.'},at)}\n  s.status='complete';s.completed_at=at;s.completion_note=note;return s\n }\n if(e.type==='workflow_configure')"
        )
        return { code, map: null }
      }

      if (path.endsWith('/src/App.jsx')) {
        const releaseAdapter = `  async function mioWdReleaseV311(matterId){
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)throw new Error('Matter not found.')
    if(!window.confirm('Release '+matterClientName(matter)+' - '+matter.name+' from withdrawal status? The withdrawal workflow history will be preserved, but the matter will no longer be treated as an active withdrawal.'))return
    let state=mioWithdrawalStore.getSnapshot().rows[matterId]?.state
    if(!state){await mioWithdrawalStore.initialize(session.user.id,String(matterId),matterExtraInfoById[matterId]?.withdrawal_entered_at||null);state=mioWithdrawalStore.getSnapshot().rows[matterId]?.state}
    if(state?.status==='active')await mioWithdrawalStore.apply(session.user.id,String(matterId),{type:'workflow_release',confirmed:true,note:'Attorney released matter from withdrawal status from the withdrawal page.'})
    const extra={...matterExtraInfoById,[matterId]:{...cloneMatterExtraInfo(matterExtraInfoById[matterId]||{}),withdrawal_status:'',withdrawal_released_at:new Date().toISOString()}}
    try{await saveMioStateKeyNow('caseControllerMatterExtraInfo',JSON.stringify(extra),{throwOnError:true});setMatterExtraInfoById(extra)}catch(error){setMioWithdrawalIntegrationError('Withdrawal was released and saved. The older matter-extra status could not sync because another tab changed it: '+(error.message||error)+'. The saved workflow release remains authoritative.')}
    if(mioWdFocusMatter===String(matterId))setMioWdFocusMatter('')
  }
`
        if (!code.includes('async function mioWdReleaseV311(')) code = replaceIfPresent(code, '  async function mioWdPrepareEfile', releaseAdapter + '  async function mioWdPrepareEfile')

        const statusAdapter = `  async function mioWdChangeMatterStatus(matterId,nextStatus){
    const matter=matters.find(m=>String(m.id)===String(matterId));if(!matter)throw new Error('Matter not found.')
    const value=String(nextStatus||'').trim(),allowed=options('matter_status').map(o=>o.name)
    if(!value||!allowed.includes(value))throw new Error('Choose a valid matter status from Settings.')
    if(matter.matter_status===value)return matter
    let query=supabase.from('matters').update({matter_status:value}).eq('id',matterId)
    query=matter.matter_status==null?query.is('matter_status',null):query.eq('matter_status',matter.matter_status)
    const{data,error}=await query.select('id,matter_status').single()
    if(error||data?.matter_status!==value)throw new Error(error?.message||'The matter changed in another window. Reload before changing its status.')
    await fetchMatters();return data
  }
`
        if (!code.includes('async function mioWdChangeMatterStatus(')) code = replaceIfPresent(code, '  async function mioWdBlockAction(matterId,step,state){', statusAdapter + '  async function mioWdBlockAction(matterId,step,state){')

        code = replaceIfPresent(code, 'onRelease={mioWdRelease}', 'onRelease={mioWdReleaseV311}')
        code = replaceIfPresent(code, 'onAction={mioWdBlockAction} getPeople={mioWdBlockPeople}', 'onAction={mioWdBlockAction} onMatterStatus={mioWdChangeMatterStatus} getPeople={mioWdBlockPeople}')
        code = code.replaceAll('Mio V309 (multi-file eService + document sources)', 'Mio V311 (withdrawal rows + matter status)')
        return { code, map: null }
      }

      if (!path.endsWith('/src/MioWithdrawalBlocks.jsx')) return null

      code = replaceIfPresent(code, 'onAction,getPeople,initialExpanded', 'onAction,onMatterStatus,getPeople,initialExpanded')
      code = replaceIfPresent(code, 'const tableFinance=[...graphFinance].sort(', 'const tableFinance=[...matchingFinance].sort(')
      code = replaceIfPresent(
        code,
        "Review {graphFinance.length} matters shown on graph{matchingFinance.length>graphFinance.length?' of '+matchingFinance.length+' matching filters':''} / change withdrawal status",
        "Review {matchingFinance.length} matching matters{matchingFinance.length>graphFinance.length?' (graph shows first '+graphFinance.length+')':''} / change withdrawal status"
      )
      code = replaceIfPresent(
        code,
        " const close=()=>{if(!busy)setEditor(null)}",
        " const close=()=>{if(!busy)setEditor(null)}\n const openMatterStatus=row=>setEditor({type:'matter_status',title:'Change matter status',matter:String(row.matter_id),matterName:[row.client,row.name].filter(Boolean).join(' - '),value:row.matter_status||'',current:row.matter_status||''})"
      )
      code = replaceIfPresent(code, "<th aria-sort={sortAria('withdrawal')}>", "<th>Matter status</th><th aria-sort={sortAria('withdrawal')}>")
      code = replaceIfPresent(
        code,
        '<td>{day(r.last_invoice_sent)}</td><td><button type="button" disabled={busy||r.complete&&!r.withdrawing}',
        '<td>{day(r.last_invoice_sent)}</td><td><span>{r.matter_status||\'Not set\'}</span> <button type="button" disabled={busy} onClick={()=>openMatterStatus(r)}>Change status</button></td><td><button type="button" disabled={busy||r.complete&&!r.withdrawing}'
      )
      code = replaceIfPresent(
        code,
        '<th>Matter / client</th><th>Status</th><th>Next action / what is needed</th><th>Pending</th><th>In withdrawal</th><th>Open</th>',
        '<th>Matter / client</th><th>Status</th><th>Next action / what is needed</th><th>Pending</th><th>In withdrawal</th><th>Matter status</th><th>Open</th>'
      )
      code = replaceIfPresent(
        code,
        '<td>{ageLabel(row.state?.started_at,now)}</td><td><button type="button" aria-expanded={expanded===row.matter_id}',
        '<td>{ageLabel(row.state?.started_at,now)}</td><td><span>{row.matter_status||\'Not set\'}</span> <button type="button" disabled={busy} onClick={e=>{e.stopPropagation();openMatterStatus(row)}}>Change status</button></td><td><button type="button" aria-expanded={expanded===row.matter_id}'
      )
      code = replaceIfPresent(code, 'className="mio-block-expanded"><td colSpan={6}', 'className="mio-block-expanded"><td colSpan={7}')
      code = replaceIfPresent(
        code,
        `<button type="button" disabled={!rowEditable(row)} onClick={()=>run(async()=>{const final=row.state.definition.steps.find(s=>s.action==='finish');if(!final)throw new Error('Add a Complete workflow action to this process first.');setSelectedId(final.id);await complete(row,final)})}>Mark complete</button>`,
        `<button type="button" disabled={!rowEditable(row)} onClick={e=>{e.stopPropagation();run(async()=>{if(!window.confirm('Mark this entire withdrawal workflow complete? Unfinished workflow steps will be closed as not active; no filing, email, signature, or court action will be performed.'))return;await mutate(row.matter_id,{type:'workflow_complete',confirmed:true,note:'Attorney marked the withdrawal workflow complete from the row control.'});setMessage('Withdrawal marked complete.');if(expanded===row.matter_id)setExpanded('')})}}>Mark complete</button>`
      )
      code = replaceIfPresent(
        code,
        '<button type="button" disabled={busy||row.state.status!==\'active\'} onClick={()=>run(()=>onRelease(row.matter_id))}>Release from withdrawal</button>',
        '<button type="button" disabled={busy||row.state.status!==\'active\'} onClick={e=>{e.stopPropagation();run(()=>onRelease(row.matter_id))}}>Release from withdrawal</button>'
      )
      code = replaceIfPresent(
        code,
        "{editor.type==='builder'&&editorState&&",
        `{editor.type==='matter_status'&&<><p><strong>{editor.matterName}</strong></p><label>Matter status<select value={editor.value} onChange={e=>setEditor({...editor,value:e.target.value})}><option value="">Select matter status</option>{(optionLists.matter_status||[]).map(o=><option key={o.id||o.name} value={o.name}>{o.name}</option>)}</select></label><button type="button" className="mio-block-primary" disabled={busy||!editor.value||editor.value===editor.current||!onMatterStatus} onClick={()=>run(async()=>{await onMatterStatus(editor.matter,editor.value);setMessage('Matter status changed to '+editor.value+'.');setEditor(null)})}>Save matter status</button></>}\n {editor.type==='builder'&&editorState&&`
      )
      return { code, map: null }
    }
  }
}
