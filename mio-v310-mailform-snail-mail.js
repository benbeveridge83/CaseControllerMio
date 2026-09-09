function once(code, from, to, label) {
  const first = code.indexOf(from)
  if (first < 0 || code.indexOf(from, first + from.length) >= 0) throw new Error('V310 Mailform integration anchor changed: ' + label)
  return code.replace(from, to)
}

export default function mioV310MailformSnailMail() {
  return {
    name: 'mio-v310-mailform-snail-mail',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')

      if (path.endsWith('/src/mioWorkflowBlocks.js')) {
        let code = source
        if (code.includes("id:'mailform'")) return { code, map: null }
        const efileAction = " {id:'efile_document',label:'E-file document',button:'Prepare e-filing',module:'efile',input:true},"
        code = once(
          code,
          efileAction,
          efileAction + "\n {id:'mailform',label:'Send by snail mail (Mailform)',button:'Prepare snail mail',module:'mail_center',input:true},",
          'workflow Mailform action'
        )
        return { code, map: null }
      }

      if (!path.endsWith('/src/App.jsx')) return null
      let code = source
      if (code.includes('Mio V310 (Mailform snail mail + workflow block)')) return { code, map: null }

      code = code.replaceAll('Mail Center', 'Snail Mail')
      code = code.replace('Mio V309 (multi-file eService + document sources)', 'Mio V310 (Mailform snail mail + workflow block)')

      code = once(
        code,
        "    setPostalForm((current) => ({ ...current, matter_id: matterId, recipient_source: client ? 'client' : 'custom', document_ids: [], approved_to_send: false, ...recipient }))",
        "    setPostalForm((current) => ({ ...current, matter_id: matterId, recipient_source: client ? 'client' : 'custom', document_ids: [], approved_to_send: false, workflow_matter_id: '', workflow_step_id: '', ...recipient }))",
        'clear workflow binding on manual matter selection'
      )

      const emailActionAnchor = "    if(['draft_email','esign_document'].includes(step.action)){"
      const mailformAction = `    if(step.action==='mailform'){
      const documentIds=[]
      for(const input of inputs){
        const doc=documents.find(d=>String(d.id)===String(input.document_id)&&String(d.matter_id)===String(matterId))
        if(!doc)throw new Error('A selected snail-mail input document is missing from this matter.')
        const name=doc.file_name||doc.original_file_name||doc.name||''
        if(!(/\\.pdf$/i.test(name)||/pdf/i.test(String(doc.file_type||doc.mime_type||''))))throw new Error('Snail Mail requires PDF input documents. Convert '+(name||'the selected document')+' to PDF first.')
        documentIds.push(String(doc.id))
      }
      postalSelectMatter(matterId)
      setPostalTab('compose');setPostalMessage('');setPostalQuote(null);setPostalPreparedFile(null);setPostalUploadFile(null)
      setPostalForm(current=>({...current,matter_id:String(matterId),document_ids:documentIds,purpose:step.name||current.purpose||'General correspondence',approved_to_send:false,workflow_matter_id:String(matterId),workflow_step_id:step.id}))
      setPage('mail_center');return
    }
${emailActionAnchor}`
      code = once(code, emailActionAnchor, mailformAction, 'workflow action adapter')

      const postalMessageLine = "      setPostalMessage(order.test_mode ? 'Test mailing submitted. Mailform test-mode orders are automatically cancelled and do not incur mailing charges.' : 'Mailing submitted to Mailform.')"
      code = once(
        code,
        postalMessageLine,
        `      let workflowNote = ''
      if (postalForm.workflow_matter_id && postalForm.workflow_step_id) {
        if (order.test_mode) {
          workflowNote = ' Test order only; the linked workflow step was not completed.'
        } else {
          try {
            const workflowState = mioWithdrawalStore.getSnapshot().rows[String(postalForm.workflow_matter_id)]?.state
            const workflowStep = workflowState?.definition?.steps.find((item) => item.id === postalForm.workflow_step_id)
            const missingOutputs = (workflowStep?.output_slots || []).filter((slotId) => !resolveWorkflowSlot(workflowState, slotId)?.verified)
            if (workflowStep && !missingOutputs.length) {
              await mioWithdrawalStore.apply(session.user.id, String(postalForm.workflow_matter_id), {
                type: 'step_update', step_id: postalForm.workflow_step_id, status: 'complete', confirmed: true,
                note: 'Mailform live mailing submitted and recorded by Mio.',
                evidence: { reference: 'Mailform order ' + String(order.id || record.id) }
              })
              workflowNote = ' Linked workflow step marked complete.'
            } else if (workflowStep) {
              workflowNote = ' Mailing sent; return to the workflow to attach its required output document(s) before completing the step.'
            }
          } catch (workflowError) {
            workflowNote = ' Mailing sent; workflow completion needs review: ' + (workflowError?.message || String(workflowError))
          }
        }
      }
      setPostalMessage((order.test_mode ? 'Test mailing submitted. Mailform test-mode orders are automatically cancelled and do not incur mailing charges.' : 'Mailing submitted to Mailform.') + workflowNote)`,
        'workflow completion after provider submission'
      )

      code = once(
        code,
        "      setPostalForm((current) => ({ ...current, approved_to_send: false, document_ids: [] }))",
        "      setPostalForm((current) => ({ ...current, approved_to_send: false, document_ids: [], workflow_matter_id: '', workflow_step_id: '' }))",
        'clear workflow binding after submission'
      )

      return { code, map: null }
    }
  }
}
