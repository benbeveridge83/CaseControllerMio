// Mio V293: test any Word drafting template against a selected matter from the Template Library.
// Adds a non-destructive "Test with matter" flow that reuses the normal drafting composer,
// so users can preview, fill missing information, and download the generated Word document.

function replaceOnce(code, from, to, label) {
  const first = code.indexOf(from)
  if (first < 0 || code.indexOf(from, first + from.length) >= 0) throw new Error('V293 integration anchor changed: ' + label)
  return code.replace(from, to)
}

export default function mioV293TemplateMatterTest() {
  return {
    name: 'mio-v293-template-matter-test',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      code = code.replace(/const MIO_APP_VERSION = 'Mio V\d+[^']*'/, "const MIO_APP_VERSION = 'Mio V293 (template matter test)'")

      const stateAnchor = "  const [draftingMatterQuickSaveStatus, setDraftingMatterQuickSaveStatus] = useState('')"
      if (!code.includes(stateAnchor)) throw new Error('V293 integration anchor changed: drafting quick-save state')
      code = code.replace(stateAnchor, stateAnchor + "\n  const [draftingTemplateTest, setDraftingTemplateTest] = useState({ template_id: '', matter_id: '' })")

      const legacyAnchor = '  function renderDraftingPageLegacy(options = {}) {'
      if (!code.includes(legacyAnchor)) throw new Error('V293 integration anchor changed: drafting page renderer')
      const helpers = `  function mioOpenTemplateForMatterV293(templateId, matterId) {
    if (!templateId) return alert('Choose a template first.')
    if (!matterId) return alert('Choose a matter to test this template with.')
    const template = draftingTemplates.find(item => item.id === templateId)
    if (!template) return alert('Mio could not find that template.')
    const selectedFiles = (template.files || []).filter(file => file.include_by_default !== false).map(file => file.id || file.name).filter(Boolean)
    setDraftingSelection(current => ({ ...current, matter_id: matterId, template_id: templateId, selected_file_names: selectedFiles.length ? selectedFiles : (template.files || []).slice(0, 1).map(file => file.id || file.name).filter(Boolean), field_values: {} }))
    setDraftingGeneratedFiles([])
    setDraftingOutput('')
    setDraftingStudioTab('compose')
    window.location.hash = 'drafting'
  }

  function mioTemplateMatterTesterV293(template) {
    if (!template) return null
    const matterId = draftingTemplateTest.template_id === template.id ? draftingTemplateTest.matter_id : ''
    const options = matters.filter(matter => matter?.is_active !== false).slice().sort((a, b) => {
      const an = String(a?.clients?.last_name || a?.client_name || a?.name || '').toLowerCase()
      const bn = String(b?.clients?.last_name || b?.client_name || b?.name || '').toLowerCase()
      return an.localeCompare(bn)
    })
    return <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #dbeafe' }}>
      <div style={{ fontSize: 11, fontWeight: 900, marginBottom: 4 }}>Test this template with a matter</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label={'Matter for ' + template.name} value={matterId} onChange={event => setDraftingTemplateTest({ template_id: template.id, matter_id: event.target.value })} style={{ minWidth: 220, maxWidth: '100%' }}>
          <option value="">Choose matter...</option>
          {options.map(matter => <option key={matter.id} value={matter.id}>{[matter?.clients?.last_name ? matter.clients.last_name + ', ' + (matter.clients.first_name || '') : (matter.client_name || ''), matter.name || matter.matter_type || matter.case_type || '', matter.cause_number || ''].filter(Boolean).join(' — ')}</option>)}
        </select>
        <button type="button" disabled={!matterId} onClick={() => mioOpenTemplateForMatterV293(template.id, matterId)}>Open for matter</button>
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>Opens the normal drafting composer using this template and matter. You can fill missing values there, preview the populated document, and generate/download the Word file without changing the reusable template.</div>
    </div>
  }

`
      code = code.replace(legacyAnchor, helpers + legacyAnchor)

      // Add the matter tester to every template card in the Template Library, immediately after its action buttons.
      const cardAction = "<button type=\"button\" onClick={() => draftingStudioOpenTemplate(template.id)}>Open Visual Builder</button>"
      if (!code.includes(cardAction)) throw new Error('V293 integration anchor changed: template library action button')
      code = code.replaceAll(cardAction, cardAction + "{mioTemplateMatterTesterV293(template)}")

      return { code, map: null }
    }
  }
}
