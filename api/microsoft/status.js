import { requireParalegalUser } from '../../lib/paralegal/auth.js'
import { createMicrosoftTokenStore } from '../../lib/paralegal/microsoft/tokenStore.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const user = await requireParalegalUser(req)
    const token = await createMicrosoftTokenStore().load(user.id)
    if (!token) return res.status(200).json({ ok: true, connected: false })
    return res.status(200).json({
      ok: true,
      connected: true,
      accountEmail: token.accountEmail || '',
      scopes: token.scopes || [],
      expiresAt: token.expiresAt || ''
    })
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Microsoft status check failed.' })
  }
}
