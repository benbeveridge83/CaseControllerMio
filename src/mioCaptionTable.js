import { generatedCaseCaption, resolveCaseStyle, sortedChildren } from './mioDraftingComponents.js'
import { blockKey } from './mioTemplateFields.js'
export const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const SPACE = 'http://www.w3.org/XML/1998/namespace'
export function wordText(node) {
  const pieces = []
  function walk(n) {
    if (n.namespaceURI === WORD_NS) {
      if (['t','instrText','delText'].includes(n.localName)) { pieces.push(n.textContent || ''); return }
      if (['br','cr','tab'].includes(n.localName)) { pieces.push(n.localName === 'tab' ? '\t' : '\n'); return }
    }
    Array.from(n.childNodes || []).forEach(walk)
  }
  walk(node); return pieces.join('')
}
export function captionModel(data = {}, profile = {}, placeholder = false) {
  const values = placeholder ? {case_style_id:data.case_style_id || '@divorce', petitioner_name:'[Petitioner name]', respondent_name:'[Respondent name]', children:Array.isArray(data.children)?data.children:[{name:'[Child name]'}]} : data
  const style = resolveCaseStyle(profile, values.matter_case_type || values.case_type || '', sortedChildren(values).length > 0, values.case_style_id || '')
  const leftText = placeholder ? generatedCaseCaption(values, profile) : String(data.case_caption_text || generatedCaseCaption(data, profile))
  const left = (leftText || '[Case caption]').split(/\r?\n/)
  const rawCourt = String(data.court_name || data.matter_court_name || data.court_title || '').trim()
  const countyRaw = String(data.county || data.matter_county || data.court_county || '').trim().replace(/,?\s*TEXAS\s*$/i,'').trim()
  const county = placeholder ? '[Court county], TEXAS' : countyRaw ? countyRaw.toUpperCase() + (/\bCOUNTY$/i.test(countyRaw) ? '' : ' COUNTY') + ', TEXAS' : '[Missing: county]'
  const court = placeholder ? '[Court name]' : rawCourt ? rawCourt.toUpperCase().replace(/\s+COURT$/,'') : '[Missing: court_name]'
  const heading = placeholder || /district|judicial/i.test(rawCourt) ? 'IN THE DISTRICT COURT' : /county.*law/i.test(rawCourt) ? 'IN THE COUNTY COURT AT LAW' : 'IN THE COURT'
  return {left, right:[heading,'',court,'',county], marks:Math.max(8,left.length + 1), style:style?.kind || 'custom'}
}
function el(doc,name,attrs={}) {
  const n=doc.createElementNS(WORD_NS,'w:'+name)
  for(const [key,value] of Object.entries(attrs))n.setAttributeNS(WORD_NS,'w:'+key,String(value))
  return n
}
export function wordParagraph(doc,text,alignment='left') {
  const p=el(doc,'p'),props=el(doc,'pPr');props.append(el(doc,'jc',{val:alignment}),el(doc,'spacing',{before:0,after:0,line:240,lineRule:'auto'}),el(doc,'keepNext'));p.appendChild(props)
  const r=el(doc,'r'),rp=el(doc,'rPr');rp.append(el(doc,'rFonts',{ascii:'Times New Roman',hAnsi:'Times New Roman',cs:'Times New Roman'}),el(doc,'sz',{val:24}));r.appendChild(rp)
  String(text ?? '').split(/\r?\n/).forEach((line,i)=>{if(i)r.appendChild(el(doc,'br'));const t=el(doc,'t');t.setAttributeNS(SPACE,'xml:space','preserve');t.textContent=line;r.appendChild(t)})
  p.appendChild(r);return p
}
export function createCaptionTable(doc,data,profile={}) {
  const model=captionModel(data,profile),section=doc.getElementsByTagNameNS(WORD_NS,'sectPr')[0]
  const get=(local,attr,fallback)=>{const n=section?.getElementsByTagNameNS(WORD_NS,local)[0];const v=Number(n?.getAttributeNS(WORD_NS,attr));return v>0?v:fallback}
  const width=Math.max(2880,get('pgSz','w',12240)-get('pgMar','left',1440)-get('pgMar','right',1440))
  const cols=[Math.round(width*.51),Math.round(width*.045)];cols.push(width-cols[0]-cols[1])
  const table=el(doc,'tbl'),pr=el(doc,'tblPr'),borders=el(doc,'tblBorders');pr.append(el(doc,'tblW',{w:width,type:'dxa'}),el(doc,'jc',{val:'center'}),el(doc,'tblLayout',{type:'fixed'}))
  for(const name of ['top','left','bottom','right','insideH','insideV'])borders.appendChild(el(doc,name,{val:'nil'}))
  pr.appendChild(borders);table.appendChild(pr);const grid=el(doc,'tblGrid');cols.forEach(w=>grid.appendChild(el(doc,'gridCol',{w})));table.appendChild(grid)
  const row=el(doc,'tr'),rowProps=el(doc,'trPr');rowProps.appendChild(el(doc,'cantSplit'));row.appendChild(rowProps)
  const lines=[model.left,Array.from({length:model.marks},()=>String.fromCharCode(167)),model.right]
  cols.forEach((width,index)=>{const cell=el(doc,'tc'),cp=el(doc,'tcPr');cp.append(el(doc,'tcW',{w:width,type:'dxa'}),el(doc,'vAlign',{val:'center'}));const margins=el(doc,'tcMar');for(const side of ['top','left','bottom','right'])margins.appendChild(el(doc,side,{w:side==='left'||side==='right'?60:0,type:'dxa'}));cp.appendChild(margins);cell.appendChild(cp);lines[index].forEach(line=>cell.appendChild(wordParagraph(doc,line,index===0?'left':'center')));row.appendChild(cell)})
  table.appendChild(row);return table
}
function ancestor(node,name){let n=node.parentNode;while(n){if(n.namespaceURI===WORD_NS&&n.localName===name)return n;n=n.parentNode}return null}
export function expandCaptionMarkers(doc,data,profile={}) {
  for(const p of Array.from(doc.getElementsByTagNameNS(WORD_NS,'p'))){
    if(blockKey(wordText(p))!=='caption')continue
    const table=ancestor(p,'tbl'),cell=ancestor(p,'tc')
    const cells=table?Array.from(table.getElementsByTagNameNS(WORD_NS,'tc')):[]
    if(table&&cells.length===3&&/^[\s\u00a7]*$/.test(wordText(cells[1]))){
      table.parentNode.replaceChild(createCaptionTable(doc,data,profile),table)
    }else if(table&&cell&&cells.length>=3){
      const replacement=wordParagraph(doc,String(data.case_caption_text||generatedCaseCaption(data,profile)),'left')
      const row=ancestor(p,'tr')
      if(row)for(const h of Array.from(row.getElementsByTagNameNS(WORD_NS,'trHeight')))h.parentNode.removeChild(h)
      p.parentNode.replaceChild(replacement,p)
    }else{
      const parent=p.parentNode;parent.replaceChild(createCaptionTable(doc,data,profile),p)
      if(parent.localName==='tc'&&parent.lastChild?.localName!=='p')parent.appendChild(el(doc,'p'))
    }
  }
}
export function applySensitiveNoticeSafe(doc,body,setup) {
  const normalize=text=>String(text||'').replace(/\s+/g,'').replace(/[.!]+$/,'').toUpperCase()
  const desired=normalize(setup.sensitive_notice_text),standard='NOTICE:THISDOCUMENTCONTAINSSENSITIVEDATA'
  const existing=Array.from(body.getElementsByTagNameNS(WORD_NS,'p')).filter(p=>[desired,standard].includes(normalize(wordText(p))))
  const remove=p=>{const parent=p.parentNode;parent?.removeChild(p);if(parent?.localName==='tc'&&!parent.getElementsByTagNameNS(WORD_NS,'p').length)parent.appendChild(el(doc,'p'))}
  if(!setup.sensitive_notice_enabled){existing.forEach(remove);return}
  if(existing.length){existing.slice(1).forEach(remove);return}
  body.insertBefore(wordParagraph(doc,setup.sensitive_notice_text),body.firstChild)
}
export function replaceWordRange(paragraph,start,end,value) {
  const parts=[];let at=0
  function walk(n){if(n.namespaceURI===WORD_NS){if(n.localName==='t'){const text=n.textContent||'';parts.push({node:n,start:at,end:at+text.length,text});at+=text.length;return}if(['br','cr','tab'].includes(n.localName)){parts.push({node:n,start:at,end:at+1,text:n.localName==='tab'?'\t':'\n',control:true});at++;return}}Array.from(n.childNodes||[]).forEach(walk)}
  walk(paragraph)
  const affected=parts.filter(p=>p.end>start&&p.start<end)
  if(!affected.length||start<0||end>at)throw new Error('Field location no longer matches the Word paragraph.')
  const first=affected[0];if(first.control)throw new Error('Select text, not a standalone Word break.')
  const suffix=first.text.slice(Math.max(0,end-first.start)),prefix=first.text.slice(0,Math.max(0,start-first.start))
  first.node.textContent=prefix+String(value??'')+suffix;first.node.setAttributeNS(SPACE,'xml:space','preserve')
  for(const part of affected.slice(1)){if(part.control)part.node.parentNode.removeChild(part.node);else part.node.textContent=part.text.slice(Math.max(0,end-part.start))}
  if(first.node.textContent.includes('\n')){const lines=first.node.textContent.split(/\r?\n/),parent=first.node.parentNode,after=first.node.nextSibling;first.node.textContent=lines.shift();for(const line of lines){parent.insertBefore(el(paragraph.ownerDocument,'br'),after);const t=el(paragraph.ownerDocument,'t');t.setAttributeNS(SPACE,'xml:space','preserve');t.textContent=line;parent.insertBefore(t,after)}}
}
