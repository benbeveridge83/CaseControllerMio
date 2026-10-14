import { useState } from 'react'
import { LEGAL_DATA, DISCOVERY_TYPES } from './model.js'
import { normalizePersonal } from './personal.js'
import Authorities from './Authorities.jsx'

const fields = [
  ['exampleRequest','Example discovery request','Paste a request this rule should recognize.'],
  ['exampleObjection','Preferred objection response','Your preferred objection language.'],
  ['examplePrivilege','Preferred privilege assertion','Optional privilege language, separate from objections.'],
  ['recognitionGuidance','How to identify this request','Phrases, scope, distinctions, facts to check, and situations where this rule does not apply.'],
  ['responseGuidance','Instructions for the response','Tone, wording, qualifications, and how to respond to the unobjectionable part.']
]
export default function PersonalRules({ profile, initialDraft = profile, initialPending = false, type, disabled, loadError, onSave }) {
  const [draft,setDraft] = useState(initialDraft), [active,setActive] = useState(initialDraft.rules[0]?.id || '')
  const [needsAcknowledgement,setNeedsAcknowledgement] = useState(initialPending)
  const [saving,setSaving] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('')
  const rule = draft.rules.find(r => r.id === active), locked = disabled || saving || Boolean(loadError)
  const dirty = needsAcknowledgement || JSON.stringify(draft) !== JSON.stringify(profile)
  function change(next) { setDraft(next); setNotice(''); setError('') }
  function edit(patch) { change({...draft,rules:draft.rules.map(r => r.id === active ? {...r,...patch} : r)}) }
  function add() {
    const next = {id:crypto.randomUUID(),title:'New example',type,enabled:true,exampleRequest:'',exampleObjection:'',examplePrivilege:'',recognitionGuidance:'',responseGuidance:'',authorities:[]}
    change({...draft,rules:[...draft.rules,next]}); setActive(next.id)
  }
  async function save() {
    setSaving(true); setError(''); setNotice('')
    try { const normalized = normalizePersonal(draft); await onSave(normalized); setDraft(normalized); setNeedsAcknowledgement(false); setNotice('Saved to your account. Enabled guidance will be used in new analysis and chat.') }
    catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }
  return <section className="disco-personal">
    <div className="disco-section-heading"><div><h2>My rules & examples</h2><p>Teach Mio how you recognize requests and how you prefer to respond.</p></div><span className="disco-count">{draft.rules.filter(r=>r.enabled).length} enabled</span></div>
    {loadError && <div className="disco-error" role="alert">{loadError}</div>}
    {needsAcknowledgement&&<div className="disco-message">A previous save has not been confirmed. Your pending edits are recovered below; AI uses your last confirmed saved guidance until you save successfully.</div>}
    <div className="disco-card"><label className="disco-label" htmlFor="disco-style">General objection and privilege style</label><textarea id="disco-style" value={draft.styleInstructions} onChange={e=>change({...draft,styleInstructions:e.target.value})} rows={3} maxLength={6000} disabled={locked} placeholder="E.g., use short paragraphs; identify the precise scope resisted; avoid subject-to reservations; distinguish privilege from ordinary objections."/><p className="disco-note">Saved guidance shapes analysis and chat. Examples are drafting preferences; the AI still checks the supplied facts and authority.</p></div>
    <div className="disco-personal-layout"><div className="disco-rule-list"><button type="button" className="disco-primary" disabled={locked || draft.rules.length>=40} onClick={add}>Add rule or example</button>{draft.rules.map(r=><button type="button" key={r.id} aria-pressed={active===r.id} className={active===r.id?'active':''} onClick={()=>setActive(r.id)}><strong>{r.title || 'Untitled example'}</strong><small>{r.type==='all'?'All discovery':DISCOVERY_TYPES.find(t=>t.id===r.type)?.label} · {r.enabled?'Enabled':'Disabled'}</small></button>)}{!draft.rules.length&&<p className="disco-note">Add your first example, then save it below.</p>}</div>
    {rule?<div className="disco-card disco-rule-editor"><div className="disco-two"><label>Rule title<input type="text" aria-label="Rule title" maxLength={160} value={rule.title} disabled={locked} onChange={e=>edit({title:e.target.value})}/></label><label>Applies to<select aria-label="Rule discovery type" value={rule.type} disabled={locked} onChange={e=>edit({type:e.target.value})}><option value="all">All discovery</option>{DISCOVERY_TYPES.map(t=><option key={t.id} value={t.id}>{t.label} — {t.title}</option>)}</select></label></div><label className="disco-include"><input type="checkbox" checked={rule.enabled} disabled={locked} onChange={e=>edit({enabled:e.target.checked})}/>Use this rule in AI analysis and chat</label>
      {fields.map(([key,label,placeholder])=><label key={key}>{label}<textarea aria-label={label} value={rule[key]} onChange={e=>edit({[key]:e.target.value})} rows={key==='recognitionGuidance'?4:3} maxLength={5000} disabled={locked} placeholder={placeholder}/></label>)}
      <details><summary>Link supporting authorities (optional)</summary><p className="disco-note">Choose relevant sources. Linking a source does not establish that your example is legally valid.</p><div className="disco-authority-picker">{LEGAL_DATA.sources.map(s=><label key={s.id}><input type="checkbox" disabled={locked || (!rule.authorities.includes(s.id) && rule.authorities.length>=12)} checked={rule.authorities.includes(s.id)} onChange={e=>edit({authorities:e.target.checked?[...rule.authorities,s.id]:rule.authorities.filter(id=>id!==s.id)})}/>{s.label}</label>)}</div></details><Authorities ids={rule.authorities}/>
      <button type="button" disabled={locked} className="disco-remove" onClick={()=>{change({...draft,rules:draft.rules.filter(r=>r.id!==active)});setActive('')}}>Remove this example</button>
    </div>:<div className="disco-card"><h3>A reusable example has three parts</h3><p>The request to recognize, your preferred response, and the facts or rules that determine when that response fits.</p><p>Use recognition guidance to distinguish a request for the general bases of a contention from a demand to marshal every piece of evidence, for example.</p></div>}</div>
    <div className="disco-save-bar"><span>{dirty?'Unsaved changes':'Saved guidance ready'} · {draft.rules.length} / 40 examples</span><button type="button" className="disco-primary" disabled={locked || !dirty} onClick={save}>{saving?'Saving…':'Save my rules & style'}</button></div>
    {error&&<div className="disco-error" role="alert">{error} Your edits remain in the editor.</div>}{notice&&<div className="disco-message" role="status">{notice}</div>}
  </section>
}
