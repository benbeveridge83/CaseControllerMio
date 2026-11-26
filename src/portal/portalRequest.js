export async function requestPortal(action,body={},headers={}){
 const timed=action.startsWith('discovery_')||(['staff_client_action','staff_client_discovery_action'].includes(action)&&String(body.client_action||'').startsWith('discovery_'))
 const payload=JSON.stringify({action,...body}),answerSave=action==='discovery_save'||['staff_client_action','staff_client_discovery_action'].includes(action)&&body.client_action==='discovery_save'
 const controller=new AbortController(),timer=timed?setTimeout(()=>controller.abort(),30000):null
 try{
  const response=await fetch('/api/client-portal',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...headers},body:payload,signal:controller.signal,keepalive:answerSave&&new Blob([payload]).size<60000})
  let result;try{result=await response.json()}catch{throw Object.assign(new Error('The server response could not be confirmed. Your unsaved answer has been kept for retry.'),{status:response.status>=400?response.status:502})}
  if(!response.ok)throw Object.assign(new Error(result.error||'Request failed'),{status:response.status})
  return result
 }catch(e){if(e.name==='AbortError')throw Object.assign(new Error('The save could not be confirmed because the connection timed out. Your draft is kept for retry.'),{status:408});throw e}
 finally{if(timer)clearTimeout(timer)}
}
