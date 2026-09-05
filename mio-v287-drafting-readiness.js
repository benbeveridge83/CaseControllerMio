// Mio V287: a small, stable readiness panel for the matter drafting page.
function replaceIfPresent(code, from, to) {
  return code.includes(from) ? code.replace(from, to) : code
}

export default function mioV287DraftingReadiness() {
  return {
    name: 'mio-v287-drafting-readiness',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      code = replaceIfPresent(code, "const MIO_APP_VERSION = 'Mio V284 (structural template editor)'", "const MIO_APP_VERSION = 'Mio V287 (draft readiness)'")

      // Structural Mio markers are never questions the user should answer.
      code = replaceIfPresent(
        code,
        "    const draftingApplicableFields = (template?.fields || []).filter(draftingFieldIsApplicable)",
        "    const draftingApplicableFields = (template?.fields || []).filter((field) => !/MIO_BLOCK/i.test(String(field?.key || '') + ' ' + String(field?.label || '') + ' ' + String(field?.default_value || ''))).filter(draftingFieldIsApplicable)"
      )

      const suggestionAnchor = "    Array.from(placeholderMap.values()).slice(0, 350).forEach(({ paragraph, sourceText }) => {\n      const field = draftingStudioPlaceholderDefinition(sourceText)"
      code = replaceIfPresent(code, suggestionAnchor, "    Array.from(placeholderMap.values()).slice(0, 350).forEach(({ paragraph, sourceText }) => {\n      if (/MIO_BLOCK:/i.test(String(sourceText || ''))) return\n      const field = draftingStudioPlaceholderDefinition(sourceText)")

      const stateAnchor = "  const [draftingWordRangeSelection, setDraftingWordRangeSelection] = useState({ anchor: -1, start: -1, end: -1 })"
      code = replaceIfPresent(code, stateAnchor, stateAnchor + "\n  const [draftingMatterQuickSaveStatus, setDraftingMatterQuickSaveStatus] = useState('')")

      if (!code.includes('function renderMioDraftingReadinessV287(')) {
        const helpers = String.raw`  function mioDraftingQuickValueV287(key, fallback = '') {
    const value = draftingSelection.field_values?.[key]
    return value == null || value === '' ? String(fallback || '') : String(value)
  }

  function mioDraftingChildrenStatusV287(matter) {
    if (draftingChildrenForMatter(matter).length) return 'yes'
    return String(matterExtraFor(matter?.id)?.drafting_facts?.children_status || '')
  }

  function mioDraftingBlockersV287(template, matter, data, fieldValues = {}) {
    const blockers = draftingPreflightIssues(template, matter, data, fieldValues).filter((issue) => issue.level === 'error')
    const style = draftingResolveCaseStyle(template, matter, fieldValues)
    if (String(style?.kind || '').toLowerCase() === 'divorce' && !data.children_names && !mioDraftingChildrenStatusV287(matter)) {
      blockers.push({ level: 'error', message: 'Confirm whether this divorce includes children.' })
    }
    return blockers
  }

  async function mioSaveDraftingMatterFactsV287(matter, data) {
    if (!matter?.id) return
    const values = draftingSelection.field_values || {}
    const petitioner = String(values.petitioner_name ?? data?.petitioner_name ?? '').trim()
    const respondent = String(values.respondent_name ?? data?.respondent_name ?? '').trim()
    const childrenStatus = String(values.drafting_children_status || mioDraftingChildrenStatusV287(matter) || '').trim()
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
    if (childrenStatus === 'yes' && children.length) {
      parties = parties.filter((party) => !/child|minor/i.test(String(party.role || party.party_type || party.type || '')))
      children.forEach((child) => parties.push(ensureLitigationPartyShape({ ...child, role: 'Child' }, matter.id, parties.length)))
    }

    const nextExtra = syncOpposingPartiesFromLitigationParties({
      ...current,
      drafting_facts: {
        ...(current.drafting_facts || {}),
        petitioner_name: petitioner,
        respondent_name: respondent,
        children_status: childrenStatus,
        ...(childrenStatus === 'yes' ? { children } : {})
      },
      litigation_parties: parties
    }, matter.id)
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

  function renderMioDraftingReadinessV287(template, matter, data, fieldValues = {}) {
    if (!matter || !data) return null
    const blockers = mioDraftingBlockersV287(template, matter, data, fieldValues)
    const ready = blockers.length === 0
    const style = draftingResolveCaseStyle(template, matter, fieldValues)
    const kind = String(style?.kind || '').toLowerCase()
    const childrenStatus = mioDraftingQuickValueV287('drafting_children_status', mioDraftingChildrenStatusV287(matter))
    const showChildren = ['sapcr','habeas'].includes(kind) || childrenStatus === 'yes'
    return <section style={{ border: '2px solid ' + (ready ? '#16a34a' : '#dc2626'), borderRadius: 12, padding: 14, background: ready ? '#f0fdf4' : '#fff7ed', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, flexWrap: 'wrap' }}>
        <div><h3 style={{ margin: 0 }}>{ready ? 'Ready to generate' : 'Required before generating'}</h3><div style={{ color: '#475569', marginTop: 4 }}>{ready ? 'All required matter information is available.' : 'Enter missing information here, then save it to the matter.'}</div></div>
        <strong style={{ color: ready ? '#166534' : '#991b1b' }}>{ready ? 'READY' : blockers.length + ' REQUIRED'}</strong>
      </div>
      {!ready && <div style={{ display: 'grid', gap: 3, marginTop: 9 }}>{blockers.map((issue, index) => <div key={index} style={{ color: '#991b1b', fontWeight: 800 }}>• {issue.message}</div>)}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 9, marginTop: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}><strong>Petitioner</strong><input value={mioDraftingQuickValueV287('petitioner_name', data.petitioner_name)} onChange={(event) => updateDraftingFieldValue('petitioner_name', event.target.value)} placeholder="Full legal name" /></label>
        <label style={{ display: 'grid', gap: 4 }}><strong>Respondent</strong><input value={mioDraftingQuickValueV287('respondent_name', data.respondent_name)} onChange={(event) => updateDraftingFieldValue('respondent_name', event.target.value)} placeholder="Full legal name" /></label>
        {kind === 'divorce' && <label style={{ display: 'grid', gap: 4 }}><strong>Children in this divorce?</strong><select value={childrenStatus} onChange={(event) => updateDraftingFieldValue('drafting_children_status', event.target.value)}><option value="">Select...</option><option value="no">No</option><option value="yes">Yes</option></select></label>}
        {showChildren && <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}><strong>Children</strong><textarea rows={3} value={mioDraftingQuickValueV287('drafting_children_quick', data.children_names)} onChange={(event) => updateDraftingFieldValue('drafting_children_quick', event.target.value)} placeholder={'One child per line. Optional DOB after |\nExample: Joshua Carmack | 05/14/2014'} /></label>}
      </div>
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}><button type="button" onClick={() => mioSaveDraftingMatterFactsV287(matter, data)} style={{ fontWeight: 900 }}>Save entered values to matter</button><span role="status" style={{ fontWeight: 750, color: /could not/i.test(draftingMatterQuickSaveStatus) ? '#991b1b' : '#166534' }}>{draftingMatterQuickSaveStatus}</span></div>
    </section>
  }

`
        const anchor = '  function renderDraftingPageLegacy(options = {}) {'
        if (code.includes(anchor)) code = code.replace(anchor, helpers + anchor)
      }

      const matterOpen = "            {isAssembly && matter && assemblyData && <section style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, background: '#eff6ff' }}>"
      if (code.includes(matterOpen) && !code.includes('renderMioDraftingReadinessV287(template, matter, assemblyData, fieldValues)')) {
        code = code.replace(matterOpen, "            {isAssembly && matter && assemblyData && renderMioDraftingReadinessV287(template, matter, assemblyData, fieldValues)}\n\n" + matterOpen)
      }
      code = replaceIfPresent(code, '<h3 style={{ margin: 0 }}>Matter data Mio will place into the Word document</h3>', '<h3 style={{ margin: 0 }}>Matter data & optional customization</h3>')
      code = replaceIfPresent(code, 'These values come from the matter, court, Requested Relief, and Drafting Studio settings. Overrides below affect only this document.', 'These values come from the matter, court, Requested Relief, and Drafting Studio settings. Missing party/child data can be saved from the readiness panel above.')

      return { code, map: null }
    }
  }
}
