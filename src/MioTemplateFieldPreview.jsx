import React,{useState} from 'react'
import {blockKey, paragraphFields, BLOCK_TOKENS} from './mioTemplateFields.js'
import {captionModel} from './mioCaptionTable.js'
import {DEFAULT_COMPONENT_TEXT} from './mioDraftingComponents.js'
import {partyLabel} from './mioPartyPronouns.js'
const chip={display:'inline-block',padding:'1px 5px',margin:'1px 2px',border:'1px dashed #2563eb',borderRadius:4,background:'#eff6ff',color:'#1744a3',fontFamily:'Arial,sans-serif',fontSize:11,fontWeight:700,lineHeight:1.3,textIndent:0,whiteSpace:'normal',overflowWrap:'anywhere',verticalAlign:'baseline',cursor:'pointer'}
function Field({label,...props}){return <span {...props} contentEditable={false} style={chip}>[{label}]</span>}
function words(value){return String(value||'Field').replace(/[_.]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
export function CaptionPreview({styleId,profile}){
 const [sampleType,setSampleType]=useState('SAPCR'),[count,setCount]=useState(2)
 const sample={matter_case_type:sampleType,case_style_id:styleId||'',children:Array.from({length:count},(_,i)=>({name:'[Child '+(i+1)+' name]'}))}
 const model=captionModel(sample,profile,true)
 const display=text=>text.split(/(\[[^\]]+\])/).map((part,i)=>part.startsWith('[')?<Field key={i} label={part.slice(1,-1)}/>:part)
 return <div><div style={{fontFamily:'Arial,sans-serif',fontSize:11,marginBottom:8,textIndent:0,textAlign:'left'}}><strong>{styleId?'Template caption override':'Automatic caption — follows matter case type'}</strong><div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:5}}>{!styleId&&<label>Preview case type <select aria-label="Caption example case type" value={sampleType} onChange={e=>setSampleType(e.target.value)}><option>Divorce</option><option>SAPCR</option><option>Modification</option></select></label>}<label>Preview children <select aria-label="Caption example children" value={count} onChange={e=>setCount(Number(e.target.value))}>{[0,1,2,3,4].map(n=><option key={n} value={n}>{n}</option>)}</select></label></div><small>Preview only. Generation uses the selected matter's actual parties and children.</small></div><table aria-label="Caption fields" style={{width:'100%',tableLayout:'fixed',borderCollapse:'collapse',fontFamily:'Times New Roman,serif',fontSize:14,lineHeight:1.15,whiteSpace:'normal',textIndent:0}}><colgroup><col style={{width:'51%'}}/><col style={{width:'4.5%'}}/><col style={{width:'44.5%'}}/></colgroup><tbody><tr>
 <td style={{border:0,textAlign:'left',verticalAlign:'middle',padding:'4px 2px'}}>{model.left.map((line,i)=><div key={i}>{display(line)||'\u00a0'}</div>)}</td>
 <td style={{border:0,textAlign:'center',verticalAlign:'middle',padding:0}}>{Array.from({length:model.marks},(_,i)=><div key={i}>{'\u00a7'}</div>)}</td>
 <td style={{border:0,textAlign:'center',verticalAlign:'middle',padding:'4px 2px'}}>{model.right.map((line,i)=><div key={i} style={{minHeight:'1.15em'}}>{display(line)}</div>)}</td>
 </tr></tbody></table></div>
}
export function BlockPreview({type,profile,styleId}){
 if(type==='caption')return <CaptionPreview styleId={styleId} profile={profile}/>
 let wording=type==='signature'?'{{firm_name}}\n/s/ {{attorney_name}}\nState Bar No. {{bar_number}}\n{{firm_address}}\nTelephone: {{firm_phone}}\nEmail: {{firm_email}}':profile?.component_templates?.[type]??DEFAULT_COMPONENT_TEXT[type]??''
 if(!wording)wording='{{'+(type==='notice'?'notice_text':'custom_block_content')+'}}'
 return <div aria-label={words(type)+' fields'} contentEditable={false} style={{padding:'6px 8px',border:'1px solid #c4b5fd',borderRadius:5,background:'#faf8ff',textAlign:'left',textIndent:0,whiteSpace:'normal'}}>{wording.split('\n').map((line,i)=><div key={i} style={{minHeight:16}}>{line.split(/(\{\{[\w.\s-]+\}\})/).map((part,j)=>part.startsWith('{{')?<Field key={j} label={words(part.slice(2,-2).trim())}/>:part)}</div>)}</div>
}
export function TemplateParagraph({paragraph,template,file,document,profile,sourceLabel,onEdit}){
 const text=String(paragraph?.text||''),type=blockKey(text)
 const styleId=template?.drafting_components_by_file?.[String(file?.id||file?.name||'')]?.case_style_id||''
 if(type)return <div contentEditable={false} data-mio-block={type}><BlockPreview type={type} profile={profile} styleId={styleId}/></div>
 const ranges=paragraphFields(paragraph,template,file,document),pieces=[]
 const plain=(start,end)=>{if(end>start)pieces.push(<span key={'text-'+start} data-mio-source-start={start} data-mio-source-end={end}>{text.slice(start,end)}</span>)}
 let cursor=0
 for(const range of ranges){
  plain(cursor,range.start)
  const b=range.binding,kind=b.kind
  const block=kind==='caption_block'?'caption':kind==='signature_block'?'signature':kind==='component_block'?BLOCK_TOKENS[b.field_key]:''
  if(block)pieces.push(<span key={b.id+'-'+range.start} data-mio-source-start={range.start} data-mio-source-end={range.end} data-mio-field-id={b.id} contentEditable={false}>{range.first!==false&&<BlockPreview type={block} profile={profile} styleId={styleId}/>}</span>)
  else {
   const source=b.data_source&&b.data_source!=='manual'?sourceLabel(b.data_source):''
   const label=kind==='pronoun'?partyLabel(b.linked_party)+' '+words(b.grammar_role||'subject')+' Pronoun':source||b.label||words(b.field_key)
   pieces.push(<Field key={b.id+'-'+range.start} label={label} role="button" tabIndex={0} aria-label={'Edit field: '+label} data-mio-source-start={range.start} data-mio-source-end={range.end} data-mio-field-id={b.id} title="Saved template field. Click to edit." onMouseUp={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onEdit(b)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onEdit(b)}}}/>)
  }
  cursor=range.end
 }
 plain(cursor,text.length)
 return <>{pieces}</>
}
