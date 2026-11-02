function replaceOnce(code, anchor, replacement, label) {
  if (code.split(anchor).length !== 2) throw new Error(`Patent review mount anchor changed: ${label}`)
  return code.replace(anchor, () => replacement)
}

export function applyPatentMount(source) {
  if (source.includes('const MioPatentReview =')) throw new Error('Patent review already mounted')
  let code = "import { lazy as patentLazy, Suspense as PatentSuspense } from 'react'\nconst MioPatentReview = patentLazy(() => import('./patents/MioPatentReview.jsx'))\n" + source
  const registration = "  { value: 'discovery', label: 'Discovery' },"
  code = replaceOnce(code, registration, `${registration}\n  { value: 'patent_review', label: 'Patent Review' },`, 'page registration')
  const navigation = "        {canOpenPage('documents') && ("
  code = replaceOnce(code, navigation, `        {canOpenPage('patent_review') && isFirmStaffMember() && (
          <a href="#patent_review" onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); setPage('patent_review') }} aria-current={page === 'patent_review' ? 'page' : undefined} style={{ display: 'block', marginBottom: 10, fontWeight: page === 'patent_review' ? 900 : undefined, color: page === 'patent_review' ? '#17675e' : undefined }}>
            Patent Review
          </a>
        )}

${navigation}`, 'sidebar')
  const page = "        {page === 'discovery' && canOpenPage('discovery') && ("
  code = replaceOnce(code, page, `        {page === 'patent_review' && canOpenPage('patent_review') && isFirmStaffMember() && (
          <PatentSuspense fallback={<p>Loading Patent Review…</p>}>
            <MioPatentReview key={session.user.id} userId={session.user.id} />
          </PatentSuspense>
        )}

${page}`, 'route')
  return code
}

export default function patentReviewMount() {
  return {
    name: 'mio-patent-review-mount',
    enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/App.jsx')) return null
      return { code: applyPatentMount(source), map: null }
    },
  }
}
