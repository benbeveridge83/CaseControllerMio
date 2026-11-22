import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mioCloudStore, mioStorage } from './mioCloudRuntime.js'
import { APPOINTED_KEY, LEGACY_KEY, WEEKLY_SETTINGS_KEY, ROLES, CATEGORIES, appointedMatters, normalizeState, serviceInvoice,
  num, currentReview, summarize, canApprove, approvedCurrent, approvalContext, outlineErrors, profileErrors, splitLine, changeSplitHours, isExpense } from './mioAppointedBillingModel.js'
import { buildOutlinePdf, buildVoucherPdf, readVoucherOutline, bytesToBase64, base64ToBytes } from './mioAppointedVoucherPdf.js'
import './mioAppointedBilling.css'

const usd = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num(value))
const steps = ['Create invoices', 'Check voucher outlines', 'Fill & review vouchers']
const Field = ({ label, children }) => <label className="apb-field"><span>{label}</span>{children}</label>
const safeName = value => String(value || '').replace(/[^A-Za-z0-9._-]/g, '_')
const download = (url, name) => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove() }
function readState() {
  try { return normalizeState(JSON.parse(mioStorage.getItem(APPOINTED_KEY) || mioStorage.getItem(LEGACY_KEY) || '{}')) } catch { return normalizeState() }
}

export default function MioAppointedBilling({ matters, invoices, firmProfile, clientName, courtName, financeFor, onCreateWip, createdInvoices, supabase, session, onClose }) {
  const [value, setValue] = useState(readState), live = useRef(value), processed = useRef(new Set())
  const [settings, setSettings] = useState(null), [settingsError, setSettingsError] = useState('')
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [showProfile, setShowProfile] = useState(false), [sign, setSign] = useState(false), [vouchers, setVouchers] = useState([])
  const urls = useRef(new Set())
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url) }, [])
  useEffect(() => {
    let active = true
    supabase.from('case_mio_user_state').select('json_value,raw_value').eq('user_id', session.user.id).eq('key', WEEKLY_SETTINGS_KEY).maybeSingle()
      .then(({ data, error }) => { if (!active) return; if (error) throw error; setSettings(data?.json_value || JSON.parse(data?.raw_value || '{}')) })
      .catch(e => { if (active) setSettingsError(`Could not load Appointed settings: ${e.message || e}`) })
    return () => { active = false }
  }, [supabase, session.user.id])
  const change = useCallback(next => {
    try { mioCloudStore.stage(APPOINTED_KEY, JSON.stringify(next)); live.current = next; setValue(next); return true }
    catch (e) { setError(`The change could not be saved: ${e.message || e}`); return false }
  }, [])
  const commit = async next => {
    await mioCloudStore.saveNow(APPOINTED_KEY, JSON.stringify(next), { throwOnError: true })
    live.current = next; setValue(next)
  }
  useEffect(() => {
    const added = (createdInvoices || []).filter(invoice => !processed.current.has(String(invoice.id)))
    if (!added.length) return
    for (const invoice of added) processed.current.add(String(invoice.id))
    const current = live.current
    change({ ...current, batch: { ...current.batch, step: 2, invoice_ids: [...new Set([...current.batch.invoice_ids, ...added.map(invoice => String(invoice.id))])] } })
  }, [createdInvoices, change])

  const eligible = useMemo(() => settings ? appointedMatters(matters, settings) : [], [matters, settings])
  const eligibleIds = useMemo(() => new Set(eligible.map(m => String(m.id))), [eligible])
  const available = invoices.filter(invoice => eligibleIds.has(String(invoice.matter_id)) && serviceInvoice(invoice) && num(invoice.total) > 0)
  const { batch, outlines, reviews } = value, step = batch.step
  const selected = batch.invoice_ids.map(id => available.find(invoice => String(invoice.id) === String(id))).filter(Boolean)
  const missing = selected.length !== batch.invoice_ids.length
  const selectedMatters = [...new Set(selected.map(invoice => String(invoice.matter_id)))].map(id => matters.find(m => String(m.id) === id)).filter(Boolean)
  const profile = { attorney_name: '', bar_number: '', ssn_last4: '', address: firmProfile.address || '', phone: firmProfile.phone || '', ...value.profile }
  const getOutline = matter => outlines[String(matter.id)] || { court: courtName(matter) || '300th', cause_number: matter.cause_number || '', party_name: clientName(matter) || '',
    cps: /^dfps$/i.test(matter.matter_type || matter.case_type || ''), represented_role: '', child_count: '', appeal: false, confirmed_at: '' }
  const invoiceMatter = invoice => matters.find(m => String(m.id) === String(invoice.matter_id))
  const approved = selected.filter(invoice => approvedCurrent(invoice, currentReview(invoice, reviews[invoice.id]), getOutline(invoiceMatter(invoice)), profile, invoiceMatter(invoice)))
  const outlineCount = selectedMatters.filter(m => !outlineErrors(getOutline(m), m).length).length
  const setBatch = patch => change({ ...value, batch: { ...batch, ...patch } })
  const setReview = (invoice, review) => change({ ...value, reviews: { ...reviews, [invoice.id]: { ...review, approved_at: '', acknowledged: false } } })
  const changeLine = (invoice, i, fn) => {
    const review = currentReview(invoice, reviews[invoice.id])
    setReview(invoice, { ...review, lines: review.lines.map(line => line.id === String(i) ? fn(line) : line) })
  }
  const editOutline = (matter, patch) => change({ ...value, outlines: { ...outlines, [String(matter.id)]: { ...getOutline(matter), ...patch, confirmed_at: '' } } })
  const run = async (label, fn) => {
    if (busy) return
    setBusy(label); setError(''); setNotice('')
    try { await fn() } catch (e) { setError(e.message || String(e)) } finally { setBusy('') }
  }
  const makeUrl = bytes => { const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); urls.current.add(url); return url }
  const templateFor = outline => {
    if (!outline.template_key) return undefined
    const saved = mioStorage.getItem(outline.template_key)
    if (!saved) throw new Error('The imported outline PDF could not be loaded. Reimport the outline before filling it.')
    return base64ToBytes(saved)
  }
  const filename = invoice => `Fee_Voucher_${safeName(getOutline(invoiceMatter(invoice)).cause_number)}_${safeName(invoice.invoice_number)}.pdf`

  async function saveOutline(matter) {
    const outline = { ...getOutline(matter), confirmed_at: new Date().toISOString() }
    const errors = [...profileErrors(profile), ...outlineErrors(outline, matter)]
    if (errors.length) throw new Error(errors.join(' '))
    // Validate the actual form before calling this outline ready for later invoices.
    await buildOutlinePdf({ outline, profile, templateBytes: templateFor(outline) })
    await commit({ ...value, profile, outlines: { ...outlines, [String(matter.id)]: outline } })
    setNotice(`${clientName(matter) || matter.name}: reusable voucher outline saved.`)
  }
  async function importOutline(matter, file) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) throw new Error('Use a one-page outline PDF smaller than 5 MB.')
    const bytes = new Uint8Array(await file.arrayBuffer()), imported = await readVoucherOutline(bytes, matter)
    const key = `caseMioAppointedTemplate:${matter.id}:${crypto.randomUUID()}`
    await mioCloudStore.saveNow(key, bytesToBase64(bytes), { throwOnError: true })
    const nextProfile = { ...profile, ...Object.fromEntries(Object.entries(imported.profile).filter(([, text]) => String(text || '').trim())) }
    await commit({ ...value, profile: nextProfile, outlines: { ...outlines, [String(matter.id)]: { ...imported.outline, imported_from: file.name, template_key: key } } })
    setNotice('Outline imported. Check its details and save it for this matter.')
  }
  async function suggestCategories() {
    if (!selected.length || missing) throw new Error('Select available appointed-case invoices in step 1.')
    const nextReviews = Object.fromEntries(Object.entries(reviews).map(([id, review]) => [id, structuredClone(review)]))
    for (const invoice of selected) nextReviews[invoice.id] = structuredClone(currentReview(invoice, reviews[invoice.id]))
    const next = { ...value, profile, reviews: nextReviews, batch: { ...batch, step: 3 } }
    await commit(next)
    const entries = selected.flatMap(invoice => (invoice.line_items || []).flatMap((line, i) => {
      const review = nextReviews[invoice.id], row = review.lines[i]
      return row.source === 'manual' || approvedCurrent(invoice, review, getOutline(invoiceMatter(invoice)), profile, invoiceMatter(invoice)) ? [] :
        [{ id: `${invoice.id}:${i}`, description: String(line.description || '').slice(0, 3500), date: line.date || '', expense: isExpense(line) }]
    }))
    if (!entries.length) return
    try {
      const results = []
      for (let offset = 0; offset < entries.length; offset += 80) {
        const response = await fetch('/api/appointed-billing', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: 'categorize', lines: entries.slice(offset, offset + 80) }), signal: AbortSignal.timeout(105000) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.ok) throw new Error(data.error || 'AI suggestions are unavailable.')
        results.push(...data.lines)
      }
      for (const invoice of selected) for (const row of nextReviews[invoice.id].lines) {
        const suggestion = results.find(result => result.id === `${invoice.id}:${row.id}`)
        if (suggestion && row.source !== 'manual') Object.assign(row, { source: 'ai', reason: suggestion.reason, allocations: row.allocations.map(a => ({ ...a, category: suggestion.category })) })
      }
      await commit({ ...next, reviews: nextReviews })
      setNotice('Categories suggested. Review each invoice below and approve individually or all together.')
    } catch (e) { setError(`${e.message} Your manual corrections were kept. You can review the current categories and continue.`) }
  }
  async function approveAndFill(targets) {
    if (missing) throw new Error('A selected invoice is no longer available. Update the selection in step 1.')
    const failures = targets.flatMap(invoice => canApprove(invoice, currentReview(invoice, reviews[invoice.id]), getOutline(invoiceMatter(invoice)), profile, invoiceMatter(invoice)).map(message => `${invoice.invoice_number}: ${message}`))
    if (failures.length) throw new Error([...new Set(failures)].join(' '))
    const nextReviews = { ...reviews }, now = new Date().toISOString()
    for (const invoice of targets) nextReviews[invoice.id] = { ...currentReview(invoice, reviews[invoice.id]), approved_at: now, approval_context: approvalContext(getOutline(invoiceMatter(invoice)), profile) }
    const generated = []
    for (const invoice of targets) {
      const outline = getOutline(invoiceMatter(invoice)), review = nextReviews[invoice.id]
      const bytes = await buildVoucherPdf({ invoice, review, outline, profile, matter: invoiceMatter(invoice), templateBytes: templateFor(outline), sign })
      generated.push({ id: invoice.id, bytes, name: filename(invoice), fingerprint: review.fingerprint, approved_at: review.approved_at, context: review.approval_context, sign })
    }
    // No approved state or download is exposed until the approval is saved.
    await commit({ ...value, profile, reviews: nextReviews })
    const ready = generated.map(item => ({ ...item, url: makeUrl(item.bytes) }))
    const ids = new Set(ready.map(voucher => voucher.id))
    setVouchers(current => [...current.filter(voucher => !ids.has(voucher.id)), ...ready])
    setNotice(`${targets.length} completed voucher${targets.length === 1 ? '' : 's'} ready to download.`)
  }
  const currentVouchers = vouchers.filter(voucher => {
    const invoice = selected.find(invoice => invoice.id === voucher.id)
    if (!invoice) return false
    const review = currentReview(invoice, reviews[invoice.id]), outline = getOutline(invoiceMatter(invoice))
    return approvedCurrent(invoice, review, outline, profile, invoiceMatter(invoice)) && review.approved_at === voucher.approved_at && review.fingerprint === voucher.fingerprint && approvalContext(outline, profile) === voucher.context && sign === voucher.sign
  })

  return <div className="apb-overlay" role="dialog" aria-modal="true" aria-label="Appointed billing"><section className="apb-shell">
    <header className="apb-header"><div className="apb-title"><div><h2>Appointed billing</h2><p>Create invoices, reuse matter outlines, and fill fee vouchers.</p></div><div className="apb-actions" style={{ margin: 0 }}><button disabled={!!busy} onClick={() => { if (change({ ...value, batch: { step: 1, matter_ids: [], invoice_ids: [] } })) { setVouchers([]); setNotice('New billing run started. Saved outlines and previous approvals are retained.'); setError('') } }}>New billing run</button><button onClick={onClose} disabled={!!busy}>Close</button></div></div>
      <nav className="apb-steps" aria-label="Appointed billing steps">{steps.map((label, i) => <button key={label} aria-current={step === i + 1 ? 'step' : undefined} disabled={!!busy || (i > 0 && (!selected.length || missing))} onClick={() => setBatch({ step: i + 1 })}><span>{i + 1}</span>{label}</button>)}</nav>
    </header>
    <div className="apb-body" aria-busy={!!busy}>
      {busy && <div className="apb-message" role="status">{busy}…</div>}
      {error && <div className="apb-message apb-error" role="alert">{error}</div>}
      {notice && <div className="apb-message apb-success" role="status">{notice}</div>}
      {settingsError && <div className="apb-message apb-error" role="alert">{settingsError}</div>}
      {settings === null && !settingsError && <div className="apb-empty">Loading appointed-case settings…</div>}
      {missing && <div className="apb-message apb-error">A selected invoice is no longer available or its matter is no longer appointed. Update your selection in step 1.</div>}

      {step === 1 && settings && <>
        <section className="apb-card"><div className="apb-section-title"><div><h3>Create invoices from WIP</h3><p>Includes matters marked Appointed in Billing Settings.</p></div><button disabled={!!busy} onClick={() => setBatch({ matter_ids: eligible.filter(m => num(financeFor(m).wip) > .005).map(m => String(m.id)) })}>Select all with WIP</button></div>
          {!eligible.length && <div className="apb-empty">No appointed matters found. Mark the matter Appointed in Billing Settings to include it.</div>}
          {eligible.map(matter => { const id = String(matter.id), wip = num(financeFor(matter).wip); return <label className="apb-row" key={id}>
            <input type="checkbox" disabled={!!busy || wip <= .005} checked={batch.matter_ids.includes(id)} onChange={e => setBatch({ matter_ids: e.target.checked ? [...batch.matter_ids, id] : batch.matter_ids.filter(item => item !== id) })} />
            <span><strong>{clientName(matter) || matter.name}</strong><small>{matter.cause_number || 'Cause number needed'} · {matter.name} · {matter.matter_type || matter.case_type || 'Other'}</small></span><span className="apb-amount"><strong>{usd(wip)}</strong><small>Work in progress</small></span>
          </label> })}
          <div className="apb-actions"><button className="apb-primary" disabled={!!busy || !batch.matter_ids.some(id => eligibleIds.has(id) && num(financeFor(eligible.find(m => String(m.id) === id)).wip) > .005)} onClick={() => onCreateWip(batch.matter_ids.filter(id => eligibleIds.has(id)))}>Review WIP & create invoices</button></div>
        </section>
        <section className="apb-card"><div className="apb-section-title"><div><h3>Invoices for this billing run</h3><p>New invoices are added here automatically. You can also select existing invoices.</p></div><button disabled={!!busy} onClick={() => setBatch({ invoice_ids: available.filter(invoice => invoice.status !== 'paid' && !approvedCurrent(invoice, currentReview(invoice, reviews[invoice.id]), getOutline(invoiceMatter(invoice)), profile, invoiceMatter(invoice))).map(invoice => String(invoice.id)) })}>Select outstanding without vouchers</button></div>
          {!available.length && <div className="apb-empty">Create invoices above to begin preparing vouchers.</div>}
          {[...available].sort((a, b) => String(b.created_at || b.issue_date).localeCompare(String(a.created_at || a.issue_date))).map(invoice => <label className="apb-row" key={invoice.id}>
            <input type="checkbox" disabled={!!busy} checked={batch.invoice_ids.includes(String(invoice.id))} onChange={e => setBatch({ invoice_ids: e.target.checked ? [...batch.invoice_ids, String(invoice.id)] : batch.invoice_ids.filter(id => id !== String(invoice.id)) })} />
            <span><strong>{invoice.client_name || invoice.matter_name}</strong><small>{invoice.invoice_number} · {invoice.issue_date} · {invoice.status}</small></span><strong className="apb-amount">{usd(invoice.total)}</strong>
          </label>)}
          <div className="apb-actions"><span>{selected.length} invoices selected · {usd(selected.reduce((sum, invoice) => sum + num(invoice.total), 0))}</span><button className="apb-primary" disabled={!!busy || !selected.length || missing} onClick={() => setBatch({ step: 2 })}>Continue to voucher outlines</button></div>
        </section>
      </>}

      {step === 2 && <>
        <div className="apb-review-bar"><strong>{outlineCount} of {selectedMatters.length} outlines ready</strong><button className="apb-primary" disabled={!!busy || !selected.length || missing || outlineCount !== selectedMatters.length || profileErrors(profile).length > 0} onClick={() => run('Suggesting billing categories', suggestCategories)}>Continue & fill voucher details</button></div>
        <section className="apb-card"><div className="apb-section-title"><div><h3>Attorney information</h3><p>Shared by the reusable outlines, just as in your first HTML.</p></div><button disabled={!!busy} onClick={() => setShowProfile(!showProfile)}>{showProfile ? 'Hide details' : 'Edit attorney information'}</button></div>
          {(showProfile || profileErrors(profile).length > 0) && <div className="apb-fields">{[['attorney_name', 'Attorney name'], ['bar_number', 'Bar card number'], ['ssn_last4', 'SSN last four digits'], ['phone', 'Telephone'], ['address', 'Mailing address']].map(([key, label]) => <Field key={key} label={label}><input type={key === 'ssn_last4' ? 'password' : 'text'} autoComplete={key === 'ssn_last4' ? 'off' : undefined} maxLength={key === 'ssn_last4' ? 4 : key === 'bar_number' ? 8 : undefined} disabled={!!busy} value={profile[key]} onChange={e => change({ ...value, profile: { ...profile, [key]: e.target.value } })} /></Field>)}</div>}
        </section>
        {selectedMatters.map(matter => { const outline = getOutline(matter), ready = !outlineErrors(outline, matter).length; return <section className="apb-card" key={matter.id}>
          <div className="apb-section-title"><div><h3>{clientName(matter) || matter.name}</h3><p>{matter.name}</p></div><span className={`apb-badge ${ready ? 'apb-approved' : ''}`}>{ready ? 'Saved outline ready' : 'Outline needs review'}</span></div>
          <div className="apb-fields"><Field label="Court"><input disabled={!!busy} value={outline.court} onChange={e => editOutline(matter, { court: e.target.value })} /></Field><Field label="Cause number"><input disabled={!!busy} value={outline.cause_number} onChange={e => editOutline(matter, { cause_number: e.target.value })} /></Field><Field label="Party name / child initials"><input disabled={!!busy} value={outline.party_name} onChange={e => editOutline(matter, { party_name: e.target.value })} /></Field>
            <Field label="CPS / DFPS appointment"><select disabled={!!busy} value={outline.cps !== false ? 'yes' : 'no'} onChange={e => editOutline(matter, { cps: e.target.value === 'yes' })}><option value="yes">Yes</option><option value="no">No</option></select></Field>
            {outline.cps !== false && <Field label="Person represented"><select disabled={!!busy} value={outline.represented_role} onChange={e => editOutline(matter, { represented_role: e.target.value })}><option value="">Select person represented</option>{ROLES.map(role => <option key={role} value={role}>{role === 'NonCustodial Parent' ? 'Non-Custodial Parent' : role}</option>)}</select></Field>}
            {outline.cps !== false && outline.represented_role === 'Child or Children' && <Field label="Number of children"><input disabled={!!busy} type="number" min={1} step={1} value={outline.child_count} onChange={e => editOutline(matter, { child_count: e.target.value })} /></Field>}
            <Field label="Appeal"><select disabled={!!busy} value={outline.appeal ? 'yes' : 'no'} onChange={e => editOutline(matter, { appeal: e.target.value === 'yes' })}><option value="no">No</option><option value="yes">Yes</option></select></Field>
          </div>
          {outlineErrors(outline, matter).filter(message => message.includes('differs')).map(message => <div className="apb-message apb-error" key={message}>{message}</div>)}
          <div className="apb-actions"><Field label="Import existing voucher outline"><input type="file" accept="application/pdf,.pdf" disabled={!!busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; run('Importing saved outline', () => importOutline(matter, file)) }} /></Field>
            <button disabled={!!busy} onClick={() => run('Preparing outline PDF', async () => download(makeUrl(await buildOutlinePdf({ outline, profile, templateBytes: templateFor(outline) })), `Voucher_Outline_${safeName(outline.cause_number)}.pdf`))}>Download outline</button>
            <button className="apb-primary" disabled={!!busy} onClick={() => run('Saving reusable outline', () => saveOutline(matter))}>Save voucher outline</button>
          </div>
        </section> })}
      </>}

      {step === 3 && <>
        <div className="apb-review-bar"><div><strong>{approved.length} of {selected.length} approved</strong><small>{usd(selected.reduce((sum, invoice) => sum + num(invoice.total), 0))} · all invoices below</small></div><button className="apb-primary" disabled={!!busy || !selected.length || missing} onClick={() => run('Approving and filling vouchers', () => approveAndFill(selected))}>Approve all & create vouchers</button></div>
        <div className="apb-actions apb-export"><label className="apb-check"><input type="checkbox" disabled={!!busy} checked={sign} onChange={e => setSign(e.target.checked)} />Add my typed attorney signature: /s/ {profile.attorney_name || 'Attorney name'}</label>
          {currentVouchers.length > 0 && <button disabled={!!busy} onClick={() => run('Preparing all completed vouchers', async () => { const { default: JSZip } = await import('jszip'); const zip = new JSZip(); for (const voucher of currentVouchers) zip.file(voucher.name, voucher.bytes); const bytes = await zip.generateAsync({ type: 'uint8array' }); const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })); urls.current.add(url); download(url, 'Appointed_Fee_Vouchers.zip') })}>Download {currentVouchers.length} completed vouchers</button>}
        </div>
        {selected.map((invoice, index) => { const review = currentReview(invoice, reviews[invoice.id]), summary = summarize(invoice, review), matter = invoiceMatter(invoice), outline = getOutline(matter), errors = canApprove(invoice, review, outline, profile, matter), isApproved = approvedCurrent(invoice, review, outline, profile, matter), voucher = currentVouchers.find(item => item.id === invoice.id); return <section className={`apb-card apb-invoice ${isApproved ? 'apb-card-approved' : ''}`} key={invoice.id}>
          <div className="apb-section-title"><div><small>INVOICE {index + 1} OF {selected.length}</small><h3>{invoice.client_name || clientName(matter) || invoice.matter_name}</h3><p>{invoice.invoice_number} · {outline.cause_number} · {invoice.issue_date}</p></div><div className="apb-amount"><strong>{usd(invoice.total)}</strong><span className={`apb-badge ${isApproved ? 'apb-approved' : ''}`}>{isApproved ? 'Approved' : 'Review categories'}</span></div></div>
          <div className="apb-table-wrap"><table className="apb-entries"><thead><tr><th>Service date / activity</th><th>Hours</th><th>Amount</th><th>Voucher category</th></tr></thead><tbody>{(invoice.line_items || []).map((line, i) => { const row = review.lines.find(item => item.id === String(i)); return <tr key={i}>
            <td><strong>{line.date || 'Service date needed'}</strong><p>{line.description || 'Description needed'}</p><small>{row.source === 'ai' ? 'AI suggestion: ' : row.source === 'manual' ? 'Your correction: ' : 'Suggested: '}{row.reason}</small>{num(line.hours) > 0 && <button className="apb-text-button" disabled={!!busy} onClick={() => changeLine(invoice, i, entry => entry.allocations.length === 1 ? splitLine(entry) : { ...entry, source: 'manual', allocations: [{ category: entry.allocations[0].category, hours: num(line.hours), amount: num(line.amount) }] })}>{row.allocations.length === 1 ? 'Split this activity' : 'Undo split'}</button>}</td>
            <td>{row.allocations.map((a, n) => <div className="apb-allocation" key={n}>{row.allocations.length === 1 ? String(line.hours ?? '—') : <input aria-label={`Split hours ${i + 1}.${n + 1} ${invoice.invoice_number}`} disabled={!!busy} type="number" min={0} max={line.hours} step="0.01" value={a.hours} onChange={e => changeLine(invoice, i, entry => changeSplitHours(entry, n, e.target.value, line))} />}</div>)}</td>
            <td>{row.allocations.map((a, n) => <div className="apb-allocation" key={n}>{usd(a.amount)}</div>)}</td>
            <td>{row.allocations.map((a, n) => <div className="apb-allocation" key={n}><select aria-label={`Voucher category ${i + 1}.${n + 1} ${invoice.invoice_number}`} className={!a.category ? 'apb-category-missing' : ''} disabled={!!busy} value={a.category} onChange={e => changeLine(invoice, i, entry => ({ ...entry, source: 'manual', reason: 'Category chosen during review.', allocations: entry.allocations.map((item, aIndex) => aIndex === n ? { ...item, category: e.target.value } : item) }))}><option value="">Choose category</option>{CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></div>)}</td>
          </tr> })}</tbody></table></div>
          <div className="apb-table-wrap apb-summary"><h4>Voucher category totals</h4><table><thead><tr><th>Category</th><th>Dates</th><th>Days</th><th>Hours</th><th>Amount</th></tr></thead><tbody>{summary.categories.map(c => <tr key={c.id}><td>{c.label}</td><td>{c.dates.join(', ')}</td><td>{c.days}</td><td>{Number(c.hours.toFixed(4))}</td><td>{usd(c.amount)}</td></tr>)}</tbody><tfoot><tr><th colSpan={4}>Voucher / invoice total</th><th>{usd(summary.total)} / {usd(invoice.total)}</th></tr></tfoot></table></div>
          {summary.errors.length > 0 && <div className="apb-message apb-error">{summary.errors.map(message => <p key={message}>{message}</p>)}</div>}
          {summary.warnings.length > 0 && <div className="apb-message apb-warning"><strong>Review before approval</strong><ul>{summary.warnings.map(message => <li key={message}>{message}</li>)}</ul><label className="apb-check"><input type="checkbox" disabled={!!busy} checked={!!review.acknowledged} onChange={e => change({ ...value, reviews: { ...reviews, [invoice.id]: { ...review, acknowledged: e.target.checked, approved_at: '' } } })} />I reviewed the voucher notes and amounts to be submitted.</label></div>}
          <div className="apb-actions"><span>{isApproved ? `Approval saved ${new Date(review.approved_at).toLocaleString()}` : 'Category changes clear this invoice’s approval.'}</span>
            {voucher && <a className="apb-download" href={voucher.url} download={voucher.name}>Download completed voucher</a>}
            <button className="apb-primary" disabled={!!busy || !!errors.length || missing} onClick={() => run('Approving and filling voucher', () => approveAndFill([invoice]))}>{isApproved ? 'Rebuild voucher' : 'Approve & create voucher'}</button>
          </div>
        </section> })}
      </>}
    </div>
  </section></div>
}
