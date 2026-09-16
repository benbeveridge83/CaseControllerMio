import React,{useCallback,useEffect,useRef,useState} from 'react'
import {supabase} from './supabaseClient.js'
import './mioLeadAlerts.css'
import {SubmissionDetails,LeadReview} from './MioFormspree.jsx'
import {normalizedLead} from '../supabase/functions/formspree-webhook/model.js'

const OPEN=['new','acknowledged']
const fmt=v=>v?new Date(v).toLocaleString():''
const name=l=>l.full_name||l.email||l.phone||'New website lead'

export default function MioLeadAlerts(){
 const [session,setSession]=useState(null),[leads,setLeads]=useState([]),[expanded,setExpanded]=useState(true),[error,setError]=useState(''),known=useRef(new Set())
 const load=useCallback(async()=>{const {data,error}=await supabase.from('mio_formspree_leads').select('*').in('status',OPEN).order('submitted_at',{ascending:false}).limit(50);if(error){setError(error.message);return}setError('');setLeads((data||[]).map(normalizedLead));for(const l of data||[])known.current.add(l.id)},[])
 useEffect(()=>{let alive=true;supabase.auth.getSession().then(({data})=>alive&&setSession(data.session));const {data:auth}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>{alive=false;auth.subscription.unsubscribe()}},[])
 useEffect(()=>{if(!session)return;void load();const timer=setInterval(()=>void load(),30000);const channel=supabase.channel('mio-formspree-leads').on('postgres_changes',{event:'*',schema:'public',table:'mio_formspree_leads'},payload=>{if(payload.eventType==='INSERT'&&OPEN.includes(payload.new?.status)){setExpanded(true);try{new BroadcastChannel('mio-leads').postMessage({type:'new-lead',id:payload.new.id})}catch{}}void load()}).subscribe();let bc;try{bc=new BroadcastChannel('mio-leads');bc.onmessage=e=>{if(e.data?.type==='new-lead'){setExpanded(true);void load()}else if(['refresh','converted'].includes(e.data?.type)){void load();if(e.data.type==='converted')window.dispatchEvent(new Event('mio-lead-converted'))}}}catch{}return()=>{clearInterval(timer);void supabase.removeChannel(channel);bc?.close()}},[session,load])
 useEffect(()=>{window.addEventListener('mio-leads-refresh',load);return()=>window.removeEventListener('mio-leads-refresh',load)},[load])
 const current=leads[0],count=leads.length
 const act=useCallback(async(status)=>{if(!current)return;const final=!OPEN.includes(status),patch={status,addressed_at:final?new Date().toISOString():null,addressed_by:final?session?.user?.id:null};const {error}=await supabase.from('mio_formspree_leads').update(patch).eq('id',current.id);if(error){setError(error.message);return}try{new BroadcastChannel('mio-leads').postMessage({type:'refresh'})}catch{}await load()},[current,session,load])
 const minimize=useCallback(async()=>{setExpanded(false);if(current?.status==='new'){await supabase.from('mio_formspree_leads').update({status:'acknowledged',minimized_at:new Date().toISOString()}).eq('id',current.id);try{new BroadcastChannel('mio-leads').postMessage({type:'refresh'})}catch{}await load()}},[current,load])
 if(!session||!count)return null
 if(!expanded)return <aside className="mio-lead-mini" role="status"><button onClick={()=>setExpanded(true)}><b>NEW LEAD{count>1?'S':''}: {count}</b><span>{name(current)}</span></button></aside>
 return <div className="mio-lead-backdrop"><section className="mio-lead-alert" role="alertdialog" aria-label="New website lead"><header><div><small>WEBSITE LEAD · FORMSPREE</small><h2>{count>1?`${count} leads need attention`:'New potential client'}</h2></div><button onClick={minimize}>Minimize</button></header><div className="mio-lead-body"><SubmissionDetails lead={current}/><LeadReview key={current.id} lead={current} onSaved={load}/>{error&&<p role="alert">{error}</p>}</div><footer><button onClick={()=>{setExpanded(false);window.dispatchEvent(new Event('mio-open-formspree'))}}>View all submissions</button><button className="primary" onClick={()=>act('contacted')}>Mark contacted</button><button onClick={()=>act('converted')}>Handled / converted</button><button onClick={()=>act('declined')}>Decline lead</button><button onClick={()=>act('spam')}>Mark spam</button>{count>1&&<span>{count-1} more waiting</span>}</footer></section></div>
}
