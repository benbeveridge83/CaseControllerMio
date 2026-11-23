// Keep the monolithic App integration small and fail builds if an anchor changes.
export function mountClientPortal(source){
 const patch=(anchor,replacement)=>{if(!source.includes(anchor))throw new Error('Client portal mount anchor missing: '+anchor.slice(0,90));source=source.replace(anchor,replacement)}
 source="import StaffPortal from './portal/StaffPortal.jsx'\nimport './portal/portal.css'\n"+source
 patch('const appPages = [',"const appPages = [\n  {value:'client_portal',label:'Client Portal'},")
 const helper=[
 "  const portalStaffApi = useCallback(async (action, body = {}) => {",
 "    const {data} = await supabase.auth.getSession()",
 "    if (!data?.session?.access_token) throw new Error('Sign in to Mio first.')",
 "    const payload = {action,...body}",
 "    if (['invite','staff_send_intake'].includes(action)) { try {payload.graph_token=await getMicrosoftGraphToken()} catch {} }",
 "    const r=await fetch('/api/client-portal',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify(payload)})",
 "    const p=await r.json();if(!r.ok)throw new Error(p.error||'Portal request failed.');return p",
 "  },[serviceGraphConfig,serviceGraphAuth,page])",
 "  function renderStaffClientPortal(matter = null) {",
 "    return <StaffPortal matterId={matter?.id||''} matters={matters} api={portalStaffApi} templates={draftingIntakeTemplates}",
 "      onPrepareAgreement={m=>mioPnc.open(m,'agreement')}",
 "      onAssignIntake={async (m,t)=>draftingAuthenticatedApi('/api/client-intake',{method:'POST',body:JSON.stringify({action:'create',matter_id:m.id,matter_name:m.name||'',client_name:matterClientName(m),recipient_email:m.clients?.email||'',expires_days:60,template_snapshot:draftingNormalizeIntakeTemplate(t),title:t.name})})} />",
 "  }",""
 ].join('\n')
 patch('  function renderClientDashboardFeeAgreement(matter) {',helper+'  function renderClientDashboardFeeAgreement(matter) {')
 const page="        {page === 'billing' && canOpenPage('billing') && renderBillingPage()}"
 patch(page,"        {page === 'client_portal' && isFirmStaffMember() && canOpenPage('client_portal') && renderStaffClientPortal()}\n\n"+page)
 const tab="                  <button\n                    type=\"button\"\n                    onClick={() => setClientDashboardTab('fee_agreement')}"
 patch(tab,"                  {isFirmStaffMember() && <button type=\"button\" onClick={()=>setClientDashboardTab('client_portal')} style={{padding:'8px 14px',border:'1px solid #c8d0d8',background:clientDashboardTab==='client_portal'?'#2f6584':'white',color:clientDashboardTab==='client_portal'?'white':'#1f2d3d'}}>Client Portal</button>}\n"+tab)
 const panel="                {clientDashboardTab === 'matter_information' && renderClientDashboardMatterInformation(selectedTemplateMatter())}"
 patch(panel,"                {clientDashboardTab === 'client_portal' && isFirmStaffMember() && renderStaffClientPortal(selectedTemplateMatter())}\n\n"+panel)
 return source
}
export default function clientPortalMount(){return {name:'mio-client-portal',enforce:'pre',transform(code,id){if(!id.replaceAll('\\','/').endsWith('/src/App.jsx'))return null;return {code:mountClientPortal(code),map:null}}}}
