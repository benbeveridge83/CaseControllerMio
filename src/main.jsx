import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ClientPortal from './portal/ClientPortal.jsx'
import './portal/portal.css'
const App = lazy(() => import('./App.jsx'))
import MioCloudBoundary from './MioCloudBoundary.jsx'
import MioLeadAlerts from './MioLeadAlerts.jsx'
import MioLawPayAlerts from './MioLawPayAlerts.jsx'
const isClientPortal=new URLSearchParams(window.location.search).has('client-portal')
createRoot(document.getElementById('root')).render(<StrictMode>{isClientPortal?<ClientPortal/>:<MioCloudBoundary><Suspense fallback={<p>Loading Mio…</p>}><App/><div className="mio-alert-stack"><MioLeadAlerts/><MioLawPayAlerts/></div></Suspense></MioCloudBoundary>}</StrictMode>)
