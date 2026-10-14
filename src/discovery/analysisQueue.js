// One accepted result per request. A failed request must never block later requests.
const makeError=(message,properties)=>Object.assign(new Error(message),properties)
const abortError=()=>new DOMException('Analysis stopped.','AbortError')
const RETRY_REASONS=new Set(['AI_INVALID_RESULT','AI_OUTPUT_LIMIT','AI_INCOMPLETE','AI_TIMEOUT','AI_GATEWAY','AI_RATE_LIMIT','AI_UNAVAILABLE','CLIENT_TIMEOUT','NETWORK_ERROR'])

export function discoveryApiError(response,payload) {
  const status=response.status
  const header=payload?.retryAfterSeconds??response.headers?.get?.('retry-after')
  const seconds=Number(header)
  const retryAfter=header?(Number.isFinite(seconds)?Math.max(0,seconds):Math.max(0,Math.ceil((Date.parse(header)-Date.now())/1000))):0
  return makeError(payload?.error || `The discovery service returned HTTP ${status} without a usable result.`,{
    status,code:payload?.code||(status>=500?'AI_GATEWAY':status===429?'AI_RATE_LIMIT':'API_ERROR'),
    retryable:payload?.retryable??(status===408||status===429||status>=500),
    retryAfterSeconds:Number.isFinite(retryAfter)&&retryAfter>0?retryAfter:0
  })
}

function attemptWithDeadline(action,parentSignal,timeoutMs) {
  return new Promise((resolve,reject)=>{
    const controller=new AbortController()
    let settled=false,timer
    const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);parentSignal?.removeEventListener('abort',stop);callback(value)}
    const stop=()=>{controller.abort();finish(reject,abortError())}
    if(parentSignal?.aborted){stop();return}
    parentSignal?.addEventListener('abort',stop,{once:true})
    timer=setTimeout(()=>{controller.abort();finish(reject,makeError('This request exceeded the waiting limit. It can be retried.',{code:'CLIENT_TIMEOUT',status:504,retryable:true}))},timeoutMs)
    Promise.resolve().then(()=>{if(controller.signal.aborted)throw abortError();return action(controller.signal)}).then(value=>finish(resolve,value),error=>finish(reject,error))
  })
}
function waitForRetry(ms,signal) {
  return new Promise((resolve,reject)=>{
    let timer
    const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(abortError())}
    if(signal?.aborted){stop();return}
    signal?.addEventListener('abort',stop,{once:true})
    timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve()},ms)
  })
}
function failureDetails(error,attempt) {
  return {message:error?.code?error.message:'The connection to discovery AI was interrupted.',code:error?.code||'NETWORK_ERROR',status:error?.status||0,
    retryable:error?.retryable??true,retryAfterSeconds:error?.retryAfterSeconds||0,attempt}
}

export async function runAnalysisQueue({requests,completedIds=[],failures={},analyze,onResult=()=>{},onState=()=>{},signal,timeoutMs=115000,retryDelayMs=1500}) {
  const completed=new Set(completedIds.filter(id=>requests.some(r=>r.id===id)))
  let state={phase:'running',current:null,attempt:0,attemptStartedAt:null,retryAt:null,lastCompletedAt:null,message:'',failures:{...failures}}
  const emit=patch=>{
    state={...state,...patch,analyzed:completed.size,total:requests.length,remaining:requests.length-completed.size}
    onState({...state,failures:{...state.failures}});return state
  }
  emit({})
  try {
    for(const request of requests.filter(r=>!completed.has(r.id))) {
      if(signal?.aborted)throw abortError()
      let previousError
      for(let attempt=1;attempt<=2;attempt++) {
        emit({phase:'running',current:{id:request.id,type:request.type,number:request.number},attempt,attemptStartedAt:Date.now(),retryAt:null,message:''})
        let data
        try {
          data=await attemptWithDeadline(attemptSignal=>analyze(request,{signal:attemptSignal,attempt,retry:previousError?{attempt:2,reason:RETRY_REASONS.has(previousError.code)?previousError.code:'NETWORK_ERROR'}:undefined}),signal,timeoutMs)
          if(signal?.aborted)throw abortError()
          if(!Array.isArray(data?.results)||data.results.length!==1||data.results[0]?.id!==request.id)throw makeError('The AI result did not match this request. No analysis was accepted.',{code:'AI_INVALID_RESULT',status:502,retryable:true})
        } catch(error) {
          if(signal?.aborted)throw abortError()
          const details=failureDetails(error,attempt)
          const globalFailure=[401,403].includes(details.status)||details.code==='AI_CONFIGURATION'||details.code==='AUTH_CONFIGURATION'
          const tooLong=details.retryAfterSeconds>30
          if(globalFailure||tooLong||(details.code==='AI_RATE_LIMIT'&&attempt===2)) {
            return emit({phase:'paused',message:details.message,failures:{...state.failures,[request.id]:details},retryAt:null})
          }
          if(details.retryable&&attempt<2) {
            previousError=details
            const delay=Math.max(retryDelayMs,details.retryAfterSeconds*1000,details.code==='AI_RATE_LIMIT'?6000:0)
            emit({phase:'retrying',message:details.message,retryAt:Date.now()+delay,failures:{...state.failures,[request.id]:details}})
            await waitForRetry(delay,signal)
            continue
          }
          emit({failures:{...state.failures,[request.id]:details},message:details.message})
          break
        }
        if(signal?.aborted)throw abortError()
        onResult(data.results[0]);completed.add(request.id)
        const nextFailures={...state.failures};delete nextFailures[request.id]
        emit({lastCompletedAt:Date.now(),message:'',failures:nextFailures})
        break
      }
    }
    return emit({phase:completed.size===requests.length?'completed':'attention',current:null,retryAt:null,message:''})
  } catch(error) {
    if(signal?.aborted||error?.name==='AbortError')return emit({phase:'stopped',retryAt:null,message:'Completed results remain available. Resume to analyze only unfinished requests.'})
    return emit({phase:'paused',retryAt:null,message:'Analysis was interrupted. Completed results remain available; resume the remaining requests.'})
  }
}
