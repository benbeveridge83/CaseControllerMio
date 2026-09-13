# Equal Parenting Research Hub — Design

Date: 2026-09-12
Status: Design approved in concept; implementation pending written-spec review
Systems: Case Controller Mio / Supabase / Beveridge Law Firm public website

## 1. Goal

Create a public, searchable Equal Parenting Research Database on BeveridgeLawFirm.com while using Mio/Supabase as the single editorial source of truth.

The resource must:

- include favorable, neutral, mixed, conditional, and unfavorable research under the same admission and scoring rules;
- distinguish publication-level records from separate studies/analyses contained in one publication;
- expose enough original structured analysis to be useful to parents, lawyers, researchers, journalists, and policymakers;
- provide lawful full-text access where possible and purchase/publisher links where not;
- support SEO through indexable hub, study-detail, and later topic pages;
- preserve methodology and uncertainty rather than turning the database into an advocacy-only list;
- support ongoing enrichment as new studies and impact metrics are added.

## 2. Existing context

Case Controller Mio is a React/Vite application using Supabase. It is the appropriate internal editorial interface and data owner for this project.

The public law-firm website already exposes an Equal Parenting Toolkit link. The research database should sit within that public equal-parenting content hierarchy rather than becoming a disconnected microsite.

The public website repository is not currently visible through the connected GitHub account, and the connected Vercel account is not exposing projects. Therefore this spec defines a framework-independent public-site contract. Website implementation should be applied to the actual site repository once that source is available; no website repository or framework should be guessed.

## 3. Approaches considered

### A. Static spreadsheet/JSON copied into the website

Pros: fastest initial launch.

Cons: creates multiple sources of truth, makes corrections hard to propagate, weakens editorial workflow, and eventually becomes error-prone.

Decision: reject as the primary architecture. A downloadable CSV/XLSX can still be generated as an export.

### B. Supabase/Mio source of truth with a public published-data contract — RECOMMENDED

Mio manages research records and review state. Supabase stores records. The public website reads only records explicitly marked Published and pre-renders/indexes them.

Pros: one source of truth; supports continuous updates, filtering, metrics, PDF/access status, and SEO; separates internal research notes from public fields.

Cons: requires a carefully limited public read surface and publication workflow.

Decision: use this approach.

### C. Mio-owned API proxy as the only way the website reads data

Pros: strongest central control and easy future transformation.

Cons: adds runtime coupling, another failure point, and unnecessary complexity for primarily public read-only content.

Decision: do not require this initially. Add a proxy later only if the actual website framework or security model makes it useful.

## 4. Core architecture

### 4.1 Source of truth

Supabase stores the normalized research records. Mio provides the private editorial UI. The public website never writes research data.

### 4.2 Publication boundary

Every public-facing research record has an editorial state:

- `draft`
- `needs_review`
- `published`
- `archived`

Only `published` records may appear on the public website or public dataset export.

### 4.3 Public read contract

Expose a safe published-only representation containing only public fields. This can be implemented as a Supabase view/RPC/Edge Function or an equivalent build-time endpoint, depending on the public website's actual framework.

The public contract must exclude:

- private attorney notes;
- internal acquisition notes;
- copyrighted files that are not licensed for redistribution;
- unpublished scoring comments;
- credentials or administrative metadata.

The public website should pre-render or server-render indexable HTML from the published data. A client-only table is not sufficient for study-detail SEO.

## 5. Data model

### 5.1 `research_publications`

One row per unique publication.

Core fields:

- `id`
- `slug`
- `title`
- `authors_text`
- `publication_year`
- `journal_or_publisher`
- `doi`
- `source_type`
- `country_text`
- `citation_text`
- `abstract_summary`
- `overall_findings_summary`
- `limitations_summary`
- `what_it_supports`
- `what_it_does_not_establish`
- `finding_direction`
- `evidence_strength_score`
- `impact_score`
- `equal_parenting_relevance_score`
- `historical_field_importance_score`
- `editorial_status`
- `published_at`
- `updated_at`

`finding_direction` values:

- `favors_shared`
- `neutral`
- `mixed`
- `conditional_concern`
- `disfavors_shared`
- `methodology_only`

Source types should include at least:

- original empirical study
- longitudinal study
- natural/quasi-natural experiment
- systematic review
- meta-analysis
- narrative review
- consensus report
- methodology/critique
- policy/legal study

### 5.2 `research_studies`

One publication may contain one or more distinct study samples/analyses. This prevents review counts such as “60 studies” from being mistaken for 60 unique publications.

Core fields:

- `id`
- `publication_id`
- `study_label`
- `sample_size`
- `child_age_text`
- `age_min`
- `age_max`
- `parenting_time_definition`
- `shared_time_min_percent`
- `shared_time_max_percent`
- `exact_or_near_50_50`
- `study_design`
- `outcomes_measured`
- `controls_summary`
- `longitudinal`
- `pre_separation_controls`
- `effect_size_summary`
- `result_summary`
- `causal_claim_strength`

Suggested causal-strength values:

- high
- moderate
- low
- very_low
- not_applicable

### 5.3 `research_access_links`

Allow multiple lawful access paths per publication.

Fields:

- `id`
- `publication_id`
- `link_type`
- `url`
- `access_status`
- `license_text`
- `redistribution_permitted`
- `is_preferred`
- `checked_at`

Link types should include:

- canonical/DOI
- publisher
- PubMed/abstract
- open-access HTML
- open-access PDF
- repository manuscript
- Mio/public hosted copy
- purchase/paywall

Access status should support:

- Mio/public copy
- free full text
- free manuscript
- abstract only
- paywalled
- purchase required
- unavailable

A public/Mio-hosted copy may be used only when redistribution is legally permitted. Merely being downloadable does not establish permission to republish.

### 5.4 `research_metrics`

Metrics must be timestamped because they change.

Fields:

- `id`
- `publication_id`
- `provider`
- `metric_type`
- `metric_value`
- `source_url`
- `captured_at`

Metric types may include:

- citation_count
- citations_per_year
- FWCI
- influential_citations
- Altmetric score
- Mendeley readers
- publisher views
- publisher downloads
- policy citations

### 5.5 `research_reviews` and `research_review_memberships`

Track major reviews/meta-analyses and which publications/studies they include.

`research_reviews` may either reference an existing review publication or contain only review-specific metadata.

`research_review_memberships` fields:

- `review_publication_id`
- `included_publication_id`
- optional `included_study_id`
- `membership_note`
- `verified_at`

This allows public/internal displays such as “Included in 5 major reviews.”

### 5.6 Topics/tags

Use controlled tags for filtering. Initial topics:

- mental health
- psychosomatic/physical health
- attachment
- infants/toddlers
- preschool
- school age
- adolescents
- academic achievement
- delinquency/risky behavior
- parent-child relationship
- father-child relationship
- conflict
- high conflict
- coparenting
- stability/transitions
- policy/legal reform
- child support/incentives
- selection bias/confounding
- measurement/methodology

A publication can have multiple tags.

## 6. Scoring model

Result direction must never affect score.

Publicly expose four distinct scores rather than a single opaque ranking:

1. **Impact** — citations, normalized citations, review inclusion, policy influence, readership/attention.
2. **Evidence Strength** — research design, sample, longitudinal quality, controls, causal identification, measurement quality.
3. **Equal-Parenting Relevance** — how directly the work tests shared/equal parenting rather than an adjacent mechanism.
4. **Historical/Field Importance** — foundational importance, including older work that shaped later research or policy.

Store score components or score explanations so the number can be audited later.

## 7. Mio editorial experience

Add an internal Equal Parenting Research area in Mio with:

- sortable/filterable publication table;
- search by title, author, DOI, year, topic, country, result direction;
- publication detail editor;
- nested Study/Analysis records;
- review-membership editor;
- access-link/license editor;
- impact-metric snapshots;
- scoring fields and scoring notes;
- publication-status controls;
- “Preview public page” link once the website route exists;
- duplicate detection using DOI, normalized title, and author/year similarity.

Initial import should ingest the current research inventory as Draft records, not automatically publish every row.

## 8. Public website experience

### 8.1 Main hub

Route:

`/equal-parenting-research/`

Working title:

**Equal Parenting Research Database**

Subtitle:

**A searchable database of research on shared physical custody, 50/50 parenting time, and child outcomes**

Hero/intro should state:

- number of published publications;
- date last updated;
- that favorable, neutral, mixed, conditional, and unfavorable studies are included;
- that study quality and impact are scored separately from study direction;
- that “shared parenting” definitions vary and each study's actual definition is preserved.

### 8.2 Public filters

Initial filters:

- result direction
- exact/near 50/50
- shared-time threshold where known
- source/design type
- age group
- topic/outcome
- country
- year range
- Evidence Strength
- Impact
- full-text availability

Default sorting should favor usefulness, not ideological direction. Recommended default:

1. Evidence Strength descending
2. Impact descending
3. publication year descending

Allow alternate sorts for newest, most cited, highest impact, and highest relevance.

### 8.3 Study/publication detail pages

Route:

`/equal-parenting-research/{slug}/`

Each page should contain:

- title
- authors/year/journal
- source type
- country/sample/child ages
- actual shared-parenting definition
- study design
- outcomes measured
- controls
- principal findings
- effect sizes where available
- finding-direction label
- Evidence Strength
- Impact
- Equal-Parenting Relevance
- Historical/Field Importance
- strengths
- limitations
- “What this study supports”
- “What this study does not establish”
- review memberships
- citation metrics with metric date/provider
- DOI/canonical link
- preferred lawful full-text link
- purchase/paywall link where needed
- formal citation
- related studies

Do not republish copyrighted abstracts or articles beyond permissible quotation/summary limits.

### 8.4 Topic pages — phase 2

Once enough records are tagged, generate indexable pages such as:

- `/equal-parenting-research/50-50-custody/`
- `/equal-parenting-research/high-conflict/`
- `/equal-parenting-research/infants-toddlers/`
- `/equal-parenting-research/mental-health/`
- `/equal-parenting-research/academic-achievement/`
- `/equal-parenting-research/negative-mixed-findings/`

These pages must contain original editorial introductions and summaries, not merely duplicate filtered tables.

## 9. SEO and structured data

### 9.1 Indexability

- main hub must have indexable server/pre-rendered content;
- each published study must have a unique canonical URL;
- title and meta description must be publication-specific;
- study detail should be linked from the hub and relevant topic pages;
- XML sitemap must include published study-detail and topic pages;
- archived/unpublished records must not remain indexed as stale duplicates.

### 9.2 Structured data

Use structured data appropriate to the actual page content:

- `Dataset` for the master downloadable dataset/resource;
- `Article` or another applicable scholarly/content schema for editorial pages when valid;
- `BreadcrumbList` for navigation hierarchy.

Do not add schema solely because it exists; markup must match visible page content.

### 9.3 Downloadable dataset

Publish versioned exports of the public fields in at least CSV and XLSX; JSON is desirable for reuse.

The dataset landing page should identify:

- dataset name
- creator
- version/update date
- methodology/inclusion rules
- license for the database compilation itself
- distributions/download formats

The export must not include copyrighted article PDFs or internal Mio notes.

## 10. Content integrity rules

### 10.1 Admission philosophy

Seed/anchor materials include:

- Linda Nielsen's major shared-physical-custody reviews and the studies analyzed in them;
- Richard Warshak's *Social Science and Parenting Plans for Young Children: A Consensus Report*;
- Bergström et al., *Fifty moves a year: is there an association between joint physical custody and psychosomatic problems in children?*;
- major systematic reviews/meta-analyses and their included studies;
- later papers that materially test, qualify, replicate, or challenge important earlier findings;
- empirical legal/policy studies involving shared/equal-parenting presumptions or statutory reforms;
- attachment/overnight studies relevant to young children;
- methodological papers addressing definitions, selection effects, causation, or measurement.

No publication is excluded because its result is unfavorable to shared/equal parenting.

### 10.2 Direction vs quality

Finding direction is descriptive. It must not change Impact, Evidence Strength, Relevance, or Historical Importance scores.

### 10.3 Definitions

Never treat “joint physical custody,” “shared residence,” “alternating residence,” and “50/50” as automatically equivalent.

Store each paper's actual parenting-time definition and use public filters to distinguish true/near 50/50 from broader 30/70 or similar definitions.

### 10.4 Causation

Every empirical study should receive a causal-claim-strength field. Public prose must not state causation when the design only supports association.

## 11. File/PDF handling

Preferred access order for visitors:

1. lawfully hosted public/Mio copy, when redistribution is permitted;
2. lawful open-access publisher/repository full text;
3. publisher/canonical full-text page;
4. purchase/paywall page;
5. abstract/index page.

Supabase Storage may hold internal research copies as permitted for internal use, but internal possession does not automatically authorize public redistribution.

Public PDF paths must be separate from private/internal storage paths.

## 12. Error handling and resilience

- A broken external study link must not break the public study page.
- If an impact metric is unavailable, show “not available” rather than zero.
- If a parenting-time percentage is unknown, do not infer one from labels such as JPC.
- If full text is unavailable, retain DOI/canonical/purchase links.
- If a record is unpublished or archived, public endpoints must not expose it.
- If the public data source is unavailable during a build, retain the last successful published build rather than emitting empty study pages.

## 13. Testing

### Data tests

- one publication can contain multiple study analyses without duplicate-publication counts;
- DOI/title duplicate detection works;
- unpublished records never appear in the public contract;
- negative findings receive no scoring penalty;
- missing metrics remain null, not zero;
- access status does not claim redistributability without an affirmative license/permission field.

### Mio UI tests

- create/edit/publish/archive publication;
- add separate study analyses;
- add access links and select preferred access;
- add/update metric snapshot;
- add review membership;
- filter by direction, design, age, topic, and access status.

### Public-site tests

- hub renders useful HTML without requiring client JavaScript;
- filter controls work without changing canonical study URLs;
- study-detail pages contain unique title/description/content;
- unpublished slugs are inaccessible;
- structured data validates;
- sitemap includes published records only;
- canonical tags are correct;
- external-link failure does not break page rendering.

## 14. Rollout phases

### Phase 1 — Data foundation + Mio editorial UI

- create Supabase schema/migrations;
- add Mio Equal Parenting Research area;
- import the existing research inventory as Draft;
- support access links, metrics, review memberships, scoring, and publish state;
- expose a published-only data contract.

### Phase 2 — Public hub + study pages

Once the actual public website source is available:

- add `/equal-parenting-research/`;
- add one indexable route per published study;
- add search/filtering;
- add dataset download;
- add structured data, sitemap, and internal links from Equal Parenting Toolkit and relevant family-law pages.

### Phase 3 — Topic/editorial pages

- generate curated topic indexes;
- add original editorial summaries;
- cross-link studies and topics;
- add update/changelog page.

### Phase 4 — Metric refresh and enrichment automation

- automated OpenAlex/other permitted metric refresh;
- stale-link checking;
- duplicate/review-membership assistance;
- editorial queue for newly discovered papers.

Automation must never auto-publish a newly discovered or materially changed study without editorial review.

## 15. Security/privacy

- public read surface is published-only and field-limited;
- service-role keys never ship to the browser;
- Mio editing remains authenticated;
- internal notes/private files are never included in public export;
- public download endpoints cannot enumerate private Supabase Storage objects;
- database policies should default to no anonymous write access.

## 16. Success criteria

Phase 1 is successful when:

- current inventory can be imported without losing publication-vs-study distinctions;
- records can be reviewed, scored, linked, and published in Mio;
- a safe published-only payload is available for the public site;
- negative, neutral, mixed, and favorable studies can be filtered identically;
- lawful access status is explicit for each record.

Phase 2 is successful when:

- the public research hub and individual study pages are indexable;
- users can meaningfully filter and sort the evidence;
- every public study has a stable canonical page and source/access links;
- the website can be updated by publishing in Mio rather than manually editing duplicate study data.

## 17. Explicit non-goals for initial release

- no automated legal conclusion such as “science proves 50/50”;
- no automatic exclusion of unfavorable studies;
- no public hosting of copyrighted paywalled PDFs without redistribution rights;
- no attempt to replace scholarly databases;
- no AI-generated score without visible criteria/auditability;
- no requirement to finish every known study before launch.

## 18. Current implementation dependency

The connected GitHub account does not expose a repository identifiable as the current BeveridgeLawFirm.com site, and the connected Vercel account currently exposes no projects. Phase 1 can proceed in CaseControllerMio. Phase 2 code must wait until the actual public-site source is accessible; the implementation must not invent a repository or framework.
