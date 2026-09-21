import React from 'react'
import {mioStartupDiagnostics,mioStartupDiagnosticsEnabled,mioStartupProgress} from './mioStartupView.js'
// Customer-facing startup screen. Build numbers, record counters, and tab-reuse
// diagnostics appear only when diagnostics are enabled (see mioStartupView.js).
const outer={minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc',color:'#172033',fontFamily:'system-ui,Segoe UI,Roboto,sans-serif',padding:24}
const card={width:'min(540px,100%)',background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,boxShadow:'0 18px 50px rgba(15,23,42,.10)',padding:'30px 32px',textAlign:'center',lineHeight:1.6}
const heading={fontSize:20,fontWeight:700,letterSpacing:'-.2px',color:'#0f172a',margin:'0 0 6px'}
const detail={color:'#475569',fontSize:14,margin:0}
const quietButton={marginTop:18,border:'1px solid #cbd5e1',background:'#fff',color:'#334155',borderRadius:8,padding:'7px 14px',fontFamily:'inherit',fontSize:13,cursor:'pointer'}
export function MioStartupBrand(){
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,marginBottom:18}}><span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:38,height:38,borderRadius:11,background:'#0f172a',color:'#fff',fontWeight:800,fontSize:19}}>M</span><span style={{textAlign:'left'}}><span style={{display:'block',fontWeight:800,fontSize:20,color:'#0f172a'}}>Mio</span><span style={{display:'block',fontSize:11,textTransform:'uppercase',letterSpacing:1.2,color:'#64748b',fontWeight:700}}>Case Controller</span></span></div>
}
export default function MioStartupScreen({heading:title,message,progress,action}){
  const steps=mioStartupProgress(progress),showDiagnostics=mioStartupDiagnosticsEnabled()
  return <main style={outer}><section style={card}><MioStartupBrand/><h1 style={heading}>{title}</h1>{message&&<p style={detail}>{message}</p>}{progress!==undefined&&<div role="status" data-mio-startup="loading" style={{marginTop:18,fontSize:13,color:'#475569'}}><div style={{height:4,borderRadius:999,background:'#e2e8f0',overflow:'hidden'}}><div style={{height:'100%',borderRadius:999,background:'#2563eb',transition:'width .3s ease',width:steps.indeterminate?'35%':steps.percent+'%'}}/></div><p style={{margin:'10px 0 0'}}>{steps.text}</p></div>}{showDiagnostics&&<p style={{margin:'10px 0 0',fontSize:11,color:'#94a3b8'}}>{mioStartupDiagnostics(progress)}</p>}{action&&<button type="button" style={quietButton} disabled={!!action.disabled} onClick={action.onClick}>{action.label}</button>}</section></main>
}
