import React,{useEffect,useRef,useState} from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const SCALE = 1.5
const BUCKET = 'fee-agreement-templates'
const SEMANTIC_OPTIONS = [
  {value:'client_name',label:'Client Name'},
  {value:'client_email',label:'Client Email'},
  {value:'date',label:'Date'},
  {value:'retainer_amount',label:'Retainer Amount'},
  {value:'hourly_rate',label:'Hourly Rate'},
  {value:'evergreen_minimum_balance',label:'Evergreen Minimum Balance'},
  {value:'client_signature',label:'Client Signature'},
]

const FIXED=new Set(SEMANTIC_OPTIONS.map(o=>o.value))
export function FeeAgreementPdfMapper({supabase,path,fieldsJson,onChange}){
  const [fields,setFields]=useState(()=>{try{const v=JSON.parse(fieldsJson||'[]');return Array.isArray(v)?v:[]}catch{return []}})
  const [pages,setPages]=useState([])
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [selected,setSelected]=useState(null)
  const [pdfUrl,setPdfUrl]=useState('')
  const dragRef=useRef(null)

  useEffect(()=>{if(path){supabase.storage.from(BUCKET).createSignedUrl(path,3600).then(({data,error})=>{if(data&&!error)setPdfUrl(data.signedUrl)})}},[path,supabase])

  async function loadPdf(url){
    setBusy(true);setError('')
    try{
      const doc=await pdfjsLib.getDocument({url}).promise
      const loaded=[]
      for(let i=1;i<=doc.numPages;i++){
        const page=await doc.getPage(i)
        const vp=page.getViewport({scale:SCALE})
        const canvas=document.createElement('canvas')
        canvas.width=vp.width;canvas.height=vp.height
        await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise
        loaded.push({page:i-1,dataUrl:canvas.toDataURL(),width:vp.width,height:vp.height})
      }
      setPages(loaded)
    }catch(e){setError(e.message||String(e))}
    finally{setBusy(false)}
  }

  useEffect(()=>{if(pdfUrl)loadPdf(pdfUrl)},[pdfUrl])

  async function upload(file){
    setBusy(true);setError('')
    try{
      const safeName=(file.name||'fee-agreement.pdf').replace(/[^a-zA-Z0-9._-]/g,'_')
      const p=`templates/${crypto.randomUUID()}-${safeName}`
      const {error:upErr}=await supabase.storage.from(BUCKET).upload(p,file,{upsert:false})
      if(upErr)throw upErr
      onChange(p,JSON.stringify(fields))
      const {data:sign,error:signErr}=await supabase.storage.from(BUCKET).createSignedUrl(p,3600);if(signErr)throw signErr
      if(path&&path!==p)await supabase.storage.from(BUCKET).remove([path])
      setPdfUrl(sign.signedUrl)
    }catch(e){setError(e.message||String(e))}
    finally{setBusy(false)}
  }

  async function removeTemplate(){
    if(!path)return
    setBusy(true);setError('')
    try{
      const {error}=await supabase.storage.from(BUCKET).remove([path])
      if(error)throw error
      onChange('','[]')
      setFields([]);setPdfUrl('');setPages([]);setSelected(null)
    }catch(e){setError(e.message||String(e))}
    finally{setBusy(false)}
  }

  function placeField(e,page){
    const rect=e.currentTarget.getBoundingClientRect()
    const f={id:crypto.randomUUID(),semantic:'client_name',type:'text',page,x:Math.round((e.clientX-rect.left)/SCALE),y:Math.round((e.clientY-rect.top)/SCALE),width:140,height:20}
    const next=[...fields,f]
    setFields(next);onChange(path,JSON.stringify(next));setSelected(f.id)
  }

  function update(id,patch){
    const next=fields.map(f=>f.id===id?{...f,...patch}:f)
    setFields(next);onChange(path,JSON.stringify(next))
  }

  function remove(id){
    const next=fields.filter(f=>f.id!==id)
    setFields(next);onChange(path,JSON.stringify(next));setSelected(null)
  }
  function onBoxDown(e,id){
    e.stopPropagation();e.preventDefault()
    const d=fields.find(f=>f.id===id);if(!d)return
    dragRef.current={id,kind:'move',startX:e.clientX,startY:e.clientY,origX:d.x,origY:d.y}
    setSelected(id)
    const move=ev=>{const dg=dragRef.current;if(!dg||dg.kind!=='move')return;const nx=Math.round(dg.origX+(ev.clientX-dg.startX)/SCALE),ny=Math.round(dg.origY+(ev.clientY-dg.startY)/SCALE);setFields(fs=>fs.map(f=>f.id===dg.id?{...f,x:nx,y:ny}:f))}
    const up=ev=>{const dg=dragRef.current;if(dg){const nx=Math.round(dg.origX+(ev.clientX-dg.startX)/SCALE),ny=Math.round(dg.origY+(ev.clientY-dg.startY)/SCALE);setFields(fs=>{const next=fs.map(f=>f.id===dg.id?{...f,x:nx,y:ny}:f);onChange(path,JSON.stringify(next));return next})}dragRef.current=null;window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up)}
    window.addEventListener('mousemove',move);window.addEventListener('mouseup',up)
  }

  function onResizeDown(e,id){
    e.stopPropagation();e.preventDefault()
    const d=fields.find(f=>f.id===id);if(!d)return
    dragRef.current={id,kind:'resize',startX:e.clientX,startY:e.clientY,origW:d.width,origH:d.height}
    setSelected(id)
    const move=ev=>{const dg=dragRef.current;if(!dg||dg.kind!=='resize')return;const nw=Math.max(30,Math.round(dg.origW+(ev.clientX-dg.startX)/SCALE)),nh=Math.max(14,Math.round(dg.origH+(ev.clientY-dg.startY)/SCALE));setFields(fs=>fs.map(f=>f.id===dg.id?{...f,width:nw,height:nh}:f))}
    const up=ev=>{const dg=dragRef.current;if(dg){const nw=Math.max(30,Math.round(dg.origW+(ev.clientX-dg.startX)/SCALE)),nh=Math.max(14,Math.round(dg.origH+(ev.clientY-dg.startY)/SCALE));setFields(fs=>{const next=fs.map(f=>f.id===dg.id?{...f,width:nw,height:nh}:f);onChange(path,JSON.stringify(next));return next})}dragRef.current=null;window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up)}
    window.addEventListener('mousemove',move);window.addEventListener('mouseup',up)
  }

  const sel=fields.find(f=>f.id===selected)

  return <div className="mio-pdf-mapper">
    <div className="mio-pnc-actions"><label className="mio-pnc-field"><span>Fee agreement PDF</span><input type="file" accept="application/pdf" onChange={e=>{const f=e.target.files?.[0];if(f)upload(f)}}/></label>{path&&<button type="button" disabled={busy} onClick={removeTemplate}>Remove PDF</button>}{busy&&<span role="status">Working...</span>}</div>
    <p className="hint">Click the page to add a field. Click a box to select it and set its type below. Drag a box to move it; drag its bottom-right corner to resize.</p>
    {error&&<p role="alert" className="mio-pnc-error">{error}</p>}
    {pages.length===0&&!busy&&!error&&<p>Upload a PDF to begin mapping fields.</p>}
    {sel&&<div className="mio-pnc-preview"><h4>Selected field</h4><label className="mio-pnc-field"><span>Field type</span><select value={FIXED.has(sel.semantic)?sel.semantic:'__custom__'} onChange={e=>{if(e.target.value==='__custom__'){update(sel.id,{semantic:'',type:'text'})}else{update(sel.id,{semantic:e.target.value,type:e.target.value==='client_signature'?'signature':'text'})}}}>{SEMANTIC_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}<option value="__custom__">Custom field...</option></select></label>{!FIXED.has(sel.semantic)&&<label className="mio-pnc-field"><span>Custom field name</span><input value={sel.semantic} placeholder="e.g. purposes_of_representation" onChange={e=>update(sel.id,{semantic:e.target.value,type:'text'})}/></label>}<button onClick={()=>remove(sel.id)}>Remove field</button></div>}
    {pages.map(pg=><div key={pg.page} style={{position:'relative',width:pg.width,height:pg.height,margin:'8px 0',boxShadow:'0 1px 3px rgba(0,0,0,.2)'}}>
      <img src={pg.dataUrl} width={pg.width} height={pg.height} alt={`Page ${pg.page+1}`} style={{display:'block'}} onClick={e=>placeField(e,pg.page)}/>
      {fields.filter(f=>f.page===pg.page).map(f=>{const label=SEMANTIC_OPTIONS.find(o=>o.value===f.semantic)?.label||f.semantic;return <div key={f.id} onMouseDown={e=>onBoxDown(e,f.id)} onClick={e=>{e.stopPropagation();setSelected(f.id)}} style={{position:'absolute',left:f.x*SCALE,top:f.y*SCALE,width:f.width*SCALE,height:f.height*SCALE,border:f.type==='signature'?'2px solid #dc2626':'2px solid #2563eb',background:f.type==='signature'?'rgba(220,38,38,.15)':'rgba(37,99,235,.15)',cursor:'move',boxSizing:'border-box',overflow:'hidden'}}><span style={{fontSize:11,color:'#0f172a',background:'#fff',padding:'0 3px',whiteSpace:'nowrap'}}>{label}</span><span onMouseDown={e=>onResizeDown(e,f.id)} style={{position:'absolute',right:0,bottom:0,width:12,height:12,background:'#2563eb',border:'1px solid #fff',cursor:'nwse-resize',borderRadius:'0 0 0 3px'}}/></div>})}
    </div>)}
  </div>
}

