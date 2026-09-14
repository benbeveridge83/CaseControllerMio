export const matches = ['EXACT', 'PHRASE', 'BROAD']
export const keywordKey = r => r.criterionResourceName || `${r.campaignId}:${r.adGroupId}:${r.criterionId}`
export const termKey = r => JSON.stringify([r.campaignId,r.adGroupId,r.searchTerm,r.triggeringKeywordResourceName,r.device,r.matchType])
export function isLinked(term, keyword) {
  if(term.triggeringKeywordResourceName) return term.triggeringKeywordResourceName === keyword.criterionResourceName
  return !!term.triggeringCriterionId && String(term.triggeringCriterionId) === String(keyword.criterionId) && String(term.adGroupId) === String(keyword.adGroupId) && String(term.campaignId) === String(keyword.campaignId)
}
export const existingItem = (r, kind, matchType=r.matchType) => ({kind,campaignId:r.campaignId,adGroupId:r.adGroupId,keyword:r.keyword,matchType,criterionResourceName:r.criterionResourceName,expectedRevision:r.revision})
export const termItem = (r, kind, matchType) => ({kind,campaignId:r.campaignId,adGroupId:r.adGroupId,keyword:r.searchTerm,matchType,source:'search_term'})
export const textColumn = (key,label,type='text') => ({key,label,type})
export const numericColumn = (key,label,format='number') => ({key,label,type:'numeric',format})
export const metricColumns = [numericColumn('impressions','Impressions'),numericColumn('impressionsPerDay','Impressions/day'),numericColumn('clicks','Clicks'),numericColumn('clicksPerDay','Clicks/day'),numericColumn('ctr','CTR','percent'),numericColumn('averageCpc','Average CPC','money'),numericColumn('cost','Cost','money'),numericColumn('costPerDay','Cost/day','money'),numericColumn('conversions','Conversions'),numericColumn('conversionRate','Conversion rate','percent'),numericColumn('costPerConversion','Cost/conversion','money')]
export const qualityColumns = [numericColumn('relevantClickRate','Relevant-click rate','percent'),numericColumn('relevantSpendRate','Relevant-spend rate','percent'),numericColumn('wasteRate','Waste rate','percent'),numericColumn('classifiedSpendCoverage','Classified-spend coverage','percent')]
export function display(value,column={},currency='USD') {
  if(value===null||value===undefined||value==='') return '—'
  if(column.format==='percent')return `${(Number(value)*100).toFixed(1)}%`
  if(column.format==='money')return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(value)
  if(typeof value==='number')return value.toLocaleString('en-US',{maximumFractionDigits:2})
  return String(value)
}
