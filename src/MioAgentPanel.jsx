import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient.js'
import { agentHistoryKey, readAgentHistory, saveAgentHistory } from './mioAgentHistory.js'
import './mioAgentPanel.css'

const prompts = [
  ['Where are we at?', 'Give me the current marketing picture: ad spending, inquiries, consultations, and what needs my attention.'],
  ['What’s the bottleneck?', 'What is the best-supported bottleneck in my marketing? Show the evidence, what is uncertain, and what I should check first.'],
  ['Are my forms working?', 'Are my website forms reaching Mio and being recorded correctly in Google Ads? Separate what is verified from what still needs testing.'],
  ['Are my phones connected?', 'Check my Google call tracking and available call records. Can you verify that calls reach my phone system, and what is still unverified?']
]
const labels = { available: 'Data checked', partial: 'Partial data', unavailable: 'Unavailable', unverified: 'Needs verification' }
const stamp = value => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' : 'Not checked yet'
const money = (value, currency = 'USD') => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD', maximumFractionDigits: 2 })

function EvidenceCard({ label, value, note }) {
  return <div className="mio-agent-metric"><span>{label}</span><strong>{value ?? '—'}</strong><small>{note}</small></div>
}

export default function MioAgentPanel({ session, scope = 'marketing', initialDays = 30 }) {
  const historyKey = agentHistoryKey(session?.user?.id, scope)
  const [messages, setMessages] = useState(() => {
    try { return readAgentHistory(window.localStorage, historyKey) } catch { return [] }
  })
  const [draft, setDraft] = useState('')
  const [days, setDays] = useState([7, 14, 30, 90].includes(Number(initialDays)) ? Number(initialDays) : 30)
  const [evidence, setEvidence] = useState(null)
  const [aiConfigured, setAiConfigured] = useState(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(true)
  const [error, setError] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const requestRef = useRef(null)
  const busyRef = useRef(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  function updateMessages(next) {
    const bounded = next.slice(-40)
    setMessages(bounded)
    try { setSaveFailed(!saveAgentHistory(window.localStorage, historyKey, bounded)) } catch { setSaveFailed(true) }
  }

  async function request(body, signal) {
    const { data, error: authError } = await supabase.auth.getSession()
    if (authError || !data?.session?.access_token || data.session.user?.id !== session?.user?.id) throw new Error('Sign in to Mio again to ask a question.')
    const response = await fetch('/api/marketing-audit', {
      method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, ...body }), signal
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Ask Mio is temporarily unavailable. Try again.')
    return payload
  }

  async function refreshEvidence(signal) {
    try {
      const result = await request({ action: 'context', days }, signal)
      if (signal.aborted) return
      setEvidence(result.evidence)
      setAiConfigured(result.aiConfigured)
    } catch (cause) {
      if (!signal.aborted) setError(cause.message)
    } finally {
      if (!signal.aborted) setRefreshing(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    // Schedule the network subscription so auth failures also settle asynchronously.
    Promise.resolve().then(() => { if (!controller.signal.aborted) refreshEvidence(controller.signal) })
    return () => controller.abort()
    // The panel is keyed by authenticated user. Changing the period reloads its evidence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, loading])

  useEffect(() => () => { requestRef.current?.abort() }, [])

  async function sendQuestion(question = draft) {
    const content = String(question).trim()
    if (!content || busyRef.current || refreshing || aiConfigured === false) return
    busyRef.current = true
    setLoading(true)
    setError('')
    setDraft('')
    const next = [...messages, { id: crypto.randomUUID(), role: 'user', content, createdAt: new Date().toISOString() }].slice(-39)
    updateMessages(next)
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const result = await request({ action: 'chat', days, messages: next.map(({ role, content: text }) => ({ role, content: text })) }, controller.signal)
      if (controller.signal.aborted) return
      setEvidence(result.evidence)
      updateMessages([...next, { id: result.responseId || crypto.randomUUID(), role: 'assistant', content: result.answer, createdAt: new Date().toISOString(), range: result.evidence?.range, checkedAt: result.evidence?.checkedAt }])
    } catch (cause) {
      if (!controller.signal.aborted) { setError(cause.message); setDraft(content) }
    } finally {
      busyRef.current = false
      if (!controller.signal.aborted) { setLoading(false); inputRef.current?.focus() }
    }
  }

  function reload() {
    if (loading || refreshing) return
    setRefreshing(true)
    setError('')
    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    refreshEvidence(controller.signal)
  }

  const google = evidence?.google?.report
  const leads = evidence?.leads
  const pnc = evidence?.pnc
  const usable = source => source && ['available', 'partial'].includes(source.status)
  const disabled = loading || refreshing || aiConfigured === false

  return <section className="mio-agent" aria-labelledby="mio-agent-title">
    <header className="mio-agent-header">
      <div><div className="mio-agent-eyebrow">Your marketing assistant</div><h1 id="mio-agent-title">Ask Mio <span>Marketing</span></h1><p>Understand your ads, find the gaps, and decide what to fix next.</p></div>
      <div className="mio-agent-controls">
        <label>Reporting period<select aria-label="Agent reporting period" value={days} disabled={loading || refreshing} onChange={event => { setRefreshing(true); setEvidence(null); setError(''); setDays(Number(event.target.value)) }}>{[7, 14, 30, 90].map(value => <option key={value} value={value}>Last {value} days</option>)}</select></label>
        <button type="button" onClick={reload} disabled={loading || refreshing}>{refreshing ? 'Checking data…' : 'Refresh evidence'}</button>
      </div>
    </header>

    <div className="mio-agent-layout">
      <div className="mio-agent-conversation">
        <div className="mio-agent-conversation-top"><div><span className="mio-agent-dot" />Ask a question or follow up</div><button type="button" disabled={loading || !messages.length} onClick={() => { updateMessages([]); setDraft(''); setError(''); inputRef.current?.focus() }}>New conversation</button></div>
        <div className="mio-agent-prompts">{prompts.map(([label, question]) => <button key={label} type="button" disabled={disabled} onClick={() => sendQuestion(question)}>{label}<span aria-hidden="true">↗</span></button>)}</div>
        <div className="mio-agent-messages" role="log" aria-label="Ask Mio conversation" aria-live="polite" aria-busy={loading}>
          {!messages.length && <div className="mio-agent-welcome"><div className="mio-agent-mark" aria-hidden="true">✦</div><h2>Your marketing questions, answered here.</h2><p>I’ll use the connected reports and Mio’s lead records, show the evidence, and explain what still needs checking.</p><div>Try: “Why do I have form submissions but no conversions?”</div></div>}
          {messages.map((message, index) => <article key={message.id || index} className={`mio-agent-message mio-agent-message-${message.role}`}>
            <div className="mio-agent-message-label">{message.role === 'user' ? 'You' : 'Mio'}{message.role === 'assistant' && message.range && <span>{message.range.start} → {message.range.end}</span>}</div>
            <div className="mio-agent-message-text">{message.content}</div>
            {message.checkedAt && <small>Evidence checked {stamp(message.checkedAt)}</small>}
          </article>)}
          {loading && <div className="mio-agent-thinking" role="status"><span className="mio-agent-dot" />Checking fresh reports and preparing your answer…</div>}
          <div ref={endRef} />
        </div>
        {error && <div className="mio-agent-error" role="alert">{error}</div>}
        {aiConfigured === false && <div className="mio-agent-error" role="status">Mio’s AI service needs to be connected. You can still review and refresh the evidence.</div>}
        <form className="mio-agent-composer" onSubmit={event => { event.preventDefault(); sendQuestion() }}>
          <label className="mio-agent-sr-only" htmlFor="mio-agent-question">Your marketing question</label>
          <textarea id="mio-agent-question" ref={inputRef} value={draft} rows={3} maxLength={4000} disabled={disabled} placeholder="Ask about your ads, forms, calls, or next steps…" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendQuestion() } }} />
          <div><small>Enter to send · Shift + Enter for a new line</small><button type="submit" disabled={disabled || !draft.trim()}>{loading ? 'Working…' : 'Ask Mio'}<span aria-hidden="true">↑</span></button></div>
        </form>
        <div className="mio-agent-history-note">{saveFailed ? 'Browser storage is full. This conversation is available until you leave this page.' : 'Conversation saved for your account in this browser.'}</div>
      </div>

      <aside className="mio-agent-evidence" aria-label="Marketing evidence">
        <div className="mio-agent-evidence-heading"><h2>What Mio checked</h2><span>{refreshing ? 'Refreshing…' : stamp(evidence?.checkedAt)}</span></div>
        {evidence?.range && <p className="mio-agent-period">{evidence.range.start} → {evidence.range.end}</p>}
        <div className="mio-agent-metrics">
          <EvidenceCard label="Google Ads spend" value={google && !google.warnings?.some(w => w.section === 'overview') ? money(google.overview?.cost, google.account?.currencyCode) : null} note="Platform report" />
          <EvidenceCard label="Form inquiries" value={usable(leads) ? leads.inquiries : null} note="All sources · excludes spam" />
          <EvidenceCard label="Unaddressed forms" value={usable(leads) ? leads.unaddressed : null} note="New or acknowledged" />
          <EvidenceCard label="Consultations scheduled" value={usable(pnc) ? pnc.consultationsScheduled : null} note="PNCs opened this period · invites sent" />
        </div>
        {leads?.groups && <div className="mio-agent-practices"><strong>Form inquiries by practice</strong><div><span>Family law</span><b>{leads.groups.family_law.inquiries}</b></div><div><span>Personal injury</span><b>{leads.groups.personal_injury.inquiries}</b></div><div><span>Unknown</span><b>{leads.groups.unknown.inquiries}</b></div></div>}
        <div className="mio-agent-checks">{(evidence?.checks || []).map(check => <div className="mio-agent-check" key={check.id}><div><strong>{check.label}</strong><span className={`mio-agent-badge mio-agent-badge-${check.status}`}>{labels[check.status] || check.status}</span></div><p>{check.detail}</p></div>)}</div>
        {!evidence && <p className="mio-agent-empty-evidence">{refreshing ? 'Reading connected reports and lead records…' : 'Refresh evidence to check your connections.'}</p>}
        <div className="mio-agent-scope-note"><strong>Recommendations for your review</strong><p>Mio can explain results and suggest fixes here. Use the ad controls to review and apply a campaign change.</p></div>
      </aside>
    </div>
  </section>
}
