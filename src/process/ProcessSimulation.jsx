import {useState} from 'react'
import {startSimulation,advanceSimulation,simulationStatus} from '../../lib/process/simulation.js'
import {renderTokens} from '../../lib/process/model.js'
import {Field} from './BlockTypeFields.jsx'

export default function ProcessSimulation({definition,onClose}){
  const [state,setState]=useState(()=>startSimulation(definition)),[result,setResult]=useState(''),[error,setError]=useState('')
  const status=simulationStatus(state),b=state.definition.blocks.find(x=>x.id===status.blockId),active=b&&state.states[b.id]
  const context={matter:{client_name:'Alex Example',client_email:'client@example.invalid',opposing_counsel_name:'Jordan Example',opposing_counsel_email:'counsel@example.invalid',opposing_party_name:'Taylor Example',opposing_party_email:'party@example.invalid',court_name:'Example Court',court_email:'court@example.invalid',cause_number:'TEST-001',matter_name:'Example hearing'},row:{hearing_details:'Example: October 1, 9 AM, Example Court'},blocks:state.outputs}
  function action(type){try{setState(advanceSimulation(state,b.id,type,result));setResult('');setError('')}catch(e){setError(e.message)}}
  return <section className="mp-simulation" aria-label="Process simulation"><header><div><small>TEST MODE · SYNTHETIC DATA</small><h2>{definition.pageName}</h2></div><button onClick={onClose}>Close test</button></header><p>This previews transitions only. Nothing is sent, filed, saved as a case document, or billed. Sample dates are not a calendar availability check.</p>
    <div className={'mp-status '+status.category}><span>{status.category==='me'?'Waiting on me':status.category==='others'?'Waiting on someone else':'Complete'}</span>{b&&<small>Step {b.stepNumber} · {b.name}</small>}<strong>{status.unread?'✉ ':''}{status.message}</strong></div>
    {error&&<p role="alert">{error}</p>}
    {b&&<div className="mp-sim-content">
      {b.type==='email'&&<div className="mp-email-preview"><h3>Example email preview</h3>{['from','to','cc','subject','body'].map(k=><div key={k}><b>{k.toUpperCase()}</b><pre>{renderTokens(b.config[k],context).text||'(not configured)'}</pre></div>)}</div>}
      {b.type==='email'&&!active.sent&&<button className="mp-primary" onClick={()=>action('send')}>Simulate send</button>}
      {active.status==='waiting'&&<button className="mp-primary" onClick={()=>action('reply')}>Simulate reply</button>}
      {!(b.type==='email'&&(!active.sent||active.status==='waiting'))&&<><Field label="Step result" value={result} multiline onChange={setResult} help={b.output.label}/><button className="mp-primary" onClick={()=>action('complete')}>Complete simulated step</button></>}
      <p className="mp-note">{status.pendingCount>1?status.pendingCount+' blocks are active. Needs-me actions appear first.':'Each block completes independently.'}</p>
    </div>}
    <div className="mp-sim-steps">{state.definition.blocks.map(block=><div key={block.id}><span>{block.stepNumber}. {block.name}</span><small>{state.states[block.id].status.replaceAll('_',' ')}</small></div>)}</div>
    {!b&&<button onClick={()=>{setState(startSimulation(definition));setResult('')}}>Restart test</button>}
  </section>
}
