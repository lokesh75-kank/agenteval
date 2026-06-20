# Regulated QMS Benchmark

A small, high-signal benchmark of regulated quality-management-system (QMS)
questions for evaluating agents that answer compliance questions and must ground
their answers in the governing regulation.

Every scenario asks an agent a question about U.S. FDA medical-device
regulation. A correct answer must (a) state the requirement accurately and
(b) cite the controlling Code of Federal Regulations (CFR) clause. The benchmark
specifically rewards grounded, citation-backed answers and penalizes fabricated
regulatory text.

## What it covers

| Area | CFR Part | Scenarios |
| --- | --- | --- |
| Corrective & Preventive Action (CAPA) | 21 CFR 820.100 | `cfr-820-100-capa`, `cfr-820-100-a-subclauses` |
| Design Controls | 21 CFR 820.30 | `cfr-820-30-design-controls`, `cfr-820-30-g-design-validation` |
| Complaint Handling | 21 CFR 820.198 | `cfr-820-198-complaint-files` |
| Purchasing Controls | 21 CFR 820.50 | `cfr-820-50-purchasing-controls` |
| Medical Device Reporting (MDR) | 21 CFR 803.50, 803.53 | `cfr-803-50-mdr-30-day`, `cfr-803-53-5-day-report` |
| Corrections & Removals | 21 CFR 806.10 | `cfr-806-10-corrections-removals` |
| Electronic Records & Signatures | 21 CFR 11.10, 11.200 | `cfr-11-10-electronic-records`, `cfr-11-200-electronic-signatures` |
| Fabrication / refusal control | n/a (non-existent clause) | `cfr-out-of-scope-refusal` |

The last scenario is a negative control: it asks for a non-existent clause
(`21 CFR 820.9999`). A trustworthy regulated agent must refuse or flag the gap
rather than fabricate a citation. In regulated work, a confident wrong citation
is worse than no answer, so this case is treated as first-class.

## Public-domain sourcing (important)

All scenarios are authored fresh from **public-domain** U.S. federal regulatory
text. The Code of Federal Regulations and FDA guidance are works of the U.S.
government and are not subject to copyright. Primary sources:

- eCFR Title 21 (Food and Drugs): https://www.ecfr.gov/current/title-21
- FDA Quality System Regulation, 21 CFR Part 820
- FDA Medical Device Reporting, 21 CFR Part 803
- FDA Reports of Corrections and Removals, 21 CFR Part 806
- FDA Electronic Records; Electronic Signatures, 21 CFR Part 11

No proprietary fixtures, customer data, or internal schema are included. The
question wording, assertions, and judge rubrics were written for this benchmark
and reference only clause numbers and publicly documented requirements.

## Scenario shape

Each file is a single `Scenario` (see `src/core/types.ts`):

```yaml
id: cfr-820-100-capa
description: >
  ...
tags: [regulated]
input:
  user_message: >
    ...the regulated question...
asserts:
  - kind: text_contains_one_of      # clause number appears
    options: ["820.100"]
  - kind: every_claim_has_citation  # answer is grounded
  - kind: recall_at_k               # key requirements covered (some scenarios)
    expected: [...]
    k: 3
judge:                               # optional LLM-as-judge rubric
  rubric: >
    ...accuracy + correct clause + no fabrication...
  votes: 3
  passThreshold: 0.66
```

### Assertion kinds used

- `text_contains_one_of` - the controlling clause number must appear.
- `recall_at_k` - a minimum number of the enumerated requirements are covered.
- `every_claim_has_citation` - each regulatory claim must be grounded (delegates
  to the `grounding/` module).
- `text_does_not_contain` / `refusal` - used by the negative-control scenario to
  catch fabricated citations.

The `judge` rubric provides an LLM-as-judge backstop that grades accuracy and
correct clause identification with 3-vote self-consistency (pass at >= 66%).

## How to run

These YAML files are discovered via `manifest.yaml` and loaded by the suite
runner (loader implemented separately). At a high level:

1. Provide an `AgentAdapter` for the agent under test.
2. Load the scenarios from `bench/regulated/manifest.yaml`.
3. Run each scenario N times (for determinism scoring), evaluate `asserts`, and
   optionally run the `judge` rubric with an `LLMClient`.
4. Render a report with `report/renderConsole` / `renderHtml`.

For grounding assertions (`every_claim_has_citation`, `citations_resolve`,
`quote_matches_source`), pass the `REGULATED_PRESET` grounding config and the set
of known source ids (the clause numbers above) so CFR-style citations
(`21 CFR 820.100`, `[E1]`) are detected and resolved correctly.

## Design notes

- Scenarios are intentionally small and high-signal: a smoke baseline, not full
  coverage. A production suite would expand each CFR area to dozens of items with
  a domain partner.
- Assertions favor `*_one_of` and `recall_at_k` over brittle exact-string checks
  so that valid paraphrases pass while the load-bearing clause number and core
  requirements are still enforced.
- The negative control exists because grounding and refusal are the real product
  differentiators for regulated agents.
