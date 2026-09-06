// Pure, file-scoped field locations. Never changes the source document or stores browser data.
export const BLOCK_TOKENS = {
  case_caption_text: 'caption', attorney_signature_block: 'signature',
  certificate_of_conference_text: 'conference', certificate_of_service_simple_text: 'certificate_simple',
  certificate_of_service_detailed_text: 'certificate_detailed', custom_notice_text: 'notice', custom_component_text: 'custom'
}
export function blockKey(text) {
  const value = String(text || '').trim()
  if (value.startsWith('[[MIO_BLOCK:') && value.endsWith(']]')) {
    const key = value.slice(12, -2).toLowerCase()
    return /^[a-z0-9_]+$/.test(key) ? key : ''
  }
  const token = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/)
  return token ? BLOCK_TOKENS[token[1]] || '' : ''
}
export function fieldKey(source, fallback = '') {
  const aliases = { 'matter.client_address': 'client_address_inline', 'matter.name': 'matter_name',
    'matter.case_type': 'matter_case_type', 'case.caption': 'case_caption_text', 'case.style_id': 'case_style_id',
    'attorney.signature_block': 'attorney_signature_block', 'matter.children': 'children_names',
    'matter.future_events': 'future_events_text', 'matter.service_recipients': 'service_recipients_text' }
  return aliases[source] || String(source === 'manual' ? fallback : source || fallback).replace(/^matter\./, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
}
export function validFieldSource(source) {
  return typeof source === 'string' && /^(?:manual|today|(?:matter|court|attorney|firm|opposing_counsel|case)\.[a-z][a-z0-9_.]*)$/.test(source)
}
export function activeFileBindings(template, file) {
  const aliases = new Set([file?.id, file?.name].filter(Boolean).map(String))
  return (template?.bindings || []).filter(b => b && b.is_active !== false && (!b.file_id || aliases.has(String(b.file_id))))
}
function matches(text, source, pronoun) {
  const haystack = pronoun ? text.toLowerCase() : text
  const needle = pronoun ? source.toLowerCase() : source
  if (!needle) return []
  const result = []
  let at = haystack.indexOf(needle)
  while (at >= 0) {
    if (!pronoun || (!/[\p{L}\p{N}_]/u.test(text[at - 1] || '') && !/[\p{L}\p{N}_]/u.test(text[at + needle.length] || ''))) result.push(at)
    at = haystack.indexOf(needle, at + Math.max(1, needle.length))
  }
  return result
}
export function locateBinding(binding, document) {
  const paragraphs = document?.paragraphs || [], source = String(binding?.source_text || '')
  const index = Number(binding?.paragraph_start), end = Number(binding?.paragraph_end ?? index), offset = Number(binding?.start_offset || 0)
  const at = paragraphs.findIndex((p, i) => Number(p.index ?? i) === index)
  if (!source) return null
  if (end !== index) {
    const last = paragraphs.findIndex((p, i) => Number(p.index ?? i) === end)
    if (at < 0 || last < at) return null
    const full = paragraphs.slice(at, last + 1).map(p => String(p.text || '')).join('\n')
    if (full.replace(/\s+/g, ' ').trim() !== source.replace(/\s+/g, ' ').trim()) return null
    return {paragraph_start: index, paragraph_end: end, start_offset: 0, end_offset: String(paragraphs[last].text || '').length}
  }
  const pronoun = binding.kind === 'pronoun'
  const occurrences = at < 0 ? [] : matches(String(paragraphs[at].text || ''), source, pronoun)
  const found = occurrences.includes(offset) ? offset : occurrences.length === 1 ? occurrences[0] : null
  if (found != null) return {paragraph_start: index, paragraph_end: index, start_offset: found, end_offset: found + source.length}
  // Re-anchor only when unique in the document. Do not guess among repeated names.
  const all = paragraphs.flatMap((p, i) => matches(String(p.text || ''), source, pronoun).map(start => ({p: Number(p.index ?? i), start})))
  if (all.length !== 1) return null
  return {paragraph_start: all[0].p, paragraph_end: all[0].p, start_offset: all[0].start, end_offset: all[0].start + source.length}
}
export function paragraphFields(paragraph, template, file, document) {
  const text = String(paragraph?.text || ''), index = Number(paragraph?.index)
  const ranges = []
  for (const binding of activeFileBindings(template, file)) {
    if (binding.replace_all && ['field', 'pronoun', 'paragraph_choice'].includes(binding.kind)) {
      for (const start of matches(text, String(binding.source_text || ''), binding.kind === 'pronoun')) ranges.push({start, end:start + binding.source_text.length, binding})
      continue
    }
    const location = locateBinding(binding, document)
    if (!location || index < location.paragraph_start || index > location.paragraph_end) continue
    const start = index === location.paragraph_start ? location.start_offset : 0
    const end = index === location.paragraph_end ? location.end_offset : text.length
    if (end > start) ranges.push({start, end, binding, first: index === location.paragraph_start})
  }
  ranges.sort((a,b) => a.start - b.start || b.end - a.end)
  const result = []
  for (const range of ranges) if (!result.length || range.start >= result[result.length - 1].end) result.push(range)
  return result
}
export function replaceInParagraph(text, ranges, valueFor) {
  let output = String(text)
  for (const range of [...ranges].sort((a,b) => b.start - a.start)) output = output.slice(0, range.start) + String(valueFor(range.binding) ?? '') + output.slice(range.end)
  return output
}
export function bindingSignature(b) {
  return [b.kind,b.file_id,b.paragraph_start,b.paragraph_end,b.start_offset,b.end_offset,b.field_key,b.source_text].join('|')
}
// Map displayed DOM positions to original source positions. Placeholder labels are never source text.
export function captureTemplateSelection(selection, document) {
  if (!selection || !selection.rangeCount || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  function point(node, offset, end) {
    const el = node.nodeType === 3 ? node.parentElement : node
    const p = el?.closest?.('[data-drafting-paragraph-index]')
    if (!p) return null
    const span = el?.closest?.('[data-mio-source-start]')
    if (span && p.contains(span)) {
      if (span.dataset.mioFieldId) return {index:Number(p.dataset.draftingParagraphIndex), offset:Number(end ? span.dataset.mioSourceEnd : span.dataset.mioSourceStart), field:true}
      const before = p.ownerDocument.createRange(); before.selectNodeContents(span); before.setEnd(node, offset)
      return {index:Number(p.dataset.draftingParagraphIndex), offset:Number(span.dataset.mioSourceStart) + before.toString().length}
    }
    if (node === p) {
      const spans = Array.from(p.querySelectorAll('[data-mio-source-start]'))
      const child = p.childNodes[offset]
      const next = child?.nodeType === 1 ? (child.matches('[data-mio-source-start]') ? child : child.querySelector('[data-mio-source-start]')) : null
      return {index:Number(p.dataset.draftingParagraphIndex), offset:next ? Number(next.dataset.mioSourceStart) : Number(spans.at(-1)?.dataset.mioSourceEnd || 0)}
    }
    return null
  }
  const start = point(range.startContainer, range.startOffset, false), end = point(range.endContainer, range.endOffset, true)
  if (!start || !end || start.field || end.field || start.index !== end.index) return null
  const paragraph = document?.paragraphs?.find(p => Number(p.index) === start.index)
  const text = String(paragraph?.text || '')
  let from = start.offset, to = end.offset
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--
  if (from >= to || to > text.length) return null
  const root = (range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer).closest('[data-drafting-paragraph-index]')
  if (Array.from(root.querySelectorAll('[data-mio-field-id]')).some(el => from < Number(el.dataset.mioSourceEnd) && to > Number(el.dataset.mioSourceStart))) return null
  return {paragraph_start:start.index, paragraph_end:end.index, start_offset:from, end_offset:to, source_text:text.slice(from,to), section_name:paragraph?.section_name || ''}
}
