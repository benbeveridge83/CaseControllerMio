export default function mioV309ReleaseLabel() {
  return {
    name: 'mio-v309-release-label',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source
      code = code.replace('Mio V307 (Dropbox Sign + document sources)', 'Mio V309 (multi-file eService + document sources)')
      code = code.replace('Mio V305 (editable withdrawal workflows)', 'Mio V309 (multi-file eService + document sources)')
      return { code, map: null }
    }
  }
}
