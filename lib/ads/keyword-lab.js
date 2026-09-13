// Pure Keyword Lab domain helpers. This module has no network, browser, or storage dependencies.

const DAY_MS = 24 * 60 * 60 * 1000
const REPORTING_DAYS = 365
const PRESET_DAYS = Object.freeze({
  LAST_7_DAYS: 7,
  LAST_14_DAYS: 14,
  LAST_30_DAYS: 30,
  LAST_90_DAYS: 90,
})
const MATCH_TYPES = new Set(['EXACT', 'PHRASE', 'BROAD'])

export const KEYWORD_RECOMMENDATION_THRESHOLDS = Object.freeze({
  minimumImpressions: 100,
  highImpressionsPerDay: 10,
  lowCtr: 0.02,
  highWasteRate: 0.3,
  pauseWasteRate: 0.6,
  minimumPauseSpend: 100,
  scaleCtr: 0.05,
})

function parseIsoDate(value, label = 'Date') {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must be a valid ISO date.`)
  const date = new Date(`${text}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} must be a valid ISO date.`)
  }
  return date
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  return new Date(date.valueOf() + days * DAY_MS)
}

function isUnavailable(value) {
  return value === null || value === undefined || value === ''
}

/**
 * Normalize a preset or custom date selection.
 * @param {'LAST_7_DAYS'|'LAST_14_DAYS'|'LAST_30_DAYS'|'LAST_90_DAYS'|{startDate:string,endDate:string}} selection
 * @param {string|Date} [today=new Date()] UTC reporting date used as a preset's inclusive end.
 * @returns {{startDate:string,endDate:string}} Inclusive ISO dates, capped to 365 calendar days.
 */
export function normalizeDateRange(selection, today = new Date()) {
  if (typeof selection === 'string') {
    const days = PRESET_DAYS[selection]
    if (!days) throw new Error('Choose a supported date preset.')
    const end = today instanceof Date
      ? parseIsoDate(isoDate(today), 'Today')
      : parseIsoDate(today, 'Today')
    return { startDate: isoDate(addDays(end, 1 - days)), endDate: isoDate(end) }
  }

  const start = parseIsoDate(selection?.startDate, 'Start date')
  const end = parseIsoDate(selection?.endDate, 'End date')
  if (start > end) throw new Error('Start date must be on or before end date.')
  const earliest = addDays(end, 1 - REPORTING_DAYS)
  return { startDate: isoDate(start < earliest ? earliest : start), endDate: isoDate(end) }
}

/**
 * Count inclusive reporting days, using an experiment's later start when supplied.
 * @param {{startDate:string,endDate:string}} range
 * @param {string|null} [experimentStartDate]
 * @returns {number}
 */
export function effectiveDays(range, experimentStartDate = null) {
  const normalized = normalizeDateRange(range)
  const start = parseIsoDate(normalized.startDate)
  const end = parseIsoDate(normalized.endDate)
  const experimentStart = experimentStartDate ? parseIsoDate(experimentStartDate, 'Experiment start date') : null
  const effectiveStart = experimentStart && experimentStart > start ? experimentStart : start
  return effectiveStart > end ? 0 : Math.floor((end - effectiveStart) / DAY_MS) + 1
}

/**
 * Copy a metric row and add impressionsPerDay, clicksPerDay, and costPerDay.
 * @param {object} row
 * @param {number|{startDate:string,endDate:string}} daysOrRange
 * @param {string|null} [experimentStartDate]
 * @returns {object}
 */
export function withPerDayMetrics(row = {}, daysOrRange, experimentStartDate = null) {
  const days = typeof daysOrRange === 'number'
    ? daysOrRange
    : effectiveDays(daysOrRange, experimentStartDate)
  const perDay = key => days > 0 && !isUnavailable(row[key]) && Number.isFinite(Number(row[key]))
    ? Number(row[key]) / days
    : null
  return {
    ...row,
    impressionsPerDay: perDay('impressions'),
    clicksPerDay: perDay('clicks'),
    costPerDay: perDay('cost'),
  }
}

function numericMatch(value, filter) {
  if (filter.operator === 'blank' || filter.operator === 'unavailable') return isUnavailable(value)
  if (isUnavailable(value)) return false
  const actual = Number(value)
  if (!Number.isFinite(actual)) return false
  const expected = Number(filter.value)
  const maximum = Number(filter.max ?? filter.value2)
  switch (filter.operator) {
    case '>': return actual > expected
    case '>=': return actual >= expected
    case '<': return actual < expected
    case '<=': return actual <= expected
    case '=':
    case 'equals': return actual === expected
    case 'between': return Number.isFinite(expected) && Number.isFinite(maximum) && actual >= Math.min(expected, maximum) && actual <= Math.max(expected, maximum)
    case 'nonzero': return actual !== 0
    default: throw new Error(`Unsupported numeric filter operator: ${filter.operator}`)
  }
}

function textMatch(value, filter) {
  const actual = String(value ?? '').toLocaleLowerCase()
  const expected = String(filter.value ?? '').toLocaleLowerCase()
  switch (filter.operator) {
    case 'contains': return actual.includes(expected)
    case '=':
    case 'equals': return actual === expected
    case 'does_not_contain':
    case 'does not contain': return !actual.includes(expected)
    default: throw new Error(`Unsupported text filter operator: ${filter.operator}`)
  }
}

function dateMatch(value, filter) {
  if (isUnavailable(value)) return false
  const actual = parseIsoDate(value, filter.column)
  const expected = parseIsoDate(filter.value, 'Filter date')
  switch (filter.operator) {
    case 'before': return actual < expected
    case 'after': return actual > expected
    case 'between': {
      const maximum = parseIsoDate(filter.max ?? filter.value2, 'Filter end date')
      const [start, end] = expected <= maximum ? [expected, maximum] : [maximum, expected]
      return actual >= start && actual <= end
    }
    default: throw new Error(`Unsupported date filter operator: ${filter.operator}`)
  }
}

function categoricalMatch(value, filter) {
  const values = Array.isArray(filter.values) ? filter.values : [filter.value]
  return values.includes(value)
}

function rowMatchesFilter(row, filter) {
  if (!filter?.column) throw new Error('Column filters require a column.')
  switch (filter.type) {
    case 'numeric': return numericMatch(row[filter.column], filter)
    case 'text': return textMatch(row[filter.column], filter)
    case 'categorical': return categoricalMatch(row[filter.column], filter)
    case 'date': return dateMatch(row[filter.column], filter)
    default: throw new Error(`Unsupported column filter type: ${filter.type}`)
  }
}

/**
 * Apply one filter or an array of filters (combined with AND) without mutating rows.
 * @param {object[]} rows
 * @param {{column:string,type:'numeric'|'text'|'categorical'|'date',operator?:string,value?:unknown,max?:unknown,values?:unknown[]}|Array<object>} filters
 * @returns {object[]}
 */
export function applyColumnFilter(rows = [], filters = []) {
  const active = (Array.isArray(filters) ? filters : [filters]).filter(Boolean)
  return rows.filter(row => active.every(filter => rowMatchesFilter(row, filter)))
}

/**
 * Stable, non-mutating column sort. Null, undefined, and empty values remain last.
 * @param {object[]} rows
 * @param {{column:string,direction?:'asc'|'desc'}} sort
 * @returns {object[]}
 */
export function sortRows(rows = [], { column, direction = 'asc' } = {}) {
  if (!column) return [...rows]
  const multiplier = direction === 'desc' ? -1 : 1
  if (!['asc', 'desc'].includes(direction)) throw new Error('Sort direction must be asc or desc.')
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const a = left.row[column]
      const b = right.row[column]
      if (isUnavailable(a) || isUnavailable(b)) {
        if (isUnavailable(a) && isUnavailable(b)) return left.index - right.index
        return isUnavailable(a) ? 1 : -1
      }
      const comparison = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
      return comparison === 0 ? left.index - right.index : comparison * multiplier
    })
    .map(item => item.row)
}

/**
 * Calculate classified-term quality rates. Observe rows enter denominators and coverage;
 * unclassified rows affect only total-spend coverage.
 * Promoted rows count as relevant; negative-covered rows count as waste.
 * @param {Array<{clicks?:number,cost?:number,classification?:string,promoted?:boolean,negativeCoverage?:unknown}>} rows
 * @returns {{relevantClickRate:number|null,relevantSpendRate:number|null,wasteRate:number|null,classifiedSpendCoverage:number|null,classifiedClicks:number,classifiedSpend:number,totalSpend:number}}
 */
export function classifyQuality(rows = []) {
  let relevantClicks = 0
  let relevantSpend = 0
  let wasteSpend = 0
  let classifiedClicks = 0
  let classifiedSpend = 0
  let totalSpend = 0
  for (const row of rows) {
    const clicks = Number(row.clicks) || 0
    const spend = Number(row.cost) || 0
    totalSpend += spend
    const classification = String(row.classification ?? '').toLowerCase()
    const relevant = row.promoted === true || classification === 'relevant' || classification === 'promoted'
    const waste = Boolean(row.negativeCoverage) || classification === 'irrelevant' || classification === 'blocked'
    const observed = classification === 'observe'
    if (!relevant && !waste && !observed) continue
    classifiedClicks += clicks
    classifiedSpend += spend
    if (relevant) {
      relevantClicks += clicks
      relevantSpend += spend
    }
    if (waste) wasteSpend += spend
  }
  return {
    relevantClickRate: classifiedClicks ? relevantClicks / classifiedClicks : null,
    relevantSpendRate: classifiedSpend ? relevantSpend / classifiedSpend : null,
    wasteRate: classifiedSpend ? wasteSpend / classifiedSpend : null,
    classifiedSpendCoverage: totalSpend ? classifiedSpend / totalSpend : null,
    classifiedClicks,
    classifiedSpend,
    totalSpend,
  }
}

function percent(value) {
  return `${Number((Number(value) * 100).toFixed(2))}%`
}

function optionalNumber(value) {
  if (isUnavailable(value)) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * Produce a transparent recommendation badge from raw metrics and centralized thresholds.
 * @param {{impressions?:number,impressionsPerDay?:number,ctr?:number,cost?:number,conversions?:number,wasteRate?:number}} row
 * @param {{minimumImpressions:number,highImpressionsPerDay:number,lowCtr:number,highWasteRate:number,pauseWasteRate:number,minimumPauseSpend:number,scaleCtr:number}} [thresholds]
 * @returns {{label:string,reasons:string[]}}
 */
export function recommendKeyword(row = {}, thresholds = KEYWORD_RECOMMENDATION_THRESHOLDS) {
  const impressions = optionalNumber(row.impressions)
  const impressionsPerDay = optionalNumber(row.impressionsPerDay)
  const ctr = optionalNumber(row.ctr)
  const wasteRate = optionalNumber(row.wasteRate)
  const cost = optionalNumber(row.cost)
  if (impressions === null) {
    return { label: 'Insufficient data', reasons: ['Impression data is unavailable'] }
  }
  if (impressions < thresholds.minimumImpressions) {
    return { label: 'Insufficient data', reasons: [`${impressions} impressions is below the ${thresholds.minimumImpressions}-impression minimum`] }
  }
  if (wasteRate !== null && cost !== null && wasteRate >= thresholds.pauseWasteRate && cost >= thresholds.minimumPauseSpend) {
    return {
      label: 'Pause candidate',
      reasons: [`${percent(wasteRate)} waste rate is at or above ${percent(thresholds.pauseWasteRate)}`, `$${cost} spend meets the $${thresholds.minimumPauseSpend} review threshold`],
    }
  }
  if (wasteRate !== null && wasteRate >= thresholds.highWasteRate) {
    return { label: 'Add negative protection', reasons: [`${percent(wasteRate)} waste rate is at or above ${percent(thresholds.highWasteRate)}`] }
  }
  if (impressionsPerDay !== null && ctr !== null && impressionsPerDay >= thresholds.highImpressionsPerDay && ctr < thresholds.lowCtr) {
    return {
      label: 'Keep but tighten',
      reasons: [`${impressionsPerDay} impressions/day is high`, `${percent(ctr)} CTR is below ${percent(thresholds.lowCtr)}`],
    }
  }
  if (ctr !== null && ctr >= thresholds.scaleCtr) {
    return { label: 'Keep / scale', reasons: [`${percent(ctr)} CTR meets the ${percent(thresholds.scaleCtr)} target`] }
  }
  return {
    label: 'Test longer',
    reasons: [ctr === null ? 'CTR is unavailable' : 'The current metrics do not yet meet another recommendation rule'],
  }
}

function suppliedCriterionId(row) {
  return row.triggeringCriterionId ?? row.triggeringKeywordCriterionId ?? row.triggeringKeywordResourceName ?? null
}

/**
 * Group terms by a Google-supplied triggering criterion identity.
 * Rows without supplied identity remain unlinked; keyword text is never used to invent identity.
 * @param {object[]} rows
 * @returns {{groups:Array<{criterionId:string,keyword:unknown,matchType:unknown,terms:object[]}>,unlinked:object[]}}
 */
export function groupTermsByKeyword(rows = []) {
  const grouped = new Map()
  const unlinked = []
  for (const row of rows) {
    const suppliedId = suppliedCriterionId(row)
    if (isUnavailable(suppliedId)) {
      unlinked.push(row)
      continue
    }
    const criterionId = String(suppliedId)
    if (!grouped.has(criterionId)) {
      grouped.set(criterionId, {
        criterionId,
        keyword: row.triggeringKeyword,
        matchType: row.triggeringKeywordMatchType ?? row.keywordMatchType,
        terms: [],
      })
    }
    grouped.get(criterionId).terms.push(row)
  }
  return { groups: [...grouped.values()], unlinked }
}

/**
 * Build the ordered service contract for replacing a keyword's match type.
 * This function plans no-retry operations; it performs no Google Ads write.
 * @param {{criterionId:string,campaignId?:string,adGroupId?:string,keyword:string,matchType:string}} current
 * @param {'EXACT'|'PHRASE'|'BROAD'} proposedMatchType
 * @returns {object}
 */
export function planMatchReplacement(current = {}, proposedMatchType) {
  const oldMatchType = String(current.matchType ?? '').toUpperCase()
  const newMatchType = String(proposedMatchType ?? '').toUpperCase()
  if (!MATCH_TYPES.has(oldMatchType) || !MATCH_TYPES.has(newMatchType)) throw new Error('Match type must be EXACT, PHRASE, or BROAD.')
  if (oldMatchType === newMatchType) throw new Error('Choose a different match type for replacement.')
  if (isUnavailable(current.criterionId)) throw new Error('A Google-supplied criterion ID is required.')
  if (!String(current.keyword ?? '').trim()) throw new Error('Keyword text is required.')
  const replacement = {
    campaignId: current.campaignId,
    adGroupId: current.adGroupId,
    keyword: String(current.keyword).trim(),
    matchType: newMatchType,
  }
  return {
    action: 'change_match_type',
    original: { ...current, matchType: oldMatchType },
    replacement,
    steps: [
      { id: 'validate_replacement', operation: 'validate', target: replacement },
      { id: 'create_replacement', operation: 'create', target: replacement, after: 'validate_replacement', retry: 'never' },
      { id: 'verify_replacement', operation: 'read_back', target: replacement, after: 'create_replacement', retry: 'never' },
      { id: 'pause_original', operation: 'pause', criterionId: String(current.criterionId), after: 'verify_replacement', retry: 'never' },
    ],
    autoRetry: false,
    onCreateVerificationFailure: 'leave_original_unchanged',
    onPauseUncertain: 'mark_unverified',
  }
}
