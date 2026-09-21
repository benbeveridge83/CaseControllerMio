// The startup screen is customer-facing, so build numbers, record counters, and
// tab-reuse diagnostics stay behind an explicit opt-in. Add ?mioDebug=1 to the URL,
// or set localStorage caseMioStartupDiagnostics to 1, when a startup problem is
// being investigated. Nothing here changes how cloud data is read or verified.
export const MIO_STARTUP_DIAGNOSTICS_KEY = 'caseMioStartupDiagnostics'
export function mioStartupDiagnosticsEnabled(win = typeof window === 'undefined' ? null : window) {
  if (!win) return false
  try {
    if (new URLSearchParams(win.location?.search || '').has('mioDebug')) return true
    return win.localStorage?.getItem(MIO_STARTUP_DIAGNOSTICS_KEY) === '1'
  } catch { return false }
}
// Progress text a customer can read. Record counts are only shown while records load,
// because "loaded 196 of 222" is the only progress signal that means anything here.
export function mioStartupProgress(progress) {
  const total = Number(progress?.total) || 0
  if (!progress || !total || progress.phase !== 'reading') {
    return { indeterminate: true, percent: 0, text: progress ? 'Reading your saved records…' : 'Checking your sign-in session…' }
  }
  const loaded = Math.max(0, Math.min(Number(progress.loaded) || 0, total))
  return { indeterminate: false, percent: Math.round((loaded / total) * 100), text: 'Loading your saved records… ' + loaded + ' of ' + total }
}
// Engineering detail for the opt-in diagnostics line only.
export function mioStartupDiagnostics(progress) {
  const base = 'Cloud startup 304.1 - sign-in recovery / cloud-verified tab reuse'
  if (!progress) return base
  const reused = Number(progress.reused) || 0
  return base + ' - ' + progress.phase + ' ' + (Number(progress.loaded) || 0) + '/' + (Number(progress.total) || 0) +
    (reused ? ' (reused ' + reused + ' unchanged records from an open tab)' : '')
}
