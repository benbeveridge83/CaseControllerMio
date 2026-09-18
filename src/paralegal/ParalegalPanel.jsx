import React, { useState } from 'react'
import { supabase } from '../supabaseClient'
import { askParalegal } from './paralegal-client.js'

const QUICK_PROMPTS = [
  'What needs my attention first?',
  'Which matters are waiting on someone else?',
  'Summarize where we are on each Need to Set matter.'
]

export default function ParalegalPanel({getSnapshot}) {
  const [open,setOpen]=useState(true)
  const [message,setMessage]=useState('')
  const [messages,setMessages]=useState([])
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')

  async function submit(text = message) {
    const question=String(text||'').trim()
    if(!question||busy)return
    setBusy(true);setError('')
    const prior=messages
    setMessages((current)=>[...current,{role:'user',content:question}])
    setMessage('')
    try {
      const result=await askParalegal({auth:supabase.auth,message:question,history:prior,snapshot:getSnapshot()})
      setMessages((current)=>[...current,{role:'assistant',content:result.text}])
    } catch(error) {
      setError(error.message||String(error))
    } finally { setBusy(false) }
  }

  return <section style={{border:'1px solid #93c5fd',borderRadius:12,background:'#f8fbff',margin:'0 0 16px',overflow:'hidden'}}>
    <button type="button" onClick={()=>setOpen((value)=>!value)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'12px 14px',border:0,borderBottom:open?'1px solid #dbeafe':0,background:'#eff6ff',textAlign:'left'}}>
      <span><strong style={{fontSize:16}}>Paralegal</strong><span style={{marginLeft:8,fontSize:11,fontWeight:800,color:'#1d4ed8',border:'1px solid #93c5fd',borderRadius:999,padding:'2px 7px'}}>Claude · read-only preview</span></span>
      <span>{open?'▾':'▸'}</span>
    </button>
    {open&&<div style={{padding:14}}>
      <p style={{margin:'0 0 10px',color:'#475569',fontSize:13}}>Ask about Need to Set. This first preview can read the current workflow and suggest next steps; it cannot send email, change your calendar, file anything, or mark a step complete.</p>
      {!messages.length&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>{QUICK_PROMPTS.map((prompt)=><button type="button" key={prompt} disabled={busy} onClick={()=>submit(prompt)} style={{fontSize:12}}>{prompt}</button>)}</div>}
      {!!messages.length&&<div style={{maxHeight:320,overflowY:'auto',display:'grid',gap:8,marginBottom:10}}>{messages.map((item,index)=><div key={`${item.role}-${index}`} style={{justifySelf:item.role==='user'?'end':'start',maxWidth:'88%',padding:'8px 10px',borderRadius:10,whiteSpace:'pre-wrap',background:item.role==='user'?'#dbeafe':'#fff',border:'1px solid #dbe4ee'}}><strong style={{fontSize:11,color:'#64748b'}}>{item.role==='user'?'You':'Paralegal'}</strong><div>{item.content}</div></div>)}</div>}
      {error&&<p role="alert" style={{color:'#b91c1c',margin:'6px 0'}}>{error}</p>}
      <div style={{display:'flex',gap:8}}><input value={message} onChange={(event)=>setMessage(event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void submit()}}} placeholder="Ask about Need to Set..." disabled={busy} style={{flex:1}}/><button type="button" onClick={()=>void submit()} disabled={busy||!message.trim()} style={{background:'#2563eb',color:'#fff',fontWeight:800}}>{busy?'Checking...':'Ask'}</button></div>
    </div>}
  </section>
}
