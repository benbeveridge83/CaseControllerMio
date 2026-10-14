import authorityData from './authorities.json' with { type: 'json' }

export const LEGAL_DATA = authorityData
export const SOURCE_BY_ID = Object.fromEntries(authorityData.sources.map(source => [source.id, source]))
export const DISCOVERY_TYPES = [
  {id:'rfp', label:'RFP', title:'Requests for production', rule:'Rule 196'},
  {id:'rfd', label:'RFD', title:'Requests for disclosure', rule:'Rules 194 / 194a'},
  {id:'roggs', label:'Roggs', title:'Interrogatories', rule:'Rule 197'},
  {id:'rfa', label:'RFA', title:'Requests for admission', rule:'Rule 198'}
]
export const REGIMES = [
  {id:'family_current',label:'Family case filed on or after September 1, 2023',note:'Request-based disclosure under Rule 194a and Family Code chapter 301. Work-product objections are prohibited; other objections must be legally supported and specific.'},
  {id:'family_2021',label:'Family case filed January 1, 2021 – August 31, 2023',note:'The 2021 required-disclosure regime applies, including then-Rule 194.2(c) family financial disclosures, subject to exemptions and court orders.'},
  {id:'civil_current',label:'Other civil case filed on or after January 1, 2021',note:'Required disclosures under Rule 194, subject to exemptions and orders. Rule 194.5 prohibits objections and work-product assertions to required disclosures.'},
  {id:'legacy',label:'Case filed before January 1, 2021',note:'The pre-2021 request-based disclosure rules apply. Use the historical rule text and applicable discovery control order.'}
]
export const ASSESSMENTS = {
  proper: {label:'Generally proper',color:'green'},
  partial: {label:'Objectionable in part',color:'amber'},
  objectionable: {label:'Likely objectionable',color:'red'},
  needs_facts: {label:'More facts needed',color:'slate'}
}
export function citationText(ids = []) {
  return [...new Set(ids)].map(id => {const s=SOURCE_BY_ID[id];return s ? `${s.label}${s.pinpoint ? ` (${s.pinpoint})` : ''}` : ''}).filter(Boolean).join('; ')
}
export function objectionWithAuthorities(result, text = result?.objection || '') {
  if (!text.trim()) return ''
  return `${text.trim()}${result?.authorities?.length ? ` Authority: ${citationText(result.authorities)}.` : ''}`
}
export function categoriesFor(type, query = '', status = 'all') {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return authorityData.categories.filter(c => c.types.includes(type) && (status === 'all' || c.status === status) && words.every(word => `${c.title} ${c.example} ${c.explanation}`.toLowerCase().includes(word)))
}
