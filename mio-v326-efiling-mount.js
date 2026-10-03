// V326: mount the mock-only e-filing panel into the matter page.
//
// This transform wires MioEfilingPanel into the matter dashboard's Filings tab,
// behind the EFILING_ENABLED flag, using the mock provider and the in-memory
// repository from the runtime. Tyler is never constructed or called, and Stage /
// Production submission stay disabled by mioEfilingFlags.js.

const IMPORT_ANCHOR = "import MioAgentPanel from './MioAgentPanel.jsx'"

const IMPORTS = `import MioAgentPanel from './MioAgentPanel.jsx'
import MioEfilingPanel from './efiling/MioEfilingPanel.jsx'
import { createEfilingRuntime, efilingFilerFromTeamMember, efilingMatterDocuments } from './efiling/mioEfilingRuntime.js'

// V326: mock-only e-filing runtime. Provider and repository are created once and
// shared across the matter dashboard. Stage and Production submission remain
// disabled until TYLER_EFM_STAGE_ENABLED / TYLER_EFM_PRODUCTION_ENABLED and their
// credentials are configured (see src/efiling/mioEfilingFlags.js).
const mioEfilingRuntime = createEfilingRuntime({
  flags: {
    EFILING_ENABLED: import.meta.env.VITE_EFILING_ENABLED,
    TYLER_EFM_STAGE_ENABLED: import.meta.env.VITE_TYLER_EFM_STAGE_ENABLED,
    TYLER_EFM_PRODUCTION_ENABLED: import.meta.env.VITE_TYLER_EFM_PRODUCTION_ENABLED,
  },
})`

const FILINGS_ANCHOR = `{clientDashboardTab === 'filings' && renderMatterFilingsPanel(selectedTemplateMatter())}`

const EFILING_MOUNT = `{clientDashboardTab === 'filings' && mioEfilingRuntime.enabled && (
  <MioEfilingPanel
    key={selectedTemplateMatter().id}
    matter={selectedTemplateMatter()}
    documents={efilingMatterDocuments(documents, selectedTemplateMatter().id)}
    filer={efilingFilerFromTeamMember(currentTeamMember)}
    settings={mioEfilingRuntime.settings}
    flags={mioEfilingRuntime.flags}
    provider={mioEfilingRuntime.provider}
    repository={mioEfilingRuntime.repository}
    ownerId={session?.user?.id || ''}
  />
)}
{clientDashboardTab === 'filings' && renderMatterFilingsPanel(selectedTemplateMatter())}`

function once(code, from, to, label) {
  const parts = code.split(from)
  if (parts.length !== 2) throw Error(`V326 ${label || 'anchor'} count=${parts.length}: source anchor not unique or missing`)
  return code.replace(from, () => to)
}

export function applyEfilingMount(source = '') {
  let code = String(source || '')
  if (code.includes('mioEfilingRuntime')) throw Error('V326 e-filing mount transform ran twice')
  code = once(code, IMPORT_ANCHOR, IMPORTS, 'e-filing imports')
  code = once(code, FILINGS_ANCHOR, EFILING_MOUNT, 'e-filing filings mount')
  return code
}

export default function mioV326EfilingMount() {
  return {
    name: 'mio-v326-efiling-mount',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      return { code: applyEfilingMount(source), map: null }
    },
  }
}
