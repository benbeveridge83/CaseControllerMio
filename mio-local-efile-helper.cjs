#!/usr/bin/env node
// Case Controller Mio local eFile helper and browser agent.
// Run from the project folder with: npm run efile-agent
//
// Security boundaries:
// - listens only on 127.0.0.1
// - accepts browser requests only from approved Mio origins
// - never receives or stores eFileTexas credentials
// - never submits an envelope without a separate, exact approval phrase
// - stages PDFs locally; no document contents are stored in Mio/Supabase

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const HOST = '127.0.0.1'
const PORT = Number(process.env.MIO_EFILE_AGENT_PORT || 8787)
const EFILE_URL = 'https://efiletx.tylertech.cloud/OfsEfsp/ui/landing'
const AGENT_VERSION = 'Mio eFile Browser Agent V267'
const MAX_BODY_BYTES = 150 * 1024 * 1024
const MAX_PDF_BYTES = 50 * 1024 * 1024
const DATA_DIR = process.platform === 'win32' && process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'CaseControllerMio', 'efile-agent')
  : path.join(os.tmpdir(), 'case-controller-mio-efile-agent')
const PROFILE_DIR = path.join(DATA_DIR, 'chrome-profile')
const JOBS_DIR = path.join(DATA_DIR, 'jobs')
const DEFAULT_ALLOWED_ORIGINS = [
  'https://case-controller-mio.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...String(process.env.MIO_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
])

let browserContext = null
let efilePage = null
const jobs = new Map()

function requestOrigin(req) {
  return String(req.headers.origin || '').replace(/\/$/, '')
}

function isOriginAllowed(req) {
  const origin = requestOrigin(req)
  return !origin || ALLOWED_ORIGINS.has(origin)
}

function corsHeaders(req) {
  const origin = requestOrigin(req)
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin'
  }
}

function sendJson(req, res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(req)
  })
  res.end(JSON.stringify(data))
}

function sanitizeFileName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '')
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned || 'efile-document'}.pdf`
}

function sanitizeId(value, fallback = 'item') {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 100) || fallback
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&nbsp;/gi, ' ')
}

function stripTags(value) {
  return htmlDecode(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function resolveUrl(base, href) {
  try { return new URL(href, base).toString() } catch { return '' }
}

function isAllowedEfileUrl(value) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && /(^|\.)(efiletx\.tylertech\.cloud|texas\.tylertech\.cloud)$/i.test(parsed.hostname)
  } catch {
    return false
  }
}

async function fetchBuffer(url, options = {}) {
  if (!isAllowedEfileUrl(url)) throw new Error('Only official Tyler/eFileTexas HTTPS links are allowed.')
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 CaseControllerMioLocalHelper',
      Accept: 'application/pdf,text/html,application/xhtml+xml,*/*',
      ...(options.headers || {})
    }
  })
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const contentType = response.headers.get('content-type') || ''
  const finalUrl = response.url || url
  if (!isAllowedEfileUrl(finalUrl)) throw new Error('The eFile link redirected outside the official Tyler/eFileTexas domain.')
  return { response, buffer, contentType, finalUrl }
}

function findPdfNameFromHtml(html, fallbackName) {
  const plain = stripTags(html)
  const patterns = [
    /Lead\s+Document\s+Page\s+Count\s+([A-Za-z0-9][^\r\n<>]{1,180}\.pdf)/i,
    /Lead\s+Document\s+([A-Za-z0-9][^\r\n<>]{1,180}\.pdf)/i,
    /Document\s+Details[\s\S]{0,900}?([A-Za-z0-9][^\r\n<>]{1,180}\.pdf)/i,
    /([A-Za-z0-9][^\r\n<>]{1,180}\.pdf)/i
  ]
  for (const pattern of patterns) {
    const match = plain.match(pattern) || String(html || '').match(pattern)
    if (match && match[1]) return sanitizeFileName(stripTags(match[1]))
  }
  return sanitizeFileName(fallbackName || 'efile-document.pdf')
}

function findDownloadUrlFromHtml(html, baseUrl) {
  const anchors = [...String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: htmlDecode(match[1]), text: stripTags(match[2]), raw: match[0] }))

  const preferred = anchors.find((a) => /download\s+document/i.test(a.text))
    || anchors.find((a) => /file\s+stamped\s+copy/i.test(a.raw + ' ' + a.text))
    || anchors.find((a) => /download|document|pdf|viewdocuments/i.test(a.href + ' ' + a.text))
    || anchors.find((a) => /\.pdf(\?|#|$)/i.test(a.href))

  return preferred ? resolveUrl(baseUrl, preferred.href) : ''
}

async function getPdfFromEfileUrl(sourceUrl, expectedPdfName) {
  const first = await fetchBuffer(sourceUrl)
  if (!first.response.ok) throw new Error(`eFile link returned HTTP ${first.response.status}`)

  const firstLooksPdf = /application\/pdf/i.test(first.contentType) || first.buffer.slice(0, 5).toString() === '%PDF-'
  if (firstLooksPdf) {
    return {
      buffer: first.buffer,
      pdfName: sanitizeFileName(expectedPdfName || path.basename(new URL(first.finalUrl).pathname) || 'efile-document.pdf'),
      sourceUrl: first.finalUrl
    }
  }

  const html = first.buffer.toString('utf8')
  const pdfName = findPdfNameFromHtml(html, expectedPdfName)
  const downloadUrl = findDownloadUrlFromHtml(html, first.finalUrl)
  if (!downloadUrl) throw new Error('The helper opened the eFile page but could not find the Download Document link inside it.')

  const second = await fetchBuffer(downloadUrl, { headers: { Referer: first.finalUrl } })
  if (!second.response.ok) throw new Error(`Download Document link returned HTTP ${second.response.status}`)
  const secondLooksPdf = /application\/pdf/i.test(second.contentType) || second.buffer.slice(0, 5).toString() === '%PDF-'
  if (!secondLooksPdf) throw new Error(`Download Document did not return a PDF. Content-Type was ${second.contentType || 'unknown'}.`)

  return { buffer: second.buffer, pdfName, sourceUrl: second.finalUrl }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      body += chunk
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        settled = true
        reject(new Error('Request body too large. Stage fewer or smaller PDFs.'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (settled) return
      try { resolve(body ? JSON.parse(body) : {}) } catch (error) { reject(error) }
    })
    req.on('error', (error) => { if (!settled) reject(error) })
  })
}

function locateChromeExecutable() {
  const candidates = process.platform === 'win32' ? [
    process.env.MIO_CHROME_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ] : [
    process.env.MIO_CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ]
  return candidates.filter(Boolean).find((candidate) => fs.existsSync(candidate)) || ''
}

function publicJob(job) {
  if (!job) return null
  const page = job.page ? {
    url: job.page.url || '',
    title: job.page.title || '',
    needs_sign_in: Boolean(job.page.needs_sign_in),
    signed_in: Boolean(job.page.signed_in),
    ready_for_review: Boolean(job.page.ready_for_review),
    submitted: Boolean(job.page.submitted),
    envelope_number: job.page.envelope_number || ''
  } : null
  return {
    id: job.id,
    status: job.status,
    pause_reason: job.pause_reason || '',
    error: job.error || '',
    created_at: job.created_at,
    updated_at: job.updated_at,
    submitted_at: job.submitted_at || '',
    envelope_number: job.envelope_number || '',
    page,
    matter_id: job.matter_id || '',
    cause_number: job.cause_number || '',
    case_style: job.case_style || '',
    court_name: job.court_name || '',
    efile_location: job.efile_location || '',
    filing_kind: job.filing_kind || 'existing',
    service_type: job.service_type || 'efile_and_serve',
    payment_account: job.payment_account || '',
    filing_comments: job.filing_comments || '',
    filings: (job.filings || []).map((filing) => ({
      id: filing.id,
      filing_code: filing.filing_code || '',
      description: filing.description || '',
      security: filing.security || 'public',
      documents: (filing.documents || []).map((document) => ({
        id: document.id,
        file_name: document.file_name,
        size: document.size,
        role: document.role || 'lead'
      }))
    })),
    audit: (job.audit || []).slice(-100)
  }
}

function persistJob(job) {
  try {
    fs.mkdirSync(JOBS_DIR, { recursive: true })
    fs.writeFileSync(path.join(JOBS_DIR, `${sanitizeId(job.id)}.json`), JSON.stringify(publicJob(job), null, 2))
  } catch (error) {
    console.warn('[mio-efile-agent] Could not persist job metadata:', error.message || error)
  }
}

function audit(job, action, detail = '') {
  job.audit = Array.isArray(job.audit) ? job.audit : []
  job.audit.push({ id: crypto.randomUUID(), at: new Date().toISOString(), action, detail: String(detail || '') })
  job.updated_at = new Date().toISOString()
  persistJob(job)
}

function loadPersistedJobs() {
  try {
    fs.mkdirSync(JOBS_DIR, { recursive: true })
    for (const name of fs.readdirSync(JOBS_DIR)) {
      if (!name.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, name), 'utf8'))
        if (parsed?.id) {
          const jobDir = path.join(JOBS_DIR, sanitizeId(parsed.id))
          parsed.filings = (parsed.filings || []).map((filing) => ({
            ...filing,
            documents: (filing.documents || []).map((document) => {
              const stagedPath = path.join(jobDir, `${sanitizeId(document.id, 'document')}-${sanitizeFileName(document.file_name)}`)
              return { ...document, staged_path: fs.existsSync(stagedPath) ? stagedPath : '' }
            })
          }))
          jobs.set(String(parsed.id), parsed)
        }
      } catch {}
    }
  } catch {}
}

function decodePdfDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:application\/pdf(?:;[^,]*)?;base64,([A-Za-z0-9+/=\r\n]+)$/i)
  if (!match) throw new Error('Only base64-encoded PDF files can be staged.')
  const buffer = Buffer.from(match[1].replace(/\s/g, ''), 'base64')
  if (!buffer.length || buffer.slice(0, 5).toString() !== '%PDF-') throw new Error('A staged file is not a valid PDF.')
  if (buffer.length > MAX_PDF_BYTES) throw new Error('Each PDF must be 50 MB or smaller.')
  return buffer
}

function stageJob(input = {}) {
  const id = sanitizeId(input.id || crypto.randomUUID(), 'efile-job')
  const jobDir = path.join(JOBS_DIR, id)
  fs.mkdirSync(jobDir, { recursive: true })
  const stagedFiles = Array.isArray(input.files) ? input.files : []
  const fileById = new Map()

  for (const staged of stagedFiles) {
    const documentId = sanitizeId(staged.document_id || crypto.randomUUID(), 'document')
    const fileName = sanitizeFileName(staged.file_name || staged.name || `${documentId}.pdf`)
    const buffer = decodePdfDataUrl(staged.data_url)
    const stagedPath = path.join(jobDir, `${documentId}-${fileName}`)
    fs.writeFileSync(stagedPath, buffer, { flag: 'w' })
    fileById.set(String(staged.document_id || documentId), { staged_path: stagedPath, size: buffer.length, file_name: fileName })
  }

  const existing = jobs.get(id) || {}
  const filings = (Array.isArray(input.filings) ? input.filings : []).map((filing, filingIndex) => ({
    id: sanitizeId(filing.id || `filing-${filingIndex + 1}`),
    filing_code: String(filing.filing_code || '').trim(),
    description: String(filing.description || '').trim(),
    security: String(filing.security || 'public'),
    documents: (Array.isArray(filing.documents) ? filing.documents : []).map((document, documentIndex) => {
      const documentId = String(document.id || `document-${filingIndex + 1}-${documentIndex + 1}`)
      const staged = fileById.get(documentId)
      if (!staged) throw new Error(`Select ${document.file_name || `document ${documentIndex + 1}`} again before staging.`)
      return {
        id: sanitizeId(documentId),
        file_name: staged.file_name,
        size: staged.size,
        role: String(document.role || (documentIndex === 0 ? 'lead' : 'attachment')),
        staged_path: staged.staged_path
      }
    })
  }))
  if (!filings.length || !filings.some((filing) => filing.documents.length)) throw new Error('Add at least one filing and one PDF.')

  const job = {
    ...existing,
    id,
    status: 'staged',
    pause_reason: '',
    error: '',
    created_at: existing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    matter_id: String(input.matter_id || ''),
    cause_number: String(input.cause_number || '').trim(),
    case_style: String(input.case_style || '').trim(),
    court_name: String(input.court_name || '').trim(),
    efile_location: String(input.efile_location || '').trim(),
    filing_kind: input.filing_kind === 'new' ? 'new' : 'existing',
    service_type: input.service_type === 'efile_only' ? 'efile_only' : 'efile_and_serve',
    payment_account: String(input.payment_account || '').trim(),
    filing_comments: String(input.filing_comments || '').trim(),
    filings,
    audit: Array.isArray(existing.audit) ? existing.audit : []
  }
  audit(job, 'staged', `${filings.length} filing(s), ${filings.reduce((sum, filing) => sum + filing.documents.length, 0)} PDF(s)`)
  jobs.set(id, job)
  return job
}

async function ensureEfilePage() {
  if (efilePage && !efilePage.isClosed()) return efilePage
  if (!browserContext) {
    const executablePath = locateChromeExecutable()
    if (!executablePath) throw new Error('Chrome or Edge was not found. Set MIO_CHROME_PATH to the browser executable and restart the agent.')
    let chromium
    try { ({ chromium } = require('playwright-core')) } catch {
      throw new Error('playwright-core is not installed. Run npm install in the Mio project folder, then restart the agent.')
    }
    fs.mkdirSync(PROFILE_DIR, { recursive: true })
    browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      executablePath,
      headless: false,
      viewport: null,
      acceptDownloads: true,
      args: ['--start-maximized'],
      downloadsPath: path.join(DATA_DIR, 'downloads')
    })
    browserContext.on('close', () => { browserContext = null; efilePage = null })
  }
  efilePage = browserContext.pages()[0] || await browserContext.newPage()
  if (!String(efilePage.url() || '').startsWith('https://efiletx.tylertech.cloud/')) await efilePage.goto(EFILE_URL, { waitUntil: 'domcontentloaded' })
  return efilePage
}

async function pageSummary(page) {
  const url = String(page?.url() || '')
  const title = await page.title().catch(() => '')
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, 12000)
  const needsSignIn = /sign in to your account/i.test(normalized) || /\/landing(?:$|\?)/i.test(url)
  const readyForReview = /review (?:and )?submit|envelope review|review envelope|filing summary/i.test(normalized)
    && /\bsubmit(?: envelope)?\b/i.test(normalized)
  const submitted = /envelope (?:has been )?submitted|submission (?:was )?successful|filing submitted/i.test(normalized)
  const envelopeMatch = normalized.match(/envelope\s*(?:number|no\.?|#|id)?\s*[:#]?\s*(\d{6,})/i)
  return {
    url,
    title,
    needs_sign_in: needsSignIn,
    signed_in: !needsSignIn && /dashboard|filing history|file into existing|start a new case|existing case/i.test(normalized),
    ready_for_review: readyForReview,
    submitted,
    envelope_number: envelopeMatch?.[1] || '',
    text_excerpt: normalized.slice(0, 1200)
  }
}

async function firstVisible(locators = []) {
  for (const locator of locators) {
    try {
      if (await locator.first().isVisible()) return locator.first()
    } catch {}
  }
  return null
}

async function clickNamed(page, names) {
  const locators = []
  for (const name of names) {
    const pattern = name instanceof RegExp ? name : new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
    locators.push(page.getByRole('button', { name: pattern }))
    locators.push(page.getByRole('link', { name: pattern }))
    locators.push(page.getByText(pattern, { exact: true }))
  }
  const target = await firstVisible(locators)
  if (!target) return false
  await target.click({ timeout: 10000 })
  await page.waitForTimeout(700)
  return true
}

async function fillByLabels(scope, patterns, value) {
  if (!String(value || '').trim()) return false
  const locators = patterns.flatMap((pattern) => [scope.getByLabel(pattern), scope.getByPlaceholder(pattern)])
  const target = await firstVisible(locators)
  if (!target) return false
  await target.fill(String(value), { timeout: 10000 })
  return true
}

async function selectByLabels(scope, patterns, preferredText) {
  if (!String(preferredText || '').trim()) return false
  const target = await firstVisible(patterns.map((pattern) => scope.getByLabel(pattern)))
  if (!target) return false
  const options = await target.locator('option').allTextContents().catch(() => [])
  const preferred = String(preferredText).trim().toLowerCase()
  const exactIndex = options.findIndex((option) => option.trim().toLowerCase() === preferred)
  const partialIndex = options.findIndex((option) => option.trim().toLowerCase().includes(preferred) || preferred.includes(option.trim().toLowerCase()))
  const index = exactIndex >= 0 ? exactIndex : partialIndex
  if (index < 0) return false
  await target.selectOption({ index }, { timeout: 10000 })
  return true
}

async function fillVisibleFiling(page, filing, filingIndex) {
  const filingSections = await page.locator('form, [role="form"], fieldset').all().catch(() => [])
  const scope = filingSections[filingIndex] || page
  const codeSelected = await selectByLabels(scope, [/filing code/i, /filing type/i], filing.filing_code)
  const descriptionFilled = await fillByLabels(scope, [/filing description/i, /description/i], filing.description)
  const securitySelected = await selectByLabels(scope, [/document security/i, /^security$/i], filing.security)
  const fileInputs = await scope.locator('input[type="file"]').all().catch(() => [])
  const fileInput = fileInputs[0]
  let filesUploaded = false
  let uploadedCount = 0
  if (fileInput && filing.documents.length) {
    const filePaths = filing.documents.map((document) => document.staged_path).filter(Boolean)
    if (filePaths.length) {
      const acceptsMultiple = await fileInput.getAttribute('multiple').then((value) => value !== null).catch(() => false)
      if (acceptsMultiple || filePaths.length === 1) {
        await fileInput.setInputFiles(acceptsMultiple ? filePaths : filePaths[0])
        filesUploaded = true
        uploadedCount = acceptsMultiple ? filePaths.length : 1
      } else {
        await fileInput.setInputFiles(filePaths[0])
        filesUploaded = true
        uploadedCount = 1
        for (let index = 1; index < filePaths.length; index += 1) {
          const role = filing.documents[index]?.role || 'attachment'
          const addNames = role === 'proposed_order'
            ? [/add proposed order/i, /add attachment/i, /add document/i]
            : [/add attachment/i, /add document/i]
          const added = await clickNamed(scope, addNames)
          if (!added) break
          const nextInputs = await scope.locator('input[type="file"]').all().catch(() => [])
          const nextInput = nextInputs[nextInputs.length - 1]
          if (!nextInput) break
          await nextInput.setInputFiles(filePaths[index])
          uploadedCount += 1
        }
      }
    }
  }
  return { codeSelected, descriptionFilled, securitySelected, filesUploaded, allFilesUploaded: uploadedCount === filing.documents.length }
}

async function prepareJob(job) {
  const page = await ensureEfilePage()
  await page.bringToFront()
  job.status = 'preparing'
  job.pause_reason = ''
  job.error = ''
  audit(job, 'prepare_started')

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const summary = await pageSummary(page)
    job.page = summary
    if (summary.needs_sign_in) {
      job.status = 'needs_sign_in'
      job.pause_reason = 'Sign in directly in the eFileTexas browser window. Mio does not receive or store your password or verification code. Then click Resume preparation.'
      audit(job, 'paused_for_sign_in', summary.url)
      return job
    }
    if (summary.submitted) {
      job.status = 'submitted'
      job.envelope_number = summary.envelope_number || job.envelope_number || ''
      job.submitted_at = job.submitted_at || new Date().toISOString()
      audit(job, 'submission_confirmed', job.envelope_number)
      return job
    }
    if (summary.ready_for_review) {
      job.status = 'ready_for_review'
      job.pause_reason = 'Review every document, filing code, service contact, payment account, and fee in the eFileTexas window. Then return to Mio for the separate approval step.'
      audit(job, 'ready_for_review', summary.url)
      return job
    }

    const bodyText = summary.text_excerpt
    if (/file into existing case|start filing/i.test(bodyText)) {
      const clicked = job.filing_kind === 'new'
        ? await clickNamed(page, [/start a new case/i, /file a new case/i])
        : await clickNamed(page, [/file into existing case/i, /existing case/i])
      if (clicked) continue
    }

    if (/case number|case search|location/i.test(bodyText)) {
      await selectByLabels(page, [/location/i, /court location/i], job.efile_location)
      const caseFilled = await fillByLabels(page, [/case number/i, /cause number/i], job.cause_number)
      if (caseFilled) {
        const searched = await clickNamed(page, [/^search$/i, /search cases/i])
        if (searched) continue
      }
      job.status = 'needs_user_input'
      job.pause_reason = 'Select the filing location and locate the correct case in the eFileTexas window, then click Resume preparation. Mio will continue with the document upload.'
      audit(job, 'paused_for_case_selection')
      return job
    }

    if (job.cause_number && bodyText.toLowerCase().includes(job.cause_number.toLowerCase())) {
      const escapedCause = job.cause_number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const selectedCase = await clickNamed(page, [new RegExp(escapedCause, 'i'), /^select$/i, /^file into case$/i])
      if (selectedCase) continue
    }

    if (/filing code|filing description|lead document|add filing/i.test(bodyText)) {
      let uploadedAny = false
      let uploadedAll = true
      for (let index = 0; index < job.filings.length; index += 1) {
        if (index > 0) await clickNamed(page, [/add filing/i, /add another filing/i])
        const result = await fillVisibleFiling(page, job.filings[index], index)
        uploadedAny = uploadedAny || result.filesUploaded
        uploadedAll = uploadedAll && result.allFilesUploaded
      }
      await fillByLabels(page, [/comments? to (?:the )?clerk/i, /filing comments?/i], job.filing_comments)
      audit(job, 'filing_details_attempted', uploadedAny ? 'PDFs uploaded' : 'PDF upload control not found')
      if (!uploadedAll) {
        job.status = 'needs_user_input'
        job.pause_reason = 'The lead PDF was uploaded, but eFileTexas did not expose a safe automatic control for every attachment or proposed order. Add the remaining PDFs in the eFileTexas window, verify each document role, and click Resume preparation in Mio.'
        audit(job, 'paused_for_remaining_documents')
        return job
      }
      const continued = await clickNamed(page, [/^save$/i, /save and continue/i, /^continue$/i, /^next$/i])
      if (continued) continue
      job.status = 'needs_user_input'
      job.pause_reason = 'Review the filing details in eFileTexas and complete any court-specific required fields. Do not click Submit. When the page is complete, click Resume preparation in Mio.'
      audit(job, 'paused_for_filing_details')
      return job
    }

    if (/service contact|payment account|filing fee|fees|waiver/i.test(bodyText)) {
      job.status = 'needs_user_input'
      job.pause_reason = 'Choose the correct service contacts, payment account, and any required fee or waiver options in eFileTexas. Do not click Submit. Then click Resume preparation in Mio.'
      audit(job, 'paused_for_service_and_payment')
      return job
    }

    job.status = 'needs_user_input'
    job.pause_reason = 'The agent reached a page it cannot safely complete without your review. Complete the visible required fields in eFileTexas, but do not submit; then click Resume preparation in Mio.'
    audit(job, 'paused_on_unrecognized_page', summary.url)
    return job
  }

  job.status = 'needs_user_input'
  job.pause_reason = 'The agent stopped after several preparation steps to avoid clicking through an unexpected page. Review the eFileTexas window, then click Resume preparation.'
  audit(job, 'paused_after_step_limit')
  return job
}

async function submitJob(job, body = {}) {
  if (job.status !== 'ready_for_review') throw new Error('The envelope is not at the verified review screen.')
  const expectedPhrase = `FILE ${job.cause_number || job.id}`.trim()
  if (String(body.approval_phrase || '').trim() !== expectedPhrase) throw new Error(`Type exactly “${expectedPhrase}” to authorize submission.`)
  if (body.reviewed !== true) throw new Error('Confirm that you reviewed the documents, filing codes, service contacts, payment account, and fees.')

  const page = await ensureEfilePage()
  await page.bringToFront()
  const before = await pageSummary(page)
  if (!before.ready_for_review) {
    job.status = 'needs_user_input'
    job.pause_reason = 'The eFileTexas browser is no longer on the verified review screen. Return to the review screen and resume preparation.'
    audit(job, 'submission_blocked_not_on_review')
    return job
  }

  const submitButton = await firstVisible([
    page.getByRole('button', { name: /^submit envelope$/i }),
    page.getByRole('button', { name: /^submit$/i }),
    page.getByRole('button', { name: /^file and serve$/i }),
    page.getByRole('button', { name: /^file & serve$/i })
  ])
  if (!submitButton) throw new Error('The final eFileTexas Submit button could not be identified safely. Nothing was submitted.')

  audit(job, 'submission_authorized', expectedPhrase)
  await submitButton.click({ timeout: 10000 })
  await page.waitForTimeout(2000)
  const after = await pageSummary(page)
  job.page = after
  if (after.submitted || after.envelope_number) {
    job.status = 'submitted'
    job.submitted_at = new Date().toISOString()
    job.envelope_number = after.envelope_number || ''
    job.pause_reason = ''
    audit(job, 'submission_confirmed', job.envelope_number)
  } else {
    job.status = 'submission_unconfirmed'
    job.pause_reason = 'Mio clicked Submit, but eFileTexas did not show a confirmation or envelope number that the agent could verify. Check Filing History before trying again.'
    audit(job, 'submission_unconfirmed', after.url)
  }
  return job
}

async function agentStatus() {
  let page = null
  if (efilePage && !efilePage.isClosed()) page = await pageSummary(efilePage)
  return {
    ok: true,
    service: AGENT_VERSION,
    browser_found: Boolean(locateChromeExecutable()),
    browser_open: Boolean(browserContext && efilePage && !efilePage.isClosed()),
    page,
    jobs: Array.from(jobs.values()).map(publicJob).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
  }
}

loadPersistedJobs()

const server = http.createServer(async (req, res) => {
  if (!isOriginAllowed(req)) return sendJson(req, res, 403, { ok: false, error: 'This website is not allowed to control the Mio local eFile agent.' })
  if (req.method === 'OPTIONS') return sendJson(req, res, 200, { ok: true })

  const requestUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`)
  if (req.method === 'GET' && (requestUrl.pathname === '/health' || requestUrl.pathname === '/efile-agent/status')) {
    try { return sendJson(req, res, 200, await agentStatus()) }
    catch (error) { return sendJson(req, res, 500, { ok: false, error: error.message || String(error) }) }
  }

  if (req.method === 'POST' && req.url === '/save-efile-pdf') {
    try {
      const body = await parseBody(req)
      const sourceUrl = String(body.sourceUrl || '').trim()
      const targetDir = String(body.targetDir || '').trim()
      const fileName = sanitizeFileName(body.fileName || body.expectedPdfName || 'efile-document.pdf')
      if (!isAllowedEfileUrl(sourceUrl)) throw new Error('Missing or invalid official Tyler/eFileTexas source URL.')
      if (!targetDir) throw new Error('Missing targetDir. The Service Inbox row must contain the Matter efile folder path.')

      const resolvedTargetDir = path.resolve(targetDir)
      const targetStat = await fs.promises.stat(resolvedTargetDir).catch(() => null)
      if (!targetStat?.isDirectory()) throw new Error('The selected matter efile folder does not exist. Mio did not create a replacement folder.')

      const pdf = await getPdfFromEfileUrl(sourceUrl, body.expectedPdfName || fileName)
      const finalName = sanitizeFileName(fileName)
      const savedPath = path.join(resolvedTargetDir, finalName)
      await fs.promises.writeFile(savedPath, pdf.buffer)

      return sendJson(req, res, 200, {
        ok: true,
        fileName: finalName,
        pdfName: pdf.pdfName,
        savedPath,
        size: pdf.buffer.length,
        sourceUrl: pdf.sourceUrl,
        dataUrl: `data:application/pdf;base64,${pdf.buffer.toString('base64')}`
      })
    } catch (error) {
      console.error('[mio-local-efile-helper]', error)
      return sendJson(req, res, 500, { ok: false, error: error.message || String(error) })
    }
  }

  if (req.method === 'POST' && requestUrl.pathname === '/efile-agent/open') {
    try {
      const page = await ensureEfilePage()
      await page.bringToFront()
      return sendJson(req, res, 200, await agentStatus())
    } catch (error) {
      return sendJson(req, res, 500, { ok: false, error: error.message || String(error) })
    }
  }

  if (req.method === 'POST' && requestUrl.pathname === '/efile-agent/stage') {
    try {
      const body = await parseBody(req)
      const job = stageJob(body)
      return sendJson(req, res, 200, { ok: true, job: publicJob(job) })
    } catch (error) {
      return sendJson(req, res, 400, { ok: false, error: error.message || String(error) })
    }
  }

  if (req.method === 'POST' && requestUrl.pathname === '/efile-agent/prepare') {
    let body = {}
    try {
      body = await parseBody(req)
      const job = jobs.get(String(body.id || ''))
      if (!job) throw new Error('The staged filing was not found. Stage the PDFs again.')
      const prepared = await prepareJob(job)
      return sendJson(req, res, 200, { ok: true, job: publicJob(prepared) })
    } catch (error) {
      const job = jobs.get(String(body.id || ''))
      if (job) { job.status = 'error'; job.error = error.message || String(error); audit(job, 'prepare_error', job.error) }
      return sendJson(req, res, 500, { ok: false, error: error.message || String(error) })
    }
  }

  if (req.method === 'POST' && requestUrl.pathname === '/efile-agent/submit') {
    try {
      const body = await parseBody(req)
      const job = jobs.get(String(body.id || ''))
      if (!job) throw new Error('The filing job was not found.')
      const submitted = await submitJob(job, body)
      return sendJson(req, res, 200, { ok: true, job: publicJob(submitted) })
    } catch (error) {
      return sendJson(req, res, 400, { ok: false, error: error.message || String(error) })
    }
  }

  return sendJson(req, res, 404, { ok: false, error: 'Not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`${AGENT_VERSION} running at http://${HOST}:${PORT}`)
  console.log('Leave this window open while preparing or submitting eFileTexas envelopes from Mio.')
  console.log('Credentials and verification codes must be entered only in the eFileTexas browser window.')
})
