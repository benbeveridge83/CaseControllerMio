import { dailyTrustSummary, firmDate } from '../mioDailyTrust.js'

export { firmDate }
export const messageKey = m => `${String(m.accountEmail||'').toLowerCase()}::${m.id||''}`
export const billingMarker = row => `Dashboard / ${row.kind} / ${row.sourceId}`
export function weekStart(date) {
 const d=new Date(`${date}T12:00:00Z`),day=(d.getUTCDay()+6)%7
 d.setUTCDate(d.getUTCDate()-day)
 return d.toISOString().slice(0,10)
}
export function workedToday(row, entries, date, userId) {
 return entries.some(e=>!['pending','failed'].includes(e.dashboard_save_state)&&String(e.matter_id)===String(row.matterId)&&String(e.user_id||'')===String(userId||'')&&String(e.date||'').slice(0,10)===date&&e.entry_type!=='expense'&&!e.deleted_at&&!['void','deleted'].includes(e.status)&&Number(e.billing_time)>0&&(
   e.dashboard_task_key===row.key||e.matter_step===billingMarker(row)||
   (row.kind==='orders'&&String(e.matter_step||'').startsWith(`Orders - ${row.sourceId}:`))
 ))
}
export function periodSummary({from,to,entries=[],matters=[],userId,financeFor,pendingFor}) {
 const own=entries.filter(e=>String(e.user_id||'')===String(userId||'')&&e.entry_type!=='expense')
 const result=dailyTrustSummary({date:from,dateTo:to,entries:own,matters,financeFor,pendingFor})
 const seen=new Set()
 result.hours=own.reduce((n,e)=>{
  if(e.date<from||e.date>to||e.deleted_at||e.do_not_bill||e.non_billable||['void','deleted'].includes(e.status)||seen.has(e.id))return n
  seen.add(e.id);return n+Math.max(0,Number(e.billing_time)||0)
 },0)
 return result
}
function words(value){return String(value||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>3&&!['hearing','setting','matter','regarding','please','re'].includes(w))}
function seedMatches(row,message,rows){
 if(message.taskKey)return message.taskKey===row.key
 const matches=message.matches||[]
 if(matches.length!==1||String(matches[0].matterId)!==String(row.matterId))return false
 if(!(message.categories||[]).includes(row.kind))return false
 const candidates=rows.filter(r=>r.kind===row.kind&&String(r.matterId)===String(row.matterId))
 if(candidates.length===1)return true
 const subject=words(message.subject),ours=words(row.title)
 return ours.length>0&&ours.every(w=>subject.includes(w))&&candidates.filter(r=>{const title=words(r.title);return title.length&&title.every(w=>subject.includes(w))}).length===1
}
export function taskMessages(row,messages=[],rows=[row]){
 const seeds=messages.filter(m=>seedMatches(row,m,rows))
 const threads=new Set(seeds.filter(m=>m.conversationId).map(m=>`${m.accountEmail}::${m.conversationId}`))
 const ids=new Set(seeds.map(messageKey))
 for(const m of row.linkedEmails||[]){const mailbox=String(m.mailbox_email||m.accountEmail||m.sender_email||'').toLowerCase();if(m.outlook_conversation_id)threads.add(`${mailbox}::${m.outlook_conversation_id}`);if(m.outlook_message_id)ids.add(messageKey({accountEmail:mailbox,id:m.outlook_message_id}))}
 return messages.filter(m=>ids.has(messageKey(m))||(m.conversationId&&threads.has(`${m.accountEmail}::${m.conversationId}`)))
}
export function linkedThreadRecords(records=[]){return records.filter(e=>e.outlook_conversation_id||e.outlook_message_id||(Array.isArray(e.thread_messages)&&e.thread_messages.length))}
export function sortedTrust(matters,financeFor){
 return matters.map(m=>{const f=financeFor(m);return {id:String(m.id),name:m.name||'Matter',trust:f?.financialSnapshotResolved===false?null:Number(f?.trust||0)}}).sort((a,b)=>(b.trust??-Infinity)-(a.trust??-Infinity)||a.name.localeCompare(b.name))
}
export function classifyTimeline(item){return /deadline|due|designation|exchange|discovery.end/i.test(item.type||item.kind||item.title||'')?'deadlines':'settings'}
