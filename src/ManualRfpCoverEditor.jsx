import React, { useEffect, useRef, useState } from 'react'
import { DEFAULT_RFP_COVER_SETTINGS, createRfpCoverDraft, normalizeRfpCoverSettings, rfpCoverBlocks } from './manualRfpPreparation.js'
import './manualRfpPreparation.css'

export default function ManualRfpCoverEditor({ documents, onClose, onCreate, busy }) {
  const [sheets, setSheets] = useState(() => documents.map(createRfpCoverDraft))
  const [active, setActive] = useState(0)
  const [settings, setSettings] = useState({ ...DEFAULT_RFP_COVER_SETTINGS })
  const [format, setFormat] = useState('docx')
  const [error, setError] = useState('')
  const dialog = useRef(null), sheet = sheets[active], normalized = normalizeRfpCoverSettings(settings)
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus()
    return () => previous?.focus?.()
  }, [])
  const edit = (key, value) => setSheets(rows => rows.map((row, i) => i === active ? { ...row, [key]: value } : row))
  const setting = (key, value) => setSettings(current => ({ ...current, [key]: value }))
  const create = async () => {
    setError('')
    try {
      const result = await onCreate(sheets, normalized, format)
      if (result?.failedIds) {
        setSheets(rows => rows.filter(row => result.failedIds.includes(row.sourceId)))
        setActive(0)
        setError(result.error)
      }
    } catch (err) { setError(err.message || String(err)) }
  }
  if (!sheet) return <div className="rfp-cover-backdrop"><section className="rfp-cover-dialog" role="dialog" aria-label="Create cover sheets"><header><p>Select at least one document from this matter.</p><button type="button" onClick={onClose}>Close</button></header></section></div>
  return <div className="rfp-cover-backdrop">
    <section className="rfp-cover-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="rfp-cover-title" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key !== 'Tab') return
      const nodes = Array.from(dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)'))
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header><div><h2 id="rfp-cover-title">Create cover sheets</h2><p>One sheet per selected file. Edit the wording for each file and preview the page.</p></div><button type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="Close cover sheet editor">Close</button></header>
      <div className="rfp-cover-workspace">
        <fieldset className="rfp-cover-controls" disabled={Boolean(busy)}>
          <label>File to preview<select value={active} onChange={e => setActive(Number(e.target.value))}>{sheets.map((row, i) => <option value={i} key={row.sourceId}>{i + 1}. {row.filename}</option>)}</select></label>
          <label>Heading<textarea aria-label="Heading" rows={2} value={sheet.heading} onChange={e => edit('heading', e.target.value)} /></label>
          <label>Native filename<input value={sheet.filename} readOnly /></label>
          <label>Document name<input value={sheet.documentName} onChange={e => edit('documentName', e.target.value)} /></label>
          <label>Description / production instructions<textarea aria-label="Description / production instructions" rows={4} value={sheet.description} onChange={e => edit('description', e.target.value)} placeholder="Describe this file and how it is being provided." /></label>
          <button type="button" onClick={() => setSheets(rows => rows.map(row => ({ ...row, heading: sheet.heading, description: sheet.description })))}>Apply this heading and description to all sheets</button>
          <label>Cover sheet filename<input value={sheet.outputName} onChange={e => edit('outputName', e.target.value)} /></label>
          <h3>Page layout <small>Applies to all sheets</small></h3>
          <div className="rfp-cover-control-grid">
            <label>Font<select value={settings.font} onChange={e => setting('font', e.target.value)}><option>Times New Roman</option><option>Arial</option></select></label>
            <label>Alignment<select value={settings.alignment} onChange={e => setting('alignment', e.target.value)}><option value="center">Centered</option><option value="left">Left</option><option value="right">Right</option></select></label>
            <label>Heading size (pt)<input aria-label="Heading size (pt)" type="number" min="18" max="48" value={settings.headingSize} onChange={e => setting('headingSize', e.target.value)} /></label>
            <label>Body size (pt)<input type="number" min="10" max="24" value={settings.bodySize} onChange={e => setting('bodySize', e.target.value)} /></label>
            <label>Distance from top (inches)<input type="number" min="0.75" max="3.5" step="0.05" value={settings.topInches} onChange={e => setting('topInches', e.target.value)} /></label>
          </div>
          <div className="rfp-cover-checks">{[['bold', 'Bold heading'], ['showDocumentName', 'Include document name'], ['showType', 'Include file type'], ['showSize', 'Include file size']].map(([key, label]) => <label key={key}><input type="checkbox" checked={settings[key]} onChange={e => setting(key, e.target.checked)} />{label}</label>)}</div>
          <label>Save as<select aria-label="Save as" value={format} onChange={e => setFormat(e.target.value)}><option value="docx">Word document (.docx)</option><option value="pdf">PDF (.pdf)</option></select></label>
        </fieldset>
        <div className="rfp-cover-preview"><div className="rfp-cover-preview-label">Page preview · US Letter · {active + 1} of {sheets.length}</div>
          <div className="rfp-cover-paper" aria-label="Cover sheet page preview" style={{ paddingTop: `${normalized.topInches * 72}px`, textAlign: normalized.alignment, fontFamily: normalized.font === 'Times New Roman' ? '"Times New Roman", Times, serif' : 'Arial, Helvetica, sans-serif' }}>
            {rfpCoverBlocks(sheet, normalized).map((block, index) => <p key={index} style={{ fontSize: block.size, fontWeight: block.bold ? 700 : 400, margin: `0 0 ${block.after}px`, lineHeight: 1.2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{block.text}</p>)}
          </div>
          <p className="rfp-cover-preview-note">Word remains editable. You can convert a saved Word cover sheet to PDF from the document list. Long text continues onto additional pages in the saved file.</p>
        </div>
      </div>
      <footer><div role="status">{busy || error || `${sheets.length} cover sheet${sheets.length === 1 ? '' : 's'} will be added to this matter. Native files stay available separately.`}</div><button type="button" onClick={create} disabled={Boolean(busy) || sheets.some(row => !row.heading.trim() || !row.outputName.trim())}>Create {sheets.length} {format === 'docx' ? 'Word' : 'PDF'} cover sheet{sheets.length === 1 ? '' : 's'}</button></footer>
    </section>
  </div>
}
