import test from 'node:test'
import assert from 'node:assert/strict'
import {scanSettingText,currentStoredSettingScan,SETTING_SCAN_SCHEMA} from '../src/mioSettingScan.js'
const sample='The court hearing is scheduled for September 24,2026 at 9:00 am . THE DISMISSAL DATE FOR THIS SUIT IS DECEMBER 29, 2026. SUBJECT CHILD Date of Birth: 06/27/2025 Initial Placement Date: 12/03/2025. Status as of 9/4/2026 4:09 PM. TimestampSubmitted 9/4/2026 3:22:47 PM.'
test('report has one September setting, never borrows hearing time for December dismissal',()=>{
 const s=scanSettingText(sample);assert.equal(s.status,'high');assert.equal(s.candidates.length,1);assert.equal(s.primary_candidate.date,'2026-09-24');assert.equal(s.primary_candidate.time,'09:00')
})
for(const text of [
 'Order on Substitution of Counsel. SIGNED September 4, 2026 at 1:08 PM. Certificate of service on September 4, 2026.',
 'Motion for a hearing. Petitioner requests a hearing. Filed September 4, 2026 at 9:00 AM.',
 'After notice and hearing the Court may grant relief. Date of Birth: 01/02/2020.',
 'The hearing was held on June 4, 2025 at 9:00 am.',
 'TimestampSubmitted 9/4/2026 3:22:47 PM. Status SENT. Dismissal date December 29, 2026.',
 'Please contact the clerk for a hearing. Zoom meeting link is provided. Served 9/4/2026.',
])test('ordinary dates or generic/historical hearing language stay quiet: '+text.slice(0,45),()=>assert.equal(scanSettingText(text).status,'clear'))
for(const [text,date,time] of [
 ['NOTICE OF HEARING. The motion will be heard on September 10, 2026 at 9:00 a.m.','2026-09-10','09:00'],
 ['The trial is set for 10/12/2026 at 1:30 PM.','2026-10-12','13:30'],
 ['The motion is set for submission on October 15, 2026.','2026-10-15',''],
 ['Deposition will be held on the 21st day of September, 2026 at 10:00 AM.','2026-09-21','10:00'],
 ['You are ordered to appear on 2026-10-02 at 08:30.','2026-10-02','08:30'],
 ['Hearing date: September 24, 2026. Filing date: September 4, 2026 at 9:00 AM.','2026-09-24',''],
 ['Electronically filed September 4, 2026 at 2:00 PM. NOTICE OF HEARING\nThe hearing is scheduled for September 10, 2026 at 9:00 AM.','2026-09-10','09:00']
])test('explicit scheduling: '+text.slice(0,50),()=>{const s=scanSettingText(text);assert.equal(s.status,'high');assert.equal(s.candidates.length,1);assert.equal(s.primary_candidate.date,date);assert.equal(s.primary_candidate.time,time)})
test('same sentence separates a setting, dismissal, and birth dates',()=>{
 const s=scanSettingText('Hearing is set for September 24,2026 at 9:00 am THE DISMISSAL DATE is December 29,2026 date of birth 06/27/2025')
 assert.equal(s.candidates.length,1);assert.equal(s.primary_candidate.date,'2026-09-24')
})
test('multiple events and OCR duplicates are not merged or repeated',()=>{
 const s=scanSettingText('Trial is set for 10/12/2026 at 9 AM. Hearing is set for 9/24/2026 at 1 PM.\n--- Notice - OCR page 1 ---\nTrial is set for 10/12/2026 at 9 AM.')
 assert.equal(s.candidates.length,2)
})
test('missing year and proposed setting remain uncertain; no invented year or time',()=>{
 const s=scanSettingText('The hearing is set for September 24 at 9 AM.');assert.equal(s.status,'possible');assert.equal(s.primary_candidate.date,'')
 const proposed=scanSettingText('Proposed order: hearing is set for October 1, 2026 at 9 AM.');assert.equal(proposed.status,'possible')
})
test('cancellation is reviewable rather than silently dropped',()=>assert.equal(scanSettingText('The hearing on September 24,2026 is cancelled.').status,'possible'))
test('legacy alerts are reclassified from stored text without re-downloading files',()=>{
 const row={pdf_text:sample,hearing_scan_at:'old',hearing_scan_status:'high',hearing_scan_completeness:'full',hearing_scan_result:{schema:'old',status:'high'},hearing_reviewed_at:'preserve-me'}
 const s=currentStoredSettingScan(row);assert.equal(s.schema,SETTING_SCAN_SCHEMA);assert.equal(s.candidates.length,1);assert.equal(row.hearing_scan_result.schema,'old');assert.equal(row.hearing_reviewed_at,'preserve-me')
})
test('failed, partial, unknown and truncated extraction never silently become clean',()=>{
 const base={pdf_text:'SIGNED on September 4, 2026.',hearing_scan_at:'old',hearing_scan_status:'high',hearing_scan_result:{schema:'old',status:'failed'}}
 assert.equal(currentStoredSettingScan({...base,hearing_scan_status:'failed',hearing_scan_completeness:'full'}).status,'failed')
 assert.equal(currentStoredSettingScan({...base,hearing_scan_completeness:'partial'}).status,'possible')
 assert.equal(currentStoredSettingScan({...base}).status,'failed')
 assert.equal(currentStoredSettingScan({...base,pdf_text:base.pdf_text+' [Middle of long filing omitted from local storage after hearing scan.]',hearing_scan_completeness:'full'}).status,'possible')
})

test('a file stamp followed immediately by notice language never becomes the hearing date',()=>{
 const s=scanSettingText('Electronically filed September 4,2026 4:09 PM NOTICE OF HEARING The hearing is set for September 24,2026 at 9:00 AM')
 assert.equal(s.candidates.length,1);assert.equal(s.primary_candidate.date,'2026-09-24');assert.equal(s.primary_candidate.time,'09:00')
})
test('notice of setting without readable details requires review',()=>assert.equal(scanSettingText('NOTICE OF SETTING. See the attached notice.').status,'possible'))

test('past and upcoming events in the same sentence stay associated with their own dates',()=>{
 const s=scanSettingText('The hearing was held on September 1,2026 and the hearing is set for September 24,2026 at 9 AM')
 assert.equal(s.candidates.length,1);assert.equal(s.primary_candidate.date,'2026-09-24')
 assert.equal(scanSettingText('The hearing on September 1,2026 was held at 9 AM.').status,'clear')
})

test('a notice with only a readable filing stamp remains incomplete rather than clean',()=>assert.equal(scanSettingText('FILED September 4,2026 at 9 AM NOTICE OF HEARING').status,'possible'))
test('cancellation without a date still asks for review',()=>assert.equal(scanSettingText('The previously scheduled hearing is cancelled.').status,'possible'))
