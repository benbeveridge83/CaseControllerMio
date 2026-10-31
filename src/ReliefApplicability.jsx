import React from 'react'

export function ReliefApplicabilityFields({ groups = [], value = {}, onChange, mode = 'filter', inherited = {} }) {
  const update = (id, ids) => { const next = { ...value }; if (ids === undefined) delete next[id]; else next[id] = ids; onChange(next) }
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 10, border: '1px solid #bfdbfe', borderRadius: 6, background: '#f8fbff' }}>
    {groups.filter(g => !g.archived).map(group => {
      const own = Array.isArray(value[group.id]); const allowed = inherited[group.id] || group.options.map(o => o.id)
      const selected = own ? value[group.id] : allowed
      return <fieldset key={group.id} style={{ border: 0, padding: 0, margin: 0, minWidth: 170 }}>
        <legend style={{ fontWeight: 700 }}>{group.name}</legend>
        <div style={{ display: 'flex', gap: 5, marginBottom: 5 }}>
          <button type="button" onClick={() => update(group.id, undefined)}>{mode === 'row' ? 'Inherit' : 'All'}</button>
          {mode === 'row' && <button type="button" onClick={() => update(group.id, [...allowed])}>All available</button>}
          <button type="button" onClick={() => update(group.id, [])}>None</button>
          <small style={{ alignSelf: 'center', color: '#475569' }}>{!own ? (mode === 'row' ? 'Inherited' : 'Unfiltered') : selected.length ? 'Selected' : 'None'}</small>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', maxWidth: 520 }}>
          {group.options.filter(o => !o.archived || selected.includes(o.id)).map(option => <label key={option.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" aria-label={`${group.name}: ${option.name}`} checked={selected.includes(option.id)} disabled={mode === 'row' && !allowed.includes(option.id)} onChange={e => update(group.id, e.target.checked ? [...new Set([...selected, option.id])] : selected.filter(id => id !== option.id))} />
            {option.name}{option.archived ? ' (archived)' : ''}
          </label>)}
        </div>
      </fieldset>
    })}
    {!groups.some(g => !g.archived) && <span>No active filter groups. Add one in Filter groups.</span>}
  </div>
}

export function ReliefFilterGroupSettings({ groups, onChange }) {
  const nameFrom = (message, initial = '') => window.prompt(message, initial)?.trim()
  const rename = (group, option) => {
    const name = nameFrom(option ? 'Option name' : 'Filter group name', option?.name || group.name)
    if (!name) return
    onChange(groups.map(g => g.id !== group.id ? g : option ? { ...g, options: g.options.map(o => o.id === option.id ? { ...o, name } : o) } : { ...g, name }))
  }
  return <section><h2>Requested Relief Filter Groups</h2><p>Add groups and their choices here. The Order type choices also appear as Litigation Track types. Add Habeas Corpus, Discovery Orders, or any other type here once; it becomes available both on tracks and in row applicability. Final orders is assigned to each matter’s default Final Relief track. Proceeding supplies the choices in Edit Matter. Renaming keeps existing assignments. Archiving a group stops filtering by that group; archiving a choice preserves its existing assignments.</p>
    <button type="button" onClick={() => { const name = nameFrom('New filter group name'); if (name) onChange([...groups, { id: crypto.randomUUID(), name, options: [] }]) }}>+ Add filter group</button>
    {groups.map(group => <section key={group.id} style={{ marginTop: 12, padding: 12, border: '1px solid #cbd5e1', borderRadius: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong>{group.name}{group.archived ? ' (archived)' : ''}</strong><button type="button" onClick={() => rename(group)}>Rename group</button><button type="button" onClick={() => onChange(groups.map(g => g.id === group.id ? { ...g, archived: !g.archived } : g))}>{group.archived ? 'Restore group' : 'Archive group'}</button>
      <button type="button" onClick={() => { const name = nameFrom(`New choice for ${group.name}`); if (name) onChange(groups.map(g => g.id === group.id ? { ...g, options: [...g.options, { id: crypto.randomUUID(), name }] } : g)) }}>+ Add choice</button></div>
      {group.options.map(option => <div key={option.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 0 16px' }}><span>{option.name}{option.archived ? ' (archived)' : ''}</span><button type="button" onClick={() => rename(group, option)}>Rename</button><button type="button" onClick={() => onChange(groups.map(g => g.id === group.id ? { ...g, options: g.options.map(o => o.id === option.id ? { ...o, archived: !o.archived } : o) } : g))}>{option.archived ? 'Restore' : 'Archive'}</button></div>)}
    </section>)}
  </section>
}

export function ReliefInlineRowEditor({ row, parentName, groups, inherited, onChange, onSave, onCancel }) {
  const input = React.useRef(null)
  React.useEffect(() => { input.current?.focus({ preventScroll: true }) }, [])
  const change = patch => onChange({ ...row, ...patch })
  return <section className="rr-inline-row-editor" aria-label={row.id ? 'Edit relief row' : 'New relief row'} onClick={event => event.stopPropagation()}
    style={{ margin: '6px 0', padding: 12, border: '2px solid #93c5fd', borderRadius: 8, background: '#f8fbff', textAlign: 'left' }}>
    <div style={{ fontWeight: 700, marginBottom: 8 }}>{row.id ? 'Edit row' : row.is_relief_option ? 'New relief option' : 'New issue'}{parentName ? ` under ${parentName}` : ' at top level'}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end', marginBottom: 10 }}>
      <label style={{ display: 'grid', gap: 4, flex: '2 1 240px' }}>Row name<input ref={input} aria-label="Row name" value={row.name} onChange={event => change({ name: event.target.value })} style={{ padding: 7 }} /></label>
      <label style={{ display: 'grid', gap: 4, flex: '2 1 220px' }}>Notes<input aria-label="Notes" value={row.notes || ''} onChange={event => change({ notes: event.target.value })} style={{ padding: 7 }} /></label>
      <label style={{ display: 'grid', gap: 4 }}>Row type<select aria-label="Row type" value={row.is_relief_option ? row.option_type : 'issue'} onChange={event => change({ is_relief_option: event.target.value !== 'issue', option_type: event.target.value === 'exclusive' ? 'exclusive' : 'non_exclusive' })} style={{ padding: 7 }}><option value="issue">Issue</option><option value="exclusive">Exclusive option</option><option value="non_exclusive">Non-exclusive option</option></select></label>
      {row.is_relief_option && <label><input type="checkbox" checked={row.has_text_box === true} onChange={event => change({ has_text_box: event.target.checked })} /> Add text box</label>}
      {row.is_relief_option && row.has_text_box && <label>Text box label <input value={row.text_box_label || ''} onChange={event => change({ text_box_label: event.target.value })} /></label>}
    </div>
    <strong>Applies to</strong>
    <ReliefApplicabilityFields mode="row" groups={groups} inherited={inherited} value={row.applicability || {}} onChange={applicability => change({ applicability })} />
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <button type="button" onClick={onSave}>{row.id ? 'Save changes' : 'Save row'}</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  </section>
}

export function ReliefContextSummary({ groups, value = {} }) {
  return <div aria-label="Relief filters" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0', textAlign: 'left' }}>
    {groups.filter(group => !group.archived).map(group => <span key={group.id} style={{ padding: '5px 9px', border: '1px solid #bfdbfe', borderRadius: 6, background: '#f8fbff' }}>
      <strong>{group.name}: </strong>{!Object.hasOwn(value, group.id) ? 'All' : !value[group.id].length ? 'None' : value[group.id].map(id => group.options.find(option => option.id === id)?.name || id).join(', ')}
    </span>)}
  </div>
}
