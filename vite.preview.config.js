// SYNTHETIC PREVIEW BUILD ONLY — this file exists on the preview branch and is not merged.
//
// `npm run build:synthetic` produces dist-preview: the same application, with the synthetic
// data service installed (VITE_MIO_SYNTHETIC is defined as '1' only here) and the public project
// configuration pointed at a host that cannot resolve. A production build of this repository
// does not contain the adapter, this config or the defining constant, so the synthetic mode
// cannot be switched on in production.
import fs from 'node:fs'
import path from 'node:path'
import base from './vite.config.js'

const appEntry = '/src/App.jsx'
const previewTransform = () => ({
  name: 'mio-preview-synthetic',
  enforce: 'pre',
  transform(source, id) {
    if (!id.split('?')[0].replaceAll('\\', '/').endsWith(appEntry)) return null
    // Installed before the application can make its first request.
    return `import { installSyntheticPreview } from './mioSyntheticPreview.js'\ninstallSyntheticPreview()\n${source}`
  },
})
// Nothing in the emitted preview may name the firm's project, its URL or its key. The generic
// `.supabase.co` suffix is expected in the application's own URL handling, so the guard checks the
// project reference itself. The build fails rather than shipping a bundle that could reach a live
// financial record.
const forbidden = ['vnnkxqpyndidnjbrbywz', 'https://vnnkxqpyndidnjbrbywz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'LAWPAY_SECRET_KEY', 'LAWPAY_ACCOUNT_']
const leakGuard = (outDir) => ({
  name: 'mio-preview-leak-guard',
  closeBundle() {
    const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
    const offenders = []
    for (const file of walk(outDir)) {
      const text = fs.readFileSync(file, 'utf8')
      for (const needle of forbidden) if (text.includes(needle)) offenders.push(`${file} contains ${needle}`)
    }
    if (offenders.length) throw Error(`Synthetic preview build refused: ${offenders.join('; ')}`)
    console.log(`[synthetic preview] no production project reference, URL or key in ${outDir}`)
  },
})

const outDir = 'dist-preview'
export default {
  ...base,
  define: { ...(base.define || {}), 'import.meta.env.VITE_MIO_SYNTHETIC': JSON.stringify('1') },
  plugins: [...base.plugins, previewTransform(), leakGuard(outDir)],
  build: { ...(base.build || {}), outDir, emptyOutDir: true },
}
