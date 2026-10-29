export const RESEARCH_DATE = 'October 29, 2026'

export const APPEAL_GROUPS = [
  { id: 'entry', label: 'Getting into the appeal', number: '01', description: 'Jurisdiction, deadlines, and the pleadings that frame the case.' },
  { id: 'record', label: 'Order & appellate record', number: '02', description: 'Audit the signed order, findings, clerk’s record, and reporter’s record.' },
  { id: 'trial', label: 'What happened at trial', number: '03', description: 'Preservation, evidence, jury procedure, and representation.' },
  { id: 'merits', label: 'The termination decision', number: '04', description: 'Test the proof of each ground, best interest, and remaining custody relief.' },
  { id: 'review', label: 'Briefing & disposition', number: '05', description: 'Present the issue, answer it, show harm, and request the correct relief.' },
]

export const APPEAL_SECTIONS = [
  { id: 'jurisdiction', group: 'entry', label: 'Jurisdiction & finality', description: 'Appealable orders, jurisdictional dismissal, standing, and special federal requirements.' },
  { id: 'deadlines', group: 'entry', label: 'Deadlines & appellate filings', description: 'Accelerated notice, postjudgment steps, extensions, and higher review.' },
  { id: 'pleadings', group: 'entry', label: 'Petition, service & notice', description: 'Fair notice, unpleaded grounds, citation, appearance, and trial notice.' },
  { id: 'findings', group: 'record', label: 'Findings & termination order', description: 'Rule findings, statutory findings, specificity, and defects in the judgment.' },
  { id: 'clerk-record', group: 'record', label: 'Clerk’s record', description: 'Required filings, exhibits, supplementation, and record limits.' },
  { id: 'reporter-record', group: 'record', label: 'Reporter’s record', description: 'Requests, omitted testimony, partial records, and lost recordings.' },
  { id: 'trial-procedure', group: 'trial', label: 'Trial procedure & jury charge', description: 'Participation, continuances, jury submission, and trial rulings.' },
  { id: 'trial-evidence', group: 'trial', label: 'Evidence admitted or excluded', description: 'Hearsay, experts, drug tests, records, objections, and offers of proof.' },
  { id: 'counsel', group: 'trial', label: 'Counsel & due process', description: 'Appointment, effective assistance, conflicts, and appellate representation.' },
  { id: 'sufficiency', group: 'merits', label: 'Legal & factual sufficiency', description: 'The heightened burden, standards of review, and independent grounds.' },
  { id: 'predicates', group: 'merits', label: 'Every statutory predicate', description: 'Current grounds, former grounds, elements, defenses, and version changes.' },
  { id: 'best-interest', group: 'merits', label: 'Best interest', description: 'Holley, statutory factors, improvement, placement, and parent-specific proof.' },
  { id: 'special-grounds', group: 'merits', label: 'Special statutory routes', description: 'Alleged fathers, mental illness, prior denied termination, and ICWA’s additional proof.' },
  { id: 'conservatorship', group: 'merits', label: 'Conservatorship & residual relief', description: 'Separate custody findings and the effect of reversing termination.' },
  { id: 'briefing', group: 'review', label: 'Briefs, waiver & argument', description: 'Issue framing, record citations, abandoned grounds, and responding to an appeal.' },
  { id: 'remedies', group: 'review', label: 'Harm, relief & remand', description: 'Reversible harm, rendition, remand, correction, and proceedings after appeal.' },
]
