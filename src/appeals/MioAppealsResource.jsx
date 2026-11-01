import { useEffect, useMemo, useRef, useState } from 'react'
import { APPEAL_ISSUES, APPEAL_SECTIONS, APPEAL_GROUPS, RESEARCH_DATE } from './appealsCatalog.js'
import { filterAppealIssues, parseSavedIssueIds } from './appealsModel.js'
import AppealIssueDetail from './AppealIssueDetail.jsx'
import './appeals.css'

const validIds = APPEAL_ISSUES.map(issue => issue.id)
const sectionCounts = Object.fromEntries(APPEAL_SECTIONS.map(section => [section.id, APPEAL_ISSUES.filter(issue => issue.category === section.id).length]))
const distinctCases = new Set(APPEAL_ISSUES.flatMap(issue => issue.authorities.filter(source => source.type === 'case').map(source => source.url))).size

function initialIssue() {
  if (typeof window === 'undefined') return null
  const id = new URLSearchParams(window.location.hash.split('?')[1] || '').get('issue')
  return APPEAL_ISSUES.find(issue => issue.id === id) || null
}

function VersionGuide() {
  return <details className="appeals-version-guide appeals-no-print">
    <summary><span className="appeals-guide-badge">Start here</span><strong>Which version of the law governs?</strong><span>2025 amendments · 2026 rules and decisions</span></summary>
    <div>
      <p><strong>Ground letters changed.</strong> H.B. 116 removed former §161.001(b)(1)(O) (service-plan noncompliance) and redesignated former (P)–(V) as (O)–(U). It reaches suits pending in a trial court on September 1, 2025, as well as later-filed suits. A filing date alone does not resolve the transition. <a href="https://capitol.texas.gov/tlodocs/89R/billtext/html/HB00116F.htm" target="_blank" rel="noopener noreferrer">H.B. 116, §§2–4 ↗</a></p>
      <p><strong>Other amendments have different triggers.</strong> H.B. 1151’s medical-treatment provisions apply to DFPS suits filed on or after September 1, 2025. Check the applicable version of §161.001(f)–(g) for reunification efforts, continuing danger, and specific written findings. <a href="https://capitol.texas.gov/tlodocs/89R/billtext/html/HB01151F.htm" target="_blank" rel="noopener noreferrer">H.B. 1151 ↗</a> · <a href="https://tcss.legis.texas.gov/resources/FA/htm/FA.161.htm" target="_blank" rel="noopener noreferrer">Chapter 161 ↗</a></p>
      <p><strong>Research date: {RESEARCH_DATE}.</strong> Entries use the current published rules and identify former-law cases. Read the linked sources and check later history before relying on a proposition. Where no directly on-point decision was verified, the entry says so.</p>
    </div>
  </details>
}

export default function MioAppealsResource({ userId = '' }) {
  const [selectedId, setSelectedId] = useState(() => initialIssue()?.id || '')
  const [category, setCategory] = useState(() => initialIssue()?.category || 'all')
  const [query, setQuery] = useState('')
  const [perspective, setPerspective] = useState('both')
  const [savedOnly, setSavedOnly] = useState(false)
  const storageKey = userId ? `mio-appeals-saved:${userId}` : ''
  const [savedIds, setSavedIds] = useState(() => {
    try { return storageKey ? parseSavedIssueIds(localStorage.getItem(storageKey), validIds) : [] } catch { return [] }
  })
  const [storageMessage, setStorageMessage] = useState('')
  const contentRef = useRef(null)

  useEffect(() => {
    document.body.classList.add('mio-appeals-active')
    function syncNavigation() {
      if (window.location.hash.replace(/^#\/?/, '').split('?')[0] !== 'dfps_appeals') return
      const issue = initialIssue()
      setSelectedId(issue?.id || '')
      setCategory(issue?.category || 'all')
      setQuery('')
      setSavedOnly(false)
    }
    window.addEventListener('hashchange', syncNavigation)
    window.addEventListener('mio-appeals-home', syncNavigation)
    return () => {
      document.body.classList.remove('mio-appeals-active')
      window.removeEventListener('hashchange', syncNavigation)
      window.removeEventListener('mio-appeals-home', syncNavigation)
    }
  }, [])

  const selected = APPEAL_ISSUES.find(issue => issue.id === selectedId)
  const activeSection = APPEAL_SECTIONS.find(section => section.id === category)
  const results = useMemo(() => filterAppealIssues(APPEAL_ISSUES, { query, category, savedOnly, savedIds }), [query, category, savedOnly, savedIds])
  const overview = category === 'all' && !query.trim() && !savedOnly && !selected

  function moveFocus() {
    requestAnimationFrame(() => {
      contentRef.current?.focus({ preventScroll: true })
      contentRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
    })
  }
  function selectSection(id) {
    setCategory(id); setSelectedId(''); setQuery(''); setSavedOnly(false)
    window.history.replaceState(null, '', '#dfps_appeals')
    moveFocus()
  }
  function openIssue(issue) {
    setSelectedId(issue.id)
    window.history.replaceState(null, '', `#dfps_appeals?issue=${encodeURIComponent(issue.id)}`)
    moveFocus()
  }
  function closeIssue() {
    setSelectedId('')
    window.history.replaceState(null, '', '#dfps_appeals')
    moveFocus()
  }
  function showSaved() {
    setCategory('all'); setSelectedId(''); setQuery(''); setSavedOnly(true)
    window.history.replaceState(null, '', '#dfps_appeals')
    moveFocus()
  }
  function changeSearch(value) {
    setQuery(value); setSelectedId('')
    window.history.replaceState(null, '', '#dfps_appeals')
  }
  function toggleSave(id) {
    const next = savedIds.includes(id) ? savedIds.filter(saved => saved !== id) : [...savedIds, id]
    setSavedIds(next)
    try {
      if (!storageKey) { setStorageMessage('Saved for this visit. Sign in to retain your saved issues on this browser.'); return }
      localStorage.setItem(storageKey, JSON.stringify(next)); setStorageMessage('')
    } catch { setStorageMessage('Browser storage is unavailable. Your saved issues will last for this visit only.') }
  }
  function quickSearch(value) { setCategory('all'); setSavedOnly(false); changeSearch(value); moveFocus() }

  return <div className="mio-appeals">
    <header className="appeals-header appeals-no-print">
      <div><p className="appeals-eyebrow">Mio research desk / Texas parental termination</p><h1>DFPS / CPS Appeals</h1><p className="appeals-intro">Find the issue. Check preservation. Build the argument—or the response.</p></div>
      <div className="appeals-library-stats"><span><strong>{APPEAL_ISSUES.length}</strong> issue guides</span><span><strong>{APPEAL_SECTIONS.length}</strong> sections</span><span><strong>{distinctCases}</strong> case sources</span></div>
    </header>
    <VersionGuide />
    <div className="appeals-toolbar appeals-no-print">
      <div className="appeals-search"><label htmlFor="appeals-search">Search issues and authorities</label><div><span aria-hidden="true">⌕</span><input id="appeals-search" type="search" value={query} onChange={event => changeSearch(event.target.value)} placeholder="Try: missing findings, hearsay, N.G., 161.001…" /></div></div>
      <fieldset className="appeals-perspective"><legend>Read from this perspective</legend><div>{[['both', 'Both sides'], ['appellant', 'Appellant'], ['appellee', 'Appellee']].map(([value, label]) => <button key={value} type="button" aria-pressed={perspective === value} className={perspective === value ? 'is-active' : ''} onClick={() => setPerspective(value)}>{label}</button>)}</div></fieldset>
    </div>
    {storageMessage && <p className="appeals-feedback appeals-no-print" role="status">{storageMessage}</p>}
    <div className="appeals-mobile-nav appeals-no-print"><label htmlFor="appeals-section-select">Section</label><select id="appeals-section-select" value={category} onChange={event => selectSection(event.target.value)}><option value="all">All sections</option>{APPEAL_SECTIONS.map(section => <option key={section.id} value={section.id}>{section.label} ({sectionCounts[section.id]})</option>)}</select><button type="button" className="appeals-button" onClick={showSaved}>★ Saved ({savedIds.length})</button></div>

    <div className="appeals-layout">
      <nav className="appeals-tree appeals-no-print" aria-label="Appeal sections">
        <button className={`appeals-tree-home ${category === 'all' && !savedOnly ? 'is-active' : ''}`} type="button" onClick={() => selectSection('all')}>All appeal issues <span>{APPEAL_ISSUES.length}</span></button>
        <button className={`appeals-tree-home ${savedOnly ? 'is-active' : ''}`} type="button" onClick={showSaved}>★ Saved issues <span>{savedIds.length}</span></button>
        {APPEAL_GROUPS.map(group => <div className="appeals-tree-group" key={group.id}><p><span>{group.number}</span> {group.label}</p>{APPEAL_SECTIONS.filter(section => section.group === group.id).map(section => <button type="button" key={section.id} className={category === section.id ? 'is-active' : ''} aria-current={category === section.id ? 'page' : undefined} onClick={() => selectSection(section.id)}><span>{section.label}</span><small>{sectionCounts[section.id]}</small></button>)}</div>)}
        <p className="appeals-tree-date">Research checked<br />{RESEARCH_DATE}</p>
      </nav>

      <div className="appeals-content" ref={contentRef} tabIndex={-1}>
        {selected ? <><p className="appeals-breadcrumb appeals-no-print">{APPEAL_SECTIONS.find(section => section.id === selected.category)?.label} <span>/</span> {selected.subcategory}</p><AppealIssueDetail key={selected.id} issue={selected} perspective={perspective} saved={savedIds.includes(selected.id)} onSave={() => toggleSave(selected.id)} onBack={closeIssue} /></> : overview ? <>
          <div className="appeals-overview-intro"><p className="appeals-eyebrow">Explore the issue map</p><h2>Work through the appeal, one question at a time.</h2><p>Open a section to drill down into individual issues. Each guide connects the legal rule to preservation, the record, both parties’ arguments, potential relief, and supporting authority.</p></div>
          <div className="appeals-quick-start appeals-no-print"><span>Jump into</span>{['notice of appeal', 'specific findings', 'endangerment', 'best interest', 'ineffective assistance'].map(text => <button type="button" key={text} onClick={() => quickSearch(text)}>{text} ↗</button>)}</div>
          {APPEAL_GROUPS.map(group => <section className="appeals-overview-group" key={group.id}><div className="appeals-group-title"><span>{group.number}</span><div><h3>{group.label}</h3><p>{group.description}</p></div></div><div className="appeals-section-cards">{APPEAL_SECTIONS.filter(section => section.group === group.id).map(section => <button type="button" className="appeals-section-card" key={section.id} onClick={() => selectSection(section.id)}><span className="appeals-card-top"><span>{sectionCounts[section.id]} issues</span><span aria-hidden="true">↗</span></span><strong>{section.label}</strong><span>{section.description}</span></button>)}</div></section>)}
          <p className="appeals-research-note">This is a detailed issue map, not a claim that every possible issue has been exhausted. Authorities and version notes travel with each entry. Saved issues are personal browser bookmarks, not a matter checklist.</p>
        </> : <>
          <div className="appeals-results-heading"><div><p className="appeals-eyebrow">{savedOnly ? 'Your research shortlist' : activeSection ? APPEAL_GROUPS.find(group => group.id === activeSection.group)?.label : 'Across the resource'}</p><h2>{savedOnly ? 'Saved issues' : activeSection?.label || 'Search results'}</h2>{activeSection && <p>{activeSection.description}</p>}</div><span className="appeals-result-count" role="status">{results.length} {results.length === 1 ? 'issue' : 'issues'}</span></div>
          {savedOnly && <p className="appeals-source-note">Saved for your account on this browser. These bookmarks are not tied to a particular matter.</p>}
          <div className="appeals-results-controls appeals-no-print"><label><input type="checkbox" checked={savedOnly} onChange={event => { setSavedOnly(event.target.checked); setSelectedId('') }} /> Saved issues only</label>{(query || category !== 'all' || savedOnly) && <button type="button" className="appeals-text-button" onClick={() => selectSection('all')}>Clear filters</button>}</div>
          {!results.length ? <div className="appeals-empty"><h3>No issues match these filters.</h3><p>{savedOnly ? 'Save an issue using its star, or clear the saved-only filter.' : 'Try fewer words, a case name, or another section.'}</p><button type="button" className="appeals-button" onClick={() => selectSection('all')}>Browse all sections</button></div> : APPEAL_SECTIONS.filter(section => results.some(issue => issue.category === section.id)).map(section => <section className="appeals-results-section" key={section.id}>{category === 'all' && <h3 className="appeals-result-section-title">{section.label}</h3>}{[...new Set(results.filter(issue => issue.category === section.id).map(issue => issue.subcategory))].map(subcategory => <div className="appeals-subsection" key={subcategory}><h4>{subcategory}</h4>{results.filter(issue => issue.category === section.id && issue.subcategory === subcategory).map(issue => <div className="appeals-issue-row" key={issue.id}><button type="button" className="appeals-issue-open" onClick={() => openIssue(issue)}><span className="appeals-issue-row-title">{issue.title}<span aria-hidden="true">→</span></span><span className="appeals-row-summary">{issue.summary}</span><span className="appeals-row-meta">{issue.authorities.length} authorities · preservation · {perspective === 'both' ? 'both sides' : perspective}</span></button><button type="button" className={`appeals-save-small ${savedIds.includes(issue.id) ? 'is-saved' : ''}`} onClick={() => toggleSave(issue.id)} aria-label={`${savedIds.includes(issue.id) ? 'Unsave' : 'Save'} ${issue.title}`} aria-pressed={savedIds.includes(issue.id)}>{savedIds.includes(issue.id) ? '★' : '☆'}</button></div>)}</div>)}</section>)}
        </>}
      </div>
    </div>
  </div>
}
