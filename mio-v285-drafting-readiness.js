// Mio V285: make drafting readiness obvious and let missing caption data be entered here
// and saved back into the matter's litigation-party data in Supabase-backed Mio state.
function once(code, from, to, label) {
  const at = code.indexOf(from)
  if (at < 0 || code.indexOf(from, at + from.length) >= 0) throw new Error('V285 integration anchor changed: ' + label)
  return code.replace(from, to)
}

export default function mioV285DraftingReadiness() {
  return {
    name: 'mio-v285-drafting-readiness',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      code = once(code, "const MIO_APP_VERSION = 'Mio V284 (structural template editor)'", "const MIO_APP_VERSION = 'Mio V285 (draft readiness)'", 'version')

      // Smart block placeholders are structural markers, never user fill-in fields.
      const placeholderLoop = "    Array.from(placeholderMap.values()).slice(0, 350).forEach(({ paragraph, sourceText }) => {\n      const field = draftingStudioPlaceholderDefinition(sourceText)"
      code = once(code, placeholderLoop, "    Array.from(placeholderMap.values()).slice(0, 350).forEach(({ paragraph, sourceText }) => {\n      if (/^\\[\\[?MIO_BLOCK:/i.test(String(sourceText || '').trim())) return\n      const field = draftingStudioPlaceholderDefinition(sourceText)", 'smart block placeholder filter')

      // Prefer any quick-entry facts saved into the matter, while retaining the existing party model.
      code = once(code,
        "  function draftingPetitionerName(matter) {\n    const clientRole = draftingClientRoleForMatter(matter)",
        "  function draftingPetitionerName(matter) {\n    const quick = matterExtraFor(matter?.id)?.drafting_facts?.petitioner_name\n    if (quick) return quick\n    const clientRole = draftingClientRoleForMatter(matter)",
        'petitioner override')
      code = once(code,
        "  function draftingRespondentName(matter) {\n    const clientRole = draftingClientRoleForMatter(matter)",
        "  function draftingRespondentName(matter) {\n    const quick = matterExtraFor(matter?.id)?.drafting_facts?.respondent_name\n    if (quick) return quick\n    const clientRole = draftingClientRoleForMatter(matter)",
        'respondent override')
      code = once(code,
        "  function draftingChildrenForMatter(matter) {\n    if (!matter) return []\n    const direct = Array.isArray(matter.children) ? matter.children : []",
        "  function draftingChildrenForMatter(matter) {\n    if (!matter) return []\n    const quickChildren = matterExtraFor(matter.id)?.drafting_facts?.children\n    const direct = Array.isArray(quickChildren) && quickChildren.length ? quickChildren : (Array.isArray(matter.children) ? matter.children : [])",
        'children override')

      // Add one small state value for visible save feedback.
      const stateAnchor = "  const [draftingWordRangeSelection, setDraftingWordRangeSelection] = useState({ anchor: -1, start: -1, end: -1 })"
      code = once(code, stateAnchor, stateAnchor + "\n  const [draftingMatterQuickSaveStatus, setDraftingMatterQuickSaveStatus] = useState('')", 'save status state')

      const helperAnchor = '  function renderDraftingPageLegacy(options = {}) {'
      if (!code.includes(helperAnchor)) throw new Error('V285 integration anchor changed: drafting page')
      const helpers = `  function mioDraftingQuickValue(key, fallback = '') {
    const value = draftingSelection.field_values?.[key]
    return value == null || value === '' ? String(fallback || '') : String(value)
  }

  function mioDraftingRequiredFacts(template, matter, data, fieldValues = {}) {
    if (!matter || !data) return []
    const style = draftingResolveCaseStyle(template, matter, fieldValues)
    const kind = String(style?.kind || '').toLowerCase()
    const missing = []
    if (!data.cause_number) missing.push({ key: 'cause_number', label: 'Cause number' })
    if (!data.matter_county) missing.push({ key: 'matter_county', label: 'County' })
    if (!data.court_name) missing.push({ key: 'court_name', label: 'Court' })
    if (!data.client_name) missing.push({ key: 'client_name', label: 'Client' })
    if (['divorce','civil'].includes(kind) && !data.petitioner_name) missing.push({ key: 'petitioner_name', label: 'Petitioner' })
    if (['divorce','civil'].includes(kind) && !data.respondent_name) missing.push({ key: 'respondent_name', label: 'Respondent' })
    if (['sapcr','habeas'].includes(kind) && !data.children_names) missing.push({ key: 'children_names', label: 'Child / children' })
    return missing
  }

  async function mioSaveDraftingMatterFacts(matter, data) {
    if (!matter?.id) return
    const values = draftingSelection.field_values || {}
    const petitioner = String(values.petitioner_name ?? data?.petitioner_name ?? '').trim()
    const respondent = String(values.respondent_name ?? data?.respondent_name ?? '').trim()
    const childText = String(values.drafting_children_quick ?? data?.children_names ?? '').trim()
    const children = childText.split(/\\n|;/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const parts = line.split('|').map((part) => part.trim())
      return { name: parts[0] || '', date_of_birth: parts[1] || '' }
    }).filter((child) => child.name)
    const current = cloneMatterExtraInfo(matterExtraInfoById[matter.id] || {})
    let parties = Array.isArray(current.litigation_parties) ? current.litigation_parties.map((party, index) => ensureLitigationPartyShape(party, matter.id, index)) : []
    const upsert = (pattern, role, name) => {
      if (!name) return
      const index = parties.findIndex((party) => pattern.test(String(party.role || party.party_type || party.type || '')))
      const row = ensureLitigationPartyShape({ ...(index >= 0 ? parties[index] : {}), name, role }, matter.id, index >= 0 ? index : parties.length)
      if (index >= 0) parties[index] = row; else parties.push(row)
    }
    upsert(/petitioner|movant|applicant/i, 'Petitioner', petitioner)
    upsert(/respondent/i, 'Respondent', respondent)
    if (children.length) {
      parties = parties.filter((party) => !/child|minor/i.test(String(party.role || party.party_type || party.type || '')))
      children.forEach((child) => parties.push(ensureLitigationPartyShape({ ...child, role: 'Child' }, matter.id, parties.length)))
    }
    const facts = { ...(current.drafting_facts || {}), petitioner_name: petitioner, respondent_name: respondent, ...(children.length ? { children } : {}) }
    const nextExtra = syncOpposingPartiesFromLitigationParties({ ...current, drafting_facts: facts, litigation_parties: parties }, matter.id)
    const nextAll = { ...matterExtraInfoById, [matter.id]: nextExtra }
    setMatterExtraInfoById(nextAll)
    setDraftingMatterQuickSaveStatus('Saving to matter...')
    try {
      await saveMioStateKeyNow('caseControllerMatterExtraInfo', JSON.stringify(nextAll), { throwOnError: true })
      setDraftingMatterQuickSaveStatus('Saved to matter and ready for this draft.')
    } catch (error) {
      setDraftingMatterQuickSaveStatus('Could not save: ' + (error?.message || error))
    }
  }

  function renderMioDraftingReadiness(template, matter, data, fieldValues = {}) {
    if (!matter || !data) return null
    const style = draftingResolveCaseStyle(template, matter, fieldValues)
    const missing = mioDraftingRequiredFacts(template, matter, data, fieldValues)
    const canGenerate = missing.length === 0
    const needsChildren = ['sapcr','habeas'].includes(String(style?.kind || '').toLowerCase())
    return <section style={{ border: '2px solid ' + (canGenerate ? '#16a34a' : '#dc2626'), borderRadius: 12, padding: 14, background: canGenerate ? '#f0fdf4' : '#fff7ed', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, flexWrap: 'wrap' }}>
        <div><h3 style={{ margin: 0 }}>{canGenerate ? 'Ready to generate' : 'Information needed before generating'}</h3><div style={{ marginTop: 4, color: '#475569' }}>{canGenerate ? 'Mio has the required matter data for this template.' : 'Enter the missing matter information here. Saving it updates the matter and this draft.'}</div></div>
        <span style={{ fontWeight: 900, color: canGenerate ? '#166534' : '#991b1b' }}>{canGenerate ? 'READY' : missing.length + ' REQUIRED'}</span>
      </div>
      {!canGenerate && <div style={{ marginTop: 10, fontWeight: 800 }}>Missing: {missing.map((item) => item.label).join(', ')}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10, marginTop: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}><strong>Petitioner</strong><input value={mioDraftingQuickValue('petitioner_name', data.petitioner_name)} onChange={(event) => updateDraftingFieldValue('petitioner_name', event.target.value)} placeholder="Petitioner full name" /></label>
        <label style={{ display: 'grid', gap: 4 }}><strong>Respondent</strong><input value={mioDraftingQuickValue('respondent_name', data.respondent_name)} onChange={(event) => updateDraftingFieldValue('respondent_name', event.target.value)} placeholder="Respondent full name" /></label>
        <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}><strong>Children {needsChildren ? '(required for this case style)' : '(only if this matter has children)'}</strong><textarea rows={3} value={mioDraftingQuickValue('drafting_children_quick', data.children_names)} onChange={(event) => updateDraftingFieldValue('drafting_children_quick', event.target.value)} placeholder={'One child per line. Optional DOB after |\nExample: Joshua Carmack | 05/14/2014'} /></label>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}><button type="button" onClick={() => mioSaveDraftingMatterFacts(matter, data)} style={{ fontWeight: 900 }}>Save these values to the matter</button><span role="status" style={{ color: /could not/i.test(draftingMatterQuickSaveStatus) ? '#991b1b' : '#166534', fontWeight: 750 }}>{draftingMatterQuickSaveStatus}</span></div>
    </section>
  }

`
      code = code.replace(helperAnchor, helpers + helperAnchor)

      // Put readiness first, before all optional document detail.
      const matterSection = "            {isAssembly && matter && assemblyData && <section style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, background: '#eff6ff' }}>"
      code = once(code, matterSection, "            {isAssembly && matter && assemblyData && renderMioDraftingReadiness(template, matter, assemblyData, fieldValues)}\n\n" + matterSection, 'readiness panel placement')

      // Make the dense matter-data/customization section collapsible by default.
      const startAt = code.indexOf(matterSection)
      if (startAt < 0) throw new Error('V285 matter section not found after insertion')
      const openTagEnd = startAt + matterSection.length
      code = code.slice(0, openTagEnd) + "\n              <details><summary style={{ cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>Document data and optional customization</summary>" + code.slice(openTagEnd)
      const closeAt = code.indexOf('            </section>}', openTagEnd)
      if (closeAt < 0) throw new Error('V285 matter section close not found')
      code = code.slice(0, closeAt) + "              </details>\n" + code.slice(closeAt)

      // The old description incorrectly implies every override is document-only now that quick-entry can save to matter.
      code = code.replace('These values come from the matter, court, Requested Relief, and Drafting Studio settings. Overrides below affect only this document.', 'These values come from the matter, court, Requested Relief, and Drafting Studio settings. Use the readiness panel above to save missing party/child data back to the matter.')

      return { code, map: null }
    }
  }
}
