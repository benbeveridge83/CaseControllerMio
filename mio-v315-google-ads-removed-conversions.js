const RAW_CONVERSIONS = "const conversions = Array.isArray(report?.conversionActions) ? report.conversionActions : []"
const GUARDED_CONVERSIONS = "const conversions = Array.isArray(report?.conversionActions) ? report.conversionActions.filter((row) => String(row?.status || '').toUpperCase() !== 'REMOVED') : []"

const RAW_INACTIVE_PRIMARY = "const inactivePrimary = (report?.conversionActions || []).filter((row) => row.primaryForGoal && String(row.status || '').toUpperCase() !== 'ENABLED')"
const GUARDED_INACTIVE_PRIMARY = "const inactivePrimary = (report?.conversionActions || []).filter((row) => row.primaryForGoal && String(row.status || '').toUpperCase() !== 'REMOVED' && String(row.status || '').toUpperCase() !== 'ENABLED')"

const RAW_PRIMARY_CONTROL = "{authorizeButton(row.primaryForGoal ? 'Make secondary' : 'Make primary'"
const GUARDED_PRIMARY_CONTROL = "{String(row.status).toUpperCase() !== 'REMOVED' && authorizeButton(row.primaryForGoal ? 'Make secondary' : 'Make primary'"

function countOccurrences(source, needle) {
  return source.split(needle).length - 1
}

export function applyGoogleAdsRemovedConversionGuards(source = '') {
  let code = String(source || '')

  const rawConversionCount = countOccurrences(code, RAW_CONVERSIONS)
  const guardedConversionCount = countOccurrences(code, GUARDED_CONVERSIONS)
  if (rawConversionCount) code = code.replaceAll(RAW_CONVERSIONS, GUARDED_CONVERSIONS)
  else if (guardedConversionCount < 2) throw new Error('Mio V315 could not find the Google Ads conversion-list anchors.')

  if (code.includes(RAW_INACTIVE_PRIMARY)) code = code.replace(RAW_INACTIVE_PRIMARY, GUARDED_INACTIVE_PRIMARY)
  else if (!code.includes(GUARDED_INACTIVE_PRIMARY)) throw new Error('Mio V315 could not find the Google Ads bottleneck anchor.')

  if (code.includes(RAW_PRIMARY_CONTROL)) code = code.replace(RAW_PRIMARY_CONTROL, GUARDED_PRIMARY_CONTROL)
  else if (!code.includes(GUARDED_PRIMARY_CONTROL)) throw new Error('Mio V315 could not find the Google Ads conversion-control anchor.')

  return code
}

export default function mioV315GoogleAdsRemovedConversions() {
  return {
    name: 'mio-v315-google-ads-removed-conversions',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      return { code: applyGoogleAdsRemovedConversionGuards(source), map: null }
    }
  }
}
