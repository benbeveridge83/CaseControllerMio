function once(code, from, to, label) {
  const first = code.indexOf(from)
  if (first < 0 || code.indexOf(from, first + from.length) >= 0) throw new Error('V308 integration anchor changed: ' + label)
  return code.replace(from, to)
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

      // Restore legacy filename fields populated by older Service Inbox versions.
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

      // Calendar/setting review is advisory for Bill + save. Earlier Vite transforms may have
      // already rewritten the surrounding button markup, so remove only the actual gate rather
      // than depending on the full JSX attribute string.
      code = code.replaceAll(' || (isNotice && serviceHearingNeedsAttention(active))', '')
      code = code.replaceAll('disabled={serviceGraphBusy || hearingAttention}', 'disabled={serviceGraphBusy}')
      code = code.replaceAll("title={hearingAttention ? 'Review the red hearing alert first.' : ''}", "title={hearingAttention ? 'Calendar review can remain pending; Bill and save will still process this filing.' : ''}")
      code = code.replaceAll('opacity: hearingAttention ? .45 : 1', 'opacity: 1')
      code = code.replaceAll('opacity: isNotice && active && serviceHearingNeedsAttention(active) ? .45 : 1', 'opacity: 1')
      code = code.replaceAll("'Resolve the red hearing/calendar alert before saving and moving this email.'", "'Calendar review can remain pending; Bill and save will still process this filing.'")

      // Do not show a blocking alert immediately before the browser file picker. That alert can
      // consume Chrome's transient user activation and prevent showOpenFilePicker from opening.
      code = once(
        code,
        "window.alert(`Case Controller could not verify the original filename from the eFile link",
        "setServiceEmailScanNote(`Case Controller could not verify the original filename from the eFile link",
        'pre-picker blocking alert'
      )

      // If a PDF genuinely cannot be loaded, show one concise failure rather than claiming that
      // Chrome necessarily displayed a picker.
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
