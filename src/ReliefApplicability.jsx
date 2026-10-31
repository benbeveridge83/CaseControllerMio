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
  return <section><h2>Requested Relief Filter Groups</h2><p>Add groups and their choices here. Row applicability and case filters use the same definitions. Renaming keeps existing assignments. Archiving a group stops filtering by that group; archiving a choice preserves its existing assignments.</p>
    <button type="button" onClick={() => { const name = nameFrom('New filter group name'); if (name) onChange([...groups, { id: crypto.randomUUID(), name, options: [] }]) }}>+ Add filter group</button>
    {groups.map(group => <section key={group.id} style={{ marginTop: 12, padding: 12, border: '1px solid #cbd5e1', borderRadius: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong>{group.name}{group.archived ? ' (archived)' : ''}</strong><button type="button" onClick={() => rename(group)}>Rename group</button><button type="button" onClick={() => onChange(groups.map(g => g.id === group.id ? { ...g, archived: !g.archived } : g))}>{group.archived ? 'Restore group' : 'Archive group'}</button>
      <button type="button" onClick={() => { const name = nameFrom(`New choice for ${group.name}`); if (name) onChange(groups.map(g => g.id === group.id ? { ...g, options: [...g.options, { id: crypto.randomUUID(), name }] } : g)) }}>+ Add choice</button></div>
      {group.options.map(option => <div key={option.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 0 16px' }}><span>{option.name}{option.archived ? ' (archived)' : ''}</span><button type="button" onClick={() => rename(group, option)}>Rename</button><button type="button" onClick={() => onChange(groups.map(g => g.id === group.id ? { ...g, options: g.options.map(o => o.id === option.id ? { ...o, archived: !o.archived } : o) } : g))}>{option.archived ? 'Restore' : 'Archive'}</button></div>)}
    </section>)}
  </section>
}
