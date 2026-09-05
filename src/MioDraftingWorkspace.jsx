import React, { useEffect, useRef, useState } from 'react'
import { COMPONENTS, DEFAULT_COMPONENT_TEXT, DEFAULT_LAYOUT, componentDefault, componentHasTarget, fileComponentData, fillComponent, validateLayout } from './mioDraftingComponents.js'
import './mioDraftingWorkspace.css'

export function DraftingFrame({ children, settings }) {
  const [open, setOpen] = useState(false), bottom = useRef(null)
  const show = () => { setOpen(v => !v); if (!open) setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }
  return <div className="mio-drafting-workspace"><div className="mio-draft-tools"><button type="button" onClick={show} aria-expanded={open}>Drafting settings</button></div>{children}<div ref={bottom}>{open && <section className="mio-draft-panel" aria-label="Page drafting settings"><div className="mio-draft-tools"><h2>Drafting settings</h2><button type="button" onClick={() => setOpen(false)}>Close settings</button></div><p>These are the same defaults as Settings &gt; Drafting. Document-only changes are made in the preview, not here.</p>{settings}</section>}</div></div>
}

export function DraftingPreferences({ profile, caseTypes = [], onSave }) {
  const [edit, setEdit] = useState(null), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [newType, setNewType] = useState('')
  const value = edit || profile, styles = (profile.case_styles || []).filter(s => s.is_active !== false)
  const change = patch => { setEdit(current => ({ ...(current || profile), ...patch })); setStatus('Unsaved changes') }
  const types = [...new Set(['Divorce', 'SAPCR', 'Modification', 'Enforcement', ...caseTypes.filter(Boolean), ...Object.keys(value.case_type_style_map || {})])].sort((a,b) => a.localeCompare(b))
  const save = async () => { setBusy(true); try { await onSave({ case_type_style_map: value.case_type_style_map || {}, default_case_style_id: value.default_case_style_id, component_templates: value.component_templates || {}, component_layout: value.component_layout || DEFAULT_LAYOUT }); setEdit(null); setStatus('Saved to Supabase') } catch (error) { setStatus(`Not saved: ${error.message || error}`) } finally { setBusy(false) } }
  return <section className="mio-draft-panel"><h3>Case type connections and reusable components</h3><p>Divorce automatically chooses the divorce caption with or without children. All other types use the fallback below unless you assign a different style.</p><label className="mio-draft-field">Fallback for other case types<select value={value.default_case_style_id || ''} onChange={e => change({ default_case_style_id: e.target.value })}>{styles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="mio-draft-grid">{types.map(type => <label className="mio-draft-field" key={type}>{type}<select value={value.case_type_style_map?.[type] || ''} onChange={e => change({ case_type_style_map: { ...value.case_type_style_map, [type]: e.target.value } })}><option value="">Automatic: divorce or fallback</option><option value="@divorce">Divorce - child-aware</option>{styles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>)}</div><div className="mio-draft-tools"><input aria-label="Additional case type" value={newType} onChange={e => setNewType(e.target.value)} placeholder="Additional case type" /><button type="button" disabled={!newType.trim()} onClick={() => { change({ case_type_style_map: { ...value.case_type_style_map, [newType.trim()]: value.default_case_style_id } }); setNewType('') }}>Add connection</button></div><details><summary>Reusable wording defaults</summary><p>Use tokens such as {'{{client_name}}'} and {'{{attorney_name}}'}. Missing service date, method, and recipients must be supplied in the preview; they are not assumed.</p>{COMPONENTS.filter(c => !['caption','signature'].includes(c.key)).map(c => <label className="mio-draft-field" key={c.key}>{c.label}<textarea rows={5} value={value.component_templates?.[c.key] ?? DEFAULT_COMPONENT_TEXT[c.key]} onChange={e => change({ component_templates: { ...value.component_templates, [c.key]: e.target.value } })} /></label>)}</details><details><summary>Optional font, spacing, and margin preset</summary><p>The uploaded Word formatting stays unchanged unless you explicitly apply this preset to a document.</p><LayoutFields value={value.component_layout || DEFAULT_LAYOUT} onChange={layout => change({ component_layout: layout })} /></details><div className="mio-draft-tools"><button type="button" disabled={!edit || busy} onClick={save}>{busy ? 'Saving...' : 'Save shared defaults'}</button><button type="button" disabled={!edit || busy} onClick={() => { setEdit(null); setStatus('Changes discarded') }}>Cancel changes</button><span role="status">{status}</span></div></section>
}

function LayoutFields({ value, onChange }) {
  return <div className="mio-draft-grid"><label className="mio-draft-field">Font<input value={value.font} onChange={e => onChange({ ...value, font: e.target.value })} /></label>{[['size','Size (pt)',8,32,.5],['line','Line spacing',.8,3,.1],['margin','Margins (inches)',.25,2,.05]].map(([key,label,min,max,step]) => <label className="mio-draft-field" key={key}>{label}<input type="number" min={min} max={max} step={step} value={value[key]} onChange={e => onChange({ ...value, [key]: e.target.value })} /></label>)}</div>
}

function PreviewDialog({ title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close() }, [])
  return <dialog className="mio-draft-dialog" ref={ref} onCancel={onClose}><div className="mio-draft-tools"><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close preview">Close</button></div>{children}</dialog>
}

export function DraftingComponents({ data, profile, template, selectedFiles = [], fieldValues, onChange, onStyleChange, onSaveDefaults, ensureZip }) {
  const files = (template.files || []).filter(file => selectedFiles.includes(file.id || file.name))
  const [chosenFile, setChosenFile] = useState(''), [editor, setEditor] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [pendingPreview, setPendingPreview] = useState('')
  const file = files.find(f => String(f.id || f.name) === chosenFile) || files[0], fileKey = String(file?.id || file?.name || '')
  const scoped = fileComponentData(data, file, profile), instances = fieldValues.drafting_components?.[fileKey] || {}
  const open = async c => {
    setError(''); setBusy(true)
    try {
      let mapped = componentHasTarget(c, template, file)
      if (!mapped && file?.file_data) {
        await ensureZip()
        const encoded = file.file_data.split(',')[1]
        if (!encoded) throw new Error('The selected template has no usable Word file.')
        const zip = await window.JSZip.loadAsync(encoded, { base64: true })
        const xml = await zip.file('word/document.xml')?.async('string')
        const parsed = new DOMParser().parseFromString(xml || '', 'application/xml')
        const text = Array.from(parsed.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't')).map(n => n.textContent).join('')
        mapped = componentHasTarget(c, template, file, text)
      }
      setEditor({ key: c.key, label: c.label, text: instances[c.key]?.text ?? scoped[c.token] ?? '', placement: instances[c.key]?.placement || (mapped ? 'bound' : ''), mapped, fileKey, fileName: file.name })
    } catch (e) { setError(e.message || String(e)) } finally { setBusy(false) }
  }
  useEffect(() => {
    if (!pendingPreview || !file) return
    const key = pendingPreview
    setPendingPreview('')
    void open(COMPONENTS.find(c => c.key === key))
  }, [pendingPreview, data.case_style_id, data.signature_block_id])
  const editDefault = () => {
    let text = profile.component_templates?.[editor.key] ?? DEFAULT_COMPONENT_TEXT[editor.key] ?? ''
    if (editor.key === 'caption') { const style = profile.case_styles.find(s => s.id === data.case_style_id); text = [style?.line_1,style?.line_2,style?.line_3].join('\n') }
    if (editor.key === 'signature') text = profile.signature_blocks.find(s => s.id === data.signature_block_id)?.signature_text || ''
    setEditor({ ...editor, mode: 'default', text })
    setError('')
  }
  const saveDefault = async () => {
    setBusy(true)
    try {
      let patch = { component_templates: { ...profile.component_templates, [editor.key]: editor.text } }
      if (editor.key === 'caption') { const lines = editor.text.split('\n'); patch = { case_styles: profile.case_styles.map(s => s.id === data.case_style_id ? { ...s, line_1: lines[0] || '', line_2: lines[1] || '', line_3: lines.slice(2).join('\n') } : s) } }
      if (editor.key === 'signature') patch = { signature_blocks: profile.signature_blocks.map(s => s.id === data.signature_block_id ? { ...s, signature_text: editor.text } : s) }
      await onSaveDefaults(patch)
      setEditor(null)
    } catch (e) { setError(e.message || String(e)) } finally { setBusy(false) }
  }
  const apply = () => {
    try {
      const next = { ...instances }
      if (editor.key === 'layout') next.layout = validateLayout(editor.layout)
      else {
        if (!editor.placement) throw new Error('Choose where to insert this block.')
        if (/\[Missing:|\{\{/.test(editor.text)) throw new Error('Replace the missing-value markers before applying.')
        next[editor.key] = { text: editor.text, placement: editor.placement, customized_at: new Date().toISOString() }
      }
      onChange({ ...fieldValues.drafting_components, [editor.fileKey]: next }); setEditor(null); setError('')
    } catch (e) { setError(e.message || String(e)) }
  }
  const reset = key => { const next = { ...instances }; delete next[key]; onChange({ ...fieldValues.drafting_components, [fileKey]: next }) }
  const layout = editor?.key === 'layout' ? editor.layout : instances.layout
  return <section className="mio-draft-panel mio-drafting-workspace"><h3>Preview and customize this document</h3><div className="mio-draft-grid"><label className="mio-draft-field">File to customize<select value={fileKey} onChange={e => { setChosenFile(e.target.value); setError('') }}>{files.map(f => <option key={f.id || f.name} value={f.id || f.name}>{f.name}</option>)}</select></label><label className="mio-draft-field">Case style default for this draft<select value={fieldValues.case_style_id || ''} onChange={e => { onStyleChange('case_style_id', e.target.value); setPendingPreview('caption') }}><option value="">Follow case type: {data.case_style_name}</option>{(profile.case_styles || []).filter(s => s.is_active !== false).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="mio-draft-field">Signature default for this draft<select value={fieldValues.signature_block_id || ''} onChange={e => { onStyleChange('signature_block_id', e.target.value); setPendingPreview('signature') }}><option value="">Follow template / firm default</option>{(profile.signature_blocks || []).filter(s => s.is_active !== false).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div><p>{fieldValues.case_style_id ? 'Case-style override is active.' : `Using the configured default for ${data.matter_case_type || 'this case type'}.`} <button type="button" onClick={() => onStyleChange('case_style_id', '')}>Reset to case default</button> Literal block edits below remain in place until reset.</p><div className="mio-draft-tools">{COMPONENTS.map(c => <button type="button" key={c.key} disabled={!file || busy} onClick={() => open(c)}>{c.label}{instances[c.key] ? ' (customized)' : ''}</button>)}<button type="button" disabled={!file} onClick={() => { setError(''); setEditor({ key: 'layout', label: 'Font, spacing, and margins', fileKey, fileName: file.name, layout: instances.layout || profile.component_layout || DEFAULT_LAYOUT }) }}>Formatting preview{instances.layout ? ' (customized)' : ''}</button></div>{!file && <p>Select at least one Word file to preview its components.</p>}{busy && <p role="status">Checking this Word template for the insertion target...</p>}{Object.keys(instances).length > 0 && <div className="mio-draft-tools">{Object.keys(instances).map(key => <button type="button" key={key} onClick={() => reset(key)}>Reset {COMPONENTS.find(c => c.key === key)?.label || key}</button>)}</div>}{error && !editor && <p role="alert">{error}</p>}{editor && <PreviewDialog title={editor.label} onClose={() => { setEditor(null); setError('') }}><p><strong>{editor.mode === 'default' ? 'Shared default template' : editor.fileName}</strong> - {editor.mode === 'default' ? 'saving changes the reusable template for future drafts. Keep matter-specific values as tokens. Existing document overrides remain unchanged.' : 'edits apply only to this file in the current draft. Shared defaults stay unchanged.'}</p><p>Populated from {data.matter_display_name || data.client_name || 'the selected matter'}, its case style, and the selected attorney/firm profile.</p>{editor.key === 'layout' ? <><LayoutFields value={editor.layout} onChange={next => setEditor({ ...editor, layout: next })} /><p>This explicitly changes document text font/size, line spacing, and section margins. Alignment, tables, tabs, bold/italics, and numbering are preserved.</p></> : <><label className="mio-draft-field">{editor.mode === 'default' ? 'Edit reusable wording (tokens preserved)' : 'Edit populated wording'}<textarea rows={10} value={editor.text} onChange={e => setEditor({ ...editor, text: e.target.value })} /></label>{editor.mode !== 'default' && <label className="mio-draft-field">Placement<select value={editor.placement} onChange={e => setEditor({ ...editor, placement: e.target.value })}><option value="">Choose placement</option>{editor.mapped && <option value="bound">Replace mapped block / template token</option>}<option value="append">Append this block to the end of this document</option></select></label>}{editor.mode !== 'default' && !editor.mapped && <p role="status">No matching template binding/token was found. Map the block in Visual Template Builder, or explicitly append it here. Mio will not silently replace unrelated text.</p>}</>}<h3>Live content preview</h3><div className="mio-component-paper" style={{ fontFamily: layout?.font || 'Times New Roman', fontSize: `${layout?.size || 12}pt`, lineHeight: layout?.line || 1.2, textAlign: editor.key === 'caption' ? 'center' : 'left' }}>{editor.key === 'layout' ? `${scoped.case_caption_text}\n\nSample document paragraph with the selected font and line spacing.\n\n${scoped.attorney_signature_block}` : editor.mode === 'default' ? fillComponent(editor.text, data) : editor.text}</div><p>Content preview; Word controls final pagination and the mapped paragraph formatting.</p>{error && <p role="alert">{error}</p>}<div className="mio-draft-tools">{editor.mode === 'default' ? <button type="button" disabled={busy} onClick={saveDefault}>Save shared default</button> : <><button type="button" onClick={apply}>Apply to this document</button>{editor.key !== 'layout' && <button type="button" onClick={editDefault}>Edit shared default instead</button>}</>}<button type="button" onClick={() => { setEditor(null); setError('') }}>Cancel</button></div></PreviewDialog>}</section>
}

export function SuggestionInspector({ suggestion, sources, onChange }) {
  return <div className="mio-suggestion-inspector"><strong>Proposed replacement</strong><label>Field key<input value={suggestion.field_key || ''} onChange={e => onChange({ field_key: e.target.value })} /></label><label>Populate from<select value={suggestion.data_source || 'manual'} onChange={e => onChange({ data_source: e.target.value })}>{sources.map(source => <option key={source.value} value={source.value}>{source.label}</option>)}</select></label><label><input type="checkbox" checked={suggestion.replace_all === true} onChange={e => onChange({ replace_all: e.target.checked })} /> Replace every matching occurrence in this file</label><p>{suggestion.reason || 'Confirm the field and its source before accepting.'}</p>{(!suggestion.data_source || suggestion.data_source === 'manual') && <p>Manual source: Mio will ask for this value when drafting; accepting does not connect it to a person automatically.</p>}<small>{suggestion.source === 'local_rule' ? 'Rule-based suggestion, not an AI confidence score.' : 'Confidence is a detector estimate, not a verified probability.'}</small></div>
}
