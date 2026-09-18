const DEFAULT_MODEL = 'claude-sonnet-5'
const MAX_MESSAGE = 5000
const MAX_HISTORY = 12

function boundedHistory(history = []) {
  if (!Array.isArray(history)) return []
  return history.slice(-MAX_HISTORY).map((entry) => ({
    role: entry?.role === 'assistant' ? 'assistant' : 'user',
    content: String(entry?.content || '').slice(0, MAX_MESSAGE)
  })).filter((entry) => entry.content.trim())
}

export async function askClaudeParalegal({apiKey, fetchImpl = fetch, message, history = [], snapshot = [], model = DEFAULT_MODEL}) {
  const key = String(apiKey || '').trim()
  const question = String(message || '').trim()
  if (!key) throw Object.assign(new Error('Claude is not configured for this preview.'), {code:'CLAUDE_NOT_CONFIGURED'})
  if (!question) throw Object.assign(new Error('Ask Paralegal a question first.'), {code:'INVALID_MESSAGE'})
  if (question.length > MAX_MESSAGE) throw Object.assign(new Error('That request is too long for this preview.'), {code:'INVALID_MESSAGE'})
  if (!Array.isArray(snapshot) || snapshot.length > 200) throw Object.assign(new Error('The Need to Set snapshot is invalid or too large.'), {code:'INVALID_SNAPSHOT'})

  const system = [
    'You are Paralegal, an AI assistant inside Case Controller Mio for a Texas family-law office.',
    'This preview is read-only. Use only the Need to Set snapshot supplied with the request.',
    'Do not claim an email was sent, a calendar was changed, a filing was made, a website was checked, or a workflow step was completed.',
    'Distinguish saved facts from recommendations. If the snapshot does not contain the answer, say what information is missing.',
    'Be concise and practical. Refer to matters by the names supplied in the snapshot.'
  ].join(' ')
  const context = `Current Need to Set snapshot (JSON):\n${JSON.stringify(snapshot)}\n\nUser request: ${question}`
  const messages = [...boundedHistory(history), {role:'user', content:context}]
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model, max_tokens:1200, system, messages}),
    signal:AbortSignal.timeout(45000)
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(`Claude request failed with status ${response.status || 'unknown'}.`), {code:'CLAUDE_REQUEST_FAILED', statusCode:502})
  }
  const text = (Array.isArray(data.content) ? data.content : []).filter((block) => block?.type === 'text').map((block) => block.text).join('\n').trim()
  if (!text) throw Object.assign(new Error('Claude returned no readable response.'), {code:'CLAUDE_EMPTY_RESPONSE', statusCode:502})
  return {text, model:data.model || model, usage:{inputTokens:Number(data.usage?.input_tokens)||0, outputTokens:Number(data.usage?.output_tokens)||0}}
}
