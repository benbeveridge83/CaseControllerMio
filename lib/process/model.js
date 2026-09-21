export const TYPES = {
  email:{label:'Email',icon:'✉',color:'#2563eb'},
  calendar:{label:'Calendar',icon:'▦',color:'#7c3aed'},
  draft:{label:'Draft document',icon:'▤',color:'#0891b2'},
  efile:{label:'E-file / E-serve',icon:'↥',color:'#c2410c'},
  save:{label:'Save file',icon:'▣',color:'#15803d'}
}
export const clone = value => JSON.parse(JSON.stringify(value))
export const newId = prefix => prefix+'_'+crypto.randomUUID().replaceAll('-','')
export const MATTER_FIELDS = ['client_name','client_email','opposing_counsel_name','opposing_counsel_email','opposing_party_name','opposing_party_email','court_name','court_email','cause_number','matter_name']
export function newProcess(){return {schemaVersion:1,id:newId('process'),name:'New process',pageName:'New process',fields:[],blocks:[],edges:[]}}
export function newBlock(type,id=newId(type)){
  if(!TYPES[type])throw Error('Unknown block type')
  const config={
    email:{from:'',to:'{{matter.court_email}}',cc:'',subject:'{{matter.cause_number}} — Hearing dates',body:'Hello {{matter.court_name}},\n\nPlease provide available hearing dates for {{matter.matter_name}}.',attachments:'',review:true,waitForReply:true},
    calendar:{calendar:'',candidates:'',duration:60,before:0,after:0,timeZone:'America/Chicago',workingStart:'09:00',workingEnd:'17:00',tentativeBusy:true,allDayBusy:true,review:true},
    draft:{templateId:'',fieldMappings:'',format:'docx',review:true},
    efile:{mode:'both',documents:'',court:'{{matter.court_name}}',cause:'{{matter.cause_number}}',filingCode:'',recipients:'{{matter.opposing_counsel_email}}',paymentAccount:'',review:true},
    save:{documents:'',destination:'matter',folder:'',filename:'{{matter.cause_number}} - Document',conflict:'version',review:false}
  }[type]
  return {id,type,name:TYPES[type].label,stepNumber:1,position:{x:80,y:70},activation:'row_created',join:'all',config,
    completion:type==='email'?'field':'action',output:{key:id+'_result',label:type==='email'?'Response details':'Result',type:type==='email'?'text':type==='calendar'?'date_windows':'documents'},
    messages:{input:'Provide missing information',review:'Review '+TYPES[type].label.toLowerCase(),waiting:type==='email'?'Waiting for a response':'Waiting for processing',reply:'Read the response and enter the result',complete:'Step complete'},
    billing:{enabled:false,description:'',minutes:0}}
}
export function renderTokens(template,context){
  const missing=[]
  const text=String(template||'').replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(whole,path)=>{
    const keys=path.trim().split('.')
    let value=context
    for(const key of keys){if(['__proto__','prototype','constructor'].includes(key)||value==null||!Object.hasOwn(value,key)){value=undefined;break}value=value[key]}
    if(value==null||value===''){missing.push(path.trim());return whole}
    return typeof value==='object'?JSON.stringify(value):String(value)
  })
  return {text,missing:[...new Set(missing)]}
}
export function validateDefinition(d){
  const errors=[]
  if(!d||d.schemaVersion!==1||!Array.isArray(d.blocks)||!Array.isArray(d.edges)||!Array.isArray(d.fields))return ['Invalid process format']
  if(!String(d.name||'').trim()||!String(d.pageName||'').trim())errors.push('Process and page names are required')
  if(d.blocks.length>100||d.edges.length>300)errors.push('Use at most 100 blocks and 300 connections')
  const ids=new Set(),outputs=new Set(),validKey=x=>/^[A-Za-z][A-Za-z0-9_]*$/.test(x)
  for(const f of d.fields){if(!validKey(f.key)||outputs.has(f.key))errors.push('Row field keys must be unique valid names');outputs.add(f.key)}
  for(const b of d.blocks){
    if(!validKey(b.id)||ids.has(b.id))errors.push('Blocks need unique valid IDs');ids.add(b.id)
    if(!TYPES[b.type]||!String(b.name||'').trim())errors.push('Choose a block type and name')
    if(!b.position||![b.position.x,b.position.y].every(Number.isFinite))errors.push('Block position must be numeric')
    if(!b.output||!validKey(b.output.key)||outputs.has(b.output.key))errors.push('Output fields need unique valid keys')
    outputs.add(b.output?.key)
    if(!['row_created','predecessors'].includes(b.activation)||!['all','any'].includes(b.join))errors.push('Choose a valid activation rule')
    if(!['field','action'].includes(b.completion))errors.push('Choose a completion rule')
  }
  for(const e of d.edges)if(!ids.has(e.source)||!ids.has(e.target)||e.source===e.target)errors.push('Connection references a missing or identical block')
  const visiting=new Set(),visited=new Set()
  function walk(id){if(visiting.has(id)){errors.push('Connections cannot form a cycle');return}if(visited.has(id))return;visiting.add(id);d.edges.filter(e=>e.target===id).forEach(e=>walk(e.source));visiting.delete(id);visited.add(id)}
  d.blocks.forEach(b=>walk(b.id))
  function ancestors(id,seen=new Set()){for(const e of d.edges.filter(e=>e.target===id))if(!seen.has(e.source)){seen.add(e.source);ancestors(e.source,seen)}return seen}
  for(const b of d.blocks){
    if(b.activation==='predecessors'&&!d.edges.some(e=>e.target===b.id))errors.push(b.name+': connect a preceding block')
    const upstream=ancestors(b.id)
    for(const value of Object.values(b.config||{}).filter(v=>typeof v==='string'))for(const match of value.matchAll(/\{\{\s*blocks\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*\}\}/g)){
      const producer=d.blocks.find(x=>x.id===match[1])
      if(!producer||producer.output.key!==match[2]||!upstream.has(producer.id))errors.push(b.name+': output reference '+match[1]+'.'+match[2]+' needs a connected preceding block')
    }
  }
  return [...new Set(errors)]
}
export function connectBlocks(d,source,target){
  if(d.edges.some(e=>e.source===source&&e.target===target))return d
  const next=clone(d);next.edges.push({id:newId('edge'),source,target})
  const block=next.blocks.find(b=>b.id===target);if(block)block.activation='predecessors'
  const errors=validateDefinition(next).filter(e=>/cycle|Connection references/.test(e));if(errors.length)throw Error(errors.join('; '))
  return next
}
export function removeBlock(d,id){const next=clone(d);next.blocks=next.blocks.filter(b=>b.id!==id);next.edges=next.edges.filter(e=>e.source!==id&&e.target!==id);return next}
export function starterProcess(){
  const d=newProcess();d.name='Need to Set';d.pageName='Need to Set — Process';
  d.fields=[{key:'hearing_details',label:'Confirmed hearing date, time and location',type:'text',required:true}]
  const specs=[['court','email','Request court dates','court_dates'],['calendar','calendar','Compare with my calendar','available_dates'],['client','email','Ask client availability','client_dates'],['counsel','email','Ask opposing counsel','agreed_dates'],['notice','draft','Draft hearing notice','notice_document'],['save','save','Save reviewed notice','saved_notice'],['efile','efile','File and serve notice','filing_result']]
  d.blocks=specs.map(([id,type,name,key],i)=>({...newBlock(type,id),name,stepNumber:i+1,position:{x:80+(i%2)*340,y:70+Math.floor(i/2)*200},activation:i?'predecessors':'row_created',output:{key,label:name+' result',type:i<4?'date_windows':'documents'}}))
  d.edges=specs.slice(1).map((s,i)=>({id:'edge_'+i,source:specs[i][0],target:s[0]}))
  const [court,calendar,client,counsel,notice,save,efile]=d.blocks
  court.messages={...court.messages,review:'Review email to court',waiting:'Waiting for court dates',reply:'Read court reply and enter available dates'}
  calendar.config.candidates='{{blocks.court.court_dates}}'
  client.config.to='{{matter.client_email}}';client.config.body='Hello {{matter.client_name}},\n\nWhich of these hearing dates are you available?\n{{blocks.calendar.available_dates}}'
  counsel.config.to='{{matter.opposing_counsel_email}}';counsel.config.body='Hello {{matter.opposing_counsel_name}},\n\nPlease confirm your availability:\n{{blocks.client.client_dates}}'
  notice.config.fieldMappings='Hearing details: {{row.hearing_details}}\nAgreed options: {{blocks.counsel.agreed_dates}}'
  save.config.documents='{{blocks.notice.notice_document}}';save.config.filename='{{matter.cause_number}} - Notice of hearing'
  efile.config.documents='{{blocks.save.saved_notice}}'
  return d
}
