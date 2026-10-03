import { useEffect, useMemo, useState } from 'react'
import { autoFillEfilingDraft } from './mioEfilingAutoFill.js'
import { validateEfilingDraft } from './mioEfilingValidation.js'
import { assessSubmitReadiness, assertEfilingSubmissionAllowed } from './mioEfilingFlags.js'
import { EFILING_MODES, filingModeLabel, isServiceMode } from './mioEfilingModel.js'
import './mioEfiling.css'

function findDocument(documents, documentId) {
  return (documents || []).find((document) => String(document.id || document.documentId) === String(documentId)) || null
}

export default function MioEfilingPanel({
  matter = {},
  documents = [],
  filer = {},
  settings = {},
  flags = {},
  provider = null,
  repository = null,
  ownerId = '',
  onSaved = null,
}) {
  const safeDocuments = useMemo(() => (Array.isArray(documents) ? documents : []), [documents])
  const [draft, setDraft] = useState(() => autoFillEfilingDraft({ matter, filer, settings }))
  const [validation, setValidation] = useState(() => validateEfilingDraft(autoFillEfilingDraft({ matter, filer, settings }), matter, null))
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [filingCodes, setFilingCodes] = useState([])
  const [courts, setCourts] = useState([])
  const [serviceInfo, setServiceInfo] = useState({ contacts: [] })
  const [paymentAccounts, setPaymentAccounts] = useState([])
  const [feeResult, setFeeResult] = useState(null)
  const [savedDrafts, setSavedDrafts] = useState([])

  const readiness = useMemo(() => assessSubmitReadiness(flags, settings), [flags, settings])
  const selectedDocument = useMemo(() => findDocument(safeDocuments, draft.documentId), [safeDocuments, draft.documentId])

  function rebuildDraft(document) {
    setDraft((current) => {
      const next = autoFillEfilingDraft({ matter, document, filer, settings })
      if (current && current.id) {
        next.id = current.id
        next.filingMode = current.filingMode
        next.filingCode = current.filingCode
        next.filingCodeId = current.filingCodeId
        next.filingDescription = current.filingDescription || next.filingDescription
        next.paymentAccountId = current.paymentAccountId
        next.paymentAccountLabel = current.paymentAccountLabel
        next.target = current.target
        next.feeWaiver = current.feeWaiver
        next.initialFiling = current.initialFiling
        next.documentSecurity = current.documentSecurity
        next.serviceContacts = current.serviceContacts && current.serviceContacts.length ? current.serviceContacts : next.serviceContacts
      }
      return next
    })
  }

  function patchDraft(patch) {
    setDraft((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))
  }

  useEffect(() => {
    if (provider?.mode !== 'mock') return
    let cancelled = false
    Promise.allSettled([
      provider.getCourts(settings.jurisdictionState || 'TX'),
      provider.getFilingCodes(draft.courtLocationId, draft.caseType),
      provider.getServiceInformation(draft.caseId),
      provider.getPaymentAccounts(''),
    ]).then(([courtsResult, codesResult, serviceResult, accountsResult]) => {
      if (cancelled) return
      if (courtsResult.status === 'fulfilled') setCourts(courtsResult.value)
      if (codesResult.status === 'fulfilled') setFilingCodes(codesResult.value)
      if (serviceResult.status === 'fulfilled') setServiceInfo(serviceResult.value)
      if (accountsResult.status === 'fulfilled') setPaymentAccounts(accountsResult.value)
    })
    return () => { cancelled = true }
  }, [provider, settings.jurisdictionState, draft.courtLocationId, draft.caseType, draft.caseId])

  useEffect(() => {
    if (!repository || !ownerId || !matter.id) return
    let cancelled = false
    repository.listDrafts(ownerId, matter.id).then((rows) => {
      if (!cancelled) setSavedDrafts(Array.isArray(rows) ? rows : [])
    }).catch(() => {
      if (!cancelled) setSavedDrafts([])
    })
    return () => { cancelled = true }
  }, [repository, ownerId, matter.id])

  function handleSelectDocument(event) {
    const document = findDocument(safeDocuments, event.target.value)
    rebuildDraft(document)
    setFeeResult(null)
    setNotice('')
    setError('')
  }

  function handleModeChange(mode) {
    patchDraft({ filingMode: mode })
  }

  function handleFieldChange(field, value) {
    patchDraft({ [field]: value })
  }

  function runValidation() {
    const result = validateEfilingDraft(draft, matter, selectedDocument)
    setValidation(result)
    return result
  }

  async function handleSaveDraft() {
    const result = runValidation()
    if (!result.ready) {
      setError('Resolve the blocking issues before marking this draft ready. Saving an in-progress draft is still allowed.')
    }
    if (!repository) {
      setNotice('Draft prepared locally (no repository configured).')
      return
    }
    setBusy('saving')
    setError('')
    try {
      const payload = { ...draft, validationStatus: result.status, validationIssues: [...result.blockingIssues, ...result.warnings] }
      const saved = await repository.saveDraft(ownerId, payload, 'efiling_draft_saved')
      setDraft((current) => ({ ...current, id: saved?.id || current.id, revision: saved?.revision ?? current.revision }))
      await repository.recordEvent(ownerId, matter.id, saved?.id || draft.id, 'efiling_draft_validated', { status: result.status })
      setNotice('E-filing draft saved.')
      if (onSaved) onSaved(saved)
      const rows = await repository.listDrafts(ownerId, matter.id)
      setSavedDrafts(Array.isArray(rows) ? rows : [])
    } catch (saveError) {
      setError(saveError?.message || 'E-filing draft save failed.')
    } finally {
      setBusy('')
    }
  }

  async function handleCalculateFees() {
    if (!provider) return
    setBusy('fees')
    setError('')
    try {
      const result = await provider.calculateFees(draft)
      setFeeResult(result)
      patchDraft({
        feeCalculationStatus: result.status,
        estimatedFees: result.estimatedFees,
        feeBreakdown: result.feeBreakdown || [],
      })
    } catch (feeError) {
      setError(feeError?.message || 'Fee calculation failed.')
    } finally {
      setBusy('')
    }
  }

  async function handleSubmit(target) {
    if (!provider) return
    setBusy('submitting')
    setError('')
    try {
      assertEfilingSubmissionAllowed(target, flags, settings)
      const result = await provider.submitFiling(draft)
      patchDraft({
        target,
        tylerEnvelopeId: result.tylerEnvelopeId || '',
        tylerFilingId: result.tylerFilingId || '',
        tylerStatus: result.tylerStatus || 'submitted',
        tylerStatusLastCheckedAt: result.tylerStatusLastCheckedAt || new Date().toISOString(),
        submittedAt: result.submittedAt || new Date().toISOString(),
        receiptUrl: result.receiptUrl || '',
      })
      if (repository) await repository.recordEvent(ownerId, matter.id, draft.id, 'efiling_ready', { target, envelopeId: result.tylerEnvelopeId })
      setNotice(`Mock submission prepared. Envelope ${result.tylerEnvelopeId || ''} (no live filing occurred).`)
    } catch (submitError) {
      setError(submitError?.message || 'Submission blocked.')
    } finally {
      setBusy('')
    }
  }

  const blockingFields = validation.blockingIssues.map((item) => item.field)
  const canSubmitMock = validation.ready && readiness.allowed.mock
  const badgeClass = validation.status === 'valid' ? 'mio-efiling-badge--valid' : validation.status === 'blocked' ? 'mio-efiling-badge--blocked' : 'mio-efiling-badge--mock'
  const badgeLabel = validation.status === 'valid' ? 'Ready' : validation.status === 'blocked' ? 'Action needed' : 'Needs review'

  return (
    <section className="mio-efiling-panel" aria-label="E-Filing Draft Review">
      <h2>
        E-Filing Draft Review
        <span className={`mio-efiling-badge ${badgeClass}`}>{badgeLabel}</span>
      </h2>

      <div className={`mio-efiling-badge ${provider?.mode === 'mock' ? 'mio-efiling-badge--mock' : 'mio-efiling-badge--blocked'}`}>
        {provider ? provider.label : 'No provider configured'}
      </div>

      <div className="mio-efiling-row">
        <label className="mio-efiling-field">
          <strong>Document</strong>
          <select value={draft.documentId} onChange={handleSelectDocument} aria-label="Document" aria-invalid={blockingFields.includes('documentId')}>
            <option value="">Select a document…</option>
            {safeDocuments.map((document) => (
              <option key={document.id || document.documentId} value={document.id || document.documentId}>
                {document.file_name || document.name || document.fileName || document.id}
              </option>
            ))}
          </select>
        </label>
        <label className="mio-efiling-field">
          <strong>Filing mode</strong>
          <select value={draft.filingMode} onChange={(event) => handleModeChange(event.target.value)} aria-label="Filing mode" aria-invalid={blockingFields.includes('filingMode')}>
            <option value="">Choose a mode…</option>
            {Object.values(EFILING_MODES).map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mio-efiling-modes">
        {Object.values(EFILING_MODES).map((mode) => (
          <button key={mode.value} type="button" className="mio-efiling-mode" aria-pressed={draft.filingMode === mode.value} onClick={() => handleModeChange(mode.value)}>
            {mode.label}
          </button>
        ))}
      </div>

      <div className="mio-efiling-row">
        <label className="mio-efiling-field">
          <strong>County</strong>
          <input value={draft.county} onChange={(event) => handleFieldChange('county', event.target.value)} aria-invalid={blockingFields.includes('county')} />
        </label>
        <label className="mio-efiling-field">
          <strong>Court</strong>
          {courts.length ? (
            <select value={draft.court} onChange={(event) => {
              const court = courts.find((item) => item.name === event.target.value)
              handleFieldChange('court', event.target.value)
              handleFieldChange('courtLocationId', court?.locationId || court?.id || '')
              handleFieldChange('county', court?.county || draft.county)
            }} aria-invalid={blockingFields.includes('court')}>
              <option value="">Select a court…</option>
              {courts.map((court) => (
                <option key={court.id} value={court.name}>{court.name} — {court.county}</option>
              ))}
            </select>
          ) : (
            <input value={draft.court} onChange={(event) => handleFieldChange('court', event.target.value)} aria-invalid={blockingFields.includes('court')} />
          )}
        </label>
        <label className="mio-efiling-field">
          <strong>Cause number</strong>
          <input value={draft.causeNumber} onChange={(event) => handleFieldChange('causeNumber', event.target.value)} aria-invalid={blockingFields.includes('causeNumber')} />
        </label>
        <label className="mio-efiling-field">
          <strong>Case type</strong>
          <input value={draft.caseType} onChange={(event) => handleFieldChange('caseType', event.target.value)} />
        </label>
      </div>

      <div className="mio-efiling-row">
        <label className="mio-efiling-field">
          <strong>Filing attorney</strong>
          <input value={draft.filingAttorneyName} onChange={(event) => handleFieldChange('filingAttorneyName', event.target.value)} aria-invalid={blockingFields.includes('filingAttorneyId')} />
        </label>
        <label className="mio-efiling-field">
          <strong>Bar number</strong>
          <input value={draft.filingAttorneyBarNumber} onChange={(event) => handleFieldChange('filingAttorneyBarNumber', event.target.value)} />
        </label>
        <label className="mio-efiling-field">
          <strong>Filing code</strong>
          {filingCodes.length ? (
            <select value={draft.filingCode} onChange={(event) => handleFieldChange('filingCode', event.target.value)}>
              <option value="">Select a filing code…</option>
              {filingCodes.map((code) => (
                <option key={code.id} value={code.filingCode}>{code.filingDescription || code.filingCode}</option>
              ))}
            </select>
          ) : (
            <input value={draft.filingCode} onChange={(event) => handleFieldChange('filingCode', event.target.value)} />
          )}
        </label>
        <label className="mio-efiling-field">
          <strong>Filing description</strong>
          <input value={draft.filingDescription} onChange={(event) => handleFieldChange('filingDescription', event.target.value)} />
        </label>
      </div>

      <div className="mio-efiling-row">
        <label className="mio-efiling-field">
          <strong>Document security</strong>
          <select value={draft.documentSecurity} onChange={(event) => handleFieldChange('documentSecurity', event.target.value)}>
            <option value="public">Public</option>
            <option value="sensitive">Sensitive data document</option>
            <option value="confidential">Confidential / sealed</option>
          </select>
        </label>
        <label className="mio-efiling-field">
          <strong>Payment account</strong>
          {paymentAccounts.length ? (
            <select value={draft.paymentAccountId} onChange={(event) => {
              const account = paymentAccounts.find((item) => item.id === event.target.value)
              handleFieldChange('paymentAccountId', event.target.value)
              handleFieldChange('paymentAccountLabel', account?.label || '')
            }}>
              <option value="">Select a payment account…</option>
              {paymentAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.label}</option>
              ))}
            </select>
          ) : (
            <input value={draft.paymentAccountLabel} onChange={(event) => handleFieldChange('paymentAccountLabel', event.target.value)} />
          )}
        </label>
      </div>

      {isServiceMode(draft.filingMode) && (
        <div>
          <h3>Service contacts</h3>
          <div className="mio-efiling-muted">
            {(serviceInfo.contacts && serviceInfo.contacts.length ? serviceInfo.contacts : draft.serviceContacts).map((contact) => (
              <div key={contact.id} className="mio-efiling-issue mio-efiling-issue--warning" style={{ marginBottom: 6 }}>
                <span>{contact.selected === false ? '☐' : '☑'}</span>
                <span>{contact.name}{contact.email ? ` — ${contact.email}` : ''}{contact.firm ? ` (${contact.firm})` : ''}</span>
              </div>
            ))}
            {(!serviceInfo.contacts || !serviceInfo.contacts.length) && !draft.serviceContacts.length && (
              <div className="mio-efiling-issue mio-efiling-issue--blocking">No service contacts found. Add opposing counsel or party contacts to this matter.</div>
            )}
          </div>
        </div>
      )}

      <div>
        <h3>Validation</h3>
        <div className="mio-efiling-issues">
          {!validation.blockingIssues.length && !validation.warnings.length && (
            <div className="mio-efiling-notice">All required fields are complete.</div>
          )}
          {validation.blockingIssues.map((item) => (
            <div key={item.code} className="mio-efiling-issue mio-efiling-issue--blocking">
              <span>⛔</span><span><strong>{item.field}:</strong> {item.message}{item.fix ? ` ${item.fix}` : ''}</span>
            </div>
          ))}
          {validation.warnings.map((item) => (
            <div key={item.code} className="mio-efiling-issue mio-efiling-issue--warning">
              <span>⚠️</span><span><strong>{item.field}:</strong> {item.message}{item.fix ? ` ${item.fix}` : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {feeResult && (
        <div>
          <h3>Estimated fees (mock)</h3>
          <div className="mio-efiling-muted">
            {(feeResult.feeBreakdown || []).map((fee) => (
              <div key={fee.label}>{fee.label}: ${fee.amount}</div>
            ))}
            <div><strong>Total: ${feeResult.estimatedFees}</strong></div>
          </div>
        </div>
      )}

      <div className="mio-efiling-actions">
        <button type="button" onClick={runValidation} disabled={Boolean(busy)}>Validate draft</button>
        <button type="button" onClick={handleCalculateFees} disabled={Boolean(busy) || !provider}>{busy === 'fees' ? 'Calculating…' : 'Calculate fees (mock)'}</button>
        <button type="button" className="mio-efiling-primary" onClick={handleSaveDraft} disabled={Boolean(busy) || !repository}>{busy === 'saving' ? 'Saving…' : 'Save draft'}</button>
        <button type="button" className="mio-efiling-danger" onClick={() => handleSubmit('mock')} disabled={!canSubmitMock || Boolean(busy)} title={readiness.reasons.join(' ')}>
          {busy === 'submitting' ? 'Submitting…' : 'Submit (mock)'}
        </button>
        <button type="button" onClick={() => handleSubmit('stage')} disabled title={readiness.reasons.join(' ')}>Submit to Stage</button>
        <button type="button" onClick={() => handleSubmit('production')} disabled title={readiness.reasons.join(' ')}>Submit to Production</button>
      </div>

      {readiness.reasons.length > 0 && (
        <div className="mio-efiling-muted">
          {readiness.reasons.map((reason) => <div key={reason}>• {reason}</div>)}
        </div>
      )}

      {savedDrafts.length > 0 && (
        <div>
          <h3>Saved drafts</h3>
          <div className="mio-efiling-muted">
            {savedDrafts.map((saved) => (
              <div key={saved.id}>{saved.selectedDocumentName || 'Draft'} — {filingModeLabel(saved.filingMode)} — {saved.validationStatus || 'draft'}</div>
            ))}
          </div>
        </div>
      )}

      {notice && <div className="mio-efiling-notice">{notice}</div>}
      {error && <div className="mio-efiling-error">{error}</div>}
    </section>
  )
}





