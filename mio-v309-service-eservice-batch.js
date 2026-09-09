// Integrate with the current Service Inbox, not the removed legacy Clio handler.
// Missing anchors are a release error: never publish a V309 label without its feature.
function replaceOnce(code, from, to, label) {
  const at = code.indexOf(from)
  if (at < 0 || code.indexOf(from, at + from.length) >= 0) {
    throw new Error('V309 integration anchor changed: ' + label)
  }
  return code.slice(0, at) + to + code.slice(at + from.length)
}

function replaceSection(code, start, end, transform, label) {
  const at = code.indexOf(start)
  const stop = code.indexOf(end, at + start.length)
  if (at < 0 || stop < 0 || code.indexOf(start, at + start.length) >= 0) {
    throw new Error('V309 integration section changed: ' + label)
  }
  return code.slice(0, at) + transform(code.slice(at, stop)) + code.slice(stop)
}

export const serviceV309Helpers = String.raw`  // A separate queue per email survives React re-renders and failed save retries.
  const serviceV309BatchesRef = useRef(new Map())
  const serviceV309DocumentsRef = useRef(documents)
  useEffect(() => { serviceV309DocumentsRef.current = documents }, [documents])

  async function serviceV309PdfBytes(attachment) {
    if (!attachment) return null
    let blob = await normalizeServicePdfBlob(attachment.blob || attachment.file || null, attachment.content_type || 'application/pdf')
    if (!blob && attachment.content_url) {
      const response = await fetch(attachment.content_url)
      if (!response.ok) return null
      blob = await response.blob()
    }
    if (!blob || !blob.size) return null
    // Tyler can return a document-list/sign-in HTML page with a PDF-looking URL.
    const header = await blob.slice(0, 1024).text()
    return /%PDF-\d\.\d/.test(header) ? blob : null
  }

  function serviceV309PickWithButton() {
    // An awaited download can consume browser user activation. A new explicit click
    // is reliable, unlike repeatedly opening a blocked file picker or an alert loop.
    return new Promise((resolve) => {
      const overlay = document.createElement('div')
      Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '2147483647', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.4)' })
      const panel = document.createElement('div')
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-modal', 'true')
      panel.setAttribute('aria-label', 'Choose downloaded eService PDFs')
      Object.assign(panel.style, { background: 'white', color: '#111827', padding: '24px', borderRadius: '10px', width: '460px', maxWidth: '90vw', fontFamily: 'sans-serif' })
      const title = document.createElement('h3')
      title.textContent = 'Choose downloaded eService PDFs'
      const help = document.createElement('p')
      help.textContent = 'Select all PDFs from this email together. Mio will keep each original filename, save every selected PDF, and bill this email only once after all saves succeed.'
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.pdf,application/pdf'
      input.multiple = true
      input.style.display = 'none'
      const choose = document.createElement('button')
      choose.type = 'button'
      choose.textContent = 'Choose PDFs from Downloads'
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.textContent = 'Cancel'
      cancel.style.marginLeft = '12px'
      let finished = false
      const previousFocus = document.activeElement
      const finish = (files) => {
        if (finished) return
        finished = true
        overlay.remove()
        previousFocus?.focus?.()
        resolve(files)
      }
      input.onchange = () => finish(Array.from(input.files || []))
      input.oncancel = () => finish([])
      choose.onclick = () => input.click()
      cancel.onclick = () => finish([])
      overlay.onkeydown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); finish([]) }
        if (event.key === 'Tab') {
          if (event.shiftKey && document.activeElement === choose) { event.preventDefault(); cancel.focus() }
          else if (!event.shiftKey && document.activeElement === cancel) { event.preventDefault(); choose.focus() }
        }
      }
      panel.append(title, help, input, choose, cancel)
      overlay.append(panel)
      document.body.append(overlay)
      choose.focus()
    })
  }

  async function pickLocalServicePdfAttachment(row) {
    let files = []
    try {
      setServiceEmailScanNote('Select all downloaded PDFs for this eService email. Mio will preserve each filename and save the complete batch before billing.')
      if (typeof window.showOpenFilePicker === 'function') {
        try {
          const handles = await window.showOpenFilePicker({ multiple: true, startIn: 'downloads', types: [{ description: 'PDF files', accept: { 'application/pdf': ['.pdf'] } }] })
          files = await Promise.all(handles.map((handle) => handle.getFile()))
        } catch (error) {
          if (error?.name === 'AbortError') return null
          if (!['SecurityError', 'NotAllowedError'].includes(error?.name)) throw error
          files = await serviceV309PickWithButton()
        }
      } else {
        files = await serviceV309PickWithButton()
      }
      if (!files.length) return null
      const attachments = []
      const names = new Set()
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const name = verifiedServicePdfFileName(file.name || '')
        if (!name || !/\.pdf$/i.test(file.name || '')) throw new Error('Select the actual downloaded PDF with its original filename, not the Tyler document-list page.')
        if (names.has(name.toLowerCase())) throw new Error('Two selected PDFs have the same filename. Select distinct filenames so one document cannot replace another.')
        names.add(name.toLowerCase())
        if (!await serviceV309PdfBytes({ blob: file })) throw new Error(name + ' is not a readable PDF. Nothing was saved, billed, or moved.')
        attachments.push({ id: 'v309-local-' + row.id + '-' + Date.now() + '-' + index, name, actual_name_verified: true, file_name_source: 'selected_file', content_type: 'application/pdf', size: file.size, is_inline: false, content_loaded: true, blob: file })
      }
      // Validate the entire selection before exposing it to the save operation.
      attachments.forEach((item) => { item.content_url = URL.createObjectURL(item.blob) })
      serviceV309BatchesRef.current.set(String(row.id), attachments)
      setServiceEmailRows((rows) => rows.map((item) => item.id === row.id ? {
        ...item, has_attachments: true,
        attachments: [...attachments, ...(item.attachments || []).filter((existing) => !attachments.some((chosen) => chosen.name === existing.name))],
        extracted_pdf_name: attachments[0].name, extracted_pdf_name_source: 'selected_file', extracted_pdf_name_verified: true, suggested_document_name: attachments[0].name
      } : item))
      setSelectedPdfPreviewName(attachments[0].name)
      setSelectedPdfPreviewUrl(attachments[0].content_url)
      setServiceEmailScanNote('Selected ' + attachments.length + ' PDF(s). All will be saved with their original filenames; billing occurs once after the complete batch succeeds.')
      return attachments[0]
    } catch (error) {
      setServiceEmailScanNote('Could not select eService PDFs: ' + (error.message || error))
      throw error
    }
  }

  async function saveServiceV309Batch(row, attachments, options) {
    // Revalidate all bytes before any write, including retries after partial failures.
    for (const item of attachments) {
      if (!verifiedServicePdfFileName(item.name) || !await serviceV309PdfBytes(item)) throw new Error('The complete eService batch must contain readable PDFs with original filenames. No billing entry was created and the email was not moved.')
    }
    const savedFiles = []
    for (const item of attachments) {
      try {
        const result = await saveDownloadedServicePdf(row, item, { ...options, serviceV309BatchItem: true, allowPick: false, tryDirectDownload: false })
        if (!result || result.ok === false || result.verified === false) throw new Error('Save was not verified.')
        savedFiles.push(result)
      } catch (error) {
        throw new Error('Batch stopped at ' + item.name + ': ' + (error.message || error) + ' ' + savedFiles.length + ' of ' + attachments.length + ' PDFs were saved. Already-saved files remain in the matter folder; retry to finish. No new billing entry was created and the email was not moved.')
      }
    }
    return { ...savedFiles[0], ok: true, verified: true, savedFiles, files_saved_or_confirmed: savedFiles.map((item) => item.fileName) }
  }

`

export default function mioV309ServiceEserviceBatch() {
  return {
    name: 'mio-v309-service-eservice-batch',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      if (source.includes('const serviceV309BatchesRef = useRef(new Map())')) return { code: source, map: null }
      let code = replaceSection(source, '  async function pickLocalServicePdfAttachment(row) {', '  async function ensureServiceEmailDirectoryHandle(row) {', () => serviceV309Helpers, 'current PDF picker')

      code = replaceSection(code, '  async function saveDownloadedServicePdf(row, providedAttachment = null, options = {}) {', '  async function openServiceRowPdf(row) {', (section) => {
        section = replaceOnce(section, '    // Never manufacture a filename.', String.raw`    // Reject HTML/sign-in/document-list responses before saving or billing.
    let serviceV309Blob = await serviceV309PdfBytes(attachment)
    if (!serviceV309Blob && options.allowPick !== false) {
      attachment = await pickLocalServicePdfAttachment(currentRow)
      serviceV309Blob = await serviceV309PdfBytes(attachment)
    }
    if (!serviceV309Blob) throw new Error('No valid PDF was selected. Nothing was saved, billed, or moved. Download the actual documents from eService, then choose those PDFs.')
    attachment = { ...attachment, blob: serviceV309Blob, content_type: 'application/pdf' }

    // Never manufacture a filename.`, 'PDF bytes validation')
        section = replaceOnce(section, '    const fileName = actualFile.name', String.raw`    const serviceV309Batch = serviceV309BatchesRef.current.get(String(currentRow.id))
    if (!options.serviceV309BatchItem && serviceV309Batch?.some((item) => item.id === attachment.id)) {
      return await saveServiceV309Batch(currentRow, serviceV309Batch, options)
    }
    const fileName = actualFile.name`, 'batch save boundary')
        return section
      }, 'current PDF save flow')

      // Sequential batch records must build on the latest catalog, not the render's
      // stale documents snapshot (which otherwise drops all but the last PDF).
      code = replaceSection(code, '  async function createServiceEmailDocumentRecord(row, fileName, blob, savedInfo = {}) {', '  function classifyLiveServiceEmail(source, message) {', (section) => {
        section = replaceOnce(section, 'documents.find((doc)', 'serviceV309DocumentsRef.current.find((doc)', 'existing document lookup')
        section = replaceOnce(section, 'stripLargeFileData(documents)', 'stripLargeFileData(serviceV309DocumentsRef.current)', 'existing document catalog')
        section = replaceOnce(section, '    const nextDocuments = [documentRecord, ...documents]\n    setDocuments(nextDocuments)', '    const nextDocuments = [documentRecord, ...serviceV309DocumentsRef.current]\n    serviceV309DocumentsRef.current = nextDocuments\n    setDocuments(nextDocuments)', 'batch document catalog')
        return section
      }, 'document catalog persistence')

      code = replaceSection(code, '  async function processSingleFilingServiceEmail(row) {', '  async function sendSingleServiceEmailAndMove(row) {', (section) => {
        section = replaceOnce(section, `    const hearingSafety = await ensureNotificationHearingSafetyBeforeMove(row)
    if (!hearingSafety.ok) return false
    row = hearingSafety.row || row`, `    row = serviceEmailRows.find((item) => item.id === row.id) || row
    // Bill/save is independent of calendar review. Keep an unresolved alert in the
    // inbox instead of clearing it or silently moving the email out of sight.
    const serviceV309CalendarPending = serviceHearingNeedsAttention(row)`, 'nonblocking Bill and save')
        section = replaceOnce(section, "      if (serviceGraphConfig.mode === 'live' && serviceGraphAuth.connected) await moveLiveRowToRead(row)", "      if (!serviceV309CalendarPending && serviceGraphConfig.mode === 'live' && serviceGraphAuth.connected) await moveLiveRowToRead(row)", 'preserve pending calendar email')
        section = replaceOnce(section, '        notes: `${label}. PDF saved${billingEntry ? \', billing added\' : \'\'}.`,', "        notes: serviceV309CalendarPending ? 'PDFs saved and billing recorded; calendar review remains pending and the email was not moved.' : `${label}. PDF saved${billingEntry ? ', billing added' : ''}.`,", 'calendar audit note')
        section = replaceOnce(section, "        document_name: savedInfo.fileName || row.suggested_document_name || row.extracted_pdf_name || '',", "        document_name: savedInfo.files_saved_or_confirmed?.join('; ') || savedInfo.fileName || row.suggested_document_name || row.extracted_pdf_name || '',", 'batch audit filenames')
        section = replaceOnce(section, '        billing_added: Boolean(billingEntry)', "        billing_added: Boolean(billingEntry),\n        saved_files: savedInfo.savedFiles || [savedInfo],\n        calendar_review_pending: serviceV309CalendarPending", 'saved batch metadata')
        section = replaceOnce(section, `      setServiceEmailRows((current) => current.filter((item) => item.id !== row.id))
      setServiceEmailScanNote(\x60\x24{label}. Removed from this review queue.\x60)
      return true`, String.raw`      if (serviceV309CalendarPending) {
        setServiceEmailRows((current) => current.map((item) => item.id === row.id ? { ...item, billing_added: Boolean(billingEntry), saved_files: savedInfo.savedFiles || [savedInfo], calendar_review_pending: true } : item))
        setServiceEmailScanNote('Saved ' + (savedInfo.savedFiles?.length || 1) + ' PDF(s) and recorded billing. Calendar review is still pending; the email and its hearing alert remain in this queue.')
        return false
      }
      serviceV309BatchesRef.current.delete(String(row.id))
      setServiceEmailRows((current) => current.filter((item) => item.id !== row.id))
      setServiceEmailScanNote(label + '. Saved ' + (savedInfo.savedFiles?.length || 1) + ' PDF(s), billed this email once, and removed it from this review queue.')
      return true`, 'completion and pending review')
        return section
      }, 'current save-and-bill handler')
      code = code.replace(/const MIO_APP_VERSION = 'Mio V\d+'/g, "const MIO_APP_VERSION = 'Mio V309'")
      return { code, map: null }
    }
  }
}
