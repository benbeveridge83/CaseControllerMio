// Tyler EFM callback entry point for Case Controller Mio.
// SECURITY: Do not acknowledge or persist a callback until Tyler's official
// callback transport, signature verification, replay semantics, and response
// contract have been implemented from the private integration specification.
// An HTTP 2xx here would falsely acknowledge an untrusted or unprocessed
// filing event and could silently lose critical court-status notifications.
//
// POST is fail-closed behind three independent, server-owned gates:
//   1. a trusted Stage/Production signing certificate is installed
//      (TYLER_EFM_STAGE_SIGNING_CERT / TYLER_EFM_PRODUCTION_SIGNING_CERT);
//   2. the callback is explicitly activated (TYLER_EFM_CALLBACK_ACTIVATED=true),
//      so installing a certificate alone can never make the route live; and
//   3. the status resolver and recording behavior have been validated against
//      real Tyler Stage fixtures (TYLER_EFM_CALLBACK_STATUS_VALIDATED=true).
// A callback is acknowledged (HTTP 2xx) only after all three gates pass.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  const certConfigured = Boolean(
    process.env.TYLER_EFM_STAGE_SIGNING_CERT || process.env.TYLER_EFM_PRODUCTION_SIGNING_CERT,
  )
  const activated = process.env.TYLER_EFM_CALLBACK_ACTIVATED === 'true'
  const validated = process.env.TYLER_EFM_CALLBACK_STATUS_VALIDATED === 'true'

  if (req.method === 'GET' || req.method === 'HEAD') {
    // Non-sensitive diagnostics only. This is NOT a Tyler handshake.
    const result = {
      service: 'mio-tyler-efm-callback',
      state: validated
        ? 'awaiting_tyler_certification'
        : activated
          ? 'awaiting_tyler_stage_fixtures'
          : certConfigured
            ? 'certificate_installed_not_activated'
            : 'awaiting_tyler_callback_specification',
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

  // Gate 1: a trusted signing certificate must be installed.
  if (!certConfigured) {
    res.setHeader('Retry-After', '3600')
    return res.status(503).json({
      ok: false,
      code: 'TYLER_CALLBACK_NOT_ACTIVATED',
      message: 'Tyler EFM callback processing is not yet activated.',
    })
  }

  // Gate 2: installing a certificate alone must NOT make the route live. The
  // callback must be explicitly activated by a server-owned flag.
  if (!activated) {
    res.setHeader('Retry-After', '3600')
    return res.status(503).json({
      ok: false,
      code: 'TYLER_CALLBACK_NOT_ACTIVATED',
      message: 'Tyler EFM callback processing is not yet activated.',
    })
  }

  // Gate 3: do not acknowledge a callback as successfully processed until the
  // status and recording behavior have been validated against Stage fixtures.
  if (!validated) {
    res.setHeader('Retry-After', '3600')
    return res.status(503).json({
      ok: false,
      code: 'TYLER_CALLBACK_NOT_VALIDATED',
      message: 'Tyler EFM callback status and recording have not been validated against Stage fixtures.',
    })
  }

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
      // Placeholder: replace with a Stage-validated status resolver before
      // setting TYLER_EFM_CALLBACK_STATUS_VALIDATED=true. Until then gate 3
      // keeps this branch unreachable.
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

