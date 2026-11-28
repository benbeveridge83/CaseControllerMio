// Tyler EFM callback entry point for Case Controller Mio.
// SECURITY: Do not acknowledge or persist a callback until Tyler's official
// callback transport, signature verification, replay semantics, and response
// contract have been implemented from the private integration specification.
// An HTTP 2xx here would falsely acknowledge an untrusted or unprocessed
// filing event and could silently lose critical court-status notifications.
//
// POST remains fail-closed (HTTP 503) until a trusted Stage/Production signing
// certificate is configured. When one is, the verified path is
// processTylerCallback (verification -> NFRC parse -> atomic record -> SOAP ACK).
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  const configured = Boolean(
    process.env.TYLER_EFM_STAGE_SIGNING_CERT || process.env.TYLER_EFM_PRODUCTION_SIGNING_CERT,
  )

  if (req.method === 'GET' || req.method === 'HEAD') {
    // Non-sensitive diagnostics only. This is NOT a Tyler handshake.
    const result = {
      service: 'mio-tyler-efm-callback',
      state: configured ? 'awaiting_tyler_stage_fixtures' : 'awaiting_tyler_callback_specification',
      acceptsNotifications: false,
      stageActivated: false,
    }
    if (req.method === 'HEAD') return res.status(200).end()
    return res.status(200).json(result)
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, HEAD, POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed.' })
  }

  if (!configured) {
    // Do not trust headers, URLs, case IDs, or XML/JSON contents as evidence
    // of Tyler origin. No payload, signer, or case data is logged or stored.
    // Return a retryable error until the signed Tyler protocol is verified.
    res.setHeader('Retry-After', '3600')
    return res.status(503).json({
      ok: false,
      code: 'TYLER_CALLBACK_NOT_ACTIVATED',
      message: 'Tyler EFM callback processing is not yet activated.',
    })
  }

  // The verified path is deliberately NOT reachable in production until Tyler's
  // signed Stage fixtures and the certificate role have been confirmed. It is
  // kept here so the wiring (verifier -> processor -> atomic recorder) is ready.
  const { processTylerCallback } = await import('./tylerCallbackProcessor.js')
  const { createSupabaseTylerReceiptRecorder } = await import('./tylerNfrcProcessor.js')
  const { createClient } = await import('@supabase/supabase-js')

  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !serviceKey) {
    res.setHeader('Retry-After', '3600')
    return res.status(503).json({ ok: false, code: 'TYLER_CALLBACK_NOT_ACTIVATED', message: 'Tyler EFM callback server configuration is incomplete.' })
  }

  let rawXml = ''
  if (typeof req.body === 'string') rawXml = req.body
  else if (Buffer.isBuffer(req.body)) rawXml = req.body.toString('utf8')
  else if (req.body && typeof req.body === 'object' && req.rawBody) rawXml = String(req.rawBody)
  if (!rawXml || Buffer.byteLength(rawXml, 'utf8') > 8 * 1024 * 1024) {
    return res.status(400).json({ ok: false, code: 'TYLER_CALLBACK_INVALID', message: 'Invalid or oversized SOAP payload.' })
  }

  const environment = process.env.TYLER_EFM_ENVIRONMENT === 'production' ? 'production' : 'stage'
  const trustedCertificatePem = environment === 'production'
    ? process.env.TYLER_EFM_PRODUCTION_SIGNING_CERT
    : process.env.TYLER_EFM_STAGE_SIGNING_CERT
  const approvedCertificateSha256 = environment === 'production'
    ? process.env.TYLER_EFM_PRODUCTION_SIGNING_CERT_SHA256
    : process.env.TYLER_EFM_STAGE_SIGNING_CERT_SHA256

  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const { acknowledgment } = await processTylerCallback({
      rawXml,
      environment,
      trustedCertificatePem,
      approvedCertificateSha256: approvedCertificateSha256 || undefined,
      // A conservative resolver until real Tyler status lookup is Stage-tested.
      resolveStatus: async () => 'unknown',
      recordReceipt: createSupabaseTylerReceiptRecorder(serviceClient),
    })
    res.setHeader('Content-Type', 'text/xml; charset=utf-8')
    return res.status(200).send ? res.status(200).send(acknowledgment) : res.status(200).end(acknowledgment)
  } catch (error) {
    res.setHeader('Retry-After', '3600')
    return res.status(503).json({ ok: false, code: 'TYLER_CALLBACK_REJECTED', message: error?.message || 'Callback rejected.' })
  }
}

