// Email dashboard category taxonomy.
//
// A single message can carry several categories at once. For example an email
// that is both an order and a setting must appear in both the Orders and
// Settings sections. Resolution is tracked per (message, category) — never per
// message — so resolving one category leaves the others pending.

export const EMAIL_CATEGORIES = ['orders', 'settings', 'drafts', 'service', 'general']

export const CATEGORY_LABELS = {
  orders: 'Orders',
  settings: 'Settings',
  general: 'General',
  drafts: 'Email drafted',
  service: 'Need to serve',
}

export function keywordCategories(subject='',body='') {
 const text=`${subject}\n${typeof body==='string'?body:body?.content||''}`
 const categories=[]
 if(/\borders?\b|order to appear/i.test(text))categories.push('orders')
 if(/\bsetting|hearing|docket|schedul|continuance|appearance|mediat|deposition|trial/i.test(text))categories.push('settings')
 if(/\b(draft email|draft reply|draft response|email draft)\b/i.test(text))categories.push('drafts')
 if(/\b(service of|process server|need to serve|citation|serve the|served on|service instructions)\b/i.test(text))categories.push('service')
 return normalizeCategories(categories)
}

export function normalizeCategory(value) {
  const key = String(value == null ? '' : value).trim().toLowerCase()
  return EMAIL_CATEGORIES.includes(key) ? key : 'general'
}

export function normalizeCategories(values = []) {
  const set = new Set((Array.isArray(values) ? values : []).map(normalizeCategory))
  if (set.size === 0) return ['general']
  return EMAIL_CATEGORIES.filter((category) => set.has(category))
}

export function labelFor(category) {
  return CATEGORY_LABELS[normalizeCategory(category)] || 'General'
}
