// AI classification and draft suggestions for the email dashboard.
//
// Reuses the OpenAI Responses API already wired elsewhere in Mio
// (lib/ads/http.js, lib/marketing-agent.js) via OPENAI_API_KEY, so categories
// and drafts come from the real model, not static mock output. A deterministic
// keyword fallback keeps classification usable when the provider is not
// configured, and the response always flags whether the AI produced the result.

import { normalizeCategories } from './categories.js'

const DEFAULT_MODEL = 'gpt-5-mini'

export function aiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY)
}

async function openAiText({ instructions, prompt, model, maxTokens = 800, signal }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw Object.assign(new Error('AI is not configured on the server. Set OPENAI_API_KEY.'), { statusCode: 503 })
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: signal || AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, store: false, max_output_tokens: maxTokens, instructions, input: prompt }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error?.message || `AI request failed (${response.status}).`), { statusCode: 502 })
  }
  const text = payload.output_text || (payload.output || []).flatMap((item) => item.content || []).filter((item) => item.type === 'output_text').map((item) => item.text).join('\n')
  if (!text || !text.trim()) throw Object.assign(new Error('AI returned no text.'), { statusCode: 502 })
  return { text: text.trim(), model: payload.model || model }
}

const CLASSIFY_SYSTEM = `You are a careful email classifier for a family-law practice.
Classify each email into one or more of these categories: orders, settings, general.
- orders: emails about court orders — proposed orders, signed orders, agreed orders,
  temporary or final orders, orders to appear, orders enforcing, or motions about orders.
- settings: emails about scheduling, hearing settings, docket settings, continuances,
  appearances, status conferences, trial or mediation settings.
- general: any routine correspondence that is not about an order or a setting.
An email may match more than one category. For every category you assign, produce a short
"topic" noun phrase (for example "Proposed Order", "Hearing Setting"). If the text names a
matter or client, put a short hint in "matterHint". Return JSON only in this shape:
{"categories":["orders","settings"],"topics":{"orders":"Proposed Order","settings":"Hearing Setting"},"matterHint":"Bay"}`

const DRAFT_SYSTEM = `You draft short, professional email replies for a family-law firm.
Only suggest a draft — never send anything and never promise a send. Use the sender's name,
the matter context, and any calendar or OneDrive context provided. Do not invent facts,
deadlines, filing fees, or court rules. Keep the draft concise and return the email body only.`

function truncateBody(body) {
  let text = ''
  if (typeof body === 'string') text = body
  else if (body?.content) text = body.content
  if (text.length > 6000) text = text.slice(0, 6000) + '…'
  return text || '(no body)'
}

function contextLines(context = {}) {
  const lines = []
  if (context.calendar?.length) {
    lines.push('Nearby calendar events:\n' + context.calendar.map((e) => `- ${e.subject || e.title || ''} @ ${e.start || ''}`).join('\n'))
  }
  if (context.onedrive?.length) {
    lines.push('OneDrive items matching this matter:\n' + context.onedrive.map((i) => `- ${i.name || i.fileName || ''}`).join('\n'))
  }
  return lines
}

function buildPrompt(message, context) {
  return [
    `Subject: ${message.subject || ''}`,
    `From: ${message.from?.emailAddress?.address || message.from || ''}`,
    `Received: ${message.receivedDateTime || message.received || ''}`,
    contextLines(context).join('\n\n'),
    'Body:',
    truncateBody(message.body),
  ].filter(Boolean).join('\n')
}

function normalizeTopics(topics, categories) {
  const out = {}
  for (const category of categories) out[category] = String(topics?.[category] || topics?.[`${category}s`] || '').slice(0, 80)
  return out
}

function parseClassificationJson(text) {
  try {
    const json = JSON.parse(text)
    const categories = normalizeCategories(json.categories || json.category || [])
    return { categories, topics: normalizeTopics(json.topics || {}, categories), matterHint: String(json.matterHint || json.matter_hint || '') }
  } catch {
    return null
  }
}

export function keywordClassify(subject = '', body = '') {
  const text = `${subject}\n${body}`.toLowerCase()
  const categories = []
  if (/\border|order to appear|proposed order|signed order|agreed order|temporary order|final order|order enforcing|motion for.{0,24}order/i.test(text)) categories.push('orders')
  if (/\bsetting|hearing|docket|schedule|continuance|appearance|status conference|trial setting|mediation setting/i.test(text)) categories.push('settings')
  if (categories.length === 0) categories.push('general')
  const topics = {}
  for (const category of categories) topics[category] = category === 'orders' ? 'Order' : category === 'settings' ? 'Setting' : 'General'
  return { categories: normalizeCategories(categories), topics, matterHint: '' }
}

export async function classifyEmail({ message = {}, context = {}, signal } = {}) {
  if (aiConfigured()) {
    try {
      const result = await openAiText({
        instructions: CLASSIFY_SYSTEM,
        prompt: buildPrompt(message, context),
        model: process.env.OPENAI_EMAIL_MODEL || DEFAULT_MODEL,
        maxTokens: 400,
        signal,
      })
      const parsed = parseClassificationJson(result.text)
      if (parsed) return { ...parsed, ai: true, model: result.model }
    } catch {
      // fall through to the deterministic fallback; the dashboard never fails on an AI outage
    }
  }
  return { ...keywordClassify(message.subject, message.body), ai: false }
}

export async function draftReply({ message = {}, context = {}, signal } = {}) {
  if (!aiConfigured()) {
    throw Object.assign(new Error('Draft suggestions require the AI provider to be configured on the server.'), { statusCode: 503 })
  }
  const prompt = [
    'Original message:',
    `Subject: ${message.subject || ''}`,
    `From: ${message.from || ''}`,
    truncateBody(message.body),
    context.matterName ? `Matter: ${context.matterName}` : '',
    contextLines(context).join('\n\n'),
    'Write a suggested reply draft (email body only).',
  ].filter(Boolean).join('\n')
  const result = await openAiText({ instructions: DRAFT_SYSTEM, prompt, model: process.env.OPENAI_EMAIL_MODEL || DEFAULT_MODEL, maxTokens: 900, signal })
  return { body: result.text, model: result.model }
}
