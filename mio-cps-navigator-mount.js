function replaceOnce(code, anchor, replacement, label) {
  if (code.split(anchor).length !== 2) throw new Error(`CPS Navigator mount anchor changed: ${label}`)
  return code.replace(anchor, () => replacement)
}

export function applyCPSNavigatorMount(source) {
  if (source.includes('const MioCPSNavigator =')) throw new Error('CPS Navigator already mounted')
  let code = "import { lazy as cpsLazy, Suspense as CPSSuspense } from 'react'\nconst MioCPSNavigator = cpsLazy(() => import('./cps/CPSNavigator.jsx'))\n" + source
  const registration = "  { value: 'discovery', label: 'Discovery' },"
  code = replaceOnce(code, registration, `${registration}\n  { value: 'cps_navigator', label: 'CPS Navigator' },`, 'page registration')
  const navigation = "        {canOpenPage('documents') && ("
  code = replaceOnce(code, navigation, `        {canOpenPage('cps_navigator') && isFirmStaffMember() && (
          <a href="#cps_navigator" onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); setPage('cps_navigator') }} aria-current={page === 'cps_navigator' ? 'page' : undefined} style={{ display: 'block', marginBottom: 10, fontWeight: page === 'cps_navigator' ? 900 : undefined, color: page === 'cps_navigator' ? '#17675e' : undefined }}>
            CPS Navigator
          </a>
        )}

${navigation}`, 'sidebar')
  const page = "        {page === 'discovery' && canOpenPage('discovery') && ("
  code = replaceOnce(code, page, `        {page === 'cps_navigator' && canOpenPage('cps_navigator') && isFirmStaffMember() && (
          <CPSSuspense fallback={<p>Loading CPS Navigator…</p>}>
            <MioCPSNavigator key={session.user.id} />
          </CPSSuspense>
        )}

${page}`, 'route')
  return code
}

export default function cpsNavigatorMount() {
  return {
    name: 'mio-cps-navigator-mount',
    enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/App.jsx')) return null
      return { code: applyCPSNavigatorMount(source), map: null }
    },
  }
}
