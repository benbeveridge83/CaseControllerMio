// Isolated integration, after V300. Do not change drafting templates or auth.
function once(code,from,to){if(code.split(from).length!==2)throw new Error('V301 integration anchor changed: '+from.slice(0,100));return code.replace(from,()=>to)}
export default function mioV301StartupSettings(){return{name:'mio-v301-startup-settings',enforce:'pre',transform(source,id){
 if(!id.split('?')[0].replaceAll('\\','/').endsWith('/src/App.jsx'))return null
 let code="import { scanSettingText as mioScanSettingsV301, currentStoredSettingScan as mioStoredSettingsV301 } from './mioSettingScan.js'\n"+source
 code=once(code,"const MIO_APP_VERSION = 'Mio V300 (verified template fields)'","const MIO_APP_VERSION = 'Mio V301 (fast tabs / precise settings)'")
 const schema=code.match(/const SERVICE_HEARING_SCAN_SCHEMA = '[^']+'/g)
 if(schema?.length!==1)throw new Error('V301 scan schema moved')
 code=once(code,schema[0],"const SERVICE_HEARING_SCAN_SCHEMA = 'service-hearing-scan-v301'")
 const start=code.indexOf("function scanServiceFilingTextForHearing(value = '') {"),end=code.indexOf('\nfunction serviceHearingCandidateLabel(',start)
 if(start<0||end<start)throw new Error('V301 scanner moved')
 code=code.slice(0,start)+"function scanServiceFilingTextForHearing(value = '') { return mioScanSettingsV301(value) }\n"+code.slice(end)
 code=once(code,"    const scan = row.hearing_scan_result && typeof row.hearing_scan_result === 'object' ? row.hearing_scan_result : {}","    const scan = mioStoredSettingsV301(row)")
 code=once(code,"completeness: row.hearing_scan_completeness || scan.completeness || ''","completeness: scan.completeness || row.hearing_scan_completeness || ''")
 code=once(code,"const background = needsAttention ? '#b91c1c' : (isClear ? '#ecfdf5' : '#fff1f2')","const background = needsAttention ? (alertState.status === 'high' ? '#b91c1c' : '#92400e') : (isClear ? '#ecfdf5' : '#fff1f2')")
 code=once(code,"const border = needsAttention ? '4px solid #7f1d1d' : (isClear ? '2px solid #22c55e' : '2px solid #ef4444')","const border = needsAttention ? (alertState.status === 'high' ? '3px solid #7f1d1d' : '2px solid #b45309') : (isClear ? '2px solid #22c55e' : '2px solid #ef4444')")
 code=code.replaceAll('LIKELY HEARING / SETTING NOTICE','EXPLICIT SETTING - VERIFY DATE').replaceAll('POSSIBLE HEARING / CALENDAR DATE','POSSIBLE SETTING / DETAILS NEED REVIEW')
 code=code.replaceAll('Detected non-file-stamp dates/times and hearing language:','Settings supported by the filing wording (not ordinary dates):')
 code=code.replaceAll('Mio is scanning the complete readable filing for hearing, trial, setting, courtroom, Zoom, and non-file-stamp date/time references.','Mio is checking the readable filing for actual scheduled events and setting changes, not ordinary dates.')
 code=code.replaceAll('Hearing safety scan complete: no non-file-stamp date/time or setting language was found.','Setting scan complete: no explicit setting was identified in the readable text.')
 return{code,map:null}
}}}
