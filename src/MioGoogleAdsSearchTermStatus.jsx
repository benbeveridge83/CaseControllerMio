import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient.js'
import {
  deriveSearchTermStatus,
  searchTermFilterMatches,
  shouldRefreshGoogleAdsStatusAfterClick
} from './googleAdsSearchTermStatus.js'

const ENHANCER_ID = 'mio-google-ads-search-term-status-toolbar'

function isGoogleAdsPage() {
  return String(window.location.hash || '').toLowerCase().includes('google_ads')
}

function norm(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function findSearchTermsTable() {
  return [...document.querySelectorAll('table')].find((table) => {
    const headers = [...table.querySelectorAll('thead th')].map((th) => norm(th.childNodes?.[0]?.textContent || th.textContent))
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
  th.dataset.mioBaseLabel = 'Status'
  th.appendChild(document.createTextNode('Status'))
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

function ensureHeaderSelect(th, key, options, onChange) {
  if (!th) return null
  let select = th.querySelector(`[data-mio-header-filter="${key}"]`)
  if (!select) {
    select = document.createElement('select')
    select.dataset.mioHeaderFilter = key
    select.style.display = 'block'
    select.style.marginTop = '5px'
    select.style.maxWidth = '150px'
    select.style.fontSize = '10px'
    select.style.fontWeight = '500'
    select.style.padding = '2px 4px'
    select.style.border = '1px solid #cbd5e1'
    select.style.borderRadius = '5px'
    select.style.background = '#fff'
    select.addEventListener('change', onChange)
    th.appendChild(select)
  }

  const current = select.value || 'all'
  const normalizedOptions = [{ value: 'all', label: 'All' }, ...options]
  const signature = JSON.stringify(normalizedOptions)
  if (select.dataset.mioOptionsSignature !== signature) {
    select.dataset.mioOptionsSignature = signature
    select.replaceChildren(...normalizedOptions.map((option) => {
      const node = document.createElement('option')
      node.value = option.value
      node.textContent = option.label
      return node
    }))
    if ([...select.options].some((option) => option.value === current)) select.value = current
  }
  return select
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

      let headerCells = [...table.querySelectorAll('thead th')]
      let headerText = headerCells.map((th) => norm(th.dataset.mioBaseLabel || th.childNodes?.[0]?.textContent || th.textContent))
      const searchIndex = headerText.indexOf('search term')
      const actionsIndexBeforeStatus = headerText.findIndex((value) => value.includes('actions'))
      const scopeIndex = headerText.findIndex((value) => value.includes('campaign') && value.includes('ad group'))
      if (searchIndex < 0 || actionsIndexBeforeStatus < 0) return

      ensureStatusHeader(table, actionsIndexBeforeStatus)
      headerCells = [...table.querySelectorAll('thead th')]
      headerText = headerCells.map((th) => norm(th.dataset.mioBaseLabel || th.childNodes?.[0]?.textContent || th.textContent))
      const intentIndex = headerText.indexOf('intent')
      const statusIndex = headerText.indexOf('status')

      const toolbar = makeToolbar(apply)
      if (!toolbar.isConnected) table.parentElement?.insertBefore(toolbar, table)
      const unresolvedOnly = Boolean(toolbar.querySelector('[data-mio-unresolved-only]')?.checked)

      const intentValues = [...new Set([...table.querySelectorAll('tbody tr')]
        .map((tr) => norm(tr.children[intentIndex]?.textContent || ''))
        .filter(Boolean))]
        .sort()
        .map((value) => ({ value, label: value.replace(/\b\w/g, (char) => char.toUpperCase()) }))
      const intentSelect = intentIndex >= 0 ? ensureHeaderSelect(headerCells[intentIndex], 'intent', intentValues, apply) : null
      const statusSelect = statusIndex >= 0 ? ensureHeaderSelect(headerCells[statusIndex], 'status', [
        { value: 'unresolved', label: 'Needs review' },
        { value: 'campaign_negative', label: 'Campaign negative' },
        { value: 'ad_group_negative', label: 'Ad-group negative' },
        { value: 'exact_keyword', label: 'Exact keyword added' }
      ], apply) : null
      const filters = {
        intent: intentSelect?.value || 'all',
        status: statusSelect?.value || 'all'
      }

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
        const intent = norm(cells[intentIndex]?.textContent || '')
        const matchesFilters = searchTermFilterMatches({ intent, statusKind: status.kind }, filters)
        const hiddenByUnresolved = status.resolved && unresolvedOnly
        tr.dataset.mioSearchResolved = status.resolved ? 'true' : 'false'
        tr.style.opacity = status.resolved && !unresolvedOnly ? '0.62' : ''
        tr.style.display = hiddenByUnresolved || !matchesFilters ? 'none' : ''
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
      if (!shouldRefreshGoogleAdsStatusAfterClick(button.textContent || '')) return
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
