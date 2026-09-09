// Mio UUIDs identify records. Cause numbers and names are display references only.
export function nativeMatterReference(matter = {}) {
  return String(matter.mio_number || matter.cause_number || matter.case_number || matter.name || (matter.id ? 'Mio ' + matter.id : '')).trim()
}
export function legacyLinkChanged(previous = {}, draft = {}, normalize = value => String(value || '').trim()) {
  return String(previous.clio_matter_id || previous.clioMatterId || '').trim() !== String(draft.clio_matter_id || '').trim() ||
    normalize(previous.clio_display_number || previous.clio_matter_number || '') !== normalize(draft.clio_display_number || '')
}
