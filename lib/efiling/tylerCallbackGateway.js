// Tyler EFM callback entry point for Case Controller Mio.
// SECURITY: Do not acknowledge or persist a callback until Tyler's official
// callback transport, signature verification, replay semantics, and response
// contract have been implemented from the private integration specification.
// An HTTP 2xx here would falsely acknowledge an untrusted or unprocessed
// filing event and could silently lose critical court-status notifications.
//
// This deliberately fail-closed gateway reserves a stable Vercel URL without
// enabling filing-status mutations or pretending to be Stage-certified.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  if (req.method === 'GET' || req.method === 'HEAD') {
    // Non-sensitive diagnostics only. This is NOT a Tyler handshake.
    const result = {
      service: 'mio-tyler-efm-callback',
      state: 'awaiting_tyler_callback_specification',
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
