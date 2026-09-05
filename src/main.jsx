import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import MioCloudBoundary from './MioCloudBoundary.jsx'
createRoot(document.getElementById('root')).render(<StrictMode><MioCloudBoundary><App /></MioCloudBoundary></StrictMode>)
