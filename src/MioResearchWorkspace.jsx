import React,{useEffect,useMemo,useState}from'react'
import{listResearchPublications}from'../lib/research/repository.js'
import{FINDING_DIRECTIONS,SOURCE_TYPES,RESEARCH_TOPICS,matchesResearchFilters,sortResearchRows}from'../lib/research/model.js'
import MioResearchEditor from'./MioResearchEditor.jsx'
import'./mioResearch.css'

const directionLabel=v=>({favors_shared:'Favors shared',neutral:'Neutral',mixed:'Mixed',conditional_concern:'Conditional concern',disfavors_shared:'Disfavors shared',methodology_only:'Methodology only'}[v]||v||'—')
const sourceLabel=v=>String(v||'').replaceAll('_',' ')
const metric=v=>v===null||v===undefined||v===''?'Not available':String(v)

export default function MioResearchWorkspace({session,supabase,enabled=true,EditorComponent=MioResearchEditor}){
 const[rows,setRows]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[selectedId,setSelectedId]=useState(null)
 const[filters,setFilters]=useState({search:'',finding_direction:'',source_type:'',editorial_status:'',topic:'',access_status:'',exact50:false})
 const[sort,setSort]=useState({key:'publication_year',direction:'desc'})
 async function load(){if(!supabase)return;setLoading(true);setError('');try{setRows(await listResearchPublications(supabase))}catch(e){setError(e.message)}finally{setLoading(false)}}
 useEffect(()=>{if(enabled&&session?.user?.id)void load()},[enabled,session?.user?.id])
 const shown=useMemo(()=>sortResearchRows(rows.filter(r=>matchesResearchFilters(r,filters)),sort),[rows,filters,sort])
 const counts=useMemo(()=>Object.fromEntries(['draft','needs_review','published','archived'].map(k=>[k,rows.filter(r=>r.editorial_status===k).length])),[rows])
 const setFilter=(key,value)=>setFilters(f=>({...f,[key]:value}))
 const chooseSort=key=>setSort(s=>({key,direction:s.key===key&&s.direction==='desc'?'asc':'desc'}))
 if(selectedId&&EditorComponent)return <EditorComponent publicationId={selectedId==='new'?null:selectedId} onClose={()=>{setSelectedId(null);void load()}} supabase={supabase} session={session}/>
 return <section className="mio-research" aria-label="Equal Parenting Research workspace">
  <div className="mio-research-actions"><div><h1>Equal Parenting Research</h1><p className="mio-research-note">Finding direction is descriptive only. It never changes evidence, impact, relevance, or historical-importance scores.</p></div><button type="button" onClick={()=>setSelectedId('new')}>New publication</button></div>
  <div className="mio-research-summary"><div><span>Total</span><b>{rows.length}</b></div><div><span>Draft</span><b>{counts.draft||0}</b></div><div><span>Needs review</span><b>{counts.needs_review||0}</b></div><div><span>Published</span><b>{counts.published||0}</b></div><div><span>Archived</span><b>{counts.archived||0}</b></div></div>
  <div className="mio-research-panel mio-research-toolbar">
   <label>Search<input aria-label="Search research" value={filters.search} onChange={e=>setFilter('search',e.target.value)} placeholder="Title, author, DOI, year, country"/></label>
   <label>Finding direction<select aria-label="Finding direction" value={filters.finding_direction} onChange={e=>setFilter('finding_direction',e.target.value)}><option value="">All</option>{FINDING_DIRECTIONS.map(v=><option key={v} value={v}>{directionLabel(v)}</option>)}</select></label>
   <label>Source type<select aria-label="Source type" value={filters.source_type} onChange={e=>setFilter('source_type',e.target.value)}><option value="">All</option>{SOURCE_TYPES.map(v=><option key={v} value={v}>{sourceLabel(v)}</option>)}</select></label>
   <label>Topic<select aria-label="Topic" value={filters.topic} onChange={e=>setFilter('topic',e.target.value)}><option value="">All</option>{RESEARCH_TOPICS.map(v=><option key={v} value={v}>{sourceLabel(v)}</option>)}</select></label>
   <label>Status<select aria-label="Editorial status" value={filters.editorial_status} onChange={e=>setFilter('editorial_status',e.target.value)}><option value="">All</option>{['draft','needs_review','published','archived'].map(v=><option key={v} value={v}>{sourceLabel(v)}</option>)}</select></label>
   <label className="mio-research-check"><input aria-label="Exact or near 50/50" type="checkbox" checked={filters.exact50} onChange={e=>setFilter('exact50',e.target.checked)}/>Exact or near 50/50</label>
  </div>
  <div className="mio-research-sort"><button type="button" onClick={()=>chooseSort('evidence_strength_score')}>Sort by Evidence</button><button type="button" onClick={()=>chooseSort('impact_score')}>Sort by Impact</button><button type="button" onClick={()=>chooseSort('equal_parenting_relevance_score')}>Sort by Relevance</button><button type="button" onClick={()=>chooseSort('historical_field_importance_score')}>Sort by Historical Importance</button><button type="button" onClick={()=>chooseSort('publication_year')}>Sort by Newest</button><button type="button" onClick={()=>chooseSort('title')}>Sort by Title</button></div>
  {error&&<div role="alert" className="mio-research-error">{error}</div>}
  <div className="mio-research-table-wrap"><table className="mio-research-table"><thead><tr><th>Title</th><th>Year</th><th>Direction</th><th>Type</th><th>50/50</th><th>Evidence</th><th>Impact</th><th>Access</th><th>Status</th></tr></thead><tbody>
   {shown.map(r=><tr key={r.id} data-research-row><td><button className="mio-research-title-btn" type="button" onClick={()=>setSelectedId(r.id)}>{r.title}</button><div>{r.authors_text}</div></td><td>{r.publication_year||'—'}</td><td><span className="mio-research-badge">{directionLabel(r.finding_direction)}</span></td><td>{sourceLabel(r.source_type)}</td><td>{(r.studies||[]).some(s=>s.exact_or_near_50_50===true)?'Yes':'No'}</td><td>{metric(r.evidence_strength_score)}</td><td>{metric(r.impact_score)}</td><td>{(r.access_links||[]).length?((r.access_links||[])[0].access_status||'Available'):'Not available'}</td><td>{sourceLabel(r.editorial_status)}</td></tr>)}
   {!shown.length&&!loading&&<tr><td className="mio-research-empty" colSpan="9">No research records match these filters.</td></tr>}
  </tbody></table></div>
  {loading&&<p>Loading research…</p>}
 </section>
}
