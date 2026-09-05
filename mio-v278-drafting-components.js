// Additive integration: fail the build rather than silently patch a changed App.
export function transformDraftingComponents(source) {
  let code = source
  const once = (from, to) => { if (code.split(from).length !== 2) throw new Error('V278 integration anchor changed: ' + from.slice(0, 100)); code = code.replace(from, to) }
  const region = (start, end, replacement) => { if (code.split(start).length !== 2 || code.split(end).length !== 2) throw new Error('V278 region changed: ' + start); const a = code.indexOf(start), b = code.indexOf(end, a); if (b < a) throw new Error('V278 region order changed'); code = code.slice(0,a) + replacement + '\n\n' + code.slice(b) }
  code = `import { DraftingFrame, DraftingPreferences, DraftingComponents, SuggestionInspector } from './MioDraftingWorkspace.jsx'\nimport { COMPONENTS as MIO_DRAFT_COMPONENTS, resolveCaseStyle as mioResolveCaseStyle, fileComponentData as mioFileComponentData, applyComponentXml as mioApplyComponentXml, componentIssues as mioComponentIssues, semanticSuggestions as mioSemanticSuggestions, reviewSuggestions as mioReviewSuggestions } from './mioDraftingComponents.js'\n` + code
  once("const MIO_APP_VERSION = 'Mio V277 (cloud storage)'", "const MIO_APP_VERSION = 'Mio V278 (draft previews)'")
  once("  { value: 'signature_block', label: 'Signature block' },", "  { value: 'signature_block', label: 'Signature block' },\n  { value: 'component_block', label: 'Reusable component (service certificate / notice / custom)' },")
  once("const [draftingSelection, setDraftingSelection] = useState({ matter_id: '', template_id: '', field_values: {}, selected_file_names: [] })", "const [draftingSelection, setDraftingSelection] = useState(() => { try { return JSON.parse(localStorage.getItem('caseMioDraftingSessionV278') || 'null') || { matter_id: '', template_id: '', field_values: {}, selected_file_names: [] } } catch { return { matter_id: '', template_id: '', field_values: {}, selected_file_names: [] } } })")
  once("  const [mioCloudHydrationDone, setMioCloudHydrationDone] = useState(false)", "  const [mioCloudHydrationDone, setMioCloudHydrationDone] = useState(false)\n  useEffect(() => { if (mioCloudHydrationDone) saveMioStateKey('caseMioDraftingSessionV278', JSON.stringify(draftingSelection)) }, [draftingSelection, mioCloudHydrationDone])")
  region('  function draftingResolveCaseStyle(template, matter, fieldValues = {}) {', '  function draftingExpandInlineTemplate(text, data) {', `  function draftingResolveCaseStyle(template, matter, fieldValues = {}) {
    return mioResolveCaseStyle(draftingProfile, draftingMatterTypeValue(matter), draftingChildrenForMatter(matter).length > 0, fieldValues.case_style_id || '')
  }`)
  once("    if (!output.case_style_id) output.case_style_id = draftingResolveCaseStyle(template, matter, output)?.id || ''\n    if (!output.signature_block_id) output.signature_block_id = draftingProfileSignatureBlock(template)?.id || ''", "    // An empty override continues to follow the current shared defaults.\n    output.case_style_id = ''\n    output.signature_block_id = ''")
  once("if (field.required && draftingValueMissing(fieldValues[field.key]))", "if (field.required && draftingValueMissing(['case_style_id', 'signature_block_id'].includes(field.key) ? data?.[field.key] : fieldValues[field.key]))")
  // Retain placeholder and relief detection, replace the unreliable capitalized-name heuristic.
  const start = '    const fullNameCounts = new Map()', end = '    document.sections.forEach((section) => {'
  const a = code.indexOf(start), b = code.indexOf(end, a)
  if (a < 0 || b < a) throw new Error('V278 detector region changed')
  code = code.slice(0,a) + "    suggestions.push(...mioSemanticSuggestions(document, (draftingProfile.signature_blocks || []).map(block => block.attorney_name)))\n" + code.slice(b)
  once('    setDraftingAiSuggestions(merged)', '    setDraftingAiSuggestions(mioReviewSuggestions(merged))')
  once('`Mio proposed ${merged.length} field or clause binding(s). Nothing is permanent until you accept and save the template.`', '`Mio proposed ${mioReviewSuggestions(merged).length} field or clause binding(s). Review the source and replacement scope before accepting. Rule-based detection is used when the AI service is unavailable.`')
  // Expanded source list includes the source picker additions, not only the original small enum.
  const cardAnchor = '<button type="button" onClick={() => draftingStudioAcceptSuggestion(suggestion)}'
  const index = code.indexOf(cardAnchor), div = code.lastIndexOf('<div style=', index)
  if (index < 0 || div < 0) throw new Error('V278 suggestion card changed')
  code = code.slice(0,div) + `<SuggestionInspector suggestion={suggestion} sources={Array.from(new Map([...DRAFTING_FIELD_SOURCE_OPTIONS, { value: 'attorney.name', label: 'Attorney name (signature profile)' }].map(item => [item.value, item])).values())} onChange={(patch) => setDraftingAiSuggestions(current => current.map(item => item.id === suggestion.id ? { ...item, ...patch } : item))} />` + code.slice(div)
  once('{Math.round((suggestion.confidence || 0) * 100)}%', "{suggestion.source === 'local_rule' ? 'rule-based' : `${Math.round((suggestion.confidence || 0) * 100)}% estimate`}")
  // Component binding needs an explicit data key; all subsequent output comes from the same instance data.
  once("if (binding.kind === 'signature_block') return data.attorney_signature_block || ''", "if (binding.kind === 'signature_block') return data.attorney_signature_block || ''\n    if (binding.kind === 'component_block') return data[binding.field_key] ?? ''")
  code = code.replaceAll("['relief_clause', 'conditional_block', 'caption_block', 'signature_block'].includes(binding.kind)", "['relief_clause', 'conditional_block', 'caption_block', 'signature_block', 'component_block'].includes(binding.kind)")
  once("if (binding.kind === 'caption_block' || binding.kind === 'signature_block' || (binding.kind === 'relief_clause'", "if (binding.kind === 'caption_block' || binding.kind === 'signature_block' || binding.kind === 'component_block' || (binding.kind === 'relief_clause'")
  once("const rangeBindings = bindings.filter((binding) =>", "const rangeBindings = bindings.filter(() => xmlPath === 'word/document.xml').filter((binding) =>")
  once("    draftingReplaceTokensInElement(xmlDoc.documentElement, data)\n    return new XMLSerializer().serializeToString(xmlDoc)", "    draftingReplaceTokensInElement(xmlDoc.documentElement, data)\n    mioApplyComponentXml(xmlDoc, data, xmlPath)\n    if (xmlDoc.documentElement.textContent.includes('[Missing:')) throw new Error('Complete the missing reusable-component values before generating.')\n    return new XMLSerializer().serializeToString(xmlDoc)")
  once("  async function generateDocxFromTemplateFile(templateFile, data, matter, template = null) {", `  async function generateDocxFromTemplateFile(templateFile, data, matter, template = null) {
    const componentErrors = mioComponentIssues(data, templateFile)
    if (componentErrors.length) throw new Error(componentErrors.join(' '))
    data = mioFileComponentData(data, templateFile, draftingProfile)`)
  once('    const draftingComposerBindingValue = (binding) => draftingBindingValue(binding, assemblyData || {}, template)', "    const draftingComposerBindingValue = (binding) => draftingBindingValue(binding, mioFileComponentData(assemblyData || {}, { id: draftingComposerFileKey }, draftingProfile), template)")
  // Replace the old read-only preview widgets, not the template's Word formatting.
  const uiStart = "              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10, marginTop: 12 }}>\n                <LabeledField label=\"Caption / case style for this document\">"
  const ua = code.indexOf(uiStart)
  if (ua < 0) throw new Error('V278 composer controls changed')
  const ub = code.indexOf('            </section>', ua)
  if (ub < ua) throw new Error('V278 composer section end changed')
  code = code.slice(0,ua) + `              <DraftingComponents data={assemblyData} profile={draftingProfile} template={template} selectedFiles={selectedFileKeys} fieldValues={fieldValues} onChange={(value) => updateDraftingFieldValue('drafting_components', value)} onStyleChange={updateDraftingFieldValue} onSaveDefaults={mioSaveDraftingDefaults} ensureZip={ensureDraftingZipLibrary} />\n` + code.slice(ub)
  once('  function renderDraftingPage(options = {}) {', '  function renderDraftingPageLegacy(options = {}) {')
  once('  function renderDraftingSettings() {', '  function renderDraftingSettingsLegacy() {')
  const helpers = `  async function mioSaveDraftingDefaults(patch) {
    const next = draftingNormalizeProfile({ ...draftingProfile, ...patch, updated_at: new Date().toISOString() })
    await saveMioStateKeyNow('caseMioDraftingProfile', JSON.stringify(next), { throwOnError: true })
    setDraftingProfile(next)
    setDraftingGeneratedFiles([])
    setDraftingOutput('')
  }
  function renderMioDraftingDefaults() {
    return <><DraftingPreferences profile={draftingProfile} caseTypes={Array.from(new Set(matters.map(draftingMatterTypeValue).filter(Boolean)))} onSave={mioSaveDraftingDefaults} /><details><summary>Caption and signature library</summary>{renderDraftingProfileSettings()}</details></>
  }
  function renderDraftingPage(options = {}) {
    return <DraftingFrame settings={renderMioDraftingDefaults()}>{renderDraftingPageLegacy(options)}</DraftingFrame>
  }
  function renderDraftingSettings() {
    return <DraftingFrame settings={renderMioDraftingDefaults()}>{draftingStudioTab === 'case_styles' && <DraftingPreferences profile={draftingProfile} caseTypes={Array.from(new Set(matters.map(draftingMatterTypeValue).filter(Boolean)))} onSave={mioSaveDraftingDefaults} />}{renderDraftingSettingsLegacy()}</DraftingFrame>
  }
`
  once('  function renderDraftingSettingsLegacy() {', helpers + '\n  function renderDraftingSettingsLegacy() {')
  const bindAnchor = "{draftingBindingDraft.kind === 'conditional_block' &&"
  once(bindAnchor, `<>{draftingBindingDraft.kind === 'component_block' && <LabeledField label="Reusable component"><select value={draftingBindingDraft.field_key || ''} onChange={event => setDraftingBindingDraft(current => ({ ...current, field_key: event.target.value }))}><option value="">Choose component...</option>{MIO_DRAFT_COMPONENTS.filter(item => item.kind === 'component_block').map(item => <option key={item.key} value={item.token}>{item.label}</option>)}</select></LabeledField>}</>${bindAnchor}`)
  return code
}
export default function mioV278DraftingComponents() {
  return { name: 'mio-v278-drafting-components', enforce: 'pre', transform(source, id) { return id.split('?')[0].endsWith('/src/App.jsx') ? transformDraftingComponents(source) : null } }
}
