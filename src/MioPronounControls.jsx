import React from 'react'
import {PRONOUN_PARTIES,PRONOUN_ROLES,partyLabel,partyPronounSet,resolveLinkedPronoun,suggestGrammar,normalizePronounSet} from './mioPartyPronouns.js'
const field={display:'grid',gap:4,margin:'6px 0'}
export function PronounControls({value,onChange,sourceText=''}) {
 const known=PRONOUN_PARTIES.some(([key])=>key===value.linked_party)
 const custom=!!value.linked_party&&!known
 const grammar=suggestGrammar(sourceText||value.source_text)
 return <section aria-label="Party-linked pronoun" style={{padding:9,border:'1px solid #a78bfa',borderRadius:7,background:'#faf5ff'}}>
  <strong>Pronoun field</strong>
  <label style={field}>Linked party<select aria-label="Pronoun linked party" value={custom?'__role':value.linked_party||''} onChange={e=>onChange({linked_party:e.target.value==='__role'?'role:':e.target.value,party_link_mode:'manual'})}><option value="">Choose a party...</option>{PRONOUN_PARTIES.map(([key,label])=><option key={key} value={key}>{label}</option>)}<option value="__role">Another exact matter-party role</option></select></label>
  {custom&&<label style={field}>Exact role in matter information<input aria-label="Pronoun custom party role" value={value.linked_party.replace(/^role:/,'')} onChange={e=>onChange({linked_party:'role:'+e.target.value,party_link_mode:'manual'})} placeholder="Example: Intervenor" /></label>}
  <label style={field}>Grammatical role<select aria-label="Pronoun grammatical role" value={value.grammar_role||''} onChange={e=>onChange({grammar_role:e.target.value})}><option value="">Choose grammatical role...</option>{PRONOUN_ROLES.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  {grammar.ambiguous&&<p style={{fontSize:12}}>Check the grammar: "her" can mean an object ("notify her") or possession ("her address"); "his" can precede a noun or stand alone.</p>}
  <p style={{fontSize:12,marginBottom:0}}>{value.party_link_mode==='suggested'&&value.linked_party?'Suggested from the preceding party-name field. Change it here when it refers to someone else.':!value.linked_party?'No preceding party-name field was found. Choose the party explicitly.':'This party link stays fixed until you change it.'} Mio uses that party's recorded sex or pronoun preference. Only this occurrence is replaced.</p>
 </section>
}
export function PartySexFields({party,onChange}) {
 const sex=normalizePronounSet(party.sex??party.gender)
 return <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
  <label style={field}>Sex<select aria-label={'Sex for '+(party.name||party.role||'party')} value={['male','female'].includes(sex)?sex:''} onChange={e=>onChange({sex:e.target.value})}><option value="">Not specified</option><option value="female">Female</option><option value="male">Male</option></select></label>
  <label style={field}>Pronoun preference<select aria-label={'Pronoun preference for '+(party.name||party.role||'party')} value={normalizePronounSet(party.pronoun_set??party.pronouns)} onChange={e=>onChange({pronoun_set:e.target.value})}><option value="">Automatic from sex</option><option value="female">She / her / hers</option><option value="male">He / him / his</option><option value="neutral">They / them / theirs</option></select></label>
  <span style={{alignSelf:'center',fontSize:12}}>{({female:'she / her',male:'he / him',neutral:'they / them'})[partyPronounSet(party)]||'Pronouns need information'}</span>
 </div>
}
export function MatterPronounEditor({parties,onChange}) {
 return <details style={{margin:'12px 0',padding:10,border:'1px solid #cbd5e1',borderRadius:7}}><summary style={{cursor:'pointer',fontWeight:700}}>Party sex and drafting pronouns</summary><p>These values belong to this matter. A recorded pronoun preference takes precedence over sex. Names are never used to guess sex.</p>{parties.filter(p=>p.name||p.source==='client').map(p=><div key={p.id} style={{marginTop:8,padding:8,borderTop:'1px solid #e2e8f0'}}><strong>{p.name||'Client'} - {p.role||p.source}</strong><PartySexFields party={p} onChange={patch=>onChange(p.id,patch)} /></div>)}</details>
}
export function PronounReview({template,data,selectedFiles=[]}) {
 const ids=new Set(selectedFiles)
 const bindings=(template?.bindings||[]).filter(b=>b.kind==='pronoun'&&b.is_active!==false&&(!b.file_id||ids.has(b.file_id)))
 if(!bindings.length)return null
 return <details style={{margin:'10px 0',padding:10,border:'1px solid #a78bfa',borderRadius:7}} open={bindings.some(b=>resolveLinkedPronoun(b,data).error)||undefined}><summary>Pronoun check ({bindings.length} fields)</summary>{bindings.map(b=>{const r=resolveLinkedPronoun(b,data);return <p key={b.id} style={{margin:'6px 0',color:r.error?'#991b1b':undefined}}><strong>{partyLabel(b.linked_party)}</strong>{r.party?.name?' ('+r.party.name+')':''}: {r.error||r.value} <small>{!r.error?' - '+r.source:''}</small></p>})}</details>
}
