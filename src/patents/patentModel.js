export const PATENT_KEY = 'caseMioPatentReviewV1'
export const REVIEW_STATUSES = ['Investigate', 'Shortlist', 'Ask counsel', 'Hold', 'Not pursuing']
const fields = ['summary','combination','overlap','distinction','legal','measure']
export function validateReport(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.candidates) || value.candidates.length > 200 || !value.sources || typeof value.sources !== 'object') throw new Error('Choose a valid Mio Patent Review JSON file (version 1).')
  for (const k of ['title','reviewDate','scope','method','patentSearchNotes']) if (typeof value[k] !== 'string') throw new Error(`Invalid report ${k}.`)
  const ids = new Set()
  for (const c of value.candidates) {
    if (!c || typeof c.id !== 'string' || !/^[a-z0-9-]+$/i.test(c.id) || ids.has(c.id) || typeof c.title !== 'string') throw new Error('Candidate IDs must be unique and titles must be text.')
    ids.add(c.id)
    for (const k of ['stage','type']) if (typeof c[k] !== 'string') throw new Error(`Invalid ${k}.`)
    if (c.notes != null && typeof c.notes !== 'string') throw new Error('Notes must be text.')
    if (c.status != null && !REVIEW_STATUSES.includes(c.status)) throw new Error('Invalid review status.')
    if (c.answers != null && (typeof c.answers !== 'object' || Object.values(c.answers).some(x => typeof x !== 'boolean'))) throw new Error('Invalid answers.')
    for (const k of ['patent','originality','time']) if (!Number.isInteger(c[k]) || c[k] < 1 || c[k] > 5) throw new Error('Scores must be integers from 1 to 5.')
    for (const k of fields) if (typeof c[k] !== 'string') throw new Error(`Missing candidate ${k}.`)
    for (const k of ['questions','evidence','sourceIds']) if (!Array.isArray(c[k]) || c[k].some(x => typeof x !== 'string')) throw new Error(`Invalid ${k}.`)
    if (c.sourceIds.some(k => !value.sources[k])) throw new Error('A candidate references a missing source.')
  }
  for (const s of Object.values(value.sources)) {
    if (!s || typeof s.title !== 'string') throw new Error('Invalid source.')
    let u; try { u = new URL(s.url) } catch { throw new Error('Invalid source URL.') }
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Source links must use HTTPS or HTTP.')
  }
  if (!Array.isArray(value.legalGuide) || value.legalGuide.some(x=>typeof x.title !== 'string'||typeof x.text !== 'string'||!Array.isArray(x.sourceIds)||x.sourceIds.some(k=>!value.sources[k]))) throw new Error('Invalid legal guide.')
  if (!Array.isArray(value.nextSteps) || value.nextSteps.some(x=>typeof x!=='string')) throw new Error('Invalid next steps.')
  return value
}
export function selectCandidates(report, query='', sort='rank', status='all') {
  return (report?.candidates || []).map((c,i)=>({...c,rank:i+1})).filter(c=>(status==='all'||(c.status||'Investigate')===status) && `${c.title} ${c.summary} ${c.combination} ${c.notes||''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='rank'?a.rank-b.rank:b[sort]-a[sort]||a.rank-b.rank)
}
