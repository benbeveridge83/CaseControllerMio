# Equal Parenting Research Phase 1.5 — Enrichment and Importance Design

Date: 2026-09-13
Status: User-approved scope; written design for review before implementation
System: Case Controller Mio / Supabase

## 1. Problem

Phase 1 successfully created the research data model and imported 90 publication records, but the current Equal Parenting Research screen is still primarily a bibliography.

Live production inspection on 2026-09-13 confirmed:

- 90 publications;
- 0 publications with Evidence Strength scores;
- 0 publications with Impact scores;
- 0 publications with Equal-Parenting Relevance scores;
- 0 publications with Historical/Field Importance scores;
- 0 `research_studies` analysis rows;
- 0 findings summaries;
- 0 limitations summaries;
- 0 `what_it_supports` summaries;
- only 10 metric snapshots total, of which 4 are citation counts;
- 68 publications with DOI values.

The UI also currently converts missing study-analysis data into a false “No” in the 50/50 column. A publication with no coded study rows is therefore visually represented as “not 50/50,” when the correct state is “Unknown / not yet coded.”

The goal of Phase 1.5 is to turn the current publication inventory into a substantive, sortable research database before exposing it on the public law-firm website.

## 2. Phase 1.5 outcome

When Phase 1.5 is complete, a researcher should be able to look at Mio and immediately determine:

- what the paper studied;
- what it found;
- whether it studied actual equal/near-equal parenting time or a broader JPC/shared-custody category;
- sample size and child age;
- study design;
- important controls;
- what conclusions the design does and does not support;
- how often the paper has been cited;
- how quickly it is being cited;
- how many major reviews in the database include it;
- whether it has normalized/high-impact citation signals;
- the paper's Evidence Strength, Impact, Equal-Parenting Relevance, and Historical/Field Importance scores;
- where to read the paper or publisher page.

Finding direction remains completely separate from quality and importance scoring.

## 3. Approaches considered

### A. Manually enrich all 90 records one at a time

Pros: maximum editorial control.

Cons: slow, difficult to refresh citation data, high risk of inconsistent scoring and fields.

Decision: do not use as the primary method.

### B. Fully automatic enrichment and automatic publication

Pros: fast.

Cons: unacceptable risk of DOI/title mismatches, incorrect abstract interpretation, false causal claims, and opaque scoring.

Decision: reject. Automation may propose metadata and draft analyses, but it must not auto-publish research conclusions.

### C. Automated bibliometrics + structured extraction + editorial verification — RECOMMENDED

Use reliable scholarly metadata APIs to enrich bibliometrics for all records automatically. Use abstracts/lawful full text to create structured analysis drafts. Make the scoring rubric deterministic and auditable. Require editorial verification for substantive study-analysis fields before public publication.

Decision: use this approach.

## 4. Immediate UI corrections

Before deeper enrichment, correct misleading or low-information UI states.

### 4.1 Tri-state 50/50 display

The list must distinguish:

- `Yes` — at least one verified or reviewed study analysis explicitly has `exact_or_near_50_50=true`;
- `No` — coded study analyses exist and none qualifies as exact/near 50/50;
- `Unknown` — there is not enough coded study-analysis data to answer.

Never infer `No` merely because no study rows exist.

### 4.2 Main list columns

Replace the current low-information table with these primary columns:

1. Study / Publication
2. Year
3. Finding
4. Parenting-Time Definition / 50/50
5. Sample
6. Cited By
7. Citations / Year
8. Major Reviews
9. Evidence
10. Impact
11. Study Link
12. Status

Source type, relevance, historical importance, access status, and other fields remain available in filters/detail views rather than occupying the primary table by default.

### 4.3 Clickable study access

The list must expose a real clickable study action:

Preferred order:

1. lawful public/Mio-hosted copy if redistribution is permitted;
2. lawful open-access full text;
3. publisher/canonical full text;
4. purchase/paywall page;
5. DOI/abstract page.

The title remains an internal Mio editor link. A separate `Read study` / `Open source` action opens the external/public study source.

### 4.4 Findings preview

Once populated, show a one- or two-line finding summary below the title on wide screens. Do not show generated or unverified prose as if it were verified.

## 5. Bibliometric enrichment

### 5.1 Primary matching

Use publication DOI as the preferred external identity.

Fallback matching is allowed only when DOI is absent:

1. normalized title exact/high-similarity match;
2. publication year agreement;
3. first-author agreement where available.

Low-confidence fallback matches must be flagged for review and must not overwrite existing verified identifiers.

### 5.2 Metric providers

Use snapshots rather than destructive replacement so metric history is preserved.

Preferred sources:

- OpenAlex: citation count, FWCI/normalized citation indicator where available, open-access location metadata, publication metadata;
- Semantic Scholar: citation count and influential citation count when available;
- Crossref/publisher: fallback citation count or publisher-specific usage/metadata where appropriate;
- Existing publisher views/access counts may remain as separate attention metrics.

The user-facing `Cited By` figure uses the latest OpenAlex citation count when available. If OpenAlex is unavailable for a matched work, use the best verified fallback and visibly retain the provider.

Do not merge counts from different providers into one numeric total.

### 5.3 Derived bibliometric fields

For each publication calculate/store or expose:

- citation count;
- citation provider;
- metric capture date;
- citations per year;
- FWCI/normalized citation signal where available;
- influential citation count where available;
- number of verified major-review memberships.

`citations_per_year` is calculated from the citation count and publication year using the current calendar year, with a minimum denominator of 1.

Missing metrics remain null / `Unknown`, never zero.

## 6. Review inclusion count

`Major Reviews` is not manually typed. It is computed from verified `research_review_memberships` where the publication is the included/member work.

The detail view lists the actual review titles.

Review inclusion is an importance signal, not a quality guarantee.

## 7. Study-analysis enrichment

### 7.1 Publication vs analysis remains separate

A publication can contain multiple samples or analyses. Do not flatten these into a single fake study.

A publication list row may show a compact summary derived from its child study rows; the editor/detail view preserves every distinct analysis.

### 7.2 Structured extraction fields

For empirical studies, populate as available:

- sample size;
- country;
- child age range/text;
- exact parenting-time definition;
- minimum/maximum shared-time percentage where explicitly reported;
- exact/near 50/50 tri-state;
- comparator;
- study design;
- outcome domains/measures;
- longitudinal status;
- pre-separation controls;
- conflict controls;
- SES controls;
- other important controls;
- effect-size/statistical estimate summary;
- result direction;
- result summary;
- key limitation;
- causal-claim strength;
- extraction source;
- extraction verification status.

For systematic reviews, meta-analyses, consensus reports, and methodology papers, use publication-level synthesis fields and only create child study rows when the publication itself contains distinct analyses that warrant them.

### 7.3 Evidence sources

Extraction may use:

- lawful open-access full text;
- publisher full text the firm is legally permitted to access;
- accepted manuscripts/repositories;
- PubMed/publisher abstracts;
- structured metadata from scholarly APIs.

A field derived only from an abstract must not be presented as full-text verified. Store provenance/verification status.

### 7.4 Editorial verification

Automation may create `unverified` or `needs_review` analyses.

Only verified analyses may drive strong public claims, definitive 50/50 classification, or high-confidence evidence scoring.

## 8. Findings and limitations

Populate these publication-level fields from verified analysis:

- `overall_findings_summary`;
- `limitations_summary`;
- `what_it_supports`;
- `what_it_does_not_establish`.

Required editorial language rules:

- distinguish association from causation;
- distinguish broad shared custody from true 50/50;
- state when advantages disappear after controls;
- state when results apply only to a subgroup (e.g. infants, persistent high conflict);
- preserve mixed or null findings rather than forcing a binary favorable/unfavorable interpretation;
- never infer missing study details.

## 9. Evidence Strength score

Evidence Strength is independent of finding direction.

The score is 0–100 and must store component details in `score_notes` so it can be audited.

### 9.1 Empirical-study rubric

Suggested components:

- Design / causal identification: 0–40
- Sample size / power: 0–15
- Confounding controls: 0–20
- Measurement quality: 0–10
- Attrition / missingness / bias handling: 0–10
- Transparency / replication / preregistration where relevant: 0–5

Examples for design component only:

- strong natural/quasi-experimental design: up to 40;
- longitudinal with meaningful baseline/pre-separation controls: up to 32;
- longitudinal without strong baseline controls: up to 27;
- cross-sectional adjusted comparison: up to 20;
- descriptive/unadjusted comparison: up to 10.

The total is not calculated until enough methodology fields are available. Unknown components remain unknown; they are not automatically scored as zero.

### 9.2 Review/synthesis rubric

Reviews use a separate component set rather than pretending to be empirical samples:

- systematic search/selection method;
- breadth/completeness;
- risk-of-bias/quality assessment;
- quantitative synthesis/heterogeneity handling where applicable;
- transparency/reproducibility;
- relevance of underlying evidence.

Narrative reviews and consensus reports may have field importance without receiving a high Evidence Strength score.

## 10. Equal-Parenting Relevance score

This score measures directness to the user’s research question, not whether the result favors equal parenting.

Use an auditable rubric centered on the actual parenting-time definition:

- 95–100: explicit equal/50-50 or near-equal residence;
- 85–94: narrow near-equal range such as approximately 40/60–60/40;
- 65–84: broader shared-residence threshold such as 30/70;
- 45–64: JPC/shared residence without a sufficiently precise time threshold;
- 25–44: adjacent overnight/young-child/contact literature relevant to parenting plans but not equal residence;
- 10–24: legal/policy/mechanism study relevant to equal-parenting policy but not direct child residence-outcome comparison;
- 0–9: contextual/methodological material with only indirect relevance.

Direct child outcomes may increase the score within the applicable range but may not move an imprecise JPC definition into the exact-50 category.

## 11. Impact score

Impact measures scholarly/field influence, not quality and not result direction.

Use a transparent composite of available normalized components:

- citation-count percentile within the research database: 35%;
- citations/year percentile: 20%;
- FWCI/normalized citation indicator: 15%;
- influential-citation signal: 10%;
- verified major-review inclusion: 15%;
- documented policy/legal influence: 5%.

If a component is unavailable, normalize over the available weights rather than treating missing data as zero. Also store an `impact_data_completeness` percentage so an 80 based on two components is not visually equivalent to an 80 based on all components.

The list may display `80 (75% data)` or use a tooltip/detail indicator for completeness.

## 12. Historical / Field Importance

Historical/Field Importance is distinct from current citation impact.

It captures foundational role even where methodology is dated.

Inputs may include:

- explicit anchor/foundational designation;
- inclusion in multiple major reviews;
- unusually durable citation influence across years;
- role in later methodological debate;
- demonstrated policy/legal influence;
- whether subsequent papers directly replicate, challenge, or build on the work.

This score may be partly editorial, but every nontrivial score must include a note explaining why.

## 13. Main-table importance signals

The Mio list must support sorting by:

- Cited By;
- Citations / Year;
- Major Reviews;
- Evidence Strength;
- Impact;
- Equal-Parenting Relevance;
- Historical/Field Importance;
- publication year;
- title.

A missing score always sorts after actual scores.

## 14. Database changes

Phase 1.5 should add/standardize publication-level summary fields needed for fast sorting and later public-site use. Suggested additions:

- `citation_count_current` integer nullable;
- `citation_count_provider` text nullable;
- `citation_count_captured_at` timestamptz nullable;
- `citations_per_year` numeric nullable;
- `fwci_current` numeric nullable;
- `influential_citation_count_current` integer nullable;
- `major_review_count` integer not null default 0;
- `impact_data_completeness` integer nullable check 0–100;
- `analysis_completion_status` text;
- `analysis_verified_at` timestamptz nullable.

These are summary/cache fields. `research_metrics` remains the historical snapshot source of truth for external metrics.

The sanitized public cache should be extended with the safe summary fields when they are available so Phase 2 does not need to redesign the database again.

## 15. Enrichment service/script

Create a focused research-enrichment script/service rather than putting external API logic in React.

Responsibilities:

1. load eligible publications;
2. identify external scholarly record by DOI or high-confidence fallback match;
3. fetch bibliometric metadata;
4. append metric snapshots;
5. update publication summary metrics;
6. compute review counts;
7. calculate Impact components/completeness;
8. find open-access locations where reliably reported;
9. never overwrite verified editorial findings with automated prose;
10. output an exceptions/review queue for unmatched or ambiguous records.

It must be idempotent: repeated runs refresh current metrics without duplicating same-provider/same-capture records unnecessarily.

External API failures affect only that publication/provider and should not abort the entire 90-record run.

## 16. Scoring service

Create pure scoring functions separate from UI and network code:

- `calculateImpactScore()`;
- `calculateEvidenceStrength()`;
- `calculateEqualParentingRelevance()`;
- `calculateHistoricalImportance()` where enough structured inputs exist;
- component/explanation builders.

Each score returns both the numeric score and its component explanation/completeness.

Tests must explicitly prove that changing `finding_direction` alone never changes any quality/importance score.

## 17. Detail/editor experience

The editor should make missing enrichment obvious with a completion checklist:

- Bibliography verified
- Source link verified
- Citation metrics current
- Study definition coded
- Sample/ages coded
- Design coded
- Controls coded
- Findings coded
- Limitations coded
- Evidence score ready
- Relevance score ready
- Impact score ready
- Historical importance reviewed

Add a visible `Needs research enrichment` / `Ready for editorial review` / `Verified` status.

## 18. Publication gate

A publication should not be made public merely because it has a title and DOI.

Before `Published`, require at minimum:

- verified bibliographic identity;
- at least one public source/access link;
- overall finding/synthesis summary;
- limitations;
- `what_it_supports`;
- `what_it_does_not_establish`;
- result direction;
- citations or an explicit `citation data unavailable` status;
- evidence/relevance assessment appropriate to source type;
- for direct empirical studies, verified or explicitly reviewed analysis data sufficient to justify the displayed 50/50 classification.

Impact score may be unavailable for a genuinely unmatched/new work, but the reason must be visible.

## 19. Rollout order

### 1.5A — Accuracy and visibility

- change false `No` 50/50 values to tri-state;
- load metrics/review memberships in list query;
- add Cited By / Citations per Year / Major Reviews / Study Link;
- make source links clickable;
- add sorting.

### 1.5B — Bibliometric enrichment

- run scholarly matching for all 90;
- populate citation snapshots and summary fields;
- calculate citations/year, review count, impact components/completeness;
- add/open lawful source locations where found.

### 1.5C — Substantive study extraction

- process the anchor set first: Nielsen reviews and their included studies, Warshak, Bergström/Fifty Moves, Vowels, Bauserman, Baude, Steinbach, young-child caution literature;
- then complete remaining direct empirical studies and policy studies;
- populate findings, limitations, methodology, controls, exact parenting-time definition;
- create distinct child analysis rows where publications contain multiple analyses.

### 1.5D — Scoring and verification

- calculate Evidence Strength and Relevance from verified structured inputs;
- review Historical Importance;
- finalize Impact;
- move sufficiently enriched records to `needs_review`, not directly to `published`;
- maintain a visible queue for incomplete records.

## 20. Testing and verification

Required automated tests:

- no-study record displays 50/50 as Unknown, not No;
- coded non-50/50 study displays No;
- exact/near-50 study displays Yes;
- latest citation metric is selected correctly;
- zero citations remains a real zero, not missing;
- citations/year calculation handles current-year papers;
- review count is correct and does not double-count duplicate membership rows;
- missing metrics do not become zero;
- impact normalization ignores missing components and reports completeness;
- finding direction cannot alter any score;
- study-source link priority is deterministic;
- ambiguous scholarly matches are never silently accepted;
- external API failure for one work does not abort the batch;
- public cache never gains internal notes/raw extraction data;
- publication gate rejects analytically empty records.

Browser verification should cover desktop and mobile table behavior and clickable study links.

## 21. Success criteria

Phase 1.5 is complete when:

- the main list no longer misrepresents unknown 50/50 status as No;
- every record with a usable external source has a clickable study link;
- citation count / citation rate / review count are visible and sortable for substantially all matchable publications;
- Impact is populated wherever the minimum bibliometric data is sufficient and its completeness is visible;
- the anchor/high-priority literature has structured study-analysis records and substantive findings/limitations;
- the remaining empirical literature is in a visible enrichment queue rather than appearing falsely complete;
- Evidence Strength and Equal-Parenting Relevance are based on transparent, auditable components;
- publication status communicates research completeness;
- no automated enrichment can silently publish a paper or overwrite verified editorial research conclusions;
- the resulting data is rich enough that Phase 2 public pages convey research content and importance rather than merely article titles.

## 22. Explicit non-goals

- Do not claim all 90 papers are equally well verified on day one.
- Do not fabricate full-text details from titles or sparse abstracts.
- Do not use finding direction in any quality/importance score.
- Do not collapse provider citation counts into a fake combined count.
- Do not interpret “JPC” as exact 50/50 without evidence.
- Do not auto-publish records.
- Do not begin the public website rollout until a meaningful enriched subset is ready.
