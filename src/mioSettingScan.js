// A date is not a setting. Require scheduling language attached to that date,
// never borrow a time across another date, sentence, page or filing boundary.
export const SETTING_SCAN_SCHEMA='service-hearing-scan-v301'
const months=['january','february','march','april','may','june','july','august','september','october','november','december']
const month='(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)'
const dates=new RegExp(String.raw`\b(?:20\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|1[0-2])[/.-](?:0?[1-9]|[12]\d|3[01])(?:[/.-](?:20\d{2}|\d{2}))?|${month}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*20\d{2})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?${month}\.?(?:,?\s*20\d{2})?)\b`,'gi')
const times=/\b(?:(?:1[0-2]|0?\d)(?:\s*:\s*[0-5]\d)?\s*[ap]\.?m\.?|(?:[01]?\d|2[0-3])\s*:\s*[0-5]\d|noon|midnight)\b/gi
const event='(?:hearing|trial|setting|submission|mediation|deposition|conference|docket\\s+call)'
const anchors=new RegExp(String.raw`\b(?:notice\s+of\s+(?:oral\s+)?${event}|(?:${event}|motion|case|matter)\s+(?:(?:is|are|has\s+been|have\s+been|will\s+be|shall\s+be|remains|is\s+hereby|was)\s+)?(?:set|reset|scheduled|rescheduled|will\s+take\s+place|will\s+be\s+held)|(?:is|are|has\s+been|will\s+be|shall\s+be)\s+(?:set|reset|scheduled|rescheduled)\s+for\s+(?:an?\s+)?${event}|(?:will|shall)\s+be\s+heard|(?:${event})\s+(?:date|will\s+be\s+(?:held|conducted)|is\s+on|on)|date\s+of\s+(?:the\s+)?${event}|(?:ordered|directed|commanded|notified)\s+to\s+appear|(?:shall|must)\s+appear)\b`,'gi')
const metadata=/\b(?:dismissal\s+date|deadline|due\s+(?:date|by)|date\s+of\s+birth|birth|dob|placement\s*(?:date)?|date\s+of\s+(?:current\s+)?placement|signed|executed|filed|filing\s+(?:date|time)|time\s*stamp\s*submitted|timestampsubmitted|submitted|accepted|certificate\s+of\s+(?:service|delivery)|served|sent\s+(?:on|at)|status\s+(?:as\s+of|sent)|received)\b/gi
const historic=/\b(?:(?:hearing|trial|mediation|deposition|conference)\s+(?:was\s+)?(?:held|conducted|occurred)|(?:was|were)\s+(?:held|conducted|heard)|previous(?:ly)?|prior\s+hearing|last\s+hearing)\b/i
const requested=/\b(?:proposed|requested\s+(?:date|setting)|requests?\s+(?:that|a|an|the)|asks?\s+(?:that|the)|if\s+(?:the\s+)?(?:court|motion)|tentative|subject\s+to\s+(?:approval|confirmation))\b/i
const changed=/\b(?:cancel(?:led|ed)|vacated|continued\s+(?:from|to)|no\s+longer\s+set)\b/i
const compact=s=>String(s||'').replace(/\s+/g,' ').trim()
export function settingTextHash(value=''){const text=String(value||'');let h=5381;for(let i=0;i<text.length;i++)h=((h<<5)+h)^text.charCodeAt(i);return `h${(h>>>0).toString(36)}-${text.length}`}
function dateValue(raw){
 const s=raw.toLowerCase();let y,m,d,v
 if((v=s.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/)))[,y,m,d]=v
 else if((v=s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|20\d{2})$/))){[,m,d,y]=v;if(y.length===2)y='20'+y}
 else {
  const name=s.match(/[a-z]+/g)?.find(t=>months.some(n=>n.startsWith(t)) || t==='sept')
  if(!name)return ''
  m=months.findIndex(n=>n.startsWith(name==='sept'?'sep':name))+1
  y=s.match(/\b20\d{2}\b/)?.[0];d=s.match(/\b\d{1,2}(?:st|nd|rd|th)?\b/)?.[0]?.replace(/\D/g,'')
 }
 if(!y||!m||!d)return ''
 const dt=new Date(Date.UTC(+y,+m-1,+d))
 return dt.getUTCFullYear()===+y&&dt.getUTCMonth()===+m-1&&dt.getUTCDate()===+d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:''
}
function timeValue(raw){
 if(/noon/i.test(raw))return '12:00';if(/midnight/i.test(raw))return '00:00'
 const m=raw.match(/(\d{1,2})(?:\s*:\s*(\d{2}))?\s*([ap])?/i);if(!m)return ''
 let hour=+m[1];if(m[3])hour=hour%12+(m[3].toLowerCase()==='p'?12:0)
 return `${String(hour).padStart(2,'0')}:${m[2]||'00'}`
}
function matches(s,re){return [...s.matchAll(new RegExp(re.source,re.flags))].map(m=>({raw:m[0],start:m.index,end:m.index+m[0].length}))}
function distance(a,b){return Math.max(0,a.start-b.end,b.start-a.end)}
function units(text){
 // Preserve PDF/OCR page and attachment boundaries. Ordinary line wraps are not
 // sentence boundaries; initials, numeric dates, and a.m./p.m. are protected.
 return text.replace(/(?:---[^\n]*?(?:PDF|OCR)\s+page\s+\d+\s+---|=====\s*(?:BEGIN|END)[^\n]*=====)/gi,'\n\n')
 .split(/\n\s*\n/).flatMap(page=>compact(page).split(/(?<=[.!?])\s+(?=[A-Z])|(?<=;)\s+/)).map(compact).filter(Boolean)
}
export function scanSettingText(value=''){
 const text=String(value||''),candidates=[],excluded=[],unresolved=[]
 for(const unit of units(text)){
  const ds=matches(unit,dates),ts=matches(unit,times),as=matches(unit,anchors),ms=matches(unit,metadata)
  const cancel=changed.test(unit),past=historic.test(unit)&&!/(?:reset|rescheduled|next\s+hearing)/i.test(unit)
  if(!as.length && !cancel)continue
  let found=false
  for(let i=0;i<ds.length;i++){
   const d=ds[i],left=i?ds[i-1].end:0,right=ds[i+1]?.start??unit.length
   // Find the scheduling phrase in this date's own clause, not near another date.
   const eligible=as.filter(a=>distance(d,a)<=240 && a.end>left && a.start<right && (a.start<d.start || /^(?:on\s*)?$/i.test(unit.slice(0,d.start).trim())))
   const a=eligible.sort((x,y)=>distance(d,x)-distance(d,y))[0]
   const lastMeta=ms.filter(m=>m.end<=d.start&&m.start>=left).at(-1)
   const datedPast=historic.test(unit.slice(left,right)) && !(a && /(?:\bis\b|\bwill\b|\bshall\b|reset|rescheduled)/i.test(a.raw))
   if(datedPast || (!a&&!cancel) || (lastMeta && (!a||a.start>=d.end||lastMeta.start>=a.start) && d.start-lastMeta.end<120)){
    excluded.push({raw:d.raw,reason:datedPast?'Historical event reference.':'Background, deadline, or filing metadata; not a setting.',context:unit.slice(0,700)})
    continue
   }
   const nearbyTimes=ts.filter(t=>t.start>=d.end&&t.end<=right&&t.start-d.end<140&&!ms.some(m=>m.start>=d.end&&m.end<=t.start))
   // A time preceding the date is allowed only when no other date intervenes.
   const before=ts.filter(t=>t.end<=d.start&&t.start>=left&&d.start-t.end<90&&!ms.some(m=>m.start>=t.end&&m.end<=d.start)).at(-1)
   const t=nearbyTimes[0]||before,date=dateValue(d.raw),time=t?timeValue(t.raw):''
   const uncertain=!date||requested.test(unit)||/\bproposed\s+order\b/i.test(text)||cancel
   const kind=(unit.match(/\b(hearing|trial|submission|mediation|deposition|conference|docket\s+call)\b/i)?.[0]||'appearance').toLowerCase()
   candidates.push({id:`setting-${candidates.length}`,kind:'setting',event_kind:kind,raw:d.raw,date,time,strong:!uncertain,
    context:unit.slice(Math.max(0,d.start-220),Math.min(unit.length,d.end+300)),reason:cancel?'Setting change or cancellation: verify the calendar.':uncertain?'Possible or proposed setting; confirm the wording and missing details.':'Explicit scheduling language attached to this date.'})
   found=true
  }
  if(cancel && /\b(?:hearing|trial|setting|mediation|deposition|submission)\b/i.test(unit) && !found)unresolved.push(unit)
  if(!found && as.length && !past && !requested.test(unit) && !/\b(?:after|without|upon)\s+(?:notice\s+and\s+)?hearing\b/i.test(unit))unresolved.push(unit)
 }
 const unique=[...new Map(candidates.map(c=>[`${c.event_kind}|${c.date||c.raw.toLowerCase()}|${c.time}`,c])).values()]
 if(!unique.length && unresolved.length)unique.push({id:'setting-unresolved',kind:'hearing_language',date:'',time:'',raw:'Setting details need review',strong:false,context:unresolved[0].slice(0,700),reason:'Scheduling language was found, but a complete associated date was not established.'})
 const status=unique.some(c=>c.strong)?'high':unique.length?'possible':'clear'
 unique.sort((a,b)=>Number(b.strong)-Number(a.strong))
 const first=unique[0]||null
 return {schema:SETTING_SCAN_SCHEMA,status,level:status==='high'?'critical':status==='possible'?'warning':'clear',
  summary:status==='high'?`An explicit ${first.event_kind||'court'} setting was found${first.date?' for '+first.date:''}${first.time?' at '+first.time:''}. Verify the quoted wording before adding it to the calendar.`:status==='possible'?'Possible setting or setting change: verify the quoted wording and any missing date/time.':'No explicit setting was identified in the readable text. Ordinary dates, filing stamps, and background dates are not hearing alerts.',
  fingerprint:settingTextHash(text),scanned_character_count:text.length,candidates:unique.slice(0,30),primary_candidate:first,
  excluded_file_stamp_candidates:[],excluded_nonsetting_candidates:excluded.slice(0,20),has_hearing_language:unique.length>0,created_at:new Date().toISOString()}
}
const refreshCache=new WeakMap()
export function currentStoredSettingScan(row={}){
 const previous=row.hearing_scan_result||{}
 if(previous.schema===SETTING_SCAN_SCHEMA || !row.pdf_text || !row.hearing_scan_at || ['failed','scanning','not_scanned'].includes(row.hearing_scan_status))return previous
 if(refreshCache.has(row))return refreshCache.get(row)
 const completeness=row.hearing_scan_completeness||previous.completeness
 // Unknown extraction coverage never becomes a successful clean scan.
 if(!['full','partial'].includes(completeness))return previous
 const scan=scanSettingText(row.pdf_text)
 const partial=completeness!=='full'||/\[Middle of long filing omitted/i.test(row.pdf_text)
 const result={...previous,...scan,completeness:partial?'partial':'full'}
 if(partial&&result.status==='clear')Object.assign(result,{status:'possible',level:'warning',summary:'The available filing text is incomplete. Review the entire PDF; a setting could be on a missing page.'})
 refreshCache.set(row,result)
 return result
}
