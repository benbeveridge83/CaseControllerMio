// Mio V285: make drafting readiness obvious and let missing caption data be entered here
// and saved back into the matter's litigation-party data in Supabase-backed Mio state.
export default function mioV285DraftingReadiness() {
  return {
    name: 'mio-v285-drafting-readiness',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      code = code.replace("const MIO_APP_VERSION = 'Mio V284 (structural template editor)'", "const MIO_APP_VERSION = 'Mio V285 (draft readiness)'")

      // Smart block placeholders are structural markers, never user fill-in fields.
      code = code.replace(
        "    Array.from(placeholderMap.values()).slice(0, 350).forEach(({ paragraph, sourceText }) => {\n      const field = draftingStudioPlaceholderDefinition(sourceText)",
        "    Array.from(placeholderMap.values()).slice(0, 350).forEach(({ paragraph, sourceText }) => {\n      if (/MIO_BLOCK:/i.test(String(sourceText || ''))) return\n      const field = draftingStudioPlaceholderDefinition(sourceText)"
      )

      // Prefer quick-entry facts saved from the drafting page, without disturbing the normal party model.
      code = code.replace(
        "  function draftingPetitionerName(matter) {\n    const clientRole = draftingClientRoleForMatter(matter)",
        "  function draftingPetitionerName(matter) {\n    const quick = matterExtraFor(matter?.id)?.drafting_facts?.petitioner_name\n    if (quick) return quick\n    const clientRole = draftingClientRoleForMatter(matter)"
      )
      code = code.replace(
        "  function draftingRespondentName(matter) {\n    const clientRole = draftingClientRoleForMatter(matter)",
        "  function draftingRespondentName(matter) {\n    const quick = matterExtraFor(matter?.id)?.drafting_facts?.respondent_name\n    if (quick) return quick\n    const clientRole = draftingClientRoleForMatter(matter)"
      )
      code = code.replace(
`  function draftingChildrenForMatter(matter) {
    if (!matter) return []
    const direct = Array.isArray(matter.children) ? matter.children : []
    const litigation = matterExtraFor(matter.id)?.litigation_parties || []
    return [...direct, ...litigation.filter((party) => /child|minor/i.test(String(party.role || '')))].map((item) => ({
      name: item.name || draftingPersonFullName(item),
      age: item.age || item.date_of_birth || item.dob || ''
    })).filter((item) => item.name)
  }`,
`  function draftingChildrenForMatter(matter) {
    if (!matter) return []
    const extra = matterExtraFor(matter.id) || {}
    const quick = Array.isArray(extra.drafting_facts?.children) ? extra.drafting_facts.children : []
    const direct = Array.isArray(matter.children) ? matter.children : []
    const litigation = extra.litigation_parties || []
    const source = quick.length ? quick : [...direct, ...litigation.filter((party) => /child|minor/i.test(String(party.role || '')))]
    return source.map((item) => ({
      name: item.name || draftingPersonFullName(item),
      age: item.age || item.date_of_birth || item.dob || ''
    })).filter((item) => item.name)
  }`)

      const stateAnchor = "  const [draftingWordRangeSelection, setDraftingWordRangeSelection] = useState({ anchor: -1, start: -1, end: -1 })"
      if (code.includes(stateAnchor) && !code.includes('draftingMatterQuickSaveStatus')) {
        code = code.replace(stateAnchor, stateAnchor + "\n  const [draftingMatterQuickSaveStatus, setDraftingMatterQuickSaveStatus] = useState('')")
      }

      const helperAnchor = '  function renderDraftingPageLegacy(options = {}) {'
      if (code.includes(helperAnchor) && !code.includes('function renderMioDraftingReadiness(')) {
        const helpers = `  function mioDraftingQuickValue(key, fallback = '') {
    const value = draftingSelection.field_values?.[key]
    return value == null || value === '' ? String(fallback || '') : String(value)
  }

  function mioDraftingRequiredFacts(template, matter, data, fieldValues = {}) {
    if (!matter || !data) return []
    const style = draftingResolveCaseStyle(template, matter, fieldValues)
    const kind = String(style?.kind || '').toLowerCase()
    const missing = []
    if (!data.cause_number) missing.push('Cause number')
    if (!data.matter_county) missing.push('County')
    if (!data.court_name) missing.push('Court')
    if (!data.client_name) missing.push('Client')
    if (['divorce','civil'].includes(kind) && !data.petitioner_name) missing.push('Petitioner')
    if (['divorce','civil'].includes(kind) && !data.respondent_name) missing.push('Respondent')
    if (['sapcr','habeas'].includes(kind) && !data.children_names) missing.push('Child / children')
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
      if (index >= 0) parties[index] = row
      else parties.push(row)
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
      setDraftingMatterQuickSaveStatus('Saved to matter.')
    } catch (error) {
      setDraftingMatterQuickSaveStatus('Could not save: ' + (error?.message || error))
    }
  }

  function renderMioDraftingReadiness(template, matter, data, fieldValues = {}) {
    if (!matter || !data) return null
    const style = draftingResolveCaseStyle(template, matter, fieldValues)
    const missing = mioDraftingRequiredFacts(template, matter, data, fieldValues)
    const ready = missing.length === 0
    const childRequired = ['sapcr','habeas'].includes(String(style?.kind || '').toLowerCase())
    return <section style={{ border: '2px solid ' + (ready ? '#16a34a' : '#dc2626'), borderRadius: 12, padding: 14, background: ready ? '#f0fdf4' : '#fff7ed', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
        <div><h3 style={{ margin: 0 }}>{ready ? 'Ready to generate' : 'Required before generating'}</h3><div style={{ marginTop: 4, color: '#475569' }}>{ready ? 'Mio has the required matter information for this draft.' : 'Enter missing party/child information here and save it to the matter.'}</div></div>
        <strong style={{ color: ready ? '#166534' : '#991b1b' }}>{ready ? 'READY' : missing.length + ' MISSING'}</strong>
      </div>
      {!ready && <div style={{ marginTop: 9, fontWeight: 850 }}>Missing: {missing.join(', ')}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 9, marginTop: 11 }}>
        <label style={{ display: 'grid', gap: 4 }}><strong>Petitioner</strong><input value={mioDraftingQuickValue('petitioner_name', data.petitioner_name)} onChange={(event) => updateDraftingFieldValue('petitioner_name', event.target.value)} placeholder="Full legal name" /></label>
        <label style={{ display: 'grid', gap: 4 }}><strong>Respondent</strong><input value={mioDraftingQuickValue('respondent_name', data.respondent_name)} onChange={(event) => updateDraftingFieldValue('respondent_name', event.target.value)} placeholder="Full legal name" /></label>
        <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}><strong>Children {childRequired ? '— required for this style' : '— add only if applicable'}</strong><textarea rows={3} value={mioDraftingQuickValue('drafting_children_quick', data.children_names)} onChange={(event) => updateDraftingFieldValue('drafting_children_quick', event.target.value)} placeholder={'One child per line. Optional DOB after |\nJoshua Carmack | 05/14/2014'} /></label>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}><button type="button" onClick={() => mioSaveDraftingMatterFacts(matter, data)} style={{ fontWeight: 900 }}>Save entered values to matter</button><span role="status" style={{ fontWeight: 750, color: /could not/i.test(draftingMatterQuickSaveStatus) ? '#991b1b' : '#166534' }}>{draftingMatterQuickSaveStatus}</span></div>
      <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer', fontWeight: 800 }}>Why Mio needs these fields</summary><p style={{ marginBottom: 0, color: '#475569' }}>The selected case style is generated from matter data. Values saved here are available to this draft and future templates for this matter.</p></details>
    </section>
  }

`
        code = code.replace(helperAnchor, helpers + helperAnchor)
      }

      const matterSection = "            {isAssembly && matter && assemblyData && <section style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, background: '#eff6ff' }}>"
      if (code.includes(matterSection) && !code.includes('renderMioDraftingReadiness(template, matter, assemblyData, fieldValues)')) {
        code = code.replace(matterSection, "            {isAssembly && matter && assemblyData && renderMioDraftingReadiness(template, matter, assemblyData, fieldValues)}\n\n" + matterSection)
      }

      // Hide dense detail by default without changing its internal behavior.
      code = code.replace(
        '<h3 style={{ margin: 0 }}>Matter data Mio will place into the Word document</h3>',
        '<h3 style={{ margin: 0 }}>Document data and optional customization</h3>'
      )
      code = code.replace(
        'These values come from the matter, court, Requested Relief, and Drafting Studio settings. Overrides below affect only this document.',
        'These values come from the matter, court, Requested Relief, and Drafting Studio settings. Missing party/child data can be saved from the readiness panel above.'
      )

      return { code, map: null }
    }
  }
}
