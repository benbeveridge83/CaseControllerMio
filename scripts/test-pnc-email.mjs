import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'
import {createServer} from 'vite'
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/#matters'})
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true})
const {createRoot}=await import('react-dom/client')
const server=await createServer({server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true}}),root=createRoot(document.getElementById('root'))
const matter={id:'matter-a',name:'Sample PNC',client_id:'client',matter_status:'PNC- Need to Consult',clients:{first_name:'Sample',last_name:'Person',email:'corrected@example.test'}}
let ctrl,authCalls=[],apiCalls=[],graphCalls=[],authFails=false,networkFails=false
let workflow={matter_id:matter.id,revision:0,config:{consult_subject:'Consultation',consult_body:'Hello {{client_name}}',sender_email:'billing@example.test'},state:{}}
const props={session:{user:{id:'owner',email:'ben@example.test'},access_token:'fixture'},enabled:false,matters:[matter],clients:[matter.clients],refreshMatters:async()=>{},refreshClients:async()=>{},supabase:{},ensureEmailAccess:async opts=>{authCalls.push(opts);if(authFails)throw Error('Sign in required');return 'test-token'},graphFetch:async(path,options)=>{graphCalls.push({path,options});if(networkFails)throw Error('Connection lost');return null}}
const originalFetch=globalThis.fetch
globalThis.fetch=async(url,options)=>{
 const b=JSON.parse(options.body);apiCalls.push(b)
 if(b.action==='list')return {ok:true,json:async()=>({rows:[workflow]})}
 if(b.action==='claim_delivery')workflow={...workflow,state:{...workflow.state,[b.kind+'_delivery']:{status:'sending',reference:'attempt-'+apiCalls.length,recipient:matter.clients.email}}}
 if(b.action==='record_delivery')workflow={...workflow,state:{...workflow.state,[b.kind+'_delivery']:{...workflow.state[b.kind+'_delivery'],status:'sent'}}}
 return {ok:true,json:async()=>({workflow})}
}
try {
 const {useMioPnc,MioPncModal}=await server.ssrLoadModule('/src/MioPnc.jsx')
 function Harness(){ctrl=useMioPnc(props);return React.createElement('button',{onClick:()=>ctrl.open(matter)},'Open consultation')}
 await act(async()=>root.render(React.createElement(Harness)))
 await act(async()=>document.querySelector('button').click())
 assert.equal(authCalls.length,1,'Opening the consultation must preflight Microsoft access')
 assert.equal(authCalls[0].allowInteractive,true)
 assert.equal(ctrl.emailConnection.status,'ready')
 assert.equal(apiCalls.length,0,'Opening never claims a send')
 assert.equal(graphCalls.length,0,'Opening never sends email')
 authFails=true
 await act(async()=>{await assert.rejects(()=>ctrl.sendMessage(workflow,'consult'),/Sign in required/)})
 assert.equal(apiCalls.length,0,'Auth failure happens before claiming the send')
 authFails=false
 workflow={...workflow,state:{consult_delivery:{status:'sent',reference:'prior',recipient:'wrong@example.test'}}}
 await act(async()=>{await ctrl.sendMessage(workflow,'consult',{resend:true})})
 const claim=apiCalls.find(x=>x.action==='claim_delivery')
 assert.equal(claim.resend,true);assert.equal(claim.previous_reference,'prior');assert.equal(claim.recipient,'corrected@example.test')
 const sent=graphCalls[0]
 assert.equal(JSON.parse(sent.options.body).message.toRecipients[0].emailAddress.address,'corrected@example.test')
 assert.equal(sent.options.allowInteractive,false,'No redirect after claiming a send')
 assert.equal(sent.options.maxRetries,0,'Email POST must never auto-retry')
 assert.equal(apiCalls.at(-1).action,'record_delivery')
 const before=apiCalls.length;await act(async()=>{await assert.rejects(()=>ctrl.sendMessage(workflow,'consult'),/already sent/i)})
 assert.equal(apiCalls.length,before)
 networkFails=true;workflow={...workflow,state:{}}
 await act(async()=>{await assert.rejects(()=>ctrl.sendMessage(workflow,'consult'),/uncertain/)})
 assert.equal(apiCalls.at(-1).action,'claim_delivery','Network uncertainty remains locked for review')
 await act(async()=>root.render(null))
 sessionStorage.setItem('mio-pnc-email-return',JSON.stringify({owner:'owner',id:matter.id,mode:'agreement',at:Date.now()}))
 authCalls=[]
 await act(async()=>root.render(React.createElement(Harness)))
 assert.equal(ctrl.modal.id,matter.id,'Return from Microsoft reopens the consultation')
 assert.equal(authCalls[0].allowInteractive,false,'Return restoration must not loop redirects')
 assert.equal(sessionStorage.getItem('mio-pnc-email-return'),null)
 await act(async()=>root.render(React.createElement(MioPncModal,{control:{...ctrl,modal:{id:matter.id},matters:[matter],rows:{[matter.id]:{...workflow,state:{consult_delivery:{status:'sent',reference:'old',at:'2026-10-15T20:00:00Z'}}}},defaults:{},intakeTemplates:[]},caseTypes:[]})))
 assert.ok([...document.querySelectorAll('button')].some(b=>b.textContent==='Send again'),'Sent email remains resendable')
 const history=[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Sent history'))
 assert.ok(history);await act(async()=>history.click())
 assert.match(document.body.textContent,/Recipient not recorded/)
 console.log('PASS: early auth; no send on open; auth failure before claim; explicit resend to corrected recipient; no auto retry; uncertain outcome locked; redirect restore; history and resend controls')
}catch(error){console.error(error);process.exitCode=1}finally{globalThis.fetch=originalFetch;await act(async()=>root.unmount());await server.close();dom.window.close()}

process.exit(process.exitCode||0)
