// Mio V288: simplify the drafting page after V287 readiness is in place.
function swap(code, from, to) { return code.includes(from) ? code.replace(from, to) : code }
export default function mioV288DraftingPageCleanup() {
  return {
    name: 'mio-v288-drafting-page-cleanup',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source
      code = swap(code, "const MIO_APP_VERSION = 'Mio V287 (draft readiness)'", "const MIO_APP_VERSION = 'Mio V288 (clean drafting page)'")

      // One readiness calculation drives the visible READY/MISSING state and the Generate button.
      code = swap(code,
        "    const preflightIssues = template && matter ? draftingPreflightIssues(template, matter, assemblyData, fieldValues) : []\n    const futureEvents = draftingFutureEventsForMatter(matter)",
        "    const preflightIssues = template && matter ? draftingPreflightIssues(template, matter, assemblyData, fieldValues) : []\n    const draftingReadinessBlockers = isAssembly && template && matter && assemblyData ? mioDraftingBlockersV287(template, matter, assemblyData, fieldValues) : preflightIssues.filter((issue) => issue.level === 'error')\n    const futureEvents = draftingFutureEventsForMatter(matter)"
      )

      // Collapse the large matter-data/customization area by default.
      const matterOpen = "            {isAssembly && matter && assemblyData && <section style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, background: '#eff6ff' }}>"
      code = swap(code, matterOpen, "            {isAssembly && matter && assemblyData && <details style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: 10, background: '#eff6ff' }}><summary style={{ cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>Matter data & document options</summary><section style={{ paddingTop: 10 }}>")
      const matterClose = "              </div>\n            </section>}\n\n            {draftingApplicableFields.length > 0 && <section"
      code = swap(code, matterClose, "              </div>\n            </section></details>}\n\n            {draftingApplicableFields.length > 0 && <section")

      // Collapse template-specific fill-ins unless something still needs an answer.
      const fieldsOpen = "            {draftingApplicableFields.length > 0 && <section style={{ border: '1px solid #94a3b8', borderRadius: 10, padding: 11, background: '#f8fafc' }}>"
      code = swap(code, fieldsOpen, "            {draftingApplicableFields.length > 0 && <details open={draftingUnresolvedFields.length > 0} style={{ border: '1px solid #94a3b8', borderRadius: 10, padding: 10, background: '#f8fafc' }}><summary style={{ cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>Other fields & clauses {draftingUnresolvedFields.length ? '— ' + draftingUnresolvedFields.length + ' need attention' : '— complete'}</summary><section style={{ paddingTop: 10 }}>")
      const fieldsBoundary = "            </section>}\n\n            {preflightIssues.length > 0 && <section style={{ border: '1px solid #fcd34d'"
      const fieldsAt = code.indexOf(fieldsBoundary, code.indexOf('Other fields & clauses'))
      if (fieldsAt >= 0) {
        code = code.slice(0, fieldsAt) + "            </section></details>}\n\n            {preflightIssues.length > 0 && <section style={{ border: '1px solid #fcd34d'" + code.slice(fieldsAt + fieldsBoundary.length)
      }

      // Warnings remain available but do not dominate the page.
      code = swap(code,
        "            {preflightIssues.length > 0 && <section style={{ border: '1px solid #fcd34d', borderRadius: 8, padding: 10, background: '#fffbeb' }}>\n              <strong>Preflight review</strong>",
        "            {preflightIssues.length > 0 && <details open={preflightIssues.some((issue) => issue.level === 'error')} style={{ border: '1px solid #fcd34d', borderRadius: 8, padding: 10, background: '#fffbeb' }}><summary style={{ cursor: 'pointer', fontWeight: 900 }}>Review warnings & technical checks ({preflightIssues.length})</summary><section style={{ paddingTop: 7 }}>"
      )
      const preflightClose = "              <div style={{ display: 'grid', gap: 5, marginTop: 7 }}>{preflightIssues.map((issue, index) => <div key={`${issue.level}-${index}`} style={{ color: issue.level === 'error' ? '#991b1b' : '#92400e' }}>{issue.level === 'error' ? 'Required: ' : 'Review: '}{issue.message}</div>)}</div>\n            </section>}"
      code = swap(code, preflightClose, "              <div style={{ display: 'grid', gap: 5 }}>{preflightIssues.map((issue, index) => <div key={`${issue.level}-${index}`} style={{ color: issue.level === 'error' ? '#991b1b' : '#92400e' }}>{issue.level === 'error' ? 'Required: ' : 'Review: '}{issue.message}</div>)}</div>\n            </section></details>}")

      // Generation is visibly disabled until required information is resolved.
      const generate = '<button type="button" onClick={() => generateDraftForMatter(lockedMatterId)} style={{ fontWeight: 900, color: \'#1d4ed8\' }}>'
      code = swap(code, generate, '<button type="button" disabled={draftingReadinessBlockers.length > 0} title={draftingReadinessBlockers.length ? \'Complete the Required before generating section first.\' : \'Generate Word document\'} onClick={() => generateDraftForMatter(lockedMatterId)} style={{ fontWeight: 900, color: draftingReadinessBlockers.length ? \'#64748b\' : \'#1d4ed8\' }}>')

      // Ensure the generation function enforces the same divorce-children confirmation rule.
      code = swap(code,
        "    const errors = issues.filter((issue) => issue.level === 'error')\n    if (errors.length)",
        "    const errors = mioDraftingBlockersV287(template, matter, data, fieldValues)\n    if (errors.length)"
      )

      return { code, map: null }
    }
  }
}
