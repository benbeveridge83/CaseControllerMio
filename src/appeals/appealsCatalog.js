import procedure from './data/procedure.js'
import merits from './data/merits.js'
import trialBrief from './data/trialBrief.js'
import articleSupplement from './data/articleSupplement.js'

export { APPEAL_SECTIONS, APPEAL_GROUPS, RESEARCH_DATE } from './appealsSections.js'
export const APPEAL_ISSUES = [...procedure, ...merits, ...trialBrief, ...articleSupplement]
