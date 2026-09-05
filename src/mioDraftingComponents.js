// Shared by the composer, previews, and Word generation. No browser persistence.
export const COMPONENTS = [
  { key: 'caption', label: 'Case caption / styling', token: 'case_caption_text', kind: 'caption_block', group: 'style' },
  { key: 'signature', label: 'Signature block', token: 'attorney_signature_block', kind: 'signature_block', group: 'closing' },
  { key: 'conference', label: 'Certificate of conference', token: 'certificate_of_conference_text', kind: 'component_block', group: 'closing' },
  { key: 'certificate_simple', label: 'Certificate of service — all parties', token: 'certificate_of_service_simple_text', kind: 'component_block', group: 'closing' },
  { key: 'certificate_detailed', label: 'Certificate of service — detailed recipients', token: 'certificate_of_service_detailed_text', kind: 'component_block', group: 'closing' },
  { key: 'notice', label: 'Notice block', token: 'custom_notice_text', kind: 'component_block', group: 'other' },
  { key: 'custom', label: 'Custom reusable block', token: 'custom_component_text', kind: 'component_block', group: 'other' }
]

export const CASE_STYLE_OPTIONS = [
  { id: '@divorce', label: 'Divorce — petitioner, respondent, then children', kind: 'divorce' },
  { id: '@sapcr', label: 'SAPCR — In the Interest of child / children', kind: 'sapcr' },
  { id: '@habeas', label: 'Habeas Corpus — Ex Parte child / children', kind: 'habeas' },
  { id: '@civil', label: 'Civil — Petitioner / Plaintiff v. Respondent / Defendant', kind: 'civil' }
]

export const DEFAULT_COMPONENT_TEXT = {
  conference: 'CERTIFICATE OF CONFERENCE\nI certify that on {{conference_date}}, I conferred with {{conference_with}} regarding the relief requested in this filing. {{conference_result}}\n\n{{attorney_name}}',
  certificate_simple: 'CERTIFICATE OF SERVICE\nI certify that all parties and counsel of record were served with a true and correct copy of the foregoing on {{service_date}} in accordance with Rule 21a of the Texas Rules of Civil Procedure.\n\n{{attorney_name}}',
  certificate_detailed: 'CERTIFICATE OF SERVICE\nI certify that a true and correct copy of the foregoing was served on {{service_date}} as follows:\n\n{{service_recipients_detailed}}\n\n{{attorney_name}}',
  notice: '',
  custom: ''
}

export const DEFAULT_LAYOUT = { font: 'Times New Roman', size: 12, line: 1, margin: 1 }
export const DEFAULT_PAGE_SETUP = {
  apply_layout: false,
  paper_size: 'letter',
  orientation: 'portrait',
  margin_top: 1,
  margin_right: 1,
  margin_bottom: 1,
  margin_left: 1,
  header_mode: 'keep',
  header_text: '',
  header_alignment: 'left',
  footer_mode: 'keep',
  footer_text: '',
  footer_alignment: 'left',
  page_number_mode: 'keep',
  page_number_location: 'bottom',
  page_number_alignment: 'center',
  page_number_format: 'page',
  page_number_start: 1,
  different_first_page: false,
  sensitive_notice_enabled: true,
  sensitive_notice_text: 'NOTICE: THIS DOCUMENT CONTAINS SENSITIVE DATA.'
}

export const caseTypeKey = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')

const builtinStyle = id => {
  const option = CASE_STYLE_OPTIONS.find(item => item.id === id)
  return option ? { id: option.id, name: option.label, kind: option.kind, is_active: true, generated: true } : null
}

export function resolveCaseStyle(profile, caseType, hasChildren, overrideId = '') {
  const styles = (profile?.case_styles || []).filter(s => s.is_active !== false)
  const byId = id => builtinStyle(id) || styles.find(s => String(s.id) === String(id))
  if (overrideId && byId(overrideId)) return byId(overrideId)
  const key = caseTypeKey(caseType), map = profile?.case_type_style_map || {}
  const mapped = Object.entries(map).find(([name]) => caseTypeKey(name) === key)?.[1]
  if (mapped && byId(mapped)) return byId(mapped)
  if (/\bdivorce\b/.test(key)) return builtinStyle('@divorce')
  if (/habeas/.test(key)) return builtinStyle('@habeas')
  if (hasChildren && /(sapcr|parent|custody|modification|enforcement|support|possession)/.test(key)) return builtinStyle('@sapcr')
  return byId(profile?.default_case_style_id) || (hasChildren ? builtinStyle('@sapcr') : builtinStyle('@civil')) || styles[0] || null
}

export function fillComponent(text, data, markMissing = true) {
  return String(text ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    const value = key.split('.').reduce((result, part) => result?.[part], data)
    return value == null || value === '' ? (markMissing ? `[Missing: ${key}]` : '') : String(value)
  })
}

function nameOfChild(child) {
  if (!child) return ''
  if (typeof child === 'string') return child.trim()
  return String(child.name || [child.first_name || child.firstName, child.middle_name || child.middleName, child.last_name || child.lastName].filter(Boolean).join(' ')).trim()
}

function dateValue(child) {
  const raw = child?.date_of_birth || child?.dob || child?.birth_date || child?.birthDate || ''
  const time = raw ? Date.parse(raw) : NaN
  return Number.isFinite(time) ? time : null
}

export function sortedChildren(data = {}) {
  let children = []
  if (Array.isArray(data.children)) children = data.children.filter(Boolean)
  else if (Array.isArray(data.child_list)) children = data.child_list.filter(Boolean)
  else if (Array.isArray(data.children_detail)) children = data.children_detail.filter(Boolean)
  if (!children.length) {
    const names = String(data.children_names || data.child_names || '').split(/\n|;|,(?=\s*[A-Z])/).map(v => v.trim()).filter(Boolean)
    children = names.map(name => ({ name }))
  }
  return children.map((child, index) => ({ child, index, name: nameOfChild(child), dob: dateValue(child), age: Number(child?.age) })).filter(item => item.name).sort((a, b) => {
    if (a.dob != null && b.dob != null) return a.dob - b.dob
    if (Number.isFinite(a.age) && Number.isFinite(b.age)) return b.age - a.age
    return a.index - b.index
  }).map(item => item.child)
}

export function formatNamesWithAnd(names = []) {
  const clean = names.map(value => String(value || '').trim()).filter(Boolean)
  if (!clean.length) return ''
  if (clean.length === 1) return clean[0]
  if (clean.length === 2) return `${clean[0]} AND ${clean[1]}`
  return `${clean.slice(0, -1).join(', ')}, AND ${clean[clean.length - 1]}`
}

export function childCaptionLines(data = {}) {
  const names = sortedChildren(data).map(nameOfChild).filter(Boolean)
  return {
    names,
    names_text: formatNamesWithAnd(names),
    child_word: names.length === 1 ? 'A CHILD' : 'CHILDREN'
  }
}

export function generatedCaseCaption(data = {}, profile = {}) {
  const style = resolveCaseStyle(profile, data.matter_case_type || data.case_type || '', sortedChildren(data).length > 0, data.case_style_id || data.case_style_kind || '')
  if (!style?.generated) return String(data.case_caption_text || '')
  const petitioner = String(data.petitioner_name || data.petitioner || data.client_name || '[PETITIONER]').trim().toUpperCase()
  const respondent = String(data.respondent_name || data.respondent || data.opposing_party_name || '[RESPONDENT]').trim().toUpperCase()
  const child = childCaptionLines(data)
  if (style.kind === 'sapcr') return ['IN THE INTEREST OF', child.names_text || '[CHILD NAME]', child.child_word].join('\n')
  if (style.kind === 'habeas') return [`EX PARTE ${child.names_text || '[CHILD NAME]'}`, child.child_word].join('\n')
  if (style.kind === 'civil') return [petitioner, 'v.', respondent].join('\n')
  const lines = ['IN THE MATTER OF THE', 'MARRIAGE OF', petitioner, 'AND', respondent]
  if (child.names.length) lines.push('AND IN THE INTEREST OF', child.names_text, child.child_word)
  return lines.join('\n')
}

export function componentDefault(key, data, profile) {
  const definition = COMPONENTS.find(c => c.key === key)
  if (!definition) return ''
  if (key === 'caption') return generatedCaseCaption(data, profile)
  if (key === 'signature') return String(data?.[definition.token] ?? '')
  const enriched = {
    ...data,
    service_recipients_detailed: data?.service_recipients_detailed || data?.service_recipients_text || '',
    service_date: data?.service_date || data?.filing_date || data?.today || '',
    conference_date: data?.conference_date || data?.filing_date || data?.today || ''
  }
  return fillComponent(profile?.component_templates?.[key] ?? DEFAULT_COMPONENT_TEXT[key], enriched)
}

export function normalizePageSetup(value = {}) {
  const setup = { ...DEFAULT_PAGE_SETUP, ...(value || {}) }
  const num = (key, min, max, fallback) => {
    const valueNumber = Number(setup[key])
    setup[key] = Number.isFinite(valueNumber) ? Math.min(max, Math.max(min, valueNumber)) : fallback
  }
  for (const key of ['margin_top','margin_right','margin_bottom','margin_left']) num(key, .25, 3, 1)
  num('page_number_start', 1, 9999, 1)
  if (!['letter','legal','a4'].includes(setup.paper_size)) setup.paper_size = 'letter'
  if (!['portrait','landscape'].includes(setup.orientation)) setup.orientation = 'portrait'
  for (const key of ['header_mode','footer_mode','page_number_mode']) if (!['keep','custom','none'].includes(setup[key])) setup[key] = 'keep'
  for (const key of ['header_alignment','footer_alignment','page_number_alignment']) if (!['left','center','right'].includes(setup[key])) setup[key] = key === 'page_number_alignment' ? 'center' : 'left'
  if (!['top','bottom'].includes(setup.page_number_location)) setup.page_number_location = 'bottom'
  if (!['plain','page','page_of'].includes(setup.page_number_format)) setup.page_number_format = 'page'
  setup.sensitive_notice_enabled = setup.sensitive_notice_enabled !== false
  setup.different_first_page = setup.different_first_page === true
  setup.apply_layout = setup.apply_layout === true
  setup.header_text = String(setup.header_text || '')
  setup.footer_text = String(setup.footer_text || '')
  setup.sensitive_notice_text = String(setup.sensitive_notice_text || DEFAULT_PAGE_SETUP.sensitive_notice_text)
  return setup
}

export function validatePageSetup(value) {
  const setup = normalizePageSetup(value)
  if (setup.header_mode === 'custom' && /\[Missing:/.test(setup.header_text)) throw new Error('Complete missing header values.')
  if (setup.footer_mode === 'custom' && /\[Missing:/.test(setup.footer_text)) throw new Error('Complete missing footer values.')
  return setup
}

export function fileComponentData(data, file, profile) {
  const fileKey = String(file?.id || file?.name || '')
  const saved = data?.drafting_components?.[fileKey] || {}
  const result = { ...data }
  for (const c of COMPONENTS) result[c.token] = saved[c.key]?.placement === 'bound' ? String(saved[c.key].text ?? '') : componentDefault(c.key, data, profile)
  if (saved.caption?.placement === 'bound') {
    const lines = result.case_caption_text.split('\n')
    result.caption_left_line_1 = lines[0] || ''
    result.caption_left_line_2 = lines[1] || ''
    result.caption_left_line_3 = lines.slice(2).join('\n')
  } else if (result.case_style_id?.startsWith?.('@') || resolveCaseStyle(profile, result.matter_case_type || result.case_type || '', sortedChildren(result).length > 0, result.case_style_id || '')?.generated) {
    result.case_caption_text = generatedCaseCaption(result, profile)
  }
  const sharedSetup = normalizePageSetup(profile?.page_setup_defaults || {})
  result._page_setup = normalizePageSetup(saved.page_setup || (profile?.page_setup_apply_by_default ? sharedSetup : DEFAULT_PAGE_SETUP))
  result._page_setup_explicit = !!saved.page_setup || profile?.page_setup_apply_by_default === true
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
    if (!['bound', 'prepend', 'append'].includes(instance.placement)) issues.push(`${c.label}: choose a mapped target, beginning, or end.`)
    if (/\[Missing:|\{\{/.test(instance.text || '')) issues.push(`${c.label}: fill the missing values before generating.`)
  }
  try { if (saved.layout) validateLayout(saved.layout) } catch (e) { issues.push(e.message) }
  try { if (saved.page_setup) validatePageSetup(saved.page_setup) } catch (e) { issues.push(e.message) }
  return issues
}

export function componentHasTarget(component, template, file, xmlText = '') {
  const key = String(file?.id || file?.name || '')
  const binding = (template?.bindings || []).some(b => b.is_active !== false && (!b.file_id || String(b.file_id) === key) && (b.kind === component.kind && (component.kind !== 'component_block' || b.field_key === component.token)))
  return binding || xmlText.includes('{{' + component.token + '}}') || (component.key === 'caption' && xmlText.includes('{{caption_left_line_1}}'))
}

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT = 'http://schemas.openxmlformats.org/package/2006/content-types'
const XML_SPACE = 'http://www.w3.org/XML/1998/namespace'

function ensureWordChild(doc, parent, localName, first = false) {
  let element = Array.from(parent?.children || []).find(n => n.namespaceURI === WORD && n.localName === localName)
  if (!element) {
    element = doc.createElementNS(WORD, `w:${localName}`)
    if (first && parent.firstChild) parent.insertBefore(element, parent.firstChild)
    else parent.appendChild(element)
  }
  return element
}

function paragraphWithText(doc, text, alignment = 'left', bold = false) {
  const p = doc.createElementNS(WORD, 'w:p')
  const pPr = doc.createElementNS(WORD, 'w:pPr')
  const jc = doc.createElementNS(WORD, 'w:jc'); jc.setAttributeNS(WORD, 'w:val', alignment); pPr.appendChild(jc); p.appendChild(pPr)
  String(text || '').split('\n').forEach((line, index) => {
    if (index) { const brRun = doc.createElementNS(WORD, 'w:r'); brRun.appendChild(doc.createElementNS(WORD, 'w:br')); p.appendChild(brRun) }
    const run = doc.createElementNS(WORD, 'w:r')
    if (bold) { const rPr = doc.createElementNS(WORD, 'w:rPr'); rPr.appendChild(doc.createElementNS(WORD, 'w:b')); run.appendChild(rPr) }
    const t = doc.createElementNS(WORD, 'w:t'); t.setAttributeNS(XML_SPACE, 'xml:space', 'preserve'); t.textContent = line; run.appendChild(t); p.appendChild(run)
  })
  return p
}

function insertComponentParagraph(doc, body, text, where) {
  const p = paragraphWithText(doc, text, 'left', false)
  const section = Array.from(body.childNodes).find(n => n.localName === 'sectPr')
  if (where === 'prepend') body.insertBefore(p, body.firstChild)
  else body.insertBefore(p, section || null)
}

function applySensitiveNotice(doc, body, setup) {
  const noticePattern = /NOTICE:\s*THIS DOCUMENT\s+CONTAINS SENSITIVE DATA\.?/i
  const existing = Array.from(body.getElementsByTagNameNS(WORD, 'p')).filter(p => noticePattern.test(p.textContent || ''))
  if (!setup.sensitive_notice_enabled) { existing.forEach(p => p.parentNode?.removeChild(p)); return }
  if (existing.length) return
  const notice = paragraphWithText(doc, setup.sensitive_notice_text, 'left', true)
  body.insertBefore(notice, body.firstChild)
}

// Only explicit instance changes reach this function. Original alignment, tabs, tables, and numbering stay intact.
export function applyComponentXml(doc, data, xmlPath) {
  if (xmlPath !== 'word/document.xml') return
  const instances = data?._component_instances || {}, body = doc.getElementsByTagNameNS(WORD, 'body')[0]
  if (!body) return
  const setup = normalizePageSetup(data?._page_setup || DEFAULT_PAGE_SETUP)
  applySensitiveNotice(doc, body, setup)
  for (const c of COMPONENTS) {
    const placement = instances[c.key]?.placement
    if (!['prepend','append'].includes(placement)) continue
    insertComponentParagraph(doc, body, String(instances[c.key].text ?? ''), placement)
  }
  const sectionProperties = Array.from(doc.getElementsByTagNameNS(WORD, 'sectPr'))
  if (data?._page_setup_explicit && setup.apply_layout) {
    const sizes = { letter: [12240,15840], legal: [12240,20160], a4: [11906,16838] }
    const base = sizes[setup.paper_size] || sizes.letter
    for (const section of sectionProperties) {
      const pgSz = ensureWordChild(doc, section, 'pgSz')
      const width = setup.orientation === 'landscape' ? base[1] : base[0], height = setup.orientation === 'landscape' ? base[0] : base[1]
      pgSz.setAttributeNS(WORD, 'w:w', String(width)); pgSz.setAttributeNS(WORD, 'w:h', String(height))
      if (setup.orientation === 'landscape') pgSz.setAttributeNS(WORD, 'w:orient', 'landscape'); else pgSz.removeAttributeNS(WORD, 'orient')
      const margins = ensureWordChild(doc, section, 'pgMar')
      for (const [side, key] of [['top','margin_top'],['right','margin_right'],['bottom','margin_bottom'],['left','margin_left']]) margins.setAttributeNS(WORD, `w:${side}`, String(Math.round(setup[key] * 1440)))
    }
  }
  if (instances.layout) {
    const layout = validateLayout(instances.layout)
    for (const section of sectionProperties) {
      const margins = ensureWordChild(doc, section, 'pgMar')
      for (const side of ['top','bottom','left','right']) margins.setAttributeNS(WORD, `w:${side}`, String(Math.round(layout.margin * 1440)))
    }
    for (const p of Array.from(body.getElementsByTagNameNS(WORD, 'p'))) {
      const spacing = ensureWordChild(doc, ensureWordChild(doc, p, 'pPr', true), 'spacing')
      spacing.setAttributeNS(WORD, 'w:line', String(Math.round(layout.line * 240))); spacing.setAttributeNS(WORD, 'w:lineRule', 'auto')
    }
    for (const r of Array.from(body.getElementsByTagNameNS(WORD, 'r'))) {
      const props = ensureWordChild(doc, r, 'rPr', true), fonts = ensureWordChild(doc, props, 'rFonts')
      for (const key of ['ascii','hAnsi','cs','eastAsia']) { fonts.setAttributeNS(WORD, `w:${key}`, layout.font); fonts.removeAttributeNS(WORD, `${key}Theme`) }
      for (const key of ['sz','szCs']) ensureWordChild(doc, props, key).setAttributeNS(WORD, 'w:val', String(layout.size * 2))
    }
  }
}

function pageField(doc, instruction, placeholder = '1') {
  const field = doc.createElementNS(WORD, 'w:fldSimple'); field.setAttributeNS(WORD, 'w:instr', instruction)
  const run = doc.createElementNS(WORD, 'w:r'), text = doc.createElementNS(WORD, 'w:t'); text.textContent = placeholder; run.appendChild(text); field.appendChild(run); return field
}

function headerFooterXml(kind, text, alignment, pageNumber) {
  const parser = new DOMParser()
  const rootName = kind === 'header' ? 'hdr' : 'ftr'
  const doc = parser.parseFromString(`<w:${rootName} xmlns:w="${WORD}"/>`, 'application/xml')
  const root = doc.documentElement
  if (text) root.appendChild(paragraphWithText(doc, text, alignment, false))
  if (pageNumber?.enabled) {
    const p = doc.createElementNS(WORD, 'w:p'), pPr = doc.createElementNS(WORD, 'w:pPr'), jc = doc.createElementNS(WORD, 'w:jc')
    jc.setAttributeNS(WORD, 'w:val', pageNumber.alignment); pPr.appendChild(jc); p.appendChild(pPr)
    if (pageNumber.format !== 'plain') { const r = doc.createElementNS(WORD, 'w:r'), t = doc.createElementNS(WORD, 'w:t'); t.textContent = 'Page '; r.appendChild(t); p.appendChild(r) }
    p.appendChild(pageField(doc, 'PAGE', String(pageNumber.start || 1)))
    if (pageNumber.format === 'page_of') { const r = doc.createElementNS(WORD, 'w:r'), t = doc.createElementNS(WORD, 'w:t'); t.textContent = ' of '; r.appendChild(t); p.appendChild(r); p.appendChild(pageField(doc, 'NUMPAGES', '1')) }
    root.appendChild(p)
  }
  if (!root.childNodes.length) root.appendChild(doc.createElementNS(WORD, 'w:p'))
  return new XMLSerializer().serializeToString(doc)
}

function ensureRelationship(relDoc, type, target, preferredId) {
  const root = relDoc.documentElement
  const existing = Array.from(root.children || []).find(node => node.getAttribute('Type') === type && node.getAttribute('Target') === target)
  if (existing) return existing.getAttribute('Id')
  const ids = new Set(Array.from(root.children || []).map(node => node.getAttribute('Id')).filter(Boolean))
  let id = preferredId, counter = 1
  while (ids.has(id)) id = `${preferredId}${counter++}`
  const relationship = relDoc.createElementNS(PKG_REL, 'Relationship'); relationship.setAttribute('Id', id); relationship.setAttribute('Type', type); relationship.setAttribute('Target', target); root.appendChild(relationship)
  return id
}

function ensureContentType(contentDoc, partName, contentType) {
  if (Array.from(contentDoc.documentElement.children || []).some(node => node.getAttribute('PartName') === partName)) return
  const override = contentDoc.createElementNS(CONTENT, 'Override'); override.setAttribute('PartName', partName); override.setAttribute('ContentType', contentType); contentDoc.documentElement.appendChild(override)
}

function applyReference(doc, sectPr, localName, relId, mode) {
  const refs = Array.from(sectPr.children || []).filter(node => node.namespaceURI === WORD && node.localName === localName && (node.getAttributeNS(WORD, 'type') || node.getAttribute('w:type') || 'default') === 'default')
  if (mode === 'none') { refs.forEach(node => sectPr.removeChild(node)); return }
  if (mode !== 'custom') return
  let ref = refs[0]
  if (!ref) { ref = doc.createElementNS(WORD, `w:${localName}`); sectPr.insertBefore(ref, sectPr.firstChild) }
  ref.setAttributeNS(WORD, 'w:type', 'default'); ref.setAttributeNS(REL, 'r:id', relId)
}

export async function applyPageSetupToPackage(zip, data, file, profile) {
  if (!zip || !data) return
  const setup = normalizePageSetup(data._page_setup || DEFAULT_PAGE_SETUP)
  if (!data._page_setup_explicit && setup.header_mode === 'keep' && setup.footer_mode === 'keep' && setup.page_number_mode === 'keep' && setup.sensitive_notice_enabled) return
  const documentEntry = zip.file('word/document.xml'), relEntry = zip.file('word/_rels/document.xml.rels'), contentEntry = zip.file('[Content_Types].xml')
  if (!documentEntry || !relEntry || !contentEntry) return
  const parser = new DOMParser()
  const doc = parser.parseFromString(await documentEntry.async('string'), 'application/xml')
  const relDoc = parser.parseFromString(await relEntry.async('string'), 'application/xml')
  const contentDoc = parser.parseFromString(await contentEntry.async('string'), 'application/xml')
  const sections = Array.from(doc.getElementsByTagNameNS(WORD, 'sectPr'))
  if (!sections.length) return
  const filledHeader = fillComponent(setup.header_text, data, false), filledFooter = fillComponent(setup.footer_text, data, false)
  const pageNumber = setup.page_number_mode === 'custom' ? { enabled: true, alignment: setup.page_number_alignment, format: setup.page_number_format, start: setup.page_number_start } : null
  let headerId = '', footerId = ''
  const needsHeaderFile = setup.header_mode === 'custom' || (pageNumber && setup.page_number_location === 'top')
  const needsFooterFile = setup.footer_mode === 'custom' || (pageNumber && setup.page_number_location === 'bottom')
  if (needsHeaderFile) {
    const target = 'header-mio.xml'
    headerId = ensureRelationship(relDoc, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', target, 'rIdMioHeader')
    ensureContentType(contentDoc, '/word/header-mio.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml')
    zip.file('word/' + target, headerFooterXml('header', setup.header_mode === 'custom' ? filledHeader : '', setup.header_alignment, pageNumber && setup.page_number_location === 'top' ? pageNumber : null))
  }
  if (needsFooterFile) {
    const target = 'footer-mio.xml'
    footerId = ensureRelationship(relDoc, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', target, 'rIdMioFooter')
    ensureContentType(contentDoc, '/word/footer-mio.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml')
    zip.file('word/' + target, headerFooterXml('footer', setup.footer_mode === 'custom' ? filledFooter : '', setup.footer_alignment, pageNumber && setup.page_number_location === 'bottom' ? pageNumber : null))
  }
  for (const sectPr of sections) {
    applyReference(doc, sectPr, 'headerReference', headerId, needsHeaderFile ? 'custom' : setup.header_mode)
    applyReference(doc, sectPr, 'footerReference', footerId, needsFooterFile ? 'custom' : setup.footer_mode)
    const titlePg = Array.from(sectPr.children || []).find(node => node.namespaceURI === WORD && node.localName === 'titlePg')
    if (setup.different_first_page && !titlePg) sectPr.appendChild(doc.createElementNS(WORD, 'w:titlePg'))
    if (!setup.different_first_page && titlePg) sectPr.removeChild(titlePg)
    if (setup.page_number_mode === 'custom') ensureWordChild(doc, sectPr, 'pgNumType').setAttributeNS(WORD, 'w:start', String(setup.page_number_start))
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc))
  zip.file('word/_rels/document.xml.rels', new XMLSerializer().serializeToString(relDoc))
  zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(contentDoc))
}

const STATIC_LEGAL = /^(?:Texas Rules(?: of Civil Procedure)?|Civil Procedure|Texas Family(?: Code)?|Family Code|The Court|District Court|Supreme Court|Motion for Withdrawal(?: of Attorney)?|Certificate of Service|Certificate of Conference|Notice of Court Proceeding)$/i
export function reviewSuggestions(suggestions = []) {
  return suggestions.filter(s => !STATIC_LEGAL.test(String(s.source_text || '').trim())).map(s => ({ ...s, ...(s.kind === 'pronoun' ? { replace_all: false, reason: 'Confirm the party and grammatical role. Only this selected occurrence will be replaced.' } : {}), source: s.source === 'local_ai' ? 'local_rule' : s.source }))
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
    out.push({ id: `semantic-${out.length}-${paragraph.index}`, kind: 'field', label, field_key: key, data_source: source, source_text: text, file_id: document.file_id, paragraph_start: paragraph.index, paragraph_end: paragraph.index, start_offset: Math.max(0, at), end_offset: Math.max(0, at) + text.length, replace_all: all, source: 'local_rule', confidence: .8, reason: all ? 'Known attorney profile value; verify that every matching name refers to the same attorney.' : 'Detected from the surrounding label. Confirm the proposed source before accepting.' })
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
