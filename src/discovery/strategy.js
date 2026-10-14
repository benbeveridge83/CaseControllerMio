export const DRAFTING_STRATEGIES = [
  { id: 0, label: 'Every supportable ground', min: 1, description: 'Look for an objection or privilege for every request. Include tentative grounds with their missing facts; leave a request clear when no supportable ground exists.' },
  { id: 1, label: 'Broad objections', min: 25, description: 'Include plausible, request-specific grounds that need closer review.' },
  { id: 2, label: 'Reasonable objections', min: 50, description: 'Include reasonably supported objections and privileges, with necessary factual qualifications.' },
  { id: 3, label: 'Likely to be sustained', min: 70, description: 'Include only strong grounds supported by the supplied facts and authority.' },
  { id: 4, label: 'Strongest grounds only', min: 85, description: 'Use the most conservative threshold. Include only very strong grounds with clear support; no court outcome can be guaranteed.' }
]
export function draftingStrategy(value = 2) {
  const strategy = DRAFTING_STRATEGIES.find(s => s.id === value)
  if (!strategy) throw new Error('Choose a valid drafting threshold.')
  return strategy
}
export function strengthLabel(value) {
  if (value == null) return 'Unrated'
  return value >= 85 ? 'Very strong' : value >= 70 ? 'Strong' : value >= 50 ? 'Reasonable' : value >= 25 ? 'Tentative' : 'Weak / needs facts'
}
