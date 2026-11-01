function replaceOnce(code, anchor, replacement, label) {
  if (code.split(anchor).length !== 2) throw new Error(`DFPS appeals mount anchor changed: ${label}`)
  return code.replace(anchor, () => replacement)
}

export function applyAppealsMount(source) {
  if (source.includes('const MioAppealsResource =')) throw new Error('DFPS appeals already mounted')
  let code = "import { lazy as appealsLazy, Suspense as AppealsSuspense } from 'react'\nconst MioAppealsResource = appealsLazy(() => import('./appeals/MioAppealsResource.jsx'))\n" + source
  const registration = "  { value: 'discovery', label: 'Discovery' },"
  code = replaceOnce(code, registration, `${registration}\n  { value: 'dfps_appeals', label: 'DFPS / CPS Appeals' },`, 'page registration')
  const navigation = "        {canOpenPage('documents') && ("
  code = replaceOnce(code, navigation, `        {canOpenPage('dfps_appeals') && isFirmStaffMember() && (
          <a href="#dfps_appeals" onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); setPage('dfps_appeals'); window.dispatchEvent(new Event('mio-appeals-home')) }} aria-current={page === 'dfps_appeals' ? 'page' : undefined} style={{ display: 'block', marginBottom: 10, fontWeight: page === 'dfps_appeals' ? 900 : undefined, color: page === 'dfps_appeals' ? '#17675e' : undefined }}>
            DFPS / CPS Appeals
          </a>
        )}

${navigation}`, 'sidebar')
  const page = "        {page === 'discovery' && canOpenPage('discovery') && ("
  code = replaceOnce(code, page, `        {page === 'dfps_appeals' && canOpenPage('dfps_appeals') && isFirmStaffMember() && (
          <AppealsSuspense fallback={<p>Loading DFPS / CPS Appeals…</p>}>
            <MioAppealsResource key={session.user.id} userId={session.user.id} />
          </AppealsSuspense>
        )}

${page}`, 'route')
  return code
}

export default function appealsResourceMount() {
  return {
    name: 'mio-dfps-appeals-mount',
    enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/App.jsx')) return null
      return { code: applyAppealsMount(source), map: null }
    },
  }
}
