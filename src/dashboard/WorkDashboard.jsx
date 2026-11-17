import { useEffect,useRef,useState } from 'react'
import { createPortal } from 'react-dom'
import { firmDate,workedToday } from './model.js'
import './dashboard.css'

const labels={settings:'Need to set',orders:'Orders',service:'Drafted · need to serve'}
const icons={settings:'▣',orders:'▤',service:'➤',drafts:'✎',general:'✉'}
const cash=c=>(c/100).toLocaleString('en-US',{style:'currency',currency:'USD'})

function billDate(value,sent=false){
 if(!value)return '—'
 if(!sent&&/^\d{4}-\d{2}-\d{2}$/.test(value)){const [y,m,d]=value.split('-');return `${Number(m)}/${Number(d)}/${y.slice(-2)}`}
 const date=new Date(value)
 return Number.isFinite(date.getTime())?date.toLocaleDateString('en-US',{timeZone:'America/Chicago',month:'numeric',day:'numeric',year:'2-digit'}):'—'
}

function MatterTrust({row,finance}){
 if(row.financeVisible===false)return null
 const value=!finance.ready?(finance.error?'Unavailable':'Refreshing…'):Number.isFinite(row.trust)?cash(row.trust*100):'Review'
 return <span className="desk-matter-trust">Trust: {value}</span>
}

function OpenPage({page,label}){
 return <a className="desk-open-page" href={`#${page}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label} page in a new window`} title={`Open ${label} page in a new window`} onClick={event=>{
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return
  event.preventDefault()
  window.open(event.currentTarget.href,'_blank','popup=yes,width=1440,height=900,noopener,noreferrer')
 }}>Open page ↗</a>
}

export function DeskModal({title,onClose,children}){
 const ref=useRef(null)
 useEffect(()=>{const previous=document.activeElement;ref.current?.querySelector('button')?.focus();const key=e=>{if(!ref.current?.contains(document.activeElement))return;if(e.key==='Escape')onClose();if(e.key==='Tab'){const list=[...ref.current.querySelectorAll('button,a,input,select,textarea')].filter(n=>!n.disabled),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus?.()}},[onClose])
 return createPortal(<div className="mio-desk-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section ref={ref} role="dialog" aria-modal="true" aria-label={title} className="mio-desk-modal"><header><h2>{title}</h2><button onClick={onClose}>Close</button></header>{children}</section></div>,document.body)
}

export default function WorkDashboard({billingUserId,rows,billingEntries,finance,trust,withdrawals=[],withdrawalLoading=false,withdrawalError='',onWithdrawal,workflow,onWorkflow,onOpen,onAddNeedToSet,onTime,onMatter,timeline,renderNativePlanning}){
 const [today,setToday]=useState(firmDate),[view,setView]=useState('calendar'),[queue,setQueue]=useState('')
 useEffect(()=>{const timer=setInterval(()=>setToday(firmDate()),30000);return()=>clearInterval(timer)},[])
 const stats=[['Time billed',`${(finance.day?.hours||0).toFixed(1)} h`,`${(finance.week?.hours||0).toFixed(1)} h`],['Fees earned',cash(finance.day?.total||0),cash(finance.week?.total||0)],['Earned · trust covered',cash(finance.day?.covered||0),cash(finance.week?.covered||0)],['CPS / DFPS earned',cash(finance.day?.dfps||0),cash(finance.week?.dfps||0)]]
 function rowView(row){const worked=workedToday(row,billingEntries,today,billingUserId),name=row.clientName||'Client not linked';return <div key={row.key} className={`desk-task ${worked?'worked':''}`} data-task-key={row.key}><button className="desk-task-open" onClick={()=>{setQueue('');onOpen(row)}}><strong>{name}</strong><span className="desk-matter-reference">{row.matterName}</span><span>{row.title}</span><small>{row.phase||labels[row.kind]}{worked?' · ✓ Worked today':''}</small></button><div className="desk-task-actions"><MatterTrust row={row} finance={finance}/><button onClick={()=>onTime(row)} aria-label={`Add time: ${name}, ${row.title}`}>＋ Time</button></div></div>}
 return <div className="mio-work-dashboard">
  <div className="desk-title"><div><h1>My dashboard</h1><small>{today} · Your work and billed time</small></div><div><button onClick={()=>onTime(null)}>＋ Add time</button></div></div>
  <div className="desk-finance"><section className="desk-box desk-withdrawals"><header><h2>↗ Withdrawals</h2><span>{withdrawals.length}</span><OpenPage page="withdrawals" label="Withdrawals"/></header><div className="desk-withdrawal-scroll">{withdrawalError?<p role="alert">{withdrawalError}</p>:withdrawalLoading?<p>Loading withdrawals…</p>:withdrawals.length?withdrawals.map(w=><button key={w.id} onClick={()=>onWithdrawal(w.id)}><strong>{w.clientName||'Client not linked'}</strong><span className="desk-matter-reference">{w.name}</span><span className={`desk-withdrawal-status ${w.kind}`}>{w.status}</span><small>{w.next}</small>{w.financeVisible!==false&&<span className="desk-withdrawal-finance"><b><MatterTrust row={w} finance={finance}/></b><span className="desk-withdrawal-bills-label">Last 3 bill sends</span>{!finance.ready?<span>Refreshing bill history…</span>:w.billSends?.length?w.billSends.map(bill=><span key={bill.key} className="desk-withdrawal-bill">{bill.invoiceNumber} · bill {billDate(bill.issueDate)} · sent {billDate(bill.sentAt,true)}</span>):<span>No recorded bill sends.</span>}</span>}</button>):<p>No withdrawal cases.</p>}</div></section><section className="desk-box desk-billing"><header><h2>◷ Billing & earnings <OpenPage page="billing" label="Billing"/></h2><span>Today</span><span>This week</span></header>{stats.map(([name,a,b])=><div className="desk-stat" key={name}><span>{name}</span><b>{finance.ready?a:'—'}</b><b>{finance.ready?b:'—'}</b></div>)}<small className="desk-finance-note">{finance.error?<span role="alert">Finance unavailable: {finance.error}</span>:!finance.ready?'Refreshing current trust and billing…':(finance.day?.unknown||finance.week?.unknown)?'Some earned fees need finance review; trust coverage excludes them.':'Earned fees are recorded work, not collected funds. Trust is allocated per matter.'}</small></section>
   <section className="desk-box desk-trust"><header><h2>◈ My matters · highest trust first</h2><OpenPage page="billing" label="Trust balances"/></header><div className="desk-trust-scroll" aria-label="Matters by trust, 10 visible at a time">{finance.ready?trust.map((m,i)=><button key={m.id} onClick={()=>onMatter(m.id)}><span><strong>{i+1}. {m.clientName||'Client not linked'}</strong><small>{m.name}</small></span><b>{m.trust===null?'Review':cash(m.trust*100)}</b></button>):<p>Refreshing balances…</p>}</div><small>{trust.length} matters · 10 at a time · Scroll for more</small></section></div>
  <div className="desk-work"><aside className="desk-box desk-workflow"><header><h2>☑ Daily workflow</h2><OpenPage page="workflow" label="Workflow"/></header>{workflow.length?workflow.map(item=><label key={item.id}><input type="checkbox" checked={item.checked} onChange={()=>onWorkflow(item.id,today)}/><span>{item.name}</span></label>):<p>No workflow items configured.</p>}</aside>
   <main className="desk-boxes">{Object.keys(labels).map(kind=>{const items=rows.filter(r=>r.kind===kind);return <section key={kind} className={`desk-box desk-queue ${kind}`}><header><h2>{icons[kind]} {labels[kind]}</h2>{kind==='settings'&&onAddNeedToSet&&<button type="button" onClick={onAddNeedToSet}>＋ Add need to set</button>}<button onClick={()=>setQueue(kind)} aria-label={`Expand ${labels[kind]} queue`}>{items.length} ↗</button><OpenPage page={kind==='settings'?'need_to_set':kind==='orders'?'orders':'matters'} label={kind==='service'?'Matters':labels[kind]}/></header><div className="desk-queue-scroll">{items.map(rowView)}{!items.length&&<p>No current matters.</p>}</div></section>})}
   </main></div>
  <section className="desk-box desk-planning"><header><h2>▦ Calendar & matter planning</h2><div role="tablist" aria-label="Planning view">{[['calendar','Calendar'],['matter_timelines','Matter timelines'],['checklist','Checklist']].map(([key,name])=><button key={key} role="tab" aria-selected={view===key} onClick={()=>setView(key)}>{name}</button>)}</div><OpenPage page={view} label={view==='matter_timelines'?'Matter timelines':view==='checklist'?'Checklist':'Calendar'}/></header><div className="desk-planning-content">{view==='calendar'?<CalendarStrip timeline={timeline} today={today} onOpen={onMatter}/>:renderNativePlanning(view)}</div></section>
  {queue&&<DeskModal title={labels[queue]} onClose={()=>setQueue('')}>{rows.filter(r=>r.kind===queue).map(rowView)}</DeskModal>}

 </div>
}

function CalendarStrip({timeline,today,onOpen}){
 const [offset,setOffset]=useState(0);const start=new Date(`${today}T12:00:00Z`);start.setUTCDate(start.getUTCDate()+offset)
 const days=Array.from({length:14},(_,i)=>{const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10)})
 return <><div className="desk-calendar-nav"><button onClick={()=>setOffset(offset-14)}>← Previous</button><b>{days[0]} — {days[13]}</b><button onClick={()=>setOffset(0)}>Today</button><button onClick={()=>setOffset(offset+14)}>Next →</button></div><div className="desk-calendar-strip">{days.map(day=><div key={day} className={day===today?'today':''}><strong>{day.slice(5)}</strong>{timeline.filter(t=>t.date===day).map((t,i)=><button key={`${t.id}:${i}`} className={t.lane} title={`${t.name} · ${t.title}`} onClick={()=>onOpen(t.matterId)}><b>{t.name}</b><span>{t.lane==='deadlines'?'◆ ':t.lane==='activity'?'▪ ':'● '}{t.title}</span></button>)}</div>)}</div><small>● Settings &nbsp; ◆ Deadlines &nbsp; ▪ Activity · Dates follow your Matter Timeline options.</small></>
}
