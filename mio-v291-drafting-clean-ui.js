// Mio V291: safe UI-only collapsing; optional content stays in place and is only shown/hidden.
function repl(code, from, to) { return code.includes(from) ? code.replace(from, to) : code }
export default function mioV291DraftingCleanUi() {
  return {
    name: 'mio-v291-drafting-clean-ui',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source
      code = repl(code, "const MIO_APP_VERSION = 'Mio V287 (draft readiness)'", "const MIO_APP_VERSION = 'Mio V291 (clean drafting)'")

      const stateAnchor = "  const [draftingMatterQuickSaveStatus, setDraftingMatterQuickSaveStatus] = useState('')"
      code = repl(code, stateAnchor, stateAnchor + "\n  const [draftingMatterDataOpen, setDraftingMatterDataOpen] = useState(false)\n  const [draftingFieldsOpen, setDraftingFieldsOpen] = useState(false)\n  const [draftingWarningsOpen, setDraftingWarningsOpen] = useState(false)")

      const matterOpen = "            {isAssembly && matter && assemblyData && <section style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, background: '#eff6ff' }}>"
      const matterToggle = "            {isAssembly && matter && assemblyData && <details open={draftingMatterDataOpen} onToggle={(event) => setDraftingMatterDataOpen(event.currentTarget.open)} style={{ border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 10px', background: '#eff6ff' }}><summary style={{ cursor: 'pointer', fontWeight: 900 }}>Matter data & document options</summary></details>}\n" + matterOpen.replace("background: '#eff6ff'", "background: '#eff6ff', display: draftingMatterDataOpen ? 'block' : 'none'")
      code = repl(code, matterOpen, matterToggle)
      code = repl(code, '<h3 style={{ margin: 0 }}>Matter data Mio will place into the Word document</h3>', '<h3 style={{ margin: 0 }}>Matter data used for this document</h3>')

      const fieldsOpen = "            {(template.fields || []).length > 0 && <section style={{ border: '1px solid #94a3b8', borderRadius: 10, padding: 11, background: '#f8fafc' }}>"
      const fieldsToggle = "            {draftingApplicableFields.length > 0 && <details open={draftingFieldsOpen || draftingUnresolvedFields.length > 0} onToggle={(event) => setDraftingFieldsOpen(event.currentTarget.open)} style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', background: '#f8fafc' }}><summary style={{ cursor: 'pointer', fontWeight: 900 }}>Other fields & clauses {draftingUnresolvedFields.length ? '— ' + draftingUnresolvedFields.length + ' need attention' : '— complete'}</summary></details>}\n            {(template.fields || []).length > 0 && <section style={{ border: '1px solid #94a3b8', borderRadius: 10, padding: 11, background: '#f8fafc', display: (draftingFieldsOpen || draftingUnresolvedFields.length > 0) ? 'block' : 'none' }}>"
      code = repl(code, fieldsOpen, fieldsToggle)

      const warningOpen = "            {preflightIssues.length > 0 && <section style={{ border: '1px solid #fcd34d', borderRadius: 8, padding: 10, background: '#fffbeb' }}>"
      const warningToggle = "            {preflightIssues.length > 0 && <details open={draftingWarningsOpen || preflightIssues.some((issue) => issue.level === 'error')} onToggle={(event) => setDraftingWarningsOpen(event.currentTarget.open)} style={{ border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 10px', background: '#fffbeb' }}><summary style={{ cursor: 'pointer', fontWeight: 900 }}>Warnings & review items ({preflightIssues.length})</summary></details>}\n            {preflightIssues.length > 0 && <section style={{ border: '1px solid #fcd34d', borderRadius: 8, padding: 10, background: '#fffbeb', display: (draftingWarningsOpen || preflightIssues.some((issue) => issue.level === 'error')) ? 'block' : 'none' }}>"
      code = repl(code, warningOpen, warningToggle)

      // The smart readiness panel is the authority for whether assembly generation may proceed.
      code = repl(code,
        "    const errors = issues.filter((issue) => issue.level === 'error')\n    if (errors.length)",
        "    const errors = mioDraftingBlockersV287(template, matter, data, fieldValues)\n    if (errors.length)"
      )

      const generate = '<button type="button" onClick={() => generateDraftForMatter(lockedMatterId)} style={{ fontWeight: 900, color: \'#1d4ed8\' }}>'
      code = repl(code, generate, '<button type="button" disabled={isAssembly && matter && assemblyData && mioDraftingBlockersV287(template, matter, assemblyData, fieldValues).length > 0} title={isAssembly && matter && assemblyData && mioDraftingBlockersV287(template, matter, assemblyData, fieldValues).length > 0 ? \'Complete the Required before generating section first.\' : \'Generate document\'} onClick={() => generateDraftForMatter(lockedMatterId)} style={{ fontWeight: 900, color: isAssembly && matter && assemblyData && mioDraftingBlockersV287(template, matter, assemblyData, fieldValues).length > 0 ? \'#64748b\' : \'#1d4ed8\' }}>')

      return { code, map: null }
    }
  }
}
