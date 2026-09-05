// Mio V286: clean drafting page + matter-backed missing-data entry.
// Uses String.raw for injected code so regex/newline escapes survive the transform safely.
function one(code, from, to, label) {
  const at = code.indexOf(from)
  if (at < 0) throw new Error('V286 anchor missing: ' + label)
  return code.replace(from, to)
}

export default function mioV286DraftingReadinessCleanup() {
  return {
    name: 'mio-v286-drafting-readiness-cleanup',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      code = one(code, "const MIO_APP_VERSION = 'Mio V284 (structural template editor)'", "const MIO_APP_VERSION = 'Mio V286 (draft readiness)'", 'version')

      // Existing/stale smart-block markers must never appear as ordinary drafting questions.
      code = one(code,
        "    const draftingApplicableFields = (template?.fields || []).filter(draftingFieldIsApplicable)",
        "    const draftingApplicableFields = (template?.fields || []).filter((field) => !/MIO_BLOCK/i.test(String(field?.key || '') + ' ' + String(field?.label || '') + ' ' + String(field?.default_value || ''))).filter(draftingFieldIsApplicable)",
        'applicable fields')

      // Do not create new AI fill-in suggestions for Mio structural markers.
      const suggestionAnchor = "    Array.from(placeholderMap.values()).slice(0, 350).forEach(({ paragraph, sourceText }) => {\n      const field = draftingStudioPlaceholderDefinition(sourceText)"
      if (code.includes(suggestionAnchor)) {
        code = code.replace(suggestionAnchor, "    Array.from(placeholderMap.values()).slice(0, 350).forEach(({ paragraph, sourceText }) => {\n      if (/MIO_BLOCK:/i.test(String(sourceText || ''))) return\n      const field = draftingStudioPlaceholderDefinition(sourceText)")
      }

      // Matter-level drafting facts are a fallback for the normal People/Litigation Party model.
      code = one(code,
        "  function draftingPetitionerName(matter) {\n    const clientRole = draftingClientRoleForMatter(matter)",
        "  function draftingPetitionerName(matter) {\n    const savedDraftingName = matterExtraFor(matter?.id)?.drafting_facts?.petitioner_name\n    if (savedDraftingName) return savedDraftingName\n    const clientRole = draftingClientRoleForMatter(matter)",
        'petitioner')
      code = one(code,
        "  function draftingRespondentName(matter) {\n    const clientRole = draftingClientRoleForMatter(matter)",
        "  function draftingRespondentName(matter) {\n    const savedDraftingName = matterExtraFor(matter?.id)?.drafting_facts?.respondent_name\n    if (savedDraftingName) return savedDraftingName\n    const clientRole = draftingClientRoleForMatter(matter)",
        'respondent')

      const childFunction = String.raw`  function draftingChildrenForMatter(matter) {
    if (!matter) return []
    const direct = Array.isArray(matter.children) ? matter.children : []
    const litigation = matterExtraFor(matter.id)?.litigation_parties || []
    return [...direct, ...litigation.filter((party) => /child|minor/i.test(String(party.role || '')))].map((item) => ({
      name: item.name || draftingPersonFullName(item),
      age: item.age || item.date_of_birth || item.dob || ''
    })).filter((item) => item.name)
  }`
      const childReplacement = String.raw`  function draftingChildrenForMatter(matter) {
    if (!matter) return []
    const extra = matterExtraFor(matter.id) || {}
    const saved = Array.isArray(extra.drafting_facts?.children) ? extra.drafting_facts.children : []
    const direct = Array.isArray(matter.children) ? matter.children : []
    const litigation = extra.litigation_parties || []
    const source = saved.length ? saved : [...direct, ...litigation.filter((party) => /child|minor/i.test(String(party.role || '')))]
    return source.map((item) => ({
      name: item.name || draftingPersonFullName(item),
      age: item.age || item.date_of_birth || item.dob || ''
    })).filter((item) => item.name)
  }`
      code = one(code, childFunction, childReplacement, 'children')

      const stateAnchor = "  const [draftingWordRangeSelection, setDraftingWordRangeSelection] = useState({ anchor: -1, start: -1, end: -1 })"
      code = one(code, stateAnchor, stateAnchor + "\n  const [draftingMatterQuickSaveStatus, setDraftingMatterQuickSaveStatus] = useState('')", 'readiness state')

      const helpers = String.raw`  function mioDraftingQuickValue(key, fallback = '') {
    const value = draftingSelection.field_values?.[key]
    return value == null || value === '' ? String(fallback || '') : String(value)
  }

  function mioDraftingChildrenStatus(matter) {
    const extra = matterExtraFor(matter?.id) || {}
    if (draftingChildrenForMatter(matter).length) return 'yes'
    return extra.drafting_facts?.children_status || ''
  }

  function mioDraftingReadinessIssues(template, matter, data, fieldValues = {}) {
    const normal = draftingPreflightIssues(template, matter, data, fieldValues).filter((issue) => issue.level === 'error')
    const extra = []
    const style = draftingResolveCaseStyle(template, matter, fieldValues)
    const kind = String(style?.kind || '').toLowerCase()
    if (kind === 'divorce' && !data.children_names && !mioDraftingChildrenStatus(matter)) extra.push({ level: 'error', message: 'Confirm whether this divorce includes children.' })
    return [...normal, ...extra]
  }

  async function mioSaveDraftingMatterFacts(matter, data) {
    if (!matter?.id) return
    const values = draftingSelection.field_values || {}
    const petitioner = String(values.petitioner_name ?? data?.petitioner_name ?? '').trim()
    const respondent = String(values.respondent_name ?? data?.respondent_name ?? '').trim()
    const childrenStatus = String(values.drafting_children_status || mioDraftingChildrenStatus(matter) || '').trim()
    const childText = String(values.drafting_children_quick ?? data?.children_names ?? '').trim()
    const children = childText.split(/\n|;/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split('|').map((part) => part.trim())
      return { name: parts[0] || '', date_of_birth: parts[1] || '' }
    }).filter((child) => child.name)
    const current = cloneMatterExtraInfo(matterExtraInfoById[matter.id] || {})
    let parties = Array.isArray(current.litigation_parties) ? current.litigation_parties.map((party, index) => ensureLitigationPartyShape(party, matter.id, index)) : []
    const upsert = (pattern, role, name) => {
      if (!name) return
      const index = parties.findIndex((party) => pattern.test(String(party.role || party.party_type || party.type || '')))
      const next = ensureLitigationPartyShape({ ...(index >= 0 ? parties[index] : {}), name, role }, matter.id, index >= 0 ? index : parties.length)
      if (index >= 0) parties[index] = next
      else parties.push(next)
    }
    upsert(/petitioner|movant|applicant/i, 'Petitioner', petitioner)
    upsert(/respondent/i, 'Respondent', respondent)
    if (childrenStatus === 'yes') {
      parties = parties.filter((party) => !/child|minor/i.test(String(party.role || party.party_type || party.type || '')))
      children.forEach((child) => parties.push(ensureLitigationPartyShape({ ...child, role: 'Child' }, matter.id, parties.length)))
    }
    const facts = {
      ...(current.drafting_facts || {}),
      petitioner_name: petitioner,
      respondent_name: respondent,
      children_status: childrenStatus,
      children: childrenStatus === 'yes' ? children : []
    }
    const nextExtra = syncOpposingPartiesFromLitigationParties({ ...current, drafting_facts: facts, litigation_parties: parties }, matter.id)
    const nextAll = { ...matterExtraInfoById, [matter.id]: nextExtra }
    setMatterExtraInfoById(nextAll)
    setDraftingMatterQuickSaveStatus('Saving to matter...')
    try {
      await saveMioStateKeyNow('caseControllerMatterExtraInfo', JSON.stringify(nextAll), { throwOnError: true })
      setDraftingMatterQuickSaveStatus('Saved to matter.')
      setDraftingGeneratedFiles([])
      setDraftingOutput('')
    } catch (error) {
      setDraftingMatterQuickSaveStatus('Could not save: ' + (error?.message || error))
    }
  }

  function renderMioDraftingReadiness(template, matter, data, fieldValues = {}) {
    if (!matter || !data) return null
    const blockers = mioDraftingReadinessIssues(template, matter, data, fieldValues)
    const ready = blockers.length === 0
    const style = draftingResolveCaseStyle(template, matter, fieldValues)
    const kind = String(style?.kind || '').toLowerCase()
    const childrenStatus = mioDraftingQuickValue('drafting_children_status', mioDraftingChildrenStatus(matter))
    const childRequired = ['sapcr','habeas'].includes(kind) || (kind === 'divorce' && childrenStatus === 'yes')
    return <section style={{ border: '2px solid ' + (ready ? '#16a34a' : '#dc2626'), borderRadius: 12, padding: 14, background: ready ? '#f0fdf4' : '#fff7ed' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, flexWrap: 'wrap' }}>
        <div><h3 style={{ margin: 0 }}>{ready ? 'Ready to generate' : 'Required before generating'}</h3><div style={{ color: '#475569', marginTop: 3 }}>{ready ? 'All required information is available.' : 'Complete the items below. Values saved here become matter data and are reused in future drafts.'}</div></div>
        <span style={{ borderRadius: 999, padding: '5px 10px', fontWeight: 900, background: ready ? '#dcfce7' : '#fee2e2', color: ready ? '#166534' : '#991b1b' }}>{ready ? 'READY' : blockers.length + ' REQUIRED'}</span>
      </div>
      {!ready && <div style={{ marginTop: 9, display: 'grid', gap: 3 }}>{blockers.map((issue, index) => <div key={index} style={{ color: '#991b1b', fontWeight: 800 }}>• {issue.message}</div>)}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 9, marginTop: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}><strong>Petitioner</strong><input value={mioDraftingQuickValue('petitioner_name', data.petitioner_name)} onChange={(event) => updateDraftingFieldValue('petitioner_name', event.target.value)} placeholder="Full legal name" /></label>
        <label style={{ display: 'grid', gap: 4 }}><strong>Respondent</strong><input value={mioDraftingQuickValue('respondent_name', data.respondent_name)} onChange={(event) => updateDraftingFieldValue('respondent_name', event.target.value)} placeholder="Full legal name" /></label>
        {kind === 'divorce' && <label style={{ display: 'grid', gap: 4 }}><strong>Children in this divorce?</strong><select value={childrenStatus} onChange={(event) => updateDraftingFieldValue('drafting_children_status', event.target.value)}><option value="">Select...</option><option value="no">No</option><option value="yes">Yes</option></select></label>}
        {(childRequired || childrenStatus === 'yes') && <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}><strong>Children</strong><textarea rows={3} value={mioDraftingQuickValue('drafting_children_quick', data.children_names)} onChange={(event) => updateDraftingFieldValue('drafting_children_quick', event.target.value)} placeholder={'One child per line. Optional DOB after |\nExample: Joshua Carmack | 05/14/2014'} /></label>}
      </div>
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}><button type="button" onClick={() => mioSaveDraftingMatterFacts(matter, data)} style={{ fontWeight: 900 }}>Save entered values to matter</button><span role="status" style={{ color: /could not/i.test(draftingMatterQuickSaveStatus) ? '#991b1b' : '#166534', fontWeight: 750 }}>{draftingMatterQuickSaveStatus}</span></div>
    </section>
  }

`
      const pageAnchor = '  function renderDraftingPageLegacy(options = {}) {'
      code = one(code, pageAnchor, helpers + pageAnchor, 'readiness helpers')

      const matterOpen = "            {isAssembly && matter && assemblyData && <section style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, background: '#eff6ff' }}>"
      code = one(code, matterOpen, "            {isAssembly && matter && assemblyData && renderMioDraftingReadiness(template, matter, assemblyData, fieldValues)}\n\n            {isAssembly && matter && assemblyData && <details style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: 10, background: '#eff6ff' }}><summary style={{ cursor: 'pointer', fontWeight: 900 }}>Matter data & optional document customization</summary><section style={{ padding: 2 }}>", 'matter details open')
      const matterClose = "              </div>\n            </section>}\n\n            {(template.fields || []).length > 0 && <section"
      code = one(code, matterClose, "              </div>\n            </section></details>}\n\n            {draftingApplicableFields.length > 0 && <section", 'matter details close')

      // Make the field/clauses editor itself collapsible. It opens only when something remains unresolved.
      const completeOpen = "            {draftingApplicableFields.length > 0 && <section style={{ border: '1px solid #94a3b8', borderRadius: 10, padding: 11, background: '#f8fafc' }}>"
      code = one(code, completeOpen, "            {draftingApplicableFields.length > 0 && <details open={draftingUnresolvedFields.length > 0} style={{ border: '1px solid #94a3b8', borderRadius: 10, padding: 10, background: '#f8fafc' }}><summary style={{ cursor: 'pointer', fontWeight: 900 }}>Other fields & clauses {draftingUnresolvedFields.length ? '— ' + draftingUnresolvedFields.length + ' still needed' : '— complete'}</summary><section style={{ paddingTop: 9 }}>", 'fields details open')
      const completeClose = "              {draftingComposerMode === 'document' ? renderDraftingComposerDocumentMode() : <div style={{ display: 'grid', gap: 10 }}>{draftingUnresolvedFields.length === 0 && !draftingShowResolvedFields && <div style={{ border: '1px solid #86efac', background: '#f0fdf4', color: '#166534', borderRadius: 8, padding: 10, fontWeight: 850 }}>All fields are populated. Turn on “Show completed fields” to review or override them.</div>}{Object.entries(groupedFields).map(([groupName, fields]) => renderFieldGroup(groupName, fields))}{!draftingShowResolvedFields && draftingResolvedFields.length > 0 && <details style={{ border: '1px solid #dbe3ea', borderRadius: 8, padding: 9, background: '#fff' }}><summary style={{ cursor: 'pointer', fontWeight: 850 }}>Completed automatically ({draftingResolvedFields.length})</summary><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 6, marginTop: 8 }}>{draftingResolvedFields.map((field) => <button type=\"button\" key={`resolved-${field.id}`} onClick={() => { setDraftingShowResolvedFields(true); focusDraftingComposerField(field.key) }} style={{ textAlign: 'left', border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 6, padding: 7 }}><strong>{field.label || field.key}</strong><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#166534', fontSize: 12 }}>{draftingComposerFormatValue(draftingFieldCurrentValue(field))}</div></button>)}</div></details>}</div>}\n            </section>}"
      // The exact long inner block can vary after earlier plugins, so use the stable end immediately before preflight instead.
      const preflightBoundary = "            </section>}\n\n            {preflightIssues.length > 0 && <section style={{ border: '1px solid #fcd34d'"
      const boundaryAt = code.indexOf(preflightBoundary, code.indexOf('Other fields & clauses'))
      if (boundaryAt >= 0) code = code.slice(0, boundaryAt) + "            </section></details>}\n\n            {preflightIssues.length > 0 && <section style={{ border: '1px solid #fcd34d'" + code.slice(boundaryAt + preflightBoundary.length)

      // Change the generator button so its disabled/readiness state is obvious instead of relying on a later alert.
      const generateButton = '<button type="button" onClick={() => generateDraftForMatter(lockedMatterId)} style={{ fontWeight: 900, color: \'#1d4ed8\' }}>'
      if (code.includes(generateButton)) {
        code = code.replace(generateButton, '<button type="button" disabled={preflightIssues.some((issue) => issue.level === \'error\')} onClick={() => generateDraftForMatter(lockedMatterId)} style={{ fontWeight: 900, color: preflightIssues.some((issue) => issue.level === \'error\') ? \'#64748b\' : \'#1d4ed8\' }}>')
      }

      return { code, map: null }
    }
  }
}
