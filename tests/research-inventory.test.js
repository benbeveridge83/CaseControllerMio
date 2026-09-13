import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import {parseResearchInventory} from '../lib/research/inventory.js'
const sheet=a=>XLSX.utils.aoa_to_sheet(a)

test('inventory parser preserves direction, zero metrics, and verified study detail',()=>{
 const wb=XLSX.utils.book_new()
 XLSX.utils.book_append_sheet(wb,sheet([['Work ID','Authors','Year','Title','Source Type','Admission Route','Direct Child Outcome?','Included in Nielsen 2018?','Preliminary Direction','Country','Sample N','Shared/Equal Definition','Design','DOI','Canonical URL','Access Status','Full Text / OA URL'],['W1','A',2025,'Good','Empirical study','x','Yes','No','Favors shared','US',100,'JPC >=35%','Cross-sectional','10/x','https://doi.org/10/x','OA','https://oa/1'],['W2','B',2024,'Concern','Empirical study','x','Yes','No','Disfavors joint-custody-law exposure','US',200,'50/50','Natural experiment','10/y','https://doi.org/10/y','Paywalled','']]),'Master Works')
 XLSX.utils.book_append_sheet(wb,sheet([['Review Work ID','Review','Member Work ID','Membership Status','Notes'],['W1','R','W2','Included','n']]),'Review Memberships')
 XLSX.utils.book_append_sheet(wb,sheet([['Work ID','Metric','Value','Source','Retrieved','Notes'],['W1','citation_count',0,'OpenAlex','2026-09-12','n']]),'Metric Snapshots')
 XLSX.utils.book_append_sheet(wb,sheet([['Work ID','Title','Access Status','Canonical URL','Full Text / OA URL','Mio Copy Decision','License/Permission Notes'],['W1','Good','OA','https://doi.org/10/x','https://oa/1','Not yet reviewed','Do not mirror']]),'Access Queue')
 XLSX.utils.book_append_sheet(wb,sheet([['Study ID','Work ID','Sample/Analysis Label','Country','Sample N','Child Ages','Exact Parenting-Time Definition','Comparator','Outcome Domain','Outcome Measure','Longitudinal?','Pre-separation Controls?','Conflict Controls?','SES Controls?','Effect Size','Result Direction','Causal Claim Strength','Key Limitation','Extraction Status'],['S1','W1','Analysis','US',100,'8-12','50/50 alternating weeks','sole','mental health','scale','Yes','No','Yes','Yes','d=.2','Favors shared','moderate','selection','Verified']]),'Study Analysis Template')
 const p=parseResearchInventory(wb)
 assert.equal(p.publications.length,2)
 assert.equal(p.publications[1].finding_direction,'disfavors_shared')
 assert.equal(p.metrics[0].metric_value,0)
 assert.equal(p.studies[0].exact_or_near_50_50,true)
 assert.equal(p.studies[0].causal_claim_strength,'moderate')
})
