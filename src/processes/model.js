/** Provider-neutral process graph. Definitions never perform external actions. */
export const TYPES = [
 ['draft_email','Email','\u2709',true,true,'Send email','Waiting for {who} to respond to the email'],
 ['efile_document','E-file','\u2696',true,false,'Prepare e-filing','Waiting for filing acceptance and the file-stamped document'],
 ['mailform','Snail Mail','\u2709',true,false,'Prepare snail mail','Waiting for mailing confirmation'],
 ['esign_document','Signatures','\u270d',true,false,'Send for signatures','Waiting for {who} to sign the document'],
 ['draft_document','Draft document','\u270e',false,false,'Open drafting','Waiting for you to draft the document'],
 ['review_document','Review document','\u2315',false,false,'Review document','Waiting for you to review the document'],
 ['save_file','Save file','\u25a3',true,true,'Save to folder','Waiting for the file to be saved'],
 ['wait','Wait / response','\u231b',false,false,'Record response','Waiting for {who}'],
 ['calendar','Calendar / dates','\u25a6',true,false,'Open calendar','Waiting for court dates or calendar review'],
 ['matter_status','Change status','\u2691',true,false,'Change status','Waiting for you to approve the status change'],
 ['approve','Approval','\u2713',true,false,'Record decision','Waiting for your decision'],
 ['notification','Notification','\u25c9',false,true,'Post notification','Waiting to post notification'],
 ['manual','Manual task','\u2610',false,false,'Record completion','Waiting for you to complete the task']
].map(([id,label,icon,approval,automatic,action,waiting])=>({id,label,icon,approval,automatic,action,waiting}));
export const uid=()=>crypto.randomUUID();
export const copy=x=>JSON.parse(JSON.stringify(x));
export const typeFor=id=>TYPES.find(x=>x.id===id)||TYPES.at(-1);
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(x);
export function makeDefinition(name='New process'){return {id:uid(),version:2,name,revision:0,nodes:[],slots:[]};}
export function makeBlock(type='manual',x=40,y=40){const t=typeFor(type);return {id:uid(),type:t.id,name:t.label,icon:t.icon,x,y,dependsOn:[],join:'all',trigger:'completion',startAt:'',eventName:'',approval:t.approval,automatic:false,completion:['draft_email','esign_document','wait'].includes(type)?'response':'action',waitingOn:type==='draft_email'?'opposing counsel':'the responsible person',messages:{ready:'',approval:'',waiting:'',complete:''},billing:{enabled:false,minutes:6,description:''},config:{documentIds:[],inputSlots:[],outputSlots:[],recipientRole:'opposing_counsel',to:'',cc:'',subject:'',body:'',folder:'',filename:'',templateId:'',statusField:'matter_status',statusValue:''}};}
export function validateDefinition(d,{allowEmpty=false}={}){
 if(!d||d.version!==2||!validId(d.id)||!String(d.name||'').trim()||!Array.isArray(d.nodes))throw Error('A process needs a name and a valid definition.');
 if((!allowEmpty&&!d.nodes.length)||d.nodes.length>100)throw Error('Use 1 to 100 blocks.');
 const ids=new Set(),slots=new Set();
 for(const s of d.slots||[]){if(!validId(s.id)||slots.has(s.id)||!s.name)throw Error('Document slots need unique IDs and names.');slots.add(s.id);}
 for(const n of d.nodes){
  if(!validId(n.id)||ids.has(n.id)||!n.name?.trim()||!TYPES.some(t=>t.id===n.type))throw Error('Each block needs a unique ID, name, and known action.');ids.add(n.id);
  if(!['all','any'].includes(n.join)||!['completion','manual','date','event'].includes(n.trigger)||!['action','response'].includes(n.completion)||typeof n.approval!=='boolean')throw Error('Invalid block settings.');
  if(n.trigger==='date'&&!Number.isFinite(Date.parse(n.startAt)))throw Error('Choose a valid start date.');
  if(n.trigger==='event'&&!n.eventName?.trim())throw Error('Name the trigger event.');
  if(n.automatic&&!typeFor(n.type).automatic)throw Error('This action uses a reviewed workspace and cannot run automatically.');
  if(!Number.isFinite(n.x)||!Number.isFinite(n.y)||n.x<0||n.y<0)throw Error('Invalid block position.');
  if(n.billing?.enabled&&(!Number.isFinite(Number(n.billing.minutes))||Number(n.billing.minutes)<=0||Number(n.billing.minutes)>1440||!n.billing.description?.trim()))throw Error('Billing requires positive minutes (at most 1440) and a description.');
  for(const id of [...(n.config?.inputSlots||[]),...(n.config?.outputSlots||[])])if(!slots.has(id))throw Error('A document slot reference is missing.');
 }
 const visiting=new Set(),visited=new Set(),byId=new Map(d.nodes.map(n=>[n.id,n]));
 for(const n of d.nodes)if(!Array.isArray(n.dependsOn)||new Set(n.dependsOn).size!==n.dependsOn.length||n.dependsOn.some(id=>!ids.has(id)||id===n.id))throw Error('Invalid prerequisite reference.');
 const visit=id=>{if(visiting.has(id))throw Error('Connections cannot form a cycle.');if(visited.has(id))return;visiting.add(id);byId.get(id).dependsOn.forEach(visit);visiting.delete(id);visited.add(id);};d.nodes.forEach(n=>visit(n.id));return d;
}
export function prerequisites(r,n){const x=n.dependsOn.map(id=>r.steps[id]?.status==='complete');return !x.length||(n.join==='any'?x.some(Boolean):x.every(Boolean));}
export function messageFor(r,n){const s=r.steps[n.id],t=typeFor(n.type),messages=n.messages||{};const defaults={approval:'Waiting for you to approve '+n.name.toLowerCase(),ready:s.performedAt||s.responseReference?'Waiting for you to review the result of '+n.name.toLowerCase():'Waiting for you to '+t.action.toLowerCase(),waiting:t.waiting,complete:n.name+' completed',running:'Action started; awaiting its result. Do not repeat it.',error:s.error||'Action result needs review.'};return String(s.status==='waiting'&&s.waitingMessage||messages[s.status]||defaults[s.status]||'Waiting for prerequisites').replaceAll('{who}',n.waitingOn||'the responsible person').replaceAll('{matter}',r.matterName||'').replaceAll('{block}',n.name);}
function record(r,n,type,at,extra={}){r.history.push({id:uid(),nodeId:n?.id||'',name:n?.name||r.name,icon:n?.icon||'\u25c9',type,at,...extra});}
function activate(r,at){if(r.status!=='active')return r;for(const n of r.definition.nodes){const s=r.steps[n.id];if(s.status!=='blocked'||!prerequisites(r,n))continue;const start=n.trigger==='completion'||n.trigger==='manual'&&s.manualStarted||n.trigger==='date'&&Date.parse(at)>=Date.parse(n.startAt)||n.trigger==='event'&&s.signalReceived;if(start){s.status=n.approval?'approval':n.type==='wait'?'waiting':'ready';s.enteredAt=at;record(r,n,'activated',at,{message:messageFor(r,n)});}}if(r.definition.nodes.every(n=>r.steps[n.id].status==='complete')){r.status='complete';r.completedAt=at;}return r;}
export function startRun(def,matter,at=new Date().toISOString()){validateDefinition(def);if(!matter?.id)throw Error('Choose a matter.');const r={id:uid(),name:def.name,matterId:String(matter.id),matterName:matter.name||'',definition:copy(def),revision:0,status:'active',startedAt:at,steps:{},history:[],seen:[],documents:{}};for(const n of def.nodes)r.steps[n.id]={status:'blocked',enteredAt:at,config:copy(n.config||{}),approvedAt:null,billingId:null};record(r,null,'started',at);return activate(r,at);}
function requiredDocs(r,s,output=false){for(const id of [...(s.config.inputSlots||[]),...(output?s.config.outputSlots||[]:[])])if(!r.documents[id]?.verified)throw Error('Verify the required document: '+(r.definition.slots.find(x=>x.id===id)?.name||id));}
export function reduceRun(current,e,at=new Date().toISOString()){
 if(!e?.id||!e.type)throw Error('An event ID and type are required.');if(current.seen.includes(e.id))return current;
 const n=current.definition.nodes.find(n=>n.id===e.nodeId),old=n&&current.steps[n.id];
 if(old?.status==='complete'&&['complete','success','signal'].includes(e.type))return current;
 if(['cancelled','complete'].includes(current.status)&&!['note','billed'].includes(e.type))throw Error('This process is closed.');
 if(current.status==='paused'&&!['resume','note','success','failure','handoff','signal','billed'].includes(e.type))throw Error('This process is paused.');
 const r=copy(current),s=n&&r.steps[n.id],need=()=>{if(!s)throw Error('Choose a block.');},reference=()=>{if(!e.reference?.trim())throw Error('Record the actual action or document reference.');};
 const complete=()=>{requiredDocs(r,s,true);s.status='complete';s.enteredAt=at;s.completedAt=at;s.performedAt=s.performedAt||at;s.reference=e.reference;record(r,n,'completed',at,{reference:e.reference,message:n.messages?.complete||n.name+' completed'});};
 switch(e.type){
 case'tick':break;
 case'pause':r.status='paused';record(r,null,'paused',at);break;
 case'resume':r.status='active';record(r,null,'resumed',at);break;
 case'cancel':if(!e.confirmed)throw Error('Confirm cancellation.');r.status='cancelled';record(r,null,'cancelled',at);break;
 case'approve':need();if(s.status!=='approval')throw Error('Not awaiting approval.');s.approvedAt=at;s.status=n.type==='wait'?'waiting':'ready';s.enteredAt=at;record(r,n,'approved',at);break;
 case'configure':need();if(s.performedAt||s.responseReference||!['blocked','approval','ready','error'].includes(s.status))throw Error('Cannot edit an action after it started.');s.config={...s.config,...copy(e.config||{})};if(n.approval&&s.status!=='blocked'){s.status='approval';s.approvedAt=null;s.enteredAt=at;}record(r,n,'configured',at);break;
 case'document':need();if(!e.confirmed||!e.document?.id||String(e.document.matter_id)!==r.matterId||!r.definition.slots.some(x=>x.id===e.slotId))throw Error('Choose and verify an actual document from this matter.');for(const consumer of r.definition.nodes){const state=r.steps[consumer.id];if(!(state.config.inputSlots||[]).includes(e.slotId))continue;if(r.documents[e.slotId]?.id!==String(e.document.id)&&(['running','waiting','complete'].includes(state.status)||state.performedAt))throw Error('This input has already been used by a started action; retain it and use a new document slot.');if(consumer.approval&&state.status==='ready'){state.status='approval';state.approvedAt=null;state.enteredAt=at;}}
 r.documents[e.slotId]={id:String(e.document.id),name:e.document.file_name||e.document.name||'Document',matterId:r.matterId,verified:true,at};record(r,n,'document_verified',at,{reference:String(e.document.id)});break;
 case'start':need();if(n.trigger!=='manual'||!prerequisites(r,n)||s.status!=='blocked')throw Error('Complete prerequisites before starting this block.');s.manualStarted=true;break;
 case'claim':need();if(s.status!=='ready'||s.performedAt||s.responseReference)throw Error('The action must be ready and not already running.');requiredDocs(r,s);if(n.approval&&!s.approvedAt)throw Error('Approval is required.');s.status='running';s.enteredAt=at;s.actionKey=r.id+':'+n.id;record(r,n,'action_started',at);break;
 case'handoff':need();if(s.status!=='running')throw Error('No running action.');reference();s.status='waiting';s.enteredAt=at;s.reference=e.reference;s.waitingMessage=e.message||typeFor(n.type).waiting;record(r,n,'workspace_opened',at,{reference:e.reference,message:s.waitingMessage});break;
 case'failure':need();if(s.status!=='running')throw Error('No running action.');s.status='error';s.enteredAt=at;s.error=e.message||'Result uncertain. Check the provider before retrying.';record(r,n,'error',at,{message:s.error});break;
 case'success':need();if(s.status!=='running')throw Error('No running action.');reference();s.performedAt=at;s.reference=e.reference;s.receipt=e.receipt||{};s.enteredAt=at;record(r,n,'action_succeeded',at,{reference:e.reference});if(n.completion==='response'||(s.config.outputSlots||[]).some(id=>!r.documents[id]?.verified)){s.status='waiting';s.waitingMessage='';}else complete();break;
 case'complete':need();if(!e.confirmed||!['ready','waiting','error','running'].includes(s.status))throw Error('Complete prerequisites and approval before confirming actual work.');reference();complete();break;
 case'wait':need();if(!['ready','waiting'].includes(s.status)||!e.message?.trim())throw Error('Describe what is awaited on a ready step.');s.status='waiting';s.enteredAt=at;s.waitingMessage=e.message;record(r,n,'waiting',at,{message:e.message});break;
 case'signal':need();reference();if(n.trigger==='event'&&e.signal===n.eventName)s.signalReceived=at;if(s.status==='waiting'&&e.confirmed){s.status='ready';s.enteredAt=at;s.responseReference=e.reference;record(r,n,'response_received',at,{reference:e.reference});}break;
 case'retry':need();if(!['error','running'].includes(s.status)||!e.confirmed)throw Error('Check the provider and confirm the action did not happen before retrying.');reference();s.status=n.approval?'approval':'ready';s.approvedAt=null;s.error='';record(r,n,'retry_authorized',at,{reference:e.reference});break;
 case'note':if(!e.message?.trim())throw Error('Enter a note.');record(r,n,'note',at,{message:e.message});break;
 case'billed':need();if(!s.performedAt||!e.billingId)throw Error('Billing requires a successful action.');if(s.billingId)return current;s.billingId=e.billingId;record(r,n,'billed',at,{billingId:e.billingId,minutes:n.billing.minutes,description:n.billing.description});break;
 default:throw Error('Unknown process event.');}
 r.seen.push(e.id);return activate(r,at);
}
export function billingIntent(r,id){const n=r.definition.nodes.find(n=>n.id===id),s=r.steps[id];return n?.billing?.enabled&&s?.performedAt&&!s.billingId?{id:'process:'+r.id+':'+id,nodeId:id,matterId:r.matterId,minutes:Number(n.billing.minutes),description:n.billing.description,at:s.performedAt}:null;}
export function attention(r){if(['complete','cancelled'].includes(r.status))return [];if(r.status==='paused')return [{nodeId:'',status:'paused',message:'Process paused',needsMe:false,since:r.startedAt}];return r.definition.nodes.flatMap(n=>{const s=r.steps[n.id];if(s.status==='complete')return [];let message=messageFor(r,n);if(s.status==='blocked'){if(!prerequisites(r,n)||n.trigger==='completion')return [];message=n.trigger==='manual'?'Waiting for you to start '+n.name:n.trigger==='date'?'Waiting until '+new Date(n.startAt).toLocaleString():'Waiting for event: '+n.eventName;}return [{nodeId:n.id,icon:n.icon,name:n.name,status:s.status,message,who:['approval','ready','error'].includes(s.status)?'You':n.waitingOn,needsMe:['approval','ready','error'].includes(s.status)||s.status==='blocked'&&n.trigger==='manual',since:s.enteredAt}];}).sort((a,b)=>Number(b.needsMe)-Number(a.needsMe)||Date.parse(a.since)-Date.parse(b.since));}
export function fromWithdrawal(legacy){const d=makeDefinition(legacy?.name||'Withdrawal');d.slots=copy(legacy?.slots||[]);d.source='withdrawal';d.nodes=(legacy?.steps||[]).map((s,i)=>{const n=makeBlock(s.action==='finish'?'manual':s.action,40+(i%4)*260,40+Math.floor(i/4)*170);return {...n,id:s.id,name:s.name,dependsOn:s.depends_on||[],join:s.dependency_mode||'all',trigger:s.manual_start?'manual':'completion',config:{...n.config,inputSlots:s.input_slots||[],outputSlots:s.output_slots||[],recipientRole:s.recipient_roles?.[0]||'client',templateId:s.template_id||'',statusField:s.target_field||'matter_status',statusValue:s.target_value||''}};});return d;}

// V314 successful-action review and input guards
