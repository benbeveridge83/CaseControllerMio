const LIMIT = 40

export function agentHistoryKey(userId, scope = 'marketing') {
  return userId ? `mio-agent-history:v1:${scope}:${userId}` : null
}

export function readAgentHistory(storage, key) {
  if (!key) return []
  try {
    const saved = JSON.parse(storage.getItem(key) || 'null')
    if (saved?.version !== 1 || !Array.isArray(saved.messages)) return []
    return saved.messages.filter(message => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string')
      .slice(-LIMIT).map(message => ({ ...message, content: message.content.slice(0, message.role === 'user' ? 4000 : 12000) }))
  } catch { return [] }
}

export function saveAgentHistory(storage, key, messages) {
  if (!key) return false
  try {
    storage.setItem(key, JSON.stringify({ version: 1, messages: messages.slice(-LIMIT) }))
    return true
  } catch { return false }
}
