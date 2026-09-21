export function Field({label,value='',onChange,multiline=false,type='text',options,help,disabled=false}){
  return <label className="mp-field"><span>{label}</span>{options?<select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>:multiline?<textarea aria-label={label} rows={5} value={value} onChange={e=>onChange(e.target.value)}/>:<input aria-label={label} type={type} min={type==='number'?0:undefined} value={value} onChange={e=>onChange(type==='number'?Number(e.target.value):e.target.value)}/>} {help&&<small>{help}</small>}</label>
}
export default function BlockTypeFields({block,templates=[],onChange}){
  const c=block.config,patch=(key,value)=>onChange({...c,[key]:value})
  const field=(key,label,props={})=><Field key={key} label={label} value={c[key]??''} onChange={v=>patch(key,v)} {...props}/>
  const yesNo=(key,label,help)=><Field label={label} value={c[key]?'yes':'no'} options={[["yes","Yes"],["no","No"]]} onChange={v=>patch(key,v==='yes')} help={help}/>
  if(block.type==='email')return <>
    {field('from','From mailbox',{help:'For example ben@beveridgelawfirm.com or office@beveridgelawfirm.com. Live sending requires permission for this mailbox.'})}
    {field('to','To',{help:'Use email addresses or merge fields; separate multiple recipients with semicolons.'})}{field('cc','CC')}
    {field('subject','Subject')}{field('body','Email body',{multiline:true})}{field('attachments','Attachments',{help:'Insert a document output from a preceding block.'})}
    {yesNo('review','Review before sending','No means send on activation when live execution is connected and enabled.')}
    {yesNo('waitForReply','Wait for reply')}
  </>
  if(block.type==='calendar')return <>
    {field('candidates','Candidate dates / input')}{field('calendar','Calendar / mailbox',{help:'One or more calendar identifiers, separated by semicolons.'})}
    {field('timeZone','Timezone')}{field('duration','Hearing duration (minutes)',{type:'number'})}
    <div className="mp-two">{field('before','Buffer before (minutes)',{type:'number'})}{field('after','Buffer after (minutes)',{type:'number'})}</div>
    <div className="mp-two">{field('workingStart','Working hours start',{type:'time'})}{field('workingEnd','Working hours end',{type:'time'})}</div>
    {yesNo('tentativeBusy','Treat tentative events as busy')}{yesNo('allDayBusy','Treat all-day events as busy')}{yesNo('review','Review available dates')}
  </>
  if(block.type==='draft')return <>
    {field('templateId','Drafting template',{options:[['','Choose a template'],...templates.filter(t=>t.is_active!==false&&t.status!=='retired').map(t=>[String(t.id),t.name||String(t.id)])]})}
    {!templates.length&&<p className="mp-note">No active templates loaded. Your existing Drafting templates appear here when available.</p>}
    {field('fieldMappings','Template field values / mappings',{multiline:true,help:'Describe the template fields and insert the matter, row, or previous-block values they use.'})}
    {field('format','Output format',{options:[['docx','Editable Word document'],['pdf','PDF — requires conversion'],['both','Word and PDF — requires conversion']]})}
    {yesNo('review','Review draft before completion')}
  </>
  if(block.type==='efile')return <>
    {field('mode','Filing action',{options:[['file','E-file only'],['serve','E-serve only'],['both','E-file and E-serve']]})}
    {field('documents','Input documents')}{field('court','Court')}{field('cause','Cause number')}{field('filingCode','Filing code')}
    {field('recipients','Service recipients')}{field('paymentAccount','Payment account reference',{help:'Store an account name or provider reference, never card details.'})}
    <p className="mp-note">Final review is required for filing/service in version one. Opening a filing package is not proof of acceptance.</p>
  </>
  return <>{field('documents','Input documents')}
    {field('destination','Save destination',{options:[['matter','Matter documents'],['onedrive','OneDrive folder']]})}
    {c.destination==='onedrive'&&field('folder','OneDrive folder reference')}
    {field('filename','Filename pattern')}{field('conflict','If the filename exists',{options:[['version','Create a new version'],['ask','Ask me']]})}
    {yesNo('review','Review before saving')}
  </>
}
