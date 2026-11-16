// Starter discovery library + relief mappings for the Ellis pilot.
//
// These are candidate discovery TOPICS for attorney customization, not
// finished legal requests or conclusions about entitlement to relief. They are
// intentionally generalized (no names, dates, private facts, or document
// identifiers) and keyed to Mio's default relief issue ids so they appear for
// any option under those issues. Refine them at the option level as the matter
// develops (for example, "other parent pays" vs. "neither parent pays").

// Default relief option ids from src/App.jsx `defaultRequestedReliefOptions`.
const RR_POSSESSION_ACCESS = 'rr-possession-access'
const RR_SUPPORT = 'rr-support'

export const SEED_LIBRARY = [
  // Possession — schedule, caregiving, logistics, communications.
  {
    id: 'lib-possession-work-schedule',
    type: 'roggs',
    text: 'Describe your proposed work schedule and the specific periods of possession you propose for each parent, including weekdays, weekends, holidays, and school breaks.',
    tags: ['possession', 'schedule'],
    author: 'system',
    source: 'seed'
  },
  {
    id: 'lib-possession-exchange-logistics',
    type: 'roggs',
    text: 'Describe the exchange logistics you propose, including the location, times, and transportation responsibilities for each exchange.',
    tags: ['possession', 'logistics'],
    author: 'system',
    source: 'seed'
  },
  {
    id: 'lib-possession-communications',
    type: 'rfp',
    text: 'Produce all communications between the parties concerning possession and access schedules.',
    tags: ['possession', 'communications'],
    author: 'system',
    source: 'seed'
  },

  // Support — income, child-related expenses, allocation.
  {
    id: 'lib-support-income',
    type: 'rfp',
    text: 'Produce all documents reflecting your income and earning capacity for the last twelve months, including pay stubs, tax returns, and financial statements.',
    tags: ['support', 'income'],
    author: 'system',
    source: 'seed'
  },
  {
    id: 'lib-support-child-expenses',
    type: 'rfp',
    text: 'Produce all documents reflecting expenses for the children, including education, extracurricular, medical, and childcare expenses.',
    tags: ['support', 'expenses'],
    author: 'system',
    source: 'seed'
  },
  {
    id: 'lib-support-allocation',
    type: 'roggs',
    text: "Describe your proposal for the allocation of the children's expenses and the basis for that proposal.",
    tags: ['support', 'allocation'],
    author: 'system',
    source: 'seed'
  },

  // General discovery — no specific relief link.
  {
    id: 'lib-general-knowledge-persons',
    type: 'roggs',
    text: 'Identify every person with knowledge of relevant facts and describe the facts each person is believed to know.',
    tags: ['general'],
    author: 'system',
    source: 'seed'
  },
  {
    id: 'lib-general-trial-documents',
    type: 'rfp',
    text: 'Produce all documents you intend to use to support your claims or defenses at trial.',
    tags: ['general'],
    author: 'system',
    source: 'seed'
  }
]

export const SEED_MAPPINGS = [
  { issue_id: RR_POSSESSION_ACCESS, source_side: 'ours', library_item_id: 'lib-possession-work-schedule' },
  { issue_id: RR_POSSESSION_ACCESS, source_side: 'ours', library_item_id: 'lib-possession-exchange-logistics' },
  { issue_id: RR_POSSESSION_ACCESS, source_side: 'ours', library_item_id: 'lib-possession-communications' },
  { issue_id: RR_SUPPORT, source_side: 'ours', library_item_id: 'lib-support-income' },
  { issue_id: RR_SUPPORT, source_side: 'ours', library_item_id: 'lib-support-child-expenses' },
  { issue_id: RR_SUPPORT, source_side: 'ours', library_item_id: 'lib-support-allocation' }
]

// General discovery: library items with no relief link.
export const SEED_GENERAL = [
  { id: 'lib-general-knowledge-persons' },
  { id: 'lib-general-trial-documents' }
]
