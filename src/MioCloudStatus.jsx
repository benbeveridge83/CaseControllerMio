import React from 'react'
const label=key=>key.replace(/^caseMioStickyFilter:/,'').replace(/^(caseMio|caseController)/,'').replace(/V\d+$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase())
// Bottom-right notice. Saved work has no notice at all; a finished save only shows a
// small "Saving changes" pill, and the detailed card is reserved for a save that did
// not complete or a record this window resolved to its cloud version.
const base={position:'fixed',bottom:12,right:12,zIndex:2147483000,maxWidth:'min(420px, calc(100vw - 24px))',maxHeight:'50vh',overflow:'auto',color:'#172033',fontFamily:'system-ui,Segoe UI,Roboto,sans-serif',fontSize:13}
const pill={...base,background:'#0f172a',color:'#f8fafc',borderRadius:999,padding:'8px 14px',display:'flex',alignItems:'center',gap:10,boxShadow:'0 8px 24px rgba(15,23,42,.18)'}
const card={...base,background:'#fff',border:'1px solid #cbd5e1',borderRadius:10,padding:'12px 14px',lineHeight:1.5,boxShadow:'0 10px 30px rgba(15,23,42,.14)'}
const button={border:'1px solid #cbd5e1',background:'#fff',color:'#1e293b',borderRadius:7,padding:'5px 10px',fontFamily:'inherit',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}
const pillButton={...button,background:'transparent',borderColor:'#64748b',color:'#f8fafc'}
export default function MioCloudStatus({status,busy,onRetry,onPreserve,onUseCloud,onReload}){
  if(!status.pending&&!status.remoteChanged)return null
  const conflicts=status.conflictKeys||[],problem=!!status.pending&&!!status.error
  if(!problem)return <aside aria-live="polite" aria-label="Cloud save status" style={pill}>{status.pending?<span>Saving changes…</span>:<><span>Newer saved data is available.</span><button type="button" disabled={busy} onClick={onReload} style={pillButton}>Refresh saved data</button></>}</aside>
  const items=status.pendingKeys||[]
  return <aside aria-live="polite" aria-label="Cloud save status" style={card}>
    <strong>{`${status.pending} unsaved item${status.pending===1?'':'s'}`}</strong>
    <p style={{margin:'5px 0 8px'}}>{conflicts.length?'Another tab saved a newer version. Your pending edits are still protected in this tab.':'The save has not completed. Keep this tab open until it is saved or backed up.'}</p>
    <ul style={{margin:'0 0 10px',paddingLeft:18}}>{items.map(key=><li key={key}><span title={key}>{label(key)}</span>{conflicts.includes(key)&&<> — <button type="button" disabled={busy} onClick={()=>onUseCloud(key)} style={button}>Use newer cloud version</button></>}</li>)}</ul>
    {!conflicts.length&&<><p role="alert" style={{margin:'0 0 8px',color:'#9a3412'}}>{status.error}</p><button type="button" disabled={busy} onClick={onRetry} style={button}>Retry save</button>{' '}</>}
    <button type="button" disabled={busy} onClick={onPreserve} style={button}>Preserve my edits and reload</button>
    <p style={{fontSize:11.5,margin:'8px 0 0',color:'#64748b'}}>Preserve saves a verified backup; it does not apply these edits to the active records. Save any open form before reloading.</p>
  </aside>
}

