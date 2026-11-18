import { useCallback,useEffect,useMemo,useState } from 'react'
import { supabase } from '../supabaseClient.js'

const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Chicago'})
const dateLabel=value=>value?new Date(value+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'No due date'
const openStatus=['open','pending','in_progress','in progress','todo','to do','new','']

export default function MioTodo({dashboard=false}){
 const [tasks,setTasks]=useState([]),[matters,setMatters]=useState([]),[members,setMembers]=useState([])
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[showAll,setShowAll]=useState(false),[adding,setAdding]=useState(false)
 const [form,setForm]=useState({title:'',description:'',matter_id:'',due_date:'',priority:'Normal',assignee:''})
 const load=useCallback(async()=>{
  setLoading(true)
  const [t,m,p]=await Promise.all([
   supabase.from('tasks').select('id,matter_id,title,description,due_date,priority,status,created_at,is_active').eq('is_active',true),
   supabase.from('matters').select('id,name,is_active').eq('is_active',true).order('name'),
   supabase.from('team_members').select('id,first_name,last_name,is_active').eq('is_active',true).order('first_name')
  ])
  if(t.error){setError(t.error.message);setLoading(false);return}
  setTasks(t.data||[]);setMatters(m.data||[]);setMembers(p.data||[]);setError(m.error?.message||p.error?.message||'');setLoading(false)
 },[])
 useEffect(()=>{void load()},[load])
 const matterById=useMemo(()=>Object.fromEntries(matters.map(m=>[m.id,m.name])),[matters])
 const ordered=useMemo(()=>tasks.filter(t=>!['completed','complete','done','cancelled','canceled','closed'].includes((t.status||'').toLowerCase())).sort((a,b)=>{
  const rank={Urgent:0,High:1,Normal:2,Low:3};const pa=rank[a.priority]??2,pb=rank[b.priority]??2
  if(pa!==pb)return pa-pb
  if(a.due_date&&b.due_date)return a.due_date.localeCompare(b.due_date)
  if(a.due_date)return -1;if(b.due_date)return 1
  return (a.created_at||'').localeCompare(b.created_at||'')
 }),[tasks])
 async function addTask(e){
  e.preventDefault();if(!form.title.trim())return
  const {data,error}=await supabase.from('tasks').insert({title:form.title.trim(),description:form.description||null,matter_id:form.matter_id||null,due_date:form.due_date||null,priority:form.priority,status:'open',is_active:true,assign_date:today()}).select('id').single()
  if(error){setError(error.message);return}
  if(form.assignee){const {error:assignError}=await supabase.from('task_assignments').insert({task_id:data.id,team_member_id:form.assignee});if(assignError)setError(assignError.message)}
  setForm({title:'',description:'',matter_id:'',due_date:'',priority:'Normal',assignee:''});setAdding(false);await load()
 }
 async function complete(task){
  const {error}=await supabase.from('tasks').update({status:'completed',is_active:false,status_changed_at:new Date().toISOString()}).eq('id',task.id)
  if(error){setError(error.message);return}await load()
 }
 const list=dashboard?ordered.slice(0,10):ordered
 return <section className={dashboard?'mio-todo-card':'mio-todo-page'}>
  <header className="mio-todo-head"><div><h2>{dashboard?'▢ Outstanding to-do’s':'To-Do List'}</h2><small>{ordered.length} outstanding {ordered.length===1?'task':'tasks'}</small></div><div><button type="button" onClick={()=>setAdding(v=>!v)}>＋ Add task</button>{dashboard&&<button type="button" onClick={()=>setShowAll(v=>!v)}>{showAll?'Close list':'View all'}</button>}</div></header>
  {error&&<p className="mio-todo-error" role="alert">{error}</p>}
  {adding&&<form className="mio-todo-form" onSubmit={addTask}>
   <input required placeholder="Task" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/>
   <input placeholder="Notes (optional)" value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/>
   <select value={form.matter_id} onChange={e=>setForm({...form,matter_id:e.target.value})}><option value="">Firm-wide / no matter</option>{matters.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
   <input aria-label="Due date" type="date" value={form.due_date} onChange={e=>setForm({...form,due_date:e.target.value})}/>
   <select aria-label="Priority" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{['Urgent','High','Normal','Low'].map(v=><option key={v}>{v}</option>)}</select>
   <select aria-label="Assign to" value={form.assignee} onChange={e=>setForm({...form,assignee:e.target.value})}><option value="">Unassigned</option>{members.map(m=><option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}</select>
   <button type="submit">Save task</button><button type="button" onClick={()=>setAdding(false)}>Cancel</button>
  </form>}
  {loading?<p>Loading tasks…</p>:list.length?<div className="mio-todo-list">{list.map(task=><div className="mio-todo-row" key={task.id}>
   <button type="button" className="mio-todo-check" title="Mark complete" aria-label={'Complete '+task.title} onClick={()=>complete(task)}>□</button>
   <div className="mio-todo-main"><strong>{task.title}</strong><small>{task.matter_id?matterById[task.matter_id]||'Matter unavailable':'Firm-wide'} · {dateLabel(task.due_date)}</small></div>
   <span className={'mio-todo-priority '+String(task.priority||'Normal').toLowerCase()}>{task.priority||'Normal'}</span>
  </div>)}</div>:<p className="mio-todo-empty">No outstanding tasks. Add one to get started.</p>}
  {dashboard&&ordered.length>10&&<small className="mio-todo-more">Showing the 10 highest-priority outstanding tasks.</small>}
  {dashboard&&showAll&&<div className="mio-todo-expanded"><MioTodo/></div>}
 </section>
}
