import fs from 'node:fs';
const marker='V314 successful-action review and input guards';
function once(s,a,b){if(s.split(a).length!==2)throw Error('Process hardening anchor changed: '+a.slice(0,100));return s.replace(a,()=>b);}
function patch(file,fn){const s=fs.readFileSync(file,'utf8');if(s.includes(marker))return;fs.writeFileSync(file,fn(s)+'\n// '+marker+'\n');}
patch('src/processes/model.js',s=>{
 s=once(s,"ready:'Waiting for you to '+t.action.toLowerCase()","ready:s.performedAt||s.responseReference?'Waiting for you to review the result of '+n.name.toLowerCase():'Waiting for you to '+t.action.toLowerCase()");
 s=once(s,"case'configure':need();if(!['blocked','approval','ready','error'].includes(s.status))","case'configure':need();if(s.performedAt||s.responseReference||!['blocked','approval','ready','error'].includes(s.status))");
 s=once(s,"case'claim':need();if(s.status!=='ready')","case'claim':need();if(s.status!=='ready'||s.performedAt||s.responseReference)");
 s=once(s,"case'complete':need();if(!e.confirmed||!['ready','waiting','error'].includes(s.status))","case'complete':need();if(!e.confirmed||!['ready','waiting','error','running'].includes(s.status))");
 s=once(s,"r.documents[e.slotId]={id:String(e.document.id)",`for(const consumer of r.definition.nodes){const state=r.steps[consumer.id];if(!(state.config.inputSlots||[]).includes(e.slotId))continue;if(r.documents[e.slotId]?.id!==String(e.document.id)&&(['running','waiting','complete'].includes(state.status)||state.performedAt))throw Error('This input has already been used by a started action; retain it and use a new document slot.');if(consumer.approval&&state.status==='ready'){state.status='approval';state.approvedAt=null;state.enteredAt=at;}}
 r.documents[e.slotId]={id:String(e.document.id)`);
 return s;
});
patch('src/processes/RunPanel.jsx',s=>{
 s=once(s,"const canEdit=['blocked','approval','ready','error'].includes(s.status)","const canEdit=!s.performedAt&&!s.responseReference&&['blocked','approval','ready','error'].includes(s.status)");
 s=once(s,"{s.status==='ready'&&!['manual','wait','approve']", "{s.status==='ready'&&!s.performedAt&&!s.responseReference&&!['manual','wait','approve']");
 s=once(s,"{['ready','waiting','error'].includes(s.status)&&<button", "{['ready','waiting','error','running'].includes(s.status)&&<button");
 return s;
});
patch('src/processes/Processes.jsx',s=>{
 s=once(s,"[recoveries,setRecoveries]=useState({});","[recoveries,setRecoveries]=useState({}),[notice,setNotice]=useState('');");
 s=once(s,"n.automatic&&r.steps[n.id].status==='ready'", "n.automatic&&!r.steps[n.id].performedAt&&!r.steps[n.id].responseReference&&r.steps[n.id].status==='ready'");
 s=once(s,"if(saved.steps[n.id].billingId)ctx.current.billingRefresh?.();result.open?.();", "if(saved.steps[n.id].billingId)ctx.current.billingRefresh?.();if(result.type!=='handoff')setNotice(saved.steps[n.id].status==='complete'?(n.messages?.complete||result.reference):result.reference);result.open?.();");
 s=once(s,' {error&&<div role="alert"', ' {notice&&<div role="status" className="proc-warning">{notice} <button onClick={()=>setNotice(\'\')}>Dismiss notification</button></div>}\n {error&&<div role="alert"');
 return s;
});
console.log('Verified-result review, input approval and notification guards installed.');
// A release-label assertion is updated for V314; all existing behavior checks remain.
const releaseFile='scripts/test-withdrawal-release.mjs';
if(fs.existsSync(releaseFile)){
 const release=fs.readFileSync(releaseFile,'utf8');
 if(release.includes('Mio V31[123]'))fs.writeFileSync(releaseFile,once(release,'Mio V31[123]','Mio V31[1234]'));
}
