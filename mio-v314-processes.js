import fs from 'node:fs';
const adapter=fs.readFileSync(new URL('./src/processes/appAdapters.inc',import.meta.url),'utf8');
function once(code,from,to,label){if(code.split(from).length!==2)throw Error('V314 integration anchor changed: '+label);return code.replace(from,()=>to);}
export default function mioProcesses(){return {name:'mio-v314-processes',enforce:'pre',transform(source,id){
 const path=id.split('?')[0].replaceAll('\\','/');let code=source;
 if(path.endsWith('/src/MioWithdrawalBlocks.jsx'))return {code:once(code,'<h2>Withdrawal settings</h2>','<h2>Withdrawal settings</h2><a href="#processes">Open Processes designer</a>','withdrawal entry point'),map:null};
 if(!path.endsWith('/src/App.jsx'))return null;
 code="import MioProcesses from './processes/Processes.jsx'\nimport {actions as mioCreateProcessActions} from './processes/actions.js'\nimport {defaultWithdrawalDefinition as mioDefaultWithdrawalDefinition} from './mioWorkflowBlocks.js'\nimport {mioStorage as mioProcessStorage} from './mioCloudRuntime.js'\nimport {definitionKey as mioProcessWithdrawalKey} from './mioWithdrawalBlockHelpers.js'\n"+code;
 code=once(code,"  { value: 'workflow', label: 'Workflow' },","  { value: 'processes', label: 'Processes' },\n  { value: 'workflow', label: 'Workflow' },",'page registry');
 code=once(code,'  function getAllowedPages(member = currentTeamMember) {','  function getAllowedPagesLegacyV314(member = currentTeamMember) {','existing access logic');
 code=once(code,'  function canOpenPage(pageName) {',"  function getAllowedPages(member = currentTeamMember) { const pages=getAllowedPagesLegacyV314(member);return !isClientPortalMember(member)&&(pages.includes('workflow')||pages.includes('withdrawals'))?[...new Set([...pages,'processes'])]:pages }\n  function canOpenPage(pageName) {",'compatible staff access');
 code=once(code,"        {canOpenPage('workflow') && (","        {canOpenPage('processes') && <a href=\"#processes\" onClick={e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();setPage('processes')}} style={{display:'block',marginBottom:10,fontWeight:page==='processes'?900:undefined}}>Processes</a>}\n        {canOpenPage('workflow') && (",'sidebar');
 code=once(code,'  function renderDailyBillingModal() {',adapter+'\n  function renderDailyBillingModal() {','action adapters');
 code=once(code,"        {page === 'orders' && canOpenPage('orders') && renderOrdersPage()}","        {page === 'processes' && canOpenPage('processes') && <MioProcesses key={session?.user?.id} client={supabase} owner={session?.user?.id} context={mioProcessContext()} />}\n        {page === 'orders' && canOpenPage('orders') && renderOrdersPage()}",'page route');
 code=once(code,'Mio V313 (daily trust + PNC workflow)','Mio V314 (visual process builder)','release label');
 return {code,map:null};
}};}
