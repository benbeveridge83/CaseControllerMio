export const cacheKey=userId=>`mio-email-categorizations-v2:${userId}`
export function loadCategories(userId){try{return JSON.parse(localStorage.getItem(cacheKey(userId))||'{}')}catch{return {}}}
export function saveCategories(userId,cache){try{localStorage.setItem(cacheKey(userId),JSON.stringify(cache))}catch{/* classification remains usable in memory */}window.dispatchEvent(new Event('mio-email-categories'))}
