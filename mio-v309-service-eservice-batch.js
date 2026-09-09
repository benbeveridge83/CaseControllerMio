function findMatchingBrace(source, openIndex) {
  if (source[openIndex] !== '{') return -1
  let depth = 0
  let mode = 'code'
  const templateReturnDepths = []

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]

    if (mode === 'line-comment') {
      if (char === '\n') mode = 'code'
      continue
    }
    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        mode = 'code'
        i += 1
      }
      continue
    }
    if (mode === 'single-quote') {
      if (char === '\\') i += 1
      else if (char === "'") mode = 'code'
      continue
    }
    if (mode === 'double-quote') {
      if (char === '\\') i += 1
      else if (char === '"') mode = 'code'
      continue
    }
    if (mode === 'template') {
      if (char === '\\') {
        i += 1
        continue
      }
      if (char === '`') {
        mode = 'code'
        continue
      }
      if (char === '$' && next === '{') {
        depth += 1
        templateReturnDepths.push(depth - 1)
        mode = 'code'
        i += 1
      }
      continue
    }

    if (char === '/' && next === '/') {
      mode = 'line-comment'
      i += 1
      continue
    }
    if (char === '/' && next === '*') {
      mode = 'block-comment'
      i += 1
      continue
    }
    if (char === "'") {
      mode = 'single-quote'
      continue
    }
    if (char === '"') {
      mode = 'double-quote'
      continue
    }
    if (char === '`') {
      mode = 'template'
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (templateReturnDepths.length && depth === templateReturnDepths[templateReturnDepths.length - 1]) {
        templateReturnDepths.pop()
        mode = 'template'
      }
      if (depth === 0) return i
    }
  }
  return -1
}

function removeManualClioGate(handler) {
  const blockPattern = /if\s*\(([^)]*matterPracticeId[^)]*)\)\s*\{[\s\S]{0,900}?\}/g
  handler = handler.replace(blockPattern, (block, condition) => {
    const isMissingMatterGate = /!\s*matterPracticeId/.test(condition)
    const isManualClioBlock = /clio/i.test(block) && /return\b/.test(block)
    return isMissingMatterGate && isManualClioBlock ? '' : block
  })

  const oneLinePattern = /if\s*\(\s*!\s*matterPracticeId\s*\)\s*(?:return\s+)?(?:window\.)?alert\([^;]{0,700}?\)\s*;?/g
  handler = handler.replace(oneLinePattern, (line) => /clio/i.test(line) ? '' : line)
  return handler
}

function rewriteBillAndSaveHandlers(code) {
  const marker = 'async function handleServiceBillAndSave('
  const starts = []
  let cursor = 0
  while (true) {
    const start = code.indexOf(marker, cursor)
    if (start < 0) break
    starts.push(start)
    cursor = start + marker.length
  }

  // Some earlier source transforms can replace the legacy named handler entirely.
  // In that case V309 must not fail the whole production build. The V308 fixes and
  // V309 release label still apply, while this optional batch layer is skipped.
  if (!starts.length) return { code, changed: false }

  let changed = 0
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const start = starts[index]
    const open = code.indexOf('{', start + marker.length)
    const close = findMatchingBrace(code, open)
    if (open < 0 || close < 0) continue
    const original = code.slice(start, close + 1)
    let next = original

    if (/await\s+askUserForExistingPdf\(\)/.test(next)) {
      next = next.replace(/await\s+askUserForExistingPdf\(\)/g, 'await askUserForExistingPdfBatch()')
    }

    const saveAnchor = 'await saveEFilePDF(email.serviceId, email.mailboxKey, folderPath, blob, chosenName)'
    if (next.includes(saveAnchor)) {
      next = next.replaceAll(saveAnchor, 'await saveEFilePDFBatchAware(email.serviceId, email.mailboxKey, folderPath, blob, chosenName)')
    }

    next = removeManualClioGate(next)
    if (next !== original) {
      code = code.slice(0, start) + next + code.slice(close + 1)
      changed += 1
    }
  }

  return { code, changed: changed > 0 }
}

const batchHelpers = `  // V309: an eService/Tyler notification can point to an HTML document list instead of one PDF.
  // Chrome cannot safely expose Tyler's cross-origin document list to Mio, so when the normal
  // direct-PDF path cannot resolve one file, let the user choose every already-downloaded PDF
  // in one picker. The existing Bill + save handler still owns the single 0.1-hour billing call.
  let servicePendingPdfBatch = []
  let servicePendingPdfBatchFirstBlob = null

  function servicePdfSelection(file) {
    if (!file) return null
    const filename = String(file.name || '').trim()
    if (!filename || (file.type !== 'application/pdf' && !/\\.pdf$/i.test(filename))) {
      throw new Error('Every selected eService document must be a PDF. Remove non-PDF files and try again.')
    }
    return { blob: file, filename }
  }

  async function askUserForExistingPdfBatch() {
    servicePendingPdfBatch = []
    servicePendingPdfBatchFirstBlob = null

    let selectedFiles = []
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: 'PDF documents', accept: { 'application/pdf': ['.pdf'] } }]
        })
        for (const handle of handles || []) selectedFiles.push(await handle.getFile())
      } catch (error) {
        if (error?.name === 'AbortError') return null
        throw error
      }
    } else {
      selectedFiles = await new Promise((resolve, reject) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.pdf,application/pdf'
        input.multiple = true
        input.style.display = 'none'
        let finished = false
        const finish = (files) => {
          if (finished) return
          finished = true
          window.removeEventListener('focus', focusFallback)
          input.remove()
          resolve(files)
        }
        const focusFallback = () => window.setTimeout(() => {
          if (!finished && !(input.files && input.files.length)) finish([])
        }, 350)
        input.onchange = () => finish(Array.from(input.files || []))
        input.oncancel = () => finish([])
        input.onerror = () => {
          if (finished) return
          finished = true
          window.removeEventListener('focus', focusFallback)
          input.remove()
          reject(new Error('Chrome could not open the PDF picker.'))
        }
        document.body.appendChild(input)
        window.addEventListener('focus', focusFallback, { once: true })
        input.click()
      })
    }

    const items = selectedFiles.map(servicePdfSelection).filter(Boolean)
    if (!items.length) return null
    servicePendingPdfBatchFirstBlob = items[0].blob
    servicePendingPdfBatch = items.slice(1)
    setServiceEmailScanNote(items.length > 1
      ? \`Selected \${items.length} eService PDFs. Mio will save all of them to the chosen matter folder with their original filenames and create only one 6-minute billing entry for this email.\`
      : \`Selected \${items[0].filename}. Mio will keep the original filename.\`)
    return items[0]
  }

  function serviceBatchFailure(status, message) {
    return {
      ok: false,
      status: Number(status || 400),
      json: async () => ({ error: message })
    }
  }

  async function saveEFilePDFBatchAware(serviceId, mailboxKey, folderPath, blob, filename) {
    const usePendingBatch = Boolean(servicePendingPdfBatchFirstBlob && blob === servicePendingPdfBatchFirstBlob)
    const queue = [{ blob, filename }, ...(usePendingBatch ? servicePendingPdfBatch : [])]
    servicePendingPdfBatch = []
    servicePendingPdfBatchFirstBlob = null

    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index]
      const itemName = String(item.filename || '').trim()
      const response = await saveEFilePDF(serviceId, mailboxKey, folderPath, item.blob, itemName)
      if (response?.ok) continue

      let body = null
      try { body = await response?.json?.() } catch {}
      const baseMessage = body?.error || \`Save failed for \${itemName || 'an eService PDF'}.\`
      if (Number(response?.status) === 409) {
        const keepExisting = window.confirm(
          \`\${itemName || 'This PDF'} already exists in the selected eFile folder.\\n\\n\` +
          'Click OK to keep the existing file and continue saving the rest of this eService batch, or Cancel to stop. No billing entry will be created and the email will not move to Read unless the whole batch completes.'
        )
        if (keepExisting) continue
        return serviceBatchFailure(422, \`Batch stopped at \${itemName || 'duplicate PDF'}. No billing entry was created and the email was not moved to Read.\`)
      }
      return serviceBatchFailure(response?.status || 500, \`\${itemName ? itemName + ': ' : ''}\${baseMessage} No billing entry was created and the email was not moved to Read.\`)
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, files_saved_or_confirmed: queue.map((item) => item.filename) })
    }
  }`

export default function mioV309ServiceEserviceBatch() {
  return {
    name: 'mio-v309-service-eservice-batch',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      code = code.replace(/const MIO_APP_VERSION = 'Mio V\d+'/g, "const MIO_APP_VERSION = 'Mio V309'")

      const handlerMarker = 'async function handleServiceBillAndSave('
      const firstHandler = code.indexOf(handlerMarker)
      if (firstHandler >= 0 && !code.includes('async function askUserForExistingPdfBatch()')) {
        code = code.slice(0, firstHandler) + batchHelpers + '\n\n' + code.slice(firstHandler)
      }

      code = rewriteBillAndSaveHandlers(code).code
      return { code, map: null }
    }
  }
}
