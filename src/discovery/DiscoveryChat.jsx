import { useEffect, useRef, useState } from 'react'
import { CHAT_KEY, readDiscoveryValue, saveDiscoveryValue } from './personal.js'
import { REGIMES, SOURCE_BY_ID } from './model.js'
import { draftingStrategy } from './strategy.js'
import Authorities from './Authorities.jsx'

function trimHistory(messages, max = 39, chars = 110000) {
  const next = [...messages]
  while (next.length > max || JSON.stringify(next).length > chars) next.splice(0,2)
  if (next[0]?.role === 'assistant') next.shift()
  return next
}
function loadHistory(store) {
  try {
    const stored = readDiscoveryValue(store.storage,CHAT_KEY,{version:1,messages:[]})
    const data = Array.isArray(stored) ? stored : stored?.version===1 ? stored.messages : null
    if (!Array.isArray(data) || data.length > 40 || data.some(m => !m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 10000 || (m.authorities && (!Array.isArray(m.authorities) || m.authorities.some(id=>!SOURCE_BY_ID[id]))))) throw new Error('Saved chat could not be read. Reload Mio before continuing.')
    if (data.some((m,i) => m.role !== (i%2?'assistant':'user'))) throw new Error('Saved chat has incomplete message order. Reload Mio before continuing.')
    return {messages:data,error:'',pending:store.status().pendingKeys?.includes(CHAT_KEY)||false}
  } catch (error) { return {messages:[],error:error.message} }
}
export default function DiscoveryChat({ api, store, owner, profile, regime, level, context, strategy, disabled, aiConfigured, onBusyChange }) {
  const [initial] = useState(()=>loadHistory(store)), [messages,setMessages] = useState(initial.messages)
  const [question,setQuestion] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState(''), [saveError,setSaveError] = useState(initial.pending?'A previous chat save is still pending. These messages are retained here; retry saving.':'')
  const abortRef = useRef(null), endRef = useRef(null), busyRef = useRef(false)
  const waiting = messages.at(-1)?.role==='user', locked = disabled || busy || Boolean(initial.error)
  useEffect(()=>()=>{abortRef.current?.abort()},[])
  useEffect(()=>{if(busy)endRef.current?.scrollIntoView({block:'nearest'})},[busy,messages])
  async function persist(history) {
    try { await saveDiscoveryValue(store,owner,CHAT_KEY,history); setSaveError('') }
    catch (cause) { setSaveError(cause.message) }
  }
  async function send() {
    if (busyRef.current || locked || (!waiting&&!question.trim())) return
    busyRef.current=true;setBusy(true);onBusyChange(true);setError('')
    const abort = new AbortController(); abortRef.current=abort
    const contextLabel = `${REGIMES.find(r=>r.id===regime)?.label} · Level ${level} · ${draftingStrategy(strategy).label}`
    let history = waiting ? messages : trimHistory([...messages,{id:crypto.randomUUID(),role:'user',content:question.trim(),contextLabel}])
    setMessages(history);setQuestion('')
    try {
      await persist(history)
      if (abort.signal.aborted) return
      const recent = trimHistory(history.map(({role,content})=>({role,content})),19,65000)
      const data = await api({action:'chat',regime,level,context,strategy,personal:profile,messages:recent},abort.signal)
      if (abort.signal.aborted) return
      history = trimHistory([...history,{id:crypto.randomUUID(),role:'assistant',content:data.answer,authorities:data.authorities,factsNeeded:data.factsNeeded,appliedRules:data.appliedRuleIds.map(id=>profile.rules.find(r=>r.id===id)?.title||id),contextLabel}],40)
      setMessages(history);await persist(history)
    } catch (cause) { if(!abort.signal.aborted)setError(cause.message) }
    finally {busyRef.current=false;setBusy(false);onBusyChange(false)}
  }
  async function clear() { setMessages([]);setError('');await persist([]) }
  async function discard() { const next=messages.slice(0,-1);setMessages(next);setError('');await persist(next) }
  return <section className="disco-chat">
    <div className="disco-section-heading"><div><h2>Discovery chat</h2><p>Ask about scope, objections, privileges, and how the rules apply.</p></div><button type="button" disabled={locked||!messages.length} onClick={clear}>Clear chat</button></div>
    <div className="disco-message">Uses the selected filing-date rules, discovery level, case facts, drafting threshold, and saved personal guidance. Paste a particular request into your question to discuss it. The uploaded document is not automatically included.</div>
    {initial.error&&<div className="disco-error" role="alert">{initial.error}</div>}
    <div className="disco-chat-history" role="log" aria-label="Discovery conversation" aria-live="polite">
      {!messages.length&&<div className="disco-chat-empty"><h3>Start with a discovery question</h3><p>“When is a request for all documents too broad?”</p><p>“How should I distinguish privilege from work product?”</p><p>“What does the 25-interrogatory limit include?”</p></div>}
      {messages.map((message,index)=><article className={`disco-chat-message ${message.role}`} key={message.id||index}><div className="disco-eyebrow">{message.role==='user'?'You':'Mio discovery assistant'}</div><div className="disco-chat-text">{message.content}</div>{message.role==='assistant'&&<><Authorities ids={message.authorities}/>{message.factsNeeded?.length>0&&<div className="disco-chat-facts"><strong>Facts or research to confirm</strong><ul>{message.factsNeeded.map((fact,i)=><li key={i}>{fact}</li>)}</ul></div>}{message.appliedRules?.length>0&&<p className="disco-note">Personal guidance used: {message.appliedRules.join('; ')}</p>}</>}<small>{message.contextLabel}</small></article>)}
      {busy&&<p role="status">Considering your question and the linked authorities…</p>}<div ref={endRef}/>
    </div>
    {error&&<div className="disco-error" role="alert">{error} Your question is kept below for retry.</div>}
    {saveError&&<div className="disco-error" role="alert">Chat has not been confirmed saved: {saveError} <button type="button" disabled={locked} onClick={()=>persist(messages)}>Retry saving chat</button></div>}
    {waiting&&!busy?<div className="disco-chat-compose"><span>Last question is awaiting an answer.</span><button type="button" className="disco-primary" disabled={locked||aiConfigured===false} onClick={send}>Retry question</button><button type="button" disabled={locked} onClick={discard}>Remove unanswered question</button></div>:<form className="disco-chat-compose" onSubmit={e=>{e.preventDefault();void send()}}><label className="disco-label" htmlFor="disco-chat-question">Ask about discovery</label><textarea id="disco-chat-question" value={question} disabled={locked} maxLength={10000} rows={3} placeholder="Ask a question, paste a request, or follow up on an earlier answer…" onChange={e=>setQuestion(e.target.value)}/><button type="submit" className="disco-primary" disabled={locked||aiConfigured===false||!question.trim()}>{busy?'Thinking…':'Send question'}</button></form>}
    <p className="disco-note">Recent chat is saved to your account. Answers use the linked authority collection, not a live citator or web search. Earlier answers retain their original case settings.</p>
  </section>
}
