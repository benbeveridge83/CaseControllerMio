function clean(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function words(value = '') {
  return clean(value).split(' ').filter(Boolean)
}

export function negativeKeywordMatchesSearch(searchTerm = '', negative = {}) {
  const search = clean(searchTerm)
  const keyword = clean(negative?.keyword)
  if (!search || !keyword) return false

  const matchType = String(negative?.matchType || 'EXACT').toUpperCase()
  if (matchType === 'EXACT') return search === keyword
  if (matchType === 'PHRASE') return ` ${search} `.includes(` ${keyword} `)
  if (matchType === 'BROAD') {
    const searchWords = new Set(words(search))
    return words(keyword).every((word) => searchWords.has(word))
  }
  return search === keyword
}

function sameCampaign(row, candidate) {
  const rowId = String(row?.campaignId || '')
  const candidateId = String(candidate?.campaignId || '')
  if (rowId && candidateId) return rowId === candidateId
  return clean(row?.campaignName) === clean(candidate?.campaignName)
}

function sameAdGroup(row, candidate) {
  const rowId = String(row?.adGroupId || '')
  const candidateId = String(candidate?.adGroupId || '')
  if (rowId && candidateId) return rowId === candidateId
  return clean(row?.adGroupName) === clean(candidate?.adGroupName)
}

function negativeScope(candidate = {}) {
  return String(candidate?.scope || '').toLowerCase().replace('-', '_')
}

function activePositiveExact(row, keyword = {}) {
  if (keyword?.negative) return false
  if (!sameCampaign(row, keyword) || !sameAdGroup(row, keyword)) return false
  if (String(keyword?.matchType || '').toUpperCase() !== 'EXACT') return false
  if (['REMOVED'].includes(String(keyword?.status || '').toUpperCase())) return false
  return clean(keyword?.keyword) === clean(row?.searchTerm)
}

export function deriveSearchTermStatus(row = {}, report = {}) {
  const negatives = Array.isArray(report?.negativeKeywords) ? report.negativeKeywords : []

  const campaignNegative = negatives.find((negative) =>
    negativeScope(negative) === 'campaign' &&
    sameCampaign(row, negative) &&
    negativeKeywordMatchesSearch(row?.searchTerm, negative)
  )
  if (campaignNegative) {
    return {
      resolved: true,
      kind: 'campaign_negative',
      label: 'Campaign negative',
      detail: `Blocked by ${String(campaignNegative.matchType || 'EXACT').toUpperCase()} negative “${campaignNegative.keyword}”`
    }
  }

  const adGroupNegative = negatives.find((negative) =>
    negativeScope(negative) === 'ad_group' &&
    sameCampaign(row, negative) &&
    sameAdGroup(row, negative) &&
    negativeKeywordMatchesSearch(row?.searchTerm, negative)
  )
  if (adGroupNegative) {
    return {
      resolved: true,
      kind: 'ad_group_negative',
      label: 'Ad-group negative',
      detail: `Blocked by ${String(adGroupNegative.matchType || 'EXACT').toUpperCase()} negative “${adGroupNegative.keyword}”`
    }
  }

  const keywords = Array.isArray(report?.keywords) ? report.keywords : []
  const exactKeyword = keywords.find((keyword) => activePositiveExact(row, keyword))
  if (exactKeyword) {
    return {
      resolved: true,
      kind: 'exact_keyword',
      label: 'Exact keyword added',
      detail: `Active exact keyword “${exactKeyword.keyword}”`
    }
  }

  return { resolved: false, kind: 'unresolved', label: 'Needs review', detail: '' }
}

export function isResolvedSearchTermStatus(status = {}) {
  return Boolean(status?.resolved && status?.kind && status.kind !== 'unresolved')
}
