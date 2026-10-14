import { analyzeDiscovery, chatDiscovery, recognizeDiscovery, requireDiscoveryUser } from './discovery-objections.js'

export default async function handler(req,res) {
  const json=(status,body)=>{res.status(status);res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))}
  if(req.method!=='POST') return json(405,{ok:false,error:'Use POST.'})
  try {
    await requireDiscoveryUser(req)
    if(Number(req.headers['content-length']||0)>400000) return json(413,{ok:false,error:'Split this document into smaller request sets.'})
    if(!req.body || typeof req.body!=='object' || JSON.stringify(req.body).length>400000) return json(400,{ok:false,error:'Invalid or oversized discovery analysis input.'})
    if(req.body.action==='status') return json(200,{ok:true,aiConfigured:Boolean(process.env.OPENAI_API_KEY)})
    if(req.body.action==='recognize') return json(200,{ok:true,...await recognizeDiscovery(req.body)})
    if(req.body.action==='chat') return json(200,{ok:true,...await chatDiscovery(req.body)})
    if(req.body.action==='analyze') return json(200,{ok:true,...await analyzeDiscovery(req.body)})
    return json(400,{ok:false,error:'Choose analysis, chat or request recognition.'})
  } catch(error) {
    // Never log request/response text, tokens or raw provider errors.
    return json(error?.statusCode||500,{ok:false,error:error?.statusCode?error.message:'Discovery analysis could not be completed. Please retry.',code:error?.code||'AI_UNAVAILABLE',retryable:error?.retryable??true,...(error?.retryAfterSeconds?{retryAfterSeconds:error.retryAfterSeconds}:{})})
  }
}
