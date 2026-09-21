import React from 'react'
import {createRoot} from 'react-dom/client'
import ProcessBuilder from '../../../src/process/ProcessBuilder.jsx'
const records=await fetch('/test-store').then(r=>r.json())
createRoot(document.getElementById('root')).render(<ProcessBuilder initialDefinitions={records} templates={[{id:'notice-test',name:'Notice of Hearing'}]} onSave={async definitions=>{const r=await fetch('/test-store',{method:'POST',body:JSON.stringify(definitions)});if(!r.ok)throw Error('Save rejected');return true}}/>)
