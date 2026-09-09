export default function mioV307Compat() {
  return {
    name: 'mio-v307-compat',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/MioWithdrawalBlocks.jsx')) return null

      // V305 adds this accessibility label before V307 runs, while V307's guarded
      // slot-source integration still targets the original select markup. Restore only
      // this one anchor so V307 can apply its document-source picker. V307's remaining
      // guarded anchors continue to protect against unexpected source changes.
      const from = '<label>Saved matter document<select aria-label="Saved matter document"'
      const to = '<label>Saved matter document<select'
      const count = source.split(from).length - 1
      if (count !== 1) throw new Error('V307 compatibility anchor changed: saved matter document select')
      return { code: source.replace(from, to), map: null }
    }
  }
}
