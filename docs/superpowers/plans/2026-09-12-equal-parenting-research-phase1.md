# Equal Parenting Research Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Supabase-backed Equal Parenting Research editorial system in Mio, import the current 90-publication inventory as drafts, and expose a safe published-only data contract for the future public website.

**Architecture:** Supabase is the normalized source of truth; Mio is the authenticated editor. Pure research rules live in `lib/research/`, React UI lives in focused `src/MioResearch*.jsx` files, and a checked Vite transform integrates the workspace into the existing 6 MB `src/App.jsx` without adding feature logic to that monolith. Anonymous users get no base-table access; a field-limited published-only SQL view is the only public read surface.

**Tech Stack:** React 19, Vite 8, `@supabase/supabase-js` 2.108.2, PostgreSQL/Supabase RLS, Node built-in test runner, existing `xlsx` dependency, existing Playwright/Vite browser-test pattern.

**Spec:** `docs/superpowers/specs/2026-09-12-equal-parenting-research-hub-design.md`

## Global Constraints

- Include favorable, neutral, mixed, conditional, and unfavorable research under the same admission and scoring rules.
- Distinguish publication-level records from separate studies/analyses contained in one publication.
- Result direction must never affect Impact, Evidence Strength, Equal-Parenting Relevance, or Historical/Field Importance scores.
- Never treat “joint physical custody,” “shared residence,” “alternating residence,” and “50/50” as automatically equivalent.
- Store each paper's actual parenting-time definition when known; do not infer percentages from labels such as JPC.
- Every empirical study must support a causal-claim-strength value; public prose must not claim causation when the design supports association only.
- Only `published` records may appear in the public website contract or public dataset export.
- Public/Mio-hosted article copies may be exposed only when redistribution is affirmatively permitted; a downloadable file alone is not proof of permission.
- Missing metrics are `null`/“not available,” never zero.
- Service-role keys must never ship to the browser.
- The public website repository is out of scope for Phase 1 because its source is not currently available through the connected GitHub/Vercel accounts.
- Do not require every known paper to be fully analyzed before the first public launch; imported rows begin as `draft`.

---

## File Structure

Create these focused units rather than expanding feature logic inside `src/App.jsx`:

- `supabase/migrations/20260913031500_equal_parenting_research_v1.sql` — normalized research schema, RLS, indexes, and published-only view.
- `lib/research/model.js` — constants, normalization, validation, filtering, sorting, slug generation, score helpers; no network or React.
- `lib/research/repository.js` — thin Supabase CRUD/bundle functions used by Mio.
- `lib/research/inventory.js` — deterministic parser/mapping from the current XLSX workbook into normalized draft bundles.
- `scripts/import-equal-parenting-research.mjs` — one-off/idempotent server-side inventory importer using a service-role key from environment only.
- `src/MioResearchWorkspace.jsx` — list/search/filter/sort/status workspace.
- `src/MioResearchEditor.jsx` — publication editor plus nested studies, access links, metrics, review memberships, and publish validation.
- `src/mioResearch.css` — research workspace/editor styling.
- `mio-v318-equal-parenting-research.js` — checked/idempotent Vite integration transform for `src/App.jsx`.
- `tests/research-migration.test.js` — schema/security source assertions.
- `tests/research-model.test.js` — pure model tests.
- `tests/research-repository.test.js` — repository contract tests against a fake Supabase client.
- `tests/research-inventory.test.js` — XLSX parsing/deduplication/idempotency input tests.
- `tests/research-workspace-browser-fixture.jsx` — synthetic browser fixture.
- `tests/research-workspace-browser.mjs` — compiled browser workflow test.
- `tests/research-integration.test.js` — App transform and Vite integration assertions.

The importer must consume the existing workbook sheets exactly as currently named:

- `Master Works` — 90 data rows; columns include `Work ID`, `Authors`, `Year`, `Title`, `Source Type`, `Admission Route`, `Direct Child Outcome?`, `Included in Nielsen 2018?`, `Preliminary Direction`, `Country`, `Sample N`, `Shared/Equal Definition`, `Design`, DOI/URLs/access/metric verification/notes.
- `Review Memberships` — 55 data rows.
- `Metric Snapshots` — 10 data rows.
- `Access Queue` — 90 data rows.
- `Study Analysis Template` — currently headers only; future populated rows must also import.

---

### Task 1: Create the normalized Supabase schema and published-only boundary

**Files:**
- Create: `supabase/migrations/20260913031500_equal_parenting_research_v1.sql`
- Create: `tests/research-migration.test.js`

**Interfaces:**
- Consumes: Supabase Auth JWT; existing convention that staff emails end in `@beveridgelawfirm.com`.
- Produces: tables `research_publications`, `research_studies`, `research_access_links`, `research_metrics`, `research_review_memberships`; view `research_public_catalog`.

- [ ] **Step 1: Write the failing migration contract test**

Create `tests/research-migration.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const path=new URL('../supabase/migrations/20260913031500_equal_parenting_research_v1.sql',import.meta.url)
const sql=()=>fs.readFileSync(path,'utf8')

test('research migration creates normalized publication and child tables',()=>{
  const s=sql()
  for(const name of ['research_publications','research_studies','research_access_links','research_metrics','research_review_memberships'])
    assert.match(s,new RegExp(`create table if not exists public\\.${name}`,'i'))
})

test('anonymous users cannot read base research tables',()=>{
  const s=sql()
  for(const name of ['research_publications','research_studies','research_access_links','research_metrics','research_review_memberships'])
    assert.match(s,new RegExp(`revoke all on public\\.${name} from anon`,'i'))
})

test('the anonymous contract is a published-only field-limited view',()=>{
  const s=sql()
  assert.match(s,/create or replace view public\.research_public_catalog/i)
  assert.match(s,/where p\.editorial_status\s*=\s*'published'/i)
  assert.match(s,/grant select on public\.research_public_catalog to anon/i)
  assert.doesNotMatch(s,/grant select[^;]*research_publications[^;]*to anon/i)
})

test('scores are nullable 0-100 values and direction is independent',()=>{
  const s=sql()
  for(const key of ['impact_score','evidence_strength_score','equal_parenting_relevance_score','historical_field_importance_score'])
    assert.match(s,new RegExp(`${key} integer[^,;]*between 0 and 100`,'i'))
  assert.match(s,/finding_direction text/i)
})
```

- [ ] **Step 2: Run the test and verify it fails because the migration is absent**

Run:

```bash
node --test tests/research-migration.test.js
```

Expected: FAIL with `ENOENT` for `20260913031500_equal_parenting_research_v1.sql`.

- [ ] **Step 3: Add the migration with explicit constraints, RLS, and indexes**

The migration must implement these exact structural rules:

```sql
create table if not exists public.research_publications (
  id uuid primary key default gen_random_uuid(),
  inventory_work_id text unique,
  slug text not null unique,
  title text not null,
  authors_text text not null default '',
  publication_year integer check(publication_year between 1800 and 2200),
  journal_or_publisher text,
  doi text,
  source_type text not null check(source_type in (
    'original_empirical','longitudinal','natural_experiment','systematic_review',
    'meta_analysis','narrative_review','consensus_report','methodology_critique','policy_legal','other'
  )),
  admission_route text,
  direct_child_outcome boolean,
  included_nielsen_2018 boolean,
  country_text text,
  citation_text text,
  abstract_summary text,
  overall_findings_summary text,
  limitations_summary text,
  what_it_supports text,
  what_it_does_not_establish text,
  finding_direction text not null default 'mixed' check(finding_direction in (
    'favors_shared','neutral','mixed','conditional_concern','disfavors_shared','methodology_only'
  )),
  topics text[] not null default '{}',
  evidence_strength_score integer check(evidence_strength_score between 0 and 100),
  impact_score integer check(impact_score between 0 and 100),
  equal_parenting_relevance_score integer check(equal_parenting_relevance_score between 0 and 100),
  historical_field_importance_score integer check(historical_field_importance_score between 0 and 100),
  score_notes jsonb not null default '{}'::jsonb,
  editorial_status text not null default 'draft' check(editorial_status in ('draft','needs_review','published','archived')),
  published_at timestamptz,
  citation_verification text,
  internal_notes text,
  inventory_raw jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists research_publications_doi_unique
  on public.research_publications(lower(doi)) where doi is not null and btrim(doi)<>'';
create index if not exists research_publications_status_year
  on public.research_publications(editorial_status,publication_year desc);
create index if not exists research_publications_topics_gin
  on public.research_publications using gin(topics);

create table if not exists public.research_studies (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.research_publications(id) on delete cascade,
  study_label text not null,
  extraction_status text not null default 'unverified' check(extraction_status in ('unverified','verified','needs_review')),
  country_text text,
  sample_size integer check(sample_size is null or sample_size>=0),
  child_age_text text,
  age_min numeric,
  age_max numeric,
  parenting_time_definition text,
  shared_time_min_percent numeric check(shared_time_min_percent is null or shared_time_min_percent between 0 and 100),
  shared_time_max_percent numeric check(shared_time_max_percent is null or shared_time_max_percent between 0 and 100),
  exact_or_near_50_50 boolean,
  comparator text,
  study_design text,
  outcomes_measured text,
  controls_summary text,
  longitudinal boolean,
  pre_separation_controls boolean,
  conflict_controls boolean,
  ses_controls boolean,
  effect_size_summary text,
  result_direction text check(result_direction is null or result_direction in ('favors_shared','neutral','mixed','conditional_concern','disfavors_shared')),
  result_summary text,
  key_limitation text,
  causal_claim_strength text not null default 'not_applicable' check(causal_claim_strength in ('high','moderate','low','very_low','not_applicable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.research_access_links (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.research_publications(id) on delete cascade,
  link_type text not null,
  url text not null,
  access_status text not null,
  license_text text,
  redistribution_permitted boolean not null default false,
  is_preferred boolean not null default false,
  is_public boolean not null default true,
  checked_at timestamptz,
  unique(publication_id,link_type,url)
);

create table if not exists public.research_metrics (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.research_publications(id) on delete cascade,
  provider text not null,
  metric_type text not null,
  metric_value numeric,
  source_url text,
  captured_at timestamptz not null,
  unique(publication_id,provider,metric_type,captured_at)
);

create table if not exists public.research_review_memberships (
  id uuid primary key default gen_random_uuid(),
  review_publication_id uuid not null references public.research_publications(id) on delete cascade,
  included_publication_id uuid not null references public.research_publications(id) on delete cascade,
  included_study_id uuid references public.research_studies(id) on delete set null,
  membership_status text not null default 'included',
  membership_note text,
  verified_at timestamptz,
  unique(review_publication_id,included_publication_id,included_study_id)
);
```

For every base table:

```sql
alter table public.<table> enable row level security;
revoke all on public.<table> from anon;
grant select,insert,update,delete on public.<table> to authenticated;
create policy <table>_staff_all on public.<table> for all to authenticated
 using(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com')
 with check(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');
```

Create `research_public_catalog` as a field-limited view. It must select only public publication fields and aggregate child rows with `jsonb_build_object`/`jsonb_agg`. Access-link aggregation must include only `is_public=true` and must exclude any `link_type='mio_public_copy'` row unless `redistribution_permitted=true`. The view must filter `p.editorial_status='published'` inside the view definition. Revoke default/public privileges and grant `select` only on the view to `anon,authenticated`.

- [ ] **Step 4: Run the migration contract test**

Run:

```bash
node --test tests/research-migration.test.js
```

Expected: PASS.

- [ ] **Step 5: Apply the migration to the connected `casecontrollermio` Supabase project and verify live security**

Use the connected Supabase project rather than copying SQL into a browser manually. Verify with read-only SQL after application:

```sql
select count(*) from public.research_publications;
select table_name from information_schema.views where table_schema='public' and table_name='research_public_catalog';
select grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name like 'research_%'
order by table_name,grantee,privilege_type;
```

Expected before import: publication count `0`; `research_public_catalog` exists; `anon` has `SELECT` on the view and no grants on base research tables.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260913031500_equal_parenting_research_v1.sql tests/research-migration.test.js
git commit -m "feat: add equal parenting research schema"
```

---

### Task 2: Add pure research-domain normalization, filtering, and validation

**Files:**
- Create: `lib/research/model.js`
- Create: `tests/research-model.test.js`

**Interfaces:**
- Produces: `FINDING_DIRECTIONS`, `SOURCE_TYPES`, `RESEARCH_TOPICS`, `slugifyResearchTitle(value)`, `normalizePublicationDraft(input)`, `validatePublicationForPublish(publication,bundle)`, `matchesResearchFilters(row,filters)`, `sortResearchRows(rows,sort)`.
- Consumes: plain JavaScript objects only; no React, Supabase, browser globals, or filesystem.

- [ ] **Step 1: Write failing model tests**

Create tests covering exact behavior:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  slugifyResearchTitle,normalizePublicationDraft,validatePublicationForPublish,
  matchesResearchFilters,sortResearchRows
} from '../lib/research/model.js'

test('slug generation is stable and URL safe',()=>{
  assert.equal(slugifyResearchTitle('Bergström 2015 — Fifty moves a year'),'bergstrom-2015-fifty-moves-a-year')
})

test('zero is not substituted for an unknown score',()=>{
  const row=normalizePublicationDraft({title:'Test',source_type:'original_empirical',impact_score:''})
  assert.equal(row.impact_score,null)
})

test('direction does not alter scores',()=>{
  const base={title:'Test',source_type:'original_empirical',impact_score:88,evidence_strength_score:76}
  const a=normalizePublicationDraft({...base,finding_direction:'favors_shared'})
  const b=normalizePublicationDraft({...base,finding_direction:'disfavors_shared'})
  assert.equal(a.impact_score,b.impact_score)
  assert.equal(a.evidence_strength_score,b.evidence_strength_score)
})

test('publish validation requires public source and causal strength for empirical analyses',()=>{
  const publication=normalizePublicationDraft({title:'Test',authors_text:'A',publication_year:2026,source_type:'original_empirical',finding_direction:'mixed'})
  const errors=validatePublicationForPublish(publication,{studies:[{causal_claim_strength:'not_applicable'}],accessLinks:[]})
  assert.ok(errors.some(x=>x.includes('access')))
  assert.ok(errors.some(x=>x.includes('causal')))
})

test('50/50 filter never infers equality from a JPC label',()=>{
  assert.equal(matchesResearchFilters({title:'X',studies:[{parenting_time_definition:'JPC',exact_or_near_50_50:null}]},{exact50:true}),false)
  assert.equal(matchesResearchFilters({title:'X',studies:[{exact_or_near_50_50:true}]},{exact50:true}),true)
})

test('sorting handles null impact after real scores',()=>{
  const rows=sortResearchRows([{id:'a',impact_score:null},{id:'b',impact_score:50}],{key:'impact_score',direction:'desc'})
  assert.deepEqual(rows.map(x=>x.id),['b','a'])
})
```

- [ ] **Step 2: Run tests and verify missing-module failure**

```bash
node --test tests/research-model.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the minimal pure model**

`lib/research/model.js` must:

- transliterate common diacritics with `String(value).normalize('NFKD')` and remove combining marks;
- normalize blank numeric scores to `null`;
- reject scores outside 0–100;
- preserve finding direction without using it in score calculations;
- define controlled source/direction/topic constants;
- require title/source type for drafts;
- on publish, require authors, year, a canonical/public access link, nonblank findings summary, and for each empirical study a non-`not_applicable` causal strength;
- filter across title/authors/year/country/topics/direction/source type/access and exact-50 flag;
- sort `null` values after actual values in both directions.

Use this shape for publish validation:

```js
export function validatePublicationForPublish(p,bundle={}){
  const errors=[]
  if(!String(p.title||'').trim())errors.push('Title is required.')
  if(!String(p.authors_text||'').trim())errors.push('Authors are required before publishing.')
  if(!Number.isInteger(Number(p.publication_year)))errors.push('Publication year is required before publishing.')
  if(!String(p.overall_findings_summary||'').trim())errors.push('Findings summary is required before publishing.')
  const publicLinks=(bundle.accessLinks||[]).filter(x=>x.is_public!==false&&x.url)
  if(!publicLinks.length)errors.push('At least one public canonical, publisher, abstract, full-text, or purchase access link is required before publishing.')
  if(['original_empirical','longitudinal','natural_experiment','policy_legal'].includes(p.source_type)){
    for(const study of bundle.studies||[])if(study.causal_claim_strength==='not_applicable')errors.push('Each empirical analysis needs a causal-claim-strength classification.')
  }
  return errors
}
```

- [ ] **Step 4: Run tests**

```bash
node --test tests/research-model.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/research/model.js tests/research-model.test.js
git commit -m "feat: add research domain model"
```

---

### Task 3: Add a thin, testable Supabase repository

**Files:**
- Create: `lib/research/repository.js`
- Create: `tests/research-repository.test.js`

**Interfaces:**
- Consumes: a Supabase client object with `.from()` query builders.
- Produces:
  - `listResearchPublications(client)` -> publication rows with nested child data.
  - `getResearchPublication(client,id)` -> `{publication,studies,accessLinks,metrics,reviewMemberships}`.
  - `saveResearchPublication(client,input)` -> saved publication row.
  - `replaceResearchStudies(client,publicationId,rows)`.
  - `replaceResearchAccessLinks(client,publicationId,rows)`.
  - `replaceResearchMetrics(client,publicationId,rows)`.
  - `replaceResearchReviewMemberships(client,publicationId,rows)`.
  - `setResearchEditorialStatus(client,id,status,actorId)`.

- [ ] **Step 1: Write a fake Supabase query builder and failing repository tests**

The fake must record table, operation, payload, filters, and selected columns rather than making network calls. Tests must prove:

```js
test('list reads only research tables and orders newest first',async()=>{ /* assert table==='research_publications', order publication_year desc */ })
test('save strips nested UI fields before upsert',async()=>{ /* studies/accessLinks are not sent to publication row */ })
test('replace children always binds the requested publication id',async()=>{ /* malicious child publication_id is overwritten */ })
test('publishing sets published_at while archiving clears no historical data',async()=>{ /* patch assertions */ })
```

- [ ] **Step 2: Run and verify module-not-found**

```bash
node --test tests/research-repository.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement repository functions**

Use explicit column lists instead of `select('*')` in list/detail functions. For child replacements, delete existing children for the publication inside each child table, then insert the normalized replacement rows. If any Supabase response has `error`, throw `new Error(error.message)` immediately.

Status transition implementation must be explicit:

```js
export async function setResearchEditorialStatus(client,id,status,actorId){
  const patch={editorial_status:status,updated_by:actorId,updated_at:new Date().toISOString()}
  if(status==='published')patch.published_at=new Date().toISOString()
  const {data,error}=await client.from('research_publications').update(patch).eq('id',id).select(PUBLICATION_COLUMNS).single()
  if(error)throw new Error(error.message)
  return data
}
```

Do not put the service-role key or a Supabase client constructor in this module; the caller injects the client.

- [ ] **Step 4: Run repository + model tests**

```bash
node --test tests/research-model.test.js tests/research-repository.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/research/repository.js tests/research-repository.test.js
git commit -m "feat: add research Supabase repository"
```

---

### Task 4: Build the idempotent XLSX inventory parser and importer

**Files:**
- Create: `lib/research/inventory.js`
- Create: `scripts/import-equal-parenting-research.mjs`
- Create: `tests/research-inventory.test.js`

**Interfaces:**
- Consumes: an `xlsx` workbook with the exact sheet names listed above.
- Produces: `parseResearchInventory(workbook)` -> `{publications,studies,accessLinks,metrics,reviewMemberships}`.
- Import identity: `research_publications.inventory_work_id` is the stable primary import key; DOI is a secondary dedupe key.

- [ ] **Step 1: Write a synthetic workbook test**

Create the workbook in memory with `xlsx.utils.aoa_to_sheet` so the test has no binary fixture dependency. Cover:

- one favorable publication and one unfavorable publication;
- a duplicate rerun using the same `Work ID`;
- review membership references by Work ID;
- metric value `0` versus missing metric;
- canonical + OA links;
- a `Mio copy` link with no redistribution permission remaining non-public;
- a `Study Analysis Template` row with exact-50 `true` and causal strength `moderate`.

Assertions must include:

```js
assert.equal(parsed.publications.length,2)
assert.equal(parsed.publications[1].finding_direction,'disfavors_shared')
assert.equal(parsed.metrics.find(x=>x.metric_type==='citation_count').metric_value,0)
assert.equal(parsed.metrics.find(x=>x.metric_type==='publisher_views'),undefined)
assert.equal(parsed.studies[0].exact_or_near_50_50,true)
assert.equal(parsed.studies[0].causal_claim_strength,'moderate')
```

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/research-inventory.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement deterministic workbook parsing**

Mapping rules:

- `Work ID` -> `inventory_work_id`.
- `Authors`, `Year`, `Title`, `Country`, `DOI`, `Notes` map directly after trimming.
- `Preliminary Direction` maps through an explicit dictionary; unknown values become `mixed` plus an import warning in `inventory_raw`, never silently “favors shared.”
- `Source Type` maps through an explicit dictionary; unknown values become `other`.
- `Included in Nielsen 2018?` and `Direct Child Outcome?` parse `yes/no/true/false/1/0`; blanks -> `null`.
- `Canonical URL` and `Full Text / OA URL` create separate access-link rows when present.
- `Mio Copy Decision` never creates a public URL unless the access row affirmatively states redistribution permission.
- Blank metric cell -> no metric row. Numeric zero -> a metric row with value `0`.
- `Metric Retrieved`/`Retrieved` become timestamps only when parseable; invalid dates generate an import warning and no fabricated date.
- `Study Analysis Template` produces study rows only when that sheet contains data rows. Do not infer a verified study row from the summary columns in `Master Works`.
- Preserve `Sample N`, `Shared/Equal Definition`, and `Design` from `Master Works` inside `inventory_raw` until full-text extraction creates verified `research_studies` rows.

Generate a stable draft slug from author/year/title; resolve same-run collisions by suffixing `-2`, `-3`, etc. On re-import, the database's existing slug must be preserved for an existing `inventory_work_id`.

- [ ] **Step 4: Implement the service-role importer**

`scripts/import-equal-parenting-research.mjs` must require:

```js
const url=process.env.SUPABASE_URL
const key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key)throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the local shell. Never use a VITE_ variable for the service-role key.')
```

CLI usage:

```bash
node scripts/import-equal-parenting-research.mjs /absolute/path/equal_parenting_research_inventory_v1.xlsx
```

Import order:

1. parse workbook;
2. fetch existing publications by `inventory_work_id` and DOI;
3. upsert publications with `editorial_status:'draft'` for new rows while preserving an existing non-draft status on rerun;
4. build Work-ID -> UUID map;
5. replace imported access links/metrics/studies for each Work ID;
6. resolve and upsert review memberships only after all publication UUIDs exist;
7. print counts for inserted/updated/skipped/warnings;
8. exit nonzero if a membership references a missing Work ID or a database operation fails.

Do not log the service-role key or complete environment values.

- [ ] **Step 5: Run parser tests**

```bash
node --test tests/research-inventory.test.js
```

Expected: PASS.

- [ ] **Step 6: Run the importer in dry-run mode against the real workbook**

Add `--dry-run` support that parses and reports without connecting to Supabase:

```bash
node scripts/import-equal-parenting-research.mjs --dry-run /mnt/data/equal_parenting_research_inventory_v1.xlsx
```

Expected from the current v1 workbook: `90 publications`, `55 review memberships`, `10 metric snapshot rows`, `90 access-queue records`; `Study Analysis Template` contributes `0` study rows until populated. The exact number of generated access-link rows may exceed 90 because a publication can have both canonical and OA links.

- [ ] **Step 7: Commit**

```bash
git add lib/research/inventory.js scripts/import-equal-parenting-research.mjs tests/research-inventory.test.js
git commit -m "feat: import equal parenting research inventory"
```

---

### Task 5: Build the Mio research list/search/filter workspace

**Files:**
- Create: `src/MioResearchWorkspace.jsx`
- Create: `src/mioResearch.css`
- Create: `tests/research-workspace-browser-fixture.jsx`
- Create: `tests/research-workspace-browser.mjs`

**Interfaces:**
- Consumes props: `{session,supabase,enabled}`.
- Uses `listResearchPublications`, `matchesResearchFilters`, and `sortResearchRows`.
- Produces an internal workspace with `onEdit(id)` state passed to `MioResearchEditor` in Task 6.

- [ ] **Step 1: Write the initial browser fixture and failing browser assertions**

Follow the existing offline compiled-component pattern in `tests/ads-workspace-browser.mjs`: Vite `build({write:false})`, `playwright-core`, synthetic Supabase client, no live cloud calls.

The synthetic dataset must contain at least five rows: favorable, neutral, mixed, conditional concern, and unfavorable. Assertions:

```js
await page.getByRole('heading',{name:'Equal Parenting Research'}).waitFor()
assert.equal(await page.locator('tbody tr[data-research-row]').count(),5)
await page.getByLabel('Finding direction').selectOption('disfavors_shared')
assert.equal(await page.locator('tbody tr[data-research-row]').count(),1)
await page.getByLabel('Finding direction').selectOption('')
await page.getByLabel('Exact or near 50/50').check()
assert.equal(await page.locator('tbody tr[data-research-row]').count(),1)
await page.getByRole('button',{name:'Sort by Impact'}).click()
assert.match(await page.locator('tbody tr[data-research-row]').first().innerText(),/88/)
```

Also assert that an unavailable metric renders `Not available`, not `0`.

- [ ] **Step 2: Run the browser test and verify failure**

```bash
node tests/research-workspace-browser.mjs
```

Expected: build/module failure because the component does not exist.

- [ ] **Step 3: Implement `MioResearchWorkspace`**

Required UI:

- heading `Equal Parenting Research`;
- counters for total, draft, needs review, published, archived;
- search box covering title/authors/DOI/year/country;
- filters for direction, source type, exact/near 50/50, topic, access status, editorial status;
- sort controls for Evidence Strength, Impact, Relevance, Historical Importance, newest, title;
- table columns: Title, Year, Direction, Type, 50/50, Evidence, Impact, Access, Status;
- `New publication` button;
- row click/Edit button;
- visible explanation that Direction does not change quality/impact scores.

Keep component state local; do not persist filter settings in `localStorage`.

- [ ] **Step 4: Implement responsive CSS**

`src/mioResearch.css` must keep filters usable at 390px width and allow the results table to horizontally scroll without overflowing the whole page. Direction colors may aid scanning, but text labels must communicate meaning without color.

- [ ] **Step 5: Run model/repository/browser tests**

```bash
node --test tests/research-model.test.js tests/research-repository.test.js
node tests/research-workspace-browser.mjs
```

Expected: PASS with no page errors at desktop and mobile viewports.

- [ ] **Step 6: Commit**

```bash
git add src/MioResearchWorkspace.jsx src/mioResearch.css tests/research-workspace-browser-fixture.jsx tests/research-workspace-browser.mjs
git commit -m "feat: add Mio research workspace"
```

---

### Task 6: Add the publication editor, child analyses, access, metrics, review memberships, and publishing gate

**Files:**
- Create: `src/MioResearchEditor.jsx`
- Modify: `src/MioResearchWorkspace.jsx`
- Modify: `tests/research-workspace-browser-fixture.jsx`
- Modify: `tests/research-workspace-browser.mjs`

**Interfaces:**
- Consumes: `{publicationId,onClose,supabase,session}`.
- Produces saved publication bundle via repository functions; calls `validatePublicationForPublish` before any status change to `published`.

- [ ] **Step 1: Extend the browser test with failing editor workflow assertions**

Test this complete synthetic workflow:

1. open a draft unfavorable study;
2. change its direction to favorable and confirm score fields do not change automatically;
3. restore unfavorable direction;
4. add a study analysis with `parenting_time_definition='50/50 alternating weeks'`, exact-50 true, and causal strength `low`;
5. add a publisher access link;
6. add citation metric `123`, provider `OpenAlex`, captured date;
7. save and close, reopen, and confirm values persist through the fake repository;
8. attempt Publish with missing findings summary -> blocked with validation message;
9. enter findings summary -> Publish becomes successful;
10. confirm the fake save recorded `editorial_status:'published'` and a nonblank `published_at`.

- [ ] **Step 2: Run browser test and verify failure**

```bash
node tests/research-workspace-browser.mjs
```

Expected: FAIL because editor controls do not exist.

- [ ] **Step 3: Implement editor sections**

The editor must have these explicit sections:

- **Bibliography:** title, authors, year, journal/publisher, DOI, source type, country, admission route.
- **Research conclusion:** direction, findings summary, limitations, what it supports, what it does not establish.
- **Scores:** four nullable 0–100 fields plus visible scoring-note fields; changing direction never alters scores.
- **Topics:** controlled topic checkboxes/multi-select.
- **Studies / analyses:** add/edit/delete nested analyses with sample, age, exact parenting-time definition, exact-50 flag, design, controls, effect size, result, limitation, causal strength, extraction status.
- **Access:** canonical/publisher/OA/repository/purchase/Mio-copy link type, access status, license, redistribution permission, public visibility, preferred link. If `link_type==='mio_public_copy'`, UI must force `is_public=false` until `redistribution_permitted===true`.
- **Metrics:** provider, type, numeric value, source URL, captured date; blank value means no metric, not zero.
- **Review membership:** choose review publication, membership status/note, optional verified date.
- **Editorial status:** Draft -> Needs Review -> Published -> Archived. Publish uses model validation and shows all blocking errors together.

Use plain forms and existing Mio visual conventions; do not add another UI dependency.

- [ ] **Step 4: Save atomically from the user's perspective**

The editor save sequence must:

1. save publication row;
2. replace child studies;
3. replace access links;
4. replace metrics;
5. replace memberships;
6. reload the full bundle;
7. only then show `Saved`.

If child save N fails, show a precise error (`Publication saved, but access links failed: ...`) and keep the editor open. Do not falsely report full success.

- [ ] **Step 5: Run browser test**

```bash
node tests/research-workspace-browser.mjs
```

Expected: PASS, including publish-validation and direction-score independence.

- [ ] **Step 6: Commit**

```bash
git add src/MioResearchEditor.jsx src/MioResearchWorkspace.jsx tests/research-workspace-browser-fixture.jsx tests/research-workspace-browser.mjs
git commit -m "feat: add research publication editor"
```

---

### Task 7: Integrate the workspace into Mio without hand-editing feature logic into `App.jsx`

**Files:**
- Create: `mio-v318-equal-parenting-research.js`
- Modify: `vite.config.js`
- Create: `tests/research-integration.test.js`

**Interfaces:**
- Consumes: current `src/App.jsx` text at V317-era anchors.
- Produces: an idempotent Vite pre-transform that imports/renders `MioResearchWorkspace` and adds one navigation entry.

- [ ] **Step 1: Write the failing checked-transform tests**

Follow `tests/ads-workspace-integration.test.js` and `mio-v317-ads-workspace.js` patterns:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {applyEqualParentingResearch} from '../mio-v318-equal-parenting-research.js'
const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')

test('research integration adds exactly one import, nav entry, and workspace',()=>{
  const r=applyEqualParentingResearch(source)
  assert.equal((r.match(/MioResearchWorkspace/g)||[]).length>=2,true)
  assert.equal((r.match(/Equal Parenting Research/g)||[]).length,1)
  assert.equal(applyEqualParentingResearch(r),r)
})

test('missing navigation/page anchors refuse a partial installation',()=>{
  assert.throws(()=>applyEqualParentingResearch('missing'),/research integration anchors/i)
})
```

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/research-integration.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement a checked Vite pre-transform**

`mio-v318-equal-parenting-research.js` must:

- export `applyEqualParentingResearch(source)`;
- add marker `/* MIO_EQUAL_PARENTING_RESEARCH_V318 */` and return unchanged if marker already exists;
- inject `import MioResearchWorkspace from './MioResearchWorkspace.jsx'`;
- add exactly one navigation action labeled `Equal Parenting Research` that sets the app's existing page state to `equal_parenting_research`;
- add exactly one render branch that supplies `{session,supabase,enabled:true}`;
- use exact-count anchors and throw if expected nav/render anchors are missing or duplicated;
- change only the release label needed for V318, not unrelated App content.

The executor must derive the exact current nav/render anchor strings from the checked-in `src/App.jsx` immediately before writing the transform; the test must freeze those exact anchors so a future App change fails loudly instead of partially installing the feature.

- [ ] **Step 4: Wire the transform into Vite**

In `vite.config.js`:

```js
import equalParentingResearch from './mio-v318-equal-parenting-research.js'
```

Place `equalParentingResearch()` after `adsWorkspace()` and before `react()` so all earlier Vite App transforms have already produced the current V317 structure while React still compiles the resulting JSX.

- [ ] **Step 5: Run integration, browser syntax, and build checks**

```bash
node --test tests/research-integration.test.js tests/browser-syntax.test.js
npm run build
```

Expected: all PASS; production build succeeds.

- [ ] **Step 6: Commit**

```bash
git add mio-v318-equal-parenting-research.js vite.config.js tests/research-integration.test.js
git commit -m "feat: integrate research workspace into Mio"
```

---

### Task 8: Import the real inventory, verify publication security, and run the Phase 1 regression gate

**Files:**
- Modify only if verification exposes a defect: files created in Tasks 1–7.
- No new production file is expected in this task.

**Interfaces:**
- Consumes: live connected `casecontrollermio` Supabase project and `/mnt/data/equal_parenting_research_inventory_v1.xlsx` (or the same workbook copied to an accessible local path).
- Produces: 90 draft research publications plus child access/metric/review-membership records; zero public rows until an editor explicitly publishes a record.

- [ ] **Step 1: Run the importer against the connected Supabase project**

Run with service credentials in the process environment only:

```bash
SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
node scripts/import-equal-parenting-research.mjs /mnt/data/equal_parenting_research_inventory_v1.xlsx
```

Expected: 90 publication identities processed; new records remain `draft`.

- [ ] **Step 2: Immediately run the same import again to prove idempotency**

Run the identical command again.

Expected: publication count remains 90; no duplicate DOI/Work-ID rows; membership/metric/access counts do not double.

- [ ] **Step 3: Verify live database counts and the public boundary**

Run read-only SQL:

```sql
select editorial_status,count(*) from public.research_publications group by editorial_status order by editorial_status;
select count(*) as publications from public.research_publications;
select count(*) as public_catalog_rows from public.research_public_catalog;
select count(*) as memberships from public.research_review_memberships;
select count(*) as metrics from public.research_metrics;
```

Expected immediately after import:

- `research_publications = 90`;
- all imported publication rows are `draft` unless a pre-existing record had already advanced status;
- `research_public_catalog = 0` for an all-new inventory because drafts are never exposed;
- imported review membership and metric counts match one import, not two.

Then publish exactly one harmless test/real reviewed record through Mio and verify `research_public_catalog` becomes `1`; set it back to `draft` if it was published only for the security test.

- [ ] **Step 4: Verify anonymous access behavior**

Using the Supabase anon key in a read-only request:

- querying `research_public_catalog` succeeds;
- querying `research_publications` fails/returns permission denied;
- private `internal_notes`, `inventory_raw`, `score_notes`, and non-public access links are absent from the public view payload.

- [ ] **Step 5: Run complete Phase 1 automated checks**

```bash
node --test tests/research-migration.test.js tests/research-model.test.js tests/research-repository.test.js tests/research-inventory.test.js tests/research-integration.test.js tests/browser-syntax.test.js
node tests/research-workspace-browser.mjs
npm run build
```

Expected: all PASS with no browser page errors and a successful production build.

- [ ] **Step 6: Visual browser verification**

Run Mio against synthetic/test data and capture desktop (1440x1000) and mobile (390x844) screenshots of:

- research list with filters visible;
- publication editor Bibliography/Conclusion sections;
- studies/access/metrics sections;
- publish-validation errors;
- a published-ready record.

Confirm no horizontal page overflow on mobile, table-only horizontal scrolling, readable labels without relying on color, and no console errors.

- [ ] **Step 7: Commit any verification-only fixes, then final verification commit if needed**

If no fixes are needed, do not create a meaningless commit. If fixes were required:

```bash
git add <only the corrected research files>
git commit -m "fix: verify research workspace import and publishing"
```

---

## Phase 1 Completion Gate

Do not claim Phase 1 complete until all of the following are true:

- normalized research tables and RLS exist in the live `casecontrollermio` project;
- anonymous users have no base-table research access;
- the published-only view exposes only fields intended for the future public site;
- the current inventory imports idempotently as 90 publication records;
- favorable and unfavorable rows use identical validation/scoring rules;
- publication and study/analysis records remain separate;
- Mio can search/filter/sort/edit/save/publish/archive records;
- lawful access/redistribution status is explicit and a private copy cannot leak through the public view;
- missing metrics remain null/not available;
- browser tests pass at desktop and mobile widths;
- existing browser-syntax tests and `npm run build` pass;
- no public website code has been invented or modified before the actual BeveridgeLawFirm.com source becomes accessible.

## Deferred to Phase 2

Phase 1 deliberately does **not** implement the public `beveridgelawfirm.com/equal-parenting-research/` pages, individual study SEO routes, XML sitemap, downloadable public dataset, or structured data. The database/view created here is the contract those pages will consume after the actual website repository becomes available.
