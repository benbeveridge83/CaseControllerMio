import {useState} from 'react'
import BlockTypeFields,{Field} from './BlockTypeFields.jsx'
import {MATTER_FIELDS,TYPES} from '../../lib/process/model.js'

export default function BlockProperties({block,definition,templates,onChange,onConnect,onDisconnect,onDelete}){
  const [source,setSource]=useState(''),[token,setToken]=useState(''),[copied,setCopied]=useState(false)
  const patch=changes=>onChange({...block,...changes})
  const tokens=[...MATTER_FIELDS.map(k=>['{{matter.'+k+'}}','Matter · '+k.replaceAll('_',' ')]),...definition.fields.map(f=>['{{row.'+f.key+'}}','Row · '+f.label]),...definition.blocks.filter(b=>b.id!==block.id).map(b=>['{{blocks.'+b.id+'.'+b.output.key+'}}',b.name+' · '+b.output.label])]
  return <aside className="mp-properties"><div className="mp-panel-heading"><div><small>BLOCK SETTINGS</small><h2>{TYPES[block.type].label}</h2></div><span className="mp-type-icon" style={{color:TYPES[block.type].color}}>{TYPES[block.type].icon}</span></div>
    <Field label="Step name" value={block.name} onChange={name=>patch({name})}/>
    <Field label="Step number" type="number" value={block.stepNumber} onChange={stepNumber=>patch({stepNumber})}/>
    <details open><summary>Activation & connections</summary>
      <Field label="Activate when" value={block.activation} onChange={activation=>patch({activation})} options={[["row_created","A new row is created"],["predecessors","Connected preceding block completes"]]}/>
      {block.activation==='predecessors'&&<Field label="Required predecessors" value={block.join} options={[["all","All connected blocks complete"],["any","Any connected block completes"]]} onChange={join=>patch({join})}/>}
      <Field label="Connect from block" value={source} options={[["","Choose a preceding block"],...definition.blocks.filter(b=>b.id!==block.id).map(b=>[b.id,b.name])]} onChange={setSource}/>
      <button disabled={!source} onClick={()=>{onConnect(source,block.id);setSource('')}}>Connect blocks</button>
      {definition.edges.filter(e=>e.target===block.id||e.source===block.id).map(e=><div className="mp-connection" key={e.id}><small>{definition.blocks.find(b=>b.id===e.source)?.name} → {definition.blocks.find(b=>b.id===e.target)?.name}</small><button aria-label="Remove connection" onClick={()=>onDisconnect(e.id)}>×</button></div>)}
    </details>
    <details open><summary>Inputs & action</summary><BlockTypeFields block={block} templates={templates} onChange={config=>patch({config})}/></details>
    <details><summary>Merge fields</summary><p className="mp-note">Copy a field into the email, filename, or another input. Prior outputs must come from a connected preceding block.</p><Field label="Available merge fields" value={token} options={[["","Choose a field"],...tokens]} onChange={v=>{setToken(v);setCopied(false)}}/>{token&&<><input aria-label="Merge field token" readOnly value={token} onFocus={e=>e.target.select()}/><button onClick={async()=>{try{await navigator.clipboard.writeText(token);setCopied(true)}catch{setCopied(false)}}}>{copied?'Copied':'Copy field'}</button></>}</details>
    <details open><summary>Row status messages</summary><p className="mp-note">These are the messages you see in the row. The active block controls who you’re waiting on.</p>
      {[["input","Missing-information message"],["review","Review message"],["waiting","Waiting for reply message"],["reply","Response-received message"],["complete","Completed message"]].map(([key,label])=><Field key={key} label={label} value={block.messages[key]} onChange={v=>patch({messages:{...block.messages,[key]:v}})}/>)}
    </details>
    <details open><summary>Output & completion</summary>
      <Field label="Complete this block when" value={block.completion} options={[["field","The result field is populated"],["action","The action and required review finish"]]} onChange={completion=>patch({completion})}/>
      <Field label="Output field label" value={block.output.label} onChange={label=>patch({output:{...block.output,label}})}/>
      <Field label="Output field key" value={block.output.key} onChange={key=>patch({output:{...block.output,key}})} help="Use letters, numbers and underscores. Changing this requires updating references in later blocks."/>
      <Field label="Output field type" value={block.output.type} options={[["text","Text"],["date_windows","Dates / time windows"],["documents","Document references"],["boolean","Yes / no"]]} onChange={type=>patch({output:{...block.output,type}})}/>
    </details>
    <details><summary>Billing</summary><Field label="Offer time entry for this step" value={block.billing.enabled?'yes':'no'} options={[["no","No"],["yes","Yes"]]} onChange={v=>patch({billing:{...block.billing,enabled:v==='yes'}})}/><Field label="Suggested billing description" value={block.billing.description} onChange={description=>patch({billing:{...block.billing,description}})}/><Field label="Suggested minutes" type="number" value={block.billing.minutes} onChange={minutes=>patch({billing:{...block.billing,minutes}})}/><p className="mp-note">Configuration only in this release. No billing entries are created by the test.</p></details>
    <button className="mp-danger" onClick={onDelete}>Delete block</button>
  </aside>
}
