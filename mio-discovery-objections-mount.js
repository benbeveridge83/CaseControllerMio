function once(code,from,to,label){if(code.split(from).length!==2)throw new Error('Discovery objections mount anchor changed: '+label);return code.replace(from,()=>to)}
export default function discoveryObjectionsMount(){return{name:'mio-discovery-objections-mount',enforce:'pre',transform(source,id){
  if(!id.split('?')[0].replaceAll('\\','/').endsWith('/src/App.jsx'))return null
  let code="import { lazy as discoLazy, Suspense as DiscoSuspense } from 'react'\nconst DiscoveryObjections = discoLazy(() => import('./DiscoveryObjections.jsx'))\n"+source
  code=once(code,"<div style={{ fontFamily: 'Arial', display: 'flex', width: '100vw', maxWidth: 'none', margin: 0 }}>","<div className={page === 'discovery_objections' ? 'mio-discovery-shell' : undefined} style={{ fontFamily: 'Arial', display: 'flex', width: '100vw', maxWidth: 'none', margin: 0 }}>",'responsive page shell')
  code=once(code,"  { value: 'discovery', label: 'Discovery' },","  { value: 'discovery', label: 'Discovery' },\n  { value: 'discovery_objections', label: 'Discovery Objections' },",'page registration')
  const nav="        {canOpenPage('documents') && ("
  code=once(code,nav,`        {canOpenPage('discovery_objections') && isFirmStaffMember() && (
          <a href="#discovery_objections" onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); setPage('discovery_objections') }} style={{ display: 'block', marginBottom: 10, fontWeight: page === 'discovery_objections' ? 900 : undefined, color: page === 'discovery_objections' ? '#16746f' : undefined }}>Discovery Objections</a>
        )}

`+nav,'sidebar')
  const page="        {page === 'discovery' && canOpenPage('discovery') && ("
  code=once(code,page,`        {page === 'discovery_objections' && canOpenPage('discovery_objections') && isFirmStaffMember() && <DiscoSuspense fallback={<p>Loading discovery walkthrough…</p>}><DiscoveryObjections key={session?.user?.id} session={session} /></DiscoSuspense>}

`+page,'route')
  code=once(code,'            <h1>Discovery</h1>',`            <h1>Discovery</h1>
            {isFirmStaffMember() && <button type="button" onClick={() => setPage('discovery_objections')} style={{ marginBottom: 16, padding: '9px 14px', borderRadius: 7, border: '1px solid #16746f', background: '#edf7f5', color: '#12615c', fontWeight: 700 }}>Discovery objection walkthrough →</button>}`,'discovery entry')
  return{code,map:null}
}}}
