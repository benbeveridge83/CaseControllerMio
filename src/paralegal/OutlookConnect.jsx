import React, { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

export default function OutlookConnect() {
  const [state, setState] = useState({ loading: true, connected: false, accountEmail: '' })
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const session = (await supabase.auth.getSession())?.data?.session
        const token = session?.access_token
        if (!token) { if (active) setState({ loading: false, connected: false, accountEmail: '' }); return }
        const res = await fetch('/api/microsoft/status', { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json().catch(() => ({}))
        if (active) setState({ loading: false, connected: !!data?.connected, accountEmail: data?.accountEmail || '' })
      } catch (e) { if (active) { setState({ loading: false, connected: false, accountEmail: '' }); setError(e.message || String(e)) } }
    }
    load()
    return () => { active = false }
  }, [])

  async function connect() {
    setError('')
    try {
      const session = (await supabase.auth.getSession())?.data?.session
      const token = session?.access_token
      if (!token) { setError('Sign in to Mio first.'); return }
      const res = await fetch('/api/microsoft/oauth-start', { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => ({}))
      if (data?.url) window.location.href = data.url
      else setError(data?.error || 'Could not start Microsoft sign-in.')
    } catch (e) { setError(e.message || String(e)) }
  }

  if (state.loading) return <div style={{ fontSize: 13, color: '#64748b' }}>Checking Outlook connection…</div>
  if (state.connected) return <div style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>✓ Outlook connected{state.accountEmail ? ` (${state.accountEmail})` : ''}</div>
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: '#b45309' }}>Outlook not connected</span>
      <button type="button" onClick={connect} style={{ fontSize: 12 }}>Connect Outlook</button>
      {error && <span style={{ fontSize: 12, color: '#b91c1c' }}>{error}</span>}
    </div>
  )
}
