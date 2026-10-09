import React,{useEffect,useRef,useState} from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const BUCKET = 'fee-agreement-templates'
const MIN_SCALE = 0.4
const MAX_SCALE = 1.6

// Read-only preview: renders the uploaded fee-agreement PDF scaled to fit the
// available width (so the whole page is visible) and overlays the mapped fields
// with their populated values. Signature fields render empty.
export function FeeAgreementPdfPreview({supabase,path,fieldsJson,values}){
  const [pages,setPages]=useState([])
  const [fields,setFields]=useState([])
  const [scale,setScale]=useState(1)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const wrapRef=useRef(null)

  useEffect(()=>{try{const v=JSON.parse(fieldsJson||'[]');setFields(Array.isArray(v)?v:[])}catch{setFields([])}},[fieldsJson])

  useEffect(()=>{
    let cancelled=false
    if(!path){setPages([]);return}
    ;(async()=>{
      setBusy(true);setError('')
      try{
        const {data,error:urlErr}=await supabase.storage.from(BUCKET).createSignedUrl(path,3600)
        if(cancelled)return
        if(urlErr||!data)throw urlErr||new Error('Could not load the agreement PDF.')
        const doc=await pdfjsLib.getDocument({url:data.signedUrl}).promise
        const first=await doc.getPage(1)
        const naturalWidth=first.getViewport({scale:1}).width
        const avail=Math.max(280,(wrapRef.current?.clientWidth||660)-24)
        const s=Math.max(MIN_SCALE,Math.min(MAX_SCALE,avail/naturalWidth))
        const loaded=[]
        for(let i=1;i<=doc.numPages;i++){
          const page=await doc.getPage(i)
          const vp=page.getViewport({scale:s})
          const canvas=document.createElement('canvas')
          canvas.width=vp.width;canvas.height=vp.height
          await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise
          loaded.push({page:i-1,dataUrl:canvas.toDataURL(),width:vp.width,height:vp.height})
        }
        if(!cancelled){setScale(s);setPages(loaded)}
      }catch(e){if(!cancelled)setError(e.message||String(e))}
      finally{if(!cancelled)setBusy(false)}
    })()
    return()=>{cancelled=true}
  },[path,supabase])

  if(!path)return <p className="mio-pnc-error">No fee-agreement PDF is configured for this matter. Upload and map it in Settings → PNC workflow → "Fee agreement PDF template".</p>
  if(busy&&pages.length===0)return <p role="status">Loading agreement PDF...</p>
  if(error)return <p role="alert" className="mio-pnc-error">{error}</p>

  const isSig=f=>f.type==='signature'||f.semantic==='client_signature'
  return <div ref={wrapRef} style={{width:'100%'}}>
    {pages.map(pg=><div key={pg.page} style={{position:'relative',width:pg.width,height:pg.height,margin:'8px auto',boxShadow:'0 1px 3px rgba(0,0,0,.2)'}}>
      <img src={pg.dataUrl} width={pg.width} height={pg.height} alt={`Page ${pg.page+1}`} style={{display:'block'}}/>
      {fields.filter(f=>f.page===pg.page).map(f=>(
        <div key={f.id||f.semantic+'-'+f.x+'-'+f.y} style={{position:'absolute',left:f.x*scale,top:f.y*scale,width:f.width*scale,height:f.height*scale,border:isSig(f)?'2px solid #dc2626':'1px solid #2563eb',background:isSig(f)?'rgba(220,38,38,.10)':'rgba(37,99,235,.10)',boxSizing:'border-box',overflow:'hidden',display:'flex',alignItems:'center',paddingLeft:5}}>
          {!isSig(f)&&<span style={{fontSize:Math.max(10,Math.round(12*scale)),color:'#0f172a',whiteSpace:'nowrap'}}>{values?.[f.semantic]??f.semantic??''}</span>}
        </div>
      ))}
    </div>)}
  </div>
}
