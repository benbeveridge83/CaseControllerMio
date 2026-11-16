// V331: mount the email dashboard into the main app.
//
// Adds an "Email Dashboard" page with Settings / Orders / General / By Matter
// views. The heavy component is lazy-loaded so the main bundle stays small.

function replaceOnce(code, anchor, replacement, label) {
  if (code.split(anchor).length !== 2) throw new Error(`Email dashboard mount anchor changed: ${label}`)
  return code.replace(anchor, () => replacement)
}

export function applyEmailDashboardMount(source) {
  if (source.includes('const MioEmailDashboard =')) throw new Error('Email dashboard already mounted')
  let code = "import { lazy as emailLazy, Suspense as EmailSuspense } from 'react'\nconst MioEmailDashboard = emailLazy(() => import('./email/EmailDashboard.jsx'))\n" + source
  const registration = "  { value: 'discovery', label: 'Discovery' },"
  code = replaceOnce(code, registration, `${registration}\n  { value: 'email', label: 'Email Dashboard' },`, 'page registration')
  const navigation = "        {canOpenPage('documents') && ("
  code = replaceOnce(code, navigation, `        {canOpenPage('email') && isFirmStaffMember() && (\n          <a href="#email" onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); setPage('email') }} aria-current={page === 'email' ? 'page' : undefined} style={{ display: 'block', marginBottom: 10, fontWeight: page === 'email' ? 900 : undefined, color: page === 'email' ? '#17675e' : undefined }}>\n            Email Dashboard\n          </a>\n        )}\n\n${navigation}`, 'sidebar')
  const page = "        {page === 'discovery' && canOpenPage('discovery') && ("
  code = replaceOnce(code, page, `        {page === 'email' && canOpenPage('email') && isFirmStaffMember() && (\n          <EmailSuspense fallback={<p>Loading Email Dashboard…</p>}>\n            <MioEmailDashboard key={session.user.id} userId={session.user.id} />\n          </EmailSuspense>\n        )}\n\n${page}`, 'route')
  return code
}

export default function emailDashboardMount() {
  return {
    name: 'mio-v331-email-dashboard-mount',
    enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/App.jsx')) return null
      return { code: applyEmailDashboardMount(source), map: null }
    },
  }
}
