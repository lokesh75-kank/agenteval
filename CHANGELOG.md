# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-08-08

### Added
- **Test configuration section in the HTML report**: runs per scenario, scenario
  pass threshold, LLM-judge usage, and generator version are now recorded in the
  report itself, so a reviewer can audit what was tested without access to the
  invocation. `SuiteReport` gains an optional `config` field (recorded by
  `runSuite`); reports without it (e.g. hand-built) render unchanged.

### Changed
- **Determinism-first default**: `runs` now defaults to 3 (was 1), matching the
  scaffolded configs and the 2-of-3 default pass threshold. Pass `runs: 1`
  explicitly for a single-shot check.
- **Judge ties fail closed**: without an explicit `passThreshold`, the
  LLM-judge now requires a strict majority of votes - an even split fails.
  An explicit `passThreshold` keeps inclusive (`>=`) semantics, so `1.0`
  still means "unanimous".

## [0.1.1] - 2026-06-21

### Added
- `case-studies/aaro-property-tax/` - real-agent validation: four recorded runs
  of an autonomous web agent on the same task scored at 25% determinism (1/4).
- `CHANGELOG.md` and `CONTRIBUTING.md`.

### Changed
- Trimmed the published package (source maps excluded): ~328KB -> ~113KB.
- Reframed reporting language as "audit-ready" (no implication of certified compliance).
- Scrubbed internal implementation references from public source comments.

## [0.1.0] - 2026-06-20

Initial public release.

### Added
- **Core**: `AgentAdapter` + `AgentTrace` contracts (wrap any agent), N-of-M
  determinism/flakiness runner (`runScenario`, `runSuite`), YAML scenario loader.
- **Assertions**: 14 kinds (tool-call, text, recall, grounding, refusal).
- **Grounding**: uncited-claim detection, citation parsing/resolution, quote
  matching, cross-section coherence; `GENERIC_PRESET` and `REGULATED_PRESET`.
- **Judge**: optional LLM-as-judge with self-consistency voting; fails closed.
- **LLM clients**: provider-agnostic Anthropic and Google clients (optional peer
  deps, lazy-loaded) plus cost estimation.
- **Ingest**: map OpenTelemetry and LangSmith traces into `AgentTrace`.
- **Reports**: console scorecard, JSON, and a self-contained audit-ready HTML report.
- **CLI**: `agenteval run | baseline | check | init`.
- **MCP server**: `evaluate_agent`, `check_grounding`, `get_report` tools.
- **Benchmark**: starter regulated scenario set from public-domain US regulatory text (eCFR/FDA).

[0.1.1]: https://github.com/lokesh75-kank/agenteval/releases/tag/v0.1.1
