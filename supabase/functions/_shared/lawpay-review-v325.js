// Read-only evidence hydration for the centralized LawPay review queue. The provider transaction
// remains the immutable anchor: names and amounts never establish a request, matter or invoice.
export function storedStateValue(row = null, fallback = null) {
  const value = row?.json_value ?? row?.raw_value
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

const text = (value) => String(value ?? '').trim()

export function transactionLinkage(row = {}, requests = [], invoices = [], events = []) {
  const raw = row?.raw && typeof row.raw === 'object' ? row.raw : {}
  const paymentRequestId = text(raw.mio_payment_request_id)
  const request = (requests || []).find((item) => text(item.id) === paymentRequestId) || null
  const invoiceNumber = text(request?.invoice_number || raw.mio_invoice_number || raw.invoice_number)
  const invoice = (invoices || []).find((item) => invoiceNumber && text(item.invoice_number).toUpperCase() === invoiceNumber.toUpperCase()) || null
  const providerEvents = (events || []).filter((item) => text(item.provider_event_id) === text(row.gateway_transaction_id) && text(item.event_type) === 'lawpay_payment_recorded')
  const event = invoice ? providerEvents.find((item) => text(item.invoice_id) === text(invoice.id)) || null : null
  const matterCandidates = [text(raw.mio_matter_id), text(request?.matter_id), text(invoice?.matter_id)].filter(Boolean)
  const clientCandidates = [text(raw.mio_client_id), text(request?.client_id), text(invoice?.client_id)].filter(Boolean)
  const matterId = matterCandidates[0] || '', clientId = clientCandidates[0] || ''
  const conflict = new Set(matterCandidates).size > 1
    ? 'The linked payment request and invoice name different matters. Review their immutable linkage before doing anything.'
    : providerEvents.length && invoice && !event
      ? 'The provider transaction was recorded against a different invoice. Review the immutable invoice event before doing anything.'
      : ''
  return {
    payment_request_id: paymentRequestId,
    request_found: !!request,
    payment_request_status: text(request?.status),
    invoice_number: invoiceNumber,
    invoice_id: text(invoice?.id),
    invoice_status: text(invoice?.status),
    invoice_event_id: text(event?.id),
    matter_id: matterId,
    client_id: clientId,
    reconciled: !!event,
    conflict,
  }
}
