import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import MioCloudBoundary from './MioCloudBoundary.jsx'
import MioLeadAlerts from './MioLeadAlerts.jsx'
import MioGoogleAdsSearchTermStatus from './MioGoogleAdsSearchTermStatus.jsx'
createRoot(document.getElementById('root')).render(<StrictMode><MioCloudBoundary><><App /><MioLeadAlerts /><MioGoogleAdsSearchTermStatus /></></MioCloudBoundary></StrictMode>)