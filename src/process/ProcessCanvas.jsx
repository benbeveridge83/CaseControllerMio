import {useRef} from 'react'
import {TYPES} from '../../lib/process/model.js'

export default function ProcessCanvas({definition,selectedId,onSelect,onMove,onConnect,onDropBlock}){
  const surface=useRef(null),drag=useRef(null),origin=useRef(null)
  const width=Math.max(860,...definition.blocks.map(b=>b.position.x+300)),height=Math.max(560,...definition.blocks.map(b=>b.position.y+200))
  function begin(e,b){if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:b.id,x:e.clientX,y:e.clientY,start:b.position};onSelect(b.id)}
  function move(e){if(!drag.current)return;const d=drag.current;onMove(d.id,{x:Math.max(20,Math.round(d.start.x+e.clientX-d.x)),y:Math.max(20,Math.round(d.start.y+e.clientY-d.y))})}
  return <div className="mp-canvas-scroll"><div ref={surface} className="mp-canvas" style={{width,height}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const type=e.dataTransfer.getData('application/mio-block');if(!TYPES[type])return;const box=surface.current.getBoundingClientRect();onDropBlock(type,{x:Math.max(20,e.clientX-box.left-120),y:Math.max(20,e.clientY-box.top-30)})}}>
    <svg width={width} height={height} className="mp-wires" aria-hidden="true"><defs><marker id="mp-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#94a3b8"/></marker></defs>{definition.edges.map(e=>{
      const a=definition.blocks.find(b=>b.id===e.source),b=definition.blocks.find(b=>b.id===e.target);if(!a||!b)return null
      const x1=a.position.x+125,y1=a.position.y+132,x2=b.position.x+125,y2=b.position.y-5
      return <path key={e.id} d={`M ${x1} ${y1} C ${x1} ${y1+65}, ${x2} ${y2-65}, ${x2} ${y2}`} fill="none" stroke="#94a3b8" strokeWidth="2" markerEnd="url(#mp-arrow)"/>
    })}</svg>
    {!definition.blocks.length&&<div className="mp-empty-canvas"><h3>Build your first process</h3><p>Drag a block here or click a block in the palette.<br/>Connect its output to the next block’s input.</p></div>}
    {definition.blocks.map(b=><div key={b.id} className={'mp-node '+(selectedId===b.id?'selected':'')} style={{left:b.position.x,top:b.position.y,'--block-color':TYPES[b.type].color}}>
      <button className="mp-port input" aria-label={'Connect input of '+b.name} title="Connect from the selected output" onClick={()=>{if(origin.current){onConnect(origin.current,b.id);origin.current=null}}}>○</button>
      <button className="mp-node-body" aria-label={'Configure '+b.name} onPointerDown={e=>begin(e,b)} onPointerMove={move} onPointerUp={()=>{drag.current=null}} onLostPointerCapture={()=>{drag.current=null}} onClick={()=>onSelect(b.id)} onKeyDown={e=>{const delta={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];if(delta){e.preventDefault();onMove(b.id,{x:Math.max(20,b.position.x+delta[0]),y:Math.max(20,b.position.y+delta[1])})}}}>
        <span className="mp-node-type"><span>{TYPES[b.type].icon}</span>{TYPES[b.type].label}<b>{b.stepNumber}</b></span>
        <strong>{b.name}</strong><small>{b.activation==='row_created'?'Starts when a row is created':'Starts after connected block'+(b.join==='all'?'s':'')}</small>
      </button>
      <button className="mp-port output" aria-label={'Select output of '+b.name} title="Click, then choose another block’s input" onClick={e=>{origin.current=b.id;onSelect(b.id);e.currentTarget.focus()}}>●</button>
    </div>)}
  </div></div>
}
