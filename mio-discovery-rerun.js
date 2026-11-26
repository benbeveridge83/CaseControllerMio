export function mountDiscoveryRerun(input){
 let source=input
 const patch=(from,to)=>{if(!source.includes(from))throw new Error('Discovery rerun anchor missing: '+from.slice(0,100));source=source.replace(from,to)}
 const helper=`
  const respondingDiscoveryRerunRef = React.useRef(respondingDiscoverySets)
  respondingDiscoveryRerunRef.current = respondingDiscoverySets
  async function rerunRespondingDiscoveryExtraction(setId, options = {}) {
    const set = respondingDiscoveryRerunRef.current.find(item => item.id === setId)
    if (!set) throw new Error('Discovery set no longer available.')
    const target = options.requestId ? (set.requests || []).find(item => item.id === options.requestId) : null
    if (options.requestId && !target) throw new Error('Request no longer available.')
    let rawText = ''
    if (options.source === 'document') {
      const doc = documents.find(item => String(item.id) === String(set.document_id) && String(item.matter_id) === String(set.matter_id))
      if (!doc) throw new Error('The original document is unavailable. Choose saved request text or paste the source text.')
      const result = await extractDocumentTextForAi(doc)
      rawText = result?.extracted_text || ''
    } else if (options.source === 'paste') rawText = String(options.text || '')
    else rawText = target ? target.request_text || '' : (set.requests || []).map((item,index) => String(item.request_number || index + 1) + '. ' + (item.request_text || '')).join('\\n\\n')
    if (!rawText.trim()) throw new Error('No source text is available to extract.')
    const result = await callRespondingDiscoveryExtractionApi(rawText, set.discovery_type, set.title || '')
    let items = result?.requests || []
    if (target && options.source === 'document') {
      items = items.filter(item => String(item.request_number) === String(target.request_number || (set.requests || []).indexOf(target) + 1))
      if (!items.length) throw new Error('That request number was not found in the original document. Choose the current block or paste numbered text instead.')
    }
    if (!items.length) throw new Error('No individual numbered requests were recognized. Nothing was changed. Try the original document or paste numbered source text.')
    const protectedIds = new Set()
    let portalCheckUnavailable = false
    try {
      const portal = await portalStaffApi('staff_discovery_list', {matter_id: set.matter_id})
      const released = (portal.sets || []).find(item => item.source_set_id === set.id)
      for (const answer of released?.answers || []) if (answer.version > 0 || answer.needs_help || ['client_answer','client_comments','rfp_status','attorney_response'].some(key => String(answer[key] || '').trim())) protectedIds.add(answer.request_id)
      for (const file of released?.files || []) protectedIds.add(file.request_id)
    } catch {
      portalCheckUnavailable = true
      for (const item of set.requests || []) protectedIds.add(item.id)
    }
    return {items, protectedIds: [...protectedIds], portalCheckUnavailable}
  }
  async function applyRespondingDiscoveryReextraction(setId, plan) {
    const current = respondingDiscoveryRerunRef.current
    const set = current.find(item => item.id === setId)
    if (!set) throw new Error('Discovery set no longer available.')
    const replacement = applyReextractionPlan(set, plan)
    const retainedIds = new Set(replacement.requests.map(item => item.id))
    const removedIds = new Set((set.requests || []).filter(item => !retainedIds.has(item.id)).map(item => item.id))
    if (removedIds.size) {
      const portal = await portalStaffApi('staff_discovery_list', {matter_id:set.matter_id})
      const released = (portal.sets || []).find(item => item.source_set_id === set.id)
      if ((released?.answers || []).some(answer => removedIds.has(answer.request_id) && (answer.version > 0 || answer.needs_help || ['client_answer','client_comments','rfp_status','attorney_response'].some(key => String(answer[key] || '').trim()))) || (released?.files || []).some(file => removedIds.has(file.request_id))) throw new Error('Client work changed while this preview was open. Rerun extraction so those answers and files are retained.')
      if (JSON.stringify(respondingDiscoveryRerunRef.current.find(item => item.id === setId)?.requests || []) !== plan.baseline) throw new Error('The requests changed while this preview was open. Rerun extraction to review the latest version.')
    }
    const latest = respondingDiscoveryRerunRef.current
    const latestSet = latest.find(item => item.id === setId)
    if (!latestSet) throw new Error('Discovery set no longer available.')
    const next = latest.map(item => item.id === setId ? applyReextractionPlan(latestSet, plan) : item)
    respondingDiscoveryRerunRef.current = next
    setRespondingDiscoverySets(next)
    safeSetLocalStorage('caseMioRespondingDiscoverySets', JSON.stringify(next))
    try { await saveMioStateKeyNow('caseMioRespondingDiscoverySets', JSON.stringify(next), {throwOnError:true}) }
    catch (error) { throw new Error('Extraction was applied locally, but cloud saving needs attention. Your changes are preserved. Check the save-status panel: ' + (error?.message || error)) }
  }

`
 patch('  async function addRespondingDiscoverySet(e) {',helper+'  async function addRespondingDiscoverySet(e) {')
 const add='<button type="button" onClick={() => addRespondingDiscoveryRequest(activeSet.id)}>+ Add request</button>'
 patch(add,add+'<DiscoveryReextract key={activeSet.id} set={activeSet} onExtract={rerunRespondingDiscoveryExtraction} onApply={applyRespondingDiscoveryReextraction} />')
 const text='<textarea value={request.request_text || \'\'} onChange={(e) => updateRespondingDiscoveryRequest(activeSet.id, request.id, { request_text: e.target.value })} style={{ width: \'100%\', minHeight: 76 }} />\n                    </LabeledField>'
 patch(text,text+'\n                    {request.extraction_review_note && <p role="status" style={{background:"#fff4d6",padding:8}}>{request.extraction_review_note}</p>}\n                    <DiscoveryReextract key={request.id} set={activeSet} request={request} onExtract={rerunRespondingDiscoveryExtraction} onApply={applyRespondingDiscoveryReextraction} />')
 return "import DiscoveryReextract from './discovery/DiscoveryReextract.jsx'\nimport {applyReextractionPlan} from './discovery/reextraction.js'\n"+source
}
