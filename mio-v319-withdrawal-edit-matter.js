function once(code,from,to,label){
 const index=code.indexOf(from)
 if(index<0||code.indexOf(from,index+from.length)>=0)throw new Error('V319 integration anchor changed: '+label)
 return code.replace(from,to)
}

export default function mioV319WithdrawalEditMatter(){return{
 name:'mio-v319-withdrawal-edit-matter',
 enforce:'pre',
 transform(source,id){
  const path=id.split('?')[0].replaceAll('\\','/')
  if(!path.endsWith('/src/MioWithdrawalBlocks.jsx'))return null
  let code=once(source,'onAction,onMatterStatus,getPeople,','onAction,onMatterStatus,onEditMatter,getPeople,','dashboard edit callback prop')
  const review=`<td><button type="button" aria-expanded={expanded===row.matter_id} onClick={e=>{e.stopPropagation();run(()=>showRow(row))}}>{expanded===row.matter_id?'Collapse':'Review'}</button></td></tr>`
  const actions=`<td><button type="button" aria-expanded={expanded===row.matter_id} onClick={e=>{e.stopPropagation();run(()=>showRow(row))}}>{expanded===row.matter_id?'Collapse':'Review'}</button> <button type="button" onClick={e=>{e.stopPropagation();onEditMatter?.(row.matter_id)}}>Edit matter</button></td></tr>`
  code=once(code,review,actions,'workflow row actions')
  return {code,map:null}
 }
}}
