// Server-authorized Tyler e-filing submit HTTP handler.
// Routed through the consolidated /api/auth/callback Vercel function
// (integration=tyler_efm_submit) to stay within the Hobby function budget.
//
// SECURITY: verifies the caller's Mio session server-side, authorizes the
// matter through the caller's own session (so RLS applies), and fetches the
// document with the service-role client. A client-supplied ownerId is never
// trusted. This is a Stage-disabled dry run: it never calls Tyler.
import { createClient } from '@supabase/supabase-js'
import { retrieveAuthorizedTylerDocument } from './tylerDocumentRetrieval.js'
import { createTylerSubmitService } from './tylerSubmitService.js'

function env() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  return { url, anonKey, serviceKey }
}

function respond(res, status, body) {
  return res.status(status).json(body)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'POST required.' })

  const { url, anonKey, serviceKey } = env()
  if (!url || !anonKey || !serviceKey)
    return respond(res, 503, { ok: false, error: 'E-filing server configuration is incomplete.' })

  const authorization = String(req.headers?.authorization || '')
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) return respond(res, 401, { ok: false, error: 'Missing Mio session token.' })

  // 1. Verify the session. The ownerId used downstream is auth.uid(), never the body.
  const verify = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anonKey } })
  if (!verify.ok) return respond(res, 401, { ok: false, error: 'Your Mio session could not be verified.' })
  const session = await verify.json().catch(() => ({}))
  const userId = session?.id
  if (!userId) return respond(res, 401, { ok: false, error: 'Your Mio session could not be verified.' })

  const body = req.body || {}
  const draft = body.draft || {}
  const environment = body.environment === 'production' ? 'production' : 'stage'
  const idempotencyKey = String(body.idempotencyKey || '')
  const documentReference = body.documentReference || {}
  const documentPath = String(documentReference.path || draft.selectedDocumentUrlOrPath || '')

  // 2. Matter authorization happens inside authorizeMatter using the caller's
  //    own session, so Supabase RLS decides access; the service only proceeds
  //    after the matter resolves.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const service = createTylerSubmitService({
    authorizeMatter: async ({ matterId }) => {
      const query = await userClient.from('matters').select('id').eq('id', matterId).maybeSingle()
      if (query.error || !query.data) throw new Error('You are not authorized for this matter.')
    },
    retrieveDocument: () => retrieveAuthorizedTylerDocument(serviceClient, {
      path: documentPath,
      expectedSha256: documentReference.sha256,
      expectedByteLength: documentReference.byteLength,
    }),
  })

  try {
    const result = await service.submit({
      draft,
      ownerId: userId,
      environment,
      idempotencyKey,
      documentReference,
    })
    return respond(res, 200, { ok: true, ...result })
  } catch (error) {
    return respond(res, 400, { ok: false, error: error?.message || 'E-filing submit could not be completed.' })
  }
}
