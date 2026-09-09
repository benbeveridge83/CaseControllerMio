function once(code, from, to, label) {
  if (code.split(from).length !== 2) throw new Error('V312 native matter anchor changed: ' + label)
  return code.replace(from, () => to)
}
export default function nativeMatters() { return {
  name: 'mio-v312-native-matters', enforce: 'pre', transform(source, id) {
    if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/App.jsx')) return null
    let code = "import {nativeMatterReference,legacyLinkChanged} from './mioNativeMatterIdentity.js'\n" + source
    code = once(code, "    const requestedClioMatterId = String(matterClioLinkDraft.clio_matter_id || '').trim()", `    const previousLegacyLink = clioMioRosetta?.[String(editingMatterId || '')] || {}
    const clioLinkChanged = legacyLinkChanged(previousLegacyLink, matterClioLinkDraft, normalizeClioMatterNumber)
    const requestedClioMatterId = String(matterClioLinkDraft.clio_matter_id || '').trim()`, 'detect explicit legacy edit')
    code = once(code, "if (requestedClioMatterId && !/^\\d+$/.test(requestedClioMatterId))", "if (clioLinkChanged && requestedClioMatterId && !/^\\d+$/.test(requestedClioMatterId))", 'validate only changed legacy ID')
    code = once(code, 'if (editingMatterId && requestedClioMatterId && usedClioMatterIdsInRosetta(editingMatterId).has(requestedClioMatterId))', 'if (clioLinkChanged && editingMatterId && requestedClioMatterId && usedClioMatterIdsInRosetta(editingMatterId).has(requestedClioMatterId))', 'legacy duplicate ID')
    code = once(code, `    if (requestedClioMatterId && !requestedResolvedDisplayNumber) {
      alert('Enter the Clio Matter Number too (for example, 00319-hicks dfps). Mio needs the number that appears in the Clio reports when the Clio matter list has not been loaded.')
      return
    }
`, '', 'remove mandatory external display number')
    code = once(code, '    if (duplicateNumberLink) {', '    if (clioLinkChanged && duplicateNumberLink) {', 'ignore unchanged legacy duplicates')
    code = once(code, '      const linkedClioMatter = requestedLinkedClioMatter', '      if (clioLinkChanged) {\n      const linkedClioMatter = requestedLinkedClioMatter', 'skip unrelated legacy writes')
    code = once(code, "      if (!clioLinkSaved) alert('The matter was saved, but Mio could only keep the Clio link in this browser. Reconnect to Supabase before using another device.')", "      if (!clioLinkSaved) alert('The Mio matter was saved. The optional legacy Clio reference was not saved; see the cloud-save panel before closing this tab.')\n      }", 'truthful optional link error')
    code = once(code, `  function billingMatterNumber(matter = {}) {
    const mapping = clioMioRosetta?.[String(matter?.id || '')] || {}
    return mapping.clio_display_number || mapping.clio_matter_number || matter.clio_display_number || matter.clio_matter_number || matter.cause_number || ''
  }`, `  function billingMatterNumber(matter = {}) { return nativeMatterReference(matter) }`, 'native invoice references')
    code = once(code, `    const numbered = billingMatterNumber(matter) || matter.clio_matter_number || matter.clio_display_number || matter.cause_number || matter.case_number || ''`, `    if (matter.id) return 'mio:' + String(matter.id)
    const numbered = nativeMatterReference(matter)`, 'native graph identity')
    const start='                    <LabeledField label="Clio Matter ID">', end='                    <LabeledField label="Hire Date">'
    let pos=0,count=0
    while ((pos=code.indexOf(start,pos))>=0) {
      const stop=code.indexOf(end,pos); if(stop<0) throw new Error('V312 legacy form boundary moved')
      const section=code.slice(pos,stop)
      const replacement='                    <details style={{gridColumn:"1 / -1"}}><summary>Legacy Clio reference (optional)</summary><p>Not required for Mio matters, billing or documents. Retained only for historical imports.</p>'+section+'</details>\n\n'
      code=code.slice(0,pos)+replacement+code.slice(stop);pos+=replacement.length;count++
    }
    if(count!==2) throw new Error('V312 expected both matter editors')
    code = once(code, 'Mio V311 (withdrawal rows + matter status)', 'Mio V312 (native matters + saved filters)', 'release label')
    return {code,map:null}
  }
}}
