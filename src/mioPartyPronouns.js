// Party-linked template pronouns. No storage, network calls, or name-based sex inference.
import {activeFileBindings, locateBinding} from './mioTemplateFields.js'
export const PRONOUN_SCHEMA = 'party-pronouns-v302'
export const PRONOUN_PARTIES = [
  ['client','Client'], ['opposing_party','Opposing party'], ['petitioner','Petitioner'],
  ['respondent','Respondent'], ['mother','Mother'], ['father','Father'],
  ['obligor','Obligor'], ['obligee','Obligee'],
  ...Array.from({length:6},(_,i)=>['child_'+(i+1),'Child '+(i+1)+' (matter list order)'])
]
export const PRONOUN_ROLES = [
  ['subject','Subject: he / she / they'], ['object','Object: him / her / them'],
  ['possessive_adjective','Before a noun: his / her / their'],
  ['possessive_pronoun','Standalone possessive: his / hers / theirs'],
  ['reflexive','Reflexive: himself / herself / themselves'], ['title','Title: Mr. / Ms. / Mx.']
]
const SETS = {
  male:{subject:'he',object:'him',possessive_adjective:'his',possessive_pronoun:'his',reflexive:'himself',title:'Mr.'},
  female:{subject:'she',object:'her',possessive_adjective:'her',possessive_pronoun:'hers',reflexive:'herself',title:'Ms.'},
  neutral:{subject:'they',object:'them',possessive_adjective:'their',possessive_pronoun:'theirs',reflexive:'themselves',title:'Mx.'}
}
const clean = v => String(v ?? '').trim()
const normalized = v => clean(v).toLowerCase().replace(/\s+/g,' ')
export const partyLabel = key => PRONOUN_PARTIES.find(([id])=>id===key)?.[1] || clean(key).replace(/^role:/,'') || 'Unassigned party'
export function normalizePronounSet(value) {
  const v=normalized(value).replace(/\s*\/\s*/g,'/')
  if (['female','f','woman','girl','she','she/her','she/her/hers'].includes(v)) return 'female'
  if (['male','m','man','boy','he','he/him','he/him/his'].includes(v)) return 'male'
  if (['neutral','they','they/them','they/them/theirs'].includes(v)) return 'neutral'
  return ''
}
export function partyPronounSet(party={}) {
  return normalizePronounSet(party.pronoun_set ?? party.pronouns) || normalizePronounSet(party.sex ?? party.gender)
}
export function suggestGrammar(word, following='') {
  const token=normalized(word).replace(/\.$/,'')
  const simple={he:'subject',she:'subject',they:'subject',him:'object',them:'object',hers:'possessive_pronoun',theirs:'possessive_pronoun',their:'possessive_adjective',himself:'reflexive',herself:'reflexive',themselves:'reflexive',mr:'title',ms:'title',mx:'title'}
  if(simple[token])return {role:simple[token],ambiguous:false}
  // "her" and "his" need a grammatical-role check, even when a nearby noun suggests a choice.
  if(token==='his'||token==='her')return {role:/^\s+[\p{L}]/u.test(following)?'possessive_adjective':token==='her'?'object':'possessive_pronoun',ambiguous:true}
  return {role:'',ambiguous:false}
}
export function partyFromIdentifier(binding={}) {
  if(binding.kind!=='field'||binding.is_active===false)return ''
  const source=String(binding.data_source||'')
  const match=source.match(/^matter\.(client|petitioner|respondent|opposing_party|obligor|obligee|mother|father|child_\d+)_name$/)
  return match?.[1] || ''
}
export function suggestPriorParty(selection, template, file, document) {
  if(!selection)return null
  const candidates=[]
  for(const b of activeFileBindings(template,file)){
    const party=partyFromIdentifier(b);if(!party)continue
    const loc=locateBinding(b,document)
    // For a replace-all name binding, locate every real occurrence, not its first saved anchor.
    const locations=b.replace_all ? (document?.paragraphs||[]).flatMap((p,i)=>{
      const text=String(p.text||''),source=String(b.source_text||'');if(!source)return []
      const out=[];let at=text.indexOf(source)
      while(at>=0){out.push({paragraph_end:Number(p.index??i),end_offset:at+source.length});at=text.indexOf(source,at+source.length)}return out
    }) : loc?[loc]:[]
    for(const pos of locations)if(pos.paragraph_end<selection.paragraph_start||(pos.paragraph_end===selection.paragraph_start&&pos.end_offset<=selection.start_offset))candidates.push({party,binding_id:b.id,paragraph:pos.paragraph_end,offset:pos.end_offset})
  }
  candidates.sort((a,b)=>b.paragraph-a.paragraph||b.offset-a.offset)
  return candidates[0]||null
}
const fullName=p=>clean(typeof p==='string'?p:p?.name||[p?.first_name,p?.middle_name,p?.last_name].filter(Boolean).join(' '))
export const isChildParty=p=>/^(?:(?:subject|minor)\s+)?(?:child|children|minor|son|daughter)(?:\s*\d+)?$/i.test(clean(p?.role||p?.party_type))
export function collectMatterChildren(matter={},extra={}) {
  const direct=Array.isArray(matter.children)?matter.children:[]
  const litigation=(extra.litigation_parties||[]).filter(isChildParty)
  const facts=extra.drafting_facts?.children_status==='yes'&&Array.isArray(extra.drafting_facts.children)?extra.drafting_facts.children:[]
  const out=[]
  for(const source of [...direct,...facts,...litigation]){
    const item=typeof source==='string'?{name:source}:{...source}
    item.name=fullName(item);item.date_of_birth=item.date_of_birth||item.dob||item.birth_date||''
    if(!item.name&&!item.id&&!isChildParty(item))continue
    const same=out.findIndex(p=>(p.id&&item.id&&p.id===item.id)||(item.name&&normalized(p.name)===normalized(item.name)&&(!p.date_of_birth||!item.date_of_birth||p.date_of_birth===item.date_of_birth)))
    if(same<0)out.push(item)
    else out[same]={...out[same],...Object.fromEntries(Object.entries(item).filter(([,v])=>v!==''&&v!=null))}
  }
  return out
}
export function matterPronounParties(matter={},extra={},client={}) {
  const stored=(extra.litigation_parties||[]).map(p=>({...p,name:fullName(p)}))
  const out=[...stored]
  if(!out.some(p=>p.source==='client'))out.unshift({id:'lit-party-client-'+(client.id||matter.id||'draft'),source:'client',role:matter.client_role||matter.client_status||'Client',name:fullName(client)||matter.client_name||'',sex:extra.client_sex??client.sex??client.gender??'',pronoun_set:extra.client_pronoun_set??client.pronoun_set??client.pronouns??''})
  for(const [i,p] of (extra.opposing_parties||[]).entries()){
    if(!p.name&&!p.email&&!p.party_type)continue
    if(out.some(s=>(p.id&&s.id===p.id)||(p.name&&normalized(s.name)===normalized(p.name))))continue
    out.push({...p,id:p.id||`lit-party-opposing-${matter.id||'draft'}-${i+1}`,name:fullName(p),source:'opposing',role:p.role||p.party_type||'Opposing Party'})
  }
  for(const [i,c] of collectMatterChildren(matter,extra).entries())if(!out.some(p=>(c.id&&p.id===c.id)||(c.name&&normalized(p.name)===normalized(c.name))))out.push({...c,id:c.id||`lit-party-child-${matter.id||'draft'}-${i+1}`,source:'other',role:'Child'})
  return out.map(p=>{
    if(p.source!=='client')return p
    return {...client,...p,sex:p.sex??extra.client_sex??client.sex??client.gender??'',pronoun_set:p.pronoun_set??extra.client_pronoun_set??client.pronoun_set??client.pronouns??''}
  })
}
export function resolvePronounParty(key,parties=[]) {
  if(!key)return {error:'Choose the party for this pronoun.'}
  let matches=[]
  if(key==='client')matches=parties.filter(p=>p.source==='client')
  else if(key==='opposing_party')matches=parties.filter(p=>p.source==='opposing')
  else if(/^child_\d+$/.test(key))matches=parties.filter(isChildParty).slice(Number(key.slice(6))-1,Number(key.slice(6)))
  else {
    const role=normalized(key.replace(/^role:/,'')),aliases={petitioner:['petitioner','movant','applicant'],respondent:['respondent'],mother:['mother','mom'],father:['father','dad']}
    matches=parties.filter(p=>(aliases[role]||[role]).some(r=>normalized(p.role||p.party_type).split(/\s*(?:\/|,|;|\|)\s*/).includes(r)))
  }
  if(matches.length!==1)return {error:matches.length?`More than one matter party matches ${partyLabel(key)}. Use a unique party role.`:`No matter party is assigned to ${partyLabel(key)}.`}
  return {party:matches[0]}
}
export function resolveLinkedPronoun(binding,data={}) {
  const key=binding.linked_party||''
  const resolved=resolvePronounParty(key,data._pronoun_parties||[])
  if(resolved.error)return {value:`[Missing: ${resolved.error}]`,error:resolved.error}
  const role=binding.grammar_role||''
  if(!PRONOUN_ROLES.some(([id])=>id===role))return {value:'[Missing: pronoun grammatical role]',error:'Choose this pronoun\'s grammatical role.'}
  const explicit=normalizePronounSet(binding.pronoun_override)||normalizePronounSet(data.pronoun_overrides?.[key])
  const set=explicit||partyPronounSet(resolved.party)
  if(!set){const error=`Record sex or a pronoun preference for ${resolved.party.name||partyLabel(key)} in matter information.`;return {value:`[Missing: ${error}]`,error}}
  let value=SETS[set][role]
  const source=String(binding.source_text||'')
  if(source===source.toUpperCase()&&/[A-Z]/.test(source))value=value.toUpperCase()
  else if(/^[A-Z]/.test(source))value=value[0].toUpperCase()+value.slice(1)
  return {value,set,party:resolved.party,source:explicit?'draft override':'matter party'}
}
export function preparePronounBinding(raw,template,file,document) {
  if(raw.kind!=='pronoun')return raw
  const previous=(template?.bindings||[]).find(b=>b.id===raw.id)
  const loc=raw.paragraph_start==null?null:raw
  const guess=suggestPriorParty(loc,template,file,document)
  const paragraph=document?.paragraphs?.find(p=>Number(p.index)===Number(raw.paragraph_start))
  const grammar=suggestGrammar(raw.source_text,String(paragraph?.text||'').slice(Number(raw.end_offset||0)))
  const deliberate=raw.party_link_mode==='manual'||previous||raw.pronoun_schema===PRONOUN_SCHEMA
  const party=deliberate?raw.linked_party||'':guess?.party||''
  const role=raw.grammar_role||grammar.role
  return {...raw,linked_party:party,grammar_role:role,replace_all:false,required:false,data_source:'manual',
    field_key:party?party.replace(/[^a-z0-9]/gi,'_')+'_pronouns':raw.field_key||'unassigned_pronouns',
    label:partyLabel(party)+' '+(PRONOUN_ROLES.find(([id])=>id===role)?.[1].split(':')[0]||'')+' pronoun',
    party_link_mode:deliberate?raw.party_link_mode||'manual':'suggested',suggested_by_binding:deliberate?raw.suggested_by_binding||'':guess?.binding_id||'',pronoun_schema:PRONOUN_SCHEMA}
}
export function linkedPronounIssues(template,data,files) {
  const selected=files?new Set(files.flatMap(f=>typeof f==='string'?[f]:[f.id,f.name].filter(Boolean))):null
  const issues=[]
  for(const b of template?.bindings||[]){
    if(b.is_active===false||b.kind!=='pronoun'||(selected&&b.file_id&&!selected.has(b.file_id)))continue
    const {error}=resolveLinkedPronoun(b,data);if(error)issues.push(error)
  }
  return [...new Set(issues)].map(message=>({level:'error',message}))
}
