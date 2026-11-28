// Validated, non-logging loading of Tyler e-filing secrets (SERVER ONLY).
//
// Secrets are read from environment variables only and are never logged. The
// key-rotation helper accepts an allowlist of SHA-256 certificate fingerprints
// so a new signing certificate can be added before the old one is retired.

export function loadTylerSecrets(env = process.env) {
  const signingCert = env.TYLER_EFM_STAGE_SIGNING_CERT || env.TYLER_EFM_PRODUCTION_SIGNING_CERT || ''
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || ''
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || ''
  return Object.freeze({
    // Only booleans are returned; no secret value ever leaves this function.
    signingCertificateConfigured: Boolean(signingCert),
    supabaseServiceRoleConfigured: Boolean(supabaseUrl && serviceRoleKey),
  })
}

export function createTylerCertificateAllowlist(fingerprints = []) {
  const set = new Set()
  for (const fp of fingerprints) {
    const hex = String(fp || '').replaceAll(':', '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('Invalid certificate SHA-256 fingerprint in allowlist.')
    set.add(hex)
  }
  return Object.freeze({
    has(fingerprint) {
      const hex = String(fingerprint || '').replaceAll(':', '').toLowerCase()
      return set.has(hex)
    },
    size: set.size,
  })
}
