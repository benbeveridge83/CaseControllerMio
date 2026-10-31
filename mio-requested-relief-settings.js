// Mount the existing template editor on Settings as well as matter pages.
export function applyRequestedReliefSettings(source) {
  const anchor = '          <h2>Requested Relief Templates</h2>'
  const mount = '\n          {renderRequestedReliefBuilderModal()}'
  if (source.split(anchor).length !== 2) throw new Error('Requested relief Settings anchor changed')
  if (source.includes(anchor + mount)) return source
  return source.replace(anchor, anchor + mount)
}
export default function requestedReliefSettings() {
  return {
    name: 'mio-requested-relief-settings',
    enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/App.jsx')) return null
      return { code: applyRequestedReliefSettings(source), map: null }
    },
  }
}
