import React, {useEffect, useRef, useState} from 'react'

const fields = [
  ['first_name', 'First name', 'text'], ['last_name', 'Last name', 'text'],
  ['email', 'Email address', 'email'], ['phone', 'Phone number', 'tel'],
  ['address', 'Street address', 'text'], ['city', 'City', 'text'],
  ['state', 'State', 'text'], ['zip', 'ZIP code', 'text']
]
const selection = 'id,' + fields.map(([key]) => key).join(',')
const draftFrom = client => Object.fromEntries(fields.map(([key]) => [key, client[key] || '']))

// Kept mounted across matter tabs so switching tabs never discards contact edits.
export default function MatterClientInfo({clientId, supabase, onSaved, active = true}) {
  const [original, setOriginal] = useState(null)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const panel = useRef(null)
  const saveInFlight = useRef(false)

  useEffect(() => {
    let active = true
    setOriginal(null)
    setDraft(null)
    setError('')
    setNotice('')
    if (clientId) {
      void (async () => {
        try {
          const {data, error: loadError} = await supabase.from('clients').select(selection).eq('id', clientId).single()
          if (loadError) throw loadError
          if (!data) throw new Error('Client record could not be loaded.')
          if (active) { setOriginal(data); setDraft(draftFrom(data)) }
        } catch (err) { if (active) setError(err.message || 'Unable to load client information.') }
      })()
    }
    return () => { active = false }
  }, [clientId, supabase, loadAttempt])

  async function save() {
    if (!draft || saveInFlight.current) return
    setNotice('')
    setError('')
    if (!draft.first_name.trim() || !draft.last_name.trim()) {
      setError('First name and last name are required.')
      return
    }
    const emailInput = panel.current?.querySelector('input[type="email"]')
    if (emailInput && !emailInput.checkValidity()) {
      setError('Enter a valid email address, or leave it blank.')
      emailInput.focus()
      return
    }
    // Only write fields actually edited here; preserve unrelated client data.
    const patch = Object.fromEntries(fields
      .filter(([key]) => draft[key].trim() !== (original[key] || ''))
      .map(([key]) => [key, draft[key].trim()]))
    if (!Object.keys(patch).length) { setNotice('No changes to save.'); return }
    saveInFlight.current = true
    setSaving(true)
    try {
      const {data, error: saveError} = await supabase.from('clients').update(patch).eq('id', clientId).select(selection).single()
      if (saveError) throw saveError
      if (!data || data.id !== clientId) throw new Error('The client update was not confirmed. Please try again.')
      setOriginal(data)
      setDraft(draftFrom(data))
      onSaved(data)
      setNotice('Client information saved.')
    } catch (err) { setError(err.message || 'Unable to save client information. Your edits are still here.') }
    finally { saveInFlight.current = false; setSaving(false) }
  }

  return <section ref={panel} aria-label="Client information" onKeyDown={event => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); void save() }
  }}>
    <h2>Client Information</h2>
    <p>Changes update this client's record across their matters. Future consultation emails use the saved email address.</p>
    {!clientId ? <p>Select a client in Matter Info first.</p> : <>
      {error && <p role="alert" style={{color:'#a12222'}}>{error}</p>}
      {!draft && !error && <p role="status">Loading client information…</p>}
      {!draft && error && <button type="button" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading client</button>}
      {draft && <>
        <fieldset disabled={saving || !active} style={{border:0,padding:0,margin:0,display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(210px, 1fr))',gap:12}}>
          {fields.map(([key, label, type]) => <label key={key} style={{display:'flex',flexDirection:'column',gap:5,textAlign:'left'}}>
            {label}
            <input type={type} value={draft[key]} onChange={event => {
              setDraft(current => ({...current,[key]:event.target.value}))
              setNotice('')
            }} style={{padding:8}} />
          </label>)}
        </fieldset>
        <button type="button" disabled={saving} onClick={save} style={{marginTop:16}}>{saving ? 'Saving…' : 'Save Client Info'}</button>
        <p style={{fontSize:13}}>Save Client Info before closing this window. Matter details are saved separately.</p>
        {notice && <p role="status" style={{color:'#215d39'}}>{notice}</p>}
      </>}
    </>}
  </section>
}
