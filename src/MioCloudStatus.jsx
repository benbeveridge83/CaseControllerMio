import React from 'react'
const label=key=>key.replace(/^caseMioStickyFilter:/,'').replace(/^(caseMio|caseController)/,'').replace(/V\d+$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase())
export default function MioCloudStatus({status,busy,onRetry,onPreserve,onUseCloud,onReload}){
  if(!status.pending&&!status.remoteChanged)return null
  const conflicts=status.conflictKeys||[],problem=!!status.pending&&!!status.error
  return <aside aria-live="polite" aria-label="Cloud save status" style={{position:'fixed',bottom:12,right:12,zIndex:2147483000,maxWidth:'min(460px, calc(100vw - 24px))',maxHeight:'50vh',overflow:'auto',background:problem?'#fff7ed':'#eff6ff',color:'#172033',border:'1px solid #94a3b8',padding:10,borderRadius:8,fontFamily:'system-ui',fontSize:13}}>
    {status.pending?<>
      <strong>{problem?`${status.pending} unsaved item${status.pending===1?'':'s'}`:'Saving changes…'}</strong>
      {problem&&<><p>{conflicts.length?'Another tab saved a newer version. Your pending edits are still protected in this tab.':'The save has not completed. Keep this tab open until it is saved or backed up.'}</p>
        <ul>{(status.pendingKeys||[]).map(key=><li key={key}><span title={key}>{label(key)}</span>{conflicts.includes(key)&&<> — <button disabled={busy} onClick={()=>onUseCloud(key)}>Use newer cloud version</button></>}</li>)}</ul>
        {!conflicts.length&&<><p role="alert">{status.error}</p><button disabled={busy} onClick={onRetry}>Retry save</button>{' '}</>}
        <button disabled={busy} onClick={onPreserve}>Preserve my edits and reload</button>
        <p style={{fontSize:12,marginBottom:0}}>Recovery keeps a verified backup; it does not apply the pending edits to the active records. Save any open form before reloading.</p>
      </>}
    </>:<>Newer saved data is available.{' '}<button disabled={busy} onClick={onReload}>Refresh saved data</button></>}
  </aside>
}
