import { useState } from 'react'
import { buildIssueText } from './appealsModel.js'
import { RESEARCH_DATE } from './appealsSections.js'

function BulletList({ items }) {
  return <ul>{items.map((text, index) => <li key={index}>{text}</li>)}</ul>
}

export default function AppealIssueDetail({ issue, perspective, saved, onSave, onBack }) {
  const [copyMessage, setCopyMessage] = useState('')
  async function copyIssue() {
    try {
      await navigator.clipboard.writeText(`${buildIssueText(issue, perspective)}\n\nMio DFPS / CPS Appeals · Research checked ${RESEARCH_DATE}`)
      setCopyMessage('Issue copied with authorities.')
    } catch { setCopyMessage('Copy is unavailable in this browser. Use Print issue to save a PDF.') }
  }
  return <article className="appeals-issue" aria-labelledby="appeal-issue-title">
    <div className="appeals-detail-actions appeals-no-print">
      <button type="button" className="appeals-text-button" onClick={onBack}>← Back to issues</button>
      <div>
        <button type="button" className={saved ? 'appeals-button is-saved' : 'appeals-button'} onClick={onSave} aria-pressed={saved}>{saved ? '★ Saved' : '☆ Save issue'}</button>
        <button type="button" className="appeals-button" onClick={copyIssue}>Copy issue</button>
        <button type="button" className="appeals-button" onClick={() => window.print()}>Print issue</button>
      </div>
    </div>
    {copyMessage && <p className="appeals-feedback appeals-no-print" role="status">{copyMessage}</p>}
    <p className="appeals-eyebrow">{issue.subcategory}</p>
    <h2 id="appeal-issue-title">{issue.title}</h2>
    <p className="appeals-issue-summary">{issue.summary}</p>
    <div className="appeals-tags">{issue.tags.map(tag => <span key={tag}>{tag}</span>)}</div>

    <section className="appeals-rule"><h3>Governing rule</h3><p>{issue.rule}</p></section>
    <div className={`appeals-arguments ${perspective === 'both' ? 'appeals-two-columns' : ''}`}>
      {perspective !== 'appellee' && <section className="appeals-argument appeals-for-appellant"><p className="appeals-eyebrow">Appellant</p><h3>Develop the issue</h3><BulletList items={issue.appellant} /></section>}
      {perspective !== 'appellant' && <section className="appeals-argument appeals-for-appellee"><p className="appeals-eyebrow">Appellee</p><h3>Defend the judgment</h3><BulletList items={issue.appellee} /></section>}
    </div>
    <div className="appeals-two-columns appeals-review-grid">
      <section><h3>Preservation</h3><p>{issue.preservation}</p></section>
      <section><h3>Standard of review</h3><p>{issue.review}</p></section>
    </div>
    <section className="appeals-record"><h3>Record to check</h3><BulletList items={issue.record} /></section>
    <section className="appeals-remedy"><h3>Potential relief</h3><p>{issue.remedy}</p></section>
    {!!issue.cautions.length && <section className="appeals-qualifications"><h3>Qualifications & version notes</h3><BulletList items={issue.cautions} /></section>}
    <section className="appeals-authorities" aria-label="Supporting authorities">
      <div className="appeals-section-heading"><h3>Supporting authorities</h3><span>{issue.authorities.length} sources</span></div>
      <p className="appeals-source-note">Each synopsis identifies the point supported. Open the opinion or provision to check its full context and later history.</p>
      <div className="appeals-source-list">
        {issue.authorities.map((source, index) => <div className="appeals-source" key={`${source.url}-${index}`}>
          <span className={`appeals-source-type appeals-source-type-${source.type}`}>{source.type === 'case' ? 'Case' : source.type === 'rule' ? 'Rule' : source.type === 'statute' ? 'Statute' : 'Guide'}</span>
          <div><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<span aria-hidden="true"> ↗</span></a>
            {source.citation !== source.label && <p className="appeals-citation">{source.citation}</p>}
            <p>{source.proposition}</p>
            <span className="appeals-print-url">{source.url}</span>
          </div>
        </div>)}
      </div>
    </section>
    <p className="appeals-research-note">Research checked {RESEARCH_DATE}. Apply the law governing the particular proceeding; these entries are issue-spotting research, not a finding about a client’s record.</p>
  </article>
}
