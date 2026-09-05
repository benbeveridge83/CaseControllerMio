// Mio V292: drafting should always be allowed. Missing values are warnings, not blockers.
function repl(code, from, to) { return code.includes(from) ? code.replace(from, to) : code }
function replaceRegion(code, start, end, replacement) {
  const a = code.indexOf(start)
  const b = a >= 0 ? code.indexOf(end, a) : -1
  if (a < 0 || b < 0) return code
  return code.slice(0, a) + replacement + '\n\n' + code.slice(b)
}

export default function mioV292DraftingNonblocking() {
  return {
    name: 'mio-v292-drafting-nonblocking',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      code = repl(code, "const MIO_APP_VERSION = 'Mio V291 (clean drafting)'", "const MIO_APP_VERSION = 'Mio V292 (nonblocking drafting)'")

      // Keep the existing preflight analysis for visibility, but never block generation.
      const blockerStart = '  function mioDraftingBlockersV287(template, matter, data, fieldValues = {}) {'
      const blockerEnd = '  async function mioSaveDraftingMatterFactsV287(matter, data) {'
      code = replaceRegion(code, blockerStart, blockerEnd, `  function mioDraftingMissingV292(template, matter, data, fieldValues = {}) {
    const issues = draftingPreflightIssues(template, matter, data, fieldValues)
    const style = draftingResolveCaseStyle(template, matter, fieldValues)
    const output = [...issues]
    if (String(style?.kind || '').toLowerCase() === 'divorce' && !data.children_names && !mioDraftingChildrenStatusV287(matter)) {
      output.push({ level: 'warning', message: 'Confirm whether this divorce includes children.' })
    }
    return output.map((issue) => ({ ...issue, level: 'warning' }))
  }

  function mioDraftingBlockersV287() {
    return []
  }`)

      const saveStart = '  async function mioSaveDraftingMatterFactsV287(matter, data) {'
      const saveEnd = '  function renderMioDraftingReadinessV287(template, matter, data, fieldValues = {}) {'
      code = replaceRegion(code, saveStart, saveEnd, `  async function mioSaveDraftingMatterFactsV287(matter, data) {
    if (!matter?.id) return
    const values = draftingSelection.field_values || {}
    const petitioner = String(values.petitioner_name ?? data?.petitioner_name ?? '').trim()
    const respondent = String(values.respondent_name ?? data?.respondent_name ?? '').trim()
    const childrenStatus = String(values.drafting_children_status || mioDraftingChildrenStatusV287(matter) || '').trim()
    const existingChildren = draftingChildrenForMatter(matter) || []
    const children = Array.from({ length: 5 }, (_, zeroIndex) => {
      const number = zeroIndex + 1
      const existing = existingChildren[zeroIndex] || {}
      const name = String(values['drafting_child_' + number + '_name'] ?? existing.name ?? '').trim()
      const date_of_birth = String(values['drafting_child_' + number + '_dob'] ?? existing.date_of_birth ?? existing.dob ?? '').trim()
      const social_security_number = String(values['drafting_child_' + number + '_ssn'] ?? existing.social_security_number ?? existing.ssn ?? '').trim()
      const state_born = String(values['drafting_child_' + number + '_state_born'] ?? existing.state_born ?? existing.birth_state ?? '').trim()
      return { ...existing, name, date_of_birth, social_security_number, ssn: social_security_number, state_born, birth_state: state_born }
    }).filter((child) => child.name || child.date_of_birth || child.social_security_number || child.state_born)

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
    if (childrenStatus === 'yes' || children.length) {
      parties = parties.filter((party) => !/child|minor/i.test(String(party.role || party.party_type || party.type || '')))
      children.filter((child) => child.name).forEach((child) => parties.push(ensureLitigationPartyShape({ ...child, role: 'Child' }, matter.id, parties.length)))
    }

    const nextExtra = syncOpposingPartiesFromLitigationParties({
      ...current,
      drafting_facts: {
        ...(current.drafting_facts || {}),
        petitioner_name: petitioner,
        respondent_name: respondent,
        children_status: childrenStatus,
        children
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
  }`)

      const renderStart = '  function renderMioDraftingReadinessV287(template, matter, data, fieldValues = {}) {'
      const renderEnd = '  function renderDraftingPageLegacy(options = {}) {'
      code = replaceRegion(code, renderStart, renderEnd, `  function renderMioDraftingReadinessV287(template, matter, data, fieldValues = {}) {
    if (!matter || !data) return null
    const missing = mioDraftingMissingV292(template, matter, data, fieldValues)
    const style = draftingResolveCaseStyle(template, matter, fieldValues)
    const kind = String(style?.kind || '').toLowerCase()
    const childrenStatus = mioDraftingQuickValueV287('drafting_children_status', mioDraftingChildrenStatusV287(matter))
    const showChildren = ['sapcr','habeas'].includes(kind) || childrenStatus === 'yes'
    const existingChildren = draftingChildrenForMatter(matter) || []
    const barNumber = mioDraftingQuickValueV287('attorney_bar_number', mioDraftingQuickValueV287('bar_number', data.attorney_bar_number || data.bar_number || ''))
    return <section style={{ border: '2px solid ' + (missing.length ? '#f59e0b' : '#16a34a'), borderRadius: 12, padding: 14, background: missing.length ? '#fffbeb' : '#f0fdf4', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, flexWrap: 'wrap' }}>
        <div><h3 style={{ margin: 0 }}>{missing.length ? 'Missing information — generation is still allowed' : 'Ready to generate'}</h3><div style={{ color: '#475569', marginTop: 4 }}>{missing.length ? 'Fill in anything you want below. If you leave something blank, Mio will generate the Word document anyway and mark unresolved placeholders with ***.' : 'All detected information is available.'}</div></div>
        <strong style={{ color: missing.length ? '#92400e' : '#166534' }}>{missing.length ? missing.length + ' TO REVIEW' : 'READY'}</strong>
      </div>
      {missing.length > 0 && <div style={{ display: 'grid', gap: 3, marginTop: 9 }}>{missing.map((issue, index) => <div key={index} style={{ color: '#92400e', fontWeight: 800 }}>• {issue.message}</div>)}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 9, marginTop: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}><strong>Petitioner</strong><input value={mioDraftingQuickValueV287('petitioner_name', data.petitioner_name)} onChange={(event) => updateDraftingFieldValue('petitioner_name', event.target.value)} placeholder="Full legal name" /></label>
        <label style={{ display: 'grid', gap: 4 }}><strong>Respondent</strong><input value={mioDraftingQuickValueV287('respondent_name', data.respondent_name)} onChange={(event) => updateDraftingFieldValue('respondent_name', event.target.value)} placeholder="Full legal name" /></label>
        <label style={{ display: 'grid', gap: 4 }}><strong>Attorney bar number</strong><input value={barNumber} onChange={(event) => { updateDraftingFieldValue('attorney_bar_number', event.target.value); updateDraftingFieldValue('bar_number', event.target.value) }} placeholder="State Bar number" /></label>
        {kind === 'divorce' && <label style={{ display: 'grid', gap: 4 }}><strong>Children in this divorce?</strong><select value={childrenStatus} onChange={(event) => updateDraftingFieldValue('drafting_children_status', event.target.value)}><option value="">Select...</option><option value="no">No</option><option value="yes">Yes</option></select></label>}
      </div>
      {showChildren && <div style={{ marginTop: 14 }}>
        <strong>Children</strong>
        <div style={{ overflowX: 'auto', marginTop: 6 }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 850 }}><thead><tr><th style={{ textAlign: 'left', padding: 5 }}>Child</th><th style={{ textAlign: 'left', padding: 5 }}>Name</th><th style={{ textAlign: 'left', padding: 5 }}>Birthdate</th><th style={{ textAlign: 'left', padding: 5 }}>Social Security number</th><th style={{ textAlign: 'left', padding: 5 }}>State born</th></tr></thead><tbody>
          {Array.from({ length: 5 }, (_, zeroIndex) => {
            const number = zeroIndex + 1
            const child = existingChildren[zeroIndex] || {}
            return <tr key={number}><td style={{ padding: 5, fontWeight: 800 }}>Child {number}</td><td style={{ padding: 5 }}><input style={{ width: '100%' }} value={mioDraftingQuickValueV287('drafting_child_' + number + '_name', child.name || '')} onChange={(event) => updateDraftingFieldValue('drafting_child_' + number + '_name', event.target.value)} /></td><td style={{ padding: 5 }}><input type="date" style={{ width: '100%' }} value={mioDraftingQuickValueV287('drafting_child_' + number + '_dob', child.date_of_birth || child.dob || '')} onChange={(event) => updateDraftingFieldValue('drafting_child_' + number + '_dob', event.target.value)} /></td><td style={{ padding: 5 }}><input style={{ width: '100%' }} value={mioDraftingQuickValueV287('drafting_child_' + number + '_ssn', child.social_security_number || child.ssn || '')} onChange={(event) => updateDraftingFieldValue('drafting_child_' + number + '_ssn', event.target.value)} /></td><td style={{ padding: 5 }}><input style={{ width: '100%' }} value={mioDraftingQuickValueV287('drafting_child_' + number + '_state_born', child.state_born || child.birth_state || '')} onChange={(event) => updateDraftingFieldValue('drafting_child_' + number + '_state_born', event.target.value)} placeholder="TX" /></td></tr>
          })}
        </tbody></table></div>
      </div>}
      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}><button type="button" onClick={() => mioSaveDraftingMatterFactsV287(matter, data)} style={{ fontWeight: 900 }}>Save entered values to matter</button><span role="status" style={{ fontWeight: 750, color: /could not/i.test(draftingMatterQuickSaveStatus) ? '#991b1b' : '#166534' }}>{draftingMatterQuickSaveStatus}</span></div>
    </section>
  }`)

      // V291 disabled the Generate button when there were blockers. V292 expressly never disables drafting.
      code = code.replace(/ disabled=\{isAssembly && matter && assemblyData && mioDraftingBlockersV287\(template, matter, assemblyData, fieldValues\)\.length > 0\}/g, '')
      code = code.replace(/ title=\{isAssembly && matter && assemblyData && mioDraftingBlockersV287\(template, matter, assemblyData, fieldValues\)\.length > 0 \? 'Complete the Required before generating section first\.' : 'Generate document'\}/g, " title={'Generate document'}")
      code = code.replace(/color: isAssembly && matter && assemblyData && mioDraftingBlockersV287\(template, matter, assemblyData, fieldValues\)\.length > 0 \? '#64748b' : '#1d4ed8'/g, "color: '#1d4ed8'")
      code = repl(code, "    const errors = mioDraftingBlockersV287(template, matter, data, fieldValues)\n    if (errors.length)", "    const errors = []\n    if (errors.length)")

      // Reusable components and unresolved inline placeholders should not abort generation.
      code = repl(code, "    if (componentErrors.length) throw new Error(componentErrors.join(' '))", "    // V292: component issues are review warnings only; never block document generation.")
      code = repl(code, "    if (xmlDoc.documentElement.textContent.includes('[Missing:')) throw new Error('Complete the missing reusable-component values before generating.')", "    Array.from(xmlDoc.getElementsByTagNameNS('*', 't')).forEach((node) => { node.textContent = String(node.textContent || '').replace(/\\[Missing:[^\\]]+\\]/g, '***').replace(/\\{\\{\\s*[\\w.-]+\\s*\\}\\}/g, '***') })")

      // A missing signature/component value should be visible in the output instead of silently disappearing.
      code = repl(code, "if (binding.kind === 'signature_block') return data.attorney_signature_block || ''", "if (binding.kind === 'signature_block') return data.attorney_signature_block || '***'")
      code = repl(code, "if (binding.kind === 'component_block') return data[binding.field_key] ?? ''", "if (binding.kind === 'component_block') return data[binding.field_key] || '***'")

      return { code, map: null }
    }
  }
}
