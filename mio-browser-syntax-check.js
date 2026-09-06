// Validate the actual emitted browser bundles before any build can be deployed.
import {spawnSync} from 'node:child_process'
export function checkBrowserSyntax(code, name = 'browser module') {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: code, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024
  })
  if (result.error || result.status !== 0) {
    throw new Error('Browser JavaScript validation failed in ' + name + ': ' +
      String(result.error?.message || result.stderr || 'Parser exited unsuccessfully').slice(0, 3000))
  }
}
export default function mioBrowserSyntaxCheck() {
  return {name:'mio-browser-syntax-check',enforce:'post',generateBundle(_options,bundle) {
    for (const item of Object.values(bundle)) {
      if (item.type !== 'chunk') continue
      try { checkBrowserSyntax(item.code, item.fileName) } catch (error) { this.error(error.message) }
    }
  }}
}
