# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/lokesh75-kank/agenteval/releases/tag/v0.1.0
