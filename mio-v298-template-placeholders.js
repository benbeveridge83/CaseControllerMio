// Mio V298: make the visual template builder read like a reusable form, not the uploaded case.
// Saved bindings are displayed as generic field placeholders while the original source text stays
// in the stored Word template for stable anchoring and generation.
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

      code = code.replace(/const MIO_APP_VERSION = 'Mio V\d+[^']*'/, "const MIO_APP_VERSION = 'Mio V298 (visual template fields)'")

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
    base = base.replace(/\s*[\u2014\u2013-]\s*/g, ' ').replace(/\s+/g, ' ').trim()
    const kind = String(binding?.kind || 'field')
    if (kind === 'pronoun') return /pronoun/i.test(base) ? base : base + ' pronoun field'
    if (kind === 'paragraph_choice') return /paragraph|choice/i.test(base) ? base : base + ' paragraph choice'
    if (/field$/i.test(base)) return base
    return base + ' field'
  }

  function draftingStudioV298FieldChip(label, key = '') {
    return <span key={key || label} contentEditable={false} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 18, minWidth: 80, padding: '1px 5px', margin: '1px 2px', border: '1px dashed #2563eb', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', fontFamily: 'Arial,sans-serif', fontSize: 9, fontWeight: 900, letterSpacing: '.02em', lineHeight: 1.2, whiteSpace: 'nowrap', verticalAlign: 'baseline', boxSizing: 'border-box' }}>{String(label || 'Template field').toUpperCase()}</span>
  }

  function draftingStudioV298CaptionPreview() {
    const sectionMarks = Array.from({ length: 8 }, (_, index) => <div key={index}>{'\u00a7'}</div>)
    return <div contentEditable={false} style={{ width: '100%', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 24px minmax(0,1fr)', gap: 8, alignItems: 'stretch', fontFamily: 'Times New Roman,serif', fontSize: '9.5pt', lineHeight: 1.12, color: '#111827' }}>
      <div style={{ textAlign: 'left' }}>
        <div>IN THE MATTER OF THE</div><div>MARRIAGE OF</div>
        <div>{draftingStudioV298FieldChip('Petitioner name field', 'caption-petitioner')}</div>
        <div>AND</div>
        <div>{draftingStudioV298FieldChip('Respondent name field', 'caption-respondent')}</div>
        <div>AND IN THE INTEREST OF</div>
        <div>{draftingStudioV298FieldChip('Child / children names field', 'caption-children')}</div>
        <div>CHILDREN</div>
      </div>
      <div aria-hidden="true" style={{ textAlign: 'center', fontWeight: 700 }}>{sectionMarks}</div>
      <div style={{ textAlign: 'center', display: 'grid', alignContent: 'space-between', minHeight: 112 }}>
        <div>IN THE DISTRICT COURT</div>
        <div>{draftingStudioV298FieldChip('Court name field', 'caption-court')}</div>
        <div>{draftingStudioV298FieldChip('County field', 'caption-county')}, TEXAS</div>
      </div>
    </div>
  }

  function draftingStudioV298BlockSpec(key) {
    const specs = {
      caption: {
        label: 'Heading / case caption block',
        fields: ['Petitioner name', 'Respondent name', 'Child / children names', 'Court name', 'County']
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
    if (String(key || '').toLowerCase() === 'caption') return draftingStudioV298CaptionPreview()
    const spec = draftingStudioV298BlockSpec(key)
    return <span contentEditable={false} style={{ display: 'grid', gap: 5, width: 'min(100%,440px)', padding: '7px 9px', border: '1px solid #7c3aed', borderRadius: 7, background: '#faf5ff', color: '#581c87', fontFamily: 'Arial,sans-serif', textAlign: 'left', boxSizing: 'border-box' }}>
      <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '.05em', textTransform: 'uppercase' }}>{spec.label}</span>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{spec.fields.map((field) => <span key={field} style={{ padding: '2px 5px', border: '1px dashed #a855f7', borderRadius: 4, background: '#fff', color: '#6b21a8', fontSize: 9, fontWeight: 800 }}>{field + ' field'}</span>)}</span>
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
    if (/^\s*\[\[MIO_BLOCK:[a-z0-9_]+\]\]\s*$/i.test(text)) return true
    return draftingStudioV298ParagraphRanges(paragraph, template).length > 0
  }

  function draftingStudioV298InlineField(sourceText, binding, key) {
    const label = draftingStudioV298BindingLabel(binding)
    const displayLabel = String(label || 'Template field').toUpperCase()
    const minWidth = Math.max(8, Math.min(48, Math.max(String(sourceText || '').length, displayLabel.length + 2)))
    return <span key={key} onClick={(event) => { event.stopPropagation(); if (typeof mioEditBindingV293 === 'function') mioEditBindingV293(binding) }} title={label + ' - click to edit'} contentEditable={false} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: minWidth + 'ch', minHeight: 18, padding: '1px 5px', margin: '0 2px', border: '1px dashed #2563eb', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', fontFamily: 'Arial,sans-serif', fontSize: 9, fontWeight: 900, letterSpacing: '.02em', lineHeight: 1.2, whiteSpace: 'nowrap', verticalAlign: 'baseline', boxSizing: 'border-box', cursor: 'pointer' }}>{displayLabel}</span>
  }

  function draftingStudioV298RenderTemplateParagraph(paragraph, template) {
    const text = String(paragraph?.text || '')
    const block = text.trim().match(/^\[\[MIO_BLOCK:([a-z0-9_]+)\]\]$/i)
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
