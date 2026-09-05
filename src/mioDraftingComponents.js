// Shared by the composer, previews, and Word generation. No browser persistence.
export const COMPONENTS = [
  { key: 'caption', label: 'Case caption / styling', token: 'case_caption_text', kind: 'caption_block' },
  { key: 'signature', label: 'Signature block', token: 'attorney_signature_block', kind: 'signature_block' },
  { key: 'certificate', label: 'Certificate of service', token: 'certificate_of_service_text', kind: 'component_block' },
  { key: 'notice', label: 'Notice block', token: 'custom_notice_text', kind: 'component_block' },
  { key: 'custom', label: 'Custom reusable block', token: 'custom_component_text', kind: 'component_block' }
]
export const DEFAULT_COMPONENT_TEXT = {
  certificate: 'CERTIFICATE OF SERVICE\nI certify that a true and correct copy of the foregoing was served on {{service_recipients_text}} by {{service_method}} on {{service_date}}.\n\n{{attorney_name}}',
  notice: '', custom: ''
}
export const DEFAULT_LAYOUT = { font: 'Times New Roman', size: 12, line: 1, margin: 1 }
export const caseTypeKey = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
export function resolveCaseStyle(profile, caseType, hasChildren, overrideId = '') {
  const styles = (profile?.case_styles || []).filter(s => s.is_active !== false)
  const byId = id => styles.find(s => String(s.id) === String(id))
  if (overrideId && byId(overrideId)) return byId(overrideId)
  const key = caseTypeKey(caseType), map = profile?.case_type_style_map || {}
  const mapped = Object.entries(map).find(([name]) => caseTypeKey(name) === key)?.[1]
  if (mapped && byId(mapped)) return byId(mapped)
  const divorce = mapped === '@divorce' || (!mapped && /\bdivorce\b/.test(key))
  if (divorce) return styles.find(s => s.kind === 'divorce' && !!s.requires_children === !!hasChildren) || styles.find(s => s.kind === 'divorce') || null
  return byId(profile?.default_case_style_id) || styles.find(s => s.kind === 'sapcr') || styles[0] || null
}
export function fillComponent(text, data, markMissing = true) {
  return String(text ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    const value = key.split('.').reduce((result, part) => result?.[part], data)
    return value == null || value === '' ? (markMissing ? `[Missing: ${key}]` : '') : String(value)
  })
}
export function componentDefault(key, data, profile) {
  const definition = COMPONENTS.find(c => c.key === key)
  if (!definition) return ''
  if (key === 'caption' || key === 'signature') return String(data?.[definition.token] ?? '')
  return fillComponent(profile?.component_templates?.[key] ?? DEFAULT_COMPONENT_TEXT[key], data)
}
export function fileComponentData(data, file, profile) {
  const fileKey = String(file?.id || file?.name || '')
  const saved = data?.drafting_components?.[fileKey] || {}
  const result = { ...data }
  for (const c of COMPONENTS) {
    result[c.token] = saved[c.key]?.placement === 'bound' ? String(saved[c.key].text ?? '') : componentDefault(c.key, data, profile)
  }
  if (saved.caption?.placement === 'bound') {
    const lines = result.case_caption_text.split('\n')
    result.caption_left_line_1 = lines[0] || ''
    result.caption_left_line_2 = lines[1] || ''
    result.caption_left_line_3 = lines.slice(2).join('\n')
  }
  result._component_instances = saved
  result._component_file_key = fileKey
  return result
}
export function validateLayout(value) {
  if (!value || !Object.keys(value).length) return null
  const result = { font: String(value.font || DEFAULT_LAYOUT.font).trim(), size: Number(value.size), line: Number(value.line), margin: Number(value.margin) }
  if (!result.font || result.font.length > 80 || !Number.isFinite(result.size) || result.size < 8 || result.size > 32 || !Number.isFinite(result.line) || result.line < .8 || result.line > 3 || !Number.isFinite(result.margin) || result.margin < .25 || result.margin > 2) throw new Error('Use a font size of 8-32 pt, spacing 0.8-3, and margins 0.25-2 inches.')
  return result
}
export function componentIssues(data, file) {
  const saved = data?.drafting_components?.[String(file?.id || file?.name || '')] || {}
  const issues = []
  for (const c of COMPONENTS) {
    const instance = saved[c.key]
    if (!instance) continue
    if (!['bound', 'append'].includes(instance.placement)) issues.push(`${c.label}: choose a mapped template target or append.`)
    if (/\[Missing:|\{\{/.test(instance.text || '')) issues.push(`${c.label}: fill the missing values before generating.`)
  }
  try { if (saved.layout) validateLayout(saved.layout) } catch (e) { issues.push(e.message) }
  return issues
}
export function componentHasTarget(component, template, file, xmlText = '') {
  const key = String(file?.id || file?.name || '')
  const binding = (template?.bindings || []).some(b => b.is_active !== false && (!b.file_id || String(b.file_id) === key) && (b.kind === component.kind && (component.kind !== 'component_block' || b.field_key === component.token)))
  return binding || xmlText.includes('{{' + component.token + '}}') || (component.key === 'caption' && xmlText.includes('{{caption_left_line_1}}'))
}
const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
// Only explicit instance changes reach this function. Original alignment, tabs, tables, and numbering stay intact.
export function applyComponentXml(doc, data, xmlPath) {
  if (xmlPath !== 'word/document.xml') return
  const instances = data?._component_instances || {}, body = doc.getElementsByTagNameNS(WORD, 'body')[0]
  if (!body) return
  for (const c of COMPONENTS) {
    if (instances[c.key]?.placement !== 'append') continue
    const p = doc.createElementNS(WORD, 'w:p'), r = doc.createElementNS(WORD, 'w:r')
    String(instances[c.key].text ?? '').split('\n').forEach((line, i) => {
      if (i) r.appendChild(doc.createElementNS(WORD, 'w:br'))
      const t = doc.createElementNS(WORD, 'w:t'); t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); t.textContent = line; r.appendChild(t)
    })
    p.appendChild(r)
    const section = Array.from(body.childNodes).find(n => n.localName === 'sectPr')
    body.insertBefore(p, section || null)
  }
  if (!instances.layout) return
  const layout = validateLayout(instances.layout)
  const ensure = (parent, tag, first = false) => {
    let element = Array.from(parent.children).find(n => n.namespaceURI === WORD && n.localName === tag)
    if (!element) { element = doc.createElementNS(WORD, `w:${tag}`); if (first) parent.insertBefore(element, parent.firstChild); else parent.appendChild(element) }
    return element
  }
  for (const section of Array.from(doc.getElementsByTagNameNS(WORD, 'sectPr'))) {
    const margins = ensure(section, 'pgMar')
    for (const side of ['top','bottom','left','right']) margins.setAttributeNS(WORD, `w:${side}`, String(Math.round(layout.margin * 1440)))
  }
  for (const p of Array.from(body.getElementsByTagNameNS(WORD, 'p'))) {
    const spacing = ensure(ensure(p, 'pPr', true), 'spacing')
    spacing.setAttributeNS(WORD, 'w:line', String(Math.round(layout.line * 240))); spacing.setAttributeNS(WORD, 'w:lineRule', 'auto')
  }
  for (const r of Array.from(body.getElementsByTagNameNS(WORD, 'r'))) {
    const props = ensure(r, 'rPr', true), fonts = ensure(props, 'rFonts')
    for (const key of ['ascii','hAnsi','cs','eastAsia']) { fonts.setAttributeNS(WORD, `w:${key}`, layout.font); fonts.removeAttributeNS(WORD, `${key}Theme`) }
    for (const key of ['sz','szCs']) ensure(props, key).setAttributeNS(WORD, 'w:val', String(layout.size * 2))
  }
}
const STATIC_LEGAL = /^(?:Texas Rules(?: of Civil Procedure)?|Civil Procedure|Texas Family(?: Code)?|Family Code|The Court|District Court|Supreme Court|Motion for Withdrawal(?: of Attorney)?|Certificate of Service|Notice of Court Proceeding)$/i
export function reviewSuggestions(suggestions = []) {
  return suggestions.filter(s => !STATIC_LEGAL.test(String(s.source_text || '').trim())).map(s => ({
    ...s,
    ...(s.kind === 'pronoun' ? { replace_all: false, reason: 'Confirm the party and grammatical role. Only this selected occurrence will be replaced.' } : {}),
    source: s.source === 'local_ai' ? 'local_rule' : s.source
  }))
}
export function semanticSuggestions(document, attorneyNames = []) {
  if (!document?.paragraphs) return []
  const out = [], seen = new Set()
  const add = (paragraph, text, key, label, source, all = false) => {
    if (!text || STATIC_LEGAL.test(text.trim())) return
    const id = `${key}|${text}|${all ? 'all' : paragraph.index}`
    if (seen.has(id)) return
    seen.add(id)
    const at = String(paragraph.text || paragraph.normalized || '').indexOf(text)
    out.push({ id: `semantic-${out.length}-${paragraph.index}`, kind: 'field', label, field_key: key, data_source: source,
      source_text: text, file_id: document.file_id, paragraph_start: paragraph.index, paragraph_end: paragraph.index,
      start_offset: Math.max(0, at), end_offset: Math.max(0, at) + text.length, replace_all: all,
      source: 'local_rule', confidence: .8, reason: all ? 'Known attorney profile value; verify that every matching name refers to the same attorney.' : 'Detected from the surrounding label. Confirm the proposed source before accepting.' })
  }
  for (const p of document.paragraphs) {
    const text = String(p.text || p.normalized || '')
    for (const name of attorneyNames.filter(Boolean)) if (text.includes(name)) add(p, name, 'attorney_name', 'Attorney name', 'attorney.name', true)
    const cause = text.match(/CAUSE\s+(?:NO\.?|NUMBER)\s*[:#]?\s*([A-Z0-9][A-Z0-9.\/-]*)/i)
    if (cause) add(p, cause[1], 'cause_number', 'Cause number', 'matter.cause_number')
    const county = text.match(/\b([A-Z][A-Za-z ]{1,30})\s+COUNTY,?\s+TEXAS\b/i)
    if (county) add(p, county[0], 'county_caption', 'County caption (include County, Texas)', 'manual')
    const court = text.match(/\b\d+(?:st|nd|rd|th)\s+JUDICIAL\s+DISTRICT\b/i)
    if (court) add(p, court[0], 'court_caption_line_2', 'Court caption line', 'manual')
    const email = text.match(/(?:E-?mail(?: address)?\s*:\s*)([^\s<>]+@[^\s<>]+)/i)
    if (email) add(p, email[1], 'service_email', 'Contact email - confirm recipient', 'manual')
    const phone = text.match(/(?:Telephone(?: number)?|Phone)\s*:\s*([+()\d .-]{7,25})/i)
    if (phone) add(p, phone[1].trim(), 'contact_phone', 'Contact phone - confirm person', 'manual')
    const address = text.match(/Mailing address\s*:\s*(.+)/i)
    if (address) add(p, address[1].trim(), 'client_address_inline', 'Client mailing address', 'matter.client_address')
    const client = text.match(/attorney in charge for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,4})/)
    if (client) add(p, client[1], 'client_name', 'Represented client name', 'matter.client_name', true)
  }
  return out
}
