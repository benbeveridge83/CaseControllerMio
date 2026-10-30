import { createRoot } from 'react-dom/client'
import MioAppealsResource from '../../../src/appeals/MioAppealsResource.jsx'

const userId = new URLSearchParams(location.search).get('user') || 'appeals-fixture-user'
createRoot(document.getElementById('root')).render(<MioAppealsResource key={userId} userId={userId} />)
