import {useEffect,useRef,useState} from 'react'
import {TYPES,clone,newId,newBlock,newProcess,starterProcess,validateDefinition,connectBlocks,removeBlock} from '../../lib/process/model.js'
import ProcessCanvas from './ProcessCanvas.jsx'
import BlockProperties from './BlockProperties.jsx'
import ProcessSimulation from './ProcessSimulation.jsx'
import {Field} from './BlockTypeFields.jsx'
import './process.css'

export default function ProcessBuilder({initialDefinitions=[],templates=[],onSave}){
  const [definitions,setDefinitions]=useState(()=>clone(initialDefinitions)),[draft,setDraft]=useState(null),[selected,setSelected]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[testing,setTesting]=useState(false),[pageSettings,setPageSettings]=useState(false)
  const root=useRef(null),alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{
    if(!dirty)return
    const unload=e=>{e.preventDefault();e.returnValue=''}
    const leave=e=>{if(root.current&&!root.current.contains(e.target)&&e.target.closest('button,a')&&!window.confirm('Leave the process builder and discard unsaved changes?')){e.preventDefault();e.stopPropagation()}}
    window.addEventListener('beforeunload',unload);document.addEventListener('click',leave,true)
    return()=>{window.removeEventListener('beforeunload',unload);document.removeEventListener('click',leave,true)}
  },[dirty])
  const change=next=>{setDraft(next);setDirty(true);setMessage('');setError('')}
  const choose=(d,isNew=false)=>{if(dirty&&!window.confirm('Discard unsaved changes to this process?'))return;setDraft(clone(d));setSelected('');setDirty(isNew);setMessage('');setError('');setTesting(false);setPageSettings(false)}
  const block=draft?.blocks.find(b=>b.id===selected)
  function add(type,position){const b=newBlock(type);b.stepNumber=draft.blocks.length+1;b.position=position||{x:80+(draft.blocks.length%2)*340,y:70+Math.floor(draft.blocks.length/2)*200};change({...draft,blocks:[...draft.blocks,b]});setSelected(b.id)}
  function connect(source,target){try{change(connectBlocks(draft,source,target))}catch(e){setError(e.message)}}
  async function save(){
    const problems=validateDefinition(draft);if(problems.length){setError(problems.join(' · '));return}
    setBusy(true);setError('')
    const next=definitions.some(d=>d.id===draft.id)?definitions.map(d=>d.id===draft.id?clone(draft):d):[...definitions,clone(draft)]
    try{if(!onSave)throw Error('Account saving is not connected');const ok=await onSave(next);if(ok===false)throw Error('Save was not acknowledged');if(!alive.current)return;setDefinitions(next);setDirty(false);setMessage('Saved to your account.')}
    catch(e){if(alive.current)setError(e.message||'Could not save. Your changes remain in this editor.')}
    finally{if(alive.current)setBusy(false)}
  }
  function test(){const problems=validateDefinition(draft);if(!draft.blocks.length)problems.push('Add a block before testing');if(problems.length){setError(problems.join(' · '));return}setTesting(true);setError('')}
  return <section className="mp-builder" ref={root}>
    <header className="mp-top"><div><span className="mp-eyebrow">MIO / WORKFLOW DESIGN</span><h1>Process Builder</h1><p>One set of blocks. Any process you need.</p></div><span className="mp-version">VERSION ONE · DESIGN & TEST</span></header>
    <div className="mp-banner"><b>Build and save your processes now.</b> This release configures blocks and previews their status changes. Live execution and custom navigation pages are not enabled yet.</div>
    <div className="mp-library"><div className="mp-library-actions"><button className="mp-primary" disabled={busy} onClick={()=>choose(newProcess(),true)}>+ Create process/page</button><button disabled={busy} onClick={()=>choose(starterProcess(),true)}>Use Need to Set example</button></div><div className="mp-saved-list">{definitions.map(d=><button key={d.id} disabled={busy} className={draft?.id===d.id?'active':''} aria-label={'Open '+d.name} onClick={()=>choose(d)}>{d.name}<small>{d.blocks.length} blocks</small></button>)}</div></div>
    {!draft?<div className="mp-welcome"><h2>Turn a routine into a reusable process.</h2><p>Start with an email, calendar check, document draft, filing, or file save. Give each block inputs, a completion rule, and a status message.</p><div className="mp-type-showcase">{Object.entries(TYPES).map(([key,t])=><div key={key} style={{'--block-color':t.color}}><span>{t.icon}</span><strong>{t.label}</strong></div>)}</div></div>:<>
      <div className="mp-toolbar"><div><h2>{draft.name}</h2><span className={dirty?'mp-unsaved':'mp-note'}>{dirty?'Unsaved changes':'Saved draft'}</span></div><div className="mp-toolbar-buttons"><button disabled={busy} onClick={()=>setPageSettings(!pageSettings)}>Page settings</button><button disabled={busy} onClick={()=>{const d=clone(draft);d.id=newId('process');d.name+=' (copy)';d.pageName+=' (copy)';choose(d,true)}}>Duplicate</button><button disabled={busy} onClick={test}>Test process</button><button className="mp-primary" disabled={busy||!dirty} onClick={save}>{busy?'Saving…':'Save process'}</button></div></div>
      {message&&<p role="status" className="mp-success">{message}</p>}{error&&<p role="alert" className="mp-error">{error}</p>}
      {pageSettings&&<fieldset className="mp-page-settings" disabled={busy}><legend>Process & page settings</legend><div className="mp-two"><Field label="Process name" value={draft.name} onChange={name=>change({...draft,name})}/><Field label="Page name" value={draft.pageName} onChange={pageName=>change({...draft,pageName})}/></div><p className="mp-note">Define row fields below. Page navigation and automatic row creation will be enabled with the live engine.</p>{draft.fields.map((f,i)=><div className="mp-row-field" key={i}><Field label={'Field '+(i+1)+' label'} value={f.label} onChange={label=>change({...draft,fields:draft.fields.map((x,j)=>j===i?{...x,label}:x)})}/><Field label={'Field '+(i+1)+' key'} value={f.key} onChange={key=>change({...draft,fields:draft.fields.map((x,j)=>j===i?{...x,key}:x)})}/><button onClick={()=>change({...draft,fields:draft.fields.filter((_,j)=>i!==j)})}>Remove field</button></div>)}<button onClick={()=>change({...draft,fields:[...draft.fields,{key:'field_'+newId('row').slice(-8),label:'New field',type:'text',required:false}]})}>+ Add row field</button></fieldset>}
      {testing?<ProcessSimulation definition={draft} onClose={()=>setTesting(false)}/>:<fieldset disabled={busy} className="mp-editor-frame"><div className="mp-editor">
        <aside className="mp-palette"><h3>BLOCKS</h3><p>Drag onto the canvas or click to add.</p>{Object.entries(TYPES).map(([type,t])=><button key={type} aria-label={'Add '+t.label+' block'} draggable onDragStart={e=>e.dataTransfer.setData('application/mio-block',type)} onClick={()=>add(type)}><span style={{color:t.color}}>{t.icon}</span>{t.label}</button>)}<div className="mp-canvas-help"><b>Connect blocks</b><p>Click the bottom dot, then the next block’s top dot. You can also connect in block settings.</p><b>Move blocks</b><p>Drag a card, or focus it and use arrow keys.</p></div></aside>
        <ProcessCanvas definition={draft} selectedId={selected} onSelect={setSelected} onMove={(id,position)=>change({...draft,blocks:draft.blocks.map(b=>b.id===id?{...b,position}:b)})} onConnect={connect} onDropBlock={add}/>
        {block?<BlockProperties key={block.id} block={block} definition={draft} templates={templates} onChange={next=>change({...draft,blocks:draft.blocks.map(b=>b.id===next.id?next:b)})} onConnect={connect} onDisconnect={id=>change({...draft,edges:draft.edges.filter(e=>e.id!==id)})} onDelete={()=>{if(window.confirm('Delete this block and its connections? References in other blocks may need updating.')){change(removeBlock(draft,block.id));setSelected('')}}}/>:<aside className="mp-properties mp-no-selection"><span>↖</span><h3>Choose a block</h3><p>Set its inputs, action, status messages and completion rule here.</p><div className="mp-status-key"><span className="me">Waiting on me</span><span className="others">Waiting on someone else</span></div></aside>}
      </div></fieldset>}
    </>}
  </section>
}
