// Mio V289: completes the V288 native-details wrapping using the actual legacy field condition.
export default function mioV289DraftingCollapseRepair() {
  return {
    name: 'mio-v289-drafting-collapse-repair',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source
      code = code.replace("const MIO_APP_VERSION = 'Mio V288 (clean drafting page)'", "const MIO_APP_VERSION = 'Mio V289 (clean drafting page)'")

      const oldBoundary = "              </div>\n            </section>}\n\n            {(template.fields || []).length > 0 && <section style={{ border: '1px solid #94a3b8', borderRadius: 10, padding: 11, background: '#f8fafc' }}>"
      const newBoundary = "              </div>\n            </section></details>}\n\n            {draftingApplicableFields.length > 0 && <details open={draftingUnresolvedFields.length > 0} style={{ border: '1px solid #94a3b8', borderRadius: 10, padding: 10, background: '#f8fafc' }}><summary style={{ cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>Other fields & clauses {draftingUnresolvedFields.length ? '— ' + draftingUnresolvedFields.length + ' need attention' : '— complete'}</summary><section style={{ paddingTop: 10 }}>"
      if (code.includes(oldBoundary)) code = code.replace(oldBoundary, newBoundary)

      const start = code.indexOf('Other fields & clauses')
      if (start >= 0) {
        const boundary = "            </section>}\n\n            {preflightIssues.length > 0 && <details"
        const at = code.indexOf(boundary, start)
        if (at >= 0) {
          code = code.slice(0, at) + "            </section></details>}\n\n            {preflightIssues.length > 0 && <details" + code.slice(at + boundary.length)
        }
      }
      return { code, map: null }
    }
  }
}
