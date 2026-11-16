import { useEffect } from 'react'
import navigatorHTML from './cps-navigator.html?raw'
import './cps-navigator.css'

export default function CPSNavigator() {
  useEffect(() => {
    document.body.classList.add('mio-cps-navigator-active')
    return () => document.body.classList.remove('mio-cps-navigator-active')
  }, [])

  // Trusted, bundled content. A separate document preserves the approved
  // resource's CSS, SVG IDs, interactions, and stage-only print stylesheet.
  return <section className="mio-cps-navigator" aria-label="CPS Navigator">
    <iframe
      title="CPS Navigator — Texas CPS / DFPS"
      srcDoc={navigatorHTML}
      className="mio-cps-navigator-frame"
    />
  </section>
}
