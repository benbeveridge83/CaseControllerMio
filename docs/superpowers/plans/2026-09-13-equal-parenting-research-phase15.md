# Equal Parenting Research Phase 1.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current 90-publication bibliography into a substantive, sortable research database with accurate 50/50 classification, citation/review importance signals, auditable scores, clickable study links, structured study analyses, and a verified enrichment queue ready for Phase 2 public publishing.

**Architecture:** Keep Supabase as the source of truth and Mio as the authenticated editorial UI. Add publication-level summary/cache fields for fast sorting while preserving `research_metrics` and `research_review_memberships` as historical/relational sources. External scholarly enrichment runs outside React in focused provider modules and a batch script; scoring remains pure/deterministic; substantive analysis is imported from curated, source-backed JSON and remains unverified until editorial review.

**Tech Stack:** React 19, Vite 8, Supabase/PostgreSQL, Node built-in test runner, browser tests with the existing Vite + Playwright pattern, OpenAlex REST API, optional Semantic Scholar Graph API, existing `xlsx` dependency where needed.

**Spec:** `docs/superpowers/specs/2026-09-13-equal-parenting-research-phase15-design.md`

## Global Constraints

- Finding direction must never affect Evidence Strength, Impact, Equal-Parenting Relevance, or Historical/Field Importance.
- `joint physical custody`, `shared residence`, `alternating residence`, and `50/50` are never treated as synonyms without coded evidence.
- Missing data remains `null`/`Unknown`; it is never silently converted to zero or `No`.
- A publication with no coded study analyses must display 50/50 as `Unknown`.
- External citation counts from different providers are never summed together.
- OpenAlex is the preferred `Cited By` provider when a confident match exists; fallback providers remain visibly identified.
- Automated enrichment may create metadata, metrics, source links, draft analyses, and score proposals, but it must never auto-publish a publication or overwrite verified substantive conclusions.
- Full-text-derived claims must record provenance; abstract-only extraction cannot be represented as full-text verified.
- Only verified/reviewed analysis may drive definitive public 50/50 classification or strong public causal claims.
- Public/Mio-hosted copies are never marked public unless redistribution permission is affirmatively recorded.
- Existing 90 records remain draft/needs-review until the stronger publication gate is satisfied.
- Phase 2 public website work remains out of scope until a meaningful enriched subset is ready.

---

## File Structure

Create or modify these focused units:

- `supabase/migrations/20260913_equal_parenting_research_phase15.sql` — publication summary fields and sanitized public-cache columns.
- `lib/research/model.js` — tri-state 50/50 helper, source-link priority helper, publish validation updates.
- `lib/research/scoring.js` — pure Evidence, Relevance, Impact, Historical Importance functions.
- `lib/research/repository.js` — richer list query, computed review count/metrics, summary persistence helpers.
- `lib/research/enrichment/matching.js` — DOI/title-author-year matching confidence.
- `lib/research/enrichment/openalex.js` — OpenAlex fetch/parse adapter.
- `lib/research/enrichment/semanticScholar.js` — optional Semantic Scholar fetch/parse adapter.
- `lib/research/enrichment/orchestrator.js` — per-publication enrichment pipeline.
- `scripts/enrich-equal-parenting-research.mjs` — batch CLI over the 90 records.
- `scripts/import-research-analysis.mjs` — curated analysis JSON importer.
- `data/research/anchor-analysis-v1.json` — source-backed first enrichment set for anchor/caution literature.
- `src/MioResearchWorkspace.jsx` — high-information list columns/sorting/link actions.
- `src/MioResearchEditor.jsx` — completion checklist, provenance, analysis status, stronger publish gate.
- `src/mioResearch.css` — responsive enriched table/detail styling.
- `tests/research-phase15-migration.test.js`
- `tests/research-model.test.js`
- `tests/research-scoring.test.js`
- `tests/research-enrichment-matching.test.js`
- `tests/research-enrichment-openalex.test.js`
- `tests/research-enrichment-orchestrator.test.js`
- `tests/research-analysis-import.test.js`
- `tests/research-workspace-browser.mjs`
- `tests/research-editor-browser.mjs` or extend the existing browser fixture if that keeps one clear workflow.

---

### Task 1: Add publication summary fields and extend the sanitized public cache

**Files:**
- Create: `supabase/migrations/20260913_equal_parenting_research_phase15.sql`
- Create: `tests/research-phase15-migration.test.js`

**Interfaces:**
- Consumes existing tables: `research_publications`, `research_metrics`, `research_review_memberships`, `research_public_catalog`.
- Produces nullable/current summary columns used by Mio sorting and later Phase 2 pages.

- [ ] **Step 1: Write the failing migration contract test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const path=new URL('../supabase/migrations/20260913_equal_parenting_research_phase15.sql',import.meta.url)
const sql=()=>fs.readFileSync(path,'utf8')

test('phase 1.5 adds sortable bibliometric and completion summaries',()=>{
  const s=sql()
  for(const c of [
    'citation_count_current','citation_count_provider','citation_count_captured_at',
    'citations_per_year','fwci_current','influential_citation_count_current',
    'major_review_count','impact_data_completeness','analysis_completion_status','analysis_verified_at'
  ]) assert.match(s,new RegExp(`add column if not exists ${c}`,'i'))
})

test('public catalog remains sanitized and gains safe importance fields',()=>{
  const s=sql()
  assert.match(s,/citation_count_current/i)
  assert.match(s,/citations_per_year/i)
  assert.match(s,/major_review_count/i)
  assert.match(s,/impact_data_completeness/i)
  assert.doesNotMatch(s,/internal_notes[^\n]*research_public_catalog/i)
})
```

- [ ] **Step 2: Run and confirm RED**

```bash
node --test tests/research-phase15-migration.test.js
```

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Add the migration**

The migration must add exactly these fields to `research_publications`:

```sql
alter table public.research_publications
  add column if not exists citation_count_current integer check(citation_count_current is null or citation_count_current >= 0),
  add column if not exists citation_count_provider text,
  add column if not exists citation_count_captured_at timestamptz,
  add column if not exists citations_per_year numeric,
  add column if not exists fwci_current numeric,
  add column if not exists influential_citation_count_current integer check(influential_citation_count_current is null or influential_citation_count_current >= 0),
  add column if not exists major_review_count integer not null default 0 check(major_review_count >= 0),
  add column if not exists impact_data_completeness integer check(impact_data_completeness is null or impact_data_completeness between 0 and 100),
  add column if not exists analysis_completion_status text not null default 'needs_enrichment'
    check(analysis_completion_status in ('needs_enrichment','ready_for_editorial_review','verified')),
  add column if not exists analysis_verified_at timestamptz;
```

Add indexes:

```sql
create index if not exists research_publications_citations_idx
  on public.research_publications(citation_count_current desc nulls last);
create index if not exists research_publications_impact_idx
  on public.research_publications(impact_score desc nulls last);
create index if not exists research_publications_analysis_status_idx
  on public.research_publications(analysis_completion_status, editorial_status);
```

Extend `research_public_catalog` with the safe summary fields above plus the four existing score fields; do not add `score_notes`, `inventory_raw`, `internal_notes`, `created_by`, or `updated_by`.

Update `research_refresh_public_catalog()` so each published row copies those safe fields into the cache.

- [ ] **Step 4: Run migration tests**

```bash
node --test tests/research-phase15-migration.test.js tests/research-migration.test.js tests/research-public-security.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260913_equal_parenting_research_phase15.sql tests/research-phase15-migration.test.js
git commit -m "feat: add research enrichment summary fields"
```

---

### Task 2: Fix tri-state 50/50 classification and source-link priority in the pure model

**Files:**
- Modify: `lib/research/model.js`
- Modify: `tests/research-model.test.js`

**Interfaces:**
- Produces `classifyExact50(studies) -> 'yes'|'no'|'unknown'`.
- Produces `preferredResearchLink(accessLinks) -> accessLink|null`.
- Produces `calculateCitationsPerYear(count,year,currentYear) -> number|null`.

- [ ] **Step 1: Add failing tests**

```js
import {classifyExact50,preferredResearchLink,calculateCitationsPerYear} from '../lib/research/model.js'

test('50/50 is unknown when no analyses exist',()=>{
  assert.equal(classifyExact50([]),'unknown')
})

test('50/50 is unknown when analyses exist but classification is uncoded',()=>{
  assert.equal(classifyExact50([{exact_or_near_50_50:null}]),'unknown')
})

test('50/50 is no only when coded analyses exist and all are false',()=>{
  assert.equal(classifyExact50([{exact_or_near_50_50:false}]),'no')
})

test('50/50 is yes when any reviewed analysis is true',()=>{
  assert.equal(classifyExact50([{exact_or_near_50_50:false},{exact_or_near_50_50:true}]),'yes')
})

test('source priority prefers lawful hosted copy then OA then canonical DOI',()=>{
  const links=[
    {link_type:'canonical_doi',url:'https://doi.org/x',is_public:true},
    {link_type:'open_access_pdf',url:'https://example.org/x.pdf',is_public:true},
    {link_type:'mio_public_copy',url:'https://site/x.pdf',is_public:true,redistribution_permitted:true}
  ]
  assert.equal(preferredResearchLink(links).link_type,'mio_public_copy')
})

test('citations per year uses denominator one for current-year works',()=>{
  assert.equal(calculateCitationsPerYear(12,2026,2026),12)
  assert.equal(calculateCitationsPerYear(null,2020,2026),null)
})
```

- [ ] **Step 2: Run and confirm RED**

```bash
node --test tests/research-model.test.js
```

Expected: FAIL because helpers are undefined.

- [ ] **Step 3: Implement the helpers**

```js
export function classifyExact50(studies=[]){
  if(!studies.length)return 'unknown'
  const coded=studies.filter(s=>s?.exact_or_near_50_50===true||s?.exact_or_near_50_50===false)
  if(!coded.length)return 'unknown'
  return coded.some(s=>s.exact_or_near_50_50===true)?'yes':'no'
}

const LINK_PRIORITY=['mio_public_copy','open_access_pdf','open_access_html','repository_manuscript','publisher','purchase','canonical_doi','abstract']
export function preferredResearchLink(links=[]){
  const usable=links.filter(x=>x?.url&&x.is_public!==false&&(x.link_type!=='mio_public_copy'||x.redistribution_permitted===true))
  return usable.sort((a,b)=>LINK_PRIORITY.indexOf(a.link_type)-LINK_PRIORITY.indexOf(b.link_type))[0]||null
}

export function calculateCitationsPerYear(count,year,currentYear=new Date().getUTCFullYear()){
  if(count===null||count===undefined||count===''||!Number.isFinite(Number(count)))return null
  const y=Number(year)
  if(!Number.isFinite(y))return null
  return Number(count)/Math.max(1,currentYear-y+1)
}
```

Normalize missing priority types by treating an index of `-1` as lower priority than all named types.

- [ ] **Step 4: Run model tests**

```bash
node --test tests/research-model.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/research/model.js tests/research-model.test.js
git commit -m "fix: make research classification states honest"
```

---

### Task 3: Enrich the repository list query and rebuild the Mio main table

**Files:**
- Modify: `lib/research/repository.js`
- Modify: `src/MioResearchWorkspace.jsx`
- Modify: `src/mioResearch.css`
- Modify: `tests/research-repository.test.js`
- Modify: `tests/research-workspace-browser-fixture.jsx`
- Modify: `tests/research-workspace-browser.mjs`

**Interfaces:**
- `listResearchPublications(client)` must return nested `metrics`, access links, studies, plus publication summary fields.
- UI consumes `classifyExact50`, `preferredResearchLink`.

- [ ] **Step 1: Add failing repository assertions**

Assert `LIST_COLUMNS` includes:

```js
for(const field of [
  'citation_count_current','citations_per_year','major_review_count',
  'impact_data_completeness','analysis_completion_status'
]) assert.match(LIST_COLUMNS,new RegExp(field))
assert.match(LIST_COLUMNS,/metrics:research_metrics/)
```

- [ ] **Step 2: Add failing browser assertions for the high-information table**

Synthetic rows must include one `yes`, one `no`, and one `unknown` 50/50 state plus citation values and source links.

```js
await page.getByRole('heading',{name:'Equal Parenting Research'}).waitFor()
for(const heading of ['Cited By','Citations / Year','Major Reviews','Evidence','Impact','Study'])
  await page.getByRole('columnheader',{name:heading}).waitFor()
assert.match(await page.locator('tbody').innerText(),/Unknown/)
assert.match(await page.locator('tbody').innerText(),/Read study/)
await page.getByRole('button',{name:'Sort by Cited By'}).click()
assert.match(await page.locator('tbody tr').first().innerText(),/321/)
```

- [ ] **Step 3: Run and confirm RED**

```bash
node --test tests/research-repository.test.js
node tests/research-workspace-browser.mjs
```

- [ ] **Step 4: Extend repository columns**

Add publication summary fields to `PUBLICATION_COLUMNS` and add:

```js
metrics:research_metrics(id,provider,metric_type,metric_value,source_url,captured_at)
```

Keep `review_memberships` out of the list payload because `major_review_count` is the fast summary; detail/editor continues to load actual memberships separately.

- [ ] **Step 5: Replace the main table columns**

Use this exact visible order:

```text
Study | Year | Finding | Parenting Time / 50/50 | Sample | Cited By | Citations / Year | Major Reviews | Evidence | Impact | Study | Status
```

For `Parenting Time / 50/50`, show the first/most relevant coded `parenting_time_definition` and a badge `Yes`, `No`, or `Unknown` from `classifyExact50()`.

For `Sample`, show the largest known child-analysis sample if multiple analyses exist; otherwise `Unknown`.

For `Cited By`, show `citation_count_current` with provider/capture date in a `title` attribute; `0` renders as `0`, missing renders `Unknown`.

For `Impact`, render score and completeness when present:

```jsx
{r.impact_score==null?'Unknown':`${r.impact_score}${r.impact_data_completeness!=null?` (${r.impact_data_completeness}% data)`:''}`}
```

`Read study` must be a real `<a target="_blank" rel="noreferrer">` using `preferredResearchLink()`.

Add sort buttons for Cited By, Citations/Year, Major Reviews, Evidence, Impact, Relevance, Historical Importance, Newest, Title.

- [ ] **Step 6: Update responsive CSS**

At <= 700px, preserve the title/findings block and allow table-only horizontal scroll. Do not collapse citation/importance numbers into unlabeled icon-only content.

- [ ] **Step 7: Run repository/browser regression**

```bash
node --test tests/research-model.test.js tests/research-repository.test.js
node tests/research-workspace-browser.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/research/repository.js src/MioResearchWorkspace.jsx src/mioResearch.css tests/research-repository.test.js tests/research-workspace-browser-fixture.jsx tests/research-workspace-browser.mjs
git commit -m "feat: show research content and importance in Mio"
```

---

### Task 4: Implement pure, auditable scoring functions

**Files:**
- Create: `lib/research/scoring.js`
- Create: `tests/research-scoring.test.js`

**Interfaces:**
- `calculateEvidenceStrength(input) -> {score:number|null,completeness:number,components:object}`.
- `calculateEqualParentingRelevance(input) -> {score:number|null,components:object}`.
- `calculateImpactScore(input) -> {score:number|null,completeness:number,components:object}`.
- `calculateHistoricalImportance(input) -> {score:number|null,components:object}`.

- [ ] **Step 1: Write failing score tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateEvidenceStrength,calculateEqualParentingRelevance,
  calculateImpactScore,calculateHistoricalImportance
} from '../lib/research/scoring.js'

test('finding direction never changes scores',()=>{
  const base={design:'longitudinal',sample_size:5000,pre_separation_controls:true,conflict_controls:true,ses_controls:true,measurement_quality:'good'}
  const a=calculateEvidenceStrength({...base,finding_direction:'favors_shared'})
  const b=calculateEvidenceStrength({...base,finding_direction:'disfavors_shared'})
  assert.deepEqual(a,b)
})

test('unknown evidence components are omitted, not scored zero',()=>{
  const r=calculateEvidenceStrength({design:'cross_sectional_adjusted'})
  assert.ok(r.score>0)
  assert.ok(r.completeness<100)
})

test('exact 50/50 is more relevant than broad JPC with unknown threshold',()=>{
  assert.ok(
    calculateEqualParentingRelevance({exact_or_near_50_50:true,direct_child_outcome:true}).score >
    calculateEqualParentingRelevance({parenting_time_definition:'JPC',direct_child_outcome:true}).score
  )
})

test('impact ignores missing components and reports completeness',()=>{
  const r=calculateImpactScore({citation_percentile:90,citations_per_year_percentile:80})
  assert.ok(r.score>=0&&r.score<=100)
  assert.ok(r.completeness<100)
})
```

- [ ] **Step 2: Run and confirm RED**

```bash
node --test tests/research-scoring.test.js
```

- [ ] **Step 3: Implement Evidence Strength**

Use fixed maximum weights:

```js
const EVIDENCE_WEIGHTS={design:40,sample:15,controls:20,measurement:10,bias:10,transparency:5}
```

Design points:

```js
const DESIGN_POINTS={
  strong_quasi_experimental:40,
  longitudinal_preseparation:32,
  longitudinal:27,
  cross_sectional_adjusted:20,
  descriptive:10
}
```

Unknown categories are omitted from numerator and denominator. `completeness` is the percentage of total possible weight represented by known categories. Normalize the known-points result to 0–100.

- [ ] **Step 4: Implement Relevance**

Return a score within these bands:

```js
if(input.exact_or_near_50_50===true) base=97
else if(input.shared_time_min_percent>=40) base=90
else if(input.shared_time_min_percent>=30) base=75
else if(/JPC|joint physical|shared residence/i.test(input.parenting_time_definition||'')) base=55
else if(/overnight|attachment|infant|toddler/i.test(input.parenting_time_definition||input.topic_text||'')) base=35
else if(input.source_type==='policy_legal') base=18
else base=8
```

Allow `direct_child_outcome===true` to add at most 3 points without crossing 100. Never inspect finding direction.

- [ ] **Step 5: Implement Impact**

Weights:

```js
const IMPACT_WEIGHTS={
  citation_percentile:35,
  citations_per_year_percentile:20,
  fwci_percentile:15,
  influential_citation_percentile:10,
  review_inclusion_percentile:15,
  policy_influence:5
}
```

For missing components, normalize over available weights. `policy_influence` is already 0–100 when known. Return null if no components are known.

- [ ] **Step 6: Implement Historical Importance**

Use documented inputs only:

```js
const components={
  anchor_designation: input.anchor_designation===true?30:null,
  review_inclusion: Number.isFinite(input.review_inclusion_percentile)?input.review_inclusion_percentile*0.25:null,
  durable_citation: Number.isFinite(input.durable_citation_percentile)?input.durable_citation_percentile*0.20:null,
  methodological_debate: input.methodological_debate===true?15:null,
  policy_influence: Number.isFinite(input.policy_influence)?input.policy_influence*0.10:null
}
```

Normalize only known components; require an explanation string for any manually asserted boolean signal.

- [ ] **Step 7: Run tests**

```bash
node --test tests/research-scoring.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/research/scoring.js tests/research-scoring.test.js
git commit -m "feat: add auditable research scoring"
```

---

### Task 5: Build deterministic scholarly matching and OpenAlex/Semantic Scholar adapters

**Files:**
- Create: `lib/research/enrichment/matching.js`
- Create: `lib/research/enrichment/openalex.js`
- Create: `lib/research/enrichment/semanticScholar.js`
- Create: `tests/research-enrichment-matching.test.js`
- Create: `tests/research-enrichment-openalex.test.js`

**Interfaces:**
- `matchConfidence(publication,candidate) -> {accepted:boolean,score:number,reasons:string[]}`.
- `fetchOpenAlexWork(fetchFn,publication) -> normalizedWork|null`.
- `fetchSemanticScholarWork(fetchFn,publication,{apiKey}) -> normalizedWork|null`.

- [ ] **Step 1: Write failing matching tests**

```js
test('matching accepts exact DOI regardless of title punctuation',()=>{
  const r=matchConfidence({doi:'10.1234/ABC'},{doi:'https://doi.org/10.1234/abc',title:'Different punctuation'})
  assert.equal(r.accepted,true)
  assert.equal(r.score,100)
})

test('title fallback requires year and author support',()=>{
  assert.equal(matchConfidence(
    {title:'Fifty moves a year',publication_year:2015,authors_text:'Malin Bergström'},
    {title:'Fifty moves a year',publication_year:2015,authors:['Malin Bergström']}
  ).accepted,true)
  assert.equal(matchConfidence(
    {title:'Fifty moves a year',publication_year:2015,authors_text:'Malin Bergström'},
    {title:'Fifty moves a year',publication_year:2021,authors:['Other']}
  ).accepted,false)
})
```

- [ ] **Step 2: Write failing OpenAlex parsing test with mocked fetch**

Mock response:

```js
const payload={
  id:'https://openalex.org/W123',doi:'https://doi.org/10.1000/test',title:'Test',publication_year:2015,
  cited_by_count:321,fwci:4.2,
  primary_location:{landing_page_url:'https://publisher.example/test',pdf_url:null,is_oa:false},
  open_access:{is_oa:false,oa_status:'closed'},
  authorships:[{author:{display_name:'Jane Doe'}}]
}
```

Assert normalized output includes `provider:'OpenAlex'`, `citation_count:321`, `fwci:4.2`, canonical URL, OA status, OpenAlex ID.

- [ ] **Step 3: Run and confirm RED**

```bash
node --test tests/research-enrichment-matching.test.js tests/research-enrichment-openalex.test.js
```

- [ ] **Step 4: Implement DOI normalization and fallback match confidence**

Exact normalized DOI = 100 and accepted.

Without DOI, score:

- normalized exact title: +60;
- title token similarity >= 0.92: +50;
- year exact: +20;
- year ±1: +10;
- first author normalized exact: +20.

Accept only score >= 85. Return reasons for every awarded component.

- [ ] **Step 5: Implement OpenAlex adapter**

For DOI:

```js
const url=`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(normalizeDoi(publication.doi))}`
```

If DOI lookup is 404 or DOI missing, search title:

```js
const url=`https://api.openalex.org/works?search=${encodeURIComponent(publication.title)}&per-page=5`
```

Pass all search candidates through `matchConfidence()`; accept only the highest accepted match. Never accept a low-confidence match silently.

Normalize only required fields; keep raw provider response out of production tables.

- [ ] **Step 6: Implement optional Semantic Scholar adapter**

DOI request:

```text
https://api.semanticscholar.org/graph/v1/paper/DOI:<doi>?fields=title,year,authors,citationCount,influentialCitationCount,externalIds,url,openAccessPdf
```

Send `x-api-key` only when an API key is provided. A 404/429/network error returns a structured provider error to the orchestrator rather than throwing the whole batch.

- [ ] **Step 7: Run adapter tests**

```bash
node --test tests/research-enrichment-matching.test.js tests/research-enrichment-openalex.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/research/enrichment tests/research-enrichment-matching.test.js tests/research-enrichment-openalex.test.js
git commit -m "feat: add scholarly research matching"
```

---

### Task 6: Build the idempotent bibliometric enrichment orchestrator and batch CLI

**Files:**
- Create: `lib/research/enrichment/orchestrator.js`
- Create: `scripts/enrich-equal-parenting-research.mjs`
- Create: `tests/research-enrichment-orchestrator.test.js`
- Modify: `lib/research/repository.js`

**Interfaces:**
- `enrichPublication({client,publication,fetchFn,currentYear,semanticScholarApiKey}) -> result`.
- `refreshPublicationImportance(client,publicationId) -> publication`.

- [ ] **Step 1: Write failing orchestrator tests**

Cover:

```js
test('one provider failure does not abort successful OpenAlex enrichment',async()=>{/* mocked OpenAlex 200, Semantic Scholar 429 */})
test('unmatched candidate is returned as needs_review and does not write metrics',async()=>{/* low confidence */})
test('zero citations creates a real metric value zero',async()=>{/* cited_by_count:0 */})
test('review count is deduplicated by review publication id',async()=>{/* duplicate membership fixtures */})
```

- [ ] **Step 2: Run and confirm RED**

```bash
node --test tests/research-enrichment-orchestrator.test.js
```

- [ ] **Step 3: Add repository write helpers**

Implement:

```js
export async function appendResearchMetric(client,row){ /* insert exact snapshot */ }
export async function upsertResearchAccessLink(client,row){ /* upsert publication_id,link_type,url */ }
export async function updateResearchSummary(client,id,patch){ /* whitelist summary fields only */ }
export async function countVerifiedMajorReviews(client,id){ /* distinct review_publication_id */ }
```

`updateResearchSummary` must reject arbitrary fields; allowed keys are the Phase 1.5 summary columns plus the four score columns and `score_notes`.

- [ ] **Step 4: Implement `enrichPublication()`**

Per publication:

1. fetch OpenAlex;
2. if match accepted, append `citation_count`, `fwci`, and OA/access metadata snapshots as applicable;
3. optionally fetch Semantic Scholar and append `influential_citations` snapshot;
4. calculate `citations_per_year`;
5. calculate distinct review count;
6. compute percentile inputs against the current database cohort;
7. call `calculateImpactScore()`;
8. update current summary fields;
9. add lawful OA access URL only when provider metadata identifies one;
10. return `{status:'enriched'|'needs_review'|'partial',warnings:[]}`.

Do not touch findings, limitations, supports/not-establish, evidence score, relevance score, historical score, or editorial status in this automated step.

- [ ] **Step 5: Implement CLI**

Usage:

```bash
node scripts/enrich-equal-parenting-research.mjs --dry-run
node scripts/enrich-equal-parenting-research.mjs --limit 10
node scripts/enrich-equal-parenting-research.mjs --work-id W0025
node scripts/enrich-equal-parenting-research.mjs --all
```

Require `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for non-dry-run. Optional `SEMANTIC_SCHOLAR_API_KEY`.

Print one line per work:

```text
W0025 enriched OpenAlex citations=... FWCI=... reviews=... impact=... completeness=...
```

Finish with counts for enriched/partial/needs-review/errors. Exit nonzero only for configuration/database failures; individual provider failures stay in the summary.

- [ ] **Step 6: Run tests**

```bash
node --test tests/research-enrichment-orchestrator.test.js tests/research-scoring.test.js tests/research-repository.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/research/repository.js lib/research/enrichment/orchestrator.js scripts/enrich-equal-parenting-research.mjs tests/research-enrichment-orchestrator.test.js
git commit -m "feat: automate research bibliometrics"
```

---

### Task 7: Add completion status, provenance, and the stronger publication gate to the editor

**Files:**
- Modify: `src/MioResearchEditor.jsx`
- Modify: `lib/research/model.js`
- Modify: `tests/research-model.test.js`
- Modify/Create browser editor test fixture as needed.

**Interfaces:**
- `researchCompletion(publication,bundle) -> {status,items,percent}`.
- `validatePublicationForPublish()` enforces Phase 1.5 gate.

- [ ] **Step 1: Add failing completion/gate tests**

```js
test('empty bibliography is needs enrichment',()=>{
  const r=researchCompletion({title:'X',doi:'10/x'},{studies:[],accessLinks:[],metrics:[]})
  assert.equal(r.status,'needs_enrichment')
})

test('direct empirical record cannot publish with uncoded 50/50 analysis',()=>{
  const p={title:'X',authors_text:'A',publication_year:2020,source_type:'original_empirical',overall_findings_summary:'Finding',limitations_summary:'Limit',what_it_supports:'Supports',what_it_does_not_establish:'Does not',finding_direction:'mixed',evidence_strength_score:70,equal_parenting_relevance_score:75}
  const errors=validatePublicationForPublish(p,{studies:[],accessLinks:[{url:'https://doi.org/x',is_public:true}],metrics:[{metric_type:'citation_count',metric_value:3}]})
  assert.ok(errors.some(x=>/analysis/i.test(x)))
})
```

- [ ] **Step 2: Run and confirm RED**

```bash
node --test tests/research-model.test.js
```

- [ ] **Step 3: Implement completion checklist**

Checklist items:

```js
[
 ['Bibliography verified', Boolean(p.title&&p.authors_text&&p.publication_year)],
 ['Source link verified', accessLinks.some(x=>x.url&&x.is_public!==false)],
 ['Citation metrics current', p.citation_count_captured_at!=null || p.citation_verification==='unavailable'],
 ['Study definition coded', nonEmpirical || studies.some(x=>x.parenting_time_definition)],
 ['Sample/ages coded', nonEmpirical || studies.some(x=>x.sample_size||x.child_age_text)],
 ['Design coded', nonEmpirical || studies.some(x=>x.study_design)],
 ['Controls coded', nonEmpirical || studies.some(x=>x.controls_summary)],
 ['Findings coded', Boolean(p.overall_findings_summary)],
 ['Limitations coded', Boolean(p.limitations_summary)],
 ['Evidence score ready', p.evidence_strength_score!=null || sourceTypeAllowsNoEvidenceScore],
 ['Relevance score ready', p.equal_parenting_relevance_score!=null],
 ['Impact score ready', p.impact_score!=null || p.citation_verification==='unavailable'],
 ['Historical importance reviewed', p.historical_field_importance_score!=null]
]
```

`verified` requires all applicable items true. `ready_for_editorial_review` requires >= 80% and all substantive conclusion items. Else `needs_enrichment`.

- [ ] **Step 4: Strengthen publish validation**

Require:

- bibliography identity;
- public source;
- findings;
- limitations;
- supports;
- does-not-establish;
- direction;
- citations or explicit unavailable status;
- evidence/relevance assessment appropriate to type;
- empirical study analysis sufficient to classify parenting time honestly.

Do not require Impact if external metrics are explicitly unavailable.

- [ ] **Step 5: Add editor UI**

Show a completion card at the top with percentage and all checklist items. Add provenance controls to each child study:

- `Extraction status`
- `Extraction source` as a text/source URL field stored in `inventory_raw` or a dedicated child column if added in Task 1 migration revision;
- `Verified` timestamp/display.

If a dedicated `extraction_source_url`/`verified_at` study column is chosen, add it to Task 1 migration before implementation rather than storing provenance in freeform notes.

- [ ] **Step 6: Run model/browser tests**

```bash
node --test tests/research-model.test.js
node tests/research-workspace-browser.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/MioResearchEditor.jsx lib/research/model.js tests/research-model.test.js tests/research-workspace-browser.mjs
git commit -m "feat: gate research publication on substantive review"
```

---

### Task 8: Create a source-backed curated-analysis import format and import the anchor/caution set

**Files:**
- Create: `scripts/import-research-analysis.mjs`
- Create: `data/research/anchor-analysis-v1.json`
- Create: `tests/research-analysis-import.test.js`

**Interfaces:**
- JSON keyed by `inventory_work_id`.
- Importer updates publication synthesis fields and upserts distinct `research_studies` rows without auto-publishing.

- [ ] **Step 1: Write the failing JSON/import parser test**

Required JSON shape:

```json
{
  "inventory_work_id": "W0025",
  "sources": [
    {"url":"https://doi.org/10.1136/jech-2014-205058","kind":"doi","verified":true}
  ],
  "publication": {
    "overall_findings_summary": "...",
    "limitations_summary": "...",
    "what_it_supports": "...",
    "what_it_does_not_establish": "..."
  },
  "studies": [
    {
      "study_label":"Main Swedish school-age sample",
      "sample_size":147839,
      "child_age_text":"12 and 15 years",
      "parenting_time_definition":"living equally much with both parents",
      "exact_or_near_50_50":true,
      "study_design":"cross-sectional adjusted comparison",
      "causal_claim_strength":"low",
      "extraction_status":"needs_review",
      "source_url":"https://doi.org/10.1136/jech-2014-205058"
    }
  ]
}
```

Test must prove two analyses for one publication remain two child rows and rerunning the same JSON does not duplicate them.

- [ ] **Step 2: Run and confirm RED**

```bash
node --test tests/research-analysis-import.test.js
```

- [ ] **Step 3: Implement importer**

CLI:

```bash
node scripts/import-research-analysis.mjs --dry-run data/research/anchor-analysis-v1.json
node scripts/import-research-analysis.mjs data/research/anchor-analysis-v1.json
```

Importer rules:

- resolve publication only by `inventory_work_id`;
- never change `editorial_status` to `published`;
- never overwrite a child analysis whose `extraction_status='verified'` unless `--allow-verified-overwrite` is explicitly passed;
- source URL required for every substantive analysis row;
- if publication synthesis fields already differ and were verified, emit a conflict and leave them untouched;
- calculate proposed Evidence/Relevance scores only after structured fields exist; store component detail in `score_notes`;
- update `analysis_completion_status` from `researchCompletion()` after import.

- [ ] **Step 4: Curate the first anchor/caution dataset**

The first JSON file must contain at least these existing production Work IDs:

- `W0001` — Nielsen 2014, 40-study review;
- `W0002` — Nielsen 2018, 60-study review;
- `W0003` — Warshak 2014 consensus report;
- `W0004` — Baude/Pearson/Drapeau 2016 meta-analysis;
- `W0005` — Bauserman 2002 meta-analysis;
- `W0006` — Steinbach 2019 literature review;
- `W0007` — Vowels et al. 2023 systematic review;
- `W0008` — Mahrer et al. 2018 high-conflict review;
- `W0011` — Nielsen 2011 review;
- `W0012` — Nielsen 2017 conflict/coparenting review;
- `W0025` — Bergström et al. 2015, *Fifty moves a year*;
- `W0060` — McIntosh et al. 2010 post-separation parenting arrangements;
- `W0069` — Tornello et al. 2013 overnight custody/attachment;
- `W0080` — Solomon & George 1999 attachment/overnights;
- `W0081` — Pruett/Ebling/Insabella 2004 young-child overnights;
- `W0092` — Steinbach & Augustijn 2022 child wellbeing;
- `W0093` — Steinbach 2024 coparenting mediator;
- `W0101` — Steinbach 2026 measurement of JPC.

For each record, use primary/full-text sources when lawfully available; otherwise publisher/abstract source. Every substantive statement must be traceable to `sources` in the JSON. Do not use tertiary summaries as the sole source for sample/design/results when a primary paper is available.

- [ ] **Step 5: Run import parser tests and dry run**

```bash
node --test tests/research-analysis-import.test.js tests/research-scoring.test.js
node scripts/import-research-analysis.mjs --dry-run data/research/anchor-analysis-v1.json
```

Expected: PASS and 18 Work IDs resolved without duplicate analyses.

- [ ] **Step 6: Commit**

```bash
git add scripts/import-research-analysis.mjs data/research/anchor-analysis-v1.json tests/research-analysis-import.test.js
git commit -m "feat: add source-backed anchor research analyses"
```

---

### Task 9: Run live bibliometric enrichment, import anchor analyses, and verify the Phase 1.5 dataset

**Files:**
- No new production files expected; modify prior tasks only if verification finds defects.

**Interfaces:**
- Consumes live Supabase project `vnnkxqpyndidnjbrbywz` after migration is applied.

- [ ] **Step 1: Apply the Phase 1.5 migration**

Use the connected Supabase migration tool with the exact checked-in SQL.

Verify:

```sql
select count(*) from public.research_publications;
select column_name from information_schema.columns
where table_schema='public' and table_name='research_publications'
  and column_name in ('citation_count_current','citations_per_year','major_review_count','impact_data_completeness');
```

Expected: 90 publications and all four columns present.

- [ ] **Step 2: Run a single-work bibliometric smoke test first**

```bash
node scripts/enrich-equal-parenting-research.mjs --work-id W0025
```

Verify W0025 has provider, capture date, citation count, citation rate, review count, and Impact/completeness where enough metrics exist.

- [ ] **Step 3: Run the full 90-work enrichment**

```bash
node scripts/enrich-equal-parenting-research.mjs --all
```

Capture summary counts: matched, partial, needs-review, provider errors.

Immediately rerun `--all` and verify no duplicate current-summary corruption and no uncontrolled duplicate source links.

- [ ] **Step 4: Import the curated anchor set**

```bash
node scripts/import-research-analysis.mjs data/research/anchor-analysis-v1.json
```

Rerun it and verify child analysis counts do not double.

- [ ] **Step 5: Verify production completeness metrics**

Run:

```sql
select
  count(*) as publications,
  count(*) filter (where citation_count_current is not null) as with_citations,
  count(*) filter (where impact_score is not null) as with_impact,
  count(*) filter (where evidence_strength_score is not null) as with_evidence,
  count(*) filter (where equal_parenting_relevance_score is not null) as with_relevance,
  count(*) filter (where analysis_completion_status='ready_for_editorial_review') as ready_for_review,
  count(*) filter (where analysis_completion_status='verified') as verified
from public.research_publications;

select count(*) as analyses from public.research_studies;
```

Do not claim success based on an arbitrary target count. Report exact matched/unmatched counts and explain unmatched records.

- [ ] **Step 6: Verify live UI**

At `/#equal_parenting_research` confirm:

- uncoded rows say `Unknown`, not `No`;
- anchor true-50 rows show `Yes` only when coded;
- `Cited By`, `Citations / Year`, `Major Reviews`, Evidence, Impact appear;
- `Read study` opens an actual URL;
- sort by citations and Impact works;
- missing metrics display `Unknown`, zero remains `0`;
- mobile layout remains usable.

- [ ] **Step 7: Run complete automated gate**

```bash
node --test tests/research-*.test.js tests/browser-syntax.test.js
node tests/research-workspace-browser.mjs
npm run build
```

Expected: all PASS.

- [ ] **Step 8: Run Supabase security advisor**

Confirm Phase 1.5 creates no new research-specific RLS/security-definer/public-function findings. Pre-existing unrelated Mio findings may remain separately documented.

- [ ] **Step 9: Commit any verification-only fixes**

Only if needed:

```bash
git add <specific corrected files>
git commit -m "fix: verify research enrichment pipeline"
```

---

### Task 10: Merge Phase 1.5 and establish the remaining enrichment queue

**Files:**
- Create or update only if needed: `docs/research/equal-parenting-enrichment-status.md`

**Interfaces:**
- Produces an auditable list of records still requiring substantive extraction after the first anchor set.

- [ ] **Step 1: Generate the enrichment-status report from live data**

The report must include exact counts for:

- total publications;
- citation matched/unmatched;
- analysis rows;
- exact-50 Yes/No/Unknown counts;
- Evidence scored/unscored;
- Impact scored/unscored;
- Ready for editorial review;
- Verified;
- remaining Work IDs grouped by source type and priority.

Do not hand-type counts that can be queried.

- [ ] **Step 2: Open a Phase 1.5 PR**

PR body must explicitly state:

- the table no longer lies about unknown 50/50 status;
- bibliometric matching success/failure counts;
- anchor Work IDs enriched;
- tests/build status;
- live Supabase migration status;
- records remain unpublished unless editorially ready.

- [ ] **Step 3: Merge only after green CI and Vercel preview**

Use squash merge after the final branch workflow and Vercel status are successful.

- [ ] **Step 4: Verify production after merge**

Recheck Vercel success and the live Supabase counts from Task 9. Do not auto-publish any research record as part of merge verification.

---

## Phase 1.5 Completion Gate

Do not claim Phase 1.5 complete until:

- 50/50 is tri-state and uncoded records show `Unknown`;
- the main Mio list shows Cited By, Citations/Year, Major Reviews, Evidence, Impact, and a real study link;
- bibliography titles remain internal editor links and source links open actual papers/publisher pages;
- citation metrics have provider and capture-date provenance;
- citation counts from separate providers remain separate;
- Impact is auditable and carries data-completeness information;
- scoring is direction-neutral by automated test;
- review count is distinct/verified rather than manually typed;
- the first 18 anchor/caution Work IDs have source-backed enrichment records;
- substantive analysis rows distinguish publication from study/analysis;
- the stronger publication gate rejects bibliography-only records;
- no batch enrichment step can auto-publish;
- unmatched/ambiguous works remain visibly queued rather than guessed;
- live Supabase security checks remain intact;
- browser tests and production build pass;
- exact remaining enrichment backlog is documented for the next pass.
