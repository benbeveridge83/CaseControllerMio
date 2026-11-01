import { requireParalegalUser } from '../lib/paralegal/auth.js'
import { askClaudeParalegal } from '../lib/paralegal/claude.js'

export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control','no-store')
  if (req.method !== 'POST') return res.status(405).json({ok:false,error:'Method not allowed.'})
  try {
    await requireParalegalUser(req)
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const result = await askClaudeParalegal({
      gatewayKey:process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
      apiKey:process.env.ANTHROPIC_API_KEY,
      model:process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      message:body.message,
      history:body.history,
      snapshot:body.snapshot
    })
    return res.status(200).json({ok:true,...result,mode:'read_only'})
  } catch(error) {
    const status = error.statusCode || (error.code === 'INVALID_MESSAGE' || error.code === 'INVALID_SNAPSHOT' ? 400 : error.code === 'CLAUDE_NOT_CONFIGURED' ? 503 : 500)
    return res.status(status).json({ok:false,error:error.message || 'Paralegal request failed.'})
  }
}
