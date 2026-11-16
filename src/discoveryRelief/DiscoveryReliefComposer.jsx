import { composeOutgoingRequests } from './compose.js'
import { discoveryTypeLabel } from './types.js'

// Presentational composer. The parent (App.jsx wiring) owns selection state,
// persistence, template choice, and the add/edit flows; this component computes
// the composed view from the pure logic and renders the relief/request table.
export function DiscoveryReliefComposer({
  groups = [],
  mappings = [],
  library = [],
  general = [],
  extra = [],
  selections = [],
  templateOptions = [],
  selectedTemplateId = '',
  onSelectTemplate,
  onToggleRequest,
  onEditRequest,
  onAddRequest,
  onGenerate,
  disabled = false
}) {
  const composed = composeOutgoingRequests({ groups, mappings, library, general, extra, selections })

  return (
    <section className="dr-composer" aria-label="Discovery draft composer">
      <header className="dr-toolbar">
        <div className="dr-counts" role="status">
          {Object.entries(composed.counts).map(([type, count]) => (
            <span key={type} className="dr-count" data-type={type}>{discoveryTypeLabel(type)}: {count}</span>
          ))}
          {!Object.keys(composed.counts).length && <span className="dr-count">No requests selected</span>}
        </div>
        <label className="dr-template">
          Template
          <select value={selectedTemplateId} onChange={(event) => onSelectTemplate?.(event.target.value)} disabled={disabled}>
            <option value="">Choose a drafting template…</option>
            {templateOptions.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
          </select>
        </label>
        <div className="dr-actions">
          <button type="button" disabled={disabled || !composed.included.length} onClick={() => onGenerate?.(composed)}>Generate document</button>
        </div>
      </header>

      {composed.groups.map((group) => (
        <section key={group.id} className="dr-group" data-group-id={group.id} data-kind={group.kind}>
          <h3 className="dr-group-label">
            {group.kind === 'general' ? 'General discovery' : group.label}
            {group.kind !== 'general' && <small className="dr-side">({group.source_side})</small>}
          </h3>
          {!group.requests.length && !group.references.length && (
            <p className="dr-empty">No saved requests yet for this relief.</p>
          )}
          <ul className="dr-list">
            {group.requests.map((request) => (
              <li key={request.key} className="dr-request" data-request-key={request.key}>
                <input
                  type="checkbox"
                  checked={request.included}
                  disabled={disabled}
                  onChange={() => onToggleRequest?.(request.key)}
                  aria-label={`Include ${discoveryTypeLabel(request.type)} ${request.number}`}
                />
                <span className="dr-number">{discoveryTypeLabel(request.type)} {request.number}</span>
                {request.item_id && <span className="dr-origin" title={`Library item ${request.item_id}`}>library</span>}
                <textarea
                  rows={2}
                  value={request.text}
                  disabled={disabled}
                  onChange={(event) => onEditRequest?.(request.key, event.target.value)}
                  aria-label={`Request ${request.number} text`}
                />
              </li>
            ))}
            {group.references.map((reference, index) => (
              <li key={`${reference.key}-ref-${index}`} className="dr-reference dr-muted" data-duplicate="true" title="Duplicate — already included once">
                <span className="dr-duplicate-note">{reference.reason}</span>
                <div className="dr-duplicate-text">{reference.text}</div>
              </li>
            ))}
          </ul>
          <button type="button" className="dr-add" disabled={disabled} onClick={() => onAddRequest?.(group)}>+ Add request</button>
        </section>
      ))}
    </section>
  )
}
