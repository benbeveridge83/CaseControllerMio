// Email dashboard — Settings / Orders / General / By Matter views.
//
// Self-contained: it loads mailboxes, folders, messages, matters, resolutions,
// and AI categorizations itself. Messages keep their source identity across
// categories; resolution is tracked per (message, category).

import { useEffect, useMemo, useRef, useState } from 'react'
import { emailClient } from './emailClient.js'
import { supabase } from '../supabaseClient.js'
import { EMAIL_CATEGORIES, CATEGORY_LABELS, normalizeCategories, labelFor, keywordCategories } from '../../lib/email/categories.js'
import { loadCategories,saveCategories } from './categoryCache.js'
import { messageKey as emailMessageKey } from '../dashboard/model.js'
import { buildMatterIndex, matchMessageToMatters, matterDisplayName, matterContactEmails } from '../../lib/email/matching.js'
import { categoryStatesFor, setResolved } from '../../lib/email/resolution.js'
import './emailDashboard.css'

const DEFAULT_MAILBOXES = ['ben@beveridgelawfirm.com', 'service@beveridgelawfirm.com', 'office@beveridgelawfirm.com', 'billing@beveridgelawfirm.com']
const VIEWS=['configuration','settings','orders','drafts','service','general','bymatter']


export default function EmailDashboard({ userId }) {
  const [view, setView] = useState('orders')
  const [status, setStatus] = useState({ accounts: [], available: [], categories: EMAIL_CATEGORIES })
  const [folders, setFolders] = useState([])
  const [settings, setSettings] = useState({})
  const [messages, setMessages] = useState([])
  const [resolutions, setResolutions] = useState({})
  const [matters, setMatters] = useState([])
  const [catCache, setCatCache] = useState(()=>loadCategories(userId))
  const [drafts, setDrafts] = useState({})
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [filters, setFilters] = useState({ matter: '', client: '', counsel: '' })
  const [loading, setLoading] = useState(true)
  const [classifying, setClassifying] = useState(false)
  const [error, setError] = useState(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    return params.get('error') || ''
  })
  const [warnings, setWarnings] = useState([])
  const [connecting, setConnecting] = useState(false)
  const classifyRef = useRef(null)

  async function refresh() {
    setLoading(true)
    try {
      const statusData = await emailClient.status()
      setStatus(statusData)
      if (!(statusData.accounts || []).length) setView('configuration')
      const results = await Promise.allSettled([
        emailClient.folders(), emailClient.getSettings(),
        emailClient.resolutions(), emailClient.messages(),
      ])
      const [folderData, settingsData, resolutionData, messageData] = results.map((result) => result.status === 'fulfilled' ? result.value : {})
      setFolders(folderData.folders || [])
      setSettings(settingsData.settings || {})
      setResolutions(resolutionData.resolutions || {})
      setMessages(messageData.messages || [])
      setWarnings(messageData.warnings || [])
      const failures = results.filter((result) => result.status === 'rejected')
      if (failures.length) setError([...new Set(failures.map((result) => result.reason.message || 'Could not load email data.'))].join(' '))
      const { data: matterRows } = await supabase
        .from('matters')
        .select('*, clients(first_name, last_name, email)')
        .order('created_at', { ascending: false })
      setMatters(matterRows || [])
    } catch (err) {
      setError(err.message || 'Could not load the email dashboard.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [userId])

  const matterIndex = useMemo(() => buildMatterIndex(matters), [matters])

  const categorized = useMemo(() => {
    return messages.map((message) => {
      const entry = catCache[emailMessageKey(message)] || {}
      return {
        ...message,
        categories: normalizeCategories([...(entry.categories||keywordCategories(message.subject,message.bodyPreview)),...(message.isDraft?['drafts']:[])]),
        topics: entry.topics || {},
        matterHint: entry.matterHint || '',
        ai: Boolean(entry.ai),
        matches: matchMessageToMatters(message, matters, matterIndex),
      }
    })
  }, [messages, catCache, matters, matterIndex])

  async function classifyPending() {
    const pending = categorized.filter((m) => !catCache[emailMessageKey(m)])
    if (!pending.length) return
    setClassifying(true)
    const next = { ...catCache }
    for (const message of pending.slice(0, 8)) {
      try {
        const matterName = (message.matches && message.matches[0] && message.matches[0].matterName) || ''
        const result = await emailClient.classify(message, matterName)
        next[emailMessageKey(message)] = { categories: result.categories, topics: result.topics, matterHint: result.matterHint, ai: result.ai }
      } catch {
        next[emailMessageKey(message)] = { categories: keywordCategories(message.subject,message.bodyPreview), topics: { general: 'General' }, matterHint: '', ai: false }
      }
    }
    setCatCache(next)
    saveCategories(userId,next)
    setClassifying(false)
  }

  useEffect(() => {
    if (!messages.length || classifying) return
    if (classifyRef.current) return
    classifyRef.current = true
    classifyPending().finally(() => { classifyRef.current = false })
  }, [messages])

  async function openMessage(message) {
    setSelectedMessage(message)
    setError('')
    try {
      const { message: full } = await emailClient.message(message.id, message.accountEmail)
      setSelectedMessage(full)
    } catch (err) {
      setError(err.message || 'Could not open the message.')
    }
  }

  async function draftFor(message) {
    setError('')
    try {
      const matterName = (message.matches && message.matches[0] && message.matches[0].matterName) || ''
      const result = await emailClient.draft(message, matterName)
      setDrafts((prev) => ({ ...prev, [message.id]: result.body }))
    } catch (err) {
      setError(err.message || 'Could not draft a reply.')
    }
  }

  async function resolveCategory(message, category, resolved) {
    const prev = resolutions
    setResolutions(setResolved(prev, message.id, category, resolved))
    try {
      await emailClient.resolve(message.id, category, resolved)
    } catch (err) {
      setResolutions(prev)
      setError(err.message || 'Could not save the resolution.')
    }
  }

  async function connect(account) {
    setError('')
    setConnecting(true)
    try {
      const { url } = await emailClient.connectStart(account)
      window.location.assign(url)
    } catch (err) {
      setError(err.message || 'Could not start the connection.')
      setConnecting(false)
    }
  }

  async function disconnect(account) {
    setError('')
    try {
      await emailClient.disconnect(account)
      await refresh()
    } catch (err) {
      setError(err.message || 'Could not disconnect the mailbox.')
    }
  }

  async function saveFolderSelections(account, selections) {
    setError('')
    try {
      await emailClient.saveSettings(account, selections)
      await refresh()
    } catch (err) {
      setError(err.message || 'Could not save folder settings.')
    }
  }

  const filterOptions = useMemo(() => {
    const mattersList = matters.map((m) => ({ value: matterDisplayName(m), label: matterDisplayName(m) }))
    const clients = new Set()
    const counsel = new Set()
    for (const matter of matters) {
      for (const contact of matterContactEmails(matter)) {
        if (contact.kind === 'client' && contact.name) clients.add(contact.name)
        if (contact.kind.startsWith('opposing') && contact.name) counsel.add(contact.name)
      }
    }
    return {
      matters: mattersList,
      clients: [...clients].sort().map((c) => ({ value: c, label: c })),
      counsel: [...counsel].sort().map((c) => ({ value: c, label: c })),
    }
  }, [matters])

  const filtered = useMemo(() => {
    return categorized.filter((m) => {
      if (filters.matter && !(m.matches || []).some((match) => match.matterName === filters.matter)) return false
      if (filters.client && !(m.matches || []).some((match) => match.clientName && match.clientName.includes(filters.client))) return false
      if (filters.counsel && !(m.matches || []).some((match) => match.clientName && match.clientName.includes(filters.counsel))) return false
      return true
    })
  }, [categorized, filters])

  function messagesForCategory(category) {
    return filtered.filter((m) => m.categories.includes(category))
  }

  const matterGroups = useMemo(() => {
    const groups = new Map()
    const add = (key, name, message, topic) => {
      if (!groups.has(key)) groups.set(key, { key, name, topics: new Map() })
      const group = groups.get(key)
      if (!group.topics.has(topic)) group.topics.set(topic, [])
      group.topics.get(topic).push(message)
    }
    for (const m of filtered) {
      if (!(m.matches || []).length) {
        for (const category of m.categories) add('__unassigned__', 'Unassigned', m, category === 'general' ? 'General' : labelFor(category))
        continue
      }
      for (const match of m.matches) {
        for (const category of m.categories) {
          add(match.matterId, match.matterName, m, category === 'general' ? 'General' : labelFor(category))
        }
      }
    }
    return [...groups.values()].map((g) => ({ key: g.key, name: g.name, topics: [...g.topics.entries()].map(([topic, items]) => ({ topic, items })) }))
  }, [filtered])

  const pendingCount = categorized.filter((m) => !catCache[emailMessageKey(m)]).length

  return (
    <div className="mio-email-dashboard">
      <div className="mio-email-header">
        <h2>Email Dashboard</h2>
        <button onClick={() => { setError(''); refresh() }} disabled={loading}>Refresh emails</button>
        <div className="mio-email-tabs" role="tablist">
          {VIEWS.map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
              {v === 'bymatter' ? 'By Matter' : v==='configuration'?'Mailbox settings':v==='settings'?'Need to set':CATEGORY_LABELS[v] || v}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mio-email-error" role="alert">{error}</div>}
      {warnings.map((warning, i) => <div key={i} className="mio-email-error" role="alert">{warning.accountEmail}: {warning.error}</div>)}
      {!loading && !(status.accounts || []).length && (
        <div className="mio-email-connection" role="status">
          <strong>Connect Outlook to load your emails</strong>
          <p>No Microsoft mailbox is connected to this dashboard yet. Sign in with ben@beveridgelawfirm.com to load your Inbox and any shared mailboxes you can access.</p>
          <button disabled={connecting} onClick={() => connect(DEFAULT_MAILBOXES[0])}>{connecting ? 'Opening Microsoft sign-in…' : 'Connect Outlook'}</button>
        </div>
      )}

      {loading ? (
        <p className="mio-email-loading">Loading email dashboard…</p>
      ) : (
        <>
          {view === 'configuration' ? (
            <SettingsView
              status={status}
              folders={folders}
              settings={settings}
              onConnect={connect}
              onDisconnect={disconnect}
              onSave={saveFolderSelections}
            />
          ) : (
            <>
              <div className="mio-email-filters">
                <select value={filters.matter} onChange={(e) => setFilters((f) => ({ ...f, matter: e.target.value }))}>
                  <option value="">All matters</option>
                  {filterOptions.matters.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select value={filters.client} onChange={(e) => setFilters((f) => ({ ...f, client: e.target.value }))}>
                  <option value="">All clients</option>
                  {filterOptions.clients.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select value={filters.counsel} onChange={(e) => setFilters((f) => ({ ...f, counsel: e.target.value }))}>
                  <option value="">All opposing counsel</option>
                  {filterOptions.counsel.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span className="mio-email-note">
                  {!messages.length ? 'No emails loaded' : classifying ? 'Classifying…' : pendingCount ? `${pendingCount} unclassified — classifying…` : 'AI classification up to date'}
                </span>
              </div>

              {view === 'bymatter' ? (
                <ByMatterView groups={matterGroups} resolutions={resolutions} onOpen={openMessage} onToggle={resolveCategory} />
              ) : (
                <CategoryView
                  category={view}
                  items={messagesForCategory(view)}
                  resolutions={resolutions}
                  onOpen={openMessage}
                  onToggle={resolveCategory}
                  drafts={drafts}
                  onDraft={draftFor}
                  onClassifyMore={() => classifyPending()}
                  pendingCount={pendingCount}
                />
              )}
            </>
          )}
        </>
      )}

      {selectedMessage && (
        <MessageDetail
          message={selectedMessage}
          categorizedMessage={categorized.find((m) => m.id === selectedMessage.id) || selectedMessage}
          resolutions={resolutions}
          drafts={drafts}
          onToggle={resolveCategory}
          onDraft={draftFor}
          onClose={() => setSelectedMessage(null)}
        />
      )}
    </div>
  )
}

function SettingsView({ status, folders, settings, onConnect, onDisconnect, onSave }) {
  const [draftSelections, setDraftSelections] = useState({})
  const connected = new Set((status.accounts || []).map((a) => a.accountEmail))

  function accountFolders(account) {
    const found = folders.find((f) => f.accountEmail === account)
    const list = [...((found && found.folders) || [])]
    const ids = new Set(list.map((f) => f.id))
    if (!ids.has('inbox')) list.unshift({ id: 'inbox', name: 'Inbox', childFolderCount: 0, accountEmail: account })
    return list
  }

  function isChecked(account, folderId) {
    const sel = draftSelections[account] !== undefined ? draftSelections[account] : (Object.hasOwn(settings, account) ? settings[account] : ['inbox'])
    return sel.includes(folderId)
  }

  function toggle(account, folderId) {
    const current = draftSelections[account] !== undefined ? draftSelections[account] : (Object.hasOwn(settings, account) ? settings[account] : ['inbox'])
    const next = current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId]
    setDraftSelections((d) => ({ ...d, [account]: next }))
  }

  function save(account) {
    const sel = draftSelections[account] !== undefined ? draftSelections[account] : (Object.hasOwn(settings, account) ? settings[account] : ['inbox'])
    const selections = sel.map((folderId) => {
      const f = accountFolders(account).find((x) => x.id === folderId)
      return { folderId, folderName: f ? f.name : folderId, enabled: true }
    })
    onSave(account, selections)
  }

  return (
    <div className="mio-email-settings">
      <p className="mio-email-help">
        Connect the mailboxes that should feed the dashboard, then tick the inboxes and subfolders to include.
        Selected folders control which messages appear; none, one, or any combination is allowed.
      </p>
      {DEFAULT_MAILBOXES.map((account) => {
        const isConnected = connected.has(account)
        const missing = ((status.accounts || []).find((a) => a.accountEmail === account) || {}).missingScopes || []
        return (
          <div key={account} className="mio-email-mailbox">
            <div className="mio-email-mailbox-head">
              <span className="mio-email-mailbox-name">{account}</span>
              {isConnected ? (
                <>
                  <span className="mio-email-connected">Connected</span>
                  <button onClick={() => onDisconnect(account)}>Disconnect</button>
                </>
              ) : (
                <button onClick={() => onConnect(account)}>Connect</button>
              )}
            </div>
            {isConnected && missing.length > 0 && (
              <div className="mio-email-warn">
                Additional Outlook permissions needed: {missing.join(', ')}. <button onClick={() => onConnect(account)}>Reconnect</button>
              </div>
            )}
            {isConnected && (
              <div className="mio-email-folders">
                {accountFolders(account).map((folder) => (
                  <label key={folder.id} className="mio-email-folder">
                    <input type="checkbox" checked={isChecked(account, folder.id)} onChange={() => toggle(account, folder.id)} />
                    {folder.name}
                  </label>
                ))}
                <div className="mio-email-folder-actions">
                  <button onClick={() => save(account)}>Save folders</button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CategoryView({ category, items, resolutions, onOpen, onToggle, drafts, onDraft, onClassifyMore, pendingCount }) {
  return (
    <div className="mio-email-list">
      <div className="mio-email-list-head">
        <span>{CATEGORY_LABELS[category] || category} ({items.length})</span>
        {pendingCount > 0 && <button onClick={onClassifyMore}>Classify more…</button>}
      </div>
      {!items.length && <p className="mio-email-empty">No messages in this section.</p>}
      {items.map((message) => (
        <MessageRow key={message.id} message={message} resolutions={resolutions} onOpen={onOpen} onToggle={onToggle} drafts={drafts} onDraft={onDraft} />
      ))}
    </div>
  )
}

function ByMatterView({ groups, resolutions, onOpen, onToggle }) {
  if (!groups.length) return <p className="mio-email-empty">No messages to group by matter.</p>
  return (
    <div className="mio-email-bymatter">
      {groups.map((group) => (
        <div key={group.key} className="mio-email-matter">
          <h3 className="mio-email-matter-name">{group.name}</h3>
          {group.topics.map(({ topic, items }) => (
            <div key={topic} className="mio-email-topic">
              <h4 className="mio-email-topic-name">{topic} ({items.length})</h4>
              {items.map((message) => (
                <MessageRow key={`${message.id}:${topic}`} message={message} resolutions={resolutions} onOpen={onOpen} onToggle={onToggle} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function CategoryBadges({ message, resolutions, onToggle }) {
  return (
    <div className="mio-email-badges">
      {message.categories.map((category) => {
        const state = categoryStatesFor(message, [category], resolutions)[0]
        return (
          <label key={category} className={`mio-email-badge ${state.resolved ? 'resolved' : 'open'}`}>
            <input type="checkbox" checked={Boolean(state.resolved)} onChange={(e) => onToggle(message, category, e.target.checked)} />
            {labelFor(category)}
            {message.topics && message.topics[category] ? ` — ${message.topics[category]}` : ''}
          </label>
        )
      })}
    </div>
  )
}

function MessageRow({ message, resolutions, onOpen, onToggle, drafts, onDraft }) {
  return (
    <div className="mio-email-row">
      <button className="mio-email-row-main" onClick={() => onOpen(message)}>
        <span className="mio-email-subject">{message.subject || '(no subject)'}</span>
        <span className="mio-email-meta">{message.from || message.accountEmail} · {message.receivedDateTime || ''} · {message.accountEmail}</span>
        {message.bodyPreview && <span className="mio-email-preview">{message.bodyPreview}</span>}
      </button>
      <div className="mio-email-row-actions">
        <CategoryBadges message={message} resolutions={resolutions} onToggle={onToggle} />
        {onDraft && <button onClick={() => onDraft(message)}>Draft reply</button>}
      </div>
    </div>
  )
}

function MessageDetail({ message, categorizedMessage, resolutions, drafts, onToggle, onDraft, onClose }) {
  const categories = categorizedMessage.categories || []
  const draft = drafts[message.id]
  return (
    <div className="mio-email-detail">
      <div className="mio-email-detail-head">
        <h3>{message.subject || '(no subject)'}</h3>
        <button onClick={onClose}>Close</button>
      </div>
      <div className="mio-email-detail-meta">
        <div>From: {message.from || '—'}</div>
        <div>To: {(message.to || []).join(', ') || '—'}</div>
        <div>Received: {message.receivedDateTime || '—'}</div>
        <div>Mailbox: {message.accountEmail || '—'}</div>
      </div>
      <div className="mio-email-detail-cats">
        {!categories.length && <span className="mio-email-note">Not classified yet.</span>}
        {categories.map((category) => {
          const state = categoryStatesFor(message, [category], resolutions)[0]
          return (
            <label key={category} className={`mio-email-badge ${state.resolved ? 'resolved' : 'open'}`}>
              <input type="checkbox" checked={Boolean(state.resolved)} onChange={(e) => onToggle(message, category, e.target.checked)} />
              {labelFor(category)} — {state.resolved ? 'Resolved' : 'Pending'}
            </label>
          )
        })}
      </div>
      <div className="mio-email-detail-body">{message.body || message.bodyPreview || '(no body)'}</div>
      <div className="mio-email-detail-draft">
        <button onClick={() => onDraft(message)}>Suggest a draft reply</button>
        {draft && <pre className="mio-email-draft">{draft}</pre>}
        <p className="mio-email-note">Drafts are suggestions only — Mio never sends without an explicit action from you.</p>
      </div>
    </div>
  )
}




