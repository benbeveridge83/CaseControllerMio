const text=v=>typeof v==='string'?v.trim():''
const first=(...v)=>v.map(text).find(Boolean)||''
export function submissionFields(p={}){return p.submission&&typeof p.submission==='object'?p.submission:p.data&&typeof p.data==='object'?p.data:p}
export function normalizeSubmission(p={}){
 const s=submissionFields(p),flag=p.spam??p._spam??p.is_spam??s.spam??s._spam??s.is_spam
 const status=first(p.status,p.submission_status,s.status,s._status).toLowerCase()
 return {form_id:first(p.form_id,p.formId,p.form?.id,p.form),provider_id:first(p.id,p.submission_id,p.submissionId,p.key,s.id,s._id),submitted_at:first(s._date,p.submitted_at,p.created_at,p.createdAt,p.timestamp,s.created_at),full_name:first(s.name,s.full_name,s.fullName,[text(s.first_name),text(s.last_name)].filter(Boolean).join(' ')),email:first(s.email,s._replyto,s.reply_to),phone:first(s.phone,s.telephone,s.mobile),county:first(s.county),family_type:first(s['family-type'],s.family_type,s.familyLawType,s.case_type),matter_kind:first(s.matter,s.matter_kind,s.matter_type,s.issue),message:first(s.message,s.details,s.description,s.comments),opposing_party:first(s['opposing-party'],s.opposing_party),deadline:first(s.deadline),preferred_contact:first(s['preferred-contact'],s.preferred_contact),is_spam:[true,1,'true','spam'].includes(typeof flag==='string'?flag.toLowerCase():flag)||['spam','blocked'].includes(status)}
}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v}
export function submissionIdentity(p,fallbackForm='unknown'){
 const n=normalizeSubmission(p),form=n.form_id||fallbackForm
 return n.provider_id?`${form}:${n.provider_id}`:JSON.stringify([form,n.submitted_at,canonical(submissionFields(p))])
}
export function normalizedLead(lead){const n=normalizeSubmission(lead.raw_submission||{});return {...lead,...Object.fromEntries(Object.entries(n).filter(([,v])=>v!==''&&v!==false))}}
export function leadDraft(lead,types=[]){
 const n=normalizedLead(lead),parts=(n.full_name||'').split(/\s+/),names=types.map(t=>t.name||t)
 const issue=n.family_type||n.matter_kind||'',lower=issue.toLowerCase()
 const suggested=names.find(t=>t.toLowerCase()===lower)||(/divorce/.test(lower)?names.find(t=>/divorce/i.test(t)): /custody|sapcr|modif|child/.test(lower)?names.find(t=>/sapcr|modif/i.test(t)): /injury/.test(lower)?names.find(t=>/injury/i.test(t)):null)||names.find(t=>/^other$/i.test(t))||''
 const extras=[['County',n.county],['Opposing party',n.opposing_party],['Deadline',n.deadline],['Preferred contact',n.preferred_contact]].filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`)
 return {first_name:parts.shift()||'',last_name:parts.join(' '),email:n.email||'',phone:n.phone||'',case_type:suggested,matter_name:[n.full_name,issue||suggested].filter(Boolean).join(' - '),matter_status:'PNC- Need to Consult',case_status:'Open',notes:['Website inquiry',...extras,n.message].filter(Boolean).join('\n'),existing_client_id:''}
}
