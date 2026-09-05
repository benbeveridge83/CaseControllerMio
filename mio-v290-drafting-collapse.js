// Mio V290: native <details> wrappers for optional drafting sections, built on stable V287.
function replaceFirst(code, from, to) { return code.includes(from) ? code.replace(from, to) : code }
export default function mioV290DraftingCollapse() {
  return {
    name: 'mio-v290-drafting-collapse',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source
      code = replaceFirst(code, "const MIO_APP_VERSION = 'Mio V287 (draft readiness)'", "const MIO_APP_VERSION = 'Mio V290 (clean drafting)'")

      code = replaceFirst(code,
        "    const preflightIssues = template && matter ? draftingPreflightIssues(template, matter, assemblyData, fieldValues) : []\n    const futureEvents = draftingFutureEventsForMatter(matter)",
        "    const preflightIssues = template && matter ? draftingPreflightIssues(template, matter, assemblyData, fieldValues) : []\n    const draftingReadinessBlockers = isAssembly && template && matter && assemblyData ? mioDraftingBlockersV287(template, matter, assemblyData, fieldValues) : preflightIssues.filter((issue) => issue.level === 'error')\n    const futureEvents = draftingFutureEventsForMatter(matter)"
      )

      const matterOpen = "            {isAssembly && matter && assemblyData && <section style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, background: '#eff6ff' }}>"
      code = replaceFirst(code, matterOpen, "            {isAssembly && matter && assemblyData && <details style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, background: '#eff6ff' }}><summary style={{ cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>Matter data & document options</summary>")
      const matterEnd = "              </div>\n            </section>}\n\n            {(template.fields || []).length > 0 && <section"
      code = replaceFirst(code, matterEnd, "              </div>\n            </details>}\n\n            {(template.fields || []).length > 0 && <section")

      const fieldsOpen = "            {(template.fields || []).length > 0 && <section style={{ border: '1px solid #94a3b8', borderRadius: 10, padding: 11, background: '#f8fafc' }}>"
      code = replaceFirst(code, fieldsOpen, "            {draftingApplicableFields.length > 0 && <details open={draftingUnresolvedFields.length > 0} style={{ border: '1px solid #94a3b8', borderRadius: 10, padding: 11, background: '#f8fafc' }}><summary style={{ cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>Other fields & clauses {draftingUnresolvedFields.length ? '— ' + draftingUnresolvedFields.length + ' need attention' : '— complete'}</summary>")
      const fieldsEnd = "            </section>}\n\n            {preflightIssues.length > 0 && <section style={{ border: '1px solid #fcd34d'"
      const fieldsStart = code.indexOf('Other fields & clauses')
      const fieldsAt = fieldsStart >= 0 ? code.indexOf(fieldsEnd, fieldsStart) : -1
      if (fieldsAt >= 0) {
        code = code.slice(0, fieldsAt) + "            </details>}\n\n            {preflightIssues.length > 0 && <section style={{ border: '1px solid #fcd34d'" + code.slice(fieldsAt + fieldsEnd.length)
      }

      const generate = '<button type="button" onClick={() => generateDraftForMatter(lockedMatterId)} style={{ fontWeight: 900, color: \'#1d4ed8\' }}>'
      code = replaceFirst(code, generate, '<button type="button" disabled={draftingReadinessBlockers.length > 0} title={draftingReadinessBlockers.length ? \'Complete the Required before generating section first.\' : \'Generate Word document\'} onClick={() => generateDraftForMatter(lockedMatterId)} style={{ fontWeight: 900, color: draftingReadinessBlockers.length ? \'#64748b\' : \'#1d4ed8\' }}>')

      code = replaceFirst(code,
        "    const errors = issues.filter((issue) => issue.level === 'error')\n    if (errors.length)",
        "    const errors = mioDraftingBlockersV287(template, matter, data, fieldValues)\n    if (errors.length)"
      )

      return { code, map: null }
    }
  }
}
