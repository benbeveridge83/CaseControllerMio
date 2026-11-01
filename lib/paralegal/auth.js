export async function requireParalegalUser(req, {fetchImpl = fetch, env = process.env} = {}) {
  const token = String(req?.headers?.authorization || '').replace(/^Bearer\s+/i,'').trim()
  if (!token) throw Object.assign(new Error('Missing Mio session token.'), {statusCode:401})
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/,'')
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''
  if (!url || !key) throw Object.assign(new Error('Supabase auth is not configured on the server.'), {statusCode:503})
  const response = await fetchImpl(`${url}/auth/v1/user`, {
    headers:{Authorization:`Bearer ${token}`,apikey:key},
    signal:AbortSignal.timeout(15000)
  })
  if (!response.ok) throw Object.assign(new Error('Your Mio session could not be verified.'), {statusCode:401})
  const user = await response.json()
  const email = String(user?.email || '').trim().toLowerCase()
  if (!email.endsWith('@beveridgelawfirm.com')) throw Object.assign(new Error('Paralegal is restricted to firm staff accounts.'), {statusCode:403})
  return user
}
