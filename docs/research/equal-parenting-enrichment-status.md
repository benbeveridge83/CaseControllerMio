# Equal Parenting Research Enrichment Status

Production snapshot: 2026-09-13
Supabase project: `vnnkxqpyndidnjbrbywz`

## Current production counts

- Publications: **90**
- Editorial status: **90 Draft / 0 Published**
- Publications with current citation data: **81**
- Publications with Impact score: **81**
- Impact data completeness: **70–85%** among scored records
- Publications with Evidence Strength: **7**
- Publications with Equal-Parenting Relevance: **18**
- Publications with Historical / Field Importance: **0** (still an editorial-review field)
- Publications with substantive findings summaries: **18**
- Publications marked `ready_for_editorial_review`: **18**
- Verified publications: **0**
- Structured child/study analyses: **9**
- Study analyses marked `needs_review`: **9**
- Verified study analyses: **0**
- Coded study-level 50/50 values: **2 Yes / 2 No / 5 Unknown**
- Publications with at least one verified major-review membership: **55**
- Maximum currently coded major-review count: **1** (the membership graph presently covers one major review; other review memberships remain an enrichment backlog)

## Bibliometric enrichment

OpenAlex enrichment is DOI-first. All 68 publications that originally had a DOI were matched by exact normalized DOI. A conservative title/year/author review accepted 12 additional no-DOI records. After the curated anchor pass added a verified DOI for Mahrer 2018, the final current citation coverage is **81 of 90 publications**.

`Cited By` uses the current OpenAlex citation count when available. Citation count, FWCI, and retrieval time are also retained as metric snapshots. `citations_per_year` is derived using a minimum denominator of one year. A true zero citation count remains `0`; missing data remains unknown.

Impact is calculated independently of finding direction from available cohort-relative citation count, citations/year, FWCI, and major-review inclusion. Missing components are omitted and the remaining weights are renormalized. Influential-citation and policy-influence components are not yet populated, which is why current Impact completeness is 70–85% rather than 100%.

## Source-backed anchor / caution set

The following 18 Work IDs now contain source-backed findings, limitations, what-the-paper-supports, and what-it-does-not-establish fields:

`W0001, W0002, W0003, W0004, W0005, W0006, W0007, W0008, W0011, W0012, W0025, W0060, W0069, W0080, W0081, W0092, W0093, W0101`

The nine publications in that set that contain distinct empirical analyses now have separate `research_studies` rows. These analyses remain `needs_review`; they were intentionally not auto-verified or auto-published.

Examples:

- `W0025` (*Fifty moves a year*) — N=147,839; ages 12 and 15; equal time with both parents; coded exact/near 50/50 = Yes; Evidence Strength 66; Relevance 100; current Impact 88.
- `W0069` (Tornello et al.) — very-young-child frequent-overnight literature; not automatically classified as exact 50/50; conditional-concern finding.
- `W0080` (Solomon & George) — infant overnight-visitation study, coded 50/50 = No rather than being conflated with equal residence.
- `W0081` (Pruett et al.) — young-child overnight/parenting-plan study, coded 50/50 = No.
- `W0092` (Steinbach & Augustijn) — near-equal residence; coded 50/50 = Yes; bivariate advantages disappear after controls; finding direction = Neutral.

## Unmatched citation queue

Nine records currently remain without accepted citation metrics because a safe DOI match or high-confidence title/author/year match was not established:

- `W0009` — Jensen & Sanner scoping review
- `W0035` — Cashmore/Parkinson shared-care arrangements
- `W0036` — Dissing et al. parental break-ups/stress
- `W0041` — Fabricius et al. parenting time/conflict/physical health
- `W0042` — Fabricius/Suh infant-toddler overnights
- `W0049` — Irving/Benjamin comparative analysis
- `W0054` — Australian 2006 Family Law Reforms evaluation
- `W0060` — McIntosh et al. post-separation infant/child outcomes report
- `W0095` — Augustijn loyalty-conflict moderation paper

These remain unknown rather than being attached to low-confidence OpenAlex search results.

## Remaining substantive enrichment backlog

1. Verify the nine imported empirical analyses and promote them from `needs_review` to `verified` after editorial/source review.
2. Add structured analyses for the remaining empirical publications.
3. Expand review-membership coding beyond the currently loaded major review so `Major Reviews` can distinguish repeated inclusion across Nielsen, Vowels, Baude, Steinbach, and other syntheses.
4. Review Historical / Field Importance with documented reasons; it remains intentionally blank rather than auto-generated from popularity alone.
5. Resolve the nine unmatched citation records where reliable identifiers can be found.
6. Add influential-citation and documented policy/legal-influence metrics where a reliable provider/source is available.

## Safety / publication state

No research record was auto-published during Phase 1.5. All 90 publications remain Draft. The public sanitized cache therefore remains empty until an editor explicitly reviews and publishes qualifying records.

The Supabase security advisor reports no new research-specific finding from Phase 1.5. Existing unrelated Mio advisor findings remain outside this project's scope.
