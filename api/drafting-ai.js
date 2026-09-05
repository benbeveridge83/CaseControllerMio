export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  res.setHeader('Cache-Control', 'no-store')
  const action = String(req.body?.action || '')
  if (action === 'analyze_template') return res.status(200).json({ suggestions: [], mode: 'local_fallback' })
  if (action === 'compare_template') return res.status(200).json({ annotations: [], mode: 'local_fallback' })
  return res.status(400).json({ error: 'Unsupported drafting AI action.' })
}
