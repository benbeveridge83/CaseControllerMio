#!/usr/bin/env node
// Case Controller Mio local helper for eFile PDF saving.
// Run from the project folder with: node mio-local-efile-helper.cjs
// It listens only on 127.0.0.1:8787 and lets the React app save an eFile PDF
// to the exact Windows path and filename shown on the Service Inbox row.

const http = require('http')
const fs = require('fs')
const path = require('path')

const HOST = '127.0.0.1'
const PORT = 8787

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
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

async function fetchBuffer(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 CaseControllerMioLocalHelper',
      'Accept': 'application/pdf,text/html,application/xhtml+xml,*/*',
      ...(options.headers || {})
    }
  })
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const contentType = response.headers.get('content-type') || ''
  const finalUrl = response.url || url
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
  if (!downloadUrl) {
    throw new Error('The helper opened the eFile page but could not find the Download Document link inside it.')
  }

  const second = await fetchBuffer(downloadUrl, { headers: { Referer: first.finalUrl } })
  if (!second.response.ok) throw new Error(`Download Document link returned HTTP ${second.response.status}`)
  const secondLooksPdf = /application\/pdf/i.test(second.contentType) || second.buffer.slice(0, 5).toString() === '%PDF-'
  if (!secondLooksPdf) throw new Error(`Download Document did not return a PDF. Content-Type was ${second.contentType || 'unknown'}.`)

  return { buffer: second.buffer, pdfName, sourceUrl: second.finalUrl }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 10 * 1024 * 1024) reject(new Error('Request body too large'))
    })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true })
  if (req.method === 'GET' && req.url === '/health') return sendJson(res, 200, { ok: true, service: 'Case Controller Mio local eFile helper' })

  if (req.method === 'POST' && req.url === '/save-efile-pdf') {
    try {
      const body = await parseBody(req)
      const sourceUrl = String(body.sourceUrl || '').trim()
      const targetDir = String(body.targetDir || '').trim()
      const fileName = sanitizeFileName(body.fileName || body.expectedPdfName || 'efile-document.pdf')
      if (!/^https?:\/\//i.test(sourceUrl)) throw new Error('Missing or invalid eFile source URL.')
      if (!targetDir) throw new Error('Missing targetDir. The Service Inbox row must contain the Matter efile folder path.')

      const resolvedTargetDir = path.resolve(targetDir)
      await fs.promises.mkdir(resolvedTargetDir, { recursive: true })

      const pdf = await getPdfFromEfileUrl(sourceUrl, body.expectedPdfName || fileName)
      const finalName = sanitizeFileName(fileName)
      const savedPath = path.join(resolvedTargetDir, finalName)
      await fs.promises.writeFile(savedPath, pdf.buffer)

      sendJson(res, 200, {
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
      sendJson(res, 500, { ok: false, error: error.message || String(error) })
    }
    return
  }

  sendJson(res, 404, { ok: false, error: 'Not found' })
})

server.listen(PORT, HOST, () => {
  console.log(`Case Controller Mio local eFile helper running at http://${HOST}:${PORT}`)
  console.log('Leave this window open while testing Service Inbox PDF save/move.')
})
