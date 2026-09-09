export default function mioV311WithdrawalRowControls() {
  return {
    name: 'mio-v311-withdrawal-row-controls',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      return {
        code: source.replaceAll(
          'Mio V309 (multi-file eService + document sources)',
          'Mio V311 (withdrawal fixes)'
        ),
        map: null
      }
    }
  }
}
