// Mio V298: make the visual template builder read like a reusable form, not the uploaded case.
// Saved bindings are displayed as generic field placeholders while keeping the original source
// text underneath (transparent) so selection offsets and V295 source-text anchors stay stable.
function replaceRequired(code, from, to, label) {
  if (!code.includes(from)) throw new Error('V298 integration anchor changed: ' + label)
  return code.replace(from, to)
}

export default function mioV298TemplatePlaceholders() {
  return {
    name: 'mio-v298-template-placeholders',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      code = code.replace(/const MIO_APP_VERSION = 'Mio V295[^']*'/, "const MIO_APP_VERSION = 'Mio V298 (visual template fields)'")

      const paragraphAnchor = "  function draftingStudioV274ParagraphNode(paragraph, template, keyPrefix = '') {"
      if (!code.includes(paragraphAnchor)) throw new Error('V298 integration anchor changed: V274 paragraph renderer')

      if (!code.includes('function draftingStudioV298RenderTemplateParagraph(')) {
        const helpers = `  function draftingStudioV298CurrentFileKey(template) {
    const file = draftingStudioCurrentFile(template)
    return String(file?.id || file?.name || '')
  }

  function draftingStudioV298Bindings(template) {
    const fileKey = draftingStudioV298CurrentFileKey(template)
    return (template?.bindings || []).filter((binding) => {
      if (!binding || binding.is_active === false || !binding.source_text) return false
      if (binding.file_id && String(binding.file_id) !== fileKey) return false
      return true
    })
  }

  function draftingStudioV298BindingLocation(binding) {
    if (typeof mioResolveBindingLocationV295 === 'function') return mioResolveBindingLocationV295(binding)
    const startParagraph = Number(binding?.paragraph_start)
    const endParagraph = Number(binding?.paragraph_end)
    const startOffset = Number(binding?.start_offset)
    const endOffset = Number(binding?.end_offset)
    return {
      paragraph_start: Number.isFinite(startParagraph) ? startParagraph : 0,
      paragraph_end: Number.isFinite(endParagraph) ? endParagraph : (Number.isFinite(startParagraph) ? startParagraph : 0),
      start_offset: Number.isFinite(startOffset) ? startOffset : 0,
      end_offset: Number.isFinite(endOffset) ? endOffset : ((Number.isFinite(startOffset) ? startOffset : 0) + String(binding?.source_text || '').length)
    }
  }

  function draftingStudioV298BindingLabel(binding) {
    const explicit = String(binding?.label || '').trim()
    const source = String(binding?.data_source || '')
    let sourceLabel = ''
    try { sourceLabel = source && source !== 'manual' && typeof draftingV276SourceLabel === 'function' ? String(draftingV276SourceLabel(source) || '') : '' } catch {}
    const rawKey = String(binding?.field_key || '').replace(/[_.-]+/g, ' ').trim()
    let base = explicit || sourceLabel || rawKey || 'Template value'
    base = base.replace(/\\s*[—–]\\s*(full name|first name|last name|mailing address|email|phone|current date).*$/i, '').trim() || base
    const kind = String(binding?.kind || 'field')
    if (kind === 'pronoun') return /pronoun/i.test(base) ? base : base + ' pronoun field'
    if (kind === 'paragraph_choice') return /paragraph|choice/i.test(base) ? base : base + ' paragraph choice'
    if (/field$/i.test(base)) return base
    return base + ' field'
  }

  function draftingStudioV298BlockSpec(key) {
    const specs = {
      caption: {
        label: 'Heading / case caption block',
        fields: ['Case style', 'Petitioner / client name', 'Respondent / opposing party name', 'Child / children names']
      },
      signature: {
        label: 'Signature block',
        fields: ['Attorney name', 'State Bar number', 'Firm name', 'Firm address', 'Firm phone', 'Firm email']
      },
      conference: {
        label: 'Certificate of conference block',
        fields: ['Conference date', 'Person conferred with', 'Conference result', 'Attorney name']
      },
      certificate_simple: {
        label: 'Certificate of service block',
        fields: ['Service date', 'Attorney name']
      },
      certificate_detailed: {
        label: 'Detailed certificate of service block',
        fields: ['Service date', 'Service recipients', 'Attorney name']
      },
      notice: {
        label: 'Notice block',
        fields: ['Notice text']
      },
      custom: {
        label: 'Custom reusable block',
        fields: ['Custom block content']
      }
    }
    return specs[String(key || '').toLowerCase()] || { label: String(key || 'Reusable block') + ' block', fields: ['Block content'] }
  }

  function draftingStudioV298BlockPreview(key) {
    const spec = draftingStudioV298BlockSpec(key)
    return <span className="mio-template-block-preview" contentEditable={false}>
      <span className="mio-template-block-title">{spec.label}</span>
      <span className="mio-template-block-fields">{spec.fields.map((field) => <span key={field} className="mio-template-block-field">{field + ' field'}</span>)}</span>
    </span>
  }

  function draftingStudioV298RangeForParagraph(binding, paragraph) {
    const text = String(paragraph?.text || '')
    const paragraphIndex = Number(paragraph?.index)
    const located = draftingStudioV298BindingLocation(binding)
    const first = Number(located?.paragraph_start)
    const last = Number(located?.paragraph_end)
    if (!Number.isFinite(paragraphIndex) || !Number.isFinite(first) || !Number.isFinite(last)) return null
    const low = Math.min(first, last)
    const high = Math.max(first, last)
    if (paragraphIndex < low || paragraphIndex > high) return null
    let start = paragraphIndex === first ? Number(located?.start_offset) : 0
    let end = paragraphIndex === last ? Number(located?.end_offset) : text.length
    if (!Number.isFinite(start)) start = 0
    if (!Number.isFinite(end)) end = text.length
    start = Math.max(0, Math.min(text.length, start))
    end = Math.max(start, Math.min(text.length, end))
    if (end <= start) return null
    return { binding, start, end }
  }

  function draftingStudioV298ParagraphRanges(paragraph, template) {
    const ranges = draftingStudioV298Bindings(template)
      .map((binding) => draftingStudioV298RangeForParagraph(binding, paragraph))
      .filter(Boolean)
      .sort((a, b) => a.start - b.start || b.end - a.end)
    const nonOverlapping = []
    let cursor = -1
    ranges.forEach((range) => {
      if (range.start < cursor) return
      nonOverlapping.push(range)
      cursor = range.end
    })
    return nonOverlapping
  }

  function draftingStudioV298ParagraphHasTemplateControls(paragraph, template) {
    const text = String(paragraph?.text || '')
    if (/^\\s*\\[\\[MIO_BLOCK:[a-z0-9_]+\\]\\]\\s*$/i.test(text)) return true
    return draftingStudioV298ParagraphRanges(paragraph, template).length > 0
  }

  function draftingStudioV298InlineField(sourceText, binding, key) {
    const label = draftingStudioV298BindingLabel(binding)
    const displayLabel = String(label || 'Template field').toUpperCase()
    const minWidth = Math.max(8, Math.min(46, Math.max(String(sourceText || '').length, displayLabel.length + 2)))
    return <span key={key} className="mio-template-field-placeholder" data-mio-template-label={displayLabel} title={label} style={{ minWidth: minWidth + 'ch' }} contentEditable={false}>
      <span className="mio-template-field-source">{sourceText || ' '}</span>
    </span>
  }

  function draftingStudioV298RenderTemplateParagraph(paragraph, template) {
    const text = String(paragraph?.text || '')
    const block = text.trim().match(/^\\[\\[MIO_BLOCK:([a-z0-9_]+)\\]\\]$/i)
    if (block) return draftingStudioV298BlockPreview(block[1])
    const ranges = draftingStudioV298ParagraphRanges(paragraph, template)
    if (!ranges.length) return renderDraftingStudioHighlightedText(paragraph, template)
    const pieces = []
    let cursor = 0
    ranges.forEach((range, index) => {
      if (range.start > cursor) pieces.push(text.slice(cursor, range.start))
      pieces.push(draftingStudioV298InlineField(text.slice(range.start, range.end), range.binding, 'field-' + paragraph.index + '-' + index + '-' + range.start))
      cursor = range.end
    })
    if (cursor < text.length) pieces.push(text.slice(cursor))
    return pieces
  }

`
        code = code.replace(paragraphAnchor, helpers + paragraphAnchor)
      }

      code = replaceRequired(
        code,
        '{renderDraftingStudioHighlightedText(paragraph, template)}',
        '{draftingStudioV298RenderTemplateParagraph(paragraph, template)}',
        'visual template paragraph text'
      )

      code = replaceRequired(
        code,
        'contentEditable={draftingWordEditorEnabled && !paragraph.hidden}',
        'contentEditable={draftingWordEditorEnabled && !paragraph.hidden && !draftingStudioV298ParagraphHasTemplateControls(paragraph, template)}',
        'bound-field content editing guard'
      )

      return { code, map: null }
    }
  }
}
