import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient.js'
import { LEGAL_DATA, SOURCE_BY_ID, DISCOVERY_TYPES, REGIMES, ASSESSMENTS, categoriesFor, objectionWithAuthorities } from './discovery/model.js'
import { parseDiscoveryText, readDiscoveryDocx, exportDiscoveryDocx, mapRecognizedRanges } from './discovery/documents.js'
import './discoveryObjections.css'

function Authorities({ids=[]}) {
  return <div className="disco-authorities">{[...new Set(ids)].map(id=>SOURCE_BY_ID[id]&&<a key={id} href={SOURCE_BY_ID[id].url} target="_blank" rel="noreferrer" title={SOURCE_BY_ID[id].proposition}>{SOURCE_BY_ID[id].label}<span aria-hidden="true"> ↗</span></a>)}</div>
}
function RuleList({title,items=[]}) { return <section><h3>{title}</h3><ul>{items.map((item,i)=><li key={i}>{typeof item==='string'?item:item.text}</li>)}</ul></section> }
const typeLabel=type=>DISCOVERY_TYPES.find(t=>t.id===type)?.label || type
const statusLabels={allowed:'Generally allowed',conditional:'Depends on scope and facts',objectionable:'Example supports an objection'}

export default function DiscoveryObjections({session}) {
  const [type,setType]=useState('rfp'),[step,setStep]=useState('rules'),[regime,setRegime]=useState('family_current')
  const [level,setLevel]=useState('2'),[context,setContext]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[categoryId,setCategoryId]=useState('')
  const [draft,setDraft]=useState(''),[document,setDocument]=useState(null),[requests,setRequests]=useState([]),[warnings,setWarnings]=useState([])
  const [results,setResults]=useState({}),[edits,setEdits]=useState({}),[selected,setSelected]=useState({}),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [busy,setBusy]=useState(''),[progress,setProgress]=useState(''),[aiConfigured,setAiConfigured]=useState(null)
  const controller=useRef(null),busyRef=useRef(false),uploadRef=useRef(null)
  const selectedRegime=REGIMES.find(r=>r.id===regime)
  const guide=LEGAL_DATA.types[type]
  const categories=categoriesFor(type,query,filter)
  const category=categories.find(c=>c.id===categoryId)||categories[0]
  const completed=Object.keys(results).length
  const chosen=requests.filter(r=>selected[r.id]&&results[r.id]?.objection)

  async function api(body,signal) {
    const {data,error:authError}=await supabase.auth.getSession()
    if(authError || !data?.session?.access_token || data.session.user?.id!==session?.user?.id) throw new Error('Sign in to Mio again to use discovery AI.')
    const response=await fetch('/api/discovery-objections',{method:'POST',headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal})
    const payload=await response.json().catch(()=>null)
    if(!response.ok||!payload?.ok) throw new Error(payload?.error||'The discovery AI service is unavailable. The rules and Word recognition are still available.')
    return payload
  }
  useEffect(()=>{
    const abort=new AbortController()
    api({action:'status'},abort.signal).then(data=>{if(!abort.signal.aborted)setAiConfigured(data.aiConfigured)}).catch(()=>{})
    return ()=>{abort.abort();controller.current?.abort()}
    // This workspace is keyed to the authenticated user at its mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  function invalidate() { setResults({});setEdits({});setSelected({});setNotice('');setError('') }
  function adopt(parsed,source=null) {
    invalidate();setRequests(parsed.requests);setWarnings(parsed.warnings||[]);setDocument(source);setStep('analyze')
    setNotice(`${parsed.requests.length} request${parsed.requests.length===1?'':'s'} recognized. Check the request and response boundaries below.`)
  }
  async function upload(file) {
    if(!file||busyRef.current)return
    busyRef.current=true;setBusy('import');setError('');setNotice('')
    try {
      if(file.size>20*1024*1024)throw new Error('Upload a Word document of 20 MB or less.')
      if(/\.txt$/i.test(file.name)) { const text=await file.text();setDraft(text);adopt(parseDiscoveryText(text,type));return }
      if(!/\.docx$/i.test(file.name))throw new Error('Use a Word .docx file. For an older .doc, open it in Word and choose Save As → Word Document (.docx).')
      const bytes=new Uint8Array(await file.arrayBuffer()),parsed=await readDiscoveryDocx(bytes,type)
      adopt(parsed,{name:file.name,bytes,paragraphs:parsed.paragraphs,hasTrackedChanges:parsed.hasTrackedChanges})
    } catch(cause){setError(cause.message)} finally {busyRef.current=false;setBusy('');if(uploadRef.current)uploadRef.current.value=''}
  }
  async function recognizeWithAi() {
    if(!document||busyRef.current)return
    busyRef.current=true;setBusy('recognize');setError('');setProgress('Recognizing request and response boundaries…')
    const abort=new AbortController();controller.current=abort
    try {
      const data=await api({action:'recognize',type,paragraphs:document.paragraphs},abort.signal)
      if(abort.signal.aborted)return
      const identified=mapRecognizedRanges(document.paragraphs,data.ranges,type)
      adopt({requests:identified,warnings:['AI recognized these boundaries. Check every request and response before analysis.']},document)
    } catch(cause){if(!abort.signal.aborted)setError(cause.message)}finally{busyRef.current=false;setBusy('');setProgress('')}
  }
  async function analyze() {
    if(busyRef.current||!requests.length)return
    busyRef.current=true;setBusy('analyze');setError('');setNotice('')
    const abort=new AbortController();controller.current=abort
    const pending=requests.filter(r=>!results[r.id])
    try {
      for(let i=0;i<pending.length;i+=3) {
        const batch=pending.slice(i,i+3)
        setProgress(`Analyzing requests ${completed+i+1}–${Math.min(requests.length,completed+i+batch.length)} of ${requests.length}…`)
        const data=await api({action:'analyze',regime,level,context,requests:batch.map(({id,type,number,request,response})=>({id,type,number,request,response}))},abort.signal)
        if(abort.signal.aborted)return
        const next=Object.fromEntries(data.results.map(result=>[result.id,result]))
        setResults(previous=>({...previous,...next}))
        setEdits(previous=>({...previous,...Object.fromEntries(data.results.map(result=>[result.id,objectionWithAuthorities(result)]))}))
      }
      setNotice('Analysis complete. Review the reasons and authority, edit the language, then select the objections to include.')
    } catch(cause){if(!abort.signal.aborted)setError(cause.message+' Completed results remain below; retry to continue the remaining requests.')}
    finally {busyRef.current=false;setBusy('');setProgress('')}
  }
  function cancel() { controller.current?.abort();setNotice('Analysis stopped. Completed results remain available.');setProgress('') }
  async function download() {
    setError('');setNotice('');setBusy('export');busyRef.current=true
    try {
      if(chosen.some(r=>!edits[r.id]?.trim()||/\[[^\]]+\]/.test(edits[r.id]))) throw new Error('Complete the bracketed fact placeholders and any empty objection before exporting.')
      const bytes=await exportDiscoveryDocx({originalBytes:document?.bytes,requests,objections:chosen.map(r=>({id:r.id,text:edits[r.id]}))})
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}))
      const a=window.document.createElement('a');a.href=url;a.download=(document?.name?.replace(/\.docx$/i,'')||'Discovery-responses')+'-with-objections.docx';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)
      setNotice(`Downloaded a Word copy with ${chosen.length} selected objection${chosen.length===1?'':'s'}. ${document?'The original file is unchanged.':'Complete the response text before service.'}`)
    } catch(cause){setError(cause.message)}finally{busyRef.current=false;setBusy('')}
  }
  const disclosureSource=regime==='family_current'?'trcp194a':regime==='civil_current'?'trcp194':'order2021'
  const regimeDetails=(LEGAL_DATA.dateRegimes||[]).find(r=>r.id===regime)
  const responseNotes=regime==='family_current'?guide.responseNotes:(type==='rfd'?[regimeDetails?.disclosure,regimeDetails?.objections,regimeDetails?.timing].filter(Boolean):guide.responseNotes.map(note=>/50 days|50-day/.test(note)?(regime==='legacy'?'Use the historical response-time rules and the case’s orders.':'Ordinarily respond in 30 days. Do not apply the current family 50-day pre-answer exception to this regime.'):note))

  return <div className="disco-workspace">
    <header className="disco-header"><div><div className="disco-eyebrow">MIO · TEXAS DISCOVERY</div><h1>Discovery objection walkthrough</h1><p>Understand the request. Find the right authority. Build a specific response.</p></div><div className="disco-date">Authorities reviewed<br/><strong>{LEGAL_DATA.reviewedAt||'October 14, 2026'}</strong></div></header>
    <div className="disco-types" aria-label="Discovery type">{DISCOVERY_TYPES.map(item=><button type="button" key={item.id} disabled={Boolean(busy)} aria-pressed={type===item.id} className={type===item.id?'active':''} onClick={()=>{setType(item.id);setCategoryId('');setQuery('');setFilter('all')}}><strong>{item.label}</strong><span>{item.title}</span><small>{item.rule}</small></button>)}</div>
    <div className="disco-regime"><label>Which rules apply?<select aria-label="Rules regime" value={regime} disabled={Boolean(busy)} onChange={e=>{setRegime(e.target.value);invalidate()}}>{REGIMES.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label><p>{selectedRegime?.note}</p></div>
    <nav className="disco-steps" aria-label="Walkthrough steps">{[['rules','1','Rules & scope'],['examples','2','Request examples'],['analyze','3','Analyze & draft']].map(([id,n,label])=><button key={id} type="button" aria-current={step===id?'step':undefined} className={step===id?'active':''} onClick={()=>setStep(id)}><span>{n}</span>{label}</button>)}</nav>

    {step==='rules'&&<div className="disco-rules">
      <section className="disco-card disco-scope"><div className="disco-eyebrow">{guide.rule||DISCOVERY_TYPES.find(t=>t.id===type)?.rule}</div><h2>{guide.title}</h2><p>{type==='rfd'&&regime!=='family_current'?selectedRegime.note:guide.scope}</p><Authorities ids={type==='rfd'&&regime!=='family_current'?[disclosureSource]:guide.authorities}/></section>
      {type==='rfd'&&regime!=='family_current'?<section className="disco-card"><h3>Disclosure depends on the filing date</h3><p>{selectedRegime.note}</p><p>Do not apply the family Rule 194a category list to this regime. Use the historical or ordinary civil disclosure requirements linked here, the applicable exemptions, and the discovery order.</p><Authorities ids={regimeDetails?.authorities||[disclosureSource]}/></section>:<div className="disco-two"><div className="disco-card disco-allowed"><RuleList title="Generally allowed" items={guide.allowed}/></div><div className="disco-card disco-limits"><RuleList title="Limits and objection grounds" items={guide.notAllowed}/></div></div>}
      <section className="disco-card"><RuleList title="How to respond" items={responseNotes}/><p className="disco-note">Check the case filing date, service date, discovery control plan and any court order. This page does not calculate your response deadline.</p></section>
      <h2 className="disco-section-title">Rules that apply across discovery</h2><div className="disco-general">{(LEGAL_DATA.generalRules||[]).map((rule,i)=><details key={i} className="disco-card"><summary>{rule.title}</summary><p>{rule.text}</p><Authorities ids={rule.authorities}/></details>)}</div>
      <button type="button" className="disco-primary disco-next" onClick={()=>setStep('examples')}>Explore {typeLabel(type)} request examples →</button>
    </div>}

    {step==='examples'&&<section className="disco-examples">
      <div className="disco-section-heading"><div><h2>What is this request asking for?</h2><p>Select a category to see the distinction and supporting authority.</p></div><span className="disco-count">{categories.length} examples</span></div>
      {type==='rfd'&&regime!=='family_current'&&<div className="disco-message">These examples describe current family Rule 194a requests. For this case, compare the selected filing-date regime before applying an example; AI analysis uses your selected regime.</div>}
      <div className="disco-example-toolbar"><input aria-label="Search request examples" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search attorney, all documents, evidence…"/><select aria-label="Filter request examples" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All categories</option><option value="allowed">Generally allowed</option><option value="conditional">Depends on facts</option><option value="objectionable">Objectionable example</option></select></div>
      <div className="disco-example-layout"><div className="disco-example-list">{categories.map(c=><button type="button" key={c.id} aria-pressed={category?.id===c.id} className={category?.id===c.id?'active':''} onClick={()=>setCategoryId(c.id)}><span className={`disco-dot ${c.status}`}/><span>{c.title}</span><span aria-hidden="true">›</span></button>)}{!categories.length&&<p>No matching categories. Try a broader search.</p>}</div>
      {category&&<article className="disco-card disco-example-detail"><span className={`disco-badge ${category.status}`}>{statusLabels[category.status]}</span><h2>{category.title}</h2><blockquote>{category.example}</blockquote><p>{category.explanation}</p>{category.whatFactsNeeded?.length>0&&<RuleList title="Facts to check" items={category.whatFactsNeeded}/>}<h3>A narrower request or appropriate response</h3><p>{category.alternative}</p><Authorities ids={category.authorities}/><button type="button" className="disco-primary" disabled={Boolean(busy)} onClick={()=>{setDraft(category.example);adopt(parseDiscoveryText(category.example,type))}}>Analyze this example →</button></article>}</div>
    </section>}

    {step==='analyze'&&<section className="disco-analysis">
      <div className="disco-section-heading"><div><h2>Review requests and draft objections</h2><p>Paste requests, or upload a Word request set or completed response.</p></div><span className="disco-count">{requests.length?`${completed} / ${requests.length} analyzed`:'Start with a request'}</span></div>
      <div className="disco-two"><div className="disco-card"><label className="disco-label" htmlFor="disco-paste">Paste {typeLabel(type)} requests</label><textarea id="disco-paste" value={draft} disabled={Boolean(busy)} onChange={e=>setDraft(e.target.value)} rows={5} placeholder="REQUEST FOR PRODUCTION NO. 1: Produce all communications with your attorney…"/><button type="button" disabled={Boolean(busy)||!draft.trim()} onClick={()=>{try{adopt(parseDiscoveryText(draft,type))}catch(cause){setError(cause.message)}}}>Recognize pasted requests</button></div><div className="disco-card disco-upload"><div className="disco-file-icon" aria-hidden="true">W</div><h3>Upload requests or responses</h3><p>Word .docx or plain text · up to 20 MB</p><input ref={uploadRef} aria-label="Upload discovery Word document" type="file" accept=".docx,.doc,.txt" disabled={Boolean(busy)} onChange={e=>upload(e.target.files[0])}/><small>For older .doc files, use Word’s Save As → .docx.</small>{document&&<div className="disco-filename"><strong>{document.name}</strong><span>Original formatting preserved on export</span><button type="button" disabled={Boolean(busy)||aiConfigured===false} onClick={recognizeWithAi}>Try AI request recognition</button></div>}</div></div>
      <div className="disco-card disco-context"><label>Relevant case facts and court-ordered limits<textarea aria-label="Case context" disabled={Boolean(busy)} value={context} onChange={e=>{setContext(e.target.value);invalidate()}} rows={2} maxLength={12000} placeholder="E.g., modification of possession; disputed conduct since June 2025; requested records date back to 2000. Include facts supporting burden or privilege."/></label><label>Discovery level<select aria-label="Discovery level" value={level} disabled={Boolean(busy)} onChange={e=>{setLevel(e.target.value);invalidate()}}><option value="1">Level 1</option><option value="2">Level 2</option><option value="3">Level 3 / court order</option><option value="unknown">Not yet confirmed</option></select></label><p>AI assesses the actual request and cites the linked authority collection. It identifies missing facts and may recommend answering without an objection.</p></div>
      {aiConfigured===false&&<div className="disco-error">Mio’s AI service is not connected on the server. Rules, examples, and numbered Word recognition remain available; AI analysis needs the server’s OpenAI connection.</div>}
      {warnings.map((warning,i)=><div key={i} className="disco-message">{warning}</div>)}
      {requests.length>0&&<><div className="disco-review-bar"><div><strong>Check the recognized pairs below</strong><small>Each result stays attached to its original request number and discovery type.</small></div><button type="button" className="disco-primary" disabled={Boolean(busy)||aiConfigured===false||completed===requests.length} onClick={analyze}>{completed===requests.length?'All requests analyzed':completed?`Analyze ${requests.length-completed} remaining`:`Analyze ${requests.length} request${requests.length===1?'':'s'}`}</button>{busy==='analyze'&&<button type="button" onClick={cancel}>Stop analysis</button>}</div>
      <div className="disco-request-list">{requests.map((request,index)=>{
        const result=results[request.id],assessment=result&&ASSESSMENTS[result.assessment]
        return <article className="disco-card disco-request" key={request.id}><header><div className="disco-request-number">{typeLabel(request.type)} <strong>{request.number}</strong></div>{assessment?<span className={`disco-badge ${assessment.color}`}>{assessment.label}</span>:<span className="disco-badge slate">Not analyzed</span>}</header><div className="disco-request-text">{request.request}</div>{request.response&&<details open={requests.length<4}><summary>Existing response</summary><div className="disco-original-response">{request.response}</div></details>}
          {result&&<div className="disco-result"><p><strong>Assessment. </strong>{result.reason}</p><Authorities ids={result.authorities}/>{result.factsNeeded.length>0&&<RuleList title="Confirm before relying on this objection" items={result.factsNeeded}/>}<p><strong>Response still required. </strong>{result.responseGuidance}</p>{result.withholding&&<p className="disco-message"><strong>Withholding / privilege procedure. </strong>{result.withholding}</p>}{result.objection?<div className="disco-draft"><label htmlFor={`objection-${index}`}><strong>OBJECTION:</strong> <span>Editable proposed language</span></label><textarea id={`objection-${index}`} aria-label={`Objection for ${typeLabel(request.type)} ${request.number}`} disabled={Boolean(busy)} rows={5} value={edits[request.id]||''} onChange={e=>setEdits(old=>({...old,[request.id]:e.target.value}))}/><label className="disco-include"><input type="checkbox" disabled={Boolean(busy)} checked={Boolean(selected[request.id])} onChange={e=>setSelected(old=>({...old,[request.id]:e.target.checked}))}/>Include this objection below the response in Word</label></div>:<div className="disco-proper">No objection proposed. Use the response guidance above.</div>}</div>}
        </article>
      })}</div>
      <div className="disco-export"><div><strong>{chosen.length} objection{chosen.length===1?'':'s'} selected</strong><p>Word inserts <b>OBJECTION:</b> below each matching response. Privilege assertions may also require a withholding statement or log. Review the final copy before service.</p></div><button type="button" className="disco-primary" disabled={Boolean(busy)||Boolean(document?.hasTrackedChanges)||(!chosen.length&&Boolean(document))} onClick={download}>{busy==='export'?'Preparing Word…':'Download Word response'}</button></div></>}
      <p className="disco-note">The uploaded file stays in this page’s memory. Clicking an AI action sends the recognized text to Mio’s AI service. This workspace clears when you leave or refresh; download your work before leaving.</p>
    </section>}
    {progress&&<div className="disco-progress" role="status">{progress}</div>}{error&&<div className="disco-error" role="alert">{error}</div>}{notice&&<div className="disco-message" role="status">{notice}</div>}
    <footer className="disco-footer"><details><summary>Sources and treatment of the uploaded reference materials</summary><p>The walkthrough uses linked rules and judicial opinions. The supplied objection forms informed the categories; form language was checked for scope, privilege and filing-date problems. Selected authorities were reviewed; this is not a comprehensive citator check. AI suggestions require your legal and factual review.</p>{(LEGAL_DATA.uploadNotes||[]).map((note,i)=><p key={i}>{typeof note==='string'?note:<><strong>{note.file}: </strong>{note.note||note.summary}</>}</p>)}<Authorities ids={LEGAL_DATA.sources.map(s=>s.id)}/></details></footer>
  </div>
}
