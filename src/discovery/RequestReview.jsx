import { ASSESSMENTS, DISCOVERY_TYPES } from './model.js'
import { strengthLabel } from './strategy.js'
import Authorities from './Authorities.jsx'

export default function RequestReview({ request, result, drafts = {}, onChange, disabled, privilegePlacement, profile }) {
  const label = `${DISCOVERY_TYPES.find(t=>t.id===request.type)?.label || request.type} ${request.number}`
  const assessment = result && ASSESSMENTS[result.assessment]
  function change(kind, patch) { onChange(kind,{...drafts[kind],...patch}) }
  function add(kind) { change(kind,{text:'',origin:'manual',selected:false,strength:null,strengthSource:'manual',strengthReason:''}) }
  return <article className="disco-card disco-request" data-request-id={request.id}>
    <header><div className="disco-request-number">{label}</div>{assessment?<span className={`disco-badge ${assessment.color}`}>{assessment.label}</span>:<span className="disco-badge slate">Not analyzed</span>}</header><div className="disco-request-text">{request.request}</div>
    {result&&<div className="disco-result"><p><strong>Assessment. </strong>{result.reason}</p><Authorities ids={result.authorities}/>{result.factsNeeded?.length>0&&<section><h3>Facts to confirm</h3><ul>{result.factsNeeded.map((f,i)=><li key={i}>{f}</li>)}</ul></section>}<p><strong>Response guidance. </strong>{result.responseGuidance}</p>{result.withholding&&<p className="disco-message"><strong>Privilege procedure. </strong>{result.withholding}</p>}{result.screenedOut?.map((text,i)=><p className="disco-message" key={i}>{text}</p>)}{result.appliedRuleIds?.length>0&&<p className="disco-note">Personal examples used: {result.appliedRuleIds.map(id=>profile.rules.find(r=>r.id===id)?.title || id).join('; ')}</p>}{!result.objection&&!result.privilege&&<div className="disco-proper">No objection or privilege proposed at this threshold. You can add your own below.</div>}</div>}
    <div className="disco-manual-actions">{['privilege','objection'].map(kind=>!drafts[kind]&&<button key={kind} type="button" disabled={disabled} onClick={()=>add(kind)}>+ Add {kind}</button>)}</div>
    {['privilege','objection'].map(kind=>{
      const item = drafts[kind]
      if (!item) return null
      const title = kind==='privilege'?'Privilege':'Objection'
      return <div className={`disco-draft disco-${kind}`} key={kind}><label><strong>{title.toUpperCase()}:</strong><span>{item.origin==='manual'?'Your editable language':'AI draft · review before use'}</span></label><textarea aria-label={`${title} for ${label}`} value={item.text} disabled={disabled} rows={5} maxLength={20000} onChange={e=>change(kind,{text:e.target.value,origin:'manual',strength:null,strengthSource:'manual',strengthReason:''})}/>
        <div className="disco-strength"><div><label htmlFor={`${kind}-strength-${request.id}`}>{title} strength</label><strong>{strengthLabel(item.strength)}{item.strength!=null?` · ${item.strength}/100`:''}</strong></div><input id={`${kind}-strength-${request.id}`} aria-label={`${title} strength for ${label}`} type="range" min="0" max="100" step="1" value={item.strength??0} disabled={disabled} onChange={e=>change(kind,{strength:Number(e.target.value),strengthSource:'manual',origin:'manual',strengthReason:''})}/><div className="disco-scale-labels"><span>Weak / needs facts</span><span>Very strong</span></div><p>{item.strengthSource==='ai'?'AI estimate':'Your assessment'} · qualitative strength, not a probability or guarantee.{item.strengthReason?` ${item.strengthReason}`:''}</p></div>
        {kind==='privilege'&&result?.privilegeAuthorities?.length>0&&<Authorities ids={result.privilegeAuthorities}/>}
        <label className="disco-include"><input type="checkbox" checked={Boolean(item.selected)} disabled={disabled} onChange={e=>change(kind,{selected:e.target.checked})}/>Include this {kind} {kind==='objection'?'between the request and response':privilegePlacement==='before_request'?'before the request':'after the request, before objections'} in Word</label>
        <button type="button" className="disco-remove" disabled={disabled} onClick={()=>onChange(kind,null)}>Remove {kind}</button>
      </div>
    })}
    {request.response&&<details className="disco-existing" open><summary>Existing response</summary><div className="disco-original-response">{request.response}</div></details>}
  </article>
}
