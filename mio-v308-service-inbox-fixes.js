function once(code, from, to, label) {
  const first = code.indexOf(from)
  if (first < 0 || code.indexOf(from, first + from.length) >= 0) throw new Error('V308 integration anchor changed: ' + label)
  return code.replace(from, to)
}

function onceAfter(code, anchor, from, to, label) {
  const anchorIndex = code.indexOf(anchor)
  if (anchorIndex < 0 || code.indexOf(anchor, anchorIndex + anchor.length) >= 0) throw new Error('V308 integration anchor changed: ' + label + ' anchor')
  const index = code.indexOf(from, anchorIndex + anchor.length)
  if (index < 0) throw new Error('V308 integration anchor changed: ' + label)
  const nextAnchor = code.indexOf(anchor, anchorIndex + anchor.length)
  if (nextAnchor >= 0 && index > nextAnchor) throw new Error('V308 integration anchor moved: ' + label)
  return code.slice(0, index) + to + code.slice(index + from.length)
}

export default function mioV308ServiceInboxFixes() {
  return {
    name: 'mio-v308-service-inbox-fixes',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      // Tyler's ViewServiceDocuments.aspx endpoint is a link endpoint, not a PDF filename.
      // Reject it before it can be persisted as ViewServiceDocuments.aspx.pdf.
      code = once(
        code,
        "if (/tylerhost(?:\\.net)?|efilingmail|viewdocuments(?:\\.aspx)?|content\\.tylerhost/i.test(lower)) return true",
        "if (/tylerhost(?:\\.net)?|efilingmail|view(?:service)?documents(?:\\.aspx)?|content\\.tylerhost/i.test(lower)) return true",
        'generic Tyler service filename rejection'
      )

      // Restore the legacy eFile filename fields that older Service Inbox versions populated.
      // This lets already-parsed rows retain their actual Tyler filename instead of falling back
      // to the URL endpoint name.
      code = once(
        code,
        "const rowCandidate = verifiedServicePdfFileName(row.extracted_pdf_name || row.efile_actual_file_name || '')",
        "const rowCandidate = verifiedServicePdfFileName(row.extracted_pdf_name || row.efile_actual_file_name || row.actual_file_name || row.selected_file_name || row.efiling_filename || row.file_name || '')",
        'legacy service filename candidates'
      )
      code = once(
        code,
        "const rowSource = String(row.extracted_pdf_name_source || row.efile_file_name_source || '').toLowerCase()",
        "const rowSource = String(row.extracted_pdf_name_source || row.efile_file_name_source || row.file_name_source || '').toLowerCase()",
        'legacy service filename source'
      )
      code = once(
        code,
        "return verifiedServicePdfFileName(file.name || '') || verifiedServicePdfFileName(row.extracted_pdf_name || '')",
        "return verifiedServicePdfFileName(file.name || '') || verifiedServicePdfFileName(row.extracted_pdf_name || row.efile_actual_file_name || row.actual_file_name || row.selected_file_name || row.efiling_filename || row.file_name || '')",
        'local service filename fallback'
      )

      // Calendar/setting review is advisory for this action. Bill + save must still save the PDF,
      // add the document, bill the matter, move the email to Read, and advance. The alert remains
      // unresolved until the user handles it separately.
      code = once(
        code,
        "disabled={!active || showSavedFilingReviewRows || serviceGraphBusy || (isNotice && serviceHearingNeedsAttention(active))} title={isNotice && active && serviceHearingNeedsAttention(active) ? 'Resolve the red hearing/calendar alert before saving and moving this email.' : ''}",
        "disabled={!active || showSavedFilingReviewRows || serviceGraphBusy} title={isNotice && active && serviceHearingNeedsAttention(active) ? 'Calendar review can remain pending; Bill and save will still process this filing.' : ''}",
        'modal Bill and save calendar gate'
      )
      code = once(
        code,
        "opacity: isNotice && active && serviceHearingNeedsAttention(active) ? .45 : 1",
        "opacity: 1",
        'modal Bill and save opacity'
      )

      const rowSaveAnchor = 'onClick={(event) => saveAndBillRow(row, event)}'
      code = onceAfter(
        code,
        rowSaveAnchor,
        "disabled={serviceGraphBusy || hearingAttention} title={hearingAttention ? 'Review the red hearing alert first.' : ''}",
        "disabled={serviceGraphBusy} title={hearingAttention ? 'Calendar review can remain pending; Bill and save will still process this filing.' : ''}",
        'row Bill and save calendar gate'
      )
      code = onceAfter(
        code,
        rowSaveAnchor,
        'opacity: hearingAttention ? .45 : 1',
        'opacity: 1',
        'row Bill and save opacity'
      )

      // Do not show a blocking alert immediately before the browser file picker. That alert can
      // consume Chrome's transient user activation and prevent showOpenFilePicker from opening.
      // Keep the same guidance as an in-page status note instead.
      code = once(
        code,
        "window.alert(`Case Controller could not verify the original filename from the eFile link",
        "setServiceEmailScanNote(`Case Controller could not verify the original filename from the eFile link",
        'pre-picker blocking alert'
      )

      // If a PDF really cannot be loaded, show one concise failure instead of instructing the user
      // that Chrome necessarily displayed a picker.
      code = once(
        code,
        "throw new Error('The PDF was not selected or loaded. Open/download the eFile PDF if needed, click Bill and save again, and choose that PDF when Chrome asks. No file was saved, billed, or moved.')",
        "throw new Error('Mio could not load the eFile PDF. Nothing was saved, billed, or moved. Open/download the PDF once from the filing link, then click Bill and save again; if Mio cannot fetch it automatically, select the downloaded PDF from Downloads.')",
        'save failure guidance'
      )

      return { code, map: null }
    }
  }
}
