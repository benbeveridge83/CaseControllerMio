import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient.js'
import { deriveSearchTermStatus } from './googleAdsSearchTermStatus.js'

const ENHANCER_ID = 'mio-google-ads-search-term-status-toolbar'

function isGoogleAdsPage() {
  return String(window.location.hash || '').toLowerCase().includes('google_ads')
}

function norm(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function findSearchTermsTable() {
  return [...document.querySelectorAll('table')].find((table) => {
    const headers = [...table.querySelectorAll('thead th')].map((th) => norm(th.textContent))
    return headers.includes('search term') && headers.some((value) => value.includes('actions'))
  }) || null
}

function rowForDom(reportRows, searchTerm, scopeText) {
  const term = norm(searchTerm)
  const scope = norm(scopeText)
  return reportRows.find((row) => {
    if (norm(row?.searchTerm) !== term) return false
    const campaign = norm(row?.campaignName)
    const adGroup = norm(row?.adGroupName)
    return (!campaign || scope.includes(campaign)) && (!adGroup || scope.includes(adGroup))
  }) || reportRows.find((row) => norm(row?.searchTerm) === term) || null
}

function ensureStatusHeader(table, actionsIndex) {
  const headRow = table.querySelector('thead tr')
  if (!headRow || headRow.querySelector('[data-mio-search-status-header]')) return
  const th = document.createElement('th')
  th.dataset.mioSearchStatusHeader = 'true'
  th.textContent = 'Status'
  th.style.minWidth = '160px'
  th.style.textAlign = 'left'
  const actionHeader = headRow.children[actionsIndex]
  headRow.insertBefore(th, actionHeader || null)
}

function statusCellForRow(tr, actionsIndex) {
  let cell = tr.querySelector('[data-mio-search-status-cell]')
  if (cell) return cell
  cell = document.createElement('td')
  cell.dataset.mioSearchStatusCell = 'true'
  cell.style.verticalAlign = 'middle'
  cell.style.padding = '8px 6px'
  const actionCell = tr.children[actionsIndex]
  tr.insertBefore(cell, actionCell || null)
  return cell
}

function renderStatusCell(cell, status) {
  const signature = JSON.stringify({
    resolved: Boolean(status?.resolved),
    kind: String(status?.kind || ''),
    label: String(status?.label || ''),
    detail: String(status?.detail || '')
  })
  if (cell.dataset.mioStatusSignature === signature) return
  cell.dataset.mioStatusSignature = signature
  cell.replaceChildren()

  const badge = document.createElement('span')
  badge.textContent = status.resolved ? `✓ ${status.label}` : status.label
  badge.style.display = 'inline-block'
  badge.style.padding = '4px 7px'
  badge.style.borderRadius = '999px'
  badge.style.fontWeight = '700'
  badge.style.fontSize = '11px'
  badge.style.whiteSpace = 'nowrap'
  badge.style.background = status.resolved ? '#dcfce7' : '#fef3c7'
  badge.style.color = status.resolved ? '#166534' : '#92400e'
  cell.appendChild(badge)

  if (status.detail) {
    const detail = document.createElement('div')
    detail.textContent = status.detail
    detail.style.marginTop = '4px'
    detail.style.fontSize = '10px'
    detail.style.lineHeight = '1.25'
    detail.style.color = '#64748b'
    cell.appendChild(detail)
  }
}

function makeToolbar(onChange) {
  let toolbar = document.getElementById(ENHANCER_ID)
  if (toolbar) return toolbar
  toolbar = document.createElement('div')
  toolbar.id = ENHANCER_ID
  toolbar.style.display = 'flex'
  toolbar.style.alignItems = 'center'
  toolbar.style.gap = '12px'
  toolbar.style.justifyContent = 'flex-end'
  toolbar.style.margin = '8px 0'
  toolbar.style.fontSize = '12px'

  const label = document.createElement('label')
  label.style.display = 'inline-flex'
  label.style.alignItems = 'center'
  label.style.gap = '6px'
  label.style.cursor = 'pointer'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.checked = true
  checkbox.dataset.mioUnresolvedOnly = 'true'
  checkbox.addEventListener('change', onChange)
  label.append(checkbox, document.createTextNode('Unresolved only'))

  const note = document.createElement('span')
  note.textContent = 'Resolved rows are confirmed from the current Google Ads account.'
  note.style.color = '#64748b'
  toolbar.append(label, note)
  return toolbar
}

async function fetchGoogleAdsReport() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Mio session unavailable.')
  const response = await fetch('/api/google-ads?action=report&days=30', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store'
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || 'Google Ads report failed.')
  return payload
}

export default function MioGoogleAdsSearchTermStatus() {
  const reportRef = useRef(null)
  const refreshTimerRef = useRef(null)

  useEffect(() => {
    let stopped = false
    let observer

    const apply = () => {
      if (stopped || !isGoogleAdsPage() || !reportRef.current) return
      const table = findSearchTermsTable()
      if (!table) return

      const headerCells = [...table.querySelectorAll('thead th')]
      const headerText = headerCells.map((th) => norm(th.textContent))
      const searchIndex = headerText.indexOf('search term')
      const actionsIndexBeforeStatus = headerText.findIndex((value) => value.includes('actions'))
      const scopeIndex = headerText.findIndex((value) => value.includes('campaign') && value.includes('ad group'))
      if (searchIndex < 0 || actionsIndexBeforeStatus < 0) return

      ensureStatusHeader(table, actionsIndexBeforeStatus)
      const toolbar = makeToolbar(apply)
      if (!toolbar.isConnected) table.parentElement?.insertBefore(toolbar, table)
      const unresolvedOnly = Boolean(toolbar.querySelector('[data-mio-unresolved-only]')?.checked)

      const reportRows = Array.isArray(reportRef.current?.searchTerms) ? reportRef.current.searchTerms : []
      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = [...tr.children]
        const searchTerm = cells[searchIndex]?.textContent || ''
        const scopeText = scopeIndex >= 0 ? cells[scopeIndex]?.textContent || '' : tr.textContent || ''
        const reportRow = rowForDom(reportRows, searchTerm, scopeText)
        if (!reportRow) continue
        const status = deriveSearchTermStatus(reportRow, reportRef.current)
        const cell = statusCellForRow(tr, actionsIndexBeforeStatus)
        renderStatusCell(cell, status)
        tr.dataset.mioSearchResolved = status.resolved ? 'true' : 'false'
        tr.style.opacity = status.resolved && !unresolvedOnly ? '0.62' : ''
        tr.style.display = status.resolved && unresolvedOnly ? 'none' : ''
      }
    }

    const load = async () => {
      if (!isGoogleAdsPage()) return
      try {
        reportRef.current = await fetchGoogleAdsReport()
        apply()
      } catch (error) {
        console.warn('Mio Google Ads search-term status could not refresh:', error)
      }
    }

    const onHash = () => {
      if (isGoogleAdsPage()) load()
      else document.getElementById(ENHANCER_ID)?.remove()
    }

    const onClick = (event) => {
      if (!isGoogleAdsPage()) return
      const button = event.target?.closest?.('button')
      if (!button) return
      const text = norm(button.textContent)
      if (!text.includes('negative') && !text.includes('exact keyword')) return
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(load, 1800)
      setTimeout(load, 4500)
    }

    observer = new MutationObserver(() => apply())
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('hashchange', onHash)
    document.addEventListener('click', onClick, true)
    load()

    return () => {
      stopped = true
      clearTimeout(refreshTimerRef.current)
      observer?.disconnect()
      window.removeEventListener('hashchange', onHash)
      document.removeEventListener('click', onClick, true)
      document.getElementById(ENHANCER_ID)?.remove()
    }
  }, [])

  return null
}
